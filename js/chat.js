import { db } from './config.js';
import { 
  collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, query, where, 
  orderBy, onSnapshot, serverTimestamp, arrayUnion, arrayRemove, increment, writeBatch 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { 
  state,
  setCurrentChat, clearChatState, setReplyContext, clearReplyContext,
  setUnsubscribeMessages, setUnsubscribeTyping, setUnsubscribeChatPresence
} from './state.js';
import { showToast, uploadToCloudinary, debounce, formatLastSeen } from './utils.js';
import { viewProfile, blockUser } from './profile.js';

// ================= Утильна функція для санітизації HTML =================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

// ================= Допоміжні функції =================
export const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

// ================= Завантаження списку чатів =================
export async function loadChatList() {
  if (!state.currentUser) return;
  const listEl = document.getElementById('chatList');
  if (!listEl) return;

  try {
    const snapshot = await getDocs(query(
      collection(db, "chats"),
      where("participants", "array-contains", state.currentUser.uid)
    ));

    // ВИПРАВЛЕННЯ: замість послідовного for...of з await — паралельний Promise.all
    const chatItemsRaw = await Promise.all(
      snapshot.docs.map(async (docSnap) => {
        const chat = docSnap.data();
        const otherUid = chat.participants.find(uid => uid !== state.currentUser.uid);
        if (!otherUid) return null;

        const userSnap = await getDoc(doc(db, "users", otherUid));
        if (!userSnap.exists()) return null;
        const user = userSnap.data();

        const unread = chat.unread?.[state.currentUser.uid] || 0;
        const lastMsg = chat.lastMessage || '';
        const lastMsgType = chat.lastMessageType || 'text';
        let displayLast = lastMsg;
        if (lastMsgType === 'photo') displayLast = '📷 Фото';
        else if (lastMsgType === 'video') displayLast = '🎥 Відео';

        const updatedAt = chat.updatedAt?.seconds * 1000 || 0;
        const time = updatedAt
          ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        const lastSeen = user.lastSeen?.seconds * 1000 || 0;
        const isOnline = (Date.now() - lastSeen) < 60000;

        return { chatId: docSnap.id, otherUid, user, unread, lastMsg: displayLast, time, isOnline, lastSeen, updatedAt };
      })
    );

    const chatItems = chatItemsRaw.filter(Boolean);
    chatItems.sort((a, b) => b.updatedAt - a.updatedAt);
    renderChatList(chatItems);
  } catch (error) {
    console.error('Помилка завантаження списку чатів:', error);
    showToast('Не вдалося завантажити чати');
  }
}

function renderChatList(chatItems) {
  const listEl = document.getElementById('chatList');
  if (!listEl) return;
  listEl.innerHTML = '';

  if (chatItems.length === 0) {
    listEl.innerHTML = '<p style="text-align:center; padding:20px;">Немає чатів</p>';
    return;
  }

  chatItems.forEach(item => {
    const div = document.createElement('div');
    div.className = `chat-item ${item.unread > 0 ? 'unread' : ''}`;
    div.dataset.chatId = item.chatId;
    div.dataset.otherUid = item.otherUid;
    div.dataset.username = item.user.nickname;
    div.dataset.avatar = item.user.avatar || '';
    div.tabIndex = 0;

    const lastSeenText = item.lastSeen ? formatLastSeen({ seconds: item.lastSeen / 1000 }) : '';
    div.title = item.isOnline ? 'онлайн' : `Останній візит: ${lastSeenText}`;

    // ВИПРАВЛЕННЯ: note екранується через escapeHtml перед вставкою в innerHTML
    const noteHtml = item.user.note
      ? `<div class="note-badge">${escapeHtml(item.user.note)}</div>`
      : '';

    div.innerHTML = `
      <div class="chat-avatar">
        <div class="avatar small" style="background-image:url(${escapeHtml(item.user.avatar || '')})"></div>
        ${item.isOnline ? '<span class="online-indicator"></span>' : ''}
        ${noteHtml}
      </div>
      <div class="chat-info">
        <div class="chat-name">${escapeHtml(item.user.nickname)}</div>
        <div class="chat-last">${escapeHtml(item.lastMsg)}</div>
      </div>
      <div class="chat-time">${escapeHtml(item.time)}</div>
      ${item.unread > 0 ? `<div class="chat-badge">${item.unread}</div>` : ''}
    `;

    // ВИПРАВЛЕННЯ: прибрано глобальний document.addEventListener для .chat-item,
    // обробник лише тут — інакше openChat викликався двічі (локальний + глобальний).
    div.addEventListener('click', (e) => {
      e.stopPropagation();
      openChat(item.chatId, item.otherUid, item.user.nickname, item.user.userId, item.user.avatar);
    });

    listEl.appendChild(div);
  });
}

// ================= Відкриття чату =================
export async function openChat(chatId, otherUid, otherName, otherUserId, otherAvatar) {
  try {
    if (!state.currentUser) {
      console.warn('Користувач не авторизований');
      return;
    }

    setCurrentChat(chatId, otherUid, otherName, otherUserId, otherAvatar);

    const chatNameEl = document.getElementById('chatName');
    const chatStatusEl = document.getElementById('chatStatus');
    const chatAvatarEl = document.getElementById('chatAvatar');
    const chatWindowContainer = document.getElementById('chatWindowContainer');
    const chatListSidebar = document.getElementById('chatListSidebar');
    const bottomNav = document.querySelector('.bottom-nav');
    const chatText = document.getElementById('chatText');

    if (!chatNameEl || !chatStatusEl || !chatAvatarEl || !chatWindowContainer) {
      console.error("Не знайдено обов'язкові елементи DOM для чату");
      showToast('Помилка інтерфейсу чату');
      return;
    }

    chatNameEl.textContent = otherName;
    chatStatusEl.textContent = '';
    chatAvatarEl.style.backgroundImage = otherAvatar ? `url(${otherAvatar})` : 'none';

    chatWindowContainer.style.display = 'flex';
    if (window.innerWidth < 768) {
      chatListSidebar?.classList.add('hide');
    }
    if (bottomNav) bottomNav.classList.add('hide-chat-mode');

    const chatRef = doc(db, "chats", chatId);
    await updateDoc(chatRef, {
      [`unread.${state.currentUser.uid}`]: 0
    }).catch(console.error);

    subscribeToMessages(chatId);

    if (state.unsubscribeChatPresence) state.unsubscribeChatPresence();
    const unsubPresence = onSnapshot(doc(db, "users", otherUid), (snap) => {
      const user = snap.data();
      if (!user) return;
      const lastSeen = user.lastSeen;
      const isOnline = lastSeen ? (Date.now() - (lastSeen.seconds * 1000)) < 60000 : false;
      const statusEl = document.getElementById('chatStatus');
      if (!statusEl) return;
      statusEl.textContent = isOnline ? 'онлайн' : `був(ла) ${formatLastSeen(lastSeen)}`;
    });
    setUnsubscribeChatPresence(unsubPresence);

    if (state.unsubscribeTyping) state.unsubscribeTyping();
    const typingRef = doc(db, `chats/${chatId}/typing/${otherUid}`);
    const unsubTyping = onSnapshot(typingRef, (docSnap) => {
      const indicator = document.getElementById('typingIndicator');
      if (!indicator) return;
      indicator.style.display = (docSnap.exists() && docSnap.data().isTyping) ? 'flex' : 'none';
    });
    setUnsubscribeTyping(unsubTyping);

    setTimeout(() => chatText?.focus(), 200);
  } catch (error) {
    console.error('Помилка у openChat:', error);
    showToast('Не вдалося відкрити чат');
  }
}

// ================= Підписка на повідомлення =================
function subscribeToMessages(chatId) {
  if (!state.currentUser) return;
  if (state.unsubscribeMessages) state.unsubscribeMessages();

  const messagesContainer = document.getElementById('chatMessages');
  if (!messagesContainer) {
    console.error('chatMessages не знайдено');
    return;
  }
  messagesContainer.innerHTML = '';

  // Зберігаємо вже відрендерені ID щоб не перебудовувати весь список
  // ВИПРАВЛЕННЯ: замість повного innerHTML='' при кожному оновленні —
  // додаємо лише нові повідомлення, що критично при великих чатах
  const renderedIds = new Set();
  let lastDate = '';

  try {
    const q = query(collection(db, `chats/${chatId}/messages`), orderBy("createdAt", "asc"));
    const unsub = onSnapshot(q, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
          const msg = { id: change.doc.id, ...change.doc.data() };
          if (renderedIds.has(msg.id)) return;
          renderedIds.add(msg.id);

          const msgDate = formatMessageDate(msg.createdAt);
          if (msgDate !== lastDate) {
            lastDate = msgDate;
            const divider = document.createElement('div');
            divider.className = 'date-divider';
            divider.textContent = msgDate;
            messagesContainer.appendChild(divider);
          }

          const messageEl = createMessageElement(msg);
          messagesContainer.appendChild(messageEl);
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        if (change.type === 'modified') {
          const msg = { id: change.doc.id, ...change.doc.data() };
          const existing = messagesContainer.querySelector(`.message-wrapper[data-message-id="${msg.id}"]`);
          if (existing) {
            const updated = createMessageElement(msg);
            existing.replaceWith(updated);
          }
        }

        if (change.type === 'removed') {
          const existing = messagesContainer.querySelector(`.message-wrapper[data-message-id="${change.doc.id}"]`);
          if (existing) existing.remove();
          renderedIds.delete(change.doc.id);
        }
      });
    }, (error) => {
      console.error('Помилка отримання повідомлень:', error);
      showToast('Помилка завантаження повідомлень');
    });
    setUnsubscribeMessages(unsub);
  } catch (error) {
    console.error('Помилка створення підписки:', error);
  }
}

