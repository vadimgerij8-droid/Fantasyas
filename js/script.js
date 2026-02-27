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
let currentReplyToMessage = null;

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

// ================= Допоміжні функції =================
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
        // Видалити чат зі списку
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
async function loadSettings() {
    if (!currentUser) return;
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const data = userSnap.data();
    document.getElementById('settingsNickname').value = data.nickname || '';
    document.getElementById('settingsBio').value = data.bio || '';
    document.getElementById('privacyWhoCanMessage').value = data.privacy?.whoCanMessage || 'everyone';
    document.getElementById('privacyWhoCanSeeOnline').value = data.privacy?.whoCanSeeOnline || 'everyone';
    document.getElementById('privacyWhoCanSeeFollowers').value = data.privacy?.whoCanSeeFollowers || 'everyone';
    document.getElementById('notifyPrivateChats').checked = data.notifications?.privateChats !== false;
    document.getElementById('themeSelect').value = data.theme || 'light';
    document.getElementById('accentColor').value = data.accentColor || '#007bff';

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
}

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
    document.body.classList.toggle('dark', updates.theme === 'dark');
    document.documentElement.style.setProperty('--accent-color', updates.accentColor);
    showToast('Налаштування збережено');
});

// ================= Модуль: Чати =================
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

            const muted = await isChatMuted(docSnap.id);
            chatItems.push({
                chatId: docSnap.id,
                otherUid,
                user,
                unread: muted ? 0 : unread,
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
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) bottomNav.classList.add('hide-chat-mode');

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

    attachMessageContextMenu(wrapper, msg);

    return wrapper;
}

function attachMessageContextMenu(wrapper, msg) {
    const isMine = msg.from === currentUser.uid;
    const msgTime = msg.createdAt?.seconds * 1000 || 0;
    const now = Date.now();
    const canEditDelete = isMine && (now - msgTime) < 15 * 60 * 1000;

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
    deleteSelfItem.style.display = 'block';

    const closeMenu = (e) => {
        if (!menu.contains(e.target)) {
            menu.classList.remove('show');
            document.removeEventListener('click', closeMenu);
        }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

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

document.getElementById('sendMessage')?.addEventListener('click', sendMessage);
document.getElementById('chatText')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

let typingTimeout;
document.getElementById('chatText')?.addEventListener('input', () => {
    if (!currentUser || !currentChatId || !currentChatPartner) return;
    const typingRef = doc(db, `chats/${currentChatId}/typing/${currentUser.uid}`);
    setDoc(typingRef, { isTyping: true }, { merge: true }).catch(console.error);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        setDoc(typingRef, { isTyping: false }, { merge: true }).catch(console.error);
    }, 2000);
});

document.getElementById('chatAttachBtn')?.addEventListener('click', () => {
    document.getElementById('chatAttachFile')?.click();
});
document.getElementById('chatAttachFile')?.addEventListener('change', function() {
    if (this.files && this.files[0]) {
        const btn = document.getElementById('chatAttachBtn');
        if (btn) btn.innerHTML = '📁';
    }
});

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

document.getElementById('chatBackBtn')?.addEventListener('click', () => {
    const chatWindow = document.getElementById('chatWindowContainer');
    if (chatWindow) chatWindow.style.display = 'none';
    const chatSidebar = document.getElementById('chatListSidebar');
    if (chatSidebar) chatSidebar.classList.remove('hide');
    const bottomNav = document.querySelector('.bottom-nav');
    if (bottomNav) bottomNav.classList.remove('hide-chat-mode');
    if (unsubscribeMessages) unsubscribeMessages();
    if (unsubscribeTyping) unsubscribeTyping();
    if (unsubscribeChatPresence) unsubscribeChatPresence();
    currentChatId = null;
    currentChatPartner = null;
});

document.getElementById('chatAvatar')?.addEventListener('click', () => {
    if (currentChatPartner) viewProfile(currentChatPartner);
});

document.getElementById('chatMenuBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('chatMenuDropdown');
    if (dropdown) dropdown.classList.toggle('show');
});

document.addEventListener('click', () => {
    const dropdown = document.getElementById('chatMenuDropdown');
    if (dropdown) dropdown.classList.remove('show');
});

