// --- アクセス制限 ---
const SECRET_PASS = "ongy";

if (sessionStorage.getItem("auth") !== "true") {
    const input = prompt("【Silhouette Master Pro】\nアクセスコードを入力してください：");
    if (input === SECRET_PASS) {
        sessionStorage.setItem("auth", "true");
    } else {
        alert("コードが正しくありません。");
        document.body.innerHTML = `
            <div style="background:#0a0a14; color:#ff2d8a; height:100vh; display:flex; align-items:center; justify-content:center; font-family:'Urbanist',sans-serif;">
                <div style="text-align:center; border:1.5px solid #ff2d8a; padding:48px; border-radius:16px;">
                    <h1 style="font-size:28px; margin:0 0 12px;">ACCESS DENIED</h1>
                    <p style="color:#9a9ab0; margin:0;">認証が必要です。ページを更新してやり直してください。</p>
                </div>
            </div>`;
        throw new Error("Authentication failed");
    }
}

// --- State ---
let rootHandle = null;
let setlist = []; // [{folder, displayName, color, questions:[{name,fullPath,isColor,handle}]}]
let currentSetIdx = 0;
let currentQIdx = 0;
let editingCategoryIdx = -1;
let objectUrls = [];
let animState = { playing: false, paused: false, lastSpeed: 2, timerId: null, startTime: 0, elapsed: 0, countingDown: false };

const CATEGORY_COLORS = ['#ff2d8a', '#00e5ff', '#ffe42d', '#8aff2d', '#ff8a2d', '#a78bfa'];

// --- DOM References ---
const gridEl = document.getElementById('grid');
const quizImg = document.getElementById('quiz-img');
const playInfo = document.getElementById('play-info');
const playCounter = document.getElementById('play-counter');
const canvasBox = document.getElementById('canvas-box');
const progressBar = document.getElementById('progress-bar');
const timerDisplay = document.getElementById('timer-display');
const helpOverlay = document.getElementById('help-overlay');
const setlistContainer = document.getElementById('setlist-container');
const setlistEmpty = document.getElementById('setlist-empty');
const categoryDetail = document.getElementById('category-detail');
const categoryDetailName = document.getElementById('category-detail-name');

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
    playTone(523, 0.12, 'square', 0.12);
    setTimeout(() => playTone(659, 0.12, 'square', 0.12), 80);
    setTimeout(() => playTone(784, 0.12, 'square', 0.15), 160);
    setTimeout(() => playTone(1047, 0.4, 'sine', 0.2), 240);
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
        await buildFolderSelector();
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
        el.innerHTML = `
            <span class="setlist-num">${idx + 1}</span>
            <span class="setlist-color-dot" style="background:${cat.color}" onclick="event.stopPropagation(); cycleColor(${idx})" title="色を変更"></span>
            <input class="setlist-name-input" value="${cat.displayName}" onchange="updateDisplayName(${idx}, this.value)" onclick="event.stopPropagation()">
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
            filter: '.setlist-color-dot, .setlist-btn, .setlist-name-input, .btn-remove',
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
        currentSetIdx = 0;
        currentQIdx = 0;
        loadQuiz();
    }
}

// --- 5. Play Engine (Setlist-aware) ---
function getCurrentQuestions() {
    if (setlist.length === 0) return [];
    return setlist[currentSetIdx]?.questions || [];
}

async function loadQuiz() {
    const questions = getCurrentQuestions();
    if (questions.length === 0) return;
    resetAnimState();

    const item = questions[currentQIdx];
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

    const cat = setlist[currentSetIdx];
    playInfo.innerText = `${cat.displayName}  Q${currentQIdx + 1}`;
    playInfo.style.color = '';
    playCounter.textContent = `${currentQIdx + 1}/${questions.length}  [${currentSetIdx + 1}/${setlist.length}]`;
}

function startAnim(speedNum) {
    if (getCurrentQuestions().length === 0 || animState.countingDown) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();

    resetAnimState();
    animState.lastSpeed = speedNum;

    quizImg.classList.remove('revealed-img');
    quizImg.style.left = '110%';
    quizImg.style.transform = 'none';
    quizImg.style.animation = '';
    canvasBox.classList.remove('revealed');

    const countdownOn = document.getElementById('countdown-toggle').checked;
    const countdownSec = parseInt(document.getElementById('countdown-sec').value) || 3;
    if (countdownOn && countdownSec > 0) {
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
    const cdColors = ['#00e5ff', '#ffe42d', '#ff2d8a', '#8aff2d', '#ff8a2d'];
    const cdTones = [523, 587, 659, 784, 880];

    function tick() {
        const color = cdColors[remaining % cdColors.length];
        numEl.textContent = remaining;
        numEl.style.color = color;
        numEl.classList.remove('pop');
        void numEl.offsetWidth;
        numEl.classList.add('pop');
        playTone(cdTones[remaining % cdTones.length], 0.12, 'sine', 0.15);

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
    if (getCurrentQuestions().length === 0) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playRevealSound();
    resetAnimState();

    quizImg.classList.remove('animating', 'is-silhouette', 'revealed-img');
    quizImg.style.animation = '';
    quizImg.style.left = "50%";
    quizImg.style.transform = "translateX(-50%)";

    void quizImg.offsetWidth;
    quizImg.classList.add('revealed-img');
    canvasBox.classList.add('revealed');

    quizImg.addEventListener('animationend', function onRevealEnd() {
        quizImg.removeEventListener('animationend', onRevealEnd);
        quizImg.classList.remove('revealed-img');
        quizImg.style.left = "50%";
        quizImg.style.transform = "translateX(-50%)";
    });

    progressBar.classList.remove('active');
    progressBar.style.width = '100%';
    progressBar.style.transitionDuration = '0.3s';
    timerDisplay.textContent = '';

    spawnParticles();
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

// --- Navigation (Setlist-aware) ---
function nextQuiz() {
    if (setlist.length === 0) return;
    const questions = getCurrentQuestions();
    if (currentQIdx < questions.length - 1) {
        currentQIdx++;
    } else if (currentSetIdx < setlist.length - 1) {
        currentSetIdx++;
        currentQIdx = 0;
    } else {
        currentSetIdx = 0;
        currentQIdx = 0;
    }
    loadQuiz();
}

function prevQuiz() {
    if (setlist.length === 0) return;
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

// --- 6. Config Save/Load (Setlist version) ---
function saveConfig() {
    if (setlist.length === 0) return;
    const config = {
        version: 3,
        speeds: [
            document.getElementById('speed1').value,
            document.getElementById('speed2').value,
            document.getElementById('speed3').value
        ],
        countdown: {
            enabled: document.getElementById('countdown-toggle').checked,
            seconds: document.getElementById('countdown-sec').value
        },
        setlist: setlist.map(cat => ({
            folder: cat.folder,
            displayName: cat.displayName,
            color: cat.color,
            questions: cat.questions.map(q => ({ name: q.name, fullPath: q.fullPath, isColor: q.isColor }))
        }))
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `setlist_${Date.now()}.json`;
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
    if (config.countdown) {
        document.getElementById('countdown-toggle').checked = config.countdown.enabled;
        document.getElementById('countdown-sec').value = config.countdown.seconds;
        toggleCountdownInput();
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
                    questions
                });
            } catch (e) {
                console.warn(`Folder not found: ${saved.folder}`, e);
            }
        }
        renderSetlist();
    } else if (config.folder && config.order) {
        // v2 backward compatibility
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
