// posts.js — Повністю оновлений модуль для роботи з постами
import { db } from './config.js';
import {
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, startAfter, getDocs,
  serverTimestamp, arrayUnion, arrayRemove, increment,
  writeBatch, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  state,
  setFilterHashtag,
  resetPaginationState,
  setCurrentFeedType
} from './state.js';
import { showToast, vibrate, uploadToCloudinary, debounce, setupEmojiPicker } from './utils.js';
import { toggleFollow } from './profile.js';

// ==================== Конфігурація та допоміжні функції ====================
const CONFIG = {
  MAX_FILES: 3,
  LIKE_DEBOUNCE: 300,
  SAVE_DEBOUNCE: 300,
  POPULARITY_LIKE: 50,
  POPULARITY_COMMENT: 40,
  POPULARITY_VIEW: 5,
  EMOJI_BUTTON_TEXT: '😊'
};

// Утиліта для безпечного доступу до DOM
const $ = (selector, context = document) => context.querySelector(selector);
const $$ = (selector, context = document) => Array.from(context.querySelectorAll(selector));

// Хештеги
export function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

// ==================== Сучасне меню поста (Instagram‑стиль) ====================
class PostMenu {
  constructor(container, postId, isAuthor) {
    this.container = container;
    this.postId = postId;
    this.isAuthor = isAuthor;
    this.menuBtn = null;
    this.dropdown = null;
    this.init();
  }

  init() {
    if (!this.isAuthor) return;

    this.container.classList.add('post-menu-container');
    this.container.innerHTML = `
      <button class="post-menu-btn" aria-label="Меню поста">⋮</button>
      <div class="post-menu-dropdown">
        <div class="post-menu-item" data-action="edit">Редагувати</div>
        <div class="post-menu-item" data-action="delete">Видалити</div>
      </div>
    `;

    this.menuBtn = $('.post-menu-btn', this.container);
    this.dropdown = $('.post-menu-dropdown', this.container);

    // Анімація через CSS (клас .show)
    this.menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Закриття при кліку поза меню – глобальний обробник додається один раз
  }

  toggle() {
    const isOpen = this.dropdown.classList.contains('show');
    // Закриваємо всі інші меню
    $$('.post-menu-dropdown.show').forEach(d => d.classList.remove('show'));
    if (!isOpen) {
      this.dropdown.classList.add('show');
    }
  }

  close() {
    this.dropdown.classList.remove('show');
  }

  static setupGlobalClose() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.post-menu-container')) {
        $$('.post-menu-dropdown.show').forEach(d => d.classList.remove('show'));
      }
    });
  }
}

// Викликати один раз при завантаженні модуля
PostMenu.setupGlobalClose();

// ==================== Модальне вікно редагування з emoji та лічильником ====================
class EditModal {
  constructor(currentText, onSave) {
    this.currentText = currentText;
    this.onSave = onSave;
    this.modal = null;
    this.textarea = null;
    this.counter = null;
    this.init();
  }

  init() {
    // Видаляємо попереднє, якщо є
    $('#customEditModal')?.remove();

    this.modal = document.createElement('div');
    this.modal.id = 'customEditModal';
    this.modal.className = 'edit-modal-overlay'; // для CSS-анімації
    this.modal.innerHTML = `
      <div class="edit-modal">
        <h3 class="edit-modal-title">Редагувати пост</h3>
        <div class="edit-modal-textarea-container">
          <textarea id="editModalTextarea" class="edit-modal-textarea" maxlength="2000">${this.currentText}</textarea>
          <span class="edit-modal-counter" id="editModalCounter">${this.currentText.length}/2000</span>
        </div>
        <div class="edit-modal-actions">
          <button id="closeEditModal" class="edit-modal-btn cancel">Скасувати</button>
          <button id="saveEditModal" class="edit-modal-btn save">Зберегти</button>
        </div>
        <button id="editModalEmojiBtn" class="edit-modal-emoji-btn">${CONFIG.EMOJI_BUTTON_TEXT}</button>
        <div id="editModalEmojiPicker" class="emoji-picker"></div>
      </div>
    `;

    document.body.appendChild(this.modal);
    this.textarea = $('#editModalTextarea');
    this.counter = $('#editModalCounter');

    // Анімація появи
    setTimeout(() => this.modal.classList.add('active'), 10);

    this.attachEvents();
    this.setupEmoji();
    this.textarea.focus();
    this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
  }

