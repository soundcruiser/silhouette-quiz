// js/main.js
import { state } from './state.js';
import * as uiConfig from './uiConfig.js';
import * as uiPlay from './uiPlay.js';
import * as audio from './audio.js';
import * as fileSystem from './fileSystem.js';
import * as remote from './remote.js';
import * as soundUi from './soundUi.js';

document.addEventListener('DOMContentLoaded', () => {
    setupEventDelegation();
    console.log('Phase 3: All modules loaded and wired up.');
    // fileSystem.restoreRootHandle(); // フェーズ2の関数を呼び出し
});

function setupEventDelegation() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;

        switch (action) {
            case 'switchMode': uiConfig.switchMode(target.dataset.mode); break;
            case 'openLoadConfigModal': uiConfig.openLoadConfigModal(); break;
            case 'closeLoadConfigModal': uiConfig.closeLoadConfigModal(); break;
            case 'toggleHelp': uiConfig.toggleHelp(); break;
            
            case 'testSound': audio.testSound(target.dataset.slot); break;
            case 'clearCustomSound': {
                const slot = target.dataset.slot;
                audio.clearCustomSound(slot);
                soundUi.resetSoundFileLabel(slot);
                break;
            }
            case 'stopAllPreviews': audio.stopAllPreviews(); break;
            
            case 'initRemote': remote.initRemote(); break;
            
            case 'startAnim': uiPlay.startAnim(parseInt(target.dataset.speed)); break;
            case 'reveal': uiPlay.reveal(); break;
            case 'togglePause': uiPlay.togglePause(); break;
            case 'replayAnim': uiPlay.startAnim(state.animState.lastSpeed || 2); break;
            case 'nextQuiz': uiPlay.nextQuiz(); break;
            case 'prevQuiz': uiPlay.prevQuiz(); break;
            case 'advanceShow': uiPlay.advanceShow(); break;
            default: console.warn(`Unhandled click action: ${action}`);
        }
    });

    document.addEventListener('change', (e) => {
        const target = e.target.closest('[data-change]');
        if (!target) return;
        const action = target.dataset.change;
        
        switch (action) {
            case 'loadCustomSound': {
                const slot = target.dataset.slot;
                const name = audio.loadCustomSound(slot, target);
                if (name) soundUi.setSoundFileLabel(slot, name);
                break;
            }
            // ...その他のchangeイベント
        }
    });
}