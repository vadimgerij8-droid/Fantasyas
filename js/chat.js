import { db } from './config.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  query, where, orderBy, onSnapshot, serverTimestamp,
  arrayUnion, arrayRemove, increment,
  limitToLast, documentId, runTransaction
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
  state,
  setCurrentChat, clearChatState, setReplyContext, clearReplyContext,
  setUnsubscribeMessages, setUnsubscribeTyping, setUnsubscribeChatPresence
} from './state.js';

import { showToast, uploadToCloudinary, debounce, formatLastSeen } from './utils.js';
import { viewProfile } from './profile.js';

// ================= Utilities =================
export const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

const fmtTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const ONLINE_MS = 60_000;
const CHATLIST_LIMIT = 200;         // за бажанням
const MESSAGES_LIMIT = 80;          // скільки останніх повідомлень показуємо realtime

const userCache = new Map();        // uid -> userData
const chatItemCache = new Map();    // chatId -> normalized item (опційно)
const messageElById = new Map();    // messageId -> element

const dom = {
  chatList: () => document.getElementById('chatList'),
  chatName: () => document.getElementById('chatName'),
  chatStatus: () => document.getElementById('chatStatus'),
  chatAvatar: () => document.getElementById('chatAvatar'),
  chatWindowContainer: () => document.getElementById('chatWindowContainer'),
  chatListSidebar: () => document.getElementById('chatListSidebar'),
  bottomNav: () => document.querySelector('.bottom-nav'),
  typingIndicator: () => document.getElementById('typingIndicator'),
  chatText: () => document.getElementById('chatText'),
  chatMessages: () => document.getElementById('chatMessages'),
  messageContextMenu: () => document.getElementById('messageContextMenu'),
  replyPreview: () => document.getElementById('replyPreview'),
  chatBackBtn: () => document.getElementById('chatBackBtn')
};

function safeText(el, text) {
  el.textContent = text ?? '';
  return el;
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) safeText(n, text);
  return n;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Пакетно тягнемо юзерів (по 10 — ліміт Firestore для "in")
async function getUsersByUids(uids) {
  const unique = [...new Set(uids)].filter(Boolean);
  const need = unique.filter(uid => !userCache.has(uid));
  if (need.length === 0) return;

  for (const part of chunk(need, 10)) {
    const q = query(collection(db, "users"), where(documentId(), "in", part));
    const snap = await getDocs(q);
    snap.forEach(d => userCache.set(d.id, d.data()));
  }
}

// ================= Chat list (realtime) =================
let unsubscribeChatList = null;

export function loadChatList() {
  if (!state.currentUser) return;
  const listEl = dom.chatList();
  if (!listEl) return;

  // якщо вже підписані — не дублюємо
  if (unsubscribeChatList) unsubscribeChatList();

  // Порада: бажано мати індекс: participants array-contains + updatedAt desc
  const q = query(
    collection(db, "chats"),
    where("participants", "array-contains", state.currentUser.uid),
    orderBy("updatedAt", "desc")
    // можна ще limitToLast/limit, але з orderBy desc зазвичай limit() — краще
  );

  listEl.innerHTML = `<div class="skeleton" style="height:60px;"></div>`;

  unsubscribeChatList = onSnapshot(q, async (snapshot) => {
    try {
      const chats = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

      // збираємо UID співрозмовників, щоб витягнути профілі пакетно
      const otherUids = chats
        .map(c => (c.participants || []).find(uid => uid !== state.currentUser.uid))
        .filter(Boolean);

      await getUsersByUids(otherUids);

      const items = chats.map(chat => normalizeChatItem(chat));
      renderChatList(items);
    } catch (e) {
      console.error('Chat list render error:', e);
      showToast('Не вдалося оновити список чатів');
    }
  }, (error) => {
    console.error('Chat list snapshot error:', error);
    showToast('Не вдалося завантажити чати');
  });
}

