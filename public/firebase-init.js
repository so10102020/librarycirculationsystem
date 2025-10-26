(function(){
  'use strict';

  function loadScript(src){
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.defer = true; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureFirebaseSdk(){
    if (typeof window.firebase !== 'undefined') return;
    // Hosting外でのフォールバック（gstatic CDN・compat版）
    const base = 'https://www.gstatic.com/firebasejs/12.4.0';
    await loadScript(base + '/firebase-app-compat.js');
    await loadScript(base + '/firebase-auth-compat.js');
    await loadScript(base + '/firebase-firestore-compat.js');
  }

  function connectEmulatorsIfLocal(){
    try {
      if (location.hostname === 'localhost') {
        if (!window.__EMULATORS_BOUND__) {
          if (firebase.firestore) {
            try { firebase.firestore().useEmulator('localhost', 8080); } catch(_) {}
          }
          if (firebase.auth) {
            try { firebase.auth().useEmulator('http://localhost:9099'); } catch(_) {}
          }
          window.__EMULATORS_BOUND__ = true;
        }
      }
    } catch(e) { console.warn('Emulator binding skipped:', e); }
  }

  async function initIfNeeded(){
    try {
      await ensureFirebaseSdk();
      if (firebase && firebase.apps && firebase.apps.length > 0) {
        connectEmulatorsIfLocal();
        return;
      }
      if (window.FIREBASE_WEB_CONFIG) {
        firebase.initializeApp(window.FIREBASE_WEB_CONFIG);
        connectEmulatorsIfLocal();
        return;
      }
      // Firebase Hosting の init.js による初期化を少し待つ（最大1s）
      const start = Date.now();
      while (Date.now() - start < 1000) {
        if (firebase.apps && firebase.apps.length > 0) { connectEmulatorsIfLocal(); return; }
        await new Promise(r => setTimeout(r, 50));
      }
      console.error('Firebase: configuration not found. Provide window.FIREBASE_WEB_CONFIG or run on Firebase Hosting (init.js).');
    } catch(e) {
      console.error('Firebase init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initIfNeeded);
  } else {
    initIfNeeded();
  }
})();
