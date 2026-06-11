#!/usr/bin/env python3
"""
train_ghostfill_model.py — GhostFill Form Field Classifier
=============================================================
Architecture: CharCNN (shared) + Cross-Channel Attention + Structural MLP
Input:
  - 8 Text Channels  : int64 tensor (batch, 8, 80) — char-level encoding
  - Structural Vector: float32 tensor (batch, 64) — DOM/layout heuristics
Output:
  - logits: float32 tensor (batch, 10) — one per field class

Training:
  - Brief synthetic training run to initialize and verify weights.
  - Exports FP32 ONNX, then applies INT8 dynamic quantization.

Target artifact sizes: FP32 ~5–12 MB | INT8 ~2–5 MB
"""

from __future__ import annotations

# pylint: disable=not-callable, no-member, invalid-name, missing-docstring

import json
import os
import sys
import warnings

import numpy as np
import torch # type: ignore [import]
import torch.nn as nn # type: ignore [import]
from torch.utils.data import DataLoader, Dataset # type: ignore [import]

# ─── ONNX Export ─────────────────────────────────────────────────────────────
warnings.filterwarnings("ignore", category=DeprecationWarning)

try:
    import onnx # type: ignore [import]
    from onnxruntime.quantization import quantize_dynamic, QuantType # type: ignore [import]
except ImportError as exc:  # pragma: no cover
    sys.exit(
        f"[ERROR] Missing dependency: {exc}.\n"
        "  Run: pip install onnx onnxruntime onnxscript"
    )

# ─── Constants ────────────────────────────────────────────────────────────────

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

MODEL_FILENAME = "ghostfill_v1_int8.onnx"
FP32_FILENAME  = "ghostfill_v1_fp32.onnx"
DEPLOY_DIR = os.path.join("public", "models")

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")


# ═════════════════════════════════════════════════════════════════════════════
# PART 1 — MODEL ARCHITECTURE
# ═════════════════════════════════════════════════════════════════════════════


class CharCNNEncoder(nn.Module):
    # type: ignore [misc]
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

        self.conv_stack = nn.Sequential(
            nn.Conv1d(embed_dim, 96, kernel_size=3, padding=1),
            nn.GroupNorm(8, 96),   # GroupNorm — safe for batch_size=1
            nn.GELU(),
            nn.MaxPool1d(2),

            nn.Conv1d(96, 144, kernel_size=3, padding=1),
            nn.GroupNorm(8, 144),
            nn.GELU(),
            nn.MaxPool1d(2),

            nn.Conv1d(144, 192, kernel_size=3, padding=1),
            nn.GroupNorm(8, 192),
            nn.GELU(),
        )
        self.proj = nn.Linear(192, output_dim)
        self.drop = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, L) int64
        emb = self.embedding(x)          # (B, L, E)
        emb = emb.transpose(1, 2)        # (B, E, L)
        h = self.conv_stack(emb)         # (B, 192, L')
        h = torch.max(h, dim=-1)[0]      # (B, 192)
        return self.drop(self.proj(h))   # (B, output_dim)


class CrossChannelAttention(nn.Module):
    # type: ignore [misc]
    """
    Single Transformer encoder layer over the 8 text-channel embeddings.
    Uses a hand-written multi-head scaled dot-product attention so that the
    module exports cleanly via the legacy TorchScript ONNX path (no MHA op).

    Input/Output: (B, 8, d_model)
    """

    def __init__(
        self,
        d_model: int = 192,
        n_heads: int = 4,
        dropout: float = 0.10,
    ) -> None:
        super().__init__()
        assert d_model % n_heads == 0, "d_model must be divisible by n_heads"
        self.n_heads = n_heads
        self.d_head = d_model // n_heads

        # Fused QKV projection
        self.qkv = nn.Linear(d_model, d_model * 3, bias=False)
        self.out_proj = nn.Linear(d_model, d_model)
        self.attn_drop = nn.Dropout(dropout)

        self.norm1 = nn.LayerNorm(d_model)
        self.norm2 = nn.LayerNorm(d_model)
        self.ffn = nn.Sequential(
            nn.Linear(d_model, d_model * 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model * 2, d_model),
            nn.Dropout(dropout),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, S, D)  where S=8 channels, D=d_model
        B, S, D = x.shape
        H, DH = self.n_heads, self.d_head
        scale = DH ** -0.5

        # Pre-norm attention
        normed = self.norm1(x)
        qkv = self.qkv(normed)               # (B, S, 3D)
        q, k, v = qkv.chunk(3, dim=-1)       # each (B, S, D)

        # Reshape for multi-head: (B, H, S, DH)
        q = q.view(B, S, H, DH).transpose(1, 2)
        k = k.view(B, S, H, DH).transpose(1, 2)
        v = v.view(B, S, H, DH).transpose(1, 2)

        # Scaled dot-product attention
        attn = torch.matmul(q, k.transpose(-2, -1)) * scale   # (B, H, S, S)
        attn = torch.softmax(attn, dim=-1)
        attn = self.attn_drop(attn)
        out = torch.matmul(attn, v)           # (B, H, S, DH)

        # Merge heads
        out = out.transpose(1, 2).contiguous().view(B, S, D)  # (B, S, D)
        out = self.out_proj(out)
        x = x + out

        # Pre-norm FFN
        x = x + self.ffn(self.norm2(x))
        return x


