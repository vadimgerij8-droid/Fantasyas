// ================= Глобальний стан додатку =================
export const state = {
  currentUser: null,
  currentUserData: null,
  currentUserFollowing: [],
  currentChatPartner: null,
  currentChatPartnerName: '',
  currentChatPartnerAvatar: '',
  currentChatPartnerUserId: '',
  currentChatId: null,
  currentProfileUid: null,
  currentEditingPost: null,
  replyContext: null, // { messageId, text, senderName }

  unsubscribeFeed: null,
  unsubscribeChatList: null,
  unsubscribeMessages: null,
  unsubscribeTyping: null,
  unsubscribeChatPresence: null,
  unsubscribeFollowing: null,
  lastOnlineInterval: null,

  unreadCount: 0,
  currentFeedType: 'new',
  lastVisible: null,
  loading: false,
  hasMore: true,

  viewedPosts: new Set(),
  currentFilterHashtag: null,
  postListeners: new Map(),

  navigationHistory: [], // масив ідентифікаторів попередніх секцій
  previousSection: null,

  likePromiseMap: new Map(),
  savePromiseMap: new Map(),

  userSettings: {
    notifications: {
      push: true, email: true, sms: false, privateChats: true,
      likes: true, comments: true, newFollowers: true, mentions: true,
      directMessages: true, storyReplies: true
    },
    privacy: {
      privateAccount: false, activityStatus: true, storySharing: true,
      allowTags: 'everyone', allowMentions: 'everyone', blockedAccounts: [],
      whoCanMessage: 'everyone', whoCanSeeOnline: 'everyone', whoCanSeeFollowers: 'everyone'
    },
    security: { twoFactor: false, loginAlerts: true, savedLogins: [] },
    preferences: {
      language: 'uk', darkMode: false, reduceMotion: false, highContrast: false,
      autoplayVideos: true, soundEffects: true
    }
  }
};

// ================= Сетери для оновлення стану =================
export function setCurrentUser(user) { state.currentUser = user; }
export function setCurrentUserData(data) {
  state.currentUserData = data;
  state.currentUserFollowing = data?.following || [];
}
export function setCurrentChat(chatId, partnerUid, name, userId, avatar) {
  state.currentChatId = chatId;
  state.currentChatPartner = partnerUid;
  state.currentChatPartnerName = name;
  state.currentChatPartnerUserId = userId;
  state.currentChatPartnerAvatar = avatar;
}
export function clearChatState() {
  state.currentChatId = null;
  state.currentChatPartner = null;
  state.currentChatPartnerName = '';
  state.currentChatPartnerUserId = '';
  state.currentChatPartnerAvatar = '';
  state.replyContext = null;
}
export function setReplyContext(messageId, text, senderName) {
  state.replyContext = { messageId, text, senderName };
}
export function clearReplyContext() { state.replyContext = null; }
export function setCurrentFeedType(type) { state.currentFeedType = type; }
export function setFilterHashtag(tag) { state.currentFilterHashtag = tag; }
export function setLoading(value) { state.loading = value; }
export function setHasMore(value) { state.hasMore = value; }
export function setLastVisible(value) { state.lastVisible = value; }
export function addViewedPost(postId) { state.viewedPosts.add(postId); }
export function addPostListener(postId, unsubscribe) { state.postListeners.set(postId, unsubscribe); }
export function removePostListener(postId) {
  const unsub = state.postListeners.get(postId);
  if (unsub) { unsub(); state.postListeners.delete(postId); }
}
export function updateUnreadCount(delta) { state.unreadCount = Math.max(0, state.unreadCount + delta); }

// Сетери для слухачів
export function setUnsubscribeFeed(fn) { state.unsubscribeFeed = fn; }
export function setUnsubscribeChatList(fn) { state.unsubscribeChatList = fn; }
export function setUnsubscribeMessages(fn) { state.unsubscribeMessages = fn; }
export function setUnsubscribeTyping(fn) { state.unsubscribeTyping = fn; }
export function setUnsubscribeChatPresence(fn) { state.unsubscribeChatPresence = fn; }
export function setUnsubscribeFollowing(fn) { state.unsubscribeFollowing = fn; }
export function setLastOnlineInterval(interval) { state.lastOnlineInterval = interval; }

// Очищення всіх слухачів
export function cleanupAllListeners() {
  if (state.unsubscribeFeed) { state.unsubscribeFeed(); state.unsubscribeFeed = null; }
  if (state.unsubscribeChatList) { state.unsubscribeChatList(); state.unsubscribeChatList = null; }
  if (state.unsubscribeMessages) { state.unsubscribeMessages(); state.unsubscribeMessages = null; }
  if (state.unsubscribeTyping) { state.unsubscribeTyping(); state.unsubscribeTyping = null; }
  if (state.unsubscribeChatPresence) { state.unsubscribeChatPresence(); state.unsubscribeChatPresence = null; }
  if (state.unsubscribeFollowing) { state.unsubscribeFollowing(); state.unsubscribeFollowing = null; }
  if (state.lastOnlineInterval) { clearInterval(state.lastOnlineInterval); state.lastOnlineInterval = null; }
  state.postListeners.forEach(unsub => unsub());
  state.postListeners.clear();
}
