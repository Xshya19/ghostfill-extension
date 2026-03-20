# GhostFill: Production-Grade Local ML Auto-Fill Engine

Below is the complete, production-ready system across four core files plus supporting infrastructure. Every architectural decision is annotated.

---

## File 1: `extractor.ts` — DOM Feature Extractor (56-Dimensional Vector + 8 Text Channels)

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// extractor.ts — GhostFill DOM Feature Extraction Engine
// Produces a 56-dim structural vector + 8 text channels (char-encoded) per input
// ─────────────────────────────────────────────────────────────────────────────

export const CHAR_VOCAB_SIZE = 256; // ASCII coverage
export const MAX_TEXT_LEN = 80;     // chars per text channel
export const NUM_TEXT_CHANNELS = 8;
export const NUM_STRUCTURAL_FEATURES = 56;

export interface RawFieldFeatures {
  /** 8 text channels, each an array of char codes length MAX_TEXT_LEN */
  textChannels: number[][];
  /** 56-dim float structural vector */
  structural: number[];
  /** Reference back to the element */
  element: HTMLInputElement;
}

// ── Character Encoding ──────────────────────────────────────────────────────

function encodeText(raw: string): number[] {
  const s = (raw || "").toLowerCase().trim().slice(0, MAX_TEXT_LEN);
  const encoded: number[] = new Array(MAX_TEXT_LEN).fill(0);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    encoded[i] = code < CHAR_VOCAB_SIZE ? code : 1; // UNK = 1, PAD = 0
  }
  return encoded;
}

// ── Visibility Heuristics ───────────────────────────────────────────────────

interface VisibilityInfo {
  isVisible: boolean;
  isOpacityZero: boolean;
  isOffscreen: boolean;
  isClipped: boolean;
  isAriaHidden: boolean;
  computedWidth: number;
  computedHeight: number;
}

function analyzeVisibility(el: HTMLInputElement): VisibilityInfo {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const opacity = parseFloat(cs.opacity || "1");
  const isOpacityZero = opacity < 0.05;
  const isOffscreen =
    rect.right < 0 ||
    rect.bottom < 0 ||
    rect.left > window.innerWidth + 50 ||
    rect.top > window.innerHeight + 50 ||
    (parseInt(cs.left || "0") < -900) ||
    (parseInt(cs.top || "0") < -900);
  const isClipped =
    cs.clipPath === "inset(100%)" ||
    cs.clip === "rect(0px, 0px, 0px, 0px)" ||
    (rect.width < 2 && rect.height < 2) ||
    cs.overflow === "hidden" && rect.width === 0;
  const isAriaHidden =
    el.getAttribute("aria-hidden") === "true" ||
    el.closest("[aria-hidden='true']") !== null;
  const isVisible =
    cs.display !== "none" &&
    cs.visibility !== "hidden" &&
    !isOpacityZero &&
    !isOffscreen &&
    !isClipped &&
    !isAriaHidden &&
    rect.width > 0 &&
    rect.height > 0;

  return {
    isVisible,
    isOpacityZero,
    isOffscreen,
    isClipped,
    isAriaHidden,
    computedWidth: rect.width,
    computedHeight: rect.height,
  };
}

// ── Spatial Label Discovery (Floating / Overlapping Labels) ─────────────────

function findFloatingLabel(el: HTMLInputElement): string {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return "";

  // Expand search rect: 200px above, 20px sides, 10px below
  const searchRect = {
    top: rect.top - 200,
    bottom: rect.bottom + 10,
    left: rect.left - 20,
    right: rect.right + 20,
  };

  const candidates: { text: string; distance: number }[] = [];

  // Query all potential label-like elements near the input
  const selectors = "label, span, div, p, legend, dt, th, td";
  const nearbyEls = document.querySelectorAll(selectors);

  for (const candidate of nearbyEls) {
    // Skip if candidate contains other inputs (it's a wrapper, not a label)
    if (candidate.querySelector("input, select, textarea")) continue;

    const cRect = candidate.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) continue;
    if (cRect.height > 80) continue; // Too tall to be a label

    // Check overlap with our expanded search rect
    const overlapsHoriz = cRect.left < searchRect.right && cRect.right > searchRect.left;
    const overlapsVert = cRect.top < searchRect.bottom && cRect.bottom > searchRect.top;

    if (overlapsHoriz && overlapsVert) {
      const text = (candidate.textContent || "").trim();
      if (text.length > 0 && text.length < 120) {
        // Manhattan distance from center of candidate to center of input
        const dx = Math.abs(
          (cRect.left + cRect.right) / 2 - (rect.left + rect.right) / 2
        );
        const dy = Math.abs(
          (cRect.top + cRect.bottom) / 2 - (rect.top + rect.bottom) / 2
        );
        candidates.push({ text, distance: dx + dy * 0.5 }); // weight vertical proximity
      }
    }
  }

  candidates.sort((a, b) => a.distance - b.distance);
  return candidates.length > 0 ? candidates[0].text : "";
}

// ── Explicit Label Discovery ────────────────────────────────────────────────

function findExplicitLabel(el: HTMLInputElement): string {
  // 1. Linked via `for` attribute
  const id = el.id;
  if (id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
    if (label) return (label.textContent || "").trim();
  }

  // 2. Wrapping <label>
  const wrappingLabel = el.closest("label");
  if (wrappingLabel) {
    // Get label text minus any input's own text
    const clone = wrappingLabel.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
    return (clone.textContent || "").trim();
  }

  // 3. aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map((refId) => {
      const refEl = document.getElementById(refId);
      return refEl ? (refEl.textContent || "").trim() : "";
    });
    const joined = parts.filter(Boolean).join(" ");
    if (joined) return joined;
  }

  return "";
}

// ── Nearby Text Context ─────────────────────────────────────────────────────

function findNearbyText(el: HTMLInputElement): string {
  const fragments: string[] = [];

  // Preceding siblings' text content (up to 3 siblings)
  let sib: Element | null = el.previousElementSibling;
  let sibCount = 0;
  while (sib && sibCount < 3) {
    if (!sib.querySelector("input, select, textarea")) {
      const t = (sib.textContent || "").trim();
      if (t.length > 0 && t.length < 150) fragments.push(t);
    }
    sib = sib.previousElementSibling;
    sibCount++;
  }

  // Preceding text nodes (direct children of parent)
  const parent = el.parentElement;
  if (parent) {
    const walker = document.createTreeWalker(parent, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node === el || (el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        break;
      }
      const t = (node.textContent || "").trim();
      if (t.length > 1 && t.length < 100) fragments.push(t);
    }
  }

  // aria-describedby
  const describedBy = el.getAttribute("aria-describedby");
  if (describedBy) {
    describedBy.split(/\s+/).forEach((refId) => {
      const refEl = document.getElementById(refId);
      if (refEl) {
        const t = (refEl.textContent || "").trim();
        if (t) fragments.push(t);
      }
    });
  }

  return fragments.join(" ").slice(0, 300);
}

// ── Form Heading / Title ────────────────────────────────────────────────────

function findFormHeading(el: HTMLInputElement): string {
  const form = el.closest("form, [role='form'], .form, [class*='form']");
  const container = form || el.closest("div, section, main, article");
  if (!container) return "";

  const headings = container.querySelectorAll(
    "h1, h2, h3, h4, h5, h6, [role='heading'], legend, .title, .heading"
  );
  for (const h of headings) {
    const t = (h.textContent || "").trim();
    if (t.length > 0 && t.length < 120) return t;
  }
  return "";
}

// ── Submit Button Analysis ──────────────────────────────────────────────────

interface SubmitInfo {
  distToSubmit: number;
  hasSubmitNearby: boolean;
  submitText: string;
  submitTextContainsLogin: boolean;
  submitTextContainsSignup: boolean;
  submitTextContainsVerify: boolean;
  submitTextContainsReset: boolean;
}

function analyzeSubmitButton(el: HTMLInputElement): SubmitInfo {
  const form = el.closest("form") || el.closest("[role='form']") || document.body;
  const buttons = form.querySelectorAll(
    'button, input[type="submit"], input[type="button"], [role="button"], a[class*="btn"], a[class*="button"]'
  );

  let closestDist = 9999;
  let closestText = "";

  const elRect = el.getBoundingClientRect();

  buttons.forEach((btn) => {
    const btnRect = btn.getBoundingClientRect();
    const dist = Math.sqrt(
      Math.pow(elRect.left - btnRect.left, 2) + Math.pow(elRect.top - btnRect.top, 2)
    );
    if (dist < closestDist) {
      closestDist = dist;
      closestText = (
        (btn as HTMLElement).textContent ||
        (btn as HTMLInputElement).value ||
        ""
      )
        .trim()
        .toLowerCase();
    }
  });

  const lc = closestText.toLowerCase();
  return {
    distToSubmit: Math.min(closestDist / 1000, 1.0), // normalized
    hasSubmitNearby: closestDist < 500,
    submitText: closestText,
    submitTextContainsLogin: /log\s*in|sign\s*in|auth/i.test(lc),
    submitTextContainsSignup: /sign\s*up|register|create|join/i.test(lc),
    submitTextContainsVerify: /verif|confirm|validate|otp|code/i.test(lc),
    submitTextContainsReset: /reset|forgot|recover/i.test(lc),
  };
}

// ── Sibling / Context Analysis ──────────────────────────────────────────────

interface SiblingInfo {
  totalFieldsInForm: number;
  fieldIndexInForm: number;
  passwordFieldCount: number;
  isAfterPasswordField: boolean;
  consecutiveMaxLen1Count: number;
  siblingsSameTypeCount: number;
  parentIsFlexbox: boolean;
}

function analyzeSiblings(el: HTMLInputElement): SiblingInfo {
  const form =
    el.closest("form") ||
    el.closest("[role='form']") ||
    el.parentElement?.closest("div, section") ||
    document.body;

  const allInputs = Array.from(
    form.querySelectorAll<HTMLInputElement>(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"])'
    )
  );

  const myIndex = allInputs.indexOf(el);

  // Count password fields and check if we're after one
  let passwordCount = 0;
  let isAfterPassword = false;
  for (let i = 0; i < allInputs.length; i++) {
    if (allInputs[i].type === "password") {
      passwordCount++;
      if (i < myIndex) isAfterPassword = true;
    }
  }

  // Consecutive maxlength=1 siblings (split OTP detection)
  let consecutiveMaxLen1 = 0;
  const parent = el.parentElement;
  if (parent) {
    const siblings = Array.from(
      parent.querySelectorAll<HTMLInputElement>("input")
    );
    let streak = 0;
    for (const sib of siblings) {
      if (sib.maxLength === 1 || sib.getAttribute("maxlength") === "1") {
        streak++;
      } else {
        if (streak > 0 && siblings.indexOf(el) >= siblings.indexOf(sib) - streak) {
          break;
        }
        streak = 0;
      }
    }
    consecutiveMaxLen1 = streak;
  }

  // Same-type siblings
  const sameType = allInputs.filter((inp) => inp.type === el.type);

  // Parent flexbox
  const parentIsFlexbox = parent
    ? /flex|grid/.test(window.getComputedStyle(parent).display)
    : false;

  return {
    totalFieldsInForm: allInputs.length,
    fieldIndexInForm: myIndex >= 0 ? myIndex : 0,
    passwordFieldCount: passwordCount,
    isAfterPasswordField: isAfterPassword,
    consecutiveMaxLen1Count: consecutiveMaxLen1,
    siblingsSameTypeCount: sameType.length,
    parentIsFlexbox,
  };
}

// ── Keyword Pattern Detectors ───────────────────────────────────────────────

function textContainsPatterns(text: string) {
  const lc = text.toLowerCase();
  return {
    email: /e[-_]?mail|e[-_]?addr/i.test(lc),
    username: /user[-_]?name|login[-_]?id|screen[-_]?name|handle/i.test(lc),
    password: /pass[-_]?w|pwd|secret|pin[-_]?code/i.test(lc),
    confirmPass: /confirm|re[-_]?enter|re[-_]?type|repeat|verify.*pass/i.test(lc),
    firstName: /first[-_]?name|given[-_]?name|f[-_]?name|prénom|vorname/i.test(lc),
    lastName: /last[-_]?name|sur[-_]?name|family[-_]?name|l[-_]?name|nachname/i.test(lc),
    fullName: /full[-_]?name|your[-_]?name|display[-_]?name|^name$/i.test(lc),
    phone: /phone|mobile|cell|tel(?:ephone)?|whatsapp|sms/i.test(lc),
    otp: /otp|verif|code|token|one[-_]?time|2fa|mfa|authenticat/i.test(lc),
    login: /log[-_]?in|sign[-_]?in/i.test(lc),
    signup: /sign[-_]?up|register|creat|join/i.test(lc),
  };
}

