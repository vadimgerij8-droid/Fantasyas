// ================= Firebase імпорти =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, OAuthProvider, signInWithPopup, sendPasswordResetEmail, updateEmail, updatePassword, reauthenticateWithCredential, EmailAuthProvider, deleteUser } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, arrayUnion, arrayRemove, deleteDoc, getDocs, increment, limit, startAfter, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ================= Конфігурація =================
const firebaseConfig = {
  apiKey: "AIzaSyDRzC-QDE0-UXd-XL0i3iqayFiKcc6wmvc",
  authDomain: "fantasyasapp.firebaseapp.com",
  projectId: "fantasyasapp",
  storageBucket: "fantasyasapp.appspot.com",
  messagingSenderId: "721763921060",
  appId: "1:721763921060:web:3d61044ea2424e8176ca31"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ================= Глобальні змінні =================
let currentUser = null;
let currentUserData = null;
let currentUserFollowing = [];
let currentChatPartner = null;
let currentChatPartnerName = '';
let currentChatPartnerAvatar = '';
let currentChatPartnerUserId = '';
let currentChatId = null;
let currentProfileUid = null;
let currentEditingPost = null;
let replyContext = null; // { messageId, text, senderName }

let unsubscribeFeed = null;
let unsubscribeChatList = null;
let unsubscribeMessages = null;
let unsubscribeTyping = null;
let unsubscribeChatPresence = null;
let unsubscribeFollowing = null;
let lastOnlineInterval = null;

let unreadCount = 0;
let currentFeedType = 'new';
let lastVisible = null;
let loading = false;
let hasMore = true;

const viewedPosts = new Set();
let currentFilterHashtag = null;
const postListeners = new Map();

// Історія навігації для кнопки "Назад"
let navigationHistory = []; // масив ідентифікаторів попередніх секцій
let previousSection = null;

// ================= ОНОВЛЕНИЙ СТАН НАЛАШТУВАНЬ =================
const userSettings = {
  notifications: {
    push: true,
    email: true,
    sms: false,
    privateChats: true,
    likes: true,
    comments: true,
    newFollowers: true,
    mentions: true,
    directMessages: true,
    storyReplies: true
  },
  privacy: {
    privateAccount: false,
    activityStatus: true,
    storySharing: true,
    allowTags: 'everyone',
    allowMentions: 'everyone',
    blockedAccounts: [],
    whoCanMessage: 'everyone',
    whoCanSeeOnline: 'everyone',
    whoCanSeeFollowers: 'everyone'
  },
  security: {
    twoFactor: false,
    loginAlerts: true,
    savedLogins: []
  },
  preferences: {
    language: 'uk',
    darkMode: false,
    reduceMotion: false,
    highContrast: false,
    autoplayVideos: true,
    soundEffects: true
  }
};

// ================= Допоміжні функції =================
const showToast = (msg) => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
};

const vibrate = (ms) => { if (navigator.vibrate) navigator.vibrate(ms); };

const updateUnreadBadge = () => {
  const badge = document.getElementById('unreadBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
};

const clearMainFeedListeners = () => {
  postListeners.forEach((unsubscribe) => unsubscribe());
  postListeners.clear();
};

const cleanupListeners = () => {
  if (unsubscribeFeed) { unsubscribeFeed(); unsubscribeFeed = null; }
  if (unsubscribeChatList) { unsubscribeChatList(); unsubscribeChatList = null; }
  if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
  if (unsubscribeTyping) { unsubscribeTyping(); unsubscribeTyping = null; }
  if (unsubscribeChatPresence) { unsubscribeChatPresence(); unsubscribeChatPresence = null; }
  if (unsubscribeFollowing) { unsubscribeFollowing(); unsubscribeFollowing = null; }
  if (lastOnlineInterval) { clearInterval(lastOnlineInterval); lastOnlineInterval = null; }
  clearMainFeedListeners();
};

// ================= Дебаунс =================
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ================= Функції для скарг, мюту, блокування =================
async function reportUser(targetUid, reason = '') {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "reports"), {
      reportedUserId: targetUid,
      reporterId: currentUser.uid,
      reason: reason || 'Без причини',
      timestamp: serverTimestamp()
    });
    showToast('Скаргу надіслано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function muteUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      mutedUsers: arrayUnion(targetUid)
    });
    showToast('Користувача замучено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function unmuteUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      mutedUsers: arrayRemove(targetUid)
    });
    showToast('Користувача розмучено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function blockUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      blockedUsers: arrayUnion(targetUid)
    });
    showToast('Користувача заблоковано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

async function unblockUser(targetUid) {
  if (!currentUser) return;
  const userRef = doc(db, "users", currentUser.uid);
  try {
    await updateDoc(userRef, {
      blockedUsers: arrayRemove(targetUid)
    });
    showToast('Користувача розблоковано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

// ================= Карти для запобігання паралельним викликам =================
const likePromiseMap = new Map();
const savePromiseMap = new Map();

// ================= Функція перемикання лайка (ВИПРАВЛЕНО) =================
const toggleLike = debounce(async (postId, buttonElement) => {
  if (!currentUser) {
    showToast('Увійдіть, щоб лайкати');
    return;
  }

  if (likePromiseMap.has(postId)) {
    return;
  }

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

// ================= Функція збереження поста (ВИПРАВЛЕНО) =================
const toggleSave = debounce(async (postId, buttonElement) => {
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

// ================= Функція підписки/відписки =================
const toggleFollow = debounce(async (targetUid, buttonElement) => {
  if (!currentUser) return;

  const wasFollowing = currentUserFollowing.includes(targetUid);
  const newFollowingState = !wasFollowing;

  if (newFollowingState) {
    currentUserFollowing.push(targetUid);
  } else {
    currentUserFollowing = currentUserFollowing.filter(id => id !== targetUid);
  }

  if (buttonElement) {
    buttonElement.textContent = newFollowingState ? 'Відписатися' : 'Підписатися';
    buttonElement.classList.toggle('following', newFollowingState);
  }

  try {
    const myRef = doc(db, "users", currentUser.uid);
    const targetRef = doc(db, "users", targetUid);
    const batch = writeBatch(db);

    if (wasFollowing) {
      batch.update(myRef, { following: arrayRemove(targetUid) });
      batch.update(targetRef, { followers: arrayRemove(currentUser.uid) });
    } else {
      batch.update(myRef, { following: arrayUnion(targetUid) });
      batch.update(targetRef, { followers: arrayUnion(currentUser.uid) });
      vibrate(30);
    }
    await batch.commit();
  } catch (error) {
    console.error('Follow error:', error);
    if (newFollowingState) {
      currentUserFollowing = currentUserFollowing.filter(id => id !== targetUid);
    } else {
      currentUserFollowing.push(targetUid);
    }
    if (buttonElement) {
      buttonElement.textContent = wasFollowing ? 'Відписатися' : 'Підписатися';
      buttonElement.classList.toggle('following', wasFollowing);
    }
    if (error.code === 'permission-denied') {
      showToast('Помилка: недостатньо прав. Перевірте правила безпеки Firestore.');
    } else {
      showToast('Помилка: ' + (error.message || 'Невідома помилка'));
    }
  }
}, 300);

// ================= Навігація по розділах =================
const sections = ['home','search','hashtags','profile','chats','settings'];
const navItems = document.querySelectorAll('.bottom-nav .nav-item');

navItems.forEach((item) => {
  item.addEventListener('click', async () => {
    const section = item.dataset.section;
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    sections.forEach(s => document.getElementById(s).classList.remove('active'));
    const sectionEl = document.getElementById(section);
    if (sectionEl) sectionEl.classList.add('active');
    const span = item.querySelector('span');
    document.getElementById('pageTitle').textContent = span ? span.textContent : item.textContent.trim();
    
    // Запам'ятовуємо попередню секцію для кнопки "Назад"
    if (previousSection !== section) {
      navigationHistory.push(previousSection);
      previousSection = section;
    }
    
    cleanupListeners();
    
    const chatWindow = document.getElementById('chatWindowContainer');
    if (chatWindow) chatWindow.style.display = 'none';
    const chatSidebar = document.getElementById('chatListSidebar');
    if (chatSidebar) chatSidebar.classList.remove('hide');
    document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');
    // Сховати кнопку "Назад" при переході на головні розділи
    document.querySelector('.back-btn').classList.remove('visible');
    
    if (section === 'home' && currentUser) {
      resetPagination();
    }
    if (section === 'search' && currentUser) {
      await loadSearchUsers();
    }
    if (section === 'hashtags' && currentUser) {
      await loadHashtags();
    }
    if (section === 'chats' && currentUser) {
      document.getElementById('chatWindowContainer').style.display = 'none';
      document.getElementById('chatListSidebar').classList.remove('hide');
      document.getElementById('chatSearchInput').value = '';
      document.getElementById('chatSearchResults').style.display = 'none';
      await loadChatList();
    }
    if (section === 'profile' && currentUser) {
      await viewProfile(currentUser.uid);
    }
    if (section === 'settings') {
      loadSettings();
    }
  });
});

// Кнопка "Назад" у верхній панелі
document.querySelector('.back-btn').addEventListener('click', () => {
  if (navigationHistory.length > 0) {
    const prev = navigationHistory.pop();
    previousSection = prev;
    // Активуємо відповідний пункт меню
    const navItem = document.querySelector(`.nav-item[data-section="${prev}"]`);
    if (navItem) navItem.click();
  }
});

// ================= Емоджі-пікер =================
const emojiList = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];

function closeAllEmojiPickers() {
  document.querySelectorAll('.emoji-picker').forEach(p => p.classList.remove('active'));
}

function setupEmojiPicker(buttonId, pickerId, inputId) {
  const btn = document.getElementById(buttonId);
  const picker = document.getElementById(pickerId);
  const input = document.getElementById(inputId);
  if (!btn || !picker || !input) return;
  
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isActive = picker.classList.contains('active');
    closeAllEmojiPickers();
    if (!isActive) {
      picker.classList.add('active');
    }
  });
  
  picker.innerHTML = '';
  emojiList.forEach(emoji => {
    const button = document.createElement('button');
    button.textContent = emoji;
    button.type = 'button';
    button.tabIndex = 0;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const text = input.value;
      input.value = text.substring(0, start) + emoji + text.substring(end);
      input.focus();
      input.selectionStart = input.selectionEnd = start + emoji.length;
      picker.classList.remove('active');
    });
    picker.appendChild(button);
  });
  
  document.addEventListener('click', (e) => {
    if (!picker.contains(e.target) && e.target !== btn) {
      picker.classList.remove('active');
    }
  });
}

// ================= Кастомний вибір файлу =================
function setupFileInput(inputId, labelId, previewId) {
  const input = document.getElementById(inputId);
  const label = document.getElementById(labelId);
  const preview = document.getElementById(previewId);
  if (!input || !label) return;

  input.addEventListener('change', function() {
    if (this.files && this.files[0]) {
      const file = this.files[0];
      label.textContent = file.name.length > 30 ? file.name.substring(0,30)+'…' : file.name;
      
      if (preview) {
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (e) => {
            preview.src = e.target.result;
            preview.classList.add('show');
          };
          reader.readAsDataURL(file);
        } else if (file.type.startsWith('video/')) {
          preview.src = '';
          preview.classList.remove('show');
        }
      }
    } else {
      label.textContent = inputId.includes('Avatar') ? 'Обрати аватар' : 'Обрати фото/відео';
      if (preview) preview.classList.remove('show');
    }
  });
}

// ================= Функції для хештегів =================
function extractHashtags(text) {
  const regex = /#(\w+)/g;
  const matches = text.match(regex);
  return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

async function loadHashtags() {
  const list = document.getElementById('hashtagList');
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

function searchHashtag(tag) {
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.value = '#' + tag;
    document.querySelector('[data-section="search"]').click();
    loadSearchUsers();
  }
}

// ================= Функції для фільтрів =================
async function loadFilterHashtags() {
  const list = document.getElementById('filterList');
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

function applyFilter(tag) {
  currentFilterHashtag = tag;
  document.getElementById('filterModal').classList.remove('active');
  
  const activeDiv = document.getElementById('activeFilter');
  activeDiv.innerHTML = `#${tag} <button id="clearFilterChip">✕</button>`;
  document.getElementById('clearFilterChip').onclick = clearFilter;
  
  resetPagination();
}

function clearFilter() {
  currentFilterHashtag = null;
  document.getElementById('activeFilter').innerHTML = '';
  resetPagination();
}

// ================= АВТОРИЗАЦІЯ =================
document.getElementById('toRegister').onclick = () => {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
};
document.getElementById('toLogin').onclick = () => {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
};

document.getElementById('registerBtn').onclick = async () => {
  const nickname = document.getElementById('registerNickname').value.trim();
  const password = document.getElementById('registerPassword').value.trim();
  if (!nickname) {
    showToast('Введіть псевдонім');
    return;
  }
  if (password.length < 6) {
    showToast('Мінімум 6 символів');
    return;
  }
  
  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    showToast('Цей ID вже зайнятий');
    return;
  }
  
  try {
    const safeNick = nickname.toLowerCase().replace(/[^a-z0-9]/g, '');
    const randomSuffix = Math.floor(Math.random() * 10000);
    const email = `${safeNick}_${randomSuffix}@fantasyas.local`;
    
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    
    await setDoc(doc(db, "users", cred.user.uid), {
      nickname,
      userId,
      nickname_lower: nickname.toLowerCase().trim(),
      bio: '',
      avatar: '',
      note: '', // поле для нотатки
      posts: [],
      likedPosts: [],
      savedPosts: [],
      followers: [],
      following: [],
      mutedUsers: [],
      blockedUsers: [],
      settings: { ...userSettings },
      createdAt: serverTimestamp(),
      lastOnline: serverTimestamp(),
      email: email
    });
    
    showToast('Реєстрація успішна');
    document.getElementById('toLogin').click();
  } catch (e) { showToast(e.message); }
};

document.getElementById('loginBtn').onclick = async () => {
  const nickname = document.getElementById('loginNickname').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (!nickname || !password) {
    showToast('Заповніть поля');
    return;
  }
  try {
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) {
      showToast('Користувача не знайдено');
      return;
    }
    
    const userDoc = snap.docs[0];
    const userData = userDoc.data();
    const email = userData.email;
    
    if (!email) {
      showToast('Для цього акаунту не встановлено email. Увійдіть через Google або Apple, або створіть новий акаунт.');
      return;
    }
    
    await signInWithEmailAndPassword(auth, email, password);
    showToast('Ласкаво просимо!');
  } catch (err) {
    showToast('Невірний псевдонім або пароль');
  }
};

// Google Login
document.getElementById('googleLoginBtn').onclick = async () => {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({
    prompt: 'select_account'
  });
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      const nickname = user.displayName || user.email?.split('@')[0] || 'user';
      let userId = `@${nickname.toLowerCase()}`;
      const q = query(collection(db, "users"), where("userId", "==", userId));
      const snap = await getDocs(q);
      if (!snap.empty) userId = `@${nickname.toLowerCase()}${Math.floor(Math.random()*1000)}`;
      await setDoc(doc(db, "users", user.uid), {
        nickname,
        userId,
        nickname_lower: nickname.toLowerCase().trim(),
        bio: '',
        avatar: user.photoURL || '',
        note: '',
        posts: [],
        likedPosts: [],
        savedPosts: [],
        followers: [],
        following: [],
        mutedUsers: [],
        blockedUsers: [],
        settings: { ...userSettings },
        createdAt: serverTimestamp(),
        lastOnline: serverTimestamp(),
        email: user.email
      });
    }
    showToast('Вхід через Google успішний');
  } catch (error) {
    console.error('Google login error:', error);
    if (error.code === 'auth/popup-blocked') {
      showToast('Будь ласка, дозвольте спливаючі вікна для цього сайту, щоб увійти через Google.');
    } else if (error.code === 'auth/operation-not-allowed') {
      showToast('Вхід через Google не налаштовано в Firebase. Перевірте консоль Firebase.');
    } else {
      showToast('Помилка входу: ' + error.message);
    }
  }
};

