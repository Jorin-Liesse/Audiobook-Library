import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import type { LibraryFile, NativeFile, NativeLibrary } from '#lib/types/library.ts';

export const isNativeApp = () => typeof window !== 'undefined' && isTauri();
export const isNativeFile = (file: LibraryFile): file is NativeFile =>
  'source' in file && file.source === 'native';

export const chooseNativeLibrary = () => invoke<NativeLibrary | null>('choose_library');
export const refreshNativeLibrary = () => invoke<NativeLibrary>('refresh_library');
export const checkNativeAccess = () => invoke<boolean>('check_library_access');

// The platform's file transport serves the original files with byte ranges.
// No audiobook bytes pass through IPC or IndexedDB.
export const nativeFileUrl = async (file: NativeFile): Promise<string> =>
  file.protocol === 'library'
    ? invoke<string>('library_file_url', { location: file.location })
    : convertFileSrc(file.location, 'asset');
