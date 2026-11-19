use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct AntiPatternMatch {
    pub is_rejected: bool,
    pub penalty_points: i32,
}

#[wasm_bindgen]
pub fn check_anti_patterns_fast(candidate: &str, context: &str) -> AntiPatternMatch {
    // 1. Check if candidate looks like a date separator
    if candidate.contains('/') || candidate.contains('-') || candidate.contains('.') {
        if candidate.chars().filter(|c| *c == '/' || *c == '-' || *c == '.').count() >= 2 {
            return AntiPatternMatch { is_rejected: true, penalty_points: 100 };
        }
    }

    // 2. Currency prefix/suffix check
    let trimmed = context.trim();
    if trimmed.starts_with('$') || trimmed.starts_with('€') || trimmed.starts_with('£') || trimmed.starts_with('¥') || trimmed.starts_with('₹') {
        return AntiPatternMatch { is_rejected: true, penalty_points: 90 };
    }
    if trimmed.ends_with("usd") || trimmed.ends_with("eur") || trimmed.ends_with("gbp") || trimmed.ends_with("inr") {
        return AntiPatternMatch { is_rejected: true, penalty_points: 90 };
    }

    // 3. Phone number check: long sequences or paren formatting
    if candidate.len() >= 10 && candidate.chars().all(|c| c.is_ascii_digit()) {
        return AntiPatternMatch { is_rejected: true, penalty_points: 95 };
    }

    // 4. Year check (1900-2099): soft penalty, not hard reject
    if candidate.len() == 4 && (candidate.starts_with("19") || candidate.starts_with("20")) {
        return AntiPatternMatch { is_rejected: false, penalty_points: 25 };
    }

    // 5. Monotonic / trivial sequence check
    let ascending = ["0123", "1234", "2345", "3456", "4567", "5678", "6789"];
    for seq in ascending {
        if candidate.starts_with(seq) {
            return AntiPatternMatch { is_rejected: true, penalty_points: 80 };
        }
    }
    let descending = ["9876", "8765", "7654", "6543", "5432", "4321", "3210"];
    for seq in descending {
        if candidate.starts_with(seq) {
            return AntiPatternMatch { is_rejected: true, penalty_points: 80 };
        }
    }

    // Clean code candidate
    AntiPatternMatch { is_rejected: false, penalty_points: 0 }
}
