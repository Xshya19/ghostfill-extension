use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct UrlVerificationResult {
    pub is_valid: bool,
    pub is_secure_web: bool,
    pub is_auth_link: bool,
}

#[wasm_bindgen]
pub fn analyze_activation_url_fast(url: &str) -> UrlVerificationResult {
    let lower = url.to_lowercase();
    let is_secure_web = lower.starts_with("https://") || lower.starts_with("http://");

    if !is_secure_web {
        return UrlVerificationResult {
            is_valid: false,
            is_secure_web: false,
            is_auth_link: false,
        };
    }

    let is_auth_link = lower.contains("verify")
        || lower.contains("activate")
        || lower.contains("confirm")
        || lower.contains("auth")
        || lower.contains("token=")
        || lower.contains("code=")
        || lower.contains("login")
        || lower.contains("magic");

    UrlVerificationResult {
        is_valid: true,
        is_secure_web: true,
        is_auth_link,
    }
}

#[wasm_bindgen]
pub fn extract_code_from_url_fast(url: &str) -> Option<String> {
    // 1. Query parameters
    if let Some(query_idx) = url.find('?') {
        let query = &url[query_idx + 1..];
        let end_idx = query.find('#').unwrap_or(query.len());
        let query_slice = &query[..end_idx];

        for pair in query_slice.split('&') {
            let mut parts = pair.splitn(2, '=');
            if let Some(key) = parts.next() {
                let k_lower = key.to_lowercase();
                if k_lower == "code" || k_lower == "token" || k_lower == "otp" || k_lower == "verification_code" {
                    if let Some(val) = parts.next() {
                        if (4..=12).contains(&val.len()) && val.chars().any(|c| c.is_ascii_digit()) {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
    }

    // 2. Hash fragment
    if let Some(hash_idx) = url.find('#') {
        let fragment = &url[hash_idx + 1..];
        for pair in fragment.split('&') {
            let mut parts = pair.splitn(2, '=');
            if let Some(key) = parts.next() {
                let k_lower = key.to_lowercase();
                if k_lower == "code" || k_lower == "token" || k_lower == "otp" {
                    if let Some(val) = parts.next() {
                        if (4..=12).contains(&val.len()) && val.chars().any(|c| c.is_ascii_digit()) {
                            return Some(val.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}
