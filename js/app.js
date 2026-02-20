import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, onSnapshot, updateDoc, serverTimestamp, collection, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { showToast, updateUnreadBadge, setupEmojiPicker, setupFileInput } from './helpers.js';
import { initAuth } from './auth.js';
import { initFeed, setCurrentUser, updateFollowing, loadMorePosts } from './feed.js';
import { initProfile, viewProfile, loadMyProfile } from './profile.js';
import { initChats, loadChatList, openChat, cleanupChatListeners } from './chats.js';
import { initTVNavigation } from './tv-navigation.js';

// Глобальні змінні стану
let currentUser = null;
let currentUserFollowing = [];
let unreadCount = 0;
let lastOnlineInterval = null;
let unsubscribeFollowing = null;

// Функція для очищення слухачів
function cleanupListeners() {
  if (unsubscribeFollowing) unsubscribeFollowing();
  if (lastOnlineInterval) clearInterval(lastOnlineInterval);
  cleanupChatListeners();
}

// Ініціалізація додатку після логіну
function onUserLogin(user) {
  currentUser = user;
  setCurrentUser(user);

  // Показати/сховати блоки
  document.getElementById('authBox').style.display = 'none';
  document.getElementById('newPostBox').style.display = 'block';

  // Оновлення lastOnline кожні 30 секунд
  lastOnlineInterval = setInterval(() => {
    updateDoc(doc(db, "users", currentUser.uid), { lastOnline: serverTimestamp() }).catch(console.error);
  }, 30000);

  // Підписка на зміну списку following
  const userRef = doc(db, "users", currentUser.uid);
  unsubscribeFollowing = onSnapshot(userRef, (docSnap) => {
    if (docSnap.exists()) {
      currentUserFollowing = docSnap.data().following || [];
      updateFollowing(currentUserFollowing);
    }
  });

  // Ініціалізація модулів
  initFeed(currentUser, currentUserFollowing);
  initProfile(currentUser);
  initChats(currentUser);

  // Завантаження профілю
  loadMyProfile();

  // Підписка на список чатів для бейджа
  const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
  onSnapshot(q, (snapshot) => {
    let totalUnread = 0;
    snapshot.forEach(doc => {
      const data = doc.data();
      if (data.unread && data.unread[currentUser.uid]) {
        totalUnread += data.unread[currentUser.uid];
      }
    });
    unreadCount = totalUnread;
    updateUnreadBadge(unreadCount);
    if (document.getElementById('chats').classList.contains('active')) {
      loadChatList();
    }
  });

  // Налаштування емоджі та файлових інпутів (деякі вже в feed)
  setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
  setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');
  setupFileInput('postMedia', 'postMediaLabel', 'postMediaPreview');
  setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
  setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostMediaPreview');

  // Фокус на контент
  setTimeout(() => {
    const content = document.querySelector('.content');
    if (content) {
      content.setAttribute('tabindex', '-1');
      content.focus({ preventScroll: true });
    }
    window.updateFocusableCache();
    window.setFocusOnElement?.(document.querySelector('.nav-item.active'));
  }, 500);
}

function onUserLogout() {
  currentUser = null;
  setCurrentUser(null);
  cleanupListeners();

  document.getElementById('authBox').style.display = 'block';
  document.getElementById('newPostBox').style.display = 'none';
  unreadCount = 0;
  updateUnreadBadge(0);

  setTimeout(() => {
    window.updateFocusableCache();
    window.setFocusOnElement?.(document.querySelector('.nav-item.active'));
  }, 500);
}

// Навігація по розділах
const sections = ['home','search','hashtags','profile','chats','settings'];
const navItems = document.querySelectorAll('.nav-item');
navItems.forEach((item) => {
  item.addEventListener('click', () => {
    const section = item.dataset.section;
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    sections.forEach(s => document.getElementById(s).classList.remove('active'));
    const sectionEl = document.getElementById(section);
    if (sectionEl) sectionEl.classList.add('active');
    document.getElementById('pageTitle').textContent = item.textContent.trim();

    cleanupListeners();

    if (section === 'home' && currentUser) {
      // reset pagination? (вже в initFeed)
    }
    if (section === 'search' && currentUser) {
      if (window.loadSearchUsers) window.loadSearchUsers();
    }
    if (section === 'hashtags' && currentUser) {
      if (window.loadHashtags) window.loadHashtags();
    }
    if (section === 'chats' && currentUser) {
      document.getElementById('chatWindow').style.display = 'none';
      loadChatList();
      document.getElementById('chatSearchResults').style.display = 'none';
      document.getElementById('chatSearchInput').value = '';
    }
    if (section === 'profile' && currentUser) {
      viewProfile(currentUser.uid);
    }

    closeSidebar();
    setTimeout(() => { window.updateFocusableCache(); window.setFocusOnElement?.(document.querySelector('.nav-item.active')); }, 200);
  });
});

