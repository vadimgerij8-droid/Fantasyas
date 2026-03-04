import { db } from './config.js';
import {
  collection,
  getDocs,
  query,
  where,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getCurrentUser,
  setCurrentFilterHashtag
} from './state.js';
import { showToast } from './utils.js';
import { resetPagination } from './posts.js';

// ================= Пошук користувачів або хештегів =================
export async function loadSearchUsers() {
  const searchInput = document.getElementById('searchInput');
  const resultsContainer = document.getElementById('searchResults');
  if (!searchInput || !resultsContainer) return;

  const searchTerm = searchInput.value.trim();
  if (!searchTerm) {
    resultsContainer.innerHTML = '';
    return;
  }

  resultsContainer.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    if (searchTerm.startsWith('#')) {
      // Пошук за хештегом
      const tag = searchTerm.substring(1);
      const q = query(collection(db, "posts"), where("hashtags", "array-contains", tag), limit(20));
      const snapshot = await getDocs(q);
      resultsContainer.innerHTML = '';
      if (snapshot.empty) {
        resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Немає постів з цим хештегом</p>';
        return;
      }
      snapshot.forEach(doc => {
        const post = doc.data();
        post.id = doc.id;
        renderSearchPost(post, resultsContainer);
      });
    } else {
      // Пошук користувачів
      const lowerTerm = searchTerm.toLowerCase();
      const q = query(
        collection(db, "users"),
        where("nickname_lower", ">=", lowerTerm),
        where("nickname_lower", "<=", lowerTerm + '\uf8ff'),
        limit(20)
      );
      const snapshot = await getDocs(q);
      resultsContainer.innerHTML = '';
      if (snapshot.empty) {
        resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Користувачів не знайдено</p>';
        return;
      }
      snapshot.forEach(doc => {
        const user = doc.data();
        user.uid = doc.id;
        renderSearchUser(user, resultsContainer);
      });
    }
  } catch (error) {
    console.error('Search error:', error);
    resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Помилка пошуку</p>';
  }
}

// ================= Рендер знайденого користувача =================
function renderSearchUser(user, container) {
  const div = document.createElement('div');
  div.className = 'search-user-item';
  div.innerHTML = `
    <img src="${user.avatar || 'default-avatar.png'}" class="search-avatar" loading="lazy">
    <div class="search-user-info">
      <span class="search-user-nickname">${user.nickname}</span>
      <span class="search-user-userid">${user.userId}</span>
    </div>
  `;
  div.addEventListener('click', () => {
    import('./profile.js').then(module => module.viewProfile(user.uid));
  });
  container.appendChild(div);
}

// ================= Рендер знайденого поста =================
function renderSearchPost(post, container) {
  const div = document.createElement('div');
  div.className = 'search-post-item';
  div.innerHTML = `
    <div class="post-header">
      <img src="${post.avatar || 'default-avatar.png'}" class="post-avatar" loading="lazy">
      <span class="post-nickname">${post.nickname}</span>
    </div>
    <p>${post.text}</p>
  `;
  // Можна додати перехід до поста
  container.appendChild(div);
}

// ================= Завантаження популярних хештегів (для розділу хештегів) =================
export async function loadHashtags() {
  const list = document.getElementById('hashtagList');
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    const postsSnap = await getDocs(collection(db, "posts"));
    const tagCount = new Map();
    postsSnap.forEach(doc => {
      const tags = doc.data().hashtags || [];
      tags.forEach(tag => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });

    const sortedTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);

    list.innerHTML = '';
    if (sortedTags.length === 0) {
      list.innerHTML = '<p style="text-align:center; padding:20px;">Поки немає хештегів</p>';
      return;
    }

    sortedTags.forEach(([tag, count]) => {
      const div = document.createElement('div');
      div.className = 'hashtag-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <span class="hashtag-name">${tag}</span>
        <span class="hashtag-count">${count} постів</span>
      `;
      div.addEventListener('click', () => searchHashtag(tag));
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error loading hashtags:', e);
    list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}

function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    document.querySelector('[data-section="search"]').click();
    loadSearchUsers();
  }
}

// ================= Завантаження хештегів для фільтра =================
export async function loadFilterHashtags() {
  const list = document.getElementById('filterList');
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    const postsSnap = await getDocs(collection(db, "posts"));
    const tagCount = new Map();
    postsSnap.forEach(doc => {
      const tags = doc.data().hashtags || [];
      tags.forEach(tag => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });

    const sortedTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);

    list.innerHTML = '';
    if (sortedTags.length === 0) {
      list.innerHTML = '<p style="text-align:center; padding:20px;">Немає хештегів</p>';
      return;
    }

    sortedTags.forEach(([tag, count]) => {
      const div = document.createElement('div');
      div.className = 'filter-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <span class="tag">#${tag}</span>
        <span class="count">${count} постів</span>
      `;
      div.addEventListener('click', () => applyFilter(tag));
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error loading filter hashtags:', e);
    list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}

// ================= Застосувати фільтр =================
function applyFilter(tag) {
  setCurrentFilterHashtag(tag);
  document.getElementById('filterModal').classList.remove('active');

  const activeDiv = document.getElementById('activeFilter');
  activeDiv.innerHTML = `#${tag} <button id="clearFilterChip">✕</button>`;
  document.getElementById('clearFilterChip').onclick = clearFilter;

  resetPagination();
}

// ================= Очистити фільтр =================
function clearFilter() {
  setCurrentFilterHashtag(null);
  document.getElementById('activeFilter').innerHTML = '';
  resetPagination();
}
