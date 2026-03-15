import { db } from './config.js';
import { 
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy, limit, startAfter, 
  getDocs, serverTimestamp, arrayUnion, arrayRemove, increment, writeBatch, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { 
  state,
  setFilterHashtag, 
  resetPaginationState, 
  setCurrentFeedType
} from './state.js';
import { showToast, vibrate, uploadToCloudinary, debounce } from './utils.js';
import { toggleFollow } from './profile.js';

// ================= Константи =================
const CONSTANTS = {
  MAX_FILES: 3,
  POSTS_PER_PAGE: 10,
  MAX_POST_LENGTH: 2000,
  DEBOUNCE_DELAY: 300,
  POPULARITY: {
    LIKE: 50,
    COMMENT: 40,
    VIEW: 5
  }
};

// ================= Клас для управління постами =================
class PostManager {
  constructor() {
    this.listeners = new Map();
    this.pendingOperations = new Map();
    this.observer = null;
    this.initIntersectionObserver();
  }

  // Спостерігач для лінивого завантаження та переглядів
  initIntersectionObserver() {
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const postId = entry.target.dataset.postId;
          if (postId) this.trackView(postId);
        }
      });
    }, { threshold: 0.5 });
  }

  // ================= Хештеги =================
  static extractHashtags(text) {
    if (!text) return [];
    const matches = text.match(/#(\w+)/g);
    return matches ? [...new Set(matches.map(tag => tag.toLowerCase()))] : [];
  }

  static formatHashtags(text) {
    if (!text) return '';
    return text.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>');
  }

  // ================= Безпека та валідація =================
  static async verifyOwnership(postId) {
    if (!state.currentUser) throw new Error('Unauthorized');
    
    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    
    if (!postSnap.exists()) throw new Error('Post not found');
    if (postSnap.data().author !== state.currentUser.uid) {
      throw new Error('Permission denied');
    }
    
    return { ref: postRef, data: postSnap.data() };
  }

  static checkAuth() {
    if (!state.currentUser) {
      showToast('Увійдіть, щоб виконати цю дію');
      return false;
    }
    return true;
  }

  // ================= Оптимізовані операції з лайками =================
  toggleLike = debounce(async (postId, buttonElement) => {
    if (!PostManager.checkAuth()) return;
    if (this.pendingOperations.has(`like-${postId}`)) return;

    const wasLiked = buttonElement.classList.contains('liked');
    const countSpan = buttonElement.querySelector('.like-count');
    const oldCount = parseInt(countSpan?.textContent || 0);

    // Оптимістичне оновлення UI
    this.updateLikeUI(buttonElement, !wasLiked, wasLiked ? oldCount - 1 : oldCount + 1);

    try {
      this.pendingOperations.set(`like-${postId}`, true);
      
      const batch = writeBatch(db);
      const postRef = doc(db, "posts", postId);
      const userRef = doc(db, "users", state.currentUser.uid);

      if (wasLiked) {
        batch.update(postRef, {
          likes: arrayRemove(state.currentUser.uid),
          likesCount: increment(-1),
          popularity: increment(-CONSTANTS.POPULARITY.LIKE)
        });
        batch.update(userRef, { likedPosts: arrayRemove(postId) });
      } else {
        batch.update(postRef, {
          likes: arrayUnion(state.currentUser.uid),
          likesCount: increment(1),
          popularity: increment(CONSTANTS.POPULARITY.LIKE)
        });
        batch.update(userRef, { likedPosts: arrayUnion(postId) });
        vibrate(30);
      }

      await batch.commit();
    } catch (error) {
      console.error('Like error:', error);
      this.updateLikeUI(buttonElement, wasLiked, oldCount);
      showToast('Не вдалося оновити лайк');
    } finally {
      this.pendingOperations.delete(`like-${postId}`);
    }
  }, CONSTANTS.DEBOUNCE_DELAY);

  updateLikeUI(button, isLiked, count) {
    button.classList.toggle('liked', isLiked);
    const countSpan = button.querySelector('.like-count');
    if (countSpan) countSpan.textContent = Math.max(0, count);
  }

  // ================= Операції збереження =================
  toggleSave = debounce(async (postId, buttonElement) => {
    if (!PostManager.checkAuth()) return;
    if (this.pendingOperations.has(`save-${postId}`)) return;

    const wasSaved = buttonElement.classList.contains('saved');
    buttonElement.classList.toggle('saved', !wasSaved);

    try {
      this.pendingOperations.set(`save-${postId}`, true);
      
      const batch = writeBatch(db);
      const postRef = doc(db, "posts", postId);
      const userRef = doc(db, "users", state.currentUser.uid);

      if (wasSaved) {
        batch.update(userRef, { savedPosts: arrayRemove(postId) });
        batch.update(postRef, { saves: arrayRemove(state.currentUser.uid) });
      } else {
        batch.update(userRef, { savedPosts: arrayUnion(postId) });
        batch.update(postRef, { saves: arrayUnion(state.currentUser.uid) });
      }

      await batch.commit();
    } catch (error) {
      console.error('Save error:', error);
      buttonElement.classList.toggle('saved', wasSaved);
      showToast('Не вдалося зберегти пост');
    } finally {
      this.pendingOperations.delete(`save-${postId}`);
    }
  }, CONSTANTS.DEBOUNCE_DELAY);

  // ================= Створення поста =================
  async createPost(text, files) {
    if (!PostManager.checkAuth()) return false;

    if (files.length > CONSTANTS.MAX_FILES) {
      showToast(`Можна вибрати не більше ${CONSTANTS.MAX_FILES} файлів`);
      return false;
    }

    const submitBtn = document.getElementById('submitPost');
    const originalText = submitBtn?.textContent;
    
    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner"></span> Публікація...';
      }

      // Паралельне завантаження медіа
      const media = await Promise.all(
        files.map(file => uploadToCloudinary(file).then(url => ({
          url,
          type: file.type.split('/')[0]
        })))
      );

      const [userSnap] = await Promise.all([
        getDoc(doc(db, "users", state.currentUser.uid))
      ]);

      const userData = userSnap.data();
      const hashtags = PostManager.extractHashtags(text);

      const postData = {
        author: state.currentUser.uid,
        authorType: 'user',
        authorName: userData.nickname,
        authorUserId: userData.userId,
        authorAvatar: userData.avatar || '',
        text: text.trim(),
        media,
        createdAt: serverTimestamp(),
        likes: [],
        likesCount: 0,
        commentsCount: 0,
        saves: [],
        views: 0,
        hashtags,
        popularity: 0
      };

      const postDoc = await addDoc(collection(db, "posts"), postData);
      
      await updateDoc(doc(db, "users", state.currentUser.uid), {
        posts: arrayUnion(postDoc.id)
      });

      this.resetCreateForm();
      showToast('Пост опубліковано!');
      return true;
    } catch (error) {
      console.error('Create post error:', error);
      showToast('Помилка: ' + error.message);
      return false;
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText || 'Опублікувати';
      }
    }
  }

  resetCreateForm() {
    const elements = {
      text: document.getElementById('postText'),
      media: document.getElementById('postMedia'),
      previews: document.getElementById('postMediaPreviews'),
      label: document.getElementById('postMediaLabel')
    };

    if (elements.text) elements.text.value = '';
    if (elements.media) elements.media.value = '';
    if (elements.previews) elements.previews.innerHTML = '';
    if (elements.label) elements.label.textContent = '+ Медіа (до 3 файлів)';
  }

  // ================= Редагування з покращеним UI =================
  async editPost(postId) {
    if (!PostManager.checkAuth()) return;

    try {
      const { ref: postRef, data: post } = await PostManager.verifyOwnership(postId);
      
      const modal = new EditPostModal(post.text || '', async (newText) => {
        try {
          const hashtags = PostManager.extractHashtags(newText);
          
          await updateDoc(postRef, {
            text: newText.trim(),
            hashtags,
            edited: true,
            updatedAt: serverTimestamp()
          });

          this.updatePostInDOM(postId, newText.trim(), hashtags);
          showToast('Пост оновлено');
        } catch (error) {
          console.error('Update error:', error);
          showToast('Не вдалося оновити пост');
        }
      });

      modal.show();
    } catch (error) {
      showToast(error.message);
    }
  }

  updatePostInDOM(postId, newText, hashtags) {
    const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
    if (!postEl) return;

    const contentContainer = postEl.querySelector('.post-content');
    if (contentContainer) {
      contentContainer.innerHTML = PostManager.formatHashtags(newText);
      this.attachHashtagListeners(contentContainer);
    }

    // Додаємо мітку "редаговано"
    const metaContainer = postEl.querySelector('.post-meta');
    if (metaContainer && !metaContainer.querySelector('.edited-badge')) {
      const editedBadge = document.createElement('span');
      editedBadge.className = 'edited-badge';
      editedBadge.textContent = ' (ред.)';
      metaContainer.appendChild(editedBadge);
    }
  }

  // ================= Видалення з batch операціями =================
  async deletePost(postId) {
    if (!PostManager.checkAuth()) return;
    if (!confirm('Видалити цей пост назавжди?')) return;

    try {
      await PostManager.verifyOwnership(postId);

      const batch = writeBatch(db);
      
      // Видаляємо коментарі
      const commentsSnap = await getDocs(collection(db, `posts/${postId}/comments`));
      commentsSnap.forEach(doc => batch.delete(doc.ref));

      // Видаляємо пост
      batch.delete(doc(db, "posts", postId));
      
      // Оновлюємо користувача
      batch.update(doc(db, "users", state.currentUser.uid), {
        posts: arrayRemove(postId)
      });

      await batch.commit();

      // Анімоване видалення з DOM
      const postEl = document.querySelector(`.post[data-post-id="${postId}"]`);
      if (postEl) {
        postEl.style.transition = 'all 0.3s ease';
        postEl.style.opacity = '0';
        postEl.style.transform = 'scale(0.9)';
        setTimeout(() => postEl.remove(), 300);
      }

      this.cleanupListener(postId);
      showToast('Пост видалено');
    } catch (error) {
      console.error('Delete error:', error);
      showToast(error.message);
    }
  }

  // ================= Завантаження постів з оптимізацією =================
  async loadMorePosts(containerId = 'feed') {
    if (!state.currentUser || state.loading || !state.hasMore) return;

    state.loading = true;
    const skeleton = document.getElementById('skeletonContainer');
    if (skeleton) skeleton.style.display = 'block';

    try {
      let baseQuery = state.currentFilterHashtag 
        ? query(collection(db, "posts"), where("hashtags", "array-contains", state.currentFilterHashtag))
        : collection(db, "posts");

      let q;
      if (state.currentFeedType === 'new' || state.currentFilterHashtag) {
        q = query(baseQuery, orderBy("createdAt", "desc"), limit(CONSTANTS.POSTS_PER_PAGE));
      } else {
        q = query(baseQuery, orderBy("likesCount", "desc"), orderBy("createdAt", "desc"), limit(CONSTANTS.POSTS_PER_PAGE));
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
      this.renderPosts(snapshot.docs, containerId);
    } catch (error) {
      this.handleLoadError(error);
    } finally {
      if (skeleton) skeleton.style.display = 'none';
      state.loading = false;
    }
  }

  handleLoadError(error) {
    console.error("Load posts error:", error);
    
    if (error.code === 'failed-precondition') {
      const match = error.message.match(/https:\/\/console\.firebase\.google\.com[^\s]*/);
      showToast(match ? `⚠️ Потрібен індекс: ${match[0]}` : '⚠️ Потрібно створити індекс у Firestore');
    } else if (error.code === 'permission-denied') {
      showToast('❌ Недостатньо прав доступу');
    } else {
      showToast('Помилка завантаження: ' + error.message);
    }
  }

  // ================= Рендеринг з DocumentFragment =================
  renderPosts(docs, containerId = 'feed') {
    const feed = document.getElementById(containerId);
    if (!feed) return;

    const fragment = document.createDocumentFragment();

    docs.forEach(docSnap => {
      const post = { id: docSnap.id, ...docSnap.data() };
      const postEl = this.createPostElement(post);
      fragment.appendChild(postEl);
      
      // Спостереження за переглядами
      this.observer.observe(postEl);
      
      // Реактивне оновлення
      this.setupRealtimeUpdates(post.id, postEl);
    });

    feed.appendChild(fragment);
  }

  createPostElement(post) {
    const isAuthor = state.currentUser?.uid === post.author;
    const isLiked = post.likes?.includes(state.currentUser?.uid) || false;
    const isSaved = post.saves?.includes(state.currentUser?.uid) || false;
    const isFollowing = state.currentUserFollowing?.includes(post.author) || false;

    const postEl = document.createElement('article');
    postEl.className = 'post';
    postEl.dataset.postId = post.id;
    postEl.tabIndex = 0;

    const timeString = this.formatTime(post.createdAt);

    postEl.innerHTML = `
      <header class="post-header">
        <div class="post-author-section">
          <div class="avatar" style="background-image:url(${post.authorAvatar || '/default-avatar.png'})" 
               data-uid="${post.author}" role="button" tabindex="0" aria-label="Профіль ${post.authorName}"></div>
          <div class="post-author-info">
            <div class="author-row">
              <span class="post-author" data-uid="${post.author}" role="button">${post.authorName || 'Невідомо'}</span>
              <span class="post-userid">${post.authorUserId || ''}</span>
              ${!isAuthor && state.currentUser ? `
                <button class="follow-btn-post ${isFollowing ? 'following' : ''}" 
                        data-uid="${post.author}" aria-label="${isFollowing ? 'Відписатися' : 'Підписатися'}">
                  ${isFollowing ? 'Відписатися' : 'Підписатися'}
                </button>
              ` : ''}
            </div>
            <time class="post-time" datetime="${post.createdAt?.toDate?.().toISOString() || ''}">${timeString}</time>
          </div>
        </div>
        ${isAuthor ? this.createPostMenu() : ''}
      </header>
      
      <div class="post-content">${PostManager.formatHashtags(post.text)}</div>
      
      ${post.media?.length ? this.createGalleryHTML(post.media) : ''}
      
      <footer class="post-footer">
        <div class="post-actions">
          <button class="action-btn like-btn ${isLiked ? 'liked' : ''}" 
                  data-post-id="${post.id}" aria-label="Подобається" aria-pressed="${isLiked}">
            <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
            <span class="like-count">${post.likesCount || 0}</span>
          </button>
          
          <button class="action-btn comment-btn" data-post-id="${post.id}" aria-label="Коментарі">
            <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="comment-count">${post.commentsCount || 0}</span>
          </button>
          
          <button class="action-btn save-btn ${isSaved ? 'saved' : ''}" 
                  data-post-id="${post.id}" aria-label="Зберегти" aria-pressed="${isSaved}">
            <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
          </button>
        </div>
        
        <div class="post-stats">
          <span class="view-count" title="Перегляди">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="2"/>
              <path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7z"/>
            </svg>
            ${post.views || 0}
          </span>
        </div>
      </footer>
      
      <section class="comments-section" id="comments-${post.id}" hidden>
        <div class="comments-list" id="comments-list-${post.id}"></div>
        <form class="comment-form" onsubmit="return false;">
          <input type="text" id="comment-input-${post.id}" class="comment-input" 
                 placeholder="Напишіть коментар..." maxlength="500" aria-label="Коментар">
          <button type="button" class="emoji-btn" data-input="comment-input-${post.id}" aria-label="Емодзі">😊</button>
          <button type="submit" class="submit-comment-btn" data-post-id="${post.id}" aria-label="Надіслати">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </form>
      </section>
    `;

    this.attachPostListeners(postEl, post.id);
    return postEl;
  }

  createPostMenu() {
    return `
      <div class="post-menu">
        <button class="post-menu-trigger" aria-label="Меню поста" aria-haspopup="true" aria-expanded="false">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
          </svg>
        </button>
        <div class="post-menu-dropdown" role="menu" hidden>
          <button class="menu-item" data-action="edit" role="menuitem">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            Редагувати
          </button>
          <button class="menu-item menu-item-danger" data-action="delete" role="menuitem">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Видалити
          </button>
        </div>
      </div>
    `;
  }

  createGalleryHTML(media) {
    if (media.length === 1) {
      const item = media[0];
      return item.type === 'image' 
        ? `<div class="post-media"><img src="${item.url}" alt="Зображення поста" loading="lazy"></div>`
        : `<div class="post-media"><video src="${item.url}" controls preload="metadata"></video></div>`;
    }

    return `
      <div class="post-gallery" data-slide="0">
        <div class="gallery-track">
          ${media.map((item, i) => `
            <div class="gallery-slide ${i === 0 ? 'active' : ''}">
              ${item.type === 'image' 
                ? `<img src="${item.url}" alt="Зображення ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">`
                : `<video src="${item.url}" controls preload="metadata"></video>`
              }
            </div>
          `).join('')}
        </div>
        ${media.length > 1 ? `
          <div class="gallery-nav">
            <button class="gallery-prev" aria-label="Попереднє">‹</button>
            <div class="gallery-dots">
              ${media.map((_, i) => `<button class="dot ${i === 0 ? 'active' : ''}" data-index="${i}" aria-label="Слайд ${i + 1}"></button>`).join('')}
            </div>
            <button class="gallery-next" aria-label="Наступне">›</button>
          </div>
          <div class="gallery-counter">1/${media.length}</div>
        ` : ''}
      </div>
    `;
  }

  attachPostListeners(postEl, postId) {
    // Лайк
    const likeBtn = postEl.querySelector('.like-btn');
    if (likeBtn) {
      likeBtn.addEventListener('click', () => this.toggleLike(postId, likeBtn));
    }

    // Збереження
    const saveBtn = postEl.querySelector('.save-btn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => this.toggleSave(postId, saveBtn));
    }

    // Коментарі
    const commentBtn = postEl.querySelector('.comment-btn');
    const commentsSection = postEl.querySelector('.comments-section');
    if (commentBtn && commentsSection) {
      commentBtn.addEventListener('click', () => {
        const isHidden = commentsSection.hidden;
        commentsSection.hidden = !isHidden;
        if (isHidden) this.loadComments(postId, postEl.querySelector('.comments-list'));
      });
    }

    // Меню
    const menuTrigger = postEl.querySelector('.post-menu-trigger');
    if (menuTrigger) {
      menuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleMenu(menuTrigger);
      });
    }

    // Хештеги
    this.attachHashtagListeners(postEl);

    // Галерея
    this.initGallery(postEl);
  }

  attachHashtagListeners(container) {
    container.querySelectorAll('.hashtag').forEach(tag => {
      tag.addEventListener('click', (e) => {
        e.stopPropagation();
        searchHashtag(tag.dataset.tag);
      });
    });
  }

  initGallery(postEl) {
    const gallery = postEl.querySelector('.post-gallery');
    if (!gallery || gallery.dataset.slide === undefined) return;

    const track = gallery.querySelector('.gallery-track');
    const slides = gallery.querySelectorAll('.gallery-slide');
    const dots = gallery.querySelectorAll('.dot');
    const counter = gallery.querySelector('.gallery-counter');
    let current = 0;

    const updateSlide = (index) => {
      current = index;
      track.style.transform = `translateX(-${index * 100}%)`;
      slides.forEach((s, i) => s.classList.toggle('active', i === index));
      dots.forEach((d, i) => d.classList.toggle('active', i === index));
      if (counter) counter.textContent = `${index + 1}/${slides.length}`;
    };

    gallery.querySelector('.gallery-prev')?.addEventListener('click', () => {
      updateSlide(current > 0 ? current - 1 : slides.length - 1);
    });

    gallery.querySelector('.gallery-next')?.addEventListener('click', () => {
      updateSlide(current < slides.length - 1 ? current + 1 : 0);
    });

    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => updateSlide(i));
    });
  }

  // ================= Меню з анімацією =================
  toggleMenu(trigger) {
    // Закриваємо всі інші меню
    document.querySelectorAll('.post-menu-dropdown').forEach(menu => {
      if (menu !== trigger.nextElementSibling) {
        menu.hidden = true;
        menu.previousElementSibling?.setAttribute('aria-expanded', 'false');
      }
    });

    const dropdown = trigger.nextElementSibling;
    const isOpen = !dropdown.hidden;
    
    dropdown.hidden = isOpen;
    trigger.setAttribute('aria-expanded', !isOpen);

    if (!isOpen) {
      // Закриття при кліку поза меню
      const closeHandler = (e) => {
        if (!trigger.parentElement.contains(e.target)) {
          dropdown.hidden = true;
          trigger.setAttribute('aria-expanded', 'false');
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 0);
    }
  }

  // ================= Реактивні оновлення =================
  setupRealtimeUpdates(postId, postEl) {
    if (this.listeners.has(postId)) return;

    const unsubscribe = onSnapshot(
      doc(db, "posts", postId),
      (snap) => {
        if (!snap.exists()) {
          postEl.remove();
          this.cleanupListener(postId);
          return;
        }

        const data = snap.data();
        
        // Оновлюємо лише змінені елементи
        const likeBtn = postEl.querySelector('.like-btn');
        if (likeBtn) {
          const isLiked = data.likes?.includes(state.currentUser?.uid);
          likeBtn.classList.toggle('liked', isLiked);
          const count = likeBtn.querySelector('.like-count');
          if (count) count.textContent = data.likesCount || 0;
        }

        const saveBtn = postEl.querySelector('.save-btn');
        if (saveBtn) {
          const isSaved = data.saves?.includes(state.currentUser?.uid);
          saveBtn.classList.toggle('saved', isSaved);
        }

        const commentCount = postEl.querySelector('.comment-count');
        if (commentCount) commentCount.textContent = data.commentsCount || 0;
      },
      (error) => console.error(`Realtime error for ${postId}:`, error)
    );

    this.listeners.set(postId, unsubscribe);
  }

  cleanupListener(postId) {
    const unsubscribe = this.listeners.get(postId);
    if (unsubscribe) {
      unsubscribe();
      this.listeners.delete(postId);
    }
  }

  cleanupAllListeners() {
    this.listeners.forEach(unsubscribe => unsubscribe());
    this.listeners.clear();
    this.observer?.disconnect();
  }

  // ================= Коментарі =================
  async loadComments(postId, container) {
    try {
      const q = query(
        collection(db, `posts/${postId}/comments`), 
        orderBy("createdAt", "asc")
      );
      const snapshot = await getDocs(q);
      
      const fragment = document.createDocumentFragment();
      
      if (snapshot.empty) {
        container.innerHTML = '<p class="no-comments">Поки немає коментарів</p>';
        return;
      }

      snapshot.forEach(doc => {
        const comment = doc.data();
        const el = this.createCommentElement(comment);
        fragment.appendChild(el);
      });

      container.innerHTML = '';
      container.appendChild(fragment);
    } catch (error) {
      console.error('Load comments error:', error);
      container.innerHTML = '<p class="error">Помилка завантаження коментарів</p>';
    }
  }

  createCommentElement(comment) {
    const el = document.createElement('div');
    el.className = 'comment';
    
    const time = this.formatTime(comment.createdAt);
    
    el.innerHTML = `
      <div class="comment-avatar" style="background-image:url(${comment.authorAvatar || ''})" 
           data-uid="${comment.author}" role="button"></div>
      <div class="comment-content">
        <div class="comment-header">
          <span class="comment-author" data-uid="${comment.author}">${comment.authorName}</span>
          <time class="comment-time">${time}</time>
        </div>
        <p class="comment-text">${this.escapeHtml(comment.text)}</p>
      </div>
    `;
    
    return el;
  }

  async addComment(postId, text) {
    if (!PostManager.checkAuth() || !text.trim()) return;

    try {
      const userSnap = await getDoc(doc(db, "users", state.currentUser.uid));
      const user = userSnap.data();

      await addDoc(collection(db, `posts/${postId}/comments`), {
        author: state.currentUser.uid,
        authorName: user.nickname,
        authorAvatar: user.avatar || '',
        text: text.trim(),
        createdAt: serverTimestamp()
      });

      await updateDoc(doc(db, "posts", postId), { 
        commentsCount: increment(1),
        popularity: increment(CONSTANTS.POPULARITY.COMMENT)
      });

      return true;
    } catch (error) {
      console.error('Add comment error:', error);
      throw error;
    }
  }

  // ================= Перегляди =================
  async trackView(postId) {
    if (!state.currentUser || state.viewedPosts?.has(postId)) return;
    
    state.viewedPosts = state.viewedPosts || new Set();
    state.viewedPosts.add(postId);

    try {
      await updateDoc(doc(db, "posts", postId), { 
        views: increment(1),
        popularity: increment(CONSTANTS.POPULARITY.VIEW)
      });
    } catch (e) {
      console.warn("View tracking error:", e);
    }
  }

  // ================= Утиліти =================
  formatTime(timestamp) {
    if (!timestamp) return '';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ================= Модальне вікно редагування =================
class EditPostModal {
  constructor(currentText, onSave) {
    this.currentText = currentText;
    this.onSave = onSave;
    this.maxLength = CONSTANTS.MAX_POST_LENGTH;
    this.modal = null;
  }

  show() {
    this.create();
    this.attachListeners();
    this.updateCharCount();
    
    // Фокус в кінець тексту
    const textarea = this.modal.querySelector('#editTextarea');
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  create() {
    // Видаляємо існуюче
    document.getElementById('editPostModal')?.remove();

    this.modal = document.createElement('div');
    this.modal.id = 'editPostModal';
    this.modal.className = 'modal-overlay';
    this.modal.innerHTML = `
      <div class="modal-container" role="dialog" aria-modal="true" aria-labelledby="editTitle">
        <div class="modal-header">
          <h3 id="editTitle">Редагувати пост</h3>
          <button class="modal-close" aria-label="Закрити">×</button>
        </div>
        
        <div class="modal-body">
          <div class="textarea-wrapper">
            <textarea 
              id="editTextarea" 
              class="edit-textarea" 
              maxlength="${this.maxLength}"
              placeholder="Що у вас нового?"
              aria-label="Текст поста"
            >${this.escapeHtml(this.currentText)}</textarea>
            <div class="textarea-toolbar">
              <button type="button" class="emoji-trigger" aria-label="Додати емодзі">😊</button>
              <span class="char-count" aria-live="polite">0/${this.maxLength}</span>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-secondary" data-action="cancel">Скасувати</button>
          <button class="btn btn-primary" data-action="save" disabled>
            <span class="btn-text">Зберегти</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);
    
    // Анімація появи
    requestAnimationFrame(() => this.modal.classList.add('active'));
  }

  attachListeners() {
    const textarea = this.modal.querySelector('#editTextarea');
    const saveBtn = this.modal.querySelector('[data-action="save"]');
    const cancelBtn = this.modal.querySelector('[data-action="cancel"]');
    const closeBtn = this.modal.querySelector('.modal-close');
    const emojiBtn = this.modal.querySelector('.emoji-trigger');

    // Оновлення лічильника та кнопки
    textarea.addEventListener('input', () => {
      this.updateCharCount();
      const hasChanges = textarea.value.trim() !== this.currentText.trim();
      saveBtn.disabled = !hasChanges || !textarea.value.trim();
    });

    // Збереження
    saveBtn.addEventListener('click', () => {
      const newText = textarea.value.trim();
      if (newText && newText !== this.currentText) {
        this.onSave(newText);
        this.close();
      }
    });

    // Скасування
    const cancel = () => {
      if (textarea.value.trim() !== this.currentText.trim()) {
        if (confirm('Ви маєте незбережені зміни. Вийти?')) {
          this.close();
        }
      } else {
        this.close();
      }
    };

    cancelBtn.addEventListener('click', cancel);
    closeBtn.addEventListener('click', cancel);

    // Закриття по кліку поза модалкою
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) cancel();
    });

    // Escape для закриття
    this.modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
    });

    // Emoji picker (спрощена версія, можна розширити)
    emojiBtn.addEventListener('click', () => {
      const emojis = ['😀', '😂', '🥰', '😎', '🤔', '👍', '❤️', '🔥', '🎉', '👏'];
      const picker = document.createElement('div');
      picker.className = 'emoji-picker-dropdown';
      picker.innerHTML = emojis.map(e => `<button type="button" class="emoji-option">${e}</button>`).join('');
      
      const rect = emojiBtn.getBoundingClientRect();
      picker.style.position = 'absolute';
      picker.style.top = `${rect.bottom + 5}px`;
      picker.style.left = `${rect.left}px`;
      
      picker.addEventListener('click', (e) => {
        if (e.target.classList.contains('emoji-option')) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const text = textarea.value;
          textarea.value = text.substring(0, start) + e.target.textContent + text.substring(end);
          textarea.focus();
          textarea.setSelectionRange(start + 2, start + 2);
          textarea.dispatchEvent(new Event('input'));
          picker.remove();
        }
      });

      document.body.appendChild(picker);
      
      // Закриття picker при кліку поза ним
      setTimeout(() => {
        document.addEventListener('click', function closePicker(e) {
          if (!picker.contains(e.target) && e.target !== emojiBtn) {
            picker.remove();
            document.removeEventListener('click', closePicker);
          }
        });
      }, 0);
    });
  }

  updateCharCount() {
    const textarea = this.modal.querySelector('#editTextarea');
    const counter = this.modal.querySelector('.char-count');
    const length = textarea.value.length;
    counter.textContent = `${length}/${this.maxLength}`;
    counter.classList.toggle('near-limit', length > this.maxLength * 0.9);
  }

  close() {
    this.modal.classList.remove('active');
    setTimeout(() => this.modal.remove(), 300);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ================= Хештеги та фільтри =================
class HashtagManager {
  static async loadPopular(listId = 'hashtagList', limit = 20) {
    const list = document.getElementById(listId);
    if (!list) return;

    list.innerHTML = '<div class="skeleton-loader"></div>';

    try {
      // Використовуємо агрегацію на клієнті (для великих обсягів краще Cloud Function)
      const snapshot = await getDocs(collection(db, "posts"));
      const tagCount = new Map();

      snapshot.forEach(doc => {
        (doc.data().hashtags || []).forEach(tag => {
          tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
        });
      });

      const sorted = Array.from(tagCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit);

      this.renderHashtagList(list, sorted);
    } catch (error) {
      console.error('Load hashtags error:', error);
      list.innerHTML = '<p class="error">Помилка завантаження</p>';
    }
  }

  static renderHashtagList(container, tags) {
    if (!tags.length) {
      container.innerHTML = '<p class="empty">Поки немає хештегів</p>';
      return;
    }

    const fragment = document.createDocumentFragment();
    
    tags.forEach(([tag, count]) => {
      const item = document.createElement('div');
      item.className = 'hashtag-item';
      item.tabIndex = 0;
      item.innerHTML = `
        <span class="hashtag-name">#${tag}</span>
        <span class="hashtag-count">${count} ${this.declension(count, 'пост', 'пости', 'постів')}</span>
      `;
      item.addEventListener('click', () => searchHashtag(tag));
      fragment.appendChild(item);
    });

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  static declension(n, one, few, many) {
    if (n % 10 === 1 && n % 100 !== 11) return one;
    if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return few;
    return many;
  }
}

// ================= Ініціалізація та експорти =================
const postManager = new PostManager();

// Глобальні обробники подій з делегуванням
document.addEventListener('DOMContentLoaded', () => {
  // Делегування для динамічно доданих елементів
  document.body.addEventListener('click', (e) => {
    // Меню поста
    const menuItem = e.target.closest('.menu-item');
    if (menuItem) {
      e.stopPropagation();
      const postEl = menuItem.closest('.post');
      const postId = postEl?.dataset.postId;
      const action = menuItem.dataset.action;
      
      if (action === 'edit') postManager.editPost(postId);
      if (action === 'delete') postManager.deletePost(postId);
      
      // Закриваємо меню
      const dropdown = menuItem.closest('.post-menu-dropdown');
      const trigger = dropdown?.previousElementSibling;
      if (dropdown) dropdown.hidden = true;
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    // Підписка
    const followBtn = e.target.closest('.follow-btn-post');
    if (followBtn) {
      const uid = followBtn.dataset.uid;
      if (uid) toggleFollow(uid, followBtn);
    }

    // Перехід на профіль
    const profileLink = e.target.closest('[data-uid]');
    if (profileLink && !profileLink.closest('.follow-btn-post')) {
      const uid = profileLink.dataset.uid;
      // Ваш код для відкриття профілю
    }
  });

  // Обробка форм коментарів
  document.body.addEventListener('submit', (e) => {
    if (e.target.classList.contains('comment-form')) {
      e.preventDefault();
      const postId = e.target.querySelector('.submit-comment-btn')?.dataset.postId;
      const input = e.target.querySelector('.comment-input');
      if (postId && input?.value.trim()) {
        postManager.addComment(postId, input.value).then(() => {
          input.value = '';
          const list = document.getElementById(`comments-list-${postId}`);
          if (list) postManager.loadComments(postId, list);
        });
      }
    }
  });
});

// Експорт функцій
export const toggleLike = (...args) => postManager.toggleLike(...args);
export const toggleSave = (...args) => postManager.toggleSave(...args);
export const createPost = (...args) => postManager.createPost(...args);
export const editPost = (...args) => postManager.editPost(...args);
export const deletePost = (...args) => postManager.deletePost(...args);
export const loadMorePosts = (...args) => postManager.loadMorePosts(...args);
export const renderPosts = (...args) => postManager.renderPosts(...args);
export const loadComments = (...args) => postManager.loadComments(...args);
export const addComment = (...args) => postManager.addComment(...args);
export const loadHashtags = (...args) => HashtagManager.loadPopular(...args);
export const extractHashtags = (text) => PostManager.extractHashtags(text);

export function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    document.querySelector('[data-section="search"]')?.click();
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
    activeDiv.innerHTML = `
      <span class="filter-chip">#${tag}</span>
      <button class="clear-filter" id="clearFilterChip" aria-label="Очистити фільтр">×</button>
    `;
    document.getElementById('clearFilterChip')?.addEventListener('click', clearFilter);
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

// Очищення при виході
window.addEventListener('beforeunload', () => {
  postManager.cleanupAllListeners();
});