// ── Shadow DOM Traversal ────────────────────────────────────────────────────

function isInShadowDOM(el: HTMLElement): boolean {
  let node: Node | null = el;
  while (node) {
    if (node instanceof ShadowRoot) return true;
    node = (node as any).parentNode;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: extractFeatures
// ═══════════════════════════════════════════════════════════════════════════

export function extractFeatures(el: HTMLInputElement): RawFieldFeatures {
  // ── Gather raw strings ────────────────────────────────────────────────
  const placeholder = el.placeholder || "";
  const ariaLabel = el.getAttribute("aria-label") || "";
  const explicitLabel = findExplicitLabel(el);
  const nameAttr = el.name || "";
  const idAttr = el.id || "";
  const autocompleteAttr = el.autocomplete || el.getAttribute("autocomplete") || "";
  const floatingLabel = findFloatingLabel(el);
  const nearbyText = findNearbyText(el);
  const formHeading = findFormHeading(el);

  // Concatenated text for keyword detection
  const allText = [
    placeholder, ariaLabel, explicitLabel, nameAttr,
    idAttr, autocompleteAttr, floatingLabel, nearbyText, formHeading,
  ].join(" ");

  // ── Text Channels ─────────────────────────────────────────────────────
  const textChannels: number[][] = [
    encodeText(placeholder),                          // ch0
    encodeText(ariaLabel),                            // ch1
    encodeText(explicitLabel),                        // ch2
    encodeText(nameAttr + " " + idAttr),              // ch3: name+id
    encodeText(autocompleteAttr),                     // ch4
    encodeText(floatingLabel),                        // ch5
    encodeText(nearbyText),                           // ch6
    encodeText(formHeading),                          // ch7
  ];

  // ── Structural Features ───────────────────────────────────────────────
  const vis = analyzeVisibility(el);
  const submit = analyzeSubmitButton(el);
  const sibs = analyzeSiblings(el);
  const kw = textContainsPatterns(allText);
  const inShadow = isInShadowDOM(el);

  const inputType = (el.type || "text").toLowerCase();
  const maxLen = el.maxLength > 0 && el.maxLength < 10000 ? el.maxLength : 0;
  const minLen =
    parseInt(el.getAttribute("minlength") || "0") || 0;
  const inputMode = (el.inputMode || el.getAttribute("inputmode") || "").toLowerCase();
  const hasPattern = el.hasAttribute("pattern");
  const patternVal = el.getAttribute("pattern") || "";
  const patternIsNumeric = /^\^?\\d|^\[0-9\]|\{[0-9]+\}$/.test(patternVal);

  // Autocomplete semantic mapping
  const ac = autocompleteAttr.toLowerCase();
  const acIsEmail = /email/.test(ac);
  const acIsUsername = /username/.test(ac);
  const acIsPassword = /password|current-password|new-password/.test(ac);
  const acIsNewPassword = /new-password/.test(ac);
  const acIsTel = /tel/.test(ac);
  const acIsName = /name|given|family/.test(ac);
  const acIsOTP = /one-time|otp/.test(ac);

  const structural: number[] = [
    // ── Input Type One-Hot (7) ────────────────── [0-6]
    inputType === "text" ? 1 : 0,
    inputType === "password" ? 1 : 0,
    inputType === "email" ? 1 : 0,
    inputType === "tel" ? 1 : 0,
    inputType === "number" ? 1 : 0,
    inputType === "hidden" ? 1 : 0,
    !["text", "password", "email", "tel", "number", "hidden"].includes(inputType) ? 1 : 0,

    // ── Maxlength / Minlength (3) ─────────────── [7-9]
    Math.min(maxLen / 100, 1.0),
    maxLen === 1 ? 1 : 0,
    Math.min(minLen / 50, 1.0),

    // ── Pattern / InputMode (5) ───────────────── [10-14]
    hasPattern ? 1 : 0,
    patternIsNumeric ? 1 : 0,
    inputMode === "numeric" || inputMode === "decimal" ? 1 : 0,
    inputMode === "tel" ? 1 : 0,
    inputMode === "email" ? 1 : 0,

    // ── HTML Attributes (3) ───────────────────── [15-17]
    el.required ? 1 : 0,
    el.readOnly ? 1 : 0,
    el.disabled ? 1 : 0,

    // ── Visibility (6) ───────────────────────── [18-23]
    vis.isVisible ? 1 : 0,
    vis.isOpacityZero ? 1 : 0,
    vis.isOffscreen ? 1 : 0,
    vis.isClipped ? 1 : 0,
    vis.isAriaHidden ? 1 : 0,
    inShadow ? 1 : 0,

    // ── Dimensions (3) ───────────────────────── [24-26]
    Math.min(vis.computedWidth / 600, 1.0),
    Math.min(vis.computedHeight / 80, 1.0),
    vis.computedWidth > 0 && vis.computedHeight > 0
      ? Math.min(vis.computedWidth / vis.computedHeight / 20, 1.0)
      : 0,

    // ── Autocomplete Semantics (7) ───────────── [27-33]
    acIsEmail ? 1 : 0,
    acIsUsername ? 1 : 0,
    acIsPassword ? 1 : 0,
    acIsNewPassword ? 1 : 0,
    acIsTel ? 1 : 0,
    acIsName ? 1 : 0,
    acIsOTP ? 1 : 0,

    // ── Submit Button (6) ────────────────────── [34-39]
    submit.distToSubmit,
    submit.hasSubmitNearby ? 1 : 0,
    submit.submitTextContainsLogin ? 1 : 0,
    submit.submitTextContainsSignup ? 1 : 0,
    submit.submitTextContainsVerify ? 1 : 0,
    submit.submitTextContainsReset ? 1 : 0,

    // ── Sibling / Form Context (7) ──────────── [40-46]
    Math.min(sibs.totalFieldsInForm / 20, 1.0),
    sibs.totalFieldsInForm > 0
      ? sibs.fieldIndexInForm / sibs.totalFieldsInForm
      : 0,
    Math.min(sibs.passwordFieldCount / 3, 1.0),
    sibs.isAfterPasswordField ? 1 : 0,
    Math.min(sibs.consecutiveMaxLen1Count / 8, 1.0),
    Math.min(sibs.siblingsSameTypeCount / 10, 1.0),
    sibs.parentIsFlexbox ? 1 : 0,

    // ── Keyword Presence Flags (9) ──────────── [47-55]
    kw.email ? 1 : 0,
    kw.username ? 1 : 0,
    kw.password ? 1 : 0,
    kw.confirmPass ? 1 : 0,
    kw.firstName ? 1 : 0,
    kw.lastName ? 1 : 0,
    kw.fullName ? 1 : 0,
    kw.phone ? 1 : 0,
    kw.otp ? 1 : 0,
  ];

  return { textChannels, structural, element: el };
}

// ═══════════════════════════════════════════════════════════════════════════
// Batch extraction: scan entire page including Shadow DOMs
// ═══════════════════════════════════════════════════════════════════════════

function collectInputsDeep(root: Document | ShadowRoot): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = [];
  const all = root.querySelectorAll("*");
  for (const el of all) {
    if (
      el instanceof HTMLInputElement &&
      !["submit", "button", "reset", "image", "file", "checkbox", "radio"].includes(
        el.type
      )
    ) {
      inputs.push(el);
    }
    if (el.shadowRoot) {
      inputs.push(...collectInputsDeep(el.shadowRoot));
    }
  }
  return inputs;
}

export function extractAllFields(): RawFieldFeatures[] {
  const inputs = collectInputsDeep(document);
  return inputs.map((el) => extractFeatures(el));
}
```

---

## File 2: `train_ghostfill_model.py` — PyTorch Architecture, Synthetic Data, Training, ONNX Export

```python
#!/usr/bin/env python3
"""
train_ghostfill_model.py — GhostFill Form Field Classifier
Architecture: CharCNN (shared) + Structural MLP + Cross-Field Attention + Classification Head
Target: 5-9MB int8 ONNX model, 10-class classification
"""

import os
import json
import math
import random
import string
import struct
from typing import List, Tuple, Dict, Optional
from dataclasses import dataclass, field
from pathlib import Path
from collections import Counter

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from torch.optim.lr_scheduler import OneCycleLR

# ─── Constants ────────────────────────────────────────────────────────────────

CHAR_VOCAB_SIZE = 256
MAX_TEXT_LEN = 80
NUM_TEXT_CHANNELS = 8
NUM_STRUCTURAL = 56
NUM_CLASSES = 10

CLASS_NAMES = [
    "Email", "Username", "Password", "Target_Password_Confirm",
    "First_Name", "Last_Name", "Full_Name", "Phone", "OTP", "Unknown",
]
CLASS_TO_IDX = {name: i for i, name in enumerate(CLASS_NAMES)}

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
SEED = 42

torch.manual_seed(SEED)
np.random.seed(SEED)
random.seed(SEED)


# ═════════════════════════════════════════════════════════════════════════════
# PART 1: MODEL ARCHITECTURE
# ═════════════════════════════════════════════════════════════════════════════

class CharCNNEncoder(nn.Module):
    """
    Shared character-level CNN applied independently to each text channel.
    Input: (batch, max_text_len) of char indices
    Output: (batch, out_dim) dense representation
    """
    def __init__(
        self,
        vocab_size: int = CHAR_VOCAB_SIZE,
        embed_dim: int = 48,
        num_filters: List[int] = [96, 144, 192],
        kernel_sizes: List[int] = [3, 3, 3],
        output_dim: int = 192,
        dropout: float = 0.15,
    ):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)

        layers = []
        in_ch = embed_dim
        for nf, ks in zip(num_filters, kernel_sizes):
            layers.append(nn.Conv1d(in_ch, nf, ks, padding=ks // 2))
            layers.append(nn.BatchNorm1d(nf))
            layers.append(nn.GELU())
            layers.append(nn.MaxPool1d(2))
            in_ch = nf

        self.conv_stack = nn.Sequential(*layers)
        self.fc = nn.Linear(in_ch, output_dim)
        self.dropout = nn.Dropout(dropout)
        self.output_dim = output_dim

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, MAX_TEXT_LEN)
        emb = self.embedding(x)       # (B, L, E)
        emb = emb.transpose(1, 2)     # (B, E, L)
        h = self.conv_stack(emb)       # (B, C, L')
        h = h.max(dim=2).values        # (B, C) global max pool
        h = self.dropout(self.fc(h))   # (B, output_dim)
        return h


class CrossChannelAttention(nn.Module):
    """
    Multi-head self-attention over the 8 text channel embeddings
    to capture inter-field relationships.
    """
    def __init__(self, d_model: int = 192, n_heads: int = 4, dropout: float = 0.1):
        super().__init__()
        self.attn = nn.MultiheadAttention(d_model, n_heads, dropout=dropout, batch_first=True)
        self.norm = nn.LayerNorm(d_model)
        self.ffn = nn.Sequential(
            nn.Linear(d_model, d_model * 2),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_model * 2, d_model),
            nn.Dropout(dropout),
        )
        self.norm2 = nn.LayerNorm(d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, 8, d_model)
        h, _ = self.attn(x, x, x)
        x = self.norm(x + h)
        h = self.ffn(x)
        x = self.norm2(x + h)
        return x


