import { auth, db } from './config.js';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  GoogleAuthProvider, 
  OAuthProvider, 
  signInWithPopup, 
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { showToast, stopHeartbeat } from './utils.js';
import { state } from './state.js';

// ================= Хелпери =================

// Базова структура нового користувача
function buildUserData(nickname, userId, email, avatarUrl = '') {
  return {
    nickname,
    userId,
    nickname_lower: nickname.toLowerCase().trim(),
    bio: '',
    avatar: avatarUrl,
    note: '',
    posts: [],
    likedPosts: [],
    savedPosts: [],
    followers: [],
    following: [],
    mutedUsers: [],
    blockedUsers: [],
    settings: { ...state.userSettings },
    createdAt: serverTimestamp(),
    lastSeen: serverTimestamp(),
    email: email || ''
  };
}

// ВИПРАВЛЕННЯ: винесено дубльовану логіку Google/Apple у спільну функцію.
// Також виправлено: якщо перший варіант userId зайнятий — пробуємо до 5 разів
// замість одного рандому, який теж міг виявитись зайнятим.
async function createSocialUser(user) {
  const existingDoc = await getDoc(doc(db, "users", user.uid));
  if (existingDoc.exists()) return; // Вже зареєстрований

  const baseName = user.displayName || user.email?.split('@')[0] || 'user';
  let userId = `@${baseName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  // Якщо базовий userId порожній після очищення — fallback
  if (userId === '@') userId = '@user';

  let finalUserId = userId;
  let attempts = 0;
  const MAX_ATTEMPTS = 5;

  while (attempts < MAX_ATTEMPTS) {
    const q = query(collection(db, "users"), where("userId", "==", finalUserId));
    const snap = await getDocs(q);
    if (snap.empty) break;
    finalUserId = `${userId}${Math.floor(Math.random() * 10000)}`;
    attempts++;
  }

  if (attempts === MAX_ATTEMPTS) {
    // Малоймовірно, але якщо всі спроби зайняті — використовуємо uid як суфікс
    finalUserId = `${userId}_${user.uid.slice(0, 6)}`;
  }

  const userData = buildUserData(
    user.displayName || baseName,
    finalUserId,
    user.email,
    user.photoURL || ''
  );

  await setDoc(doc(db, "users", user.uid), userData);
}

// ================= Реєстрація =================
export async function register(nickname, password) {
  if (!nickname) {
    showToast('Введіть псевдонім');
    return false;
  }
  if (password.length < 6) {
    showToast('Мінімум 6 символів');
    return false;
  }

  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (!snap.empty) {
    showToast('Цей ID вже зайнятий');
    return false;
  }

  try {
    // ВИПРАВЛЕННЯ: якщо nickname містить лише кирилицю або спецсимволи,
    // safeNick ставав порожнім рядком → email: "_1234@fantasyas.local"
    const safeNick = nickname.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
    const randomSuffix = Math.floor(Math.random() * 10000);
    const email = `${safeNick}_${randomSuffix}@fantasyas.local`;

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, "users", cred.user.uid), buildUserData(nickname, userId, email));

    showToast('Реєстрація успішна');
    return true;
  } catch (e) {
    // Показуємо зрозуміле повідомлення замість технічного тексту Firebase
    if (e.code === 'auth/email-already-in-use') {
      showToast('Цей псевдонім вже зайнятий. Спробуйте інший.');
    } else {
      showToast('Помилка реєстрації: ' + e.message);
    }
    return false;
  }
}

// ================= Вхід =================
export async function login(nickname, password) {
  if (!nickname || !password) {
    showToast('Заповніть поля');
    return false;
  }
  try {
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) {
      showToast('Користувача не знайдено');
      return false;
    }

    const userData = snap.docs[0].data();
    const email = userData.email;

    if (!email) {
      showToast('Для цього акаунту не встановлено email. Увійдіть через Google або Apple, або створіть новий акаунт.');
      return false;
    }

    await signInWithEmailAndPassword(auth, email, password);
    showToast('Ласкаво просимо!');
    return true;
  } catch (err) {
    showToast('Невірний псевдонім або пароль');
    return false;
  }
}

// ================= Вхід через Google =================
export async function googleLogin() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await signInWithPopup(auth, provider);
    await createSocialUser(result.user); // ВИПРАВЛЕННЯ: використовуємо спільну функцію
    showToast('Вхід через Google успішний');
  } catch (error) {
    console.error('Google login error:', error);
    if (error.code === 'auth/popup-blocked') {
      showToast('Будь ласка, дозвольте спливаючі вікна для цього сайту.');
    } else if (error.code === 'auth/operation-not-allowed') {
      showToast('Вхід через Google не налаштовано в Firebase.');
    } else if (error.code === 'auth/popup-closed-by-user') {
      // Користувач сам закрив вікно — не показуємо помилку
    } else {
      showToast('Помилка входу: ' + error.message);
    }
  }
}

// ================= Вхід через Apple =================
export async function appleLogin() {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  try {
    const result = await signInWithPopup(auth, provider);
    await createSocialUser(result.user); // ВИПРАВЛЕННЯ: використовуємо спільну функцію
    showToast('Вхід через Apple успішний');
  } catch (error) {
    console.error('Apple login error:', error);
    if (error.code === 'auth/popup-closed-by-user') {
      // Користувач сам закрив вікно — не показуємо помилку
    } else {
      showToast('Помилка: ' + error.message);
    }
  }
}

// ================= Скидання пароля =================
export async function resetPassword(nickname) {
  if (!nickname) return false;

  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);

  if (snap.empty) {
    showToast('Користувача не знайдено');
    return false;
  }

  const userData = snap.docs[0].data();
  const email = userData.email;

  if (!email) {
    showToast('Для цього акаунту не вказано email. Увійдіть через Google/Apple або створіть новий акаунт.');
    return false;
  }

  // ВИПРАВЛЕННЯ: акаунти зареєстровані через nickname мають email @fantasyas.local —
  // реальний лист на цей домен не дійде, попереджаємо користувача.
  if (email.endsWith('@fantasyas.local')) {
    showToast('Скидання пароля через email недоступне для цього типу акаунту. Зверніться до підтримки.');
    return false;
  }

  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Лист для скидання пароля відправлено');
    return true;
  } catch (err) {
    showToast('Помилка: ' + err.message);
    return false;
  }
}

// ================= Вихід =================
export async function logout() {
  // ВИПРАВЛЕННЯ: явна обробка помилки updateDoc замість мовчазного .catch(console.error)
  if (state.currentUser) {
    try {
      const userRef = doc(db, "users", state.currentUser.uid);
      await updateDoc(userRef, { lastSeen: serverTimestamp() });
    } catch (err) {
      console.error('Помилка оновлення lastSeen при виході:', err);
    }
  }

  stopHeartbeat();

  try {
    await signOut(auth);
  } catch (err) {
    showToast('Помилка виходу: ' + err.message);
  }
}
