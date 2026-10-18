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
//! - **Random actions**: a triggered reaction plays one of its actions instead
//!   of its usual animation by each action's chance, rolled as the round
//!   starts. Idle and sleep play each of theirs once every so often, as one
//!   round, then loop as usual.
//! - **sleep** loops once there has been no input for the pet's sleep delay;
//!   any input wakes it.

use std::collections::HashMap;

use super::manifest::{PetManifest, PetState};

/// What the behaviour needs to know of a random action.
#[derive(Clone, Debug)]
pub struct VariantInfo {
    pub id: String,
    /// Seconds one round of it lasts.
    pub length: f64,
    /// Looping reactions: seconds between plays, a random time in the range.
    pub every: Option<(f64, f64)>,
    /// Triggered reactions: the chance it plays instead of the usual animation.
    pub chance: f64,
}

pub struct PetBehavior {
    /// Round length in seconds for each state that may be shown.
    lengths: [Option<f64>; 6],
    /// Each state's random actions.
    variants: [Vec<VariantInfo>; 6],
    /// Seconds without input before the pet sleeps, if it has a sleep state.
    sleep_after: Option<f64>,
    pub current: PetState,
    /// Bumped whenever a reaction starts, so the caller can tell a new round of
    /// the same reaction from the one already playing.
    pub round: u64,
    /// The random action the round plays, if it is one.
    pub variant: Option<String>,
    round_start: f64,
    round_length: f64,
    is_stroking: bool,
    last_key_at: f64,
    last_stroke_at: f64,
    last_activity_at: Option<f64>,
    /// When each of a looping reaction's actions is next due.
    due: HashMap<String, f64>,
    /// A number in 0..1, uniformly; replaced in tests.
    random: Box<dyn FnMut() -> f64>,
}

fn index(state: PetState) -> usize {
    PetState::ALL.iter().position(|s| *s == state).unwrap()
}

impl PetBehavior {
    pub fn new(manifest: &PetManifest) -> PetBehavior {
        let mut behavior = PetBehavior::with_lengths(|state| manifest.playable(state).map(|s| s.timeline_duration()));
        behavior.sleep_after = manifest.playable(PetState::Sleep).map(|s| s.sleep_after_minutes.unwrap_or(15.0) * 60.0);
        for state in PetState::ALL {
            let Some(spec) = manifest.playable(state) else { continue };
            behavior.variants[index(state)] = spec
                .variants
                .iter()
                .flatten()
                .map(|v| VariantInfo {
                    id: v.id.clone(),
                    length: spec.playing(v).timeline_duration(),
                    every: v.every.as_deref().and_then(|e| match e {
                        [a, b] if *a > 0.0 && a <= b => Some((*a, *b)),
                        _ => None,
                    }),
                    chance: v.chance.unwrap_or(0.0).max(0.0),
                })
                .collect();
        }
        behavior
    }

    /// `length(state)` is how long one round lasts, or `None` if the pet
    /// does not have that state.
    pub fn with_lengths(length: impl Fn(PetState) -> Option<f64>) -> PetBehavior {
        PetBehavior {
            lengths: PetState::ALL.map(length),
            variants: Default::default(),
            sleep_after: None,
            current: PetState::Idle,
            round: 0,
            variant: None,
            round_start: 0.0,
            round_length: 0.0,
            is_stroking: false,
            last_key_at: f64::NEG_INFINITY,
            last_stroke_at: f64::NEG_INFINITY,
            last_activity_at: None,
            due: HashMap::new(),
            random: Box::new(seeded_random()),
        }
    }

    pub fn tapped(&mut self, time: f64) {
        self.activity(time);
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
        self.activity(time);
        self.last_key_at = self.last_key_at.max(time);
        if self.current == PetState::Idle {
            self.start(PetState::Typing, time);
        }
    }

    pub fn mouse_clicked(&mut self, time: f64) {
        self.activity(time);
        if self.current == PetState::Idle {
            self.start(PetState::MouseClick, time);
        }
    }

    /// Any input: it puts sleep off, and wakes a sleeping pet.
    pub fn activity(&mut self, time: f64) {
        // The pet starts out idle without entering it: its actions are timed
        // from the first sign of life.
        if self.last_activity_at.is_none() && self.current == PetState::Idle {
            self.enter(PetState::Idle, time);
        }
        self.last_activity_at = Some(self.last_activity_at.map_or(time, |at| at.max(time)));
        if self.current == PetState::Sleep {
            self.enter(PetState::Idle, time);
            self.round = self.round.wrapping_add(1);
        }
    }

