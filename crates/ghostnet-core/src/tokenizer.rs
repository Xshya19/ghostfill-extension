use wasm_bindgen::prelude::*;

pub const V_VOCAB: usize = 1536;
pub const B_CHAR: usize = 768;
pub const B_CODE_CHAR: usize = 256;

pub const TOK_PAD: u16 = 0;
pub const TOK_CLS: u16 = 1;
pub const TOK_UNK: u16 = 2;
pub const TOK_NUM4: u16 = 3;
pub const TOK_NUM5: u16 = 4;
pub const TOK_NUM6: u16 = 5;
pub const TOK_NUM7_8: u16 = 6;
pub const TOK_NUM_LONG: u16 = 7;
pub const TOK_ALNUM_TOK: u16 = 8;
pub const TOK_PRICE: u16 = 9;

#[inline(always)]
#[wasm_bindgen]
pub fn fnv1a_hash(s: &str, seed: Option<u32>) -> u32 {
    let mut h = seed.unwrap_or(2166136261);
    for b in s.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

#[wasm_bindgen]
pub fn shannon_entropy(s: &str) -> f32 {
    let len = s.len();
    if len <= 1 {
        return 0.0;
    }
    let bytes = s.as_bytes();
    let mut ent = 0.0f32;
    for i in 0..len {
        let b = bytes[i];
        let mut seen = false;
        for j in 0..i {
            if bytes[j] == b {
                seen = true;
                break;
            }
        }
        if seen {
            continue;
        }
        let mut count = 1;
        for j in (i + 1)..len {
            if bytes[j] == b {
                count += 1;
            }
        }
        let p = (count as f32) / (len as f32);
        ent -= p * p.log2();
    }
    ent
}

#[wasm_bindgen]
pub fn char_3gram_buckets(tok: &str) -> Vec<u16> {
    let padded = format!("<{}>", tok);
    let bytes = padded.as_bytes();
    if bytes.len() <= 3 {
        let b0 = (V_VOCAB as u32) + (fnv1a_hash(&padded, Some(0x9e3779b1)) % (B_CHAR as u32));
        return vec![b0 as u16, b0 as u16, b0 as u16];
    }
    let len = bytes.len() - 2;
    let step = 1.max(len / 3);
    let b0 = (V_VOCAB as u32) + (fnv1a_hash(&padded[..3], Some(0x9e3779b1)) % (B_CHAR as u32));
    let s1 = (len - 1).min(step);
    let b1 = (V_VOCAB as u32) + (fnv1a_hash(&padded[s1..s1 + 3], Some(0x9e3779b1)) % (B_CHAR as u32));
    let s2 = (len - 1).min(step * 2);
    let b2 = (V_VOCAB as u32) + (fnv1a_hash(&padded[s2..s2 + 3], Some(0x9e3779b1)) % (B_CHAR as u32));
    vec![b0 as u16, b1 as u16, b2 as u16]
}

#[wasm_bindgen]
pub fn extract_code_morph_char_ids(code: &str) -> Vec<u16> {
    let lowered = code.to_lowercase();
    let s = format!("<{}>", lowered);
    let h = |sub: &str| -> u16 {
        (fnv1a_hash(sub, Some(0x811c9dc5)) % (B_CODE_CHAR as u32)) as u16
    };
    let g0 = h(&s[..s.len().min(3)]);
    let s_start = 1.min(s.len().saturating_sub(1));
    let s_end = s.len().min(4);
    let g1 = h(&s[s_start..s_end]);
    let g2_start = s.len().saturating_sub(3);
    let g2 = h(&s[g2_start..]);
    let is_numeric = code.chars().all(|c| c.is_ascii_digit());
    let type_char = if is_numeric { 'D' } else { 'A' };
    let meta_str = format!("{}:{}", code.len(), type_char);
    let g3 = h(&meta_str);
    vec![g0, g1, g2, g3]
}