function normalizeChatItem(chat) {
  const otherUid = (chat.participants || []).find(uid => uid !== state.currentUser.uid);
  const user = userCache.get(otherUid);

  // якщо профіль ще не підтягнувся — показуємо плейсхолдер
  const nickname = user?.nickname || '...';
  const avatar = user?.avatar || '';
  const userId = user?.userId || otherUid || '';

  const unread = chat.unread?.[state.currentUser.uid] || 0;

  const lastMsgType = chat.lastMessageType || 'text';
  let lastMsg = chat.lastMessage || '';
  if (lastMsgType === 'photo' || lastMsgType === 'image') lastMsg = '📷 Фото';
  else if (lastMsgType === 'video') lastMsg = '🎥 Відео';

  const updatedAtMs = chat.updatedAt?.seconds ? chat.updatedAt.seconds * 1000 : 0;
  const time = updatedAtMs ? fmtTime.format(new Date(updatedAtMs)) : '';

  const lastSeenMs = user?.lastSeen?.seconds ? user.lastSeen.seconds * 1000 : 0;
  const isOnline = lastSeenMs ? (Date.now() - lastSeenMs) < ONLINE_MS : false;

  return {
    chatId: chat.id,
    otherUid,
    otherUserId: userId,
    nickname,
    avatar,
    note: user?.note || '',
    unread,
    lastMsg,
    time,
    isOnline,
    lastSeenMs,
    updatedAtMs
  };
}

function renderChatList(items) {
  const listEl = dom.chatList();
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
    return;
  }

  // не рендеримо зайве, якщо хочеш — можна порівнювати з chatItemCache
  listEl.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const item of items) {
    const row = el('div', `chat-item ${item.unread > 0 ? 'unread' : ''}`);
    row.tabIndex = 0;

    row.dataset.chatId = item.chatId;
    row.dataset.otherUid = item.otherUid || '';
    row.dataset.otherUserId = item.otherUserId || '';
    row.dataset.username = item.nickname || '';
    row.dataset.avatar = item.avatar || '';

    const lastSeenText = item.lastSeenMs ? formatLastSeen({ seconds: item.lastSeenMs / 1000 }) : '';
    row.title = item.isOnline ? 'онлайн' : (lastSeenText ? `Останній візит: ${lastSeenText}` : 'офлайн');

    const avatarWrap = el('div', 'chat-avatar');
    const avatarEl = el('div', 'avatar small');
    if (item.avatar) avatarEl.style.backgroundImage = `url(${item.avatar})`;
    avatarWrap.appendChild(avatarEl);

    if (item.isOnline) avatarWrap.appendChild(el('span', 'online-indicator'));
    if (item.note) avatarWrap.appendChild(el('div', 'note-badge', item.note));

    const info = el('div', 'chat-info');
    info.appendChild(el('div', 'chat-name', item.nickname));
    info.appendChild(el('div', 'chat-last', item.lastMsg));

    const time = el('div', 'chat-time', item.time);

    row.appendChild(avatarWrap);
    row.appendChild(info);
    row.appendChild(time);

    if (item.unread > 0) row.appendChild(el('div', 'chat-badge', String(item.unread)));

    frag.appendChild(row);
  }

  listEl.appendChild(frag);
}

// Делегація кліку по списку чатів (одне місце, без дублювань)
document.addEventListener('click', (e) => {
  const item = e.target.closest('.chat-item');
  if (!item) return;

  const chatId = item.dataset.chatId;
  const otherUid = item.dataset.otherUid;
  const username = item.dataset.username || '';
  const otherUserId = item.dataset.otherUserId || otherUid;
  const avatar = item.dataset.avatar || '';

  if (chatId && otherUid) {
    openChat(chatId, otherUid, username, otherUserId, avatar);
  }
});

