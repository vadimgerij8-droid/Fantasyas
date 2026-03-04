import { db } from './config.js';
import {
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  writeBatch,
  increment,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  onSnapshot,
  serverTimestamp,
  addDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getCurrentUser,
  getCurrentUserFollowing,
  getCurrentFilterHashtag,
  getLastVisible,
  setLastVisible,
  getLoading,
  setLoading,
  getHasMore,
  setHasMore,
  getCurrentFeedType
} from './state.js';
import { showToast, vibrate, debounce, extractHashtags } from './utils.js';

// ================= Карти для запобігання паралельним викликам =================
const likePromiseMap = new Map();
const savePromiseMap = new Map();

// Слухачі постів (для реального часу)
const postListeners = new Map();

// ================= Функція перемикання лайка =================
export const toggleLike = debounce(async (postId, buttonElement) => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast('Увійдіть, щоб лайкати');
    return;
  }

  if (likePromiseMap.has(postId)) return;

  const wasLiked = buttonElement.classList.contains('liked');
  const countSpan = buttonElement.querySelector('span');
  const oldCount = countSpan ? parseInt(countSpan.textContent) : 0;

  const newCount = wasLiked ? Math.max(oldCount - 1, 0) : oldCount + 1;
  buttonElement.classList.toggle('liked', !wasLiked);
  if (countSpan) countSpan.textContent = newCount;

  try {
    likePromiseMap.set(postId, true);

    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      buttonElement.classList.toggle('liked', wasLiked);
      if (countSpan) countSpan.textContent = oldCount;
      return;
    }

    const postData = postSnap.data();
    const isLiked = postData.likes?.includes(currentUser.uid) || false;

    if (isLiked === wasLiked) {
      const batch = writeBatch(db);
      if (isLiked) {
        batch.update(postRef, {
          likes: arrayRemove(currentUser.uid),
          likesCount: increment(-1),
          popularity: increment(-50)
        });
        batch.update(doc(db, "users", currentUser.uid), {
          likedPosts: arrayRemove(postId)
        });
      } else {
        batch.update(postRef, {
          likes: arrayUnion(currentUser.uid),
          likesCount: increment(1),
          popularity: increment(50)
        });
        batch.update(doc(db, "users", currentUser.uid), {
          likedPosts: arrayUnion(postId)
        });
        vibrate(30);
      }
      await batch.commit();
    } else {
      buttonElement.classList.toggle('liked', isLiked);
      if (countSpan) countSpan.textContent = postData.likesCount || 0;
    }
  } catch (error) {
    console.error('Помилка toggleLike:', error);
    showToast('Не вдалося оновити лайк. Спробуйте ще.');
    buttonElement.classList.toggle('liked', wasLiked);
    if (countSpan) countSpan.textContent = oldCount;
  } finally {
    likePromiseMap.delete(postId);
  }
}, 300);

// ================= Функція збереження поста =================
export const toggleSave = debounce(async (postId, buttonElement) => {
  const currentUser = getCurrentUser();
  if (!currentUser) {
    showToast('Увійдіть, щоб зберегти');
    return;
  }

  if (savePromiseMap.has(postId)) return;

  const wasSaved = buttonElement.classList.contains('saved');
  buttonElement.classList.toggle('saved', !wasSaved);

  try {
    savePromiseMap.set(postId, true);

    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      buttonElement.classList.toggle('saved', wasSaved);
      return;
    }

    const isSaved = postSnap.data().saves?.includes(currentUser.uid) || false;
    if (isSaved === wasSaved) {
      const batch = writeBatch(db);
      const userRef = doc(db, "users", currentUser.uid);
      if (wasSaved) {
        batch.update(userRef, { savedPosts: arrayRemove(postId) });
        batch.update(postRef, { saves: arrayRemove(currentUser.uid) });
      } else {
        batch.update(userRef, { savedPosts: arrayUnion(postId) });
        batch.update(postRef, { saves: arrayUnion(currentUser.uid) });
      }
      await batch.commit();
    } else {
      buttonElement.classList.toggle('saved', isSaved);
    }
  } catch (error) {
    console.error("Помилка збереження:", error);
    showToast("Не вдалося зберегти пост.");
    buttonElement.classList.toggle('saved', wasSaved);
  } finally {
    savePromiseMap.delete(postId);
  }
}, 300);

// ================= Очищення слухачів =================
export const clearMainFeedListeners = () => {
  postListeners.forEach((unsubscribe) => unsubscribe());
  postListeners.clear();
};

// ================= Скидання пагінації =================
export function resetPagination() {
  setLastVisible(null);
  setHasMore(true);
  setLoading(false);
  loadFeed();
}

