// js/uiConfig.js
import { state } from './state.js';
import * as CONSTANTS from './constants.js';
import * as audio from './audio.js';
import * as fileSystem from './fileSystem.js';
import * as soundUi from './soundUi.js';
import * as uiPlay from './uiPlay.js';
import * as utils from './utils.js';

let controlsTimer = null;
let topChromeTimer = null;
let playChromeWasInTopZone = false;
let playChromeWasInBottomZone = false;
let playCursorIdleTimer = null;

const gridEl = () => document.getElementById('grid');
const setlistContainer = () => document.getElementById('setlist-container');

export function switchMode(mode) {
    document.getElementById('config-mode').style.display = mode === 'config' ? 'block' : 'none';
    document.getElementById('play-mode').style.display = mode === 'play' ? 'block' : 'none';
    document.getElementById('nav-config').classList.toggle('active', mode === 'config');
    document.getElementById('nav-play').classList.toggle('active', mode === 'play');
    document.body.classList.toggle('is-playing', mode === 'play');
    document.documentElement.classList.toggle('play-scroll-lock', mode === 'play');

    const playBottom = document.querySelector('.play-bottom');

    if (mode === 'play') {
        audio.stopAllPreviews();
        state.currentSetIdx = 0;
        state.currentQIdx = 0;
        document.body.classList.remove('play-chrome-top');
        playBottom?.classList.remove('visible');
        clearTimeout(controlsTimer);
        clearTimeout(topChromeTimer);
        playChromeWasInTopZone = false;
        playChromeWasInBottomZone = false;
        uiPlay.enterStartupSplash();
        resetPlayCursorIdle();
    } else {
        uiPlay.hideThinkingOverlay();
        audio.stopAllPreviews();
        audio.stopBGM();
        uiPlay.hideShowOverlay();
        document.body.classList.remove('play-chrome-top');
        playBottom?.classList.remove('visible');
        clearTimeout(controlsTimer);
        clearTimeout(topChromeTimer);
        playChromeWasInTopZone = false;
        playChromeWasInBottomZone = false;
        document.body.classList.remove('play-hide-cursor');
        clearTimeout(playCursorIdleTimer);
        playCursorIdleTimer = null;
    }
}

export function toggleHelp() {
    const helpOverlay = document.getElementById('help-overlay');
    if (!helpOverlay) return;
    helpOverlay.classList.toggle('visible');
    if (helpOverlay.classList.contains('visible')) {
        document.body.classList.remove('play-hide-cursor');
        clearTimeout(playCursorIdleTimer);
        playCursorIdleTimer = null;
    } else if (isPlayModeVisible()) {
        resetPlayCursorIdle();
    }
}

export function openLoadConfigModal() {
    const modal = document.getElementById('load-config-modal');
    if (!modal) return;
    document.getElementById('load-modal-step1').classList.remove('hidden');
    document.getElementById('load-modal-step2').classList.add('hidden');
    document.getElementById('load-modal-json').value = '';
    modal.classList.add('visible');
}

