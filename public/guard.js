(function(){
  'use strict';
  const auth = () => firebase.auth();

  function isAuthPage(){
    const p = location.pathname;
    return p.endsWith('/login.html') || p.endsWith('login.html') || p.endsWith('/signup.html') || p.endsWith('signup.html');
  }

  function signOut(){
    auth().signOut().catch(()=>{}).finally(()=>{
      location.replace('login.html');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    auth().onAuthStateChanged((user) => {
      if (!user && !isAuthPage()) {
        location.replace('login.html');
        return;
      }
      if (user && isAuthPage()) {
        // 認証画面にいるがログイン済みの場合はトップへ
        location.replace('index.html');
      }
    });
  });

  window.signOut = signOut;
})();
