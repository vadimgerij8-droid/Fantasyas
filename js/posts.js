import { db } from './config.js';
import { collection, query, orderBy, limit, getDocs, addDoc, doc, updateDoc, serverTimestamp, arrayUnion, arrayRemove, increment, getDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentUser, currentUserFollowing, currentFeedType, currentFilterHashtag, lastVisible, loading, hasMore, setLastVisible, setLoading, setHasMore, likePromiseMap, savePromiseMap } from './state.js';
import { showToast, uploadToCloudinary, debounce, vibrate } from './utils.js';

export function extractHashtags(text) { const regex = /#(\w+)/g; const matches = text.match(regex); return matches ? matches.map(tag => tag.toLowerCase()) : []; }

export const toggleLike = debounce(async (postId, buttonElement) => {
  if (!currentUser) { showToast('Увійдіть, щоб лайкати'); return; }
  if (likePromiseMap.has(postId)) return;
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
    if (!postSnap.exists()) { showToast('Пост не знайдено'); buttonElement.classList.toggle('liked', wasLiked); if (countSpan) countSpan.textContent = oldCount; return; }
    const postData = postSnap.data();
    const isLiked = postData.likes?.includes(currentUser.uid) || false;
    if (isLiked === wasLiked) {
      const batch = writeBatch(db);
      if (isLiked) {
        batch.update(postRef, { likes: arrayRemove(currentUser.uid), likesCount: increment(-1), popularity: increment(-50) });
        batch.update(doc(db, "users", currentUser.uid), { likedPosts: arrayRemove(postId) });
      } else {
        batch.update(postRef, { likes: arrayUnion(currentUser.uid), likesCount: increment(1), popularity: increment(50) });
        batch.update(doc(db, "users", currentUser.uid), { likedPosts: arrayUnion(postId) });
        vibrate(30);
      }
      await batch.commit();
    } else { buttonElement.classList.toggle('liked', isLiked); if (countSpan) countSpan.textContent = postData.likesCount || 0; }
  } catch (error) { console.error(error); showToast('Не вдалося оновити лайк.'); buttonElement.classList.toggle('liked', wasLiked); if (countSpan) countSpan.textContent = oldCount; } 
  finally { likePromiseMap.delete(postId); }
}, 300);

export const toggleSave = debounce(async (postId, buttonElement) => {
  if (!currentUser) { showToast('Увійдіть, щоб зберегти'); return; }
  if (savePromiseMap.has(postId)) return;
  const wasSaved = buttonElement.classList.contains('saved');
  buttonElement.classList.toggle('saved', !wasSaved);
  try {
    savePromiseMap.set(postId, true);
    const postRef = doc(db, "posts", postId);
    const postSnap = await getDoc(postRef);
    if (!postSnap.exists()) { showToast('Пост не знайдено'); buttonElement.classList.toggle('saved', wasSaved); return; }
    const isSaved = postSnap.data().saves?.includes(currentUser.uid) || false;
    if (isSaved === wasSaved) {
      const batch = writeBatch(db);
      if (wasSaved) {
        batch.update(doc(db, "users", currentUser.uid), { savedPosts: arrayRemove(postId) });
        batch.update(postRef, { saves: arrayRemove(currentUser.uid) });
      } else {
        batch.update(doc(db, "users", currentUser.uid), { savedPosts: arrayUnion(postId) });
        batch.update(postRef, { saves: arrayUnion(currentUser.uid) });
      }
      await batch.commit();
    } else { buttonElement.classList.toggle('saved', isSaved); }
  } catch (error) { console.error(error); showToast("Не вдалося зберегти пост."); buttonElement.classList.toggle('saved', wasSaved); } 
  finally { savePromiseMap.delete(postId); }
}, 300);

export async function createPost(text, files) {
  if (!currentUser) { showToast('Увійдіть, щоб опублікувати пост'); return false; }
  if (files.length > 3) { showToast('Можна вибрати не більше 3 файлів'); return false; }
  try {
    showToast('Завантаження...');
    const media = [];
    for (const file of files) {
      const url = await uploadToCloudinary(file);
      media.push({ url, type: file.type.split('/')[0] });
    }
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const userData = userSnap.data();
    const hashtags = extractHashtags(text);
    const postDoc = await addDoc(collection(db, "posts"), {
      author: currentUser.uid, authorType: 'user', authorName: userData.nickname, authorUserId: userData.userId, authorAvatar: userData.avatar || '', text, media, createdAt: serverTimestamp(), likes: [], likesCount: 0, commentsCount: 0, saves: [], views: 0, hashtags, popularity: 0
    });
    await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayUnion(postDoc.id) });
    document.getElementById('postText').value = ''; document.getElementById('postMedia').value = ''; document.getElementById('postMediaPreviews').innerHTML = ''; document.getElementById('postMediaLabel').textContent = '+ Медіа (до 3 файлів)';
    showToast('Пост опубліковано!'); return true;
  } catch (e) { console.error(e); showToast('Помилка: ' + e.message); return false; }
}

