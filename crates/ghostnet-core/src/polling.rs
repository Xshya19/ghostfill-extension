use wasm_bindgen::prelude::*;

#[wasm_bindgen]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed = 0,
    Open = 1,
    HalfOpen = 2,
}

#[wasm_bindgen]
pub struct AdaptivePollingCore {
    state: CircuitState,
    consecutive_failures: u32,
    consecutive_successes: u32,
    last_failure_time: f64,
    next_retry_time: f64,
    request_timestamps: Vec<f64>,
}

#[wasm_bindgen]
impl AdaptivePollingCore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: CircuitState::Closed,
            consecutive_failures: 0,
            consecutive_successes: 0,
            last_failure_time: 0.0,
            next_retry_time: 0.0,
            request_timestamps: Vec::with_capacity(64),
        }
    }

    pub fn allows_request(&mut self, now: f64) -> bool {
        match self.state {
            CircuitState::Closed => true,
            CircuitState::Open => {
                if now >= self.next_retry_time {
                    self.state = CircuitState::HalfOpen;
                    self.consecutive_successes = 0;
                    true
                } else {
                    false
                }
            }
            CircuitState::HalfOpen => true,
        }
    }

    pub fn record_success(&mut self) {
        self.consecutive_failures = 0;
        self.consecutive_successes += 1;
        if self.state != CircuitState::Closed {
            self.state = CircuitState::Closed;
        }
    }

    pub fn record_failure(&mut self, is_auth_error: bool, now: f64) -> f64 {
        if is_auth_error {
            return 0.0;
        }
        self.consecutive_successes = 0;
        self.consecutive_failures += 1;
        self.last_failure_time = now;

        if self.consecutive_failures >= 3 {
            self.state = CircuitState::Open;
            let exponent = (self.consecutive_failures - 3).min(5);
            let backoff = (3000.0 * 2.0f64.powi(exponent as i32)).min(60000.0);
            self.next_retry_time = now + backoff;
            backoff
        } else {
            0.0
        }
    }

    pub fn is_rate_limited(&mut self, now: f64, window_ms: f64, max_per_window: usize) -> bool {
        let cutoff = now - window_ms;
        self.request_timestamps.retain(|&t| t > cutoff);
        self.request_timestamps.len() >= max_per_window
    }

    pub fn record_request(&mut self, now: f64) {
        self.request_timestamps.push(now);
    }

    pub fn reset(&mut self) {
        self.state = CircuitState::Closed;
        self.consecutive_failures = 0;
        self.consecutive_successes = 0;
        self.last_failure_time = 0.0;
        self.next_retry_time = 0.0;
        self.request_timestamps.clear();
    }

    pub fn current_state(&self) -> CircuitState {
        self.state
    }

    pub fn failures(&self) -> u32 {
        self.consecutive_failures
    }
}