document.getElementById('appleLoginBtn').onclick = async () => {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  try {
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    const userDoc = await getDoc(doc(db, "users", user.uid));
    if (!userDoc.exists()) {
      const nickname = user.displayName || user.email?.split('@')[0] || 'user';
      let userId = `@${nickname.toLowerCase()}`;
      const q = query(collection(db, "users"), where("userId", "==", userId));
      const snap = await getDocs(q);
      if (!snap.empty) userId = `@${nickname.toLowerCase()}${Math.floor(Math.random()*1000)}`;
      await setDoc(doc(db, "users", user.uid), {
        nickname,
        userId,
        nickname_lower: nickname.toLowerCase().trim(),
        bio: '',
        avatar: user.photoURL || '',
        note: '',
        posts: [],
        likedPosts: [],
        savedPosts: [],
        followers: [],
        following: [],
        mutedUsers: [],
        blockedUsers: [],
        settings: { ...userSettings },
        createdAt: serverTimestamp(),
        lastOnline: serverTimestamp(),
        email: user.email
      });
    }
    showToast('Вхід через Apple успішний');
  } catch (error) {
    showToast('Помилка: ' + error.message);
  }
};

document.getElementById('forgotPassword').onclick = async (e) => {
  e.preventDefault();
  const nickname = prompt('Введіть ваш псевдонім (без @)');
  if (!nickname) return;
  
  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (snap.empty) {
    showToast('Користувача не знайдено');
    return;
  }
  
  const userData = snap.docs[0].data();
  const email = userData.email;
  if (!email) {
    showToast('Для цього акаунту не вказано email. Увійдіть через Google/Apple або створіть новий акаунт.');
    return;
  }
  
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Лист для скидання пароля відправлено');
  } catch (err) {
    showToast('Помилка: ' + err.message);
  }
};

onAuthStateChanged(auth, (user) => {
  cleanupListeners();
  
  if (user) {
    currentUser = user;
    currentProfileUid = user.uid;
    const authBox = document.getElementById('authBox');
    if (authBox) authBox.style.display = 'none';
    const newPostBox = document.getElementById('newPostBox');
    if (newPostBox) newPostBox.style.display = 'block';
    
    lastOnlineInterval = setInterval(() => {
      updateDoc(doc(db, "users", currentUser.uid), { lastOnline: serverTimestamp() }).catch(console.error);
    }, 30000);
    
    const userRef = doc(db, "users", currentUser.uid);
    unsubscribeFollowing = onSnapshot(userRef, (docSnap) => {
      if (docSnap.exists()) {
        currentUserData = docSnap.data();
        currentUserFollowing = docSnap.data().following || [];
        
        if (currentUserData.settings) {
          Object.assign(userSettings, currentUserData.settings);
          applySettings();
        }
        
        document.querySelectorAll('.follow-btn-post').forEach(btn => {
          const targetUid = btn.dataset.uid;
          if (targetUid) {
            const isFollowing = currentUserFollowing.includes(targetUid);
            btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
            btn.classList.toggle('following', isFollowing);
          }
        });
      }
    }, (error) => {
      console.error('Error in following snapshot:', error);
    });
    
    resetPagination();
    loadMyProfile();
    
    // Підписка на список чатів для оновлення непрочитаних
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
    unsubscribeChatList = onSnapshot(q, (snapshot) => {
      let totalUnread = 0;
      snapshot.forEach(doc => {
        const data = doc.data();
        if (data.unread && data.unread[currentUser.uid]) {
          totalUnread += data.unread[currentUser.uid];
        }
      });
      unreadCount = totalUnread;
      updateUnreadBadge();
      if (document.getElementById('chats')?.classList.contains('active')) {
        loadChatList();
      }
    }, (error) => {
      console.error('Chat list snapshot error:', error);
      showToast('Помилка оновлення списку чатів. Перевірте індекси Firestore.');
    });

    setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
    setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');

    setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
    setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostMediaPreview');

    const postMediaInput = document.getElementById('postMedia');
    const postMediaPreviews = document.getElementById('postMediaPreviews');
    const postMediaLabel = document.getElementById('postMediaLabel');

    if (postMediaInput) {
      postMediaInput.addEventListener('change', function() {
        postMediaPreviews.innerHTML = '';
        
        const files = Array.from(this.files);
        const maxFiles = 3;
        if (files.length > maxFiles) {
          showToast(`Можна вибрати не більше ${maxFiles} файлів`);
          this.value = '';
          return;
        }
        
        postMediaLabel.textContent = files.length ? `Вибрано ${files.length} файлів` : '+ Медіа (до 3 файлів)';
        
        files.forEach((file, index) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const previewContainer = document.createElement('div');
            previewContainer.style.position = 'relative';
            previewContainer.style.width = '80px';
            previewContainer.style.height = '80px';
            
            if (file.type.startsWith('image/')) {
              const img = document.createElement('img');
              img.src = e.target.result;
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.objectFit = 'cover';
              img.style.borderRadius = '8px';
              img.style.border = '1px solid var(--border)';
              previewContainer.appendChild(img);
            } else if (file.type.startsWith('video/')) {
              const video = document.createElement('video');
              video.src = e.target.result;
              video.style.width = '100%';
              video.style.height = '100%';
              video.style.objectFit = 'cover';
              video.style.borderRadius = '8px';
              video.style.border = '1px solid var(--border)';
              video.muted = true;
              video.preload = 'metadata';
              video.addEventListener('loadeddata', () => {
                video.currentTime = 0.1;
              });
              previewContainer.appendChild(video);
              
              const playIcon = document.createElement('span');
              playIcon.innerHTML = '▶️';
              playIcon.style.position = 'absolute';
              playIcon.style.top = '50%';
              playIcon.style.left = '50%';
              playIcon.style.transform = 'translate(-50%, -50%)';
              playIcon.style.fontSize = '24px';
              playIcon.style.opacity = '0.7';
              previewContainer.appendChild(playIcon);
            }
            
            const removeBtn = document.createElement('button');
            removeBtn.innerHTML = '✕';
            removeBtn.style.position = 'absolute';
            removeBtn.style.top = '-5px';
            removeBtn.style.right = '-5px';
            removeBtn.style.width = '22px';
            removeBtn.style.height = '22px';
            removeBtn.style.borderRadius = '50%';
            removeBtn.style.background = 'var(--danger)';
            removeBtn.style.color = 'white';
            removeBtn.style.border = 'none';
            removeBtn.style.cursor = 'pointer';
            removeBtn.style.fontSize = '14px';
            removeBtn.style.display = 'flex';
            removeBtn.style.alignItems = 'center';
            removeBtn.style.justifyContent = 'center';
            removeBtn.style.padding = '0';
            removeBtn.setAttribute('data-index', index);
            
            removeBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              const dt = new DataTransfer();
              const updatedFiles = files.filter((_, i) => i !== index);
              updatedFiles.forEach(f => dt.items.add(f));
              postMediaInput.files = dt.files;
              postMediaInput.dispatchEvent(new Event('change', { bubbles: true }));
            });
            
            previewContainer.appendChild(removeBtn);
            postMediaPreviews.appendChild(previewContainer);
          };
          reader.readAsDataURL(file);
        });
      });
    }
  } else {
    currentUser = null;
    currentUserData = null;
    currentUserFollowing = [];
    const authBox = document.getElementById('authBox');
    if (authBox) authBox.style.display = 'block';
    const newPostBox = document.getElementById('newPostBox');
    if (newPostBox) newPostBox.style.display = 'none';
    unreadCount = 0;
    updateUnreadBadge();
  }
});

