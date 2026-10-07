use serde_json::Value;
use tauri::{
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

struct NativeAudio<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn load<R: Runtime>(app: AppHandle<R>, request: Value) -> Result<Value, String> {
    let audio = app.state::<NativeAudio<R>>();
    audio.0.run_mobile_plugin("load", request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn seek<R: Runtime>(app: AppHandle<R>, position: f64) -> Result<Value, String> {
    let audio = app.state::<NativeAudio<R>>();
    audio.0.run_mobile_plugin("seek", serde_json::json!({ "position": position }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let audio = app.state::<NativeAudio<R>>();
    audio.0.run_mobile_plugin("status", serde_json::json!({}))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn play<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let audio = app.state::<NativeAudio<R>>();
    audio.0.run_mobile_plugin("play", serde_json::json!({}))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn pause<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let audio = app.state::<NativeAudio<R>>();
    audio.0.run_mobile_plugin("pause", serde_json::json!({}))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn stop<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let audio = app.state::<NativeAudio<R>>();
    audio.0.run_mobile_plugin("stop", serde_json::json!({}))
        .map_err(|error| error.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("native-audio")
        .setup(|app, api| {
            let handle =
                api.register_android_plugin("com.sapodillagames.nativeaudio", "NativeAudioPlugin")?;
            app.manage(NativeAudio(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![load, status, play, pause, seek, stop])
        .build()
}
