// ================= Головний файл, точка входу =================
import { auth, db } from ‘./config.js’;
import {
state,
setCurrentUser, setCurrentUserData, setUnsubscribeFollowing,
cleanupAllListeners, updateUnreadCount, resetPaginationState
} from ‘./state.js’;
import { showToast, startHeartbeat, stopHeartbeat, updateUnreadBadge, setupEmojiPicker, setupFileInput, debounce } from ‘./utils.js’;
import { register, login, googleLogin, appleLogin, resetPassword, logout } from ‘./auth.js’;
import { createPost, loadMorePosts, loadHashtags, loadFilterHashtags, clearFilter, applyFilter } from ‘./posts.js’;
import { viewProfile, saveProfileEdit, toggleFollow, openFollowersList, openFollowingList } from ‘./profile.js’;
import { loadChatList, openChat, closeChat, sendMessage, handleTyping, handleMessageContextAction, searchUsersForChat } from ‘./chat.js’;
import { loadSettings, setupSettingsListeners, applySettings } from ‘./settings.js’;
import { onAuthStateChanged } from “https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js”;
import {
doc, onSnapshot, collection, query, where, serverTimestamp, updateDoc, getDoc, getDocs
} from “https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js”;

// ================= Утильна функція для санітизації HTML =================
function escapeHtml(text) {
const div = document.createElement(‘div’);
div.textContent = String(text ?? ‘’);
return div.innerHTML;
}

// ================= Глобальні змінні =================
let unsubscribeChatList = null;

// ================= Допоміжні функції =================
async function blockUser(uid) {
try {
if (!state.currentUser) { showToast(‘Ви не авторизовані’); return; }
const userRef = doc(db, “users”, state.currentUser.uid);
const userDoc = await getDoc(userRef);
const blockedUsers = userDoc.data().blockedUsers || [];
if (!blockedUsers.includes(uid)) {
blockedUsers.push(uid);
await updateDoc(userRef, { blockedUsers });
showToast(‘Користувача заблоковано’);
} else {
showToast(‘Користувач уже у списку блокованих’);
}
} catch (error) {
console.error(‘Error blocking user:’, error);
showToast(‘Помилка при блокуванні користувача’);
}
}

async function clearChatHistory() {
try {
if (!state.currentChatId) { showToast(‘Чат не відкритий’); return; }
const chatRef = doc(db, “chats”, state.currentChatId);
await updateDoc(chatRef, { messages: [] });
showToast(‘Історія повідомлень очищена’);
} catch (error) {
console.error(‘Error clearing chat history:’, error);
showToast(‘Помилка при очищенні історії чату’);
}
}

// ВИПРАВЛЕННЯ: показуємо/ховаємо authBox через клас body.auth-visible
// (відповідно до CSS в index.html) замість прямого style.display
function showAuthBox() {
document.body.classList.add(‘auth-visible’);
const authBox = document.getElementById(‘authBox’);
if (authBox) authBox.style.display = ‘block’;
}

function hideAuthBox() {
document.body.classList.remove(‘auth-visible’);
const authBox = document.getElementById(‘authBox’);
if (authBox) authBox.style.display = ‘none’;
}

