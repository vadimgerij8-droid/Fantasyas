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
import { 
  showToast, 
  vibrate, 
  uploadToCloudinary, 
  debounce, 
  setupEmojiPicker,
  createLoadingSpinner 
} from './utils.js';
import { toggleFollow } from './profile.js';

// ================= Конфігурація =================
const POSTS_PER_PAGE = 10;
const MAX_MEDIA_FILES = 3;
const POPULARITY = {
  LIKE: 50,
  COMMENT: 40,
  VIEW: 5
};

// ================= Допоміжні функції =================
export function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

function formatTimestamp(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp.seconds * 1000);
  return date.toLocaleString('uk-UA', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function highlightHashtags(text) {
  if (!text) return '';
  const hashtagRegex = /#(\w+)/g;
  return text.replace(hashtagRegex, '<span class="hashtag" data-tag="$1">#$1</span>');
}

// ================= Клас для керування постом (UI логіка) =================
class PostUI {
  constructor(post, container) {
    this.post = post;
    this.container = container;
    this.element = null;
    this.unsubscribe = null;
    this.commentsVisible = false;
  }

  create() {
    const isAuthor = state.currentUser && this.post.author === state.currentUser.uid;
    const isFollowing = state.currentUserFollowing.includes(this.post.author);
    const liked = this.post.likes?.includes(state.currentUser?.uid) || false;
    const saved = this.post.saves?.includes(state.currentUser?.uid) || false;
    const postTime = formatTimestamp(this.post.createdAt);

    this.element = document.createElement('div');
    this.element.className = 'post';
    this.element.dataset.postId = this.post.id;
    this.element.tabIndex = 0;

    // Шапка поста
    const header = this.createHeader(isAuthor, isFollowing);
    
    // Контент
    const content = this.createContent();
    
    // Галерея
    const gallery = this.createGallery();
    
    // Футер
    const footer = this.createFooter(liked, saved);
    
    // Секція коментарів
    const commentsSection = this.createCommentsSection();

    this.element.appendChild(header);
    this.element.appendChild(content);
    if (gallery) this.element.appendChild(gallery);
    this.element.appendChild(footer);
    this.element.appendChild(commentsSection);

    this.attachEventListeners();
    this.setupRealtimeUpdates();
    
    return this.element;
  }

  createHeader(isAuthor, isFollowing) {
    const header = document.createElement('div');
    header.className = 'post-header';
    
    header.innerHTML = `
      <div class="avatar" style="background-image:url(${this.post.authorAvatar || ''})" data-uid="${this.post.author}" tabindex="0"></div>
      <div class="post-author-info">
        <div>
          <span class="post-author" data-uid="${this.post.author}" tabindex="0">${this.post.authorName || 'Невідомо'}</span>
          <span class="post-meta">${this.post.authorUserId || ''}</span>
          ${!isAuthor && state.currentUser ? `
            <button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${this.post.author}" tabindex="0">
              ${isFollowing ? 'Відписатися' : 'Підписатися'}
            </button>
          ` : ''}
        </div>
        <div class="post-time">${formatTimestamp(this.post.createdAt)}</div>
      </div>
      ${isAuthor ? this.createMenu() : ''}
    `;
    
    return header;
  }

  createMenu() {
    return `
      <div class="post-menu-container">
        <button class="post-menu-btn" aria-label="Меню поста" tabindex="0">⋮</button>
        <div class="post-menu-dropdown">
          <div class="post-menu-item" data-action="edit">Редагувати</div>
          <div class="post-menu-item" data-action="delete">Видалити</div>
        </div>
      </div>
    `;
  }

  createContent() {
    const content = document.createElement('div');
    content.className = 'post-content';
    content.innerHTML = highlightHashtags(this.post.text);
    return content;
  }

  createGallery() {
    if (!this.post.media?.length && !this.post.mediaUrl) return null;
    
    if (this.post.media?.length > 0) {
      return new PostGallery(this.post.media).create();
    } else if (this.post.mediaUrl) {
      const mediaEl = document.createElement(this.post.mediaType === 'image' ? 'img' : 'video');
      mediaEl.src = this.post.mediaUrl;
      mediaEl.className = 'post-media';
      mediaEl.loading = 'lazy';
      mediaEl.tabIndex = 0;
      if (this.post.mediaType === 'video') mediaEl.controls = true;
      return mediaEl;
    }
    
    return null;
  }

  createFooter(liked, saved) {
    const footer = document.createElement('div');
    footer.className = 'post-footer';
    footer.innerHTML = `
      <button class="like-btn ${liked ? 'liked' : ''}" data-post-id="${this.post.id}" tabindex="0">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        <span>${this.post.likesCount || 0}</span>
      </button>
      <button class="comment-toggle-btn" data-post-id="${this.post.id}" tabindex="0">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        <span>${this.post.commentsCount || 0}</span>
      </button>
      <button class="save-btn ${saved ? 'saved' : ''}" data-post-id="${this.post.id}" tabindex="0">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
      </button>
      <span class="view-count" title="Перегляди">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7z"/></svg>
        ${this.post.views || 0}
      </span>
    `;
    return footer;
  }

  createCommentsSection() {
    const section = document.createElement('div');
    section.className = 'comments-section';
    section.id = `comments-${this.post.id}`;
    section.style.display = 'none';
    section.innerHTML = `
      <div class="comments-list" id="comments-list-${this.post.id}"></div>
      <div class="comment-form">
        <input type="text" id="comment-input-${this.post.id}" class="comment-input" placeholder="Напишіть коментар..." tabindex="0">
        <div class="emoji-picker-container" style="position: relative;">
          <button class="emoji-button" id="comment-emoji-${this.post.id}" tabindex="0">😊</button>
          <div class="emoji-picker" id="comment-picker-${this.post.id}"></div>
        </div>
        <button class="btn btn-primary btn-icon" id="submit-comment-${this.post.id}" tabindex="0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        </button>
      </div>
    `;
    return section;
  }

  attachEventListeners() {
    // Хештеги
    this.element.querySelectorAll('.hashtag').forEach(span => {
      span.onclick = (e) => {
        e.stopPropagation();
        searchHashtag(span.dataset.tag);
      };
    });

    // Коментарі
    const toggleBtn = this.element.querySelector('.comment-toggle-btn');
    const commentsSection = this.element.querySelector('.comments-section');
    
    toggleBtn.onclick = async () => {
      commentsSection.style.display = commentsSection.style.display === 'none' ? 'block' : 'none';
      if (commentsSection.style.display === 'block') {
        const commentsList = document.getElementById(`comments-list-${this.post.id}`);
        if (commentsList && !commentsList.hasChildNodes()) {
          await loadComments(this.post.id, commentsList);
        }
      }
    };

    // Відправка коментаря
    const submitBtn = document.getElementById(`submit-comment-${this.post.id}`);
    const commentInput = document.getElementById(`comment-input-${this.post.id}`);
    
    if (submitBtn && commentInput) {
      submitBtn.onclick = async () => {
        const text = commentInput.value.trim();
        if (!text) return;
        
        submitBtn.disabled = true;
        submitBtn.innerHTML = createLoadingSpinner('small');
        
        try {
          await addComment(this.post.id, text);
          commentInput.value = '';
          const commentsList = document.getElementById(`comments-list-${this.post.id}`);
          if (commentsList) await loadComments(this.post.id, commentsList);
          
          const countSpan = toggleBtn.querySelector('span');
          if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;
          
          showToast('Коментар додано');
        } catch (error) {
          console.error('Error adding comment:', error);
          showToast('Помилка: ' + error.message);
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
        }
      };
    }

    // Emoji picker
    setupEmojiPicker(`comment-emoji-${this.post.id}`, `comment-picker-${this.post.id}`, `comment-input-${this.post.id}`);
  }

  setupRealtimeUpdates() {
    const postRef = doc(db, "posts", this.post.id);
    
    this.unsubscribe = onSnapshot(postRef, (snap) => {
      if (!snap.exists()) {
        this.element?.remove();
        this.cleanup();
        return;
      }

      const data = snap.data();
      this.updateUI(data);
    }, (error) => {
      console.error(`Error listening to post ${this.post.id}:`, error);
    });

    state.postListeners.set(this.post.id, this.unsubscribe);
  }

  updateUI(data) {
    if (!this.element) return;

    // Оновлення лайків
    const likeBtn = this.element.querySelector('.like-btn');
    if (likeBtn) {
      const liked = data.likes?.includes(state.currentUser?.uid) || false;
      const countSpan = likeBtn.querySelector('span');
      likeBtn.classList.toggle('liked', liked);
      if (countSpan) countSpan.textContent = data.likesCount || 0;
    }

    // Оновлення збережень
    const saveBtn = this.element.querySelector('.save-btn');
    if (saveBtn) {
      const saved = data.saves?.includes(state.currentUser?.uid) || false;
      saveBtn.classList.toggle('saved', saved);
    }

    // Оновлення тексту (якщо змінився)
    const contentEl = this.element.querySelector('.post-content');
    if (contentEl && data.text !== this.post.text) {
      contentEl.innerHTML = highlightHashtags(data.text);
      this.post.text = data.text;
    }
  }

  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
      state.postListeners.delete(this.post.id);
    }
  }
}