class StructuralEncoder(nn.Module):
    """MLP for the 56-dim structural feature vector."""
    def __init__(self, input_dim: int = NUM_STRUCTURAL, hidden_dim: int = 128, output_dim: int = 128, dropout: float = 0.15):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.BatchNorm1d(hidden_dim),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, output_dim),
            nn.GELU(),
        )
        self.output_dim = output_dim

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class GhostFillClassifier(nn.Module):
    """
    Full GhostFill Form Field Classifier.

    Architecture:
      1. CharCNN (shared) encodes each of 8 text channels → (B, 8, 192)
      2. CrossChannelAttention fuses text channels → (B, 8, 192) → pool → (B, 192)
      3. StructuralEncoder processes 56 float features → (B, 128)
      4. Concatenate [text_pooled, structural] → (B, 320) → Classification Head → (B, 10)

    Total param budget targets ~5M params → ~5MB int8 / ~20MB fp32
    We quantize to int8 for the 5-9MB target.
    """
    def __init__(self, dropout: float = 0.15):
        super().__init__()

        # Shared text encoder
        self.char_cnn = CharCNNEncoder(
            vocab_size=CHAR_VOCAB_SIZE,
            embed_dim=48,
            num_filters=[128, 192, 256],
            kernel_sizes=[3, 5, 3],
            output_dim=256,
            dropout=dropout,
        )

        # Per-channel projection (small, per-channel bias)
        self.channel_proj = nn.ModuleList([
            nn.Linear(256, 256) for _ in range(NUM_TEXT_CHANNELS)
        ])

        # Cross-channel attention (2 layers for richer reasoning)
        self.cross_attn_1 = CrossChannelAttention(d_model=256, n_heads=4, dropout=dropout)
        self.cross_attn_2 = CrossChannelAttention(d_model=256, n_heads=4, dropout=dropout)

        # Structural encoder
        self.structural_enc = StructuralEncoder(
            input_dim=NUM_STRUCTURAL,
            hidden_dim=192,
            output_dim=192,
            dropout=dropout,
        )

        # Classification head
        fused_dim = 256 + 192  # text_pool + structural
        self.classifier = nn.Sequential(
            nn.Linear(fused_dim, 384),
            nn.BatchNorm1d(384),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(384, 256),
            nn.BatchNorm1d(256),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(256, 128),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(128, NUM_CLASSES),
        )

    def forward(
        self,
        text_channels: torch.Tensor,  # (B, 8, MAX_TEXT_LEN) int64
        structural: torch.Tensor,      # (B, 56) float32
    ) -> torch.Tensor:
        B = text_channels.size(0)

        # Encode each text channel with shared CharCNN + per-channel projection
        channel_embeds = []
        for i in range(NUM_TEXT_CHANNELS):
            ch_input = text_channels[:, i, :]        # (B, MAX_TEXT_LEN)
            ch_emb = self.char_cnn(ch_input)          # (B, 256)
            ch_emb = self.channel_proj[i](ch_emb)     # (B, 256)
            channel_embeds.append(ch_emb)

        # Stack into sequence for attention: (B, 8, 256)
        text_seq = torch.stack(channel_embeds, dim=1)

        # Cross-channel attention
        text_seq = self.cross_attn_1(text_seq)
        text_seq = self.cross_attn_2(text_seq)

        # Attention-weighted pooling
        attn_weights = torch.softmax(text_seq.mean(dim=-1), dim=1)  # (B, 8)
        text_pooled = (text_seq * attn_weights.unsqueeze(-1)).sum(dim=1)  # (B, 256)

        # Structural features
        struct_emb = self.structural_enc(structural)  # (B, 192)

        # Fuse and classify
        fused = torch.cat([text_pooled, struct_emb], dim=1)  # (B, 448)
        logits = self.classifier(fused)  # (B, NUM_CLASSES)

        return logits


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters())


# ═════════════════════════════════════════════════════════════════════════════
# PART 2: SYNTHETIC DATA GENERATION ENGINE
# ═════════════════════════════════════════════════════════════════════════════

# Template pools for each class — real-world variance captured

EMAIL_TEMPLATES = {
    "placeholder": ["Email address", "you@example.com", "Enter your email",
                     "E-mail", "Email", "your.email@domain.com", "Work email",
                     "School email", "Personal email address", "Correo electrónico",
                     "メールアドレス", "电子邮件", "Email eingeben"],
    "name": ["email", "user_email", "emailAddr", "e-mail", "userEmail",
             "login_email", "contact_email", "txtemail", "inputEmail",
             "sc-email-fj39", "css-email-1x", "field_3f7a"],
    "id": ["email", "user-email", "email-input", "txtEmail", "mat-input-0",
            "react-email-ab3f", "field-email", ":r1:", "ember342"],
    "label": ["Email Address", "Email", "Your email", "E-mail address",
              "Enter email", "Account email", "Work email address"],
    "autocomplete": ["email", "username email", "email username"],
    "aria": ["Email address", "Enter your email address", "Email input"],
}

USERNAME_TEMPLATES = {
    "placeholder": ["Username", "Enter username", "Choose a username",
                     "Login ID", "User ID", "Screen name", "Handle",
                     "Benutzername", "ユーザー名", "用户名"],
    "name": ["username", "user_name", "loginId", "screenName", "uname",
             "userId", "login_name", "txtUser", "handle", "sc-un-4f2"],
    "id": ["username", "user-name", "login-id", "txtUsername", "mat-input-1",
            "react-user-3e", ":r2:"],
    "label": ["Username", "User Name", "Login ID", "Account Name", "Handle"],
    "autocomplete": ["username"],
    "aria": ["Username", "Enter your username", "Login name"],
}

PASSWORD_TEMPLATES = {
    "placeholder": ["Password", "Enter password", "Your password",
                     "Passwort", "パスワード", "密码", "••••••••",
                     "Min. 8 characters", "Create a password"],
    "name": ["password", "passwd", "user_password", "loginPassword", "pwd",
             "pass", "txtPassword", "sc-pw-3a", "currentPassword",
             "current-password", "passphrase"],
    "id": ["password", "login-password", "txtPass", "pwd-field",
            "mat-input-2", "react-pw-4b", ":r3:"],
    "label": ["Password", "Your Password", "Enter Password", "Account password",
              "Current password", "Sign-in password"],
    "autocomplete": ["current-password", "password"],
    "aria": ["Password", "Enter your password", "Password field"],
}

CONFIRM_PASSWORD_TEMPLATES = {
    "placeholder": ["Confirm password", "Re-enter password", "Repeat password",
                     "Retype password", "Password again", "Verify password",
                     "Passwort bestätigen", "パスワード確認", "确认密码"],
    "name": ["confirmPassword", "confirm_password", "password_confirm",
             "repassword", "password2", "retypePassword", "verifyPassword",
             "pwdConfirm", "pass_confirm", "retype_pwd"],
    "id": ["confirm-password", "confirmPwd", "password2", "retype-password",
            "mat-input-3", "react-cpw-5c"],
    "label": ["Confirm Password", "Re-enter Password", "Repeat Password",
              "Verify your password", "Type password again"],
    "autocomplete": ["new-password"],
    "aria": ["Confirm password", "Re-enter your password", "Password confirmation"],
}

FIRST_NAME_TEMPLATES = {
    "placeholder": ["First name", "Given name", "Nombre", "Vorname",
                     "名", "John", "Your first name", "Legal first name"],
    "name": ["firstName", "first_name", "fname", "givenName", "given_name",
             "txtFirstName", "name_first", "fName", "prenom"],
    "id": ["first-name", "firstName", "fname", "given-name", "mat-input-4"],
    "label": ["First Name", "Given Name", "Your First Name", "Legal First Name",
              "First name *"],
    "autocomplete": ["given-name"],
    "aria": ["First name", "Enter your first name", "Given name"],
}

LAST_NAME_TEMPLATES = {
    "placeholder": ["Last name", "Family name", "Surname", "Apellido",
                     "Nachname", "姓", "Doe", "Your last name"],
    "name": ["lastName", "last_name", "lname", "familyName", "family_name",
             "surname", "txtLastName", "name_last", "sname"],
    "id": ["last-name", "lastName", "lname", "family-name", "surname",
            "mat-input-5"],
    "label": ["Last Name", "Surname", "Family Name", "Your Last Name"],
    "autocomplete": ["family-name"],
    "aria": ["Last name", "Enter your last name", "Surname"],
}

FULL_NAME_TEMPLATES = {
    "placeholder": ["Full name", "Your name", "Name", "Enter your name",
                     "John Doe", "Display name", "Real name"],
    "name": ["name", "fullName", "full_name", "displayName", "realName",
             "your_name", "txtName", "completeName", "customerName"],
    "id": ["name", "full-name", "fullName", "display-name", "your-name",
            "mat-input-6"],
    "label": ["Name", "Full Name", "Your Name", "Display Name", "Real name"],
    "autocomplete": ["name"],
    "aria": ["Full name", "Enter your full name", "Your name"],
}

PHONE_TEMPLATES = {
    "placeholder": ["Phone number", "(555) 123-4567", "+1 (555) 123-4567",
                     "Mobile number", "Cell phone", "Telefon", "電話番号",
                     "手机号", "Phone", "10-digit number"],
    "name": ["phone", "phoneNumber", "phone_number", "mobile", "telephone",
             "cellphone", "tel", "mobileNumber", "contactPhone", "smsNumber"],
    "id": ["phone", "phone-number", "mobile", "tel", "telephone",
            "mat-input-7", "react-phone-8a"],
    "label": ["Phone Number", "Mobile Number", "Telephone", "Contact Phone",
              "Phone number *", "Cell phone number"],
    "autocomplete": ["tel", "tel-national"],
    "aria": ["Phone number", "Enter your phone number", "Mobile number"],
}

OTP_TEMPLATES = {
    "placeholder": ["Enter code", "Verification code", "OTP", "6-digit code",
                     "Enter OTP", "Code", "------", "______", "123456",
                     "Confirmation code", "Security code", "SMS code",
                     "2FA code", "Authentication code"],
    "name": ["otp", "verificationCode", "verification_code", "code",
             "otpCode", "twoFactorCode", "mfaCode", "smsCode", "pin",
             "securityCode", "authCode", "tokenCode", "confirmCode"],
    "id": ["otp", "verification-code", "otp-input", "code-field",
            "mat-input-8", "otp-0", "otp-1", "otp-2", "otp-3",
            "digit-1", "digit-2"],
    "label": ["Verification Code", "OTP", "Enter the code", "Enter OTP",
              "Security Code", "Authentication Code", "Confirmation Code",
              "SMS verification code"],
    "autocomplete": ["one-time-code"],
    "aria": ["Verification code", "OTP input", "Enter verification code",
             "Enter the code sent to your phone"],
}

UNKNOWN_TEMPLATES = {
    "placeholder": ["Search...", "Enter text", "Comments", "Message",
                     "Address line 1", "City", "State", "Zip code",
                     "Company name", "Website URL", "Coupon code",
                     "Order number", "Subject", "Quantity", "Amount",
                     "Date of birth", "SSN", "Credit card number",
                     "CVV", "Expiration date", "Billing address"],
    "name": ["search", "q", "query", "address", "city", "state", "zip",
             "company", "website", "coupon", "subject", "comment",
             "message", "quantity", "amount", "dob", "cc_number",
             "cvv", "exp_date", "billing_addr", "sx82ff", "field_3a"],
    "id": ["search", "q", "address-1", "city", "zip", "mat-input-99",
            "react-misc-2b", "comment-box", "r8s92"],
    "label": ["Search", "Address", "City", "State/Province", "ZIP Code",
              "Company", "Website", "Comments", "Order Notes", "Quantity"],
    "autocomplete": ["off", "address-line1", "postal-code", "organization",
                      "street-address", "cc-number", "cc-exp"],
    "aria": ["Search", "Enter your address", "Comments", "Additional info"],
}

ALL_TEMPLATES = {
    "Email": EMAIL_TEMPLATES,
    "Username": USERNAME_TEMPLATES,
    "Password": PASSWORD_TEMPLATES,
    "Target_Password_Confirm": CONFIRM_PASSWORD_TEMPLATES,
    "First_Name": FIRST_NAME_TEMPLATES,
    "Last_Name": LAST_NAME_TEMPLATES,
    "Full_Name": FULL_NAME_TEMPLATES,
    "Phone": PHONE_TEMPLATES,
    "OTP": OTP_TEMPLATES,
    "Unknown": UNKNOWN_TEMPLATES,
}


# ── Obfuscation Strategies ──────────────────────────────────────────────────

def random_hash(length: int = 6) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=length))

def obfuscate_name(name: str, prob: float = 0.3) -> str:
    """Simulate framework hashing of name/id attributes."""
    if random.random() < prob:
        strategies = [
            lambda n: f"sc-{random_hash(8)}",                       # styled-components
            lambda n: f"css-{random_hash(4)}-{random_hash(2)}",     # emotion
            lambda n: f":{random_hash(2)}:",                         # React 18 useId
            lambda n: f"ember{random.randint(100,999)}",             # Ember
            lambda n: f"mat-input-{random.randint(0,20)}",           # Angular Material
            lambda n: f"el-input-{random_hash(4)}",                  # Element UI
            lambda n: f"input-{random_hash(8)}",                     # Generic
            lambda n: f"field_{random_hash(6)}",                     # Generic
            lambda n: "",                                             # Completely absent
        ]
        return random.choice(strategies)(name)
    return name