// ================= Стрічка з кнопкою підписки =================
document.getElementById('feedNewBtn').onclick = () => {
  if (currentFeedType === 'new') return;
  currentFeedType = 'new';
  resetPagination();
};
document.getElementById('feedPopularBtn').onclick = () => {
  if (currentFeedType === 'popular') return;
  currentFeedType = 'popular';
  resetPagination();
};

function resetPagination() {
  lastVisible = null;
  hasMore = true;
  const feed = document.getElementById('feed');
  if (feed) {
    clearMainFeedListeners();
    feed.innerHTML = '';
  }
  loadMorePosts();
}

// ================= Функція завантаження на Cloudinary =================
async function uploadToCloudinary(file) {
  const CLOUD_NAME = 'dv6ehoqiq';
  const UPLOAD_PRESET = 'post_media';
  const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  const response = await fetch(url, {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.secure_url;
}

// ================= Додавання поста =================
document.getElementById('addPost').onclick = async () => {
  if (!currentUser) {
    showToast('Увійдіть, щоб опублікувати пост');
    return;
  }
  const text = document.getElementById('postText').value.trim();
  const fileInput = document.getElementById('postMedia');
  const files = fileInput.files ? Array.from(fileInput.files) : [];

  if (!text && files.length === 0) {
    showToast('Додайте текст або медіа');
    return;
  }

  const MAX_FILES = 3;
  if (files.length > MAX_FILES) {
    showToast(`Можна вибрати не більше ${MAX_FILES} файлів`);
    return;
  }

  try {
    showToast('Завантаження...');
    
    const media = [];
    for (const file of files) {
      const url = await uploadToCloudinary(file);
      media.push({
        url,
        type: file.type.split('/')[0]
      });
    }

    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userSnap.data();

    const hashtags = extractHashtags(text);

    const postDoc = await addDoc(collection(db, "posts"), {
      author: currentUser.uid,
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

    await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayUnion(postDoc.id) });

    document.getElementById('postText').value = '';
    fileInput.value = '';
    document.getElementById('postMediaPreviews').innerHTML = '';
    document.getElementById('postMediaLabel').textContent = '+ Медіа (до 3 файлів)';

    showToast('Пост опубліковано!');
  } catch (e) {
    console.error('Помилка створення поста:', e);
    showToast('Помилка: ' + e.message);
  }
};

// ================= Функція завантаження постів =================
async function loadMorePosts() {
  if (!currentUser || loading || !hasMore) return;
  loading = true;
  const skeleton = document.getElementById('skeletonContainer');
  if (skeleton) skeleton.style.display = 'block';
  
  try {
    let baseQuery;
    if (currentFilterHashtag) {
      baseQuery = query(collection(db, "posts"), where("hashtags", "array-contains", currentFilterHashtag));
    } else {
      baseQuery = collection(db, "posts");
    }

    let q;
    if (currentFeedType === 'new' || currentFilterHashtag) {
      q = query(baseQuery, orderBy("createdAt", "desc"), limit(10));
    } else {
      q = query(baseQuery, 
        orderBy("likesCount", "desc"), 
        orderBy("createdAt", "desc"), 
        limit(10)
      );
    }
    
    if (lastVisible) q = query(q, startAfter(lastVisible));
    
    const snapshot = await getDocs(q);
    if (snapshot.empty) { hasMore = false; return; }
    
    lastVisible = snapshot.docs[snapshot.docs.length - 1];
    renderPosts(snapshot.docs);
  } catch (e) {
    console.error("Помилка завантаження постів:", e);
    showToast("Помилка завантаження. Перевірте індекси Firestore.");
  } finally {
    if (skeleton) skeleton.style.display = 'none';
    loading = false;
  }
}

async function loadComments(postId, container) {
  const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
  const snapshot = await getDocs(q);
  container.innerHTML = '';
  snapshot.forEach(doc => {
    const comment = doc.data();
    const commentEl = document.createElement('div');
    commentEl.className = 'comment';
    commentEl.innerHTML = `
      <div class="comment-avatar" style="background-image:url(${comment.authorAvatar || ''})" data-uid="${comment.author}"></div>
      <div class="comment-content">
        <div>
          <span class="comment-author" data-uid="${comment.author}">${comment.authorName}</span>
          <span class="comment-time">${new Date(comment.createdAt?.seconds * 1000).toLocaleString()}</span>
        </div>
        <div class="comment-text">${comment.text}</div>
      </div>
    `;
    container.appendChild(commentEl);
  });
}

async function addComment(postId, text) {
  if (!currentUser || !text.trim()) return;
  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  const user = userSnap.data();
  const commentRef = collection(db, `posts/${postId}/comments`);
  await addDoc(commentRef, {
    author: currentUser.uid,
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

async function incrementPostView(postId) {
  if (!currentUser) return;
  if (viewedPosts.has(postId)) return;
  viewedPosts.add(postId);
  try {
    await updateDoc(doc(db, "posts", postId), { 
      views: increment(1),
      popularity: increment(5)
    });
  } catch (e) {
    console.warn("Не вдалося оновити перегляди:", e);
  }
}

// ================= Рендеринг постів =================
function renderPosts(docs, container = null) {
  const feed = container || document.getElementById('feed');
  if (!feed) return;
  docs.forEach(docSnap => {
    const post = { id: docSnap.id, ...docSnap.data() };
    const liked = post.likes?.includes(currentUser?.uid) || false;
    const saved = post.saves?.includes(currentUser?.uid) || false;
    const postTime = post.createdAt ? new Date(post.createdAt.seconds * 1000).toLocaleString() : '';
    const isAuthor = currentUser && post.author === currentUser.uid;
    const isFollowing = currentUserFollowing.includes(post.author);
    
    const postEl = document.createElement('div');
    postEl.className = 'post';
    postEl.dataset.postId = post.id;
    postEl.tabIndex = 0;
    
    let actionsHtml = '';
    if (isAuthor) {
      actionsHtml = `
        <div class="post-actions">
          <button class="edit-post-btn" title="Редагувати пост" tabindex="0">⋯</button>
        </div>
      `;
    }
    
    let contentHtml = post.text || '';
    const hashtagRegex = /#(\w+)/g;
    contentHtml = contentHtml.replace(hashtagRegex, '<span class="hashtag" data-tag="$1">#$1</span>');
    
    const followButtonHtml = !isAuthor && currentUser ? 
      `<button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${post.author}" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>` : '';
    
    postEl.innerHTML = `
      ${actionsHtml}
      <div class="post-header">
        <div class="avatar" style="background-image:url(${post.authorAvatar || ''})" data-uid="${post.author}" tabindex="0"></div>
        <div class="post-author-info">
          <div>
            <span class="post-author" data-uid="${post.author}" tabindex="0">${post.authorName || 'Невідомо'}</span>
            <span class="post-meta">${post.authorUserId || ''}</span>
            ${followButtonHtml}
          </div>
          <div class="post-time">${postTime}</div>
        </div>
      </div>
      <div class="post-content">${contentHtml}</div>
    `;

    // Галерея
    if (post.media && post.media.length > 0) {
      const gallery = document.createElement('div');
      gallery.className = 'post-gallery';
      gallery.setAttribute('data-current', 0);

      const inner = document.createElement('div');
      inner.className = 'gallery-inner';

      post.media.forEach((item, index) => {
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
      post.media.forEach((_, i) => {
        const dot = document.createElement('span');
        dot.className = i === 0 ? 'active' : '';
        indicators.appendChild(dot);
      });
      gallery.appendChild(indicators);

      const counter = document.createElement('div');
      counter.className = 'gallery-counter';
      counter.textContent = `1/${post.media.length}`;
      gallery.appendChild(counter);

      let startX = 0;
      inner.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
      });

      inner.addEventListener('touchend', (e) => {
        if (!startX) return;
        const endX = e.changedTouches[0].clientX;
        const diff = endX - startX;
        const current = parseInt(gallery.dataset.current);
        if (diff > 50 && current > 0) {
          gallery.dataset.current = current - 1;
        } else if (diff < -50 && current < post.media.length - 1) {
          gallery.dataset.current = current + 1;
        } else {
          return;
        }
        const newCurrent = parseInt(gallery.dataset.current);
        inner.style.transform = `translateX(-${newCurrent * 100}%)`;
        indicators.querySelectorAll('span').forEach((dot, i) => {
          dot.className = i === newCurrent ? 'active' : '';
        });
        counter.textContent = `${newCurrent + 1}/${post.media.length}`;
      });

      postEl.appendChild(gallery);
    } else if (post.mediaUrl) {
      const mediaEl = post.mediaType === 'image'
        ? `<img src="${post.mediaUrl}" class="post-media" loading="lazy" tabindex="0">`
        : `<video src="${post.mediaUrl}" controls class="post-media" tabindex="0"></video>`;
      postEl.innerHTML += mediaEl;
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

    incrementPostView(post.id);

    const followBtn = postEl.querySelector('.follow-btn-post');
    if (followBtn) {
      followBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetUid = followBtn.dataset.uid;
        toggleFollow(targetUid, followBtn);
      });
    }

    if (isAuthor) {
      postEl.querySelector('.edit-post-btn').onclick = () => openEditPostModal(post);
    }

    postEl.querySelectorAll('.hashtag').forEach(span => {
      span.onclick = (e) => {
        e.stopPropagation();
        const tag = span.dataset.tag;
        searchHashtag(tag);
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

    if (!container || container.id === 'feed') {
      const postRef = doc(db, "posts", post.id);
      const unsubscribe = onSnapshot(postRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const likeBtn = postEl.querySelector('.like-btn');
          if (likeBtn) {
            const liked = data.likes?.includes(currentUser?.uid) || false;
            const countSpan = likeBtn.querySelector('span');
            if (liked) {
              likeBtn.classList.add('liked');
            } else {
              likeBtn.classList.remove('liked');
            }
            if (countSpan) countSpan.textContent = data.likesCount || 0;
          }
          const saveBtn = postEl.querySelector('.save-btn');
          if (saveBtn) {
            const saved = data.saves?.includes(currentUser?.uid) || false;
            if (saved) {
              saveBtn.classList.add('saved');
            } else {
              saveBtn.classList.remove('saved');
            }
          }
        } else {
          if (postEl.parentNode) postEl.parentNode.removeChild(postEl);
          const unsub = postListeners.get(post.id);
          if (unsub) {
            unsub();
            postListeners.delete(post.id);
          }
        }
      }, (error) => {
        console.error(`Error listening to post ${post.id}:`, error);
      });
      postListeners.set(post.id, unsubscribe);
    }
  });
}

function openEditPostModal(post) {
  currentEditingPost = post;
  document.getElementById('editPostText').value = post.text || '';
  document.getElementById('editPostMedia').value = '';
  document.getElementById('editPostMediaLabel').textContent = 'Змінити медіа';
  const preview = document.getElementById('editPostMediaPreview');
  preview.classList.remove('show');
  if (post.mediaUrl) {
    if (post.mediaType === 'image') {
      preview.src = post.mediaUrl;
      preview.classList.add('show');
    }
  }
  document.getElementById('editPostModal').classList.add('active');
}

document.getElementById('closeEditPostModal').onclick = () => {
  document.getElementById('editPostModal').classList.remove('active');
  currentEditingPost = null;
};

document.getElementById('savePostEdit').onclick = async () => {
  if (!currentEditingPost || !currentUser) return;
  const newText = document.getElementById('editPostText').value.trim();
  const file = document.getElementById('editPostMedia').files[0];
  try {
    const postRef = doc(db, "posts", currentEditingPost.id);
    let updateData = { text: newText };
    updateData.hashtags = extractHashtags(newText);
    if (file) {
      const mediaUrl = await uploadToCloudinary(file);
      const mediaType = file.type.split('/')[0];
      updateData.mediaUrl = mediaUrl;
      updateData.mediaType = mediaType;
    }
    await updateDoc(postRef, updateData);
    showToast('Пост оновлено');
    document.getElementById('editPostModal').classList.remove('active');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
};

document.getElementById('deletePostBtn').onclick = async () => {
  if (!currentEditingPost || !currentUser) return;
  if (!confirm('Видалити пост?')) return;
  try {
    await deleteDoc(doc(db, "posts", currentEditingPost.id));
    await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayRemove(currentEditingPost.id) });
    showToast('Пост видалено');
    document.getElementById('editPostModal').classList.remove('active');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
};

async function loadSearchUsers() {
  if (!currentUser) return;
  const val = document.getElementById('searchInput').value.trim().toLowerCase();
  const userList = document.getElementById('userList');
  if (!val) { userList.innerHTML = ''; return; }

  if (val.startsWith('#')) {
    const tag = val.substring(1);
    const q = query(collection(db, "posts"), where("hashtags", "array-contains", tag));
    const snapshot = await getDocs(q);
    userList.innerHTML = '<h3 style="margin-bottom:12px;">Пости з тегом</h3>';
    if (snapshot.empty) {
      userList.innerHTML += '<p>Немає постів з цим тегом</p>';
    } else {
      const feedDiv = document.createElement('div');
      feedDiv.className = 'feed';
      userList.appendChild(feedDiv);
      renderPosts(snapshot.docs, feedDiv);
    }
    return;
  }
  
  const mySnap = await getDoc(doc(db, "users", currentUser.uid));
  const myFollowing = mySnap.data().following || [];
  
  const q1 = query(collection(db, "users"), where("userId", ">=", val.startsWith('@') ? val : `@${val}`), where("userId", "<=", (val.startsWith('@') ? val : `@${val}`) + '\uf8ff'));
  const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));
  
  const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
  const usersMap = new Map();
  snap1.forEach(d => usersMap.set(d.id, d.data()));
  snap2.forEach(d => usersMap.set(d.id, d.data()));
  
  userList.innerHTML = '';
  usersMap.forEach((data, uid) => {
    if (uid === currentUser.uid) return;
    const isFollowing = myFollowing.includes(uid);
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.tabIndex = 0;
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${data.avatar || ''})" tabindex="0"></div>
      <div class="chat-info">
        <div class="chat-name">${data.nickname}</div>
        <div class="chat-last">${data.userId}</div>
      </div>
      <button class="btn follow-btn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
    `;
    const followBtn = div.querySelector('.follow-btn');
    followBtn.onclick = async (e) => {
      e.stopPropagation();
      await toggleFollow(uid, followBtn);
    };
    div.onclick = () => viewProfile(uid);
    userList.appendChild(div);
  });
}
document.getElementById('searchInput').addEventListener('input', loadSearchUsers);

async function loadMyProfile() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists()) renderProfile(snap.data(), currentUser.uid, true);
}

function viewProfile(uid) {
  currentProfileUid = uid;
  // Запам'ятовуємо попередню секцію для кнопки "Назад"
  const currentSection = document.querySelector('.section.active')?.id || 'home';
  if (currentSection !== 'profile') {
    navigationHistory.push(currentSection);
    previousSection = currentSection;
  }
  
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
  const profileNav = document.querySelector('[data-section="profile"]');
  if (profileNav) profileNav.classList.add('active');
  sections.forEach(s => document.getElementById(s).classList.remove('active'));
  const profileSection = document.getElementById('profile');
  if (profileSection) profileSection.classList.add('active');
  document.getElementById('pageTitle').textContent = 'Профіль';
  
  // Показуємо кнопку "Назад" тільки якщо це чужий профіль
  if (uid !== currentUser?.uid) {
    document.querySelector('.back-btn').classList.add('visible');
  } else {
    document.querySelector('.back-btn').classList.remove('visible');
  }
  
  if (uid === currentUser?.uid) {
    loadMyProfile();
  } else {
    loadUserProfile(uid);
  }
}

async function loadUserProfile(uid) {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) renderProfile(snap.data(), uid, uid === currentUser.uid);
}

function renderProfile(data, uid, isOwn) {
  const header = document.getElementById('profileHeader');
  if (!header) return;

  const isBlockedByTarget = data.blockedUsers?.includes(currentUser?.uid) || false;
  const isBlockedByMe = currentUserData?.blockedUsers?.includes(uid) || false;

  if (isBlockedByTarget || isBlockedByMe) {
    header.innerHTML = `
      <div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div>
      <div>
        <h2>${data.nickname}</h2>
        <p class="text-danger">
          ${isBlockedByTarget ? 'Цей користувач вас заблокував' : 'Ви заблокували цього користувача'}
        </p>
      </div>
    `;
    return;
  }

  const isFollowing = !isOwn && currentUser ? (data.followers?.includes(currentUser.uid) || false) : false;

  const canSeeFollowers = () => {
    if (isOwn) return true;
    const privacy = data.settings?.privacy?.whoCanSeeFollowers || 'everyone';
    if (privacy === 'everyone') return true;
    if (privacy === 'followers' && isFollowing) return true;
    return false;
  };

  const followersDisplay = canSeeFollowers() ? data.followers?.length || 0 : 'Приховано';
  const followingDisplay = canSeeFollowers() ? data.following?.length || 0 : 'Приховано';

  header.innerHTML = `
    <div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div>
    <div style="flex:1">
      <h2>${data.nickname}</h2>
      <div class="user-id">${data.userId}</div>
      ${data.note ? `<div class="note-badge" style="position:relative; display:inline-block; margin-top:4px;">${data.note}</div>` : ''}
      <p>${data.bio || ''}</p>
      <div class="profile-stats">
        <span id="followersCount" data-uid="${uid}">${followersDisplay} підписників</span>
        <span id="followingCount" data-uid="${uid}">${followingDisplay} підписок</span>
        <span>${data.posts?.length || 0} постів</span>
      </div>
      ${!isOwn && currentUser ? `
        <div style="display:flex; gap:10px; margin-top:10px; align-items:center;">
          <button class="btn" id="profileFollowBtn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
          <button class="btn" id="profileMessageBtn" tabindex="0">Написати</button>
        </div>
      ` : ''}
      ${isOwn ? '<button class="btn" id="editProfileBtn" tabindex="0">Редагувати</button>' : ''}
    </div>
    ${!isOwn && currentUser ? `
      <div class="profile-menu">
        <button class="profile-menu-btn" id="profileMenuBtn" tabindex="0">⋯</button>
        <div class="profile-menu-dropdown" id="profileMenuDropdown">
          <div class="profile-menu-item" id="reportUserBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.5 6.5L21 9l-5 4 2 7-6-4-6 4 2-7-5-4 6.5-.5L12 2z"/></svg>
            Поскаржитися
          </div>
          <div class="profile-menu-item" id="muteUserBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 10h3l4-4v12l-4-4H3v-4z"/><line x1="18" y1="7" x2="22" y2="11"/><line x1="18" y1="11" x2="22" y2="7"/></svg>
            Замутити в чатах
          </div>
          <div class="profile-menu-item" id="blockUserBtn">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            Заблокувати
          </div>
        </div>
      </div>
    ` : ''}
  `;

  const followersCount = document.getElementById('followersCount');
  if (followersCount && canSeeFollowers()) {
    followersCount.style.cursor = 'pointer';
    followersCount.onclick = () => openFollowersList(uid);
  }
  const followingCount = document.getElementById('followingCount');
  if (followingCount && canSeeFollowers()) {
    followingCount.style.cursor = 'pointer';
    followingCount.onclick = () => openFollowingList(uid);
  }

  if (!isOwn && currentUser) {
    const profileFollowBtn = document.getElementById('profileFollowBtn');
    if (profileFollowBtn) {
      profileFollowBtn.onclick = async () => {
        await toggleFollow(uid, profileFollowBtn);
      };
    }
    const profileMessageBtn = document.getElementById('profileMessageBtn');
    if (profileMessageBtn) {
      profileMessageBtn.onclick = () => {
        const chatId = getChatId(currentUser.uid, uid);
        getDoc(doc(db, "chats", chatId)).then(async (docSnap) => {
          if (!docSnap.exists()) {
            await setDoc(doc(db, "chats", chatId), {
              participants: [currentUser.uid, uid],
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              lastMessage: '',
              unread: { [currentUser.uid]: 0, [uid]: 0 }
            });
          }
          openChat(chatId, uid, data.nickname, data.userId, data.avatar);
        });
      };
    }

    const menuBtn = document.getElementById('profileMenuBtn');
    const dropdown = document.getElementById('profileMenuDropdown');
    if (menuBtn && dropdown) {
      menuBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('show');
      };
      document.addEventListener('click', (e) => {
        if (!menuBtn.contains(e.target)) {
          dropdown.classList.remove('show');
        }
      });

      document.getElementById('reportUserBtn').onclick = async () => {
        dropdown.classList.remove('show');
        const reason = prompt('Опишіть причину скарги (необов\'язково)');
        await reportUser(uid, reason);
      };
      document.getElementById('muteUserBtn').onclick = async () => {
        dropdown.classList.remove('show');
        const userRef = doc(db, "users", currentUser.uid);
        const snap = await getDoc(userRef);
        const muted = snap.data().mutedUsers || [];
        if (muted.includes(uid)) {
          await unmuteUser(uid);
        } else {
          await muteUser(uid);
        }
      };
      document.getElementById('blockUserBtn').onclick = async () => {
        dropdown.classList.remove('show');
        const userRef = doc(db, "users", currentUser.uid);
        const snap = await getDoc(userRef);
        const blocked = snap.data().blockedUsers || [];
        if (blocked.includes(uid)) {
          await unblockUser(uid);
        } else {
          await blockUser(uid);
        }
        loadUserProfile(uid);
      };
    }
  }
  if (isOwn) {
    const editProfileBtn = document.getElementById('editProfileBtn');
    if (editProfileBtn) {
      editProfileBtn.onclick = () => {
        document.getElementById('editNickname').value = data.nickname;
        document.getElementById('editBio').value = data.bio || '';
        document.getElementById('editNote').value = data.note || ''; // поле для нотатки
        document.getElementById('editAvatar').value = '';
        document.getElementById('editAvatarLabel').textContent = 'Обрати аватар';
        document.getElementById('editAvatarPreview').classList.remove('show');
        document.getElementById('editProfileModal').classList.add('active');
      };
    }
  }
  
  const tabs = document.getElementById('profileTabs');
  if (tabs) {
    tabs.innerHTML = `
      <div class="profile-tab active" data-tab="posts" tabindex="0">Пости</div>
      <div class="profile-tab" data-tab="likes" tabindex="0">Лайки</div>
      <div class="profile-tab" data-tab="media" tabindex="0">Медіа</div>
      <div class="profile-tab" data-tab="saved" tabindex="0">Збережене</div>
    `;
    document.querySelectorAll('.profile-tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadProfileFeed(uid, tab.dataset.tab);
      };
    });
  }
  loadProfileFeed(uid, 'posts');
}

async function openFollowersList(uid) {
  const modal = document.getElementById('followersModal');
  const list = document.getElementById('followersList');
  if (!modal || !list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  modal.classList.add('active');
  
  const userSnap = await getDoc(doc(db, "users", uid));
  const followersIds = userSnap.data().followers || [];
  const followers = [];
  for (const id of followersIds) {
    const snap = await getDoc(doc(db, "users", id));
    if (snap.exists()) followers.push({ id, ...snap.data() });
  }
  
  list.innerHTML = '';
  if (followers.length === 0) {
    list.innerHTML = '<p style="text-align:center; padding:20px;">Немає підписників</p>';
  } else {
    followers.forEach(user => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="avatar small" style="background-image:url(${user.avatar || ''})" data-uid="${user.id}" tabindex="0"></div>
        <div class="chat-info">
          <div class="chat-name">${user.nickname}</div>
          <div class="chat-last">${user.userId}</div>
          ${user.note ? `<div class="note-badge" style="position:relative; display:inline-block;">${user.note}</div>` : ''}
        </div>
      `;
      div.onclick = () => {
        viewProfile(user.id);
        modal.classList.remove('active');
      };
      list.appendChild(div);
    });
  }
}

async function openFollowingList(uid) {
  const modal = document.getElementById('followingModal');
  const list = document.getElementById('followingList');
  if (!modal || !list) return;
  list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  modal.classList.add('active');
  
  const userSnap = await getDoc(doc(db, "users", uid));
  const followingIds = userSnap.data().following || [];
  const following = [];
  for (const id of followingIds) {
    const snap = await getDoc(doc(db, "users", id));
    if (snap.exists()) following.push({ id, ...snap.data() });
  }
  
  list.innerHTML = '';
  if (following.length === 0) {
    list.innerHTML = '<p style="text-align:center; padding:20px;">Ні на кого не підписаний</p>';
  } else {
    following.forEach(user => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="avatar small" style="background-image:url(${user.avatar || ''})" data-uid="${user.id}" tabindex="0"></div>
        <div class="chat-info">
          <div class="chat-name">${user.nickname}</div>
          <div class="chat-last">${user.userId}</div>
          ${user.note ? `<div class="note-badge" style="position:relative; display:inline-block;">${user.note}</div>` : ''}
        </div>
      `;
      div.onclick = () => {
        viewProfile(user.id);
        modal.classList.remove('active');
      };
      list.appendChild(div);
    });
  }
}

document.getElementById('closeFollowersModal').onclick = () => {
  document.getElementById('followersModal').classList.remove('active');
};
document.getElementById('closeFollowingModal').onclick = () => {
  document.getElementById('followingModal').classList.remove('active');
};

async function loadProfileFeed(uid, tab) {
  if (!currentUser) return;
  const feed = document.getElementById('profileFeed');
  if (!feed) return;
  feed.innerHTML = '';
  let posts = [];
  const userSnap = await getDoc(doc(db, "users", uid));
  const userData = userSnap.data();
  
  if (tab === 'posts') {
    const postIds = userData.posts || [];
    for (const id of postIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
    }
  } else if (tab === 'likes') {
    const likedIds = userData.likedPosts || [];
    for (const id of likedIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
    }
  } else if (tab === 'media') {
    const postIds = userData.posts || [];
    for (const id of postIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) {
        const post = postSnap.data();
        if ((post.media && post.media.length > 0) || post.mediaUrl) {
          posts.push({ id, ...post });
        }
      }
    }
  } else if (tab === 'saved') {
    const savedIds = userData.savedPosts || [];
    for (const id of savedIds.slice(0, 20)) {
      const postSnap = await getDoc(doc(db, "posts", id));
      if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
    }
  }
  
  posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  
  posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post';
    div.tabIndex = 0;
    div.innerHTML = `<div class="post-content">${post.text || ''}</div>`;
    feed.appendChild(div);
  });
}

document.getElementById('closeModal').onclick = () => {
  document.getElementById('editProfileModal').classList.remove('active');
};

document.getElementById('saveProfileEdit').onclick = async () => {
  if (!currentUser) return;
  const nickname = document.getElementById('editNickname').value.trim();
  const bio = document.getElementById('editBio').value.trim();
  const note = document.getElementById('editNote').value.trim(); // нова нотатка
  const avatarFile = document.getElementById('editAvatar').files[0];
  if (!nickname) {
    showToast('Псевдонім обов’язковий');
    return;
  }
  
  const newUserId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", newUserId));
  const snap = await getDocs(q);
  if (!snap.empty && snap.docs[0].id !== currentUser.uid) {
    showToast('Цей ID вже зайнятий');
    return;
  }
  
  try {
    let avatarUrl;
    if (avatarFile) {
      avatarUrl = await uploadToCloudinary(avatarFile);
    }
    
    const updateData = { 
      nickname, 
      userId: newUserId, 
      nickname_lower: nickname.toLowerCase().trim(), 
      bio,
      note
    };
    if (avatarUrl) updateData.avatar = avatarUrl;
    
    await updateDoc(doc(db, "users", currentUser.uid), updateData);
    loadMyProfile();
    document.getElementById('editProfileModal').classList.remove('active');
    showToast('Профіль оновлено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
};

// ================= ФУНКЦІЇ ЧАТІВ =================
const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

async function loadChatList() {
  if (!currentUser) return;
  const listEl = document.getElementById('chatList');
  if (!listEl) return;

  try {
    const snapshot = await getDocs(query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid)));
    const chatItems = [];

    for (const docSnap of snapshot.docs) {
      const chat = docSnap.data();
      const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
      if (!otherUid) continue;

      const userSnap = await getDoc(doc(db, "users", otherUid));
      if (!userSnap.exists()) continue;
      const user = userSnap.data();

      const unread = chat.unread?.[currentUser.uid] || 0;
      const lastMsg = chat.lastMessage || '';
      const lastMsgType = chat.lastMessageType || 'text';
      let displayLast = lastMsg;
      if (lastMsgType === 'photo') displayLast = '📷 Фото';
      else if (lastMsgType === 'video') displayLast = '🎥 Відео';
      
      const updatedAt = chat.updatedAt?.seconds * 1000 || 0;
      const time = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      
      const lastOnline = user.lastOnline?.seconds * 1000 || 0;
      const isOnline = (Date.now() - lastOnline) < 60000;

      chatItems.push({
        chatId: docSnap.id,
        otherUid,
        user,
        unread,
        lastMsg: displayLast,
        time,
        isOnline,
        updatedAt
      });
    }

    chatItems.sort((a, b) => b.updatedAt - a.updatedAt);
    renderChatList(chatItems);
  } catch (error) {
    console.error('Помилка завантаження списку чатів:', error);
    showToast('Не вдалося завантажити чати');
  }
}

function renderChatList(chatItems) {
  const listEl = document.getElementById('chatList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (chatItems.length === 0) {
    listEl.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
    return;
  }

  chatItems.forEach(item => {
    const div = document.createElement('div');
    div.className = `chat-item ${item.unread > 0 ? 'unread' : ''}`;
    div.dataset.chatId = item.chatId;
    div.dataset.otherUid = item.otherUid;
    div.tabIndex = 0;

    div.innerHTML = `
      <div class="chat-avatar">
        <div class="avatar small" style="background-image:url(${item.user.avatar || ''})"></div>
        ${item.isOnline ? '<span class="online-indicator"></span>' : ''}
        ${item.user.note ? `<div class="note-badge">${item.user.note}</div>` : ''}
      </div>
      <div class="chat-info">
        <div class="chat-name">${item.user.nickname}</div>
        <div class="chat-last">${item.lastMsg}</div>
      </div>
      <div class="chat-time">${item.time}</div>
      ${item.unread > 0 ? `<div class="chat-badge">${item.unread}</div>` : ''}
    `;

    div.addEventListener('click', () => {
      openChat(item.chatId, item.otherUid, item.user.nickname, item.user.userId, item.user.avatar);
    });

    listEl.appendChild(div);
  });
}

async function openChat(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  if (!currentUser) return;

  currentChatId = chatId;
  currentChatPartner = otherUid;
  currentChatPartnerName = otherName;
  currentChatPartnerUserId = otherUserId;
  currentChatPartnerAvatar = otherAvatar;

  document.getElementById('chatName').textContent = otherName;
  document.getElementById('chatStatus').textContent = '';
  const avatarEl = document.getElementById('chatAvatar');
  avatarEl.style.backgroundImage = `url(${otherAvatar || ''})`;
  
  const chatWindowContainer = document.getElementById('chatWindowContainer');
  chatWindowContainer.style.display = 'flex';
  if (window.innerWidth < 768) {
    document.getElementById('chatListSidebar').classList.add('hide');
  }

  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.classList.add('hide-chat-mode');
  }

  const chatRef = doc(db, "chats", chatId);
  await updateDoc(chatRef, {
    [`unread.${currentUser.uid}`]: 0
  }).catch(console.error);

  subscribeToMessages(chatId);

  if (unsubscribeChatPresence) unsubscribeChatPresence();
  unsubscribeChatPresence = onSnapshot(doc(db, "users", otherUid), (snap) => {
    const lastOnline = snap.data()?.lastOnline?.seconds * 1000 || 0;
    const isOnline = (Date.now() - lastOnline) < 60000;
    const statusEl = document.getElementById('chatStatus');
    statusEl.textContent = isOnline ? 'онлайн' : 'був(ла) нещодавно';
  });

  if (unsubscribeTyping) unsubscribeTyping();
  const typingRef = doc(db, `chats/${chatId}/typing/${otherUid}`);
  unsubscribeTyping = onSnapshot(typingRef, (docSnap) => {
    const indicator = document.getElementById('typingIndicator');
    if (docSnap.exists() && docSnap.data().isTyping) {
      indicator.style.display = 'flex';
    } else {
      indicator.style.display = 'none';
    }
  });

  setTimeout(() => document.getElementById('chatText')?.focus(), 200);
}

function subscribeToMessages(chatId) {
  if (!currentUser) return;
  if (unsubscribeMessages) unsubscribeMessages();

  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.innerHTML = '';

  const q = query(collection(db, `chats/${chatId}/messages`), orderBy("createdAt", "asc"));
  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    let lastDate = '';
    messagesContainer.innerHTML = '';

    snapshot.forEach(docSnap => {
      const msg = { id: docSnap.id, ...docSnap.data() };
      const msgDate = formatMessageDate(msg.createdAt);
      if (msgDate !== lastDate) {
        lastDate = msgDate;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.textContent = msgDate;
        messagesContainer.appendChild(divider);
      }

      const messageEl = createMessageElement(msg);
      messagesContainer.appendChild(messageEl);
    });

    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }, (error) => {
    console.error('Помилка отримання повідомлень:', error);
    showToast('Помилка завантаження повідомлень');
  });
}

function createMessageElement(msg) {
  const isMine = msg.from === currentUser.uid;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMine ? 'sent' : 'received'}`;
  wrapper.dataset.messageId = msg.id;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMine ? 'sent' : 'received'}`;

  // Якщо це відповідь, показуємо прев’ю оригіналу
  if (msg.replyTo) {
    const replyPreview = document.createElement('div');
    replyPreview.className = 'message-reply-preview';
    replyPreview.setAttribute('data-reply-to', msg.replyTo.messageId);
    replyPreview.innerHTML = `
      <div class="reply-sender">${msg.replyTo.senderName}</div>
      <div class="reply-text">${msg.replyTo.text}</div>
    `;
    replyPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      const originalMsg = document.querySelector(`.message-wrapper[data-message-id="${msg.replyTo.messageId}"]`);
      if (originalMsg) {
        originalMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        originalMsg.classList.add('focused-animated');
        setTimeout(() => originalMsg.classList.remove('focused-animated'), 2000);
      }
    });
    bubble.appendChild(replyPreview);
  }

  if (!isMine) {
    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender';
    senderDiv.innerHTML = `
      <div class="message-sender-avatar" style="background-image:url(${currentChatPartnerAvatar || ''})"></div>
      <span>${currentChatPartnerName}</span>
    `;
    bubble.appendChild(senderDiv);
  }

  if (msg.text) {
    const textDiv = document.createElement('div');
    textDiv.className = `message-text ${msg.edited ? 'edited' : ''}`;
    textDiv.textContent = msg.text;
    bubble.appendChild(textDiv);
  }

  if (msg.mediaUrl) {
    const mediaEl = msg.mediaType === 'image' ? document.createElement('img') : document.createElement('video');
    mediaEl.src = msg.mediaUrl;
    mediaEl.className = 'message-media';
    if (msg.mediaType === 'video') mediaEl.controls = true;
    mediaEl.addEventListener('click', () => window.open(msg.mediaUrl, '_blank'));
    bubble.appendChild(mediaEl);
  }

  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    const reactionsDiv = document.createElement('div');
    reactionsDiv.className = 'message-reactions';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      if (users.length === 0) continue;
      const reactionItem = document.createElement('span');
      reactionItem.className = `reaction-item ${users.includes(currentUser.uid) ? 'user-reacted' : ''}`;
      reactionItem.dataset.emoji = emoji;
      reactionItem.innerHTML = `<span class="emoji">${emoji}</span><span class="count">${users.length}</span>`;
      reactionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReaction(msg.id, emoji);
      });
      reactionsDiv.appendChild(reactionItem);
    }
    bubble.appendChild(reactionsDiv);
  }

  const footer = document.createElement('div');
  footer.className = 'message-footer';
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  timeSpan.textContent = formatMessageTime(msg.createdAt);
  footer.appendChild(timeSpan);

  if (isMine) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'message-status';
    let status = 'sent';
    if (msg.readBy && msg.readBy.includes(currentChatPartner)) {
      status = 'read';
    } else if (msg.deliveredTo && msg.deliveredTo.includes(currentChatPartner)) {
      status = 'delivered';
    }
    statusSpan.innerHTML = getStatusIcon(status);
    footer.appendChild(statusSpan);
  }

  bubble.appendChild(footer);
  wrapper.appendChild(bubble);

  wrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, msg);
  });
  let longPressTimer;
  wrapper.addEventListener('touchstart', (e) => {
    longPressTimer = setTimeout(() => {
      showMessageContextMenu(e, msg);
    }, 500);
  });
  wrapper.addEventListener('touchend', () => clearTimeout(longPressTimer));
  wrapper.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  return wrapper;
}

function getStatusIcon(status) {
  const icons = {
    sent: '<svg class="status-icon sent" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
    delivered: '<svg class="status-icon delivered" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.68 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12z"/></svg>',
    read: '<svg class="status-icon read" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.68 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12z"/></svg>'
  };
  return icons[status] || icons.sent;
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMessageDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (date.toDateString() === today.toDateString()) return 'Сьогодні';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

document.getElementById('sendMessage')?.addEventListener('click', sendMessage);
document.getElementById('chatText')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

let typingTimeout;
async function sendMessage() {
  const textInput = document.getElementById('chatText');
  const text = textInput?.value.trim() || '';
  const fileInput = document.getElementById('chatAttachFile');
  const file = fileInput?.files[0];

  if (!text && !file) return;
  if (!currentUser || !currentChatId || !currentChatPartner) {
    showToast('Чат не вибрано');
    return;
  }

  try {
    let mediaUrl = null;
    let mediaType = null;
    if (file) {
      mediaUrl = await uploadToCloudinary(file);
      mediaType = file.type.split('/')[0];
    }

    const messageData = {
      from: currentUser.uid,
      text: text || '',
      createdAt: serverTimestamp(),
      readBy: [currentUser.uid],
      deliveredTo: [currentUser.uid],
      reactions: {}
    };
    if (replyContext) {
      messageData.replyTo = {
        messageId: replyContext.messageId,
        text: replyContext.text,
        senderName: replyContext.senderName
      };
    }
    if (mediaUrl) {
      messageData.mediaUrl = mediaUrl;
      messageData.mediaType = mediaType;
    }

    const messageRef = collection(db, `chats/${currentChatId}/messages`);
    await addDoc(messageRef, messageData);

    const chatRef = doc(db, "chats", currentChatId);
    await updateDoc(chatRef, {
      lastMessage: text || (mediaType === 'image' ? '📷 Фото' : '🎥 Відео'),
      lastMessageType: mediaType || 'text',
      updatedAt: serverTimestamp(),
      [`unread.${currentChatPartner}`]: increment(1)
    });

    // Очищаємо контекст відповіді після відправки
    clearReply();

    if (textInput) textInput.value = '';
    if (fileInput) fileInput.value = '';
    const attachBtn = document.getElementById('chatAttachBtn');
    if (attachBtn) attachBtn.innerHTML = '📎';

    const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
    await setDoc(typingRef, { isTyping: false }, { merge: true });
  } catch (error) {
    console.error('Помилка відправки:', error);
    showToast('Не вдалося відправити повідомлення');
  }
}

// Функції для роботи з відповідями
function setReply(messageId, text, senderName) {
  replyContext = { messageId, text, senderName };
  const previewDiv = document.createElement('div');
  previewDiv.className = 'reply-preview';
  previewDiv.id = 'replyPreview';
  previewDiv.innerHTML = `
    <span class="reply-sender">${senderName}</span>
    <span class="reply-text">${text}</span>
    <button class="close-reply" id="closeReply">✕</button>
  `;
  const chatInputArea = document.querySelector('.chat-input-area');
  if (chatInputArea) {
    // Видаляємо старе прев’ю, якщо є
    const oldPreview = document.getElementById('replyPreview');
    if (oldPreview) oldPreview.remove();
    chatInputArea.parentNode.insertBefore(previewDiv, chatInputArea);
    document.getElementById('closeReply').addEventListener('click', clearReply);
  }
}

function clearReply() {
  replyContext = null;
  const preview = document.getElementById('replyPreview');
  if (preview) preview.remove();
}

document.getElementById('chatText')?.addEventListener('input', () => {
  if (!currentUser || !currentChatId || !currentChatPartner) return;
  
  const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
  setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error);
  }, 2000);
});

document.getElementById('chatAttachBtn')?.addEventListener('click', () => {
  document.getElementById('chatAttachFile')?.click();
});
document.getElementById('chatAttachFile')?.addEventListener('change', function() {
  if (this.files && this.files[0]) {
    const btn = document.getElementById('chatAttachBtn');
    if (btn) btn.innerHTML = '📁';
  }
});

let selectedMessageId = null;

function showMessageContextMenu(event, msg) {
  event.preventDefault();
  selectedMessageId = msg.id;

  const menu = document.getElementById('messageContextMenu');
  if (!menu) return;
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.classList.add('show');

  const replyItem = menu.querySelector('[data-action="reply"]');
  const editItem = menu.querySelector('[data-action="edit"]');
  const deleteEveryoneItem = menu.querySelector('[data-action="deleteEveryone"]');
  
  if (msg.from === currentUser.uid) {
    if (editItem) editItem.style.display = 'block';
    if (deleteEveryoneItem) deleteEveryoneItem.style.display = 'block';
  } else {
    if (editItem) editItem.style.display = 'none';
    if (deleteEveryoneItem) deleteEveryoneItem.style.display = 'none';
  }
  if (replyItem) replyItem.style.display = 'block'; // відповісти можна на будь-яке

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('show');
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

document.getElementById('messageContextMenu')?.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !selectedMessageId || !currentChatId) return;

  const messageRef = doc(db, `chats/${currentChatId}/messages/${selectedMessageId}`);
  const messageSnap = await getDoc(messageRef);
  const msgData = messageSnap.data();

  switch (action) {
    case 'reply':
      setReply(selectedMessageId, msgData.text, msgData.from === currentUser.uid ? 'Ви' : currentChatPartnerName);
      document.getElementById('chatText').focus();
      break;
    case 'edit':
      const oldText = msgData.text;
      const newText = prompt('Редагувати повідомлення:', oldText);
      if (newText !== null) {
        await updateDoc(messageRef, { text: newText, edited: true });
      }
      break;
    case 'copy':
      if (msgData.text) {
        navigator.clipboard.writeText(msgData.text).then(() => showToast('Скопійовано'));
      }
      break;
    case 'deleteSelf':
      if (confirm('Видалити це повідомлення для себе?')) {
        // Тут можна реалізувати видалення тільки для себе, але це складніше. Поки просто приховуємо на фронті?
        // Для простоти – видаляємо з Firestore (видалить для всіх)
        // Краще використати окрему логіку, але залишимо як заглушку
        showToast('Функція видалення для себе буде реалізована');
      }
      break;
    case 'deleteEveryone':
      if (confirm('Видалити це повідомлення для всіх?')) {
        await deleteDoc(messageRef);
      }
      break;
  }
  document.getElementById('messageContextMenu')?.classList.remove('show');
});

async function toggleReaction(messageId, emoji) {
  if (!currentUser || !currentChatId) return;
  const messageRef = doc(db, `chats/${currentChatId}/messages/${messageId}`);
  const messageSnap = await getDoc(messageRef);
  if (!messageSnap.exists()) return;

  const reactions = messageSnap.data().reactions || {};
  const users = reactions[emoji] || [];
  const userIndex = users.indexOf(currentUser.uid);
  
  if (userIndex === -1) {
    users.push(currentUser.uid);
  } else {
    users.splice(userIndex, 1);
  }
  
  if (users.length === 0) {
    delete reactions[emoji];
  } else {
    reactions[emoji] = users;
  }

  await updateDoc(messageRef, { reactions });
}

document.getElementById('chatBackBtn')?.addEventListener('click', () => {
  const chatWindow = document.getElementById('chatWindowContainer');
  if (chatWindow) chatWindow.style.display = 'none';
  const chatSidebar = document.getElementById('chatListSidebar');
  if (chatSidebar) chatSidebar.classList.remove('hide');
  
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) {
    bottomNav.classList.remove('hide-chat-mode');
  }
  
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeTyping) unsubscribeTyping();
  if (unsubscribeChatPresence) unsubscribeChatPresence();
  currentChatId = null;
  currentChatPartner = null;
  clearReply(); // очищаємо відповідь при закритті чату
});

// ================= ПОШУК КОРИСТУВАЧІВ У ЧАТАХ =================
let searchTimeout;
document.getElementById('chatSearchInput')?.addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const val = e.target.value.trim();
  const resultsContainer = document.getElementById('chatSearchResults');
  if (!resultsContainer) {
    console.error('Елемент chatSearchResults не знайдено!');
    return;
  }
  if (!val) {
    resultsContainer.style.display = 'none';
    resultsContainer.innerHTML = '';
    return;
  }
  searchTimeout = setTimeout(() => searchUsersForChat(val), 300);
});

async function searchUsersForChat(query) {
  if (!currentUser) return;
  
  const qLower = query.toLowerCase();
  const resultsContainer = document.getElementById('chatSearchResults');
  if (!resultsContainer) {
    console.error('Елемент chatSearchResults не знайдено!');
    return;
  }
  
  resultsContainer.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  resultsContainer.style.display = 'block';

  try {
    const searchTerm = qLower.startsWith('@') ? qLower : `@${qLower}`;
    const q1 = query(
      collection(db, "users"), 
      where("userId", ">=", searchTerm), 
      where("userId", "<=", searchTerm + '\uf8ff')
    );
    
    const q2 = query(
      collection(db, "users"), 
      where("nickname_lower", ">=", qLower), 
      where("nickname_lower", "<=", qLower + '\uf8ff')
    );
    
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const usersMap = new Map();
    
    const blockedByMe = currentUserData?.blockedUsers || [];
    snap1.forEach(d => {
      if (d.id !== currentUser.uid && !blockedByMe.includes(d.id)) usersMap.set(d.id, d.data());
    });
    snap2.forEach(d => {
      if (d.id !== currentUser.uid && !blockedByMe.includes(d.id)) usersMap.set(d.id, d.data());
    });

    if (usersMap.size === 0) {
      resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Користувачів не знайдено</p>';
      return;
    }

    resultsContainer.innerHTML = '';
    usersMap.forEach((data, uid) => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.style.cursor = 'pointer';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="chat-avatar">
          <div class="avatar small" style="background-image:url(${data.avatar || ''})"></div>
          ${data.note ? `<div class="note-badge">${data.note}</div>` : ''}
        </div>
        <div class="chat-info">
          <div class="chat-name">${data.nickname}</div>
          <div class="chat-last">${data.userId}</div>
        </div>
        <button class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;">Написати</button>
      `;
      
      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        viewProfile(uid);
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        document.getElementById('chatSearchInput').value = '';
      });
      
      const btn = div.querySelector('button');
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chatId = getChatId(currentUser.uid, uid);
        const chatRef = doc(db, "chats", chatId);
        const chatSnap = await getDoc(chatRef);
        
        if (!chatSnap.exists()) {
          await setDoc(chatRef, {
            participants: [currentUser.uid, uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastMessage: '',
            unread: { [currentUser.uid]: 0, [uid]: 0 }
          });
        }
        
        openChat(chatId, uid, data.nickname, data.userId, data.avatar);
        
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        document.getElementById('chatSearchInput').value = '';
      });
      
      resultsContainer.appendChild(div);
    });
  } catch (error) {
    console.error('Помилка пошуку користувачів:', error);
    resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Помилка пошуку</p>';
  }
}