// ================= Open chat =================
export async function openChat(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  try {
    if (!state.currentUser) return;

    setCurrentChat(chatId, otherUid, otherName, otherUserId, otherAvatar);

    const chatNameEl = dom.chatName();
    const chatStatusEl = dom.chatStatus();
    const chatAvatarEl = dom.chatAvatar();
    const chatWindowContainer = dom.chatWindowContainer();

    if (!chatNameEl || !chatStatusEl || !chatAvatarEl || !chatWindowContainer) {
      showToast('Помилка інтерфейсу чату');
      return;
    }

    safeText(chatNameEl, otherName);
    safeText(chatStatusEl, '');
    chatAvatarEl.style.backgroundImage = otherAvatar ? `url(${otherAvatar})` : 'none';

    chatWindowContainer.style.display = 'flex';
    if (window.innerWidth < 768) dom.chatListSidebar()?.classList.add('hide');
    dom.bottomNav()?.classList.add('hide-chat-mode');

    // unread = 0
    const chatRef = doc(db, "chats", chatId);
    updateDoc(chatRef, { [`unread.${state.currentUser.uid}`]: 0 }).catch(console.error);

    // messages
    subscribeToMessages(chatId);

    // presence
    if (state.unsubscribeChatPresence) state.unsubscribeChatPresence();
    const unsubPresence = onSnapshot(doc(db, "users", otherUid), (snap) => {
      const user = snap.data();
      if (!user) return;
      const lastSeen = user.lastSeen;
      const isOnline = lastSeen ? (Date.now() - (lastSeen.seconds * 1000)) < ONLINE_MS : false;
      const statusEl = dom.chatStatus();
      if (!statusEl) return;
      safeText(statusEl, isOnline ? 'онлайн' : `був(ла) ${formatLastSeen(lastSeen)}`);
    });
    setUnsubscribeChatPresence(unsubPresence);

    // typing
    if (state.unsubscribeTyping) state.unsubscribeTyping();
    const typingRef = doc(db, `chats/${chatId}/typing/${otherUid}`);
    const unsubTyping = onSnapshot(typingRef, (docSnap) => {
      const indicator = dom.typingIndicator();
      if (!indicator) return;
      indicator.style.display = (docSnap.exists() && docSnap.data().isTyping) ? 'flex' : 'none';
    });
    setUnsubscribeTyping(unsubTyping);

    setTimeout(() => dom.chatText()?.focus(), 200);
  } catch (error) {
    console.error('openChat error:', error);
    showToast('Не вдалося відкрити чат');
  }
}

// ================= Messages subscription (incremental render) =================
function subscribeToMessages(chatId) {
  if (!state.currentUser) return;

  if (state.unsubscribeMessages) state.unsubscribeMessages();

  const container = dom.chatMessages();
  if (!container) return;

  container.innerHTML = '';
  messageElById.clear();

  const q = query(
    collection(db, `chats/${chatId}/messages`),
    orderBy("createdAt", "asc"),
    limitToLast(MESSAGES_LIMIT)
  );

  let lastDateLabel = '';

  const unsub = onSnapshot(q, (snapshot) => {
    // інкрементально
    const changes = snapshot.docChanges();

    // якщо це перше завантаження — рендеримо всі послідовно (так простіше з date-divider)
    if (changes.length === snapshot.size) {
      container.innerHTML = '';
      lastDateLabel = '';
      messageElById.clear();

      const frag = document.createDocumentFragment();
      snapshot.forEach(docSnap => {
        const msg = { id: docSnap.id, ...docSnap.data() };

        const dateLabel = formatMessageDate(msg.createdAt);
        if (dateLabel && dateLabel !== lastDateLabel) {
          lastDateLabel = dateLabel;
          frag.appendChild(el('div', 'date-divider', dateLabel));
        }

        const node = createMessageElement(msg);
        frag.appendChild(node);
        messageElById.set(msg.id, node);
      });

      container.appendChild(frag);
      container.scrollTop = container.scrollHeight;
      return;
    }

    // для оновлень — оновлюємо конкретні елементи
    for (const ch of changes) {
      const msg = { id: ch.doc.id, ...ch.doc.data() };

      if (ch.type === 'removed') {
        const old = messageElById.get(msg.id);
        old?.remove();
        messageElById.delete(msg.id);
        continue;
      }

      if (ch.type === 'modified') {
        const old = messageElById.get(msg.id);
        if (old) {
          const fresh = createMessageElement(msg);
          old.replaceWith(fresh);
          messageElById.set(msg.id, fresh);
        }
        continue;
      }

      if (ch.type === 'added') {
        // додані наприкінці — просто append
        const node = createMessageElement(msg);
        container.appendChild(node);
        messageElById.set(msg.id, node);
        container.scrollTop = container.scrollHeight;
      }
    }
  }, (error) => {
    console.error('messages snapshot error:', error);
    showToast('Помилка завантаження повідомлень');
  });

  setUnsubscribeMessages(unsub);
}

