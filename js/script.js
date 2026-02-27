// ================= Firebase імпорти =================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, OAuthProvider, signInWithPopup, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, collection, addDoc, query, where, onSnapshot, orderBy, serverTimestamp, arrayUnion, arrayRemove, deleteDoc, getDocs, increment, limit, startAfter, writeBatch } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ================= Конфігурація =================
const firebaseConfig = {
    apiKey: "AIzaSyDRzC-QDE0-UXd-XL0i3iqayFiKcc6wmvc",
    authDomain: "fantasyasapp.firebaseapp.com",
    projectId: "fantasyasapp",
    storageBucket: "fantasyasapp.appspot.com",
    messagingSenderId: "721763921060",
    appId: "1:721763921060:web:3d61044ea2424e8176ca31"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ================= Глобальні змінні =================
let currentUser = null;
let currentUserData = null;
let currentUserFollowing = [];
let currentChatPartner = null;
let currentChatPartnerName = '';
let currentChatPartnerAvatar = '';
let currentChatPartnerUserId = '';
let currentChatId = null;
let currentProfileUid = null;
let currentEditingPost = null;
let currentReplyToMessage = null; // для відповіді на повідомлення

// Слухачі
let unsubscribeFeed = null;
let unsubscribeChatList = null;
let unsubscribeMessages = null;
let unsubscribeTyping = null;
let unsubscribeChatPresence = null;
let unsubscribeFollowing = null;
let unsubscribeUserData = null;

let lastOnlineInterval = null;
let unreadCount = 0;
let currentFeedType = 'new';
let lastVisible = null;
let loading = false;
let hasMore = true;
const viewedPosts = new Set();
let currentFilterHashtag = null;
const postListeners = new Map();

// ================= Модуль: Допоміжні функції =================
const showToast = (msg) => {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
};

const vibrate = (ms) => { if (navigator.vibrate) navigator.vibrate(ms); };

const updateUnreadBadge = () => {
    const badge = document.getElementById('unreadBadge');
    if (!badge) return;
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.style.display = 'inline-block';
    } else {
        badge.style.display = 'none';
    }
};

const clearMainFeedListeners = () => {
    postListeners.forEach((unsubscribe) => unsubscribe());
    postListeners.clear();
};

const cleanupListeners = () => {
    if (unsubscribeFeed) { unsubscribeFeed(); unsubscribeFeed = null; }
    if (unsubscribeChatList) { unsubscribeChatList(); unsubscribeChatList = null; }
    if (unsubscribeMessages) { unsubscribeMessages(); unsubscribeMessages = null; }
    if (unsubscribeTyping) { unsubscribeTyping(); unsubscribeTyping = null; }
    if (unsubscribeChatPresence) { unsubscribeChatPresence(); unsubscribeChatPresence = null; }
    if (unsubscribeFollowing) { unsubscribeFollowing(); unsubscribeFollowing = null; }
    if (unsubscribeUserData) { unsubscribeUserData(); unsubscribeUserData = null; }
    if (lastOnlineInterval) { clearInterval(lastOnlineInterval); lastOnlineInterval = null; }
    clearMainFeedListeners();
};

// ================= Модуль: Верифікація (синя галочка) =================
// Оновлюється автоматично при зміні кількості підписників
async function updateVerificationBadge(uid) {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;
    const followersCount = userSnap.data().followers?.length || 0;
    const verified = followersCount >= 1000;
    if (userSnap.data().verified !== verified) {
        await updateDoc(userRef, { verified });
    }
}

// ================= Модуль: Блокування =================
async function blockUser(targetUid) {
    if (!currentUser) return;
    const userRef = doc(db, "users", currentUser.uid);
    try {
        await updateDoc(userRef, {
            blockedUsers: arrayUnion(targetUid)
        });
        showToast('Користувача заблоковано');
        // Видалити чат зі списку (опціонально)
        const chatId = getChatId(currentUser.uid, targetUid);
        await deleteDoc(doc(db, "chats", chatId)).catch(() => {});
    } catch (e) {
        showToast('Помилка: ' + e.message);
    }
}

