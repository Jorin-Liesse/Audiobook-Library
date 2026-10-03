use serde::Serialize;
use std::path::{Path, PathBuf};
#[cfg(desktop)]
use std::{fs, time::UNIX_EPOCH};
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

#[cfg(target_os = "android")]
mod android;

#[cfg(any(target_os = "android", test))]
mod http;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeFile {
    source: &'static str,
    location: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    protocol: Option<&'static str>,
    name: String,
    #[serde(rename = "type")]
    mime_type: String,
    size: u64,
    last_modified: u64,
    webkit_relative_path: String,
}

#[derive(Serialize)]
pub struct NativeLibrary {
    root: String,
    name: String,
    files: Vec<NativeFile>,
}

fn selection_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("library-root.json"))
}

#[cfg(desktop)]
fn saved_root(app: &AppHandle) -> Result<PathBuf, String> {
    let bytes = fs::read(selection_path(app)?).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

fn file_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp3" => Some("audio/mpeg"),
        "m4a" | "m4b" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "ogg" | "oga" | "opus" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        "wav" => Some("audio/wav"),
        "wma" => Some("audio/x-ms-wma"),
        "webm" => Some("audio/webm"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

#[cfg(desktop)]
fn walk(
    root: &Path,
    directory: &Path,
    name: &str,
    files: &mut Vec<NativeFile>,
) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name().to_string_lossy().into_owned();
        if file_name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        // Do not follow links or Windows junctions outside the selected tree,
        // or recurse into a directory cycle.
        if metadata.file_type().is_symlink() {
            continue;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                continue;
            }
        }
        if metadata.is_dir() {
            walk(root, &path, name, files)?;
        } else if metadata.is_file() {
            if let Some(mime_type) = file_type(&path) {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|error| error.to_string())?
                    .components()
                    .map(|part| part.as_os_str().to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join("/");
                files.push(NativeFile {
                    source: "native",
                    location: path.to_string_lossy().into_owned(),
                    protocol: None,
                    name: file_name,
                    mime_type: mime_type.into(),
                    size: metadata.len(),
                    last_modified: metadata
                        .modified()
                        .ok()
                        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                        .map(|duration| duration.as_millis() as u64)
                        .unwrap_or(0),
                    webkit_relative_path: format!("{name}/{relative}"),
                });
            }
        }
    }
    Ok(())
}

#[cfg(desktop)]
fn scan(root: PathBuf) -> Result<NativeLibrary, String> {
    let root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    // Keep ordinary Windows paths in the catalogue and asset URLs.
    let root = tauri_plugin_dialog::FilePath::Path(root)
        .simplified()
        .into_path()
        .map_err(|error| error.to_string())?;
    let name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Library".into());
    let mut files = Vec::new();
    walk(&root, &root, &name, &mut files)?;
    files.sort_by(|a, b| a.webkit_relative_path.cmp(&b.webkit_relative_path));
    Ok(NativeLibrary {
        root: root.to_string_lossy().into_owned(),
        name,
        files,
    })
}

#[cfg(desktop)]
fn allow_library(app: &AppHandle, root: &Path) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(root, true)
        .map_err(|error| error.to_string())
}

#[cfg(desktop)]
async fn choose_desktop_library(app: AppHandle) -> Result<Option<NativeLibrary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(folder) = app
            .dialog()
            .file()
            .set_title("Choose your audiobook folder")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let library = scan(folder.into_path().map_err(|error| error.to_string())?)?;
        let selection = selection_path(&app)?;
        fs::create_dir_all(
            selection
                .parent()
                .ok_or("Missing application data directory")?,
        )
        .map_err(|error| error.to_string())?;
        let bytes = serde_json::to_vec(&library.root).map_err(|error| error.to_string())?;
        fs::write(selection, bytes).map_err(|error| error.to_string())?;
        allow_library(&app, Path::new(&library.root))?;
        Ok(Some(library))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(desktop)]
async fn refresh_desktop_library(app: AppHandle) -> Result<NativeLibrary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let library = scan(saved_root(&app)?)?;
        allow_library(&app, Path::new(&library.root))?;
        Ok(library)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(desktop)]
async fn check_desktop_library_access(app: AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(root) = saved_root(&app) else {
            return Ok(false);
        };
        if fs::read_dir(&root).is_err() {
            return Ok(false);
        }
        // Scopes are in memory, so restore the selected folder on each launch.
        allow_library(&app, &root)?;
        Ok(true)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn choose_library(app: AppHandle) -> Result<Option<NativeLibrary>, String> {
    #[cfg(desktop)]
    {
        choose_desktop_library(app).await
    }
    #[cfg(target_os = "android")]
    {
        android::choose(app).await
    }
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        Err("Folder selection is not supported on iOS yet".into())
    }
}

#[tauri::command]
pub async fn refresh_library(app: AppHandle) -> Result<NativeLibrary, String> {
    #[cfg(desktop)]
    {
        refresh_desktop_library(app).await
    }
    #[cfg(target_os = "android")]
    {
        android::refresh(app).await
    }
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        Err("Folder selection is not supported on iOS yet".into())
    }
}

#[tauri::command]
pub async fn check_library_access(app: AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        check_desktop_library_access(app).await
    }
    #[cfg(target_os = "android")]
    {
        android::check_access(app).await
    }
    #[cfg(target_os = "ios")]
    {
        let _ = app;
        Ok(false)
    }
}

#[tauri::command]
pub fn library_file_url(app: AppHandle, location: String) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        Ok(app.state::<http::MediaServer>().url_for(&location))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, location);
        Err("Android document streaming is only available on Android".into())
    }
}

#[cfg(target_os = "android")]
pub use android::start_server as start_android_server;