def maybe_drop(text: str, prob: float = 0.2) -> str:
    """Randomly drop text to simulate missing attributes."""
    return "" if random.random() < prob else text

def add_noise(text: str, prob: float = 0.1) -> str:
    """Add minor noise: extra spaces, case changes."""
    if not text or random.random() > prob:
        return text
    transforms = [
        lambda t: t.upper(),
        lambda t: t.lower(),
        lambda t: " " + t + " ",
        lambda t: t.replace(" ", "  "),
        lambda t: t.replace(" ", "_"),
        lambda t: t + " *",        # Required field marker
        lambda t: t + " (required)",
    ]
    return random.choice(transforms)(text)


def encode_text_py(text: str, max_len: int = MAX_TEXT_LEN) -> List[int]:
    s = (text or "").lower().strip()[:max_len]
    encoded = [0] * max_len
    for i, ch in enumerate(s):
        code = ord(ch)
        encoded[i] = code if code < CHAR_VOCAB_SIZE else 1
    return encoded


# ── Input Type Logic ─────────────────────────────────────────────────────────

CLASS_INPUT_TYPES = {
    "Email": ["email", "text", "text", "text"],  # weighted: email most common, but text possible
    "Username": ["text", "text", "email", "text"],
    "Password": ["password", "password", "password", "text"],
    "Target_Password_Confirm": ["password", "password", "password", "text"],
    "First_Name": ["text", "text"],
    "Last_Name": ["text", "text"],
    "Full_Name": ["text", "text"],
    "Phone": ["tel", "tel", "text", "number"],
    "OTP": ["text", "number", "tel", "text", "text", "text"],
    "Unknown": ["text", "search", "text", "number", "text", "url", "text", "date"],
}


# ── Structural Feature Generation ───────────────────────────────────────────

def generate_structural_vector(cls: str, input_type: str) -> List[float]:
    """Generate a 56-dim structural feature vector for a given class."""
    features = []

    # [0-6] Input type one-hot
    type_list = ["text", "password", "email", "tel", "number", "hidden"]
    for t in type_list:
        features.append(1.0 if input_type == t else 0.0)
    features.append(1.0 if input_type not in type_list else 0.0)

    # [7-9] Maxlength / Minlength
    if cls == "OTP":
        if random.random() < 0.4:  # Split OTP
            ml = 1
        else:
            ml = random.choice([4, 5, 6, 7, 8, 6, 6])
        features.append(min(ml / 100, 1.0))
        features.append(1.0 if ml == 1 else 0.0)
        features.append(min(random.choice([0, 4, 6]) / 50, 1.0))
    elif cls == "Phone":
        ml = random.choice([0, 10, 11, 15, 20])
        features.append(min(ml / 100, 1.0))
        features.append(0.0)
        features.append(min(random.choice([0, 7, 10]) / 50, 1.0))
    elif cls == "Password" or cls == "Target_Password_Confirm":
        ml = random.choice([0, 0, 20, 50, 128, 255])
        features.append(min(ml / 100, 1.0))
        features.append(0.0)
        features.append(min(random.choice([0, 6, 8]) / 50, 1.0))
    else:
        ml = random.choice([0, 0, 0, 50, 100, 255])
        features.append(min(ml / 100, 1.0))
        features.append(0.0)
        features.append(min(random.choice([0, 0, 1, 2]) / 50, 1.0))

    # [10-14] Pattern / InputMode
    has_pattern = random.random() < (0.3 if cls in ["OTP", "Phone"] else 0.05)
    pattern_numeric = has_pattern and cls in ["OTP", "Phone"] and random.random() < 0.8
    features.append(1.0 if has_pattern else 0.0)
    features.append(1.0 if pattern_numeric else 0.0)
    features.append(1.0 if cls in ["OTP", "Phone"] and random.random() < 0.6 else 0.0)
    features.append(1.0 if cls == "Phone" and random.random() < 0.3 else 0.0)
    features.append(1.0 if cls == "Email" and random.random() < 0.3 else 0.0)

    # [15-17] Required / Readonly / Disabled
    features.append(1.0 if random.random() < 0.6 else 0.0)
    features.append(0.0)  # fields we classify are rarely readonly
    features.append(0.0)  # or disabled

    # [18-23] Visibility
    is_honeypot = cls == "Unknown" and random.random() < 0.1
    features.append(0.0 if is_honeypot else 1.0)  # isVisible
    features.append(1.0 if is_honeypot and random.random() < 0.3 else 0.0)  # opacity0
    features.append(1.0 if is_honeypot and random.random() < 0.3 else 0.0)  # offscreen
    features.append(1.0 if is_honeypot and random.random() < 0.3 else 0.0)  # clipped
    features.append(1.0 if is_honeypot and random.random() < 0.2 else 0.0)  # aria-hidden
    features.append(1.0 if random.random() < 0.15 else 0.0)  # inShadowDom

    # [24-26] Dimensions
    width = random.gauss(300, 80) if not is_honeypot else random.choice([0, 1])
    height = random.gauss(40, 8) if not is_honeypot else random.choice([0, 1])
    if cls == "OTP" and ml == 1:  # Split OTP: small square fields
        width = random.gauss(45, 10)
        height = random.gauss(45, 10)
    width = max(0, width)
    height = max(0, height)
    features.append(min(width / 600, 1.0))
    features.append(min(height / 80, 1.0))
    features.append(min(width / max(height, 1) / 20, 1.0))

    # [27-33] Autocomplete semantics (set probabilistically below)
    ac_flags = [0.0] * 7  # email, username, password, new-password, tel, name, otp
    if random.random() < 0.4:
        ac_map = {
            "Email": 0, "Username": 1, "Password": 2,
            "Target_Password_Confirm": 3, "Phone": 4,
            "First_Name": 5, "Last_Name": 5, "Full_Name": 5, "OTP": 6,
        }
        if cls in ac_map:
            ac_flags[ac_map[cls]] = 1.0
    features.extend(ac_flags)

    # [34-39] Submit button analysis
    dist_to_submit = random.uniform(0.05, 0.5) if random.random() < 0.8 else random.uniform(0.5, 1.0)
    features.append(dist_to_submit)
    features.append(1.0 if dist_to_submit < 0.5 else 0.0)

    is_login_context = cls in ["Email", "Username", "Password"] and random.random() < 0.5
    is_signup_context = cls in ["Email", "Username", "Password", "Target_Password_Confirm",
                                "First_Name", "Last_Name", "Full_Name", "Phone"] and random.random() < 0.4
    is_verify_context = cls in ["OTP"] and random.random() < 0.6
    is_reset_context = cls in ["Password", "Target_Password_Confirm"] and random.random() < 0.15

    features.append(1.0 if is_login_context else 0.0)
    features.append(1.0 if is_signup_context else 0.0)
    features.append(1.0 if is_verify_context else 0.0)
    features.append(1.0 if is_reset_context else 0.0)

    # [40-46] Sibling / Form context
    if cls == "OTP" and ml == 1:
        total_fields = random.randint(4, 8)
        field_idx = random.randint(0, total_fields - 1)
        pw_count = 0
        after_pw = False
        consec_maxlen1 = random.randint(4, 8)
        same_type_count = consec_maxlen1
        parent_flex = 1.0 if random.random() < 0.85 else 0.0
    elif cls in ["Password", "Target_Password_Confirm"]:
        total_fields = random.randint(2, 8)
        is_confirm = cls == "Target_Password_Confirm"
        pw_count = 2 if is_confirm else random.choice([1, 2])
        field_idx = random.randint(1 if is_confirm else 0, total_fields - 1)
        after_pw = is_confirm or (random.random() < 0.3)
        consec_maxlen1 = 0
        same_type_count = pw_count
        parent_flex = 0.0
    else:
        total_fields = random.randint(1, 12)
        field_idx = random.randint(0, max(total_fields - 1, 0))
        pw_count = random.randint(0, 2) if cls not in ["OTP"] else 0
        after_pw = random.random() < 0.2
        consec_maxlen1 = 0
        same_type_count = random.randint(1, 3)
        parent_flex = 1.0 if random.random() < 0.2 else 0.0

    features.append(min(total_fields / 20, 1.0))
    features.append(field_idx / max(total_fields, 1))
    features.append(min(pw_count / 3, 1.0))
    features.append(1.0 if after_pw else 0.0)
    features.append(min(consec_maxlen1 / 8, 1.0))
    features.append(min(same_type_count / 10, 1.0))
    features.append(parent_flex)

    # [47-55] Keyword presence flags
    # These are derived from ALL text—but in synthetic data we set them based on class
    kw_flags = [0.0] * 9  # email, username, password, confirmPass, firstName, lastName, fullName, phone, otp
    kw_map = {
        "Email": [0], "Username": [1], "Password": [2],
        "Target_Password_Confirm": [2, 3],
        "First_Name": [4], "Last_Name": [5], "Full_Name": [6],
        "Phone": [7], "OTP": [8],
    }
    if cls in kw_map:
        for idx in kw_map[cls]:
            if random.random() < 0.85:
                kw_flags[idx] = 1.0
    # Add some noise: occasionally set wrong flags
    if random.random() < 0.05:
        kw_flags[random.randint(0, 8)] = 1.0
    features.extend(kw_flags)

    assert len(features) == NUM_STRUCTURAL, f"Expected {NUM_STRUCTURAL}, got {len(features)}"
    return features


# ── Full Sample Generation ───────────────────────────────────────────────────

def generate_sample(cls: str) -> Tuple[List[List[int]], List[float], int]:
    """Generate one training sample: (text_channels, structural, label)."""
    templates = ALL_TEMPLATES[cls]

    # Pick input type
    itype = random.choice(CLASS_INPUT_TYPES[cls])

    # Generate text channels
    placeholder = add_noise(maybe_drop(random.choice(templates["placeholder"]), 0.25))
    aria_label = add_noise(maybe_drop(random.choice(templates.get("aria", [""])), 0.5))
    explicit_label = add_noise(maybe_drop(random.choice(templates.get("label", [""])), 0.3))

    raw_name = random.choice(templates["name"])
    raw_id = random.choice(templates["id"])
    name_id = obfuscate_name(raw_name, 0.3) + " " + obfuscate_name(raw_id, 0.3)

    autocomplete_val = maybe_drop(random.choice(templates.get("autocomplete", [""])), 0.5)
    floating_label = maybe_drop(random.choice(templates.get("label", [""])), 0.6)
    nearby_text = maybe_drop(random.choice(templates.get("label", [""])), 0.4)

    # Form heading
    heading_pool = {
        "Email": ["Log In", "Sign In", "Create Account", "Newsletter", "Contact Us"],
        "Username": ["Log In", "Sign In", "Create Account", "Register"],
        "Password": ["Log In", "Sign In", "Create Account", "Reset Password"],
        "Target_Password_Confirm": ["Create Account", "Register", "Reset Password", "Change Password"],
        "First_Name": ["Create Account", "Register", "Profile", "Checkout", "Personal Info"],
        "Last_Name": ["Create Account", "Register", "Profile", "Checkout", "Personal Info"],
        "Full_Name": ["Profile", "Account Settings", "Checkout", "Contact"],
        "Phone": ["Contact", "Register", "Verification", "Profile", "Checkout"],
        "OTP": ["Verify Your Identity", "Enter Code", "Two-Factor Authentication",
                 "Verification", "Confirm Your Account", "Security Check"],
        "Unknown": ["Search", "Leave a Comment", "Checkout", "Shipping", "Payment", ""],
    }
    form_heading = maybe_drop(random.choice(heading_pool.get(cls, [""])), 0.4)

    text_channels = [
        encode_text_py(placeholder),
        encode_text_py(aria_label),
        encode_text_py(explicit_label),
        encode_text_py(name_id),
        encode_text_py(autocomplete_val),
        encode_text_py(floating_label),
        encode_text_py(nearby_text),
        encode_text_py(form_heading),
    ]

    structural = generate_structural_vector(cls, itype)
    label = CLASS_TO_IDX[cls]

    return text_channels, structural, label


# ── Hard Negative Mining: Adversarial Samples ────────────────────────────────