async function unblockUser(targetUid) {
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

// Перевірка, чи заблокований користувач (поточним або цільовим)
async function isBlocked(uid1, uid2) {
    const [user1, user2] = await Promise.all([
        getDoc(doc(db, "users", uid1)),
        getDoc(doc(db, "users", uid2))
    ]);
    const blockedBy1 = user1.data()?.blockedUsers?.includes(uid2) || false;
    const blockedBy2 = user2.data()?.blockedUsers?.includes(uid1) || false;
    return blockedBy1 || blockedBy2;
}

// ================= Модуль: Мут чатів =================
async function muteChat(chatId, duration) {
    if (!currentUser) return;
    const muteUntil = duration === 'forever' ? null : Date.now() + duration * 3600000;
    await setDoc(doc(db, "users", currentUser.uid, "mutedChats", chatId), {
        mutedUntil: muteUntil,
        createdAt: serverTimestamp()
    }, { merge: true });
    showToast('Чат замучено');
}

async function unmuteChat(chatId) {
    if (!currentUser) return;
    await deleteDoc(doc(db, "users", currentUser.uid, "mutedChats", chatId));
    showToast('Чат розмучено');
}

async function isChatMuted(chatId) {
    if (!currentUser) return false;
    const muteDoc = await getDoc(doc(db, "users", currentUser.uid, "mutedChats", chatId));
    if (!muteDoc.exists()) return false;
    const data = muteDoc.data();
    if (data.mutedUntil === null) return true; // назавжди
    return data.mutedUntil > Date.now();
}

// ================= Модуль: Скарги =================
async function reportUser(targetUid, reason = '', details = '') {
    if (!currentUser) return;
    try {
        await addDoc(collection(db, "reports"), {
            reportedUserId: targetUid,
            reporterId: currentUser.uid,
            reason: reason || 'Без причини',
            details,
            timestamp: serverTimestamp(),
            status: 'pending'
        });
        showToast('Скаргу надіслано адміністратору');
    } catch (e) {
        showToast('Помилка: ' + e.message);
    }
}

// ================= Модуль: Налаштування =================
// Функція для завантаження налаштувань користувача
async function loadSettings() {
    if (!currentUser) return;
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const data = userSnap.data();
    // Заповнити форму налаштувань
    document.getElementById('settingsNickname').value = data.nickname || '';
    document.getElementById('settingsBio').value = data.bio || '';
    // Налаштування конфіденційності
    document.getElementById('privacyWhoCanMessage').value = data.privacy?.whoCanMessage || 'everyone';
    document.getElementById('privacyWhoCanSeeOnline').value = data.privacy?.whoCanSeeOnline || 'everyone';
    document.getElementById('privacyWhoCanSeeFollowers').value = data.privacy?.whoCanSeeFollowers || 'everyone';
    // Список заблокованих
    const blockedList = document.getElementById('blockedUsersList');
    blockedList.innerHTML = '';
    if (data.blockedUsers && data.blockedUsers.length > 0) {
        for (const uid of data.blockedUsers) {
            const userSnap = await getDoc(doc(db, "users", uid));
            if (userSnap.exists()) {
                const user = userSnap.data();
                const div = document.createElement('div');
                div.className = 'blocked-user-item';
                div.innerHTML = `
                    <div class="avatar small" style="background-image:url(${user.avatar || ''})"></div>
                    <span>${user.nickname}</span>
                    <button class="btn small" data-uid="${uid}">Розблокувати</button>
                `;
                div.querySelector('button').onclick = () => unblockUser(uid);
                blockedList.appendChild(div);
            }
        }
    } else {
        blockedList.innerHTML = '<p>Немає заблокованих користувачів</p>';
    }
    // Сповіщення
    document.getElementById('notifyPrivateChats').checked = data.notifications?.privateChats !== false;
    // Зовнішній вигляд
    document.getElementById('themeSelect').value = data.theme || 'light';
    document.getElementById('accentColor').value = data.accentColor || '#007bff';
}

// Збереження налаштувань
document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const updates = {
        nickname: document.getElementById('settingsNickname').value.trim(),
        bio: document.getElementById('settingsBio').value.trim(),
        privacy: {
            whoCanMessage: document.getElementById('privacyWhoCanMessage').value,
            whoCanSeeOnline: document.getElementById('privacyWhoCanSeeOnline').value,
            whoCanSeeFollowers: document.getElementById('privacyWhoCanSeeFollowers').value
        },
        notifications: {
            privateChats: document.getElementById('notifyPrivateChats').checked
        },
        theme: document.getElementById('themeSelect').value,
        accentColor: document.getElementById('accentColor').value
    };
    await updateDoc(doc(db, "users", currentUser.uid), updates);
    // Застосувати тему
    document.body.classList.toggle('dark', updates.theme === 'dark');
    document.documentElement.style.setProperty('--accent-color', updates.accentColor);
    showToast('Налаштування збережено');
});