document.getElementById('chatMenuDropdown')?.addEventListener('click', async (e) => {
    const action = e.target.dataset.action;
    if (!action || !currentChatPartner) return;
    document.getElementById('chatMenuDropdown')?.classList.remove('show');
    if (action === 'viewProfile') {
        viewProfile(currentChatPartner);
    } else if (action === 'mute') {
        const modal = document.getElementById('muteModal');
        modal.classList.add('active');
        document.querySelectorAll('.mute-option').forEach(btn => {
            btn.onclick = () => {
                const duration = btn.dataset.duration;
                muteChat(currentChatId, duration);
                modal.classList.remove('active');
            };
        });
    } else if (action === 'report') {
        const reason = prompt('Оберіть причину:\n1 - Спам\n2 - Образи\n3 - Фейковий акаунт\n4 - Інше');
        let reasonText = '';
        switch (reason) {
            case '1': reasonText = 'Спам'; break;
            case '2': reasonText = 'Образи'; break;
            case '3': reasonText = 'Фейковий акаунт'; break;
            default: reasonText = 'Інше: ' + (prompt('Опишіть детальніше') || '');
        }
        await reportUser(currentChatPartner, reasonText);
    } else if (action === 'block') {
        await blockUser(currentChatPartner);
        document.getElementById('chatBackBtn').click();
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

// ================= ПОШУК КОРИСТУВАЧІВ У ЧАТАХ =================
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

// ================= Функція завантаження на Cloudinary =================
async function uploadToCloudinary(file) {
    const CLOUD_NAME = 'dv6ehoqiq';
    const UPLOAD_PRESET = 'post_media';
    const url = `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', UPLOAD_PRESET);
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cloudinary upload failed: ${response.status} ${errorText}`);
    }
    const data = await response.json();
    return data.secure_url;
}

// ================= Функції для постів (скорочено) =================
async function toggleLike(postId) {
    if (!currentUser) {
        showToast('Увійдіть, щоб лайкати');
        return;
    }
    const postRef = doc(db, "posts", postId);
    try {
        const postSnap = await getDoc(postRef);
        if (!postSnap.exists()) {
            showToast('Пост не знайдено');
            return;
        }
        const postData = postSnap.data();
        const isLiked = postData.likes?.includes(currentUser.uid) || false;

        if (isLiked) {
            await updateDoc(postRef, {
                likes: arrayRemove(currentUser.uid),
                likesCount: increment(-1),
                popularity: increment(-50)
            });
            await updateDoc(doc(db, "users", currentUser.uid), {
                likedPosts: arrayRemove(postId)
            });
        } else {
            await updateDoc(postRef, {
                likes: arrayUnion(currentUser.uid),
                likesCount: increment(1),
                popularity: increment(50)
            });
            await updateDoc(doc(db, "users", currentUser.uid), {
                likedPosts: arrayUnion(postId)
            });
            vibrate(30);
        }
    } catch (error) {
        console.error('Помилка toggleLike:', error);
        showToast('Не вдалося оновити лайк. Спробуйте ще.');
    }
}

// ================= Навігація по розділах =================
const sections = ['home','search','hashtags','profile','chats','settings'];
const navItems = document.querySelectorAll('.bottom-nav .nav-item');
navItems.forEach((item) => {
    item.addEventListener('click', async () => {
        const section = item.dataset.section;
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        sections.forEach(s => document.getElementById(s).classList.remove('active'));
        const sectionEl = document.getElementById(section);
        if (sectionEl) sectionEl.classList.add('active');
        const span = item.querySelector('span');
        document.getElementById('pageTitle').textContent = span ? span.textContent : item.textContent.trim();
        cleanupListeners();

        const chatWindow = document.getElementById('chatWindowContainer');
        if (chatWindow) chatWindow.style.display = 'none';
        const chatSidebar = document.getElementById('chatListSidebar');
        if (chatSidebar) chatSidebar.classList.remove('hide');
        document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');

        if (section === 'home' && currentUser) {
            resetPagination();
        }
        if (section === 'search' && currentUser) {
            await loadSearchUsers();
        }
        if (section === 'hashtags' && currentUser) {
            await loadHashtags();
        }
        if (section === 'chats' && currentUser) {
            document.getElementById('chatWindowContainer').style.display = 'none';
            document.getElementById('chatListSidebar').classList.remove('hide');
            document.getElementById('chatSearchInput').value = '';
            document.getElementById('chatSearchResults').style.display = 'none';
            await loadChatList();
        }
        if (section === 'profile' && currentUser) {
            await viewProfile(currentUser.uid);
        }
        if (section === 'settings') {
            // нічого не завантажуємо
        }
    });
});

// ================= Емоджі-пікер =================
const emojiList = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];

function closeAllEmojiPickers() {
    document.querySelectorAll('.emoji-picker').forEach(p => p.classList.remove('active'));
}

function setupEmojiPicker(buttonId, pickerId, inputId) {
    const btn = document.getElementById(buttonId);
    const picker = document.getElementById(pickerId);
    const input = document.getElementById(inputId);
    if (!btn || !picker || !input) return;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isActive = picker.classList.contains('active');
        closeAllEmojiPickers();
        if (!isActive) {
            picker.classList.add('active');
        }
    });
    picker.innerHTML = '';
    emojiList.forEach(emoji => {
        const button = document.createElement('button');
        button.textContent = emoji;
        button.type = 'button';
        button.tabIndex = 0;
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            const start = input.selectionStart;
            const end = input.selectionEnd;
            const text = input.value;
            input.value = text.substring(0, start) + emoji + text.substring(end);
            input.focus();
            input.selectionStart = input.selectionEnd = start + emoji.length;
            picker.classList.remove('active');
        });
        picker.appendChild(button);
    });
    document.addEventListener('click', (e) => {
        if (!picker.contains(e.target) && e.target !== btn) {
            picker.classList.remove('active');
        }
    });
}

// ================= Кастомний вибір файлу =================
function setupFileInput(inputId, labelId, previewId) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    const preview = document.getElementById(previewId);
    if (!input || !label) return;
    input.addEventListener('change', function() {
        if (this.files && this.files[0]) {
            const file = this.files[0];
            label.textContent = file.name.length > 30 ? file.name.substring(0,30)+'…' : file.name;
            if (preview) {
                if (file.type.startsWith('image/')) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        preview.src = e.target.result;
                        preview.classList.add('show');
                    };
                    reader.readAsDataURL(file);
                } else if (file.type.startsWith('video/')) {
                    preview.src = '';
                    preview.classList.remove('show');
                }
            }
        } else {
            label.textContent = inputId.includes('Avatar') ? 'Обрати аватар' : 'Обрати фото/відео';
            if (preview) preview.classList.remove('show');
        }
    });
}

// ================= Функції для хештегів =================
function extractHashtags(text) {
    const regex = /#(\w+)/g;
    const matches = text.match(regex);
    return matches ? matches.map(tag => tag.toLowerCase()) : [];
}

async function loadHashtags() {
    const list = document.getElementById('hashtagList');
    if (!list) return;
    list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
    try {
        const postsSnap = await getDocs(collection(db, "posts"));
        const tagCount = new Map();
        postsSnap.forEach(doc => {
            const tags = doc.data().hashtags || [];
            tags.forEach(tag => {
                tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
            });
        });
        const sortedTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);

        list.innerHTML = '';
        if (sortedTags.length === 0) {
            list.innerHTML = '<p style="text-align:center; padding:20px;">Поки немає хештегів</p>';
            return;
        }

        sortedTags.forEach(([tag, count]) => {
            const div = document.createElement('div');
            div.className = 'hashtag-item';
            div.tabIndex = 0;
            div.innerHTML = `
                <span class="hashtag-name">${tag}</span>
                <span class="hashtag-count">${count} постів</span>
            `;
            div.onclick = () => searchHashtag(tag);
            list.appendChild(div);
        });

    } catch (e) {
        console.error('Error loading hashtags:', e);
        list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
    }
}

