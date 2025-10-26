(function(){
  'use strict';
  const auth = () => firebase.auth();
  const db = () => firebase.firestore();

  function $(id){ return document.getElementById(id); }
  function setMsg(msg, isError=false){
    const el = $("loginMsg");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#c62828' : '#2e7d32';
  }

  async function resolveEmailByUserId(userId){
    const snap = await db().collection('users').where('user_id', '==', userId).limit(1).get();
    if (snap.empty) throw new Error('ユーザーが見つかりません。');
    const u = snap.docs[0].data() || {};
    if (!u.email) throw new Error('このユーザーにはメールが登録されていません。');
    return u.email;
  }

  async function login(){
    const userId = ($("loginUserId")?.value || '').trim();
    const password = ($("loginPassword")?.value || '').trim();
    if (!userId || !password){ setMsg('ユーザーIDとパスワードを入力してください。', true); return; }
    setMsg('ログイン中...');

    try {
      await auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      const email = await resolveEmailByUserId(userId);
      await auth().signInWithEmailAndPassword(email, password);
      setMsg('ログインしました。移動します...');
      setTimeout(()=> location.href = 'index.html', 300);
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'ログインに失敗しました。', true);
    }
  }

  async function sendReset(){
    const userId = ($("loginUserId")?.value || '').trim();
    if (!userId){ setMsg('ユーザーIDを入力してください。', true); return; }
    setMsg('送信中...');
    try {
      const email = await resolveEmailByUserId(userId);
      await auth().sendPasswordResetEmail(email);
      setMsg('パスワード再設定用のメールを送信しました。');
    } catch (e) {
      console.error(e);
      setMsg(e.message || '送信に失敗しました。', true);
    }
  }

  function setupToggle(){
    // 簡易トグル: ボタンID固定
    const btn = document.getElementById('resetBtn');
    const pwd = document.getElementById('loginPassword');
    // パスワード表示トグルをラベルクリックで代替: ダブルクリックで切替
    if (pwd) {
      pwd.addEventListener('dblclick', () => {
        pwd.type = pwd.type === 'password' ? 'text' : 'password';
      });
    }
    if (btn) btn.addEventListener('click', sendReset);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $("loginBtn");
    if (btn) btn.addEventListener('click', login);
    setupToggle();
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') login(); });
  });
})();
