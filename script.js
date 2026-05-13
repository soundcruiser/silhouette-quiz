// --- State ---
let rootHandle = null;
let setlist = []; // [{folder, displayName, color, mode:'slide'|'static', questions:[{name,fullPath,isColor,handle}]}]
let currentSetIdx = 0;
let currentQIdx = 0;
let editingCategoryIdx = -1;
let objectUrls = [];
let animState = { playing: false, paused: false, lastSpeed: 2, timerId: null, startTime: 0, elapsed: 0, countingDown: false };
/** スライド再生終了後〜次の 1/2/3 までの「考え中」オーバーレイ */
let thinkingOverlayVisible = false;
let thinkingLoopAudioEl = null;
let thinkingLoopIntervalId = null;
let thinkingLoopPreviewTimer = null;
/** BGM 線形フェードの打ち消し用（新しいフェードや即時同期で世代を進める） */
let bgmThinkingFadeGen = 0;
let showPhase = 'opening'; // 'opening' | 'category' | 'quiz' | 'ending'

let controlsTimer = null;
let loadQuizId = 0;
let quizLoading = false;
let lastAdvanceTime = 0;
/** スライド終了検知用（revealPop 等の別 animationend と混ぜない） */
let slideAnimEndListener = null;

const CATEGORY_COLORS = ['#ff2d8a', '#00e5ff', '#ffe42d', '#8aff2d', '#ff8a2d', '#a78bfa'];

function detachSlideAnimEndListener() {
    if (slideAnimEndListener) {
        quizImg.removeEventListener('animationend', slideAnimEndListener);
        slideAnimEndListener = null;
    }
    quizImg.onanimationend = null;
}

// --- DOM References ---
const gridEl = document.getElementById('grid');
const quizImg = document.getElementById('quiz-img');
const playInfo = document.getElementById('play-info');
const playCounter = document.getElementById('play-counter');
const canvasBox = document.getElementById('canvas-box');
const progressBar = document.getElementById('progress-bar');
const timerDisplay = document.getElementById('timer-display');
const helpOverlay = document.getElementById('help-overlay');
const loadConfigModal = document.getElementById('load-config-modal');
const setlistContainer = document.getElementById('setlist-container');
const setlistEmpty = document.getElementById('setlist-empty');
const categoryDetail = document.getElementById('category-detail');
const categoryDetailName = document.getElementById('category-detail-name');
const showOverlay = document.getElementById('show-overlay');
const quizControls = document.getElementById('quiz-controls');
const showControlsEl = document.getElementById('show-controls');
const btnShowAdvance = document.getElementById('btn-show-advance');
const stageEl = document.querySelector('.stage');

// --- Audio (Web Audio API + Custom Sounds) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

const customSounds = {
    bgm:       { audio: null, fileName: null, volume: 0.3 },
    start1:    { audio: null, fileName: null, volume: 0.5 },
    start2:    { audio: null, fileName: null, volume: 0.5 },
    start3:    { audio: null, fileName: null, volume: 0.5 },
    reveal:    { audio: null, fileName: null, volume: 0.5 },
    countdown: { audio: null, fileName: null, volume: 0.5 },
    opening:   { audio: null, fileName: null, volume: 0.5 },
    category:  { audio: null, fileName: null, volume: 0.5 },
    qIntro:    { audio: null, fileName: null, volume: 0.5 },
    qAfter:    { audio: null, fileName: null, volume: 0.5 },
    ending:    { audio: null, fileName: null, volume: 0.5 },
    thinkingLoop: { audio: null, fileName: null, volume: 0.35 }
};

let previewAudio = null;

/** `playCustomOrDefault` が clone した HTMLAudio（本体を触らず再生するため）。フェーズ切替で停止しないとバックグラウンドで鳴り続ける */
const activeCustomClonedAudio = new Set();

/** オープニング用デコード済みバッファ（同一ファイルの再デコードを避ける） */
let openingDecodedBuffer = null;
let openingDecodeGeneration = 0;

/**
 * オープニング画面のカスタム音ループ（Web Audio + 継ぎ目クロスフェード）
 * @type {{
 *   mode: 'crossfade' | 'simple',
 *   masterGain: GainNode,
 *   segments: Array<{ src: AudioBufferSourceNode, g: GainNode }>,
 *   refillId: ReturnType<typeof setInterval> | null,
 *   buffer: AudioBuffer,
 *   dur: number,
 *   xfade: number,
 *   period: number,
 *   tAnchor: number,
 *   lastScheduledIdx: number,
 *   simpleSrc?: AudioBufferSourceNode
 * } | null}
 */
let openingLoopState = null;

/** decode 失敗時のみ使う HTMLAudio ループ（最後の手段） */
let openingHtmlLoopFallback = null;

const OPENING_LOOP_REFILL_HORIZON_SEC = 14;
const OPENING_LOOP_REFILL_MS = 320;

/** 接続フォルダ直下の一括設定（フォルダ接続時に自動読込） */
const BUNDLED_CONFIG_FILENAME = 'silhouette-quiz-config.json';
/** 保存時にサウンドを書き出すサブフォルダ（_ 始まりのためカテゴリ追加セレクトには出ない） */
const SOUND_PACK_DIR = '_sounds';
const SOUND_CONFIG_SLOTS = ['bgm', 'start1', 'start2', 'start3', 'reveal', 'countdown', 'opening', 'category', 'qIntro', 'qAfter', 'ending', 'thinkingLoop'];

/** 考え中ループ SE 鳴っている間の BGM 音量（スライダー値に対する倍率） */
const THINKING_BGM_DUCK_MULT = 0.2;
const THINKING_BGM_DUCK_OUT_MS = 380;
const THINKING_BGM_DUCK_IN_MS = 520;

/** 浮遊シェイプ（ショー画面・考え中オーバーレイの装飾8点）をイベント別に差し替え */
const FLOATING_SHAPE_EVENTS = /** @type {const} */ (['opening', 'category', 'ending', 'thinking']);
const DEFAULT_FLOATING_SHAPES_ROW = ['?', '!', '★', '?', '●', '▲', '＋', '◆'];

function normalizeFloatingShapesRow(raw) {
    const d = [...DEFAULT_FLOATING_SHAPES_ROW];
    if (raw == null) return d;
    if (Array.isArray(raw)) {
        const out = [];
        for (let i = 0; i < 8; i++) {
            const v = raw[i] != null ? String(raw[i]).trim() : '';
            out.push(v || d[i]);
        }
        return out;
    }
    if (typeof raw === 'string') {
        const parts = Array.from(raw);
        const out = [];
        for (let i = 0; i < 8; i++) out.push(parts[i] || d[i]);
        return out;
    }
    return d;
}

function escapeForShapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

function getFloatingShapesForEvent(event) {
    const fromInputs = Array.from({ length: 8 }, (_, i) => {
        const el = document.getElementById(`fs-${event}-${i}`);
        return el ? el.value.trim() : '';
    });
    return normalizeFloatingShapesRow(fromInputs);
}

function isFloatingShapesVisibleForEvent(event) {
    const ch = document.getElementById(`fs-vis-${event}`);
    return ch ? !!ch.checked : true;
}

function buildFloatingShapesInnerHtml(eventKey) {
    const chars = getFloatingShapesForEvent(eventKey);
    let html = '';
    for (let n = 1; n <= 8; n++) {
        html += `<span class="ts-shape ts-shape-${n}">${escapeForShapeHtml(chars[n - 1])}</span>`;
    }
    return html;
}

/** 表示ONのときだけラッパー付きHTML（OFFなら空文字＝レイヤーごと省略） */
function buildFloatingShapesLayerHtml(eventKey) {
    if (!isFloatingShapesVisibleForEvent(eventKey)) return '';
    return `<div class="thinking-shapes" aria-hidden="true">${buildFloatingShapesInnerHtml(eventKey)}</div>`;
}

function applyThinkingShapesFromForm() {
    const host = document.getElementById('thinking-shapes-root');
    if (!host) return;
    if (!isFloatingShapesVisibleForEvent('thinking')) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = buildFloatingShapesInnerHtml('thinking');
}

function collectFloatingShapesForConfig() {
    const o = {};
    for (const ev of FLOATING_SHAPE_EVENTS) {
        o[ev] = getFloatingShapesForEvent(ev);
    }
    return o;
}

function collectFloatingShapesVisibleForConfig() {
    const o = {};
    for (const ev of FLOATING_SHAPE_EVENTS) {
        const ch = document.getElementById(`fs-vis-${ev}`);
        o[ev] = ch ? !!ch.checked : true;
    }
    return o;
}