export function closeLoadConfigModal() {
    const modal = document.getElementById('load-config-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.getElementById('load-modal-json').value = '';
}

export function toggleCountdownInput() {
    const on = document.getElementById('countdown-toggle').checked;
    document.getElementById('countdown-sec').disabled = !on;
}

export function updateVolume(slot, val) {
    audio.updateVolume(slot, val);
}

export async function requestDirectoryAccess() {
    try {
        state.rootHandle = await window.showDirectoryPicker();
        document.getElementById('file-status').innerText = '✓ ' + state.rootHandle.name;
        await fileSystem.saveRootHandle(state.rootHandle);
        await buildFolderSelector();
        if (await tryAutoLoadBundledConfig()) {
            document.getElementById('file-status').innerText =
                '✓ ' + state.rootHandle.name + '（' + CONSTANTS.BUNDLED_CONFIG_FILENAME + ' を読込）';
        }
    } catch (err) {
        if (err.name !== 'AbortError') console.error('Access denied', err);
    }
}

async function buildFolderSelector() {
    const selector = document.createElement('select');
    selector.className = 'mode-btn';
    selector.id = 'folder-selector';
    selector.innerHTML = '<option>-- セットに追加 --</option>';

    for await (const entry of state.rootHandle.values()) {
        if (entry.kind === 'directory' && !entry.name.startsWith('_')) {
            const opt = document.createElement('option');
            opt.value = entry.name;
            opt.text = '📂 ' + entry.name;
            selector.appendChild(opt);
        }
    }

    selector.addEventListener('change', (e) => {
        const t = /** @type {HTMLSelectElement} */ (e.target);
        if (t.value && !t.value.includes('--')) {
            addFolderToSetlist(t.value);
            t.selectedIndex = 0;
        }
    });

    const panel = document.getElementById('main-panel');
    const old = panel.querySelector('#folder-selector');
    if (old) old.remove();
    panel.appendChild(selector);
}

async function addFolderToSetlist(folderName) {
    if (!state.rootHandle) return;
    if (state.setlist.find((s) => s.folder === folderName)) return;

    const subHandle = await state.rootHandle.getDirectoryHandle(folderName);
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

    state.setlist.push({
        folder: folderName,
        displayName: folderName,
        color: CONSTANTS.CATEGORY_COLORS[state.setlist.length % CONSTANTS.CATEGORY_COLORS.length],
        mode: 'slide',
        questions
    });

    renderSetlist();
}

export async function addAllFoldersToSetlist() {
    if (!state.rootHandle) {
        alert('先にフォルダを接続してください');
        return;
    }
    for await (const entry of state.rootHandle.values()) {
        if (entry.kind === 'directory' && !entry.name.startsWith('_')) {
            await addFolderToSetlist(entry.name);
        }
    }
}

function removeFromSetlist(idx) {
    state.setlist.splice(idx, 1);
    if (state.editingCategoryIdx === idx) closeCategoryDetail();
    else if (state.editingCategoryIdx > idx) state.editingCategoryIdx--;
    renderSetlist();
}

export function renderSetlist() {
    const empty = document.getElementById('setlist-empty');
    const container = setlistContainer();
    if (state.setlist.length === 0) {
        empty.style.display = 'block';
    } else {
        empty.style.display = 'none';
    }

    container.querySelectorAll('.setlist-item').forEach((el) => el.remove());

    state.setlist.forEach((cat, idx) => {
        const el = document.createElement('div');
        el.className = `setlist-item ${state.editingCategoryIdx === idx ? 'active-category' : ''}`;
        const modeLabel = cat.mode === 'static' ? '🔍 じっくり' : '🎬 スライド';
        const modeCls = cat.mode === 'static' ? 'mode-static-tag' : 'mode-slide-tag';
        el.innerHTML = `
            <span class="setlist-num">${idx + 1}</span>
            <span class="setlist-color-dot" style="background:${cat.color}" data-action="setlistCycleColor" data-idx="${idx}" title="色を変更"></span>
            <input class="setlist-name-input" value="${escapeAttr(cat.displayName)}" data-change="setlistDisplayName" data-idx="${idx}">
            <span class="setlist-mode-btn ${modeCls}" data-action="setlistToggleMode" data-idx="${idx}" title="モード切替">${modeLabel}</span>
            <span class="setlist-count">${cat.questions.length}問</span>
            <div class="setlist-actions">
                <button type="button" class="setlist-btn" data-action="setlistOpenDetail" data-idx="${idx}" title="問題を編集">✎</button>
                <button type="button" class="setlist-btn btn-remove" data-action="setlistRemove" data-idx="${idx}" title="削除">✕</button>
            </div>
        `;
        container.appendChild(el);
    });

    if (container._sortable) container._sortable.destroy();
    if (state.setlist.length > 0) {
        container._sortable = new Sortable(container, {
            animation: 200,
            draggable: '.setlist-item',
            ghostClass: 'sortable-ghost',
            filter: '.setlist-color-dot, .setlist-btn, .setlist-name-input, .btn-remove, .setlist-mode-btn',
            preventOnFilter: false,
            onEnd: (evt) => {
                const oldIdx = evt.oldDraggableIndex;
                const newIdx = evt.newDraggableIndex;
                if (oldIdx === newIdx) return;
                const item = state.setlist.splice(oldIdx, 1)[0];
                if (!item) return;
                state.setlist.splice(newIdx, 0, item);
                if (state.editingCategoryIdx === oldIdx) state.editingCategoryIdx = newIdx;
                else if (state.editingCategoryIdx > oldIdx && state.editingCategoryIdx <= newIdx) state.editingCategoryIdx--;
                else if (state.editingCategoryIdx < oldIdx && state.editingCategoryIdx >= newIdx) state.editingCategoryIdx++;
                renderSetlist();
            }
        });
    }
}

function escapeAttr(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

export function setlistDisplayName(idx, value) {
    const i = typeof idx === 'number' ? idx : parseInt(idx, 10);
    if (!state.setlist[i]) return;
    state.setlist[i].displayName = value || state.setlist[i].folder;
}

export function setlistCycleColor(idx) {
    const i = typeof idx === 'number' ? idx : parseInt(idx, 10);
    const currentColorIdx = CONSTANTS.CATEGORY_COLORS.indexOf(state.setlist[i].color);
    state.setlist[i].color = CONSTANTS.CATEGORY_COLORS[(currentColorIdx + 1) % CONSTANTS.CATEGORY_COLORS.length];
    renderSetlist();
}

export function setlistToggleMode(idx) {
    const i = typeof idx === 'number' ? idx : parseInt(idx, 10);
    state.setlist[i].mode = state.setlist[i].mode === 'static' ? 'slide' : 'static';
    renderSetlist();
}

export function setlistOpenDetail(idx) {
    const i = typeof idx === 'number' ? idx : parseInt(idx, 10);
    state.editingCategoryIdx = i;
    const cat = state.setlist[i];
    const categoryDetail = document.getElementById('category-detail');
    const categoryDetailName = document.getElementById('category-detail-name');
    categoryDetail.style.display = 'block';
    categoryDetailName.textContent = `${cat.displayName} (${cat.questions.length}問)`;
    categoryDetailName.style.color = cat.color;
    renderGrid();
    renderSetlist();
}

export function setlistRemove(idx) {
    const i = typeof idx === 'number' ? idx : parseInt(idx, 10);
    removeFromSetlist(i);
}

export function setAllModes(mode) {
    state.setlist.forEach((cat) => {
        cat.mode = mode;
    });
    renderSetlist();
}

export function closeCategoryDetail() {
    state.editingCategoryIdx = -1;
    document.getElementById('category-detail').style.display = 'none';
    gridEl().innerHTML = '';
    renderSetlist();
}

export async function renderGrid() {
    if (state.editingCategoryIdx < 0 || !state.setlist[state.editingCategoryIdx]) return;
    utils.revokeAllUrls();
    const g = gridEl();
    g.innerHTML = '';

    const questions = state.setlist[state.editingCategoryIdx].questions;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < questions.length; i++) {
        const item = questions[i];
        const url = await utils.getFileUrl(item);
        const card = document.createElement('div');
        card.className = `card ${!item.isColor ? 'is-silhouette-preview' : ''}`;
        card.dataset.index = String(i);
        card.innerHTML = `
            <div class="card-number">${i + 1}</div>
            <img src="${url}" draggable="false">
            <div class="card-name" title="${escapeAttr(item.name)}">${escapeAttr(item.name)}</div>
            <div class="card-toggle">
                <label>
                    <input type="checkbox" ${item.isColor ? 'checked' : ''} data-change="gridToggleColor" data-idx="${i}">
                    <span class="badge ${item.isColor ? 'badge-color' : 'badge-silhouette'}">${item.isColor ? 'カラー' : 'シルエット'}</span>
                </label>
            </div>
        `;
        fragment.appendChild(card);
    }
    g.appendChild(fragment);

    if (g._sortable) g._sortable.destroy();
    g._sortable = new Sortable(g, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        onEnd: (evt) => {
            const q = state.setlist[state.editingCategoryIdx].questions;
            const item = q.splice(evt.oldIndex, 1)[0];
            q.splice(evt.newIndex, 0, item);
            renderGrid();
        }
    });
}

