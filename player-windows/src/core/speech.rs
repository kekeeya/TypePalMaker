//! What the pet says, and when. A port of
//! `player/Sources/TypePalCore/PetSpeech.swift`: one bubble at a time, on
//! screen for a while that grows with the line. A new line takes the place of
//! the one up at once, so a click is answered right away. A pool does not
//! give the same line twice running.

use super::manifest::{PetState, StateSpec, StateVariant};

pub struct PetSpeech {
    last_line: Option<String>,
    /// A number in 0..1, uniformly; replaced in tests.
    random: Box<dyn FnMut() -> f64>,
}

impl PetSpeech {
    pub fn new(random: impl FnMut() -> f64 + 'static) -> PetSpeech {
        PetSpeech { last_line: None, random: Box::new(random) }
    }

    /// Seconds a line stays up: longer for longer lines, 2.5 to 6.
    pub fn duration(line: &str) -> f64 {
        (1.6 + 0.16 * line.chars().count() as f64).clamp(2.5, 6.0)
    }

    /// The lines a round may say: an action its own; the usual animation of
    /// a triggered reaction its reaction's. Idle and sleep say something only
    /// in their random actions.
    pub fn pool(state: PetState, spec: &StateSpec, variant: Option<&StateVariant>) -> Vec<String> {
        if let Some(v) = variant {
            return v.lines.clone().unwrap_or_default();
        }
        if state.loops() { Vec::new() } else { spec.lines.clone().unwrap_or_default() }
    }

    /// A line to say now, or `None` when there is nothing to say.
    pub fn say(&mut self, pool: &[String]) -> Option<String> {
        let lines: Vec<&String> = pool.iter().filter(|l| !l.is_empty()).collect();
        if lines.is_empty() {
            return None;
        }
        let choices: Vec<&String> =
            if lines.len() > 1 { lines.iter().copied().filter(|l| Some(*l) != self.last_line.as_ref()).collect() } else { lines };
        let i = (((self.random)() * choices.len() as f64) as usize).min(choices.len() - 1);
        let line = choices[i].clone();
        self.last_line = Some(line.clone());
        Some(line)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::manifest::FrameEntry;

    #[test]
    fn answers_at_once_and_does_not_repeat() {
        let mut speech = PetSpeech::new(|| 0.0);
        let pool = vec!["a".to_string(), "b".to_string()];
        assert_eq!(speech.say(&pool).as_deref(), Some("a"));
        // Straight after, while "a" is still up: the next line replaces it.
        assert_eq!(speech.say(&pool).as_deref(), Some("b"));
        assert_eq!(speech.say(&pool).as_deref(), Some("a"));
        assert_eq!(speech.say(&pool[..1]).as_deref(), Some("a"));
        assert_eq!(speech.say(&[]), None);
        assert_eq!(PetSpeech::duration(&"字".repeat(30)), 6.0);
    }

    #[test]
    fn what_a_round_may_say() {
        let spec = StateSpec {
            enabled: true,
            fps: 10.0,
            looping: true,
            frames: vec![FrameEntry { id: "f".into(), duration: None }],
            tracks: None,
            sleep_after_minutes: None,
            lines: Some(vec!["hi".into()]),
            variants: None,
        };
        let action = StateVariant { id: "v".into(), name: String::new(), tracks: vec![], lines: Some(vec!["yawn".into()]), every: None, chance: None };
        assert!(PetSpeech::pool(PetState::Idle, &spec, None).is_empty(), "idle's usual animation says nothing");
        assert_eq!(PetSpeech::pool(PetState::Typing, &spec, None), vec!["hi"]);
        assert_eq!(PetSpeech::pool(PetState::Idle, &spec, Some(&action)), vec!["yawn"]);
    }
}
