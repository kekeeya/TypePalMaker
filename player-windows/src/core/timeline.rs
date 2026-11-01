//! Where a state's timeline stands at a moment: which frame each row shows,
//! and when the next one changes. A port of
//! `player/Sources/TypePalCore/SpriteTimeline.swift`.
//!
//! Each row plays its frames one after another; a row that ends before the
//! longest one shows nothing for the rest of the round, as the Maker's
//! timeline draws it. The round lasts as long as the longest row.

use super::manifest::{FrameEntry, FrameTrack, StateSpec};

pub struct SpriteTimeline {
    pub tracks: Vec<FrameTrack>,
    fps: f64,
    /// Seconds in one round.
    pub length: f64,
}

impl SpriteTimeline {
    pub fn new(spec: &StateSpec) -> SpriteTimeline {
        SpriteTimeline { tracks: spec.timeline_tracks(), fps: spec.fps, length: spec.timeline_duration() }
    }

    fn duration(&self, entry: &FrameEntry) -> f64 {
        entry.duration.map(|ms| ms / 1000.0).unwrap_or(1.0 / self.fps)
    }

    /// For each row, the frame showing at `time` (`None` in a gap or once the
    /// row has ended), and when the soonest of them changes.
    pub fn frames_at(&self, time: f64) -> (Vec<Option<&FrameEntry>>, f64) {
        let mut next = self.length;
        let entries = self
            .tracks
            .iter()
            .map(|track| {
                let mut boundary = 0.0;
                for entry in &track.frames {
                    boundary += StateSpec::delay(entry);
                    if time < boundary - 0.000_001 {
                        next = next.min(boundary);
                        return None;
                    }
                    boundary += self.duration(entry);
                    if time < boundary - 0.000_001 {
                        next = next.min(boundary);
                        return Some(entry);
                    }
                }
                None
            })
            .collect();
        (entries, next)
    }

    /// Nothing ever changes: one row holding one frame, from the start.
    pub fn is_still(&self) -> bool {
        self.tracks.len() == 1 && self.tracks[0].frames.len() == 1 && StateSpec::delay(&self.tracks[0].frames[0]) == 0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::manifest::FrameEntry;

    fn entry(id: &str, ms: Option<f64>) -> FrameEntry {
        FrameEntry { id: id.into(), duration: ms, delay: None }
    }

    #[test]
    fn rows_play_together_and_a_short_one_ends_early() {
        let spec = StateSpec {
            enabled: true,
            fps: 8.0,
            looping: true,
            frames: vec![entry("base", Some(500.0))],
            tracks: Some(vec![
                FrameTrack { id: "fx".into(), name: String::new(), frames: vec![entry("z1", None), entry("z2", None)] },
                FrameTrack { id: "main".into(), name: String::new(), frames: vec![entry("base", Some(500.0))] },
            ]),
            sleep_after_minutes: None,
            lines: None,
            variants: None,
        };
        let timeline = SpriteTimeline::new(&spec);
        assert_eq!(timeline.length, 0.5);
        let (shown, next) = timeline.frames_at(0.0);
        assert_eq!(shown.iter().map(|e| e.map(|e| e.id.as_str())).collect::<Vec<_>>(), vec![Some("z1"), Some("base")]);
        assert_eq!(next, 0.125);
        let (shown, next) = timeline.frames_at(0.25);
        assert_eq!(shown.iter().map(|e| e.map(|e| e.id.as_str())).collect::<Vec<_>>(), vec![None, Some("base")]);
        assert_eq!(next, 0.5);
    }

    #[test]
    fn a_gap_shows_nothing_and_counts_in_the_round() {
        let gap = |id: &str, ms: f64| FrameEntry { id: id.into(), duration: None, delay: Some(ms) };
        let spec = StateSpec {
            enabled: true,
            fps: 8.0,
            looping: false,
            frames: vec![],
            tracks: Some(vec![
                FrameTrack { id: "fx".into(), name: String::new(), frames: vec![gap("a", 250.0), gap("b", 125.0)] },
                FrameTrack { id: "main".into(), name: String::new(), frames: vec![entry("base", Some(375.0))] },
            ]),
            sleep_after_minutes: None,
            lines: None,
            variants: None,
        };
        let timeline = SpriteTimeline::new(&spec);
        assert_eq!(timeline.length, 0.625);
        let ids = |t: f64| timeline.frames_at(t).0.iter().map(|e| e.map(|e| e.id.clone())).collect::<Vec<_>>();
        assert_eq!(ids(0.0), vec![None, Some("base".to_string())]);
        assert_eq!(timeline.frames_at(0.0).1, 0.25);
        assert_eq!(ids(0.25), vec![Some("a".to_string()), Some("base".to_string())]);
        assert_eq!(ids(0.375), vec![None, None]);
        assert_eq!(timeline.frames_at(0.375).1, 0.5);
        assert_eq!(ids(0.5), vec![Some("b".to_string()), None]);
    }

    #[test]
    fn a_state_without_rows_is_one_row() {
        let spec = StateSpec { enabled: true, fps: 4.0, looping: true, frames: vec![entry("a", None)], tracks: None, sleep_after_minutes: None, lines: None, variants: None };
        let timeline = SpriteTimeline::new(&spec);
        assert!(timeline.is_still());
        assert_eq!(timeline.frames_at(0.0).1, 0.25);
    }
}
