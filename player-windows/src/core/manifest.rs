//! The pet's `manifest.json`: the same file, read the same way, as the macOS
//! runtime (`player/Sources/TypePalCore/PetManifest.swift`).

use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

use crate::strings::Bilingual;

/// The reactions a pet can have, in manifest key order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PetState {
    Idle,
    Typing,
    MouseClick,
    Tap,
    Pet,
    Sleep,
}

impl PetState {
    pub const ALL: [PetState; 6] =
        [PetState::Idle, PetState::Typing, PetState::MouseClick, PetState::Tap, PetState::Pet, PetState::Sleep];

    pub fn key(self) -> &'static str {
        match self {
            PetState::Idle => "idle",
            PetState::Typing => "typing",
            PetState::MouseClick => "mouseClick",
            PetState::Tap => "tap",
            PetState::Pet => "pet",
            PetState::Sleep => "sleep",
        }
    }

    pub fn from_key(key: &str) -> Option<PetState> {
        PetState::ALL.into_iter().find(|s| s.key() == key)
    }

    /// Idle and sleep loop; every other reaction plays once per trigger.
    pub fn loops(self) -> bool {
        self == PetState::Idle || self == PetState::Sleep
    }
}

/// One frame in a state's sequence: which image, and for how long.
#[derive(Clone, Debug, PartialEq)]
pub struct FrameEntry {
    pub id: String,
    /// Milliseconds. `None` means "1 / fps".
    pub duration: Option<f64>,
}

impl<'de> Deserialize<'de> for FrameEntry {
    /// Accepts both the short form `"a1b2"` and `{ "id": "a1b2", "duration": 500 }`.
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Id(String),
            Full { id: String, duration: Option<f64> },
        }
        Ok(match Raw::deserialize(d)? {
            Raw::Id(id) => FrameEntry { id, duration: None },
            Raw::Full { id, duration } => FrameEntry { id, duration },
        })
    }
}

/// One row of a state's timeline. The rows play together on one clock, the
/// first drawn over the others (sleep: a Z effect over the pet).
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct FrameTrack {
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub frames: Vec<FrameEntry>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateSpec {
    pub enabled: bool,
    pub fps: f64,
    #[serde(rename = "loop")]
    pub looping: bool,
    /// The pet's own row, for readers that know only one.
    pub frames: Vec<FrameEntry>,
    #[serde(default)]
    pub tracks: Option<Vec<FrameTrack>>,
    /// Sleep only: how long without any input before the pet falls asleep.
    #[serde(default)]
    pub sleep_after_minutes: Option<f64>,
    /// Lines the pet may say when the reaction plays as usual.
    #[serde(default)]
    pub lines: Option<Vec<String>>,
    #[serde(default)]
    pub variants: Option<Vec<StateVariant>>,
}

/// A random action of a reaction: rows of its own, lines to say, and how
/// often it comes. A looping reaction (idle, sleep) plays it once every
/// `every` seconds, a random time in the range; any other plays it instead
/// of its usual animation with probability `chance`. Rows with no pictures
/// at all mean the usual animation.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct StateVariant {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub tracks: Vec<FrameTrack>,
    #[serde(default)]
    pub lines: Option<Vec<String>>,
    #[serde(default)]
    pub every: Option<Vec<f64>>,
    #[serde(default)]
    pub chance: Option<f64>,
}

impl StateVariant {
    pub fn has_own_frames(&self) -> bool {
        self.tracks.iter().any(|t| !t.frames.is_empty())
    }

    pub fn frames(&self) -> impl Iterator<Item = &FrameEntry> {
        self.tracks.iter().flat_map(|t| t.frames.iter())
    }
}

impl StateSpec {
    /// Seconds an entry stays on screen.
    pub fn duration(&self, entry: &FrameEntry) -> f64 {
        entry.duration.map(|ms| ms / 1000.0).unwrap_or(1.0 / self.fps)
    }