document.getElementById('chatAvatar')?.addEventListener('click', () => {
  if (currentChatPartner) viewProfile(currentChatPartner);
});

document.getElementById('chatMenuBtn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById('chatMenuDropdown');
  if (dropdown) dropdown.classList.toggle('show');
});
document.addEventListener('click', () => {
  const dropdown = document.getElementById('chatMenuDropdown');
  if (dropdown) dropdown.classList.remove('show');
});
document.getElementById('chatMenuDropdown')?.addEventListener('click', async (e) => {
  const action = e.target.dataset.action;
  if (!action || !currentChatPartner) return;
  document.getElementById('chatMenuDropdown')?.classList.remove('show');
  
  if (action === 'viewProfile') {
    viewProfile(currentChatPartner);
  } else if (action === 'block') {
    await blockUser(currentChatPartner);
  } else if (action === 'clearHistory') {
    if (confirm('Очистити історію повідомлень? Це не можна скасувати.') && currentChatId) {
      const messagesRef = collection(db, `chats/${currentChatId}/messages`);
      const snapshot = await getDocs(messagesRef);
      const batch = writeBatch(db);
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      showToast('Історію очищено');
    }
  }
});

// ================= НАЛАШТУВАННЯ =================
function loadSettings() {
  if (!currentUser) return;
  
  updateSettingsUI();
  loadBlockedUsers();
  loadAccountStats();
  updatePrivacyUI();
  updateStorageInfo();
}

