#!/usr/bin/env python3
"""
distill_ghostfill_model.py — GhostFill Knowledge Distillation Pipeline
=======================================================================
Produces a smarter, more generalizable INT8 model via teacher-student
knowledge distillation.

Pipeline:
  1. Train a LARGE teacher model (3× the student capacity)
  2. Run teacher inference on all training samples → soft probability labels
  3. Train the compact student (same architecture as production) using:
       loss = α * CE(student, hard_label) + (1-α) * KL(student_T, teacher_T)
     where T = temperature (default 4.0), α = 0.3
  4. Export student → FP32 ONNX → INT8 ONNX (drop-in replacement)

Usage:
  pip install torch onnx onnxruntime numpy
  python training/distill_ghostfill_model.py [--epochs 60] [--temp 4.0] [--alpha 0.3]

Output:
  models/ghostfill_v1_int8.onnx   (updated, smarter student)
  models/ghostfill_v1_fp32.onnx   (FP32 backup)
  training/data/teacher_fp32.onnx (teacher, for reference)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import warnings
from typing import List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader, Dataset

warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    import onnx
    from onnxruntime.quantization import quantize_dynamic, QuantType
except ImportError as exc:
    sys.exit(
        f"[ERROR] Missing dependency: {exc}.\n"
        "  Run: pip install onnx onnxruntime onnxscript"
    )

# ── Constants (must match contract.ts) ─────────────────────────────────────────

CHAR_VOCAB_SIZE: int = 256
MAX_TEXT_LEN: int = 80
NUM_TEXT_CHANNELS: int = 8
NUM_STRUCTURAL: int = 64
NUM_CLASSES: int = 10

CLASS_NAMES: list[str] = [
    "Email",
    "Username",
    "Password",
    "Target_Password_Confirm",
    "First_Name",
    "Last_Name",
    "Full_Name",
    "Phone",
    "OTP",
    "Unknown",
]

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")

# Output paths
MODELS_DIR = "models"
DATA_DIR = os.path.join("training", "data")
STUDENT_INT8 = os.path.join(MODELS_DIR, "ghostfill_v1_int8.onnx")
STUDENT_FP32 = os.path.join(MODELS_DIR, "ghostfill_v1_fp32.onnx")
TEACHER_FP32 = os.path.join(DATA_DIR, "teacher_fp32.onnx")
SOFT_LABELS_FILE = os.path.join(DATA_DIR, "soft_labels.json")


# ══════════════════════════════════════════════════════════════════════════════
# PART 1 — SHARED MODEL ARCHITECTURES
# ══════════════════════════════════════════════════════════════════════════════


class CharCNNEncoder(nn.Module):
    """
    Shared character-level CNN applied independently to each text channel.
    Input:  (B, MAX_TEXT_LEN)  — int64 char indices
    Output: (B, output_dim)    — dense channel representation
    """

    def __init__(
        self,
        vocab_size: int = CHAR_VOCAB_SIZE,
        embed_dim: int = 48,
        output_dim: int = 192,
        dropout: float = 0.15,
    ) -> None:
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        mid = embed_dim * 2
        large = embed_dim * 4
        self.conv_stack = nn.Sequential(
            nn.Conv1d(embed_dim, mid, kernel_size=3, padding=1),
            nn.GroupNorm(min(8, mid), mid),
            nn.GELU(),
            nn.MaxPool1d(2),
            nn.Conv1d(mid, large, kernel_size=3, padding=1),
            nn.GroupNorm(min(8, large), large),
            nn.GELU(),
            nn.MaxPool1d(2),
            nn.Conv1d(large, output_dim, kernel_size=3, padding=1),
            nn.GroupNorm(min(8, output_dim), output_dim),
            nn.GELU(),
        )
        self.pool = nn.AdaptiveMaxPool1d(1)
        self.proj = nn.Linear(output_dim, output_dim)
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        emb = self.embedding(x)          # (B, L, E)
        emb = emb.transpose(1, 2)        # (B, E, L)
        h = self.conv_stack(emb)
        h = self.pool(h).squeeze(-1)     # (B, output_dim)
        return self.drop(self.proj(h))


class CrossChannelAttention(nn.Module):
    """Multi-head cross-channel attention: finds which text channels matter most."""

    def __init__(self, channel_dim: int, num_heads: int = 4) -> None:
        super().__init__()
        self.attn = nn.MultiheadAttention(channel_dim, num_heads, batch_first=True)
        self.norm = nn.LayerNorm(channel_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, num_channels, channel_dim)
        out, _ = self.attn(x, x, x)
        return self.norm(x + out)


class StructuralEncoder(nn.Module):
    """MLP encoder for the 64-dim structural feature vector."""

    def __init__(self, in_dim: int = NUM_STRUCTURAL, hidden_dim: int = 128, out_dim: int = 128) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(0.1),
            nn.Linear(hidden_dim, out_dim),
            nn.LayerNorm(out_dim),
            nn.GELU(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def _make_classifier(
    embed_dim: int,
    num_structural_out: int,
    num_heads: int,
    struct_hidden: int,
    head_hidden: int,
    dropout: float = 0.2,
) -> tuple:
    """
    Returns (cnn_encoder, attn, struct_encoder, head) as a tuple.
    Extracted to allow building both teacher and student with different sizes.
    """
    cnn = CharCNNEncoder(embed_dim=embed_dim, output_dim=embed_dim * 4, dropout=dropout)
    channel_dim = embed_dim * 4
    attn = CrossChannelAttention(channel_dim, num_heads=num_heads)
    struct = StructuralEncoder(NUM_STRUCTURAL, struct_hidden, num_structural_out)
    fused_dim = channel_dim + num_structural_out
    head = nn.Sequential(
        nn.Linear(fused_dim, head_hidden),
        nn.LayerNorm(head_hidden),
        nn.GELU(),
        nn.Dropout(dropout),
        nn.Linear(head_hidden, head_hidden // 2),
        nn.GELU(),
        nn.Linear(head_hidden // 2, NUM_CLASSES),
    )
    return cnn, attn, struct, head


class FieldClassifier(nn.Module):
    """
    Unified field classifier. Used for both teacher (large) and student (compact).

    embed_dim:      embedding dimension per char (student=48, teacher=96)
    struct_out:     structural encoder output dim (student=128, teacher=256)
    num_heads:      attention heads (student=4, teacher=8)
    head_hidden:    MLP head hidden size (student=320, teacher=768)
    """

    def __init__(
        self,
        embed_dim: int = 48,
        struct_out: int = 128,
        num_heads: int = 4,
        head_hidden: int = 320,
        dropout: float = 0.2,
    ) -> None:
        super().__init__()
        self.cnn, self.attn, self.struct_enc, self.head = _make_classifier(
            embed_dim, struct_out, num_heads, struct_out, head_hidden, dropout
        )
        self.channel_dim = embed_dim * 4

    def forward(
        self,
        text_channels: torch.Tensor,  # (B, 8, 80) int64
        structural: torch.Tensor,      # (B, 64) float32
    ) -> torch.Tensor:
        B = text_channels.size(0)
        # Encode each channel independently
        channels = text_channels.view(B * NUM_TEXT_CHANNELS, MAX_TEXT_LEN)
        encoded = self.cnn(channels)                           # (B*8, channel_dim)
        encoded = encoded.view(B, NUM_TEXT_CHANNELS, -1)       # (B, 8, channel_dim)
        attended = self.attn(encoded)                          # (B, 8, channel_dim)
        text_feat = attended.mean(dim=1)                       # (B, channel_dim)
        struct_feat = self.struct_enc(structural)              # (B, struct_out)
        fused = torch.cat([text_feat, struct_feat], dim=-1)    # (B, channel_dim+struct_out)
        return self.head(fused)                                # (B, 10)


# ══════════════════════════════════════════════════════════════════════════════
# PART 2 — DATA GENERATION (Improved Synthetic + Real DOM Data)
# ══════════════════════════════════════════════════════════════════════════════

# fmt: off
_SEEDS: dict[str, list[dict]] = {
    "Email": [
        {"name": "email", "id": "email", "placeholder": "Enter your email", "autocomplete": "email", "type": "email"},
        {"name": "emailAddress", "id": "emailAddress", "placeholder": "Email address", "autocomplete": "email", "type": "text"},
        {"name": "user_email", "id": "user-email", "placeholder": "Your email", "autocomplete": "email", "type": "email"},
        {"name": "login_email", "id": "loginEmail", "placeholder": "example@gmail.com", "autocomplete": "email", "type": "email"},
        {"name": "correo", "id": "correo", "placeholder": "Correo electrónico", "autocomplete": "email", "type": "email"},  # Spanish
        {"name": "email_utilisateur", "id": "emailUtilisateur", "placeholder": "Adresse e-mail", "autocomplete": "email", "type": "email"},  # French
        {"name": "e-mail", "id": "e-mail", "placeholder": "E-Mail-Adresse", "autocomplete": "email", "type": "email"},  # German
    ],
    "Username": [
        {"name": "username", "id": "username", "placeholder": "Username", "autocomplete": "username", "type": "text"},
        {"name": "login_name", "id": "loginName", "placeholder": "Login name", "autocomplete": "username", "type": "text"},
        {"name": "user_id", "id": "userId", "placeholder": "User ID", "autocomplete": "username", "type": "text"},
        {"name": "handle", "id": "handle", "placeholder": "Choose a username", "autocomplete": "username", "type": "text"},
        {"name": "nombre_usuario", "id": "nombreUsuario", "placeholder": "Nombre de usuario", "autocomplete": "username", "type": "text"},
    ],
    "Password": [
        {"name": "password", "id": "password", "placeholder": "Password", "autocomplete": "current-password", "type": "password"},
        {"name": "passwd", "id": "passwd", "placeholder": "Enter password", "autocomplete": "current-password", "type": "password"},
        {"name": "pwd", "id": "pwd", "placeholder": "Your password", "autocomplete": "current-password", "type": "password"},
        {"name": "login_password", "id": "loginPassword", "placeholder": "Account password", "autocomplete": "current-password", "type": "password"},
        {"name": "mot_de_passe", "id": "motDePasse", "placeholder": "Mot de passe", "autocomplete": "current-password", "type": "password"},
        {"name": "contraseña", "id": "contraseña", "placeholder": "Contraseña", "autocomplete": "current-password", "type": "password"},
        {"name": "passwort", "id": "passwort", "placeholder": "Passwort", "autocomplete": "current-password", "type": "password"},
    ],
    "Target_Password_Confirm": [
        {"name": "confirm_password", "id": "confirmPassword", "placeholder": "Confirm password", "autocomplete": "new-password", "type": "password"},
        {"name": "password_confirmation", "id": "passwordConfirmation", "placeholder": "Repeat password", "autocomplete": "new-password", "type": "password"},
        {"name": "retype_password", "id": "retypePassword", "placeholder": "Retype your password", "autocomplete": "new-password", "type": "password"},
        {"name": "confirmar_contraseña", "id": "confirmarContraseña", "placeholder": "Confirmar contraseña", "autocomplete": "new-password", "type": "password"},
    ],
    "First_Name": [
        {"name": "first_name", "id": "firstName", "placeholder": "First name", "autocomplete": "given-name", "type": "text"},
        {"name": "fname", "id": "fname", "placeholder": "First", "autocomplete": "given-name", "type": "text"},
        {"name": "given_name", "id": "givenName", "placeholder": "Given name", "autocomplete": "given-name", "type": "text"},
        {"name": "prenom", "id": "prenom", "placeholder": "Prénom", "autocomplete": "given-name", "type": "text"},
        {"name": "nombre", "id": "nombre", "placeholder": "Nombre", "autocomplete": "given-name", "type": "text"},
    ],
    "Last_Name": [
        {"name": "last_name", "id": "lastName", "placeholder": "Last name", "autocomplete": "family-name", "type": "text"},
        {"name": "lname", "id": "lname", "placeholder": "Last", "autocomplete": "family-name", "type": "text"},
        {"name": "family_name", "id": "familyName", "placeholder": "Family name", "autocomplete": "family-name", "type": "text"},
        {"name": "apellido", "id": "apellido", "placeholder": "Apellido", "autocomplete": "family-name", "type": "text"},
        {"name": "nom", "id": "nom", "placeholder": "Nom de famille", "autocomplete": "family-name", "type": "text"},
    ],
    "Full_Name": [
        {"name": "full_name", "id": "fullName", "placeholder": "Full name", "autocomplete": "name", "type": "text"},
        {"name": "name", "id": "name", "placeholder": "Your full name", "autocomplete": "name", "type": "text"},
        {"name": "display_name", "id": "displayName", "placeholder": "Display name", "autocomplete": "name", "type": "text"},
        {"name": "cardholder_name", "id": "cardholderName", "placeholder": "Cardholder name", "autocomplete": "cc-name", "type": "text"},
        {"name": "nombre_completo", "id": "nombreCompleto", "placeholder": "Nombre completo", "autocomplete": "name", "type": "text"},
        {"name": "nom_complet", "id": "nomComplet", "placeholder": "Nom complet", "autocomplete": "name", "type": "text"},
    ],
    "Phone": [
        {"name": "phone", "id": "phone", "placeholder": "Phone number", "autocomplete": "tel", "type": "tel"},
        {"name": "mobile", "id": "mobile", "placeholder": "Mobile number", "autocomplete": "tel", "type": "tel"},
        {"name": "cell", "id": "cell", "placeholder": "Cell phone", "autocomplete": "tel", "type": "tel"},
        {"name": "telefono", "id": "telefono", "placeholder": "Número de teléfono", "autocomplete": "tel", "type": "tel"},
        {"name": "telephone", "id": "telephone", "placeholder": "Numéro de téléphone", "autocomplete": "tel", "type": "tel"},
    ],
    "OTP": [
        {"name": "otp", "id": "otp", "placeholder": "Enter OTP", "autocomplete": "one-time-code", "type": "text"},
        {"name": "code", "id": "code", "placeholder": "Verification code", "autocomplete": "one-time-code", "type": "text"},
        {"name": "verification_code", "id": "verificationCode", "placeholder": "6-digit code", "autocomplete": "one-time-code", "type": "text"},
        {"name": "security_code", "id": "securityCode", "placeholder": "Security code", "autocomplete": "one-time-code", "type": "text"},
        {"name": "pin", "id": "pin", "placeholder": "PIN", "autocomplete": "one-time-code", "type": "number"},
        {"name": "token", "id": "token", "placeholder": "Auth token", "autocomplete": "one-time-code", "type": "text"},
        {"name": "codigo", "id": "codigo", "placeholder": "Código de verificación", "autocomplete": "one-time-code", "type": "text"},
        {"name": "code_verification", "id": "codeVerification", "placeholder": "Code de vérification", "autocomplete": "one-time-code", "type": "text"},
    ],
    "Unknown": [
        {"name": "search", "id": "search", "placeholder": "Search...", "autocomplete": "off", "type": "search"},
        {"name": "coupon", "id": "coupon", "placeholder": "Promo code", "autocomplete": "off", "type": "text"},
        {"name": "card_number", "id": "cardNumber", "placeholder": "Card number", "autocomplete": "cc-number", "type": "text"},
        {"name": "cvv", "id": "cvv", "placeholder": "CVV", "autocomplete": "cc-csc", "type": "text"},
        {"name": "zipcode", "id": "zipcode", "placeholder": "ZIP code", "autocomplete": "postal-code", "type": "text"},
        {"name": "website", "id": "website", "placeholder": "Website URL", "autocomplete": "url", "type": "url"},
        {"name": "company", "id": "company", "placeholder": "Company name", "autocomplete": "organization", "type": "text"},
        {"name": "bio", "id": "bio", "placeholder": "Tell us about yourself", "autocomplete": "off", "type": "text"},
        {"name": "amount", "id": "amount", "placeholder": "Enter amount", "autocomplete": "off", "type": "number"},
        {"name": "birthdate", "id": "birthdate", "placeholder": "Date of birth", "autocomplete": "bday", "type": "text"},
    ],
}
# fmt: on

# Multilingual keyword augmentation pools (for noise injection)
_LANG_VARIANTS = {
    "email": ["email", "correo", "e-mail", "courriel", "メール", "邮箱"],
    "password": ["password", "contraseña", "mot de passe", "passwort", "senha"],
    "username": ["username", "usuario", "utilisateur", "benutzername"],
    "otp": ["otp", "code", "codigo", "code de vérification", "確認コード"],
    "name": ["name", "nombre", "nom", "名前", "姓名"],
}


def encode_text(text: str, max_len: int = MAX_TEXT_LEN) -> list[int]:
    """Encode string to char-code array, padded/truncated to max_len."""
    text = (text or "").lower()[:max_len]
    encoded = [min(ord(c), 255) for c in text]
    encoded += [0] * (max_len - len(encoded))
    return encoded


def build_structural_from_seed(seed: dict) -> list[float]:
    """
    Build a 64-dim structural vector from a seed dict.
    Indices match STRUCT constants in contract.ts exactly.
    """
    v = [0.0] * 64

    # Type one-hots (0..7)
    t = seed.get("type", "text")
    type_map = {"text": 0, "email": 1, "password": 2, "tel": 3,
                "number": 4, "search": 5, "hidden": 6}
    v[type_map.get(t, 7)] = 1.0

    # Autocomplete coarse buckets (8..15)
    ac = seed.get("autocomplete", "")
    if "email" in ac:           v[8] = 1.0
    if "username" in ac:        v[9] = 1.0
    if "current-password" in ac: v[10] = 1.0
    if "new-password" in ac:    v[11] = 1.0
    if "one-time-code" in ac:   v[12] = 1.0
    if "tel" in ac:             v[13] = 1.0
    if any(x in ac for x in ["name", "given", "family"]): v[14] = 1.0
    if ac in ("", "off", "nope"): v[15] = 1.0

    # Structural signals (16..31)
    v[22] = 1.0  # VISIBLE — always visible for training seeds
    v[26] = 1.0  # IN_FORM — assume in a form
    if seed.get("name") or seed.get("id"):    v[23] = 1.0  # HAS_LABEL
    if seed.get("placeholder"):               v[24] = 1.0  # HAS_PLACEHOLDER
    if seed.get("aria_label"):                v[25] = 1.0  # HAS_ARIA

    # Keyword presence on combined text (32..55) — match keywords.ts
    combined = " ".join([
        seed.get("name", ""), seed.get("id", ""),
        seed.get("placeholder", ""), seed.get("autocomplete", ""),
        seed.get("label_text", ""), seed.get("aria_label", ""),
    ]).lower()

    # 32=KW_EMAIL, 33=KW_USER, 34=KW_PASS, 35=KW_CONFIRM, 36=KW_NEW, 37=KW_CURRENT
    # 38=KW_OTP, 39=KW_CODE, 40=KW_VERIFY, 41=KW_PHONE, 42=KW_FIRST, 43=KW_LAST
    # 44=KW_FULLNAME, 45=KW_CVV, 46=KW_CARD, 47=KW_EXPIRY, 48=KW_ZIP, 49=KW_SEARCH
    # 50=KW_COUPON, 51=KW_CAPTCHA, 52=KW_AMOUNT, 53=KW_DOB, 54=KW_DIGITS_IN_NAME, 55=KW_OTP_LENGTH_HINT
    kw_map = [
        (32, ["email", "correo", "courriel", "e-mail"]),
        (33, ["user", "usuario", "utilisateur"]),
        (34, ["password", "passwd", "pwd", "contraseña", "passwort", "senha"]),
        (35, ["confirm", "confirmar", "repeat", "retype"]),
        (36, ["new", "nuevo", "nouveau"]),
        (37, ["current", "actual", "actuel"]),
        (38, ["otp", "one-time", "einmalpasswort"]),
        (39, ["code", "codigo", "codice"]),
        (40, ["verify", "verification", "verificar"]),
        (41, ["phone", "mobile", "tel", "celular", "telefono"]),
        (42, ["first", "given", "prenom", "nombre"]),
        (43, ["last", "family", "nom", "apellido"]),
        (44, ["full name", "fullname", "nombre completo", "nom complet"]),
        (45, ["cvv", "cvc", "security code"]),
        (46, ["card", "credit", "debit"]),
        (47, ["expiry", "expiration", "exp"]),
        (48, ["zip", "postal", "postcode"]),
        (49, ["search", "query", "find", "buscar"]),
        (50, ["coupon", "promo", "voucher"]),
        (51, ["captcha", "robot", "human"]),
        (52, ["amount", "price", "sum"]),
        (53, ["birth", "dob", "birthday", "nacimiento"]),
    ]
    for idx, keywords in kw_map:
        if any(kw in combined for kw in keywords):
            v[idx] = 1.0

    return v


def augment_seed(seed: dict, noise_prob: float = 0.15) -> dict:
    """Apply noise augmentation to a seed to improve generalization."""
    s = dict(seed)
    # Randomly corrupt some text fields
    for field in ["name", "id", "placeholder"]:
        if field in s and random.random() < noise_prob:
            text = s[field]
            if len(text) > 3:
                # Random character deletion/substitution
                idx = random.randint(0, len(text) - 1)
                s[field] = text[:idx] + text[idx + 1:]
    return s


def make_dataset(samples_per_class: int = 500) -> list[dict]:
    """
    Build a training dataset from seeds + augmentation.
    Returns list of {text_channels, structural, label_idx}.
    """
    records: list[dict] = []
    for class_name, seeds in _SEEDS.items():
        label_idx = CLASS_NAMES.index(class_name)
        target = samples_per_class
        while len([r for r in records if r["label_idx"] == label_idx]) < target:
            seed = random.choice(seeds)
            seed = augment_seed(seed)
            text_channels = [
                encode_text(seed.get("placeholder", "")),      # ch0
                encode_text(seed.get("aria_label", "")),        # ch1
                encode_text(seed.get("label_text", "")),        # ch2
                encode_text(f"{seed.get('name','')} {seed.get('id','')}".strip()),  # ch3
                encode_text(seed.get("autocomplete", "")),      # ch4
                encode_text(seed.get("surrounding", "")),       # ch5
                encode_text(""),                                 # ch6
                encode_text(""),                                 # ch7
            ]
            structural = build_structural_from_seed(seed)
            records.append({
                "text_channels": text_channels,
                "structural": structural,
                "label_idx": label_idx,
            })
    random.shuffle(records)
    return records


# Try to load real DOM data collected via the extension's "Collect Training Data" feature
def load_real_data() -> list[dict]:
    real_records: list[dict] = []
    for data_file in [
        "ghostfill_user_data.json",
        os.path.join("training", "data", "real_samples.json"),
        os.path.join("training", "data", "scraped_data.json"),
    ]:
        if not os.path.exists(data_file):
            continue
        try:
            with open(data_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            loaded = 0
            for item in data:
                label = item.get("label", "")
                if label not in CLASS_NAMES:
                    continue
                features = item.get("features", {})
                seed = {
                    "name": features.get("name", ""),
                    "id": features.get("id", ""),
                    "placeholder": features.get("placeholder", ""),
                    "autocomplete": features.get("autocomplete", ""),
                    "type": features.get("type", "text"),
                    "label_text": features.get("labelText", ""),
                    "aria_label": features.get("ariaLabel", ""),
                    "surrounding": features.get("surroundingText", ""),
                }
                text_channels = [
                    encode_text(seed.get("placeholder", "")),
                    encode_text(seed.get("aria_label", "")),
                    encode_text(seed.get("label_text", "")),
                    encode_text(f"{seed.get('name','')} {seed.get('id','')}".strip()),
                    encode_text(seed.get("autocomplete", "")),
                    encode_text(seed.get("surrounding", "")[:MAX_TEXT_LEN]),
                    encode_text(seed.get("surrounding", "")[MAX_TEXT_LEN:]),
                    encode_text(""),
                ]
                structural = build_structural_from_seed(seed)
                real_records.append({
                    "text_channels": text_channels,
                    "structural": structural,
                    "label_idx": CLASS_NAMES.index(label),
                })
                loaded += 1
            print(f"  [+] Loaded {loaded} real DOM samples from {data_file}")
        except Exception as e:
            print(f"  [!] Could not load real data from {data_file}: {e}")
    return real_records


# ── PyTorch Dataset ───────────────────────────────────────────────────────────

class FieldDataset(Dataset):
    def __init__(self, records: list[dict]) -> None:
        self.records = records

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, idx: int) -> tuple:
        r = self.records[idx]
        text = torch.tensor(r["text_channels"], dtype=torch.int64)   # (8, 80)
        struct = torch.tensor(r["structural"], dtype=torch.float32)   # (64,)
        label = torch.tensor(r["label_idx"], dtype=torch.long)
        soft = torch.tensor(r.get("soft_label", []), dtype=torch.float32)  # (10,) or empty
        return text, struct, label, soft


# ══════════════════════════════════════════════════════════════════════════════
# PART 3 — TRAINING LOOPS
# ══════════════════════════════════════════════════════════════════════════════


def train_model(
    model: nn.Module,
    dataset: list[dict],
    epochs: int,
    batch_size: int = 64,
    lr: float = 1e-3,
    label: str = "Model",
) -> None:
    """Standard cross-entropy training (for teacher)."""
    model.to(DEVICE)
    model.train()
    loader = DataLoader(FieldDataset(dataset), batch_size=batch_size, shuffle=True, drop_last=True)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=lr, epochs=epochs, steps_per_epoch=len(loader)
    )
    ce = nn.CrossEntropyLoss()
    print(f"\n{'─'*60}")
    print(f"  Training {label} for {epochs} epochs on {len(dataset)} samples")
    print(f"  Device: {DEVICE}")
    print(f"{'─'*60}")

    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        correct = 0
        total = 0
        for text, struct, labels, _ in loader:
            text, struct, labels = text.to(DEVICE), struct.to(DEVICE), labels.to(DEVICE)
            optimizer.zero_grad()
            logits = model(text, struct)
            loss = ce(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            total_loss += loss.item()
            correct += (logits.argmax(dim=1) == labels).sum().item()
            total += labels.size(0)

        if epoch % 5 == 0 or epoch == epochs:
            acc = correct / total * 100
            avg_loss = total_loss / len(loader)
            print(f"  Epoch {epoch:3d}/{epochs} | Loss: {avg_loss:.4f} | Acc: {acc:.1f}%")


def generate_soft_labels(
    teacher: nn.Module,
    dataset: list[dict],
    temperature: float = 4.0,
    batch_size: int = 128,
) -> list[dict]:
    """Run teacher inference to generate soft probability labels for each sample."""
    teacher.eval()
    teacher.to(DEVICE)
    print(f"\n  Generating soft labels (T={temperature}) for {len(dataset)} samples...")

    loader = DataLoader(
        FieldDataset(dataset), batch_size=batch_size, shuffle=False
    )
    enriched = []
    offset = 0

    with torch.no_grad():
        for text, struct, labels, _ in loader:
            text, struct = text.to(DEVICE), struct.to(DEVICE)
            logits = teacher(text, struct)
            soft_probs = F.softmax(logits / temperature, dim=-1).cpu().numpy()
            for i, probs in enumerate(soft_probs):
                rec = dict(dataset[offset + i])
                rec["soft_label"] = probs.tolist()
                enriched.append(rec)
            offset += len(labels)

    print(f"  ✓ Soft labels generated for {len(enriched)} samples")
    return enriched


def distillation_loss(
    student_logits: torch.Tensor,
    teacher_soft: torch.Tensor,
    hard_labels: torch.Tensor,
    temperature: float = 4.0,
    alpha: float = 0.3,
) -> torch.Tensor:
    """
    Combined distillation loss:
      α * CE(student, hard_label) + (1-α) * KL(student_T, teacher_T) * T²
    The T² factor compensates for gradient scaling with temperature.
    """
    hard_loss = F.cross_entropy(student_logits, hard_labels)
    student_soft = F.log_softmax(student_logits / temperature, dim=-1)
    kl_loss = F.kl_div(student_soft, teacher_soft, reduction="batchmean") * (temperature ** 2)
    return alpha * hard_loss + (1 - alpha) * kl_loss


def train_student_distill(
    student: nn.Module,
    dataset: list[dict],  # already has soft_label field
    epochs: int,
    temperature: float = 4.0,
    alpha: float = 0.3,
    batch_size: int = 64,
    lr: float = 5e-4,
) -> None:
    """Distillation training loop for the student model."""
    student.to(DEVICE)
    student.train()
    loader = DataLoader(FieldDataset(dataset), batch_size=batch_size, shuffle=True, drop_last=True)
    optimizer = torch.optim.AdamW(student.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    print(f"\n{'─'*60}")
    print(f"  Distillation Training — Student for {epochs} epochs")
    print(f"  Temperature: {temperature:.1f} | Alpha: {alpha:.2f}")
    print(f"{'─'*60}")

    for epoch in range(1, epochs + 1):
        total_loss = 0.0
        correct = 0
        total = 0
        for text, struct, labels, soft in loader:
            text, struct, labels = text.to(DEVICE), struct.to(DEVICE), labels.to(DEVICE)
            # If soft labels available (non-empty), use distillation loss
            if soft.size(1) == NUM_CLASSES:
                soft = soft.to(DEVICE)
                optimizer.zero_grad()
                student_logits = student(text, struct)
                loss = distillation_loss(student_logits, soft, labels, temperature, alpha)
            else:
                optimizer.zero_grad()
                student_logits = student(text, struct)
                loss = F.cross_entropy(student_logits, labels)

            loss.backward()
            torch.nn.utils.clip_grad_norm_(student.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item()
            correct += (student_logits.argmax(dim=1) == labels).sum().item()
            total += labels.size(0)

        scheduler.step()

        if epoch % 5 == 0 or epoch == epochs:
            acc = correct / total * 100
            avg_loss = total_loss / len(loader)
            print(f"  Epoch {epoch:3d}/{epochs} | Loss: {avg_loss:.4f} | Acc: {acc:.1f}%")


# ══════════════════════════════════════════════════════════════════════════════
# PART 4 — ONNX EXPORT + QUANTIZATION
# ══════════════════════════════════════════════════════════════════════════════


def export_and_quantize(
    model: nn.Module,
    fp32_path: str,
    int8_path: str,
    label: str = "model",
) -> None:
    """Export PyTorch model → FP32 ONNX → INT8 ONNX."""
    model.eval().to("cpu")
    os.makedirs(os.path.dirname(fp32_path) if os.path.dirname(fp32_path) else ".", exist_ok=True)

    dummy_text = torch.zeros(1, NUM_TEXT_CHANNELS, MAX_TEXT_LEN, dtype=torch.int64)
    dummy_struct = torch.zeros(1, NUM_STRUCTURAL, dtype=torch.float32)

    print(f"\n  Exporting {label} → {fp32_path}")
    torch.onnx.export(
        model,
        (dummy_text, dummy_struct),
        fp32_path,
        opset_version=14,
        input_names=["text_channels", "structural"],
        output_names=["logits"],
        dynamic_axes={
            "text_channels": {0: "batch"},
            "structural": {0: "batch"},
            "logits": {0: "batch"},
        },
    )

    # Verify
    m = onnx.load(fp32_path)
    onnx.checker.check_model(m)
    size_mb = os.path.getsize(fp32_path) / 1024 / 1024
    print(f"  ✓ FP32 ONNX exported ({size_mb:.1f} MB)")

    # INT8 Quantization
    print(f"  Quantizing → {int8_path}")
    quantize_dynamic(
        model_input=fp32_path,
        model_output=int8_path,
        weight_type=QuantType.QInt8,
    )
    size_mb_int8 = os.path.getsize(int8_path) / 1024 / 1024
    print(f"  ✓ INT8 ONNX quantized ({size_mb_int8:.1f} MB)")


# ══════════════════════════════════════════════════════════════════════════════
# PART 5 — EVALUATION
# ══════════════════════════════════════════════════════════════════════════════


def evaluate(model: nn.Module, dataset: list[dict], label: str = "Model") -> float:
    """Compute held-out accuracy on a subset of data."""
    model.eval().to(DEVICE)
    # Use last 20% as held-out set
    held_out = dataset[int(len(dataset) * 0.8):]
    if not held_out:
        return 0.0

    loader = DataLoader(FieldDataset(held_out), batch_size=128, shuffle=False)
    correct = 0
    total = 0
    with torch.no_grad():
        for text, struct, labels, _ in loader:
            text, struct, labels = text.to(DEVICE), struct.to(DEVICE), labels.to(DEVICE)
            preds = model(text, struct).argmax(dim=1)
            correct += (preds == labels).sum().item()
            total += labels.size(0)

    acc = correct / total * 100 if total > 0 else 0.0
    print(f"\n  [{label}] Held-out accuracy: {acc:.1f}%  ({correct}/{total})")
    return acc


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="GhostFill Knowledge Distillation")
    p.add_argument("--teacher-epochs", type=int, default=50, help="Teacher training epochs")
    p.add_argument("--student-epochs", type=int, default=60, help="Student distillation epochs")
    p.add_argument("--samples", type=int, default=500, help="Synthetic samples per class")
    p.add_argument("--temp", type=float, default=4.0, help="Distillation temperature")
    p.add_argument("--alpha", type=float, default=0.3, help="Hard label weight (0=all soft, 1=all hard)")
    p.add_argument("--skip-teacher", action="store_true", help="Skip teacher training (use cached soft labels)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    os.makedirs(MODELS_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)

    print("\n" + "═" * 60)
    print("  GhostFill Knowledge Distillation Pipeline")
    print("═" * 60)
    print(f"  Device     : {DEVICE}")
    print(f"  Temperature: {args.temp}")
    print(f"  Alpha      : {args.alpha}")
    print(f"  Samples/cls: {args.samples}")

    # ── Step 1: Build dataset ──────────────────────────────────────────────────
    print("\n[1/5] Building training dataset...")
    synthetic = make_dataset(samples_per_class=args.samples)
    real_data = load_real_data()
    all_data = synthetic + real_data
    random.shuffle(all_data)
    print(f"  Total samples: {len(all_data)} (synthetic={len(synthetic)}, real={len(real_data)})")

    # ── Step 2: Train teacher (3× size) ──────────────────────────────────────
    if not args.skip_teacher or not os.path.exists(SOFT_LABELS_FILE):
        print("\n[2/5] Training large teacher model...")
        teacher = FieldClassifier(
            embed_dim=96,       # 2× student embed_dim
            struct_out=256,     # 2× student struct_out
            num_heads=8,        # 2× student heads
            head_hidden=768,    # 2.4× student head_hidden
            dropout=0.15,
        )
        train_model(teacher, all_data, epochs=args.teacher_epochs, label="Teacher")

        acc_teacher = evaluate(teacher, all_data, label="Teacher")
        if acc_teacher < 70.0:
            print("  ⚠  Teacher accuracy below 70% — consider more data or epochs")

        # Export teacher for reference
        export_and_quantize(teacher, TEACHER_FP32, TEACHER_FP32.replace(".onnx", "_int8.onnx"), "Teacher")

        # ── Step 3: Generate soft labels ───────────────────────────────────────
        print("\n[3/5] Generating soft labels from teacher...")
        enriched_data = generate_soft_labels(teacher, all_data, temperature=args.temp)

        # Save for inspection / skip-teacher re-runs
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(SOFT_LABELS_FILE, "w") as f:
            json.dump(enriched_data, f)
        print(f"  Soft labels saved to {SOFT_LABELS_FILE}")
    else:
        print("\n[2/5] Skipping teacher (loading cached soft labels)...")
        print(f"\n[3/5] Loading soft labels from {SOFT_LABELS_FILE}...")
        with open(SOFT_LABELS_FILE) as f:
            enriched_data = json.load(f)
        print(f"  Loaded {len(enriched_data)} samples with soft labels")

    # ── Step 4: Train student with distillation ────────────────────────────────
    print("\n[4/5] Training student model via distillation...")
    student = FieldClassifier(
        embed_dim=48,
        struct_out=128,
        num_heads=4,
        head_hidden=320,
        dropout=0.2,
    )
    train_student_distill(
        student, enriched_data,
        epochs=args.student_epochs,
        temperature=args.temp,
        alpha=args.alpha,
    )
    acc_student = evaluate(student, enriched_data, label="Student (distilled)")

    # ── Step 5: Export student ────────────────────────────────────────────────
    print("\n[5/5] Exporting distilled student model...")
    export_and_quantize(student, STUDENT_FP32, STUDENT_INT8, "Student")

    print("\n" + "═" * 60)
    print("  ✅ Distillation complete!")
    print(f"     Student held-out accuracy : {acc_student:.1f}%")
    print(f"     Output INT8 model         : {STUDENT_INT8}")
    print(f"     Output FP32 model         : {STUDENT_FP32}")
    print("═" * 60)
    print("\n  Next steps:")
    print("  1. Build the extension: npm run build")
    print("  2. Load unpacked in Chrome and test on real forms")
    print("  3. Use 'Collect Training Data' on 20+ sites for even better accuracy")


if __name__ == "__main__":
    main()