// ================= Модуль: Чати (покращені) =================
const getChatId = (uid1, uid2) => [uid1, uid2].sort().join('_');

async function loadChatList() {
    if (!currentUser) return;
    const listEl = document.getElementById('chatList');
    if (!listEl) return;
    try {
        const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
        const snapshot = await getDocs(q);
        const chatItems = [];

        for (const docSnap of snapshot.docs) {
            const chat = docSnap.data();
            const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
            if (!otherUid) continue;

            // Перевірка блокування
            if (await isBlocked(currentUser.uid, otherUid)) continue;

            const userSnap = await getDoc(doc(db, "users", otherUid));
            if (!userSnap.exists()) continue;
            const user = userSnap.data();

            const unread = chat.unread?.[currentUser.uid] || 0;
            const lastMsg = chat.lastMessage || '';
            const lastMsgType = chat.lastMessageType || 'text';
            let displayLast = lastMsg;
            if (lastMsgType === 'photo') displayLast = '📷 Фото';
            else if (lastMsgType === 'video') displayLast = '🎥 Відео';

            const updatedAt = chat.updatedAt?.seconds * 1000 || 0;
            const time = updatedAt ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

            const lastOnline = user.lastOnline?.seconds * 1000 || 0;
            const isOnline = (Date.now() - lastOnline) < 60000;

            // Перевірка муту
            const muted = await isChatMuted(docSnap.id);
            chatItems.push({
                chatId: docSnap.id,
                otherUid,
                user,
                unread: muted ? 0 : unread, // якщо мут, не показуємо непрочитані
                lastMsg: displayLast,
                time,
                isOnline,
                updatedAt,
                muted
            });
        }

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
        div.className = `chat-item ${item.unread > 0 ? 'unread' : ''} ${item.muted ? 'muted' : ''}`;
        div.dataset.chatId = item.chatId;
        div.dataset.otherUid = item.otherUid;
        div.tabIndex = 0;
        div.innerHTML = `
            <div class="chat-avatar">
                <div class="avatar small" style="background-image:url(${item.user.avatar || ''})"></div>
                ${item.isOnline ? '<span class="online-indicator"></span>' : ''}
            </div>
            <div class="chat-info">
                <div class="chat-name">${item.user.nickname} ${item.user.verified ? '<span class="verified-badge">✓</span>' : ''}</div>
                <div class="chat-last">${item.lastMsg}</div>
            </div>
            <div class="chat-time">${item.time}</div>
            ${item.unread > 0 ? `<div class="chat-badge">${item.unread}</div>` : ''}
            ${item.muted ? '<div class="chat-muted">🔇</div>' : ''}
        `;

        div.addEventListener('click', () => {
            openChat(item.chatId, item.otherUid, item.user.nickname, item.user.userId, item.user.avatar);
        });

        listEl.appendChild(div);
    });
}

