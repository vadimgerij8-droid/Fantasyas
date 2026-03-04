import { db } from './config.js';
import { 
  doc, getDoc, updateDoc, setDoc, addDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, 
  serverTimestamp, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { 
  currentUser, currentUserData, currentUserFollowing, setCurrentUserData, setCurrentUserFollowing,
  userSettings, navigationHistory, previousSection
} from './state.js';
import { showToast, uploadToCloudinary, vibrate, debounce } from './utils.js';
import { renderPosts } from './posts.js';
import { getChatId, openChat } from './chat.js';

// ================= Підписка/відписка =================
export const toggleFollow = debounce(async (targetUid, buttonElement) => {
  if (!currentUser) return;

  const wasFollowing = currentUserFollowing.includes(targetUid);
  const newFollowingState = !wasFollowing;

  // Оптимістичне оновлення UI
  if (newFollowingState) {
    // мутуємо масив (не присвоюємо новий)
    currentUserFollowing.push(targetUid);
  } else {
    const index = currentUserFollowing.indexOf(targetUid);
    if (index !== -1) currentUserFollowing.splice(index, 1);
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
    // Відкочуємо оптимістичне оновлення
    if (newFollowingState) {
      const index = currentUserFollowing.indexOf(targetUid);
      if (index !== -1) currentUserFollowing.splice(index, 1);
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

// ================= Завантаження профілю =================
export async function viewProfile(uid) {
  const currentSection = document.querySelector('.section.active')?.id || 'home';
  if (currentSection !== 'profile') {
    navigationHistory.push(currentSection);
    previousSection = currentSection;
  }

  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
  const profileNav = document.querySelector('[data-section="profile"]');
  if (profileNav) profileNav.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  const profileSection = document.getElementById('profile');
  if (profileSection) profileSection.classList.add('active');
  document.getElementById('pageTitle').textContent = 'Профіль';

  if (uid !== currentUser?.uid) {
    document.querySelector('.back-btn').classList.add('visible');
  } else {
    document.querySelector('.back-btn').classList.remove('visible');
  }

  if (uid === currentUser?.uid) {
    await loadMyProfile();
  } else {
    await loadUserProfile(uid);
  }
}

async function loadMyProfile() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (snap.exists()) renderProfile(snap.data(), currentUser.uid, true);
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
        document.getElementById('editNote').value = data.note || '';
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

// ================= Завантаження стрічки профілю =================
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
  if (posts.length > 0) {
    const fakeDocs = posts.map(p => ({ id: p.id, data: () => p }));
    renderPosts(fakeDocs, 'profileFeed');
  } else {
    feed.innerHTML = '<p style="text-align:center; padding:20px;">Немає постів</p>';
  }
}

// ================= Редагування профілю =================
export async function saveProfileEdit(nickname, bio, note, avatarFile) {
  if (!currentUser) return;
  if (!nickname) {
    showToast('Псевдонім обов’язковий');
    return false;
  }

  const newUserId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", newUserId));
  const snap = await getDocs(q);
  if (!snap.empty && snap.docs[0].id !== currentUser.uid) {
    showToast('Цей ID вже зайнятий');
    return false;
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
    await loadMyProfile();
    document.getElementById('editProfileModal').classList.remove('active');
    showToast('Профіль оновлено');
    return true;
  } catch (e) {
    showToast('Помилка: ' + e.message);
    return false;
  }
}

// ================= Списки підписників/підписок =================
export async function openFollowersList(uid) {
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

export async function openFollowingList(uid) {
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

// ================= Функції для скарг, мюту, блокування =================
export async function reportUser(targetUid, reason = '') {
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

export async function muteUser(targetUid) {
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

export async function unmuteUser(targetUid) {
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

export async function blockUser(targetUid) {
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

export async function unblockUser(targetUid) {
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