  attachEvents() {
    this.textarea.addEventListener('input', () => {
      const len = this.textarea.value.length;
      this.counter.textContent = `${len}/2000`;
    });

    $('#closeEditModal').addEventListener('click', () => this.close());
    $('#saveEditModal').addEventListener('click', () => {
      const newText = this.textarea.value.trim();
      if (newText && newText !== this.currentText) {
        this.onSave(newText);
        this.close();
      } else if (newText === this.currentText) {
        this.close();
      } else {
        showToast('Текст поста не може бути порожнім');
      }
    });

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
  }

  setupEmoji() {
    const emojiBtn = $('#editModalEmojiBtn');
    const picker = $('#editModalEmojiPicker');
    setupEmojiPicker(emojiBtn, picker, this.textarea);
  }

  close() {
    this.modal.classList.remove('active');
    setTimeout(() => this.modal.remove(), 200); // після анімації
  }
}

// ==================== Оптимізовані функції лайків та збережень ====================
// Спільна логіка для оновлення UI та Firestore з batch
async function performSocialAction({
  postId,
  button,
  actionType, // 'like' або 'save'
  checkWas,
  getServerState,
  buildBatchUpdates,
  onSuccessOptimistic,
  onErrorRollback
}) {
  if (!state.currentUser) {
    showToast(`Увійдіть, щоб ${actionType === 'like' ? 'лайкати' : 'зберегти'}`);
    return;
  }

  const promiseMap = actionType === 'like' ? state.likePromiseMap : state.savePromiseMap;
  if (promiseMap.has(postId)) return;

  const wasActive = button.classList.contains(actionType === 'like' ? 'liked' : 'saved');
  const countSpan = actionType === 'like' ? button.querySelector('span') : null;
  const oldCount = countSpan ? parseInt(countSpan.textContent) || 0 : 0;

  // Оптимістичне оновлення
  button.classList.toggle(actionType === 'like' ? 'liked' : 'saved', !wasActive);
  if (countSpan) {
    const newCount = wasActive ? Math.max(oldCount - 1, 0) : oldCount + 1;
    countSpan.textContent = newCount;
  }

  try {
    promiseMap.set(postId, true);

    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      onErrorRollback({ button, wasActive, countSpan, oldCount });
      return;
    }

    const serverActive = getServerState(postSnap.data());
    if (serverActive === wasActive) {
      const batch = writeBatch(db);
      buildBatchUpdates(batch, postRef, wasActive);
      await batch.commit();
      onSuccessOptimistic?.({ wasActive, postId });
    } else {
      // Стан не співпав – відкочуємо до серверного
      onErrorRollback({ button, wasActive: serverActive, countSpan, oldCount: postSnap.data().likesCount || 0 });
    }
  } catch (error) {
    console.error(`Помилка ${actionType}:`, error);
    showToast(`Не вдалося оновити. Спробуйте ще.`);
    onErrorRollback({ button, wasActive, countSpan, oldCount });
  } finally {
    promiseMap.delete(postId);
  }
}

