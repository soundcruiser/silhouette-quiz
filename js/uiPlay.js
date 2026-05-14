// js/uiPlay.js
import { state } from './state.js';
import * as CONSTANTS from './constants.js';
import * as audio from './audio.js';
import { sendRemoteState } from './remoteSync.js';
import * as utils from './utils.js';

/** @type {((ev: AnimationEvent) => void) | null} */
let slideAnimEndListener = null;

let thinkingGuideIntervalId = null;
let thinkingGuideRingLen = 0;
let thinkingGuideTotalSec = 0;
let thinkingGuideRemaining = 0;

function detachSlideAnimEndListener() {
    const quizImg = document.getElementById('quiz-img');
    if (!quizImg) return;
    if (slideAnimEndListener) {
        quizImg.removeEventListener('animationend', slideAnimEndListener);
        slideAnimEndListener = null;
    }
    quizImg.onanimationend = null;
}

function normalizeFloatingShapesRow(raw) {
    const d = [...CONSTANTS.DEFAULT_FLOATING_SHAPES_ROW];
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
        html += `<span class="ts-shape ts-shape-${n}">${utils.escapeForShapeHtml(chars[n - 1])}</span>`;
    }
    return html;
}

function buildFloatingShapesLayerHtml(eventKey) {
    if (!isFloatingShapesVisibleForEvent(eventKey)) return '';
    return `<div class="thinking-shapes" aria-hidden="true">${buildFloatingShapesInnerHtml(eventKey)}</div>`;
}

export function applyThinkingShapesFromForm() {
    const host = document.getElementById('thinking-shapes-root');
    if (!host) return;
    if (!isFloatingShapesVisibleForEvent('thinking')) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = buildFloatingShapesInnerHtml('thinking');
}

function syncThinkingOverlayMessage() {
    const main = document.getElementById('thinking-main-text');
    const input = document.getElementById('thinking-time-text');
    if (!main) return;
    const raw = input && input.value.trim() ? input.value : 'thinkingTime';
    main.textContent = raw;
}

function cacheThinkingGuideRingLength() {
    const ring = document.getElementById('thinking-guide-ring');
    if (!ring || typeof ring.getTotalLength !== 'function') return;
    const len = ring.getTotalLength();
    thinkingGuideRingLen = len > 0 ? len : 270;
}

function stopThinkingGuideTimer() {
    if (thinkingGuideIntervalId != null) {
        clearInterval(thinkingGuideIntervalId);
        thinkingGuideIntervalId = null;
    }
}

function resetThinkingGuideTimerWidget() {
    stopThinkingGuideTimer();
    thinkingGuideTotalSec = 0;
    thinkingGuideRemaining = 0;
    const wrap = document.getElementById('thinking-guide-timer');
    if (wrap) {
        wrap.classList.add('hidden');
        wrap.classList.remove('thinking-guide-timer--expired');
        wrap.setAttribute('aria-hidden', 'true');
    }
    const past = document.getElementById('thinking-guide-past');
    if (past) past.setAttribute('hidden', '');
}

function updateThinkingGuideRingUI() {
    const ring = document.getElementById('thinking-guide-ring');
    const numEl = document.getElementById('thinking-guide-num');
    const wrap = document.getElementById('thinking-guide-timer');
    const past = document.getElementById('thinking-guide-past');
    if (!ring || !numEl || !wrap) return;
    const total = thinkingGuideTotalSec;
    const rem = thinkingGuideRemaining;
    numEl.textContent = String(Math.max(0, rem));
    if (thinkingGuideRingLen <= 0) cacheThinkingGuideRingLength();
    const len = thinkingGuideRingLen > 0 ? thinkingGuideRingLen : 270;
    ring.style.strokeDasharray = String(len);
    const frac = total > 0 ? Math.max(0, Math.min(1, rem / total)) : 0;
    ring.style.strokeDashoffset = String(len * (1 - frac));
    const expired = total > 0 && rem <= 0;
    wrap.classList.toggle('thinking-guide-timer--expired', expired);
    if (past) {
        if (expired) past.removeAttribute('hidden');
        else past.setAttribute('hidden', '');
    }
}