function searchHashtag(tag) {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.value = '#' + tag;
        document.querySelector('[data-section="search"]').click();
        loadSearchUsers();
    }
}

async function loadFilterHashtags() {
    const list = document.getElementById('filterList');
    if (!list) return;
    list.innerHTML = '<div class="skeleton" style="height:60px;"></div>';
    try {
        const postsSnap = await getDocs(collection(db, "posts"));
        const tagCount = new Map();
        postsSnap.forEach(doc => {
            const tags = doc.data().hashtags || [];
            tags.forEach(tag => {
                tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
            });
        });
        const sortedTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);

        list.innerHTML = '';
        if (sortedTags.length === 0) {
            list.innerHTML = '<p style="text-align:center; padding:20px;">Немає хештегів</p>';
            return;
        }

        sortedTags.forEach(([tag, count]) => {
            const div = document.createElement('div');
            div.className = 'filter-item';
            div.tabIndex = 0;
            div.innerHTML = `
                <span class="tag">#${tag}</span>
                <span class="count">${count} постів</span>
            `;
            div.onclick = () => applyFilter(tag);
            list.appendChild(div);
        });

    } catch (e) {
        console.error('Error loading filter hashtags:', e);
        list.innerHTML = '<p style="text-align:center; padding:20px;">Помилка завантаження</p>';
    }
}

function applyFilter(tag) {
    currentFilterHashtag = tag;
    document.getElementById('filterModal').classList.remove('active');
    const activeDiv = document.getElementById('activeFilter');
    activeDiv.innerHTML = `#${tag} <button id="clearFilterChip">✕</button>`;
    document.getElementById('clearFilterChip').onclick = clearFilter;
    resetPagination();
}

function clearFilter() {
    currentFilterHashtag = null;
    document.getElementById('activeFilter').innerHTML = '';
    resetPagination();
}

// ================= АВТОРИЗАЦІЯ =================
document.getElementById('toRegister').onclick = () => {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('registerForm').style.display = 'block';
};

document.getElementById('toLogin').onclick = () => {
    document.getElementById('registerForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
};

document.getElementById('registerBtn').onclick = async () => {
    const nickname = document.getElementById('registerNickname').value.trim();
    const password = document.getElementById('registerPassword').value.trim();
    if (!nickname) return alert('Введіть псевдонім');
    if (password.length < 6) return alert('Мінімум 6 символів');
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (!snap.empty) return alert('Цей ID вже зайнятий');
    try {
        const safeNick = nickname.toLowerCase().replace(/[^a-z0-9]/g, '');
        const randomSuffix = Math.floor(Math.random() * 10000);
        const email = `${safeNick}_${randomSuffix}@fantasyas.local`;
        const cred = await createUserWithEmailAndPassword(auth, email, password);

        await setDoc(doc(db, "users", cred.user.uid), {
            nickname,
            userId,
            nickname_lower: nickname.toLowerCase(),
            bio: '',
            avatar: '',
            posts: [],
            likedPosts: [],
            savedPosts: [],
            followers: [],
            following: [],
            mutedUsers: [],
            blockedUsers: [],
            createdAt: serverTimestamp(),
            lastOnline: serverTimestamp(),
            email: email
        });

        showToast('Реєстрація успішна');
        document.getElementById('toLogin').click();

    } catch (e) { showToast(e.message); }
};

document.getElementById('loginBtn').onclick = async () => {
    const nickname = document.getElementById('loginNickname').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    if (!nickname || !password) return alert('Заповніть поля');
    try {
        const userId = `@${nickname.toLowerCase()}`;
        const q = query(collection(db, "users"), where("userId", "==", userId));
        const snap = await getDocs(q);
        if (snap.empty) return alert('Користувача не знайдено');
        const userDoc = snap.docs[0];
        const userData = userDoc.data();
        const email = userData.email;

        if (!email) {
            return alert('Для цього акаунту не встановлено email. Увійдіть через Google або Apple, або створіть новий акаунт.');
        }

        await signInWithEmailAndPassword(auth, email, password);
        showToast('Ласкаво просимо!');

    } catch (err) {
        alert('Невірний псевдонім або пароль');
    }
};

// Google Login
document.getElementById('googleLoginBtn').onclick = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            const nickname = user.displayName || user.email?.split('@')[0] || 'user';
            let userId = `@${nickname.toLowerCase()}`;
            const q = query(collection(db, "users"), where("userId", "==", userId));
            const snap = await getDocs(q);
            if (!snap.empty) userId = `@${nickname.toLowerCase()}${Math.floor(Math.random()*1000)}`;
            await setDoc(doc(db, "users", user.uid), {
                nickname,
                userId,
                nickname_lower: nickname.toLowerCase(),
                bio: '',
                avatar: user.photoURL || '',
                posts: [],
                likedPosts: [],
                savedPosts: [],
                followers: [],
                following: [],
                mutedUsers: [],
                blockedUsers: [],
                createdAt: serverTimestamp(),
                lastOnline: serverTimestamp(),
                email: user.email
            });
        }
        showToast('Вхід через Google успішний');
    } catch (error) {
        console.error('Google login error:', error);
        if (error.code === 'auth/popup-blocked') {
            showToast('Будь ласка, дозвольте спливаючі вікна для цього сайту, щоб увійти через Google.');
        } else if (error.code === 'auth/operation-not-allowed') {
            showToast('Вхід через Google не налаштовано в Firebase. Перевірте консоль Firebase.');
        } else {
            showToast('Помилка входу: ' + error.message);
        }
    }
};

// Apple Login
document.getElementById('appleLoginBtn').onclick = async () => {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            const nickname = user.displayName || user.email?.split('@')[0] || 'user';
            let userId = `@${nickname.toLowerCase()}`;
            const q = query(collection(db, "users"), where("userId", "==", userId));
            const snap = await getDocs(q);
            if (!snap.empty) userId = `@${nickname.toLowerCase()}${Math.floor(Math.random()*1000)}`;
            await setDoc(doc(db, "users", user.uid), {
                nickname,
                userId,
                nickname_lower: nickname.toLowerCase(),
                bio: '',
                avatar: user.photoURL || '',
                posts: [],
                likedPosts: [],
                savedPosts: [],
                followers: [],
                following: [],
                mutedUsers: [],
                blockedUsers: [],
                createdAt: serverTimestamp(),
                lastOnline: serverTimestamp(),
                email: user.email
            });
        }
        showToast('Вхід через Apple успішний');
    } catch (error) {
        showToast('Помилка: ' + error.message);
    }
};

