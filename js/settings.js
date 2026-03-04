import { db } from './config.js';
import { doc, getDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { currentUser, currentUserData, userSettings } from './state.js';
import { showToast } from './utils.js';
import { unblockUser } from './profile.js';

export async function loadSettings() {
  if (!currentUser) return;
  let data = currentUserData;
  if (!data) { const snap = await getDoc(doc(db, "users", currentUser.uid)); data = snap.data(); }
  if (data.settings) Object.assign(userSettings, data.settings);
  updateSettingsUI(); loadBlockedUsers(); loadAccountStats(data); updatePrivacyUI(); updateStorageInfo();
}

function updateSettingsUI() {
  document.getElementById('settingPushNotifications') && (document.getElementById('settingPushNotifications').checked = userSettings.notifications.push);
  document.getElementById('settingEmailNotifications') && (document.getElementById('settingEmailNotifications').checked = userSettings.notifications.email);
  document.getElementById('settingSmsNotifications') && (document.getElementById('settingSmsNotifications').checked = userSettings.notifications.sms);
  document.getElementById('settingPrivateChats') && (document.getElementById('settingPrivateChats').checked = userSettings.notifications.privateChats);
  document.getElementById('settingLikes') && (document.getElementById('settingLikes').checked = userSettings.notifications.likes);
  document.getElementById('settingComments') && (document.getElementById('settingComments').checked = userSettings.notifications.comments);
  document.getElementById('settingNewFollowers') && (document.getElementById('settingNewFollowers').checked = userSettings.notifications.newFollowers);
  document.getElementById('settingMentions') && (document.getElementById('settingMentions').checked = userSettings.notifications.mentions);
  document.getElementById('settingDirectMessages') && (document.getElementById('settingDirectMessages').checked = userSettings.notifications.directMessages);
  document.getElementById('settingStoryReplies') && (document.getElementById('settingStoryReplies').checked = userSettings.notifications.storyReplies);
  document.getElementById('settingPrivateAccount') && (document.getElementById('settingPrivateAccount').checked = userSettings.privacy.privateAccount);
  document.getElementById('settingActivityStatus') && (document.getElementById('settingActivityStatus').checked = userSettings.privacy.activityStatus);
  document.getElementById('settingDarkMode') && (document.getElementById('settingDarkMode').checked = userSettings.preferences.darkMode);
  document.getElementById('settingReduceMotion') && (document.getElementById('settingReduceMotion').checked = userSettings.preferences.reduceMotion);
  document.getElementById('settingHighContrast') && (document.getElementById('settingHighContrast').checked = userSettings.preferences.highContrast);
  document.getElementById('settingAutoplayVideos') && (document.getElementById('settingAutoplayVideos').checked = userSettings.preferences.autoplayVideos);
  document.getElementById('settingSoundEffects') && (document.getElementById('settingSoundEffects').checked = userSettings.preferences.soundEffects);
  document.getElementById('settingLanguage') && (document.getElementById('settingLanguage').value = userSettings.preferences.language);
  document.getElementById('settingTwoFactor') && (document.getElementById('settingTwoFactor').checked = userSettings.security.twoFactor);
  document.getElementById('settingLoginAlerts') && (document.getElementById('settingLoginAlerts').checked = userSettings.security.loginAlerts);
}

export function setupSettingsListeners() {
  const toggleIds = ['settingPushNotifications','settingEmailNotifications','settingSmsNotifications','settingPrivateChats','settingLikes','settingComments','settingNewFollowers','settingMentions','settingDirectMessages','settingStoryReplies','settingPrivateAccount','settingActivityStatus','settingDarkMode','settingReduceMotion','settingHighContrast','settingAutoplayVideos','settingSoundEffects','settingTwoFactor','settingLoginAlerts'];
  toggleIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', (e) => {
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
      applySettings(); saveSettingsToFirestore();
    });
  });
  document.getElementById('settingLanguage')?.addEventListener('change', (e) => { userSettings.preferences.language = e.target.value; saveSettingsToFirestore(); });
  document.querySelectorAll('input[name="whoCanMessage"]').forEach(r => r.addEventListener('change', (e) => { userSettings.privacy.whoCanMessage = e.target.value; saveSettingsToFirestore(); }));
  document.querySelectorAll('input[name="whoCanSeeOnline"]').forEach(r => r.addEventListener('change', (e) => { userSettings.privacy.whoCanSeeOnline = e.target.value; saveSettingsToFirestore(); }));
  document.querySelectorAll('input[name="whoCanSeeFollowers"]').forEach(r => r.addEventListener('change', (e) => { userSettings.privacy.whoCanSeeFollowers = e.target.value; saveSettingsToFirestore(); }));
  document.querySelectorAll('input[name="allowMentions"]').forEach(r => r.addEventListener('change', (e) => { userSettings.privacy.allowMentions = e.target.value; saveSettingsToFirestore(); }));
  document.querySelectorAll('input[name="allowTags"]').forEach(r => r.addEventListener('change', (e) => { userSettings.privacy.allowTags = e.target.value; saveSettingsToFirestore(); }));
}