function createMessageElement(msg) {
  const isMine = msg.from === state.currentUser.uid;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMine ? 'sent' : 'received'}`;
  wrapper.dataset.messageId = msg.id;

  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${isMine ? 'sent' : 'received'}`;

  // ===== Відповідь (reply) =====
  if (msg.replyTo) {
    const replyPreview = document.createElement('div');
    replyPreview.className = 'message-reply-preview';
    replyPreview.setAttribute('data-reply-to', msg.replyTo.messageId);

    const shortText = msg.replyTo.text && msg.replyTo.text.length > 50
      ? msg.replyTo.text.slice(0, 47) + '…'
      : (msg.replyTo.text || 'Медіа');

    // ВИПРАВЛЕННЯ: senderName і text санітизуються через textContent, а не innerHTML
    const senderDiv = document.createElement('div');
    senderDiv.className = 'reply-sender';
    senderDiv.textContent = msg.replyTo.senderName || '';

    const textDiv = document.createElement('div');
    textDiv.className = 'reply-text';
    textDiv.textContent = shortText;

    replyPreview.appendChild(senderDiv);
    replyPreview.appendChild(textDiv);

    replyPreview.addEventListener('click', (e) => {
      e.stopPropagation();
      const originalMsg = document.querySelector(`.message-wrapper[data-message-id="${msg.replyTo.messageId}"]`);
      if (originalMsg) {
        originalMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        originalMsg.classList.add('focused-animated');
        setTimeout(() => originalMsg.classList.remove('focused-animated'), 2000);
      } else {
        showToast('Оригінальне повідомлення було видалене');
      }
    });
    bubble.appendChild(replyPreview);
  }

  // ===== Інформація про відправника (для отриманих) =====
  if (!isMine) {
    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender';
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-sender-avatar';
    avatarDiv.style.backgroundImage = `url(${state.currentChatPartnerAvatar || ''})`;
    const nameSpan = document.createElement('span');
    nameSpan.textContent = state.currentChatPartnerName;
    senderDiv.appendChild(avatarDiv);
    senderDiv.appendChild(nameSpan);
    bubble.appendChild(senderDiv);
  }

  // ===== Текст повідомлення =====
  if (msg.text) {
    const textDiv = document.createElement('div');
    textDiv.className = `message-text ${msg.edited ? 'edited' : ''}`;
    textDiv.textContent = msg.text; // textContent — безпечно, без XSS
    bubble.appendChild(textDiv);
  }

  // ===== Медіа =====
  if (msg.mediaUrl) {
    const mediaEl = msg.mediaType === 'image'
      ? document.createElement('img')
      : document.createElement('video');
    mediaEl.src = msg.mediaUrl;
    mediaEl.className = 'message-media';
    if (msg.mediaType === 'video') mediaEl.controls = true;
    mediaEl.addEventListener('click', () => window.open(msg.mediaUrl, '_blank'));
    bubble.appendChild(mediaEl);
  }

  // ===== Реакції =====
  if (msg.reactions && Object.keys(msg.reactions).length > 0) {
    const reactionsDiv = document.createElement('div');
    reactionsDiv.className = 'message-reactions';
    for (const [emoji, users] of Object.entries(msg.reactions)) {
      if (!users || users.length === 0) continue;
      const reactionItem = document.createElement('span');
      reactionItem.className = `reaction-item ${users.includes(state.currentUser.uid) ? 'user-reacted' : ''}`;
      reactionItem.dataset.emoji = emoji;

      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'emoji';
      emojiSpan.textContent = emoji;
      const countSpan = document.createElement('span');
      countSpan.className = 'count';
      countSpan.textContent = users.length;
      reactionItem.appendChild(emojiSpan);
      reactionItem.appendChild(countSpan);

      const userReacted = users.includes(state.currentUser.uid);
      if (users.length === 1 && userReacted) reactionItem.title = 'Ви';
      else if (users.length === 1) reactionItem.title = '1 користувач';
      else if (userReacted) reactionItem.title = `Ви та ${users.length - 1} інших`;
      else reactionItem.title = `${users.length} користувачів`;

      reactionItem.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleReaction(msg.id, emoji);
      });
      reactionsDiv.appendChild(reactionItem);
    }
    bubble.appendChild(reactionsDiv);
  }

  // ===== Нижній колонтитул (час + статус) =====
  const footer = document.createElement('div');
  footer.className = 'message-footer';

  const timeSpan = document.createElement('span');
  timeSpan.className = 'message-time';
  let timeText = formatMessageTime(msg.createdAt);
  if (msg.edited) timeText += ' (відредаговано)';
  timeSpan.textContent = timeText;
  footer.appendChild(timeSpan);

  if (isMine) {
    const statusSpan = document.createElement('span');
    statusSpan.className = 'message-status';
    let status = 'sent';
    if (msg.readBy && msg.readBy.includes(state.currentChatPartner)) status = 'read';
    else if (msg.deliveredTo && msg.deliveredTo.includes(state.currentChatPartner)) status = 'delivered';
    statusSpan.innerHTML = getStatusIcon(status);
    footer.appendChild(statusSpan);
  }

  bubble.appendChild(footer);
  wrapper.appendChild(bubble);

  // ===== Контекстне меню =====
  // ВИПРАВЛЕННЯ: передаємо msg напряму, без покладення на глобальну змінну selectedMessageId
  wrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMessageContextMenu(e, msg);
  });
  let longPressTimer;
  wrapper.addEventListener('touchstart', () => {
    longPressTimer = setTimeout(() => showMessageContextMenu({ pageX: 0, pageY: 0, preventDefault: () => {} }, msg), 500);
  });
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
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