    /// The rows to play: `tracks`, or `frames` as the only one.
    pub fn timeline_tracks(&self) -> Vec<FrameTrack> {
        match &self.tracks {
            Some(tracks) if !tracks.is_empty() => tracks.clone(),
            _ => vec![FrameTrack { id: "main".into(), name: String::new(), frames: self.frames.clone() }],
        }
    }

    pub fn all_frames(&self) -> Vec<FrameEntry> {
        self.timeline_tracks().into_iter().flat_map(|t| t.frames).collect()
    }

    /// Seconds in one round: as long as the longest row.
    pub fn timeline_duration(&self) -> f64 {
        self.timeline_tracks().iter().map(|t| t.frames.iter().map(|e| self.duration(e)).sum::<f64>()).fold(0.0, f64::max)
    }

    /// How a state is played, whatever its file says: idle and sleep loop,
    /// every reaction plays once per trigger (see `PetBehavior`).
    pub fn played_as(&self, state: PetState) -> StateSpec {
        StateSpec { looping: state.loops(), ..self.clone() }
    }

    /// How a random action plays: once, on its own rows, or the usual ones
    /// if it has no pictures.
    pub fn playing(&self, variant: &StateVariant) -> StateSpec {
        StateSpec {
            looping: false,
            frames: Vec::new(),
            tracks: Some(if variant.has_own_frames() { variant.tracks.clone() } else { self.timeline_tracks() }),
            lines: variant.lines.clone(),
            variants: None,
            ..self.clone()
        }
    }

    pub fn variant(&self, id: Option<&str>) -> Option<&StateVariant> {
        let id = id?;
        self.variants.as_ref()?.iter().find(|v| v.id == id)
    }

