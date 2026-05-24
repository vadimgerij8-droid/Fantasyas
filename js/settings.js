import { db } from './config.js';
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { state } from './state.js';
import { showToast, debounce } from './utils.js';
import { unblockUser } from './profile.js';

// ===== Явний маппінг ID елемента → шлях у state.userSettings =====
const TOGGLE_MAP = {
  settingPushNotifications:  ['notifications', 'push'],
  settingEmailNotifications: ['notifications', 'email'],
  settingSmsNotifications:   ['notifications', 'sms'],
  settingPrivateChats:       ['notifications', 'privateChats'],
  settingLikes:              ['notifications', 'likes'],
  settingComments:           ['notifications', 'comments'],
  settingNewFollowers:       ['notifications', 'newFollowers'],
  settingMentions:           ['notifications', 'mentions'],
  settingDirectMessages:     ['notifications', 'directMessages'],
  settingStoryReplies:       ['notifications', 'storyReplies'],
  settingPrivateAccount:     ['privacy',        'privateAccount'],
  settingActivityStatus:     ['privacy',        'activityStatus'],
  settingDarkMode:           ['preferences',    'darkMode'],
  settingReduceMotion:       ['preferences',    'reduceMotion'],
  settingHighContrast:       ['preferences',    'highContrast'],
  settingAutoplayVideos:     ['preferences',    'autoplayVideos'],
  settingSoundEffects:       ['preferences',    'soundEffects'],
  settingTwoFactor:          ['security',       'twoFactor'],
  settingLoginAlerts:        ['security',       'loginAlerts'],
};

const RADIO_MAP = {
  whoCanMessage:      ['privacy', 'whoCanMessage'],
  whoCanSeeOnline:    ['privacy', 'whoCanSeeOnline'],
  whoCanSeeFollowers: ['privacy', 'whoCanSeeFollowers'],
  allowMentions:      ['privacy', 'allowMentions'],
  allowTags:          ['privacy', 'allowTags'],
};

// Debounce збереження — не показуємо тост після кожного кліку
const debouncedSave = debounce(saveSettingsToFirestore, 800);

export function loadSettings() {
  if (!state.currentUser) return;
  updateSettingsUI();
  updatePrivacyUI();
  loadBlockedUsers();
  loadAccountStats();
  updateStorageInfo();
}

function updateSettingsUI() {
  Object.entries(TOGGLE_MAP).forEach(([id, [section, key]]) => {
    const el = document.getElementById(id);
    if (el) el.checked = state.userSettings[section][key];
  });

  const langSelect = document.getElementById('settingLanguage');
  if (langSelect) langSelect.value = state.userSettings.preferences.language;
}

function updatePrivacyUI() {
  Object.entries(RADIO_MAP).forEach(([name, [section, key]]) => {
    const val = state.userSettings[section][key];
    const radio = document.querySelector(`input[name="${name}"][value="${val}"]`);
    if (radio) radio.checked = true;
  });
}

export function setupSettingsListeners() {
  // ===== Навігація по вкладках =====
  const navItems = document.querySelectorAll('.settings-nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const tabId = item.dataset.tab;

      // 1. Знімаємо активний стан з усіх кнопок меню
      navItems.forEach(nav => nav.classList.remove('active'));
      // 2. Додаємо активний стан натиснутій кнопці
      item.classList.add('active');

      // 3. Приховуємо весь контент вкладок
      document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
      });
      // 4. Показуємо потрібну вкладку
      const targetContent = document.getElementById(`settings-${tabId}`);
      if (targetContent) {
        targetContent.classList.add('active');
      }
    });
  });

  // ===== Чекбокси / тогли =====
  Object.entries(TOGGLE_MAP).forEach(([id, [section, key]]) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener('change', (e) => {
      state.userSettings[section][key] = e.target.checked;
      applySettings();
      debouncedSave();
    });
  });

  // ===== Мова =====
  const langSelect = document.getElementById('settingLanguage');
  if (langSelect) {
    langSelect.addEventListener('change', (e) => {
      state.userSettings.preferences.language = e.target.value;
      debouncedSave();
    });
  }

  // ===== Радіо-кнопки приватності =====
  Object.entries(RADIO_MAP).forEach(([name, [section, key]]) => {
    document.querySelectorAll(`input[name="${name}"]`).forEach(radio => {
      radio.addEventListener('change', (e) => {
        state.userSettings[section][key] = e.target.value;
        debouncedSave();
      });
    });
  });
}

