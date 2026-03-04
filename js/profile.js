import { db } from './config.js';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  updateDoc,
  arrayUnion,
  arrayRemove,
  writeBatch,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getCurrentUser,
  getCurrentUserFollowing,
  setCurrentUserFollowing,
  setCurrentProfileUid
} from './state.js';
import { showToast, vibrate, debounce } from './utils.js';
import { loadUserPosts } from './posts.js';

// ================= Перегляд профілю =================
export async function viewProfile(uid) {
  setCurrentProfileUid(uid);
  const profileHeader = document.getElementById('profileHeader');
  profileHeader.innerHTML = '<div class="skeleton" style="height:200px;"></div>';

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      showToast('Користувача не знайдено');
      return;
    }
    const userData = userSnap.data();
    renderProfileHeader(userData, uid);
    await loadUserPosts(uid, 'profilePosts');
  } catch (error) {
    console.error('Error loading profile:', error);
    showToast('Помилка завантаження профілю');
  }
}

// ================= Рендер шапки профілю (повний HTML з оригіналу) =================
function renderProfileHeader(userData, uid) {
  const header = document.getElementById('profileHeader');
  const currentUser = getCurrentUser();
  const isFollowing = getCurrentUserFollowing().includes(uid);

  header.innerHTML = `
    <div class="profile-avatar">
      <img src="${userData.avatar || 'default-avatar.png'}" alt="avatar">
    </div>
    <div class="profile-info">
      <h2>${userData.nickname}</h2>
      <p class="profile-userid">${userData.userId}</p>
      <p class="profile-bio">${userData.bio || ''}</p>
      <div class="profile-stats">
        <span><strong>${userData.posts?.length || 0}</strong> постів</span>
        <span><strong>${userData.followers?.length || 0}</strong> підписників</span>
        <span><strong>${userData.following?.length || 0}</strong> підписок</span>
      </div>
      ${currentUser && currentUser.uid !== uid ? `
        <button class="follow-btn ${isFollowing ? 'following' : ''}" data-uid="${uid}">
          ${isFollowing ? 'Відписатися' : 'Підписатися'}
        </button>
      ` : ''}
    </div>
  `;

  if (currentUser && currentUser.uid !== uid) {
    const followBtn = header.querySelector('.follow-btn');
    followBtn.addEventListener('click', () => toggleFollow(uid, followBtn));
  }
}

// ================= Підписка/відписка =================
export const toggleFollow = debounce(async (targetUid, buttonElement) => {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const currentFollowing = getCurrentUserFollowing();
  const wasFollowing = currentFollowing.includes(targetUid);
  const newFollowingState = !wasFollowing;

  if (newFollowingState) {
    setCurrentUserFollowing([...currentFollowing, targetUid]);
  } else {
    setCurrentUserFollowing(currentFollowing.filter(id => id !== targetUid));
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
      setCurrentUserFollowing(currentFollowing.filter(id => id !== targetUid));
    } else {
      setCurrentUserFollowing([...currentFollowing, targetUid]);
    }
    if (buttonElement) {
      buttonElement.textContent = wasFollowing ? 'Відписатися' : 'Підписатися';
      buttonElement.classList.toggle('following', wasFollowing);
    }
    showToast('Помилка: ' + (error.message || 'Невідома помилка'));
  }
}, 300);

// ================= Скарга на користувача =================
export async function reportUser(targetUid, reason = '') {
  if (!getCurrentUser()) return;
  try {
    await addDoc(collection(db, "reports"), {
      reportedUserId: targetUid,
      reporterId: getCurrentUser().uid,
      reason: reason || 'Без причини',
      timestamp: serverTimestamp()
    });
    showToast('Скаргу надіслано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

// ================= Мют користувача =================
export async function muteUser(targetUid) {
  if (!getCurrentUser()) return;
  const userRef = doc(db, "users", getCurrentUser().uid);
  try {
    await updateDoc(userRef, { mutedUsers: arrayUnion(targetUid) });
    showToast('Користувача замучено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

export async function unmuteUser(targetUid) {
  if (!getCurrentUser()) return;
  const userRef = doc(db, "users", getCurrentUser().uid);
  try {
    await updateDoc(userRef, { mutedUsers: arrayRemove(targetUid) });
    showToast('Користувача розмучено');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

// ================= Блокування користувача =================
export async function blockUser(targetUid) {
  if (!getCurrentUser()) return;
  const userRef = doc(db, "users", getCurrentUser().uid);
  try {
    await updateDoc(userRef, { blockedUsers: arrayUnion(targetUid) });
    showToast('Користувача заблоковано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}

export async function unblockUser(targetUid) {
  if (!getCurrentUser()) return;
  const userRef = doc(db, "users", getCurrentUser().uid);
  try {
    await updateDoc(userRef, { blockedUsers: arrayRemove(targetUid) });
    showToast('Користувача розблоковано');
  } catch (e) {
    showToast('Помилка: ' + e.message);
  }
}
