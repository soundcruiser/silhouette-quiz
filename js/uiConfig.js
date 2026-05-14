// js/uiConfig.js
import { state } from './state.js';
import * as audio from './audio.js';
import * as fileSystem from './fileSystem.js';
import * as uiPlay from './uiPlay.js';

export function switchMode(mode) {
    document.getElementById('config-mode').style.display = mode === 'config' ? 'block' : 'none';
    document.getElementById('play-mode').style.display = mode === 'play' ? 'block' : 'none';
    document.getElementById('nav-config').classList.toggle('active', mode === 'config');
    document.getElementById('nav-play').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('is-playing', mode === 'play');
    document.documentElement.classList.toggle('play-scroll-lock', mode === 'play');
    
    if (mode === 'play') {
        audio.stopAllPreviews();
        state.currentSetIdx = 0;
        state.currentQIdx = 0;
        uiPlay.enterStartupSplash();
    } else {
        // uiPlay.hideThinkingOverlay(); // uiPlayに実装されている関数を呼ぶ
        audio.stopAllPreviews();
        audio.stopBGM();
        // uiPlay.hideShowOverlay();
    }
}

export function toggleHelp() {
    const overlay = document.getElementById('help-overlay');
    overlay.classList.toggle('visible');
}

export function openLoadConfigModal() {
    const modal = document.getElementById('load-config-modal');
    if (!modal) return;
    document.getElementById('load-modal-step1').classList.remove('hidden');
    document.getElementById('load-modal-step2').classList.add('hidden');
    document.getElementById('load-modal-json').value = '';
    modal.classList.add('visible');
}

export function closeLoadConfigModal() {
    const modal = document.getElementById('load-config-modal');
    if (!modal) return;
    modal.classList.remove('visible');
}

// 既存の bulkColor, toggleCategoryMode, removeFromSetlist, renderSetlist などの
// セットリストやグリッド操作系の関数群をここに移設します。