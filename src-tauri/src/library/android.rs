use super::http::{MediaError, MediaServer, OpenedFile};
use super::{file_type, selection_path, NativeFile, NativeLibrary};
use std::{collections::HashSet, fs, path::Path, time::UNIX_EPOCH};
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_android_fs::{AndroidFsExt, Entry, FsUri, UriPermission};

fn saved_root(app: &AppHandle) -> Result<FsUri, String> {
    let bytes = fs::read(selection_path(app)?).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

async fn scan(app: &AppHandle, root: &FsUri) -> Result<NativeLibrary, String> {
    let api = app.android_fs_async();
    let name = api
        .get_name(root)
        .await
        .map_err(|error| error.to_string())?;
    let mut files = Vec::new();
    let mut pending = vec![(root.clone(), name.clone())];
    let mut visited = HashSet::new();
    while let Some((directory, prefix)) = pending.pop() {
        if !visited.insert(directory.uri.clone()) {
            continue;
        }
        for entry in api
            .read_dir(&directory)
            .await
            .map_err(|error| error.to_string())?
        {
            if entry.name().starts_with('.') {
                continue;
            }
            match entry {
                Entry::Dir { uri, name, .. } => {
                    pending.push((uri, format!("{prefix}/{name}")));
                }
                Entry::File {
                    uri,
                    name,
                    len,
                    last_modified,
                    mime_type,
                    ..
                } => {
                    let supported_type = file_type(Path::new(&name));
                    if supported_type.is_none() && !mime_type.starts_with("audio/") {
                        continue;
                    }
                    files.push(NativeFile {
                        source: "native",
                        // The media server expects the complete URI object,
                        // including the top tree used to resolve child documents.
                        location: uri.to_json_string().map_err(|error| error.to_string())?,
                        protocol: Some("library"),
                        webkit_relative_path: format!("{prefix}/{name}"),
                        name,
                        mime_type: supported_type.map(String::from).unwrap_or(mime_type),
                        size: len,
                        last_modified: last_modified
                            .duration_since(UNIX_EPOCH)
                            .map(|duration| duration.as_millis() as u64)
                            .unwrap_or(0),
                    });
                }
            }
        }
    }
    files.sort_by(|a, b| a.webkit_relative_path.cmp(&b.webkit_relative_path));
    Ok(NativeLibrary {
        root: root.uri.clone(),
        name,
        files,
    })
}

pub async fn choose(app: AppHandle) -> Result<Option<NativeLibrary>, String> {
    let api = app.android_fs_async();
    let previous = saved_root(&app).ok();
    let Some(root) = api
        .picker()
        .pick_dir(previous.as_ref(), true)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(None);
    };
    let library = scan(&app, &root).await?;
    api.picker()
        .persist_uri_permission(&root)
        .await
        .map_err(|error| error.to_string())?;
    let selection = selection_path(&app)?;
    fs::create_dir_all(
        selection
            .parent()
            .ok_or("Missing application data directory")?,
    )
    .map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec(&root).map_err(|error| error.to_string())?;
    fs::write(selection, bytes).map_err(|error| error.to_string())?;
    Ok(Some(library))
}

pub async fn refresh(app: AppHandle) -> Result<NativeLibrary, String> {
    scan(&app, &saved_root(&app)?).await
}

pub async fn check_access(app: AppHandle) -> Result<bool, String> {
    let Ok(root) = saved_root(&app) else {
        return Ok(false);
    };
    let api = app.android_fs_async();
    if !api
        .picker()
        .check_uri_permission(&root, UriPermission::Read)
        .await
        .map_err(|error| error.to_string())?
    {
        return Ok(false);
    }
    // Verify the provider still resolves the directory, without rescanning it.
    Ok(api.get_name(&root).await.is_ok())
}

pub fn start_server(app: &AppHandle) -> std::io::Result<()> {
    let handle = app.clone();
    let server = MediaServer::start(move |location| open_file(&handle, location))?;
    app.manage(server);
    Ok(())
}

fn open_file(app: &AppHandle, location: &str) -> Result<OpenedFile, MediaError> {
    let uri: FsUri =
        serde_json::from_str(location).map_err(|_| MediaError::new(400, "Invalid document URI"))?;
    let root =
        saved_root(app).map_err(|_| MediaError::new(403, "Choose your library folder again"))?;
    if !uri.is_content_scheme()
        || uri.document_top_tree_uri.is_none()
        || uri.document_top_tree_uri != root.document_top_tree_uri
    {
        return Err(MediaError::new(
            403,
            "Document does not belong to the selected folder",
        ));
    }
    // This callback runs on an HTTP worker, so the synchronous native API
    // cannot block the WebView's intercepted-request handler.
    let api = app.android_fs();
    let mut file = api
        .open_file_readable(&uri)
        .map_err(|error| MediaError::new(404, error.to_string()))?;
    let mut length = api
        .get_len(&uri)
        .map_err(|error| MediaError::new(404, error.to_string()))?;
    if length == 0 {
        use std::io::{Seek, SeekFrom};
        length = file
            .seek(SeekFrom::End(0))
            .map_err(|error| MediaError::new(500, error.to_string()))?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| MediaError::new(500, error.to_string()))?;
    }
    let name = api.get_name(&uri).unwrap_or_default();
    let mime_type = file_type(Path::new(&name))
        .map(String::from)
        .unwrap_or_else(|| {
            api.get_mime_type(&uri)
                .unwrap_or_else(|_| "application/octet-stream".into())
        });
    Ok(OpenedFile {
        file,
        length,
        mime_type,
    })
}
