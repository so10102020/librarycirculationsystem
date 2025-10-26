(function() {
  'use strict';

  let currentStream = null;
  let lastScannedText = '';
  let lastExtractedId = '';
  let lastCapturedImage = null;
  let isFirebaseReady = false;

  // Firebase初期化を待つ
  function waitForFirebase() {
    return new Promise((resolve) => {
      if (typeof firebase !== 'undefined' && firebase.firestore) {
        isFirebaseReady = true;
        resolve();
      } else {
        setTimeout(() => waitForFirebase().then(resolve), 100);
      }
    });
  }

  const db = () => {
    if (!isFirebaseReady) {
      console.warn('Firebase not initialized yet');
      return null;
    }
    return firebase.firestore();
  };

  function getEl(id) { 
    return document.getElementById(id); 
  }

  function updateStatus(elementId, message, type = 'normal') {
    const el = getEl(elementId);
    if (el) {
      el.textContent = message;
      el.className = `result-box ${type}`;
    }
  }

  function updateProgress(message) {
    const el = document.getElementById('ocrProgress');
    if (el) {
      el.textContent = message;
      el.style.display = message ? 'block' : 'none';
    }
  }

  function setMessage(id, msg, isError = false) {
    const el = getEl(id);
    if (el) {
      el.textContent = msg;
      el.style.color = isError ? '#c62828' : '#2e7d32';
    }
  }

  // カメラ開始
  async function startCamera() {
    try {
      console.log('startCamera関数が呼び出されました');
      updateStatus('cameraStatus', 'カメラを開始しています...', 'progress');
      
      // カメラ権限確認
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('このブラウザはカメラアクセスをサポートしていません');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { //解像度設定
          width: { ideal: 640 }, //カメラ横幅
          height: { ideal: 480 }, //カメラ縦幅
          facingMode: 'environment'
        }
      });

      console.log('カメラストリーム取得成功');

      const video = getEl('cameraPreview');
      if (!video) {
        throw new Error('video要素が見つかりません');
      }

      video.srcObject = stream;
      video.style.display = 'block';
      currentStream = stream;

      const startBtn = getEl('startBtn');
      const captureBtn = getEl('captureBtn');
      const stopBtn = getEl('stopBtn');

      if (startBtn) startBtn.style.display = 'none';
      if (captureBtn) captureBtn.style.display = 'inline-block';
      if (stopBtn) stopBtn.style.display = 'inline-block';

      await video.play();
      console.log('カメラ起動完了');
      updateStatus('cameraStatus', 'カメラが起動しました。識別子にフォーカスして「スキャン実行」をクリックしてください。', 'success');
    } catch (error) {
      console.error('カメラエラー:', error);
      updateStatus('cameraStatus', `カメラエラー: ${error.message}`, 'error');
    }
  }

  // カメラ停止
  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }

    const video = document.getElementById('cameraPreview');
    video.style.display = 'none';
    video.srcObject = null;

    document.getElementById('startBtn').style.display = 'inline-block';
    document.getElementById('captureBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'none';

    updateStatus('cameraStatus', 'カメラを停止しました。');
  }

  // 画像キャプチャとOCR実行
  async function captureAndScan() {
    try {
      setMessage('ocrProgress', 'スキャンを開始しています...', false);
      setMessage('ocrResult', '', false);

      const video = getEl('cameraPreview');
      const canvas = getEl('captureCanvas');
      const ctx = canvas.getContext('2d');

      // キャンバスサイズを動画に合わせる
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // 現在のフレームをキャプチャ
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // OCRを実行
      setMessage('ocrProgress', 'テキストを認識中...', false);
      
      const result = await Tesseract.recognize(
        canvas,
        'eng+jpn',
        {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              const progress = Math.round(m.progress * 100);
              setMessage('ocrProgress', `認識中... ${progress}%`, false);
            }
          }
        }
      );

      const recognizedText = result.data.text.trim();
      setMessage('ocrProgress', 'スキャン完了', false);
      lastScannedText = recognizedText;

      if (recognizedText) {
        // 複数の識別子候補を抽出
        const candidates = extractAllLibraryIds(recognizedText);
        
        if (candidates.length > 0) {
          setMessage('ocrResult', `${candidates.length}個の識別子候補を検出しました。`, false);
          
          // circulation.jsの関数を呼び出して候補を表示
          if (window.displayIdentifierCandidates) {
            window.displayIdentifierCandidates(recognizedText, candidates);
          }
        } else {
          setMessage('ocrResult', 'テキストを認識しましたが、識別子が見つかりません。', true);
          
          // 識別子が見つからない場合も結果を表示
          if (window.displayIdentifierCandidates) {
            window.displayIdentifierCandidates(recognizedText, []);
          }
        }
      } else {
        setMessage('ocrResult', '文字を認識できませんでした。もう一度試してください。', true);
      }
    } catch (error) {
      console.error('OCRエラー:', error);
      setMessage('ocrResult', 'スキャンに失敗しました: ' + error.message, true);
      setMessage('ocrProgress', '', false);
    }
  }

  // 複数の識別子候補を抽出する関数（改良版）
  function extractAllLibraryIds(text) {
    const patterns = [
      { name: 'LIB形式', regex: /LIB\d{6,12}/g },
      { name: '長い数字', regex: /\d{8,15}/g },
      { name: '文字+数字', regex: /[A-Z]{1,3}\d{6,12}/g },
      { name: 'ハイフン区切り', regex: /\d{3,5}-\d{3,5}-\d{3,5}/g },
      { name: 'ドット区切り', regex: /\d{4,6}\.\d{4,6}/g },
      { name: '複数文字+数字', regex: /[A-Z]{2,4}\d{8,12}/g },
      { name: 'ISBN形式', regex: /\d{13}/g },
      { name: '10桁', regex: /\d{10}/g },
      { name: '9桁', regex: /\d{9}/g },
      { name: '単一文字+数字', regex: /[A-Z]\d{8,12}/g }
    ];

    console.log('テキスト解析:', text);
    
    const allCandidates = [];
    const seen = new Set(); // 重複を避けるため

    for (const pattern of patterns) {
      const matches = text.match(pattern.regex);
      if (matches && matches.length > 0) {
        console.log(`${pattern.name} パターンにマッチ:`, matches);
        
        matches.forEach(match => {
          if (!seen.has(match)) {
            seen.add(match);
            allCandidates.push({
              value: match,
              type: pattern.name,
              length: match.length
            });
          }
        });
      }
    }

    // フォールバック: 6桁以上の英数字
    if (allCandidates.length === 0) {
      const fallbackPattern = /[A-Z0-9]{6,}/g;
      const fallbackMatches = text.match(fallbackPattern);
      if (fallbackMatches && fallbackMatches.length > 0) {
        console.log('フォールバックパターンにマッチ:', fallbackMatches);
        fallbackMatches.forEach(match => {
          if (!seen.has(match)) {
            allCandidates.push({
              value: match,
              type: 'フォールバック',
              length: match.length
            });
          }
        });
      }
    }

    // 長さで降順ソート（より詳細な識別子を優先）
    allCandidates.sort((a, b) => b.length - a.length);

    // 値のみを返す
    return allCandidates.map(candidate => candidate.value);
  }

  async function validateBookId(bookId) {
    try {
      await waitForFirebase();
      updateStatus('dbResult', 'データベースを照合中...', 'progress');
      
      const firestore = db();
      if (!firestore) {
        throw new Error('Firebaseが初期化されていません');
      }

      const snap = await firestore.collection('books').where('book_id', '==', bookId).limit(1).get();
      
      if (!snap.empty) {
        const bookData = snap.docs[0].data();
        updateStatus('dbResult', 
          `✅ 蔵書が見つかりました!\n書名: ${bookData.title || '不明'}\n著者: ${bookData.author || '不明'}\nID: ${bookId}`, 
          'success'
        );
      } else {
        updateStatus('dbResult', `❌ 識別子 ${bookId} は登録されていません。`, 'error');
      }
    } catch (error) {
      console.error('DB照合エラー:', error);
      updateStatus('dbResult', `データベースエラー: ${error.message}`, 'error');
    }
  }

  // 手動テスト
  function testExtraction() {
    const testText = prompt('テスト用のテキストを入力してください:', 'LIB123456789 Sample Book Title');
    if (testText) {
      const rawTextEl = getEl('rawText');
      if (rawTextEl) {
        rawTextEl.textContent = testText;
      }
      const extractedId = extractAllLibraryIds(testText);
      if (extractedId) {
        const extractedIdEl = getEl('extractedId');
        if (extractedIdEl) {
          extractedIdEl.textContent = extractedId;
        }
        lastExtractedId = extractedId;
        validateBookId(extractedId);
      } else {
        const extractedIdEl = getEl('extractedId');
        if (extractedIdEl) {
          extractedIdEl.textContent = '識別子が検出されませんでした';
        }
      }
    }
  }

  // DB接続テスト
  async function testDatabaseConnection() {
    try {
      await waitForFirebase();
      updateStatus('dbResult', 'Firebase接続をテスト中...', 'progress');
      
      const firestore = db();
      if (!firestore) {
        throw new Error('Firebaseが初期化されていません');
      }

      const testSnap = await firestore.collection('books').limit(1).get();
      updateStatus('dbResult', `✅ Firebase接続成功! (books コレクション: ${testSnap.size}件)`, 'success');
    } catch (error) {
      updateStatus('dbResult', `❌ Firebase接続エラー: ${error.message}`, 'error');
    }
  }

  // グローバル関数として公開
  window.startCamera = startCamera;
  window.stopCamera = stopCamera;
  window.captureAndScan = captureAndScan;
  window.testExtraction = testExtraction;
  window.testDatabaseConnection = testDatabaseConnection;
  window.extractAllLibraryIds = extractAllLibraryIds;

  // 初期化
  document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM読み込み完了');
    
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      updateStatus('cameraStatus', '✅ カメラ機能が利用可能です。', 'success');
    } else {
      updateStatus('cameraStatus', '❌ このブラウザではカメラ機能を利用できません。', 'error');
    }

    // Firebase初期化を待つ
    try {
      await waitForFirebase();
      console.log('Firebase初期化完了');
    } catch (error) {
      console.error('Firebase初期化エラー:', error);
    }
  });

})();