document.getElementById('forgotPassword').onclick = async (e) => {
    e.preventDefault();
    const nickname = prompt('Введіть ваш псевдонім (без @)');
    if (!nickname) return;
    const userId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", userId));
    const snap = await getDocs(q);
    if (snap.empty) return alert('Користувача не знайдено');
    const userData = snap.docs[0].data();
    const email = userData.email;
    if (!email) return alert('Для цього акаунту не вказано email. Увійдіть через Google/Apple або створіть новий акаунт.');
    try {
        await sendPasswordResetEmail(auth, email);
        showToast('Лист для скидання пароля відправлено');
    } catch (err) {
        showToast('Помилка: ' + err.message);
    }
};

// ================= Стрічка =================
document.getElementById('feedNewBtn').onclick = () => {
    if (currentFeedType === 'new') return;
    currentFeedType = 'new';
    resetPagination();
};

document.getElementById('feedPopularBtn').onclick = () => {
    if (currentFeedType === 'popular') return;
    currentFeedType = 'popular';
    resetPagination();
};

function resetPagination() {
    lastVisible = null;
    hasMore = true;
    const feed = document.getElementById('feed');
    if (feed) {
        clearMainFeedListeners();
        feed.innerHTML = '';
    }
    loadMorePosts();
}

// ================= Додавання поста =================
document.getElementById('addPost').onclick = async () => {
    if (!currentUser) return alert('Увійдіть');
    const text = document.getElementById('postText').value.trim();
    const file = document.getElementById('postMedia').files[0];
    if (!text && !file) return alert('Додайте текст або медіа');
    try {
        let mediaUrl = '', mediaType = '';
        if (file) {
            mediaUrl = await uploadToCloudinary(file);
            mediaType = file.type.split('/')[0];
        }
        const userSnap = await getDoc(doc(db, "users", currentUser.uid));
        const userData = userSnap.data();
        const hashtags = extractHashtags(text);

        const postDoc = await addDoc(collection(db, "posts"), {
            author: currentUser.uid,
            authorType: 'user',
            authorName: userData.nickname,
            authorUserId: userData.userId,
            authorAvatar: userData.avatar || '',
            text,
            mediaUrl,
            mediaType,
            createdAt: serverTimestamp(),
            likes: [],
            likesCount: 0,
            commentsCount: 0,
            saves: [],
            views: 0,
            hashtags: hashtags,
            popularity: 0
        });
        await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayUnion(postDoc.id) });
        document.getElementById('postText').value = '';
        document.getElementById('postMedia').value = '';
        document.getElementById('postMediaLabel').textContent = 'Обрати фото/відео';
        document.getElementById('postMediaPreview').classList.remove('show');
        showToast('Пост опубліковано!');

    } catch (e) { showToast(e.message); }
};

// ================= Функція завантаження постів =================
async function loadMorePosts() {
    if (!currentUser || loading || !hasMore) return;
    loading = true;
    const skeleton = document.getElementById('skeletonContainer');
    if (skeleton) skeleton.style.display = 'block';
    try {
        let baseQuery;
        if (currentFilterHashtag) {
            baseQuery = query(collection(db, "posts"), where("hashtags", "array-contains", currentFilterHashtag));
        } else {
            baseQuery = collection(db, "posts");
        }
        let q;
        if (currentFeedType === 'new' || currentFilterHashtag) {
            q = query(baseQuery, orderBy("createdAt", "desc"), limit(10));
        } else {
            q = query(baseQuery, orderBy("likesCount", "desc"), orderBy("createdAt", "desc"), limit(10));
        }

        if (lastVisible) q = query(q, startAfter(lastVisible));

        const snapshot = await getDocs(q);
        if (snapshot.empty) { hasMore = false; return; }

        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        renderPosts(snapshot.docs);

    } catch (e) {
        console.error("Помилка завантаження постів:", e);
        showToast("Помилка завантаження. Перевірте індекси Firestore.");
    } finally {
        if (skeleton) skeleton.style.display = 'none';
        loading = false;
    }
}

async function loadComments(postId, container) {
    const q = query(collection(db, `posts/${postId}/comments`), orderBy("createdAt", "asc"));
    const snapshot = await getDocs(q);
    container.innerHTML = '';
    snapshot.forEach(doc => {
        const comment = doc.data();
        const commentEl = document.createElement('div');
        commentEl.className = 'comment';
        commentEl.innerHTML = `<div class="comment-avatar" style="background-image:url(${comment.authorAvatar || ''})" data-uid="${comment.author}"></div> <div class="comment-content"> <div> <span class="comment-author" data-uid="${comment.author}">${comment.authorName}</span> <span class="comment-time">${new Date(comment.createdAt?.seconds * 1000).toLocaleString()}</span> </div> <div class="comment-text">${comment.text}</div> </div>`;
        container.appendChild(commentEl);
    });
}

async function addComment(postId, text) {
    if (!currentUser || !text.trim()) return;
    const userSnap = await getDoc(doc(db, "users", currentUser.uid));
    const user = userSnap.data();
    const commentRef = collection(db, `posts/${postId}/comments`);
    await addDoc(commentRef, {
        author: currentUser.uid,
        authorName: user.nickname,
        authorAvatar: user.avatar || '',
        text: text.trim(),
        createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, "posts", postId), {
        commentsCount: increment(1),
        popularity: increment(40)
    });
}

async function incrementPostView(postId) {
    if (!currentUser) return;
    if (viewedPosts.has(postId)) return;
    viewedPosts.add(postId);
    try {
        await updateDoc(doc(db, "posts", postId), {
            views: increment(1),
            popularity: increment(5)
        });
    } catch (e) {
        console.warn("Не вдалося оновити перегляди:", e);
    }
}

