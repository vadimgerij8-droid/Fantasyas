import { auth, db } from './config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  setCurrentUser,
  setCurrentUserData,
  setCurrentUserFollowing,
  getCurrentUser
} from './state.js';
import { showToast } from './utils.js';

let onUserChangeCallback = null;
let lastOnlineInterval = null;

export function setOnUserChangeCallback(callback) {
  onUserChangeCallback = callback;
}

export function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      setCurrentUser(user);
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);
      if (userSnap.exists()) {
        setCurrentUserData(userSnap.data());
        setCurrentUserFollowing(userSnap.data().following || []);
      }
      startLastOnlineInterval();
      if (onUserChangeCallback) onUserChangeCallback(user);
    } else {
      setCurrentUser(null);
      setCurrentUserData(null);
      setCurrentUserFollowing([]);
      if (lastOnlineInterval) clearInterval(lastOnlineInterval);
      if (onUserChangeCallback) onUserChangeCallback(null);
    }
  });
}

function startLastOnlineInterval() {
  if (lastOnlineInterval) clearInterval(lastOnlineInterval);
  lastOnlineInterval = setInterval(() => {
    const user = getCurrentUser();
    if (user) {
      updateDoc(doc(db, "users", user.uid), { lastOnline: serverTimestamp() }).catch(console.error);
    }
  }, 30000);
}

// ================= Реєстрація =================
export async function register(nickname, password) {
  if (!nickname) { showToast('Введіть псевдонім'); return false; }
  if (password.length < 6) { showToast('Мінімум 6 символів'); return false; }

  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (!snap.empty) { showToast('Цей ID вже зайнятий'); return false; }

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
      note: '',
      posts: [],
      likedPosts: [],
      savedPosts: [],
      followers: [],
      following: [],
      mutedUsers: [],
      blockedUsers: [],
      settings: {
        notifications: { push: true, email: true, sms: false, privateChats: true, likes: true, comments: true, newFollowers: true, mentions: true, directMessages: true, storyReplies: true },
        privacy: { privateAccount: false, activityStatus: true, storySharing: true, allowTags: 'everyone', allowMentions: 'everyone', blockedAccounts: [], whoCanMessage: 'everyone', whoCanSeeOnline: 'everyone', whoCanSeeFollowers: 'everyone' },
        security: { twoFactor: false, loginAlerts: true, savedLogins: [] },
        preferences: { language: 'uk', darkMode: false, reduceMotion: false, highContrast: false, autoplayVideos: true, soundEffects: true }
      },
      createdAt: serverTimestamp(),
      lastOnline: serverTimestamp(),
      email: email
    });

    showToast('Реєстрація успішна');
    return true;
  } catch (e) {
    showToast(e.message);
    return false;
  }
}

// ================= Вхід =================
export async function login(nickname, password) {
  if (!nickname || !password) { showToast('Заповніть поля'); return; }
  try {
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) { showToast('Користувача не знайдено'); return; }

    const userData = snap.docs[0].data();
    const email = userData.email;
    if (!email) {
      showToast('Для цього акаунту не вказано email. Увійдіть через Google/Apple або створіть новий акаунт.');
      return;
    }

    await signInWithEmailAndPassword(auth, email, password);
    showToast('Ласкаво просимо!');
  } catch (err) {
    showToast('Невірний псевдонім або пароль');
  }
}

// ================= Google Login =================
export async function googleLogin() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
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
        settings: {
          notifications: { push: true, email: true, sms: false, privateChats: true, likes: true, comments: true, newFollowers: true, mentions: true, directMessages: true, storyReplies: true },
          privacy: { privateAccount: false, activityStatus: true, storySharing: true, allowTags: 'everyone', allowMentions: 'everyone', blockedAccounts: [], whoCanMessage: 'everyone', whoCanSeeOnline: 'everyone', whoCanSeeFollowers: 'everyone' },
          security: { twoFactor: false, loginAlerts: true, savedLogins: [] },
          preferences: { language: 'uk', darkMode: false, reduceMotion: false, highContrast: false, autoplayVideos: true, soundEffects: true }
        },
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
}

// ================= Apple Login =================
export async function appleLogin() {
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
        settings: {
          notifications: { push: true, email: true, sms: false, privateChats: true, likes: true, comments: true, newFollowers: true, mentions: true, directMessages: true, storyReplies: true },
          privacy: { privateAccount: false, activityStatus: true, storySharing: true, allowTags: 'everyone', allowMentions: 'everyone', blockedAccounts: [], whoCanMessage: 'everyone', whoCanSeeOnline: 'everyone', whoCanSeeFollowers: 'everyone' },
          security: { twoFactor: false, loginAlerts: true, savedLogins: [] },
          preferences: { language: 'uk', darkMode: false, reduceMotion: false, highContrast: false, autoplayVideos: true, soundEffects: true }
        },
        createdAt: serverTimestamp(),
        lastOnline: serverTimestamp(),
        email: user.email
      });
    }
    showToast('Вхід через Apple успішний');
  } catch (error) {
    showToast('Помилка: ' + error.message);
  }
}

// ================= Забули пароль =================
export async function forgotPassword(nickname) {
  if (!nickname) return;
  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (snap.empty) { showToast('Користувача не знайдено'); return; }

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
}