async function openChat(chatId, otherUid, otherName, otherUserId, otherAvatar) {
    if (!currentUser) return;

    // Перевірка блокування
    if (await isBlocked(currentUser.uid, otherUid)) {
        showToast('Ви не можете спілкуватися з цим користувачем');
        return;
    }

    currentChatId = chatId;
    currentChatPartner = otherUid;
    currentChatPartnerName = otherName;
    currentChatPartnerUserId = otherUserId;
    currentChatPartnerAvatar = otherAvatar;

    document.getElementById('chatName').textContent = otherName;
    document.getElementById('chatStatus').textContent = '';
    const avatarEl = document.getElementById('chatAvatar');
    avatarEl.style.backgroundImage = `url(${otherAvatar || ''})`;

    const chatWindowContainer = document.getElementById('chatWindowContainer');
    chatWindowContainer.style.display = 'flex';
    if (window.innerWidth < 768) {
        document.getElementById('chatListSidebar').classList.add('hide');
    }
    // Ховаємо нижнє меню
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) bottomNav.classList.add('hide-chat-mode');

    // Скидаємо лічильник непрочитаних для цього чату (тільки якщо не замучено)
    if (!(await isChatMuted(chatId))) {
        const chatRef = doc(db, "chats", chatId);
        await updateDoc(chatRef, {
            [`unread.${currentUser.uid}`]: 0
        }).catch(console.error);
    }

    subscribeToMessages(chatId);

    if (unsubscribeChatPresence) unsubscribeChatPresence();
    unsubscribeChatPresence = onSnapshot(doc(db, "users", otherUid), (snap) => {
        const lastOnline = snap.data()?.lastOnline?.seconds * 1000 || 0;
        const isOnline = (Date.now() - lastOnline) < 60000;
        const statusEl = document.getElementById('chatStatus');
        statusEl.textContent = isOnline ? 'онлайн' : 'був(ла) нещодавно';
    });

    if (unsubscribeTyping) unsubscribeTyping();
    const typingRef = doc(db, `chats/${chatId}/typing/${otherUid}`);
    unsubscribeTyping = onSnapshot(typingRef, (docSnap) => {
        const indicator = document.getElementById('typingIndicator');
        if (docSnap.exists() && docSnap.data().isTyping) {
            indicator.style.display = 'flex';
        } else {
            indicator.style.display = 'none';
        }
    });

    setTimeout(() => document.getElementById('chatText')?.focus(), 200);
}

function subscribeToMessages(chatId) {
    if (!currentUser) return;
    if (unsubscribeMessages) unsubscribeMessages();

    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = '';

    const q = query(collection(db, `chats/${chatId}/messages`), orderBy("createdAt", "asc"));
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        let lastDate = '';
        messagesContainer.innerHTML = '';

        snapshot.forEach(docSnap => {
            const msg = { id: docSnap.id, ...docSnap.data() };

            // Якщо повідомлення видалене для поточного користувача, пропускаємо
            if (msg.deletedFor && msg.deletedFor.includes(currentUser.uid)) return;

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
        });

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, (error) => {
        console.error('Помилка отримання повідомлень:', error);
        showToast('Помилка завантаження повідомлень');
    });
}

