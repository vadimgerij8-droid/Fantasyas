import { db } from ‘./config.js’;
import {
doc, getDoc, updateDoc, collection, query, where, getDocs, arrayUnion, arrayRemove,
serverTimestamp, writeBatch, setDoc, addDoc
} from “https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js”;
import {
state,
setCurrentUserData
} from ‘./state.js’;
import { showToast, uploadToCloudinary, vibrate, debounce } from ‘./utils.js’;
import { renderPosts } from ‘./posts.js’;
import { getChatId, openChat } from ‘./chat.js’;

// ================= Допоміжні функції =================
function escapeHTML(str) {
if (!str) return ‘’;
return String(str)
.replace(/&/g, ‘&’)
.replace(/</g, ‘<’)
.replace(/>/g, ‘>’)
.replace(/”/g, ‘"’)
.replace(/’/g, ‘'’);
}

// ================= Змінна для відстеження поточного профілю =================
let currentProfileUid = null;

// ================= Допоміжна функція для показу/приховування блоку створення поста =================
function updateNewPostBoxVisibility() {
const newPostBox = document.getElementById(‘newPostBox’);
if (!newPostBox) return;

const profileSection = document.getElementById(‘profile’);
if (!profileSection || !profileSection.classList.contains(‘active’)) {
newPostBox.style.display = ‘none’;
return;
}

if (!state.currentUser || currentProfileUid !== state.currentUser.uid) {
newPostBox.style.display = ‘none’;
return;
}

const postsTab = document.querySelector(’.profile-tab[data-tab=“posts”]’);
const isPostsActive = postsTab && postsTab.classList.contains(‘active’);
newPostBox.style.display = isPostsActive ? ‘block’ : ‘none’;
}

// ================= Підписка/відписка =================
export const toggleFollow = debounce(async (targetUid, buttonElement) => {
if (!state.currentUser) return;

const wasFollowing = state.currentUserFollowing.includes(targetUid);
const newFollowingState = !wasFollowing;

if (newFollowingState) {
state.currentUserFollowing.push(targetUid);
} else {
state.currentUserFollowing = state.currentUserFollowing.filter(id => id !== targetUid);
}

if (buttonElement) {
buttonElement.textContent = newFollowingState ? ‘Відписатися’ : ‘Підписатися’;
buttonElement.classList.toggle(‘following’, newFollowingState);
}

try {
const myRef = doc(db, “users”, state.currentUser.uid);
const targetRef = doc(db, “users”, targetUid);
const batch = writeBatch(db);

```
if (wasFollowing) {
  batch.update(myRef, { following: arrayRemove(targetUid) });
  batch.update(targetRef, { followers: arrayRemove(state.currentUser.uid) });
} else {
  batch.update(myRef, { following: arrayUnion(targetUid) });
  batch.update(targetRef, { followers: arrayUnion(state.currentUser.uid) });
  vibrate(30);
}
await batch.commit();
```

} catch (error) {
console.error(‘Follow error:’, error);
// Відкочуємо оптимістичне оновлення
if (newFollowingState) {
state.currentUserFollowing = state.currentUserFollowing.filter(id => id !== targetUid);
} else {
state.currentUserFollowing.push(targetUid);
}
if (buttonElement) {
buttonElement.textContent = wasFollowing ? ‘Відписатися’ : ‘Підписатися’;
buttonElement.classList.toggle(‘following’, wasFollowing);
}
if (error.code === ‘permission-denied’) {
showToast(‘Помилка: недостатньо прав. Перевірте правила безпеки Firestore.’);
} else {
showToast(’Помилка: ’ + (error.message || ‘Невідома помилка’));
}
}
}, 300);

// ================= Завантаження профілю =================
export async function viewProfile(uid) {
try {
const currentSection = document.querySelector(’.section.active’)?.id || ‘home’;
if (currentSection !== ‘profile’) {
state.navigationHistory.push(currentSection);
state.previousSection = currentSection;
}

```
document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
const profileNav = document.querySelector('[data-section="profile"]');
if (profileNav) profileNav.classList.add('active');
document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
const profileSection = document.getElementById('profile');
if (profileSection) profileSection.classList.add('active');
document.getElementById('pageTitle').textContent = 'Профіль';

if (uid !== state.currentUser?.uid) {
  document.querySelector('.back-btn')?.classList.add('visible');
} else {
  document.querySelector('.back-btn')?.classList.remove('visible');
}

currentProfileUid = uid;

if (uid === state.currentUser?.uid) {
  await loadMyProfile();
} else {
  await loadUserProfile(uid);
}
```

} catch (error) {
console.error(‘viewProfile error:’, error);
showToast(‘Не вдалося завантажити профіль’);
}
}

export async function loadMyProfile() {
try {
if (!state.currentUser) return;
const snap = await getDoc(doc(db, “users”, state.currentUser.uid));
if (snap.exists()) renderProfile(snap.data(), state.currentUser.uid, true);
} catch (error) {
console.error(‘loadMyProfile error:’, error);
showToast(‘Помилка завантаження вашого профілю’);
}
}

async function loadUserProfile(uid) {
try {
if (!state.currentUser) return;
const snap = await getDoc(doc(db, “users”, uid));
if (snap.exists()) renderProfile(snap.data(), uid, uid === state.currentUser.uid);
} catch (error) {
console.error(‘loadUserProfile error:’, error);
showToast(‘Не вдалося завантажити профіль користувача’);
}
}

function renderProfile(data, uid, isOwn) {
const header = document.getElementById(‘profileHeader’);
if (!header) return;

const isBlockedByTarget = data.blockedUsers?.includes(state.currentUser?.uid) || false;
const isBlockedByMe = state.currentUserData?.blockedUsers?.includes(uid) || false;

if (isBlockedByTarget || isBlockedByMe) {
header.innerHTML = `<div class="avatar large" style="background-image:url(${escapeHTML(data.avatar || '')})" data-uid="${escapeHTML(uid)}" tabindex="0"></div> <div> <h2>${escapeHTML(data.nickname)}</h2> <p class="text-danger"> ${isBlockedByTarget ? 'Цей користувач вас заблокував' : 'Ви заблокували цього користувача'} </p> </div>`;
return;
}

const isFollowing = !isOwn && state.currentUser
? (data.followers?.includes(state.currentUser.uid) || false)
: false;

const canSeeFollowers = () => {
if (isOwn) return true;
const privacy = data.settings?.privacy?.whoCanSeeFollowers || ‘everyone’;
if (privacy === ‘everyone’) return true;
if (privacy === ‘followers’ && isFollowing) return true;
return false;
};

const followersDisplay = canSeeFollowers() ? data.followers?.length || 0 : ‘Приховано’;
const followingDisplay = canSeeFollowers() ? data.following?.length || 0 : ‘Приховано’;

header.innerHTML = `<div class="avatar large" style="background-image:url(${escapeHTML(data.avatar || '')})" data-uid="${escapeHTML(uid)}" tabindex="0"></div> <div style="flex:1"> <h2>${escapeHTML(data.nickname)}</h2> <div class="user-id">${escapeHTML(data.userId)}</div> ${data.note ?`<div class="note-badge" style="position:relative; display:inline-block; margin-top:4px;">${escapeHTML(data.note)}</div>`: ''} <p>${escapeHTML(data.bio || '')}</p> <div class="profile-stats"> <span id="followersCount" data-uid="${escapeHTML(uid)}">${escapeHTML(String(followersDisplay))} підписників</span> <span id="followingCount" data-uid="${escapeHTML(uid)}">${escapeHTML(String(followingDisplay))} підписок</span> <span>${data.posts?.length || 0} постів</span> </div> ${!isOwn && state.currentUser ?`
<div style="display:flex; gap:10px; margin-top:10px; align-items:center;">
<button class="btn" id="profileFollowBtn" tabindex="0">${isFollowing ? ‘Відписатися’ : ‘Підписатися’}</button>
<button class="btn" id="profileMessageBtn" tabindex="0">Написати</button>
</div>
`: ''} ${isOwn ? '<button class="btn" id="editProfileBtn" tabindex="0">Редагувати</button>' : ''} </div> ${!isOwn && state.currentUser ?`
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
`: ''}`;

const avatar = header.querySelector(’.avatar’);
if (avatar) avatar.style.cursor = ‘pointer’;

const followersCount = document.getElementById(‘followersCount’);
if (followersCount && canSeeFollowers()) {
followersCount.style.cursor = ‘pointer’;
followersCount.onclick = () => openFollowersList(uid);
}
const followingCount = document.getElementById(‘followingCount’);
if (followingCount && canSeeFollowers()) {
followingCount.style.cursor = ‘pointer’;
followingCount.onclick = () => openFollowingList(uid);
}

if (!isOwn && state.currentUser) {
const profileFollowBtn = document.getElementById(‘profileFollowBtn’);
if (profileFollowBtn) {
profileFollowBtn.onclick = async () => {
await toggleFollow(uid, profileFollowBtn);
};
}

```
const profileMessageBtn = document.getElementById('profileMessageBtn');
if (profileMessageBtn) {
  profileMessageBtn.onclick = () => {
    const chatId = getChatId(state.currentUser.uid, uid);
    getDoc(doc(db, "chats", chatId)).then(async (docSnap) => {
      if (!docSnap.exists()) {
        await setDoc(doc(db, "chats", chatId), {
          participants: [state.currentUser.uid, uid],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastMessage: '',
          unread: { [state.currentUser.uid]: 0, [uid]: 0 }
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

  // ВИПРАВЛЕННЯ: замінено prompt() на showToast з запитом — 
  // prompt() блокує UI і не стилізується на мобільних
  document.getElementById('reportUserBtn').onclick = async () => {
    dropdown.classList.remove('show');
    await reportUser(uid, '');
  };

  document.getElementById('muteUserBtn').onclick = async () => {
    dropdown.classList.remove('show');
    try {
      const snap = await getDoc(doc(db, "users", state.currentUser.uid));
      const muted = snap.data().mutedUsers || [];
      if (muted.includes(uid)) {
        await unmuteUser(uid);
      } else {
        await muteUser(uid);
      }
    } catch (error) {
      console.error('Error toggling mute:', error);
      showToast('Помилка при зміні статусу мута');
    }
  };

  document.getElementById('blockUserBtn').onclick = async () => {
    dropdown.classList.remove('show');
    try {
      const snap = await getDoc(doc(db, "users", state.currentUser.uid));
      const blocked = snap.data().blockedUsers || [];
      if (blocked.includes(uid)) {
        await unblockUser(uid);
      } else {
        await blockUser(uid);
      }
      loadUserProfile(uid);
    } catch (error) {
      console.error('Error toggling block:', error);
      showToast('Помилка при блокуванні/розблокуванні');
    }
  };
}
```

}

if (isOwn) {
const editProfileBtn = document.getElementById(‘editProfileBtn’);
if (editProfileBtn) {
editProfileBtn.onclick = () => {
document.getElementById(‘editNickname’).value = data.nickname;
document.getElementById(‘editBio’).value = data.bio || ‘’;
document.getElementById(‘editNote’).value = data.note || ‘’;
document.getElementById(‘editAvatar’).value = ‘’;
const preview = document.getElementById(‘editAvatarPreview’);
if (preview) {
preview.src = data.avatar || ‘’;
preview.classList.add(‘show’);
}
document.getElementById(‘editProfileModal’).classList.add(‘active’);
};
}
}

// Вкладки профілю
const tabs = document.getElementById(‘profileTabs’);
if (tabs) {
tabs.innerHTML = `<div class="profile-tab active" data-tab="posts" tabindex="0">Пости</div> <div class="profile-tab" data-tab="likes" tabindex="0">Лайки</div> <div class="profile-tab" data-tab="media" tabindex="0">Медіа</div> <div class="profile-tab" data-tab="saved" tabindex="0">Збережене</div>`;
document.querySelectorAll(’.profile-tab’).forEach(tab => {
tab.onclick = () => {
document.querySelectorAll(’.profile-tab’).forEach(t => t.classList.remove(‘active’));
tab.classList.add(‘active’);
loadProfileFeed(uid, tab.dataset.tab);
updateNewPostBoxVisibility();
};
});
}

loadProfileFeed(uid, ‘posts’);
updateNewPostBoxVisibility();
}

// ================= Завантаження стрічки профілю =================
async function loadProfileFeed(uid, tab) {
const feed = document.getElementById(‘profileFeed’);
if (!feed) return;

feed.innerHTML = `<div class="skeleton" style="height:200px; margin-bottom:10px;"></div> <div class="skeleton" style="height:200px; margin-bottom:10px;"></div> <div class="skeleton" style="height:200px;"></div>`;

if (!state.currentUser) {
feed.innerHTML = ‘<p style="text-align:center; padding:20px;">Увійдіть, щоб переглянути</p>’;
return;
}

try {
const userSnap = await getDoc(doc(db, “users”, uid));
const userData = userSnap.data();

```
let postIds = [];
if (tab === 'posts' || tab === 'media') {
  postIds = userData.posts || [];
} else if (tab === 'likes') {
  postIds = userData.likedPosts || [];
} else if (tab === 'saved') {
  postIds = userData.savedPosts || [];
}

// ВИПРАВЛЕННЯ: завантажуємо всі пости паралельно замість послідовного for...of
const snapshots = await Promise.all(
  postIds.slice(0, 20).map(id => getDoc(doc(db, "posts", id)))
);

let posts = snapshots
  .filter(snap => snap.exists())
  .map(snap => ({ id: snap.id, ...snap.data() }));

if (tab === 'media') {
  posts = posts.filter(p => (p.media && p.media.length > 0) || p.mediaUrl);
}

posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

// ГОЛОВНЕ ВИПРАВЛЕННЯ: очищаємо postListeners для постів профільної стрічки
// перед рендером. Без цього renderPosts пропускав пости які вже були у Map
// слухачів (навіть якщо DOM вже очищено через feed.innerHTML = ''),
// тому лайки/збережені/медіа не відображались при перемиканні вкладок.
posts.forEach(p => {
  const unsub = state.postListeners.get(p.id);
  if (unsub) {
    unsub();
    state.postListeners.delete(p.id);
  }
});

feed.innerHTML = '';

if (posts.length > 0) {
  const fakeDocs = posts.map(p => ({ id: p.id, data: () => p }));
  renderPosts(fakeDocs, 'profileFeed');
} else {
  const emptyMessages = {
    posts: 'Немає постів',
    likes: 'Немає лайкнутих постів',
    media: 'Немає медіа',
    saved: 'Немає збережених постів'
  };
  feed.innerHTML = `<p style="text-align:center; padding:20px;">${emptyMessages[tab] || 'Немає постів'}</p>`;
}
```

} catch (error) {
console.error(‘loadProfileFeed error:’, error);
feed.innerHTML = ‘<p style="text-align:center; padding:20px; color:red;">Помилка завантаження</p>’;
}
}

// ================= Редагування профілю =================
export async function saveProfileEdit(nickname, bio, note, avatarFile) {
if (!state.currentUser) return false;
if (!nickname) {
showToast(‘Псевдонім обов'язковий’);
return false;
}

const newUserId = `@${nickname.toLowerCase()}`;
try {
const q = query(collection(db, “users”), where(“userId”, “==”, newUserId));
const snap = await getDocs(q);
if (!snap.empty && snap.docs[0].id !== state.currentUser.uid) {
showToast(‘Цей ID вже зайнятий’);
return false;
}

```
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

await updateDoc(doc(db, "users", state.currentUser.uid), updateData);
await loadMyProfile();
document.getElementById('editProfileModal').classList.remove('active');
showToast('Профіль оновлено');
return true;
```

} catch (e) {
console.error(‘saveProfileEdit error:’, e);
showToast(’Помилка: ’ + e.message);
return false;
}
}

// ================= Списки підписників/підписок =================
export async function openFollowersList(uid) {
const modal = document.getElementById(‘followersModal’);
const list = document.getElementById(‘followersList’);
if (!modal || !list) return;

list.innerHTML = ‘<div class="skeleton" style="height:60px;"></div>’;
modal.classList.add(‘active’);

try {
const userSnap = await getDoc(doc(db, “users”, uid));
const followersIds = userSnap.data().followers || [];

```
// ВИПРАВЛЕННЯ: паралельне завантаження замість послідовного for...of
const snaps = await Promise.all(followersIds.map(id => getDoc(doc(db, "users", id))));
const followers = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));

list.innerHTML = '';
if (followers.length === 0) {
  list.innerHTML = '<p style="text-align:center; padding:20px;">Немає підписників</p>';
} else {
  followers.forEach(user => {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.tabIndex = 0;
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${escapeHTML(user.avatar || '')})" data-uid="${escapeHTML(user.id)}" tabindex="0"></div>
      <div class="chat-info">
        <div class="chat-name">${escapeHTML(user.nickname)}</div>
        <div class="chat-last">${escapeHTML(user.userId)}</div>
        ${user.note ? `<div class="note-badge" style="position:relative; display:inline-block;">${escapeHTML(user.note)}</div>` : ''}
      </div>
    `;
    div.onclick = () => { viewProfile(user.id); modal.classList.remove('active'); };
    list.appendChild(div);
  });
}
```

} catch (error) {
console.error(‘openFollowersList error:’, error);
list.innerHTML = ‘<p style="text-align:center; padding:20px; color:red;">Помилка завантаження</p>’;
}
}

export async function openFollowingList(uid) {
const modal = document.getElementById(‘followingModal’);
const list = document.getElementById(‘followingList’);
if (!modal || !list) return;

list.innerHTML = ‘<div class="skeleton" style="height:60px;"></div>’;
modal.classList.add(‘active’);

try {
const userSnap = await getDoc(doc(db, “users”, uid));
const followingIds = userSnap.data().following || [];

```
// ВИПРАВЛЕННЯ: паралельне завантаження замість послідовного for...of
const snaps = await Promise.all(followingIds.map(id => getDoc(doc(db, "users", id))));
const following = snaps.filter(s => s.exists()).map(s => ({ id: s.id, ...s.data() }));

list.innerHTML = '';
if (following.length === 0) {
  list.innerHTML = '<p style="text-align:center; padding:20px;">Ні на кого не підписаний</p>';
} else {
  following.forEach(user => {
    const div = document.createElement('div');
    div.className = 'chat-item';
    div.tabIndex = 0;
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${escapeHTML(user.avatar || '')})" data-uid="${escapeHTML(user.id)}" tabindex="0"></div>
      <div class="chat-info">
        <div class="chat-name">${escapeHTML(user.nickname)}</div>
        <div class="chat-last">${escapeHTML(user.userId)}</div>
        ${user.note ? `<div class="note-badge" style="position:relative; display:inline-block;">${escapeHTML(user.note)}</div>` : ''}
      </div>
    `;
    div.onclick = () => { viewProfile(user.id); modal.classList.remove('active'); };
    list.appendChild(div);
  });
}
```

} catch (error) {
console.error(‘openFollowingList error:’, error);
list.innerHTML = ‘<p style="text-align:center; padding:20px; color:red;">Помилка завантаження</p>’;
}
}

// ================= Функції для скарг, мюту, блокування =================
export async function reportUser(targetUid, reason = ‘’) {
if (!state.currentUser) return;
try {
await addDoc(collection(db, “reports”), {
reportedUserId: targetUid,
reporterId: state.currentUser.uid,
reason: reason || ‘Без причини’,
timestamp: serverTimestamp()
});
showToast(‘Скаргу надіслано’);
} catch (e) {
console.error(‘reportUser error:’, e);
showToast(’Помилка: ’ + e.message);
}
}

export async function muteUser(targetUid) {
if (!state.currentUser) return;
try {
await updateDoc(doc(db, “users”, state.currentUser.uid), {
mutedUsers: arrayUnion(targetUid)
});
showToast(‘Користувача замучено’);
} catch (e) {
console.error(‘muteUser error:’, e);
showToast(’Помилка: ’ + e.message);
}
}

export async function unmuteUser(targetUid) {
if (!state.currentUser) return;
try {
await updateDoc(doc(db, “users”, state.currentUser.uid), {
mutedUsers: arrayRemove(targetUid)
});
showToast(‘Користувача розмучено’);
} catch (e) {
console.error(‘unmuteUser error:’, e);
showToast(’Помилка: ’ + e.message);
}
}

export async function blockUser(targetUid) {
if (!state.currentUser) return;
try {
await updateDoc(doc(db, “users”, state.currentUser.uid), {
blockedUsers: arrayUnion(targetUid)
});
showToast(‘Користувача заблоковано’);
} catch (e) {
console.error(‘blockUser error:’, e);
showToast(’Помилка: ’ + e.message);
}
}

export async function unblockUser(targetUid) {
if (!state.currentUser) return;
try {
await updateDoc(doc(db, “users”, state.currentUser.uid), {
blockedUsers: arrayRemove(targetUid)
});
showToast(‘Користувача розблоковано’);
} catch (e) {
console.error(‘unblockUser error:’, e);
showToast(’Помилка: ’ + e.message);
}
}

// ================= Глобальний обробник для закриття меню профілю =================
document.addEventListener(‘click’, (e) => {
document.querySelectorAll(’.profile-menu-dropdown.show’).forEach(dropdown => {
const menuBtn = dropdown.previousElementSibling;
if (!menuBtn || !menuBtn.contains(e.target)) {
dropdown.classList.remove(‘show’);
}
});
});

// ================= Ініціалізація редагування аватарки =================
function initAvatarEdit() {
const avatarPreview = document.getElementById(‘editAvatarPreview’);
const avatarInput = document.getElementById(‘editAvatar’);

if (avatarPreview && avatarInput) {
avatarPreview.addEventListener(‘click’, () => { avatarInput.click(); });
avatarInput.addEventListener(‘change’, (e) => {
const file = e.target.files[0];
if (!file) return;
if (avatarPreview.src && avatarPreview.src.startsWith(‘blob:’)) {
URL.revokeObjectURL(avatarPreview.src);
}
avatarPreview.src = URL.createObjectURL(file);
});
}
}

if (document.readyState === ‘loading’) {
document.addEventListener(‘DOMContentLoaded’, initAvatarEdit);
} else {
initAvatarEdit();
}