function getThinkingGuideSecondsFromForm() {
    const el = document.getElementById('thinking-guide-sec');
    const n = parseInt(String(el?.value ?? '0').trim(), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(600, n);
}

function startThinkingGuideTimer() {
    stopThinkingGuideTimer();
    const sec = getThinkingGuideSecondsFromForm();
    const wrap = document.getElementById('thinking-guide-timer');
    const past = document.getElementById('thinking-guide-past');
    if (!wrap) return;
    if (sec <= 0) {
        thinkingGuideTotalSec = 0;
        thinkingGuideRemaining = 0;
        wrap.classList.add('hidden');
        wrap.classList.remove('thinking-guide-timer--expired');
        wrap.setAttribute('aria-hidden', 'true');
        if (past) past.setAttribute('hidden', '');
        return;
    }
    thinkingGuideTotalSec = sec;
    thinkingGuideRemaining = sec;
    wrap.classList.remove('thinking-guide-timer--expired');
    if (past) past.setAttribute('hidden', '');
    wrap.classList.remove('hidden');
    wrap.setAttribute('aria-hidden', 'false');
    cacheThinkingGuideRingLength();
    updateThinkingGuideRingUI();
    thinkingGuideIntervalId = setInterval(() => {
        if (!state.thinkingOverlayVisible) {
            stopThinkingGuideTimer();
            return;
        }
        if (thinkingGuideRemaining <= 0) {
            stopThinkingGuideTimer();
            return;
        }
        thinkingGuideRemaining -= 1;
        updateThinkingGuideRingUI();
        if (thinkingGuideRemaining <= 0) stopThinkingGuideTimer();
    }, 1000);
}

export function hideShowOverlay() {
    const canvasBox = document.getElementById('canvas-box');
    const showOverlay = document.getElementById('show-overlay');
    canvasBox?.classList.remove('startup-splash-active');
    if (!showOverlay) return;
    showOverlay.style.display = 'none';
    showOverlay.className = 'show-overlay';
    showOverlay.innerHTML = '';
}

export function hideThinkingOverlay() {
    resetThinkingGuideTimerWidget();
    const overlay = document.getElementById('thinking-overlay');
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.setAttribute('aria-hidden', 'true');
    }
    const wasVisible = state.thinkingOverlayVisible;
    state.thinkingOverlayVisible = false;
    audio.stopThinkingLoopSound();
    if (wasVisible) sendRemoteState();
}

async function showThinkingOverlay() {
    if (state.thinkingOverlayVisible) return;
    const overlay = document.getElementById('thinking-overlay');
    if (!overlay) return;
    applyThinkingShapesFromForm();
    syncThinkingOverlayMessage();
    state.thinkingOverlayVisible = true;
    overlay.classList.add('visible');
    overlay.setAttribute('aria-hidden', 'false');
    try {
        if (audio.audioCtx.state === 'suspended') await audio.audioCtx.resume();
    } catch {
        /* ignore */
    }
    audio.startThinkingLoopSound();
    startThinkingGuideTimer();
    sendRemoteState();
}

function spawnParticles() {
    const canvasBox = document.getElementById('canvas-box');
    if (!canvasBox) return;
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
        const size = 5 + Math.random() * 8 + 'px';
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
        el.style.animationDelay = Math.random() * 0.3 + 's';
        canvasBox.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }
}

export function enterStartupSplash() {
    hideThinkingOverlay();
    audio.stopOpeningLoop();
    audio.stopAllClonedCustomSounds();
    audio.stopBGM();
    state.showPhase = 'startup';
    resetAnimState();
    state.loadQuizId++;
    state.quizLoading = false;

    const quizControls = document.getElementById('quiz-controls');
    const showControls = document.getElementById('show-controls');
    const canvasBox = document.getElementById('canvas-box');
    const showOverlay = document.getElementById('show-overlay');
    quizControls.style.display = 'none';
    showControls.style.display = 'none';
    canvasBox?.classList.add('startup-splash-active');
    showOverlay.style.display = 'flex';
    showOverlay.className = 'show-overlay visible';
    renderStartupSplash();
    sendRemoteState();
}