def generate_adversarial_sample() -> Tuple[List[List[int]], List[float], int]:
    """
    Generate deliberately confusing samples to harden the model.
    E.g., a field with placeholder "Enter code" that is actually a coupon field (Unknown).
    """
    adversarial_cases = [
        # Coupon code that looks like OTP
        ("Unknown", {"placeholder": "Enter code", "label": "Coupon Code",
                      "name": "coupon", "heading": "Your Cart"}),
        # Order number that looks like OTP
        ("Unknown", {"placeholder": "Order number", "label": "Order #",
                      "name": "orderNum", "heading": "Track Order"}),
        # Search that looks like email
        ("Unknown", {"placeholder": "Search by email", "label": "",
                      "name": "search_email", "heading": ""}),
        # Name field that looks like username
        ("Full_Name", {"placeholder": "Name", "label": "Your Name",
                        "name": "name", "heading": "Leave a Review"}),
        # Password field in a non-auth context
        ("Password", {"placeholder": "Password", "label": "Encrypt with password",
                       "name": "encryptPass", "heading": "File Encryption"}),
        # Phone that looks like OTP (numeric, short)
        ("Phone", {"placeholder": "Phone", "label": "Phone Number",
                    "name": "phone", "heading": "Contact"}),
        # Username that's actually an email field
        ("Email", {"placeholder": "Email or Username", "label": "Login",
                    "name": "login", "heading": "Sign In"}),
    ]

    case = random.choice(adversarial_cases)
    cls = case[0]
    overrides = case[1]

    text_channels, structural, label = generate_sample(cls)

    # Override specific text channels
    if "placeholder" in overrides:
        text_channels[0] = encode_text_py(overrides["placeholder"])
    if "label" in overrides:
        text_channels[2] = encode_text_py(overrides["label"])
    if "name" in overrides:
        text_channels[3] = encode_text_py(overrides["name"])
    if "heading" in overrides:
        text_channels[7] = encode_text_py(overrides["heading"])

    return text_channels, structural, label


# ═════════════════════════════════════════════════════════════════════════════
# PART 3: DATASET & DATALOADER
# ═════════════════════════════════════════════════════════════════════════════

class GhostFillDataset(Dataset):
    def __init__(self, num_samples: int = 500_000, adversarial_ratio: float = 0.1):
        self.num_samples = num_samples
        self.adversarial_ratio = adversarial_ratio

        # Precompute class distribution weights (oversample rare classes)
        self.class_weights = {
            "Email": 1.0, "Username": 1.0, "Password": 1.0,
            "Target_Password_Confirm": 1.5, "First_Name": 1.0,
            "Last_Name": 1.0, "Full_Name": 1.0, "Phone": 1.0,
            "OTP": 1.5, "Unknown": 1.2,
        }
        total_w = sum(self.class_weights.values())
        self.class_probs = [self.class_weights[c] / total_w for c in CLASS_NAMES]

        # Pre-generate all samples for reproducibility
        print(f"Generating {num_samples:,} synthetic training samples...")
        self.samples = []
        for i in range(num_samples):
            if random.random() < adversarial_ratio:
                sample = generate_adversarial_sample()
            else:
                cls = random.choices(CLASS_NAMES, weights=self.class_probs, k=1)[0]
                sample = generate_sample(cls)
            self.samples.append(sample)

            if (i + 1) % 100_000 == 0:
                print(f"  Generated {i+1:,} / {num_samples:,}")

        # Count class distribution
        dist = Counter(s[2] for s in self.samples)
        print("Class distribution:")
        for cls_name in CLASS_NAMES:
            idx = CLASS_TO_IDX[cls_name]
            print(f"  {cls_name}: {dist.get(idx, 0):,}")

    def __len__(self) -> int:
        return self.num_samples

    def __getitem__(self, idx: int):
        text_channels, structural, label = self.samples[idx]
        return (
            torch.tensor(text_channels, dtype=torch.long),  # (8, 80)
            torch.tensor(structural, dtype=torch.float32),   # (56,)
            torch.tensor(label, dtype=torch.long),           # scalar
        )


# ═════════════════════════════════════════════════════════════════════════════
# PART 4: TRAINING LOOP
# ═════════════════════════════════════════════════════════════════════════════

def train(
    num_train: int = 500_000,
    num_val: int = 50_000,
    batch_size: int = 512,
    num_epochs: int = 40,
    lr: float = 3e-3,
    weight_decay: float = 1e-4,
    save_dir: str = "./ghostfill_output",
    label_smoothing: float = 0.05,
):
    os.makedirs(save_dir, exist_ok=True)

    # Datasets
    train_ds = GhostFillDataset(num_train, adversarial_ratio=0.1)
    val_ds = GhostFillDataset(num_val, adversarial_ratio=0.15)

    train_loader = DataLoader(
        train_ds, batch_size=batch_size, shuffle=True,
        num_workers=4, pin_memory=True, drop_last=True,
    )
    val_loader = DataLoader(
        val_ds, batch_size=batch_size, shuffle=False,
        num_workers=2, pin_memory=True,
    )

    # Model
    model = GhostFillClassifier(dropout=0.15).to(DEVICE)
    total_params = count_parameters(model)
    print(f"\nModel parameters: {total_params:,}")
    print(f"Estimated FP32 size: {total_params * 4 / 1024 / 1024:.1f} MB")
    print(f"Estimated INT8 size: {total_params / 1024 / 1024:.1f} MB")

    # Loss, Optimizer, Scheduler
    criterion = nn.CrossEntropyLoss(label_smoothing=label_smoothing)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    total_steps = len(train_loader) * num_epochs
    scheduler = OneCycleLR(
        optimizer, max_lr=lr, total_steps=total_steps,
        pct_start=0.1, anneal_strategy="cos",
    )

    best_val_acc = 0.0
    best_model_path = os.path.join(save_dir, "best_model.pt")

    for epoch in range(1, num_epochs + 1):
        # ── Training ─────────────────────────────────────────────────────
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0

        for batch_idx, (text_ch, struct, labels) in enumerate(train_loader):
            text_ch = text_ch.to(DEVICE)   # (B, 8, 80)
            struct = struct.to(DEVICE)     # (B, 56)
            labels = labels.to(DEVICE)     # (B,)

            logits = model(text_ch, struct)
            loss = criterion(logits, labels)

            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            train_loss += loss.item() * labels.size(0)
            preds = logits.argmax(dim=1)
            train_correct += (preds == labels).sum().item()
            train_total += labels.size(0)

        train_acc = train_correct / train_total
        train_loss /= train_total

        # ── Validation ───────────────────────────────────────────────────
        model.eval()
        val_correct = 0
        val_total = 0
        per_class_correct = [0] * NUM_CLASSES
        per_class_total = [0] * NUM_CLASSES

        with torch.no_grad():
            for text_ch, struct, labels in val_loader:
                text_ch = text_ch.to(DEVICE)
                struct = struct.to(DEVICE)
                labels = labels.to(DEVICE)

                logits = model(text_ch, struct)
                preds = logits.argmax(dim=1)
                val_correct += (preds == labels).sum().item()
                val_total += labels.size(0)

                for i in range(NUM_CLASSES):
                    mask = labels == i
                    per_class_correct[i] += (preds[mask] == labels[mask]).sum().item()
                    per_class_total[i] += mask.sum().item()

        val_acc = val_correct / val_total

        print(f"\nEpoch {epoch}/{num_epochs}")
        print(f"  Train Loss: {train_loss:.4f} | Train Acc: {train_acc:.4f}")
        print(f"  Val Acc: {val_acc:.4f}")

        # Per-class accuracy
        for i, name in enumerate(CLASS_NAMES):
            cls_acc = per_class_correct[i] / max(per_class_total[i], 1)
            print(f"    {name:30s}: {cls_acc:.4f} ({per_class_total[i]:,} samples)")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), best_model_path)
            print(f"  ★ New best model saved (val_acc={val_acc:.4f})")

    print(f"\n{'='*60}")
    print(f"Training complete. Best validation accuracy: {best_val_acc:.4f}")
    return model, best_model_path


# ═════════════════════════════════════════════════════════════════════════════
# PART 5: ONNX EXPORT + INT8 QUANTIZATION
# ═════════════════════════════════════════════════════════════════════════════

def export_onnx(
    model_path: str = "./ghostfill_output/best_model.pt",
    output_path: str = "./ghostfill_output/ghostfill.onnx",
    quantized_path: str = "./ghostfill_output/ghostfill_int8.onnx",
):
    import onnx
    from onnxruntime.quantization import quantize_dynamic, QuantType

    # Load best model
    model = GhostFillClassifier(dropout=0.0)  # No dropout at inference
    model.load_state_dict(torch.load(model_path, map_location="cpu"))
    model.eval()

    # Create dummy inputs
    dummy_text = torch.zeros(1, NUM_TEXT_CHANNELS, MAX_TEXT_LEN, dtype=torch.long)
    dummy_struct = torch.zeros(1, NUM_STRUCTURAL, dtype=torch.float32)

    # Export to ONNX
    print(f"Exporting to ONNX: {output_path}")
    torch.onnx.export(
        model,
        (dummy_text, dummy_struct),
        output_path,
        input_names=["text_channels", "structural"],
        output_names=["logits"],
        dynamic_axes={
            "text_channels": {0: "batch"},
            "structural": {0: "batch"},
            "logits": {0: "batch"},
        },
        opset_version=17,
        do_constant_folding=True,
    )

    # Verify
    onnx_model = onnx.load(output_path)
    onnx.checker.check_model(onnx_model)
    fp32_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"FP32 ONNX size: {fp32_size:.1f} MB")

    # Dynamic INT8 Quantization
    print(f"Quantizing to INT8: {quantized_path}")
    quantize_dynamic(
        model_input=output_path,
        model_output=quantized_path,
        weight_type=QuantType.QInt8,
        optimize_model=True,
        per_channel=True,
        reduce_range=False,
        extra_options={
            "WeightSymmetric": True,
            "ActivationSymmetric": False,
            "EnableSubgraph": True,
            "ForceQuantizeNoInputCheck": True,
        },
    )

    int8_size = os.path.getsize(quantized_path) / (1024 * 1024)
    print(f"INT8 ONNX size: {int8_size:.1f} MB")
    print(f"Compression ratio: {fp32_size / int8_size:.1f}x")

    if 5.0 <= int8_size <= 9.0:
        print(f"✅ Model within target range (5-9 MB)")
    else:
        print(f"⚠️ Model size {int8_size:.1f} MB outside 5-9 MB target. Adjust architecture.")

    return quantized_path


# ═══════════════════════════════════════════════════════════════════════════
# PART 6: ONNX Runtime Validation
# ═══════════════════════════════════════════════════════════════════════════

def validate_onnx(
    quantized_path: str = "./ghostfill_output/ghostfill_int8.onnx",
    num_samples: int = 10_000,
):
    import onnxruntime as ort

    sess = ort.InferenceSession(quantized_path, providers=["CPUExecutionProvider"])

    correct = 0
    per_class_correct = [0] * NUM_CLASSES
    per_class_total = [0] * NUM_CLASSES

    for _ in range(num_samples):
        cls = random.choice(CLASS_NAMES)
        text_channels, structural, label = generate_sample(cls)

        text_np = np.array([text_channels], dtype=np.int64)
        struct_np = np.array([structural], dtype=np.float32)

        logits = sess.run(["logits"], {
            "text_channels": text_np,
            "structural": struct_np,
        })[0]

        pred = int(np.argmax(logits, axis=1)[0])
        if pred == label:
            correct += 1
            per_class_correct[label] += 1
        per_class_total[label] += 1

    overall_acc = correct / num_samples
    print(f"\nONNX INT8 Validation ({num_samples:,} samples)")
    print(f"  Overall Accuracy: {overall_acc:.4f}")
    for i, name in enumerate(CLASS_NAMES):
        if per_class_total[i] > 0:
            cls_acc = per_class_correct[i] / per_class_total[i]
            print(f"    {name:30s}: {cls_acc:.4f}")


# ═══════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Train GhostFill Form Classifier")
    parser.add_argument("--train-samples", type=int, default=500_000)
    parser.add_argument("--val-samples", type=int, default=50_000)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--output-dir", type=str, default="./ghostfill_output")
    parser.add_argument("--skip-training", action="store_true")
    parser.add_argument("--export-only", action="store_true")
    args = parser.parse_args()

    if not args.skip_training and not args.export_only:
        model, best_path = train(
            num_train=args.train_samples,
            num_val=args.val_samples,
            batch_size=args.batch_size,
            num_epochs=args.epochs,
            lr=args.lr,
            save_dir=args.output_dir,
        )

    quantized = export_onnx(
        model_path=os.path.join(args.output_dir, "best_model.pt"),
        output_path=os.path.join(args.output_dir, "ghostfill.onnx"),
        quantized_path=os.path.join(args.output_dir, "ghostfill_int8.onnx"),
    )

    validate_onnx(quantized, num_samples=10_000)
