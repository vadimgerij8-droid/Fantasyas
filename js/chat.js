import { db } from './config.js';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, query, where, orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentUser, currentChatId, currentChatPartner, currentChatPartnerName, currentChatPartnerUserId, currentChatPartnerAvatar, replyContext, setCurrentChat, clearChatState, setReplyContext, clearReplyContext, setUnsubscribeMessages, setUnsubscribeTyping, setUnsubscribeChatPresence } from './state.js';
import { showToast, uploadToCloudinary } from './utils.js';

export const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

export async function loadChatList() {
  if (!currentUser) return;
  const listEl = document.getElementById('chatList');
  listEl.innerHTML = 'Завантаження...';
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
      const time = chat.updatedAt ? new Date(chat.updatedAt.seconds*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) : '';
      const isOnline = (Date.now() - (user.lastOnline?.seconds*1000||0)) < 60000;
      chatItems.push({ chatId: docSnap.id, otherUid, user, unread, lastMsg, time, isOnline, updatedAt: chat.updatedAt?.seconds*1000||0 });
    }
    chatItems.sort((a,b) => b.updatedAt - a.updatedAt);
    listEl.innerHTML = chatItems.length ? '' : '<p>Немає чатів</p>';
    chatItems.forEach(item => {
      const div = document.createElement('div');
      div.className = `chat-item ${item.unread > 0 ? 'unread' : ''}`;
      div.dataset.chatId = item.chatId; div.dataset.otherUid = item.otherUid; div.tabIndex = 0;
      div.innerHTML = `
        <div class="chat-avatar"><div class="avatar small" style="background-image:url(${item.user.avatar||''})"></div>${item.isOnline ? '<span class="online-indicator"></span>' : ''}${item.user.note?`<div class="note-badge">${item.user.note}</div>`:''}</div>
        <div class="chat-info"><div class="chat-name">${item.user.nickname}</div><div class="chat-last">${item.lastMsg}</div></div>
        <div class="chat-time">${item.time}</div>
        ${item.unread > 0 ? `<div class="chat-badge">${item.unread}</div>` : ''}
      `;
      div.addEventListener('click', () => openChat(item.chatId, item.otherUid, item.user.nickname, item.user.userId, item.user.avatar));
      listEl.appendChild(div);
    });
  } catch (error) { console.error(error); showToast('Не вдалося завантажити чати'); listEl.innerHTML = '<p>Помилка</p>'; }
}

export async function openChat(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  if (!currentUser) return;
  setCurrentChat(chatId, otherUid, otherName, otherUserId, otherAvatar);
  document.getElementById('chatName').textContent = otherName;
  document.getElementById('chatStatus').textContent = '';
  document.getElementById('chatAvatar').style.backgroundImage = `url(${otherAvatar||''})`;
  document.getElementById('chatWindowContainer').style.display = 'flex';
  if (window.innerWidth < 768) document.getElementById('chatListSidebar').classList.add('hide');
  document.querySelector('.bottom-nav')?.classList.add('hide-chat-mode');
  await updateDoc(doc(db, "chats", chatId), { [`unread.${currentUser.uid}`]: 0 }).catch(console.error);
  subscribeToMessages(chatId);
  const unsubPresence = onSnapshot(doc(db, "users", otherUid), (snap) => {
    const lastOnline = snap.data()?.lastOnline?.seconds * 1000 || 0;
    document.getElementById('chatStatus').textContent = (Date.now() - lastOnline) < 60000 ? 'онлайн' : 'був(ла) нещодавно';
  });
  setUnsubscribeChatPresence(unsubPresence);
  setTimeout(() => document.getElementById('chatText')?.focus(), 200);
}

function subscribeToMessages(chatId) {
  if (!currentUser) return;
  if (window.unsubscribeMessages) window.unsubscribeMessages();
  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.innerHTML = '';
  const q = query(collection(db, `chats/${chatId}/messages`), orderBy("createdAt", "asc"));
  const unsub = onSnapshot(q, (snapshot) => {
    messagesContainer.innerHTML = '';
    snapshot.forEach(docSnap => {
      const msg = docSnap.data();
      const div = document.createElement('div');
      div.className = `message-wrapper ${msg.from === currentUser.uid ? 'sent' : 'received'}`;
      div.textContent = msg.text || (msg.mediaUrl ? '[Медіа]' : '');
      messagesContainer.appendChild(div);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
  setUnsubscribeMessages(unsub);
}

export async function sendMessage(text, file) {
  if (!text && !file) return;
  if (!currentUser || !currentChatId || !currentChatPartner) { showToast('Чат не вибрано'); return; }
  try {
    let mediaUrl = null, mediaType = null;
    if (file) { mediaUrl = await uploadToCloudinary(file); mediaType = file.type.split('/')[0]; }
    const messageData = { from: currentUser.uid, text: text || '', createdAt: serverTimestamp(), readBy: [currentUser.uid], deliveredTo: [currentUser.uid], reactions: {} };
    if (replyContext) messageData.replyTo = { messageId: replyContext.messageId, text: replyContext.text, senderName: replyContext.senderName };
    if (mediaUrl) { messageData.mediaUrl = mediaUrl; messageData.mediaType = mediaType; }
    await addDoc(collection(db, `chats/${currentChatId}/messages`), messageData);
    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: text || (mediaType==='image'?'📷 Фото':'🎥 Відео'), lastMessageType: mediaType||'text', updatedAt: serverTimestamp(), [`unread.${currentChatPartner}`]: increment(1) });
    clearReplyContext();
    document.getElementById('chatText').value = '';
    document.getElementById('chatAttachFile').value = '';
    document.getElementById('chatAttachBtn').innerHTML = '📎';
  } catch (error) { console.error(error); showToast('Не вдалося відправити повідомлення'); }
}

export function closeChat() {
  document.getElementById('chatWindowContainer').style.display = 'none';
  document.getElementById('chatListSidebar').classList.remove('hide');
  document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');
  if (window.unsubscribeMessages) window.unsubscribeMessages();
  if (window.unsubscribeTyping) window.unsubscribeTyping();
  if (window.unsubscribeChatPresence) window.unsubscribeChatPresence();
  clearChatState();
}