// ================= Рендеринг постів =================
function renderPosts(docs, container = null) {
    const feed = container || document.getElementById('feed');
    if (!feed) return;
    docs.forEach(docSnap => {
        const post = { id: docSnap.id, ...docSnap.data() };
        const liked = post.likes?.includes(currentUser?.uid) || false;
        const saved = post.saves?.includes(currentUser?.uid) || false;
        const postTime = post.createdAt ? new Date(post.createdAt.seconds * 1000).toLocaleString() : '';
        const isAuthor = currentUser && post.author === currentUser.uid;
        const isFollowing = currentUserFollowing.includes(post.author);
        const postEl = document.createElement('div');
        postEl.className = 'post';
        postEl.dataset.postId = post.id;
        postEl.tabIndex = 0;

        let actionsHtml = '';
        if (isAuthor) {
            actionsHtml = `
                <div class="post-actions">
                    <button class="edit-post-btn" title="Редагувати пост" tabindex="0">⋯</button>
                </div>
            `;
        }

        let contentHtml = post.text || '';
        const hashtagRegex = /#(\w+)/g;
        contentHtml = contentHtml.replace(hashtagRegex, '<span class="hashtag" data-tag="$1">#$1</span>');

        const followButtonHtml = !isAuthor && currentUser ? 
            `<button class="follow-btn-post ${isFollowing ? 'following' : ''}" data-uid="${post.author}" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>` : '';

        postEl.innerHTML = `
            ${actionsHtml}
            <div class="post-header">
                <div class="avatar" style="background-image:url(${post.authorAvatar || ''})" data-uid="${post.author}" tabindex="0"></div>
                <div class="post-author-info">
                    <div>
                        <span class="post-author" data-uid="${post.author}" tabindex="0">${post.authorName || 'Невідомо'}</span>
                        <span class="post-meta">${post.authorUserId || ''}</span>
                        ${followButtonHtml}
                    </div>
                    <div class="post-time">${postTime}</div>
                </div>
            </div>
            <div class="post-content">${contentHtml}</div>
            ${post.mediaUrl ? (post.mediaType==='image' ? `<img src="${post.mediaUrl}" class="post-media" loading="lazy" tabindex="0">` : `<video src="${post.mediaUrl}" controls class="post-media" tabindex="0"></video>`) : ''}
            <div class="post-footer">
                <button class="like-btn ${liked ? 'liked' : ''}" data-post-id="${post.id}" tabindex="0">
                    <svg viewBox="0 0 24 24" width="20" height="20"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    <span>${post.likesCount || 0}</span>
                </button>
                <button class="comment-toggle-btn" data-post-id="${post.id}" tabindex="0">
                    <svg viewBox="0 0 24 24" width="20" height="20"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                    <span>${post.commentsCount || 0}</span>
                </button>
                <button class="save-btn ${saved ? 'saved' : ''}" data-post-id="${post.id}" tabindex="0">
                    <svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
                </button>
                <span class="view-count" title="Перегляди">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M22 12c-2.667 4.667-6 7-10 7s-7.333-2.333-10-7c2.667-4.667 6-7 10-7s7.333 2.333 10 7z"/></svg>
                    ${post.views || 0}
                </span>
            </div>
            <div class="comments-section" id="comments-${post.id}" style="display: none;">
                <div class="comments-list" id="comments-list-${post.id}"></div>
                <div class="comment-form">
                    <input type="text" id="comment-input-${post.id}" class="comment-input" placeholder="Напишіть коментар..." tabindex="0">
                    <div class="emoji-picker-container" style="position: relative;">
                        <button class="emoji-button" id="comment-emoji-${post.id}" tabindex="0">😊</button>
                        <div class="emoji-picker" id="comment-picker-${post.id}"></div>
                    </div>
                    <button class="btn btn-primary btn-icon" id="submit-comment-${post.id}" tabindex="0">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                    </button>
                </div>
            </div>
        `;
        feed.appendChild(postEl);

        incrementPostView(post.id);

        const followBtn = postEl.querySelector('.follow-btn-post');
        if (followBtn) {
            followBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetUid = followBtn.dataset.uid;
                toggleFollow(targetUid, followBtn);
            });
        }

        if (isAuthor) {
            postEl.querySelector('.edit-post-btn').onclick = () => openEditPostModal(post);
        }

        postEl.querySelectorAll('.hashtag').forEach(span => {
            span.onclick = (e) => {
                e.stopPropagation();
                const tag = span.dataset.tag;
                searchHashtag(tag);
            };
        });

        const commentInput = document.getElementById(`comment-input-${post.id}`);
        if (commentInput) {
            setupEmojiPicker(`comment-emoji-${post.id}`, `comment-picker-${post.id}`, `comment-input-${post.id}`);
        }

        const toggleBtn = postEl.querySelector('.comment-toggle-btn');
        const commentsSection = postEl.querySelector('.comments-section');
        toggleBtn.onclick = async () => {
            if (commentsSection.style.display === 'none') {
                commentsSection.style.display = 'block';
                const commentsList = document.getElementById(`comments-list-${post.id}`);
                if (commentsList) await loadComments(post.id, commentsList);
            } else {
                commentsSection.style.display = 'none';
            }
        };

        const submitBtn = document.getElementById(`submit-comment-${post.id}`);
        if (submitBtn) {
            submitBtn.onclick = async () => {
                const text = commentInput.value.trim();
                if (!text) return;
                try {
                    await addComment(post.id, text);
                    commentInput.value = '';
                    const commentsList = document.getElementById(`comments-list-${post.id}`);
                    if (commentsList) await loadComments(post.id, commentsList);
                    const countSpan = toggleBtn.querySelector('span');
                    if (countSpan) countSpan.textContent = parseInt(countSpan.textContent) + 1;
                    showToast('Коментар додано');
                } catch (error) {
                    console.error('Error adding comment:', error);
                    showToast('Помилка: ' + error.message);
                }
            };
        }

        if (!container || container.id === 'feed') {
            const postRef = doc(db, "posts", post.id);
            const unsubscribe = onSnapshot(postRef, (snap) => {
                if (snap.exists()) {
                    const data = snap.data();
                    const likeBtn = postEl.querySelector('.like-btn');
                    if (likeBtn) {
                        const liked = data.likes?.includes(currentUser?.uid) || false;
                        const countSpan = likeBtn.querySelector('span');
                        if (liked) {
                            likeBtn.classList.add('liked');
                        } else {
                            likeBtn.classList.remove('liked');
                        }
                        if (countSpan) countSpan.textContent = data.likesCount || 0;
                    }
                    const saveBtn = postEl.querySelector('.save-btn');
                    if (saveBtn) {
                        const saved = data.saves?.includes(currentUser?.uid) || false;
                        if (saved) {
                            saveBtn.classList.add('saved');
                        } else {
                            saveBtn.classList.remove('saved');
                        }
                    }
                } else {
                    if (postEl.parentNode) postEl.parentNode.removeChild(postEl);
                    const unsub = postListeners.get(post.id);
                    if (unsub) {
                        unsub();
                        postListeners.delete(post.id);
                    }
                }
            }, (error) => {
                console.error(`Error listening to post ${post.id}:`, error);
            });
            postListeners.set(post.id, unsubscribe);
        }
    });
}