function renderStartupSplash() {
    const showOverlay = document.getElementById('show-overlay');
    showOverlay.innerHTML = `
        <div class="show-screen show-startup">
            <div class="show-startup-aurora" aria-hidden="true"></div>
            <div class="show-startup-grid" aria-hidden="true"></div>
            <div class="show-startup-logo-frame">
                <span class="show-startup-logo-ring" aria-hidden="true"></span>
                <img class="show-startup-logo" src="./icons/opening-logo.png" alt="シルエットクイズ">
                <span class="show-startup-logo-sheen" aria-hidden="true"></span>
            </div>
            <div class="show-startup-brand">SILHOUETTE QUIZ</div>
            <div class="show-startup-prompt">
                <span class="show-startup-prompt-main">PRESS ENTER / SPACE</span>
                <span class="show-startup-prompt-sub">to start the show</span>
            </div>
        </div>
    `;
}

function renderOpening() {
    const showOverlay = document.getElementById('show-overlay');
    const tags = [];
    const copies = state.setlist.length > 0 ? Math.max(3, Math.ceil(50 / state.setlist.length)) : 0;
    for (let c = 0; c < copies; c++) {
        state.setlist.forEach((cat) => {
            const top = Math.random() * 85;
            const left = -5 + Math.random() * 95;
            const delay = (Math.random() * 5).toFixed(1);
            const dur = (4 + Math.random() * 5).toFixed(1);
            const size = 18 + Math.floor(Math.random() * 22);
            const rot = -15 + Math.floor(Math.random() * 30);
            tags.push(
                `<span class="show-float-tag" style="top:${top}%;left:${left}%;animation-delay:${delay}s;animation-duration:${dur}s;font-size:${size}px;color:${cat.color};--rot:${rot}deg">${utils.escapeForShapeHtml(cat.displayName)}</span>`
            );
        });
    }
    const floatingTags = tags.join('');
    const openingShapesLayer = buildFloatingShapesLayerHtml('opening');
    const totalQ = state.setlist.reduce((sum, cat) => sum + cat.questions.length, 0);
    const catCount = state.setlist.length;
    const title = document.getElementById('show-title')?.value || 'SILHOUETTE QUIZ';
    const sub = document.getElementById('show-subtitle')?.value || 'シルエットクイズ';

    showOverlay.innerHTML = `
        <div class="show-screen show-opening">
            <div class="show-float-layer">${floatingTags}</div>
            ${openingShapesLayer}
            <div class="show-deco-line"></div>
            <h1 class="show-main-title">${utils.escapeForShapeHtml(title)}</h1>
            <div class="show-sub-title">${utils.escapeForShapeHtml(sub)}</div>
            <div class="show-meta">
                <span>${catCount} カテゴリ</span>
                <span class="show-meta-dot">-</span>
                <span>${totalQ} 問</span>
            </div>
            <div class="show-deco-line"></div>
        </div>
    `;
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
    audio.startOpeningScreenAudio();
}

function renderCategoryTitle() {
    const showOverlay = document.getElementById('show-overlay');
    const cat = state.setlist[state.currentSetIdx];
    const roundNum = state.currentSetIdx + 1;
    const total = state.setlist.length;
    const isStatic = cat.mode === 'static';
    const modeTag = isStatic
        ? '<span class="show-cat-mode show-cat-mode-static">🔍 じっくり観察クイズ</span>'
        : '<span class="show-cat-mode show-cat-mode-slide">🎬 スライドクイズ</span>';
    const catShapesLayer = buildFloatingShapesLayerHtml('category');
    showOverlay.innerHTML = `
        <div class="show-screen show-category" style="--cat-color: ${cat.color}">
            ${catShapesLayer}
            <div class="show-round-label">Round ${roundNum} / ${total}</div>
            <h1 class="show-cat-name">${utils.escapeForShapeHtml(cat.displayName)}</h1>
            ${modeTag}
            <div class="show-cat-count">${cat.questions.length} 問</div>
            <div class="show-cat-bar" style="background: ${cat.color}"></div>
        </div>
    `;
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
    audio.playCategorySound();
}