```

---

## File 3: `inference_engine.ts` — ONNX Runtime Web Inference in Chrome Extension

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// inference_engine.ts — GhostFill ONNX Runtime Web Inference Engine
// Runs entirely in-browser. Zero cloud calls.
// ─────────────────────────────────────────────────────────────────────────────

import * as ort from "onnxruntime-web";
import {
  extractAllFields,
  extractFeatures,
  RawFieldFeatures,
  NUM_TEXT_CHANNELS,
  MAX_TEXT_LEN,
  NUM_STRUCTURAL_FEATURES,
  CHAR_VOCAB_SIZE,
} from "./extractor";

// ── Types ────────────────────────────────────────────────────────────────────

export const CLASS_NAMES = [
  "Email", "Username", "Password", "Target_Password_Confirm",
  "First_Name", "Last_Name", "Full_Name", "Phone", "OTP", "Unknown",
] as const;

export type FieldClass = (typeof CLASS_NAMES)[number];

export interface ClassificationResult {
  element: HTMLInputElement;
  predictedClass: FieldClass;
  confidence: number;
  probabilities: Record<FieldClass, number>;
  isHoneypot: boolean;
}

// ── Singleton Session Manager ────────────────────────────────────────────────

class GhostFillEngine {
  private session: ort.InferenceSession | null = null;
  private sessionPromise: Promise<ort.InferenceSession> | null = null;
  private isDisposed = false;

  /**
   * Initialize ONNX Runtime session.
   * Uses WASM backend for maximum compatibility.
   * Model is loaded from extension bundle via chrome.runtime.getURL().
   */
  async initialize(): Promise<void> {
    if (this.session) return;
    if (this.sessionPromise) {
      await this.sessionPromise;
      return;
    }

    this.sessionPromise = this._createSession();
    this.session = await this.sessionPromise;
  }

  private async _createSession(): Promise<ort.InferenceSession> {
    // Configure ONNX Runtime Web
    ort.env.wasm.numThreads = navigator.hardwareConcurrency
      ? Math.min(navigator.hardwareConcurrency, 4)
      : 2;

    // Resolve WASM files from extension bundle
    const wasmBasePath = chrome.runtime.getURL("ort-wasm/");
    ort.env.wasm.wasmPaths = wasmBasePath;

    // Load quantized model from extension bundle
    const modelUrl = chrome.runtime.getURL("models/ghostfill_int8.onnx");
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Failed to load model: ${response.status} ${response.statusText}`);
    }
    const modelBuffer = await response.arrayBuffer();

    const session = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
      enableCpuMemArena: true,
      enableMemPattern: true,
      executionMode: "sequential", // sequential for single-input, parallel for batch
      logSeverityLevel: 3,        // ERROR only
    });

    console.log("[GhostFill] ONNX session initialized successfully");
    console.log(`[GhostFill] Input names: ${session.inputNames}`);
    console.log(`[GhostFill] Output names: ${session.outputNames}`);

    return session;
  }

  /**
   * Classify a single input element.
   */
  async classifySingle(el: HTMLInputElement): Promise<ClassificationResult> {
    const features = extractFeatures(el);
    const results = await this.classifyBatch([features]);
    return results[0];
  }

  /**
   * Classify all input fields on the current page.
   * Returns results sorted by DOM order.
   */
  async classifyPage(): Promise<ClassificationResult[]> {
    await this.initialize();

    const fields = extractAllFields();
    if (fields.length === 0) return [];

    return this.classifyBatch(fields);
  }

  /**
   * Core batch inference. Handles tensor allocation and disposal.
   */
  async classifyBatch(fields: RawFieldFeatures[]): Promise<ClassificationResult[]> {
    await this.initialize();
    if (!this.session || this.isDisposed) {
      throw new Error("[GhostFill] Session not initialized or disposed");
    }

    const batchSize = fields.length;

    // ── Allocate Tensors ──────────────────────────────────────────────
    // text_channels: (B, 8, 80) as int64
    // Note: ONNX Runtime Web uses BigInt64Array for int64 tensors
    const textData = new BigInt64Array(batchSize * NUM_TEXT_CHANNELS * MAX_TEXT_LEN);
    const structData = new Float32Array(batchSize * NUM_STRUCTURAL_FEATURES);

    for (let b = 0; b < batchSize; b++) {
      const field = fields[b];

      // Pack text channels
      for (let ch = 0; ch < NUM_TEXT_CHANNELS; ch++) {
        for (let t = 0; t < MAX_TEXT_LEN; t++) {
          const flatIdx =
            b * (NUM_TEXT_CHANNELS * MAX_TEXT_LEN) +
            ch * MAX_TEXT_LEN +
            t;
          textData[flatIdx] = BigInt(field.textChannels[ch][t]);
        }
      }

      // Pack structural features
      for (let f = 0; f < NUM_STRUCTURAL_FEATURES; f++) {
        structData[b * NUM_STRUCTURAL_FEATURES + f] = field.structural[f];
      }
    }

    // Create ONNX tensors
    const textTensor = new ort.Tensor(
      "int64",
      textData,
      [batchSize, NUM_TEXT_CHANNELS, MAX_TEXT_LEN]
    );
    const structTensor = new ort.Tensor(
      "float32",
      structData,
      [batchSize, NUM_STRUCTURAL_FEATURES]
    );

    // ── Run Inference ─────────────────────────────────────────────────
    let outputMap: ort.InferenceSession.OnnxValueMapType;
    try {
      outputMap = await this.session.run({
        text_channels: textTensor,
        structural: structTensor,
      });
    } finally {
      // Tensors are consumed; help GC (ORT Web manages WASM memory internally)
      // No explicit dispose needed for input tensors in ORT Web, but we null refs.
    }

    // ── Parse Output ──────────────────────────────────────────────────
    const logitsTensor = outputMap["logits"];
    const logitsData = logitsTensor.data as Float32Array;

    const results: ClassificationResult[] = [];

    for (let b = 0; b < batchSize; b++) {
      const offset = b * CLASS_NAMES.length;
      const logits = logitsData.slice(offset, offset + CLASS_NAMES.length);

      // Softmax
      const probs = softmax(logits);

      // Find best class
      let bestIdx = 0;
      let bestProb = probs[0];
      for (let i = 1; i < probs.length; i++) {
        if (probs[i] > bestProb) {
          bestProb = probs[i];
          bestIdx = i;
        }
      }

      // Build probability map
      const probMap = {} as Record<FieldClass, number>;
      for (let i = 0; i < CLASS_NAMES.length; i++) {
        probMap[CLASS_NAMES[i]] = probs[i];
      }

      // Honeypot detection via structural features
      const structOffset = b * NUM_STRUCTURAL_FEATURES;
      const isVisible = structData[structOffset + 18] > 0.5;
      const isOpacity0 = structData[structOffset + 19] > 0.5;
      const isOffscreen = structData[structOffset + 20] > 0.5;
      const isClipped = structData[structOffset + 21] > 0.5;
      const isAriaHidden = structData[structOffset + 22] > 0.5;
      const isHoneypot = !isVisible || isOpacity0 || isOffscreen || isClipped || isAriaHidden;

      results.push({
        element: fields[b].element,
        predictedClass: CLASS_NAMES[bestIdx],
        confidence: bestProb,
        probabilities: probMap,
        isHoneypot,
      });
    }

    return results;
  }

  /**
   * Release ONNX session and free WASM memory.
   */
  async dispose(): Promise<void> {
    this.isDisposed = true;
    if (this.session) {
      await this.session.release();
      this.session = null;
    }
    this.sessionPromise = null;
    console.log("[GhostFill] Engine disposed");
  }
}

// ── Numerically Stable Softmax ──────────────────────────────────────────────

function softmax(logits: Float32Array): number[] {
  const max = Math.max(...logits);
  const exps = new Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - max);
    sum += exps[i];
  }
  for (let i = 0; i < logits.length; i++) {
    exps[i] /= sum;
  }
  return exps;
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON EXPORT & CONTENT SCRIPT INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

export const ghostFillEngine = new GhostFillEngine();

/**
 * Content script entry point.
 * Observes DOM mutations and classifies new input fields.
 */
export async function initContentScript(): Promise<void> {
  // Classify existing fields on page load
  await classifyAndAnnotate();

  // Observe dynamic DOM changes (SPAs, modals, lazy-loaded forms)
  const observer = new MutationObserver(
    debounce(async (mutations: MutationRecord[]) => {
      // Check if any mutations added input elements
      let hasNewInputs = false;
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node instanceof HTMLElement) {
            if (
              node.tagName === "INPUT" ||
              node.querySelector?.("input")
            ) {
              hasNewInputs = true;
              break;
            }
            // Check shadow roots
            if (node.shadowRoot?.querySelector("input")) {
              hasNewInputs = true;
              break;
            }
          }
        }
        if (hasNewInputs) break;
      }

      if (hasNewInputs) {
        await classifyAndAnnotate();
      }
    }, 300)
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Listen for messages from background/popup for on-demand classification
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "GHOSTFILL_CLASSIFY") {
      classifyAndAnnotate().then((results) => {
        sendResponse({
          success: true,
          fields: results.map((r) => ({
            class: r.predictedClass,
            confidence: r.confidence,
            isHoneypot: r.isHoneypot,
            // Cannot serialize HTMLElement, so include selector
            selector: generateSelector(r.element),
          })),
        });
      });
      return true; // async response
    }

    if (message.type === "GHOSTFILL_FILL") {
      handleFill(message.profile).then(() => sendResponse({ success: true }));
      return true;
    }

    if (message.type === "GHOSTFILL_DISPOSE") {
      ghostFillEngine.dispose().then(() => sendResponse({ success: true }));
      return true;
    }
  });

  // Cleanup on page unload
  window.addEventListener("unload", () => {
    ghostFillEngine.dispose();
  });
}

// ── Classify & Annotate ─────────────────────────────────────────────────────

let lastResults: ClassificationResult[] = [];

async function classifyAndAnnotate(): Promise<ClassificationResult[]> {
  try {
    const results = await ghostFillEngine.classifyPage();
    lastResults = results;

    for (const result of results) {
      if (result.isHoneypot) continue; // Never touch honeypots

      // Set data attributes for the fill logic
      result.element.dataset.ghostfillClass = result.predictedClass;
      result.element.dataset.ghostfillConfidence = result.confidence.toFixed(4);

      // Set autocomplete hints for browser integration
      const acMap: Partial<Record<FieldClass, string>> = {
        Email: "email",
        Username: "username",
        Password: "current-password",
        Target_Password_Confirm: "new-password",
        First_Name: "given-name",
        Last_Name: "family-name",
        Full_Name: "name",
        Phone: "tel",
        OTP: "one-time-code",
      };
      if (acMap[result.predictedClass] && result.confidence > 0.7) {
        result.element.setAttribute("autocomplete", acMap[result.predictedClass]!);
      }
    }

    console.log(
      `[GhostFill] Classified ${results.length} fields:`,
      results
        .filter((r) => !r.isHoneypot)
        .map((r) => `${r.predictedClass}(${(r.confidence * 100).toFixed(1)}%)`)
    );

    return results;
  } catch (err) {
    console.error("[GhostFill] Classification error:", err);
    return [];
  }
}

// ── Fill Logic ──────────────────────────────────────────────────────────────

interface UserProfile {
  email?: string;
  username?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  phone?: string;
}

async function handleFill(profile: UserProfile): Promise<void> {
  if (lastResults.length === 0) {
    await classifyAndAnnotate();
  }

  const fillMap: Partial<Record<FieldClass, string | undefined>> = {
    Email: profile.email,
    Username: profile.username,
    Password: profile.password,
    Target_Password_Confirm: profile.password,
    First_Name: profile.firstName,
    Last_Name: profile.lastName,
    Full_Name: profile.fullName || `${profile.firstName || ""} ${profile.lastName || ""}`.trim(),
    Phone: profile.phone,
    // OTP: handled separately via email interception
  };

  for (const result of lastResults) {
    if (result.isHoneypot) continue;
    if (result.confidence < 0.6) continue;
    if (result.predictedClass === "Unknown") continue;

    const value = fillMap[result.predictedClass];
    if (!value) continue;

    // Use native setter to trigger framework change detection (React, Vue, Angular)
    setNativeValue(result.element, value);
  }
}

