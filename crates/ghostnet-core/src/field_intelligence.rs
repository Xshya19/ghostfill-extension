use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct FieldClassificationResult {
    pub is_email: bool,
    pub is_password: bool,
    pub is_otp: bool,
    pub is_username: bool,
    pub is_hard_negative: bool,
    pub confidence: f32,
}

#[wasm_bindgen]
pub fn classify_field_features_fast(
    tag: &str,
    input_type: &str,
    name: &str,
    id: &str,
    placeholder: &str,
    aria_label: &str,
    label_text: &str,
    max_length: i32,
) -> FieldClassificationResult {
    let lower_name = name.to_lowercase();
    let lower_id = id.to_lowercase();
    let lower_ph = placeholder.to_lowercase();
    let lower_aria = aria_label.to_lowercase();
    let lower_lbl = label_text.to_lowercase();
    let t = input_type.to_lowercase();

    // Combined context
    let ctx = format!("{} {} {} {} {}", lower_name, lower_id, lower_ph, lower_aria, lower_lbl);

    // 1. Hard Negative Check (CVV, Card, ZIP, Search, Captcha)
    let is_hard_negative = ctx.contains("cvv")
        || ctx.contains("cvc")
        || ctx.contains("cardnumber")
        || ctx.contains("card-number")
        || ctx.contains("zipcode")
        || ctx.contains("postal")
        || ctx.contains("captcha")
        || t == "search";

    if is_hard_negative {
        return FieldClassificationResult {
            is_email: false,
            is_password: false,
            is_otp: false,
            is_username: false,
            is_hard_negative: true,
            confidence: 0.95,
        };
    }

    // 2. OTP Field Check
    let is_otp_keyword = ctx.contains("otp")
        || ctx.contains("passcode")
        || ctx.contains("verification")
        || ctx.contains("one-time")
        || ctx.contains("onetime")
        || ctx.contains("2fa")
        || ctx.contains("mfa")
        || ctx.contains("authcode");

    let is_otp_length = max_length >= 4 && max_length <= 8;
    let is_otp = is_otp_keyword || (is_otp_length && (ctx.contains("code") || ctx.contains("pin")));

    // 3. Password Field Check
    let is_password = t == "password" || ctx.contains("password") || ctx.contains("passwd");

    // 4. Email Field Check
    let is_email = t == "email" || ctx.contains("email") || ctx.contains("e-mail") || ctx.contains("correo");

    // 5. Username Field Check
    let is_username = !is_email && !is_password && (ctx.contains("username") || ctx.contains("user_name") || ctx.contains("login_id"));

    FieldClassificationResult {
        is_email,
        is_password,
        is_otp,
        is_username,
        is_hard_negative: false,
        confidence: 0.90,
    }
}
