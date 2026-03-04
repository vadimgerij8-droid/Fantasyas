import { initAuth, setOnUserChangeCallback, register, login, googleLogin, appleLogin, forgotPassword } from './auth.js';
import { loadFeed, resetPagination, clearMainFeedListeners } from './posts.js';
import { loadChatList, openChat, sendMessage } from './chat.js';
import { viewProfile, toggleFollow } from './profile.js';
import { loadSettings, saveSettings } from './settings.js';
import { loadSearchUsers, loadHashtags, loadFilterHashtags } from './search.js';
import {
  getCurrentUser,
  setCurrentUserFollowing,
  setUnreadCount,
  getNavigationHistory,
  setNavigationHistory,
  getPreviousSection,
  setPreviousSection
} from './state.js';
import {
  showToast,
  updateUnreadBadge,
  setupEmojiPicker,
  setupFileInput
} from './utils.js';

let unsubscribeFollowing = null;
let unsubscribeChatList = null;

document.addEventListener('DOMContentLoaded', () => {
  // Ініціалізація аутентифікації
  setOnUserChangeCallback(handleUserChange);
  initAuth();

  // Навігація
  setupNavigation();

  // Форми авторизації
  document.getElementById('registerBtn').addEventListener('click', onRegister);
  document.getElementById('loginBtn').addEventListener('click', onLogin);
  document.getElementById('googleLoginBtn').addEventListener('click', googleLogin);
  document.getElementById('appleLoginBtn').addEventListener('click', appleLogin);
  document.getElementById('forgotPassword').addEventListener('click', onForgotPassword);
  document.getElementById('toRegister').addEventListener('click', () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
  });
  document.getElementById('toLogin').addEventListener('click', () => {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
  });

  // Емоджі-пікери та файлові інпути
  setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
  setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');
  setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
  setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostPreview');

  // Кнопка "Назад"
  document.querySelector('.back-btn').addEventListener('click', onBack);

  // Модалка фільтрів
  document.getElementById('filterBtn')?.addEventListener('click', () => {
    document.getElementById('filterModal').classList.add('active');
    loadFilterHashtags();
  });
  document.getElementById('closeFilterModal')?.addEventListener('click', () => {
    document.getElementById('filterModal').classList.remove('active');
  });

  // Відправка повідомлення
  document.getElementById('sendChatBtn')?.addEventListener('click', () => {
    const input = document.getElementById('chatText');
    sendMessage(input.value);
  });

  // Нескінченне завантаження стрічки
  window.addEventListener('scroll', () => {
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 500) {
      if (document.getElementById('home').classList.contains('active')) {
        loadFeed();
      }
    }
  });
});

// ================= Обробник зміни користувача =================
function handleUserChange(user) {
  if (user) {
    document.getElementById('authBox').style.display = 'none';
    document.getElementById('newPostBox').style.display = 'block';

    startFollowingListener();
    startChatUnreadListener();

    document.querySelector('[data-section="home"]').click();
  } else {
    document.getElementById('authBox').style.display = 'block';
    document.getElementById('newPostBox').style.display = 'none';

    if (unsubscribeFollowing) unsubscribeFollowing();
    if (unsubscribeChatList) unsubscribeChatList();
    clearMainFeedListeners();

    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('registerForm').style.display = 'none';
    const sections = ['home','search','hashtags','profile','chats','settings'];
    sections.forEach(s => document.getElementById(s).classList.remove('active'));
    document.getElementById('home').classList.add('active');
  }
}

// ================= Слухач змін following =================
function startFollowingListener() {
  const user = getCurrentUser();
  if (!user) return;
  import('./config.js').then(({ db }) => {
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(({ doc, onSnapshot }) => {
      const userRef = doc(db, "users", user.uid);
      unsubscribeFollowing = onSnapshot(userRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCurrentUserFollowing(data.following || []);
          // Оновити кнопки підписки на постах (якщо потрібно)
          document.querySelectorAll('.follow-btn-post').forEach(btn => {
            const targetUid = btn.dataset.uid;
            if (targetUid) {
              const isFollowing = data.following?.includes(targetUid);
              btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
              btn.classList.toggle('following', isFollowing);
            }
          });
        }
      });
    });
  });
}

// ================= Слухач непрочитаних чатів =================
function startChatUnreadListener() {
  const user = getCurrentUser();
  if (!user) return;
  import('./config.js').then(({ db }) => {
    import('https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js').then(({ collection, query, where, onSnapshot }) => {
      const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
      unsubscribeChatList = onSnapshot(q, (snapshot) => {
        let total = 0;
        snapshot.forEach(doc => {
          const data = doc.data();
          if (data.unread && data.unread[user.uid]) {
            total += data.unread[user.uid];
          }
        });
        setUnreadCount(total);
        updateUnreadBadge(total);
        if (document.getElementById('chats')?.classList.contains('active')) {
          loadChatList();
        }
      });
    });
  });
}

// ================= Навігація =================
function setupNavigation() {
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');
  const sections = ['home','search','hashtags','profile','chats','settings'];

  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const section = item.dataset.section;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      sections.forEach(s => document.getElementById(s).classList.remove('active'));
      const sectionEl = document.getElementById(section);
      if (sectionEl) sectionEl.classList.add('active');
      const span = item.querySelector('span');
      document.getElementById('pageTitle').textContent = span ? span.textContent : item.textContent.trim();

      const prev = getPreviousSection();
      if (prev !== section) {
        setNavigationHistory([...getNavigationHistory(), prev]);
        setPreviousSection(section);
      }

      document.getElementById('chatWindowContainer').style.display = 'none';
      document.getElementById('chatListSidebar').classList.remove('hide');
      document.querySelector('.bottom-nav').classList.remove('hide-chat-mode');
      document.querySelector('.back-btn').classList.remove('visible');

      if (section === 'home' && getCurrentUser()) {
        resetPagination();
      }
      if (section === 'search' && getCurrentUser()) {
        await loadSearchUsers();
      }
      if (section === 'hashtags' && getCurrentUser()) {
        await loadHashtags();
      }
      if (section === 'chats' && getCurrentUser()) {
        document.getElementById('chatWindowContainer').style.display = 'none';
        document.getElementById('chatListSidebar').classList.remove('hide');
        document.getElementById('chatSearchInput').value = '';
        document.getElementById('chatSearchResults').style.display = 'none';
        await loadChatList();
      }
      if (section === 'profile' && getCurrentUser()) {
        await viewProfile(getCurrentUser().uid);
      }
      if (section === 'settings') {
        loadSettings();
      }
    });
  });
}

// ================= Кнопка "Назад" =================
function onBack() {
  const history = getNavigationHistory();
  if (history.length > 0) {
    const prev = history.pop();
    setNavigationHistory(history);
    setPreviousSection(prev);
    const navItem = document.querySelector(`.nav-item[data-section="${prev}"]`);
    if (navItem) navItem.click();
  }
}

// ================= Обробники форм =================
async function onRegister() {
  const nickname = document.getElementById('registerNickname').value.trim();
  const password = document.getElementById('registerPassword').value.trim();
  const success = await register(nickname, password);
  if (success) {
    document.getElementById('toLogin').click();
  }
}

async function onLogin() {
  const nickname = document.getElementById('loginNickname').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  await login(nickname, password);
}

async function onForgotPassword(e) {
  e.preventDefault();
  const nickname = prompt('Введіть ваш псевдонім (без @)');
  if (nickname) await forgotPassword(nickname);
}