export function gridToggleColor(idx, checked) {
    const i = typeof idx === 'number' ? idx : parseInt(idx, 10);
    if (state.editingCategoryIdx < 0) return;
    state.setlist[state.editingCategoryIdx].questions[i].isColor = checked;
    const g = gridEl();
    const card = g.children[i];
    if (!card) return;
    card.classList.toggle('is-silhouette-preview', !checked);
    const badge = card.querySelector('.badge');
    badge.className = `badge ${checked ? 'badge-color' : 'badge-silhouette'}`;
    badge.textContent = checked ? 'カラー' : 'シルエット';
}

export function bulkColor(val) {
    const v = val === true || val === 'true';
    if (state.editingCategoryIdx < 0) return;
    state.setlist[state.editingCategoryIdx].questions.forEach((item) => {
        item.isColor = v;
    });
    renderGrid();
}

async function bindSoundSlotFromFileHandle(slot, fileHandle) {
    const file = await fileHandle.getFile();
    const url = URL.createObjectURL(file);
    const audioEl = new Audio(url);
    audioEl.preload = 'auto';
    if (audio.customSounds[slot].audio) {
        audio.customSounds[slot].audio.pause();
        URL.revokeObjectURL(audio.customSounds[slot].audio.src);
    }
    audio.customSounds[slot].audio = audioEl;
    audio.customSounds[slot].fileName = file.name;
    if (slot === 'bgm') audio.syncBgmElementVolumeImmediate();
    else audioEl.volume = audio.customSounds[slot].volume;
    soundUi.setSoundFileLabel(slot, file.name);
    if (slot === 'opening') audio.invalidateOpeningDecodedBuffer();
}

