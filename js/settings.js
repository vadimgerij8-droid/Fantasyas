import { db } from './config.js';
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getCurrentUser, getCurrentUserData, setCurrentUserData } from './state.js';
import { showToast } from './utils.js';

// ================= Дефолтні налаштування =================
export const userSettings = {
  notifications: {
    push: true,
    email: true,
    sms: false,
    privateChats: true,
    likes: true,
    comments: true,
    newFollowers: true,
    mentions: true,
    directMessages: true,
    storyReplies: true
  },
  privacy: {
    privateAccount: false,
    activityStatus: true,
    storySharing: true,
    allowTags: 'everyone',
    allowMentions: 'everyone',
    blockedAccounts: [],
    whoCanMessage: 'everyone',
    whoCanSeeOnline: 'everyone',
    whoCanSeeFollowers: 'everyone'
  },
  security: {
    twoFactor: false,
    loginAlerts: true,
    savedLogins: []
  },
  preferences: {
    language: 'uk',
    darkMode: false,
    reduceMotion: false,
    highContrast: false,
    autoplayVideos: true,
    soundEffects: true
  }
};

// ================= Завантаження налаштувань у форму =================
export function loadSettings() {
  const userData = getCurrentUserData();
  if (!userData || !userData.settings) return;

  const settings = userData.settings;
  // Заповнюємо поля форми (приклад)
  const darkModeCheck = document.getElementById('darkMode');
  if (darkModeCheck) darkModeCheck.checked = settings.preferences.darkMode;

  const languageSelect = document.getElementById('language');
  if (languageSelect) languageSelect.value = settings.preferences.language;

  // Тут можна заповнити інші поля відповідно до HTML
}

// ================= Збереження налаштувань =================
export async function saveSettings(newSettings) {
  const currentUser = getCurrentUser();
  if (!currentUser) return;

  try {
    const userRef = doc(db, "users", currentUser.uid);
    await updateDoc(userRef, { settings: newSettings });
    showToast('Налаштування збережено');

    const userData = getCurrentUserData();
    userData.settings = newSettings;
    setCurrentUserData({ ...userData });
  } catch (error) {
    console.error('Error saving settings:', error);
    showToast('Помилка збереження');
  }
}
