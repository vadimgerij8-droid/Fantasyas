// TV-навігація (фокус, стрілки, курсор)
let tvSettings = {
  tvNavEnabled: localStorage.getItem('tvNav') !== 'false',
  remoteNavEnabled: localStorage.getItem('remoteNav') !== 'false',
  focusOptimized: localStorage.getItem('focusOptimized') !== 'false',
  tvCursorEnabled: localStorage.getItem('tvCursor') === 'true'
};

let cachedFocusableElements = [];
let lastDOMUpdate = 0;
let lastFocusedElement = null;

// Експортуємо функції для доступу з інших модулів
export function getFocusableElements() {
  const activeModal = document.querySelector('.modal.active');
  let container = activeModal || document;

  const baseSelector = `
    button, input, textarea, select, a[href], 
    [tabindex]:not([tabindex="-1"]), 
    .nav-item, .post, .chat-item, .profile-tab, 
    .hashtag-item, .modal-close, .emoji-button, 
    .btn, .file-input-button, .post-actions button,
    .comment-author, .post-author, .avatar, .hashtag,
    .follow-btn-post, .profile-menu-btn, .profile-menu-item
  `;

  const elements = Array.from(container.querySelectorAll(baseSelector));

  return elements.filter(el => {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           el.offsetParent !== null && 
           !el.disabled &&
           !el.hasAttribute('aria-hidden');
  });
}

export function updateFocusableCache() {
  cachedFocusableElements = getFocusableElements();
  lastDOMUpdate = Date.now();
}

function getCenter(el) {
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function findClosestElement(currentEl, direction) {
  if (!currentEl) return null;

  const currentCenter = getCenter(currentEl);
  const candidates = cachedFocusableElements.filter(el => el !== currentEl);

  if (candidates.length === 0) return null;

  const dirMap = {
    'ArrowUp': { dx: 0, dy: -1 },
    'ArrowDown': { dx: 0, dy: 1 },
    'ArrowLeft': { dx: -1, dy: 0 },
    'ArrowRight': { dx: 1, dy: 0 }
  };
  const dir = dirMap[direction];
  if (!dir) return null;

  let best = null;
  let bestScore = Infinity;

  candidates.forEach(candidate => {
    const candidateCenter = getCenter(candidate);
    const dx = candidateCenter.x - currentCenter.x;
    const dy = candidateCenter.y - currentCenter.y;

    const dot = dx * dir.dx + dy * dir.dy;
    if (dot <= 0) return;

    const length = Math.sqrt(dx * dx + dy * dy);
    const cosAngle = dot / length;
    if (cosAngle < 0.5) return;

    const score = length / cosAngle;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  });

  return best;
}

export function setFocusOnElement(el) {
  if (!el) return;

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
    el.focus();
    document.querySelectorAll('.focused').forEach(e => {
      if (e !== el) e.classList.remove('focused');
    });
    el.classList.add('focused');
  } else {
    document.querySelectorAll('.focused').forEach(e => e.classList.remove('focused'));
    el.classList.add('focused');
    el.focus({ preventScroll: true });
  }

  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  lastFocusedElement = el;

  if (tvSettings.tvCursorEnabled) {
    updateTVCursor();
  }
}

function closeAllPopups() {
  document.querySelectorAll('.emoji-picker').forEach(p => p.style.display = 'none');
  document.querySelectorAll('.profile-menu-dropdown.show').forEach(d => d.classList.remove('show'));
}

function handleKeyDown(e) {
  if (!tvSettings.tvNavEnabled && !tvSettings.remoteNavEnabled) return;

  const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  const isArrow = arrowKeys.includes(e.key);
  const isEnter = e.key === 'Enter';
  const isBack = e.key === 'Escape' || e.key === 'Back' || e.code === 'Escape';

  if (!isArrow && !isEnter && !isBack) return;

  if (Date.now() - lastDOMUpdate > 100) {
    updateFocusableCache();
  }

  const activeEl = document.activeElement;
  const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable);

  if (isInput) {
    if (isArrow || isEnter) {
      return;
    }
  }

  if (isBack) {
    e.preventDefault();

    const openEmojiPicker = document.querySelector('.emoji-picker[style*="display: grid"]');
    if (openEmojiPicker) {
      openEmojiPicker.style.display = 'none';
      if (lastFocusedElement && lastFocusedElement.classList.contains('emoji-button')) {
        setFocusOnElement(lastFocusedElement);
      } else {
        updateFocusableCache();
        const first = cachedFocusableElements[0];
        if (first) setFocusOnElement(first);
      }
      return;
    }

    const openDropdown = document.querySelector('.profile-menu-dropdown.show');
    if (openDropdown) {
      openDropdown.classList.remove('show');
      const menuBtn = document.querySelector('.profile-menu-btn');
      if (menuBtn) setFocusOnElement(menuBtn);
      return;
    }

    const activeModals = document.querySelectorAll('.modal.active');
    if (activeModals.length > 0) {
      activeModals.forEach(modal => modal.classList.remove('active'));
      setTimeout(() => {
        updateFocusableCache();
        if (lastFocusedElement && !lastFocusedElement.closest('.modal')) {
          setFocusOnElement(lastFocusedElement);
        } else {
          const first = cachedFocusableElements[0];
          if (first) setFocusOnElement(first);
        }
      }, 50);
      return;
    }

    const chatWindow = document.getElementById('chatWindow');
    if (chatWindow && chatWindow.style.display === 'flex') {
      chatWindow.style.display = 'none';
      setTimeout(() => {
        updateFocusableCache();
        const firstChat = document.querySelector('.chat-item');
        if (firstChat) setFocusOnElement(firstChat);
      }, 50);
      return;
    }

    const activeSection = document.querySelector('.section.active');
    if (activeSection && activeSection.id !== 'home') {
      document.querySelector('[data-section="home"]').click();
    }
    return;
  }

  if (isEnter) {
    if (isInput) return;

    const focused = document.querySelector('.focused') || activeEl;
    if (focused) {
      e.preventDefault();
      focused.click();
    } else {
      e.preventDefault();
      const first = cachedFocusableElements[0];
      if (first) setFocusOnElement(first);
    }
    return;
  }

  if (isArrow) {
    if (isInput) return;

    e.preventDefault();

    let current = document.querySelector('.focused') || activeEl;

    if (!current) {
      const first = cachedFocusableElements[0];
      if (first) setFocusOnElement(first);
      return;
    }

    const emojiPicker = current.closest('.emoji-picker');
    if (emojiPicker && emojiPicker.style.display === 'grid') {
      const emojiButtons = Array.from(emojiPicker.querySelectorAll('button'));
      const currentIndex = emojiButtons.indexOf(current);
      if (currentIndex !== -1) {
        let nextIndex;
        const cols = 8;
        if (e.key === 'ArrowRight') nextIndex = currentIndex + 1;
        else if (e.key === 'ArrowLeft') nextIndex = currentIndex - 1;
        else if (e.key === 'ArrowDown') nextIndex = currentIndex + cols;
        else if (e.key === 'ArrowUp') nextIndex = currentIndex - cols;

        if (nextIndex >= 0 && nextIndex < emojiButtons.length) {
          setFocusOnElement(emojiButtons[nextIndex]);
        }
        return;
      }
    }

    const next = findClosestElement(current, e.key);
    if (next) setFocusOnElement(next);
  }
}

