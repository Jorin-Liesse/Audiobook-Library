#[cfg(desktop)]
mod google_auth;
mod library;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        google_auth::google_authorize,
        google_auth::google_disconnect,
        library::choose_library,
        library::refresh_library,
        library::check_library_access,
        library::library_file_url
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        library::choose_library,
        library::refresh_library,
        library::check_library_access,
        library::library_file_url
    ]);

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_android_fs::init())
        .plugin(tauri_plugin_native_audio::init())
        .plugin(tauri_plugin_google_drive::init())
        .setup(|app| {
            library::start_android_server(app.handle())?;
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
