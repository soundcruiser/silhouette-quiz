// --- 1. フォルダへのアクセス許可（サブフォルダ対応版） ---
async function requestDirectoryAccess() {
    try {
        directoryHandle = await window.showDirectoryPicker();
        document.getElementById('file-status').innerText = "接続済み: " + directoryHandle.name;
        
        quizData = [];
        // 再帰的なスキャンを開始
        await scanDirectory(directoryHandle, ""); 
        
        // 名前順にソート（パスを含めた名前でソート）
        quizData.sort((a, b) => a.fullPath.localeCompare(b.fullPath, undefined, {numeric: true}));
        renderGrid();
    } catch (err) {
        console.error("フォルダアクセス拒否:", err);
    }
}

// サブフォルダを潜ってファイルを拾い集める関数
async function scanDirectory(handle, currentPath) {
    for await (const entry of handle.values()) {
        const entryPath = currentPath === "" ? entry.name : `${currentPath}/${entry.name}`;
        
        if (entry.kind === 'file') {
            // 画像ファイルなら追加
            if (/\.(jpe?g|png|webp|gif|bmp)$/i.test(entry.name)) {
                quizData.push({
                    name: entry.name,
                    fullPath: entryPath, // フォルダ名を含んだパス
                    isColor: false,
                    handle: entry 
                });
            }
        } else if (entry.kind === 'directory') {
            // フォルダなら中に入る（再帰呼び出し）
            await scanDirectory(entry, entryPath);
        }
    }
}

// --- 2. 画像の表示（フルパスから取得するように修正） ---
async function getImageUrl(item) {
    if (!directoryHandle) return null;
    try {
        // ネストされたフォルダからファイルを探し出す
        let fileHandle = item.handle;
        
        // もしハンドルがnull（JSONから復元した直後など）の場合はパスから再取得を試みる
        if (!fileHandle) {
            fileHandle = await findFileByPath(directoryHandle, item.fullPath);
        }
        
        if (!fileHandle) return null;
        const file = await fileHandle.getFile();
        return URL.createObjectURL(file);
    } catch (e) {
        return null;
    }
}

// パス文字列からFileHandleを特定する補助関数
async function findFileByPath(rootHandle, path) {
    const parts = path.split('/');
    let currentHandle = rootHandle;
    
    for (let i = 0; i < parts.length - 1; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
    }
    return await currentHandle.getFileHandle(parts[parts.length - 1]);
}

// renderGrid内も item.fullPath を表示するように微調整
async function renderGrid() {
    gridEl.innerHTML = '';
    for (let i = 0; i < quizData.length; i++) {
        const item = quizData[i];
        const url = await getImageUrl(item);
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="card-num">${i+1}</div>
            <img src="${url}">
            <div style="font-size:10px; color:#666; word-break: break-all;">${item.fullPath}</div>
            <label><input type="checkbox" ${item.isColor ? 'checked' : ''} onchange="quizData[${i}].isColor = this.checked"> カラー</label>
        `;
        gridEl.appendChild(card);
    }
}