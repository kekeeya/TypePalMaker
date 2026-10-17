//! Turns a stream of cursor positions into "a hand is stroking the pet". A port
//! of `player/Sources/TypePalCore/StrokeRecognizer.swift`, with its tuning and
//! its tests: the feel was tuned by hand and must not drift between systems.
//!
//! Hover-based on purpose: pressing and rubbing is the same input as dragging,
//! so requiring that no button is held keeps the two gestures apart.

/// Horizontal travel that counts as one pass of a hand.
pub const STROKE_TRAVEL: f64 = 8.0;
/// More than this in a single sample is the pointer being warped.
pub const MAX_SAMPLE_TRAVEL: f64 = 150.0;
/// Direction changes needed inside `STROKE_WINDOW` to start a stroke.
pub const REQUIRED_REVERSALS: usize = 2;
pub const STROKE_WINDOW: f64 = 0.9;
/// The sweep that carries the pointer onto the pet is travel, not a stroke.
pub const ENTRY_GRACE: f64 = 0.2;
/// A rubbing hand goes back and forth without getting anywhere.
pub const MAX_NET_TRAVEL_SHARE: f64 = 0.5;
/// Once stroking, it continues as long as a pass lands this often.
pub const STROKE_LAPSE: f64 = 0.7;

struct Pass {
    direction: i32,
    length: f64,
    at: f64,
}

#[derive(Default)]
pub struct StrokeRecognizer {
    pub is_stroking: bool,
    last_x: Option<f64>,
    travel: f64,
    passes: Vec<Pass>,
    last_pass_at: Option<f64>,
    on_pet_since: Option<f64>,
}

impl StrokeRecognizer {
    /// Passes still held in the sliding window, for tests.
    pub fn held_pass_count(&self) -> usize {
        self.passes.len()
    }

    /// Feeds one cursor sample. `x` is in points (logical pixels), so the
    /// tuning means the same on every display. `on_pet` is false when the
    /// cursor is not on the pet's artwork.
    pub fn track(&mut self, x: f64, on_pet: bool, time: f64) {
        if !on_pet {
            self.reset();
            return;
        }
        let last_x = self.last_x.replace(x);
        let since = *self.on_pet_since.get_or_insert(time);
        let Some(last_x) = last_x else { return };

        if time - since < ENTRY_GRACE {
            self.travel = 0.0;
            return;
        }

        let delta = x - last_x;
        if delta.abs() > MAX_SAMPLE_TRAVEL {
            self.travel = 0.0;
            return;
        }

        if self.travel == 0.0 || (delta < 0.0) == (self.travel < 0.0) {
            self.travel += delta;
        } else {
            self.travel = delta;
        }

        let mut committed = false;
        if self.travel.abs() >= STROKE_TRAVEL {
            self.passes.push(Pass { direction: if self.travel < 0.0 { -1 } else { 1 }, length: self.travel.abs(), at: time });
            self.travel = 0.0;
            self.last_pass_at = Some(time);
            committed = true;
        }
        self.evaluate(time, committed);
    }

    /// Re-evaluates without a new sample, so a hand that simply stops moving is
    /// noticed.
    pub fn settle(&mut self, time: f64) {
        self.evaluate(time, false);
    }

    pub fn reset(&mut self) {
        *self = StrokeRecognizer::default();
    }

    fn reversal_count(&self) -> usize {
        self.passes.windows(2).filter(|w| w[0].direction != w[1].direction).count()
    }

    fn is_wandering(&self) -> bool {
        let path: f64 = self.passes.iter().map(|p| p.length).sum();
        let net: f64 = self.passes.iter().map(|p| p.direction as f64 * p.length).sum::<f64>().abs();
        net <= path * MAX_NET_TRAVEL_SHARE
    }

    fn evaluate(&mut self, time: f64, committed: bool) {
        self.passes.retain(|p| time - p.at <= STROKE_WINDOW);
        if !self.is_stroking {
            // Only movement may start a stroke, never the passing of time.
            if committed && self.reversal_count() >= REQUIRED_REVERSALS && self.is_wandering() {
                self.is_stroking = true;
            }
        } else if !self.last_pass_at.is_some_and(|at| time - at <= STROKE_LAPSE) {
            self.is_stroking = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A back-and-forth rub: `passes` sweeps of `width` points, sampled every
    /// 16 ms.
    fn rub(r: &mut StrokeRecognizer, start: f64, passes: usize, width: f64) -> f64 {
        let mut t = start;
        let mut x = 100.0;
        for pass in 0..passes {
            let dir = if pass % 2 == 0 { 1.0 } else { -1.0 };
            for _ in 0..6 {
                x += dir * width / 6.0;
                t += 0.016;
                r.track(x, true, t);
            }
        }
        t
    }

    fn started() -> (StrokeRecognizer, f64) {
        let mut r = StrokeRecognizer::default();
        r.track(100.0, true, 0.0);
        r.track(100.0, true, 0.25); // settle past entry grace
        let end = rub(&mut r, 0.25, 4, 30.0);
        (r, end)
    }

    #[test]
    fn back_and_forth_starts_a_stroke() {
        assert!(started().0.is_stroking);
    }

    #[test]
    fn crossing_over_is_not_a_stroke() {
        let mut r = StrokeRecognizer::default();
        let mut t = 0.0;
        for i in 0..40 {
            t += 0.016;
            r.track(i as f64 * 6.0, true, t);
        }
        assert!(!r.is_stroking);
    }

    #[test]
    fn stroke_lapses_when_the_hand_stops() {
        let (mut r, end) = started();
        r.settle(end + STROKE_LAPSE + 0.1);
        assert!(!r.is_stroking);
    }

    #[test]
    fn leaving_the_pet_ends_the_stroke() {
        let (mut r, end) = started();
        r.track(500.0, false, end + 0.016);
        assert!(!r.is_stroking);
    }

    #[test]
    fn passes_stay_bounded() {
        let mut r = StrokeRecognizer::default();
        r.track(100.0, true, 0.0);
        let mut t = 0.25;
        for _ in 0..200 {
            t = rub(&mut r, t, 2, 30.0);
        }
        assert!(r.held_pass_count() < 40);
    }
}
