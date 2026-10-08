import { invoke } from '@tauri-apps/api/core';
import { isNativeApp } from './native.ts';
import { isAndroidApp } from './androidAudio.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
export interface GoogleToken {
  accessToken: string;
  expiresIn: number;
}
interface TokenResponse {
  access_token?: string;
  expires_in: number;
  scope?: string;
  error?: string;
}
interface GoogleOAuth {
  initTokenClient(options: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: (error: { type: string }) => void;
  }): {
    requestAccessToken(options: { prompt: string; login_hint?: string }): void;
  };
}
const oauth = () =>
  (window as Window & { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts
    ?.oauth2;
let script: Promise<void> | undefined;
export function prepareGoogleAuth() {
  if (isNativeApp() || oauth()) return Promise.resolve();
  return (script ??= new Promise<void>((resolve, reject) => {
    const element = document.createElement('script');
    element.src = 'https://accounts.google.com/gsi/client';
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => {
      script = undefined;
      element.remove();
      reject(new Error('Google sign-in could not load. Check your connection and try again.'));
    };
    document.head.append(element);
  }));
}

export function authorizeGoogle(interactive: boolean, email?: string): Promise<GoogleToken> {
  if (isAndroidApp())
    return invoke('plugin:google-drive|authorize', {
      interactive,
      email: email ?? null,
    });
  if (isNativeApp()) return invoke('google_authorize', { interactive });
  const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim();
  if (!clientId)
    return Promise.reject(
      new Error('Google sync needs a web OAuth client ID. See docs/google-drive-sync.md.'),
    );
  // Browser token renewal requires a click; never open popups from a timer.
  if (!interactive) return Promise.reject(new Error('Reconnect Google Drive to continue syncing.'));
  const api = oauth();
  if (!api) {
    void prepareGoogleAuth().catch(() => {});
    return Promise.reject(new Error('Google sign-in is loading. Try again in a moment.'));
  }
  return new Promise((resolve, reject) => {
    const client = api.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      include_granted_scopes: false,
      callback: (response) => {
        if (
          response.error ||
          !response.access_token ||
          !response.scope?.split(' ').includes(DRIVE_SCOPE)
        )
          reject(new Error('Google Drive app-data access was not granted.'));
        else
          resolve({
            accessToken: response.access_token,
            expiresIn: response.expires_in,
          });
      },
      error_callback: () =>
        reject(new Error('Google sign-in was closed or blocked. Try connecting again.')),
    });
    client.requestAccessToken({
      prompt: email ? '' : 'select_account',
      login_hint: email,
    });
  });
}

export async function forgetGoogle() {
  if (isNativeApp() && !isAndroidApp()) await invoke('google_disconnect');
}

export async function invalidateGoogle(accessToken: string) {
  if (isAndroidApp()) await invoke('plugin:google-drive|invalidate', { accessToken });
}
