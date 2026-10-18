//! Turns a `.typepalproj` into a standalone pet app.
//!
//! The steps are the ones proven by hand in M0: copy the prebuilt TypePal
//! runtime, drop the pet into `Contents/Resources/Pet`, rename the bundle,
//! give it an icon, and re-sign it ad hoc with the system's own `codesign`.
//! Everything is assembled in a temporary folder next to the destination and
//! only moved into place once it has been signed and verified, so a failure
//! never leaves a half-built app behind.

use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageFormat, RgbaImage};
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::Command;

thread_local! {
    /// The Maker's interface language for this generation's messages.
    static ENGLISH: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// A message for the user, in the Maker's interface language.
fn tr(zh: String, en: String) -> String {
    if ENGLISH.with(|e| e.get()) { en } else { zh }
}

/// The pet may be shown at up to 2× its designed height, on a Retina screen.
/// Frames are stored at that size and no larger.
const MAX_SCALE: f64 = 2.0;
const RETINA: f64 = 2.0;
const STATES: [&str; 6] = ["idle", "typing", "mouseClick", "tap", "pet", "sleep"];

/// Problems the Maker's UI knows how to explain. Anything else is passed on
/// as text.
#[derive(Debug)]
pub enum GenerateError {
    /// An app with this name is already there and overwriting was not allowed.
    Exists(PathBuf),
    /// The app to be replaced is running; it has to be quit first.
    Running(PathBuf),
    Other(String),
}

impl From<String> for GenerateError {
    fn from(message: String) -> Self {
        GenerateError::Other(message)
    }
}

impl From<&str> for GenerateError {
    fn from(message: &str) -> Self {
        GenerateError::Other(message.to_string())
    }
}

impl GenerateError {
    /// Serialised for the front end as `CODE:detail`.
    pub fn to_wire(&self) -> String {
        match self {
            GenerateError::Exists(p) => format!("EXISTS:{}", p.display()),
            GenerateError::Running(p) => format!("RUNNING:{}", p.display()),
            GenerateError::Other(m) => format!("ERROR:{m}"),
        }
    }
}

/// `english` picks the language of the error messages.
pub fn generate(
    project_zip: &[u8],
    template: &Path,
    out_dir: &Path,
    overwrite: bool,
    english: bool,
) -> Result<PathBuf, GenerateError> {
    ENGLISH.with(|e| e.set(english));
    let files = unzip(project_zip)?;
    let manifest: Value = serde_json::from_slice(
        files.get("manifest.json").ok_or_else(|| tr("工程里缺少 manifest.json".into(), "The project has no manifest.json".into()))?,
    )
    .map_err(|e| tr(format!("manifest.json 格式有误：{e}"), format!("manifest.json is malformed: {e}")))?;

    let name = manifest["name"].as_str().unwrap_or("").trim().to_string();
    let id = manifest["id"].as_str().unwrap_or("").to_string();
    if name.is_empty() {
        return Err(tr("宠物名字不能为空".into(), "The pet needs a name".into()).into());
    }
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(tr(format!("宠物 id 无效：{id}"), format!("Invalid pet id: {id}")).into());
    }

    if !template.join("Contents/MacOS/TypePal").exists() {
        return Err(tr(format!("找不到桌宠模板：{}", template.display()), format!("Pet template not found: {}", template.display())).into());
    }

    fs::create_dir_all(out_dir)
        .map_err(|e| tr(format!("无法创建目录 {}：{e}", out_dir.display()), format!("Can't create the folder {}: {e}", out_dir.display())))?;
    let target = out_dir.join(format!("{}.app", file_safe(&name)));
    if target.exists() {
        if !overwrite {
            return Err(GenerateError::Exists(target));
        }
        if is_running(&target) {
            return Err(GenerateError::Running(target));
        }
    }

    // Assembled beside the destination, so the final move is a rename on the
    // same volume.
    let staging = tempfile::Builder::new()
        .prefix(".typepal-build-")
        .tempdir_in(out_dir)
        .map_err(|e| tr(format!("无法创建临时目录：{e}"), format!("Can't create a temporary folder: {e}")))?;
    let app = staging.path().join("Pet.app");

    run("ditto", &[template.as_os_str(), app.as_os_str()])?;
    let pet_dir = app.join("Contents/Resources/Pet");
    let _ = fs::remove_dir_all(&pet_dir);
    fs::create_dir_all(pet_dir.join("frames")).map_err(|e| e.to_string())?;

    let display_height = manifest["display"]["height"].as_f64().unwrap_or(160.0);
    let max_px = (display_height * MAX_SCALE * RETINA).ceil() as u32;
    let (out_manifest, first_idle) = write_frames(&manifest, &files, &pet_dir, max_px)?;
    fs::write(
        pet_dir.join("manifest.json"),
        serde_json::to_vec_pretty(&out_manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // Icon: the one supplied, or the first idle frame.
    let icon_source = match files.get("icon.png") {
        Some(bytes) => decode(bytes, "icon.png")?,
        None => first_idle,
    };
    write_icon(&icon_source, &app.join("Contents/Resources/AppIcon.icns"))?;

    let plist = app.join("Contents/Info.plist");
    let bundle_id = format!("io.typepal.pet.{id}");
    for (key, value) in [
        ("CFBundleName", name.as_str()),
        ("CFBundleDisplayName", name.as_str()),
        ("CFBundleIdentifier", bundle_id.as_str()),
        ("CFBundleIconFile", "AppIcon"),
    ] {
        run("plutil", &["-replace".as_ref(), key.as_ref(), "-string".as_ref(), value.as_ref(), plist.as_os_str()])?;
    }

    // Every change above broke the template's seal; this makes a new one.
    run("codesign", &["--force".as_ref(), "--sign".as_ref(), "-".as_ref(), app.as_os_str()])?;
    run("codesign", &["--verify".as_ref(), "--strict".as_ref(), app.as_os_str()])?;

    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| tr(format!("无法替换旧的 App：{e}"), format!("Can't replace the old app: {e}")))?;
    }
    fs::rename(&app, &target)
        .map_err(|e| tr(format!("无法移动到 {}：{e}", target.display()), format!("Can't move it to {}: {e}", target.display())))?;
    Ok(target)
}

