// --- アクセス制限 ---
const SECRET_PASS = "ongy";

if (sessionStorage.getItem("auth") !== "true") {
    const input = prompt("【Silhouette Master Pro】\nアクセスコードを入力してください：");
    if (input === SECRET_PASS) {
        sessionStorage.setItem("auth", "true");
    } else {
        alert("コードが正しくありません。");
        document.body.innerHTML = `
            <div style="background:#0f1014; color:#f0c855; height:100vh; display:flex; align-items:center; justify-content:center; font-family:'Urbanist',sans-serif;">
                <div style="text-align:center; border:1.5px solid #f0c855; padding:48px; border-radius:16px;">
                    <h1 style="font-size:28px; margin:0 0 12px;">ACCESS DENIED</h1>
                    <p style="color:#8b8f9a; margin:0;">認証が必要です。ページを更新してやり直してください。</p>
                </div>
            </div>`;
        throw new Error("Authentication failed");
    }
}

// --- State ---
let rootHandle = null;
let quizData = [];
let currentIdx = 0;
let objectUrls = [];
let animState = { playing: false, paused: false, lastSpeed: 2, timerId: null, startTime: 0, elapsed: 0, countingDown: false };

// --- DOM References ---
const gridEl = document.getElementById('grid');
const quizImg = document.getElementById('quiz-img');
const playInfo = document.getElementById('play-info');
const playCounter = document.getElementById('play-counter');
const canvasBox = document.getElementById('canvas-box');
const progressBar = document.getElementById('progress-bar');
const timerDisplay = document.getElementById('timer-display');
const helpOverlay = document.getElementById('help-overlay');

// --- Audio (Web Audio API) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, duration, type = 'sine', gain = 0.15) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(g);
    g.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playRevealSound() {
    playTone(523, 0.15, 'sine', 0.2);
    setTimeout(() => playTone(659, 0.15, 'sine', 0.2), 100);
    setTimeout(() => playTone(784, 0.3, 'sine', 0.25), 200);
}

function playStartSound() {
    playTone(330, 0.08, 'square', 0.08);
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
async function requestDirectoryAccess() {
    try {
        rootHandle = await window.showDirectoryPicker();
        document.getElementById('file-status').innerText = "✓ " + rootHandle.name;

        const selector = document.createElement('select');
        selector.className = 'mode-btn';
        selector.onchange = (e) => loadSpecificFolder(e.target.value);

        const defaultOpt = document.createElement('option');
        defaultOpt.text = "-- セットを選択 --";
        selector.appendChild(defaultOpt);

        for await (const entry of rootHandle.values()) {
            if (entry.kind === 'directory' && !entry.name.startsWith('_')) {
                const opt = document.createElement('option');
                opt.value = entry.name;
                opt.text = "📂 " + entry.name;
                selector.appendChild(opt);
            }
        }

        const panel = document.getElementById('main-panel');
        const oldSelector = panel.querySelector('select');
        if (oldSelector) oldSelector.remove();
        panel.appendChild(selector);

    } catch (err) {
        if (err.name !== 'AbortError') console.error("Access denied", err);
    }
}

// --- 2. Folder Loading ---
async function loadSpecificFolder(folderName) {
    if (!rootHandle || folderName.includes("--")) return;

    const subFolderHandle = await rootHandle.getDirectoryHandle(folderName);
    quizData = [];

    for await (const entry of subFolderHandle.values()) {
        if (entry.kind === 'file' && /\.(jpe?g|png|webp|gif)$/i.test(entry.name)) {
            quizData.push({
                name: entry.name,
                fullPath: `${folderName}/${entry.name}`,
                isColor: false,
                handle: entry
            });
        }
    }

    quizData.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    currentIdx = 0;
    renderGrid();
}

// --- 3. Grid Rendering ---
async function renderGrid() {
    revokeAllUrls();
    gridEl.innerHTML = '';

    const fragment = document.createDocumentFragment();
    for (let i = 0; i < quizData.length; i++) {
        const item = quizData[i];
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
            const item = quizData.splice(evt.oldIndex, 1)[0];
            quizData.splice(evt.newIndex, 0, item);
            renderGrid();
        }
    });
}

function toggleCardColor(idx, checked) {
    quizData[idx].isColor = checked;
    const card = gridEl.children[idx];
    card.classList.toggle('is-silhouette-preview', !checked);
    const badge = card.querySelector('.badge');
    badge.className = `badge ${checked ? 'badge-color' : 'badge-silhouette'}`;
    badge.textContent = checked ? 'カラー' : 'シルエット';
}

function bulkColor(val) {
    quizData.forEach(item => item.isColor = val);
    renderGrid();
}

// --- 4. Mode Control ---
function switchMode(mode) {
    document.getElementById('config-mode').style.display = mode === 'config' ? 'block' : 'none';
    document.getElementById('play-mode').style.display = mode === 'play' ? 'block' : 'none';
    document.getElementById('nav-config').classList.toggle('active', mode === 'config');
    document.getElementById('nav-play').classList.toggle('active', mode === 'play');
    if (mode === 'play') loadQuiz();
}

// --- 5. Play Engine ---
async function loadQuiz() {
    if (quizData.length === 0) return;
    resetAnimState();

    const item = quizData[currentIdx];
    quizImg.onanimationend = null;
    quizImg.className = '';
    quizImg.src = await getFileUrl(item);
    quizImg.classList.toggle('is-silhouette', !item.isColor);
    quizImg.style.left = "110%";
    quizImg.style.transform = "none";
    quizImg.style.animation = '';
    canvasBox.classList.remove('revealed');
    progressBar.classList.remove('active');
    progressBar.style.width = '0%';
    progressBar.style.transitionDuration = '0s';
    timerDisplay.textContent = '';
    timerDisplay.classList.remove('warning');

    playInfo.innerText = `Q${currentIdx + 1}`;
    playCounter.textContent = `${currentIdx + 1} / ${quizData.length}`;
}

