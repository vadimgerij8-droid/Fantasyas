import { db } from './config.js';
import { 
  collection, addDoc, doc, getDoc, updateDoc, deleteDoc, query, where, orderBy, limit, startAfter, 
  getDocs, serverTimestamp, arrayUnion, arrayRemove, increment, writeBatch, onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { 
  state,
  setFilterHashtag, resetPaginationState, setCurrentFeedType
} from './state.js';
import { showToast, vibrate, uploadToCloudinary, debounce, setupEmojiPicker, escapeHtml } from './utils.js';
import { toggleFollow } from './profile.js';

// ================= Допоміжні функції =================
export function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

// ================= Очищення стрічки =================
export function clearFeed() {
  // Відписуємось від усіх слухачів постів
  state.postListeners.forEach(unsubscribe => unsubscribe());
  state.postListeners.clear();
  
  // Очищаємо DOM
  const feed = document.getElementById('feed');
  if (feed) feed.innerHTML = '';
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
    const isLiked = postData.likes?.includes(state.currentUser.uid) || false;

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
    state.savePromiseMap.delete(postId);
  }
}, 300);

// ================= Створення поста =================
export async function createPost(text, files) {
  if (!state.currentUser) {
    showToast('Увійдіть, щоб опублікувати пост');
    return false;
  }

  const MAX_FILES = 3;
  if (files.length > MAX_FILES) {
    showToast(`Можна вибрати не більше ${MAX_FILES} файлів`);
    return false;
  }

  // Валідація типів файлів
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
  for (const file of files) {
    if (!allowedTypes.includes(file.type)) {
      showToast(`Недопустимий тип файлу: ${file.type}`);
      return false;
    }
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

    // Очищаємо форму
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
  
  // TODO: Замінити prompt на модальне вікно
  const newText = prompt('Редагувати текст поста:', post.text || '');
  if (newText === null) return;
  
  try {
    const hashtags = extractHashtags(newText);
    await updateDoc(postRef, {
      text: newText,
      hashtags,
      edited: true,
      updatedAt: serverTimestamp()
    });
    showToast('Пост оновлено');
  } catch (error) {
    console.error('Помилка редагування поста:', error);
    showToast('Не вдалося оновити пост');
  }
}

// ================= Видалення поста =================
export async function deletePost(postId) {
  if (!state.currentUser) return;
  if (!confirm('Видалити цей пост назавжди?')) return;

  const deleteBtn = document.querySelector(`.delete-post-btn[data-post-id="${postId}"]`);
  if (deleteBtn) deleteBtn.disabled = true;

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

    // Видаляємо сам пост
    batch.delete(postRef);

    // Видаляємо ID поста з масиву постів автора
    const userRef = doc(db, "users", state.currentUser.uid);
    batch.update(userRef, {
      posts: arrayRemove(postId)
    });

    await batch.commit();

    // Видаляємо елемент з DOM
    const postElement = document.querySelector(`.post[data-post-id="${postId}"]`);
    if (postElement) {
      // Відписуємось від слухача перед видаленням
      const unsubscribe = state.postListeners.get(postId);
      if (unsubscribe) {
        unsubscribe();
        state.postListeners.delete(postId);
      }
      postElement.remove();
    }

    showToast('Пост видалено');
  } catch (error) {
    console.error('Помилка видалення поста:', error);
    showToast('Не вдалося видалити пост');
  } finally {
    if (deleteBtn) deleteBtn.disabled = false;
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
    let baseQuery;
    if (state.currentFilterHashtag) {
      console.log('loadMorePosts: фільтр за хештегом', state.currentFilterHashtag);
      baseQuery = query(collection(db, "posts"), where("hashtags", "array-contains", state.currentFilterHashtag));
    } else {
      baseQuery = collection(db, "posts");
    }

    let q;
    if (state.currentFeedType === 'new' || state.currentFilterHashtag) {
      console.log('loadMorePosts: сортування за датою (нові)');
      q = query(baseQuery, orderBy("createdAt", "desc"), limit(10));
    } else {
      console.log('loadMorePosts: сортування за популярністю');
      q = query(baseQuery, orderBy("likesCount", "desc"), orderBy("createdAt", "desc"), limit(10));
    }

    if (state.lastVisible) {
      console.log('loadMorePosts: є lastVisible, додаємо startAfter');
      q = query(q, startAfter(state.lastVisible));
    }

    const snapshot = await getDocs(q);
    console.log('loadMorePosts: отримано документів', snapshot.size);
    
    if (snapshot.empty) {
      state.hasMore = false;
      return;
    }

    state.lastVisible = snapshot.docs[snapshot.docs.length - 1];
    renderPosts(snapshot.docs, containerId);
  } catch (e) {
    console.error("Помилка завантаження постів:", e);
    // Покращена обробка помилки
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
    
    // Перевіряємо, чи пост ще не відображається
    if (document.querySelector(`.post[data-post-id="${post.id}"]`)) return;
    
    const liked = post.likes?.includes(state.currentUser?.uid) || false;
    const saved = post.saves?.includes(state.currentUser?.uid) || false;
    
    // Формат дати: день.місяць.рік години:хвилини
    const postTime = post.createdAt ? new Date(post.createdAt.seconds * 1000).toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }) : '';
    
    const isAuthor = state.currentUser && post.author === state.currentUser.uid;
    const isFollowing = state.currentUserFollowing?.includes(post.author) || false;

    // Створюємо елемент поста
    const postEl = document.createElement('div');
    postEl.className = 'post';
    postEl.dataset.postId = post.id;
    postEl.tabIndex = 0;

    // Форматуємо текст з хештегами (екрануємо HTML)
    let contentHtml = escapeHtml(post.text || '');
    contentHtml = contentHtml.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>');

    // Будівництво поста через createElement (без innerHTML для складних частин)
    
    // Шапка поста
    const header = document.createElement('div');
    header.className = 'post-header';
    
    // Аватар
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'avatar';
    avatarDiv.style.backgroundImage = `url(${post.authorAvatar || ''})`;
    avatarDiv.dataset.uid = post.author;
    avatarDiv.tabIndex = 0;
    header.appendChild(avatarDiv);
    
    // Інформація про автора
    const authorInfo = document.createElement('div');
    authorInfo.className = 'post-author-info';
    
    const authorRow = document.createElement('div');
    authorRow.className = 'post-author-row';
    
    const authorName = document.createElement('span');
    authorName.className = 'post-author';
    authorName.dataset.uid = post.author;
    authorName.tabIndex = 0;
    authorName.textContent = post.authorName || 'Невідомо';
    authorRow.appendChild(authorName);
    
    const authorUserId = document.createElement('span');
    authorUserId.className = 'post-username';
    authorUserId.textContent = post.authorUserId || '';
    authorRow.appendChild(authorUserId);
    
    // Кнопка підписки (якщо не автор)
    if (!isAuthor && state.currentUser) {
      const followBtn = document.createElement('button');
      followBtn.className = `follow-btn-post ${isFollowing ? 'following' : ''}`;
      followBtn.dataset.uid = post.author;
      followBtn.tabIndex = 0;
      followBtn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
      followBtn.onclick = (e) => {
        e.stopPropagation();
        toggleFollow(post.author, followBtn);
      };
      authorRow.appendChild(followBtn);
    }
    
    authorInfo.appendChild(authorRow);
    
    const postTimeSpan = document.createElement('div');
    postTimeSpan.className = 'post-time';
    postTimeSpan.textContent = postTime;
    authorInfo.appendChild(postTimeSpan);
    
    header.appendChild(authorInfo);
    
    // Дії з постом (редагування/видалення для автора)
    if (isAuthor) {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'post-actions';
      
      const editBtn = document.createElement('button');
      editBtn.className = 'edit-post-btn';
      editBtn.title = 'Редагувати пост';
      editBtn.dataset.postId = post.id;
      editBtn.tabIndex = 0;
      editBtn.textContent = '✎';
      editBtn.onclick = (e) => {
        e.stopPropagation();
        editPost(post.id);
      };
      actionsDiv.appendChild(editBtn);
      
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-post-btn';
      deleteBtn.title = 'Видалити пост';
      deleteBtn.dataset.postId = post.id;
      deleteBtn.tabIndex = 0;
      deleteBtn.textContent = '🗑';
      deleteBtn.onclick = (e) => {
        e.stopPropagation();
        deletePost(post.id);
      };
      actionsDiv.appendChild(deleteBtn);
      
      header.appendChild(actionsDiv);
    }
    
    postEl.appendChild(header);

    // Контент поста
    const contentDiv = document.createElement('div');
    contentDiv.className = 'post-content';
    contentDiv.innerHTML = contentHtml; // innerHTML безпечний після escapeHtml
    postEl.appendChild(contentDiv);

    // Галерея
    if (post.media && post.media.length > 0) {
      const gallery = createGallery(post.media);
      postEl.appendChild(gallery);
    } else if (post.mediaUrl) {
      if (post.mediaType === 'image') {
        const img = document.createElement('img');
        img.src = post.mediaUrl;
        img.className = 'post-media';
        img.loading = 'lazy';
        img.tabIndex = 0;
        postEl.appendChild(img);
      } else {
        const video = document.createElement('video');
        video.src = post.mediaUrl;
        video.controls = true;
        video.className = 'post-media';
        video.tabIndex = 0;
        postEl.appendChild(video);
      }
    }

    // Футер (кнопки)
    const footer = document.createElement('div');
    footer.className = 'post-footer';
    
    // Кнопка лайка
    const likeBtn = document.createElement('button');
    likeBtn.className = `like-btn ${liked ? 'liked' : ''}`;
    likeBtn.dataset.postId = post.id;
    likeBtn.tabIndex = 0;
    likeBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
      <span>${post.likesCount || 0}</span>
    `;
    likeBtn.onclick = () => toggleLike(post.id, likeBtn);
    footer.appendChild(likeBtn);
    
    // Кнопка коментарів
    const commentBtn = document.createElement('button');
    commentBtn.className = 'comment-toggle-btn';
    commentBtn.dataset.postId = post.id;
    commentBtn.tabIndex = 0;
    commentBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span>${post.commentsCount || 0}</span>
    `;
    footer.appendChild(commentBtn);
    
    // Кнопка збереження
    const saveBtn = document.createElement('button');
    saveBtn.className = `save-btn ${saved ? 'saved' : ''}`;
    saveBtn.dataset.postId = post.id;
    saveBtn.tabIndex = 0;
    saveBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
    `;
    saveBtn.onclick = () => toggleSave(post.id, saveBtn);
    footer.appendChild(saveBtn);
    
    // Лічильник переглядів
    const viewSpan = document.createElement('span');
    viewSpan.className = 'view-count';
    viewSpan.title = 'Перегляди';
    viewSpan.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7z"/></svg>
      ${post.views || 0}
    `;
    footer.appendChild(viewSpan);
    
    postEl.appendChild(footer);

    // Секція коментарів (спочатку прихована)
    const commentsSection = document.createElement('div');
    commentsSection.className = 'comments-section';
    commentsSection.id = `comments-${post.id}`;
    commentsSection.style.display = 'none';
    
    const commentsList = document.createElement('div');
    commentsList.className = 'comments-list';
    commentsList.id = `comments-list-${post.id}`;
    commentsSection.appendChild(commentsList);
    
    const commentForm = document.createElement('div');
    commentForm.className = 'comment-form';
    
    const commentInput = document.createElement('input');
    commentInput.type = 'text';
    commentInput.id = `comment-input-${post.id}`;
    commentInput.className = 'comment-input';
    commentInput.placeholder = 'Напишіть коментар...';
    commentInput.tabIndex = 0;
    commentForm.appendChild(commentInput);
    
    const emojiContainer = document.createElement('div');
    emojiContainer.style.position = 'relative';
    
    const emojiBtn = document.createElement('button');
    emojiBtn.className = 'emoji-button';
    emojiBtn.id = `comment-emoji-${post.id}`;
    emojiBtn.tabIndex = 0;
    emojiBtn.textContent = '😊';
    emojiContainer.appendChild(emojiBtn);
    
    const emojiPicker = document.createElement('div');
    emojiPicker.className = 'emoji-picker';
    emojiPicker.id = `comment-picker-${post.id}`;
    emojiContainer.appendChild(emojiPicker);
    
    commentForm.appendChild(emojiContainer);
    
    const submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary btn-icon';
    submitBtn.id = `submit-comment-${post.id}`;
    submitBtn.tabIndex = 0;
    submitBtn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
    commentForm.appendChild(submitBtn);
    
    commentsSection.appendChild(commentForm);
    postEl.appendChild(commentsSection);

    feed.appendChild(postEl);

    // Обробники подій
    postEl.querySelectorAll('.hashtag').forEach(span => {
      span.onclick = (e) => {
        e.stopPropagation();
        const tag = span.dataset.tag;
        searchHashtag(tag);
      };
    });

    // Обробник для кнопки коментарів
    commentBtn.onclick = async () => {
      if (commentsSection.style.display === 'none') {
        commentsSection.style.display = 'block';
        await loadComments(post.id, commentsList);
      } else {
        commentsSection.style.display = 'none';
      }
    };

    // Обробник для відправки коментаря
    submitBtn.onclick = async () => {
      const text = commentInput.value.trim();
      if (!text) return;
      try {
        await addComment(post.id, text);
        commentInput.value = '';
        await loadComments(post.id, commentsList);
        const countSpan = commentBtn.querySelector('span');
        if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;
        showToast('Коментар додано');
      } catch (error) {
        console.error('Error adding comment:', error);
        showToast('Помилка: ' + error.message);
      }
    };

    // Emoji picker
    setupEmojiPicker(`comment-emoji-${post.id}`, `comment-picker-${post.id}`, `comment-input-${post.id}`);

    // Підписка на оновлення поста
    const postRef = doc(db, "posts", post.id);
    const unsubscribe = onSnapshot(postRef, (snap) => {
      // Перевіряємо, чи елемент ще в DOM
      if (!postEl.isConnected) {
        unsubscribe();
        return;
      }
      
      if (snap.exists()) {
        const data = snap.data();
        
        // Оновлюємо лайк
        const liked = data.likes?.includes(state.currentUser?.uid) || false;
        const likeBtn = postEl.querySelector('.like-btn');
        if (likeBtn) {
          const countSpan = likeBtn.querySelector('span');
          if (liked) {
            likeBtn.classList.add('liked');
          } else {
            likeBtn.classList.remove('liked');
          }
          if (countSpan) countSpan.textContent = data.likesCount || 0;
        }
        
        // Оновлюємо збереження
        const saved = data.saves?.includes(state.currentUser?.uid) || false;
        const saveBtn = postEl.querySelector('.save-btn');
        if (saveBtn) {
          if (saved) {
            saveBtn.classList.add('saved');
          } else {
            saveBtn.classList.remove('saved');
          }
        }
        
        // Оновлюємо кількість коментарів
        const commentBtn = postEl.querySelector('.comment-toggle-btn span');
        if (commentBtn) commentBtn.textContent = data.commentsCount || 0;
        
        // Оновлюємо перегляди
        const viewSpan = postEl.querySelector('.view-count');
        if (viewSpan) {
          const viewCount = viewSpan.childNodes[2]; // текстовий вузол після SVG
          if (viewCount) viewCount.textContent = data.views || 0;
        }
      } else {
        // Пост видалено
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

    // Відстеження переглядів через Intersection Observer
    observePostView(post.id, postEl);
  });
}