export async function loadMorePosts(containerId = 'feed') {
  if (!currentUser || loading || !hasMore) return;
  setLoading(true);
  const skeleton = document.getElementById('skeletonContainer');
  if (skeleton) skeleton.style.display = 'block';
  try {
    let baseQuery = currentFilterHashtag ? query(collection(db, "posts"), where("hashtags", "array-contains", currentFilterHashtag)) : collection(db, "posts");
    let q;
    if (currentFeedType === 'new' || currentFilterHashtag) q = query(baseQuery, orderBy("createdAt", "desc"), limit(10));
    else q = query(baseQuery, orderBy("likesCount", "desc"), orderBy("createdAt", "desc"), limit(10));
    if (lastVisible) q = query(q, startAfter(lastVisible));
    const snapshot = await getDocs(q);
    if (snapshot.empty) { setHasMore(false); return; }
    setLastVisible(snapshot.docs[snapshot.docs.length - 1]);
    renderPosts(snapshot.docs, containerId);
  } catch (e) { console.error(e); showToast("Помилка завантаження. Перевірте індекси Firestore."); } 
  finally { if (skeleton) skeleton.style.display = 'none'; setLoading(false); }
}

export function renderPosts(docs, containerId = 'feed') {
  const feed = document.getElementById(containerId);
  if (!feed) return;
  docs.forEach(docSnap => {
    const post = { id: docSnap.id, ...docSnap.data() };
    const liked = post.likes?.includes(currentUser?.uid) || false;
    const saved = post.saves?.includes(currentUser?.uid) || false;
    const postTime = post.createdAt ? new Date(post.createdAt.seconds * 1000).toLocaleString() : '';
    const isFollowing = currentUserFollowing.includes(post.author);
    const postEl = document.createElement('div'); postEl.className = 'post'; postEl.dataset.postId = post.id; postEl.tabIndex = 0;
    let contentHtml = post.text || ''; contentHtml = contentHtml.replace(/#(\w+)/g, '<span class="hashtag" data-tag="$1">#$1</span>');
    const followButtonHtml = (post.author !== currentUser?.uid && currentUser) ? `<button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${post.author}" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>` : '';
    postEl.innerHTML = `
      <div class="post-header">
        <div class="avatar" style="background-image:url(${post.authorAvatar || ''})" data-uid="${post.author}" tabindex="0"></div>
        <div class="post-author-info">
          <div><span class="post-author" data-uid="${post.author}" tabindex="0">${post.authorName || 'Невідомо'}</span> <span class="post-meta">${post.authorUserId || ''}</span> ${followButtonHtml}</div>
          <div class="post-time">${postTime}</div>
        </div>
      </div>
      <div class="post-content">${contentHtml}</div>
    `;
    if (post.media && post.media.length > 0) postEl.appendChild(createGallery(post.media));
    const footer = document.createElement('div'); footer.className = 'post-footer';
    footer.innerHTML = `
      <button class="like-btn ${liked ? 'liked' : ''}" data-post-id="${post.id}" tabindex="0"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg><span>${post.likesCount || 0}</span></button>
      <button class="save-btn ${saved ? 'saved' : ''}" data-post-id="${post.id}" tabindex="0"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg></button>
    `;
    postEl.appendChild(footer);
    feed.appendChild(postEl);
    incrementPostView(post.id);
  });
}

function createGallery(media) { /* спрощено, можна залишити порожнім для простоти */ const div = document.createElement('div'); div.textContent = 'Галерея'; return div; }
async function incrementPostView(postId) { if (!currentUser || viewedPosts.has(postId)) return; viewedPosts.add(postId); try { await updateDoc(doc(db, "posts", postId), { views: increment(1), popularity: increment(5) }); } catch (e) {} }
