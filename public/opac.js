// OPAC 検索ロジック（バニラJS + Firestore compat）
(function () {
  'use strict';

  // ユーティリティ: XSS対策
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 参照は DOM 解析後に取得（defer スクリプトだが安全側で）
  document.addEventListener('DOMContentLoaded', () => {
    const resultsContainer = document.getElementById('resultsContainer');
    const searchInput = document.getElementById('searchInput');

    function getTerm() {
      return (searchInput.value || '').trim().toLowerCase();
    }

    function renderMessage(message) {
      resultsContainer.innerHTML = `<p>${escapeHtml(message)}</p>`;
    }

    function renderResults(items) {
      if (!Array.isArray(items) || items.length === 0) {
        renderMessage('該当する蔵書は見つかりませんでした。');
        return;
      }

      const html = items.map((book) => {
        const available = Number(book.available_copies ?? 0);
        const total = Number(book.total_copies ?? 0);
        const stockClass = available > 0 ? 'stock--ok' : 'stock--out';
        return `
          <div class="result-card">
            <h3>${escapeHtml(book.title || '無題')}</h3>
            <p class="result-meta"><strong>著者:</strong> ${escapeHtml(book.author || '不明')}</p>
            <p class="result-meta"><strong>蔵書ID:</strong> ${escapeHtml(book.book_id || '-')}</p>
            <p class="result-meta"><strong>棚の位置:</strong> ${escapeHtml(book.location || '-')}</p>
            <p class="stock ${stockClass}"><strong>在庫:</strong> <strong>${available} / ${total}</strong></p>
          </div>
        `;
      }).join('');

      resultsContainer.innerHTML = html;
    }

    async function searchBooksImpl() {
      const term = getTerm();
      if (!term) {
        renderMessage('検索キーワードを入力してください。');
        return;
      }

      resultsContainer.innerHTML = '検索中...';

      try {
        // Firestore から全件取得し、クライアント側でフィルタ
        const snapshot = await firebase.firestore().collection('books').get();
        const results = [];

        snapshot.forEach((doc) => {
          const book = doc.data() || {};
          const titleLc = (book.title || '').toLowerCase();
          const authorLc = (book.author || '').toLowerCase();
          if (titleLc.includes(term) || authorLc.includes(term)) {
            results.push(book);
          }
        });

        renderResults(results);
      } catch (err) {
        console.error('データ取得エラー: ', err);
        renderMessage('データの取得中にエラーが発生しました。');
      }
    }

    // Enterキーで検索実行
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        searchBooksImpl();
      }
    });

    // グローバル公開（HTML の onclick 用）
    window.searchBooks = searchBooksImpl;
  });
})();