export const toggleLike = debounce(async (postId, buttonElement) => {
  await performSocialAction({
    postId,
    button: buttonElement,
    actionType: 'like',
    checkWas: (el) => el.classList.contains('liked'),
    getServerState: (data) => data.likes?.includes(state.currentUser.uid) || false,
    buildBatchUpdates: (batch, postRef, wasLiked) => {
      const userRef = doc(db, "users", state.currentUser.uid);
      if (wasLiked) {
        batch.update(postRef, {
          likes: arrayRemove(state.currentUser.uid),
          likesCount: increment(-1),
          popularity: increment(-CONFIG.POPULARITY_LIKE)
        });
        batch.update(userRef, { likedPosts: arrayRemove(postId) });
      } else {
        batch.update(postRef, {
          likes: arrayUnion(state.currentUser.uid),
          likesCount: increment(1),
          popularity: increment(CONFIG.POPULARITY_LIKE)
        });
        batch.update(userRef, { likedPosts: arrayUnion(postId) });
        vibrate(30);
      }
    },
    onErrorRollback: ({ button, wasActive, countSpan, oldCount }) => {
      button.classList.toggle('liked', wasActive);
      if (countSpan) countSpan.textContent = oldCount;
    }
  });
}, CONFIG.LIKE_DEBOUNCE);

export const toggleSave = debounce(async (postId, buttonElement) => {
  await performSocialAction({
    postId,
    button: buttonElement,
    actionType: 'save',
    getServerState: (data) => data.saves?.includes(state.currentUser.uid) || false,
    buildBatchUpdates: (batch, postRef, wasSaved) => {
      const userRef = doc(db, "users", state.currentUser.uid);
      if (wasSaved) {
        batch.update(userRef, { savedPosts: arrayRemove(postId) });
        batch.update(postRef, { saves: arrayRemove(state.currentUser.uid) });
      } else {
        batch.update(userRef, { savedPosts: arrayUnion(postId) });
        batch.update(postRef, { saves: arrayUnion(state.currentUser.uid) });
      }
    },
    onErrorRollback: ({ button, wasActive }) => {
      button.classList.toggle('saved', wasActive);
    }
  });
}, CONFIG.SAVE_DEBOUNCE);

// ==================== Створення поста ====================
export async function createPost(text, files) {
  if (!state.currentUser) {
    showToast('Увійдіть, щоб опублікувати пост');
    return false;
  }

  if (files.length > CONFIG.MAX_FILES) {
    showToast(`Можна вибрати не більше ${CONFIG.MAX_FILES} файлів`);
    return false;
  }

  try {
    showToast('Завантаження...');

    const media = [];
    for (const file of files) {
      const url = await uploadToCloudinary(file);
      media.push({ url, type: file.type.split('/')[0] });
    }

    const userSnap = await getDoc(doc(db, "users", state.currentUser.uid));
    const userData = userSnap.data();

    const hashtags = extractHashtags(text);

    const postDoc = await addDoc(collection(db, "posts"), {
      author: state.currentUser.uid,
      authorType: 'user',
      authorName: userData.nickname,
      authorUserId: userData.userId,
      authorAvatar: userData.avatar || '',
      text,
      media,
      createdAt: serverTimestamp(),
      likes: [],
      likesCount: 0,
      commentsCount: 0,
      saves: [],
      views: 0,
      hashtags,
      popularity: 0
    });

    await updateDoc(doc(db, "users", state.currentUser.uid), {
      posts: arrayUnion(postDoc.id)
    });

    // Очищення форми
    const postText = document.getElementById('postText');
    const postMedia = document.getElementById('postMedia');
    const previews = document.getElementById('postMediaPreviews');
    const label = document.getElementById('postMediaLabel');
    if (postText) postText.value = '';
    if (postMedia) postMedia.value = '';
    if (previews) previews.innerHTML = '';
    if (label) label.textContent = '+ Медіа (до 3 файлів)';

    showToast('Пост опубліковано!');
    return true;
  } catch (e) {
    console.error('Помилка створення поста:', e);
    showToast('Помилка: ' + e.message);
    return false;
  }
}

