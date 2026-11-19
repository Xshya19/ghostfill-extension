use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct NetworkResponseClassification {
    pub is_retryable: bool,
    pub is_auth_failure: bool,
    pub is_rate_limited: bool,
    pub is_not_found: bool,
    pub should_failover: bool,
}

#[wasm_bindgen]
pub fn classify_http_network_response_fast(status_code: u16, error_message: &str) -> NetworkResponseClassification {
    let lower_msg = error_message.to_lowercase();

    // 1. Not Found (404) -> Normal empty inbox or missing message (not retryable failure)
    let is_not_found = status_code == 404 || lower_msg.contains("not found");

    // 2. Rate Limited (429) -> Too many requests, circuit breaker must throttle
    let is_rate_limited = status_code == 429
        || lower_msg.contains("429")
        || lower_msg.contains("rate limit")
        || lower_msg.contains("too many requests");

    // 3. Auth Failure (401, 403, 419) -> Token expired or credential mismatch
    let is_auth_failure = status_code == 401
        || status_code == 403
        || status_code == 419
        || lower_msg.contains("unauthorized")
        || lower_msg.contains("forbidden")
        || lower_msg.contains("jwt")
        || lower_msg.contains("token expired");

    // 4. Server Error (5xx) or Network Drops
    let is_server_error = (500..=599).contains(&status_code);
    let is_network_drop = lower_msg.contains("failed to fetch")
        || lower_msg.contains("fetch failed")
        || lower_msg.contains("network error")
        || lower_msg.contains("networkerror")
        || lower_msg.contains("timeout")
        || lower_msg.contains("timed out")
        || lower_msg.contains("aborted");

    let is_retryable = (is_server_error || is_rate_limited || is_network_drop) && !is_not_found;
    let should_failover = is_server_error || is_auth_failure || is_network_drop;

    NetworkResponseClassification {
        is_retryable,
        is_auth_failure,
        is_rate_limited,
        is_not_found,
        should_failover,
    }
}

#[wasm_bindgen]
pub fn validate_inbox_payload_shape_fast(json_text: &str) -> bool {
    let trimmed = json_text.trim();
    if trimmed.is_empty() {
        return false;
    }
    // Bare array: [...]
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return true;
    }
    // JSON object: must have standard inbox keys
    if trimmed.starts_with('{') && trimmed.ends_with('}') {
        let has_known_inbox_key = trimmed.contains("\"messages\"")
            || trimmed.contains("\"hydra:member\"")
            || trimmed.contains("\"emails\"")
            || trimmed.contains("\"data\"")
            || trimmed.contains("\"inbox\"")
            || trimmed.contains("\"mail\"")
            || trimmed.contains("\"result\"");
        return has_known_inbox_key;
    }
    false
}