// Бокове меню
const sidebar = document.getElementById('sidebar');
const menuToggle = document.getElementById('menuToggle');
const backdrop = document.getElementById('sidebarBackdrop');

function openSidebar() {
  sidebar.classList.add('open');
  menuToggle.classList.add('active');
  backdrop.classList.add('active');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  menuToggle.classList.remove('active');
  backdrop.classList.remove('active');
}

menuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  if (sidebar.classList.contains('open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
});

backdrop.addEventListener('click', closeSidebar);

// Налаштування
document.getElementById('toggleTheme').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

document.getElementById('privacyPolicyBtn').onclick = () => {
  document.getElementById('privacyPolicyModal').classList.add('active');
  setTimeout(() => { window.updateFocusableCache(); window.setFocusOnElement?.(document.getElementById('closePrivacyModal')); }, 50);
};
document.getElementById('closePrivacyModal').onclick = () => {
  document.getElementById('privacyPolicyModal').classList.remove('active');
  setTimeout(() => { window.updateFocusableCache(); window.setFocusOnElement?.(document.querySelector('.nav-item.active')); }, 50);
};

document.getElementById('logoutBtn').onclick = () => {
  cleanupListeners();
  auth.signOut();
};

// Безкінечна стрічка
const sentinel = document.getElementById('feedSentinel');
if (sentinel) {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMorePosts();
  }, { threshold: 0.5 });
  observer.observe(sentinel);
}

// Глобальний обробник для лайків/збережень (можна винести окремо, але поки тут)
document.addEventListener('click', async (e) => {
  if (!currentUser) return;
  const target = e.target.closest('button');
  if (!target) return;

  if (target.classList.contains('like-btn')) {
    const postId = target.dataset.postId;
    const liked = target.classList.contains('liked');
    const countSpan = target.querySelector('span');
    const oldCount = parseInt(countSpan.textContent);
    target.classList.toggle('liked');
    countSpan.textContent = liked ? oldCount - 1 : oldCount + 1;
    try {
      const postRef = doc(db, "posts", postId);
      if (liked) {
        await updateDoc(postRef, { likes: arrayRemove(currentUser.uid), likesCount: increment(-1) });
        await updateDoc(doc(db, "users", currentUser.uid), { likedPosts: arrayRemove(postId) });
      } else {
        await updateDoc(postRef, { likes: arrayUnion(currentUser.uid), likesCount: increment(1) });
        await updateDoc(doc(db, "users", currentUser.uid), { likedPosts: arrayUnion(postId) });
        vibrate(30);
      }
    } catch {
      target.classList.toggle('liked');
      countSpan.textContent = oldCount;
    }
  }

  if (target.classList.contains('save-btn')) {
    const postId = target.dataset.postId;
    const saved = target.classList.contains('saved');
    target.classList.toggle('saved');
    try {
      const userRef = doc(db, "users", currentUser.uid);
      const postRef = doc(db, "posts", postId);
      if (saved) {
        await updateDoc(userRef, { savedPosts: arrayRemove(postId) });
        await updateDoc(postRef, { saves: arrayRemove(currentUser.uid) });
      } else {
        await updateDoc(userRef, { savedPosts: arrayUnion(postId) });
        await updateDoc(postRef, { saves: arrayUnion(currentUser.uid) });
      }
    } catch { target.classList.toggle('saved'); }
  }
});

// Клік по [data-uid] для переходу в профіль
document.addEventListener('click', (e) => {
  const uidElement = e.target.closest('[data-uid]');
  if (uidElement) {
    const uid = uidElement.dataset.uid;
    viewProfile(uid);
  }
});

// Ініціалізація авторизації
initAuth(onUserLogin, onUserLogout);

// Ініціалізація TV-навігації
initTVNavigation();

// Експорт деяких функцій у window для доступу з інших модулів
window.loadSearchUsers = () => {
  // функція пошуку з profile.js? поки що залишимо заглушку
};
window.loadHashtags = () => {
  // функція з hashtags (потрібно додати окремий модуль або реалізувати тут)
  // Для простоти можна винести в окремий файл, але поки що реалізуємо тут.
  import('./hashtags.js').then(module => module.loadHashtags());
};
window.openChat = openChat;