function createMessageElement(msg) {
    const isMine = msg.from === currentUser.uid;
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isMine ? 'sent' : 'received'}`;
    wrapper.dataset.messageId = msg.id;

    const bubble = document.createElement('div');
    bubble.className = `message-bubble ${isMine ? 'sent' : 'received'}`;

    // Відповідь (цитата)
    if (msg.replyTo) {
        const replyDiv = document.createElement('div');
        replyDiv.className = 'message-reply';
        replyDiv.innerHTML = `
            <div class="reply-sender">${msg.replyTo.senderName}</div>
            <div class="reply-text">${msg.replyTo.text || 'Медіа'}</div>
        `;
        bubble.appendChild(replyDiv);
    }

    if (!isMine) {
        const senderDiv = document.createElement('div');
        senderDiv.className = 'message-sender';
        senderDiv.innerHTML = `<div class="message-sender-avatar" style="background-image:url(${currentChatPartnerAvatar || ''})"></div> <span>${currentChatPartnerName}</span>`;
        bubble.appendChild(senderDiv);
    }

    if (msg.text) {
        const textDiv = document.createElement('div');
        textDiv.className = `message-text ${msg.edited ? 'edited' : ''}`;
        textDiv.textContent = msg.text;
        bubble.appendChild(textDiv);
    }

    if (msg.mediaUrl) {
        const mediaEl = msg.mediaType === 'image' ? document.createElement('img') : document.createElement('video');
        mediaEl.src = msg.mediaUrl;
        mediaEl.className = 'message-media';
        if (msg.mediaType === 'video') mediaEl.controls = true;
        mediaEl.addEventListener('click', () => window.open(msg.mediaUrl, '_blank'));
        bubble.appendChild(mediaEl);
    }

    if (msg.reactions && Object.keys(msg.reactions).length > 0) {
        const reactionsDiv = document.createElement('div');
        reactionsDiv.className = 'message-reactions';
        for (const [emoji, users] of Object.entries(msg.reactions)) {
            if (users.length === 0) continue;
            const reactionItem = document.createElement('span');
            reactionItem.className = `reaction-item ${users.includes(currentUser.uid) ? 'user-reacted' : ''}`;
            reactionItem.dataset.emoji = emoji;
            reactionItem.innerHTML = `<span class="emoji">${emoji}</span><span class="count">${users.length}</span>`;
            reactionItem.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleReaction(msg.id, emoji);
            });
            reactionsDiv.appendChild(reactionItem);
        }
        bubble.appendChild(reactionsDiv);
    }

    const footer = document.createElement('div');
    footer.className = 'message-footer';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = formatMessageTime(msg.createdAt);
    if (msg.edited) {
        const editedSpan = document.createElement('span');
        editedSpan.className = 'message-edited';
        editedSpan.textContent = 'відредаговано';
        footer.appendChild(editedSpan);
    }
    footer.appendChild(timeSpan);

    if (isMine) {
        const statusSpan = document.createElement('span');
        statusSpan.className = 'message-status';
        let status = 'sent';
        if (msg.readBy && msg.readBy.includes(currentChatPartner)) {
            status = 'read';
        } else if (msg.deliveredTo && msg.deliveredTo.includes(currentChatPartner)) {
            status = 'delivered';
        }
        statusSpan.innerHTML = getStatusIcon(status);
        footer.appendChild(statusSpan);
    }

    bubble.appendChild(footer);
    wrapper.appendChild(bubble);

    // Контекстне меню
    attachMessageContextMenu(wrapper, msg);

    return wrapper;
}

function attachMessageContextMenu(wrapper, msg) {
    const isMine = msg.from === currentUser.uid;
    const msgTime = msg.createdAt?.seconds * 1000 || 0;
    const now = Date.now();
    const canEditDelete = isMine && (now - msgTime) < 15 * 60 * 1000; // 15 хвилин

    wrapper.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMessageContextMenu(e, msg, canEditDelete);
    });

    let longPressTimer;
    wrapper.addEventListener('touchstart', (e) => {
        longPressTimer = setTimeout(() => {
            showMessageContextMenu(e, msg, canEditDelete);
        }, 500);
    });
    wrapper.addEventListener('touchend', () => clearTimeout(longPressTimer));
    wrapper.addEventListener('touchmove', () => clearTimeout(longPressTimer));
}

function showMessageContextMenu(event, msg, canEditDelete) {
    const menu = document.getElementById('messageContextMenu');
    if (!menu) return;

    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
    menu.classList.add('show');
    menu.dataset.messageId = msg.id;
    menu.dataset.messageText = msg.text || '';

    // Показуємо/ховаємо пункти залежно від прав
    const replyItem = menu.querySelector('[data-action="reply"]');
    const editItem = menu.querySelector('[data-action="edit"]');
    const deleteSelfItem = menu.querySelector('[data-action="deleteSelf"]');
    const deleteEveryoneItem = menu.querySelector('[data-action="deleteEveryone"]');

    replyItem.style.display = 'block';
    if (canEditDelete) {
        editItem.style.display = 'block';
        deleteEveryoneItem.style.display = 'block';
    } else {
        editItem.style.display = 'none';
        deleteEveryoneItem.style.display = 'none';
    }
    deleteSelfItem.style.display = 'block'; // завжди можна видалити для себе

    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.classList.remove('show');
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

// Обробники контекстного меню
document.getElementById('messageContextMenu')?.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    const menu = document.getElementById('messageContextMenu');
    const messageId = menu.dataset.messageId;
    const messageText = menu.dataset.messageText;
    if (!action || !messageId || !currentChatId) return;

    menu.classList.remove('show');

    const messageRef = doc(db, `chats/${currentChatId}/messages/${messageId}`);

    switch (action) {
        case 'reply':
            currentReplyToMessage = { id: messageId, text: messageText, senderName: currentChatPartnerName };
            document.getElementById('replyPreview').innerHTML = `
                <span>Відповідь ${currentChatPartnerName}: ${messageText.substring(0, 30)}</span>
                <button id="cancelReply">✕</button>
            `;
            document.getElementById('replyPreview').style.display = 'flex';
            document.getElementById('cancelReply').onclick = () => {
                currentReplyToMessage = null;
                document.getElementById('replyPreview').style.display = 'none';
            };
            break;

        case 'edit':
            const newText = prompt('Редагувати повідомлення:', messageText);
            if (newText !== null) {
                await updateDoc(messageRef, { text: newText, edited: true });
            }
            break;

        case 'copy':
            navigator.clipboard.writeText(messageText).then(() => showToast('Скопійовано'));
            break;

        case 'deleteSelf':
            await updateDoc(messageRef, {
                deletedFor: arrayUnion(currentUser.uid)
            });
            break;

        case 'deleteEveryone':
            if (confirm('Видалити це повідомлення для всіх?')) {
                await deleteDoc(messageRef);
            }
            break;
    }
});

// Відправка повідомлення з підтримкою відповіді
async function sendMessage() {
    const textInput = document.getElementById('chatText');
    const text = textInput?.value.trim() || '';
    const fileInput = document.getElementById('chatAttachFile');
    const file = fileInput?.files[0];
    if (!text && !file) return;
    if (!currentUser || !currentChatId || !currentChatPartner) {
        showToast('Чат не вибрано');
        return;
    }

    // Перевірка блокування
    if (await isBlocked(currentUser.uid, currentChatPartner)) {
        showToast('Ви не можете надсилати повідомлення цьому користувачу');
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
            from: currentUser.uid,
            text: text || '',
            createdAt: serverTimestamp(),
            readBy: [currentUser.uid],
            deliveredTo: [currentUser.uid],
            reactions: {}
        };

        if (currentReplyToMessage) {
            messageData.replyTo = {
                messageId: currentReplyToMessage.id,
                text: currentReplyToMessage.text,
                senderName: currentReplyToMessage.senderName
            };
            currentReplyToMessage = null;
            document.getElementById('replyPreview').style.display = 'none';
        }

        if (mediaUrl) {
            messageData.mediaUrl = mediaUrl;
            messageData.mediaType = mediaType;
        }

        const messageRef = collection(db, `chats/${currentChatId}/messages`);
        await addDoc(messageRef, messageData);

        const chatRef = doc(db, "chats", currentChatId);
        // Оновлюємо lastMessage тільки якщо чат не замучено
        const muted = await isChatMuted(currentChatId);
        const updateData = {
            lastMessage: text || (mediaType === 'image' ? '📷 Фото' : '🎥 Відео'),
            lastMessageType: mediaType || 'text',
            updatedAt: serverTimestamp()
        };
        if (!muted) {
            updateData[`unread.${currentChatPartner}`] = increment(1);
        }
        await updateDoc(chatRef, updateData);

        if (textInput) textInput.value = '';
        if (fileInput) {
            fileInput.value = '';
            document.getElementById('chatAttachBtn').innerHTML = '📎';
        }

        const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
        await setDoc(typingRef, { isTyping: false }, { merge: true });

    } catch (error) {
        console.error('Помилка відправки:', error);
        showToast('Не вдалося відправити повідомлення');
    }
}

// Індикатор друку
document.getElementById('chatText')?.addEventListener('input', () => {
    if (!currentUser || !currentChatId || !currentChatPartner) return;
    const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
    setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error);
    }, 2000);
});

// Реакції
async function toggleReaction(messageId, emoji) {
    if (!currentUser || !currentChatId) return;
    const messageRef = doc(db, `chats/${currentChatId}/messages/${messageId}`);
    const messageSnap = await getDoc(messageRef);
    if (!messageSnap.exists()) return;
    const reactions = messageSnap.data().reactions || {};
    const users = reactions[emoji] || [];
    const userIndex = users.indexOf(currentUser.uid);
    if (userIndex === -1) {
        users.push(currentUser.uid);
    } else {
        users.splice(userIndex, 1);
    }
    if (users.length === 0) {
        delete reactions[emoji];
    } else {
        reactions[emoji] = users;
    }
    await updateDoc(messageRef, { reactions });
}

// ================= Модуль: Пошук користувачів у чатах (реальний час) =================
let searchTimeout;
document.getElementById('chatSearchInput')?.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const val = e.target.value.trim();
    const resultsContainer = document.getElementById('chatSearchResults');
    if (!val) {
        resultsContainer.style.display = 'none';
        resultsContainer.innerHTML = '';
        return;
    }
    searchTimeout = setTimeout(() => searchUsersForChat(val), 300);
});

async function searchUsersForChat(query) {
    if (!currentUser) return;
    const qLower = query.toLowerCase();
    const resultsContainer = document.getElementById('chatSearchResults');
    resultsContainer.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
    resultsContainer.style.display = 'block';

    try {
        const searchTerm = qLower.startsWith('@') ? qLower : `@${qLower}`;
        const q1 = query(
            collection(db, "users"),
            where("userId", ">=", searchTerm),
            where("userId", "<=", searchTerm + '\uf8ff')
        );
        const q2 = query(
            collection(db, "users"),
            where("nickname_lower", ">=", qLower),
            where("nickname_lower", "<=", qLower + '\uf8ff')
        );

        const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const usersMap = new Map();

        snap1.forEach(d => { if (d.id !== currentUser.uid) usersMap.set(d.id, d.data()); });
        snap2.forEach(d => { if (d.id !== currentUser.uid) usersMap.set(d.id, d.data()); });

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
            div.innerHTML = `
                <div class="avatar small" style="background-image:url(${data.avatar || ''})"></div>
                <div class="chat-info">
                    <div class="chat-name">${data.nickname} ${data.verified ? '<span class="verified-badge">✓</span>' : ''}</div>
                    <div class="chat-last">${data.userId}</div>
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
                if (await isBlocked(currentUser.uid, uid)) {
                    showToast('Ви не можете написати цьому користувачу');
                    return;
                }
                const chatId = getChatId(currentUser.uid, uid);
                const chatRef = doc(db, "chats", chatId);
                const chatSnap = await getDoc(chatRef);
                if (!chatSnap.exists()) {
                    await setDoc(chatRef, {
                        participants: [currentUser.uid, uid],
                        createdAt: serverTimestamp(),
                        updatedAt: serverTimestamp(),
                        lastMessage: '',
                        unread: { [currentUser.uid]: 0, [uid]: 0 }
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

// ================= Інтеграція з існуючим кодом =================
// (Тут має бути весь інший код: авторизація, пости, профілі тощо, адаптований під нові функції)

// Для економії місця наведено ключові додатки. Повний код дуже великий, але він організований за модулями.
// Нижче – фрагменти інтеграції верифікації та блокування в існуючі функції.

// Приклад: при підписці/відписці оновлюємо верифікацію
async function toggleFollow(targetUid, buttonElement) {
    if (!currentUser) return;
    const wasFollowing = currentUserFollowing.includes(targetUid);
    const newFollowingState = !wasFollowing;

    // ... логіка оновлення локального стану ...

    try {
        const myRef = doc(db, "users", currentUser.uid);
        const targetRef = doc(db, "users", targetUid);
        if (wasFollowing) {
            await updateDoc(myRef, { following: arrayRemove(targetUid) });
            await updateDoc(targetRef, { followers: arrayRemove(currentUser.uid) });
        } else {
            await updateDoc(myRef, { following: arrayUnion(targetUid) });
            await updateDoc(targetRef, { followers: arrayUnion(currentUser.uid) });
            vibrate(30);
        }

        // Оновлюємо верифікацію для цільового користувача
        await updateVerificationBadge(targetUid);
    } catch (error) {
        // ... обробка помилок ...
    }
}

// При завантаженні профілю враховуємо блокування
async function loadUserProfile(uid) {
    if (!currentUser) return;
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return;

    const data = snap.data();
    const isOwn = uid === currentUser.uid;
    const blocked = await isBlocked(currentUser.uid, uid);
    if (blocked && !isOwn) {
        renderBlockedProfile(data, uid);
        return;
    }
    renderProfile(data, uid, isOwn);
}

function renderBlockedProfile(data, uid) {
    const header = document.getElementById('profileHeader');
    header.innerHTML = `
        <div class="avatar large" style="background-image:url(${data.avatar || ''})"></div>
        <div>
            <h2>${data.nickname}</h2>
            <p class="text-danger">Цей користувач вас заблокував або ви його заблокували</p>
        </div>
    `;
    document.getElementById('profileTabs').innerHTML = '';
    document.getElementById('profileFeed').innerHTML = '';
}

// У чаті перевіряємо блокування перед відкриттям
// (вже додано в openChat)

// ================= Ініціалізація =================
onAuthStateChanged(auth, (user) => {
    cleanupListeners();
    if (user) {
        currentUser = user;
        currentProfileUid = user.uid;
        document.getElementById('authBox').style.display = 'none';
        document.getElementById('newPostBox').style.display = 'block';

        lastOnlineInterval = setInterval(() => {
            updateDoc(doc(db, "users", currentUser.uid), { lastOnline: serverTimestamp() }).catch(console.error);
        }, 30000);

        // Підписка на дані користувача
        const userRef = doc(db, "users", currentUser.uid);
        unsubscribeUserData = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                currentUserData = docSnap.data();
                currentUserFollowing = docSnap.data().following || [];
                // Оновлення верифікації (на всяк випадок)
                updateVerificationBadge(currentUser.uid);
            }
        });

        // Підписка на список чатів для непрочитаних
        const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
        unsubscribeChatList = onSnapshot(q, async (snapshot) => {
            let totalUnread = 0;
            for (const docSnap of snapshot.docs) {
                const chat = docSnap.data();
                const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
                if (otherUid && await isBlocked(currentUser.uid, otherUid)) continue; // ігноруємо заблоковані чати
                if (chat.unread && chat.unread[currentUser.uid]) {
                    // Перевіряємо мут
                    const muted = await isChatMuted(docSnap.id);
                    if (!muted) {
                        totalUnread += chat.unread[currentUser.uid];
                    }
                }
            }
            unreadCount = totalUnread;
            updateUnreadBadge();
            if (document.getElementById('chats')?.classList.contains('active')) {
                loadChatList();
            }
        }, (error) => {
            console.error('Chat list snapshot error:', error);
            showToast('Помилка оновлення списку чатів. Перевірте індекси Firestore.');
        });

        // Завантаження початкових даних
        resetPagination();
        loadMyProfile();
        loadSettings(); // завантажити налаштування для сторінки settings

        // ... решта ініціалізації ...
    } else {
        currentUser = null;
        currentUserData = null;
        document.getElementById('authBox').style.display = 'block';
        document.getElementById('newPostBox').style.display = 'none';
        unreadCount = 0;
        updateUnreadBadge();
    }
});