async function tryBindSoundFromRoot(slot, filePathOrName) {
    if (!state.rootHandle) return;
    if (!filePathOrName) {
        audio.clearCustomSound(slot);
        soundUi.resetSoundFileLabel(slot);
        return;
    }
    const fh = await fileSystem.tryResolveSoundFileHandle(state.rootHandle, filePathOrName);
    if (!fh) {
        if (audio.customSounds[slot].audio) {
            audio.customSounds[slot].audio.pause();
            URL.revokeObjectURL(audio.customSounds[slot].audio.src);
            audio.customSounds[slot].audio = null;
        }
        audio.customSounds[slot].fileName = null;
        const nameEl = document.getElementById('sound-name-' + slot);
        if (nameEl) {
            nameEl.textContent = filePathOrName + ' (見つかりません)';
            nameEl.classList.remove('has-file');
        }
        if (slot === 'opening') audio.invalidateOpeningDecodedBuffer();
        return;
    }
    await bindSoundSlotFromFileHandle(slot, fh);
}

function collectFloatingShapesForConfig() {
    const o = {};
    for (const ev of CONSTANTS.FLOATING_SHAPE_EVENTS) {
        o[ev] = getFloatingShapesForEvent(ev);
    }
    return o;
}

function getFloatingShapesForEvent(event) {
    const fromInputs = Array.from({ length: 8 }, (_, i) => {
        const el = document.getElementById(`fs-${event}-${i}`);
        return el ? el.value.trim() : '';
    });
    return normalizeFloatingShapesRow(fromInputs);
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

function collectFloatingShapesVisibleForConfig() {
    const o = {};
    for (const ev of CONSTANTS.FLOATING_SHAPE_EVENTS) {
        const ch = document.getElementById(`fs-vis-${ev}`);
        o[ev] = ch ? !!ch.checked : true;
    }
    return o;
}

function applyFloatingShapesFromConfig(floatingShapes) {
    if (!floatingShapes || typeof floatingShapes !== 'object') return;
    for (const ev of CONSTANTS.FLOATING_SHAPE_EVENTS) {
        const row = normalizeFloatingShapesRow(floatingShapes[ev]);
        for (let i = 0; i < 8; i++) {
            const inp = document.getElementById(`fs-${ev}-${i}`);
            if (inp) inp.value = row[i];
        }
    }
}

function applyFloatingShapesVisibleFromConfig(vis) {
    if (!vis || typeof vis !== 'object') return;
    for (const ev of CONSTANTS.FLOATING_SHAPE_EVENTS) {
        if (vis[ev] === undefined) continue;
        const ch = document.getElementById(`fs-vis-${ev}`);
        if (ch) ch.checked = !!vis[ev];
    }
}

export async function applyConfigFromObject(config) {
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
        if (tt.guideSeconds !== undefined) {
            const g = document.getElementById('thinking-guide-sec');
            if (g) {
                const n = parseInt(String(tt.guideSeconds), 10);
                g.value = String(Number.isFinite(n) ? Math.min(600, Math.max(0, n)) : 30);
            }
        }
    }

    if (config.floatingShapes) {
        applyFloatingShapesFromConfig(config.floatingShapes);
    }
    if (config.floatingShapesVisible) {
        applyFloatingShapesVisibleFromConfig(config.floatingShapesVisible);
    }
    uiPlay.applyThinkingShapesFromForm();

    if (config.sounds) {
        if (config.sounds.start && !config.sounds.start1) {
            config.sounds.start1 = config.sounds.start;
            config.sounds.start2 = config.sounds.start;
            config.sounds.start3 = config.sounds.start;
        }
        for (const slot of CONSTANTS.SOUND_CONFIG_SLOTS) {
            const saved = config.sounds[slot];
            if (!saved) continue;
            const sObj = typeof saved === 'object' ? saved : { file: saved, volume: 0.5 };
            if (sObj.volume !== undefined) {
                audio.customSounds[slot].volume = sObj.volume;
                const volSlider = document.getElementById('sound-vol-' + slot);
                const volLabel = document.getElementById('sound-vol-label-' + slot);
                if (volSlider) volSlider.value = String(Math.round(sObj.volume * 100));
                if (volLabel) volLabel.textContent = String(Math.round(sObj.volume * 100));
            }
        }
        await Promise.all(
            CONSTANTS.SOUND_CONFIG_SLOTS.map(async (slot) => {
                const saved = config.sounds[slot];
                if (!saved) return;
                const sObj = typeof saved === 'object' ? saved : { file: saved, volume: 0.5 };
                await tryBindSoundFromRoot(slot, sObj.file);
            })
        );
    }

    if (config.version >= 3 && config.setlist) {
        state.setlist = [];
        for (const saved of config.setlist) {
            try {
                const subHandle = await state.rootHandle.getDirectoryHandle(saved.folder);
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

                state.setlist.push({
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
        const cat = state.setlist.find((s) => s.folder === config.folder);
        if (cat) {
            const restoredQ = [];
            for (const saved of config.order) {
                const found = cat.questions.find((q) => q.fullPath === saved.fullPath);
                if (found) restoredQ.push({ ...found, isColor: saved.isColor });
            }
            if (restoredQ.length > 0) cat.questions = restoredQ;
        }
        renderSetlist();
    }
}

export async function tryAutoLoadBundledConfig() {
    if (!state.rootHandle) return false;
    try {
        const fh = await state.rootHandle.getFileHandle(CONSTANTS.BUNDLED_CONFIG_FILENAME);
        const file = await fh.getFile();
        await applyConfigFromObject(JSON.parse(await file.text()));
        return true;
    } catch {
        return false;
    }
}

export async function saveConfig() {
    if (state.setlist.length === 0) return;

    const setlistPayload = state.setlist.map((cat) => ({
        folder: cat.folder,
        displayName: cat.displayName,
        color: cat.color,
        mode: cat.mode || 'slide',
        questions: cat.questions.map((q) => ({ name: q.name, fullPath: q.fullPath, isColor: q.isColor }))
    }));

    if (state.rootHandle) {
        try {
            const perm = await state.rootHandle.requestPermission({ mode: 'readwrite' });
            if (perm === 'granted') {
                const packPaths = {};
                for (const slot of CONSTANTS.SOUND_CONFIG_SLOTS) {
                    if (audio.customSounds[slot].audio) {
                        const blob = await fetch(audio.customSounds[slot].audio.src).then((r) => r.blob());
                        const origName = audio.customSounds[slot].fileName || '';
                        const extMatch = origName.match(/(\.[a-z0-9]+)$/i);
                        const ext = extMatch ? extMatch[1].toLowerCase() : '.m4a';
                        const relPath = `${CONSTANTS.SOUND_PACK_DIR}/${slot}${ext}`;
                        await fileSystem.writeBlobToRelativePath(state.rootHandle, relPath, blob);
                        packPaths[slot] = relPath;
                    } else {
                        packPaths[slot] = null;
                    }
                }
                const sounds = {};
                for (const slot of CONSTANTS.SOUND_CONFIG_SLOTS) {
                    sounds[slot] = { file: packPaths[slot], volume: audio.customSounds[slot].volume };
                }
                const config = {
                    version: 13,
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
                        seEnabled: document.getElementById('thinking-se-enabled')?.checked ?? true,
                        guideSeconds: document.getElementById('thinking-guide-sec')?.value ?? '30'
                    },
                    floatingShapes: collectFloatingShapesForConfig(),
                    floatingShapesVisible: collectFloatingShapesVisibleForConfig(),
                    sounds,
                    setlist: setlistPayload
                };
                await fileSystem.writeBlobToRelativePath(
                    state.rootHandle,
                    CONSTANTS.BUNDLED_CONFIG_FILENAME,
                    new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
                );
                document.getElementById('file-status').innerText =
                    '✓ ' +
                    state.rootHandle.name +
                    '（' +
                    CONSTANTS.BUNDLED_CONFIG_FILENAME +
                    ' と ' +
                    CONSTANTS.SOUND_PACK_DIR +
                    '/ を保存）';
                audio.playSaveSuccessTone();
                return;
            }
        } catch (e) {
            console.warn('bundled save failed', e);
            alert('フォルダへの一括保存に失敗しました: ' + (e.message || e) + '\nJSON のみダウンロードします。');
        }
    }

    const sounds = {};
    for (const slot of CONSTANTS.SOUND_CONFIG_SLOTS) {
        sounds[slot] = { file: audio.customSounds[slot].fileName, volume: audio.customSounds[slot].volume };
    }
    fileSystem.downloadConfigJsonFile({
        version: 13,
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
            seEnabled: document.getElementById('thinking-se-enabled')?.checked ?? true,
            guideSeconds: document.getElementById('thinking-guide-sec')?.value ?? '30'
        },
        floatingShapes: collectFloatingShapesForConfig(),
        floatingShapesVisible: collectFloatingShapesVisibleForConfig(),
        sounds,
        setlist: setlistPayload
    });
    audio.playSaveSuccessTone();
}

export async function loadModalPickFolder() {
    try {
        state.rootHandle = await window.showDirectoryPicker();
        await fileSystem.saveRootHandle(state.rootHandle);
        document.getElementById('file-status').innerText = '✓ ' + state.rootHandle.name;
        await buildFolderSelector();
        if (await tryAutoLoadBundledConfig()) {
            document.getElementById('file-status').innerText =
                '✓ ' + state.rootHandle.name + '（' + CONSTANTS.BUNDLED_CONFIG_FILENAME + ' を読込）';
            closeLoadConfigModal();
            return;
        }
        document.getElementById('load-modal-step1').classList.add('hidden');
        document.getElementById('load-modal-step2').classList.remove('hidden');
    } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
    }
}

export async function loadConfigFromModalJson(input) {
    if (!input.files[0]) return;
    if (!state.rootHandle) {
        alert('フォルダが選択されていません');
        input.value = '';
        return;
    }
    try {
        const text = await input.files[0].text();
        await applyConfigFromObject(JSON.parse(text));
        document.getElementById('file-status').innerText = '✓ ' + state.rootHandle.name + '（設定を読込）';
        closeLoadConfigModal();
    } catch (e) {
        alert('設定の読み込みに失敗しました: ' + (e.message || String(e)));
    }
    input.value = '';
}

export function triggerJsonSelect() {
    document.getElementById('load-modal-json')?.click();
}

export function initFloatingShapesDelegation() {
    const root = document.querySelector('.floating-shapes-details');
    if (!root) return;
    root.addEventListener('input', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t.classList?.contains('fs-cell')) return;
        if (state.thinkingOverlayVisible && t.id && t.id.startsWith('fs-thinking-')) {
            uiPlay.applyThinkingShapesFromForm();
        }
    });
    root.addEventListener('change', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t.classList?.contains('fs-vis')) return;
        if (state.thinkingOverlayVisible && t.id === 'fs-vis-thinking') {
            uiPlay.applyThinkingShapesFromForm();
        }
    });
}

