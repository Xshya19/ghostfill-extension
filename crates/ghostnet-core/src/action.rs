use wasm_bindgen::prelude::*;
use crate::encoder::D_MODEL;
use crate::pointer::D_POINTER;

pub const D_ACTION_IN: usize = D_MODEL + D_POINTER * 2 + 16 + 16 + 4; // 116

#[wasm_bindgen]
pub fn score_candidates_and_aggregate(
    refined_latents: &[f32],
    k: usize,
    d_pointer: usize,
    score_weights: &[f32],
    score_bias: Option<Vec<f32>>,
    null_latent: &[f32],
    null_score_weights: &[f32],
    null_score_bias: Option<Vec<f32>>,
    temperature: f32,
    probs_out: &mut [f32],
    win_latent_out: &mut [f32],
) -> f32 {
    let s_bias = score_bias.as_deref().map(|b| b[0]).unwrap_or(0.0);
    for i in 0..k {
        let z_off = i * d_pointer;
        let mut sc = s_bias;
        for d in 0..d_pointer {
            sc += score_weights[d] * refined_latents[z_off + d];
        }
        probs_out[i] = sc;
    }

    let n_bias = null_score_bias.as_deref().map(|b| b[0]).unwrap_or(0.0);
    let mut null_logit = n_bias;
    for d in 0..d_pointer {
        null_logit += null_score_weights[d] * null_latent[d];
    }
    probs_out[k] = null_logit;

    crate::encoder::softmax_in_place(probs_out, k + 1, temperature);

    win_latent_out.fill(0.0);
    for i in 0..k {
        let p = probs_out[i];
        let z_off = i * d_pointer;
        for d in 0..d_pointer {
            win_latent_out[d] += p * refined_latents[z_off + d];
        }
    }

    probs_out[k] // return null_prob
}

#[wasm_bindgen]
pub fn assemble_action_feature_vector(
    z_doc: &[f32],
    z_otp_win: &[f32],
    z_link_win: &[f32],
    otp_geom: Option<Vec<f32>>,
    link_geom: Option<Vec<f32>>,
    scalar_features: &[f32], // [best_otp_p, null_otp_p, best_link_p, null_link_p]
    out: &mut [f32],
) {
    let mut off = 0;

    // 1. z_doc (32)
    out[off..off + D_MODEL].copy_from_slice(&z_doc[..D_MODEL]);
    off += D_MODEL;

    // 2. z_otp_win (24)
    out[off..off + D_POINTER].copy_from_slice(&z_otp_win[..D_POINTER]);
    off += D_POINTER;

    // 3. z_link_win (24)
    out[off..off + D_POINTER].copy_from_slice(&z_link_win[..D_POINTER]);
    off += D_POINTER;

    // 4. otp_geom (16)
    if let Some(og) = otp_geom {
        out[off..off + 16].copy_from_slice(&og[..16]);
    } else {
        out[off..off + 16].fill(0.0);
    }
    off += 16;

    // 5. link_geom (16)
    if let Some(lg) = link_geom {
        out[off..off + 16].copy_from_slice(&lg[..16]);
    } else {
        out[off..off + 16].fill(0.0);
    }
    off += 16;

    // 6. scalar_features (4)
    out[off..off + 4].copy_from_slice(&scalar_features[..4]);
}