// ================= Додаткові обробники для нових функцій =================
// Кнопка "Поскаржитися" в профілі (вже є в renderProfile, додаємо обробник)
// Кнопка "Замутити чат" в меню чату
document.getElementById('chatMenuDropdown')?.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action || !currentChatPartner) return;
    document.getElementById('chatMenuDropdown')?.classList.remove('show');

    if (action === 'viewProfile') {
        viewProfile(currentChatPartner);
    } else if (action === 'block') {
        await blockUser(currentChatPartner);
        // Закрити чат
        document.getElementById('chatBackBtn').click();
    } else if (action === 'mute') {
        // Показати модалку вибору тривалості
        showMuteDurationModal(currentChatId);
    } else if (action === 'clearHistory') {
        if (confirm('Очистити історію повідомлень? Це не можна скасувати.') && currentChatId) {
            const messagesRef = collection(db, `chats/${currentChatId}/messages`);
            const snapshot = await getDocs(messagesRef);
            const batch = writeBatch(db);
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
            showToast('Історію очищено');
        }
    }
});

function showMuteDurationModal(chatId) {
    const modal = document.getElementById('muteModal');
    modal.classList.add('active');
    document.querySelectorAll('.mute-option').forEach(btn => {
        btn.onclick = () => {
            const duration = btn.dataset.duration; // '1', '8', '24', 'forever'
            muteChat(chatId, duration);
            modal.classList.remove('active');
        };
    });
}

// Кнопка "Поскаржитися" в чаті
document.getElementById('reportChatBtn')?.addEventListener('click', () => {
    if (!currentChatPartner) return;
    const reason = prompt('Оберіть причину:\n1 - Спам\n2 - Образи\n3 - Фейковий акаунт\n4 - Інше');
    let reasonText = '';
    switch (reason) {
        case '1': reasonText = 'Спам'; break;
        case '2': reasonText = 'Образи'; break;
        case '3': reasonText = 'Фейковий акаунт'; break;
        default: reasonText = 'Інше: ' + (prompt('Опишіть детальніше') || '');
    }
    reportUser(currentChatPartner, reasonText);
});

// ================= Запуск =================
// Додати HTML для нових модалок (налаштування, мут, тощо) – вони мають бути в index.html
// Тут не наводяться, але передбачаються.

console.log('Додаток успішно завантажено з усіма новими функціями!');