async function toggleFollow(targetUid, buttonElement) {
    if (!currentUser) return;
    const wasFollowing = currentUserFollowing.includes(targetUid);
    const newFollowingState = !wasFollowing;
    if (newFollowingState) {
        currentUserFollowing.push(targetUid);
    } else {
        currentUserFollowing = currentUserFollowing.filter(id => id !== targetUid);
    }
    if (buttonElement) {
        buttonElement.textContent = newFollowingState ? 'Відписатися' : 'Підписатися';
        buttonElement.classList.toggle('following', newFollowingState);
    }
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
        console.error('Follow error:', error);
        if (newFollowingState) {
            currentUserFollowing = currentUserFollowing.filter(id => id !== targetUid);
        } else {
            currentUserFollowing.push(targetUid);
        }
        if (buttonElement) {
            buttonElement.textContent = wasFollowing ? 'Відписатися' : 'Підписатися';
            buttonElement.classList.toggle('following', wasFollowing);
        }
        showToast('Помилка: ' + (error.message || 'Невідома помилка'));
    }
}

function openEditPostModal(post) {
    currentEditingPost = post;
    document.getElementById('editPostText').value = post.text || '';
    document.getElementById('editPostMedia').value = '';
    document.getElementById('editPostMediaLabel').textContent = 'Змінити медіа';
    const preview = document.getElementById('editPostMediaPreview');
    preview.classList.remove('show');
    if (post.mediaUrl) {
        if (post.mediaType === 'image') {
            preview.src = post.mediaUrl;
            preview.classList.add('show');
        }
    }
    document.getElementById('editPostModal').classList.add('active');
}

document.getElementById('closeEditPostModal').onclick = () => {
    document.getElementById('editPostModal').classList.remove('active');
    currentEditingPost = null;
};

document.getElementById('savePostEdit').onclick = async () => {
    if (!currentEditingPost || !currentUser) return;
    const newText = document.getElementById('editPostText').value.trim();
    const file = document.getElementById('editPostMedia').files[0];
    try {
        const postRef = doc(db, "posts", currentEditingPost.id);
        let updateData = { text: newText };
        updateData.hashtags = extractHashtags(newText);
        if (file) {
            const mediaUrl = await uploadToCloudinary(file);
            const mediaType = file.type.split('/')[0];
            updateData.mediaUrl = mediaUrl;
            updateData.mediaType = mediaType;
        }
        await updateDoc(postRef, updateData);
        showToast('Пост оновлено');
        document.getElementById('editPostModal').classList.remove('active');
    } catch (e) {
        showToast('Помилка: ' + e.message);
    }
};

document.getElementById('deletePostBtn').onclick = async () => {
    if (!currentEditingPost || !currentUser) return;
    if (!confirm('Видалити пост?')) return;
    try {
        await deleteDoc(doc(db, "posts", currentEditingPost.id));
        await updateDoc(doc(db, "users", currentUser.uid), { posts: arrayRemove(currentEditingPost.id) });
        showToast('Пост видалено');
        document.getElementById('editPostModal').classList.remove('active');
    } catch (e) {
        showToast('Помилка: ' + e.message);
    }
};

async function loadSearchUsers() {
    if (!currentUser) return;
    const val = document.getElementById('searchInput').value.trim().toLowerCase();
    const userList = document.getElementById('userList');
    if (!val) { userList.innerHTML = ''; return; }
    if (val.startsWith('#')) {
        const tag = val.substring(1);
        const q = query(collection(db, "posts"), where("hashtags", "array-contains", tag));
        const snapshot = await getDocs(q);
        userList.innerHTML = '<h3 style="margin-bottom:12px;">Пости з тегом</h3>';
        if (snapshot.empty) {
            userList.innerHTML += '<p>Немає постів з цим тегом</p>';
        } else {
            const feedDiv = document.createElement('div');
            feedDiv.className = 'feed';
            userList.appendChild(feedDiv);
            renderPosts(snapshot.docs, feedDiv);
        }
        return;
    }
    const mySnap = await getDoc(doc(db, "users", currentUser.uid));
    const myFollowing = mySnap.data().following || [];
    const q1 = query(collection(db, "users"), where("userId", ">=", val.startsWith('@') ? val : `@${val}`), where("userId", "<=", (val.startsWith('@') ? val : `@${val}`) + '\uf8ff'));
    const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));
    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const usersMap = new Map();
    snap1.forEach(d => usersMap.set(d.id, d.data()));
    snap2.forEach(d => usersMap.set(d.id, d.data()));
    userList.innerHTML = '';
    usersMap.forEach((data, uid) => {
        if (uid === currentUser.uid) return;
        const isFollowing = myFollowing.includes(uid);
        const div = document.createElement('div');
        div.className = 'chat-item';
        div.tabIndex = 0;
        div.innerHTML = `<div class="avatar small" style="background-image:url(${data.avatar || ''})" tabindex="0"></div> <div class="chat-info"> <div class="chat-name">${data.nickname}</div> <div class="chat-last">${data.userId}</div> </div> <button class="btn follow-btn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>`;
        const followBtn = div.querySelector('.follow-btn');
        followBtn.onclick = async (e) => {
            e.stopPropagation();
            await toggleFollow(uid, followBtn);
        };
        div.onclick = () => viewProfile(uid);
        userList.appendChild(div);
    });
}