function renderEnding() {
    const showOverlay = document.getElementById('show-overlay');
    const totalQ = state.setlist.reduce((sum, cat) => sum + cat.questions.length, 0);
    const endShapesLayer = buildFloatingShapesLayerHtml('ending');
    showOverlay.innerHTML = `
        <div class="show-screen show-ending">
            ${endShapesLayer}
            <div class="show-deco-line"></div>
            <h1 class="show-ending-title">FINISH!</h1>
            <div class="show-ending-sub">お疲れ様でした</div>
            <div class="show-meta">
                <span>${state.setlist.length} カテゴリ</span>
                <span class="show-meta-dot">-</span>
                <span>${totalQ} 問 完了</span>
            </div>
            <div class="show-deco-line"></div>
        </div>
    `;
    spawnParticles();
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
    audio.playEndingSound();
}

export function advanceShow() {
    const now = Date.now();
    if (now - state.lastAdvanceTime < 500) return;
    state.lastAdvanceTime = now;

    if (state.showPhase === 'startup') {
        enterShowPhase('opening');
    } else if (state.showPhase === 'opening') {
        if (state.setlist.length === 0) return;
        state.currentSetIdx = 0;
        state.currentQIdx = 0;
        enterShowPhase('category');
    } else if (state.showPhase === 'category') {
        enterShowPhase('quiz');
    } else if (state.showPhase === 'ending') {
        document.querySelector('[data-action="switchMode"][data-mode="config"]')?.dispatchEvent(
            new MouseEvent('click', { bubbles: true, cancelable: true })
        );
    }
}

export function enterShowPhase(phase) {
    const canvasBox = document.getElementById('canvas-box');
    canvasBox?.classList.remove('startup-splash-active');
    hideThinkingOverlay();
    audio.stopOpeningLoop();
    audio.stopAllClonedCustomSounds();
    state.showPhase = phase;
    resetAnimState();
    state.loadQuizId++;
    state.quizLoading = false;

    if (phase === 'opening' || phase === 'ending') {
        audio.stopBGM();
    } else if (phase === 'category') {
        audio.startBGM();
    }

    const quizControls = document.getElementById('quiz-controls');
    const showControls = document.getElementById('show-controls');
    const showOverlay = document.getElementById('show-overlay');
    const btnShowAdvance = document.getElementById('btn-show-advance');

    if (phase === 'quiz') {
        quizControls.style.display = '';
        showControls.style.display = 'none';
        loadQuiz();
        return;
    }

    quizControls.style.display = 'none';
    showControls.style.display = '';
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
        btnShowAdvance.textContent = '設定に戻る';
    }
    sendRemoteState();
}

export async function loadQuiz() {
    hideThinkingOverlay();
    const questions = state.getCurrentQuestions();
    if (questions.length === 0) return;
    resetAnimState();
    state.quizLoading = true;

    const thisId = ++state.loadQuizId;
    const cat = state.setlist[state.currentSetIdx];
    const isStatic = cat.mode === 'static';
    const canvasBox = document.getElementById('canvas-box');
    const stageEl = document.querySelector('.stage');
    const quizImg = document.getElementById('quiz-img');
    const showOverlay = document.getElementById('show-overlay');
    const progressBar = document.getElementById('progress-bar');
    const timerDisplay = document.getElementById('timer-display');
    const playInfo = document.getElementById('play-info');
    const playCounter = document.getElementById('play-counter');

    canvasBox.style.setProperty('--cat-color', cat.color);
    stageEl.classList.toggle('mode-static', isStatic);
    stageEl.classList.toggle('mode-slide', !isStatic);

    quizImg.style.visibility = 'hidden';

    showOverlay.innerHTML = `
        <div class="show-screen show-question-num" style="--cat-color: ${cat.color}">
            <span class="show-qnum">Q${state.currentQIdx + 1}</span>
            <span class="show-qnum-total">/ ${questions.length}</span>
        </div>
    `;
    showOverlay.style.display = 'flex';
    showOverlay.className = 'show-overlay visible';
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
    audio.playQIntroSound();

    const item = questions[state.currentQIdx];
    detachSlideAnimEndListener();
    quizImg.className = '';
    const url = await utils.getFileUrl(item);
    if (thisId !== state.loadQuizId) return;
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

    document.getElementById('play-round').textContent = `ROUND ${state.currentSetIdx + 1}`;
    playInfo.textContent = cat.displayName;
    playCounter.innerHTML = `<span class="play-counter-q">Q${state.currentQIdx + 1}</span><span class="play-counter-total"> / ${questions.length}</span>`;

    await new Promise((r) => setTimeout(r, 1500));
    if (thisId !== state.loadQuizId) return;

    quizImg.style.visibility = 'visible';
    state.quizLoading = false;
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
    audio.playQAfterSound();
    hideShowOverlay();
    sendRemoteState();
}