// ==================== Редагування поста ====================
export async function editPost(postId) {
  if (!state.currentUser) return;

  const postRef = doc(db, "posts", postId);
  const postSnap = await getDoc(postRef);
  if (!postSnap.exists()) {
    showToast('Пост не знайдено');
    return;
  }

  const post = postSnap.data();
  if (post.author !== state.currentUser.uid) {
    showToast('Ви не автор цього поста');
    return;
  }

  new EditModal(post.text || '', async (newText) => {
    try {
      const hashtags = extractHashtags(newText);
      await updateDoc(postRef, {
        text: newText,
        hashtags,
        edited: true,
        updatedAt: serverTimestamp()
      });
      showToast('Пост оновлено');

      // Миттєве оновлення DOM
      const postEl = $(`.post[data-post-id="${postId}"]`);
      if (postEl) {
        const contentContainer = $('.post-content', postEl);
        if (contentContainer) {
          contentContainer.innerHTML = highlightHashtags(newText);
          attachHashtagClick(contentContainer);
        }
      }
    } catch (error) {
      console.error('Помилка редагування поста:', error);
      showToast('Не вдалося оновити пост');
    }
  });
}

// ==================== Видалення поста ====================
export async function deletePost(postId) {
  if (!state.currentUser) return;
  if (!confirm('Видалити цей пост назавжди?')) return;

  try {
    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      return;
    }

    // Видаляємо коментарі (підколекцію) за допомогою batch
    const commentsSnapshot = await getDocs(collection(db, `posts/${postId}/comments`));
    const batch = writeBatch(db);
    commentsSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(postRef);
    batch.update(doc(db, "users", state.currentUser.uid), {
      posts: arrayRemove(postId)
    });
    await batch.commit();

    // Видаляємо з DOM
    $(`.post[data-post-id="${postId}"]`)?.remove();
    showToast('Пост видалено');
  } catch (error) {
    console.error('Помилка видалення поста:', error);
    showToast('Не вдалося видалити пост');
  }
}

// ==================== Завантаження постів (пагінація) ====================
export async function loadMorePosts(containerId = 'feed') {
  if (!state.currentUser || state.loading || !state.hasMore) return;

  state.loading = true;
  const skeleton = document.getElementById('skeletonContainer');
  if (skeleton) skeleton.style.display = 'block';

  try {
    let baseQuery = state.currentFilterHashtag
      ? query(collection(db, "posts"), where("hashtags", "array-contains", state.currentFilterHashtag))
      : collection(db, "posts");

    let orderField = state.currentFeedType === 'new' || state.currentFilterHashtag ? "createdAt" : "likesCount";
    let q = query(baseQuery, orderBy(orderField, "desc"), orderBy("createdAt", "desc"), limit(10));

    if (state.lastVisible) {
      q = query(q, startAfter(state.lastVisible));
    }

    const snapshot = await getDocs(q);
    if (snapshot.empty) {
      state.hasMore = false;
      return;
    }

    state.lastVisible = snapshot.docs[snapshot.docs.length - 1];
    renderPosts(snapshot.docs, containerId);
  } catch (e) {
    handleFirestoreError(e);
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    state.loading = false;
  }
}

function handleFirestoreError(e) {
  console.error("Помилка завантаження постів:", e);
  if (e.code === 'failed-precondition' && e.message.includes('index')) {
    const match = e.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
    showToast(match ? '⚠️ Потрібен індекс. Скопіюйте посилання з консолі (F12).' : '⚠️ Потрібно створити складений індекс у Firestore.');
  } else if (e.code === 'permission-denied') {
    showToast('❌ Недостатньо прав. Перевірте правила безпеки.');
  } else {
    showToast('Помилка завантаження: ' + e.message);
  }
}

// ==================== Рендеринг постів (з documentFragment) ====================
function highlightHashtags(text) {
  return text.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>');
}

function attachHashtagClick(container) {
  $$('.hashtag', container).forEach(span => {
    span.onclick = (e) => {
      e.stopPropagation();
      searchHashtag(span.dataset.tag);
    };
  });
}