function updateSettingsUI() {
  const pushToggle = document.getElementById('settingPushNotifications');
  if (pushToggle) pushToggle.checked = userSettings.notifications.push;
  
  const emailToggle = document.getElementById('settingEmailNotifications');
  if (emailToggle) emailToggle.checked = userSettings.notifications.email;
  
  const smsToggle = document.getElementById('settingSmsNotifications');
  if (smsToggle) smsToggle.checked = userSettings.notifications.sms;
  
  const privateChatsToggle = document.getElementById('settingPrivateChats');
  if (privateChatsToggle) privateChatsToggle.checked = userSettings.notifications.privateChats;
  
  const likesToggle = document.getElementById('settingLikes');
  if (likesToggle) likesToggle.checked = userSettings.notifications.likes;
  
  const commentsToggle = document.getElementById('settingComments');
  if (commentsToggle) commentsToggle.checked = userSettings.notifications.comments;
  
  const newFollowersToggle = document.getElementById('settingNewFollowers');
  if (newFollowersToggle) newFollowersToggle.checked = userSettings.notifications.newFollowers;
  
  const mentionsToggle = document.getElementById('settingMentions');
  if (mentionsToggle) mentionsToggle.checked = userSettings.notifications.mentions;
  
  const directMessagesToggle = document.getElementById('settingDirectMessages');
  if (directMessagesToggle) directMessagesToggle.checked = userSettings.notifications.directMessages;
  
  const storyRepliesToggle = document.getElementById('settingStoryReplies');
  if (storyRepliesToggle) storyRepliesToggle.checked = userSettings.notifications.storyReplies;
  
  const privateAccountToggle = document.getElementById('settingPrivateAccount');
  if (privateAccountToggle) privateAccountToggle.checked = userSettings.privacy.privateAccount;
  
  const activityStatusToggle = document.getElementById('settingActivityStatus');
  if (activityStatusToggle) activityStatusToggle.checked = userSettings.privacy.activityStatus;
  
  const darkModeToggle = document.getElementById('settingDarkMode');
  if (darkModeToggle) darkModeToggle.checked = userSettings.preferences.darkMode;
  
  const reduceMotionToggle = document.getElementById('settingReduceMotion');
  if (reduceMotionToggle) reduceMotionToggle.checked = userSettings.preferences.reduceMotion;
  
  const highContrastToggle = document.getElementById('settingHighContrast');
  if (highContrastToggle) highContrastToggle.checked = userSettings.preferences.highContrast;
  
  const autoplayVideosToggle = document.getElementById('settingAutoplayVideos');
  if (autoplayVideosToggle) autoplayVideosToggle.checked = userSettings.preferences.autoplayVideos;
  
  const soundEffectsToggle = document.getElementById('settingSoundEffects');
  if (soundEffectsToggle) soundEffectsToggle.checked = userSettings.preferences.soundEffects;
  
  const languageSelect = document.getElementById('settingLanguage');
  if (languageSelect) languageSelect.value = userSettings.preferences.language;
  
  const twoFactorToggle = document.getElementById('settingTwoFactor');
  if (twoFactorToggle) twoFactorToggle.checked = userSettings.security.twoFactor;
  
  const loginAlertsToggle = document.getElementById('settingLoginAlerts');
  if (loginAlertsToggle) loginAlertsToggle.checked = userSettings.security.loginAlerts;
}