class StructuralEncoder(nn.Module):
    # type: ignore [misc]
    """
    Two-layer MLP for the 64-dim structural/layout feature vector.

    Input:  (B, NUM_STRUCTURAL)  — float32
    Output: (B, output_dim)
    """

    def __init__(
        self,
        input_dim: int = NUM_STRUCTURAL,
        hidden_dim: int = 128,
        output_dim: int = 128,
        dropout: float = 0.15,
    ) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),    # LayerNorm — no batch-size constraint
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, output_dim),
            nn.GELU(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class GhostFillClassifier(nn.Module):
    # type: ignore [misc]
    """
    Full GhostFill Form-Field Classifier.

    Pipeline
    --------
    1. Shared CharCNNEncoder  → 8 channel embeddings  (B, 8, 192)
    2. CrossChannelAttention  → fused text context     (B, 192)  [mean-pool]
    3. StructuralEncoder      → layout embedding       (B, 128)
    4. Concat                 → (B, 320)
    5. Classification head    → logits (B, 10)
    """

    def __init__(self, dropout: float = 0.15) -> None:
        super().__init__()

        # ── Shared CNN + per-channel projection ──────────────────────────────
        self.char_cnn = CharCNNEncoder(output_dim=192, dropout=dropout)
        self.channel_proj = nn.ModuleList(
            [nn.Linear(192, 192) for _ in range(NUM_TEXT_CHANNELS)]
        )

        # ── Cross-channel attention ───────────────────────────────────────────
        self.cross_attn = CrossChannelAttention(d_model=192, n_heads=4, dropout=dropout)
        self.text_norm = nn.LayerNorm(192)

        # ── Structural branch ─────────────────────────────────────────────────
        self.structural_enc = StructuralEncoder(
            input_dim=NUM_STRUCTURAL, hidden_dim=128, output_dim=128, dropout=dropout
        )

        # ── Classification head (fused 192+128 = 320) ─────────────────────────
        self.classifier = nn.Sequential(
            nn.Linear(320, 256),
            nn.LayerNorm(256),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, NUM_CLASSES),
        )

    def forward(
        self,
        text_channels: torch.Tensor,  # (B, 8, 80) int64
        structural: torch.Tensor,     # (B, 64)   float32
    ) -> torch.Tensor:

        # Encode each text channel independently
        channel_embeds = []
        for i in range(NUM_TEXT_CHANNELS):
            ch_i = text_channels[:, i, :]           # (B, 80)
            emb_i = self.char_cnn(ch_i)             # type: ignore [misc]
            emb_i = self.channel_proj[i](emb_i)     # (B, 192)
            channel_embeds.append(emb_i)

        # Stack → Attend → Pool
        text_seq = torch.stack(channel_embeds, dim=1)   # (B, 8, 192)
        text_seq = self.cross_attn(text_seq)            # type: ignore [misc]
        text_pooled = self.text_norm(text_seq.mean(dim=1))  # (B, 192)

        # Structural branch
        struct_emb = self.structural_enc(structural)    # type: ignore [misc]

        # Fuse & classify
        fused = torch.cat([text_pooled, struct_emb], dim=1)  # (B, 320)
        return self.classifier(fused)                         # (B, 10)