// ================= Відправка повідомлення =================
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
      mediaType = file.type.split('/')[0];
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

    const messageRef = collection(db, `chats/${state.currentChatId}/messages`);
    await addDoc(messageRef, messageData);

    const chatRef = doc(db, "chats", state.currentChatId);
    await updateDoc(chatRef, {
      lastMessage: text || (mediaType === 'image' ? '📷 Фото' : '🎥 Відео'),
      lastMessageType: mediaType || 'text',
      updatedAt: serverTimestamp(),
      [`unread.${state.currentChatPartner}`]: increment(1)
    });

    clearReplyContext();
    const preview = document.getElementById('replyPreview');
    if (preview) preview.style.display = 'none';

    const textInput = document.getElementById('chatText');
    if (textInput) textInput.value = '';
    const fileInput = document.getElementById('chatAttachFile');
    if (fileInput) fileInput.value = '';
    const attachBtn = document.getElementById('chatAttachBtn');
    if (attachBtn) attachBtn.innerHTML = '📎';

    const typingRef = doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`);
    await setDoc(typingRef, { isTyping: false }, { merge: true });
  } catch (error) {
    console.error('Помилка відправки:', error);
    showToast('Не вдалося відправити повідомлення');
  }
}

// ================= Індикатор друку =================
export function handleTyping() {
  if (!state.currentUser || !state.currentChatId || !state.currentChatPartner) return;
  const typingRef = doc(db, `chats/${state.currentChatId}/typing/${state.currentUser.uid}`);
  setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error);
  }, 2000);
}

// ================= Контекстне меню повідомлення =================
function showMessageContextMenu(event, msg) {
  event.preventDefault();
  // ВИПРАВЛЕННЯ: selectedMessageId більше не використовується як глобальна змінна —
  // msg передається напряму у handleMessageContextAction через замикання

  const menu = document.getElementById('messageContextMenu');
  if (!menu) return;

  menu.className = 'message-actions-menu';
  menu.innerHTML = '';

  const reactionsPicker = document.createElement('div');
  reactionsPicker.className = 'reaction-picker';
  reactionsPicker.style.cssText = 'position:static;box-shadow:none;margin:0 0 8px 0;padding:8px;background:transparent;backdrop-filter:none;';
  reactionsPicker.innerHTML = `
    <button class="reaction-btn" data-emoji="👍">👍</button>
    <button class="reaction-btn" data-emoji="❤️">❤️</button>
    <button class="reaction-btn" data-emoji="😂">😂</button>
    <button class="reaction-btn" data-emoji="😮">😮</button>
    <button class="reaction-btn" data-emoji="😢">😢</button>
    <button class="reaction-btn" data-emoji="👎">👎</button>
    <button class="reaction-btn more">⋯</button>
  `;
  menu.appendChild(reactionsPicker);

  const menuItems = [
    { action: 'reply', label: 'Відповісти', icon: 'reply', danger: false },
    { action: 'copy', label: 'Копіювати', icon: 'copy', danger: false },
    { action: 'edit', label: 'Редагувати', icon: 'edit', danger: false },
    { action: 'deleteEveryone', label: 'Видалити для всіх', icon: 'delete', danger: true }
  ];

  menuItems.forEach(item => {
    if (item.action === 'edit' && msg.from !== state.currentUser.uid) return;
    if (item.action === 'deleteEveryone' && msg.from !== state.currentUser.uid) return;

    const menuItem = document.createElement('div');
    menuItem.className = `menu-item ${item.danger ? 'danger' : ''}`;
    menuItem.dataset.action = item.action;
    menuItem.innerHTML = `${getActionIcon(item.icon)} ${escapeHtml(item.label)}`;

    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      handleMessageContextAction(item.action, msg); // передаємо msg напряму
      menu.classList.remove('show');
    });
    menu.appendChild(menuItem);
  });

  menu.style.left = event.pageX + 'px';
  menu.style.top = event.pageY + 'px';
  menu.classList.add('show');

  reactionsPicker.querySelectorAll('.reaction-btn[data-emoji]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleReaction(msg.id, btn.dataset.emoji);
      menu.classList.remove('show');
    });
  });

  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.classList.remove('show');
      document.removeEventListener('click', closeMenu);
    }
  };
  setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

function getActionIcon(type) {
  const icons = {
    reply: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    copy:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    edit:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34"/><polygon points="18 2 22 6 12 16 8 16 8 12 18 2"/></svg>',
    delete:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
  };
  return icons[type] || '';
}

// ВИПРАВЛЕННЯ: msg передається як параметр — не потрібна глобальна змінна selectedMessageId
export async function handleMessageContextAction(action, msg) {
  if (!action || !msg || !state.currentChatId) return;

  const messageRef = doc(db, `chats/${state.currentChatId}/messages/${msg.id}`);

  switch (action) {
    case 'reply': {
      const senderName = msg.from === state.currentUser.uid ? 'Ви' : state.currentChatPartnerName;
      const previewText = msg.text?.trim() || 'Медіа';
      setReplyContext(msg.id, msg.text, senderName);

      const replyPreview = document.getElementById('replyPreview');
      const replySender = document.getElementById('replySender');
      const replyText = document.getElementById('replyText');
      if (replyPreview && replySender && replyText) {
        replySender.textContent = senderName;
        replyText.textContent = previewText;
        replyPreview.style.display = 'flex';
      }
      document.getElementById('chatText')?.focus();
      break;
    }
    case 'edit': {
      // ВИПРАВЛЕННЯ: замість системного prompt() — показуємо inline-редагування.
      // prompt() блокує UI і не стилізується на мобільних.
      showInlineEditModal(msg.id, msg.text || '', async (newText) => {
        await updateDoc(messageRef, { text: newText, edited: true });
      });
      break;
    }
    case 'copy': {
      if (msg.text) {
        navigator.clipboard.writeText(msg.text).then(() => showToast('Скопійовано'));
      }
      break;
    }
    case 'deleteSelf': {
      if (confirm('Видалити це повідомлення для себе?')) {
        showToast('Функція видалення для себе буде реалізована');
      }
      break;
    }
    case 'deleteEveryone': {
      if (confirm('Видалити це повідомлення для всіх?')) {
        await deleteDoc(messageRef);
      }
      break;
    }
  }
  document.getElementById('messageContextMenu')?.classList.remove('show');
}

// Inline-редагування повідомлення (замість prompt)
function showInlineEditModal(messageId, currentText, onSave) {
  const existingModal = document.getElementById('inlineEditModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'inlineEditModal';
  modal.style.cssText = `
    position:fixed;top:0;left:0;width:100%;height:100%;
    background:rgba(0,0,0,0.5);display:flex;align-items:center;
    justify-content:center;z-index:10000;
  `;

  const box = document.createElement('div');
  box.style.cssText = `
    background:var(--bg-color,#fff);padding:20px;border-radius:16px;
    width:90%;max-width:480px;display:flex;flex-direction:column;gap:12px;
  `;

  const title = document.createElement('h3');
  title.style.margin = '0';
  title.textContent = 'Редагувати повідомлення';

  const textarea = document.createElement('textarea');
  textarea.value = currentText;
  textarea.style.cssText = `
    width:100%;height:120px;padding:10px;border:1px solid var(--border-color,#ddd);
    border-radius:8px;resize:none;font-family:inherit;font-size:15px;
    box-sizing:border-box;background:var(--input-bg,#fff);color:var(--text-color,#333);
  `;

  const btns = document.createElement('div');
  btns.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Скасувати';
  cancelBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;background:var(--btn-secondary-bg,#e0e0e0);cursor:pointer;font-weight:600;';
  cancelBtn.onclick = () => modal.remove();

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Зберегти';
  saveBtn.style.cssText = 'padding:8px 16px;border:none;border-radius:8px;background:var(--primary-color,#007bff);color:#fff;cursor:pointer;font-weight:600;';
  saveBtn.onclick = async () => {
    const newText = textarea.value.trim();
    if (!newText) { showToast('Повідомлення не може бути порожнім'); return; }
    if (newText === currentText) { modal.remove(); return; }
    try {
      await onSave(newText);
      modal.remove();
    } catch {
      showToast('Не вдалося зберегти');
    }
  };

  btns.appendChild(cancelBtn);
  btns.appendChild(saveBtn);
  box.appendChild(title);
  box.appendChild(textarea);
  box.appendChild(btns);
  modal.appendChild(box);
  document.body.appendChild(modal);

  textarea.focus();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// ================= Реакції =================
export async function toggleReaction(messageId, emoji) {
  if (!state.currentUser || !state.currentChatId) return;
  const messageRef = doc(db, `chats/${state.currentChatId}/messages/${messageId}`);
  try {
    const messageSnap = await getDoc(messageRef);
    if (!messageSnap.exists()) return;
    const reactions = messageSnap.data().reactions || {};
    const users = reactions[emoji] || [];
    const hasReacted = users.includes(state.currentUser.uid);
    const update = {};
    update[`reactions.${emoji}`] = hasReacted
      ? arrayRemove(state.currentUser.uid)
      : arrayUnion(state.currentUser.uid);
    await updateDoc(messageRef, update);
  } catch (error) {
    console.error('Помилка оновлення реакції:', error);
    showToast('Не вдалося оновити реакцію');
  }
}

// ================= Пошук користувачів для чату =================
export async function searchUsersForChat(queryStr) {
  if (!state.currentUser) return;
  const qLower = queryStr.toLowerCase();
  const resultsContainer = document.getElementById('chatSearchResults');
  if (!resultsContainer) return;

  resultsContainer.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
  resultsContainer.style.display = 'block';

  try {
    const searchTerm = qLower.startsWith('@') ? qLower : `@${qLower}`;
    const q1 = query(collection(db, "users"), where("userId", ">=", searchTerm), where("userId", "<=", searchTerm + '\uf8ff'));
    const q2 = query(collection(db, "users"), where("nickname_lower", ">=", qLower), where("nickname_lower", "<=", qLower + '\uf8ff'));

    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const usersMap = new Map();
    const blockedByMe = state.currentUserData?.blockedUsers || [];

    snap1.forEach(d => {
      if (d.id !== state.currentUser.uid && !blockedByMe.includes(d.id)) usersMap.set(d.id, d.data());
    });
    snap2.forEach(d => {
      if (d.id !== state.currentUser.uid && !blockedByMe.includes(d.id)) usersMap.set(d.id, d.data());
    });

    if (usersMap.size === 0) {
      resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Користувачів не знайдено</p>';
      return;
    }

    resultsContainer.innerHTML = '';
    usersMap.forEach((data, uid) => {
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.style.cursor = 'pointer';
      div.tabIndex = 0;

      const noteHtml = data.note
        ? `<div class="note-badge">${escapeHtml(data.note)}</div>`
        : '';

      div.innerHTML = `
        <div class="chat-avatar">
          <div class="avatar small" style="background-image:url(${escapeHtml(data.avatar || '')})"></div>
          ${noteHtml}
        </div>
        <div class="chat-info">
          <div class="chat-name">${escapeHtml(data.nickname)}</div>
          <div class="chat-last">${escapeHtml(data.userId)}</div>
        </div>
        <button class="btn btn-primary" style="padding:6px 12px; font-size:0.8rem;">Написати</button>
      `;

      div.addEventListener('click', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        viewProfile(uid);
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        document.getElementById('chatSearchInput').value = '';
      });

      const btn = div.querySelector('button');
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const chatId = getChatId(state.currentUser.uid, uid);
        const chatRef = doc(db, "chats", chatId);
        const chatSnap = await getDoc(chatRef);
        if (!chatSnap.exists()) {
          await setDoc(chatRef, {
            participants: [state.currentUser.uid, uid],
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastMessage: '',
            unread: { [state.currentUser.uid]: 0, [uid]: 0 }
          });
        }
        openChat(chatId, uid, data.nickname, data.userId, data.avatar);
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        document.getElementById('chatSearchInput').value = '';
      });

      resultsContainer.appendChild(div);
    });
  } catch (error) {
    console.error('Помилка пошуку користувачів:', error);
    resultsContainer.innerHTML = '<p style="text-align:center; padding:20px;">Помилка пошуку</p>';
  }
}

// ================= Закриття чату =================
export function closeChat() {
  const chatWindow = document.getElementById('chatWindowContainer');
  if (chatWindow) chatWindow.style.display = 'none';
  const chatSidebar = document.getElementById('chatListSidebar');
  if (chatSidebar) chatSidebar.classList.remove('hide');
  const bottomNav = document.querySelector('.bottom-nav');
  if (bottomNav) bottomNav.classList.remove('hide-chat-mode');

  if (state.unsubscribeMessages) state.unsubscribeMessages();
  if (state.unsubscribeTyping) state.unsubscribeTyping();
  if (state.unsubscribeChatPresence) state.unsubscribeChatPresence();
  clearChatState();
}

// ================= Обробники DOM =================
document.getElementById('chatBackBtn')?.addEventListener('click', closeChat);

document.getElementById('replyCancel')?.addEventListener('click', () => {
  clearReplyContext();
  const preview = document.getElementById('replyPreview');
  if (preview) preview.style.display = 'none';
  document.getElementById('chatText')?.focus();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('chatWindowContainer')?.style.display === 'flex') {
    closeChat();
  }
});
