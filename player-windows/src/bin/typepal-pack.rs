//! Packs a pet into a copy of the template, by hand, for testing — what the
//! Maker's generator does for real (macOS: `build-app.sh --pet`).
//!
//!     typepal-pack <TypePal.exe> <pet dir> <out.exe>
//!     typepal-pack <TypePal.exe> --mascot <typepal-frames dir> <out.exe>
//!
//! A pet dir holds `manifest.json` and the files it names. `--mascot` builds
//! the built-in TypePal mascot from its `animation.json`, every reaction on.

use serde_json::{Map, Value, json};
use std::path::Path;
use typepal::core::payload::{append, stored_zip};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let usage = "usage: typepal-pack <TypePal.exe> (<pet dir> | --mascot <frames dir>) <out.exe>";
    let (template, out, files) = match args.as_slice() {
        [t, flag, dir, o] if flag == "--mascot" => (t, o, mascot(Path::new(dir))),
        [t, dir, o] => (t, o, pet_dir(Path::new(dir))),
        _ => {
            eprintln!("{usage}");
            std::process::exit(2);
        }
    };
    let exe = std::fs::read(template).expect("read the template");
    let refs: Vec<(&str, &[u8])> = files.iter().map(|(n, d)| (n.as_str(), d.as_slice())).collect();
    std::fs::write(out, append(&exe, &stored_zip(&refs))).expect("write the pet");
    println!("{out}: {} files packed", files.len());
}

/// `manifest.json` and every file it names.
fn pet_dir(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let manifest = std::fs::read(dir.join("manifest.json")).expect("read manifest.json");
    let parsed: Value = serde_json::from_slice(&manifest).expect("parse manifest.json");
    let mut files = vec![("manifest.json".to_string(), manifest)];
    for frame in parsed["frames"].as_object().into_iter().flat_map(|m| m.values()) {
        let file = frame["file"].as_str().expect("frame file");
        files.push((file.to_string(), std::fs::read(dir.join(file)).expect("read a frame")));
    }
    files
}

fn mascot(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let animation: Value = serde_json::from_slice(&std::fs::read(dir.join("animation.json")).unwrap()).unwrap();
    let mut frames = Map::new();
    let mut states = Map::new();
    let mut files = Vec::new();
    for state in ["idle", "typing", "mouseClick", "tap", "pet"] {
        let names: Vec<String> = animation["states"][state]
            .as_array()
            .map(|a| a.iter().map(|f| f.as_str().unwrap().to_string()).collect())
            .unwrap_or_default();
        let mut ids = Vec::new();
        for name in &names {
            let id = name.trim_end_matches(".png").to_string();
            if !frames.contains_key(&id) {
                let file = format!("frames/{name}");
                files.push((file.clone(), std::fs::read(dir.join(name)).unwrap()));
                frames.insert(id.clone(), json!({ "file": file }));
            }
            ids.push(id);
        }
        states.insert(state.into(), json!({ "enabled": !ids.is_empty(), "fps": animation["fps"], "loop": state == "idle", "frames": ids }));
    }
    let manifest = json!({
        "schemaVersion": 1, "name": "TypePal 小团子", "id": "typepal-mascot",
        "display": { "height": 192 }, "frames": frames, "states": states,
    });
    files.insert(0, ("manifest.json".into(), serde_json::to_vec_pretty(&manifest).unwrap()));
    files
}