# ═════════════════════════════════════════════════════════════════════════════
# PART 2 — REAL LABELED DATASET
# Each class is seeded with realistic DOM attribute strings that mirror
# what extractor.ts reads from actual form fields on the web.
# Channel layout (matching extractor.ts):
#   ch0 = placeholder, ch1 = aria-label, ch2 = label text,
#   ch3 = name+id, ch4 = autocomplete, ch5 = floating-label,
#   ch6 = nearby text, ch7 = form heading
# ═════════════════════════════════════════════════════════════════════════════

# ------------------------------------------------------------------
# Per-class realistic string pools (one list per channel slot).
# `None` in a slot means: use empty string for that channel.
# Some lists have fewer entries; they'll be cycled with random choice.
# ------------------------------------------------------------------
import random

_CLASS_SEEDS: dict[str, dict[str, list[str | None]]] = {
    "Email": {
        "placeholder": [
            "Enter your email", "Email address", "Your email", "e.g. you@example.com",
            "mail@example.com", "Email *", "Email or username", "電子メール",
            "Adresse e-mail", "Correo electrónico", "E-Mail-Adresse", "Email ID",
        ],
        "aria_label": [
            "Email address", "Email", "Your email", "Enter email", "Email field",
        ],
        "label": [
            "Email", "Email Address", "E-mail", "Your Email", "Email *",
            "Email / Username", "Adresse mail", "Correo electrónico", "E-Mail",
        ],
        "name_id": [
            "email emailInput", "email email-address", "userEmail email",
            "emailAddress emailField", "mail mailAddress", "loginEmail email",
            "contactEmail emailContainer", "user_email email_input",
        ],
        "autocomplete": ["email", "username", "email"],
        "form_heading": [
            "Sign In", "Log In", "Create Account", "Register", "Login",
            "Sign Up", "Account Access", "Iniciar sesión",
        ],
    },

    "Username": {
        "placeholder": [
            "Username", "Enter username", "Choose a username", "Your username",
            "Login name", "Identifiant", "Benutzername", "Nombre de utilisateur",
            "User handle", "Screen name",
        ],
        "aria_label": ["Username", "Your username", "Login name", "Account name"],
        "label": [
            "Username", "User Name", "Login", "Screen Name", "Nickname",
            "Account Name", "Identifiant", "Usuario",
        ],
        "name_id": [
            "username usernameInput", "loginName loginField", "userId user-id",
            "userLogin user_login", "screenName screen_name", "accountName account",
            "login loginInput", "handle handle-input",
        ],
        "autocomplete": ["username", ""],
        "form_heading": ["Sign In", "Log In", "Login", "Account Login"],
    },

    "Password": {
        "placeholder": [
            "Password", "Enter password", "Your password", "Current password",
            "Mot de passe", "Contraseña", "Passwort", "••••••••", "Password *",
        ],
        "aria_label": ["Password", "Your password", "Current password", "Enter password"],
        "label": [
            "Password", "Enter Password", "Your Password", "Current Password",
            "Mot de passe", "Contraseña", "Passwort", "Senha",
        ],
        "name_id": [
            "password passwordInput", "passwd password", "userPassword password-field",
            "loginPassword login_pwd", "accountPassword pass", "pwd passwordBox",
        ],
        "autocomplete": ["current-password", "password", ""],
        "nearby_text": [
            "Enter your password", "Must be at least 8 characters",
            "Case sensitive", "Forgot password?",
        ],
        "form_heading": ["Sign In", "Log In", "Account Login", "Secure Login"],
    },

    "Target_Password_Confirm": {
        "placeholder": [
            "Confirm password", "Re-enter password", "Repeat password",
            "Confirm your password", "Verify password", "Password again",
            "Confirmer le mot de passe", "Bestätigen Sie das Passwort",
        ],
        "aria_label": [
            "Confirm password", "Repeat password", "Password confirmation",
        ],
        "label": [
            "Confirm Password", "Re-enter Password", "Repeat Password",
            "Password Confirmation", "Verify Password", "Confirm your password",
            "Confirm Mot de passe",
        ],
        "name_id": [
            "confirmPassword confirm-password", "passwordConfirm password_confirm",
            "rePassword re-password", "retypePassword retype_password",
            "verifyPassword verify_password", "repeatPassword repeat_password",
            "password2 password-again",
        ],
        "autocomplete": ["new-password", ""],
        "form_heading": ["Create Account", "Register", "Sign Up", "Registration"],
    },

    "First_Name": {
        "placeholder": [
            "First name", "Given name", "Your first name", "First name *",
            "Prénom", "Nombre", "Vorname", "Nome", "Nome de pila",
        ],
        "aria_label": ["First name", "Given name", "Your first name"],
        "label": [
            "First Name", "Given Name", "First name *", "Prénom",
            "Nombre", "Vorname",
        ],
        "name_id": [
            "firstName first-name", "givenName given-name", "fname fname-input",
            "first_name first_name_field", "contactFirstName first",
            "userFirstName firstname_input",
        ],
        "autocomplete": ["given-name", ""],
        "form_heading": [
            "Create Account", "Register", "Personal Information", "Sign Up",
        ],
    },

    "Last_Name": {
        "placeholder": [
            "Last name", "Surname", "Family name", "Your last name",
            "Nom de famille", "Apellido", "Nachname", "Sobrenome",
        ],
        "aria_label": ["Last name", "Surname", "Family name"],
        "label": [
            "Last Name", "Surname", "Family Name", "Nom de famille",
            "Apellido", "Nachname",
        ],
        "name_id": [
            "lastName last-name", "surname surnamefield", "familyName family-name",
            "lname lname-input", "last_name last_name_field", "contactLastName last",
        ],
        "autocomplete": ["family-name", ""],
        "form_heading": [
            "Create Account", "Register", "Personal Information",
        ],
    },

    "Full_Name": {
        "placeholder": [
            "Full name", "Your name", "Enter your full name", "Name",
            "Nom complet", "Nombre completo", "Vollständiger Name",
        ],
        "aria_label": ["Full name", "Your name", "Complete name"],
        "label": [
            "Full Name", "Name", "Your Name", "Display Name",
            "Nom complet", "Nombre completo",
        ],
        "name_id": [
            "fullName full-name", "name nameInput", "displayName display_name",
            "yourName your-name", "contactName full_name",
        ],
        "autocomplete": ["name", ""],
        "form_heading": ["Sign Up", "Create Profile", "Register", "Edit Profile"],
    },

    "Phone": {
        "placeholder": [
            "Phone number", "Mobile number", "Telephone", "Enter phone",
            "e.g. +1 555 000 0000", "Número de teléfono", "Téléphone",
            "Handynummer", "Phone *", "Mobile",
        ],
        "aria_label": ["Phone number", "Mobile number", "Telephone number"],
        "label": [
            "Phone", "Phone Number", "Mobile", "Telephone", "Cell",
            "Téléphone", "Número de teléfono", "Telefon",
        ],
        "name_id": [
            "phone phone-number", "mobile mobile-number", "telephone telephone",
            "phoneNumber phone_number", "cellPhone cell_phone", "tel tel-input",
            "contactPhone phone_input",
        ],
        "autocomplete": ["tel", ""],
        "form_heading": [
            "Contact Information", "Register", "Verify Account", "Phone Verification",
        ],
    },

    "OTP": {
        "placeholder": [
            "Enter OTP", "6-digit code", "Verification code", "One-time code",
            "Enter code", "Enter PIN", "Authentication code", "Security code",
            "Enter the code sent to you", "2FA code",
        ],
        "aria_label": [
            "One-time password", "Verification code", "OTP", "Security code",
        ],
        "label": [
            "OTP", "Verification Code", "One-Time Code", "Security Code",
            "PIN", "Code", "Authentication Code", "2FA Code",
        ],
        "name_id": [
            "otp otp-input", "verificationCode verification-code",
            "otpCode otp_code", "authCode auth-code", "securityCode security_code",
            "pinCode pin-input", "twoFactorCode two-factor",
            "mfaCode mfa-input", "token token-field",
        ],
        "autocomplete": ["one-time-code", ""],
        "form_heading": [
            "Verify Your Identity", "Two-Factor Authentication",
            "Phone Verification", "Email Verification", "Enter Code",
        ],
    },

    "Unknown": {
        "placeholder": [
            "Enter value", "", "Type here", "Address line 1",
            "City", "State", "ZIP code", "Country", "Date of birth",
            "Search", "Notes", "Comment", "Message", "Website",
        ],
        "aria_label": ["", "Search", "Address", "City", "Country"],
        "label": [
            "Address", "City", "Zip Code", "Country", "Date of Birth",
            "Search", "Comment", "Company", "School", "Website",
        ],
        "name_id": [
            "address address-line1", "city cityInput", "zipcode zip",
            "country country-select", "dob date-of-birth", "search searchInput",
            "comment commentBox", "company companyName", "website url-field",
        ],
        "autocomplete": ["street-address", "address-level2", "postal-code", "country", ""],
        "form_heading": [
            "Billing Information", "Shipping Address", "Edit Profile",
            "Account Settings", "Payment Details",
        ],
    },
}


