// ================= Головний файл, точка входу =================
import { auth, db } from './config.js';
import { 
  state,
  setCurrentUser, setCurrentUserData, setUnsubscribeFollowing,
  cleanupAllListeners, updateUnreadCount, resetPaginationState
} from './state.js';
import { showToast, startHeartbeat, stopHeartbeat, updateUnreadBadge, setupEmojiPicker, setupFileInput, debounce } from './utils.js';
import { register, login, googleLogin, appleLogin, resetPassword, logout } from './auth.js';
import { createPost, loadMorePosts, loadHashtags, loadFilterHashtags, clearFilter, applyFilter } from './posts.js';
import { viewProfile, saveProfileEdit, toggleFollow, openFollowersList, openFollowingList } from './profile.js';
import { loadChatList, openChat, closeChat, sendMessage, handleTyping, handleMessageContextAction, searchUsersForChat } from './chat.js';
import { loadSettings, setupSettingsListeners, applySettings } from './settings.js';
import { 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { 
  doc, onSnapshot, collection, query, where, serverTimestamp, updateDoc, getDoc, getDocs
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ================= Глобальні змінні =================
let unsubscribeChatList = null;

// ================= Допоміжні функції =================
/**
 * Блокування користувача
 */
async function blockUser(uid) {
  try {
    if (!state.currentUser) {
      showToast('Ви не авторизовані');
      return;
    }
    
    const userRef = doc(db, "users", state.currentUser.uid);
    const userDoc = await getDoc(userRef);
    const blockedUsers = userDoc.data().blockedUsers || [];
    
    if (!blockedUsers.includes(uid)) {
      blockedUsers.push(uid);
      await updateDoc(userRef, { blockedUsers });
      showToast('Користувача заблоковано');
    } else {
      showToast('Користувач уже у списку блокованих');
    }
  } catch (error) {
    console.error('Error blocking user:', error);
    showToast('Помилка при блокуванні користувача');
  }
}

/**
 * Очищення історії повідомлень чату
 */
async function clearChatHistory() {
  try {
    if (!state.currentChatId) {
      showToast('Чат не відкритий');
      return;
    }
    
    const chatRef = doc(db, "chats", state.currentChatId);
    await updateDoc(chatRef, { messages: [] });
    showToast('Історія повідомлень очищена');
  } catch (error) {
    console.error('Error clearing chat history:', error);
    showToast('Помилка при очищенні історії чату');
  }
}

// ================= Ініціалізація при завантаженні DOM =================
document.addEventListener('DOMContentLoaded', () => {
  // Навігація по розділах
  const sections = ['home','search','hashtags','profile','chats','settings'];
  const navItems = document.querySelectorAll('.bottom-nav .nav-item');

  navItems.forEach((item) => {
    item.addEventListener('click', async () => {
      try {
        const section = item.dataset.section;
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        sections.forEach(s => document.getElementById(s)?.classList.remove('active'));
        const sectionEl = document.getElementById(section);
        if (sectionEl) sectionEl.classList.add('active');
        const span = item.querySelector('span');
        document.getElementById('pageTitle').textContent = span ? span.textContent : item.textContent.trim();

        // Запам'ятовуємо попередню секцію для кнопки "Назад"
        if (state.previousSection !== section) {
          state.navigationHistory.push(state.previousSection);
          state.previousSection = section;
        }

        cleanupAllListeners();

        const chatWindow = document.getElementById('chatWindowContainer');
        if (chatWindow) chatWindow.style.display = 'none';
        const chatSidebar = document.getElementById('chatListSidebar');
        if (chatSidebar) chatSidebar.classList.remove('hide');
        document.querySelector('.bottom-nav')?.classList.remove('hide-chat-mode');
        document.querySelector('.back-btn')?.classList.remove('visible');

        // Приховуємо блок створення поста при переході в будь-який розділ, крім профілю
        const newPostBox = document.getElementById('newPostBox');
        if (section !== 'profile' && newPostBox) {
          newPostBox.style.display = 'none';
        }

        if (section === 'home' && state.currentUser) {
          resetPagination();
        }
        if (section === 'search' && state.currentUser) {
          await loadSearchUsers();
        }
        if (section === 'hashtags' && state.currentUser) {
          await loadHashtags();
        }
        if (section === 'chats' && state.currentUser) {
          document.getElementById('chatWindowContainer').style.display = 'none';
          document.getElementById('chatListSidebar')?.classList.remove('hide');
          document.getElementById('chatSearchInput').value = '';
          document.getElementById('chatSearchResults').style.display = 'none';
          await loadChatList();
        }
        if (section === 'profile' && state.currentUser) {
          await viewProfile(state.currentUser.uid);
        }
        if (section === 'settings') {
          loadSettings();
        }
      } catch (error) {
        console.error('Navigation error:', error);
        showToast('Помилка при переході між розділами');
      }
    });
  });

  // Кнопка "Назад"
  document.querySelector('.back-btn')?.addEventListener('click', () => {
    try {
      if (state.navigationHistory.length > 0) {
        const prev = state.navigationHistory.pop();
        state.previousSection = prev;
        const navItem = document.querySelector(`.nav-item[data-section="${prev}"]`);
        if (navItem) navItem.click();
      }
    } catch (error) {
      console.error('Back button error:', error);
    }
  });

  // Перемикання вкладок у налаштуваннях
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      try {
        const tab = item.dataset.tab;
        document.querySelectorAll('.settings-nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelectorAll('.settings-tab-content').forEach(content => content.classList.remove('active'));
        item.classList.add('active');
        const tabContent = document.getElementById(`settings-${tab}`);
        if (tabContent) tabContent.classList.add('active');
      } catch (error) {
        console.error('Settings tab error:', error);
      }
    });
  });

  // Обробники авторизації
  const toRegisterBtn = document.getElementById('toRegister');
  if (toRegisterBtn) {
    toRegisterBtn.onclick = () => {
      document.getElementById('loginForm').style.display = 'none';
      document.getElementById('registerForm').style.display = 'block';
    };
  }

  const toLoginBtn = document.getElementById('toLogin');
  if (toLoginBtn) {
    toLoginBtn.onclick = () => {
      document.getElementById('registerForm').style.display = 'none';
      document.getElementById('loginForm').style.display = 'block';
    };
  }

  const registerBtn = document.getElementById('registerBtn');
  if (registerBtn) {
    registerBtn.onclick = async () => {
      try {
        const nickname = document.getElementById('registerNickname')?.value.trim() || '';
        const password = document.getElementById('registerPassword')?.value.trim() || '';
        if (nickname && password) {
          await register(nickname, password);
        } else {
          showToast('Введіть псевдонім та пароль');
        }
      } catch (error) {
        console.error('Register error:', error);
      }
    };
  }

  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      try {
        const nickname = document.getElementById('loginNickname')?.value.trim() || '';
        const password = document.getElementById('loginPassword')?.value.trim() || '';
        if (nickname && password) {
          await login(nickname, password);
        } else {
          showToast('Введіть псевдонім та пароль');
        }
      } catch (error) {
        console.error('Login error:', error);
      }
    };
  }

  const googleLoginBtn = document.getElementById('googleLoginBtn');
  if (googleLoginBtn) googleLoginBtn.onclick = googleLogin;

  const appleLoginBtn = document.getElementById('appleLoginBtn');
  if (appleLoginBtn) appleLoginBtn.onclick = appleLogin;

  const forgotPasswordBtn = document.getElementById('forgotPassword');
  if (forgotPasswordBtn) {
    forgotPasswordBtn.onclick = async (e) => {
      e.preventDefault();
      try {
        const nickname = prompt('Введіть ваш псевдонім (без @)');
        if (nickname) await resetPassword(nickname);
      } catch (error) {
        console.error('Reset password error:', error);
      }
    };
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      cleanupAllListeners();
      logout();
    };
  }

  // Створення поста
  const addPostBtn = document.getElementById('addPost');
  if (addPostBtn) {
    addPostBtn.onclick = async () => {
      try {
        const text = document.getElementById('postText')?.value.trim() || '';
        const fileInput = document.getElementById('postMedia');
        const files = fileInput?.files ? Array.from(fileInput.files) : [];
        await createPost(text, files);
      } catch (error) {
        console.error('Create post error:', error);
        showToast('Помилка при створенні поста');
      }
    };
  }

  // Редагування профілю
  const saveProfileEditBtn = document.getElementById('saveProfileEdit');
  if (saveProfileEditBtn) {
    saveProfileEditBtn.onclick = async () => {
      try {
        const nickname = document.getElementById('editNickname')?.value.trim() || '';
        const bio = document.getElementById('editBio')?.value.trim() || '';
        const note = document.getElementById('editNote')?.value.trim() || '';
        const avatarFile = document.getElementById('editAvatar')?.files[0];
        await saveProfileEdit(nickname, bio, note, avatarFile);
      } catch (error) {
        console.error('Save profile error:', error);
        showToast('Помилка при збереженні профілю');
      }
    };
  }

  const closeModalBtn = document.getElementById('closeModal');
  if (closeModalBtn) {
    closeModalBtn.onclick = () => {
      document.getElementById('editProfileModal')?.classList.remove('active');
    };
  }

  // Фільтри
  const filterBtn = document.getElementById('filterBtn');
  if (filterBtn) {
    filterBtn.onclick = async () => {
      try {
        await loadFilterHashtags();
        document.getElementById('filterModal')?.classList.add('active');
      } catch (error) {
        console.error('Filter error:', error);
      }
    };
  }

  const closeFilterModalBtn = document.getElementById('closeFilterModal');
  if (closeFilterModalBtn) {
    closeFilterModalBtn.onclick = () => {
      document.getElementById('filterModal')?.classList.remove('active');
    };
  }

  const clearFilterBtn = document.getElementById('clearFilterBtn');
  if (clearFilterBtn) {
    clearFilterBtn.onclick = clearFilter;
  }

  // Ініціалізація currentFeedType
  if (!state.currentFeedType) {
    state.currentFeedType = 'new';
  }

  // Стрічка (нова/популярна)
  const feedNewBtn = document.getElementById('feedNewBtn');
  if (feedNewBtn) {
    feedNewBtn.onclick = () => {
      if (state.currentFeedType === 'new') return;
      state.currentFeedType = 'new';
      resetPagination();
    };
  }

  const feedPopularBtn = document.getElementById('feedPopularBtn');
  if (feedPopularBtn) {
    feedPopularBtn.onclick = () => {
      if (state.currentFeedType === 'popular') return;
      state.currentFeedType = 'popular';
      resetPagination();
    };
  }

  // Пошук
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(loadSearchUsers, 300));
  }

  // Чат
  const sendMessageBtn = document.getElementById('sendMessage');
  if (sendMessageBtn) {
    sendMessageBtn.addEventListener('click', () => {
      try {
        const text = document.getElementById('chatText')?.value.trim() || '';
        const file = document.getElementById('chatAttachFile')?.files[0];
        sendMessage(text, file);
      } catch (error) {
        console.error('Send message error:', error);
      }
    });
  }

  const chatTextInput = document.getElementById('chatText');
  if (chatTextInput) {
    chatTextInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('sendMessage')?.click();
      }
    });
    chatTextInput.addEventListener('input', handleTyping);
  }

  const chatAttachBtn = document.getElementById('chatAttachBtn');
  if (chatAttachBtn) {
    chatAttachBtn.addEventListener('click', () => {
      document.getElementById('chatAttachFile')?.click();
    });
  }

  const chatAttachFile = document.getElementById('chatAttachFile');
  if (chatAttachFile) {
    chatAttachFile.addEventListener('change', function() {
      const btn = document.getElementById('chatAttachBtn');
      if (btn) btn.innerHTML = this.files && this.files[0] ? '📁' : '📎';
    });
  }

  const chatBackBtn = document.getElementById('chatBackBtn');
  if (chatBackBtn) {
    chatBackBtn.addEventListener('click', closeChat);
  }

  const chatAvatar = document.getElementById('chatAvatar');
  if (chatAvatar) {
    chatAvatar.addEventListener('click', () => {
      try {
        if (state.currentChatPartner) viewProfile(state.currentChatPartner);
      } catch (error) {
        console.error('Chat avatar error:', error);
      }
    });
  }

  const chatMenuBtn = document.getElementById('chatMenuBtn');
  if (chatMenuBtn) {
    chatMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('chatMenuDropdown');
      if (dropdown) dropdown.classList.toggle('show');
    });
  }

  document.addEventListener('click', () => {
    const dropdown = document.getElementById('chatMenuDropdown');
    if (dropdown) dropdown.classList.remove('show');
  });

  const chatMenuDropdown = document.getElementById('chatMenuDropdown');
  if (chatMenuDropdown) {
    chatMenuDropdown.addEventListener('click', async (e) => {
      try {
        const action = e.target.dataset.action;
        if (action === 'viewProfile' && state.currentChatPartner) {
          viewProfile(state.currentChatPartner);
        } else if (action === 'block' && state.currentChatPartner) {
          await blockUser(state.currentChatPartner);
        } else if (action === 'clearHistory' && state.currentChatId) {
          if (confirm('Очистити історію повідомлень?')) {
            await clearChatHistory();
          }
        }
        document.getElementById('chatMenuDropdown')?.classList.remove('show');
      } catch (error) {
        console.error('Chat menu action error:', error);
      }
    });
  }

  // Контекстне меню повідомлень
  const messageContextMenu = document.getElementById('messageContextMenu');
  if (messageContextMenu) {
    messageContextMenu.addEventListener('click', (e) => {
      try {
        const action = e.target.dataset.action;
        handleMessageContextAction(action);
      } catch (error) {
        console.error('Message context error:', error);
      }
    });
  }

  // Пошук у чатах
  let searchTimeout;
  const chatSearchInput = document.getElementById('chatSearchInput');
  if (chatSearchInput) {
    chatSearchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const val = e.target.value.trim();
      if (!val) {
        document.getElementById('chatSearchResults').style.display = 'none';
        return;
      }
      searchTimeout = setTimeout(() => {
        try {
          searchUsersForChat(val);
        } catch (error) {
          console.error('Chat search error:', error);
        }
      }, 300);
    });
  }

  // Налаштування
  setupSettingsListeners();

  // Закриття модалок
  const closeFollowersModalBtn = document.getElementById('closeFollowersModal');
  if (closeFollowersModalBtn) {
    closeFollowersModalBtn.onclick = () => {
      document.getElementById('followersModal')?.classList.remove('active');
    };
  }

  const closeFollowingModalBtn = document.getElementById('closeFollowingModal');
  if (closeFollowingModalBtn) {
    closeFollowingModalBtn.onclick = () => {
      document.getElementById('followingModal')?.classList.remove('active');
    };
  }

  const closePrivacyModalBtn = document.getElementById('closePrivacyModal');
  if (closePrivacyModalBtn) {
    closePrivacyModalBtn.onclick = () => {
      document.getElementById('privacyPolicyModal')?.classList.remove('active');
    };
  }

  const privacyPolicyBtn = document.getElementById('privacyPolicyBtn');
  if (privacyPolicyBtn) {
    privacyPolicyBtn.onclick = () => {
      document.getElementById('privacyPolicyModal')?.classList.add('active');
    };
  }

  // Очищення кешу
  const clearCacheBtn = document.getElementById('clearCacheBtn');
  if (clearCacheBtn) {
    clearCacheBtn.addEventListener('click', async () => {
      try {
        const keysToKeep = ['theme'];
        Object.keys(localStorage).forEach(key => {
          if (!keysToKeep.includes(key)) localStorage.removeItem(key);
        });
        if ('caches' in window) {
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
        showToast('Кеш очищено');
      } catch (error) {
        console.error('Clear cache error:', error);
        showToast('Помилка при очищенні кешу');
      }
    });
  }

  const clearSavedMediaBtn = document.getElementById('clearSavedMediaBtn');
  if (clearSavedMediaBtn) {
    clearSavedMediaBtn.addEventListener('click', async () => {
      try {
        if (!state.currentUser) {
          showToast('Ви не авторизовані');
          return;
        }
        if (!confirm('Видалити всі збережені медіа?')) return;
        const userRef = doc(db, "users", state.currentUser.uid);
        await updateDoc(userRef, { savedPosts: [] });
        showToast('Збережені медіа очищено');
      } catch (error) {
        console.error('Clear saved media error:', error);
        showToast('Помилка при очищенні збережених медіа');
      }
    });
  }

  // Ініціалізація емуляції файлів
  setupFileInput('editAvatar', 'editAvatarLabel', 'editAvatarPreview');
  setupFileInput('editPostMedia', 'editPostMediaLabel', 'editPostMediaPreview');
  setupEmojiPicker('postEmojiBtn', 'postEmojiPicker', 'postText');
  setupEmojiPicker('chatEmojiBtn', 'chatEmojiPicker', 'chatText');

  // Обробка медіа для поста
  const postMediaInput = document.getElementById('postMedia');
  const postMediaPreviews = document.getElementById('postMediaPreviews');
  const postMediaLabel = document.getElementById('postMediaLabel');

  if (postMediaInput) {
    postMediaInput.addEventListener('change', function() {
      try {
        postMediaPreviews.innerHTML = '';
        const files = Array.from(this.files);
        const maxFiles = 3;
        if (files.length > maxFiles) {
          showToast(`Можна вибрати не більше ${maxFiles} файлів`);
          this.value = '';
          return;
        }
        postMediaLabel.textContent = files.length ? `Вибрано ${files.length} файлів` : '+ Медіа (до 3 файлів)';
        
        files.forEach((file, index) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const previewContainer = document.createElement('div');
              previewContainer.style.position = 'relative';
              previewContainer.style.width = '80px';
              previewContainer.style.height = '80px';

              if (file.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = e.target.result;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '8px';
                img.style.border = '1px solid var(--border)';
                previewContainer.appendChild(img);
              } else if (file.type.startsWith('video/')) {
                const video = document.createElement('video');
                video.src = e.target.result;
                video.style.width = '100%';
                video.style.height = '100%';
                video.style.objectFit = 'cover';
                video.style.borderRadius = '8px';
                video.style.border = '1px solid var(--border)';
                video.muted = true;
                video.preload = 'metadata';
                video.addEventListener('loadeddata', () => {
                  video.currentTime = 0.1;
                });
                previewContainer.appendChild(video);

                const playIcon = document.createElement('span');
                playIcon.innerHTML = '▶️';
                playIcon.style.position = 'absolute';
                playIcon.style.top = '50%';
                playIcon.style.left = '50%';
                playIcon.style.transform = 'translate(-50%, -50%)';
                playIcon.style.fontSize = '24px';
                playIcon.style.opacity = '0.7';
                previewContainer.appendChild(playIcon);
              }

              const removeBtn = document.createElement('button');
              removeBtn.innerHTML = '✕';
              removeBtn.style.position = 'absolute';
              removeBtn.style.top = '-5px';
              removeBtn.style.right = '-5px';
              removeBtn.style.width = '22px';
              removeBtn.style.height = '22px';
              removeBtn.style.borderRadius = '50%';
              removeBtn.style.background = 'var(--danger)';
              removeBtn.style.color = 'white';
              removeBtn.style.border = 'none';
              removeBtn.style.cursor = 'pointer';
              removeBtn.style.fontSize = '14px';
              removeBtn.style.display = 'flex';
              removeBtn.style.alignItems = 'center';
              removeBtn.style.justifyContent = 'center';
              removeBtn.style.padding = '0';

              removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                try {
                  const dt = new DataTransfer();
                  const allPreviews = Array.from(postMediaPreviews.children);
                  const previewIndex = allPreviews.indexOf(previewContainer);
                  
                  files.forEach((f, i) => {
                    if (i !== previewIndex) {
                      dt.items.add(f);
                    }
                  });
                  
                  postMediaInput.files = dt.files;
                  postMediaInput.dispatchEvent(new Event('change', { bubbles: true }));
                } catch (error) {
                  console.error('File removal error:', error);
                  showToast('Помилка при видаленні файлу');
                }
              });

              previewContainer.appendChild(removeBtn);
              postMediaPreviews.appendChild(previewContainer);
            } catch (error) {
              console.error('Preview load error:', error);
            }
          };
          reader.readAsDataURL(file);
        });
      } catch (error) {
        console.error('Media input change error:', error);
        showToast('Помилка при обробці файлів');
      }
    });
  }

  // Intersection Observer для пагінації
  const sentinel = document.getElementById('feedSentinel');
  if (sentinel) {
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        try {
          loadMorePosts();
        } catch (error) {
          console.error('Load more posts error:', error);
        }
      }
    }, { threshold: 0.5 });
    observer.observe(sentinel);
  }

  // Відновлення теми
  if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');

  // Глобальний обробник кліків (лайки, збереження, переходи за data-uid)
  document.addEventListener('click', async (e) => {
    try {
      const targetBtn = e.target.closest('button');
      if (targetBtn) {
        if (!state.currentUser) {
          if (targetBtn.classList.contains('like-btn') || targetBtn.classList.contains('save-btn') || targetBtn.classList.contains('follow-btn-post')) {
            showToast('Увійдіть, щоб виконати цю дію');
            return;
          }
        }

        if (targetBtn.classList.contains('like-btn')) {
          const postId = targetBtn.dataset.postId;
          const { toggleLike } = await import('./posts.js');
          toggleLike(postId, targetBtn);
        }

        if (targetBtn.classList.contains('save-btn')) {
          const postId = targetBtn.dataset.postId;
          const { toggleSave } = await import('./posts.js');
          toggleSave(postId, targetBtn);
        }
      }

      const uidElement = e.target.closest('[data-uid]');
      if (uidElement) {
        const uid = uidElement.dataset.uid;
        if (uid) viewProfile(uid);
      }
    } catch (error) {
      console.error('Click handler error:', error);
    }
  });
});