// ================= Клас для галереї =================
class PostGallery {
  constructor(media) {
    this.media = media;
    this.currentIndex = 0;
  }

  create() {
    const gallery = document.createElement('div');
    gallery.className = 'post-gallery';

    const inner = document.createElement('div');
    inner.className = 'gallery-inner';

    this.media.forEach((item, index) => {
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

    // Індикатори
    const indicators = document.createElement('div');
    indicators.className = 'gallery-indicators';
    this.media.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = i === 0 ? 'active' : '';
      indicators.appendChild(dot);
    });
    gallery.appendChild(indicators);

    // Лічильник
    const counter = document.createElement('div');
    counter.className = 'gallery-counter';
    counter.textContent = `1/${this.media.length}`;
    gallery.appendChild(counter);

    // Оновлення при скролі
    const updateGallery = () => {
      const scrollLeft = inner.scrollLeft;
      const slideWidth = inner.clientWidth;
      const index = Math.round(scrollLeft / slideWidth);
      const safeIndex = Math.min(Math.max(index, 0), this.media.length - 1);
      
      indicators.querySelectorAll('span').forEach((dot, i) => {
        dot.className = i === safeIndex ? 'active' : '';
      });
      counter.textContent = `${safeIndex + 1}/${this.media.length}`;
    };

    inner.addEventListener('scroll', updateGallery);
    setTimeout(updateGallery, 0);

    return gallery;
  }
}