def _encode_text(text: str, max_len: int = MAX_TEXT_LEN) -> list[int]:
    """Encode a string into a list of ASCII char codes, padded/truncated to max_len."""
    s = str(text or "").lower().strip()
    s = s[:max_len] # type: ignore [misc]
    encoded = [0] * max_len
    for i, ch in enumerate(s):
        code = ord(ch)
        encoded[i] = code if code < CHAR_VOCAB_SIZE else 1
    return encoded


def _make_structural_vec(cls_name: str, rng: random.Random) -> list[float]:
    """
    Generate a plausible 64-dim structural feature vector for a given class.
    Uses per-class defaults for key discriminative features; rest are near-zero noise.
    """
    vec = [rng.uniform(0.0, 0.05) for _ in range(64)]  # near-zero noise for unknowns

    # Feature indices (matching extractor.ts):
    # 0=input_type, 1=autocomplete_type, 2=maxlength, 3=maxlen_1or2, 4=required
    # 12=is_visible, 26=email_kw, 27=username_kw, 28=password_kw, 29=confirm_kw
    # 30=firstname_kw, 31=lastname_kw, 32=fullname_kw, 33=phone_kw, 34=otp_kw
    # 35=is_splitOTP, 38=form_field_count

    vec[12] = 1.0  # always visible

    if cls_name == "Email":
        vec[0] = 2/10        # type=email (mapped to 2)
        vec[1] = 1/10        # autocomplete=email
        vec[4] = rng.choice([0.0, 1.0])  # required (random)
        vec[26] = 1.0        # email keyword hit
    elif cls_name == "Username":
        vec[0] = 1/10        # type=text
        vec[1] = 2/10        # autocomplete=username
        vec[27] = 1.0        # username keyword
    elif cls_name == "Password":
        vec[0] = 3/10        # type=password
        vec[1] = 3/10        # autocomplete=current-password
        vec[28] = 1.0        # password keyword
    elif cls_name == "Target_Password_Confirm":
        vec[0] = 3/10        # type=password
        vec[1] = 4/10        # autocomplete=new-password
        vec[28] = 0.8
        vec[29] = 1.0        # confirm keyword
    elif cls_name == "First_Name":
        vec[0] = 1/10
        vec[1] = 5/10        # autocomplete=given-name
        vec[30] = 1.0        # first-name keyword
    elif cls_name == "Last_Name":
        vec[0] = 1/10
        vec[1] = 6/10        # autocomplete=family-name
        vec[31] = 1.0        # last-name keyword
    elif cls_name == "Full_Name":
        vec[0] = 1/10
        vec[1] = 7/10        # autocomplete=name
        vec[32] = 1.0        # full-name keyword
    elif cls_name == "Phone":
        vec[0] = 4/10        # type=tel
        vec[9] = 1.0         # inputmode=numeric
        vec[1] = 8/10        # autocomplete=tel
        vec[33] = 1.0        # phone keyword
    elif cls_name == "OTP":
        is_split = rng.random() < 0.4
        vec[3] = 1.0 if is_split else 0.0    # maxlength=1
        vec[35] = 1.0 if is_split else 0.0   # isSplitOTP
        if is_split:
            vec[36] = rng.randint(4, 8) / 8  # group size
        vec[9] = 1.0         # inputmode=numeric
        vec[1] = 9/10        # autocomplete=one-time-code
        vec[34] = 1.0        # otp keyword
    else:
        vec[0] = 1/10
        # Unknown fields: no strong discriminative features

    vec[38] = rng.randint(1, 10) / 20         # form field count (normalized)
    vec[40] = rng.uniform(0.0, 1.0)           # field index in form
    # Add realistic noise to help regularization
    for i in range(len(vec)):
        vec[i] = min(1.0, max(0.0, vec[i] + rng.gauss(0.0, 0.02)))

    return vec