function createMessageElement(msg) {
  const isMine = msg.from === state.currentUser.uid;

  const wrapper = el('div', `message-wrapper ${isMine ? 'sent' : 'received'}`);
  wrapper.dataset.messageId = msg.id;

  const bubble = el('div', `message-bubble ${isMine ? 'sent' : 'received'}`);

  // Reply preview
  if (msg.replyTo?.messageId) {
    const replyPreview = el('div', 'message-reply-preview');
    replyPreview.dataset.replyTo = msg.replyTo.messageId;

    const sender = el('div', 'reply-sender', msg.replyTo.senderName || '');
    const rawText = msg.replyTo.text || '';
    const shortText = rawText.length > 50 ? rawText.slice(0, 47) + '…' : rawText;
    const text = el('div', 'reply-text', shortText);

    replyPreview.appendChild(sender);
    replyPreview.appendChild(text);

    replyPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      const original = document.querySelector(`.message-wrapper[data-message-id="${msg.replyTo.messageId}"]`);
      if (original) {
        original.scrollIntoView({ behavior: 'smooth', block: 'center' });
        original.classList.add('focused-animated');
        setTimeout(() => original.classList.remove('focused-animated'), 2000);
      } else {
        showToast('Оригінальне повідомлення було видалене');
      }
    });

    bubble.appendChild(replyPreview);
  }

  // Sender line (for received)
  if (!isMine) {
    const senderDiv = el('div', 'message-sender');
    const av = el('div', 'message-sender-avatar');
    if (state.currentChatPartnerAvatar) av.style.backgroundImage = `url(${state.currentChatPartnerAvatar})`;
    const name = el('span', '', state.currentChatPartnerName || '');
    senderDiv.appendChild(av);
    senderDiv.appendChild(name);
    bubble.appendChild(senderDiv);
  }

  // Text
  if (msg.text) {
    const textDiv = el('div', `message-text ${msg.edited ? 'edited' : ''}`, msg.text);
    bubble.appendChild(textDiv);
  }

  // Media
  if (msg.mediaUrl) {
    const isImage = msg.mediaType === 'image';
    const mediaEl = document.createElement(isImage ? 'img' : 'video');
    mediaEl.className = 'message-media';
    mediaEl.src = msg.mediaUrl;

    if (!isImage) mediaEl.controls = true;

    // щоб не заважати play/pause кліку по відео
    mediaEl.addEventListener('dblclick', () => window.open(msg.mediaUrl, '_blank'));

    bubble.appendChild(mediaEl);
  }

  // Reactions
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    const reactionsDiv = el('div', 'message-reactions');

    for (const [emoji, users] of Object.entries(msg.reactions)) {
      if (!Array.isArray(users) || users.length === 0) continue;

      const reacted = users.includes(state.currentUser.uid);
      const item = el('span', `reaction-item ${reacted ? 'user-reacted' : ''}`);
      item.dataset.emoji = emoji;

      const emo = el('span', 'emoji', emoji);
      const cnt = el('span', 'count', String(users.length));
      item.appendChild(emo);
      item.appendChild(cnt);

      // title
      if (users.length === 1 && reacted) item.title = 'Ви';
      else if (users.length === 1) item.title = '1 користувач';
      else if (reacted) item.title = `Ви та ${users.length - 1} інших`;
      else item.title = `${users.length} користувачів`;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReaction(msg.id, emoji);
      });

      reactionsDiv.appendChild(item);
    }

    bubble.appendChild(reactionsDiv);
  }

  // Footer (time + status)
  const footer = el('div', 'message-footer');
  const timeSpan = el('span', 'message-time');
  let timeText = formatMessageTime(msg.createdAt);
  if (msg.edited) timeText += ' (відредаговано)';
  safeText(timeSpan, timeText);
  footer.appendChild(timeSpan);

  if (isMine) {
    const statusSpan = el('span', 'message-status');
    const status = (msg.readBy?.includes(state.currentChatPartner))
      ? 'read'
      : (msg.deliveredTo?.includes(state.currentChatPartner) ? 'delivered' : 'sent');
    statusSpan.innerHTML = getStatusIcon(status); // тут SVG — ок
    footer.appendChild(statusSpan);
  }

  bubble.appendChild(footer);
  wrapper.appendChild(bubble);

  // Context menu / long press
  wrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, msg);
  });

  let longPressTimer;
  wrapper.addEventListener('touchstart', (e) => {
    longPressTimer = setTimeout(() => showMessageContextMenu(e, msg), 500);
  }, { passive: true });

  wrapper.addEventListener('touchend', () => clearTimeout(longPressTimer));
  wrapper.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  return wrapper;
}