function setupSettingsListeners() {
  const toggleIds = [
    'settingPushNotifications', 'settingEmailNotifications', 'settingSmsNotifications',
    'settingPrivateChats', 'settingLikes', 'settingComments', 'settingNewFollowers',
    'settingMentions', 'settingDirectMessages', 'settingStoryReplies',
    'settingPrivateAccount', 'settingActivityStatus',
    'settingDarkMode', 'settingReduceMotion', 'settingHighContrast',
    'settingAutoplayVideos', 'settingSoundEffects',
    'settingTwoFactor', 'settingLoginAlerts'
  ];
  
  toggleIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        const section = id.replace('setting', '').toLowerCase();
        if (id.includes('Push')) userSettings.notifications.push = e.target.checked;
        else if (id.includes('Email')) userSettings.notifications.email = e.target.checked;
        else if (id.includes('Sms')) userSettings.notifications.sms = e.target.checked;
        else if (id.includes('PrivateChats')) userSettings.notifications.privateChats = e.target.checked;
        else if (id.includes('Likes')) userSettings.notifications.likes = e.target.checked;
        else if (id.includes('Comments')) userSettings.notifications.comments = e.target.checked;
        else if (id.includes('NewFollowers')) userSettings.notifications.newFollowers = e.target.checked;
        else if (id.includes('Mentions')) userSettings.notifications.mentions = e.target.checked;
        else if (id.includes('DirectMessages')) userSettings.notifications.directMessages = e.target.checked;
        else if (id.includes('StoryReplies')) userSettings.notifications.storyReplies = e.target.checked;
        else if (id.includes('PrivateAccount')) userSettings.privacy.privateAccount = e.target.checked;
        else if (id.includes('ActivityStatus')) userSettings.privacy.activityStatus = e.target.checked;
        else if (id.includes('DarkMode')) userSettings.preferences.darkMode = e.target.checked;
        else if (id.includes('ReduceMotion')) userSettings.preferences.reduceMotion = e.target.checked;
        else if (id.includes('HighContrast')) userSettings.preferences.highContrast = e.target.checked;
        else if (id.includes('AutoplayVideos')) userSettings.preferences.autoplayVideos = e.target.checked;
        else if (id.includes('SoundEffects')) userSettings.preferences.soundEffects = e.target.checked;
        else if (id.includes('TwoFactor')) userSettings.security.twoFactor = e.target.checked;
        else if (id.includes('LoginAlerts')) userSettings.security.loginAlerts = e.target.checked;
        
        applySettings();
        saveSettingsToFirestore();
      });
    }
  });
  
  const langSelect = document.getElementById('settingLanguage');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      userSettings.preferences.language = e.target.value;
      saveSettingsToFirestore();
    });
  }
}

