// js/fileSystem.js
import { state } from './state.js';
import * as CONSTANTS from './constants.js';

/**
 * DBを開き、ハンドル保存用ストアを準備する
 */
export function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(CONSTANTS.DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(CONSTANTS.DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * 選択したルートディレクトリのハンドルをIndexedDBに保存する
 */
export async function saveRootHandle(handle) {
    const db = await openDB();
    const tx = db.transaction(CONSTANTS.DB_STORE, 'readwrite');
    tx.objectStore(CONSTANTS.DB_STORE).put(handle, 'rootDir');
    return new Promise(r => { tx.oncomplete = r; });
}

/**
 * 次回起動時に前回選択したディレクトリの権限を再要求し復元する
 */
export async function restoreRootHandle() {
    try {
        const db = await openDB();
        const tx = db.transaction(CONSTANTS.DB_STORE, 'readonly');
        const req = tx.objectStore(CONSTANTS.DB_STORE).get('rootDir');
        const handle = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        
        if (!handle) return false;
        
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return false;
        
        state.rootHandle = handle;
        return true;
    } catch {
        return false;
    }
}

/**
 * ローカルディレクトリの書き込み権限付きでBlobを保存する
 */
export async function writeBlobToRelativePath(rootDir, relativePath, blob) {
    const parts = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length === 0) throw new Error('empty path');
    const fileName = parts.pop();
    let dir = rootDir;
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fh = await dir.getFileHandle(fileName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
}

/**
 * サウンド等の相対パスからFileHandleを解決する
 */
export async function tryResolveSoundFileHandle(rootDir, fileRef) {
    if (!fileRef || typeof fileRef !== 'string') return null;
    const normalized = fileRef.replace(/\\/g, '/').trim();
    const parts = normalized.split('/').filter(Boolean);
    try {
        if (parts.length >= 2) {
            let dir = rootDir;
            for (let i = 0; i < parts.length - 1; i++) {
                dir = await dir.getDirectoryHandle(parts[i]);
            }
            return await dir.getFileHandle(parts[parts.length - 1]);
        }
        const base = parts[0];
        try {
            const sd = await rootDir.getDirectoryHandle(CONSTANTS.SOUND_PACK_DIR);
            return await sd.getFileHandle(base);
        } catch (_) {}
        return await rootDir.getFileHandle(base);
    } catch (_) {
        return null;
    }
}

/**
 * 設定オブジェクトをJSONとしてダウンロードする（フォールバック用）
 */
export function downloadConfigJsonFile(config) {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `setlist_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}