import { auth, db } from './config.js';
import { doc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { state } from './state.js';

// ================= Toast =================
export const showToast = (msg) => {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
};

// ================= Вібрація =================
export const vibrate = (ms) => { if (navigator.vibrate) navigator.vibrate(ms); };

// ================= Дебаунс =================
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ================= Емоджі-пікер =================
const emojiList = ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'];

export function closeAllEmojiPickers() {
  document.querySelectorAll('.emoji-picker').forEach(p => p.classList.remove('active'));
}

export function setupEmojiPicker(buttonId, pickerId, inputId) {
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
export function setupFileInput(inputId, labelId, previewId) {
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

// ================= Завантаження на Cloudinary =================
export async function uploadToCloudinary(file) {
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

// ================= Оновлення онлайн-статусу =================
export async function updateLastOnline() {
  if (!state.currentUser) return;
  try {
    await updateDoc(doc(db, "users", state.currentUser.uid), { lastOnline: serverTimestamp() });
  } catch (e) {
    console.error('Failed to update lastOnline:', e);
  }
}

// ================= Оновлення бейджа непрочитаних =================
export function updateUnreadBadge(unreadCount) {
  const badge = document.getElementById('unreadBadge');
  if (!badge) return;
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}