// ================= onAuthStateChanged =================
onAuthStateChanged(auth, (user) => {
  try {
    cleanupAllListeners();

    if (user) {
      setCurrentUser(user);
      // Запускаємо heartbeat
      startHeartbeat(user);

      const authBox = document.getElementById('authBox');
      if (authBox) authBox.style.display = 'none';
      const newPostBox = document.getElementById('newPostBox');
      if (newPostBox) newPostBox.style.display = 'none';

      const userRef = doc(db, "users", user.uid);
      const unsubFollowing = onSnapshot(userRef, (docSnap) => {
        try {
          if (docSnap.exists()) {
            setCurrentUserData(docSnap.data());
            if (docSnap.data().settings) {
              const firestoreSettings = docSnap.data().settings;
              state.userSettings = {
                ...state.userSettings,
                ...firestoreSettings,
                notifications: { ...state.userSettings.notifications, ...(firestoreSettings.notifications || {}) },
                privacy: { ...state.userSettings.privacy, ...(firestoreSettings.privacy || {}) },
                preferences: { ...state.userSettings.preferences, ...(firestoreSettings.preferences || {}) },
                security: { ...state.userSettings.security, ...(firestoreSettings.security || {}) }
              };
            }
            applySettings();

            document.querySelectorAll('.follow-btn-post').forEach(btn => {
              const targetUid = btn.dataset.uid;
              if (targetUid) {
                const isFollowing = state.currentUserFollowing.includes(targetUid);
                btn.textContent = isFollowing ? 'Відписатися' : 'Підписатися';
                btn.classList.toggle('following', isFollowing);
              }
            });
          }
        } catch (error) {
          console.error('Following snapshot error:', error);
        }
      }, (error) => {
        console.error('Error in following snapshot:', error);
      });
      setUnsubscribeFollowing(unsubFollowing);

      // Підписка на список чатів для оновлення непрочитаних
      // FIX: Відписуємо старий слухач перед новою підпискою
      if (unsubscribeChatList) {
        try {
          unsubscribeChatList();
        } catch (error) {
          console.error('Error unsubscribing from chat list:', error);
        }
      }

      const q = query(collection(db, "chats"), where("participants", "array-contains", user.uid));
      unsubscribeChatList = onSnapshot(q, (snapshot) => {
        try {
          let totalUnread = 0;
          snapshot.forEach(doc => {
            const data = doc.data();
            if (data.unread && data.unread[user.uid]) {
              totalUnread += data.unread[user.uid];
            }
          });
          
          // FIX: Перевіряємо що state.unreadCount ініціалізований
          const unreadDiff = totalUnread - (state.unreadCount || 0);
          updateUnreadCount(unreadDiff);
          updateUnreadBadge(state.unreadCount || 0);
          
          if (document.getElementById('chats')?.classList.contains('active')) {
            loadChatList();
          }
        } catch (error) {
          console.error('Chat snapshot processing error:', error);
        }
      }, (error) => {
        console.error('Chat list snapshot error:', error);
        showToast('Помилка оновлення списку чатів.');
      });

      resetPagination();
      import('./profile.js').then(module => {
        try {
          module.loadMyProfile();
        } catch (error) {
          console.error('Load profile error:', error);
        }
      });

    } else {
      setCurrentUser(null);
      setCurrentUserData(null);
      // Зупиняємо heartbeat
      stopHeartbeat();
      
      // Відписуємо слухач чатів при логауті
      if (unsubscribeChatList) {
        try {
          unsubscribeChatList();
        } catch (error) {
          console.error('Error unsubscribing from chat list on logout:', error);
        }
        unsubscribeChatList = null;
      }

      const authBox = document.getElementById('authBox');
      if (authBox) {
        authBox.style.display = 'block';
      }
      const newPostBox = document.getElementById('newPostBox');
      if (newPostBox) {
        newPostBox.style.display = 'none';
      }
      updateUnreadBadge(0);
    }
  } catch (error) {
    console.error('Auth state change error:', error);
  }
});