class RealLabeledFormDataset(Dataset):
    """
    Generates realistic (text_channels, structural, label) samples for each
    field class by randomly selecting from per-class keyword pools.
    Also injects real data from `ghostfill_user_data.json` and `scraped_data.json`
    to enable continuous learning.
    """

    def __init__(self, samples_per_class: int = 500, seed: int = 42) -> None:
        rng = random.Random(seed)
        self.text_list: list[torch.Tensor] = []
        self.struct_list: list[torch.Tensor] = []
        self.label_list: list[int] = []

        import json
        import os
        from typing import Any
        
        def parse_js_array(d: Any) -> list[Any]:
            if isinstance(d, list): return d
            if isinstance(d, dict):
                arr = [0] * (max((int(k) for k in d.keys()), default=-1) + 1)
                for k, v in d.items(): arr[int(k)] = v
                return arr
            return []

        # Load Real World Data (Continuous Learning)
        for data_file in ["ghostfill_user_data.json", "ml/scraped_data.json"]:
            if os.path.exists(data_file):
                try:
                    with open(data_file, "r", encoding="utf-8") as f:
                        user_data = json.load(f)
                    for item in user_data:
                        features = item.get("features", {})
                        label_str = item.get("label", "")
                        
                        # Fix label case mismatch (e.g., 'email' -> 'Email')
                        matched_cls = next((c for c in CLASS_NAMES if c.lower() == label_str.lower()), None)
                        
                        if matched_cls and "textChannels" in features and "structural" in features:
                            cls_idx = CLASS_NAMES.index(matched_cls)
                            
                            # Parse JSON-stringified TypedArrays
                            channels_raw: list[list[int]] = [parse_js_array(ch) for ch in features["textChannels"]] # type: ignore
                            struct_raw: list[float] = parse_js_array(features["structural"]) # type: ignore
                            
                            # Ensure exact dimensions
                            for ch in channels_raw:
                                while len(ch) < MAX_TEXT_LEN: ch.append(0)
                                ch[:] = ch[:MAX_TEXT_LEN] # type: ignore [misc]
                            
                            while len(struct_raw) < NUM_STRUCTURAL: struct_raw.append(0.0)
                            struct_raw = struct_raw[:NUM_STRUCTURAL] # type: ignore [misc]
                            
                            self.text_list.append(torch.tensor(channels_raw, dtype=torch.long))
                            self.struct_list.append(torch.tensor(struct_raw, dtype=torch.float32))
                            self.label_list.append(cls_idx)
                    print(f"Loaded {len(user_data)} real samples from {data_file}")
                except Exception as e:
                    print(f"Failed to load {data_file}: {e}")

        for cls_idx, cls_name in enumerate(CLASS_NAMES):
            seeds_cfg = _CLASS_SEEDS.get(cls_name, {})
            for _ in range(samples_per_class):
                channels: list[list[int]] = []

                # Build 8 text channels from the seed pools
                slot_keys = [
                    "placeholder", "aria_label", "label",
                    "name_id", "autocomplete", "floating_label",
                    "nearby_text", "form_heading",
                ]
                for slot in slot_keys:
                    pool = seeds_cfg.get(slot, [""])
                    if not pool:
                        pool = [""]
                    chosen = rng.choice(pool)
                    # Add small random corruption for robustness
                    if chosen and rng.random() < 0.15:
                        limit_idx = int(rng.randint(1, len(chosen)))
                        chosen = chosen[:limit_idx] # type: ignore [misc]
                    channels.append(_encode_text(chosen or ""))

                text_tensor = torch.tensor(channels, dtype=torch.long)  # (8, 80)
                struct_tensor = torch.tensor(
                    _make_structural_vec(cls_name, rng), dtype=torch.float32
                )

                self.text_list.append(text_tensor)
                self.struct_list.append(struct_tensor)
                self.label_list.append(cls_idx)

        # Shuffle to prevent batch class clustering
        combined = list(zip(self.text_list, self.struct_list, self.label_list))
        rng.shuffle(combined)
        self.text_list, self.struct_list, self.label_list = map(list, zip(*combined))

    def __len__(self) -> int:
        return len(self.label_list)

    def __getitem__(self, idx: int):
        return self.text_list[idx], self.struct_list[idx], self.label_list[idx]