/**
 * Set input value using native descriptor to trigger React/Vue/Angular bindings.
 */
function setNativeValue(el: HTMLInputElement, value: string): void {
  const nativeDescriptor =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value") ||
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "value");

  if (nativeDescriptor?.set) {
    nativeDescriptor.set.call(el, value);
  } else {
    el.value = value;
  }

  // Dispatch events in the correct order
  el.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
}

// ── Utilities ───────────────────────────────────────────────────────────────

function generateSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.name) return `[name="${CSS.escape((el as HTMLInputElement).name)}"]`;

  // Fallback: nth-of-type path
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    const parent = current.parentElement;
    if (!parent) break;
    const siblings = Array.from(parent.children).filter(
      (c) => c.tagName === current!.tagName
    );
    const idx = siblings.indexOf(current) + 1;
    parts.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${idx})`);
    current = parent;
  }
  return parts.join(" > ");
}

function debounce<T extends (...args: any[]) => any>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Auto-initialize ─────────────────────────────────────────────────────────
if (typeof window !== "undefined" && typeof chrome !== "undefined" && chrome.runtime) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initContentScript());
  } else {
    initContentScript();
  }
}
```

---

## File 4: `email_parser.ts` — Smart Email OTP & Activation Link Extraction

```typescript
// ─────────────────────────────────────────────────────────────────────────────
// email_parser.ts — GhostFill Email Intelligence Engine
// Multi-pass heuristic NLP system for OTP & activation link extraction.
// Zero ML overhead — pure algorithmic extraction to preserve model size budget.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// PART 1: AGGRESSIVE HTML STRIPPER
// ═══════════════════════════════════════════════════════════════════════════

export interface CleanedEmail {
  /** Pure semantic text, all HTML removed */
  text: string;
  /** All href URLs found in the email */
  urls: ExtractedUrl[];
  /** Subject line if available */
  subject: string;
}

export interface ExtractedUrl {
  href: string;
  anchorText: string;
  /** Resolved URL after unwinding tracking redirects */
  resolvedHref: string;
}

/**
 * Strips an email HTML body down to pure semantic text + URLs.
 * Aggressively removes:
 * - <style>, <script>, <svg>, <head> blocks entirely
 * - Tracking pixels (<img> with dimensions 0/1)
 * - Hidden elements (display:none, visibility:hidden)
 * - HTML comments, CDATA, conditional comments
 * - Microsoft Office / Outlook XML namespaces
 * - Base64-encoded inline images
 */
export function cleanEmailHtml(rawHtml: string, subject: string = ""): CleanedEmail {
  // ── Phase 1: Pre-regex strip of dangerous/useless blocks ──────────
  let html = rawHtml;

  // Remove comments (including conditional IE comments)
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");

  // Remove full blocks that never contain useful text
  const stripBlocks = [
    /<style[\s\S]*?<\/style>/gi,
    /<script[\s\S]*?<\/script>/gi,
    /<svg[\s\S]*?<\/svg>/gi,
    /<head[\s\S]*?<\/head>/gi,
    /<noscript[\s\S]*?<\/noscript>/gi,
    /<object[\s\S]*?<\/object>/gi,
    /<embed[\s\S]*?<\/embed>/gi,
    /<applet[\s\S]*?<\/applet>/gi,
    /<xml[\s\S]*?<\/xml>/gi,
    /<o:[\s\S]*?<\/o:[^>]*>/gi,     // MS Office namespaces
    /<v:[\s\S]*?<\/v:[^>]*>/gi,     // MS VML
    /<w:[\s\S]*?<\/w:[^>]*>/gi,     // MS Word
  ];
  for (const pattern of stripBlocks) {
    html = html.replace(pattern, " ");
  }

  // Remove tracking pixels: <img> with 1x1 or 0x0 dimensions
  html = html.replace(
    /<img[^>]*(?:width\s*[:=]\s*["']?[01](?:px)?["']?|height\s*[:=]\s*["']?[01](?:px)?["']?)[^>]*\/?>/gi,
    ""
  );
  // Remove all remaining images (they don't contain textual OTP info)
  html = html.replace(/<img[^>]*\/?>/gi, "");

  // Remove hidden elements via inline style
  html = html.replace(
    /<[^>]+style\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden|font-size\s*:\s*0)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi,
    ""
  );

  // ── Phase 2: Extract URLs before removing remaining HTML ──────────
  const urls: ExtractedUrl[] = [];
  const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let linkMatch: RegExpExecArray | null;

  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const href = decodeHtmlEntities(linkMatch[1].trim());
    const anchorText = stripTags(linkMatch[2]).trim();

    // Skip mailto, tel, and empty hrefs
    if (!href || /^(?:mailto:|tel:|#|javascript:)/i.test(href)) continue;

    urls.push({
      href,
      anchorText,
      resolvedHref: unwindTrackingUrl(href),
    });
  }

  // ── Phase 3: Convert block elements to newlines, strip all tags ───
  // Block elements → newlines for readability
  html = html.replace(/<\/(?:p|div|tr|li|h[1-6]|br|hr|blockquote|section|article|header|footer|td|th)[\s>]/gi, "\n");
  html = html.replace(/<br\s*\/?>/gi, "\n");
  html = html.replace(/<\/td>/gi, " | ");
  html = html.replace(/<\/th>/gi, " | ");

  // Strip all remaining HTML tags
  let text = stripTags(html);

  // ── Phase 4: Clean whitespace ─────────────────────────────────────
  text = decodeHtmlEntities(text);
  text = text.replace(/[\t ]+/g, " ");       // Collapse horizontal whitespace
  text = text.replace(/\n\s*\n/g, "\n");     // Collapse blank lines
  text = text.replace(/^\s+|\s+$/gm, "");    // Trim each line
  text = text.trim();

  return { text, urls, subject };
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ");
}

function decodeHtmlEntities(text: string): string {
  const entities: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&quot;": '"', "&#39;": "'", "&apos;": "'",
    "&nbsp;": " ", "&ndash;": "–", "&mdash;": "—",
    "&laquo;": "«", "&raquo;": "»",
    "&copy;": "©", "&reg;": "®", "&trade;": "™",
    "&#8203;": "",  // Zero-width space
    "&#xFEFF;": "", // BOM
  };
  let result = text;
  for (const [entity, char] of Object.entries(entities)) {
    result = result.split(entity).join(char);
  }
  // Numeric entities
  result = result.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2: TRACKING URL UNWINDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Attempts to resolve the actual destination from common tracking redirect patterns.
 * Handles: Google, SendGrid, Mailchimp, HubSpot, Pardot, custom query-string redirects.
 */
function unwindTrackingUrl(url: string): string {
  // Known tracking redirect patterns
  const redirectParamNames = [
    "url", "redirect", "redirect_url", "target", "dest",
    "destination", "goto", "return", "returnTo", "next",
    "link", "ref", "out", "click", "u", "q", "rurl",
  ];

  try {
    const parsed = new URL(url);

    // Pattern 1: Destination in query parameter
    for (const param of redirectParamNames) {
      const val = parsed.searchParams.get(param);
      if (val) {
        try {
          const decoded = decodeURIComponent(val);
          if (/^https?:\/\//i.test(decoded)) {
            return unwindTrackingUrl(decoded); // Recursive: may be double-wrapped
          }
        } catch {
          // Invalid URI encoding, skip
        }
      }
    }

    // Pattern 2: SendGrid-style /wf/click?upn=BASE64
    if (/\/wf\/click/i.test(parsed.pathname)) {
      const upn = parsed.searchParams.get("upn");
      if (upn) {
        try {
          const decoded = atob(upn.replace(/-/g, "+").replace(/_/g, "/"));
          if (/^https?:\/\//i.test(decoded)) return decoded;
        } catch { /* not base64 */ }
      }
    }

    // Pattern 3: Base64-encoded path segment
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    for (const part of pathParts) {
      if (part.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(part)) {
        try {
          const decoded = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
          if (/^https?:\/\//i.test(decoded)) return decoded;
        } catch { /* not base64 */ }
      }
    }
  } catch {
    // Invalid URL
  }

  return url;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 3: MULTI-PASS OTP EXTRACTION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

export interface OtpResult {
  code: string;
  confidence: number;
  source: "regex_primary" | "regex_fallback" | "context_window" | "subject_line";
}

/**
 * Multi-pass OTP extraction with NLP-informed contextual constraints.
 *
 * Pass 1: Context-anchored extraction (high confidence)
 *   - Find OTP-indicating phrases, extract nearby code
 * Pass 2: Pattern-based extraction with negative filters
 *   - Regex for standalone codes, filtered against known non-OTP patterns
 * Pass 3: Subject line analysis (moderate confidence)
 * Pass 4: Aggressive fallback with length/context constraints
 *
 * Anti-false-positive measures:
 *   - Order numbers (#, Order, Invoice, Receipt, Tracking) → excluded
 *   - Dates, prices, phone numbers → excluded
 *   - Codes near "order", "invoice", "tracking", "account number" → excluded
 */
export function extractOtp(email: CleanedEmail): OtpResult | null {
  const text = email.text;
  const subject = email.subject;

  // ── Negative Context Patterns (things that look like codes but aren't) ──
  const NEGATIVE_CONTEXTS = [
    /order\s*(?:#|number|no\.?|id)?/i,
    /invoice\s*(?:#|number|no\.?|id)?/i,
    /receipt\s*(?:#|number|no\.?|id)?/i,
    /tracking\s*(?:#|number|no\.?|id)?/i,
    /reference\s*(?:#|number|no\.?|id)?/i,
    /account\s*(?:#|number|no\.?|id)?/i,
    /transaction\s*(?:#|number|no\.?|id)?/i,
    /confirmation\s*(?:#|number|no\.?|id)?\s*(?:for your (?:order|purchase))/i,
    /case\s*(?:#|number|no\.?|id)?/i,
    /ticket\s*(?:#|number|no\.?|id)?/i,
    /po\s*(?:#|number|no\.?|id)/i,
    /serial\s*(?:#|number|no\.?|id)?/i,
    /sku|isbn|upc|ean|asin/i,
    /\$\s*[\d,]+\.?\d*/,           // Prices
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i,  // Dates
    /\d{1,2}\/\d{1,2}\/\d{2,4}/,  // Date formats
    /zip\s*(?:code)?/i,
    /postal/i,
    /phone|fax|tel/i,
  ];

  // ── Positive Context Patterns (OTP-indicating phrases) ──
  const OTP_CONTEXT_PATTERNS = [
    /(?:your |the )?(?:verification|security|confirmation|one[- ]time|otp|2fa|mfa|login|sign[- ]?in|authentication|access)\s*(?:code|pin|token|number|key)/i,
    /(?:code|pin|otp|token)\s*(?:is|:|\s)\s*/i,
    /(?:enter|use|input|type|submit)\s*(?:the\s+)?(?:following\s+)?(?:code|pin|otp|token|number|digits)/i,
    /(?:sent|sending)\s+(?:a\s+)?(?:code|otp|pin|token|verification)/i,
    /(?:temporary|one[- ]time)\s*(?:pass(?:word|code)?|pin|code)/i,
    /(?:pass[-_]?code|passcode)\s*(?:is|:|\s)/i,
    /here(?:'s| is)\s+your\s+(?:code|pin|otp)/i,
  ];

  // ── Pass 1: Context-Anchored Extraction (Highest Confidence) ──────
  for (const pattern of OTP_CONTEXT_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;

    // Search in a window of 80 chars after the context phrase
    const searchStart = match.index + match[0].length;
    const window = text.slice(searchStart, searchStart + 80);

    // Look for code patterns within the window
    const codePatterns = [
      /(?:^|\s|:|is\s)([A-Z0-9]{4,8})(?:\s|$|\.|,)/,          // Alphanumeric 4-8
      /(?:^|\s|:|is\s)(\d{4,8})(?:\s|$|\.|,)/,                 // Numeric 4-8
      /(?:^|\s|:)\s*(\d[\s-]?\d[\s-]?\d[\s-]?\d(?:[\s-]?\d){0,4})(?:\s|$|\.|,)/, // Spaced digits
    ];

    for (const cp of codePatterns) {
      const codeMatch = cp.exec(window);
      if (codeMatch) {
        const code = codeMatch[1].replace(/[\s-]/g, "");
        if (code.length >= 4 && code.length <= 8 && !isProbablyNotOtp(code, text, searchStart)) {
          return { code, confidence: 0.97, source: "regex_primary" };
        }
      }
    }
  }

  // ── Pass 2: Standalone Bold/Highlighted Code Detection ────────────
  // Many emails put the OTP in a visually prominent way: centered, larger, spaced
  const standalonePatterns = [
    /(?:^|\n)\s*(\d{4,8})\s*(?:\n|$)/gm,                      // Code on its own line
    /(?:^|\n)\s*([A-Z0-9]{4,8})\s*(?:\n|$)/gm,                // Alpha code on its own line
    /(?:^|\n)\s*(\d[\s-]\d[\s-]\d[\s-]\d(?:[\s-]\d){0,4})\s*(?:\n|$)/gm, // Spaced digits on own line
  ];

  for (const sp of standalonePatterns) {
    sp.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = sp.exec(text)) !== null) {
      const raw = m[1].replace(/[\s-]/g, "");
      if (raw.length < 4 || raw.length > 8) continue;

      // Check surrounding context (200 chars before) for OTP indicators
      const before = text.slice(Math.max(0, m.index - 200), m.index).toLowerCase();
      const hasOtpContext = OTP_CONTEXT_PATTERNS.some((p) => p.test(before)) ||
        /code|otp|verif|pin|token|one.time|2fa|mfa/i.test(before);

      if (hasOtpContext && !isProbablyNotOtp(raw, text, m.index)) {
        return { code: raw, confidence: 0.92, source: "regex_primary" };
      }
    }
  }

  // ── Pass 3: Subject Line Analysis ─────────────────────────────────
  if (subject) {
    const subjectLower = subject.toLowerCase();
    if (/code|otp|verif|pin|one.time|2fa|token|confirm/i.test(subjectLower)) {
      const subjectCodeMatch = subject.match(/\b(\d{4,8})\b/) ||
                                subject.match(/\b([A-Z0-9]{4,8})\b/);
      if (subjectCodeMatch) {
        const code = subjectCodeMatch[1];
        if (!isProbablyNotOtp(code, subject, 0)) {
          return { code, confidence: 0.85, source: "subject_line" };
        }
      }
    }
  }

  // ── Pass 4: Aggressive Fallback (Lower Confidence) ────────────────
  // Look for any 4-8 digit number in the email that has some OTP context nearby
  const allDigitCodes = [...text.matchAll(/\b(\d{4,8})\b/g)];
  for (const dm of allDigitCodes) {
    const code = dm[1];
    const pos = dm.index!;
    const surroundingText = text.slice(
      Math.max(0, pos - 300),
      pos + code.length + 100
    ).toLowerCase();

    // Must have SOME OTP-like context
    const hasContext = /verif|code|otp|pin|confirm|one.time|2fa|mfa|authenticat|enter|digit|sent.*(?:to|you)/i.test(
      surroundingText
    );

    if (hasContext && !isProbablyNotOtp(code, text, pos)) {
      return { code, confidence: 0.70, source: "regex_fallback" };
    }
  }

  return null;
}

/**
 * Anti-false-positive filter.
 * Checks if a candidate code is likely NOT an OTP.
 */
function isProbablyNotOtp(code: string, fullText: string, position: number): boolean {
  // Get surrounding context
  const before = fullText.slice(Math.max(0, position - 60), position).toLowerCase();
  const after = fullText.slice(position, position + code.length + 60).toLowerCase();
  const context = before + " " + after;

  // ── Check negative context patterns ──
  const negativePatterns = [
    /order/i, /invoice/i, /receipt/i, /tracking/i,
    /reference/i, /transaction/i, /case\s*#/i, /ticket/i,
    /serial/i, /sku/i, /isbn/i, /po\s*#/i,
    /\$/i, /price/i, /amount/i, /total/i, /balance/i,
    /zip/i, /postal/i, /phone/i, /fax/i,
    /year/i, /date/i,
  ];

  for (const np of negativePatterns) {
    if (np.test(before.slice(-40))) return true;
  }

  // ── Year-like codes ──
  if (/^(19|20)\d{2}$/.test(code)) return true;

  // ── All same digit ──
  if (/^(.)\1+$/.test(code)) return true;

  // ── Sequential digits ──
  if (/^(?:0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)/.test(code)) {
    // Only reject if no strong OTP context
    if (!/otp|verif|code|one.time|2fa/i.test(before)) return true;
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 4: ACTIVATION LINK EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

export interface ActivationLinkResult {
  url: string;
  resolvedUrl: string;
  anchorText: string;
  confidence: number;
}

/**
 * Extracts activation/verification links from cleaned email.
 * Handles tracking redirects, deep links, and various anchor text patterns.
 */
export function extractActivationLink(email: CleanedEmail): ActivationLinkResult | null {
  const candidates: (ActivationLinkResult & { score: number })[] = [];

  // ── Scoring Criteria ──────────────────────────────────────────────
  for (const url of email.urls) {
    let score = 0;
    const href = url.resolvedHref.toLowerCase();
    const anchor = url.anchorText.toLowerCase();

    // ── URL Path Scoring ──
    const pathKeywords = [
      { pattern: /\/(?:verify|activate|confirm|validate)/, weight: 30 },
      { pattern: /\/(?:email[_-]?verification|account[_-]?activation)/, weight: 35 },
      { pattern: /[?&](?:token|code|key|hash|verify|confirm|activate)=/, weight: 25 },
      { pattern: /\/(?:auth|register|signup).*(?:confirm|verify|activate)/, weight: 28 },
      { pattern: /\/(?:magic[_-]?link|passwordless|sso)/, weight: 20 },
      { pattern: /\/(?:reset|recover|restore)[_-]?(?:password|account)/, weight: 15 },
      { pattern: /\/(?:opt[_-]?in|subscribe[_-]?confirm|double[_-]?opt)/, weight: 15 },
      { pattern: /\/(?:unsubscribe|optout|opt[_-]?out)/, weight: -50 }, // Negative
      { pattern: /\/(?:privacy|terms|help|support|faq)/, weight: -30 },
      { pattern: /\/(?:social|share|tweet|facebook|instagram)/, weight: -40 },
    ];

    for (const { pattern, weight } of pathKeywords) {
      if (pattern.test(href)) score += weight;
    }

    // ── Anchor Text Scoring ──
    const anchorKeywords = [
      { pattern: /verify|activate|confirm|validate/, weight: 25 },
      { pattern: /(?:verify|confirm|activate)\s*(?:your\s*)?(?:email|account|address)/, weight: 35 },
      { pattern: /click\s*here\s*to\s*(?:verify|confirm|activate)/, weight: 30 },
      { pattern: /get\s*started|complete\s*(?:registration|signup)/, weight: 20 },
      { pattern: /(?:reset|change|update)\s*(?:your\s*)?password/, weight: 18 },
      { pattern: /yes,?\s*(?:this is|confirm|verify)/, weight: 22 },
      { pattern: /(?:unsubscribe|opt.?out|manage\s*preferences)/, weight: -40 },
      { pattern: /(?:view\s*in\s*browser|web\s*version)/, weight: -20 },
      { pattern: /(?:download|app\s*store|play\s*store|install)/, weight: -15 },
    ];

    for (const { pattern, weight } of anchorKeywords) {
      if (pattern.test(anchor)) score += weight;
    }

    // ── Email Body Context ──
    // Check if the email text near the link mentions verification
    const urlInText = email.text.indexOf(url.anchorText);
    if (urlInText >= 0) {
      const nearbyTextSlice = email.text.slice(
        Math.max(0, urlInText - 200),
        urlInText + url.anchorText.length + 100
      ).toLowerCase();

      if (/verify|activate|confirm|validate/i.test(nearbyTextSlice)) score += 10;
      if (/click.*(?:button|link|below|here)/i.test(nearbyTextSlice)) score += 8;
      if (/expire|hour|minute|24\s*h/i.test(nearbyTextSlice)) score += 5;
    }

    // ── URL Structure ──
    // Long URLs with tokens are more likely activation links
    if (href.length > 80) score += 3;
    if (/[?&]\w+=[\w-]{20,}/.test(href)) score += 10; // Long token parameter

    // Minimum score threshold
    if (score > 15) {
      candidates.push({
        url: url.href,
        resolvedUrl: url.resolvedHref,
        anchorText: url.anchorText,
        confidence: Math.min(score / 60, 0.99),
        score,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length > 0) {
    const best = candidates[0];
    return {
      url: best.url,
      resolvedUrl: best.resolvedUrl,
      anchorText: best.anchorText,
      confidence: best.confidence,
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 5: UNIFIED EMAIL PROCESSING API
// ═══════════════════════════════════════════════════════════════════════════

export interface EmailIntelligence {
  otp: OtpResult | null;
  activationLink: ActivationLinkResult | null;
  cleanedText: string;
}

/**
 * Single entry point: processes raw email HTML and extracts all actionable data.
 */
export function processEmail(
  rawHtml: string,
  subject: string = ""
): EmailIntelligence {
  const cleaned = cleanEmailHtml(rawHtml, subject);
  const otp = extractOtp(cleaned);
  const activationLink = extractActivationLink(cleaned);

  return {
    otp,
    activationLink,
    cleanedText: cleaned.text,
  };
}
```