// ================= Клас для модального вікна редагування =================
class EditPostModal {
  constructor(currentText, onSave) {
    this.currentText = currentText;
    this.onSave = onSave;
    this.modal = null;
    this.textarea = null;
    this.charCounter = null;
  }

  show() {
    // Видаляємо попереднє модальне вікно
    const existingModal = document.getElementById('editPostModal');
    if (existingModal) existingModal.remove();

    this.createModal();
    document.body.appendChild(this.modal);
    this.attachEventListeners();
    
    // Фокус на textarea
    setTimeout(() => {
      this.textarea.focus();
      this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
    }, 100);
  }

  createModal() {
    this.modal = document.createElement('div');
    this.modal.id = 'editPostModal';
    this.modal.className = 'modal-overlay';
    
    this.modal.innerHTML = `
      <div class="modal-content edit-modal">
        <div class="modal-header">
          <h3>Редагувати пост</h3>
          <button class="modal-close-btn" aria-label="Закрити">✕</button>
        </div>
        <div class="modal-body">
          <div class="textarea-container">
            <textarea id="editPostTextarea" maxlength="5000" placeholder="Що нового?">${this.currentText}</textarea>
            <div class="textarea-footer">
              <div class="char-counter">
                <span id="editCharCount">${this.currentText.length}</span>/5000
              </div>
              <div class="emoji-picker-container">
                <button class="emoji-button" id="editEmojiBtn">😊</button>
                <div class="emoji-picker" id="editEmojiPicker"></div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancelEditBtn">Скасувати</button>
          <button class="btn btn-primary" id="saveEditBtn">Зберегти</button>
        </div>
      </div>
    `;

    this.textarea = this.modal.querySelector('#editPostTextarea');
    this.charCounter = this.modal.querySelector('#editCharCount');
  }