export function renderPosts(docs, containerId = 'feed') {
  const feed = document.getElementById(containerId);
  if (!feed) return;

  const fragment = document.createDocumentFragment();

  docs.forEach(docSnap => {
    const post = { id: docSnap.id, ...docSnap.data() };
    const liked = post.likes?.includes(state.currentUser?.uid) || false;
    const saved = post.saves?.includes(state.currentUser?.uid) || false;
    const postTime = post.createdAt
      ? new Date(post.createdAt.seconds * 1000).toLocaleString('uk-UA', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false
        })
      : '';
    const isAuthor = state.currentUser && post.author === state.currentUser.uid;
    const isFollowing = state.currentUserFollowing.includes(post.author);

    const postEl = document.createElement('div');
    postEl.className = 'post';
    postEl.dataset.postId = post.id;
    postEl.tabIndex = 0;

    // Меню буде додано окремо через PostMenu
    const header = document.createElement('div');
    header.className = 'post-header';
    header.innerHTML = `
      <div class="avatar" style="background-image:url(${post.authorAvatar || ''})" data-uid="${post.author}" tabindex="0"></div>
      <div class="post-author-info">
        <div>
          <span class="post-author" data-uid="${post.author}" tabindex="0">${post.authorName || 'Невідомо'}</span>
          <span class="post-meta">${post.authorUserId || ''}</span>
          ${!isAuthor && state.currentUser ? `<button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${post.author}" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>` : ''}
        </div>
        <div class="post-time">${postTime}</div>
      </div>
      <div class="post-menu-container"></div>
    `;
    postEl.appendChild(header);

    // Ініціалізуємо меню
    const menuContainer = $('.post-menu-container', header);
    new PostMenu(menuContainer, post.id, isAuthor);

    // Контент
    const contentDiv = document.createElement('div');
    contentDiv.className = 'post-content';
    contentDiv.innerHTML = highlightHashtags(post.text || '');
    attachHashtagClick(contentDiv);
    postEl.appendChild(contentDiv);

    // Медіа
    if (post.media?.length) {
      postEl.appendChild(createGallery(post.media));
    } else if (post.mediaUrl) {
      const mediaEl = document.createElement(post.mediaType === 'image' ? 'img' : 'video');
      mediaEl.src = post.mediaUrl;
      mediaEl.className = 'post-media';
      mediaEl.loading = 'lazy';
      mediaEl.tabIndex = 0;
      if (post.mediaType === 'video') mediaEl.controls = true;
      postEl.appendChild(mediaEl);
    }

    // Футер
    const footer = document.createElement('div');
    footer.className = 'post-footer';
    footer.innerHTML = `
      <button class="like-btn ${liked ? 'liked' : ''}" data-post-id="${post.id}" tabindex="0">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        <span>${post.likesCount || 0}</span>
      </button>
      <button class="comment-toggle-btn" data-post-id="${post.id}" tabindex="0">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${post.commentsCount || 0}</span>
      </button>
      <button class="save-btn ${saved ? 'saved' : ''}" data-post-id="${post.id}" tabindex="0">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
      <span class="view-count" title="Перегляди">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7z"/></svg>
        ${post.views || 0}
      </span>
    `;
    postEl.appendChild(footer);

    // Секція коментарів
    const commentsSection = document.createElement('div');
    commentsSection.className = 'comments-section';
    commentsSection.id = `comments-${post.id}`;
    commentsSection.style.display = 'none';
    commentsSection.innerHTML = `
      <div class="comments-list" id="comments-list-${post.id}"></div>
      <div class="comment-form">
        <input type="text" id="comment-input-${post.id}" class="comment-input" placeholder="Напишіть коментар..." tabindex="0">
        <div class="emoji-picker-container" style="position: relative;">
          <button class="emoji-button" id="comment-emoji-${post.id}" tabindex="0">😊</button>
          <div class="emoji-picker" id="comment-picker-${post.id}"></div>
        </div>
        <button class="btn btn-primary btn-icon" id="submit-comment-${post.id}" tabindex="0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;
    postEl.appendChild(commentsSection);

    fragment.appendChild(postEl);
  });

  feed.appendChild(fragment);

  // Тепер навішуємо обробники подій та onSnapshot для кожного нового поста
  docs.forEach(docSnap => {
    const postId = docSnap.id;
    const postEl = $(`.post[data-post-id="${postId}"]`, feed);
    if (!postEl) return;

    // Лайк
    const likeBtn = $('.like-btn', postEl);
    likeBtn?.addEventListener('click', () => toggleLike(postId, likeBtn));

    // Збереження
    const saveBtn = $('.save-btn', postEl);
    saveBtn?.addEventListener('click', () => toggleSave(postId, saveBtn));

    // Коментарі
    const toggleBtn = $('.comment-toggle-btn', postEl);
    const commentsSection = $(`#comments-${postId}`);
    toggleBtn?.addEventListener('click', async () => {
      if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        const commentsList = $(`#comments-list-${postId}`);
        if (commentsList) await loadComments(postId, commentsList);
      } else {
        commentsSection.style.display = 'none';
      }
    });

    const submitBtn = $(`#submit-comment-${postId}`);
    const commentInput = $(`#comment-input-${postId}`);
    submitBtn?.addEventListener('click', async () => {
      const text = commentInput.value.trim();
      if (!text) return;
      try {
        await addComment(postId, text);
        commentInput.value = '';
        const commentsList = $(`#comments-list-${postId}`);
        if (commentsList) await loadComments(postId, commentsList);
        const countSpan = toggleBtn.querySelector('span');
        if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;
        showToast('Коментар додано');
      } catch (error) {
        console.error('Error adding comment:', error);
        showToast('Помилка: ' + error.message);
      }
    });

    // Emoji для коментаря
    setupEmojiPicker(`comment-emoji-${postId}`, `comment-picker-${postId}`, `comment-input-${postId}`);

    // Перегляд
    incrementPostView(postId);

    // Реактивний слухач змін поста
    const unsubscribe = onSnapshot(doc(db, "posts", postId), (snap) => {
      if (!snap.exists()) {
        postEl.remove();
        unsubscribe();
        state.postListeners.delete(postId);
        return;
      }
      const data = snap.data();
      // Оновлюємо лайк
      const likeBtn = $('.like-btn', postEl);
      if (likeBtn) {
        const liked = data.likes?.includes(state.currentUser?.uid) || false;
        likeBtn.classList.toggle('liked', liked);
        const countSpan = likeBtn.querySelector('span');
        if (countSpan) countSpan.textContent = data.likesCount || 0;
      }
      // Оновлюємо збереження
      const saveBtn = $('.save-btn', postEl);
      if (saveBtn) {
        const saved = data.saves?.includes(state.currentUser?.uid) || false;
        saveBtn.classList.toggle('saved', saved);
      }
    }, (error) => console.error(`Listener post ${postId}:`, error));

    state.postListeners.set(postId, unsubscribe);
  });
}