function getStatusIcon(status) {
  const icons = {
    sent: '<svg class="status-icon sent" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
    delivered: '<svg class="status-icon delivered" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.68 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12z"/></svg>',
    read: '<svg class="status-icon read" viewBox="0 0 24 24"><path d="M23 12l-2.44-2.78.34-3.68-3.61-.82-1.89-3.18L12 3 8.6 1.54 6.71 4.72l-3.61.81.34 3.68L1 12l2.44 2.78-.34 3.68 3.61.82 1.89 3.18L12 21l3.4 1.46 1.89-3.18 3.61-.82-.34-3.68L23 12z"/></svg>'
  };
  return icons[status] || icons.sent;
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
  return fmtTime.format(date);
}

function formatMessageDate(timestamp) {
  if (!timestamp) return '';
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);

  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Сьогодні';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
  return date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });
}

// ================= Send message =================
let typingTimeout;

export async function sendMessage(text, file) {
  if (!text && !file) return;
  if (!state.currentUser || !state.currentChatId || !state.currentChatPartner) {
    showToast('Чат не вибрано');
    return;
  }

  try {
    let mediaUrl = null;
    let mediaType = null;

    if (file) {
      mediaUrl = await uploadToCloudinary(file);
      mediaType = file.type.split('/')[0]; // image|video|...
    }

    const messageData = {
      from: state.currentUser.uid,
      text: text || '',
      createdAt: serverTimestamp(),
      readBy: [state.currentUser.uid],
      deliveredTo: [state.currentUser.uid],
      reactions: {}
    };

    if (state.replyContext) {
      messageData.replyTo = {
        messageId: state.replyContext.messageId,
        text: state.replyContext.text,
        senderName: state.replyContext.senderName
      };
    }

    if (mediaUrl) {
      messageData.mediaUrl = mediaUrl;
      messageData.mediaType = mediaType;
    }

    await addDoc(collection(db, `chats/${state.currentChatId}/messages`), messageData);

    await updateDoc(doc(db, "chats", state.currentChatId), {
      lastMessage: text || (mediaType === 'image' ? '📷 Фото' : '🎥 Відео'),
      lastMessageType: mediaType || 'text',
      updatedAt: serverTimestamp(),
      [`unread.${state.currentChatPartner}`]: increment(1)
    });

    // UI cleanup
    clearReplyContext();
    dom.replyPreview()?.remove();

    const textInput = dom.chatText();
    if (textInput) textInput.value = '';

    const fileInput = document.getElementById('chatAttachFile');
    if (fileInput) fileInput.value = '';

    const attachBtn = document.getElementById('chatAttachBtn');
    if (attachBtn) attachBtn.innerHTML = '📎';

    // typing off
    await setDoc(doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`),
      { isTyping: false },
      { merge: true }
    );
  } catch (error) {
    console.error('sendMessage error:', error);
    showToast('Не вдалося відправити повідомлення');
  }
}

// ================= Typing indicator =================
// краще робити debounce, щоб не писати в Firestore на кожен символ
export const handleTyping = debounce(() => {
  if (!state.currentUser || !state.currentChatId) return;

  const typingRef = doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`);
  setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error);
  }, 2000);
}, 200);

// ================= Context menu =================
let selectedMessageId = null;

function ensureReactionsPicker(menu) {
  let picker = menu.querySelector('.reactions-picker');
  if (picker) return picker;

  picker = el('div', 'reactions-picker');
  const emojis = ['👍', '❤️', '😂', '😮', '😢', '👎'];

  for (const em of emojis) {
    const s = el('span', '');
    s.dataset.emoji = em;
    safeText(s, em);
    picker.appendChild(s);
  }

  menu.prepend(picker);
  return picker;
}

