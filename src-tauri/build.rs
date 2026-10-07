fn main() {
    for key in ["GOOGLE_DESKTOP_CLIENT_ID", "GOOGLE_DESKTOP_CLIENT_SECRET"] {
        println!("cargo:rerun-if-env-changed={}", key);
        if let Ok(value) = std::env::var(key) {
            println!("cargo:rustc-env={}={}", key, value);
        }
    }
    tauri_build::build()
}