// ==================== Коментарі ====================
export async function loadComments(postId, container) {
  const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
  const snapshot = await getDocs(q);
  container.innerHTML = '';
  snapshot.forEach(doc => {
    const comment = doc.data();
    const commentEl = document.createElement('div');
    commentEl.className = 'comment';
    const commentTime = comment.createdAt
      ? new Date(comment.createdAt.seconds * 1000).toLocaleString('uk-UA', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: false
        })
      : '';
    commentEl.innerHTML = `
      <div class="comment-avatar" style="background-image:url(${comment.authorAvatar || ''})" data-uid="${comment.author}"></div>
      <div class="comment-content">
        <div>
          <span class="comment-author" data-uid="${comment.author}">${comment.authorName}</span>
          <span class="comment-time">${commentTime}</span>
        </div>
        <div class="comment-text">${comment.text}</div>
      </div>
    `;
    container.appendChild(commentEl);
  });
}

export async function addComment(postId, text) {
  if (!state.currentUser || !text.trim()) return;
  const userSnap = await getDoc(doc(db, "users", state.currentUser.uid));
  const user = userSnap.data();
  const commentRef = collection(db, `posts/${postId}/comments`);
  await addDoc(commentRef, {
    author: state.currentUser.uid,
    authorName: user.nickname,
    authorAvatar: user.avatar || '',
    text: text.trim(),
    createdAt: serverTimestamp()
  });
  await updateDoc(doc(db, "posts", postId), {
    commentsCount: increment(1),
    popularity: increment(CONFIG.POPULARITY_COMMENT)
  });
}