export async function bootstrapFromStoredFolder() {
    const ok = await fileSystem.restoreRootHandle();
    if (!ok) return;
    document.getElementById('file-status').innerText = '✓ ' + state.rootHandle.name;
    await buildFolderSelector();
    if (await tryAutoLoadBundledConfig()) {
        document.getElementById('file-status').innerText =
            '✓ ' + state.rootHandle.name + '（' + CONSTANTS.BUNDLED_CONFIG_FILENAME + ' を読込）';
    }
}

function isPlayModeVisible() {
    return document.getElementById('play-mode').style.display !== 'none';
}

function resetPlayCursorIdle() {
    const helpOverlay = document.getElementById('help-overlay');
    if (!helpOverlay) return;
    if (!isPlayModeVisible()) {
        document.body.classList.remove('play-hide-cursor');
        clearTimeout(playCursorIdleTimer);
        playCursorIdleTimer = null;
        return;
    }
    if (helpOverlay.classList.contains('visible')) {
        document.body.classList.remove('play-hide-cursor');
        clearTimeout(playCursorIdleTimer);
        playCursorIdleTimer = null;
        return;
    }
    document.body.classList.remove('play-hide-cursor');
    clearTimeout(playCursorIdleTimer);
    playCursorIdleTimer = setTimeout(() => {
        if (!isPlayModeVisible() || helpOverlay.classList.contains('visible')) return;
        document.body.classList.add('play-hide-cursor');
    }, CONSTANTS.PLAY_CURSOR_HIDE_AFTER_MS);
}

