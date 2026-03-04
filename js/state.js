export let currentUser = null;
export let currentUserData = null;
export let currentUserFollowing = [];
export let currentChatPartner = null;
export let currentChatPartnerName = '';
export let currentChatPartnerAvatar = '';
export let currentChatPartnerUserId = '';
export let currentChatId = null;
export let replyContext = null;

export let unsubscribeMessages = null;
export let unsubscribeTyping = null;
export let unsubscribeChatPresence = null;
export let unsubscribeFollowing = null;
export let lastOnlineInterval = null;

export let unreadCount = 0;
export let currentFeedType = 'new';
export let lastVisible = null;
export let loading = false;
export let hasMore = true;

export const viewedPosts = new Set();
export let currentFilterHashtag = null;
export const postListeners = new Map();

export const navigationHistory = [];
export let previousSection = null;

export const likePromiseMap = new Map();
export const savePromiseMap = new Map();

export const userSettings = {
  notifications: { push: true, email: true, sms: false, privateChats: true, likes: true, comments: true, newFollowers: true, mentions: true, directMessages: true, storyReplies: true },
  privacy: { privateAccount: false, activityStatus: true, storySharing: true, allowTags: 'everyone', allowMentions: 'everyone', blockedAccounts: [], whoCanMessage: 'everyone', whoCanSeeOnline: 'everyone', whoCanSeeFollowers: 'everyone' },
  security: { twoFactor: false, loginAlerts: true, savedLogins: [] },
  preferences: { language: 'uk', darkMode: false, reduceMotion: false, highContrast: false, autoplayVideos: true, soundEffects: true }
};

export function setCurrentUser(user) { currentUser = user; }
export function setCurrentUserData(data) { currentUserData = data; setCurrentUserFollowing(data?.following || []); }
export function setCurrentUserFollowing(following) { currentUserFollowing = following; }
export function setCurrentChat(chatId, partnerUid, name, userId, avatar) {
  currentChatId = chatId;
  currentChatPartner = partnerUid;
  currentChatPartnerName = name;
  currentChatPartnerUserId = userId;
  currentChatPartnerAvatar = avatar;
}
export function clearChatState() {
  currentChatId = null; currentChatPartner = null; currentChatPartnerName = ''; currentChatPartnerUserId = ''; currentChatPartnerAvatar = ''; replyContext = null;
}
export function setReplyContext(messageId, text, senderName) { replyContext = { messageId, text, senderName }; }
export function clearReplyContext() { replyContext = null; }
export function setCurrentFeedType(type) { currentFeedType = type; }
export function setFilterHashtag(tag) { currentFilterHashtag = tag; }
export function resetPaginationState() { lastVisible = null; hasMore = true; loading = false; }
export function setLastVisible(doc) { lastVisible = doc; }
export function setLoading(state) { loading = state; }
export function setHasMore(state) { hasMore = state; }
export function updateUnreadCount(delta) { unreadCount = Math.max(0, unreadCount + delta); }

export function setUnsubscribeMessages(fn) { unsubscribeMessages = fn; }
export function setUnsubscribeTyping(fn) { unsubscribeTyping = fn; }
export function setUnsubscribeChatPresence(fn) { unsubscribeChatPresence = fn; }
export function setUnsubscribeFollowing(fn) { unsubscribeFollowing = fn; }
export function setLastOnlineInterval(interval) { lastOnlineInterval = interval; }

export function cleanupAllListeners() {
  if (unsubscribeMessages) unsubscribeMessages();
  if (unsubscribeTyping) unsubscribeTyping();
  if (unsubscribeChatPresence) unsubscribeChatPresence();
  if (unsubscribeFollowing) unsubscribeFollowing();
  if (lastOnlineInterval) clearInterval(lastOnlineInterval);
  postListeners.forEach(unsub => unsub());
  postListeners.clear();
}
