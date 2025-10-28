(function(){
  'use strict';
  const auth = () => firebase.auth();
  const db = () => firebase.firestore();

  let html5QrCode = null; // Html5Qrcode のインスタンス
  let running = false;
  let lastIsbn = '';

  // ネイティブバーコードスキャン用の状態
  let nativeStream = null;
  let rafId = null;

  let currentScannerType = null; // 'native' | 'html5'
  let currentDeviceId = null;

  // DOM util
  const $ = (id) => document.getElementById(id);
  const setText = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
  function showSection(id, show=true){ const el = $(id); if (el) el.style.display = show ? 'block' : 'none'; }

  function showActionResult(title, html, type='info'){
    const resultEl = $('actionResult');
    if (!resultEl) return;
    let className = 'result-card';
    let icon = '📋';
    switch(type){
      case 'success': className += ' success'; icon = '✅'; break;
      case 'error': className += ' error'; icon = '❌'; break;
      case 'warning': className += ' warning'; icon = '⚠️'; break;
      case 'processing': className += ' processing'; icon = '⏳'; break;
    }
    resultEl.className = className;
    resultEl.innerHTML = `<h3>${icon} ${title}</h3><div>${html}</div>`;
    showSection('actionResultSection', true);
    resultEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ISBN helpers
  function toIsbn13(code){
    const digits = (code || '').replace(/[^0-9Xx]/g, '');
    if (digits.length === 13) return digits;
    if (digits.length !== 10) return '';
    const core = '978' + digits.substring(0,9);
    let sum = 0;
    for (let i=0;i<core.length;i++){
      const n = parseInt(core[i],10);
      sum += (i % 2 === 0) ? n : n*3;
    }
    const cd = (10 - (sum % 10)) % 10;
    return core + String(cd);
  }
  function normalizeIsbn(text){
    const raw = (text || '').replace(/[^0-9Xx]/g, '');
    if (raw.length === 13) return /^97[89]/.test(raw) ? raw : '';
    if (raw.length === 10) return toIsbn13(raw);
    return '';
  }

  // ISBN文字列の正規化（先頭の "ISBN-13:" などのプレフィックスやハイフンを除去して数字のみ抽出）
  function extractIsbn13(raw){
    if (!raw) return '';
    let text = String(raw).replace(/^\s*ISBN(?:-1[03])?:?\s*/i, '').replace(/[-\s]/g, '');
    // 13桁（978/979で開始）優先
    let m13 = text.match(/\b(97[89]\d{10})\b/) || String(raw).match(/\b(97[89]\d{10})\b/);
    if (m13) return m13[1];
    // ISBN-10 があれば13へ変換
    let m10 = text.match(/\b(\d{9}[\dXx])\b/) || String(raw).match(/\b(\d{9}[\dXx])\b/);
    if (m10) return toIsbn13(m10[1]);
    // フォールバック: 生テキストから数字のみ
    const digits = String(raw).replace(/[^0-9Xx]/g, '');
    if (digits.length === 13 && /^97[89]/.test(digits)) return digits;
    if (digits.length === 10) return toIsbn13(digits);
    return '';
  }

  async function fetchIsbnMeta(isbn13){
    try {
      const r = await fetch(`https://openlibrary.org/isbn/${isbn13}.json`);
      if (r.ok){
        const j = await r.json();
        return {
          isbn13,
          title: j.title || '',
          authors: Array.isArray(j.authors) ? j.authors.map(a=>a.name || a.key).join(', ') : '',
          publisher: Array.isArray(j.publishers) ? j.publishers.map(p=>p.name || p).join(', ') : '',
          published: j.publish_date || ''
        };
      }
    } catch {}
    try {
      const r2 = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`);
      if (r2.ok){
        const j2 = await r2.json();
        const item = (j2.items && j2.items[0]) ? j2.items[0].volumeInfo : null;
        if (item){
          return {
            isbn13,
            title: item.title || '',
            authors: (item.authors || []).join(', '),
            publisher: item.publisher || '',
            published: item.publishedDate || ''
          };
        }
      }
    } catch {}
    return { isbn13, title: '', authors: '', publisher: '', published: '' };
  }

  async function getBookByIsbn(isbn13){
    let snap = await db().collection('books').where('isbn13','==',isbn13).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };
    snap = await db().collection('books').where('isbn','==',isbn13).limit(1).get();
    if (!snap.empty) return { id: snap.docs[0].id, data: snap.docs[0].data() };
    return null;
  }

  // 任意のスキャン結果から本を特定（ISBN→内部ID/バーコードの順に試行）
  async function getBookByAny(input){
    const raw = String(input || '').trim();
    const isbn13 = extractIsbn13(raw);
    if (isbn13){
      const byIsbn = await getBookByIsbn(isbn13);
      if (byIsbn) return { ...byIsbn, isbn13 };
    }

    // 内部コード（book_id/ドキュメントID/barcode）で探索
    const code = raw.replace(/\s+/g,'').replace(/^ISBN(?:-1[03])?:?/i,'');

    // 1) ドキュメントID一致
    try {
      const doc = await db().collection('books').doc(code).get();
      if (doc.exists) return { id: doc.id, data: doc.data(), isbn13: doc.data()?.isbn13 || null };
    } catch {}

    // 2) book_id フィールド一致
    let snap = await db().collection('books').where('book_id','==', code).limit(1).get();
    if (!snap.empty){ const d=snap.docs[0]; return { id:d.id, data:d.data(), isbn13: d.data()?.isbn13 || null }; }

    // 3) barcode フィールド一致（必要ならbooksにbarcodeを保存）
    snap = await db().collection('books').where('barcode','==', code).limit(1).get();
    if (!snap.empty){ const d=snap.docs[0]; return { id:d.id, data:d.data(), isbn13: d.data()?.isbn13 || null }; }

    return null;
  }

  // book_id（=booksドキュメントID）基準で貸出/返却する
  async function autoCheckoutOrReturnByBook(bookObj, meta){
    const user = auth().currentUser;
    if (!user){ showActionResult('ログインが必要です','<p>先にログインしてください。</p>','error'); return; }
    if (!bookObj){ showActionResult('未登録の資料','<p>この識別子の蔵書は登録されていません。</p>','warning'); return; }

    const { id: bookId, data: b, isbn13 } = bookObj;
    const bookRef = db().collection('books').doc(bookId);

    // 返却: ユーザーの未返却で book_id 一致を検索
    const q = await db().collection('loans')
      .where('uid','==', user.uid)
      .where('book_id','==', bookId)
      .where('status','==','active')
      .orderBy('created_at','desc')
      .limit(1)
      .get();

    if (!q.empty){
      const loanDoc = q.docs[0].ref;
      await db().runTransaction(async (tx)=>{
        const bSnap = await tx.get(bookRef);
        if (!bSnap.exists) throw new Error('蔵書が見つかりません');
        const data = bSnap.data() || {};
        const available = Number(data.available_count ?? data.stock_available ?? 0);
        tx.update(bookRef, { available_count: available + 1, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
        tx.update(loanDoc, { status: 'returned', returned_at: firebase.firestore.FieldValue.serverTimestamp() });
      });
      showActionResult('📥 返却完了', `
        <p><strong>ID:</strong> ${escapeHtml(bookId)}</p>
        <p><strong>書名:</strong> ${escapeHtml(b?.title || '不明')}</p>
      `, 'success');
      return;
    }

    // 貸出
    try {
      await db().runTransaction(async (tx)=>{
        const bSnap = await tx.get(bookRef);
        if (!bSnap.exists) throw new Error('蔵書が見つかりません');
        const data = bSnap.data() || {};
        const available = Number(data.available_count ?? data.stock_available ?? 0);
        if (available <= 0) throw new Error('在庫がありません');

        tx.update(bookRef, { available_count: available - 1, updated_at: firebase.firestore.FieldValue.serverTimestamp() });
        const loanRef = db().collection('loans').doc();
        tx.set(loanRef, {
          uid: user.uid,
          book_id: bookId,
          isbn13: isbn13 || data.isbn13 || null,
          book_title: data.title || meta?.title || '',
          checked_out_at: firebase.firestore.FieldValue.serverTimestamp(),
          due_at: null,
          returned_at: null,
          status: 'active',
          created_at: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      showActionResult('📤 貸出完了', `
        <p><strong>ID:</strong> ${escapeHtml(bookObj.id)}</p>
        <p><strong>書名:</strong> ${escapeHtml(bookObj.data?.title || '不明')}</p>
      `, 'success');
    } catch (e) {
      showActionResult('貸出失敗', `<p>${escapeHtml(e.message || '処理に失敗しました')}</p>`, 'error');
    }
  }

  // HTMLエスケープ（< の置換バグ修正）
  function escapeHtml(str){
    return String(str ?? '')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');
  }

  // スキャン結果の処理: ISBN優先→ダメなら内部コードで照合
  async function handleDecoded(text){
    const isbn13 = extractIsbn13(text);
    const meta = isbn13 ? await fetchIsbnMeta(isbn13).catch(()=>null) : null;

    let bookObj = null;
    if (isbn13) {
      const byIsbn = await getBookByIsbn(isbn13);
      if (byIsbn) bookObj = { ...byIsbn, isbn13 };
    }
    if (!bookObj) {
      bookObj = await getBookByAny(text);
    }

    if (!bookObj){ setText('ocrProgress', 'この識別子の蔵書は登録されていません。'); return; }

    const disp = isbn13 || String(text).replace(/^\s*ISBN(?:-1[03])?:?/i,'').replace(/[-\s]/g,'');
    if (disp === lastIsbn) return; // 重複抑制
    lastIsbn = disp;

    showSection('scanResultSection', true);
    setText('rawOcrText', disp);
    $('identifierSelection').innerHTML = '<div class="identifier-candidate selected">識別子を認識しました</div>';
    setText('ocrProgress', '処理中...');

    await autoCheckoutOrReturnByBook(bookObj, meta);
    setText('ocrProgress', '');
  }

  function ensureReaderContainer(){
    const container = document.querySelector('.scanner-container');
    if (!container) return null;
    let reader = document.getElementById('barcodeReader');
    if (!reader){
      reader = document.createElement('div');
      reader.id = 'barcodeReader';
      reader.style.maxWidth = '480px';
      reader.style.margin = '0 auto';
      reader.style.borderRadius = '8px';
      reader.style.overflow = 'hidden';
      container.insertBefore(reader, container.firstChild);
    }
    return reader;
  }

  // カメラ選択UIの生成/更新（既存デザイン内のcamera-controlsに追加）
  function ensureCameraControlsUI(){
    const controls = document.querySelector('.camera-controls');
    if (!controls) return null;

    let select = document.getElementById('cameraSelect');
    if (!select){
      select = document.createElement('select');
      select.id = 'cameraSelect';
      select.style.marginLeft = '8px';
      select.ariaLabel = 'カメラ選択';
      controls.appendChild(select);
      select.addEventListener('change', async ()=>{
        const id = select.value;
        if (!id || id === currentDeviceId) return;
        await switchCameraTo(id);
      });
    }

    let btn = document.getElementById('switchCameraBtn');
    if (!btn){
      btn = document.createElement('button');
      btn.id = 'switchCameraBtn';
      btn.textContent = 'カメラ切替';
      btn.style.marginLeft = '8px';
      controls.appendChild(btn);
      btn.addEventListener('click', async ()=>{
        const sel = document.getElementById('cameraSelect');
        if (!sel || sel.options.length < 2) return;
        const idx = sel.selectedIndex;
        const nextIdx = (idx + 1) % sel.options.length;
        const nextId = sel.options[nextIdx].value;
        sel.selectedIndex = nextIdx;
        await switchCameraTo(nextId);
      });
    }
    return select;
  }

  async function getVideoInputs(){
    // 権限がないとlabelが空のため、必要なら一度権限要求
    let devices = await navigator.mediaDevices.enumerateDevices();
    if (!devices.some(d => d.kind === 'videoinput' && d.label)){
      try {
        const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
        tmp.getTracks().forEach(t=>t.stop());
      } catch(_) {}
      devices = await navigator.mediaDevices.enumerateDevices();
    }
    return devices.filter(d => d.kind === 'videoinput');
  }

  function pickBackCameraId(videoInputs){
    const back = videoInputs.find(d => /back|rear|environment/i.test(d.label)) || videoInputs[0];
    return back ? back.deviceId : null;
  }

  function populateCameraSelect(options){
    const select = ensureCameraControlsUI();
    if (!select) return;
    // 既存をクリア
    while (select.firstChild) select.removeChild(select.firstChild);
    options.forEach(({ id, label }) => {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = label || id;
      select.appendChild(opt);
    });
    // 現在選択を反映
    if (currentDeviceId){
      const idx = options.findIndex(o => o.id === currentDeviceId);
      if (idx >= 0) select.selectedIndex = idx;
    }
  }

  // 外部ライブラリ読込ユーティリティ
  async function loadExternalScript(url){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Script load failed: ' + url));
      document.head.appendChild(s);
    });
  }

  async function ensureHtml5QrcodeLoaded(){
    if (window.Html5Qrcode && window.Html5QrcodeSupportedFormats) return;
    // まずローカル同梱版を試す
    try {
      await loadExternalScript('vendor/html5-qrcode.min.js');
    } catch (_) {}
    if (window.Html5Qrcode && window.Html5QrcodeSupportedFormats) return;
    // 次にCDN（unpkg → jsDelivr）の順で試す
    try {
      await loadExternalScript('https://unpkg.com/html5-qrcode@2.3.10/html5-qrcode.min.js');
    } catch (_) {
      try {
        await loadExternalScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.10/minified/html5-qrcode.min.js');
      } catch (_) {}
    }
    if (!(window.Html5Qrcode && window.Html5QrcodeSupportedFormats)){
      throw new Error('Html5Qrcodeライブラリを読み込めませんでした');
    }
  }

  async function startNativeScanner(deviceId){
    const video = document.getElementById('cameraPreview');
    const canvas = document.getElementById('captureCanvas');
    const detector = new BarcodeDetector({ formats: ['ean_13','ean_8','code_128','code_39'] });

    let constraints;
    if (deviceId) {
      constraints = { video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } };
    } else {
      try {
        const inputs = await getVideoInputs();
        const backId = pickBackCameraId(inputs);
        constraints = backId
          ? { video: { deviceId: { exact: backId }, width: { ideal: 1280 }, height: { ideal: 720 } } }
          : { video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
        deviceId = backId || null;
      } catch(_) {
        constraints = { video: { facingMode: { exact: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } };
      }
    }

    // 起動
    nativeStream = await navigator.mediaDevices.getUserMedia(constraints);
    currentScannerType = 'native';
    currentDeviceId = deviceId || null;

    video.srcObject = nativeStream;
    video.style.display = 'block';
    await video.play();

    // ボタン表示切替
    const startBtn = $('startCameraBtn');
    const captureBtn = $('captureBtn');
    const stopBtn = $('stopCameraBtn');
    if (startBtn) startBtn.style.display = 'none';
    if (captureBtn) captureBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'inline-block';

    running = true;
    setText('ocrProgress', '外カメラ起動済み。バーコードを枠内に合わせてください。');

    // 検出ループ
    const loop = async () => {
      if (!running) return;
      try {
        const results = await detector.detect(video);
        if (results && results.length){
          const code = results[0].rawValue || '';
          if (code) {
            setText('ocrResult', `読み取り: ${code}`);
            await handleDecoded(code);
          }
        }
      } catch (e) { /* noop */ }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  async function stopNativeScanner(){
    try {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      const video = document.getElementById('cameraPreview');
      if (video) {
        video.pause();
        video.srcObject = null;
        video.style.display = 'none';
      }
      if (nativeStream) {
        nativeStream.getTracks().forEach(t=>t.stop());
        nativeStream = null;
      }
    } catch(_) {}
  }

  async function startHtml5Scanner(deviceId){
    await ensureHtml5QrcodeLoaded();
    const reader = ensureReaderContainer();
    if (!reader){ showActionResult('エラー', '<p>スキャナーの初期化に失敗しました。</p>', 'error'); return; }

    if (!html5QrCode) html5QrCode = new Html5Qrcode('barcodeReader', { verbose: false });
    const config = {
      fps: 8,
      qrbox: 240,
      rememberLastUsedCamera: true,
      formatsToSupport: [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39
      ],
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    };

    await html5QrCode.start({ deviceId: { exact: deviceId } }, config, async (decodedText)=>{
      setText('ocrResult', `読み取り: ${decodedText}`);
      await handleDecoded(decodedText);
    }, ()=>{});

    currentScannerType = 'html5';
    currentDeviceId = deviceId;

    // ボタン表示切替
    const startBtn = $('startCameraBtn');
    const captureBtn = $('captureBtn');
    const stopBtn = $('stopCameraBtn');
    if (startBtn) startBtn.style.display = 'none';
    if (captureBtn) captureBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'inline-block';

    running = true;
    setText('ocrProgress', '外カメラ起動済み。バーコードを枠内に合わせてください。');
  }

  async function switchCameraTo(deviceId){
    if (!deviceId) return;
    setText('ocrProgress', 'カメラ切替中...');
    try {
      if (currentScannerType === 'native'){
        await stopNativeScanner();
        await startNativeScanner(deviceId);
      } else if (currentScannerType === 'html5'){
        if (html5QrCode) {
          try { await html5QrCode.stop(); } catch(_) {}
          try { await html5QrCode.clear(); } catch(_) {}
        }
        await startHtml5Scanner(deviceId);
      }
      setText('ocrProgress', 'カメラを切り替えました。');
    } catch (e) {
      console.error(e);
      setText('ocrProgress', 'カメラ切替に失敗しました。権限と接続を確認してください。');
    }
  }

  // Public controls
  async function startCamera(){
    if (running) return;

    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!isSecure){ setText('ocrProgress', 'カメラはHTTPSまたはlocalhostでのみ使用できます。'); return; }

    setText('ocrProgress', 'カメラを起動しています...');

    try {
      // UI準備
      ensureReaderContainer();
      ensureCameraControlsUI();

      // まずネイティブAPI対応か判定
      if ('BarcodeDetector' in window) {
        // デバイス列挙
        const inputs = await getVideoInputs();
        const mapped = inputs.map(d => ({ id: d.deviceId, label: d.label || d.deviceId }));
        const backId = pickBackCameraId(inputs);
        populateCameraSelect(mapped);
        await startNativeScanner(backId);
        return;
      }

      // ライブラリ経由（html5-qrcode）
      await ensureHtml5QrcodeLoaded();
      let cameras = await Html5Qrcode.getCameras();
      if (!cameras || cameras.length === 0){
        try {
          const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
          tmp.getTracks().forEach(t=>t.stop());
          cameras = await Html5Qrcode.getCameras();
        } catch (permErr) {
          setText('ocrProgress', 'カメラ権限が拒否されました。ブラウザとOSの設定を確認してください。');
          return;
        }
      }
      if (!cameras || cameras.length === 0){ setText('ocrProgress', 'カメラが見つかりません。'); return; }

      const mapped = cameras.map(c => ({ id: c.id, label: c.label || c.id }));
      const back = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[0];
      populateCameraSelect(mapped);
      await startHtml5Scanner(back.id);
    } catch (e) {
      console.error(e);
      const msg = String(e?.message || e);
      if (/NotAllowedError|Permission/i.test(msg)) {
        setText('ocrProgress', 'カメラへのアクセスが許可されていません。サイトのカメラ権限を許可してください。');
      } else if (/NotFoundError|Overconstrained|no camera/i.test(msg)) {
        setText('ocrProgress', '外カメラが見つかりません。外部カメラ接続やブラウザ設定を確認してください。');
      } else {
        setText('ocrProgress', `外カメラ起動に失敗しました: ${msg}`);
      }
    }
  }

  async function stopCamera(){
    try {
      if (html5QrCode && running){
        try { await html5QrCode.stop(); } catch(_) {}
        try { await html5QrCode.clear(); } catch(_) {}
      }
    } catch(_) {}
    await stopNativeScanner();

    const reader = document.getElementById('barcodeReader');
    if (reader && reader.parentNode) reader.parentNode.removeChild(reader);

    running = false;
    lastIsbn = '';
    currentDeviceId = null;
    currentScannerType = null;

    const startBtn = document.getElementById('startCameraBtn');
    const captureBtn = document.getElementById('captureBtn');
    const stopBtn = document.getElementById('stopCameraBtn');
    if (startBtn) startBtn.style.display = 'inline-block';
    if (captureBtn) captureBtn.style.display = 'none';
    if (stopBtn) stopBtn.style.display = 'none';

    setText('ocrProgress', 'カメラを停止しました。');
  }

  // expose
  window.startCamera = startCamera;
  window.captureAndScan = function(){ setText('ocrProgress', 'スキャン中です...'); };
  window.stopCamera = stopCamera;
})();