export function setupPlayChrome() {
    const playBottom = document.querySelector('.play-bottom');
    const loadConfigModal = document.getElementById('load-config-modal');
    const helpOverlay = document.getElementById('help-overlay');

    window.addEventListener(
        'wheel',
        (e) => {
            if (!isPlayModeVisible()) return;
            if (helpOverlay?.classList.contains('visible')) return;
            if (loadConfigModal && loadConfigModal.classList.contains('visible')) return;
            e.preventDefault();
        },
        { passive: false }
    );

    document.addEventListener(
        'mousemove',
        () => {
            resetPlayCursorIdle();
        },
        { passive: true }
    );

    let playChromePointerRaf = 0;
    let playChromePendingClientY = null;

    function armHidePlayBottom(delayMs) {
        clearTimeout(controlsTimer);
        controlsTimer = setTimeout(() => {
            playBottom?.classList.remove('visible');
        }, delayMs);
    }

    function extendPlayBottomChrome() {
        if (!playBottom) return;
        playBottom.classList.add('visible');
        armHidePlayBottom(3000);
    }

    function armHideTopChrome(delayMs) {
        clearTimeout(topChromeTimer);
        topChromeTimer = setTimeout(() => {
            document.body.classList.remove('play-chrome-top');
        }, delayMs);
    }

    function extendTopChrome() {
        document.body.classList.add('play-chrome-top');
        armHideTopChrome(3000);
    }

    function applyPlayChromeFromClientY(y) {
        if (!isPlayModeVisible()) return;
        const h = window.innerHeight;

        const inTop = y < CONSTANTS.PLAY_CHROME_TOP_PX;
        if (inTop) {
            extendTopChrome();
        } else if (playChromeWasInTopZone) {
            armHideTopChrome(700);
        }
        playChromeWasInTopZone = inTop;

        const inBottom = y > h - CONSTANTS.PLAY_CHROME_BOTTOM_PX;
        if (inBottom) {
            extendPlayBottomChrome();
        } else if (playChromeWasInBottomZone) {
            armHidePlayBottom(1200);
        }
        playChromeWasInBottomZone = inBottom;
    }

    document.querySelector('.stage')?.addEventListener(
        'mousemove',
        (e) => {
            if (!isPlayModeVisible()) return;
            playChromePendingClientY = e.clientY;
            if (playChromePointerRaf) return;
            playChromePointerRaf = requestAnimationFrame(() => {
                playChromePointerRaf = 0;
                const y = playChromePendingClientY;
                playChromePendingClientY = null;
                if (y == null) return;
                applyPlayChromeFromClientY(y);
            });
        },
        { passive: true }
    );

    document.querySelector('nav')?.addEventListener('mouseenter', () => {
        if (!isPlayModeVisible()) return;
        document.body.classList.add('play-chrome-top');
        clearTimeout(topChromeTimer);
    });
    document.querySelector('nav')?.addEventListener('mouseleave', () => {
        if (!isPlayModeVisible()) return;
        armHideTopChrome(1500);
    });

    playBottom?.addEventListener('mouseenter', () => {
        clearTimeout(controlsTimer);
        playBottom.classList.add('visible');
    });
    playBottom?.addEventListener('mouseleave', () => {
        armHidePlayBottom(1500);
    });
}