function updatePrivacyUI() {
  const whoCanMessage = document.querySelector(`input[name="whoCanMessage"][value="${userSettings.privacy.whoCanMessage}"]`);
  if (whoCanMessage) whoCanMessage.checked = true;

  const whoCanSeeOnline = document.querySelector(`input[name="whoCanSeeOnline"][value="${userSettings.privacy.whoCanSeeOnline}"]`);
  if (whoCanSeeOnline) whoCanSeeOnline.checked = true;

  const whoCanSeeFollowers = document.querySelector(`input[name="whoCanSeeFollowers"][value="${userSettings.privacy.whoCanSeeFollowers}"]`);
  if (whoCanSeeFollowers) whoCanSeeFollowers.checked = true;

  const allowMentions = document.querySelector(`input[name="allowMentions"][value="${userSettings.privacy.allowMentions}"]`);
  if (allowMentions) allowMentions.checked = true;

  const allowTags = document.querySelector(`input[name="allowTags"][value="${userSettings.privacy.allowTags}"]`);
  if (allowTags) allowTags.checked = true;
}

document.querySelectorAll('input[name="whoCanMessage"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    userSettings.privacy.whoCanMessage = e.target.value;
    await saveSettingsToFirestore();
  });
});

document.querySelectorAll('input[name="whoCanSeeOnline"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    userSettings.privacy.whoCanSeeOnline = e.target.value;
    await saveSettingsToFirestore();
  });
});