// ==================== Перегляди ====================
async function incrementPostView(postId) {
  if (!state.currentUser || state.viewedPosts.has(postId)) return;
  state.viewedPosts.add(postId);
  try {
    await updateDoc(doc(db, "posts", postId), {
      views: increment(1),
      popularity: increment(CONFIG.POPULARITY_VIEW)
    });
  } catch (e) {
    console.warn("Не вдалося оновити перегляди:", e);
  }
}

// ==================== Галерея ====================
function createGallery(media) {
  const gallery = document.createElement('div');
  gallery.className = 'post-gallery';

  const inner = document.createElement('div');
  inner.className = 'gallery-inner';

  media.forEach((item, index) => {
    const slide = document.createElement('div');
    slide.className = 'gallery-slide';
    if (item.type === 'image') {
      slide.innerHTML = `<img src="${item.url}" loading="lazy" tabindex="0">`;
    } else {
      slide.innerHTML = `<video src="${item.url}" controls class="post-media" tabindex="0"></video>`;
    }
    inner.appendChild(slide);
  });

  gallery.appendChild(inner);

  const indicators = document.createElement('div');
  indicators.className = 'gallery-indicators';
  media.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = i === 0 ? 'active' : '';
    indicators.appendChild(dot);
  });
  gallery.appendChild(indicators);

  const counter = document.createElement('div');
  counter.className = 'gallery-counter';
  counter.textContent = `1/${media.length}`;
  gallery.appendChild(counter);

  const updateGallery = () => {
    const scrollLeft = inner.scrollLeft;
    const slideWidth = inner.clientWidth;
    const index = Math.round(scrollLeft / slideWidth);
    const safeIndex = Math.min(Math.max(index, 0), media.length - 1);

    $$('span', indicators).forEach((dot, i) => {
      dot.className = i === safeIndex ? 'active' : '';
    });
    counter.textContent = `${safeIndex + 1}/${media.length}`;
  };

  inner.addEventListener('scroll', updateGallery);
  setTimeout(updateGallery, 0);

  return gallery;
}

// ==================== Хештеги ====================
export async function loadHashtags(listId = 'hashtagList') {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    const postsSnap = await getDocs(collection(db, "posts"));
    const tagCount = new Map();
    postsSnap.forEach(doc => {
      (doc.data().hashtags || []).forEach(tag => {
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
      div.onclick = () => searchHashtag(tag);
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error loading hashtags:', e);
    list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}

export function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    document.querySelector('[data-section="search"]')?.click();
  }
}

// ==================== Фільтри ====================
export async function loadFilterHashtags(listId = 'filterList') {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    const postsSnap = await getDocs(collection(db, "posts"));
    const tagCount = new Map();
    postsSnap.forEach(doc => {
      (doc.data().hashtags || []).forEach(tag => {
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
      div.onclick = () => applyFilter(tag);
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error loading filter hashtags:', e);
    list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}

export function applyFilter(tag) {
  setFilterHashtag(tag);
  document.getElementById('filterModal')?.classList.remove('active');

  if (state.currentFeedType === 'popular') {
    setCurrentFeedType('new');
    document.getElementById('feedNewBtn')?.classList.add('active');
    document.getElementById('feedPopularBtn')?.classList.remove('active');
  }

  const activeDiv = document.getElementById('activeFilter');
  activeDiv.innerHTML = `#${tag} <button id="clearFilterChip">✕</button>`;
  document.getElementById('clearFilterChip').onclick = clearFilter;

  resetPaginationState();
  const feed = document.getElementById('feed');
  if (feed) {
    feed.innerHTML = '';
    loadMorePosts();
  }
}

export function clearFilter() {
  setFilterHashtag(null);
  document.getElementById('activeFilter').innerHTML = '';
  resetPaginationState();
  const feed = document.getElementById('feed');
  if (feed) {
    feed.innerHTML = '';
    loadMorePosts();
  }
}
