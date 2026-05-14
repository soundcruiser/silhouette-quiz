// js/audio.js
import * as CONSTANTS from './constants.js';

export const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export const customSounds = {};
CONSTANTS.SOUND_CONFIG_SLOTS.forEach((slot) => {
    customSounds[slot] = {
        audio: null,
        fileName: null,
        volume: slot === 'bgm' ? 0.3 : slot === 'thinkingLoop' ? 0.35 : 0.5
    };
});

const activeCustomClonedAudio = new Set();
let bgmThinkingFadeGen = 0;
let previewAudio = null;
let thinkingLoopAudioEl = null;
let thinkingLoopIntervalId = null;
let thinkingLoopPreviewTimer = null;

function getVolume(slot) {
    return customSounds[slot]?.volume ?? 0.5;
}

export function playCustomOrDefault(slot, defaultFn) {
    if (customSounds[slot].audio) {
        const a = customSounds[slot].audio.cloneNode();
        a.loop = false;
        a.volume = customSounds[slot].volume;
        activeCustomClonedAudio.add(a);
        const detach = () => activeCustomClonedAudio.delete(a);
        a.addEventListener('ended', detach, { once: true });
        a.addEventListener('error', detach, { once: true });
        a.play().catch(detach);
    } else if (defaultFn) {
        defaultFn();
    }
}

export function playTone(freq, duration, type = 'sine', gainVal = 0.15) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gainVal, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

export function playRevealSound() {
    const v = customSounds.reveal.volume;
    playCustomOrDefault('reveal', () => {
        playTone(523, 0.12, 'square', v * 0.24);
        setTimeout(() => playTone(659, 0.12, 'square', v * 0.24), 80);
        setTimeout(() => playTone(784, 0.12, 'square', v * 0.3), 160);
        setTimeout(() => playTone(1047, 0.4, 'sine', v * 0.4), 240);
    });
}

export function playStartSound(speedNum) {
    const slot = 'start' + (speedNum || 2);
    const v = customSounds[slot].volume;
    playCustomOrDefault(slot, () => {
        playTone(330, 0.08, 'square', v * 0.16);
    });
}

function playCountdownTick(remaining) {
    const cdTones = [523, 587, 659, 784, 880];
    const v = getVolume('countdown');
    playCustomOrDefault('countdown', () => {
        playTone(cdTones[remaining % cdTones.length], 0.12, 'sine', v * 0.3);
    });
}

function playOpeningSound() {
    const v = getVolume('opening');
    playCustomOrDefault('opening', () => {
        playTone(392, 0.11, 'triangle', v * 0.2);
        setTimeout(() => playTone(523, 0.12, 'triangle', v * 0.24), 95);
        setTimeout(() => playTone(659, 0.14, 'sine', v * 0.26), 210);
        setTimeout(() => playTone(784, 0.16, 'sine', v * 0.22), 360);
    });
}

function playCategorySound() {
    const v = getVolume('category');
    playCustomOrDefault('category', () => {
        playTone(523, 0.1, 'triangle', v * 0.22);
        setTimeout(() => playTone(659, 0.12, 'triangle', v * 0.26), 95);
    });
}

function playQIntroSound() {
    const v = getVolume('qIntro');
    playCustomOrDefault('qIntro', () => {
        playTone(784, 0.07, 'sine', v * 0.28);
        setTimeout(() => playTone(988, 0.07, 'sine', v * 0.32), 70);
        setTimeout(() => playTone(1175, 0.14, 'sine', v * 0.26), 140);
    });
}

function playQAfterSound() {
    const v = getVolume('qAfter');
    playCustomOrDefault('qAfter', () => {
        playTone(659, 0.12, 'triangle', v * 0.24);
        setTimeout(() => playTone(880, 0.11, 'sine', v * 0.22), 90);
    });
}

function playEndingSound() {
    const v = getVolume('ending');
    playCustomOrDefault('ending', () => {
        playTone(523, 0.12, 'triangle', v * 0.22);
        setTimeout(() => playTone(659, 0.14, 'sine', v * 0.26), 100);
        setTimeout(() => playTone(784, 0.18, 'sine', v * 0.28), 220);
        setTimeout(() => playTone(1047, 0.22, 'sine', v * 0.24), 380);
    });
}

export function startBGM() {
    const a = customSounds.bgm.audio;
    if (!a) return;
    a.loop = true;
    if (thinkingLoopAudioEl !== null || thinkingLoopIntervalId !== null) {
        rampBgmVolume(customSounds.bgm.volume * CONSTANTS.THINKING_BGM_DUCK_MULT, Math.min(CONSTANTS.THINKING_BGM_DUCK_OUT_MS, 200));
    } else {
        bgmThinkingFadeGen++;
        a.volume = customSounds.bgm.volume;
    }
    if (a.paused) a.play().catch(() => {});
}

export function stopBGM() {
    if (customSounds.bgm.audio) {
        bgmThinkingFadeGen++;
        customSounds.bgm.audio.pause();
        customSounds.bgm.audio.currentTime = 0;
    }
}

