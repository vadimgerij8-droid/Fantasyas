/* ========== profile.css ========== */

/* ========== ПРОФІЛЬ ========== */
.profile-header {
  display: flex;
  gap: 24px;
  margin-bottom: 24px;
  flex-wrap: wrap;
  align-items: flex-start;
  animation: fadeIn 0.8s ease-out;
}
.profile-avatar-section {
  position: relative;
  flex-shrink: 0;
  animation: scaleIn 0.6s ease-out 0.2s both;
}
.profile-avatar-section .avatar.large {
  width: 120px;
  height: 120px;
  border-width: 4px;
  box-shadow: var(--shadow-md);
  transition: all var(--transition-bounce);
}
.profile-avatar-section .avatar.large:hover {
  transform: scale(1.08) rotate(2deg);
  box-shadow: var(--shadow-lg), 0 0 30px rgba(var(--accent-rgb), 0.2);
}
.profile-avatar-edit {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: var(--accent);
  color: var(--btn-primary-text);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border: 3px solid var(--card);
  transition: all var(--transition-bounce);
  box-shadow: var(--shadow-sm);
}
.profile-avatar-edit:hover {
  transform: scale(1.15) rotate(15deg);
  box-shadow: var(--shadow-md);
}
.profile-info-section {
  flex: 1;
  min-width: 0;
  animation: slideIn 0.6s ease-out 0.3s both;
}
.profile-name-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.profile-name {
  font-size: 1.8rem;
  font-weight: 700;
  margin: 0;
  background: linear-gradient(135deg, var(--accent), var(--accent-light));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: fadeIn 0.8s ease-out 0.4s both;
}
.profile-verified {
  color: var(--accent);
  animation: pulse-soft 2s infinite;
}
.profile-handle {
  color: var(--text-tertiary);
  font-size: 1rem;
  margin-bottom: 12px;
  animation: fadeIn 0.8s ease-out 0.5s both;
}
.profile-bio {
  color: var(--text-secondary);
  line-height: 1.6;
  margin-bottom: 16px;
  max-width: 600px;
  animation: fadeIn 0.8s ease-out 0.6s both;
}
.profile-stats {
  display: flex;
  gap: 24px;
  margin: 16px 0;
  flex-wrap: wrap;
  animation: fadeIn 0.8s ease-out 0.7s both;
}
.profile-stat-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  cursor: pointer;
  transition: all var(--transition);
  padding: 8px 16px;
  border-radius: var(--radius-md);
  background: transparent;
  min-width: 80px;
}
.profile-stat-item:hover {
  background: var(--surface);
  transform: translateY(-4px) scale(1.05);
}
.profile-stat-value {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--text-primary);
  transition: color 0.25s;
}
.profile-stat-item:hover .profile-stat-value {
  color: var(--accent);
}
.profile-stat-label {
  font-size: 0.9rem;
  color: var(--text-tertiary);
  font-weight: 500;
}
.profile-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
  animation: fadeIn 0.8s ease-out 0.8s both;
}
.profile-actions .btn {
  min-width: 120px;
  justify-content: center;
}
.profile-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  padding-bottom: 8px;
  margin-bottom: 20px;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  animation: fadeIn 0.8s ease-out 0.9s both;
}
.profile-tabs::-webkit-scrollbar {
  display: none;
}
.profile-tab {
  padding: 10px 20px;
  border-radius: var(--radius-md);
  cursor: pointer;
  font-weight: 600;
  color: var(--text-secondary);
  transition: all var(--transition);
  white-space: nowrap;
  position: relative;
  overflow: hidden;
}
.profile-tab::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 0;
  height: 3px;
  background: var(--accent);
  transition: all var(--transition);
  transform: translateX(-50%);
  border-radius: 3px;
}
.profile-tab:hover {
  background: var(--surface);
  color: var(--text-primary);
  transform: translateY(-2px);
}
.profile-tab.active {
  color: var(--accent);
  background: transparent;
}
.profile-tab.active::after {
  width: 80%;
}
.profile-tab.focused {
  background: var(--surface);
  box-shadow: 0 0 0 2px rgba(var(--accent-rgb), 0.2);
}
.profile-menu {
  position: relative;
  display: inline-block;
  margin-left: auto;
}
.profile-menu-btn {
  background: none;
  border: none;
  font-size: 1.8rem;
  cursor: pointer;
  padding: 8px;
  color: var(--text-secondary);
  transition: all var(--transition);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.profile-menu-btn:hover {
  transform: rotate(90deg) scale(1.1);
  color: var(--accent);
  background: var(--surface);
}
.profile-menu-dropdown {
  position: absolute;
  right: 0;
  top: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  min-width: 220px;
  box-shadow: var(--shadow-lg);
  z-index: 100;
  display: none;
  animation: scaleIn 0.3s ease-out;
  margin-top: 8px;
}
.profile-menu-dropdown.show {
  display: block;
}
.profile-menu-item {
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.25s;
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-primary);
}
.profile-menu-item:hover {
  background: var(--surface);
  transform: translateX(8px);
  color: var(--accent);
}
.profile-menu-item.danger {
  color: var(--danger);
}
.profile-menu-item.danger:hover {
  color: var(--danger-hover);
  background: rgba(158, 158, 158, 0.1);
}
@media (max-width: 768px) {
  .profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 20px;
  }
  .profile-avatar-section .avatar.large {
    width: 100px;
    height: 100px;
  }
  .profile-name {
    font-size: 1.5rem;
  }
  .profile-stats {
    justify-content: center;
    width: 100%;
    gap: 16px;
  }
  .profile-stat-item {
    align-items: center;
    flex: 1;
    min-width: 70px;
    max-width: 100px;
  }
  .profile-actions {
    justify-content: center;
    width: 100%;
  }
  .profile-actions .btn {
    flex: 1;
    max-width: 150px;
  }
  .profile-menu {
    position: absolute;
    top: 16px;
    right: 16px;
    margin: 0;
  }
}
@media (max-width: 480px) {
  .profile-avatar-section .avatar.large {
    width: 80px;
    height: 80px;
  }
  .profile-avatar-edit {
    width: 30px;
    height: 30px;
    bottom: 4px;
    right: 4px;
  }
  .profile-name {
    font-size: 1.3rem;
  }
  .profile-stat-value {
    font-size: 1.2rem;
  }
  .profile-stat-label {
    font-size: 0.8rem;
  }
  .profile-tabs {
    gap: 4px;
  }
  .profile-tab {
    padding: 8px 14px;
    font-size: 0.9rem;
  }
}