  attachEventListeners() {
    // Закриття
    const closeBtn = this.modal.querySelector('.modal-close-btn');
    const cancelBtn = this.modal.querySelector('#cancelEditBtn');
    const closeModal = () => this.modal.remove();

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;

    // Клік на оверлей
    this.modal.onclick = (e) => {
      if (e.target === this.modal) closeModal();
    };

    // Лічильник символів
    this.textarea.oninput = () => {
      this.charCounter.textContent = this.textarea.value.length;
    };

    // Emoji picker
    setupEmojiPicker('editEmojiBtn', 'editEmojiPicker', 'editPostTextarea');

    // Збереження
    const saveBtn = this.modal.querySelector('#saveEditBtn');
    saveBtn.onclick = async () => {
      const newText = this.textarea.value.trim();
      
      if (!newText) {
        showToast('Текст поста не може бути порожнім');
        return;
      }

      if (newText === this.currentText) {
        this.modal.remove();
        return;
      }

      saveBtn.disabled = true;
      saveBtn.innerHTML = createLoadingSpinner('small');

      try {
        await this.onSave(newText);
        this.modal.remove();
      } catch (error) {
        console.error('Error saving post:', error);
        showToast('Помилка при збереженні');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Зберегти';
      }
    };
  }
}

// ================= Менеджер меню постів =================
class PostMenuManager {
  constructor() {
    this.init();
  }

  init() {
    document.addEventListener('click', this.handleClick.bind(this));
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  handleClick(e) {
    const menuBtn = e.target.closest('.post-menu-btn');
    if (menuBtn) {
      e.preventDefault();
      e.stopPropagation();
      this.toggleMenu(menuBtn);
      return;
    }

    const menuItem = e.target.closest('.post-menu-item');
    if (menuItem) {
      e.preventDefault();
      e.stopPropagation();
      this.handleMenuItemClick(menuItem);
      return;
    }

    // Закриття при кліку поза меню
    if (!e.target.closest('.post-menu-container')) {
      this.closeAllMenus();
    }
  }

  handleKeyDown(e) {
    if (e.key === 'Escape') {
      this.closeAllMenus();
    }
  }

  toggleMenu(menuBtn) {
    const menuContainer = menuBtn.closest('.post-menu-container');
    const dropdown = menuContainer.querySelector('.post-menu-dropdown');
    
    if (!dropdown) return;

    const isOpen = dropdown.classList.contains('active');
    this.closeAllMenus();

    if (!isOpen) {
      dropdown.classList.add('active');
      
      // Анімація
      dropdown.style.animation = 'menuFadeIn 0.2s ease';
      
      // Позиціонування
      const rect = menuBtn.getBoundingClientRect();
      dropdown.style.top = `${rect.bottom + window.scrollY + 5}px`;
      dropdown.style.left = `${rect.right - dropdown.offsetWidth}px`;
    }
  }

  handleMenuItemClick(menuItem) {
    const menuContainer = menuItem.closest('.post-menu-container');
    const postEl = menuContainer.closest('.post');
    const postId = postEl.dataset.postId;
    const action = menuItem.dataset.action;

    if (action === 'edit') {
      editPost(postId);
    } else if (action === 'delete') {
      deletePost(postId);
    }

    this.closeAllMenus();
  }

  closeAllMenus() {
    document.querySelectorAll('.post-menu-dropdown').forEach(menu => {
      menu.classList.remove('active');
    });
  }
}

// ================= Основний код роботи з постами =================

// Ініціалізація менеджера меню
new PostMenuManager();

// ================= Лайк (з debounce та loading state) =================
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

