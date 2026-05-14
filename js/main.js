// js/main.js
import * as uiConfig from './uiConfig.js';
import * as uiPlay from './uiPlay.js';
import * as audio from './audio.js';
import * as remote from './remote.js';
import * as soundUi from './soundUi.js';

document.addEventListener('DOMContentLoaded', () => {
    try {
        setupEventDelegation();
        uiConfig.toggleCountdownInput();
        uiConfig.initFloatingShapesDelegation();
        uiPlay.applyThinkingShapesFromForm();
        void uiConfig.bootstrapFromStoredFolder().catch((err) => {
            console.error('[bootstrapFromStoredFolder]', err);
        });
        uiConfig.setupPlayChrome();
        uiConfig.setupKeyboardShortcuts();
        document.addEventListener(
            'pointerdown',
            () => {
                if (audio.audioCtx?.state === 'suspended') void audio.audioCtx.resume();
            },
            { once: true, capture: true }
        );
        console.log('Phase 3: All modules loaded and wired up.');
    } catch (err) {
        console.error('[DOMContentLoaded init]', err);
    }
});

function setupEventDelegation() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;

        switch (action) {
            case 'switchMode':
                uiConfig.switchMode(target.dataset.mode);
                break;
            case 'openLoadConfigModal':
                uiConfig.openLoadConfigModal();
                break;
            case 'closeLoadConfigModal':
                uiConfig.closeLoadConfigModal();
                break;
            case 'closeModalOutside':
                if (e.target.id === 'load-config-modal') {
                    uiConfig.closeLoadConfigModal();
                }
                break;
            case 'toggleHelp':
                uiConfig.toggleHelp();
                break;
            case 'stopPropagation':
                e.stopPropagation();
                break;

            case 'requestDirectoryAccess':
                void uiConfig.requestDirectoryAccess();
                break;
            case 'saveConfig':
                void uiConfig.saveConfig();
                break;
            case 'bulkColor':
                uiConfig.bulkColor(target.dataset.value === 'true');
                break;
            case 'setAllModes':
                uiConfig.setAllModes(target.dataset.mode);
                break;
            case 'addAllFoldersToSetlist':
                void uiConfig.addAllFoldersToSetlist();
                break;
            case 'closeCategoryDetail':
                uiConfig.closeCategoryDetail();
                break;

            case 'setlistCycleColor':
                uiConfig.setlistCycleColor(target.dataset.idx);
                break;
            case 'setlistToggleMode':
                uiConfig.setlistToggleMode(target.dataset.idx);
                break;
            case 'setlistOpenDetail':
                uiConfig.setlistOpenDetail(target.dataset.idx);
                break;
            case 'setlistRemove':
                uiConfig.setlistRemove(target.dataset.idx);
                break;

            case 'loadModalPickFolder':
                void uiConfig.loadModalPickFolder();
                break;
            case 'triggerJsonSelect':
                uiConfig.triggerJsonSelect();
                break;

            case 'testSound':
                audio.testSound(target.dataset.slot);
                break;
            case 'clearCustomSound': {
                const slot = target.dataset.slot;
                audio.clearCustomSound(slot);
                soundUi.resetSoundFileLabel(slot);
                break;
            }
            case 'stopAllPreviews':
                audio.stopAllPreviews();
                break;

            case 'initRemote':
                remote.initRemote();
                break;

            case 'startAnim':
                uiPlay.startAnim(parseInt(target.dataset.speed, 10));
                break;
            case 'reveal':
                uiPlay.reveal();
                break;
            case 'togglePause':
                uiPlay.togglePause();
                break;
            case 'replayAnim':
                uiPlay.replayAnim();
                break;
            case 'nextQuiz':
                uiPlay.nextQuiz();
                break;
            case 'prevQuiz':
                uiPlay.prevQuiz();
                break;
            case 'advanceShow':
                uiPlay.advanceShow();
                break;

            default:
                console.warn(`Unhandled click action: ${action}`);
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
            case 'toggleCountdownInput':
                uiConfig.toggleCountdownInput();
                break;
            case 'loadConfigFromModalJson':
                void uiConfig.loadConfigFromModalJson(target);
                break;
            case 'setlistDisplayName':
                uiConfig.setlistDisplayName(target.dataset.idx, target.value);
                break;
            case 'gridToggleColor':
                uiConfig.gridToggleColor(target.dataset.idx, target.checked);
                break;
            default:
                console.warn(`Unhandled change action: ${action}`);
        }
    });

    document.addEventListener('input', (e) => {
        const target = e.target.closest('[data-input]');
        if (!target) return;
        const kind = target.dataset.input;
        if (kind === 'updateVolume') {
            uiConfig.updateVolume(target.dataset.slot, target.value);
        }
    });
}
