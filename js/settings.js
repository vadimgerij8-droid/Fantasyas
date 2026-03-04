import { db } from './config.js';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentUser, currentUserData, userSettings } from './state.js';
import { showToast } from './utils.js';
import { unblockUser } from './profile.js';

// ================= Завантаження налаштувань =================
export async function loadSettings() {
  if (!currentUser) return;

  // Чекаємо, поки currentUserData завантажиться, якщо ще ні
  let data = currentUserData;
  if (!data) {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    data = snap.data();
  }

  if (data.settings) {
    Object.assign(userSettings, data.settings);
  }

  updateSettingsUI();
  loadBlockedUsers();
  loadAccountStats(data);
  updatePrivacyUI();
  updateStorageInfo();
}

function updateSettingsUI() {
  const pushToggle = document.getElementById('settingPushNotifications');
  if (pushToggle) pushToggle.checked = userSettings.notifications.push;

  const emailToggle = document.getElementById('settingEmailNotifications');
  if (emailToggle) emailToggle.checked = userSettings.notifications.email;

  const smsToggle = document.getElementById('settingSmsNotifications');
  if (smsToggle) smsToggle.checked = userSettings.notifications.sms;

  const privateChatsToggle = document.getElementById('settingPrivateChats');
  if (privateChatsToggle) privateChatsToggle.checked = userSettings.notifications.privateChats;

  const likesToggle = document.getElementById('settingLikes');
  if (likesToggle) likesToggle.checked = userSettings.notifications.likes;

  const commentsToggle = document.getElementById('settingComments');
  if (commentsToggle) commentsToggle.checked = userSettings.notifications.comments;

  const newFollowersToggle = document.getElementById('settingNewFollowers');
  if (newFollowersToggle) newFollowersToggle.checked = userSettings.notifications.newFollowers;

  const mentionsToggle = document.getElementById('settingMentions');
  if (mentionsToggle) mentionsToggle.checked = userSettings.notifications.mentions;

  const directMessagesToggle = document.getElementById('settingDirectMessages');
  if (directMessagesToggle) directMessagesToggle.checked = userSettings.notifications.directMessages;

  const storyRepliesToggle = document.getElementById('settingStoryReplies');
  if (storyRepliesToggle) storyRepliesToggle.checked = userSettings.notifications.storyReplies;

  const privateAccountToggle = document.getElementById('settingPrivateAccount');
  if (privateAccountToggle) privateAccountToggle.checked = userSettings.privacy.privateAccount;

  const activityStatusToggle = document.getElementById('settingActivityStatus');
  if (activityStatusToggle) activityStatusToggle.checked = userSettings.privacy.activityStatus;

  const darkModeToggle = document.getElementById('settingDarkMode');
  if (darkModeToggle) darkModeToggle.checked = userSettings.preferences.darkMode;

  const reduceMotionToggle = document.getElementById('settingReduceMotion');
  if (reduceMotionToggle) reduceMotionToggle.checked = userSettings.preferences.reduceMotion;

  const highContrastToggle = document.getElementById('settingHighContrast');
  if (highContrastToggle) highContrastToggle.checked = userSettings.preferences.highContrast;

  const autoplayVideosToggle = document.getElementById('settingAutoplayVideos');
  if (autoplayVideosToggle) autoplayVideosToggle.checked = userSettings.preferences.autoplayVideos;

  const soundEffectsToggle = document.getElementById('settingSoundEffects');
  if (soundEffectsToggle) soundEffectsToggle.checked = userSettings.preferences.soundEffects;

  const languageSelect = document.getElementById('settingLanguage');
  if (languageSelect) languageSelect.value = userSettings.preferences.language;

  const twoFactorToggle = document.getElementById('settingTwoFactor');
  if (twoFactorToggle) twoFactorToggle.checked = userSettings.security.twoFactor;

  const loginAlertsToggle = document.getElementById('settingLoginAlerts');
  if (loginAlertsToggle) loginAlertsToggle.checked = userSettings.security.loginAlerts;
}

