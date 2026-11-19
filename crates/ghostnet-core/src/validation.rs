use wasm_bindgen::prelude::*;

const PROMO_KEYWORDS: &[&str] = &[
    "promo", "coupon", "discount", "voucher", "referral", "checkout", "% off", "%off"
];

fn has_promo_context(text: &str) -> bool {
    let lower = text.to_lowercase();
    for kw in PROMO_KEYWORDS {
        if lower.contains(kw) {
            return true;
        }
    }
    false
}

fn is_trivial_sequence(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.len() >= 4 {
        // Repeated single digit (e.g. 0000, 1111)
        if bytes.iter().all(|&b| b == bytes[0]) {
            return true;
        }
    }
    // Monotonic sequences
    let ascending = ["0123", "1234", "2345", "3456", "4567", "5678", "6789"];
    for seq in ascending {
        if s.starts_with(seq) {
            return true;
        }
    }
    let descending = ["9876", "8765", "7654", "6543", "5432", "4321", "3210"];
    for seq in descending {
        if s.starts_with(seq) {
            return true;
        }
    }
    false
}

#[wasm_bindgen]
pub fn is_valid_explicit_code(candidate: &str, context: &str) -> bool {
    if !candidate.chars().any(|c| c.is_ascii_digit()) {
        return false;
    }
    let has_letters = candidate.chars().any(|c| c.is_ascii_alphabetic());
    if has_letters {
        let has_upper = candidate.chars().any(|c| c.is_ascii_uppercase());
        let digit_count = candidate.chars().filter(|c| c.is_ascii_digit()).count();
        if !has_upper && digit_count < 2 {
            return false;
        }
    } else if candidate.len() > 8 || candidate.len() < 4 {
        return false;
    }

    if is_trivial_sequence(candidate) {
        return false;
    }

    if has_promo_context(context) {
        return false;
    }

    true
}

#[wasm_bindgen]
pub fn is_subject_domain_token(code: &str, subject: &str) -> bool {
    if !code.chars().any(|c| c.is_ascii_alphabetic()) || subject.is_empty() {
        return false;
    }
    let code_lower = code.to_lowercase();
    let subj_lower = subject.to_lowercase();
    let pattern = format!("{}.", code_lower);
    if let Some(pos) = subj_lower.find(&pattern) {
        let after = &subj_lower[pos + pattern.len()..];
        if after.chars().take(2).all(|c| c.is_ascii_alphabetic()) {
            return true;
        }
    }
    false
}
