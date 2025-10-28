// Firebase Web App Config
// 必ず自分のプロジェクトの値に置き換えてください。
// Firebase Console > プロジェクト設定 > マイアプリ（Web）
// ここで取得できる config オブジェクトを貼り付けます。

window.FIREBASE_WEB_CONFIG = window.FIREBASE_WEB_CONFIG || {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  appId: "YOUR_APP_ID"
  // measurementId, storageBucket など任意の追加も可
};

(function(){
  const c = window.FIREBASE_WEB_CONFIG || {};
  if (!c.apiKey || String(c.apiKey).includes('YOUR_')) {
    console.warn('[firebase-config] ダミー設定のままです。Firebase Hosting 以外で動かす場合は、firebase-config.js を正しい値に更新してください。');
  }
})();
