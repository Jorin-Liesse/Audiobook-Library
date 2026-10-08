// Google installed-app OAuth runs in the system browser, outside the WebView.
// The loopback listener exists only during sign-in; this is not a hosted backend.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::{BufRead, BufReader, Read, Write}, net::TcpListener, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Runtime};
use tauri_plugin_opener::OpenerExt;
use url::Url;

const SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
static AUTH_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccessToken { access_token: String, expires_in: u64 }
#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    expires_in: u64,
    refresh_token: Option<String>,
    scope: Option<String>,
}
fn random() -> String {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}
fn client_id() -> Result<&'static str, String> {
    option_env!("GOOGLE_DESKTOP_CLIENT_ID").filter(|v| !v.is_empty())
        .ok_or_else(|| "Google sync needs VITE_GOOGLE_DESKTOP_CLIENT_ID in .env. Rebuild the app after setting it.".into())
}
fn entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.sapodillagames.audiobook-library.google", client_id()?)
        .map_err(|_| "The system credential store is unavailable.".into())
}
fn http() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder().timeout(Duration::from_secs(30)).build()
        .map_err(|_| "Could not create the Google authorization client.".into())
}
fn exchange(mut fields: Vec<(&str, String)>) -> Result<TokenResponse, String> {
    fields.push(("client_id", client_id()?.to_string()));
    if let Some(secret) = option_env!("GOOGLE_DESKTOP_CLIENT_SECRET").filter(|v| !v.is_empty()) {
        fields.push(("client_secret", secret.into()));
    }
    let response = http()?.post("https://oauth2.googleapis.com/token").form(&fields).send()
        .map_err(|_| "Google sign-in could not reach Google. Check your connection.".to_string())?;
    if !response.status().is_success() {
        // Never expose token endpoint bodies or credentials to logs/the WebView.
        return Err("Google authorization expired or failed. Reconnect Google Drive.".into());
    }
    let token: TokenResponse = response.json().map_err(|_| "Google returned an invalid authorization response.".to_string())?;
    if token.access_token.is_empty() || token.expires_in == 0 ||
        token.scope.as_ref().is_some_and(|scopes| !scopes.split_whitespace().any(|s| s == SCOPE)) {
        return Err("Google Drive app-data access was not granted.".into());
    }
    Ok(token)
}
fn callback(listener: TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(180);
    while Instant::now() < deadline {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|e| e.to_string())?;
                stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|e| e.to_string())?;
                let mut line = String::new();
                let mut reader = BufReader::new(&stream);
                if reader.by_ref().take(8192).read_line(&mut line).is_err() { continue; }
                let parts: Vec<_> = line.split_whitespace().collect();
                let url = parts.get(1).and_then(|target| Url::parse(&format!("http://127.0.0.1{}", target)).ok());
                let valid = parts.first() == Some(&"GET") && url.as_ref().is_some_and(|url|
                    url.path() == "/oauth2callback" && url.query_pairs().any(|(key, value)| key == "state" && value == state));
                if !valid {
                    let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                    continue;
                }
                let url = url.unwrap();
                let code = url.query_pairs().find(|(key, _)| key == "code").map(|(_, v)| v.into_owned());
                let body = "Google authorization received. You can return to Audiobook Library.";
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}", body.len(), body);
                return code.ok_or_else(|| "Google Drive access was not granted.".into());
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => return Err("Google sign-in could not receive the browser callback.".into()),
        }
    }
    Err("Google sign-in timed out. Try connecting again.".into())
}
fn authorize<R: Runtime>(app: AppHandle<R>, interactive: bool) -> Result<AccessToken, String> {
    let _guard = AUTH_LOCK.lock().map_err(|_| "Google authorization is unavailable.".to_string())?;
    let credentials = entry()?;
    let token = if !interactive {
        let refresh = credentials.get_password().map_err(|_| "Reconnect Google Drive to continue syncing.".to_string())?;
        exchange(vec![("grant_type", "refresh_token".into()), ("refresh_token", refresh)])?
    } else {
        let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| "Could not start the local Google sign-in callback.".to_string())?;
        let redirect = format!("http://127.0.0.1:{}/oauth2callback", listener.local_addr().map_err(|e| e.to_string())?.port());
        let state = random();
        let verifier = random();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = Url::parse("https://accounts.google.com/o/oauth2/v2/auth").unwrap();
        url.query_pairs_mut().extend_pairs([
            ("client_id", client_id()?), ("redirect_uri", &redirect), ("response_type", "code"),
            ("scope", SCOPE), ("state", &state), ("code_challenge", &challenge),
            ("code_challenge_method", "S256"), ("access_type", "offline"), ("prompt", "consent select_account"),
        ]);
        app.opener().open_url(url.to_string(), None::<&str>).map_err(|_| "Could not open Google sign-in in your browser.".to_string())?;
        let code = callback(listener, &state)?;
        exchange(vec![("grant_type", "authorization_code".into()), ("code", code), ("redirect_uri", redirect), ("code_verifier", verifier)])?
    };
    if let Some(refresh) = &token.refresh_token {
        credentials.set_password(refresh).map_err(|_| "Could not save Google authorization in the system credential store.".to_string())?;
    }
    Ok(AccessToken { access_token: token.access_token, expires_in: token.expires_in })
}

#[tauri::command]
pub async fn google_authorize<R: Runtime>(app: AppHandle<R>, interactive: bool) -> Result<AccessToken, String> {
    tauri::async_runtime::spawn_blocking(move || authorize(app, interactive)).await.map_err(|_| "Google sign-in was interrupted.".to_string())?
}
#[tauri::command]
pub async fn google_disconnect() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let _guard = AUTH_LOCK.lock().map_err(|_| "Google authorization is unavailable.".to_string())?;
        match entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err("Could not remove Google authorization from the system credential store.".into()),
        }
    }).await.map_err(|_| "Google disconnect was interrupted.".to_string())?
}
