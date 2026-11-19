use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PasswordStrengthResult {
    pub entropy: f64,
    pub score: f64,
    pub is_strong: bool,
}

#[wasm_bindgen]
pub fn calculate_password_strength_fast(password: &str) -> PasswordStrengthResult {
    if password.is_empty() {
        return PasswordStrengthResult { entropy: 0.0, score: 0.0, is_strong: false };
    }

    let mut has_lower = false;
    let mut has_upper = false;
    let mut has_digit = false;
    let mut has_symbol = false;

    let mut unique_chars = [0u8; 256];
    let mut unique_count = 0;

    for &b in password.as_bytes() {
        if unique_chars[b as usize] == 0 {
            unique_chars[b as usize] = 1;
            unique_count += 1;
        }
        if b.is_ascii_lowercase() {
            has_lower = true;
        } else if b.is_ascii_uppercase() {
            has_upper = true;
        } else if b.is_ascii_digit() {
            has_digit = true;
        } else {
            has_symbol = true;
        }
    }

    let mut charset_size = 0.0f64;
    if has_lower { charset_size += 26.0; }
    if has_upper { charset_size += 26.0; }
    if has_digit { charset_size += 10.0; }
    if has_symbol { charset_size += 32.0; }

    let length = password.len() as f64;
    let entropy = length * charset_size.max(1.0).log2();

    let mut score = (entropy / 128.0 * 100.0).min(100.0);

    // Diversity penalty
    let unique_ratio = (unique_count as f64) / length;
    if unique_ratio < 0.25 {
        score -= 30.0;
    } else if unique_ratio < 0.5 {
        score -= 15.0;
    }

    // Repetitive character penalty (e.g. "aaa")
    let bytes = password.as_bytes();
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i] == bytes[i + 1] && bytes[i] == bytes[i + 2] {
            score -= 10.0;
            break;
        }
    }

    // Sequential characters penalty (e.g. "abc", "123")
    for i in 0..bytes.len().saturating_sub(2) {
        if bytes[i + 1] == bytes[i] + 1 && bytes[i + 2] == bytes[i] + 2 {
            score -= 10.0;
            break;
        }
    }

    score = score.max(0.0).min(100.0);

    PasswordStrengthResult {
        entropy,
        score,
        is_strong: score >= 60.0,
    }
}