function showMessageContextMenu(event, msg) {
  selectedMessageId = msg.id;

  const menu = dom.messageContextMenu();
  if (!menu) return;

  const picker = ensureReactionsPicker(menu);

  // show/hide actions
  const replyItem = menu.querySelector('[data-action="reply"]');
  const editItem = menu.querySelector('[data-action="edit"]');
  const deleteEveryoneItem = menu.querySelector('[data-action="deleteEveryone"]');

  const mine = msg.from === state.currentUser.uid;
  if (editItem) editItem.style.display = mine ? 'block' : 'none';
  if (deleteEveryoneItem) deleteEveryoneItem.style.display = mine ? 'block' : 'none';
  if (replyItem) replyItem.style.display = 'block';

  // position
  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.classList.add('show');

  // реакції (делегація всередині picker)
  picker.onclick = (e) => {
    const span = e.target.closest('span[data-emoji]');
    if (!span) return;
    e.stopPropagation();
    toggleReaction(msg.id, span.dataset.emoji);
    menu.classList.remove('show');
  };

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('show');
      document.removeEventListener('click', closeMenu);
    }
  };

  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

export async function handleMessageContextAction(action) {
  if (!action || !selectedMessageId || !state.currentChatId) return;

  const messageRef = doc(db, `chats/${state.currentChatId}/messages/${selectedMessageId}`);
  const snap = await getDoc(messageRef);
  const msgData = snap.data() || {};

  try {
    switch (action) {
      case 'reply':
        setReplyContext(
          selectedMessageId,
          msgData.text || '',
          msgData.from === state.currentUser.uid ? 'Ви' : state.currentChatPartnerName
        );
        dom.chatText()?.focus();
        break;

      case 'edit': {
        const oldText = msgData.text || '';
        const newText = prompt('Редагувати повідомлення:', oldText);
        if (newText !== null) {
          await updateDoc(messageRef, { text: newText, edited: true });
        }
        break;
      }

      case 'copy':
        if (msgData.text) {
          await navigator.clipboard.writeText(msgData.text);
          showToast('Скопійовано');
        }
        break;

      case 'deleteSelf':
        if (confirm('Видалити це повідомлення для себе?')) {
          showToast('Потрібна окрема реалізація (наприклад subcollection "deletedFor")');
        }
        break;

      case 'deleteEveryone':
        if (confirm('Видалити це повідомлення для всіх?')) {
          await deleteDoc(messageRef);
        }
        break;
    }
  } catch (e) {
    console.error('context action error:', e);
    showToast('Не вдалося виконати дію');
  } finally {
    dom.messageContextMenu()?.classList.remove('show');
  }
}

// ================= Reactions (transaction-safe) =================
export async function toggleReaction(messageId, emoji) {
  if (!state.currentUser || !state.currentChatId) return;

  const messageRef = doc(db, `chats/${state.currentChatId}/messages/${messageId}`);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(messageRef);
      if (!snap.exists()) return;

      const data = snap.data();
      const reactions = data.reactions || {};
      const users = reactions[emoji] || [];
      const has = users.includes(state.currentUser.uid);

      const update = {};
      update[`reactions.${emoji}`] = has
        ? arrayRemove(state.currentUser.uid)
        : arrayUnion(state.currentUser.uid);

      tx.update(messageRef, update);
    });
  } catch (error) {
    console.error('toggleReaction error:', error);
    showToast('Не вдалося оновити реакцію');
  }
}

// ================= Search users for chat (твій код можна лишити) =================
// Тут я не переписував повністю, бо він у тебе в цілому ок.
// Головний апгрейд — також можна додати кеш + debounce по input.

// ================= Close chat =================
export function closeChat() {
  dom.chatWindowContainer() && (dom.chatWindowContainer().style.display = 'none');
  dom.chatListSidebar()?.classList.remove('hide');
  dom.bottomNav()?.classList.remove('hide-chat-mode');

  state.unsubscribeMessages?.();
  state.unsubscribeTyping?.();
  state.unsubscribeChatPresence?.();

  clearChatState();
}

dom.chatBackBtn()?.addEventListener('click', closeChat);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dom.chatWindowContainer()?.style.display === 'flex') closeChat();
});
