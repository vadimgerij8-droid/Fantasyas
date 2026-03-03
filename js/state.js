// Глобальний стан додатку
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
      language: 'uk', darkMode: false, reduceMotion: false,
      highContrast: false, autoplayVideos: true, soundEffects: true
    }
  },
  likePromiseMap: new Map(),
  savePromiseMap: new Map()
};

// Функції для роботи зі станом
export const updateUnreadBadge = () => {
  const badge = document.getElementById('unreadBadge');
  if (!badge) return;
  if (state.unreadCount > 0) {
    badge.textContent = state.unreadCount > 99 ? '99+' : state.unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
};

export const clearMainFeedListeners = () => {
  state.postListeners.forEach(unsubscribe => unsubscribe());
  state.postListeners.clear();
};

export const cleanupListeners = () => {
  if (state.unsubscribeFeed) { state.unsubscribeFeed(); state.unsubscribeFeed = null; }
  if (state.unsubscribeChatList) { state.unsubscribeChatList(); state.unsubscribeChatList = null; }
  if (state.unsubscribeMessages) { state.unsubscribeMessages(); state.unsubscribeMessages = null; }
  if (state.unsubscribeTyping) { state.unsubscribeTyping(); state.unsubscribeTyping = null; }
  if (state.unsubscribeChatPresence) { state.unsubscribeChatPresence(); state.unsubscribeChatPresence = null; }
  if (state.unsubscribeFollowing) { state.unsubscribeFollowing(); state.unsubscribeFollowing = null; }
  if (state.lastOnlineInterval) { clearInterval(state.lastOnlineInterval); state.lastOnlineInterval = null; }
  clearMainFeedListeners();
};
