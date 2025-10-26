(function(){
  'use strict';
  const auth = () => firebase.auth();
  const db = () => firebase.firestore();

  function $(id){ return document.getElementById(id); }
  function setMsg(msg, isError=false){
    const el = $("signupMsg");
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? '#c62828' : '#2e7d32';
  }

  function getForm(){
    return {
      lastName: ($("lastName")?.value || '').trim(),
      firstName: ($("firstName")?.value || '').trim(),
      userId: ($("userId")?.value || '').trim(),
      email: ($("email")?.value || '').trim(),
      password: ($("password")?.value || '').trim(),
      passwordConfirm: ($("passwordConfirm")?.value || '').trim(),
      birthday: ($("birthday")?.value || '').trim(),
      grade: ($("grade")?.value || '').trim(),
      klass: ($("klass")?.value || '').trim(),
    };
  }

  function validate(f){
    if (!f.lastName || !f.firstName) return '姓と名を入力してください。';
    if (!f.userId) return 'ユーザーIDを入力してください。';
    if (!f.email) return 'メールアドレスを入力してください。';
    if (!f.password || f.password.length < 6) return 'パスワードは6文字以上で入力してください。';
    if (f.password !== f.passwordConfirm) return 'パスワードが一致しません。';
    if (!f.birthday) return '生年月日を選択してください。';
    if (!f.grade) return '学年を選択してください。';
    if (!f.klass) return 'クラスを入力してください。';
    return '';
  }

  async function ensureUniqueUserId(userId){
    const snap = await db().collection('users').where('user_id', '==', userId).limit(1).get();
    if (!snap.empty) throw new Error('このユーザーIDはすでに使用されています。');
  }

  async function signup(){
    const f = getForm();
    const err = validate(f);
    if (err){ setMsg(err, true); return; }
    setMsg('作成中...');

    try {
      await auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL);

      // user_id 重複確認
      await ensureUniqueUserId(f.userId);

      // アカウント作成
      const cred = await auth().createUserWithEmailAndPassword(f.email, f.password);
      const uid = cred.user.uid;
      const displayName = `${f.lastName} ${f.firstName}`.trim();
      await cred.user.updateProfile({ displayName });

      // プロフィール作成（role=student）
      const birthdayDate = f.birthday ? new Date(f.birthday) : null;
      await db().collection('users').doc(uid).set({
        user_id: f.userId,
        uid,
        email: f.email,
        name: displayName,
        first_name: f.firstName,
        last_name: f.lastName,
        name_lc: displayName.toLowerCase(),
        role: 'student',
        grade: f.grade,
        class: f.klass,
        birthday: birthdayDate ? firebase.firestore.Timestamp.fromDate(birthdayDate) : null,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        is_admin: false,
      }, { merge: true });

      setMsg('アカウントを作成しました。リダイレクトします...');
      setTimeout(()=> location.href = 'index.html', 600);
    } catch (e) {
      console.error(e);
      setMsg(e.message || '作成に失敗しました。', true);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const btn = $("signupBtn");
    if (btn) btn.addEventListener('click', signup);
    document.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') signup(); });
  });
})();
