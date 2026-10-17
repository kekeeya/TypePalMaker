//! The built-in mascot, packed into a stand-in executable as a generated pet
//! is, read back and decoded at its display size: the whole data path a pet
//! takes before Windows is involved.

use std::path::Path;
use std::process::Command;
use typepal::core::behavior::PetBehavior;
use typepal::core::frames::FrameStore;
use typepal::core::manifest::{PetManifest, PetState};
use typepal::core::payload::PetSource;

#[test]
fn the_mascot_packs_reads_back_and_decodes() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let frames = root.join("../maker/public/assets/typepal-frames");
    let dir = std::env::temp_dir().join(format!("typepal-mascot-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let template = dir.join("TypePal.exe");
    std::fs::write(&template, b"MZ stand-in for the runtime").unwrap();
    let pet = dir.join("Pet.exe");

    let status = Command::new(env!("CARGO_BIN_EXE_typepal-pack"))
        .arg(&template)
        .arg("--mascot")
        .arg(&frames)
        .arg(&pet)
        .status()
        .unwrap();
    assert!(status.success());

    let source = PetSource::packed(&pet).unwrap().expect("a pet in the exe");
    let manifest = PetManifest::load(&source.read("manifest.json").unwrap()).unwrap();
    for state in PetState::ALL {
        assert!(manifest.playable(state).is_some(), "{state:?}");
    }
    let mut store = FrameStore::new(&manifest, &source);
    assert!(store.unreadable_frame_ids().is_empty());

    // 192 points tall at 150% scaling.
    store.configure(192.0 * 1.5);
    assert_eq!(store.box_px.1, 288);
    for id in manifest.used_frame_ids() {
        let frame = store.frame(&id, &source).unwrap();
        assert!(frame.bitmap.width > 0 && frame.bitmap.height as i32 + frame.y <= 288);
    }
    // Idle's frames are kept; the cache stays within its budget.
    assert!(store.cached_bytes() <= 24 * 1024 * 1024);

    // Housekeeping lets go of the others; idle's stay, and the rest come back
    // when asked for.
    let idle: Vec<String> = manifest.playable(PetState::Idle).unwrap().frames.iter().map(|f| f.id.clone()).collect();
    let all = store.cached_bytes();
    store.release_unpinned();
    assert!(store.cached_bytes() < all);
    let typing = &manifest.playable(PetState::Typing).unwrap().frames[0].id;
    if !idle.contains(typing) {
        assert!(store.frame(typing, &source).is_some());
    }

    let behavior = PetBehavior::new(&manifest);
    assert_eq!(behavior.current, PetState::Idle);
    std::fs::remove_dir_all(&dir).unwrap();
}

/// A pet the web Maker generated (`buildWindows.ts`), when `TYPEPAL_WEB_EXE`
/// names one: the runtime reads it as it reads its own packer's.
#[test]
fn a_pet_from_the_web_maker_reads_back() {
    let Some(path) = std::env::var_os("TYPEPAL_WEB_EXE") else {
        eprintln!("skipped: TYPEPAL_WEB_EXE not set");
        return;
    };
    let source = PetSource::packed(Path::new(&path)).unwrap().expect("a pet in the exe");
    let manifest = PetManifest::load(&source.read("manifest.json").unwrap()).unwrap();
    let mut store = FrameStore::new(&manifest, &source);
    assert!(store.unreadable_frame_ids().is_empty());
    store.configure(192.0);
    for id in manifest.used_frame_ids() {
        assert!(store.frame(&id, &source).is_some(), "{id}");
    }
}