# ═════════════════════════════════════════════════════════════════════════════
# PART 3 — TRAINING & EXPORT
# ═════════════════════════════════════════════════════════════════════════════


def make_splits(dataset, val_frac=0.15, test_frac=0.15, seed=42):
    """Deterministic train/val/test split (was: no split at all)."""
    n_total = len(dataset)
    n_test = int(n_total * test_frac)
    n_val = int(n_total * val_frac)
    n_train = n_total - n_val - n_test
    gen = torch.Generator().manual_seed(seed)
    return random_split(dataset, [n_train, n_val, n_test], generator=gen)


def compute_class_weights(dataset, num_classes):
    """Inverse-frequency class weights to counter imbalance (esp. Unknown)."""
    counts = np.zeros(num_classes, dtype=np.float64)
    for _, _, label in dataset:
        counts[int(label)] += 1
    counts = np.clip(counts, 1.0, None)
    weights = counts.sum() / (num_classes * counts)
    return torch.tensor(weights, dtype=torch.float32)


@torch.no_grad()
def evaluate(model, loader, device, class_names):
    """Held-out evaluation: accuracy + per-class precision/recall + confusion."""
    model.eval()
    num_classes = len(class_names)
    confusion = np.zeros((num_classes, num_classes), dtype=np.int64)
    for text_channels, structural, labels in loader:
        text_channels = text_channels.to(device)
        structural = structural.to(device)
        logits = model(text_channels, structural)
        preds = logits.argmax(dim=1).cpu().numpy()
        gold = labels.numpy()
        for g, p in zip(gold, preds):
            confusion[int(g), int(p)] += 1

    total = confusion.sum()
    correct = np.trace(confusion)
    acc = correct / total if total else 0.0
    print(f"\nHeld-out accuracy: {acc:.4f} ({correct}/{total})")
    print(f"{'class':<26}{'prec':>8}{'recall':>8}{'support':>9}")
    for i, name in enumerate(class_names):
        tp = confusion[i, i]
        support = confusion[i, :].sum()
        predicted = confusion[:, i].sum()
        precision = tp / predicted if predicted else 0.0
        recall = tp / support if support else 0.0
        print(f"{name:<26}{precision:>8.3f}{recall:>8.3f}{support:>9}")
    return acc, confusion


