// js/remoteSync.js — Peer 接続オブジェクトを uiPlay から切り離し、循環依存を防ぐ
import { state } from './state.js';

let remoteConn = null;

export function setRemoteConnection(conn) {
    remoteConn = conn;
}

export function sendRemoteState() {
    if (!remoteConn || !remoteConn.open) return;
    const cat = state.getCurrentCategory();
    remoteConn.send({
        type: 'state',
        phase: state.showPhase,
        category: cat?.displayName || '',
        catColor: cat?.color || '#ff2d8a',
        question: state.currentQIdx + 1,
        totalQ: state.getCurrentQuestions().length,
        mode: state.getCurrentMode(),
        playing: state.animState.playing,
        paused: state.animState.paused,
        thinkingWait: state.thinkingOverlayVisible
    });
}