document.getElementById('searchInput').addEventListener('input', loadSearchUsers);

async function loadMyProfile() {
    if (!currentUser) return;
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    if (snap.exists()) renderProfile(snap.data(), currentUser.uid, true);
}

function viewProfile(uid) {
    currentProfileUid = uid;
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    const profileNav = document.querySelector('[data-section="profile"]');
    if (profileNav) profileNav.classList.add('active');
    sections.forEach(s => document.getElementById(s).classList.remove('active'));
    const profileSection = document.getElementById('profile');
    if (profileSection) profileSection.classList.add('active');
    document.getElementById('pageTitle').textContent = 'Профіль';
    if (uid === currentUser?.uid) {
        loadMyProfile();
    } else {
        loadUserProfile(uid);
    }
}

async function loadUserProfile(uid) {
    if (!currentUser) return;
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) renderProfile(snap.data(), uid, uid === currentUser.uid);
}

function renderProfile(data, uid, isOwn) {
    const header = document.getElementById('profileHeader');
    if (!header) return;
    if (!isOwn && currentUser && data.blockedUsers?.includes(currentUser.uid)) {
        header.innerHTML = `<div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div> <div> <h2>${data.nickname}</h2> <p class="text-danger">Цей користувач вас заблокував</p> </div>`;
        return;
    }
    const isFollowing = !isOwn && currentUser ? (data.followers?.includes(currentUser.uid) || false) : false;
    header.innerHTML = `<div class="avatar large" style="background-image:url(${data.avatar || ''})" data-uid="${uid}" tabindex="0"></div> <div style="flex:1"> <h2>${data.nickname}</h2> <div class="user-id">${data.userId}</div> <p>${data.bio || ''}</p> <div class="profile-stats"> <span id="followersCount" data-uid="${uid}">${data.followers?.length || 0} підписників</span> <span id="followingCount" data-uid="${uid}">${data.following?.length || 0} підписок</span> <span>${data.posts?.length || 0} постів</span> </div> ${!isOwn && currentUser ?
        `<div style="display:flex; gap:10px; margin-top:10px; align-items:center;">
            <button class="btn" id="profileFollowBtn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
            <button class="btn" id="profileMessageBtn" tabindex="0">Написати</button>
        </div>` : ''} ${isOwn ? '<button class="btn" id="editProfileBtn" tabindex="0">Редагувати</button>' : ''} </div> ${!isOwn && currentUser ?
        `<div class="profile-menu">
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
        </div>` : ''}`;

    const followersCount = document.getElementById('followersCount');
    if (followersCount) {
        followersCount.style.cursor = 'pointer';
        followersCount.onclick = () => openFollowersList(uid);
    }
    const followingCount = document.getElementById('followingCount');
    if (followingCount) {
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
                document.getElementById('editAvatar').value = '';
                document.getElementById('editAvatarLabel').textContent = 'Обрати аватар';
                document.getElementById('editAvatarPreview').classList.remove('show');
                document.getElementById('editProfileModal').classList.add('active');
            };
        }
    }
    const tabs = document.getElementById('profileTabs');
    if (tabs) {
        tabs.innerHTML = `<div class="profile-tab active" data-tab="posts" tabindex="0">Пости</div> <div class="profile-tab" data-tab="likes" tabindex="0">Лайки</div> <div class="profile-tab" data-tab="media" tabindex="0">Медіа</div> <div class="profile-tab" data-tab="saved" tabindex="0">Збережене</div>`;
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

async function openFollowersList(uid) {
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
            div.innerHTML = `<div class="avatar small" style="background-image:url(${user.avatar || ''})" data-uid="${user.id}" tabindex="0"></div> <div class="chat-info"> <div class="chat-name">${user.nickname}</div> <div class="chat-last">${user.userId}</div> </div>`;
            div.onclick = () => {
                viewProfile(user.id);
                modal.classList.remove('active');
            };
            list.appendChild(div);
        });
    }
}

async function openFollowingList(uid) {
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
            div.innerHTML = `<div class="avatar small" style="background-image:url(${user.avatar || ''})" data-uid="${user.id}" tabindex="0"></div> <div class="chat-info"> <div class="chat-name">${user.nickname}</div> <div class="chat-last">${user.userId}</div> </div>`;
            div.onclick = () => {
                viewProfile(user.id);
                modal.classList.remove('active');
            };
            list.appendChild(div);
        });
    }
}

document.getElementById('closeFollowersModal').onclick = () => {
    document.getElementById('followersModal').classList.remove('active');
};
document.getElementById('closeFollowingModal').onclick = () => {
    document.getElementById('followingModal').classList.remove('active');
};

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
        const q = query(collection(db, "posts"), where("author", "==", uid), where("mediaUrl", "!=", ""));
        const snap = await getDocs(q);
        snap.forEach(d => posts.push({ id: d.id, ...d.data() }));
    } else if (tab === 'saved') {
        const savedIds = userData.savedPosts || [];
        for (const id of savedIds.slice(0, 20)) {
            const postSnap = await getDoc(doc(db, "posts", id));
            if (postSnap.exists()) posts.push({ id, ...postSnap.data() });
        }
    }
    posts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    posts.forEach(post => {
        const div = document.createElement('div');
        div.className = 'post';
        div.tabIndex = 0;
        div.innerHTML = `<div class="post-content">${post.text || ''}</div>`;
        feed.appendChild(div);
    });
}

document.getElementById('closeModal').onclick = () => {
    document.getElementById('editProfileModal').classList.remove('active');
};