    /// Every frame of its random actions.
    pub fn variant_frames(&self) -> Vec<FrameEntry> {
        self.variants.iter().flatten().flat_map(|v| v.frames().cloned()).collect()
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct Display {
    pub height: f64,
}

#[derive(Clone, Debug, Deserialize)]
pub struct FrameRef {
    pub file: String,
}

#[derive(Clone, Debug)]
pub struct PetManifest {
    pub schema_version: i64,
    pub name: String,
    pub id: String,
    pub display: Display,
    pub frames: BTreeMap<String, FrameRef>,
    pub states: BTreeMap<PetState, StateSpec>,
}

impl PetManifest {
    pub fn parse(json: &[u8]) -> Result<PetManifest, Bilingual> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Raw {
            schema_version: i64,
            name: String,
            id: String,
            display: Display,
            frames: BTreeMap<String, FrameRef>,
            states: BTreeMap<String, Value>,
        }
        let raw: Raw = serde_json::from_slice(json)
            .map_err(|e| Bilingual::new(format!("manifest.json 无法读取：{e}"), format!("manifest.json can't be read: {e}")))?;
        // Keyed by string first, so a state from a newer schema is skipped
        // rather than failing the whole pet.
        let mut states = BTreeMap::new();
        for (key, value) in raw.states {
            if let Some(state) = PetState::from_key(&key) {
                let spec = StateSpec::deserialize(value).map_err(|e| {
                    Bilingual::new(format!("状态 {key} 无法读取：{e}"), format!("State {key} can't be read: {e}"))
                })?;
                states.insert(state, spec);
            }
        }
        Ok(PetManifest {
            schema_version: raw.schema_version,
            name: raw.name,
            id: raw.id,
            display: raw.display,
            frames: raw.frames,
            states,
        })
    }

    /// Parses and validates.
    pub fn load(json: &[u8]) -> Result<PetManifest, Bilingual> {
        let manifest = PetManifest::parse(json)?;
        manifest.validate()?;
        Ok(manifest)
    }

    /// The spec for a state if it may be shown, i.e. enabled and non-empty.
    pub fn playable(&self, state: PetState) -> Option<&StateSpec> {
        self.states.get(&state).filter(|s| s.enabled && !s.all_frames().is_empty())
    }

    /// Every frame id referenced by a playable state.
    pub fn used_frame_ids(&self) -> BTreeSet<String> {
        PetState::ALL
            .into_iter()
            .filter_map(|s| self.playable(s))
            .flat_map(|spec| spec.all_frames().into_iter().chain(spec.variant_frames()).map(|f| f.id))
            .collect()
    }

    pub fn validate(&self) -> Result<(), Bilingual> {
        if self.schema_version != 1 {
            let v = self.schema_version;
            return Err(Bilingual::new(format!("不支持的 schemaVersion：{v}"), format!("Unsupported schemaVersion: {v}")));
        }
        if self.playable(PetState::Idle).is_none() {
            return Err(Bilingual::new("默认状态（idle）必须开启且至少有一帧", "Idle must be on and have at least one frame"));
        }
        if !(self.display.height > 0.0) {
            return Err(Bilingual::new("display.height 必须大于 0", "display.height must be greater than 0"));
        }
        for (state, spec) in &self.states {
            if !spec.enabled {
                continue;
            }
            let key = state.key();
            let frames = spec.all_frames();
            if frames.is_empty() {
                return Err(Bilingual::new(format!("状态 {key} 已开启但没有帧"), format!("State {key} is on but has no frames")));
            }
            if !(spec.fps > 0.0) {
                return Err(Bilingual::new(format!("状态 {key} 的 fps 必须大于 0"), format!("State {key} needs an fps greater than 0")));
            }
            for entry in frames.iter().chain(&spec.variant_frames()) {
                if !self.frames.contains_key(&entry.id) {
                    let id = &entry.id;
                    return Err(Bilingual::new(
                        format!("状态 {key} 引用了不存在的帧：{id}"),
                        format!("State {key} uses a missing frame: {id}"),
                    ));
                }
            }
            if *state == PetState::Sleep && !(spec.sleep_after_minutes.unwrap_or(15.0) > 0.0) {
                return Err(Bilingual::new("睡眠等待时间必须大于 0", "Sleep delay must be greater than 0"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = r#"{
      "schemaVersion": 1, "name": "Cat", "id": "cat", "display": { "height": 160 },
      "frames": { "a": { "file": "a.png" }, "b": { "file": "b.png" } },
      "states": {
        "idle": { "enabled": true, "fps": 4, "loop": true, "frames": ["a", { "id": "b", "duration": 500 }] },
        "typing": { "enabled": false, "fps": 8, "loop": true, "frames": [] },
        "someFutureState": { "enabled": true, "fps": 1, "loop": true, "frames": ["a"] }
      }
    }"#;

    #[test]
    fn decodes_both_frame_forms_and_durations() {
        let manifest = PetManifest::parse(BASE.as_bytes()).unwrap();
        let idle = manifest.playable(PetState::Idle).unwrap();
        assert_eq!(
            idle.frames,
            vec![FrameEntry { id: "a".into(), duration: None }, FrameEntry { id: "b".into(), duration: Some(500.0) }]
        );
        assert_eq!(idle.frames.iter().map(|e| idle.duration(e)).collect::<Vec<_>>(), vec![0.25, 0.5]);
        assert!(manifest.validate().is_ok());
    }

    #[test]
    fn disabled_states_are_not_playable_and_unknown_keys_are_ignored() {
        let manifest = PetManifest::parse(BASE.as_bytes()).unwrap();
        assert!(manifest.playable(PetState::Typing).is_none());
        assert_eq!(manifest.states.len(), 2);
    }

    #[test]
    fn rejects_missing_idle_and_dangling_frames() {
        let no_idle = BASE.replace("\"idle\"", "\"tap\"");
        assert!(PetManifest::parse(no_idle.as_bytes()).unwrap().validate().is_err());
        let dangling = BASE.replace("\"frames\": [\"a\", {", "\"frames\": [\"zzz\", {");
        assert!(PetManifest::parse(dangling.as_bytes()).unwrap().validate().is_err());
    }

    /// The Mac pet's sleep (a state with tracks) is not this runtime's yet: a
    /// manifest that has it still loads, and the pet simply never sleeps.
    #[test]
    fn reads_sleep_and_rows() {
        let json = r#"{
          "schemaVersion": 1, "name": "Cat", "id": "cat", "display": { "height": 160 },
          "frames": { "a": { "file": "a.png" }, "z": { "file": "z.png" } },
          "states": {
            "idle": { "enabled": true, "fps": 8, "loop": true, "frames": ["a"],
                      "tracks": [{ "id": "sleep-effects", "name": "", "frames": ["z", "z"] },
                                 { "id": "main", "name": "", "frames": ["a"] }] },
            "sleep": { "enabled": true, "fps": 8, "loop": true, "frames": ["a"], "sleepAfterMinutes": 3,
                       "tracks": [{ "id": "sleep-base", "name": "", "frames": [{ "id": "a", "duration": 500 }] }] }
          }
        }"#;
        let manifest = PetManifest::load(json.as_bytes()).unwrap();
        assert_eq!(manifest.used_frame_ids().len(), 2);
        let idle = manifest.playable(PetState::Idle).unwrap();
        assert_eq!(idle.timeline_tracks().len(), 2);
        assert_eq!(idle.timeline_duration(), 0.25);
        let sleep = manifest.playable(PetState::Sleep).unwrap();
        assert_eq!(sleep.sleep_after_minutes, Some(3.0));
        assert_eq!(sleep.timeline_duration(), 0.5);
    }

    #[test]
    fn reads_random_actions_and_lines() {
        let json = r#"{
          "schemaVersion": 1, "name": "Cat", "id": "cat", "display": { "height": 160 },
          "frames": { "a": { "file": "a.png" }, "s": { "file": "s.png" } },
          "states": {
            "idle": { "enabled": true, "fps": 8, "loop": true, "frames": ["a"], "lines": ["hi"],
                      "variants": [{ "id": "v", "name": "伸懒腰", "lines": ["好困…"], "every": [60, 180],
                                     "tracks": [{ "id": "fx", "name": "", "frames": ["s"] }, { "id": "main", "name": "", "frames": ["a"] }] },
                                   { "id": "w", "name": "空", "tracks": [{ "id": "main", "name": "", "frames": [] }] }] }
          }
        }"#;
        let manifest = PetManifest::load(json.as_bytes()).unwrap();
        assert_eq!(manifest.used_frame_ids().len(), 2);
        let idle = manifest.playable(PetState::Idle).unwrap();
        assert_eq!(idle.lines.as_deref(), Some(&["hi".to_string()][..]));
        let v = idle.variant(Some("v")).unwrap();
        assert_eq!(v.every.as_deref(), Some(&[60.0, 180.0][..]));
        assert_eq!(idle.playing(v).timeline_tracks().len(), 2);
        // An action with no pictures plays the usual rows.
        let empty = idle.variant(Some("w")).unwrap();
        assert_eq!(idle.playing(empty).timeline_tracks()[0].frames.len(), 1);
    }

    #[test]
    fn a_missing_row_frame_is_rejected() {
        let json = r#"{
          "schemaVersion": 1, "name": "Cat", "id": "cat", "display": { "height": 160 },
          "frames": { "a": { "file": "a.png" } },
          "states": { "idle": { "enabled": true, "fps": 8, "loop": true, "frames": ["a"],
                                "tracks": [{ "id": "fx", "name": "", "frames": ["gone"] }, { "id": "main", "name": "", "frames": ["a"] }] } }
        }"#;
        assert!(PetManifest::load(json.as_bytes()).is_err());
    }

    #[test]
    fn only_idle_and_sleep_loop() {
        let spec = StateSpec { enabled: true, fps: 10.0, looping: false, frames: vec![], tracks: None, sleep_after_minutes: None, lines: None, variants: None };
        for state in PetState::ALL {
            assert_eq!(spec.played_as(state).looping, state == PetState::Idle || state == PetState::Sleep);
        }
    }
}
