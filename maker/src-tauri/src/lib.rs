//! The Maker's native side: the few things a browser cannot do.
//!
//! The UI never calls these directly; it goes through `src/platform/tauri.ts`,
//! so the same UI runs as a plain web page when they are absent.

mod generator;

use std::path::PathBuf;
use tauri::ipc::{Request, Response};
use tauri::path::BaseDirectory;
use tauri::Manager;

/// Header names for the binary-body commands. Bytes travel as the raw request
/// body — far cheaper than a JSON array of numbers for a project full of
/// images — so the other arguments ride along as headers.
const PATH_HEADER: &str = "x-path";
const OVERWRITE_HEADER: &str = "x-overwrite";
const KEY_HEADER: &str = "x-key";
const LANG_HEADER: &str = "x-lang";

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let value = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("missing header {name}"))?;
    // Paths may hold any characters, so the front end percent-encodes them.
    let raw = value.to_str().map_err(|e| e.to_string())?;
    percent_decode(raw)
}

fn body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("expected a binary body".into()),
    }
}

#[tauri::command]
fn read_binary(path: String) -> Result<Response, String> {
    std::fs::read(&path)
        .map(Response::new)
        .map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_binary(request: Request) -> Result<(), String> {
    let path = header(&request, PATH_HEADER)?;
    std::fs::write(&path, body(&request)?).map_err(|e| format!("{path}: {e}"))
}

/// The Maker's own storage: one file per key in the app's data folder, where
/// projects are kept as they are edited.
fn store_path(app: &tauri::AppHandle, key: &str) -> Result<PathBuf, String> {
    if key.is_empty() || key.len() > 64 || !key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-') {
        return Err(format!("invalid key {key}"));
    }
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("store");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(key))
}

#[tauri::command]
fn store_set(app: tauri::AppHandle, request: Request) -> Result<(), String> {
    let path = store_path(&app, &header(&request, KEY_HEADER)?)?;
    // Written aside and renamed, so a crash mid-write never leaves half a file.
    let partial = path.with_extension("partial");
    std::fs::write(&partial, body(&request)?).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn store_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    match std::fs::remove_file(store_path(&app, &key)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[tauri::command]
fn store_get(app: tauri::AppHandle, key: String) -> Result<Response, String> {
    Ok(Response::new(std::fs::read(store_path(&app, &key)?).unwrap_or_default()))
}

/// Default destination for generated pets: `~/Applications`, where Launchpad
/// and Spotlight find them without asking for admin rights.
#[tauri::command]
fn default_output_dir(app: tauri::AppHandle) -> Result<String, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join("Applications").to_string_lossy().into_owned())
}

/// Body: the `.typepalproj` bytes. Headers: destination folder, and whether
/// an existing app of the same name may be replaced. Errors come back as
/// `CODE:detail` so the UI can ask before overwriting.
#[tauri::command]
fn generate_app(app: tauri::AppHandle, request: Request) -> Result<String, String> {
    let out_dir = PathBuf::from(header(&request, PATH_HEADER)?);
    let overwrite = header(&request, OVERWRITE_HEADER).map(|v| v == "1").unwrap_or(false);
    let template = app
        .path()
        .resolve("TypePal.app", BaseDirectory::Resource)
        .map_err(|e| format!("ERROR:{e}"))?;
    let english = header(&request, LANG_HEADER).map(|v| v == "en").unwrap_or(false);
    generator::generate(body(&request)?, &template, &out_dir, overwrite, english)
        .map(|p| p.to_string_lossy().into_owned())
        .map_err(|e| e.to_wire())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .status()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_app(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .status()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Opens a web page in the default browser. Only https links, so the page
/// can never ask the system to open a file or an app.
#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err(format!("not an https link: {url}"));
    }
    std::process::Command::new("open")
        .arg(&url)
        .status()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

fn percent_decode(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|e| e.to_string())?;
            out.push(u8::from_str_radix(hex, 16).map_err(|e| e.to_string())?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_binary,
            write_binary,
            store_get,
            store_set,
            store_delete,
            default_output_dir,
            generate_app,
            reveal_in_finder,
            open_app,
            open_link
        ])
        .run(tauri::generate_context!())
        .expect("error while running TypePalMaker");
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn decodes_percent_encoded_paths() {
        assert_eq!(percent_decode("/Users/a%20b/%E5%B0%8F%E5%92%AA").unwrap(), "/Users/a b/小咪");
        assert_eq!(percent_decode("plain").unwrap(), "plain");
    }
}
