fn main() {
    tauri_plugin::Builder::new(&["load", "status", "play", "pause", "seek", "stop"])
        .android_path("android")
        .build();
}
