import { db } from './config.js';
import {
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy, limit, startAfter,
  getDocs, serverTimestamp, arrayUnion, arrayRemove, increment, writeBatch, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  state,
  setFilterHashtag, resetPaginationState, setCurrentFeedType
} from './state.js';
import { showToast, vibrate, uploadToCloudinary, debounce, setupEmojiPicker } from './utils.js';
import { toggleFollow } from './profile.js';

// ================= Утильна функція для санітизації HTML =================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ================= Допоміжні функції =================
export function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

// ================= Лайк (з debounce) =================
export const toggleLike = debounce(async (postId, buttonElement) => {
  if (!state.currentUser) {
    showToast('Увійдіть, щоб лайкати');
    return;
  }

  if (state.likePromiseMap.has(postId)) return;

  const wasLiked = buttonElement.classList.contains('liked');
  const countSpan = buttonElement.querySelector('span');
  const oldCount = countSpan ? parseInt(countSpan.textContent) : 0;

  // Оптимістичне оновлення
  const newCount = wasLiked ? Math.max(oldCount - 1, 0) : oldCount + 1;
  buttonElement.classList.toggle('liked', !wasLiked);
  if (countSpan) countSpan.textContent = newCount;

  try {
    state.likePromiseMap.set(postId, true);

    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      buttonElement.classList.toggle('liked', wasLiked);
      if (countSpan) countSpan.textContent = oldCount;
      return;
    }

    const postData = postSnap.data();
    const isLiked = !!(postData.likes && postData.likes.includes(state.currentUser.uid));

    if (isLiked === wasLiked) {
      const batch = writeBatch(db);
      if (isLiked) {
        batch.update(postRef, {
          likes: arrayRemove(state.currentUser.uid),
          likesCount: increment(-1),
          popularity: increment(-50)
        });
        batch.update(doc(db, "users", state.currentUser.uid), {
          likedPosts: arrayRemove(postId)
        });
      } else {
        batch.update(postRef, {
          likes: arrayUnion(state.currentUser.uid),
          likesCount: increment(1),
          popularity: increment(50)
        });
        batch.update(doc(db, "users", state.currentUser.uid), {
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
    state.likePromiseMap.delete(postId);
  }
}, 300);

// ================= Збереження поста =================
export const toggleSave = debounce(async (postId, buttonElement) => {
  if (!state.currentUser) {
    showToast('Увійдіть, щоб зберегти');
    return;
  }

  if (state.savePromiseMap.has(postId)) return;

  const wasSaved = buttonElement.classList.contains('saved');
  buttonElement.classList.toggle('saved', !wasSaved);

  try {
    state.savePromiseMap.set(postId, true);

    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      buttonElement.classList.toggle('saved', wasSaved);
      return;
    }

    const postData = postSnap.data();
    const isSaved = !!(postData.saves && postData.saves.includes(state.currentUser.uid));

    if (isSaved === wasSaved) {
      const batch = writeBatch(db);
      const userRef = doc(db, "users", state.currentUser.uid);
      if (wasSaved) {
        batch.update(userRef, { savedPosts: arrayRemove(postId) });
        batch.update(postRef, { saves: arrayRemove(state.currentUser.uid) });
      } else {
        batch.update(userRef, { savedPosts: arrayUnion(postId) });
        batch.update(postRef, { saves: arrayUnion(state.currentUser.uid) });
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
    state.savePromiseMap.delete(postId);
  }
}, 300);

// ================= Створення поста =================
export async function createPost(text, files) {
  if (!state.currentUser) {
    showToast('Увійдіть, щоб опублікувати пост');
    return false;
  }

  if (!files || !Array.isArray(files)) {
    files = [];
  }

  const MAX_FILES = 3;
  if (files.length > MAX_FILES) {
    showToast(`Можна вибрати не більше ${MAX_FILES} файлів`);
    return false;
  }

  try {
    showToast('Завантаження...');

    // ВИПРАВЛЕННЯ: завантажуємо всі файли паралельно замість послідовного await у циклі
    const uploadResults = await Promise.allSettled(
      files.map(file => uploadToCloudinary(file).then(url => ({ url, type: file.type.split('/')[0], name: file.name })))
    );

    const media = [];
    uploadResults.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value.url) {
        media.push({ url: result.value.url, type: result.value.type });
      } else {
        console.error('Помилка при завантаженні файлу:', result.reason);
        showToast(`Помилка завантаження файлу: ${files[i].name}`);
      }
    });

    if (media.length === 0 && files.length > 0) {
      showToast('Не вдалося завантажити жодного файлу');
      return false;
    }

    const userRef = doc(db, "users", state.currentUser.uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      showToast('Користувача не знайдено');
      return false;
    }
    const userData = userSnap.data();

    const hashtags = extractHashtags(text);

    const postDoc = await addDoc(collection(db, "posts"), {
      author: state.currentUser.uid,
      authorType: 'user',
      authorName: userData.nickname || 'Невідомо',
      authorUserId: userData.userId || '',
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

    await updateDoc(userRef, { posts: arrayUnion(postDoc.id) });

    document.getElementById('postText').value = '';
    document.getElementById('postMedia').value = '';
    document.getElementById('postMediaPreviews').innerHTML = '';
    document.getElementById('postMediaLabel').textContent = '+ Медіа (до 3 файлів)';

    showToast('Пост опубліковано!');
    return true;
  } catch (e) {
    console.error('Помилка створення поста:', e);
    showToast('Помилка: ' + e.message);
    return false;
  }
}

// ================= Редагування поста =================
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

  createEditModal(post.text || '', async (newText) => {
    try {
      const hashtags = extractHashtags(newText);
      await updateDoc(postRef, {
        text: newText,
        hashtags,
        edited: true,
        updatedAt: serverTimestamp()
      });
      showToast('Пост оновлено');

      const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
      if (postEl) {
        const contentContainer = postEl.querySelector('.post-content');
        if (contentContainer) {
          // ВИПРАВЛЕННЯ: escapeHtml перед replace, щоб уникнути XSS.
          // Раніше newText вставлявся в innerHTML без санітизації.
          const safeText = escapeHtml(newText);
          contentContainer.innerHTML = safeText.replace(
            /#(\w+)/g,
            '<span class="hashtag" data-tag="$1">#$1</span>'
          );

          contentContainer.querySelectorAll('.hashtag').forEach(span => {
            span.onclick = (e) => {
              e.stopPropagation();
              searchHashtag(span.dataset.tag);
            };
          });
        }
      }
    } catch (error) {
      console.error('Помилка редагування поста:', error);
      showToast('Не вдалося оновити пост');
    }
  });
}

// Функція для створення UI модального вікна редагування
function createEditModal(currentText, onSave) {
  const existingModal = document.getElementById('customEditModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'customEditModal';
  modal.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center;
    z-index: 9999; backdrop-filter: blur(2px);
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: var(--bg-color, #ffffff); 
    padding: 20px; 
    border-radius: 16px; 
    width: 90%; 
    max-width: 500px; 
    box-shadow: 0 10px 25px rgba(0,0,0,0.2); 
    display: flex; 
    flex-direction: column; 
    gap: 15px;
  `;

  const title = document.createElement('h3');
  title.style.cssText = 'margin: 0; font-size: 18px; color: var(--text-color, #333);';
  title.textContent = 'Редагувати пост';

  const textarea = document.createElement('textarea');
  textarea.id = 'editModalTextarea';
  textarea.value = currentText;
  textarea.style.cssText = `
    width: 100%; 
    height: 150px; 
    padding: 12px; 
    border: 1px solid var(--border-color, #ddd); 
    border-radius: 8px; 
    resize: none; 
    font-family: inherit; 
    font-size: 15px; 
    outline: none; 
    box-sizing: border-box; 
    background: var(--input-bg, #fff); 
    color: var(--text-color, #333);
  `;

  const buttonContainer = document.createElement('div');
  buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.id = 'closeEditModal';
  cancelBtn.textContent = 'Скасувати';
  cancelBtn.style.cssText = `
    padding: 10px 16px; 
    border: none; 
    border-radius: 8px; 
    background: var(--btn-secondary-bg, #e0e0e0); 
    color: var(--text-color, #333); 
    font-weight: 600; 
    cursor: pointer;
  `;

  const saveBtn = document.createElement('button');
  saveBtn.id = 'saveEditModal';
  saveBtn.textContent = 'Зберегти';
  saveBtn.style.cssText = `
    padding: 10px 16px; 
    border: none; 
    border-radius: 8px; 
    background: var(--primary-color, #007bff); 
    color: white; 
    font-weight: 600; 
    cursor: pointer;
  `;

  buttonContainer.appendChild(cancelBtn);
  buttonContainer.appendChild(saveBtn);
  
  modalContent.appendChild(title);
  modalContent.appendChild(textarea);
  modalContent.appendChild(buttonContainer);
  
  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const closeModal = () => modal.remove();

  cancelBtn.onclick = closeModal;
  
  saveBtn.onclick = () => {
    const newText = textarea.value.trim();
    if (newText && newText !== currentText) {
      onSave(newText);
      closeModal();
    } else if (newText === currentText) {
      closeModal();
    } else {
      showToast('Текст поста не може бути порожнім');
    }
  };

  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}

// ================= Видалення поста =================
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

    // Видаляємо слухача перед видаленням
    const unsubscribe = state.postListeners.get(postId);
    if (unsubscribe) {
      unsubscribe();
      state.postListeners.delete(postId);
    }

    const commentsSnapshot = await getDocs(collection(db, `posts/${postId}/comments`));
    const batch = writeBatch(db);
    commentsSnapshot.forEach(docSnap => batch.delete(docSnap.ref));

    batch.delete(postRef);

    const userRef = doc(db, "users", state.currentUser.uid);
    batch.update(userRef, {
      posts: arrayRemove(postId)
    });

    await batch.commit();

    const postElement = document.querySelector(`.post[data-post-id="${postId}"]`);
    if (postElement) postElement.remove();

    showToast('Пост видалено');
  } catch (error) {
    console.error('Помилка видалення поста:', error);
    showToast('Не вдалося видалити пост');
  }
}

// ================= Завантаження постів (пагінація) =================
export async function loadMorePosts(containerId = 'feed') {
  if (!state.currentUser) {
    console.log('loadMorePosts: користувач не авторизований');
    return;
  }
  if (state.loading) {
    console.log('loadMorePosts: вже завантажується');
    return;
  }
  if (!state.hasMore) {
    console.log('loadMorePosts: більше немає постів');
    return;
  }

  state.loading = true;
  const skeleton = document.getElementById('skeletonContainer');
  if (skeleton) skeleton.style.display = 'block';

  try {
    let queryConstraints = [];

    if (state.currentFilterHashtag) {
      queryConstraints.push(where("hashtags", "array-contains", state.currentFilterHashtag));
    }

    if (state.currentFeedType === 'new' || state.currentFilterHashtag) {
      queryConstraints.push(orderBy("createdAt", "desc"));
    } else {
      queryConstraints.push(orderBy("likesCount", "desc"));
      queryConstraints.push(orderBy("createdAt", "desc"));
    }

    queryConstraints.push(limit(10));

    if (state.lastVisible) {
      queryConstraints.push(startAfter(state.lastVisible));
    }

    const q = query(collection(db, "posts"), ...queryConstraints);
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      state.hasMore = false;
      return;
    }

    state.lastVisible = snapshot.docs[snapshot.docs.length - 1];
    renderPosts(snapshot.docs, containerId);
  } catch (e) {
    console.error("Помилка завантаження постів:", e);
    if (e.code === 'failed-precondition' || e.message.includes('index')) {
      const match = e.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
      if (match) {
        console.log('Посилання для створення індексу:', match[0]);
        showToast(`⚠️ Потрібен індекс. Скопіюйте посилання з консолі (F12).`);
      } else {
        showToast('⚠️ Потрібно створити складений індекс у Firestore. Перейдіть у Firebase Console.');
      }
    } else if (e.code === 'permission-denied') {
      showToast('❌ Недостатньо прав. Перевірте правила безпеки Firestore.');
    } else {
      showToast('Помилка завантаження: ' + e.message);
    }
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    state.loading = false;
  }
}

// ================= Рендеринг постів =================
export function renderPosts(docs, containerId = 'feed') {
  const feed = document.getElementById(containerId);
  if (!feed) {
    console.error('renderPosts: контейнер не знайдено', containerId);
    return;
  }

  docs.forEach(docSnap => {
    const post = { id: docSnap.id, ...docSnap.data() };

    // ВИПРАВЛЕННЯ: якщо пост вже є на сторінці — пропускаємо, щоб уникнути
    // дублювання onSnapshot-слухачів і дублікатів у DOM
    if (document.querySelector(`.post[data-post-id="${post.id}"]`)) {
      console.warn(`renderPosts: пост ${post.id} вже існує у DOM, пропускаємо`);
      return;
    }

    const liked = !!(state.currentUser && post.likes && post.likes.includes(state.currentUser.uid));
    const saved = !!(state.currentUser && post.saves && post.saves.includes(state.currentUser.uid));

    let postTime = '';
    if (post.createdAt && typeof post.createdAt.seconds === 'number') {
      postTime = new Date(post.createdAt.seconds * 1000).toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
    }

    const isAuthor = !!(state.currentUser && post.author === state.currentUser.uid);
    const isFollowing = !!(state.currentUserFollowing && state.currentUserFollowing.includes(post.author));

    const postEl = document.createElement('div');
    postEl.className = 'post';
    postEl.dataset.postId = post.id;
    postEl.tabIndex = 0;

    let menuHtml = '';
    if (isAuthor) {
      menuHtml = `
        <div class="post-menu-container">
          <button class="post-menu-btn" aria-label="Меню поста" tabindex="0">⋮</button>
          <div class="post-menu-dropdown" style="display: none;">
            <div class="post-menu-item" data-action="edit">Редагувати</div>
            <div class="post-menu-item" data-action="delete">Видалити</div>
          </div>
        </div>
      `;
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'post-content';

    // Санітизуємо текст перед вставкою в innerHTML
    const safeText = escapeHtml(post.text || '');
    contentDiv.innerHTML = safeText.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>');

    const followButtonHtml = !isAuthor && state.currentUser ?
      `<button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${post.author}" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>` : '';

    const headerHtml = `
      <div class="post-header">
        <div class="avatar" style="background-image:url(${escapeHtml(post.authorAvatar || '')})" data-uid="${post.author}" tabindex="0"></div>
        <div class="post-author-info">
          <div>
            <span class="post-author" data-uid="${post.author}" tabindex="0">${escapeHtml(post.authorName || 'Невідомо')}</span>
            <span class="post-meta">${escapeHtml(post.authorUserId || '')}</span>
            ${followButtonHtml}
          </div>
          <div class="post-time">${escapeHtml(postTime)}</div>
        </div>
        ${menuHtml}
      </div>
    `;

    postEl.innerHTML = headerHtml;
    postEl.appendChild(contentDiv);

    if (post.media && post.media.length > 0) {
      const gallery = createGallery(post.media);
      postEl.appendChild(gallery);
    } else if (post.mediaUrl) {
      const mediaContainer = document.createElement('div');
      const mediaEl = post.mediaType === 'image'
        ? document.createElement('img')
        : document.createElement('video');
      mediaEl.src = post.mediaUrl;
      mediaEl.className = 'post-media';
      mediaEl.loading = 'lazy';
      if (post.mediaType !== 'image') mediaEl.controls = true;
      mediaContainer.appendChild(mediaEl);
      postEl.appendChild(mediaContainer);
    }

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

    feed.appendChild(postEl);

    // ВИПРАВЛЕННЯ: incrementPostView — async функція, помилки логуються всередині неї,
    // але ми більше не ігноруємо повернуте Promise мовчки
    incrementPostView(post.id).catch(e => console.warn('incrementPostView failed:', e));

    contentDiv.querySelectorAll('.hashtag').forEach(span => {
      span.onclick = (e) => {
        e.stopPropagation();
        searchHashtag(span.dataset.tag);
      };
    });

    const commentInput = document.getElementById(`comment-input-${post.id}`);
    if (commentInput) {
      setupEmojiPicker(`comment-emoji-${post.id}`, `comment-picker-${post.id}`, `comment-input-${post.id}`);
    }

    const toggleBtn = postEl.querySelector('.comment-toggle-btn');
    toggleBtn.onclick = async () => {
      if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        const commentsList = document.getElementById(`comments-list-${post.id}`);
        if (commentsList) await loadComments(post.id, commentsList);
      } else {
        commentsSection.style.display = 'none';
      }
    };

    const submitBtn = document.getElementById(`submit-comment-${post.id}`);
    if (submitBtn) {
      submitBtn.onclick = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        try {
          await addComment(post.id, text);
          commentInput.value = '';
          const commentsList = document.getElementById(`comments-list-${post.id}`);
          if (commentsList) await loadComments(post.id, commentsList);
          const countSpan = toggleBtn.querySelector('span');
          if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;
          showToast('Коментар додано');
        } catch (error) {
          console.error('Error adding comment:', error);
          showToast('Помилка: ' + error.message);
        }
      };
    }

    const postRef = doc(db, "posts", post.id);
    const unsubscribe = onSnapshot(postRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const likeBtn = postEl.querySelector('.like-btn');
        if (likeBtn && postEl.parentNode) {
          const liked = !!(state.currentUser && data.likes && data.likes.includes(state.currentUser.uid));
          likeBtn.classList.toggle('liked', liked);
          const countSpan = likeBtn.querySelector('span');
          if (countSpan) countSpan.textContent = data.likesCount || 0;
        }
        const saveBtn = postEl.querySelector('.save-btn');
        if (saveBtn && postEl.parentNode) {
          const saved = !!(state.currentUser && data.saves && data.saves.includes(state.currentUser.uid));
          saveBtn.classList.toggle('saved', saved);
        }
      } else {
        if (postEl.parentNode) {
          postEl.parentNode.removeChild(postEl);
        }
        unsubscribe();
        state.postListeners.delete(post.id);
      }
    }, (error) => {
      console.error(`Error listening to post ${post.id}:`, error);
    });
    state.postListeners.set(post.id, unsubscribe);
  });
}

// ================= Глобальне делегування для меню постів =================
document.addEventListener('click', (e) => {
  const menuBtn = e.target.closest('.post-menu-btn');
  if (menuBtn) {
    e.preventDefault();
    e.stopPropagation();
    const menuContainer = menuBtn.closest('.post-menu-container');
    const dropdown = menuContainer.querySelector('.post-menu-dropdown');
    if (dropdown) {
      document.querySelectorAll('.post-menu-dropdown').forEach(menu => {
        if (menu !== dropdown) menu.style.display = 'none';
      });
      dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    }
    return;
  }

  const menuItem = e.target.closest('.post-menu-item');
  if (menuItem) {
    e.preventDefault();
    e.stopPropagation();
    const menuContainer = menuItem.closest('.post-menu-container');
    const postEl = menuContainer.closest('.post');
    const postId = postEl.dataset.postId;
    const action = menuItem.dataset.action;

    if (action === 'edit') {
      editPost(postId);
    } else if (action === 'delete') {
      deletePost(postId);
    }

    const dropdown = menuContainer.querySelector('.post-menu-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  const followBtn = e.target.closest('.follow-btn-post');
  if (followBtn) {
    e.preventDefault();
    e.stopPropagation();
    const uid = followBtn.dataset.uid;
    toggleFollow(uid, followBtn);
    return;
  }

  if (!e.target.closest('.post-menu-container')) {
    document.querySelectorAll('.post-menu-dropdown').forEach(menu => {
      menu.style.display = 'none';
    });
  }
});

// ================= Коментарі =================
export async function loadComments(postId, container) {
  try {
    const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
    const snapshot = await getDocs(q);
    container.innerHTML = '';
    snapshot.forEach(docSnap => {
      const comment = docSnap.data();
      const commentEl = document.createElement('div');
      commentEl.className = 'comment';
      let commentTime = '';
      if (comment.createdAt && typeof comment.createdAt.seconds === 'number') {
        commentTime = new Date(comment.createdAt.seconds * 1000).toLocaleString('uk-UA', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      }

      const avatarEl = document.createElement('div');
      avatarEl.className = 'comment-avatar';
      avatarEl.style.backgroundImage = `url(${comment.authorAvatar || ''})`;
      avatarEl.dataset.uid = comment.author;

      const contentEl = document.createElement('div');
      contentEl.className = 'comment-content';

      const headerEl = document.createElement('div');
      const authorSpan = document.createElement('span');
      authorSpan.className = 'comment-author';
      authorSpan.dataset.uid = comment.author;
      authorSpan.textContent = comment.authorName;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'comment-time';
      timeSpan.textContent = commentTime;

      headerEl.appendChild(authorSpan);
      headerEl.appendChild(timeSpan);

      const textEl = document.createElement('div');
      textEl.className = 'comment-text';
      textEl.textContent = comment.text;

      contentEl.appendChild(headerEl);
      contentEl.appendChild(textEl);

      commentEl.appendChild(avatarEl);
      commentEl.appendChild(contentEl);

      container.appendChild(commentEl);
    });
  } catch (error) {
    console.error('Помилка завантаження коментарів:', error);
    container.innerHTML = '<p style="text-align:center;">Помилка завантаження коментарів</p>';
  }
}

export async function addComment(postId, text) {
  if (!state.currentUser || !text.trim()) return;

  try {
    const userSnap = await getDoc(doc(db, "users", state.currentUser.uid));
    if (!userSnap.exists()) {
      showToast('Користувача не знайдено');
      return;
    }
    const user = userSnap.data();
    const commentRef = collection(db, `posts/${postId}/comments`);
    await addDoc(commentRef, {
      author: state.currentUser.uid,
      authorName: user.nickname || 'Невідомо',
      authorAvatar: user.avatar || '',
      text: text.trim(),
      createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "posts", postId), {
      commentsCount: increment(1),
      popularity: increment(40)
    });
  } catch (error) {
    console.error('Помилка додавання коментаря:', error);
    throw error;
  }
}

// ================= Перегляди =================
async function incrementPostView(postId) {
  if (!state.currentUser) return;
  if (state.viewedPosts.has(postId)) return;
  state.viewedPosts.add(postId);
  try {
    await updateDoc(doc(db, "posts", postId), {
      views: increment(1),
      popularity: increment(5)
    });
  } catch (e) {
    console.warn("Не вдалося оновити перегляди:", e);
  }
}

// ================= Галерея =================
function createGallery(media) {
  const gallery = document.createElement('div');
  gallery.className = 'post-gallery';

  const inner = document.createElement('div');
  inner.className = 'gallery-inner';

  media.forEach((item) => {
    const slide = document.createElement('div');
    slide.className = 'gallery-slide';
    if (item.type === 'image') {
      const img = document.createElement('img');
      img.src = item.url;
      img.loading = 'lazy';
      img.tabIndex = 0;
      slide.appendChild(img);
    } else {
      const video = document.createElement('video');
      video.src = item.url;
      video.controls = true;
      video.className = 'post-media';
      video.tabIndex = 0;
      slide.appendChild(video);
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

    indicators.querySelectorAll('span').forEach((dot, i) => {
      dot.className = i === safeIndex ? 'active' : '';
    });
    counter.textContent = `${safeIndex + 1}/${media.length}`;
  };

  inner.addEventListener('scroll', updateGallery);
  setTimeout(updateGallery, 0);

  return gallery;
}

// ================= Хелпер завантаження хештегів =================
// ВИПРАВЛЕННЯ: loadHashtags і loadFilterHashtags мали абсолютно ідентичну логіку —
// дублювання коду винесено у спільну функцію.
async function fetchAndRenderHashtags({ listId, maxTags, itemClass, onClickTag }) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    // УВАГА: getDocs(collection(db, "posts")) завантажує ВСІ пости.
    // При великій кількості постів це дорого. Рекомендується зберігати
    // агреговані лічильники хештегів в окремому документі Firestore.
    const postsSnap = await getDocs(query(collection(db, "posts"), limit(500)));
    const tagCount = new Map();
    postsSnap.forEach(docSnap => {
      const tags = docSnap.data().hashtags || [];
      tags.forEach(tag => {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      });
    });

    const sortedTags = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxTags);

    list.innerHTML = '';
    if (sortedTags.length === 0) {
      list.innerHTML = '<p style="text-align:center; padding:20px;">Поки немає хештегів</p>';
      return;
    }

    sortedTags.forEach(([tag, count]) => {
      const div = document.createElement('div');
      div.className = itemClass;
      div.tabIndex = 0;
      div.innerHTML = `
        <span class="hashtag-name">#${escapeHtml(tag)}</span>
        <span class="hashtag-count">${count} постів</span>
      `;
      div.onclick = () => onClickTag(tag);
      list.appendChild(div);
    });
  } catch (e) {
    console.error('Error loading hashtags:', e);
    list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}

export async function loadHashtags(listId = 'hashtagList') {
  await fetchAndRenderHashtags({
    listId,
    maxTags: 20,
    itemClass: 'hashtag-item',
    onClickTag: searchHashtag
  });
}

export async function loadFilterHashtags(listId = 'filterList') {
  await fetchAndRenderHashtags({
    listId,
    maxTags: 30,
    itemClass: 'filter-item',
    onClickTag: applyFilter
  });
}

export function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    const searchBtn = document.querySelector('[data-section="search"]');
    if (searchBtn) searchBtn.click();
  }
}

// ================= Фільтри =================
export function applyFilter(tag) {
  setFilterHashtag(tag);
  const filterModal = document.getElementById('filterModal');
  if (filterModal) filterModal.classList.remove('active');

  if (state.currentFeedType === 'popular') {
    setCurrentFeedType('new');
    const feedNewBtn = document.getElementById('feedNewBtn');
    const feedPopularBtn = document.getElementById('feedPopularBtn');
    if (feedNewBtn) feedNewBtn.classList.add('active');
    if (feedPopularBtn) feedPopularBtn.classList.remove('active');
  }

  // ВИПРАВЛЕННЯ: уникаємо змішування innerHTML і appendChild.
  // Будуємо весь вміст через DOM API для надійності.
  const activeDiv = document.getElementById('activeFilter');
  if (activeDiv) {
    activeDiv.innerHTML = '';

    const tagSpan = document.createElement('span');
    tagSpan.textContent = `#${tag} `;
    activeDiv.appendChild(tagSpan);

    const clearBtn = document.createElement('button');
    clearBtn.id = 'clearFilterChip';
    clearBtn.textContent = '✕';
    clearBtn.onclick = clearFilter;
    activeDiv.appendChild(clearBtn);
  }

  resetPaginationState();
  const feed = document.getElementById('feed');
  if (feed) {
    feed.innerHTML = '';
    loadMorePosts();
  }
}

export function clearFilter() {
  setFilterHashtag(null);
  const activeDiv = document.getElementById('activeFilter');
  if (activeDiv) activeDiv.innerHTML = '';
  resetPaginationState();
  const feed = document.getElementById('feed');
  if (feed) {
    feed.innerHTML = '';
    loadMorePosts();
  }
}