document.querySelectorAll('input[name="whoCanSeeFollowers"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    userSettings.privacy.whoCanSeeFollowers = e.target.value;
    await saveSettingsToFirestore();
  });
});

document.querySelectorAll('input[name="allowMentions"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    userSettings.privacy.allowMentions = e.target.value;
    await saveSettingsToFirestore();
  });
});

document.querySelectorAll('input[name="allowTags"]').forEach(radio => {
  radio.addEventListener('change', async (e) => {
    userSettings.privacy.allowTags = e.target.value;
    await saveSettingsToFirestore();
  });
});

function applySettings() {
  if (userSettings.preferences.darkMode) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  localStorage.setItem('theme', userSettings.preferences.darkMode ? 'dark' : 'light');
  
  if (userSettings.preferences.reduceMotion) {
    document.documentElement.style.setProperty('--transition', '0s');
    document.documentElement.style.setProperty('--transition-slow', '0s');
  } else {
    document.documentElement.style.setProperty('--transition', '0.28s cubic-bezier(0.22, 0.61, 0.36, 1)');
    document.documentElement.style.setProperty('--transition-slow', '0.62s cubic-bezier(0.16, 1, 0.3, 1)');
  }
  
  if (userSettings.preferences.highContrast) {
    document.documentElement.style.setProperty('--text-primary', '#000');
    document.documentElement.style.setProperty('--text-secondary', '#222');
  } else {
  }
}

async function saveSettingsToFirestore() {
  if (!currentUser) return;
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      settings: userSettings,
      updatedAt: serverTimestamp()
    });
    showToast('Налаштування збережено');
  } catch (error) {
    console.error('Помилка збереження налаштувань:', error);
    showToast('Помилка збереження налаштувань');
  }
}

async function loadBlockedUsers() {
  const container = document.getElementById('blockedUsersList');
  if (!container) return;
  
  if (!currentUserData || !currentUserData.blockedUsers || currentUserData.blockedUsers.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary); padding:10px;">Немає заблокованих користувачів</p>';
    return;
  }
  
  container.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  
  const blockedUsers = [];
  for (const uid of currentUserData.blockedUsers) {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      blockedUsers.push({ id: uid, ...snap.data() });
    }
  }
  
  container.innerHTML = '';
  blockedUsers.forEach(user => {
    const div = document.createElement('div');
    div.className = 'blocked-user-item';
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${user.avatar || ''})"></div>
      <div class="blocked-user-info">
        <div class="blocked-user-name">${user.nickname}</div>
        <div class="blocked-user-id">${user.userId}</div>
      </div>
      <button class="btn btn-secondary unblock-btn" data-uid="${user.id}">Розблокувати</button>
    `;
    
    div.querySelector('.unblock-btn').addEventListener('click', async () => {
      await unblockUser(user.id);
      currentUserData.blockedUsers = currentUserData.blockedUsers.filter(id => id !== user.id);
      loadBlockedUsers();
    });
    
    container.appendChild(div);
  });
}

function loadAccountStats() {
  if (!currentUserData) return;
  
  const statsContainer = document.getElementById('accountStats');
  if (statsContainer) {
    statsContainer.innerHTML = `
      <h4>Статистика</h4>
      <div class="stat-item">
        <span class="stat-value">${currentUserData.posts?.length || 0}</span>
        <span class="stat-label">Постів</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${currentUserData.followers?.length || 0}</span>
        <span class="stat-label">Підписників</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${currentUserData.following?.length || 0}</span>
        <span class="stat-label">Підписок</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${currentUserData.likedPosts?.length || 0}</span>
        <span class="stat-label">Лайків</span>
      </div>
    `;
  }
  
  const accountInfo = document.getElementById('accountInfo');
  if (accountInfo && currentUser) {
    accountInfo.innerHTML = `
      <h4>Інформація</h4>
      <div class="info-row">
        <span class="info-label">ID користувача:</span>
        <span class="info-value">${currentUserData.userId}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Email:</span>
        <span class="info-value">${currentUserData.email || 'Не вказано'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Дата реєстрації:</span>
        <span class="info-value">${currentUserData.createdAt ? new Date(currentUserData.createdAt.seconds * 1000).toLocaleDateString() : 'Невідомо'}</span>
      </div>
    `;
  }
}

async function updateStorageInfo() {
  const infoDiv = document.getElementById('storageInfo');
  if (!infoDiv) return;

  let postCount = 0;
  if (currentUser) {
    const postsQuery = query(collection(db, "posts"), where("author", "==", currentUser.uid));
    const postsSnap = await getDocs(postsQuery);
    postCount = postsSnap.size;
  }

  let localStorageSize = 0;
  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      localStorageSize += (localStorage[key].length * 2) / 1024;
    }
  }

  infoDiv.innerHTML = `
    <p>Кількість ваших постів: ${postCount}</p>
    <p>Дані в браузері: ${localStorageSize.toFixed(2)} КБ</p>
    <p class="text-secondary">* Точний обсяг медіа на сервері не відображається.</p>
  `;
}

document.getElementById('clearCacheBtn')?.addEventListener('click', async () => {
  const keysToKeep = ['theme', 'notifyPrivateChats'];
  Object.keys(localStorage).forEach(key => {
    if (!keysToKeep.includes(key)) localStorage.removeItem(key);
  });

  if ('caches' in window) {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map(name => caches.delete(name)));
  }

  showToast('Кеш очищено');
});

document.getElementById('clearSavedMediaBtn')?.addEventListener('click', async () => {
  if (!currentUser) return;
  if (!confirm('Видалити всі збережені медіа? Це не впливає на самі пости.')) return;

  const userRef = doc(db, "users", currentUser.uid);
  await updateDoc(userRef, { savedPosts: [] });
  showToast('Збережені медіа очищено');
});

// ================= Інші обробники =================
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

document.getElementById('privacyPolicyBtn').onclick = () => {
  document.getElementById('privacyPolicyModal').classList.add('active');
};
document.getElementById('closePrivacyModal').onclick = () => {
  document.getElementById('privacyPolicyModal').classList.remove('active');
};

document.getElementById('logoutBtn').onclick = () => {
  cleanupListeners();
  signOut(auth);
};

const sentinel = document.getElementById('feedSentinel');
if (sentinel) {
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) loadMorePosts();
  }, { threshold: 0.5 });
  observer.observe(sentinel);
}

// ================= ГЛОБАЛЬНИЙ ОБРОБНИК КЛІКІВ =================
document.addEventListener('click', async (e) => {
  const targetBtn = e.target.closest('button');
  if (!targetBtn) return;

  if (!currentUser) {
    if (targetBtn.classList.contains('like-btn') || targetBtn.classList.contains('save-btn') || targetBtn.classList.contains('follow-btn-post')) {
      showToast('Увійдіть, щоб виконати цю дію');
      return;
    }
    return;
  }

  if (targetBtn.classList.contains('like-btn')) {
    const postId = targetBtn.dataset.postId;
    await toggleLike(postId, targetBtn);
  }

  if (targetBtn.classList.contains('save-btn')) {
    const postId = targetBtn.dataset.postId;
    await toggleSave(postId, targetBtn);
  }
});

document.addEventListener('click', (e) => {
  const uidElement = e.target.closest('[data-uid]');
  if (uidElement) {
    const uid = uidElement.dataset.uid;
    viewProfile(uid);
  }
});

// ================= НОВІ ОБРОБНИКИ ДЛЯ ФІЛЬТРІВ =================
document.getElementById('filterBtn').onclick = async () => {
  await loadFilterHashtags();
  document.getElementById('filterModal').classList.add('active');
};

document.getElementById('closeFilterModal').onclick = () => {
  document.getElementById('filterModal').classList.remove('active');
};

document.getElementById('clearFilterBtn').onclick = clearFilter;

// ================= Навігація по вкладках налаштувань =================
document.querySelectorAll('.settings-nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    document.querySelectorAll('.settings-nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.settings-tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(`settings-${tab}`)?.classList.add('active');
  });
});

// Ініціалізація слухачів налаштувань після завантаження DOM
document.addEventListener('DOMContentLoaded', () => {
  setupSettingsListeners();
});
