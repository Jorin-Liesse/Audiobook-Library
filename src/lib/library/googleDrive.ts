import type { SyncState } from './syncState.ts';
import { parseState } from './syncState.ts';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const SNAPSHOT_PREFIX = 'audiobook-library-sync-v1-';
export interface DriveAccount {
  id: string;
  email: string;
  name: string;
}
export class DriveError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class GoogleDrive {
  constructor(
    private token: string,
    private request: typeof fetch = fetch,
  ) {}
  private async call(url: string, options: RequestInit = {}) {
    const response = await this.request(url, {
      ...options,
      headers: { ...options.headers, Authorization: 'Bearer ' + this.token },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const message =
        response.status === 401
          ? 'Reconnect Google Drive to continue syncing.'
          : response.status === 403
            ? 'Google Drive denied access. Enable the Drive API and grant app-data access.'
            : response.status === 429
              ? 'Google Drive is busy. Sync will retry shortly.'
              : 'Google Drive sync failed. Your changes are saved on this device.';
      throw new DriveError(response.status, message);
    }
    return response;
  }
  async account(): Promise<DriveAccount> {
    const result = await (
      await this.call(API + '/about?fields=user(permissionId,emailAddress,displayName)')
    ).json();
    if (!result.user?.permissionId || !result.user?.emailAddress)
      throw new Error('Google Drive did not identify the connected account.');
    return {
      id: result.user.permissionId,
      email: result.user.emailAddress,
      name: result.user.displayName || result.user.emailAddress,
    };
  }
  async list(): Promise<{ id: string; name: string }[]> {
    const files: { id: string; name: string }[] = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({
        spaces: 'appDataFolder',
        q: "trashed = false and name contains '" + SNAPSHOT_PREFIX + "'",
        fields: 'nextPageToken,files(id,name)',
        pageSize: '1000',
      });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await (await this.call(API + '/files?' + query)).json();
      for (const file of page.files ?? [])
        if (
          typeof file.id === 'string' &&
          typeof file.name === 'string' &&
          file.name.startsWith(SNAPSHOT_PREFIX)
        )
          files.push(file);
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return files;
  }
  async read(id: string): Promise<SyncState> {
    return parseState(
      await (await this.call(API + '/files/' + encodeURIComponent(id) + '?alt=media')).json(),
    );
  }
  async write(id: string | undefined, name: string, state: SyncState): Promise<string> {
    if (id) {
      await this.call(UPLOAD + '/files/' + encodeURIComponent(id) + '?uploadType=media', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      return id;
    }
    const boundary = 'abl_' + crypto.randomUUID().replaceAll('-', '');
    const body =
      '--' +
      boundary +
      '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({
        name,
        mimeType: 'application/json',
        parents: ['appDataFolder'],
      }) +
      '\r\n--' +
      boundary +
      '\r\nContent-Type: application/json\r\n\r\n' +
      JSON.stringify(state) +
      '\r\n--' +
      boundary +
      '--';
    const created = await (
      await this.call(UPLOAD + '/files?uploadType=multipart&fields=id', {
        method: 'POST',
        headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
        body,
      })
    ).json();
    if (typeof created.id !== 'string')
      throw new Error('Google Drive did not confirm the sync file was saved.');
    return created.id;
  }
}