function runCountdown(seconds, callback, speedNum) {
    state.animState.countingDown = true;
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    overlay.classList.add('visible');
    let remaining = seconds;
    const cdColors = ['#00e5ff', '#ffe42d', '#ff2d8a', '#8aff2d', '#ff8a2d'];

    function tick() {
        if (remaining <= 0) {
            overlay.classList.remove('visible');
            state.animState.countingDown = false;
            audio.playStartSound(speedNum);
            callback();
            return;
        }
        const color = cdColors[remaining % cdColors.length];
        numEl.textContent = remaining;
        numEl.style.color = color;
        numEl.classList.remove('pop');
        void numEl.offsetWidth;
        numEl.classList.add('pop');
        audio.playCountdownTick(remaining);
        remaining--;
        setTimeout(tick, 1000);
    }
    tick();
}

function startTimer(dur) {
    clearInterval(state.animState.timerId);
    const totalMs = dur * 1000;
    const quizImg = document.getElementById('quiz-img');
    const progressBar = document.getElementById('progress-bar');
    const timerDisplay = document.getElementById('timer-display');
    state.animState.timerId = setInterval(() => {
        if (state.animState.paused) return;
        const elapsed = performance.now() - state.animState.startTime - state.animState.elapsed;
        const remaining = Math.max(0, (totalMs - elapsed) / 1000);
        timerDisplay.textContent = remaining.toFixed(1) + 's';
        timerDisplay.classList.toggle('warning', remaining < 2);
        if (remaining <= 0) clearInterval(state.animState.timerId);
    }, 100);
}

function executeAnim(speedNum) {
    const quizImg = document.getElementById('quiz-img');
    const progressBar = document.getElementById('progress-bar');
    const timerDisplay = document.getElementById('timer-display');
    const dur = parseFloat(document.getElementById('speed' + speedNum).value);
    state.animState.playing = true;
    state.animState.startTime = performance.now();

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
        if (state.showPhase === 'quiz' && !state.quizLoading && state.getCurrentMode() === 'slide') {
            void showThinkingOverlay();
        }
    };
    quizImg.addEventListener('animationend', slideAnimEndListener);
}

export function startAnim(speedNum) {
    if (state.showPhase !== 'quiz' || state.quizLoading) return;
    if (state.getCurrentQuestions().length === 0) return;
    if (state.animState.countingDown || state.animState.playing) return;
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();

    const quizImg = document.getElementById('quiz-img');
    const canvasBox = document.getElementById('canvas-box');

    hideThinkingOverlay();
    resetAnimState();
    state.animState.lastSpeed = speedNum;

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
        audio.playStartSound(speedNum);
        executeAnim(speedNum);
    }
}

export function reveal() {
    if (state.showPhase !== 'quiz' || state.quizLoading) return;
    if (state.getCurrentQuestions().length === 0) return;
    if (state.animState.countingDown) return;
    if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();

    const quizImg = document.getElementById('quiz-img');
    const canvasBox = document.getElementById('canvas-box');
    const progressBar = document.getElementById('progress-bar');
    const timerDisplay = document.getElementById('timer-display');

    hideThinkingOverlay();
    audio.playRevealSound();
    resetAnimState();
    detachSlideAnimEndListener();

    quizImg.classList.remove('animating', 'is-silhouette', 'revealed-img');
    quizImg.style.animation = '';
    quizImg.style.left = '50%';
    quizImg.style.transform = 'translateX(-50%)';

    void quizImg.offsetWidth;
    quizImg.classList.add('revealed-img');
    canvasBox.classList.add('revealed');

    quizImg.addEventListener(
        'animationend',
        function onRevealEnd() {
            quizImg.removeEventListener('animationend', onRevealEnd);
            quizImg.classList.remove('revealed-img');
            quizImg.style.left = '50%';
            quizImg.style.transform = 'translateX(-50%)';
        },
        { once: true }
    );

    progressBar.classList.remove('active');
    progressBar.style.width = '100%';
    progressBar.style.transitionDuration = '0.3s';
    timerDisplay.textContent = '';

    spawnParticles();
    sendRemoteState();
}

