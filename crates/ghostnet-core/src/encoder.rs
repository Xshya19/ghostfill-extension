use wasm_bindgen::prelude::*;

pub const D_MODEL: usize = 32;
pub const N_HEADS: usize = 4;
pub const D_HEAD: usize = 8;
pub const D_FFN: usize = 48;

#[inline(always)]
pub fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

#[inline(always)]
pub fn gelu_approx(x: f32) -> f32 {
    0.5 * x * (1.0 + (0.79788456 * (x + 0.044715 * x * x * x)).tanh())
}

#[wasm_bindgen]
pub fn rms_norm_residual_into(
    res_a: &[f32],
    res_a_off: usize,
    res_b: &[f32],
    res_b_off: usize,
    gamma: &[f32],
    out: &mut [f32],
    out_off: usize,
    dim: usize,
) {
    let mut sq = 0.0f32;
    for d in 0..dim {
        let v = res_a[res_a_off + d] + res_b[res_b_off + d];
        out[out_off + d] = v;
        sq += v * v;
    }
    let inv_rms = 1.0 / (sq / (dim as f32) + 1e-5).sqrt();
    for d in 0..dim {
        let g = if d < gamma.len() { gamma[d] } else { 1.0 };
        out[out_off + d] = out[out_off + d] * inv_rms * g;
    }
}

#[wasm_bindgen]
pub fn softmax_in_place(arr: &mut [f32], len: usize, temperature: f32) {
    let t = temperature.max(0.1);
    let mut max_v = f32::NEG_INFINITY;
    for i in 0..len {
        let s = arr[i] / t;
        if s > max_v {
            max_v = s;
        }
    }
    let mut sum = 0.0f32;
    for i in 0..len {
        let e = (arr[i] / t - max_v).exp();
        arr[i] = e;
        sum += e;
    }
    let inv = if sum > 0.0 { 1.0 / sum } else { 1.0 };
    for i in 0..len {
        arr[i] *= inv;
    }
}

/// Bi-directional multi-scale depthwise convolution (k=3 and dilated k=5)
#[wasm_bindgen]
pub fn depthwise_conv_into(
    e: &[f32],
    dw_k3: &[f32],
    dw_k5_dil2: &[f32],
    out: &mut [f32],
    seq_len: usize,
) {
    out[..seq_len * D_MODEL * 2].fill(0.0);
    for t in 0..seq_len {
        let c_off = t * D_MODEL * 2;
        // Kernel 3: k in -1..=1
        for k in -1..=1 {
            let pos = (t as isize) + k;
            if pos < 0 || pos >= (seq_len as isize) {
                continue;
            }
            let w_off = ((k + 1) as usize) * D_MODEL;
            let e_off = (pos as usize) * D_MODEL;
            for d in 0..D_MODEL {
                out[c_off + d] += dw_k3[w_off + d] * e[e_off + d];
            }
        }
        // Kernel 5 dilated (dilation = 2): k in 0..5
        for k in 0..5 {
            let pos = (t as isize) + (k - 2) * 2;
            if pos < 0 || pos >= (seq_len as isize) {
                continue;
            }
            let w_off = (k as usize) * D_MODEL;
            let e_off = (pos as usize) * D_MODEL;
            let c2_off = c_off + D_MODEL;
            for d in 0..D_MODEL {
                out[c2_off + d] += dw_k5_dil2[w_off + d] * e[e_off + d];
            }
        }
    }
}

/// Pointwise Gated Linear Unit (GLU) + Residual RMSNorm
#[wasm_bindgen]
pub fn pointwise_glu_residual_norm(
    e: &[f32],
    glu_raw: &[f32],
    norm1_gamma: &[f32],
    x1_out: &mut [f32],
    seq_len: usize,
) {
    for t in 0..seq_len {
        let mut sq = 0.0f32;
        let x_off = t * D_MODEL;
        let g_off = t * D_MODEL * 2;
        for d in 0..D_MODEL {
            let v = e[x_off + d] + glu_raw[g_off + d] * sigmoid(glu_raw[g_off + D_MODEL + d]);
            x1_out[x_off + d] = v;
            sq += v * v;
        }
        let inv_rms = 1.0 / (sq / (D_MODEL as f32) + 1e-5).sqrt();
        for d in 0..D_MODEL {
            let g = if d < norm1_gamma.len() { norm1_gamma[d] } else { 1.0 };
            x1_out[x_off + d] = x1_out[x_off + d] * inv_rms * g;
        }
    }
}

/// 4-Head Self-Attention with relative position bias
#[wasm_bindgen]
pub fn multi_head_attention_into(
    qkv: &[f32],
    rel_pos_bias: &[f32],
    attn_out: &mut [f32],
    seq_len: usize,
) {
    let head_scale = 1.0 / (D_HEAD as f32).sqrt();
    let mut scores = [0.0f32; 48]; // max seq_len = 48

    attn_out[..seq_len * D_MODEL].fill(0.0);

    for t in 0..seq_len {
        let t_qkv_off = t * D_MODEL * 3;
        let t_attn_off = t * D_MODEL;

        for h in 0..N_HEADS {
            let h_off = h * D_HEAD;
            let q_base = t_qkv_off + h_off;
            let q0 = qkv[q_base];
            let q1 = qkv[q_base + 1];
            let q2 = qkv[q_base + 2];
            let q3 = qkv[q_base + 3];
            let q4 = qkv[q_base + 4];
            let q5 = qkv[q_base + 5];
            let q6 = qkv[q_base + 6];
            let q7 = qkv[q_base + 7];
            let bias_base = h * 15;

            for s in 0..seq_len {
                let k_base = s * D_MODEL * 3 + D_MODEL + h_off;
                let dot = q0 * qkv[k_base]
                    + q1 * qkv[k_base + 1]
                    + q2 * qkv[k_base + 2]
                    + q3 * qkv[k_base + 3]
                    + q4 * qkv[k_base + 4]
                    + q5 * qkv[k_base + 5]
                    + q6 * qkv[k_base + 6]
                    + q7 * qkv[k_base + 7];
                let diff = (s as isize) - (t as isize);
                let rel = ((diff.max(-7).min(7) + 7) as usize);
                scores[s] = dot * head_scale + rel_pos_bias[bias_base + rel];
            }

            softmax_in_place(&mut scores, seq_len, 1.0);

            let mut o0 = 0.0f32;
            let mut o1 = 0.0f32;
            let mut o2 = 0.0f32;
            let mut o3 = 0.0f32;
            let mut o4 = 0.0f32;
            let mut o5 = 0.0f32;
            let mut o6 = 0.0f32;
            let mut o7 = 0.0f32;

            for s in 0..seq_len {
                let w = scores[s];
                let v_base = s * D_MODEL * 3 + D_MODEL * 2 + h_off;
                o0 += w * qkv[v_base];
                o1 += w * qkv[v_base + 1];
                o2 += w * qkv[v_base + 2];
                o3 += w * qkv[v_base + 3];
                o4 += w * qkv[v_base + 4];
                o5 += w * qkv[v_base + 5];
                o6 += w * qkv[v_base + 6];
                o7 += w * qkv[v_base + 7];
            }

            let out_off = t_attn_off + h_off;
            attn_out[out_off] = o0;
            attn_out[out_off + 1] = o1;
            attn_out[out_off + 2] = o2;
            attn_out[out_off + 3] = o3;
            attn_out[out_off + 4] = o4;
            attn_out[out_off + 5] = o5;
            attn_out[out_off + 6] = o6;
            attn_out[out_off + 7] = o7;
        }
    }
}