  // Додаємо loading стан
  buttonElement.classList.add('loading');

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
    const isLiked = postData.likes?.includes(state.currentUser.uid) || false;

    if (isLiked === wasLiked) {
      const batch = writeBatch(db);
      
      if (isLiked) {
        batch.update(postRef, {
          likes: arrayRemove(state.currentUser.uid),
          likesCount: increment(-1),
          popularity: increment(-POPULARITY.LIKE)
        });
        batch.update(doc(db, "users", state.currentUser.uid), {
          likedPosts: arrayRemove(postId)
        });
      } else {
        batch.update(postRef, {
          likes: arrayUnion(state.currentUser.uid),
          likesCount: increment(1),
          popularity: increment(POPULARITY.LIKE)
        });
        batch.update(doc(db, "users", state.currentUser.uid), {
          likedPosts: arrayUnion(postId)
        });
        vibrate(30);
      }
      
      await batch.commit();
    } else {
      // Стан не співпав – повертаємо як було в базі
      buttonElement.classList.toggle('liked', isLiked);
      if (countSpan) countSpan.textContent = postData.likesCount || 0;
    }
  } catch (error) {
    console.error('Помилка toggleLike:', error);
    showToast('Не вдалося оновити лайк. Спробуйте ще.');
    buttonElement.classList.toggle('liked', wasLiked);
    if (countSpan) countSpan.textContent = oldCount;
  } finally {
    buttonElement.classList.remove('loading');
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
  buttonElement.classList.add('loading');

  try {
    state.savePromiseMap.set(postId, true);

    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      buttonElement.classList.toggle('saved', wasSaved);
      return;
    }

    const isSaved = postSnap.data().saves?.includes(state.currentUser.uid) || false;
    
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
    buttonElement.classList.remove('loading');
    state.savePromiseMap.delete(postId);
  }
}, 300);

