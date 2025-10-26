(function(){
  'use strict';
  const db = () => firebase.firestore();
  const auth = () => firebase.auth();

  let unlocked = false;

  function $(id){ return document.getElementById(id); }
  function setMsg(id, msg, isError=false){
    const el = $(id);
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#c62828' : '#2e7d32';
  }

  async function requireAdminAndKey(){
    const key = ($("adminAccessKey")?.value || '').trim();
    if (!key){ setMsg('adminAccessMsg', 'アクセスキーを入力してください。', true); return; }

    const user = auth().currentUser;
    if (!user){ setMsg('adminAccessMsg', 'ログイン状態を確認してください。', true); return; }

    try {
      // ユーザーロール確認
      const userDoc = await db().collection('users').doc(user.uid).get();
      const u = userDoc.data() || {};
      if (!u.is_admin) {
        setMsg('adminAccessMsg', 'このアカウントには管理者権限がありません。', true);
        return;
      }

      // コンフィグからキーを取得
      const confDoc = await db().collection('config').doc('admin').get();
      const conf = confDoc.data() || {};
      if (!conf.access_key) {
        setMsg('adminAccessMsg', '管理アクセスキーが未設定です。config/admin に access_key を設定してください。', true);
        return;
      }

      if (String(conf.access_key) !== key) {
        setMsg('adminAccessMsg', 'アクセスキーが違います。', true);
        return;
      }

      unlocked = true;
      setMsg('adminAccessMsg', '認証に成功しました。');
      const section = $("adminAccessSection");
      const content = $("adminContent");
      if (section) section.style.display = 'none';
      if (content) content.style.display = '';
    } catch (e) {
      console.error(e);
      setMsg('adminAccessMsg', e.message || '検証中にエラーが発生しました。', true);
    }
  }

  async function updateUserRole(){
    if (!unlocked){ setMsg('roleUpdateMsg', 'まず管理者アクセスを解錠してください。', true); return; }
    const targetId = ($("roleTargetUserId")?.value || '').trim();
    const role = ($("roleSelect")?.value || '').trim();
    if (!targetId || !role){ setMsg('roleUpdateMsg', '対象ユーザーIDとロールを入力してください。', true); return; }
    if (!['student','staff'].includes(role)) { setMsg('roleUpdateMsg', 'ロールが不正です。', true); return; }

    try {
      await db().collection('users').doc(targetId).set({ role }, { merge: true });
      setMsg('roleUpdateMsg', 'ロールを更新しました。');
    } catch (e) {
      console.error(e);
      setMsg('roleUpdateMsg', e.message || '更新に失敗しました。', true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $("adminAccessBtn");
    if (btn) btn.addEventListener('click', requireAdminAndKey);
    const keyInput = $("adminAccessKey");
    if (keyInput) keyInput.addEventListener('keydown', (e)=>{ if (e.key==='Enter') requireAdminAndKey(); });
  });

  window.updateUserRole = updateUserRole;
})();
