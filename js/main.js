import { auth, db } from './config.js';
import { currentUser, setCurrentUser, setCurrentUserData, setLastOnlineInterval, setUnsubscribeFollowing, cleanupAllListeners, userSettings, updateUnreadBadge, resetPaginationState } from './state.js';
import { showToast, updateLastOnline, setupEmojiPicker, setupFileInput, debounce } from './utils.js';
import { register, login, googleLogin, appleLogin, resetPassword, logout } from './auth.js';
import { loadMorePosts } from './posts.js';
import { viewProfile, saveProfileEdit } from './profile.js';
import { loadChatList, searchUsersForChat, closeChat } from './chat.js';
import { loadSettings, setupSettingsListeners } from './settings.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, onSnapshot, collection, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
  const sections = ['home','search','hashtags','profile','chats','settings'];
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');

  navItems.forEach(item => {
    item.addEventListener('click', async () => {
      const section = item.dataset.section;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      sections.forEach(s => document.getElementById(s).classList.remove('active'));
      const sectionEl = document.getElementById(section);
      if (sectionEl) sectionEl.classList.add('active');
      document.getElementById('pageTitle').textContent = item.querySelector('span')?.textContent || section;

      if (section !== 'chats') {
        document.getElementById('chatWindowContainer').style.display = 'none';
        document.getElementById('chatListSidebar').classList.remove('hide');
        document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');
      }

      if (!currentUser) return;

      if (section === 'home') loadMorePosts();
      else if (section === 'profile') viewProfile(currentUser.uid);
      else if (section === 'chats') loadChatList();
      else if (section === 'settings') loadSettings();
    });
  });

  // Авторизація
  document.getElementById('toRegister').onclick = () => { document.getElementById('loginForm').style.display = 'none'; document.getElementById('registerForm').style.display = 'block'; };
  document.getElementById('toLogin').onclick = () => { document.getElementById('registerForm').style.display = 'none'; document.getElementById('loginForm').style.display = 'block'; };
  document.getElementById('registerBtn').onclick = async () => { await register(document.getElementById('registerNickname').value.trim(), document.getElementById('registerPassword').value.trim()); };
  document.getElementById('loginBtn').onclick = async () => { await login(document.getElementById('loginNickname').value.trim(), document.getElementById('loginPassword').value.trim()); };
  document.getElementById('googleLoginBtn').onclick = googleLogin;
  document.getElementById('appleLoginBtn').onclick = appleLogin;
  document.getElementById('forgotPassword').onclick = async (e) => { e.preventDefault(); const nickname = prompt('Введіть псевдонім'); if (nickname) await resetPassword(nickname); };
  document.getElementById('logoutBtn').onclick = () => { cleanupAllListeners(); logout(); };

  // Пости
  document.getElementById('addPost').onclick = async () => { /* буде реалізовано пізніше */ showToast('Функція створення поста тимчасово недоступна'); };

  // Редагування профілю
  document.getElementById('saveProfileEdit').onclick = async () => {
    await saveProfileEdit(
      document.getElementById('editNickname').value.trim(),
      document.getElementById('editBio').value.trim(),
      document.getElementById('editNote').value.trim(),
      document.getElementById('editAvatar').files[0]
    );
  };
  document.getElementById('closeModal').onclick = () => document.getElementById('editProfileModal').classList.remove('active');

  // Чати
  document.getElementById('chatBackBtn').addEventListener('click', closeChat);
  document.getElementById('sendMessage').addEventListener('click', () => showToast('Відправка повідомлень тимчасово недоступна'));

  let searchTimeout;
  document.getElementById('chatSearchInput').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const val = e.target.value.trim();
    if (!val) { document.getElementById('chatSearchResults').style.display = 'none'; return; }
    searchTimeout = setTimeout(() => searchUsersForChat(val), 300);
  });

  // Налаштування – вкладки
  const settingsNavItems = document.querySelectorAll('.settings-nav-item');
  settingsNavItems.forEach(item => {
    item.addEventListener('click', () => {
      const tab = item.dataset.tab;
      settingsNavItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
      const target = document.getElementById(`settings-${tab}`);
      if (target) target.classList.add('active');
    });
  });
  if (settingsNavItems.length) settingsNavItems[0].click();

  // Ініціалізація додаткових компонентів
  setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
  setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');
  setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
  setupSettingsListeners();

  if (currentUser) loadMorePosts();
});

onAuthStateChanged(auth, (user) => {
  cleanupAllListeners();
  if (user) {
    setCurrentUser(user);
    document.getElementById('authBox').style.display = 'none';
    document.getElementById('newPostBox').style.display = 'block';

    const interval = setInterval(updateLastOnline, 30000);
    setLastOnlineInterval(interval);

    const userRef = doc(db, "users", user.uid);
    const unsubFollowing = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        setCurrentUserData(docSnap.data());
        if (docSnap.data().settings) {
          Object.assign(userSettings, docSnap.data().settings);
          if (userSettings.preferences.darkMode) document.body.classList.add('dark'); else document.body.classList.remove('dark');
        }
      }
    });
    setUnsubscribeFollowing(unsubFollowing);

    const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
    onSnapshot(q, (snapshot) => {
      let totalUnread = 0;
      snapshot.forEach(doc => { const data = doc.data(); if (data.unread && data.unread[user.uid]) totalUnread += data.unread[user.uid]; });
      updateUnreadBadge(totalUnread);
    });

    loadMorePosts();
  } else {
    setCurrentUser(null);
    setCurrentUserData(null);
    document.getElementById('authBox').style.display = 'block';
    document.getElementById('newPostBox').style.display = 'none';
    updateUnreadBadge(0);
  }
});