    /// Falls asleep if an idle pet has had no input for its sleep delay.
    pub fn check_inactivity(&mut self, time: f64) {
        if self.next_sleep_deadline(f64::NEG_INFINITY).is_some_and(|deadline| time >= deadline) {
            self.start(PetState::Sleep, time);
        }
    }

    /// When the pet falls asleep if nothing happens before then (never
    /// earlier than `time`), or `None` if it is not idle or cannot sleep.
    pub fn next_sleep_deadline(&self, time: f64) -> Option<f64> {
        if self.current != PetState::Idle {
            return None;
        }
        Some((self.last_activity_at? + self.sleep_after?).max(time))
    }

    /// When the soonest of the looping reaction's actions is due, if one
    /// can play now (the reaction is playing as usual).
    pub fn next_variant_deadline(&self, time: f64) -> Option<f64> {
        if !self.current.loops() || self.variant.is_some() {
            return None;
        }
        self.variants[index(self.current)].iter().filter_map(|v| self.due.get(&v.id)).copied().reduce(f64::min).map(|due| due.max(time))
    }

    /// Plays the looping reaction's action that is due, if one is, as one
    /// round.
    pub fn check_variants(&mut self, time: f64) {
        if !self.current.loops() || self.variant.is_some() {
            return;
        }
        let ready = self.variants[index(self.current)]
            .iter()
            .filter_map(|v| self.due.get(&v.id).map(|due| (v, *due)))
            .filter(|(_, due)| *due <= time)
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(v, _)| v.clone());
        let Some(action) = ready else { return };
        self.variant = Some(action.id);
        self.round = self.round.wrapping_add(1);
        self.round_start = time;
        self.round_length = action.length;
    }

    /// The reaction showing has played its last frame through.
    pub fn round_finished(&mut self, time: f64) {
        if self.current.loops() {
            // A looping reaction ends a round only when it was an action:
            // back to the usual loop, and the action is due again later.
            let Some(action) = self.variant.take() else { return };
            self.round = self.round.wrapping_add(1);
            if let Some(v) = self.variants[index(self.current)].iter().find(|v| v.id == action).cloned() {
                self.schedule(&v, time);
            }
            self.check_inactivity(time);
            return;
        }
        let second_half = self.round_start + self.round_length / 2.0;
        let ended = self.current;
        self.enter(PetState::Idle, time);
        if self.is_stroking && (ended != PetState::Pet || self.last_stroke_at >= second_half) {
            self.start(PetState::Pet, time);
        }
        if self.current == PetState::Idle && self.last_key_at >= second_half {
            self.start(PetState::Typing, time);
        }
        self.check_inactivity(time);
    }

    /// Begins a round of `state`, if the pet has it. A triggered reaction
    /// rolls for its random actions here.
    fn start(&mut self, state: PetState, time: f64) {
        let Some(length) = self.lengths[index(state)] else { return };
        if state.loops() {
            self.enter(state, time);
            self.round = self.round.wrapping_add(1);
            return;
        }
        self.current = state;
        self.variant = self.roll(state);
        self.round = self.round.wrapping_add(1);
        self.round_start = time;
        self.round_length = self
            .variant
            .as_ref()
            .and_then(|id| self.variants[index(state)].iter().find(|v| &v.id == id))
            .map_or(length, |v| v.length);
    }

    /// Goes to a looping reaction, playing as usual. Sleep's actions are
    /// timed from now; idle's keep the times they had.
    fn enter(&mut self, state: PetState, time: f64) {
        self.current = state;
        self.variant = None;
        self.round_start = time;
        self.round_length = self.lengths[index(state)].unwrap_or(0.0);
        for v in self.variants[index(state)].clone() {
            if state == PetState::Sleep || !self.due.contains_key(&v.id) {
                self.schedule(&v, time);
            }
        }
    }

    fn schedule(&mut self, v: &VariantInfo, time: f64) {
        match v.every {
            Some((a, b)) => {
                let due = time + a + (self.random)() * (b - a);
                self.due.insert(v.id.clone(), due);
            }
            None => {
                self.due.remove(&v.id);
            }
        }
    }

    /// One action by the chances, or none: a chance of 1 is always taken;
    /// chances adding up to more than 1 are shared out in proportion.
    fn roll(&mut self, state: PetState) -> Option<String> {
        let total: f64 = self.variants[index(state)].iter().map(|v| v.chance).sum();
        if total <= 0.0 {
            return None;
        }
        let mut draw = (self.random)() * total.max(1.0);
        for v in &self.variants[index(state)] {
            if draw < v.chance {
                return Some(v.id.clone());
            }
            draw -= v.chance;
        }
        None
    }
}