// ================= Створення поста =================
export async function createPost(text, files) {
  if (!state.currentUser) {
    showToast('Увійдіть, щоб опублікувати пост');
    return false;
  }

  if (files.length > MAX_MEDIA_FILES) {
    showToast(`Можна вибрати не більше ${MAX_MEDIA_FILES} файлів`);
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
  
  // Відкриваємо модальне вікно
  const modal = new EditPostModal(post.text || '', async (newText) => {
    const hashtags = extractHashtags(newText);
    await updateDoc(postRef, {
      text: newText,
      hashtags,
      edited: true,
      updatedAt: serverTimestamp()
    });
    showToast('Пост оновлено');
  });
  
  modal.show();
}

// ================= Видалення поста =================
export async function deletePost(postId) {
  if (!state.currentUser) return;
  
  if (!confirm('Видалити цей пост назавжди?')) return;

  const deleteBtn = document.querySelector(`.post[data-post-id="${postId}"] .post-menu-item[data-action="delete"]`);
  if (deleteBtn) deleteBtn.classList.add('loading');

  try {
    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    
    if (!postSnap.exists()) {
      showToast('Пост не знайдено');
      return;
    }

    // Видаляємо коментарі
    const commentsSnapshot = await getDocs(collection(db, `posts/${postId}/comments`));
    const batch = writeBatch(db);
    
    commentsSnapshot.forEach(doc => batch.delete(doc.ref));
    batch.delete(postRef);
    batch.update(doc(db, "users", state.currentUser.uid), {
      posts: arrayRemove(postId)
    });

    await batch.commit();

    // Видаляємо елемент з DOM
    const postElement = document.querySelector(`.post[data-post-id="${postId}"]`);
    if (postElement) {
      postElement.style.animation = 'fadeOut 0.3s ease';
      setTimeout(() => postElement.remove(), 300);
    }

    showToast('Пост видалено');
  } catch (error) {
    console.error('Помилка видалення поста:', error);
    showToast('Не вдалося видалити пост');
  } finally {
    if (deleteBtn) deleteBtn.classList.remove('loading');
  }
}

// ================= Завантаження постів =================
export async function loadMorePosts(containerId = 'feed') {
  if (!state.currentUser || state.loading || !state.hasMore) return;
  
  state.loading = true;
  const skeleton = document.getElementById('skeletonContainer');
  if (skeleton) skeleton.style.display = 'block';

  try {
    let baseQuery;
    if (state.currentFilterHashtag) {
      baseQuery = query(
        collection(db, "posts"), 
        where("hashtags", "array-contains", state.currentFilterHashtag)
      );
    } else {
      baseQuery = collection(db, "posts");
    }

    let q;
    if (state.currentFeedType === 'new' || state.currentFilterHashtag) {
      q = query(baseQuery, orderBy("createdAt", "desc"), limit(POSTS_PER_PAGE));
    } else {
      q = query(
        baseQuery, 
        orderBy("likesCount", "desc"), 
        orderBy("createdAt", "desc"), 
        limit(POSTS_PER_PAGE)
      );
    }

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
    handleLoadError(e);
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    state.loading = false;
  }
}

function handleLoadError(error) {
  console.error("Помилка завантаження постів:", error);
  
  if (error.code === 'failed-precondition' || error.message.includes('index')) {
    const match = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
    if (match) {
      console.log('Посилання для створення індексу:', match[0]);
      showToast(`⚠️ Потрібен індекс. Скопіюйте посилання з консолі.`);
    } else {
      showToast('⚠️ Потрібно створити складений індекс у Firestore');
    }
  } else if (error.code === 'permission-denied') {
    showToast('❌ Недостатньо прав. Перевірте правила безпеки Firestore.');
  } else {
    showToast('Помилка завантаження: ' + error.message);
  }
}

// ================= Рендеринг постів =================
export function renderPosts(docs, containerId = 'feed') {
  const feed = document.getElementById(containerId);
  if (!feed) {
    console.error('renderPosts: контейнер не знайдено', containerId);
    return;
  }

  const fragment = document.createDocumentFragment();

  docs.forEach(docSnap => {
    const post = { id: docSnap.id, ...docSnap.data() };
    const postUI = new PostUI(post, feed);
    fragment.appendChild(postUI.create());
    
    // Лічильник переглядів
    incrementPostView(post.id);
  });

  feed.appendChild(fragment);
}

// ================= Коментарі =================
export async function loadComments(postId, container) {
  if (!container) return;
  
  container.innerHTML = createLoadingSpinner();
  
  try {
    const q = query(
      collection(db, `posts/${postId}/comments`), 
      orderBy("createdAt", "asc")
    );
    const snapshot = await getDocs(q);
    
    container.innerHTML = '';
    
    if (snapshot.empty) {
      container.innerHTML = '<p class="no-comments">Немає коментарів</p>';
      return;
    }
    
    snapshot.forEach(doc => {
      const comment = doc.data();
      const commentEl = document.createElement('div');
      commentEl.className = 'comment';
      
      const commentTime = formatTimestamp(comment.createdAt);
      
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
  } catch (error) {
    console.error('Error loading comments:', error);
    container.innerHTML = '<p class="error">Помилка завантаження коментарів</p>';
  }
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
    popularity: increment(POPULARITY.COMMENT)
  });
}

// ================= Перегляди =================
async function incrementPostView(postId) {
  if (!state.currentUser || state.viewedPosts.has(postId)) return;
  
  state.viewedPosts.add(postId);
  
  try {
    await updateDoc(doc(db, "posts", postId), { 
      views: increment(1),
      popularity: increment(POPULARITY.VIEW)
    });
  } catch (e) {
    console.warn("Не вдалося оновити перегляди:", e);
  }
}

// ================= Хештеги =================
export async function loadHashtags(listId = 'hashtagList') {
  const list = document.getElementById(listId);
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

    const sortedTags = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

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

// ================= Фільтри =================
export async function loadFilterHashtags(listId = 'filterList') {
  const list = document.getElementById(listId);
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

    const sortedTags = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 30);

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
  if (activeDiv) {
    activeDiv.innerHTML = `#${tag} <button id="clearFilterChip">✕</button>`;
    document.getElementById('clearFilterChip').onclick = clearFilter;
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

// Додаємо CSS анімації
const style = document.createElement('style');
style.textContent = `
  @keyframes menuFadeIn {
    from { opacity: 0; transform: translateY(-10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  @keyframes fadeOut {
    from { opacity: 1; }
    to { opacity: 0; }
  }
  
  .post-menu-dropdown {
    position: absolute;
    background: var(--bg-color, #fff);
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    padding: 8px 0;
    min-width: 180px;
    z-index: 1000;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
  }
  
  .post-menu-dropdown.active {
    opacity: 1;
    visibility: visible;
  }
  
  .post-menu-item {
    padding: 12px 16px;
    cursor: pointer;
    transition: background 0.2s ease;
  }
  
  .post-menu-item:hover {
    background: var(--hover-color, #f5f5f5);
  }
  
  .post-menu-item.loading {
    opacity: 0.6;
    pointer-events: none;
  }
  
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }
  
  .edit-modal {
    width: 90%;
    max-width: 600px;
    background: var(--bg-color, #fff);
    border-radius: 16px;
    overflow: hidden;
    animation: modalSlideIn 0.3s ease;
  }
  
  @keyframes modalSlideIn {
    from { transform: translateY(30px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }
  
  .modal-header {
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color, #eee);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  
  .modal-header h3 {
    margin: 0;
    font-size: 18px;
  }
  
  .modal-close-btn {
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 8px;
    transition: background 0.2s ease;
  }
  
  .modal-close-btn:hover {
    background: var(--hover-color, #f5f5f5);
  }
  
  .modal-body {
    padding: 20px;
  }
  
  .textarea-container {
    width: 100%;
  }
  
  .textarea-container textarea {
    width: 100%;
    min-height: 150px;
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
  }
  
  .textarea-container textarea:focus {
    border-color: var(--primary-color, #007bff);
  }
  
  .textarea-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 8px;
  }
  
  .char-counter {
    font-size: 12px;
    color: var(--secondary-text, #666);
  }
  
  .modal-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--border-color, #eee);
    display: flex;
    justify-content: flex-end;
    gap: 12px;
  }
  
  .btn {
    padding: 10px 16px;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  
  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .btn-primary {
    background: var(--primary-color, #007bff);
    color: white;
  }
  
  .btn-primary:hover:not(:disabled) {
    background: var(--primary-dark, #0056b3);
  }
  
  .btn-secondary {
    background: var(--btn-secondary-bg, #e0e0e0);
    color: var(--text-color, #333);
  }
  
  .btn-secondary:hover:not(:disabled) {
    background: var(--btn-secondary-dark, #d0d0d0);
  }
  
  .like-btn.loading,
  .save-btn.loading {
    opacity: 0.6;
    pointer-events: none;
  }
  
  .no-comments {
    text-align: center;
    padding: 20px;
    color: var(--secondary-text, #666);
  }
`;

document.head.appendChild(style);
