// js/remote.js
import * as uiPlay from './uiPlay.js';
import { setRemoteConnection, sendRemoteState } from './remoteSync.js';

let remotePeer = null;
let remoteConn = null;

export function initRemote() {
    if (remotePeer) {
        remotePeer.destroy();
        remotePeer = null;
        remoteConn = null;
        setRemoteConnection(null);
    }

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
        
        // QRコード生成ロジック（既存コードのまま）
        const qr = qrcode(0, 'M');
        qr.addData(remoteUrl || peerId);
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
        setRemoteConnection(conn);
        statusEl.textContent = '接続済み ✓';
        statusEl.className = 'remote-status connected';

        conn.on('data', handleRemoteCommand);
        conn.on('close', () => {
            remoteConn = null;
            setRemoteConnection(null);
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
        case 'advance': uiPlay.advanceShow(); break;
        case 'reveal': uiPlay.reveal(); break;
        case 'next': uiPlay.nextQuiz(); break;
        case 'prev': uiPlay.prevQuiz(); break;
        case 'start1': uiPlay.startAnim(1); break;
        case 'start2': uiPlay.startAnim(2); break;
        case 'start3': uiPlay.startAnim(3); break;
        case 'pause': uiPlay.togglePause(); break;
    }
    setTimeout(() => sendRemoteState(), 200);
}

export { sendRemoteState } from './remoteSync.js';