/* ========== НАЛАШТУВАННЯ ========== */
.settings-nav {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.settings-nav-item {
  padding: 12px 16px;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.25s;
  font-weight: 500;
  color: var(--text-secondary);
}
.settings-nav-item:hover {
  background: var(--surface);
  color: var(--accent);
  transform: translateX(4px);
}
.settings-nav-item.active {
  background: var(--accent);
  color: var(--btn-primary-text);
}
.settings-tab-content {
  display: none;
  animation: fadeIn 0.4s ease-out;
}
.settings-tab-content.active {
  display: block;
}
.settings-group {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.settings-group h3,
.settings-group h4 {
  margin-bottom: 12px;
  color: var(--text-primary);
}

/* ========== СПИСОК ЗАБЛОКОВАНИХ ========== */
.blocked-user-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: var(--surface);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  animation: slideIn 0.3s ease-out;
}
.blocked-user-item:hover {
  background: var(--card);
  transform: translateX(4px);
}
.blocked-user-info {
  flex: 1;
}
.blocked-user-name {
  font-weight: 600;
  color: var(--text-primary);
}
.blocked-user-id {
  font-size: 0.85rem;
  color: var(--text-tertiary);
}
.unblock-btn {
  padding: 6px 12px;
  font-size: 0.85rem;
}

/* ========== ІНФОРМАЦІЯ ПРО СХОВИЩЕ ========== */
#storageInfo {
  background: var(--surface);
  padding: 16px;
  border-radius: var(--radius-md);
  margin: 12px 0;
  line-height: 1.8;
}
#storageInfo p {
  margin: 6px 0;
}
.stat-item {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  margin-right: 24px;
}
.stat-value {
  font-size: 1.4rem;
  font-weight: 700;
  color: var(--accent);
}
.stat-label {
  font-size: 0.9rem;
  color: var(--text-tertiary);
}