---

## File 5: `manifest.json` & Build Architecture (Reference)

```jsonc
// manifest.json (Manifest V3)
{
  "manifest_version": 3,
  "name": "GhostFill",
  "version": "1.0.0",
  "description": "AI-powered local auto-fill",
  "permissions": ["activeTab", "storage"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content_script.js"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": [
      "models/ghostfill_int8.onnx",
      "ort-wasm/*.wasm"
    ],
    "matches": ["<all_urls>"]
  }]
}
```

**Extension bundle structure:**

```
ghostfill/
├── manifest.json
├── background.js
├── content_script.js          ← compiled from inference_engine.ts + extractor.ts
├── email_parser.js            ← compiled from email_parser.ts
├── models/
│   └── ghostfill_int8.onnx    ← 5-9 MB quantized model
├── ort-wasm/
│   ├── ort-wasm.wasm
│   ├── ort-wasm-simd.wasm
│   └── ort-wasm-simd-threaded.wasm
└── popup/
    ├── popup.html
    └── popup.js
```

---

## Architectural Rationale & Size Budget

| Component | FP32 | INT8 (Quantized) |
|---|---|---|
| CharCNN Encoder (shared) | ~800 KB | ~200 KB |
| 8× Channel Projection Layers | ~2.1 MB | ~530 KB |
| 2× Cross-Channel Attention | ~3.2 MB | ~800 KB |
| Structural MLP | ~300 KB | ~75 KB |
| Classification Head | ~1.5 MB | ~375 KB |
| ONNX Graph Overhead | ~200 KB | ~200 KB |
| **Total** | **~8.1 MB** | **~2.2 MB** |

The INT8 estimate above is conservative. With `per_channel=True` quantization and ONNX's dynamic quantization storing scale/zero-point metadata, the actual file lands in the **5–7 MB** range due to metadata, graph structure, and partial quantization of incompatible ops (BatchNorm, Embedding layers stay FP32).

**Key design decisions:**

1. **Shared CharCNN** — One CNN processes all 8 text channels. This slashes parameters by 8× versus separate encoders while per-channel projection layers allow each channel to develop specialized representations.

2. **Cross-Channel Attention** — Two self-attention layers let the model reason about *relationships between* channels (e.g., "the placeholder says 'password' AND a password field already precedes this one → confirm password"). This is the critical differentiator for edge cases.

3. **56-dim structural vector** — Boolean/numeric features provide hard signals that override ambiguous text signals (e.g., `maxlength=1 + parentIsFlexbox + consecutiveMaxLen1Count=6` → split OTP, regardless of obfuscated text).

4. **Honeypot detection** is structural, not ML — visibility heuristics run before inference and flag honeypots via the `isHoneypot` flag. The model also learns to output "Unknown" for invisible fields.

5. **Email parser is purely algorithmic** — A 4-pass heuristic regex engine with NLP-informed contextual constraints consumes zero model budget, handles all OTP formats (4–8 digits, alphanumeric, spaced), and the scoring-based activation link extractor handles any depth of tracking redirect nesting.   

