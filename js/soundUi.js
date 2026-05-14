// サウンド設定ラベルなど DOM 更新（audio モジュールから分離）

export function setSoundFileLabel(slot, fileName) {
    const nameEl = document.getElementById('sound-name-' + slot);
    if (!nameEl) return;
    nameEl.textContent = fileName;
    nameEl.classList.add('has-file');
}

export function resetSoundFileLabel(slot) {
    const nameEl = document.getElementById('sound-name-' + slot);
    if (!nameEl) return;
    nameEl.textContent = slot === 'bgm' ? '未設定' : 'デフォルト';
    nameEl.classList.remove('has-file');
}
