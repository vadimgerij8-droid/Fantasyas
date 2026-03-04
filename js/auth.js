import { auth, db } from './config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, OAuthProvider, signInWithPopup, sendPasswordResetEmail, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, setDoc, getDoc, collection, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { showToast } from './utils.js';
import { userSettings } from './state.js';

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
      nickname, userId, nickname_lower: nickname.toLowerCase().trim(), bio: '', avatar: '', note: '', posts: [], likedPosts: [], savedPosts: [], followers: [], following: [], mutedUsers: [], blockedUsers: [], settings: { ...userSettings }, createdAt: serverTimestamp(), lastOnline: serverTimestamp(), email
    });
    showToast('Реєстрація успішна'); return true;
  } catch (e) { showToast(e.message); return false; }
}

export async function login(nickname, password) {
  if (!nickname || !password) { showToast('Заповніть поля'); return false; }
  try {
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) { showToast('Користувача не знайдено'); return false; }
    const userDoc = snap.docs[0];
    const userData = userDoc.data();
    const email = userData.email;
    if (!email) { showToast('Для цього акаунту не встановлено email.'); return false; }
    await signInWithEmailAndPassword(auth, email, password);
    showToast('Ласкаво просимо!'); return true;
  } catch (err) { showToast('Невірний псевдонім або пароль'); return false; }
}

export async function googleLogin() {
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: 'select_account' });
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
        nickname, userId, nickname_lower: nickname.toLowerCase().trim(), bio: '', avatar: user.photoURL || '', note: '', posts: [], likedPosts: [], savedPosts: [], followers: [], following: [], mutedUsers: [], blockedUsers: [], settings: { ...userSettings }, createdAt: serverTimestamp(), lastOnline: serverTimestamp(), email: user.email
      });
    }
    showToast('Вхід через Google успішний');
  } catch (error) { showToast('Помилка входу: ' + error.message); }
}

export async function appleLogin() {
  const provider = new OAuthProvider('apple.com'); provider.addScope('email'); provider.addScope('name');
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
        nickname, userId, nickname_lower: nickname.toLowerCase().trim(), bio: '', avatar: user.photoURL || '', note: '', posts: [], likedPosts: [], savedPosts: [], followers: [], following: [], mutedUsers: [], blockedUsers: [], settings: { ...userSettings }, createdAt: serverTimestamp(), lastOnline: serverTimestamp(), email: user.email
      });
    }
    showToast('Вхід через Apple успішний');
  } catch (error) { showToast('Помилка: ' + error.message); }
}

export async function resetPassword(nickname) {
  if (!nickname) return false;
  const userId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", userId));
  const snap = await getDocs(q);
  if (snap.empty) { showToast('Користувача не знайдено'); return false; }
  const userData = snap.docs[0].data();
  const email = userData.email;
  if (!email) { showToast('Для цього акаунту не вказано email.'); return false; }
  try { await sendPasswordResetEmail(auth, email); showToast('Лист для скидання пароля відправлено'); return true; } 
  catch (err) { showToast('Помилка: ' + err.message); return false; }
}

export async function logout() {
  try { await signOut(auth); } catch (err) { showToast('Помилка виходу: ' + err.message); }
}
