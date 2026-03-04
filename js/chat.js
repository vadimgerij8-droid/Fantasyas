import { db } from './config.js';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  addDoc,
  serverTimestamp,
  doc,
  getDoc,
  updateDoc,
  arrayUnion,
  setDoc,
  writeBatch,
  increment,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getCurrentUser,
  setCurrentChatPartner,
  setCurrentChatPartnerName,
  setCurrentChatPartnerAvatar,
  setCurrentChatPartnerUserId,
  setCurrentChatId,
  getCurrentChatId,
  getCurrentChatPartnerUserId,
  setUnreadCount
} from './state.js';
import { showToast, updateUnreadBadge } from './utils.js';

let unsubscribeMessages = null;
let unsubscribeTyping = null;

// ================= Завантаження списку чатів =================
export async function loadChatList() {
  const chatList = document.getElementById('chatList');
  if (!chatList) return;
  chatList.innerHTML = '<div class="skeleton" style="height:80px;"></div>';

  const currentUser = getCurrentUser();
  if (!currentUser) return;

  try {
    const q = query(
      collection(db, "chats"),
      where("participants", "array-contains", currentUser.uid),
      orderBy("lastMessageTime", "desc")
    );
    const snapshot = await getDocs(q);
    chatList.innerHTML = '';
    if (snapshot.empty) {
      chatList.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
      return;
    }
    snapshot.forEach(doc => {
      const chat = doc.data();
      chat.id = doc.id;
      renderChatItem(chat, chatList);
    });
  } catch (error) {
    console.error('Error loading chat list:', error);
    chatList.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
  }
}

// ================= Рендер елемента чату =================
function renderChatItem(chat, container) {
  const currentUser = getCurrentUser();
  const otherParticipantId = chat.participants.find(id => id !== currentUser.uid);
  // Тут потрібно отримати дані партнера. Для спрощення вважаємо, що вони збережені в чаті
  // В оригіналі це могло бути зроблено через окремий запит, але ми використаємо поля з chat
  const partnerName = chat.partnerName || 'Користувач';
  const partnerAvatar = chat.partnerAvatar || 'default-avatar.png';
  const unread = chat.unread?.[currentUser.uid] || 0;

  const div = document.createElement('div');
  div.className = 'chat-item';
  div.dataset.chatId = chat.id;
  div.dataset.partnerId = otherParticipantId;
  div.innerHTML = `
    <img src="${partnerAvatar}" class="chat-avatar" loading="lazy">
    <div class="chat-info">
      <div class="chat-name">${partnerName}</div>
      <div class="chat-last-message">${chat.lastMessage || ''}</div>
    </div>
    ${unread ? `<span class="chat-unread">${unread}</span>` : ''}
  `;
  div.addEventListener('click', () => {
    openChat(otherParticipantId, partnerName, partnerAvatar);
  });
  container.appendChild(div);
}

// ================= Відкрити чат =================
export async function openChat(partnerId, partnerName, partnerAvatar) {
  setCurrentChatPartnerUserId(partnerId);
  setCurrentChatPartnerName(partnerName);
  setCurrentChatPartnerAvatar(partnerAvatar);

  const currentUser = getCurrentUser();
  if (!currentUser) return;

  const chatId = await getOrCreateChat(currentUser.uid, partnerId);
  setCurrentChatId(chatId);

  document.getElementById('chatWindowContainer').style.display = 'flex';
  document.getElementById('chatListSidebar').classList.add('hide');
  document.querySelector('.bottom-nav').classList.add('hide-chat-mode');

  loadMessages(chatId);
  markChatAsRead(chatId);
}

async function getOrCreateChat(uid1, uid2) {
  const participants = [uid1, uid2].sort();
  const chatId = participants.join('_');
  const chatRef = doc(db, "chats", chatId);
  const chatSnap = await getDoc(chatRef);
  if (!chatSnap.exists()) {
    // Отримуємо дані партнера для збереження в чаті (щоб не робити зайві запити)
    const partnerRef = doc(db, "users", uid2);
    const partnerSnap = await getDoc(partnerRef);
    const partnerData = partnerSnap.exists() ? partnerSnap.data() : { nickname: 'Користувач', avatar: '' };
    await setDoc(chatRef, {
      participants,
      partnerName: partnerData.nickname,
      partnerAvatar: partnerData.avatar || '',
      createdAt: serverTimestamp(),
      lastMessage: '',
      lastMessageTime: serverTimestamp(),
      unread: { [uid1]: 0, [uid2]: 0 }
    });
  }
  return chatId;
}

// ================= Завантаження повідомлень =================
function loadMessages(chatId) {
  if (unsubscribeMessages) unsubscribeMessages();
  const messagesContainer = document.getElementById('chatMessages');
  messagesContainer.innerHTML = '';

  const q = query(collection(db, "chats", chatId, "messages"), orderBy("timestamp", "asc"));
  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach(change => {
      if (change.type === 'added') {
        const msg = change.doc.data();
        msg.id = change.doc.id;
        renderMessage(msg, messagesContainer);
      }
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// ================= Рендер повідомлення =================
function renderMessage(msg, container) {
  const currentUser = getCurrentUser();
  const div = document.createElement('div');
  div.className = `message ${msg.senderId === currentUser.uid ? 'outgoing' : 'incoming'}`;
  div.textContent = msg.text;
  // Можна додати час, аватар тощо
  container.appendChild(div);
}

// ================= Позначити чат як прочитаний =================
function markChatAsRead(chatId) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  const chatRef = doc(db, "chats", chatId);
  updateDoc(chatRef, { [`unread.${currentUser.uid}`]: 0 }).then(() => {
    updateTotalUnread();
  });
}

// ================= Оновити загальну кількість непрочитаних =================
async function updateTotalUnread() {
  const currentUser = getCurrentUser();
  if (!currentUser) return;
  const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
  const snapshot = await getDocs(q);
  let total = 0;
  snapshot.forEach(doc => {
    const data = doc.data();
    if (data.unread && data.unread[currentUser.uid]) {
      total += data.unread[currentUser.uid];
    }
  });
  setUnreadCount(total);
  updateUnreadBadge(total);
}

// ================= Відправити повідомлення =================
export async function sendMessage(text) {
  const currentUser = getCurrentUser();
  const chatId = getCurrentChatId();
  const partnerId = getCurrentChatPartnerUserId();
  if (!currentUser || !chatId || !text.trim()) return;

  const msg = {
    senderId: currentUser.uid,
    text: text.trim(),
    timestamp: serverTimestamp(),
    read: false
  };

  try {
    await addDoc(collection(db, "chats", chatId, "messages"), msg);
    const chatRef = doc(db, "chats", chatId);
    await updateDoc(chatRef, {
      lastMessage: text.trim(),
      lastMessageTime: serverTimestamp(),
      [`unread.${partnerId}`]: increment(1)
    });
    document.getElementById('chatText').value = '';
    updateTotalUnread();
  } catch (error) {
    console.error('Error sending message:', error);
    showToast('Помилка відправлення');
  }
}