function applySettings() {
  // Темна тема
  if (state.userSettings.preferences.darkMode) {
    document.body.classList.add('dark');
  } else {
    document.body.classList.remove('dark');
  }
  localStorage.setItem('theme', state.userSettings.preferences.darkMode ? 'dark' : 'light');

  // Зменшення анімацій
  if (state.userSettings.preferences.reduceMotion) {
    document.documentElement.style.setProperty('--transition', '0s');
    document.documentElement.style.setProperty('--transition-slow', '0s');
  } else {
    document.documentElement.style.setProperty('--transition', '0.28s cubic-bezier(0.22, 0.61, 0.36, 1)');
    document.documentElement.style.setProperty('--transition-slow', '0.62s cubic-bezier(0.16, 1, 0.3, 1)');
  }

  // Підвищений контраст
  if (state.userSettings.preferences.highContrast) {
    document.documentElement.style.setProperty('--text-primary', '#000');
    document.documentElement.style.setProperty('--text-secondary', '#222');
  } else {
    document.documentElement.style.setProperty('--text-primary', '#1a1a1a');
    document.documentElement.style.setProperty('--text-secondary', '#666');
  }
}

async function saveSettingsToFirestore() {
  if (!state.currentUser) return;
  try {
    await updateDoc(doc(db, 'users', state.currentUser.uid), {
      settings: state.userSettings,
      updatedAt: serverTimestamp()
    });
    showToast('Налаштування збережено');
  } catch (error) {
    console.error('Помилка збереження налаштувань:', error);
    showToast('Помилка: не вдалося зберегти налаштування');
  }
}

async function loadBlockedUsers() {
  const container = document.getElementById('blockedUsersList');
  if (!container) return;

  if (
    !state.currentUserData ||
    !state.currentUserData.blockedUsers ||
    state.currentUserData.blockedUsers.length === 0
  ) {
    container.innerHTML = '<p style="color:var(--text-secondary); padding:10px;">Немає заблокованих користувачів</p>';
    return;
  }

  container.innerHTML = '<div class="skeleton" style="height:60px;"></div>';

  try {
    const blockedUsers = [];
    for (const uid of state.currentUserData.blockedUsers) {
      const snap = await getDoc(doc(db, 'users', uid));
      if (snap.exists()) blockedUsers.push({ id: uid, ...snap.data() });
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
        if (state.currentUserData) {
          state.currentUserData.blockedUsers = state.currentUserData.blockedUsers.filter(id => id !== user.id);
        }
        loadBlockedUsers();
      });
      container.appendChild(div);
    });
  } catch (error) {
    console.error('Error loading blocked users:', error);
    container.innerHTML = '<p style="color:var(--text-secondary); padding:10px;">Помилка завантаження</p>';
  }
}

function loadAccountStats() {
  if (!state.currentUserData) return;

  const statsContainer = document.getElementById('accountStats');
  if (statsContainer) {
    statsContainer.innerHTML = `
      <h4>Статистика</h4>
      <div class="stat-item">
        <span class="stat-value">${state.currentUserData.posts?.length || 0}</span>
        <span class="stat-label">Постів</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${state.currentUserData.followers?.length || 0}</span>
        <span class="stat-label">Підписників</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${state.currentUserData.following?.length || 0}</span>
        <span class="stat-label">Підписок</span>
      </div>
      <div class="stat-item">
        <span class="stat-value">${state.currentUserData.likedPosts?.length || 0}</span>
        <span class="stat-label">Лайків</span>
      </div>
    `;
  }

  const accountInfo = document.getElementById('accountInfo');
  if (accountInfo && state.currentUser) {
    accountInfo.innerHTML = `
      <h4>Інформація</h4>
      <div class="info-row">
        <span class="info-label">ID користувача:</span>
        <span class="info-value">${state.currentUserData.userId}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Email:</span>
        <span class="info-value">${state.currentUserData.email || 'Не вказано'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Дата реєстрації:</span>
        <span class="info-value">${
          state.currentUserData.createdAt
            ? new Date(state.currentUserData.createdAt.seconds * 1000).toLocaleDateString()
            : 'Невідомо'
        }</span>
      </div>
    `;
  }
}

async function updateStorageInfo() {
  const infoDiv = document.getElementById('storageInfo');
  if (!infoDiv) return;

  try {
    let postCount = 0;
    if (state.currentUser) {
      const postsQuery = query(
        collection(db, 'posts'),
        where('author', '==', state.currentUser.uid)
      );
      const postsSnap = await getDocs(postsQuery);
      postCount = postsSnap.size;
    }

    let localStorageSize = 0;
    for (const key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        localStorageSize += (localStorage[key].length * 2) / 1024;
      }
    }

    infoDiv.innerHTML = `
      <p>Кількість ваших постів: ${postCount}</p>
      <p>Дані в браузері: ${localStorageSize.toFixed(2)} КБ</p>
      <p class="text-secondary">* Точний обсяг медіа на сервері не відображається.</p>
    `;
  } catch (error) {
    console.error('Error updating storage info:', error);
    infoDiv.innerHTML = '<p style="color:var(--text-secondary);">Помилка завантаження інформації</p>';
  }
}
