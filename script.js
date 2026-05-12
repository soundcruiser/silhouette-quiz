let rootHandle = null;
let quizData = [];
let currentIdx = 0;

const gridEl = document.getElementById('grid');
const quizImg = document.getElementById('quiz-img');
const playInfo = document.getElementById('play-info');

// 1. 親フォルダに接続 & セレクター生成
async function requestDirectoryAccess() {
    try {
        rootHandle = await window.showDirectoryPicker();
        document.getElementById('file-status').innerText = "親フォルダ: " + rootHandle.name;
        
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
        if(oldSelector) oldSelector.remove();
        panel.appendChild(selector);

    } catch (err) {
        console.error("Access denied", err);
    }
}

// 2. 特定フォルダ読み込み
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
    
    quizData.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    currentIdx = 0;
    renderGrid();
}

// 3. UI表示
async function getFileUrl(item) {
    try {
        const file = await item.handle.getFile();
        return URL.createObjectURL(file);
    } catch (e) { return ""; }
}

async function renderGrid() {
    gridEl.innerHTML = '';
    for (let i = 0; i < quizData.length; i++) {
        const item = quizData[i];
        const url = await getFileUrl(item);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div style="color:var(--gold); font-weight:bold;">${i+1}</div>
            <img src="${url}">
            <div style="font-size:10px; color:#aaa; overflow:hidden;">${item.name}</div>
            <label style="font-size:11px;"><input type="checkbox" ${item.isColor ? 'checked' : ''} onchange="quizData[${i}].isColor = this.checked"> カラー</label>
        `;
        gridEl.appendChild(card);
    }

    new Sortable(gridEl, {
        animation: 150,
        onEnd: (evt) => {
            const item = quizData.splice(evt.oldIndex, 1)[0];
            quizData.splice(evt.newIndex, 0, item);
            renderGrid();
        }
    });
}

function bulkColor(val) {
    quizData.forEach(item => item.isColor = val);
    renderGrid();
}

// 4. モード制御
function switchMode(mode) {
    document.getElementById('config-mode').style.display = mode === 'config' ? 'block' : 'none';
    document.getElementById('play-mode').style.display = mode === 'play' ? 'block' : 'none';
    document.getElementById('nav-config').classList.toggle('active', mode === 'config');
    document.getElementById('nav-play').classList.toggle('active', mode === 'play');
    if(mode === 'play') loadQuiz();
}

// 5. 再生エンジン
async function loadQuiz() {
    if(quizData.length === 0) return;
    const item = quizData[currentIdx];
    quizImg.onanimationend = null;
    quizImg.classList.remove('animating');
    quizImg.src = await getFileUrl(item);
    quizImg.classList.toggle('is-silhouette', !item.isColor);
    quizImg.style.left = "110%";
    quizImg.style.transform = "none";
    playInfo.innerText = `QUESTION ${currentIdx + 1} / ${quizData.length}`;
}

function startAnim(speedNum) {
    if(quizData.length === 0) return;
    const dur = document.getElementById('speed' + speedNum).value;
    quizImg.classList.remove('animating');
    void quizImg.offsetWidth;
    quizImg.style.setProperty('--dur', dur + 's');
    quizImg.classList.add('animating');
    quizImg.onanimationend = () => {
        quizImg.classList.remove('animating');
        quizImg.style.left = "110%"; 
    };
}

function reveal() {
    quizImg.classList.remove('animating', 'is-silhouette');
    quizImg.style.left = "50%";
    quizImg.style.transform = "translateX(-50%)";
}

// 6. 設定保存
function saveConfig() {
    if(quizData.length === 0) return;
    const config = {
        speeds: [document.getElementById('speed1').value, document.getElementById('speed2').value, document.getElementById('speed3').value],
        folder: quizData[0].fullPath.split('/')[0],
        order: quizData.map(d => ({ name: d.name, fullPath: d.fullPath, isColor: d.isColor }))
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(config)], {type: 'application/json'}));
    a.download = `config_${config.folder}.json`;
    a.click();
}

async function loadConfig(input) {
    if(!rootHandle) { alert("先に親フォルダを接続してください"); return; }
    const text = await input.files[0].text();
    const config = JSON.parse(text);
    
    // まずフォルダを読み込む
    await loadSpecificFolder(config.folder);
    
    // 保存された順番とカラー設定を復元
    const restoredData = [];
    for (let saved of config.order) {
        const found = quizData.find(item => item.fullPath === saved.fullPath);
        if (found) restoredData.push({ ...found, isColor: saved.isColor });
    }
    if(restoredData.length > 0) quizData = restoredData;
    renderGrid();
}

// 7. ショートカット
window.addEventListener('keydown', (e) => {
    if(document.getElementById('play-mode').style.display === 'none') return;
    const k = e.key.toLowerCase();
    if(e.code === 'Space') { e.preventDefault(); reveal(); }
    if(k === '1') startAnim(1);
    if(k === '2') startAnim(2);
    if(k === '3') startAnim(3);
    if(e.key === 'ArrowRight') { currentIdx = (currentIdx + 1) % quizData.length; loadQuiz(); }
    if(e.key === 'ArrowLeft') { currentIdx = (currentIdx - 1 + quizData.length) % quizData.length; loadQuiz(); }
    if(k === 'f') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
    }
});