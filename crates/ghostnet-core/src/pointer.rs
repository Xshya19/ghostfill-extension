use wasm_bindgen::prelude::*;
use crate::encoder::{D_MODEL, softmax_in_place};

pub const D_POINTER: usize = 24;

const DIR_DECAY: [f32; 6] = [1.0, 0.55, 0.3025, 0.166375, 0.09150625, 0.0503284375];
const DIR_SUMS: [f32; 7] = [0.0, 1.0, 1.55, 1.8525, 2.018875, 2.11038125, 2.1607096875];

#[wasm_bindgen]
pub fn pool_directional_windows(
    h: &[f32],
    seq_len: usize,
    positions: &[usize],
    h_span_out: &mut [f32],
    h_left_out: &mut [f32],
    h_right_out: &mut [f32],
) {
    h_span_out.fill(0.0);
    h_left_out.fill(0.0);
    h_right_out.fill(0.0);

    let count = positions.len().max(1) as f32;
    let inv_count = 1.0 / count;

    for &p in positions {
        let p_off = p * D_MODEL;
        for d in 0..D_MODEL {
            h_span_out[d] += h[p_off + d] * inv_count;
        }

        let max_left = 6.min(p);
        if max_left > 0 {
            let inv_left_w = inv_count / DIR_SUMS[max_left];
            for dist in 1..=max_left {
                let s = DIR_DECAY[dist - 1] * inv_left_w;
                let off = (p - dist) * D_MODEL;
                for d in 0..D_MODEL {
                    h_left_out[d] += h[off + d] * s;
                }
            }
        }

        if seq_len > p + 1 {
            let max_right = 6.min(seq_len - 1 - p);
            if max_right > 0 {
                let inv_right_w = inv_count / DIR_SUMS[max_right];
                for dist in 1..=max_right {
                    let s = DIR_DECAY[dist - 1] * inv_right_w;
                    let off = (p + dist) * D_MODEL;
                    for d in 0..D_MODEL {
                        h_right_out[d] += h[off + d] * s;
                    }
                }
            }
        }
    }
}

#[wasm_bindgen]
pub fn cross_attend_context(
    q: &[f32],
    h: &[f32],
    seq_len: usize,
    out_ctx: &mut [f32],
    attn_scratch: &mut [f32],
) {
    let scale = 1.0 / (D_MODEL as f32).sqrt();
    for t in 0..seq_len {
        let mut dot = 0.0f32;
        let off = t * D_MODEL;
        for d in 0..D_MODEL {
            dot += q[d] * h[off + d];
        }
        attn_scratch[t] = dot * scale;
    }
    softmax_in_place(attn_scratch, seq_len, 1.0);
    out_ctx.fill(0.0);
    for t in 0..seq_len {
        let w = attn_scratch[t];
        let off = t * D_MODEL;
        for d in 0..D_MODEL {
            out_ctx[d] += w * h[off + d];
        }
    }
}

/// Set Interaction between rival candidate latents:
/// rival_buf = max_{j != i} (latent_j), diff = latent_i - rival_buf
#[wasm_bindgen]
pub fn candidate_set_interaction(
    latents: &[f32],
    k: usize,
    d_pointer: usize,
    weights: &[f32],
    bias: Option<Vec<f32>>,
    out_refined: &mut [f32],
) {
    if k <= 1 {
        out_refined[..k * d_pointer].copy_from_slice(&latents[..k * d_pointer]);
        return;
    }

    let bias_slice = bias.as_deref();
    let mut rival_buf = [0.0f32; 32]; // D_POINTER = 24

    for i in 0..k {
        let z_off = i * d_pointer;
        for d in 0..d_pointer {
            rival_buf[d] = f32::NEG_INFINITY;
        }

        for j in 0..k {
            if j == i {
                continue;
            }
            let j_off = j * d_pointer;
            for d in 0..d_pointer {
                if latents[j_off + d] > rival_buf[d] {
                    rival_buf[d] = latents[j_off + d];
                }
            }
        }

        for d in 0..d_pointer {
            rival_buf[d] = latents[z_off + d] - rival_buf[d];
        }

        // Linear layer: out = rival_buf * weight + bias, then GELU
        for o in 0..d_pointer {
            let mut sum = if let Some(b) = bias_slice { b[o] } else { 0.0 };
            let w_off = o * d_pointer;
            for d in 0..d_pointer {
                sum += rival_buf[d] * weights[w_off + d];
            }
            // GELU activation
            let gelu_val = 0.5 * sum * (1.0 + (0.79788456 * (sum + 0.044715 * sum * sum * sum)).tanh());
            out_refined[z_off + o] = latents[z_off + o] + gelu_val;
        }
    }
}