/// Writes every frame a playable state uses, scaled down to `max_px` tall,
/// and returns the manifest that points at them plus the first idle frame.
fn write_frames(
    manifest: &Value,
    files: &HashMap<String, Vec<u8>>,
    pet_dir: &Path,
    max_px: u32,
) -> Result<(Value, DynamicImage), GenerateError> {
    let frames_in = manifest["frames"]
        .as_object()
        .ok_or_else(|| tr("manifest 缺少 frames".into(), "The manifest has no frames".into()))?;
    let states_in = manifest["states"]
        .as_object()
        .ok_or_else(|| tr("manifest 缺少 states".into(), "The manifest has no states".into()))?;

    let mut used: Vec<String> = Vec::new();
    let mut first_idle_id = String::new();
    let mut states_out = Map::new();
    for state in STATES {
        let Some(spec) = states_in.get(state) else { continue };
        let mut entries = spec["frames"].as_array().cloned().unwrap_or_default();
        // The reaction's rows, then its random actions'.
        let variant_tracks = spec["variants"].as_array().into_iter().flatten().filter_map(|v| v["tracks"].as_array()).flatten();
        for track in spec["tracks"].as_array().into_iter().flatten().chain(variant_tracks) {
            entries.extend(track["frames"].as_array().cloned().unwrap_or_default());
        }
        let enabled = spec["enabled"].as_bool().unwrap_or(false) && !entries.is_empty();
        if state == "idle" && !enabled {
            return Err(tr("默认状态必须开启且至少有一帧".into(), "Idle must be on and have at least one frame".into()).into());
        }
        if enabled {
            for entry in &entries {
                let fid = entry.as_str().or_else(|| entry["id"].as_str()).unwrap_or("").to_string();
                // Any of idle's rows will do; the pet's own one comes first.
                if state == "idle" && first_idle_id.is_empty() {
                    first_idle_id = fid.clone();
                }
                if !frames_in.contains_key(&fid) {
                    return Err(tr(format!("状态 {state} 引用了不存在的帧 {fid}"), format!("State {state} uses a missing frame {fid}")).into());
                }
                if !used.contains(&fid) {
                    used.push(fid);
                }
            }
        }
        states_out.insert(state.to_string(), spec.clone());
    }

    let mut first_idle = None;

    let mut frames_out = Map::new();
    for fid in &used {
        let file = frames_in[fid]["file"].as_str().unwrap_or("");
        let bytes = files
            .get(file)
            .ok_or_else(|| tr(format!("工程里缺少图片 {file}"), format!("The project is missing the image {file}")))?;
        let image = decode(bytes, file)?;
        if *fid == first_idle_id {
            first_idle = Some(image.clone());
        }
        let scaled = fit_height(image, max_px);
        let out_name = format!("frames/{fid}.png");
        scaled
            .save_with_format(pet_dir.join(&out_name), ImageFormat::Png)
            .map_err(|e| tr(format!("无法写入 {out_name}：{e}"), format!("Can't write {out_name}: {e}")))?;
        frames_out.insert(fid.clone(), json!({ "file": out_name }));
    }

    let mut out = manifest.clone();
    out["frames"] = Value::Object(frames_out);
    out["states"] = Value::Object(states_out);
    let first_idle = first_idle.ok_or_else(|| tr("找不到默认状态的第一帧".into(), "Idle's first frame is missing".into()))?;
    Ok((out, first_idle))
}

