use serde_json::Value;
use tauri::{plugin::{Builder, PluginHandle, TauriPlugin}, AppHandle, Manager, Runtime};

struct GoogleDrive<R: Runtime>(PluginHandle<R>);

#[tauri::command]
async fn authorize<R: Runtime>(app: AppHandle<R>, interactive: bool, email: Option<String>) -> Result<Value, String> {
    app.state::<GoogleDrive<R>>().0.run_mobile_plugin("authorize",
        serde_json::json!({ "interactive": interactive, "email": email }))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn invalidate<R: Runtime>(app: AppHandle<R>, access_token: String) -> Result<Value, String> {
    app.state::<GoogleDrive<R>>().0.run_mobile_plugin("invalidate",
        serde_json::json!({ "accessToken": access_token }))
        .map_err(|error| error.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("google-drive")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.sapodillagames.googledrive", "GoogleDrivePlugin")?;
            app.manage(GoogleDrive(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![authorize, invalidate])
        .build()
}