export function setupKeyboardShortcuts() {
    const helpOverlay = document.getElementById('help-overlay');
    const loadConfigModal = document.getElementById('load-config-modal');

    window.addEventListener('keydown', (e) => {
        if (loadConfigModal && loadConfigModal.classList.contains('visible')) {
            if (e.key === 'Escape') closeLoadConfigModal();
            return;
        }

        if (helpOverlay?.classList.contains('visible')) {
            if (e.key === 'Escape' || e.key.toLowerCase() === 'h' || e.key === '?') toggleHelp();
            return;
        }

        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (document.getElementById('play-mode').style.display === 'none') {
            if (e.key.toLowerCase() === 'h' || e.key === '?') toggleHelp();
            return;
        }

        if (
            e.key === 'ArrowUp' ||
            e.key === 'ArrowDown' ||
            e.key === 'PageUp' ||
            e.key === 'PageDown' ||
            e.key === 'Home' ||
            e.key === 'End'
        ) {
            e.preventDefault();
        }

        const k = e.key.toLowerCase();

        if (k === 'f') {
            if (!document.fullscreenElement) document.documentElement.requestFullscreen();
            else document.exitFullscreen();
            return;
        }
        if (k === 'h' || e.key === '?') {
            toggleHelp();
            return;
        }

        if (e.key === 'Escape') {
            e.preventDefault();
            uiPlay.escapeInQuiz();
            return;
        }

        if (state.showPhase !== 'quiz') {
            if (e.code === 'Space' || e.key === 'Enter') {
                e.preventDefault();
                uiPlay.advanceShow();
            }
            return;
        }

        if (state.quizLoading) return;

        if (state.animState.countingDown) return;

        if (state.animState.playing) {
            if (e.code === 'Space') {
                e.preventDefault();
                uiPlay.reveal();
            } else if (k === 'p') uiPlay.togglePause();
            return;
        }

        if (e.code === 'Space') {
            e.preventDefault();
            uiPlay.reveal();
        } else if (e.key === 'ArrowRight') uiPlay.nextQuiz();
        else if (e.key === 'ArrowLeft') uiPlay.prevQuiz();

        if (state.getCurrentMode() === 'static') return;

        if (k === '1') uiPlay.startAnim(1);
        else if (k === '2') uiPlay.startAnim(2);
        else if (k === '3') uiPlay.startAnim(3);
        else if (k === 'p') uiPlay.togglePause();
        else if (k === 'r') uiPlay.replayAnim();
    });
}
