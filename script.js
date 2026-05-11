let quizData = [];
let currentIdx = 0;

const gridEl = document.getElementById('grid');
const quizImg = document.getElementById('quiz-img');
const playInfo = document.getElementById('play-info');

// 1. フォルダ読み込み
async function handleFolder(input) {
    const files = Array.from(input.files)
        .filter(f => f.type.startsWith('image/'))
        .sort((a,b) => a.name.localeCompare(b.name, undefined, {numeric: true}));
    
    quizData = [];
    for (let file of files) {
        const base64 = await toBase64(file);
        quizData.push({ name: file.name, data: base64, isColor: false });
    }
    renderGrid();
}

function toBase64(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

// 2. 一括設定
function bulkColor(val) {
    quizData.forEach(item => item.isColor = val);
    renderGrid();
}

// 3. 設定画面の描画
function renderGrid() {
    gridEl.innerHTML = '';
    quizData.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-num">${i+1}</div>
            <img src="${item.data}">
            <div style="font-size:11px; color:#aaa; overflow:hidden; white-space:nowrap;">${item.name}</div>
            <label style="font-size:12px; cursor:pointer;">
                <input type="checkbox" ${item.isColor ? 'checked' : ''} onchange="quizData[${currentIdx}].isColor = this.checked"> カラー再生
            </label>
        `;
        gridEl.appendChild(card);
    });
}

// ドラッグ＆ドロップ並び替え
new Sortable(gridEl, {
    animation: 150,
    onEnd: (evt) => {
        const item = quizData.splice(evt.oldIndex, 1)[0];
        quizData.splice(evt.newIndex, 0, item);
        renderGrid();
    }
});

// 4. モード切替
function switchMode(mode) {
    document.getElementById('config-mode').style.display = mode === 'config' ? 'block' : 'none';
    document.getElementById('play-mode').style.display = mode === 'play' ? 'block' : 'none';
    document.getElementById('nav-config').classList.toggle('active', mode === 'config');
    document.getElementById('nav-play').classList.toggle('active', mode === 'play');
    if(mode === 'play') loadQuiz();
}

// 5. クイズ再生制御
function loadQuiz() {
    if(quizData.length === 0) return;
    const item = quizData[currentIdx];
    
    quizImg.onanimationend = null;
    quizImg.classList.remove('animating');
    quizImg.src = item.data;
    
    // カラー設定の反映
    quizImg.classList.toggle('is-silhouette', !item.isColor);
    
    quizImg.style.left = "110%";
    quizImg.style.transform = "none";
    playInfo.innerText = `QUESTION ${currentIdx + 1} / ${quizData.length}`;
}

function startAnim(speedNum) {
    if(quizData.length === 0) return;
    const item = quizData[currentIdx];
    const dur = document.getElementById('speed' + speedNum).value;
    
    quizImg.classList.remove('animating');
    void quizImg.offsetWidth; // 強制再描画

    quizImg.style.setProperty('--dur', dur + 's');
    quizImg.classList.toggle('is-silhouette', !item.isColor);
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

// 6. 保存・読込
function saveProject() {
    if(quizData.length === 0) return;
    const blob = new Blob([JSON.stringify({
        quizData,
        speeds: [
            document.getElementById('speed1').value,
            document.getElementById('speed2').value,
            document.getElementById('speed3').value
        ]
    })], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'quiz_pro_v10.json';
    a.click();
}

function loadProject(input) {
    if(!input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = JSON.parse(e.target.result);
        quizData = data.quizData;
        document.getElementById('speed1').value = data.speeds[0];
        document.getElementById('speed2').value = data.speeds[1];
        document.getElementById('speed3').value = data.speeds[2];
        renderGrid();
    };
    reader.readAsText(input.files[0]);
}

// 7. ショートカットキー
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