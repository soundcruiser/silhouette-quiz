// js/uiPlay.js
import { state } from './state.js';
import * as CONSTANTS from './constants.js';
import * as audio from './audio.js';
import { sendRemoteState } from './remoteSync.js';
import * as utils from './utils.js';

export function enterStartupSplash() {
    // 既存の enterStartupSplash() の処理
    audio.stopAllPreviews();
    audio.stopBGM();
    state.showPhase = 'startup';
    resetAnimState();
    state.loadQuizId++;
    state.quizLoading = false;

    document.getElementById('quiz-controls').style.display = 'none';
    document.getElementById('show-controls').style.display = 'none';
    document.getElementById('show-overlay').style.display = 'flex';
    document.getElementById('show-overlay').className = 'show-overlay visible';
    
    // 既存の renderStartupSplash() の innerHTML 生成をここに記述
    
    sendRemoteState();
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
        // UIConfig の関数を呼ぶならイベントかコールバックにしますが、直接importして switchMode('config') 等を呼びます
        document.querySelector('[data-mode="config"]').click(); // イベント委譲経由で戻る
    }
}

export function enterShowPhase(phase) {
    state.showPhase = phase;
    resetAnimState();
    state.loadQuizId++;
    state.quizLoading = false;

    if (phase === 'opening' || phase === 'ending') {
        audio.stopBGM();
    } else if (phase === 'category') {
        audio.startBGM();
    }

    if (phase === 'quiz') {
        document.getElementById('quiz-controls').style.display = '';
        document.getElementById('show-controls').style.display = 'none';
        loadQuiz();
        return;
    }

    document.getElementById('quiz-controls').style.display = 'none';
    document.getElementById('show-controls').style.display = '';
    const showOverlay = document.getElementById('show-overlay');
    showOverlay.style.display = 'flex';
    showOverlay.className = 'show-overlay visible';

    if (phase === 'opening') {
        // 既存の renderOpening()
        document.getElementById('btn-show-advance').textContent = 'START';
    } else if (phase === 'category') {
        // 既存の renderCategoryTitle()
        document.getElementById('btn-show-advance').textContent = 'READY';
    } else if (phase === 'ending') {
        // 既存の renderEnding()
        document.getElementById('btn-show-advance').textContent = 'CONFIG に戻る';
    }
    sendRemoteState();
}

export function loadQuiz() {
    const questions = state.getCurrentQuestions();
    if (questions.length === 0) return;
    resetAnimState();
    state.quizLoading = true;
    
    // 既存の loadQuiz() の非同期処理・画像表示処理を移植
    // urlの取得には utils.getFileUrl(item) を使用
}

export function startAnim(speedNum) {
    if (state.showPhase !== 'quiz' || state.quizLoading) return;
    if (state.getCurrentQuestions().length === 0) return;
    if (state.animState.countingDown || state.animState.playing) return;
    
    resetAnimState();
    state.animState.lastSpeed = speedNum;

    const countdownOn = document.getElementById('countdown-toggle').checked;
    const countdownSec = parseInt(document.getElementById('countdown-sec').value) || 3;
    
    if (countdownOn && countdownSec > 0) {
        // runCountdown()
    } else {
        audio.playStartSound(speedNum);
        executeAnim(speedNum);
    }
}

export function reveal() {
    if (state.showPhase !== 'quiz' || state.quizLoading) return;
    if (state.animState.countingDown) return;
    
    audio.playRevealSound();
    resetAnimState();

    const quizImg = document.getElementById('quiz-img');
    quizImg.classList.remove('animating', 'is-silhouette', 'revealed-img');
    quizImg.style.animation = '';
    quizImg.style.left = '50%';
    quizImg.style.transform = 'translateX(-50%)';

    void quizImg.offsetWidth;
    quizImg.classList.add('revealed-img');
    document.getElementById('canvas-box').classList.add('revealed');

    // パーティクル演出など
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
    } else {
        state.animState.paused = false;
        quizImg.style.animationPlayState = 'running';
        progressBar.style.transitionPlayState = 'running';
        btn.textContent = '⏸';
    }
}

function resetAnimState() {
    state.animState.playing = false;
    state.animState.paused = false;
    clearInterval(state.animState.timerId);
    // その他の初期化
}

// nextQuiz(), prevQuiz() などの移動系関数もここに移設
export function nextQuiz() { /* ... */ }
export function prevQuiz() { /* ... */ }