export function setupSettingsListeners() {
  const toggleIds = [
    'settingPushNotifications', 'settingEmailNotifications', 'settingSmsNotifications',
    'settingPrivateChats', 'settingLikes', 'settingComments', 'settingNewFollowers',
    'settingMentions', 'settingDirectMessages', 'settingStoryReplies',
    'settingPrivateAccount', 'settingActivityStatus',
    'settingDarkMode', 'settingReduceMotion', 'settingHighContrast',
    'settingAutoplayVideos', 'settingSoundEffects',
    'settingTwoFactor', 'settingLoginAlerts'
  ];

  toggleIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', (e) => {
        if (id.includes('Push')) userSettings.notifications.push = e.target.checked;
        else if (id.includes('Email')) userSettings.notifications.email = e.target.checked;
        else if (id.includes('Sms')) userSettings.notifications.sms = e.target.checked;
        else if (id.includes('PrivateChats')) userSettings.notifications.privateChats = e.target.checked;
        else if (id.includes('Likes')) userSettings.notifications.likes = e.target.checked;
        else if (id.includes('Comments')) userSettings.notifications.comments = e.target.checked;
        else if (id.includes('NewFollowers')) userSettings.notifications.newFollowers = e.target.checked;
        else if (id.includes('Mentions')) userSettings.notifications.mentions = e.target.checked;
        else if (id.includes('DirectMessages')) userSettings.notifications.directMessages = e.target.checked;
        else if (id.includes('StoryReplies')) userSettings.notifications.storyReplies = e.target.checked;
        else if (id.includes('PrivateAccount')) userSettings.privacy.privateAccount = e.target.checked;
        else if (id.includes('ActivityStatus')) userSettings.privacy.activityStatus = e.target.checked;
        else if (id.includes('DarkMode')) userSettings.preferences.darkMode = e.target.checked;
        else if (id.includes('ReduceMotion')) userSettings.preferences.reduceMotion = e.target.checked;
        else if (id.includes('HighContrast')) userSettings.preferences.highContrast = e.target.checked;
        else if (id.includes('AutoplayVideos')) userSettings.preferences.autoplayVideos = e.target.checked;
        else if (id.includes('SoundEffects')) userSettings.preferences.soundEffects = e.target.checked;
        else if (id.includes('TwoFactor')) userSettings.security.twoFactor = e.target.checked;
        else if (id.includes('LoginAlerts')) userSettings.security.loginAlerts = e.target.checked;

        applySettings();
        saveSettingsToFirestore();
      });
    }
  });

  const langSelect = document.getElementById('settingLanguage');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      userSettings.preferences.language = e.target.value;
      saveSettingsToFirestore();
    });
  }

  document.querySelectorAll('input[name="whoCanMessage"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      userSettings.privacy.whoCanMessage = e.target.value;
      await saveSettingsToFirestore();
    });
  });

  document.querySelectorAll('input[name="whoCanSeeOnline"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      userSettings.privacy.whoCanSeeOnline = e.target.value;
      await saveSettingsToFirestore();
    });
  });

  document.querySelectorAll('input[name="whoCanSeeFollowers"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      userSettings.privacy.whoCanSeeFollowers = e.target.value;
      await saveSettingsToFirestore();
    });
  });

  document.querySelectorAll('input[name="allowMentions"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      userSettings.privacy.allowMentions = e.target.value;
      await saveSettingsToFirestore();
    });
  });

  document.querySelectorAll('input[name="allowTags"]').forEach(radio => {
    radio.addEventListener('change', async (e) => {
      userSettings.privacy.allowTags = e.target.value;
      await saveSettingsToFirestore();
    });
  });
}

function updatePrivacyUI() {
  const whoCanMessage = document.querySelector(`input[name="whoCanMessage"][value="${userSettings.privacy.whoCanMessage}"]`);
  if (whoCanMessage) whoCanMessage.checked = true;

  const whoCanSeeOnline = document.querySelector(`input[name="whoCanSeeOnline"][value="${userSettings.privacy.whoCanSeeOnline}"]`);
  if (whoCanSeeOnline) whoCanSeeOnline.checked = true;

  const whoCanSeeFollowers = document.querySelector(`input[name="whoCanSeeFollowers"][value="${userSettings.privacy.whoCanSeeFollowers}"]`);
  if (whoCanSeeFollowers) whoCanSeeFollowers.checked = true;

  const allowMentions = document.querySelector(`input[name="allowMentions"][value="${userSettings.privacy.allowMentions}"]`);
  if (allowMentions) allowMentions.checked = true;

  const allowTags = document.querySelector(`input[name="allowTags"][value="${userSettings.privacy.allowTags}"]`);
  if (allowTags) allowTags.checked = true;
}