function updatePrivacyUI() {
  const setRadio = (name, val) => { document.querySelector(`input[name="${name}"][value="${val}"]`) && (document.querySelector(`input[name="${name}"][value="${val}"]`).checked = true); };
  setRadio('whoCanMessage', userSettings.privacy.whoCanMessage);
  setRadio('whoCanSeeOnline', userSettings.privacy.whoCanSeeOnline);
  setRadio('whoCanSeeFollowers', userSettings.privacy.whoCanSeeFollowers);
  setRadio('allowMentions', userSettings.privacy.allowMentions);
  setRadio('allowTags', userSettings.privacy.allowTags);
}

function applySettings() {
  if (userSettings.preferences.darkMode) document.body.classList.add('dark'); else document.body.classList.remove('dark');
  localStorage.setItem('theme', userSettings.preferences.darkMode ? 'dark' : 'light');
}

async function saveSettingsToFirestore() {
  if (!currentUser) return;
  try { await updateDoc(doc(db, "users", currentUser.uid), { settings: userSettings, updatedAt: serverTimestamp() }); showToast('Налаштування збережено'); } 
  catch (error) { console.error(error); showToast('Помилка збереження налаштувань'); }
}

async function loadBlockedUsers() {
  const container = document.getElementById('blockedUsersList');
  if (!container) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  const blockedIds = snap.data().blockedUsers || [];
  if (blockedIds.length === 0) { container.innerHTML = '<p>Немає заблокованих користувачів</p>'; return; }
  container.innerHTML = '';
  for (const uid of blockedIds) {
    const userSnap = await getDoc(doc(db, "users", uid));
    if (userSnap.exists()) {
      const user = userSnap.data();
      const div = document.createElement('div'); div.className = 'blocked-user-item';
      div.innerHTML = `<div class="avatar small" style="background-image:url(${user.avatar||''})"></div><div class="blocked-user-info"><div class="blocked-user-name">${user.nickname}</div><div class="blocked-user-id">${user.userId}</div></div><button class="btn btn-secondary unblock-btn" data-uid="${uid}">Розблокувати</button>`;
      div.querySelector('.unblock-btn').addEventListener('click', async () => { await unblockUser(uid); loadBlockedUsers(); });
      container.appendChild(div);
    }
  }
}

function loadAccountStats(data) {
  document.getElementById('accountStats') && (document.getElementById('accountStats').innerHTML = `<h4>Статистика</h4><div class="stat-item"><span class="stat-value">${data.posts?.length||0}</span><span class="stat-label">Постів</span></div><div class="stat-item"><span class="stat-value">${data.followers?.length||0}</span><span class="stat-label">Підписників</span></div><div class="stat-item"><span class="stat-value">${data.following?.length||0}</span><span class="stat-label">Підписок</span></div><div class="stat-item"><span class="stat-value">${data.likedPosts?.length||0}</span><span class="stat-label">Лайків</span></div>`);
  document.getElementById('accountInfo') && (document.getElementById('accountInfo').innerHTML = `<h4>Інформація</h4><div class="info-row"><span class="info-label">ID:</span><span class="info-value">${data.userId}</span></div><div class="info-row"><span class="info-label">Email:</span><span class="info-value">${data.email||'Не вказано'}</span></div><div class="info-row"><span class="info-label">Дата реєстрації:</span><span class="info-value">${data.createdAt?new Date(data.createdAt.seconds*1000).toLocaleDateString():'Невідомо'}</span></div>`);
}

async function updateStorageInfo() {
  const infoDiv = document.getElementById('storageInfo');
  if (!infoDiv) return;
  let postCount = 0;
  if (currentUser) { const postsQuery = query(collection(db, "posts"), where("author", "==", currentUser.uid)); const postsSnap = await getDocs(postsQuery); postCount = postsSnap.size; }
  let localStorageSize = 0; for (let key in localStorage) if (localStorage.hasOwnProperty(key)) localStorageSize += (localStorage[key].length * 2) / 1024;
  infoDiv.innerHTML = `<p>Кількість ваших постів: ${postCount}</p><p>Дані в браузері: ${localStorageSize.toFixed(2)} КБ</p>`;
}
