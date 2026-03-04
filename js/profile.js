import { db } from './config.js';
import { doc, getDoc, updateDoc, setDoc, addDoc, collection, query, where, getDocs, arrayUnion, arrayRemove, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentUser, setCurrentUserData, currentUserFollowing, setCurrentUserFollowing } from './state.js';
import { showToast, uploadToCloudinary, debounce, vibrate } from './utils.js';
import { renderPosts } from './posts.js';
import { getChatId, openChat } from './chat.js';

export const toggleFollow = debounce(async (targetUid, buttonElement) => {
  if (!currentUser) return;
  const wasFollowing = currentUserFollowing.includes(targetUid);
  const newFollowingState = !wasFollowing;
  if (newFollowingState) currentUserFollowing.push(targetUid);
  else { const idx = currentUserFollowing.indexOf(targetUid); if (idx !== -1) currentUserFollowing.splice(idx, 1); }
  if (buttonElement) { buttonElement.textContent = newFollowingState ? 'Відписатися' : 'Підписатися'; buttonElement.classList.toggle('following', newFollowingState); }
  try {
    const myRef = doc(db, "users", currentUser.uid);
    const targetRef = doc(db, "users", targetUid);
    const batch = writeBatch(db);
    if (wasFollowing) { batch.update(myRef, { following: arrayRemove(targetUid) }); batch.update(targetRef, { followers: arrayRemove(currentUser.uid) }); } 
    else { batch.update(myRef, { following: arrayUnion(targetUid) }); batch.update(targetRef, { followers: arrayUnion(currentUser.uid) }); vibrate(30); }
    await batch.commit();
  } catch (error) {
    console.error(error);
    if (newFollowingState) { const idx = currentUserFollowing.indexOf(targetUid); if (idx !== -1) currentUserFollowing.splice(idx, 1); } else currentUserFollowing.push(targetUid);
    if (buttonElement) { buttonElement.textContent = wasFollowing ? 'Відписатися' : 'Підписатися'; buttonElement.classList.toggle('following', wasFollowing); }
    showToast('Помилка: ' + error.message);
  }
}, 300);

export async function viewProfile(uid) {
  if (!currentUser) return;
  document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('[data-section="profile"]').classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('profile').classList.add('active');
  document.getElementById('pageTitle').textContent = 'Профіль';
  const userSnap = await getDoc(doc(db, "users", uid));
  if (!userSnap.exists()) { showToast('Користувача не знайдено'); return; }
  const userData = userSnap.data();
  renderProfile(userData, uid, uid === currentUser.uid);
}

function renderProfile(data, uid, isOwn) {
  const header = document.getElementById('profileHeader');
  const isFollowing = !isOwn && data.followers?.includes(currentUser.uid);
  header.innerHTML = `
    <div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div>
    <div style="flex:1">
      <h2>${data.nickname}</h2>
      <div class="user-id">${data.userId}</div>
      ${data.note ? `<div class="note-badge">${data.note}</div>` : ''}
      <p>${data.bio || ''}</p>
      <div class="profile-stats">
        <span>${data.followers?.length || 0} підписників</span>
        <span>${data.following?.length || 0} підписок</span>
        <span>${data.posts?.length || 0} постів</span>
      </div>
      ${!isOwn ? `<div style="display:flex; gap:10px; margin-top:10px;"><button class="btn" id="profileFollowBtn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button><button class="btn" id="profileMessageBtn" tabindex="0">Написати</button></div>` : '<button class="btn" id="editProfileBtn" tabindex="0">Редагувати</button>'}
    </div>
  `;
  if (!isOwn) {
    document.getElementById('profileFollowBtn').onclick = () => toggleFollow(uid, document.getElementById('profileFollowBtn'));
    document.getElementById('profileMessageBtn').onclick = () => {
      const chatId = getChatId(currentUser.uid, uid);
      getDoc(doc(db, "chats", chatId)).then(async (docSnap) => {
        if (!docSnap.exists()) await setDoc(doc(db, "chats", chatId), { participants: [currentUser.uid, uid], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessage: '', unread: { [currentUser.uid]: 0, [uid]: 0 } });
        openChat(chatId, uid, data.nickname, data.userId, data.avatar);
      });
    };
  } else {
    document.getElementById('editProfileBtn').onclick = () => {
      document.getElementById('editNickname').value = data.nickname;
      document.getElementById('editBio').value = data.bio || '';
      document.getElementById('editNote').value = data.note || '';
      document.getElementById('editAvatar').value = '';
      document.getElementById('editAvatarLabel').textContent = 'Обрати аватар';
      document.getElementById('editAvatarPreview').classList.remove('show');
      document.getElementById('editProfileModal').classList.add('active');
    };
  }
  document.getElementById('profileTabs').innerHTML = `<div class="profile-tab active" data-tab="posts">Пости</div><div class="profile-tab" data-tab="likes">Лайки</div><div class="profile-tab" data-tab="media">Медіа</div><div class="profile-tab" data-tab="saved">Збережене</div>`;
  document.querySelectorAll('.profile-tab').forEach(tab => tab.onclick = () => { document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active')); tab.classList.add('active'); loadProfileFeed(uid, tab.dataset.tab); });
  loadProfileFeed(uid, 'posts');
}

async function loadProfileFeed(uid, tab) {
  const feed = document.getElementById('profileFeed');
  feed.innerHTML = 'Завантаження...';
  const userSnap = await getDoc(doc(db, "users", uid));
  const userData = userSnap.data();
  let postIds = [];
  if (tab === 'posts') postIds = userData.posts || [];
  else if (tab === 'likes') postIds = userData.likedPosts || [];
  else if (tab === 'media') { /* спрощено */ feed.innerHTML = '<p>Медіа</p>'; return; }
  else if (tab === 'saved') postIds = userData.savedPosts || [];
  const posts = [];
  for (const id of postIds.slice(0, 20)) { const p = await getDoc(doc(db, "posts", id)); if (p.exists()) posts.push({ id, ...p.data() }); }
  posts.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  feed.innerHTML = '';
  if (posts.length === 0) feed.innerHTML = '<p>Немає постів</p>';
  else { const fakeDocs = posts.map(p => ({ id: p.id, data: () => p })); renderPosts(fakeDocs, 'profileFeed'); }
}

export async function saveProfileEdit(nickname, bio, note, avatarFile) {
  if (!currentUser || !nickname) { showToast('Псевдонім обов’язковий'); return; }
  const newUserId = `@${nickname.toLowerCase()}`;
  const q = query(collection(db, "users"), where("userId", "==", newUserId));
  const snap = await getDocs(q);
  if (!snap.empty && snap.docs[0].id !== currentUser.uid) { showToast('Цей ID вже зайнятий'); return; }
  try {
    let avatarUrl;
    if (avatarFile) avatarUrl = await uploadToCloudinary(avatarFile);
    const updateData = { nickname, userId: newUserId, nickname_lower: nickname.toLowerCase().trim(), bio, note };
    if (avatarUrl) updateData.avatar = avatarUrl;
    await updateDoc(doc(db, "users", currentUser.uid), updateData);
    const updatedSnap = await getDoc(doc(db, "users", currentUser.uid));
    setCurrentUserData(updatedSnap.data());
    document.getElementById('editProfileModal').classList.remove('active');
    showToast('Профіль оновлено');
  } catch (e) { showToast('Помилка: ' + e.message); }
}