// ================= Завантаження стрічки =================
export async function loadFeed() {
  const feedEl = document.getElementById('feed');
  if (!feedEl) return;
  if (getLoading()) return;
  if (!getHasMore() && getLastVisible() !== null) return;

  setLoading(true);

  try {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const filterTag = getCurrentFilterHashtag();
    const feedType = getCurrentFeedType();

    let q;
    if (feedType === 'following') {
      const following = getCurrentUserFollowing();
      if (following.length === 0) {
        feedEl.innerHTML = '<p style="text-align:center; padding:20px;">Ви ні на кого не підписані</p>';
        setLoading(false);
        return;
      }
      q = query(collection(db, "posts"), where("userId", "in", following), orderBy("createdAt", "desc"));
    } else {
      q = query(collection(db, "posts"), orderBy("createdAt", "desc"));
    }

    if (filterTag) {
      q = query(q, where("hashtags", "array-contains", filterTag));
    }

    if (getLastVisible()) {
      q = query(q, startAfter(getLastVisible()), limit(10));
    } else {
      q = query(q, limit(10));
    }

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      if (getLastVisible() === null) {
        feedEl.innerHTML = '<p style="text-align:center; padding:20px;">Немає постів</p>';
      }
      setHasMore(false);
      setLoading(false);
      return;
    }

    setLastVisible(snapshot.docs[snapshot.docs.length - 1]);

    if (getLastVisible() === null) {
      feedEl.innerHTML = '';
    }

    snapshot.forEach(doc => {
      const post = doc.data();
      post.id = doc.id;
      renderPost(post, feedEl);
    });

    setLoading(false);
  } catch (error) {
    console.error('Error loading feed:', error);
    showToast('Помилка завантаження стрічки');
    setLoading(false);
  }
}

// ================= Рендер поста (повний HTML з оригіналу) =================
function renderPost(post, container) {
  const currentUser = getCurrentUser();
  const isLiked = post.likes?.includes(currentUser?.uid) || false;
  const isSaved = post.saves?.includes(currentUser?.uid) || false;

  const postDiv = document.createElement('div');
  postDiv.className = 'post';
  postDiv.dataset.postId = post.id;

  // Формуємо HTML-структуру поста (з оригінального коду)
  postDiv.innerHTML = `
    <div class="post-header">
      <img src="${post.avatar || 'default-avatar.png'}" class="post-avatar" loading="lazy">
      <div class="post-user">
        <span class="post-nickname">${post.nickname}</span>
        <span class="post-userid">${post.userId}</span>
      </div>
      <button class="post-menu-btn">⋯</button>
    </div>
    <div class="post-content">
      <p>${post.text || ''}</p>
      ${post.media ? (post.mediaType === 'image' ? `<img src="${post.media}" class="post-media">` : `<video src="${post.media}" controls class="post-media"></video>`) : ''}
    </div>
    <div class="post-stats">
      <span class="likes-count">${post.likesCount || 0}</span> вподобань
      <span class="comments-count">${post.commentsCount || 0}</span> коментарів
    </div>
    <div class="post-actions">
      <button class="post-action like-btn ${isLiked ? 'liked' : ''}" data-post-id="${post.id}">
        ❤️ <span>${post.likesCount || 0}</span>
      </button>
      <button class="post-action comment-btn" data-post-id="${post.id}">
        💬 <span>${post.commentsCount || 0}</span>
      </button>
      <button class="post-action save-btn ${isSaved ? 'saved' : ''}" data-post-id="${post.id}">
        🔖
      </button>
      <button class="post-action share-btn" data-post-id="${post.id}">
        📤
      </button>
    </div>
  `;

  // Додаємо обробники
  const likeBtn = postDiv.querySelector('.like-btn');
  likeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleLike(post.id, likeBtn);
  });

  const saveBtn = postDiv.querySelector('.save-btn');
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSave(post.id, saveBtn);
  });

  // Інші кнопки (коментарі, меню, поділитися) – можна додати аналогічно
  // Але для повноти можна реалізувати пізніше

  container.appendChild(postDiv);
}

// ================= Завантаження постів користувача (для профілю) =================
export async function loadUserPosts(uid, containerId = 'profilePosts') {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '<div class="skeleton" style="height:100px;"></div>';

  try {
    const q = query(collection(db, "posts"), where("userId", "==", uid), orderBy("createdAt", "desc"));
    const snapshot = await getDocs(q);
    container.innerHTML = '';
    if (snapshot.empty) {
      container.innerHTML = '<p style="text-align:center; padding:20px;">Немає постів</p>';
      return;
    }
    snapshot.forEach(doc => {
      const post = doc.data();
      post.id = doc.id;
      renderPost(post, container);
    });
  } catch (error) {
    console.error('Error loading user posts:', error);
    container.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}
