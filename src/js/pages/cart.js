import { cartState } from "../state.js";
import { formatPrice, buildCartWhatsAppUrl } from "../api.js";
import { CONFIG } from "../config.js";
import { showToast } from "../components/toast.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

export function initCartPage() {
  const itemsContainer = document.getElementById("cart-page-items");
  const subtotalEl = document.getElementById("cart-page-subtotal");
  const totalEl = document.getElementById("cart-page-total");
  const orderForm = document.getElementById("cart-order-form");
  const clearCartBtn = document.getElementById("clear-cart-page-btn");
  const whatsappOrderBtn = document.getElementById("cart-whatsapp-order-btn");

  function renderCartPage() {
    const items = cartState.getCart();
    const total = cartState.getCartTotal();

    if (subtotalEl) subtotalEl.textContent = `${formatPrice(total)}$`;
    if (totalEl) totalEl.textContent = `${formatPrice(total)}$`;

    // Update WhatsApp link
    if (whatsappOrderBtn) {
      whatsappOrderBtn.href = buildCartWhatsAppUrl(items, total);
      whatsappOrderBtn.style.display = items.length === 0 ? "none" : "inline-flex";
    }

    if (!itemsContainer) return;

    if (items.length === 0) {
      itemsContainer.innerHTML = `
        <div class="catalog-empty-state">
          <h3>Votre panier est vide</h3>
          <p>Vous n'avez pas encore sélectionné de pièce. Découvrez les drops exclusifs Jacmat Store.</p>
          <a href="/shop" class="btn btn-primary btn-sm">Explorer la boutique</a>
        </div>
      `;
      if (orderForm) {
        orderForm.querySelectorAll("input, button").forEach((el) => {
          el.disabled = true;
        });
      }
      return;
    }

    if (orderForm) {
      orderForm.querySelectorAll("input, button").forEach((el) => {
        el.disabled = false;
      });
    }

    itemsContainer.innerHTML = `
      <div class="cart-table-card">
        <div class="cart-table-header">
          <span>Articles sélectionnés (${items.length})</span>
          <span>Prix & Quantité</span>
        </div>
        <div class="cart-table-body">
          ${items
            .map((item) => {
              const variantText = item.variants && Object.keys(item.variants).length > 0
                ? Object.entries(item.variants).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join(" | ")
                : "";
              const safeName = escapeHtml(item.name);
              const safeCartId = escapeHtml(item.cartId);
              const safeImg = sanitizeImageUrl(item.image);
              return `
                <div class="cart-table-row" data-cart-id="${safeCartId}">
                  <img src="${safeImg}" alt="${safeName}" class="cart-row-img" loading="lazy">
                  <div class="cart-row-details">
                    <h3 class="cart-row-name">${safeName}</h3>
                    ${variantText ? `<div class="cart-row-variants">${variantText}</div>` : ""}
                    <div class="cart-row-price">${formatPrice(item.price)}$</div>
                  </div>
                  <div class="cart-row-actions">
                    <div class="drawer-qty-stepper">
                      <button type="button" class="qty-btn btn-cart-minus" data-cart-id="${safeCartId}" aria-label="Diminuer">-</button>
                      <span class="qty-display">${Number(item.quantity) || 1}</span>
                      <button type="button" class="qty-btn btn-cart-plus" data-cart-id="${safeCartId}" aria-label="Augmenter">+</button>
                    </div>
                    <span style="font-family: var(--font-display); font-weight: 800; font-size: var(--text-sm);">
                      ${formatPrice(item.price * item.quantity)}$
                    </span>
                    <button type="button" class="drawer-remove-btn btn-cart-remove" data-cart-id="${safeCartId}">Retirer</button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;

    // Attach row events
    itemsContainer.querySelectorAll(".btn-cart-minus").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cartId;
        const item = items.find((i) => i.cartId === id);
        if (item) cartState.updateQuantity(id, item.quantity - 1);
      });
    });

    itemsContainer.querySelectorAll(".btn-cart-plus").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cartId;
        const item = items.find((i) => i.cartId === id);
        if (item) cartState.updateQuantity(id, item.quantity + 1);
      });
    });

    itemsContainer.querySelectorAll(".btn-cart-remove").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.cartId;
        cartState.removeFromCart(id);
      });
    });
  }

  // Subscribe to updates
  cartState.subscribe(renderCartPage);
  renderCartPage();

  // Clear cart button
  clearCartBtn?.addEventListener("click", () => {
    if (confirm("Êtes-vous sûr de vouloir vider votre panier ?")) {
      cartState.clearCart();
      showToast("Panier vidé");
    }
  });

  // Web3Forms Submit Handling
  if (orderForm) {
    orderForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const items = cartState.getCart();
      if (items.length === 0) {
        alert("Votre panier est vide. Veuillez ajouter des pièces avant de commander.");
        return;
      }

      const submitBtn = orderForm.querySelector("button[type='submit']");
      const originalText = submitBtn.innerHTML;

      // Populate hidden fields
      const articlesInput = document.getElementById("articles-panier-hidden");
      const totalInput = document.getElementById("total-a-payer-hidden");
      const redirectInput = document.getElementById("redirect-hidden");

      const itemsDescription = items
        .map((item) => {
          const variants = item.variants ? Object.entries(item.variants).map(([k, v]) => `${k}:${v}`).join(", ") : "";
          const varStr = variants ? ` (${variants})` : "";
          return `${item.name} x${item.quantity}${varStr} [${formatPrice(item.price * item.quantity)}$]`;
        })
        .join(" | ");

      if (articlesInput) articlesInput.value = itemsDescription;
      if (totalInput) totalInput.value = `${formatPrice(cartState.getCartTotal())}$`;
      if (redirectInput) redirectInput.value = `${window.location.origin}/thanks`;

      // Set loading state
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin-icon" style="animation: spin 1s linear infinite;">
          <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
          <path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"></path>
        </svg>
        Validation en cours...
      `;

      try {
        const formData = new FormData(orderForm);
        const res = await fetch("https://api.web3forms.com/submit", {
          method: "POST",
          body: formData
        });

        const data = await res.json();
        if (data.success) {
          cartState.clearCart();
          window.location.href = "/thanks";
        } else {
          throw new Error(data.message || "Erreur de soumission");
        }
      } catch (err) {
        console.warn("AJAX submission fallback to native POST", err);
        // Fallback to native submission
        orderForm.submit();
      }
    });
  }
}