function rampBgmVolume(toLinear, durationMs) {
    const a = customSounds.bgm.audio;
    if (!a) return;
    if (durationMs <= 0) {
        a.volume = Math.max(0, Math.min(1, toLinear));
        return;
    }
    const myGen = ++bgmThinkingFadeGen;
    const from = a.volume;
    const t0 = performance.now();
    const tick = (now) => {
        if (myGen !== bgmThinkingFadeGen) return;
        const u = Math.min(1, (now - t0) / durationMs);
        a.volume = Math.max(0, Math.min(1, from + (toLinear - from) * u));
        if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/**
 * @returns {string|null} 読み込んだファイル名（未選択時は null）
 */
export function loadCustomSound(slot, input) {
    const file = input.files[0];
    if (!file) return null;
    const url = URL.createObjectURL(file);
    const audioEl = new Audio(url);
    audioEl.preload = 'auto';

    if (customSounds[slot].audio) {
        customSounds[slot].audio.pause();
        URL.revokeObjectURL(customSounds[slot].audio.src);
    }
    customSounds[slot].audio = audioEl;
    customSounds[slot].fileName = file.name;
    audioEl.volume = customSounds[slot].volume;
    input.value = '';
    return file.name;
}

export function clearCustomSound(slot) {
    if (customSounds[slot].audio) {
        if (slot === 'bgm') bgmThinkingFadeGen++;
        customSounds[slot].audio.pause();
        URL.revokeObjectURL(customSounds[slot].audio.src);
        customSounds[slot].audio = null;
    }
    customSounds[slot].fileName = null;
}

export function testSound(slot) {
    if (slot === 'thinkingLoop') {
        const btn = document.getElementById('sound-test-thinkingLoop');
        if (btn && btn.classList.contains('playing')) {
            if (thinkingLoopPreviewTimer) {
                clearTimeout(thinkingLoopPreviewTimer);
                thinkingLoopPreviewTimer = null;
            }
            if (previewAudio) {
                try {
                    previewAudio.pause();
                    previewAudio.currentTime = 0;
                } catch (e) {
                    /* ignore */
                }
                try {
                    previewAudio.remove();
                } catch (e) {
                    /* ignore */
                }
                previewAudio = null;
            }
            btn.classList.remove('playing');
            btn.textContent = '▶';
            return;
        }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    stopAllPreviews();

    if (slot === 'bgm') {
        if (!customSounds.bgm.audio) return;
        previewAudio = customSounds.bgm.audio;
        previewAudio.loop = false;
        previewAudio.volume = getVolume('bgm');
        previewAudio.currentTime = 0;
        previewAudio.play().catch(() => {});
        const btn = document.getElementById('sound-test-bgm');
        if (btn) {
            btn.classList.add('playing');
            btn.textContent = '■';
            previewAudio.onended = () => {
                btn.classList.remove('playing');
                btn.textContent = '▶';
                previewAudio = null;
            };
        }
    } else if (slot === 'start1' || slot === 'start2' || slot === 'start3') {
        playStartSound(parseInt(slot.charAt(5), 10));
    } else if (slot === 'reveal') {
        playRevealSound();
    } else if (slot === 'countdown') {
        playCountdownTick(3);
    } else if (slot === 'opening') {
        if (!customSounds.opening.audio) playOpeningSound();
    } else if (slot === 'category') {
        playCategorySound();
    } else if (slot === 'qIntro') {
        playQIntroSound();
    } else if (slot === 'qAfter') {
        playQAfterSound();
    } else if (slot === 'ending') {
        if (!customSounds.ending.audio) playEndingSound();
    } else if (slot === 'thinkingLoop') {
        const btn = document.getElementById('sound-test-thinkingLoop');
        const resetBtn = () => {
            if (btn) {
                btn.classList.remove('playing');
                btn.textContent = '▶';
            }
        };
        if (customSounds.thinkingLoop.audio) {
            const a = customSounds.thinkingLoop.audio.cloneNode();
            a.loop = true;
            a.volume = getVolume('thinkingLoop');
            a.setAttribute('data-thinking-loop-preview', '');
            a.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;';
            document.body.appendChild(a);
            previewAudio = a;
            a.play().catch(() => {});
            if (btn) {
                btn.classList.add('playing');
                btn.textContent = '■';
            }
        } else {
            const v = getVolume('thinkingLoop');
            playTone(392, 0.055, 'sine', v * 0.11);
            setTimeout(() => playTone(523, 0.07, 'sine', v * 0.09), 130);
            if (btn) {
                btn.classList.add('playing');
                btn.textContent = '■';
            }
            thinkingLoopPreviewTimer = setTimeout(() => {
                thinkingLoopPreviewTimer = null;
                resetBtn();
            }, 900);
        }
    }

    if (customSounds[slot].audio && slot !== 'bgm' && slot !== 'thinkingLoop') {
        previewAudio = customSounds[slot].audio.cloneNode();
        previewAudio.volume = getVolume(slot);
        previewAudio.play().catch(() => {});
        const btn = document.getElementById('sound-test-' + slot);
        if (btn) {
            btn.classList.add('playing');
            btn.textContent = '■';
            previewAudio.onended = () => {
                btn.classList.remove('playing');
                btn.textContent = '▶';
                previewAudio = null;
            };
        }
    }
}

export function stopAllPreviews() {
    if (thinkingLoopPreviewTimer) {
        clearTimeout(thinkingLoopPreviewTimer);
        thinkingLoopPreviewTimer = null;
    }
    activeCustomClonedAudio.forEach((a) => {
        try {
            a.pause();
            a.currentTime = 0;
        } catch (e) {
            /* ignore */
        }
    });
    activeCustomClonedAudio.clear();
    if (previewAudio) {
        try {
            previewAudio.pause();
            previewAudio.currentTime = 0;
        } catch (e) {
            /* ignore */
        }
        try {
            previewAudio.remove();
        } catch (e) {
            /* ignore */
        }
        previewAudio = null;
    }
    document.querySelectorAll('.sound-test-btn').forEach((btn) => {
        btn.classList.remove('playing');
        btn.textContent = '▶';
    });
    if (customSounds.bgm.audio) {
        bgmThinkingFadeGen++;
        customSounds.bgm.audio.pause();
        customSounds.bgm.audio.currentTime = 0;
    }
}