// ================= Функція пошуку користувачів (для секції search) =================
async function loadSearchUsers() {
  try {
    if (!state.currentUser) return;
    const val = document.getElementById('searchInput')?.value.trim().toLowerCase() || '';
    const userList = document.getElementById('userList');
    if (!userList) return;
    if (!val) { 
      userList.innerHTML = ''; 
      return; 
    }

    if (val.startsWith('#')) {
      const tag = val.substring(1);
      const { collection, query, where, getDocs } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
      const { db } = await import('./config.js');
      const q = query(collection(db, "posts"), where("hashtags", "array-contains", tag));
      const snapshot = await getDocs(q);
      userList.innerHTML = '<h3 style="margin-bottom:12px;">Пости з тегом</h3>';
      if (snapshot.empty) {
        userList.innerHTML += '<p>Немає постів з цим тегом</p>';
      } else {
        const feedDiv = document.createElement('div');
        feedDiv.className = 'feed';
        userList.appendChild(feedDiv);
        const { renderPosts } = await import('./posts.js');
        renderPosts(snapshot.docs, feedDiv);
      }
      return;
    }

    const mySnap = await getDoc(doc(db, "users", state.currentUser.uid));
    const myFollowing = mySnap.data()?.following || [];

    const q1 = query(collection(db, "users"), where("userId", ">=", val.startsWith('@') ? val : `@${val}`), where("userId", "<=", (val.startsWith('@') ? val : `@${val}`) + '\uf8ff'));
    const q2 = query(collection(db, "users"), where("nickname_lower", ">=", val), where("nickname_lower", "<=", val + '\uf8ff'));

    const [snap1, snap2] = await Promise.all([getDocs(q1), getDocs(q2)]);
    const usersMap = new Map();
    snap1.forEach(d => usersMap.set(d.id, d.data()));
    snap2.forEach(d => usersMap.set(d.id, d.data()));

    userList.innerHTML = '';
    usersMap.forEach((data, uid) => {
      if (uid === state.currentUser.uid) return;
      const isFollowing = myFollowing.includes(uid);
      const div = document.createElement('div');
      div.className = 'chat-item';
      div.tabIndex = 0;
      div.innerHTML = `
        <div class="avatar small" style="background-image:url(${data.avatar || ''})" tabindex="0"></div>
        <div class="chat-info">
          <div class="chat-name">${data.nickname}</div>
          <div class="chat-last">${data.userId}</div>
        </div>
        <button class="btn follow-btn" tabindex="0">${isFollowing ? 'Відписатися' : 'Підписатися'}</button>
      `;
      const followBtn = div.querySelector('.follow-btn');
      followBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
          await toggleFollow(uid, followBtn);
        } catch (error) {
          console.error('Toggle follow error:', error);
        }
      };
      div.onclick = () => {
        try {
          viewProfile(uid);
        } catch (error) {
          console.error('View profile error:', error);
        }
      };
      userList.appendChild(div);
    });
  } catch (error) {
    console.error('Load search users error:', error);
    showToast('Помилка при пошуку користувачів');
  }
}

// ================= Скидання пагінації =================
function resetPagination() {
  try {
    resetPaginationState();
    const feed = document.getElementById('feed');
    if (feed) {
      feed.innerHTML = '';
      loadMorePosts();
    }
  } catch (error) {
    console.error('Reset pagination error:', error);
  }
}