function updateTVCursor() {
  const cursor = document.getElementById('tvCursor');
  if (!cursor) return;
  if (!tvSettings.tvCursorEnabled) {
    cursor.style.display = 'none';
    return;
  }
  const focusedEl = document.querySelector('.focused');
  if (!focusedEl) {
    cursor.style.display = 'none';
    return;
  }
  const rect = focusedEl.getBoundingClientRect();
  cursor.style.display = 'block';
  cursor.style.left = (rect.left - 20) + 'px';
  cursor.style.top = (rect.top + rect.height/2 - 16) + 'px';
}

// Ініціалізація TV-навігації
export function initTVNavigation() {
  document.addEventListener('keydown', handleKeyDown);

  // Спостерігач за змінами DOM
  const observer = new MutationObserver(() => {
    updateFocusableCache();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });

  // Фокус на перший елемент після завантаження
  window.addEventListener('load', () => {
    setTimeout(() => {
      updateFocusableCache();
      const first = cachedFocusableElements[0];
      if (first) setFocusOnElement(first);
    }, 500);
  });

  // Оновлення курсора при зміні фокусу
  const focusObserver = new MutationObserver(() => {
    if (tvSettings.tvCursorEnabled) updateTVCursor();
  });
  focusObserver.observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });

  // Кнопки налаштувань TV
  document.getElementById('tvNavToggle').onclick = () => {
    tvSettings.tvNavEnabled = !tvSettings.tvNavEnabled;
    localStorage.setItem('tvNav', tvSettings.tvNavEnabled);
    updateTvButtons();
    if (!tvSettings.tvNavEnabled) {
      document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));
      document.getElementById('tvCursor').style.display = 'none';
    } else {
      updateTVCursor();
    }
  };
  document.getElementById('remoteNavToggle').onclick = () => {
    tvSettings.remoteNavEnabled = !tvSettings.remoteNavEnabled;
    localStorage.setItem('remoteNav', tvSettings.remoteNavEnabled);
    updateTvButtons();
  };
  document.getElementById('focusOptimizeToggle').onclick = () => {
    tvSettings.focusOptimized = !tvSettings.focusOptimized;
    localStorage.setItem('focusOptimized', tvSettings.focusOptimized);
    updateTvButtons();
  };
  document.getElementById('tvCursorToggle').onclick = () => {
    tvSettings.tvCursorEnabled = !tvSettings.tvCursorEnabled;
    localStorage.setItem('tvCursor', tvSettings.tvCursorEnabled);
    updateTvButtons();
    updateTVCursor();
  };
  updateTvButtons();
}

function updateTvButtons() {
  const tvNavToggle = document.getElementById('tvNavToggle');
  if (tvNavToggle) tvNavToggle.textContent = `TV-навігація: ${tvSettings.tvNavEnabled ? 'увімкнено' : 'вимкнено'}`;
  const remoteNavToggle = document.getElementById('remoteNavToggle');
  if (remoteNavToggle) remoteNavToggle.textContent = `Навігація з пульта: ${tvSettings.remoteNavEnabled ? 'увімкнено' : 'вимкнено'}`;
  const focusOptimizeToggle = document.getElementById('focusOptimizeToggle');
  if (focusOptimizeToggle) focusOptimizeToggle.textContent = `Оптимізація фокусу: ${tvSettings.focusOptimized ? 'увімкнено' : 'вимкнено'}`;
  const tvCursorToggle = document.getElementById('tvCursorToggle');
  if (tvCursorToggle) tvCursorToggle.textContent = `TV-стрілочка: ${tvSettings.tvCursorEnabled ? 'увімкнено' : 'вимкнено'}`;
}

// Робимо функції доступними глобально для інших модулів (якщо потрібно)
window.updateFocusableCache = updateFocusableCache;
window.setFocusOnElement = setFocusOnElement;
