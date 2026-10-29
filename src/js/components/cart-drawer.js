import { cartState } from "../state.js";
import { formatPrice, buildCartWhatsAppUrl } from "../api.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

let drawerEl = null;
let overlayEl = null;

export function initCartDrawer() {
  createDrawerMarkup();

  // Subscribe to state updates
  cartState.subscribe(() => {
    renderDrawerItems();
  });

  // Initial render
  renderDrawerItems();
}

function createDrawerMarkup() {
  if (document.getElementById("cart-drawer")) return;

  // Create Overlay
  overlayEl = document.createElement("div");
  overlayEl.id = "cart-drawer-overlay";
  overlayEl.className = "cart-drawer-overlay";
  overlayEl.addEventListener("click", closeCartDrawer);
  document.body.appendChild(overlayEl);

  // Create Drawer
  drawerEl = document.createElement("aside");
  drawerEl.id = "cart-drawer";
  drawerEl.className = "cart-drawer";
  drawerEl.setAttribute("aria-label", "Panier d'achats");
  drawerEl.setAttribute("aria-modal", "true");
  drawerEl.setAttribute("role", "dialog");

  drawerEl.innerHTML = `
    <div class="drawer-header">
      <h2 class="drawer-title">
        <span>Votre Panier</span>
        <span class="cart-badge" id="drawer-badge">0</span>
      </h2>
      <button type="button" class="drawer-close-btn" id="drawer-close-btn" aria-label="Fermer le panier">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
    </div>
    <div class="drawer-body" id="drawer-body">
      <!-- Injected via renderDrawerItems -->
    </div>
    <div class="drawer-footer" id="drawer-footer">
      <!-- Injected via renderDrawerItems -->
    </div>
  `;

  document.body.appendChild(drawerEl);

  // Close button listener
  document.getElementById("drawer-close-btn")?.addEventListener("click", closeCartDrawer);

  // Escape key handler
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && drawerEl.classList.contains("is-active")) {
      closeCartDrawer();
    }
  });
}

export function openCartDrawer() {
  if (!drawerEl) initCartDrawer();
  drawerEl.classList.add("is-active");
  overlayEl.classList.add("is-active");
  document.body.classList.add("scroll-locked");
}

export function closeCartDrawer() {
  if (!drawerEl) return;
  drawerEl.classList.remove("is-active");
  overlayEl.classList.remove("is-active");
  document.body.classList.remove("scroll-locked");
}

function renderDrawerItems() {
  const bodyEl = document.getElementById("drawer-body");
  const footerEl = document.getElementById("drawer-footer");
  const badgeEl = document.getElementById("drawer-badge");
  if (!bodyEl || !footerEl) return;

  const items = cartState.getCart();
  const totalCount = cartState.getCartCount();
  const total = cartState.getCartTotal();

  if (badgeEl) badgeEl.textContent = totalCount;

  if (items.length === 0) {
    bodyEl.innerHTML = `
      <div class="drawer-empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="9" cy="21" r="1"></circle>
          <circle cx="20" cy="21" r="1"></circle>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
        </svg>
        <p>Votre panier est actuellement vide.</p>
        <a href="/shop" class="btn btn-primary btn-sm">Découvrir le drop</a>
      </div>
    `;
    footerEl.innerHTML = "";
    return;
  }

  // Render items
  bodyEl.innerHTML = `
    <div class="drawer-items-list">
      ${items
        .map((item) => {
          const variantText = item.variants && Object.keys(item.variants).length > 0
            ? Object.entries(item.variants).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join(" | ")
            : "";
          const safeName = escapeHtml(item.name);
          const safeCartId = escapeHtml(item.cartId);
          const safeImg = sanitizeImageUrl(item.image);
          return `
            <div class="drawer-item" data-cart-id="${safeCartId}">
              <img src="${safeImg}" alt="${safeName}" class="drawer-item-img" loading="lazy">
              <div class="drawer-item-info">
                <div>
                  <div class="drawer-item-name">${safeName}</div>
                  ${variantText ? `<div class="drawer-item-variants">${variantText}</div>` : ""}
                </div>
                <div class="drawer-item-actions">
                  <div class="drawer-qty-stepper">
                    <button type="button" class="qty-btn btn-minus" data-cart-id="${safeCartId}" aria-label="Diminuer">-</button>
                    <span class="qty-display">${Number(item.quantity) || 1}</span>
                    <button type="button" class="qty-btn btn-plus" data-cart-id="${safeCartId}" aria-label="Augmenter">+</button>
                  </div>
                  <span class="drawer-item-price">${formatPrice(item.price * item.quantity)}$</span>
                </div>
                <button type="button" class="drawer-remove-btn" data-cart-id="${safeCartId}">Supprimer</button>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  // Render footer
  const whatsappOrderUrl = buildCartWhatsAppUrl(items, total);
  footerEl.innerHTML = `
    <div class="drawer-delivery-notice">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Livraison express disponible à Kinshasa & International</span>
    </div>
    <div class="drawer-subtotal-row">
      <span class="subtotal-label">Total estimé</span>
      <span class="subtotal-amount">${formatPrice(total)}$</span>
    </div>
    <a href="/cart" class="btn btn-primary btn-full">Finaliser la commande</a>
    <a href="${whatsappOrderUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-whatsapp btn-full btn-sm">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.301-.15-1.78-.878-2.056-.979-.276-.1-.476-.15-.677.15-.2.3-.777.979-.953 1.18-.175.2-.351.225-.652.075-.3-.15-1.267-.467-2.413-1.488-.893-.795-1.496-1.777-1.672-2.078-.175-.3-.019-.462.131-.611.136-.134.301-.35.452-.525.15-.175.2-.3.301-.5.1-.2.05-.375-.025-.525-.075-.15-.677-1.632-.928-2.235-.245-.589-.494-.509-.677-.518-.175-.009-.376-.009-.577-.009-.2 0-.527.075-.802.375-.276.3-1.054 1.03-1.054 2.511s1.079 2.912 1.23 3.113c.15.2 2.122 3.24 5.14 4.544.718.31 1.278.495 1.716.634.72.229 1.375.197 1.894.12.578-.087 1.78-.727 2.031-1.428.251-.702.251-1.303.175-1.428-.075-.125-.275-.2-.576-.35z"/>
      </svg>
      Commander via WhatsApp
    </a>
  `;

  // Attach quantity and remove event listeners
  bodyEl.querySelectorAll(".btn-minus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cartId;
      const item = items.find((i) => i.cartId === id);
      if (item) cartState.updateQuantity(id, item.quantity - 1);
    });
  });

  bodyEl.querySelectorAll(".btn-plus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cartId;
      const item = items.find((i) => i.cartId === id);
      if (item) cartState.updateQuantity(id, item.quantity + 1);
    });
  });

  bodyEl.querySelectorAll(".drawer-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.cartId;
      cartState.removeFromCart(id);
    });
  });
}
