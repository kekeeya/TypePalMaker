//! The pet's `manifest.json`: the same file, read the same way, as the macOS
//! runtime (`player/Sources/TypePalCore/PetManifest.swift`).

use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

use crate::strings::Bilingual;

/// The five reactions a pet can have, in manifest key order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PetState {
    Idle,
    Typing,
    MouseClick,
    Tap,
    Pet,
}

impl PetState {
    pub const ALL: [PetState; 5] = [PetState::Idle, PetState::Typing, PetState::MouseClick, PetState::Tap, PetState::Pet];

    pub fn key(self) -> &'static str {
        match self {
            PetState::Idle => "idle",
            PetState::Typing => "typing",
            PetState::MouseClick => "mouseClick",
            PetState::Tap => "tap",
            PetState::Pet => "pet",
        }
    }

    pub fn from_key(key: &str) -> Option<PetState> {
        PetState::ALL.into_iter().find(|s| s.key() == key)
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

#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct StateSpec {
    pub enabled: bool,
    pub fps: f64,
    #[serde(rename = "loop")]
    pub looping: bool,
    pub frames: Vec<FrameEntry>,
}

impl StateSpec {
    /// Seconds each frame stays on screen.
    pub fn durations(&self) -> Vec<f64> {
        self.frames.iter().map(|f| f.duration.map(|ms| ms / 1000.0).unwrap_or(1.0 / self.fps)).collect()
    }

    /// How a state is played, whatever its file says: idle loops, every
    /// reaction plays once per trigger (see `PetBehavior`).
    pub fn played_as(&self, state: PetState) -> StateSpec {
        StateSpec { looping: state == PetState::Idle, ..self.clone() }
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
        self.states.get(&state).filter(|s| s.enabled && !s.frames.is_empty())
    }

    /// Every frame id referenced by a playable state.
    pub fn used_frame_ids(&self) -> BTreeSet<String> {
        PetState::ALL
            .into_iter()
            .filter_map(|s| self.playable(s))
            .flat_map(|spec| spec.frames.iter().map(|f| f.id.clone()))
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
            if spec.frames.is_empty() {
                return Err(Bilingual::new(format!("状态 {key} 已开启但没有帧"), format!("State {key} is on but has no frames")));
            }
            if !(spec.fps > 0.0) {
                return Err(Bilingual::new(format!("状态 {key} 的 fps 必须大于 0"), format!("State {key} needs an fps greater than 0")));
            }
            for entry in &spec.frames {
                if !self.frames.contains_key(&entry.id) {
                    let id = &entry.id;
                    return Err(Bilingual::new(
                        format!("状态 {key} 引用了不存在的帧：{id}"),
                        format!("State {key} uses a missing frame: {id}"),
                    ));
                }
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
        assert_eq!(idle.durations(), vec![0.25, 0.5]);
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

    #[test]
    fn only_idle_loops() {
        let spec = StateSpec { enabled: true, fps: 10.0, looping: false, frames: vec![] };
        for state in PetState::ALL {
            assert_eq!(spec.played_as(state).looping, state == PetState::Idle);
        }
    }
}