export function togglePause() {
    if (!state.animState.playing) return;
    const btn = document.getElementById('btn-pause');
    const quizImg = document.getElementById('quiz-img');
    const progressBar = document.getElementById('progress-bar');

    if (!state.animState.paused) {
        state.animState.paused = true;
        quizImg.style.animationPlayState = 'paused';
        progressBar.style.transitionPlayState = 'paused';
        btn.textContent = '▶';
        btn.style.borderColor = 'var(--lime)';
        btn.style.color = 'var(--lime)';
    } else {
        state.animState.paused = false;
        quizImg.style.animationPlayState = 'running';
        progressBar.style.transitionPlayState = 'running';
        btn.textContent = '⏸';
        btn.style.borderColor = '';
        btn.style.color = '';
    }
}

export function replayAnim() {
    startAnim(state.animState.lastSpeed || 2);
}

function resetAnimState() {
    state.animState.playing = false;
    state.animState.paused = false;
    clearInterval(state.animState.timerId);
    state.animState.timerId = null;
    const quizImg = document.getElementById('quiz-img');
    const progressBar = document.getElementById('progress-bar');
    const btn = document.getElementById('btn-pause');
    if (quizImg) {
        quizImg.style.animationPlayState = 'running';
    }
    if (progressBar) {
        progressBar.style.transitionPlayState = 'running';
    }
    if (btn) {
        btn.textContent = '⏸';
        btn.style.borderColor = '';
        btn.style.color = '';
    }
}

export function nextQuiz() {
    if (state.setlist.length === 0) return;
    if (state.showPhase !== 'quiz' || state.quizLoading) return;
    if (state.animState.countingDown || state.animState.playing) return;

    const questions = state.getCurrentQuestions();
    if (state.currentQIdx < questions.length - 1) {
        state.currentQIdx++;
        loadQuiz();
    } else if (state.currentSetIdx < state.setlist.length - 1) {
        state.currentSetIdx++;
        state.currentQIdx = 0;
        enterShowPhase('category');
    } else {
        enterShowPhase('ending');
    }
}

export function prevQuiz() {
    if (state.setlist.length === 0) return;
    if (state.showPhase !== 'quiz' || state.quizLoading) return;
    if (state.animState.countingDown || state.animState.playing) return;

    if (state.currentQIdx > 0) {
        state.currentQIdx--;
    } else if (state.currentSetIdx > 0) {
        state.currentSetIdx--;
        state.currentQIdx = state.setlist[state.currentSetIdx].questions.length - 1;
    } else {
        state.currentSetIdx = state.setlist.length - 1;
        state.currentQIdx = state.setlist[state.currentSetIdx].questions.length - 1;
    }
    loadQuiz();
}

export function escapeInQuiz() {
    if (state.showPhase !== 'quiz') return;
    if (state.quizLoading) {
        state.loadQuizId++;
        state.quizLoading = false;
        hideShowOverlay();
        return;
    }
    if (state.animState.countingDown) {
        state.animState.countingDown = false;
        document.getElementById('countdown-overlay')?.classList.remove('visible');
        return;
    }
    if (state.animState.playing) {
        detachSlideAnimEndListener();
        resetAnimState();
        const quizImg = document.getElementById('quiz-img');
        const progressBar = document.getElementById('progress-bar');
        const timerDisplay = document.getElementById('timer-display');
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
    if (state.thinkingOverlayVisible) {
        hideThinkingOverlay();
    }
}
