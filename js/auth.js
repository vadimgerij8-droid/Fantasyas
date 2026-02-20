import { auth, db } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, GoogleAuthProvider, OAuthProvider, signInWithPopup, sendPasswordResetEmail, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, setDoc, getDoc, getDocs, query, where, collection, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { showToast } from './helpers.js';

// Функція ініціалізації авторизації – приймає колбеки onLogin та onLogout
export function initAuth(onLogin, onLogout) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      // Оновлюємо lastOnline при кожному вході
      try {
        await updateDoc(doc(db, "users", user.uid), { lastOnline: serverTimestamp() });
      } catch (e) {}
      onLogin(user);
    } else {
      onLogout();
    }
  });

  // Встановлюємо обробники подій для форм авторизації
  document.getElementById('toRegister').onclick = () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
    setTimeout(() => { 
      if (window.updateFocusableCache) window.updateFocusableCache(); 
      const el = document.getElementById('registerNickname');
      if (el && window.setFocusOnElement) window.setFocusOnElement(el);
    }, 50);
  };

  document.getElementById('toLogin').onclick = () => {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
    setTimeout(() => { 
      if (window.updateFocusableCache) window.updateFocusableCache(); 
      const el = document.getElementById('loginNickname');
      if (el && window.setFocusOnElement) window.setFocusOnElement(el);
    }, 50);
  };

  document.getElementById('registerBtn').onclick = async () => {
    const nickname = document.getElementById('registerNickname').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    if (!nickname) return alert('Введіть псевдонім');
    if (password.length < 6) return alert('Мінімум 6 символів');
    
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (!snap.empty) return alert('Цей ID вже зайнятий');
    
    try {
      const safeNick = nickname.toLowerCase().replace(/[^a-z0-9]/g, '');
      const randomSuffix = Math.floor(Math.random() * 10000);
      const email = `${safeNick}_${randomSuffix}@fantasyas.local`;
      
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      
      await setDoc(doc(db, "users", cred.user.uid), {
        nickname,
        userId,
        nickname_lower: nickname.toLowerCase(),
        bio: '',
        avatar: '',
        posts: [],
        likedPosts: [],
        savedPosts: [],
        followers: [],
        following: [],
        mutedUsers: [],
        blockedUsers: [],
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
    if (!nickname || !password) return alert('Заповніть поля');
    try {
      const userId = `@${nickname.toLowerCase()}`;
      const q = query(collection(db, "users"), where("userId", "==", userId));
      const snap = await getDocs(q);
      if (snap.empty) return alert('Користувача не знайдено');
      
      const userDoc = snap.docs[0];
      const userData = userDoc.data();
      const email = userData.email;
      
      if (!email) {
        return alert('Для цього акаунту не встановлено email. Увійдіть через Google або Apple, або створіть новий акаунт.');
      }
      
      await signInWithEmailAndPassword(auth, email, password);
      showToast('Ласкаво просимо!');
    } catch (err) {
      alert('Невірний псевдонім або пароль');
    }
  };

  document.getElementById('googleLoginBtn').onclick = async () => {
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
          nickname_lower: nickname.toLowerCase(),
          bio: '',
          avatar: user.photoURL || '',
          posts: [],
          likedPosts: [],
          savedPosts: [],
          followers: [],
          following: [],
          mutedUsers: [],
          blockedUsers: [],
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
          nickname_lower: nickname.toLowerCase(),
          bio: '',
          avatar: user.photoURL || '',
          posts: [],
          likedPosts: [],
          savedPosts: [],
          followers: [],
          following: [],
          mutedUsers: [],
          blockedUsers: [],
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
    if (snap.empty) return alert('Користувача не знайдено');
    
    const userData = snap.docs[0].data();
    const email = userData.email;
    if (!email) return alert('Для цього акаунту не вказано email. Увійдіть через Google/Apple або створіть новий акаунт.');
    
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('Лист для скидання пароля відправлено');
    } catch (err) {
      showToast('Помилка: ' + err.message);
    }
  };
}