function startAnim(speedNum) {
    if (quizData.length === 0 || animState.countingDown) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    resetAnimState();
    animState.lastSpeed = speedNum;

    quizImg.classList.remove('revealed-img');
    quizImg.style.left = '110%';
    quizImg.style.transform = 'none';
    quizImg.style.animation = '';
    canvasBox.classList.remove('revealed');

    const countdownSec = parseInt(document.getElementById('countdown-sec').value) || 0;
    if (countdownSec > 0) {
        runCountdown(countdownSec, () => executeAnim(speedNum));
    } else {
        playStartSound();
        executeAnim(speedNum);
    }
}

function runCountdown(seconds, callback) {
    animState.countingDown = true;
    const overlay = document.getElementById('countdown-overlay');
    const numEl = document.getElementById('countdown-number');
    overlay.classList.add('visible');
    let remaining = seconds;

    function tick() {
        numEl.textContent = remaining;
        numEl.classList.remove('pop');
        void numEl.offsetWidth;
        numEl.classList.add('pop');
        playTone(440, 0.1, 'sine', 0.12);

        if (remaining <= 0) {
            overlay.classList.remove('visible');
            animState.countingDown = false;
            playStartSound();
            callback();
            return;
        }
        remaining--;
        setTimeout(tick, 1000);
    }
    tick();
}

function executeAnim(speedNum) {
    const dur = parseFloat(document.getElementById('speed' + speedNum).value);
    animState.playing = true;
    animState.startTime = performance.now();

    void quizImg.offsetWidth;
    quizImg.style.setProperty('--dur', dur + 's');
    quizImg.classList.add('animating');

    progressBar.style.transitionDuration = dur + 's';
    progressBar.classList.add('active');
    progressBar.style.width = '100%';

    startTimer(dur);

    quizImg.onanimationend = () => {
        quizImg.classList.remove('animating');
        quizImg.style.left = "110%";
        resetAnimState();
    };
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
        btn.style.borderColor = 'var(--green)';
        btn.style.color = 'var(--green)';
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
    if (quizData.length === 0) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playRevealSound();
    resetAnimState();

    quizImg.classList.remove('animating', 'is-silhouette');
    quizImg.style.animation = '';
    quizImg.style.left = "50%";
    quizImg.style.transform = "translateX(-50%)";
    quizImg.classList.add('revealed-img');
    canvasBox.classList.add('revealed');

    progressBar.classList.remove('active');
    progressBar.style.width = '100%';
    progressBar.style.transitionDuration = '0.3s';
    timerDisplay.textContent = '';

    spawnParticles();
}

function spawnParticles() {
    const colors = ['#f0c855', '#4ae885', '#6ec8db', '#a78bfa', '#e85454'];
    const rect = canvasBox.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    for (let i = 0; i < 24; i++) {
        const el = document.createElement('div');
        el.className = 'particle';
        const angle = (Math.PI * 2 * i) / 24;
        const dist = 60 + Math.random() * 120;
        el.style.left = cx + 'px';
        el.style.top = cy + 'px';
        el.style.setProperty('--tx', Math.cos(angle) * dist + 'px');
        el.style.setProperty('--ty', Math.sin(angle) * dist + 'px');
        el.style.background = colors[i % colors.length];
        el.style.width = (4 + Math.random() * 6) + 'px';
        el.style.height = el.style.width;
        canvasBox.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }
}

// --- Navigation ---
function nextQuiz() {
    currentIdx = (currentIdx + 1) % quizData.length;
    loadQuiz();
}

function prevQuiz() {
    currentIdx = (currentIdx - 1 + quizData.length) % quizData.length;
    loadQuiz();
}

// --- 6. Config Save/Load ---
function saveConfig() {
    if (quizData.length === 0) return;
    const config = {
        version: 2,
        speeds: [
            document.getElementById('speed1').value,
            document.getElementById('speed2').value,
            document.getElementById('speed3').value
        ],
        folder: quizData[0].fullPath.split('/')[0],
        order: quizData.map(d => ({ name: d.name, fullPath: d.fullPath, isColor: d.isColor }))
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `config_${config.folder}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

async function loadConfig(input) {
    if (!rootHandle) { alert("先にフォルダを接続してください"); return; }
    const text = await input.files[0].text();
    const config = JSON.parse(text);

    if (config.speeds) {
        document.getElementById('speed1').value = config.speeds[0];
        document.getElementById('speed2').value = config.speeds[1];
        document.getElementById('speed3').value = config.speeds[2];
    }

    await loadSpecificFolder(config.folder);

    const restoredData = [];
    for (let saved of config.order) {
        const found = quizData.find(item => item.fullPath === saved.fullPath);
        if (found) restoredData.push({ ...found, isColor: saved.isColor });
    }
    if (restoredData.length > 0) quizData = restoredData;
    renderGrid();
    input.value = '';
}

// --- 7. Help ---
function toggleHelp() {
    helpOverlay.classList.toggle('visible');
}

// --- 8. Keyboard Shortcuts ---
window.addEventListener('keydown', (e) => {
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
    if (e.code === 'Space') { e.preventDefault(); reveal(); }
    else if (k === '1') startAnim(1);
    else if (k === '2') startAnim(2);
    else if (k === '3') startAnim(3);
    else if (e.key === 'ArrowRight') nextQuiz();
    else if (e.key === 'ArrowLeft') prevQuiz();
    else if (k === 'p') togglePause();
    else if (k === 'r') replayAnim();
    else if (k === 'f') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    }
    else if (k === 'h' || e.key === '?') toggleHelp();
});