// ================= Intersection Observer для переглядів =================
const viewObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const postId = entry.target.dataset.postId;
      incrementPostView(postId);
      viewObserver.unobserve(entry.target); // тільки один раз
    }
  });
}, { threshold: 0.5 });

function observePostView(postId, postEl) {
  if (!state.currentUser) return;
  if (state.viewedPosts.has(postId)) return;
  viewObserver.observe(postEl);
}

// ================= Коментарі =================
export async function loadComments(postId, container) {
  const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
  const snapshot = await getDocs(q);
  container.innerHTML = '';
  snapshot.forEach(doc => {
    const comment = doc.data();
    const commentEl = document.createElement('div');
    commentEl.className = 'comment';
    
    const commentTime = comment.createdAt ? new Date(comment.createdAt.seconds * 1000).toLocaleString('uk-UA', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }) : '';
    
    commentEl.innerHTML = `
      <div class="comment-avatar" style="background-image:url(${comment.authorAvatar || ''})" data-uid="${comment.author}"></div>
      <div class="comment-content">
        <div>
          <span class="comment-author" data-uid="${comment.author}">${escapeHtml(comment.authorName)}</span>
          <span class="comment-time">${commentTime}</span>
        </div>
        <div class="comment-text">${escapeHtml(comment.text)}</div>
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
    popularity: increment(40)
  });
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

// ================= Галерея (виправлена) =================
function createGallery(media) {
  const gallery = document.createElement('div');
  gallery.className = 'post-gallery';

  const inner = document.createElement('div');
  inner.className = 'gallery-inner';

  media.forEach((item) => {
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

  // Оновлення індикаторів при скролі
  inner.addEventListener('scroll', () => {
    const slideWidth = inner.clientWidth;
    const currentIndex = Math.round(inner.scrollLeft / slideWidth);
    
    indicators.querySelectorAll('span').forEach((dot, i) => {
      dot.className = i === currentIndex ? 'active' : '';
    });
    
    counter.textContent = `${currentIndex + 1}/${media.length}`;
  });

  return gallery;
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
    const searchTab = document.querySelector('[data-section="search"]');
    if (searchTab) searchTab.click();
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
  document.getElementById('filterModal').classList.remove('active');

  // При застосуванні фільтра автоматично перемикаємо на "Нові", щоб уникнути помилки індексу
  if (state.currentFeedType === 'popular') {
    setCurrentFeedType('new');
    const newBtn = document.getElementById('feedNewBtn');
    const popularBtn = document.getElementById('feedPopularBtn');
    if (newBtn) newBtn.classList.add('active');
    if (popularBtn) popularBtn.classList.remove('active');
  }

  const activeDiv = document.getElementById('activeFilter');
  activeDiv.innerHTML = `#${tag} <button id="clearFilterChip">✕</button>`;
  document.getElementById('clearFilterChip').onclick = clearFilter;

  // Очищаємо стрічку перед завантаженням
  clearFeed();
  resetPaginationState();
  loadMorePosts();
}

export function clearFilter() {
  setFilterHashtag(null);
  document.getElementById('activeFilter').innerHTML = '';
  
  // Очищаємо стрічку перед завантаженням
  clearFeed();
  resetPaginationState();
  loadMorePosts();
}
