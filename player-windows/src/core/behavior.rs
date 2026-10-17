//! Which reaction the pet shows, from what has happened. A line-for-line port
//! of `player/Sources/TypePalCore/PetBehavior.swift`, so a pet behaves the same
//! on both systems; the tests are the macOS ones.
//!
//! Every reaction but idle plays its frames once per trigger:
//! - **tap** and **pet** are touches, and cut in on anything else. A tap
//!   during a tap is ignored.
//! - **typing** and **mouseClick** only start from idle.
//! - When a round ends, a reaction still going on plays another: typing if a
//!   key came in the round's second half, petting if the hand kept moving.
//! - **idle** loops whenever nothing else is playing.

use super::manifest::{PetManifest, PetState};

pub struct PetBehavior {
    /// Round length in seconds for each state that may be shown.
    lengths: [Option<f64>; 5],
    pub current: PetState,
    /// Bumped whenever a reaction starts, so the caller can tell a new round of
    /// the same reaction from the one already playing.
    pub round: u64,
    round_start: f64,
    round_length: f64,
    is_stroking: bool,
    last_key_at: f64,
    last_stroke_at: f64,
}

fn index(state: PetState) -> usize {
    PetState::ALL.iter().position(|s| *s == state).unwrap()
}

impl PetBehavior {
    pub fn new(manifest: &PetManifest) -> PetBehavior {
        PetBehavior::with_lengths(|state| manifest.playable(state).map(|s| s.durations().iter().sum()))
    }

    /// `length(state)` is how long one round lasts, or `None` if the pet
    /// does not have that state.
    pub fn with_lengths(length: impl Fn(PetState) -> Option<f64>) -> PetBehavior {
        PetBehavior {
            lengths: PetState::ALL.map(length),
            current: PetState::Idle,
            round: 0,
            round_start: 0.0,
            round_length: 0.0,
            is_stroking: false,
            last_key_at: f64::NEG_INFINITY,
            last_stroke_at: f64::NEG_INFINITY,
        }
    }

    pub fn tapped(&mut self, time: f64) {
        if self.current != PetState::Tap {
            self.start(PetState::Tap, time);
        }
    }

    /// Fed on every pointer move: whether the pet is being stroked right now.
    pub fn set_stroking(&mut self, stroking: bool, time: f64) {
        self.is_stroking = stroking;
        if !stroking {
            return;
        }
        self.last_stroke_at = self.last_stroke_at.max(time);
        if self.current != PetState::Tap && self.current != PetState::Pet {
            self.start(PetState::Pet, time);
        }
    }

    pub fn key_pressed(&mut self, time: f64) {
        self.last_key_at = self.last_key_at.max(time);
        if self.current == PetState::Idle {
            self.start(PetState::Typing, time);
        }
    }

    pub fn mouse_clicked(&mut self, time: f64) {
        if self.current == PetState::Idle {
            self.start(PetState::MouseClick, time);
        }
    }

    /// The reaction showing has played its last frame through.
    pub fn round_finished(&mut self, time: f64) {
        if self.current == PetState::Idle {
            return;
        }
        let second_half = self.round_start + self.round_length / 2.0;
        let ended = self.current;
        self.current = PetState::Idle;
        if self.is_stroking && (ended != PetState::Pet || self.last_stroke_at >= second_half) {
            self.start(PetState::Pet, time);
        }
        if self.current == PetState::Idle && self.last_key_at >= second_half {
            self.start(PetState::Typing, time);
        }
    }

    /// Begins a round of `state`, if the pet has it.
    fn start(&mut self, state: PetState, time: f64) {
        let Some(length) = self.lengths[index(state)] else { return };
        self.current = state;
        self.round = self.round.wrapping_add(1);
        self.round_start = time;
        self.round_length = length;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use PetState::*;

    /// Four frames at 10 fps: every round lasts 0.4 s, its second half
    /// starting 0.2 s in.
    fn behavior(disabled: &[PetState]) -> PetBehavior {
        let disabled = disabled.to_vec();
        PetBehavior::with_lengths(move |s| if disabled.contains(&s) { None } else { Some(0.4) })
    }

    #[test]
    fn idle_by_default() {
        assert_eq!(behavior(&[]).current, Idle);
    }

    #[test]
    fn a_key_plays_typing_once_then_idle() {
        let mut b = behavior(&[]);
        b.key_pressed(10.0);
        assert_eq!(b.current, Typing);
        b.round_finished(10.4);
        assert_eq!(b.current, Idle);
    }

    #[test]
    fn keys_in_the_second_half_play_another_round() {
        let mut b = behavior(&[]);
        b.key_pressed(10.0);
        let first = b.round;
        b.key_pressed(10.3);
        assert_eq!(b.round, first, "a key mid-round does not restart it");
        b.round_finished(10.4);
        assert_eq!(b.current, Typing);
        assert_eq!(b.round, first + 1);
        b.round_finished(10.8);
        assert_eq!(b.current, Idle);
    }

    #[test]
    fn keys_in_the_first_half_are_answered_by_this_round() {
        let mut b = behavior(&[]);
        b.key_pressed(10.0);
        b.key_pressed(10.1);
        b.round_finished(10.4);
        assert_eq!(b.current, Idle);
    }

    #[test]
    fn clicks_during_a_click_are_ignored() {
        let mut b = behavior(&[]);
        b.mouse_clicked(10.0);
        let round = b.round;
        b.mouse_clicked(10.1);
        b.mouse_clicked(10.35);
        assert_eq!(b.round, round);
        b.round_finished(10.4);
        assert_eq!(b.current, Idle);
    }

    #[test]
    fn typing_and_clicking_do_not_cut_each_other_off() {
        let mut b = behavior(&[]);
        b.key_pressed(10.0);
        b.mouse_clicked(10.1);
        assert_eq!(b.current, Typing);
        b.round_finished(10.4);
        assert_eq!(b.current, Idle);

        b.mouse_clicked(11.0);
        b.key_pressed(11.3);
        assert_eq!(b.current, MouseClick);
        // The key came in the click's second half, so typing follows.
        b.round_finished(11.4);
        assert_eq!(b.current, Typing);
    }

    #[test]
    fn touches_cut_in_and_a_tap_is_not_restarted() {
        let mut b = behavior(&[]);
        b.key_pressed(10.0);
        b.set_stroking(true, 10.1);
        assert_eq!(b.current, Pet);
        b.tapped(10.2);
        assert_eq!(b.current, Tap);
        let round = b.round;
        b.tapped(10.3);
        b.set_stroking(true, 10.35);
        assert_eq!(b.round, round, "neither a tap nor stroking restarts a tap");
        // Still being stroked when the tap ends: back to petting.
        b.round_finished(10.6);
        assert_eq!(b.current, Pet);
    }

    #[test]
    fn petting_goes_on_while_the_hand_keeps_moving() {
        let mut b = behavior(&[]);
        b.set_stroking(true, 10.0);
        b.set_stroking(true, 10.3);
        b.round_finished(10.4);
        assert_eq!(b.current, Pet);
        b.set_stroking(false, 10.5);
        b.round_finished(10.8);
        assert_eq!(b.current, Idle);
    }

    #[test]
    fn disabled_states_never_start() {
        let mut b = behavior(&[Typing, Tap]);
        b.key_pressed(10.0);
        b.tapped(10.0);
        assert_eq!(b.current, Idle);
    }
}