fn decode(bytes: &[u8], name: &str) -> Result<DynamicImage, GenerateError> {
    image::load_from_memory(bytes).map_err(|e| tr(format!("无法读取图片 {name}：{e}"), format!("Can't read the image {name}: {e}")).into())
}

/// Scales down so the height is at most `max_px`; never scales up.
fn fit_height(image: DynamicImage, max_px: u32) -> DynamicImage {
    let (w, h) = image.dimensions();
    if h <= max_px {
        return image;
    }
    let new_w = ((w as f64) * (max_px as f64) / (h as f64)).round().max(1.0) as u32;
    image.resize_exact(new_w, max_px, FilterType::Lanczos3)
}

/// A square, transparent-padded icon in every size macOS asks for.
fn write_icon(source: &DynamicImage, icns: &Path) -> Result<(), GenerateError> {
    let (w, h) = source.dimensions();
    let side = w.max(h);
    let mut square = RgbaImage::new(side, side);
    image::imageops::overlay(&mut square, &source.to_rgba8(), ((side - w) / 2) as i64, ((side - h) / 2) as i64);
    let square = DynamicImage::ImageRgba8(square);

    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let iconset = dir.path().join("AppIcon.iconset");
    fs::create_dir_all(&iconset).map_err(|e| e.to_string())?;
    for size in [16u32, 32, 128, 256, 512] {
        for (scale, suffix) in [(1u32, ""), (2, "@2x")] {
            let px = size * scale;
            square
                .resize_exact(px, px, FilterType::Lanczos3)
                .save_with_format(iconset.join(format!("icon_{size}x{size}{suffix}.png")), ImageFormat::Png)
                .map_err(|e| tr(format!("无法生成图标：{e}"), format!("Can't make the icon: {e}")))?;
        }
    }
    run("iconutil", &["-c".as_ref(), "icns".as_ref(), iconset.as_os_str(), "-o".as_ref(), icns.as_os_str()])
}

