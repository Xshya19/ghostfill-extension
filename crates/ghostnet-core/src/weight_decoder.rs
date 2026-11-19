use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn dequantize_int8_matrix_fast(
    q_weights: &[i8],
    scales: &[f32],
    rows: usize,
    cols: usize,
    out: &mut [f32],
) {
    for r in 0..rows {
        let scale = if r < scales.len() { scales[r] } else { 0.0 };
        let off = r * cols;
        for c in 0..cols {
            out[off + c] = (q_weights[off + c] as f32) * scale;
        }
    }
}

#[wasm_bindgen]
pub fn decode_float32_bytes_into(raw_bytes: &[u8], out: &mut [f32]) {
    let float_count = raw_bytes.len() / 4;
    for i in 0..float_count {
        let b = [
            raw_bytes[i * 4],
            raw_bytes[i * 4 + 1],
            raw_bytes[i * 4 + 2],
            raw_bytes[i * 4 + 3],
        ];
        out[i] = f32::from_le_bytes(b);
    }
}
