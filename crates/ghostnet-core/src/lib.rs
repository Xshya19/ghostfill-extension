pub mod action;
pub mod encoder;
pub mod pointer;

use wasm_bindgen::prelude::*;
pub use action::*;
pub use encoder::*;
pub use pointer::*;

#[wasm_bindgen]
pub fn ghostnet_version() -> String {
    "GhostNet v2 (Rust/Wasm Core 0.4.0)".to_string()
}

/// SIMD / Scalar accelerated GEMM: C[seq][out] += A[seq][in] * W[out][in]
#[wasm_bindgen]
pub fn batch_linear_into(
    output: &mut [f32],
    input: &[f32],
    weight: &[f32],
    bias: Option<Vec<f32>>,
    seq_len: usize,
    in_dim: usize,
    out_dim: usize,
) {
    let bias_slice = bias.as_deref();
    for s in 0..seq_len {
        let inp_row = &input[s * in_dim..(s + 1) * in_dim];
        for o in 0..out_dim {
            let w_row = &weight[o * in_dim..(o + 1) * in_dim];
            let mut sum = 0.0f32;
            for k in 0..in_dim {
                sum += inp_row[k] * w_row[k];
            }
            if let Some(b) = bias_slice {
                sum += b[o];
            }
            output[s * out_dim + o] = sum;
        }
    }
}
