// ================= Глобальні змінні (приватні) =================
let _currentUser = null;
let _currentUserData = null;
let _currentUserFollowing = [];
let _currentChatPartner = null;
let _currentChatPartnerName = '';
let _currentChatPartnerAvatar = '';
let _currentChatPartnerUserId = '';
let _currentChatId = null;
let _currentProfileUid = null;
let _currentEditingPost = null;
let _replyContext = null; // { messageId, text, senderName }
let _unreadCount = 0;
let _currentFeedType = 'new';
let _lastVisible = null;
let _loading = false;
let _hasMore = true;
let _currentFilterHashtag = null;
let _navigationHistory = []; // масив ідентифікаторів попередніх секцій
let _previousSection = null;

// ================= Геттери =================
export const getCurrentUser = () => _currentUser;
export const getCurrentUserData = () => _currentUserData;
export const getCurrentUserFollowing = () => _currentUserFollowing;
export const getCurrentChatPartner = () => _currentChatPartner;
export const getCurrentChatPartnerName = () => _currentChatPartnerName;
export const getCurrentChatPartnerAvatar = () => _currentChatPartnerAvatar;
export const getCurrentChatPartnerUserId = () => _currentChatPartnerUserId;
export const getCurrentChatId = () => _currentChatId;
export const getCurrentProfileUid = () => _currentProfileUid;
export const getCurrentEditingPost = () => _currentEditingPost;
export const getReplyContext = () => _replyContext;
export const getUnreadCount = () => _unreadCount;
export const getCurrentFeedType = () => _currentFeedType;
export const getLastVisible = () => _lastVisible;
export const getLoading = () => _loading;
export const getHasMore = () => _hasMore;
export const getCurrentFilterHashtag = () => _currentFilterHashtag;
export const getNavigationHistory = () => _navigationHistory;
export const getPreviousSection = () => _previousSection;

// ================= Сеттери =================
export const setCurrentUser = (user) => { _currentUser = user; };
export const setCurrentUserData = (data) => { _currentUserData = data; };
export const setCurrentUserFollowing = (following) => { _currentUserFollowing = following; };
export const setCurrentChatPartner = (partner) => { _currentChatPartner = partner; };
export const setCurrentChatPartnerName = (name) => { _currentChatPartnerName = name; };
export const setCurrentChatPartnerAvatar = (avatar) => { _currentChatPartnerAvatar = avatar; };
export const setCurrentChatPartnerUserId = (userId) => { _currentChatPartnerUserId = userId; };
export const setCurrentChatId = (chatId) => { _currentChatId = chatId; };
export const setCurrentProfileUid = (uid) => { _currentProfileUid = uid; };
export const setCurrentEditingPost = (post) => { _currentEditingPost = post; };
export const setReplyContext = (context) => { _replyContext = context; };
export const setUnreadCount = (count) => { _unreadCount = count; };
export const setCurrentFeedType = (type) => { _currentFeedType = type; };
export const setLastVisible = (visible) => { _lastVisible = visible; };
export const setLoading = (loading) => { _loading = loading; };
export const setHasMore = (hasMore) => { _hasMore = hasMore; };
export const setCurrentFilterHashtag = (tag) => { _currentFilterHashtag = tag; };
export const setNavigationHistory = (history) => { _navigationHistory = history; };
export const setPreviousSection = (section) => { _previousSection = section; };
