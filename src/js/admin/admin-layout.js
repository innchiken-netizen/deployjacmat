/**
 * JACMAT STORE — Admin Shared Layout & Session Guard
 * Automatically verifies session and builds responsive navigation shell.
 */
import { escapeHtml } from "../utils/sanitize.js";

let currentAdminEmail = "";

/**
 * Show a clean toast notification in the admin interface
 * @param {string} message
 * @param {'success' | 'error'} type
 */
export function showAdminToast(message, type = "success") {
  let container = document.getElementById("admin-toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "admin-toast-container";
    container.className = "admin-toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `admin-toast ${type === "error" ? "admin-toast-error" : ""}`;
  toast.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${type === "error"
        ? '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'
        : '<path d="M20 6L9 17l-5-5"></path>'
      }
    </svg>
    <span>${escapeHtml(message)}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

/**
 * Guard & Initialize Admin Page
 * @param {string} activePageKey - 'dashboard' | 'products' | 'categories' | 'settings'
 */
export async function initAdminLayout(activePageKey = "dashboard") {
  // 1. Session verification check
  try {
    const res = await fetch("/api/admin/me");
    if (!res.ok) {
      // Not authenticated -> redirect to login
      window.location.replace("/admin/login");
      return false;
    }
    const data = await res.json();
    currentAdminEmail = data.email || "admin@jacmat.store";
  } catch (err) {
    window.location.replace("/admin/login");
    return false;
  }

  // 2. Render Sidebar Navigation
  const sidebarContainer = document.getElementById("admin-sidebar");
  if (sidebarContainer) {
    sidebarContainer.innerHTML = `
      <div class="admin-sidebar-header">
        <a href="/admin" class="admin-brand">
          <img src="/logo white.png" alt="Jacmat Store">
          <span class="admin-brand-tag">Admin</span>
        </a>
      </div>

      <nav class="admin-nav">
        <div class="admin-nav-section-title">Navigation</div>
        <ul class="admin-nav-list">
          <li>
            <a href="/admin" class="admin-nav-link ${activePageKey === "dashboard" ? "is-active" : ""}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
              </svg>
              <span>Tableau de bord</span>
            </a>
          </li>
          <li>
            <a href="/admin/products" class="admin-nav-link ${activePageKey === "products" ? "is-active" : ""}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <path d="M16 10a4 4 0 0 1-8 0"></path>
              </svg>
              <span>Produits</span>
            </a>
          </li>
          <li>
            <a href="/admin/categories" class="admin-nav-link ${activePageKey === "categories" ? "is-active" : ""}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              <span>Catégories</span>
            </a>
          </li>
          <li>
            <a href="/admin/settings" class="admin-nav-link ${activePageKey === "settings" ? "is-active" : ""}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
              </svg>
              <span>Paramètres</span>
            </a>
          </li>
        </ul>

        <div class="admin-nav-section-title" style="margin-top: 24px;">Boutique</div>
        <ul class="admin-nav-list">
          <li>
            <a href="/" target="_blank" rel="noopener noreferrer" class="admin-nav-link">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                <polyline points="15 3 21 3 21 9"></polyline>
                <line x1="10" y1="14" x2="21" y2="3"></line>
              </svg>
              <span>Voir la boutique</span>
            </a>
          </li>
        </ul>
      </nav>

      <div class="admin-sidebar-footer">
        <div class="admin-user-pill">
          <div class="admin-user-avatar">
            ${escapeHtml(currentAdminEmail.charAt(0).toUpperCase())}
          </div>
          <div class="admin-user-info">
            <div class="admin-user-role">Propriétaire</div>
            <div class="admin-user-email" title="${escapeHtml(currentAdminEmail)}">${escapeHtml(currentAdminEmail)}</div>
          </div>
        </div>

        <button type="button" id="admin-logout-btn" class="admin-btn-logout">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          <span>Déconnexion</span>
        </button>
      </div>
    `;

    // Hook logout button
    const logoutBtn = document.getElementById("admin-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        try {
          await fetch("/api/admin/logout", { method: "POST" });
        } finally {
          window.location.replace("/admin/login");
        }
      });
    }
  }

  // 3. Hook Mobile Hamburger Menu
  const menuToggle = document.getElementById("admin-menu-toggle");
  if (menuToggle && sidebarContainer) {
    menuToggle.addEventListener("click", () => {
      sidebarContainer.classList.toggle("is-open");
    });

    // Close on click outside
    document.addEventListener("click", (e) => {
      if (
        sidebarContainer.classList.contains("is-open") &&
        !sidebarContainer.contains(e.target) &&
        !menuToggle.contains(e.target)
      ) {
        sidebarContainer.classList.remove("is-open");
      }
    });
  }

  return true;
}