document.getElementById('saveProfileEdit').onclick = async () => {
    if (!currentUser) return;
    const nickname = document.getElementById('editNickname').value.trim();
    const bio = document.getElementById('editBio').value.trim();
    const avatarFile = document.getElementById('editAvatar').files[0];
    if (!nickname) return alert('Псевдонім обов’язковий');
    const newUserId = `@${nickname.toLowerCase()}`;
    const q = query(collection(db, "users"), where("userId", "==", newUserId));
    const snap = await getDocs(q);
    if (!snap.empty && snap.docs[0].id !== currentUser.uid) return alert('Цей ID вже зайнятий');
    try {
        let avatarUrl;
        if (avatarFile) {
            avatarUrl = await uploadToCloudinary(avatarFile);
        }
        const updateData = { 
            nickname, 
            userId: newUserId, 
            nickname_lower: nickname.toLowerCase(), 
            bio 
        };
        if (avatarUrl) updateData.avatar = avatarUrl;

        await updateDoc(doc(db, "users", currentUser.uid), updateData);
        loadMyProfile();
        document.getElementById('editProfileModal').classList.remove('active');
        showToast('Профіль оновлено');

    } catch (e) {
        showToast('Помилка: ' + e.message);
    }
};

// ================= Інші обробники =================
document.getElementById('toggleTheme').onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

document.getElementById('privacyPolicyBtn').onclick = () => {
    document.getElementById('privacyPolicyModal').classList.add('active');
};
document.getElementById('closePrivacyModal').onclick = () => {
    document.getElementById('privacyPolicyModal').classList.remove('active');
};

document.getElementById('logoutBtn').onclick = () => {
    cleanupListeners();
    signOut(auth);
};

const sentinel = document.getElementById('feedSentinel');
if (sentinel) {
    const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) loadMorePosts();
    }, { threshold: 0.5 });
    observer.observe(sentinel);
}

// ================= ГЛОБАЛЬНИЙ ОБРОБНИК КЛІКІВ =================
document.addEventListener('click', async (e) => {
    if (!currentUser) return;
    const target = e.target.closest('button');
    if (!target) return;
    if (target.classList.contains('like-btn')) {
        const postId = target.dataset.postId;
        await toggleLike(postId);
    }
    if (target.classList.contains('save-btn')) {
        const postId = target.dataset.postId;
        const saved = target.classList.contains('saved');
        try {
            const userRef = doc(db, "users", currentUser.uid);
            const postRef = doc(db, "posts", postId);
            if (saved) {
                await updateDoc(userRef, { savedPosts: arrayRemove(postId) });
                await updateDoc(postRef, { saves: arrayRemove(currentUser.uid) });
            } else {
                await updateDoc(userRef, { savedPosts: arrayUnion(postId) });
                await updateDoc(postRef, { saves: arrayUnion(currentUser.uid) });
            }
        } catch (error) {
            console.error("Помилка збереження:", error);
            showToast("Не вдалося зберегти пост.");
        }
    }
});

document.addEventListener('click', (e) => {
    const uidElement = e.target.closest('[data-uid]');
    if (uidElement) {
        const uid = uidElement.dataset.uid;
        viewProfile(uid);
    }
});

// ================= НОВІ ОБРОБНИКИ ДЛЯ ФІЛЬТРІВ =================
document.getElementById('filterBtn').onclick = async () => {
    await loadFilterHashtags();
    document.getElementById('filterModal').classList.add('active');
};
document.getElementById('closeFilterModal').onclick = () => {
    document.getElementById('filterModal').classList.remove('active');
};
document.getElementById('clearFilterBtn').onclick = clearFilter;

// ================= Ініціалізація =================
onAuthStateChanged(auth, (user) => {
    cleanupListeners();
    if (user) {
        currentUser = user;
        currentProfileUid = user.uid;
        const authBox = document.getElementById('authBox');
        if (authBox) authBox.style.display = 'none';
        const newPostBox = document.getElementById('newPostBox');
        if (newPostBox) newPostBox.style.display = 'block';
        lastOnlineInterval = setInterval(() => {
            updateDoc(doc(db, "users", currentUser.uid), { lastOnline: serverTimestamp() }).catch(console.error);
        }, 30000);

        const userRef = doc(db, "users", currentUser.uid);
        unsubscribeFollowing = onSnapshot(userRef, (docSnap) => {
            if (docSnap.exists()) {
                currentUserFollowing = docSnap.data().following || [];
                document.querySelectorAll('.follow-btn-post').forEach(btn => {
                    const targetUid = btn.dataset.uid;
                    if (targetUid) {
                        const isFollowing = currentUserFollowing.includes(targetUid);
                        btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
                        btn.classList.toggle('following', isFollowing);
                    }
                });
            }
        }, (error) => {
            console.error('Error in following snapshot:', error);
        });

        resetPagination();
        loadMyProfile();

        const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
        unsubscribeChatList = onSnapshot(q, async (snapshot) => {
            let totalUnread = 0;
            for (const docSnap of snapshot.docs) {
                const chat = docSnap.data();
                const otherUid = chat.participants.find(uid => uid !== currentUser.uid);
                if (otherUid && await isBlocked(currentUser.uid, otherUid)) continue;
                if (chat.unread && chat.unread[currentUser.uid]) {
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

        setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
        setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');

        setupFileInput('postMedia', 'postMediaLabel', 'postMediaPreview');
        setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
        setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostMediaPreview');

    } else {
        currentUser = null;
        currentUserFollowing = [];
        const authBox = document.getElementById('authBox');
        if (authBox) authBox.style.display = 'block';
        const newPostBox = document.getElementById('newPostBox');
        if (newPostBox) newPostBox.style.display = 'none';
        unreadCount = 0;
        updateUnreadBadge();
    }
});

// Навігація по вкладках налаштувань
document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.settings-pane').forEach(pane => pane.classList.remove('active'));
        document.getElementById(`settings${tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1)}`).classList.add('active');
    });
});

// Закриття модалки муту
document.getElementById('closeMuteModal')?.addEventListener('click', () => {
    document.getElementById('muteModal').classList.remove('active');
});