function applyFloatingShapesFromConfig(floatingShapes) {
    if (!floatingShapes || typeof floatingShapes !== 'object') return;
    for (const ev of FLOATING_SHAPE_EVENTS) {
        const row = normalizeFloatingShapesRow(floatingShapes[ev]);
        for (let i = 0; i < 8; i++) {
            const inp = document.getElementById(`fs-${ev}-${i}`);
            if (inp) inp.value = row[i];
        }
    }
}

function applyFloatingShapesVisibleFromConfig(vis) {
    if (!vis || typeof vis !== 'object') return;
    for (const ev of FLOATING_SHAPE_EVENTS) {
        if (vis[ev] === undefined) continue;
        const ch = document.getElementById(`fs-vis-${ev}`);
        if (ch) ch.checked = !!vis[ev];
    }
}

function initFloatingShapesInputDelegation() {
    const root = document.querySelector('.floating-shapes-details');
    if (!root) return;
    root.addEventListener('input', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t.classList?.contains('fs-cell')) return;
        if (thinkingOverlayVisible && t.id && t.id.startsWith('fs-thinking-')) {
            applyThinkingShapesFromForm();
        }
    });
    root.addEventListener('change', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t.classList?.contains('fs-vis')) return;
        if (thinkingOverlayVisible && t.id === 'fs-vis-thinking') {
            applyThinkingShapesFromForm();
        }
    });
}

function getVolume(slot) { return customSounds[slot].volume; }

function isThinkingLoopSeActiveForBgmDuck() {
    return thinkingLoopAudioEl !== null || thinkingLoopIntervalId !== null;
}

