use std::{collections::HashMap, env, path::Path};

fn google_desktop_config() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let mut values = HashMap::new();
    // Match Vite's local overrides without exporting unrelated .env credentials.
    for name in [".env", ".env.local"] {
        let file = root.join(name);
        println!("cargo:rerun-if-changed={}", file.display());
        if file.exists() {
            let entries = dotenvy::from_path_iter(&file)
                .unwrap_or_else(|_| panic!("Could not read Google OAuth configuration from .env"));
            for entry in entries {
                let (key, value) = entry
                    .unwrap_or_else(|_| panic!("Invalid entry in Google OAuth .env configuration"));
                values.insert(key, value);
            }
        }
    }
    for key in [
        "VITE_GOOGLE_DESKTOP_CLIENT_ID",
        "GOOGLE_DESKTOP_CLIENT_ID",
        "GOOGLE_DESKTOP_CLIENT_SECRET",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        if let Ok(value) = env::var(key) {
            values.insert(key.to_owned(), value);
        }
    }
    let value = |key: &str| {
        values
            .get(key)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
    };
    let client_id = value("VITE_GOOGLE_DESKTOP_CLIENT_ID")
        .or_else(|| value("GOOGLE_DESKTOP_CLIENT_ID"))
        .unwrap_or_default();
    println!("cargo:rustc-env=GOOGLE_DESKTOP_CLIENT_ID={client_id}");
    let secret = value("GOOGLE_DESKTOP_CLIENT_SECRET").unwrap_or_default();
    println!("cargo:rustc-env=GOOGLE_DESKTOP_CLIENT_SECRET={secret}");
}

fn main() {
    google_desktop_config();
    tauri_build::build()
}