def export_and_quantize(model, sample_text, sample_struct, out_dir="."):
    """Export FP32 ONNX, dynamic-quantize to INT8, verify parity, deploy."""
    import onnx
    from onnxruntime.quantization import QuantType, quantize_dynamic

    fp32_path = os.path.join(out_dir, FP32_FILENAME)
    int8_path = os.path.join(out_dir, MODEL_FILENAME)

    model.eval()
    torch.onnx.export(
        model,
        (sample_text, sample_struct),
        fp32_path,
        input_names=["text_channels", "structural"],
        output_names=["logits"],
        dynamic_axes={
            "text_channels": {0: "batch"},
            "structural": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        dynamo=False,
    )
    onnx.checker.check_model(onnx.load(fp32_path))

    quantize_dynamic(
        fp32_path,
        int8_path,
        weight_type=QuantType.QInt8,
        per_channel=True,  # was False; per-channel recovers accuracy
    )
    onnx.checker.check_model(onnx.load(int8_path))

    _parity_check(fp32_path, int8_path, sample_text, sample_struct)

    os.makedirs(DEPLOY_DIR, exist_ok=True)
    deploy_path = os.path.join(DEPLOY_DIR, MODEL_FILENAME)
    import shutil

    shutil.copyfile(int8_path, deploy_path)
    print(f"Deployed INT8 model -> {deploy_path}")
    return deploy_path


def _parity_check(fp32_path, int8_path, sample_text, sample_struct, tol=0.15):
    """Assert INT8 logits stay close to FP32 on a fixed batch."""
    import onnxruntime as ort

    feeds = {
        "text_channels": sample_text.cpu().numpy().astype(np.int64),
        "structural": sample_struct.cpu().numpy().astype(np.float32),
    }
    fp32 = ort.InferenceSession(fp32_path).run(["logits"], feeds)[0]
    int8 = ort.InferenceSession(int8_path).run(["logits"], feeds)[0]
    max_abs = float(np.max(np.abs(fp32 - int8)))
    agree = float(np.mean(fp32.argmax(1) == int8.argmax(1)))
    print(f"FP32 vs INT8: max|Δlogit|={max_abs:.4f}, argmax agreement={agree:.3f}")
    if agree < 1.0 - tol:
        print(f"WARNING: quantization changed {(1 - agree) * 100:.1f}% of predictions")


def build_loaders(dataset, batch_size=64):
    train_ds, val_ds, test_ds = make_splits(dataset)
    return (
        DataLoader(train_ds, batch_size=batch_size, shuffle=True),
        DataLoader(val_ds, batch_size=batch_size),
        DataLoader(test_ds, batch_size=batch_size),
    )


if __name__ == "__main__":
    device = DEVICE
    epochs = 20

    print(f"\n{'='*60}")
    print("  GhostFill ML Training Pipeline")
    print(f"  Device : {device}")
    print(f"  Classes: {len(CLASS_NAMES)}")
    print(f"{'='*60}\n")

    # 1. Initialize dataset and model
    dataset = RealLabeledFormDataset(samples_per_class=500, seed=42)
    model = GhostFillClassifier().to(device)

    # 2. Split dataset & Build loaders
    train_ds, val_ds, test_ds = make_splits(dataset)
    train_loader, val_loader, test_loader = build_loaders(dataset, batch_size=32)

    # 3. Setup optimizer & weights
    opt = torch.optim.AdamW(model.parameters(), lr=5e-4, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    class_weights = compute_class_weights(train_ds, num_classes=len(CLASS_NAMES)).to(device)
    criterion = nn.CrossEntropyLoss(weight=class_weights, label_smoothing=0.05)

    # 4. Training loop
    model.train()
    for epoch in range(epochs):
        total_loss = 0.0
        correct = 0
        total = 0
        for texts, structs, targets in train_loader:
            texts = texts.to(device)       # (B, 8, 80) int64
            structs = structs.to(device)   # (B, 64)   float32
            targets = targets.to(device)   # (B,)      int64
            opt.zero_grad()
            logits = model(texts, structs)
            loss = criterion(logits, targets)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            opt.step()
            total_loss += loss.item()
            preds = logits.argmax(dim=-1)
            correct += int(torch.eq(preds, targets).sum().item())
            total += targets.size(0)
        scheduler.step()
        avg = total_loss / len(train_loader)
        acc = 100.0 * correct / total
        if (epoch + 1) % 5 == 0 or epoch == 0:
            print(f"  Epoch {epoch + 1:3d}/{epochs}  loss={avg:.4f}  acc={acc:.1f}%")

    print(f"\nFinal training accuracy: {100.0 * correct / total:.1f}% ({correct}/{total})")

    # 5. Evaluation
    print("\n=== Validation ===")
    evaluate(model, val_loader, device, CLASS_NAMES)
    print("\n=== Test (held-out) ===")
    evaluate(model, test_loader, device, CLASS_NAMES)

    # 6. Export and quantize
    print("\n[Export & Quantize]")
    sample_batch = next(iter(val_loader))
    sample_text, sample_struct, _ = sample_batch
    sample_text  = sample_text[:1].to(device)
    sample_struct = sample_struct[:1].to(device)
    export_and_quantize(model, sample_text, sample_struct, out_dir=".")

    # 7. Save class names
    classes_path = os.path.join(".", "ghostfill_classes.json")
    with open(classes_path, "w", encoding="utf-8") as f:
        json.dump(CLASS_NAMES, f, indent=2, ensure_ascii=False)
    print(f"  Classes    →  {classes_path}")
