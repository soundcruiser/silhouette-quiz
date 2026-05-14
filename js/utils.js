// js/utils.js
import { state } from './state.js';

/**
 * メモリリークを防ぐため、生成したObjectURLを一括破棄する
 */
export function revokeAllUrls() {
    state.objectUrls.forEach(url => URL.revokeObjectURL(url));
    state.objectUrls = [];
}

/**
 * FileSystemFileHandle から一時的な表示用URLを生成する
 * @param {Object} item - { handle: FileSystemFileHandle } を持つオブジェクト
 * @returns {Promise<string>} 生成されたURL
 */
export async function getFileUrl(item) {
    try {
        const file = await item.handle.getFile();
        const url = URL.createObjectURL(file);
        state.objectUrls.push(url);
        return url;
    } catch (e) {
        console.error("Failed to generate file URL:", e);
        return "";
    }
}

/**
 * 浮遊シェイプ用の文字列を安全にエスケープする
 */
export function escapeForShapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}