function applySettings() {
  if (userSettings.preferences.darkMode) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  localStorage.setItem('theme', userSettings.preferences.darkMode ? 'dark' : 'light');

  if (userSettings.preferences.reduceMotion) {
    document.documentElement.style.setProperty('--transition', '0s');
    document.documentElement.style.setProperty('--transition-slow', '0s');
  } else {
    document.documentElement.style.setProperty('--transition', '0.28s cubic-bezier(0.22, 0.61, 0.36, 1)');
    document.documentElement.style.setProperty('--transition-slow', '0.62s cubic-bezier(0.16, 1, 0.3, 1)');
  }
}

async function saveSettingsToFirestore() {
  if (!currentUser) return;
  try {
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, {
      settings: userSettings,
      updatedAt: serverTimestamp()
    });
    showToast('Налаштування збережено');
  } catch (error) {
    console.error('Помилка збереження налаштувань:', error);
    showToast('Помилка збереження налаштувань');
  }
}

async function loadBlockedUsers() {
  const container = document.getElementById('blockedUsersList');
  if (!container) return;

  // Отримуємо актуальні дані
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  const data = snap.data();
  const blockedIds = data.blockedUsers || [];

  if (blockedIds.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary); padding:10px;">Немає заблокованих користувачів</p>';
    return;
  }

  container.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  const blockedUsers = [];
  for (const uid of blockedIds) {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      blockedUsers.push({ id: uid, ...userSnap.data() });
    }
  }

  container.innerHTML = '';
  blockedUsers.forEach(user => {
    const div = document.createElement('div');
    div.className = 'blocked-user-item';
    div.innerHTML = `
      <div class="avatar small" style="background-image:url(${user.avatar || ''})"></div>
      <div class="blocked-user-info">
        <div class="blocked-user-name">${user.nickname}</div>
        <div class="blocked-user-id">${user.userId}</div>
      </div>
      <button class="btn btn-secondary unblock-btn" data-uid="${user.id}">Розблокувати</button>
    `;

    div.querySelector('.unblock-btn').addEventListener('click', async () => {
      await unblockUser(user.id);
      loadBlockedUsers(); // перезавантажуємо список
    });

    container.appendChild(div);
  });
}

function loadAccountStats(data) {
  const statsContainer = document.getElementById('accountStats');
  if (statsContainer) {
    statsContainer.innerHTML = `
      <h4>Статистика</h4>
      <div class="stat-item">
        <span class="stat-value">${data.posts?.length || 0}</span>
        <span class="stat-label">Постів</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${data.followers?.length || 0}</span>
        <span class="stat-label">Підписників</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${data.following?.length || 0}</span>
        <span class="stat-label">Підписок</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${data.likedPosts?.length || 0}</span>
        <span class="stat-label">Лайків</span>
      </div>
    `;
  }

  const accountInfo = document.getElementById('accountInfo');
  if (accountInfo && currentUser) {
    accountInfo.innerHTML = `
      <h4>Інформація</h4>
      <div class="info-row">
        <span class="info-label">ID користувача:</span>
        <span class="info-value">${data.userId}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Email:</span>
        <span class="info-value">${data.email || 'Не вказано'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Дата реєстрації:</span>
        <span class="info-value">${data.createdAt ? new Date(data.createdAt.seconds * 1000).toLocaleDateString() : 'Невідомо'}</span>
      </div>
    `;
  }
}

async function updateStorageInfo() {
  const infoDiv = document.getElementById('storageInfo');
  if (!infoDiv) return;

  let postCount = 0;
  if (currentUser) {
    const postsQuery = query(collection(db, "posts"), where("author", "==", currentUser.uid));
    const postsSnap = await getDocs(postsQuery);
    postCount = postsSnap.size;
  }

  let localStorageSize = 0;
  for (let key in localStorage) {
    if (localStorage.hasOwnProperty(key)) {
      localStorageSize += (localStorage[key].length * 2) / 1024;
    }
  }

  infoDiv.innerHTML = `
    <p>Кількість ваших постів: ${postCount}</p>
    <p>Дані в браузері: ${localStorageSize.toFixed(2)} КБ</p>
    <p class="text-secondary">* Точний обсяг медіа на сервері не відображається.</p>
  `;
}