function cancelBgmThinkingFade() {
    bgmThinkingFadeGen++;
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
        const v = from + (toLinear - from) * u;
        a.volume = Math.max(0, Math.min(1, v));
        if (u < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
}

/** スライダー値と考え中ダック状態に応じた BGM の線形音量 */
function getTargetBgmVolumeLinear() {
    const base = getVolume('bgm');
    if (isThinkingLoopSeActiveForBgmDuck()) return base * THINKING_BGM_DUCK_MULT;
    return base;
}

function syncBgmElementVolumeImmediate() {
    const a = customSounds.bgm.audio;
    if (!a) return;
    cancelBgmThinkingFade();
    a.volume = getTargetBgmVolumeLinear();
}

function duckBgmForThinkingLoop() {
    if (!customSounds.bgm.audio) return;
    const target = getVolume('bgm') * THINKING_BGM_DUCK_MULT;
    rampBgmVolume(target, THINKING_BGM_DUCK_OUT_MS);
}

function restoreBgmAfterThinkingLoop() {
    if (!customSounds.bgm.audio) return;
    rampBgmVolume(getVolume('bgm'), THINKING_BGM_DUCK_IN_MS);
}

function playTone(freq, duration, type = 'sine', gainVal = 0.15) {
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

/** 設定保存完了のフィードバック（保存ボタンのユーザ操作直後に鳴らす） */
function playSaveSuccessTone() {
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    playTone(880, 0.1, 'sine', 0.11);
}

function stopAllClonedCustomSounds() {
    for (const a of activeCustomClonedAudio) {
        try {
            a.pause();
            a.currentTime = 0;
        } catch (e) { /* ignore */ }
    }
    activeCustomClonedAudio.clear();
}

function playCustomOrDefault(slot, defaultFn) {
    if (customSounds[slot].audio) {
        const a = customSounds[slot].audio.cloneNode();
        a.loop = false;
        a.volume = getVolume(slot);
        activeCustomClonedAudio.add(a);
        const detach = () => { activeCustomClonedAudio.delete(a); };
        a.addEventListener('ended', detach, { once: true });
        a.addEventListener('error', detach, { once: true });
        a.play().catch(() => {
            detach();
        });
    } else {
        defaultFn();
    }
}

function playRevealSound() {
    const v = getVolume('reveal');
    playCustomOrDefault('reveal', () => {
        playTone(523, 0.12, 'square', v * 0.24);
        setTimeout(() => playTone(659, 0.12, 'square', v * 0.24), 80);
        setTimeout(() => playTone(784, 0.12, 'square', v * 0.3), 160);
        setTimeout(() => playTone(1047, 0.4, 'sine', v * 0.4), 240);
    });
}

function playStartSound(speedNum) {
    const slot = 'start' + (speedNum || 2);
    const v = getVolume(slot);
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

function stopThinkingLoopSound(opts = {}) {
    const { skipBgmRestore = false } = opts;
    if (thinkingLoopIntervalId != null) {
        clearInterval(thinkingLoopIntervalId);
        thinkingLoopIntervalId = null;
    }
    if (thinkingLoopAudioEl) {
        try {
            thinkingLoopAudioEl.pause();
            thinkingLoopAudioEl.currentTime = 0;
        } catch (e) { /* ignore */ }
        try {
            thinkingLoopAudioEl.remove();
        } catch (e) { /* ignore */ }
        thinkingLoopAudioEl = null;
    }
    if (!skipBgmRestore) {
        restoreBgmAfterThinkingLoop();
    }
}

/** 考え中オーバーレイ表示中のループ SE（設定のオン時のみ） */
function startThinkingLoopSound() {
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
            .then(() => { duckBgmForThinkingLoop(); })
            .catch(() => {
                thinkingLoopAudioEl = null;
                try { a.remove(); } catch (e) { /* ignore */ }
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

function invalidateOpeningDecodedBuffer() {
    openingDecodeGeneration++;
    openingDecodedBuffer = null;
}

async function decodeOpeningBufferForLoop() {
    const el = customSounds.opening.audio;
    if (!el?.src) return null;
    if (openingDecodedBuffer) return openingDecodedBuffer;
    const myGen = openingDecodeGeneration;
    try {
        const ab = await fetch(el.src).then(r => r.arrayBuffer());
        const buf = await audioCtx.decodeAudioData(ab.slice(0));
        if (myGen !== openingDecodeGeneration) return null;
        openingDecodedBuffer = buf;
        return buf;
    } catch (e) {
        return null;
    }
}

function stopOpeningLoop() {
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
            try { openingLoopState.simpleSrc.stop(0); } catch (e) {}
            try { openingLoopState.simpleSrc.disconnect(); } catch (e) {}
        }
        for (const seg of openingLoopState.segments) {
            try { seg.src.stop(0); } catch (e) {}
            try { seg.src.disconnect(); seg.g.disconnect(); } catch (e) {}
        }
        try { openingLoopState.masterGain.disconnect(); } catch (e) {}
        openingLoopState = null;
    }
}

function playOpeningDefaultJingle() {
    const v = getVolume('opening');
    playTone(392, 0.11, 'triangle', v * 0.2);
    setTimeout(() => playTone(523, 0.12, 'triangle', v * 0.24), 95);
    setTimeout(() => playTone(659, 0.14, 'sine', v * 0.26), 210);
    setTimeout(() => playTone(784, 0.16, 'sine', v * 0.22), 360);
}

function scheduleOpeningCrossfadeSegment(state, idx) {
    const { buffer, dur, xfade, period, tAnchor, masterGain } = state;
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
    state.segments.push(seg);
    src.onended = () => {
        try { src.disconnect(); g.disconnect(); } catch (e) {}
        const i = state.segments.indexOf(seg);
        if (i >= 0) state.segments.splice(i, 1);
    };
}

function openingLoopRefillTick() {
    const state = openingLoopState;
    if (!state || state.mode !== 'crossfade' || showPhase !== 'opening') return;

    const { tAnchor, period, dur } = state;
    const horizon = audioCtx.currentTime + OPENING_LOOP_REFILL_HORIZON_SEC;
    const now = audioCtx.currentTime;
    while (tAnchor + (state.lastScheduledIdx + 1) * period < horizon) {
        const nextIdx = state.lastScheduledIdx + 1;
        const t = tAnchor + nextIdx * period;
        if (t + dur <= now + 0.01) {
            state.lastScheduledIdx = nextIdx;
            continue;
        }
        state.lastScheduledIdx = nextIdx;
        scheduleOpeningCrossfadeSegment(state, state.lastScheduledIdx);
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
    openingLoopState.refillId = setInterval(openingLoopRefillTick, OPENING_LOOP_REFILL_MS);
}

/** オープニング画面用: カスタム音源は滑らかループ、未設定時はワンショットのデフォルトジングル */
function startOpeningScreenAudio() {
    stopOpeningLoop();
    if (!customSounds.opening.audio) {
        playOpeningDefaultJingle();
        return;
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();

    decodeOpeningBufferForLoop().then((buffer) => {
        if (showPhase !== 'opening') return;
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

/** テスト再生など: カスタムは1回だけ、未設定はデフォルトジングル */
function playOpeningSound() {
    playCustomOrDefault('opening', playOpeningDefaultJingle);
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

// BGM control
function startBGM() {
    if (!customSounds.bgm.audio) return;
    const a = customSounds.bgm.audio;
    a.loop = true;
    if (isThinkingLoopSeActiveForBgmDuck()) {
        rampBgmVolume(getVolume('bgm') * THINKING_BGM_DUCK_MULT, Math.min(THINKING_BGM_DUCK_OUT_MS, 200));
    } else {
        cancelBgmThinkingFade();
        a.volume = getVolume('bgm');
    }
    if (a.paused) a.play().catch(() => {});
}

function stopBGM() {
    if (!customSounds.bgm.audio) return;
    cancelBgmThinkingFade();
    customSounds.bgm.audio.pause();
    customSounds.bgm.audio.currentTime = 0;
}

function loadCustomSound(slot, input) {
    const file = input.files[0];
    if (!file) return;
    if (slot === 'opening') {
        invalidateOpeningDecodedBuffer();
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.preload = 'auto';

    if (customSounds[slot].audio) {
        customSounds[slot].audio.pause();
        URL.revokeObjectURL(customSounds[slot].audio.src);
    }
    customSounds[slot].audio = audio;
    customSounds[slot].fileName = file.name;
    if (slot === 'bgm') syncBgmElementVolumeImmediate();
    else audio.volume = getVolume(slot);

    const nameEl = document.getElementById('sound-name-' + slot);
    nameEl.textContent = file.name;
    nameEl.classList.add('has-file');
    input.value = '';
}

function clearCustomSound(slot) {
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
    const nameEl = document.getElementById('sound-name-' + slot);
    nameEl.textContent = slot === 'bgm' ? '未設定' : 'デフォルト';
    nameEl.classList.remove('has-file');
}

function updateVolume(slot, val) {
    customSounds[slot].volume = parseInt(val) / 100;
    document.getElementById('sound-vol-label-' + slot).textContent = val;
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

function testSound(slot) {
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
                } catch (e) { /* ignore */ }
                try {
                    previewAudio.remove();
                } catch (e) { /* ignore */ }
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
        btn.classList.add('playing');
        btn.textContent = '■';
        previewAudio.onended = () => { btn.classList.remove('playing'); btn.textContent = '▶'; previewAudio = null; };
    } else if (slot === 'start1' || slot === 'start2' || slot === 'start3') {
        playStartSound(parseInt(slot.charAt(5)));
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
        if (thinkingLoopPreviewTimer) {
            clearTimeout(thinkingLoopPreviewTimer);
            thinkingLoopPreviewTimer = null;
        }
        stopThinkingLoopSound();
        const btn = document.getElementById('sound-test-thinkingLoop');
        const resetBtn = () => { if (btn) { btn.classList.remove('playing'); btn.textContent = '▶'; } };
        if (customSounds.thinkingLoop.audio) {
            const a = customSounds.thinkingLoop.audio.cloneNode();
            a.loop = true;
            a.volume = getVolume('thinkingLoop');
            a.setAttribute('data-thinking-loop-preview', '');
            a.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;';
            document.body.appendChild(a);
            previewAudio = a;
            a.play().catch(() => {});
            if (btn) { btn.classList.add('playing'); btn.textContent = '■'; }
        } else {
            const v = getVolume('thinkingLoop');
            playTone(392, 0.055, 'sine', v * 0.11);
            setTimeout(() => playTone(523, 0.07, 'sine', v * 0.09), 130);
            if (btn) { btn.classList.add('playing'); btn.textContent = '■'; }
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
        btn.classList.add('playing');
        btn.textContent = '■';
        previewAudio.onended = () => { btn.classList.remove('playing'); btn.textContent = '▶'; previewAudio = null; };
    }
}

function stopAllPreviews() {
    if (thinkingLoopPreviewTimer) {
        clearTimeout(thinkingLoopPreviewTimer);
        thinkingLoopPreviewTimer = null;
    }
    if (previewAudio) {
        try {
            previewAudio.pause();
            previewAudio.currentTime = 0;
        } catch (e) { /* ignore */ }
        try {
            previewAudio.remove();
        } catch (e) { /* ignore */ }
        previewAudio = null;
    }
    stopAllClonedCustomSounds();
    stopOpeningLoop();
    stopThinkingLoopSound();
    for (const slot of SOUND_CONFIG_SLOTS) {
        const btn = document.getElementById('sound-test-' + slot);
        if (btn) { btn.classList.remove('playing'); btn.textContent = '▶'; }
    }
    if (customSounds.bgm.audio) {
        cancelBgmThinkingFade();
        customSounds.bgm.audio.pause();
        customSounds.bgm.audio.currentTime = 0;
    }
}

// --- Memory Management ---
function revokeAllUrls() {
    objectUrls.forEach(url => URL.revokeObjectURL(url));
    objectUrls = [];
}

async function getFileUrl(item) {
    try {
        const file = await item.handle.getFile();
        const url = URL.createObjectURL(file);
        objectUrls.push(url);
        return url;
    } catch (e) { return ""; }
}

// --- 1. Directory Access ---
const DB_NAME = 'silhouette-quiz';
const DB_STORE = 'handles';

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveRootHandle(handle) {
    const db = await openDB();
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(handle, 'rootDir');
    return new Promise(r => { tx.oncomplete = r; });
}

async function restoreRootHandle() {
    try {
        const db = await openDB();
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get('rootDir');
        const handle = await new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (!handle) return false;
        const perm = await handle.requestPermission({ mode: 'read' });
        if (perm !== 'granted') return false;
        rootHandle = handle;
        document.getElementById('file-status').innerText = "✓ " + rootHandle.name;
        await buildFolderSelector();
        if (await tryAutoLoadBundledConfig()) {
            document.getElementById('file-status').innerText = "✓ " + rootHandle.name + "（" + BUNDLED_CONFIG_FILENAME + " を読込）";
        }
        return true;
    } catch { return false; }
}

async function requestDirectoryAccess() {
    try {
        rootHandle = await window.showDirectoryPicker();
        document.getElementById('file-status').innerText = "✓ " + rootHandle.name;
        await saveRootHandle(rootHandle);
        await buildFolderSelector();
        if (await tryAutoLoadBundledConfig()) {
            document.getElementById('file-status').innerText = "✓ " + rootHandle.name + "（" + BUNDLED_CONFIG_FILENAME + " を読込）";
        }
    } catch (err) {
        if (err.name !== 'AbortError') console.error("Access denied", err);
    }
}

async function buildFolderSelector() {
    const selector = document.createElement('select');
    selector.className = 'mode-btn';
    selector.id = 'folder-selector';
    selector.innerHTML = '<option>-- セットに追加 --</option>';

    for await (const entry of rootHandle.values()) {
        if (entry.kind === 'directory' && !entry.name.startsWith('_')) {
            const opt = document.createElement('option');
            opt.value = entry.name;
            opt.text = "📂 " + entry.name;
            selector.appendChild(opt);
        }
    }

    selector.onchange = (e) => {
        if (e.target.value && !e.target.value.includes('--')) {
            addFolderToSetlist(e.target.value);
            e.target.selectedIndex = 0;
        }
    };

    const panel = document.getElementById('main-panel');
    const old = panel.querySelector('#folder-selector');
    if (old) old.remove();
    panel.appendChild(selector);
}

// --- 2. Setlist Management ---
async function addFolderToSetlist(folderName) {
    if (!rootHandle) return;
    if (setlist.find(s => s.folder === folderName)) return;

    const subHandle = await rootHandle.getDirectoryHandle(folderName);
    const questions = [];

    for await (const entry of subHandle.values()) {
        if (entry.kind === 'file' && /\.(jpe?g|png|webp|gif)$/i.test(entry.name)) {
            questions.push({
                name: entry.name,
                fullPath: `${folderName}/${entry.name}`,
                isColor: false,
                handle: entry
            });
        }
    }
    questions.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    setlist.push({
        folder: folderName,
        displayName: folderName,
        color: CATEGORY_COLORS[setlist.length % CATEGORY_COLORS.length],
        mode: 'slide',
        questions
    });

    renderSetlist();
}

async function addAllFoldersToSetlist() {
    if (!rootHandle) { alert("先にフォルダを接続してください"); return; }
    for await (const entry of rootHandle.values()) {
        if (entry.kind === 'directory' && !entry.name.startsWith('_')) {
            await addFolderToSetlist(entry.name);
        }
    }
}

function removeFromSetlist(idx) {
    setlist.splice(idx, 1);
    if (editingCategoryIdx === idx) closeCategoryDetail();
    else if (editingCategoryIdx > idx) editingCategoryIdx--;
    renderSetlist();
}

function renderSetlist() {
    if (setlist.length === 0) {
        setlistEmpty.style.display = 'block';
    } else {
        setlistEmpty.style.display = 'none';
    }

    const items = setlistContainer.querySelectorAll('.setlist-item');
    items.forEach(el => el.remove());

    setlist.forEach((cat, idx) => {
        const el = document.createElement('div');
        el.className = `setlist-item ${editingCategoryIdx === idx ? 'active-category' : ''}`;
        const modeLabel = cat.mode === 'static' ? '🔍 じっくり' : '🎬 スライド';
        const modeCls = cat.mode === 'static' ? 'mode-static-tag' : 'mode-slide-tag';
        el.innerHTML = `
            <span class="setlist-num">${idx + 1}</span>
            <span class="setlist-color-dot" style="background:${cat.color}" onclick="event.stopPropagation(); cycleColor(${idx})" title="色を変更"></span>
            <input class="setlist-name-input" value="${cat.displayName}" onchange="updateDisplayName(${idx}, this.value)" onclick="event.stopPropagation()">
            <span class="setlist-mode-btn ${modeCls}" onclick="event.stopPropagation(); toggleCategoryMode(${idx})" title="モード切替">${modeLabel}</span>
            <span class="setlist-count">${cat.questions.length}問</span>
            <div class="setlist-actions">
                <button class="setlist-btn" onclick="event.stopPropagation(); openCategoryDetail(${idx})" title="問題を編集">✎</button>
                <button class="setlist-btn btn-remove" onclick="event.stopPropagation(); removeFromSetlist(${idx})" title="削除">✕</button>
            </div>
        `;
        setlistContainer.appendChild(el);
    });

    if (setlistContainer._sortable) setlistContainer._sortable.destroy();
    if (setlist.length > 0) {
        setlistContainer._sortable = new Sortable(setlistContainer, {
            animation: 200,
            draggable: '.setlist-item',
            ghostClass: 'sortable-ghost',
            filter: '.setlist-color-dot, .setlist-btn, .setlist-name-input, .btn-remove, .setlist-mode-btn',
            preventOnFilter: false,
            onEnd: (evt) => {
                const oldIdx = evt.oldDraggableIndex;
                const newIdx = evt.newDraggableIndex;
                if (oldIdx === newIdx) return;
                const item = setlist.splice(oldIdx, 1)[0];
                if (!item) return;
                setlist.splice(newIdx, 0, item);
                if (editingCategoryIdx === oldIdx) editingCategoryIdx = newIdx;
                else if (editingCategoryIdx > oldIdx && editingCategoryIdx <= newIdx) editingCategoryIdx--;
                else if (editingCategoryIdx < oldIdx && editingCategoryIdx >= newIdx) editingCategoryIdx++;
                renderSetlist();
            }
        });
    }
}

function updateDisplayName(idx, name) {
    setlist[idx].displayName = name || setlist[idx].folder;
}

function cycleColor(idx) {
    const currentColorIdx = CATEGORY_COLORS.indexOf(setlist[idx].color);
    setlist[idx].color = CATEGORY_COLORS[(currentColorIdx + 1) % CATEGORY_COLORS.length];
    renderSetlist();
}

function toggleCategoryMode(idx) {
    setlist[idx].mode = setlist[idx].mode === 'static' ? 'slide' : 'static';
    renderSetlist();
}

function setAllModes(mode) {
    setlist.forEach(cat => cat.mode = mode);
    renderSetlist();
}

// --- 3. Category Detail (per-category question grid) ---
function openCategoryDetail(idx) {
    editingCategoryIdx = idx;
    const cat = setlist[idx];
    categoryDetail.style.display = 'block';
    categoryDetailName.textContent = `${cat.displayName} (${cat.questions.length}問)`;
    categoryDetailName.style.color = cat.color;
    renderGrid();
    renderSetlist();
}

function closeCategoryDetail() {
    editingCategoryIdx = -1;
    categoryDetail.style.display = 'none';
    gridEl.innerHTML = '';
    renderSetlist();
}

async function renderGrid() {
    if (editingCategoryIdx < 0 || !setlist[editingCategoryIdx]) return;
    revokeAllUrls();
    gridEl.innerHTML = '';

    const questions = setlist[editingCategoryIdx].questions;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < questions.length; i++) {
        const item = questions[i];
        const url = await getFileUrl(item);
        const card = document.createElement('div');
        card.className = `card ${!item.isColor ? 'is-silhouette-preview' : ''}`;
        card.dataset.index = i;
        card.innerHTML = `
            <div class="card-number">${i + 1}</div>
            <img src="${url}" draggable="false">
            <div class="card-name" title="${item.name}">${item.name}</div>
            <div class="card-toggle">
                <label>
                    <input type="checkbox" ${item.isColor ? 'checked' : ''} onchange="toggleCardColor(${i}, this.checked)">
                    <span class="badge ${item.isColor ? 'badge-color' : 'badge-silhouette'}">${item.isColor ? 'カラー' : 'シルエット'}</span>
                </label>
            </div>
        `;
        fragment.appendChild(card);
    }
    gridEl.appendChild(fragment);

    if (gridEl._sortable) gridEl._sortable.destroy();
    gridEl._sortable = new Sortable(gridEl, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        onEnd: (evt) => {
            const q = setlist[editingCategoryIdx].questions;
            const item = q.splice(evt.oldIndex, 1)[0];
            q.splice(evt.newIndex, 0, item);
            renderGrid();
        }
    });
}

function toggleCardColor(idx, checked) {
    if (editingCategoryIdx < 0) return;
    setlist[editingCategoryIdx].questions[idx].isColor = checked;
    const card = gridEl.children[idx];
    card.classList.toggle('is-silhouette-preview', !checked);
    const badge = card.querySelector('.badge');
    badge.className = `badge ${checked ? 'badge-color' : 'badge-silhouette'}`;
    badge.textContent = checked ? 'カラー' : 'シルエット';
}

function bulkColor(val) {
    if (editingCategoryIdx < 0) return;
    setlist[editingCategoryIdx].questions.forEach(item => item.isColor = val);
    renderGrid();
}

// --- 4. Mode Control ---
function switchMode(mode) {
    document.getElementById('config-mode').style.display = mode === 'config' ? 'block' : 'none';
    document.getElementById('play-mode').style.display = mode === 'play' ? 'block' : 'none';
    document.getElementById('nav-config').classList.toggle('active', mode === 'config');
    document.getElementById('nav-play').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('is-playing', mode === 'play');
    if (mode === 'play') {
        stopAllClonedCustomSounds();
        currentSetIdx = 0;
        currentQIdx = 0;
        enterShowPhase('opening');
    } else {
        hideThinkingOverlay();
        stopAllClonedCustomSounds();
        stopBGM();
        stopOpeningLoop();
        hideShowOverlay();
    }
}

// --- Show Flow ---
function enterShowPhase(phase) {
    hideThinkingOverlay();
    stopOpeningLoop();
    stopAllClonedCustomSounds();
    showPhase = phase;
    resetAnimState();
    loadQuizId++;
    quizLoading = false;

    if (phase === 'opening' || phase === 'ending') {
        stopBGM();
    } else if (phase === 'category') {
        startBGM();
    }

    if (phase === 'quiz') {
        quizControls.style.display = '';
        showControlsEl.style.display = 'none';
        loadQuiz();
        return;
    }

    quizControls.style.display = 'none';
    showControlsEl.style.display = '';
    showOverlay.style.display = 'flex';
    showOverlay.className = 'show-overlay visible';

    if (phase === 'opening') {
        renderOpening();
        btnShowAdvance.textContent = 'START';
    } else if (phase === 'category') {
        renderCategoryTitle();
        btnShowAdvance.textContent = 'READY';
    } else if (phase === 'ending') {
        renderEnding();
        btnShowAdvance.textContent = 'CONFIG に戻る';
    }
    sendRemoteState();
}

function advanceShow() {
    const now = Date.now();
    if (now - lastAdvanceTime < 500) return;
    lastAdvanceTime = now;

    if (showPhase === 'opening') {
        if (setlist.length === 0) return;
        currentSetIdx = 0;
        currentQIdx = 0;
        enterShowPhase('category');
    } else if (showPhase === 'category') {
        enterShowPhase('quiz');
    } else if (showPhase === 'ending') {
        switchMode('config');
    }
}

function hideShowOverlay() {
    showOverlay.style.display = 'none';
    showOverlay.className = 'show-overlay';
    showOverlay.innerHTML = '';
}

function renderOpening() {
    const totalQ = setlist.reduce((sum, cat) => sum + cat.questions.length, 0);
    const catCount = setlist.length;

    // ── フローティングタグ調整（手動） ──
    // 50: 画面に出る総数の目安。増やすと密に、減らすとスカスカ
    // size: 18が最小, +22で最大40px。両方の数値で範囲を変える
    // rot: 回転角度の範囲（-15〜+15度）
    // delay/dur: アニメーションの遅延と周期（秒）
    // ※見た目の微調整はCSSの .show-float-tag も参照
    const tags = [];
    const copies = Math.max(3, Math.ceil(50 / setlist.length));
    for (let c = 0; c < copies; c++) {
        setlist.forEach((cat) => {
            const top = Math.random() * 85;
            const left = -5 + Math.random() * 95;
            const delay = (Math.random() * 5).toFixed(1);
            const dur = (4 + Math.random() * 5).toFixed(1);
            const size = 18 + Math.floor(Math.random() * 22);
            const rot = -15 + Math.floor(Math.random() * 30);
            tags.push(`<span class="show-float-tag" style="top:${top}%;left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;font-size:${size}px;color:${cat.color};--rot:${rot}deg">${cat.displayName}</span>`);
        });
    }
    const floatingTags = tags.join('');
    const openingShapesLayer = buildFloatingShapesLayerHtml('opening');

    showOverlay.innerHTML = `
        <div class="show-screen show-opening">
            <div class="show-float-layer">${floatingTags}</div>
            ${openingShapesLayer}
            <div class="show-deco-line"></div>
            <h1 class="show-main-title">${document.getElementById('show-title').value || 'SILHOUETTE QUIZ'}</h1>
            <div class="show-sub-title">${document.getElementById('show-subtitle').value || 'シルエットクイズ'}</div>
            <div class="show-meta">
                <span>${catCount} カテゴリ</span>
                <span class="show-meta-dot">-</span>
                <span>${totalQ} 問</span>
            </div>
            <div class="show-deco-line"></div>
        </div>
    `;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    startOpeningScreenAudio();
}

function renderCategoryTitle() {
    const cat = setlist[currentSetIdx];
    const roundNum = currentSetIdx + 1;
    const total = setlist.length;
    const isStatic = cat.mode === 'static';
    const modeTag = isStatic
        ? '<span class="show-cat-mode show-cat-mode-static">🔍 じっくり観察クイズ</span>'
        : '<span class="show-cat-mode show-cat-mode-slide">🎬 スライドクイズ</span>';
    const catShapesLayer = buildFloatingShapesLayerHtml('category');
    showOverlay.innerHTML = `
        <div class="show-screen show-category" style="--cat-color: ${cat.color}">
            ${catShapesLayer}
            <div class="show-round-label">Round ${roundNum} / ${total}</div>
            <h1 class="show-cat-name">${cat.displayName}</h1>
            ${modeTag}
            <div class="show-cat-count">${cat.questions.length} 問</div>
            <div class="show-cat-bar" style="background: ${cat.color}"></div>
        </div>
    `;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playCategorySound();
}

function renderEnding() {
    const totalQ = setlist.reduce((sum, cat) => sum + cat.questions.length, 0);
    const endShapesLayer = buildFloatingShapesLayerHtml('ending');
    showOverlay.innerHTML = `
        <div class="show-screen show-ending">
            ${endShapesLayer}
            <div class="show-deco-line"></div>
            <h1 class="show-ending-title">FINISH!</h1>
            <div class="show-ending-sub">お疲れ様でした</div>
            <div class="show-meta">
                <span>${setlist.length} カテゴリ</span>
                <span class="show-meta-dot">-</span>
                <span>${totalQ} 問 完了</span>
            </div>
            <div class="show-deco-line"></div>
        </div>
    `;
    spawnParticles();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playEndingSound();
}

// --- 5. Play Engine (Setlist-aware) ---
function getCurrentQuestions() {
    if (setlist.length === 0) return [];
    return setlist[currentSetIdx]?.questions || [];
}

function getCurrentMode() {
    return setlist[currentSetIdx]?.mode || 'slide';
}

function syncThinkingOverlayMessage() {
    const main = document.getElementById('thinking-main-text');
    const input = document.getElementById('thinking-time-text');
    if (!main) return;
    const raw = (input && input.value.trim()) ? input.value : 'thinkingTime';
    main.textContent = raw;
}

async function showThinkingOverlay() {
    if (thinkingOverlayVisible) return;
    const overlay = document.getElementById('thinking-overlay');
    if (!overlay) return;
    applyThinkingShapesFromForm();
    syncThinkingOverlayMessage();
    thinkingOverlayVisible = true;
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    try {
        if (audioCtx.state === 'suspended') await audioCtx.resume();
    } catch (e) { /* ignore */ }
    startThinkingLoopSound();
    sendRemoteState();
}

function hideThinkingOverlay() {
    const overlay = document.getElementById('thinking-overlay');
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }
    const wasVisible = thinkingOverlayVisible;
    thinkingOverlayVisible = false;
    stopThinkingLoopSound();
    if (wasVisible) sendRemoteState();
}

async function loadQuiz() {
    hideThinkingOverlay();
    const questions = getCurrentQuestions();
    if (questions.length === 0) return;
    resetAnimState();
    quizLoading = true;

    const thisId = ++loadQuizId;
    const cat = setlist[currentSetIdx];
    const isStatic = cat.mode === 'static';
    canvasBox.style.setProperty('--cat-color', cat.color);
    stageEl.classList.toggle('mode-static', isStatic);
    stageEl.classList.toggle('mode-slide', !isStatic);

    quizImg.style.visibility = 'hidden';

    showOverlay.innerHTML = `
        <div class="show-screen show-question-num" style="--cat-color: ${cat.color}">
            <span class="show-qnum">Q${currentQIdx + 1}</span>
            <span class="show-qnum-total">/ ${questions.length}</span>
        </div>
    `;
    showOverlay.style.display = 'flex';
    showOverlay.className = 'show-overlay visible';
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playQIntroSound();

    const item = questions[currentQIdx];
    detachSlideAnimEndListener();
    quizImg.className = '';
    const url = await getFileUrl(item);
    if (thisId !== loadQuizId) return;
    quizImg.src = url;
    quizImg.classList.toggle('is-silhouette', !item.isColor);
    canvasBox.classList.remove('revealed');

    if (isStatic) {
        quizImg.style.left = '50%';
        quizImg.style.transform = 'translateX(-50%)';
        quizImg.style.animation = '';
    } else {
        quizImg.style.left = '0';
        quizImg.style.transform = 'translateX(110vw)';
        quizImg.style.animation = '';
    }

    progressBar.classList.remove('active');
    progressBar.style.width = '0%';
    progressBar.style.transitionDuration = '0s';
    timerDisplay.textContent = '';
    timerDisplay.classList.remove('warning');

    document.getElementById('play-round').textContent = `ROUND ${currentSetIdx + 1}`;
    playInfo.textContent = cat.displayName;
    playCounter.innerHTML = `<span class="play-counter-q">Q${currentQIdx + 1}</span><span class="play-counter-total"> / ${questions.length}</span>`;

    await new Promise(r => setTimeout(r, 1500));
    if (thisId !== loadQuizId) return;

    quizImg.style.visibility = 'visible';
    quizLoading = false;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playQAfterSound();
    hideShowOverlay();
    sendRemoteState();
}

function startAnim(speedNum) {
    if (showPhase !== 'quiz' || quizLoading) return;
    if (getCurrentQuestions().length === 0) return;
    if (animState.countingDown || animState.playing) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    hideThinkingOverlay();
    resetAnimState();
    animState.lastSpeed = speedNum;

    quizImg.classList.remove('revealed-img');
    quizImg.style.left = '0';
    quizImg.style.transform = 'translateX(110vw)';
    quizImg.style.animation = '';
    canvasBox.classList.remove('revealed');

    const countdownOn = document.getElementById('countdown-toggle').checked;
    const countdownSec = parseInt(document.getElementById('countdown-sec').value) || 3;
    if (countdownOn && countdownSec > 0) {
        runCountdown(countdownSec, () => executeAnim(speedNum), speedNum);
    } else {
        playStartSound(speedNum);
        executeAnim(speedNum);
    }
}

function runCountdown(seconds, callback, speedNum) {
    animState.countingDown = true;
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    overlay.classList.add('visible');
    let remaining = seconds;
    const cdColors = ['#00e5ff', '#ffe42d', '#ff2d8a', '#8aff2d', '#ff8a2d'];

    function tick() {
        if (remaining <= 0) {
            overlay.classList.remove('visible');
            animState.countingDown = false;
            playStartSound(speedNum);
            callback();
            return;
        }
        const color = cdColors[remaining % cdColors.length];
        numEl.textContent = remaining;
        numEl.style.color = color;
        numEl.classList.remove('pop');
        void numEl.offsetWidth;
        numEl.classList.add('pop');
        playCountdownTick(remaining);
        remaining--;
        setTimeout(tick, 1000);
    }
    tick();
}

function executeAnim(speedNum) {
    const dur = parseFloat(document.getElementById('speed' + speedNum).value);
    animState.playing = true;
    animState.startTime = performance.now();

    quizImg.style.left = '0';
    quizImg.style.transform = 'translateX(110vw)';
    void quizImg.offsetWidth;
    quizImg.style.setProperty('--dur', dur + 's');
    quizImg.classList.add('animating');

    progressBar.style.transitionDuration = dur + 's';
    progressBar.classList.add('active');
    progressBar.style.width = '100%';

    startTimer(dur);

    detachSlideAnimEndListener();
    slideAnimEndListener = (ev) => {
        if (ev.target !== quizImg) return;
        if (!quizImg.classList.contains('animating')) return;
        detachSlideAnimEndListener();
        quizImg.classList.remove('animating');
        quizImg.style.left = '0';
        quizImg.style.transform = 'translateX(110vw)';
        resetAnimState();
        if (showPhase === 'quiz' && !quizLoading && getCurrentMode() === 'slide') {
            void showThinkingOverlay();
        }
    };
    quizImg.addEventListener('animationend', slideAnimEndListener);
}

function startTimer(dur) {
    clearInterval(animState.timerId);
    const totalMs = dur * 1000;
    animState.timerId = setInterval(() => {
        if (animState.paused) return;
        const elapsed = performance.now() - animState.startTime - animState.elapsed;
        const remaining = Math.max(0, (totalMs - elapsed) / 1000);
        timerDisplay.textContent = remaining.toFixed(1) + 's';
        timerDisplay.classList.toggle('warning', remaining < 2);
        if (remaining <= 0) clearInterval(animState.timerId);
    }, 100);
}

function togglePause() {
    if (!animState.playing) return;
    const btn = document.getElementById('btn-pause');

    if (!animState.paused) {
        animState.paused = true;
        quizImg.style.animationPlayState = 'paused';
        progressBar.style.transitionPlayState = 'paused';
        btn.textContent = '▶';
        btn.style.borderColor = 'var(--lime)';
        btn.style.color = 'var(--lime)';
    } else {
        animState.paused = false;
        quizImg.style.animationPlayState = 'running';
        progressBar.style.transitionPlayState = 'running';
        btn.textContent = '⏸';
        btn.style.borderColor = '';
        btn.style.color = '';
    }
}

function replayAnim() {
    startAnim(animState.lastSpeed || 2);
}

function resetAnimState() {
    animState.playing = false;
    animState.paused = false;
    clearInterval(animState.timerId);
    quizImg.style.animationPlayState = 'running';
    progressBar.style.transitionPlayState = 'running';
    const btn = document.getElementById('btn-pause');
    btn.textContent = '⏸';
    btn.style.borderColor = '';
    btn.style.color = '';
}

function reveal() {
    if (showPhase !== 'quiz' || quizLoading) return;
    if (getCurrentQuestions().length === 0) return;
    if (animState.countingDown) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    hideThinkingOverlay();
    playRevealSound();
    resetAnimState();
    detachSlideAnimEndListener();

    quizImg.classList.remove('animating', 'is-silhouette', 'revealed-img');
    quizImg.style.animation = '';
    quizImg.style.left = '50%';
    quizImg.style.transform = 'translateX(-50%)';

    void quizImg.offsetWidth;
    quizImg.classList.add('revealed-img');
    canvasBox.classList.add('revealed');

    quizImg.addEventListener('animationend', function onRevealEnd() {
        quizImg.removeEventListener('animationend', onRevealEnd);
        quizImg.classList.remove('revealed-img');
        quizImg.style.left = '50%';
        quizImg.style.transform = 'translateX(-50%)';
    });

    progressBar.classList.remove('active');
    progressBar.style.width = '100%';
    progressBar.style.transitionDuration = '0.3s';
    timerDisplay.textContent = '';

    spawnParticles();
    sendRemoteState();
}

function spawnParticles() {
    const colors = ['#ff2d8a', '#ffe42d', '#00e5ff', '#8aff2d', '#ff8a2d', '#fff'];
    const rect = canvasBox.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < 36; i++) {
        const el = document.createElement('div');
        el.className = 'particle';
        const angle = (Math.PI * 2 * i) / 36;
        const dist = 80 + Math.random() * 180;
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
        el.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
        el.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
        el.style.background = colors[i % colors.length];
        const size = (5 + Math.random() * 8) + 'px';
        el.style.width = size;
        el.style.height = size;
        el.style.boxShadow = `0 0 6px ${colors[i % colors.length]}`;
        canvasBox.appendChild(el);
        setTimeout(() => el.remove(), 1000);
    }

    for (let i = 0; i < 20; i++) {
        const el = document.createElement('div');
        el.className = 'confetti';
        const x = Math.random() * rect.width;
        el.style.left = x + 'px';
        el.style.top = '0px';
        el.style.setProperty('--tx', (Math.random() - 0.5) * 200 + 'px');
        el.style.setProperty('--ty', rect.height * (0.5 + Math.random() * 0.5) + 'px');
        el.style.background = colors[i % colors.length];
        el.style.animationDelay = (Math.random() * 0.3) + 's';
        canvasBox.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }
}

// --- Navigation (Setlist-aware, with show flow) ---
function nextQuiz() {
    if (setlist.length === 0) return;
    if (showPhase !== 'quiz' || quizLoading) return;
    if (animState.countingDown || animState.playing) return;

    const questions = getCurrentQuestions();
    if (currentQIdx < questions.length - 1) {
        currentQIdx++;
        loadQuiz();
    } else if (currentSetIdx < setlist.length - 1) {
        currentSetIdx++;
        currentQIdx = 0;
        enterShowPhase('category');
    } else {
        enterShowPhase('ending');
    }
}

function prevQuiz() {
    if (setlist.length === 0) return;
    if (showPhase !== 'quiz' || quizLoading) return;
    if (animState.countingDown || animState.playing) return;

    if (currentQIdx > 0) {
        currentQIdx--;
    } else if (currentSetIdx > 0) {
        currentSetIdx--;
        currentQIdx = setlist[currentSetIdx].questions.length - 1;
    } else {
        currentSetIdx = setlist.length - 1;
        currentQIdx = setlist[currentSetIdx].questions.length - 1;
    }
    loadQuiz();
}

// --- 6. Config Save/Load (Setlist version + bundled folder package) ---
function downloadConfigJsonFile(config) {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `setlist_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function writeBlobToRelativePath(rootDir, relativePath, blob) {
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

async function tryResolveSoundFileHandle(rootDir, fileRef) {
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
            const sd = await rootDir.getDirectoryHandle(SOUND_PACK_DIR);
            return await sd.getFileHandle(base);
        } catch (_) { /* */ }
        return await rootDir.getFileHandle(base);
    } catch (_) {
        return null;
    }
}

async function bindSoundSlotFromFileHandle(slot, fileHandle) {
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.preload = 'auto';
    if (customSounds[slot].audio) {
        customSounds[slot].audio.pause();
        URL.revokeObjectURL(customSounds[slot].audio.src);
    }
    customSounds[slot].audio = audio;
    customSounds[slot].fileName = file.name;
    if (slot === 'bgm') syncBgmElementVolumeImmediate();
    else audio.volume = getVolume(slot);
    const nameEl = document.getElementById('sound-name-' + slot);
    nameEl.textContent = file.name;
    nameEl.classList.add('has-file');
    if (slot === 'opening') invalidateOpeningDecodedBuffer();
}

async function tryBindSoundFromRoot(slot, filePathOrName) {
    if (!rootHandle) return;
    if (!filePathOrName) {
        clearCustomSound(slot);
        return;
    }
    const nameEl = document.getElementById('sound-name-' + slot);
    const fh = await tryResolveSoundFileHandle(rootHandle, filePathOrName);
    if (!fh) {
        if (customSounds[slot].audio) {
            customSounds[slot].audio.pause();
            URL.revokeObjectURL(customSounds[slot].audio.src);
            customSounds[slot].audio = null;
        }
        customSounds[slot].fileName = null;
        nameEl.textContent = filePathOrName + ' (見つかりません)';
        nameEl.classList.remove('has-file');
        if (slot === 'opening') invalidateOpeningDecodedBuffer();
        return;
    }
    await bindSoundSlotFromFileHandle(slot, fh);
}

async function applyConfigFromObject(config) {
    closeCategoryDetail();

    if (config.speeds) {
        document.getElementById('speed1').value = config.speeds[0];
        document.getElementById('speed2').value = config.speeds[1];
        document.getElementById('speed3').value = config.speeds[2];
    }
    if (config.countdown) {
        document.getElementById('countdown-toggle').checked = config.countdown.enabled;
        document.getElementById('countdown-sec').value = config.countdown.seconds;
        toggleCountdownInput();
    }
    if (config.showTitle) {
        if (config.showTitle.main) document.getElementById('show-title').value = config.showTitle.main;
        if (config.showTitle.sub) document.getElementById('show-subtitle').value = config.showTitle.sub;
    }

    if (config.thinkingTime) {
        const tt = config.thinkingTime;
        if (tt.message !== undefined) {
            const tel = document.getElementById('thinking-time-text');
            if (tel) tel.value = String(tt.message);
        }
        if (tt.seEnabled !== undefined) {
            const ch = document.getElementById('thinking-se-enabled');
            if (ch) ch.checked = !!tt.seEnabled;
        }
    }

    if (config.floatingShapes) {
        applyFloatingShapesFromConfig(config.floatingShapes);
    }
    if (config.floatingShapesVisible) {
        applyFloatingShapesVisibleFromConfig(config.floatingShapesVisible);
    }
    applyThinkingShapesFromForm();

    if (config.sounds) {
        if (config.sounds.start && !config.sounds.start1) {
            config.sounds.start1 = config.sounds.start;
            config.sounds.start2 = config.sounds.start;
            config.sounds.start3 = config.sounds.start;
        }
        for (const slot of SOUND_CONFIG_SLOTS) {
            const saved = config.sounds[slot];
            if (!saved) continue;
            const sObj = typeof saved === 'object' ? saved : { file: saved, volume: 0.5 };
            if (sObj.volume !== undefined) {
                customSounds[slot].volume = sObj.volume;
                const volSlider = document.getElementById('sound-vol-' + slot);
                const volLabel = document.getElementById('sound-vol-label-' + slot);
                if (volSlider) volSlider.value = Math.round(sObj.volume * 100);
                if (volLabel) volLabel.textContent = String(Math.round(sObj.volume * 100));
            }
        }
        await Promise.all(SOUND_CONFIG_SLOTS.map(async (slot) => {
            const saved = config.sounds[slot];
            if (!saved) return;
            const sObj = typeof saved === 'object' ? saved : { file: saved, volume: 0.5 };
            await tryBindSoundFromRoot(slot, sObj.file);
        }));
    }

    if (config.version >= 3 && config.setlist) {
        setlist = [];
        for (const saved of config.setlist) {
            try {
                const subHandle = await rootHandle.getDirectoryHandle(saved.folder);
                const fileHandles = {};
                for await (const entry of subHandle.values()) {
                    if (entry.kind === 'file') fileHandles[entry.name] = entry;
                }

                const questions = [];
                for (const sq of saved.questions) {
                    const handle = fileHandles[sq.name];
                    if (handle) {
                        questions.push({ name: sq.name, fullPath: sq.fullPath, isColor: sq.isColor, handle });
                    }
                }

                setlist.push({
                    folder: saved.folder,
                    displayName: saved.displayName,
                    color: saved.color,
                    mode: saved.mode || 'slide',
                    questions
                });
            } catch (e) {
                console.warn(`Folder not found: ${saved.folder}`, e);
            }
        }
        renderSetlist();
    } else if (config.folder && config.order) {
        await addFolderToSetlist(config.folder);
        const cat = setlist.find(s => s.folder === config.folder);
        if (cat) {
            const restoredQ = [];
            for (const saved of config.order) {
                const found = cat.questions.find(q => q.fullPath === saved.fullPath);
                if (found) restoredQ.push({ ...found, isColor: saved.isColor });
            }
            if (restoredQ.length > 0) cat.questions = restoredQ;
        }
        renderSetlist();
    }
}

async function tryAutoLoadBundledConfig() {
    if (!rootHandle) return false;
    try {
        const fh = await rootHandle.getFileHandle(BUNDLED_CONFIG_FILENAME);
        const file = await fh.getFile();
        await applyConfigFromObject(JSON.parse(await file.text()));
        return true;
    } catch (_) {
        return false;
    }
}

async function saveConfig() {
    if (setlist.length === 0) return;

    const setlistPayload = setlist.map(cat => ({
        folder: cat.folder,
        displayName: cat.displayName,
        color: cat.color,
        mode: cat.mode || 'slide',
        questions: cat.questions.map(q => ({ name: q.name, fullPath: q.fullPath, isColor: q.isColor }))
    }));

    if (rootHandle) {
        try {
            const perm = await rootHandle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                const packPaths = {};
                for (const slot of SOUND_CONFIG_SLOTS) {
                    if (customSounds[slot].audio) {
                        const blob = await fetch(customSounds[slot].audio.src).then(r => r.blob());
                        const origName = customSounds[slot].fileName || '';
                        const extMatch = origName.match(/(\.[a-z0-9]+)$/i);
                        const ext = extMatch ? extMatch[1].toLowerCase() : '.m4a';
                        const relPath = `${SOUND_PACK_DIR}/${slot}${ext}`;
                        await writeBlobToRelativePath(rootHandle, relPath, blob);
                        packPaths[slot] = relPath;
                    } else {
                        packPaths[slot] = null;
                    }
                }
                const sounds = {};
                for (const slot of SOUND_CONFIG_SLOTS) {
                    sounds[slot] = { file: packPaths[slot], volume: customSounds[slot].volume };
                }
                const config = {
                    version: 12,
                    speeds: [
                        document.getElementById('speed1').value,
                        document.getElementById('speed2').value,
                        document.getElementById('speed3').value
                    ],
                    countdown: {
                        enabled: document.getElementById('countdown-toggle').checked,
                        seconds: document.getElementById('countdown-sec').value
                    },
                    showTitle: {
                        main: document.getElementById('show-title').value,
                        sub: document.getElementById('show-subtitle').value
                    },
                    thinkingTime: {
                        message: document.getElementById('thinking-time-text')?.value ?? 'thinkingTime',
                        seEnabled: document.getElementById('thinking-se-enabled')?.checked ?? true
                    },
                    floatingShapes: collectFloatingShapesForConfig(),
                    floatingShapesVisible: collectFloatingShapesVisibleForConfig(),
                    sounds,
                    setlist: setlistPayload
                };
                await writeBlobToRelativePath(
                    rootHandle,
                    BUNDLED_CONFIG_FILENAME,
                    new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
                );
                document.getElementById('file-status').innerText =
                    '✓ ' + rootHandle.name + '（' + BUNDLED_CONFIG_FILENAME + ' と ' + SOUND_PACK_DIR + '/ を保存）';
                playSaveSuccessTone();
                return;
            }
        } catch (e) {
            console.warn('bundled save failed', e);
            alert('フォルダへの一括保存に失敗しました: ' + (e.message || e) + '\nJSON のみダウンロードします。');
        }
    }

    const sounds = {};
    for (const slot of SOUND_CONFIG_SLOTS) {
        sounds[slot] = { file: customSounds[slot].fileName, volume: customSounds[slot].volume };
    }
    downloadConfigJsonFile({
        version: 12,
        speeds: [
            document.getElementById('speed1').value,
            document.getElementById('speed2').value,
            document.getElementById('speed3').value
        ],
        countdown: {
            enabled: document.getElementById('countdown-toggle').checked,
            seconds: document.getElementById('countdown-sec').value
        },
        showTitle: {
            main: document.getElementById('show-title').value,
            sub: document.getElementById('show-subtitle').value
        },
        thinkingTime: {
            message: document.getElementById('thinking-time-text')?.value ?? 'thinkingTime',
            seEnabled: document.getElementById('thinking-se-enabled')?.checked ?? true
        },
        floatingShapes: collectFloatingShapesForConfig(),
        floatingShapesVisible: collectFloatingShapesVisibleForConfig(),
        sounds,
        setlist: setlistPayload
    });
    playSaveSuccessTone();
}

async function loadConfig(input) {
    if (!rootHandle) { alert("先にフォルダを接続するか、ナビの「読込」からフォルダを選んでください"); input.value = ''; return; }
    try {
        const text = await input.files[0].text();
        await applyConfigFromObject(JSON.parse(text));
    } catch (e) {
        alert('設定の読み込みに失敗しました: ' + (e.message || String(e)));
    }
    input.value = '';
}

function openLoadConfigModal() {
    if (!loadConfigModal) return;
    document.getElementById('load-modal-step1').classList.remove('hidden');
    document.getElementById('load-modal-step2').classList.add('hidden');
    document.getElementById('load-modal-json').value = '';
    loadConfigModal.classList.add('visible');
}

function closeLoadConfigModal() {
    if (!loadConfigModal) return;
    loadConfigModal.classList.remove('visible');
    document.getElementById('load-modal-json').value = '';
}

async function loadModalPickFolder() {
    try {
        rootHandle = await window.showDirectoryPicker();
        await saveRootHandle(rootHandle);
        document.getElementById('file-status').innerText = '✓ ' + rootHandle.name;
        await buildFolderSelector();
        if (await tryAutoLoadBundledConfig()) {
            document.getElementById('file-status').innerText = '✓ ' + rootHandle.name + '（' + BUNDLED_CONFIG_FILENAME + ' を読込）';
            closeLoadConfigModal();
            return;
        }
        document.getElementById('load-modal-step1').classList.add('hidden');
        document.getElementById('load-modal-step2').classList.remove('hidden');
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

async function loadConfigFromModalJson(input) {
    if (!input.files[0]) return;
    if (!rootHandle) {
        alert('フォルダが選択されていません');
        input.value = '';
        return;
    }
    try {
        const text = await input.files[0].text();
        await applyConfigFromObject(JSON.parse(text));
        document.getElementById('file-status').innerText = '✓ ' + rootHandle.name + '（設定を読込）';
        closeLoadConfigModal();
    } catch (e) {
        alert('設定の読み込みに失敗しました: ' + (e.message || String(e)));
    }
    input.value = '';
}

// --- 7. Help & UI Toggles ---
function toggleHelp() {
    helpOverlay.classList.toggle('visible');
}

function toggleCountdownInput() {
    const on = document.getElementById('countdown-toggle').checked;
    document.getElementById('countdown-sec').disabled = !on;
}

// --- 8. Keyboard Shortcuts ---
// Escape: skip/cancel current overlay, countdown, or animation (testing用)
function escapeAction() {
    if (showPhase !== 'quiz') return;
    if (quizLoading) {
        loadQuizId++;
        quizLoading = false;
        hideShowOverlay();
        return;
    }
    if (animState.countingDown) {
        animState.countingDown = false;
        document.getElementById('countdown-overlay').classList.remove('visible');
        return;
    }
    if (animState.playing) {
        detachSlideAnimEndListener();
        resetAnimState();
        quizImg.style.animation = '';
        quizImg.style.left = '0';
        quizImg.style.transform = 'translateX(110vw)';
        progressBar.classList.remove('active');
        progressBar.style.width = '0%';
        progressBar.style.transitionDuration = '0s';
        timerDisplay.textContent = '';
        timerDisplay.classList.remove('warning');
        return;
    }
    if (thinkingOverlayVisible) {
        hideThinkingOverlay();
        return;
    }
}

window.addEventListener('keydown', (e) => {
    if (loadConfigModal && loadConfigModal.classList.contains('visible')) {
        if (e.key === 'Escape') closeLoadConfigModal();
        return;
    }

    // Help overlay: always closeable
    if (helpOverlay.classList.contains('visible')) {
        if (e.key === 'Escape' || e.key.toLowerCase() === 'h' || e.key === '?') toggleHelp();
        return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (document.getElementById('play-mode').style.display === 'none') {
        if (e.key.toLowerCase() === 'h' || e.key === '?') toggleHelp();
        return;
    }

    const k = e.key.toLowerCase();

    // Global play-mode keys
    if (k === 'f') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
        return;
    }
    if (k === 'h' || e.key === '?') { toggleHelp(); return; }

    // Escape: universal skip / cancel
    if (e.key === 'Escape') {
        e.preventDefault();
        escapeAction();
        return;
    }

    // ── Show overlay phases (opening / category / ending) ──
    if (showPhase !== 'quiz') {
        if (e.code === 'Space' || e.key === 'Enter') {
            e.preventDefault();
            advanceShow();
        }
        return;
    }

    // ── Quiz phase ──

    // Q-number overlay active: block everything
    if (quizLoading) return;

    // Countdown active: block everything
    if (animState.countingDown) return;

    // Animation playing: reveal and pause only
    if (animState.playing) {
        if (e.code === 'Space') { e.preventDefault(); reveal(); }
        else if (k === 'p') togglePause();
        return;
    }

    // Idle: controls depend on mode
    if (e.code === 'Space') { e.preventDefault(); reveal(); }
    else if (e.key === 'ArrowRight') nextQuiz();
    else if (e.key === 'ArrowLeft') prevQuiz();

    if (getCurrentMode() === 'static') return;

    // Slide-only controls
    if (k === '1') startAnim(1);
    else if (k === '2') startAnim(2);
    else if (k === '3') startAnim(3);
    else if (k === 'p') togglePause();
    else if (k === 'r') replayAnim();
});

// --- 9. Play Controls Auto-hide ---
const playBottom = document.querySelector('.play-bottom');

function showPlayControls() {
    playBottom.classList.add('visible');
    clearTimeout(controlsTimer);
    controlsTimer = setTimeout(() => {
        playBottom.classList.remove('visible');
    }, 3000);
}

document.querySelector('.stage')?.addEventListener('mousemove', () => {
    if (document.getElementById('play-mode').style.display !== 'none') {
        showPlayControls();
    }
});
playBottom?.addEventListener('mouseenter', () => {
    clearTimeout(controlsTimer);
    playBottom.classList.add('visible');
});
playBottom?.addEventListener('mouseleave', () => {
    controlsTimer = setTimeout(() => {
        playBottom.classList.remove('visible');
    }, 1500);
});

// --- 10. Auto-restore previous folder on load ---
initFloatingShapesInputDelegation();
applyThinkingShapesFromForm();
restoreRootHandle();

// --- 11. Remote Control (PeerJS) ---
let remotePeer = null;
let remoteConn = null;

function initRemote() {
    if (remotePeer) { remotePeer.destroy(); remotePeer = null; remoteConn = null; }

    const id = 'sq-' + Math.random().toString(36).substr(2, 6);
    remotePeer = new Peer(id);
    const statusEl = document.getElementById('remote-status');
    const qrEl = document.getElementById('remote-qr');
    const noteEl = document.getElementById('remote-note');
    const startBtn = document.getElementById('remote-start-btn');

    statusEl.textContent = '準備中...';
    statusEl.className = 'remote-status';

    remotePeer.on('open', (peerId) => {
        statusEl.textContent = '待機中';
        startBtn.textContent = 'リセット';

        const isHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
        let remoteUrl = null;
        if (isHttp) {
            const u = new URL('remote.html', window.location.href);
            u.searchParams.set('id', peerId);
            remoteUrl = u.href;
        }
        const qrPayload = remoteUrl || peerId;

        const qr = qrcode(0, 'M');
        qr.addData(qrPayload);
        qr.make();
        const qrSvg = qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });

        qrEl.innerHTML = `
            <div class="remote-connect-pair">
                <div class="remote-id-block">
                    <span class="remote-id-caption">接続ID（手入力）</span>
                    <span class="remote-id-value">${peerId}</span>
                </div>
                <div class="remote-qr-block">
                    <span class="remote-id-caption">${remoteUrl ? 'QRで接続' : 'QR（IDコピー用）'}</span>
                    <div class="remote-qr-inner">${qrSvg}</div>
                </div>
            </div>`;
        qrEl.classList.remove('hidden');

        noteEl.innerHTML = remoteUrl
            ? `QR を読み取ると <code>remote.html</code> が開き、<strong>そのまま接続</strong>します。読み取れない場合は ID を手入力`
            : `スマホから接続するには、同一 LAN 上の <strong>http(s) の URL</strong> でホストを開いてください（<code>file://</code> では QR は ID 文字列のみ）。<code>remote.html</code> に上の ID を入力`;
        noteEl.classList.remove('hidden');
    });

    remotePeer.on('connection', (conn) => {
        remoteConn = conn;
        statusEl.textContent = '接続済み ✓';
        statusEl.className = 'remote-status connected';

        conn.on('data', handleRemoteCommand);
        conn.on('close', () => {
            remoteConn = null;
            statusEl.textContent = '切断されました';
            statusEl.className = 'remote-status';
        });

        setTimeout(() => sendRemoteState(), 500);
    });

    remotePeer.on('error', (err) => {
        statusEl.textContent = 'エラー: ' + err.type;
        statusEl.className = 'remote-status';
    });
}

function handleRemoteCommand(cmd) {
    switch (cmd) {
        case 'advance': advanceShow(); break;
        case 'reveal': reveal(); break;
        case 'next': nextQuiz(); break;
        case 'prev': prevQuiz(); break;
        case 'start1': startAnim(1); break;
        case 'start2': startAnim(2); break;
        case 'start3': startAnim(3); break;
        case 'pause': togglePause(); break;
    }
    setTimeout(() => sendRemoteState(), 200);
}

function sendRemoteState() {
    if (!remoteConn || !remoteConn.open) return;
    const cat = setlist[currentSetIdx];
    remoteConn.send({
        type: 'state',
        phase: showPhase,
        category: cat?.displayName || '',
        catColor: cat?.color || '#ff2d8a',
        question: currentQIdx + 1,
        totalQ: getCurrentQuestions().length,
        mode: getCurrentMode(),
        playing: animState.playing,
        paused: animState.paused,
        thinkingWait: thinkingOverlayVisible
    });
}
