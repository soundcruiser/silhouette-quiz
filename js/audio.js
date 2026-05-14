// js/audio.js
import * as CONSTANTS from './constants.js';
import { state } from './state.js';

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

/** オープニング画面のカスタム音ループ（Web Audio + 継ぎ目クロスフェード） */
let openingDecodedBuffer = null;
let openingDecodeGeneration = 0;
/** @type {null | {
 *   mode: 'crossfade' | 'simple',
 *   masterGain: GainNode,
 *   segments: Array<{ src: AudioBufferSourceNode; g: GainNode }>,
 *   refillId: ReturnType<typeof setInterval> | null,
 *   buffer: AudioBuffer,
 *   dur: number,
 *   xfade: number,
 *   period: number,
 *   tAnchor: number,
 *   lastScheduledIdx: number,
 *   simpleSrc?: AudioBufferSourceNode
 * }} */
let openingLoopState = null;
let openingHtmlLoopFallback = null;

function getVolume(slot) {
    return customSounds[slot]?.volume ?? 0.5;
}

function cancelBgmThinkingFade() {
    bgmThinkingFadeGen++;
}

function isThinkingLoopSeActiveForBgmDuck() {
    return thinkingLoopAudioEl !== null || thinkingLoopIntervalId !== null;
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

function getTargetBgmVolumeLinear() {
    const base = getVolume('bgm');
    if (isThinkingLoopSeActiveForBgmDuck()) return base * CONSTANTS.THINKING_BGM_DUCK_MULT;
    return base;
}

export function syncBgmElementVolumeImmediate() {
    const a = customSounds.bgm.audio;
    if (!a) return;
    cancelBgmThinkingFade();
    a.volume = getTargetBgmVolumeLinear();
}

function duckBgmForThinkingLoop() {
    if (!customSounds.bgm.audio) return;
    const target = getVolume('bgm') * CONSTANTS.THINKING_BGM_DUCK_MULT;
    rampBgmVolume(target, CONSTANTS.THINKING_BGM_DUCK_OUT_MS);
}

function restoreBgmAfterThinkingLoop() {
    if (!customSounds.bgm.audio) return;
    rampBgmVolume(getVolume('bgm'), CONSTANTS.THINKING_BGM_DUCK_IN_MS);
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

export function playCountdownTick(remaining) {
    const cdTones = [523, 587, 659, 784, 880];
    const v = getVolume('countdown');
    playCustomOrDefault('countdown', () => {
        playTone(cdTones[remaining % cdTones.length], 0.12, 'sine', v * 0.3);
    });
}

function playOpeningDefaultJingle() {
    const v = getVolume('opening');
    playTone(392, 0.11, 'triangle', v * 0.2);
    setTimeout(() => playTone(523, 0.12, 'triangle', v * 0.24), 95);
    setTimeout(() => playTone(659, 0.14, 'sine', v * 0.26), 210);
    setTimeout(() => playTone(784, 0.16, 'sine', v * 0.22), 360);
}

function playOpeningSound() {
    playCustomOrDefault('opening', playOpeningDefaultJingle);
}

export function invalidateOpeningDecodedBuffer() {
    openingDecodeGeneration++;
    openingDecodedBuffer = null;
}

async function decodeOpeningBufferForLoop() {
    const el = customSounds.opening.audio;
    if (!el?.src) return null;
    if (openingDecodedBuffer) return openingDecodedBuffer;
    const myGen = openingDecodeGeneration;
    try {
        const ab = await fetch(el.src).then((r) => r.arrayBuffer());
        const buf = await audioCtx.decodeAudioData(ab.slice(0));
        if (myGen !== openingDecodeGeneration) return null;
        openingDecodedBuffer = buf;
        return buf;
    } catch {
        return null;
    }
}

function scheduleOpeningCrossfadeSegment(loopState, idx) {
    const { buffer, dur, xfade, period, tAnchor, masterGain } = loopState;
    const t = tAnchor + idx * period;

    const src = audioCtx.createBufferSource();
    const g = audioCtx.createGain();
    src.buffer = buffer;
    src.connect(g);
    g.connect(masterGain);

    if (idx === 0) {
        g.gain.setValueAtTime(1, t);
        g.gain.setValueAtTime(1, t + dur - xfade);
        g.gain.linearRampToValueAtTime(0, t + dur);
    } else {
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(1, t + xfade);
        g.gain.setValueAtTime(1, t + dur - xfade);
        g.gain.linearRampToValueAtTime(0, t + dur);
    }

    src.start(t, 0, dur);
    const seg = { src, g };
    loopState.segments.push(seg);
    src.onended = () => {
        try {
            src.disconnect();
            g.disconnect();
        } catch {
            /* ignore */
        }
        const i = loopState.segments.indexOf(seg);
        if (i >= 0) loopState.segments.splice(i, 1);
    };
}

function openingLoopRefillTick() {
    const st = openingLoopState;
    if (!st || st.mode !== 'crossfade' || state.showPhase !== 'opening') return;

    const { tAnchor, period, dur } = st;
    const horizon = audioCtx.currentTime + CONSTANTS.OPENING_LOOP_REFILL_HORIZON_SEC;
    const now = audioCtx.currentTime;
    while (tAnchor + (st.lastScheduledIdx + 1) * period < horizon) {
        const nextIdx = st.lastScheduledIdx + 1;
        const t = tAnchor + nextIdx * period;
        if (t + dur <= now + 0.01) {
            st.lastScheduledIdx = nextIdx;
            continue;
        }
        st.lastScheduledIdx = nextIdx;
        scheduleOpeningCrossfadeSegment(st, st.lastScheduledIdx);
    }
}

function startOpeningSimpleBufferLoop(buffer) {
    const masterGain = audioCtx.createGain();
    masterGain.gain.value = getVolume('opening');
    masterGain.connect(audioCtx.destination);

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const dur = buffer.duration;
    if (dur > 0.08) {
        const trim = Math.min(0.025, dur * 0.03);
        if (dur > trim * 2 + 0.02) {
            src.loopStart = trim;
            src.loopEnd = dur - trim;
        }
    }
    src.connect(masterGain);
    src.start(0);

    openingLoopState = {
        mode: 'simple',
        masterGain,
        segments: [],
        refillId: null,
        buffer,
        dur,
        xfade: 0,
        period: dur,
        tAnchor: 0,
        lastScheduledIdx: 0,
        simpleSrc: src
    };
}

function startOpeningCrossfadeBufferLoop(buffer) {
    const dur = buffer.duration;
    const xfade = Math.min(0.12, Math.max(0.015, dur * 0.12));
    const period = dur - xfade;
    if (period < 0.04) {
        startOpeningSimpleBufferLoop(buffer);
        return;
    }

    const masterGain = audioCtx.createGain();
    masterGain.gain.value = getVolume('opening');
    masterGain.connect(audioCtx.destination);

    const tAnchor = audioCtx.currentTime + 0.05;
    openingLoopState = {
        mode: 'crossfade',
        masterGain,
        segments: [],
        refillId: null,
        buffer,
        dur,
        xfade,
        period,
        tAnchor,
        lastScheduledIdx: -1
    };

    openingLoopRefillTick();
    openingLoopState.refillId = setInterval(openingLoopRefillTick, CONSTANTS.OPENING_LOOP_REFILL_MS);
}

export function stopOpeningLoop() {
    if (openingHtmlLoopFallback) {
        openingHtmlLoopFallback.pause();
        openingHtmlLoopFallback.currentTime = 0;
        openingHtmlLoopFallback = null;
    }
    if (openingLoopState) {
        if (openingLoopState.refillId != null) {
            clearInterval(openingLoopState.refillId);
        }
        if (openingLoopState.mode === 'simple' && openingLoopState.simpleSrc) {
            try {
                openingLoopState.simpleSrc.stop(0);
            } catch {
                /* ignore */
            }
            try {
                openingLoopState.simpleSrc.disconnect();
            } catch {
                /* ignore */
            }
        }
        for (const seg of openingLoopState.segments) {
            try {
                seg.src.stop(0);
            } catch {
                /* ignore */
            }
            try {
                seg.src.disconnect();
                seg.g.disconnect();
            } catch {
                /* ignore */
            }
        }
        try {
            openingLoopState.masterGain.disconnect();
        } catch {
            /* ignore */
        }
        openingLoopState = null;
    }
}

export function startOpeningScreenAudio() {
    stopOpeningLoop();
    if (!customSounds.opening.audio) {
        playOpeningSound();
        return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    decodeOpeningBufferForLoop().then((buffer) => {
        if (state.showPhase !== 'opening') return;
        if (buffer) {
            startOpeningCrossfadeBufferLoop(buffer);
            return;
        }
        if (customSounds.opening.audio) {
            openingHtmlLoopFallback = customSounds.opening.audio.cloneNode();
            openingHtmlLoopFallback.volume = getVolume('opening');
            openingHtmlLoopFallback.loop = true;
            openingHtmlLoopFallback.play().catch(() => {});
        }
    });
}

export function playCategorySound() {
    const v = getVolume('category');
    playCustomOrDefault('category', () => {
        playTone(523, 0.1, 'triangle', v * 0.22);
        setTimeout(() => playTone(659, 0.12, 'triangle', v * 0.26), 95);
    });
}

export function playQIntroSound() {
    const v = getVolume('qIntro');
    playCustomOrDefault('qIntro', () => {
        playTone(784, 0.07, 'sine', v * 0.28);
        setTimeout(() => playTone(988, 0.07, 'sine', v * 0.32), 70);
        setTimeout(() => playTone(1175, 0.14, 'sine', v * 0.26), 140);
    });
}

export function playQAfterSound() {
    const v = getVolume('qAfter');
    playCustomOrDefault('qAfter', () => {
        playTone(659, 0.12, 'triangle', v * 0.24);
        setTimeout(() => playTone(880, 0.11, 'sine', v * 0.22), 90);
    });
}

export function playEndingSound() {
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
        cancelBgmThinkingFade();
        customSounds.bgm.audio.pause();
        customSounds.bgm.audio.currentTime = 0;
    }
}

export function stopThinkingLoopSound(opts = {}) {
    const { skipBgmRestore = false } = opts;
    if (thinkingLoopIntervalId != null) {
        clearInterval(thinkingLoopIntervalId);
        thinkingLoopIntervalId = null;
    }
    if (thinkingLoopAudioEl) {
        try {
            thinkingLoopAudioEl.pause();
            thinkingLoopAudioEl.currentTime = 0;
        } catch {
            /* ignore */
        }
        try {
            thinkingLoopAudioEl.remove();
        } catch {
            /* ignore */
        }
        thinkingLoopAudioEl = null;
    }
    if (!skipBgmRestore) {
        restoreBgmAfterThinkingLoop();
    }
}

export function startThinkingLoopSound() {
    stopThinkingLoopSound({ skipBgmRestore: true });
    const toggle = document.getElementById('thinking-se-enabled');
    if (!toggle || !toggle.checked) {
        restoreBgmAfterThinkingLoop();
        return;
    }
    if (customSounds.thinkingLoop.audio) {
        const a = customSounds.thinkingLoop.audio.cloneNode();
        a.loop = true;
        a.volume = getVolume('thinkingLoop');
        a.setAttribute('data-thinking-loop', '');
        a.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;';
        thinkingLoopAudioEl = a;
        document.body.appendChild(a);
        a.play()
            .then(() => {
                duckBgmForThinkingLoop();
            })
            .catch(() => {
                thinkingLoopAudioEl = null;
                try {
                    a.remove();
                } catch {
                    /* ignore */
                }
                restoreBgmAfterThinkingLoop();
            });
    } else {
        const v = getVolume('thinkingLoop');
        const tick = () => {
            playTone(392, 0.055, 'sine', v * 0.11);
            setTimeout(() => playTone(523, 0.07, 'sine', v * 0.09), 130);
        };
        tick();
        thinkingLoopIntervalId = setInterval(tick, 2100);
        duckBgmForThinkingLoop();
    }
}

/**
 * @returns {string|null} 読み込んだファイル名（未選択時は null）
 */
export function loadCustomSound(slot, input) {
    const file = input.files[0];
    if (!file) return null;
    if (slot === 'opening') {
        invalidateOpeningDecodedBuffer();
    }
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
    if (slot === 'opening') {
        invalidateOpeningDecodedBuffer();
    }
    if (customSounds[slot].audio) {
        if (slot === 'bgm') cancelBgmThinkingFade();
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

export function stopAllClonedCustomSounds() {
    activeCustomClonedAudio.forEach((a) => {
        try {
            a.pause();
            a.currentTime = 0;
        } catch {
            /* ignore */
        }
    });
    activeCustomClonedAudio.clear();
}

export function stopAllPreviews() {
    if (thinkingLoopPreviewTimer) {
        clearTimeout(thinkingLoopPreviewTimer);
        thinkingLoopPreviewTimer = null;
    }
    stopAllClonedCustomSounds();
    stopOpeningLoop();
    stopThinkingLoopSound();
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
        cancelBgmThinkingFade();
        customSounds.bgm.audio.pause();
        customSounds.bgm.audio.currentTime = 0;
    }
}

export function playSaveSuccessTone() {
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    playTone(880, 0.1, 'sine', 0.11);
}

export function updateVolume(slot, val) {
    customSounds[slot].volume = parseInt(val, 10) / 100;
    const label = document.getElementById('sound-vol-label-' + slot);
    if (label) label.textContent = String(val);
    if (customSounds[slot].audio) {
        if (slot === 'bgm') syncBgmElementVolumeImmediate();
        else customSounds[slot].audio.volume = customSounds[slot].volume;
    }
    if (slot === 'opening') {
        if (openingLoopState?.masterGain) {
            openingLoopState.masterGain.gain.value = customSounds[slot].volume;
        }
        if (openingHtmlLoopFallback) {
            openingHtmlLoopFallback.volume = customSounds[slot].volume;
        }
    }
}