fn unzip(bytes: &[u8]) -> Result<HashMap<String, Vec<u8>>, GenerateError> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| tr(format!("工程文件无法解压：{e}"), format!("The project file can't be unpacked: {e}")))?;
    let mut files = HashMap::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() {
            continue;
        }
        let mut data = Vec::new();
        entry.read_to_end(&mut data).map_err(|e| e.to_string())?;
        files.insert(entry.name().to_string(), data);
    }
    Ok(files)
}

/// Finder-safe file name: no path separators, no leading dot.
fn file_safe(name: &str) -> String {
    let cleaned: String = name.chars().map(|c| if c == '/' || c == ':' { '-' } else { c }).collect();
    let trimmed = cleaned.trim_start_matches('.').trim();
    if trimmed.is_empty() { "TypePal".to_string() } else { trimmed.to_string() }
}

/// Whether some process is running this app's executable right now.
fn is_running(app: &Path) -> bool {
    let exe = app.join("Contents/MacOS/TypePal");
    Command::new("pgrep")
        .args(["-f", &exe.to_string_lossy()])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn run<S: AsRef<std::ffi::OsStr>>(program: &str, args: &[S]) -> Result<(), GenerateError> {
    let output = Command::new(program)
        .args(args)
        .output()
        .map_err(|e| tr(format!("无法运行 {program}：{e}"), format!("Can't run {program}: {e}")))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(tr(format!("{program} 失败：{detail}"), format!("{program} failed: {detail}")).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_finder_safe() {
        assert_eq!(file_safe("小咪"), "小咪");
        assert_eq!(file_safe("a/b:c"), "a-b-c");
        assert_eq!(file_safe("..hidden"), "hidden");
        assert_eq!(file_safe("   "), "TypePal");
    }

    #[test]
    fn errors_follow_the_interface_language() {
        let out = tempfile::tempdir().unwrap();
        let wire = |english| generate(b"not a zip", Path::new("/nonexistent"), out.path(), false, english).unwrap_err().to_wire();
        assert!(wire(false).contains("工程文件无法解压"));
        assert!(wire(true).contains("can't be unpacked"));
    }

    #[test]
    fn frames_only_shrink() {
        let tall = DynamicImage::new_rgba8(1254, 1254);
        assert_eq!(fit_height(tall, 640).dimensions(), (640, 640));
        let small = DynamicImage::new_rgba8(100, 50);
        assert_eq!(fit_height(small, 640).dimensions(), (100, 50));
    }
}

/// End to end against the real runtime template and the built-in TypePal
/// mascot. Skipped unless the template has been built (it is a build product).
#[cfg(test)]
mod end_to_end {
    use super::*;
    use std::io::Write;

    /// A project as the Maker writes it, from the mascot's frames and their
    /// `animation.json`: every reaction on, frames in order.
    fn mascot_project(dir: &Path) -> Vec<u8> {
        let animation: Value = serde_json::from_slice(&fs::read(dir.join("animation.json")).unwrap()).unwrap();
        let fps = animation["fps"].as_f64().unwrap();
        let mut frames = Map::new();
        let mut states = Map::new();
        for state in STATES {
            let files: Vec<String> = animation["states"][state]
                .as_array()
                .map(|a| a.iter().map(|f| f.as_str().unwrap().to_string()).collect())
                .unwrap_or_default();
            for file in &files {
                frames.insert(file.trim_end_matches(".png").to_string(), json!({ "file": format!("frames/{file}") }));
            }
            let ids: Vec<String> = files.iter().map(|f| f.trim_end_matches(".png").to_string()).collect();
            states.insert(state.to_string(), json!({ "enabled": !ids.is_empty(), "fps": fps, "loop": state == "idle", "frames": ids }));
        }
        let manifest = json!({
            "schemaVersion": 1, "name": "TestPet", "id": "testpet",
            "display": { "height": 192 }, "frames": frames, "states": states,
        });

        let mut out = Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(&mut out);
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("manifest.json", opts).unwrap();
        zip.write_all(&serde_json::to_vec(&manifest).unwrap()).unwrap();
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "png") {
                zip.start_file(format!("frames/{}", path.file_name().unwrap().to_string_lossy()), opts).unwrap();
                zip.write_all(&fs::read(&path).unwrap()).unwrap();
            }
        }
        zip.finish().unwrap();
        out.into_inner()
    }

    #[test]
    fn generates_a_signed_pet_app() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let template = root.join("player/build/TypePal.app");
        if !template.exists() {
            eprintln!("skipped: template missing");
            return;
        }
        let project = mascot_project(&root.join("maker/public/assets/typepal-frames"));
        let out = tempfile::tempdir().unwrap();

        let app = generate(&project, &template, out.path(), false, false).unwrap();
        assert_eq!(app.file_name().unwrap(), "TestPet.app");
        assert!(Command::new("codesign").args(["--verify", "--strict"]).arg(&app).status().unwrap().success());

        // 384 px frames are already under 192pt × 2 (max scale) × 2 (Retina):
        // copied at their own size, never enlarged.
        let frame = image::open(app.join("Contents/Resources/Pet/frames/idle-01.png")).unwrap();
        assert_eq!(frame.dimensions(), (384, 384));
        assert!(app.join("Contents/Resources/AppIcon.icns").exists());

        let plist = String::from_utf8(
            Command::new("plutil").args(["-p"]).arg(app.join("Contents/Info.plist")).output().unwrap().stdout,
        )
        .unwrap();
        assert!(plist.contains("\"CFBundleIdentifier\" => \"io.typepal.pet.testpet\""));
        assert!(plist.contains("\"CFBundleName\" => \"TestPet\""));

        // A second run must ask before replacing, then replace when told to.
        assert!(matches!(generate(&project, &template, out.path(), false, false), Err(GenerateError::Exists(_))));
        assert!(generate(&project, &template, out.path(), true, false).is_ok());

        // Nothing left behind but the app itself.
        let leftovers: Vec<_> = fs::read_dir(out.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(leftovers, vec![std::ffi::OsString::from("TestPet.app")]);

        // CI keeps it to launch on Apple silicon.
        if let Some(keep) = std::env::var_os("TYPEPAL_SMOKE_DIR") {
            fs::create_dir_all(&keep).unwrap();
            assert!(Command::new("ditto").arg(&app).arg(Path::new(&keep).join("desktop.app")).status().unwrap().success());
        }
    }

    /// A project as the Maker sends it (baked), from `TYPEPAL_TEST_PROJECT`.
    #[test]
    fn generates_from_a_maker_project() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let template = root.join("player/build/TypePal.app");
        let Ok(path) = std::env::var("TYPEPAL_TEST_PROJECT") else {
            eprintln!("skipped: TYPEPAL_TEST_PROJECT not set");
            return;
        };
        if !template.exists() {
            eprintln!("skipped: template missing");
            return;
        }
        let project = fs::read(path).unwrap();
        let out = tempfile::tempdir().unwrap();
        let app = generate(&project, &template, out.path(), false, false).unwrap();
        assert!(Command::new("codesign").args(["--verify", "--strict"]).arg(&app).status().unwrap().success());
        let manifest: Value =
            serde_json::from_slice(&fs::read(app.join("Contents/Resources/Pet/manifest.json")).unwrap()).unwrap();
        for state in STATES {
            assert!(manifest["states"][state]["enabled"].as_bool().unwrap(), "{state}");
        }
        if let Ok(keep) = std::env::var("TYPEPAL_TEST_KEEP") {
            let _ = fs::remove_dir_all(Path::new(&keep).join(app.file_name().unwrap()));
            fs::rename(&app, Path::new(&keep).join(app.file_name().unwrap())).unwrap();
        }
    }
}
