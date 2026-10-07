fn main() {
    tauri_plugin::Builder::new(&["authorize", "invalidate"])
        .android_path("android")
        .build();
}