// ================= Ініціалізація при завантаженні DOM =================
document.addEventListener(‘DOMContentLoaded’, () => {
const sections = [‘home’,‘search’,‘hashtags’,‘profile’,‘chats’,‘settings’];
const navItems = document.querySelectorAll(’.bottom-nav .nav-item’);

navItems.forEach((item) => {
item.addEventListener(‘click’, async () => {
try {
const section = item.dataset.section;
navItems.forEach(n => n.classList.remove(‘active’));
item.classList.add(‘active’);
sections.forEach(s => document.getElementById(s)?.classList.remove(‘active’));
const sectionEl = document.getElementById(section);
if (sectionEl) sectionEl.classList.add(‘active’);

```
    const span = item.querySelector('span');
    document.getElementById('pageTitle').textContent = span ? span.textContent : item.textContent.trim();

    if (state.previousSection !== section) {
      state.navigationHistory.push(state.previousSection);
      state.previousSection = section;
    }

    // ВИПРАВЛЕННЯ: НЕ викликаємо cleanupAllListeners() при навігації —
    // це знищувало б unsubscribeFollowing, unsubscribeChatList та postListeners,
    // які мають жити протягом усієї сесії незалежно від активного розділу.
    // Прибираємо лише UI-стан чату.
    const chatWindow = document.getElementById('chatWindowContainer');
    if (chatWindow && section !== 'chats') chatWindow.style.display = 'none';
    const chatSidebar = document.getElementById('chatListSidebar');
    if (chatSidebar) chatSidebar.classList.remove('hide');
    document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');
    document.querySelector('.back-btn')?.classList.remove('visible');

    const newPostBox = document.getElementById('newPostBox');
    if (section !== 'profile' && newPostBox) newPostBox.style.display = 'none';

    if (section === 'home' && state.currentUser) resetPagination();
    if (section === 'search' && state.currentUser) await loadSearchUsers();
    if (section === 'hashtags' && state.currentUser) await loadHashtags();
    if (section === 'chats' && state.currentUser) {
      document.getElementById('chatWindowContainer').style.display = 'none';
      document.getElementById('chatListSidebar')?.classList.remove('hide');
      document.getElementById('chatSearchInput').value = '';
      document.getElementById('chatSearchResults').style.display = 'none';
      await loadChatList();
    }
    if (section === 'profile' && state.currentUser) await viewProfile(state.currentUser.uid);
    if (section === 'settings') loadSettings();
  } catch (error) {
    console.error('Navigation error:', error);
    showToast('Помилка при переході між розділами');
  }
});
```

});

// Кнопка “Назад”
document.querySelector(’.back-btn’)?.addEventListener(‘click’, () => {
try {
if (state.navigationHistory.length > 0) {
const prev = state.navigationHistory.pop();
state.previousSection = prev;
const navItem = document.querySelector(`.nav-item[data-section="${prev}"]`);
if (navItem) navItem.click();
}
} catch (error) {
console.error(‘Back button error:’, error);
}
});

// Перемикання вкладок налаштувань
document.querySelectorAll(’.settings-nav-item’).forEach(item => {
item.addEventListener(‘click’, () => {
try {
const tab = item.dataset.tab;
document.querySelectorAll(’.settings-nav-item’).forEach(nav => nav.classList.remove(‘active’));
document.querySelectorAll(’.settings-tab-content’).forEach(content => content.classList.remove(‘active’));
item.classList.add(‘active’);
const tabContent = document.getElementById(`settings-${tab}`);
if (tabContent) tabContent.classList.add(‘active’);
} catch (error) {
console.error(‘Settings tab error:’, error);
}
});
});

// Обробники авторизації
document.getElementById(‘toRegister’)?.addEventListener(‘click’, () => {
document.getElementById(‘loginForm’).style.display = ‘none’;
document.getElementById(‘registerForm’).style.display = ‘block’;
});

document.getElementById(‘toLogin’)?.addEventListener(‘click’, () => {
document.getElementById(‘registerForm’).style.display = ‘none’;
document.getElementById(‘loginForm’).style.display = ‘block’;
});

document.getElementById(‘registerBtn’)?.addEventListener(‘click’, async () => {
try {
const nickname = document.getElementById(‘registerNickname’)?.value.trim() || ‘’;
const password = document.getElementById(‘registerPassword’)?.value.trim() || ‘’;
if (nickname && password) {
await register(nickname, password);
} else {
showToast(‘Введіть псевдонім та пароль’);
}
} catch (error) {
console.error(‘Register error:’, error);
}
});

document.getElementById(‘loginBtn’)?.addEventListener(‘click’, async () => {
try {
const nickname = document.getElementById(‘loginNickname’)?.value.trim() || ‘’;
const password = document.getElementById(‘loginPassword’)?.value.trim() || ‘’;
if (nickname && password) {
await login(nickname, password);
} else {
showToast(‘Введіть псевдонім та пароль’);
}
} catch (error) {
console.error(‘Login error:’, error);
}
});

document.getElementById(‘googleLoginBtn’)?.addEventListener(‘click’, googleLogin);
document.getElementById(‘appleLoginBtn’)?.addEventListener(‘click’, appleLogin);

// ВИПРАВЛЕННЯ: замінено системний prompt() на читання вже наявного поля #loginNickname
document.getElementById(‘forgotPassword’)?.addEventListener(‘click’, async (e) => {
e.preventDefault();
try {
const nickname = document.getElementById(‘loginNickname’)?.value.trim();
if (!nickname) {
showToast(‘Спочатку введіть псевдонім у полі вище’);
document.getElementById(‘loginNickname’)?.focus();
return;
}
await resetPassword(nickname);
} catch (error) {
console.error(‘Reset password error:’, error);
}
});

document.getElementById(‘logoutBtn’)?.addEventListener(‘click’, () => {
cleanupAllListeners();
logout();
});

// Створення поста
document.getElementById(‘addPost’)?.addEventListener(‘click’, async () => {
try {
const text = document.getElementById(‘postText’)?.value.trim() || ‘’;
const fileInput = document.getElementById(‘postMedia’);
const files = fileInput?.files ? Array.from(fileInput.files) : [];
await createPost(text, files);
} catch (error) {
console.error(‘Create post error:’, error);
showToast(‘Помилка при створенні поста’);
}
});

// Редагування профілю
document.getElementById(‘saveProfileEdit’)?.addEventListener(‘click’, async () => {
try {
const nickname = document.getElementById(‘editNickname’)?.value.trim() || ‘’;
const bio = document.getElementById(‘editBio’)?.value.trim() || ‘’;
const note = document.getElementById(‘editNote’)?.value.trim() || ‘’;
const avatarFile = document.getElementById(‘editAvatar’)?.files[0];
await saveProfileEdit(nickname, bio, note, avatarFile);
} catch (error) {
console.error(‘Save profile error:’, error);
showToast(‘Помилка при збереженні профілю’);
}
});

document.getElementById(‘closeModal’)?.addEventListener(‘click’, () => {
document.getElementById(‘editProfileModal’)?.classList.remove(‘active’);
});

// Фільтри
document.getElementById(‘filterBtn’)?.addEventListener(‘click’, async () => {
try {
await loadFilterHashtags();
document.getElementById(‘filterModal’)?.classList.add(‘active’);
} catch (error) {
console.error(‘Filter error:’, error);
}
});

document.getElementById(‘closeFilterModal’)?.addEventListener(‘click’, () => {
document.getElementById(‘filterModal’)?.classList.remove(‘active’);
});

document.getElementById(‘clearFilterBtn’)?.addEventListener(‘click’, clearFilter);

// Стрічка (нова/популярна)
document.getElementById(‘feedNewBtn’)?.addEventListener(‘click’, () => {
if (state.currentFeedType === ‘new’) return;
state.currentFeedType = ‘new’;
resetPagination();
});

document.getElementById(‘feedPopularBtn’)?.addEventListener(‘click’, () => {
if (state.currentFeedType === ‘popular’) return;
state.currentFeedType = ‘popular’;
resetPagination();
});

// Пошук
document.getElementById(‘searchInput’)?.addEventListener(‘input’, debounce(loadSearchUsers, 300));

// Чат — відправка
document.getElementById(‘sendMessage’)?.addEventListener(‘click’, () => {
try {
const text = document.getElementById(‘chatText’)?.value.trim() || ‘’;
const file = document.getElementById(‘chatAttachFile’)?.files[0];
sendMessage(text, file);
} catch (error) {
console.error(‘Send message error:’, error);
}
});

document.getElementById(‘chatText’)?.addEventListener(‘keypress’, (e) => {
if (e.key === ‘Enter’ && !e.shiftKey) {
e.preventDefault();
document.getElementById(‘sendMessage’)?.click();
}
});

document.getElementById(‘chatText’)?.addEventListener(‘input’, handleTyping);

document.getElementById(‘chatAttachBtn’)?.addEventListener(‘click’, () => {
document.getElementById(‘chatAttachFile’)?.click();
});

document.getElementById(‘chatAttachFile’)?.addEventListener(‘change’, function() {
const btn = document.getElementById(‘chatAttachBtn’);
if (btn) btn.innerHTML = this.files && this.files[0] ? ‘📁’ : ‘📎’;
});

document.getElementById(‘chatBackBtn’)?.addEventListener(‘click’, closeChat);

document.getElementById(‘chatAvatar’)?.addEventListener(‘click’, () => {
try {
if (state.currentChatPartner) viewProfile(state.currentChatPartner);
} catch (error) {
console.error(‘Chat avatar error:’, error);
}
});

document.getElementById(‘chatMenuBtn’)?.addEventListener(‘click’, (e) => {
e.stopPropagation();
document.getElementById(‘chatMenuDropdown’)?.classList.toggle(‘show’);
});

document.addEventListener(‘click’, () => {
document.getElementById(‘chatMenuDropdown’)?.classList.remove(‘show’);
});

document.getElementById(‘chatMenuDropdown’)?.addEventListener(‘click’, async (e) => {
try {
const action = e.target.dataset.action;
if (action === ‘viewProfile’ && state.currentChatPartner) {
viewProfile(state.currentChatPartner);
} else if (action === ‘block’ && state.currentChatPartner) {
await blockUser(state.currentChatPartner);
} else if (action === ‘clearHistory’ && state.currentChatId) {
if (confirm(‘Очистити історію повідомлень?’)) await clearChatHistory();
}
document.getElementById(‘chatMenuDropdown’)?.classList.remove(‘show’);
} catch (error) {
console.error(‘Chat menu action error:’, error);
}
});

// ВИПРАВЛЕННЯ: контекстне меню повідомлень у main.js більше не перехоплюємо тут —
// воно повністю обробляється всередині chat.js через замикання з msg.
// Старий обробник передавав лише action без msg, що ламало всі дії меню.
// Елемент #messageContextMenu залишається в DOM для позиціонування, логіка — в chat.js.

// Пошук у чатах
let searchTimeout;
document.getElementById(‘chatSearchInput’)?.addEventListener(‘input’, (e) => {
clearTimeout(searchTimeout);
const val = e.target.value.trim();
if (!val) {
document.getElementById(‘chatSearchResults’).style.display = ‘none’;
return;
}
searchTimeout = setTimeout(() => {
try { searchUsersForChat(val); } catch (error) { console.error(‘Chat search error:’, error); }
}, 300);
});

// Налаштування
setupSettingsListeners();

// Закриття модалок
document.getElementById(‘closeFollowersModal’)?.addEventListener(‘click’, () => {
document.getElementById(‘followersModal’)?.classList.remove(‘active’);
});
document.getElementById(‘closeFollowingModal’)?.addEventListener(‘click’, () => {
document.getElementById(‘followingModal’)?.classList.remove(‘active’);
});
document.getElementById(‘closePrivacyModal’)?.addEventListener(‘click’, () => {
document.getElementById(‘privacyPolicyModal’)?.classList.remove(‘active’);
});
document.getElementById(‘privacyPolicyBtn’)?.addEventListener(‘click’, () => {
document.getElementById(‘privacyPolicyModal’)?.classList.add(‘active’);
});

// Очищення кешу
document.getElementById(‘clearCacheBtn’)?.addEventListener(‘click’, async () => {
try {
const keysToKeep = [‘theme’];
Object.keys(localStorage).forEach(key => {
if (!keysToKeep.includes(key)) localStorage.removeItem(key);
});
if (‘caches’ in window) {
const cacheNames = await caches.keys();
await Promise.all(cacheNames.map(name => caches.delete(name)));
}
showToast(‘Кеш очищено’);
} catch (error) {
console.error(‘Clear cache error:’, error);
showToast(‘Помилка при очищенні кешу’);
}
});

document.getElementById(‘clearSavedMediaBtn’)?.addEventListener(‘click’, async () => {
try {
if (!state.currentUser) { showToast(‘Ви не авторизовані’); return; }
if (!confirm(‘Видалити всі збережені медіа?’)) return;
await updateDoc(doc(db, “users”, state.currentUser.uid), { savedPosts: [] });
showToast(‘Збережені медіа очищено’);
} catch (error) {
console.error(‘Clear saved media error:’, error);
showToast(‘Помилка при очищенні збережених медіа’);
}
});

// ВИПРАВЛЕННЯ: ‘editPostMedia’ → ‘postMedia’ — в HTML немає id=“editPostMedia”
setupFileInput(‘editAvatar’, ‘editAvatarLabel’, ‘editAvatarPreview’);
setupEmojiPicker(‘postEmojiBtn’, ‘postEmojiPicker’, ‘postText’);
setupEmojiPicker(‘chatEmojiBtn’, ‘chatEmojiPicker’, ‘chatText’);

// Обробка медіа для поста
const postMediaInput = document.getElementById(‘postMedia’);
const postMediaPreviews = document.getElementById(‘postMediaPreviews’);
const postMediaLabel = document.getElementById(‘postMediaLabel’);

if (postMediaInput) {
postMediaInput.addEventListener(‘change’, function() {
try {
postMediaPreviews.innerHTML = ‘’;
const files = Array.from(this.files);
if (files.length > 3) {
showToast(‘Можна вибрати не більше 3 файлів’);
this.value = ‘’;
return;
}
postMediaLabel.textContent = files.length ? `Вибрано ${files.length} файлів` : ‘+ Медіа (до 3 файлів)’;

```
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const previewContainer = document.createElement('div');
          previewContainer.style.cssText = 'position:relative;width:80px;height:80px;';

          if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--border);';
            previewContainer.appendChild(img);
          } else if (file.type.startsWith('video/')) {
            const video = document.createElement('video');
            video.src = e.target.result;
            video.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:8px;border:1px solid var(--border);';
            video.muted = true;
            video.preload = 'metadata';
            video.addEventListener('loadeddata', () => { video.currentTime = 0.1; });
            previewContainer.appendChild(video);
            const playIcon = document.createElement('span');
            playIcon.innerHTML = '▶️';
            playIcon.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:24px;opacity:0.7;';
            previewContainer.appendChild(playIcon);
          }

          const removeBtn = document.createElement('button');
          removeBtn.innerHTML = '✕';
          removeBtn.style.cssText = 'position:absolute;top:-5px;right:-5px;width:22px;height:22px;border-radius:50%;background:var(--danger);color:white;border:none;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;';
          removeBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            try {
              const dt = new DataTransfer();
              const allPreviews = Array.from(postMediaPreviews.children);
              const previewIndex = allPreviews.indexOf(previewContainer);
              files.forEach((f, i) => { if (i !== previewIndex) dt.items.add(f); });
              postMediaInput.files = dt.files;
              postMediaInput.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (error) {
              console.error('File removal error:', error);
            }
          });

          previewContainer.appendChild(removeBtn);
          postMediaPreviews.appendChild(previewContainer);
        } catch (error) {
          console.error('Preview load error:', error);
        }
      };
      reader.readAsDataURL(file);
    });
  } catch (error) {
    console.error('Media input change error:', error);
    showToast('Помилка при обробці файлів');
  }
});
```

}

// Intersection Observer для пагінації
const sentinel = document.getElementById(‘feedSentinel’);
if (sentinel) {
const observer = new IntersectionObserver((entries) => {
if (entries[0].isIntersecting) {
try { loadMorePosts(); } catch (error) { console.error(‘Load more posts error:’, error); }
}
}, { threshold: 0.5 });
observer.observe(sentinel);
}

// Відновлення теми
if (localStorage.getItem(‘theme’) === ‘dark’) document.body.classList.add(‘dark’);

// Глобальний обробник кліків (лайки, збереження, data-uid)
document.addEventListener(‘click’, async (e) => {
try {
const targetBtn = e.target.closest(‘button’);
if (targetBtn) {
if (!state.currentUser) {
if (targetBtn.classList.contains(‘like-btn’) || targetBtn.classList.contains(‘save-btn’) || targetBtn.classList.contains(‘follow-btn-post’)) {
showToast(‘Увійдіть, щоб виконати цю дію’);
return;
}
}
if (targetBtn.classList.contains(‘like-btn’)) {
const postId = targetBtn.dataset.postId;
const { toggleLike } = await import(’./posts.js’);
toggleLike(postId, targetBtn);
}
if (targetBtn.classList.contains(‘save-btn’)) {
const postId = targetBtn.dataset.postId;
const { toggleSave } = await import(’./posts.js’);
toggleSave(postId, targetBtn);
}
}

```
  const uidElement = e.target.closest('[data-uid]');
  if (uidElement) {
    const uid = uidElement.dataset.uid;
    if (uid) viewProfile(uid);
  }
} catch (error) {
  console.error('Click handler error:', error);
}
```

});
});

// ================= onAuthStateChanged =================
onAuthStateChanged(auth, (user) => {
try {
cleanupAllListeners();

```
if (user) {
  setCurrentUser(user);
  startHeartbeat(user);
  hideAuthBox(); // ВИПРАВЛЕННЯ: використовуємо хелпер що також керує body.auth-visible

  const userRef = doc(db, "users", user.uid);
  const unsubFollowing = onSnapshot(userRef, (docSnap) => {
    try {
      if (docSnap.exists()) {
        setCurrentUserData(docSnap.data());
        if (docSnap.data().settings) {
          const s = docSnap.data().settings;
          state.userSettings = {
            ...state.userSettings, ...s,
            notifications: { ...state.userSettings.notifications, ...(s.notifications || {}) },
            privacy: { ...state.userSettings.privacy, ...(s.privacy || {}) },
            preferences: { ...state.userSettings.preferences, ...(s.preferences || {}) },
            security: { ...state.userSettings.security, ...(s.security || {}) }
          };
        }
        applySettings();
        document.querySelectorAll('.follow-btn-post').forEach(btn => {
          const targetUid = btn.dataset.uid;
          if (targetUid) {
            const isFollowing = state.currentUserFollowing.includes(targetUid);
            btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
            btn.classList.toggle('following', isFollowing);
          }
        });
      }
    } catch (error) {
      console.error('Following snapshot error:', error);
    }
  }, (error) => {
    console.error('Error in following snapshot:', error);
  });
  setUnsubscribeFollowing(unsubFollowing);

  if (unsubscribeChatList) {
    try { unsubscribeChatList(); } catch (e) { console.error('Unsubscribe chatList error:', e); }
  }

  const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
  unsubscribeChatList = onSnapshot(q, (snapshot) => {
    try {
      // ВИПРАВЛЕННЯ: пряме присвоєння totalUnread замість крихкої delta-логіки.
      // Попередній код рахував різницю і передавав у updateUnreadCount(delta),
      // що давало неправильні значення після cleanupAllListeners (скидав до 0).
      let totalUnread = 0;
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.unread?.[user.uid]) totalUnread += data.unread[user.uid];
      });
      state.unreadCount = totalUnread;
      updateUnreadBadge(totalUnread);

      if (document.getElementById('chats')?.classList.contains('active')) {
        loadChatList();
      }
    } catch (error) {
      console.error('Chat snapshot processing error:', error);
    }
  }, (error) => {
    console.error('Chat list snapshot error:', error);
    showToast('Помилка оновлення списку чатів.');
  });

  resetPagination();
  import('./profile.js').then(module => {
    try { module.loadMyProfile(); } catch (e) { console.error('Load profile error:', e); }
  });

} else {
  setCurrentUser(null);
  setCurrentUserData(null);
  stopHeartbeat();

  if (unsubscribeChatList) {
    try { unsubscribeChatList(); } catch (e) { console.error('Unsubscribe chatList logout error:', e); }
    unsubscribeChatList = null;
  }

  showAuthBox(); // ВИПРАВЛЕННЯ: використовуємо хелпер
  document.getElementById('newPostBox').style.display = 'none';
  updateUnreadBadge(0);
}
```

} catch (error) {
console.error(‘Auth state change error:’, error);
}
});

// ================= Пошук користувачів =================
async function loadSearchUsers() {
try {
if (!state.currentUser) return;
const val = document.getElementById(‘searchInput’)?.value.trim().toLowerCase() || ‘’;
const userList = document.getElementById(‘userList’);
if (!userList) return;
if (!val) { userList.innerHTML = ‘’; return; }

```
if (val.startsWith('#')) {
  const tag = val.substring(1);
  const q = query(collection(db, "posts"), where("hashtags", "array-contains", tag));
  const snapshot = await getDocs(q);

  userList.innerHTML = '<h3 style="margin-bottom:12px;">Пости з тегом</h3>';
  if (snapshot.empty) {
    userList.innerHTML += '<p>Немає постів з цим тегом</p>';
  } else {
    // ВИПРАВЛЕННЯ: renderPosts очікує string containerId а не DOM-елемент.
    // Даємо feedDiv унікальний id щоб getElementById його знайшов.
    const feedDiv = document.createElement('div');
    feedDiv.className = 'feed';
    feedDiv.id = 'searchResultsFeed';
    userList.appendChild(feedDiv);
    const { renderPosts } = await import('./posts.js');
    renderPosts(snapshot.docs, 'searchResultsFeed');
  }
  return;
}

const mySnap = await getDoc(doc(db, "users", state.currentUser.uid));
const myFollowing = mySnap.data()?.following || [];

const searchTerm = val.startsWith('@') ? val : `@${val}`;
const q1 = query(collection(db, "users"), where("userId", ">=", searchTerm), where("userId", "<=", searchTerm + '\uf8ff'));
const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));

const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
const usersMap = new Map();
snap1.forEach(d => usersMap.set(d.id, d.data()));
snap2.forEach(d => usersMap.set(d.id, d.data()));

userList.innerHTML = '';
usersMap.forEach((data, uid) => {
  if (uid === state.currentUser.uid) return;
  const isFollowing = myFollowing.includes(uid);
  const div = document.createElement('div');
  div.className = 'chat-item';
  div.tabIndex = 0;
  // ВИПРАВЛЕННЯ: escapeHtml для nickname, userId, avatar — захист від XSS
  div.innerHTML = `
    <div class="avatar small" style="background-image:url(${escapeHtml(data.avatar || '')})" tabindex="0"></div>
    <div class="chat-info">
      <div class="chat-name">${escapeHtml(data.nickname)}</div>
      <div class="chat-last">${escapeHtml(data.userId)}</div>
    </div>
    <button class="btn follow-btn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
  `;
  div.querySelector('.follow-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    try { await toggleFollow(uid, e.target); } catch (error) { console.error('Toggle follow error:', error); }
  });
  div.addEventListener('click', () => {
    try { viewProfile(uid); } catch (error) { console.error('View profile error:', error); }
  });
  userList.appendChild(div);
});
```

} catch (error) {
console.error(‘Load search users error:’, error);
showToast(‘Помилка при пошуку користувачів’);
}
}

// ================= Скидання пагінації =================
function resetPagination() {
try {
resetPaginationState();
const feed = document.getElementById(‘feed’);
if (feed) {
feed.innerHTML = ‘’;
loadMorePosts();
}
} catch (error) {
console.error(‘Reset pagination error:’, error);
}
}