/// Uniform numbers in 0..1 (xorshift), seeded from the clock: enough for
/// when a pet stretches, with no crate for it.
pub fn seeded_random() -> impl FnMut() -> f64 {
    let mut x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0x9e37_79b9, |d| d.as_nanos() as u64) | 1;
    move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x >> 11) as f64 / (1u64 << 53) as f64
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

    /// Sleeps after 60 s without input.
    fn sleepy() -> PetBehavior {
        let mut b = behavior(&[]);
        b.sleep_after = Some(60.0);
        b
    }

    #[test]
    fn sleeps_after_the_delay_and_input_puts_it_off() {
        let mut b = sleepy();
        b.activity(0.0);
        assert_eq!(b.next_sleep_deadline(10.0), Some(60.0));
        b.check_inactivity(59.0);
        assert_eq!(b.current, Idle);
        b.mouse_clicked(30.0);
        b.round_finished(30.4);
        assert_eq!(b.next_sleep_deadline(31.0), Some(90.0));
        b.check_inactivity(60.0);
        assert_eq!(b.current, Idle, "the click put sleep off");
        b.check_inactivity(90.0);
        assert_eq!(b.current, Sleep);
        assert_eq!(b.next_sleep_deadline(91.0), None);
    }

    #[test]
    fn a_key_wakes_it_into_typing() {
        let mut b = sleepy();
        b.activity(0.0);
        b.check_inactivity(60.0);
        let round = b.round;
        b.key_pressed(100.0);
        assert_eq!(b.current, Typing);
        assert!(b.round > round);
    }

    #[test]
    fn moving_the_mouse_wakes_it_to_idle() {
        let mut b = sleepy();
        b.activity(0.0);
        b.check_inactivity(60.0);
        b.activity(70.0);
        assert_eq!(b.current, Idle);
        assert_eq!(b.next_sleep_deadline(70.0), Some(130.0));
    }

    #[test]
    fn no_sleep_without_a_sleep_state() {
        let mut b = behavior(&[]);
        b.activity(0.0);
        assert_eq!(b.next_sleep_deadline(0.0), None);
        b.check_inactivity(10_000.0);
        assert_eq!(b.current, Idle);
    }

    /// Idle with one action due every 60–120 s; typing with one at 25%.
    fn with_actions(random: f64) -> PetBehavior {
        let mut b = behavior(&[]);
        b.variants[index(Idle)] = vec![VariantInfo { id: "stretch".into(), length: 0.2, every: Some((60.0, 120.0)), chance: 0.0 }];
        b.variants[index(Typing)] = vec![VariantInfo { id: "fast".into(), length: 0.4, every: None, chance: 0.25 }];
        b.random = Box::new(move || random);
        b
    }

    #[test]
    fn idle_plays_its_action_when_due_then_loops_as_usual() {
        let mut b = with_actions(0.5);
        b.activity(0.0);
        // Typing in between keeps idle's time: 60 + 0.5 × 60 = 90 s.
        b.key_pressed(1.0);
        b.round_finished(1.4);
        assert_eq!(b.next_variant_deadline(2.0), Some(90.0));
        b.check_variants(50.0);
        assert_eq!(b.variant, None);
        let round = b.round;
        b.check_variants(90.0);
        assert_eq!(b.variant.as_deref(), Some("stretch"));
        assert!(b.round > round);
        assert_eq!(b.next_variant_deadline(91.0), None, "nothing else is due while it plays");
        b.round_finished(90.2);
        assert_eq!(b.current, Idle);
        assert_eq!(b.variant, None);
        assert_eq!(b.next_variant_deadline(91.0), Some(180.2));
    }

    #[test]
    fn a_key_cuts_an_idle_action_short() {
        let mut b = with_actions(0.0);
        b.activity(0.0);
        b.check_variants(60.0);
        assert_eq!(b.variant.as_deref(), Some("stretch"));
        b.key_pressed(60.05);
        assert_eq!(b.current, Typing);
    }

    #[test]
    fn typing_rolls_for_its_action() {
        let mut low = with_actions(0.2);
        low.key_pressed(0.0);
        assert_eq!(low.variant.as_deref(), Some("fast"), "0.2 is under the 25% chance");
        let mut high = with_actions(0.3);
        high.key_pressed(0.0);
        assert_eq!(high.variant, None);
        assert_eq!(high.current, Typing);
    }

    #[test]
    fn disabled_states_never_start() {
        let mut b = behavior(&[Typing, Tap]);
        b.key_pressed(10.0);
        b.tapped(10.0);
        assert_eq!(b.current, Idle);
    }
}
