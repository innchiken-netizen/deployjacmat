import { fetchProducts, formatPrice, getEffectivePrice, hasProductVariants, getProductCategoryLabel, slugify } from "../api.js";
import { cartState } from "../state.js";
import { openVariantModal } from "../components/variant-modal.js";
import { showToast } from "../components/toast.js";
import { openCartDrawer } from "../components/cart-drawer.js";
import { CONFIG } from "../config.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

export async function initHomePage() {
  setupIntersectionObserver();
  setupMarketingPopup();
  await loadFeaturedDrops();
}

async function loadFeaturedDrops() {
  const container = document.getElementById("featured-drops-container");
  if (!container) return;

  const products = await fetchProducts();
  if (!products || products.length === 0) {
    container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--color-muted);">Impossible de charger les produits pour le moment.</p>`;
    return;
  }

  // Curate top featured products (SS80, 1on1, NO CAP, FOR THE 10s, SLIPPERS, Winter Blazer)
  const featuredNames = [
    "SS80",
    "The collection : 1on1",
    "NO CAP",
    "FOR THE 10s ONLY",
    "SLIPPERS VPMLM",
    "Take Over the World",
    "Winter Blazer",
    "JIC"
  ];

  const publishedOnly = products.filter((p) => !p.status || p.status === "published");
  const seenIds = new Set();
  const topFeatured = [];
  publishedOnly.forEach((p) => {
    const id = p.id || p.slug || p.name;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      topFeatured.push(p);
    }
  });

  container.innerHTML = topFeatured
    .slice(0, 8)
    .map((product) => {
      const primaryImg = sanitizeImageUrl(product.images?.[0]);
      const secondaryImg = sanitizeImageUrl(product.images?.[1] || primaryImg);
      const hasSecondary = Array.isArray(product.images) && product.images.length > 1;
      const slug = escapeHtml(product.slug || slugify(product.name));
      const safeName = escapeHtml(product.name);
      const safeCategory = escapeHtml(getProductCategoryLabel(product));
      const effectivePrice = getEffectivePrice(product);
      const hasSale = effectivePrice < Number(product.price);
      const needsVariantModal = hasProductVariants(product);

      let badgeHtml = "";
      if (product.soldOut) {
        badgeHtml = `<span class="badge badge-soldout">Sold Out</span>`;
      } else if (product.preOrder) {
        badgeHtml = `<span class="badge badge-preorder">Pre-Order</span>`;
      } else {
        badgeHtml = `<span class="badge badge-drop">Drop</span>`;
      }

      const priceHtml = hasSale
        ? `<span class="product-price"><del style="opacity:0.5;font-size:0.85em;margin-right:4px;">${formatPrice(product.price)}$</del>${formatPrice(effectivePrice)}$</span>`
        : `<span class="product-price">${formatPrice(effectivePrice)}$</span>`;

      return `
        <article class="product-card reveal ${product.soldOut ? "is-sold-out" : ""}" data-product-id="${slug}">
          <div class="product-media">
            <div class="product-badges">${badgeHtml}</div>
            <a href="/product?p=${encodeURIComponent(product.slug || slugify(product.name))}" aria-label="Voir ${safeName}">
              <img src="${primaryImg}" alt="${safeName}" class="product-img img-primary" loading="lazy">
              ${
                hasSecondary
                  ? `<img src="${secondaryImg}" alt="${safeName} vue alternative" class="product-img img-secondary" loading="lazy">`
                  : `<img src="${primaryImg}" alt="${safeName}" class="product-img no-secondary" loading="lazy">`
              }
            </a>
          </div>
          <div class="product-content">
            <div>
              <div class="product-category-tag">${safeCategory}</div>
              <h3 class="product-title">
                <a href="/product?p=${encodeURIComponent(product.slug || slugify(product.name))}">${safeName}</a>
              </h3>
            </div>
            <div class="product-bottom-row">
              ${priceHtml}
              ${
                product.soldOut
                  ? `<span class="badge badge-soldout">Épuisé</span>`
                  : `<button type="button" class="product-quick-btn quick-add-btn" data-product-id="${escapeHtml(product.id || product.slug || product.name)}">
                      ${needsVariantModal ? "Options" : "Ajouter"}
                    </button>`
              }
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  // Attach quick-add event listeners
  container.querySelectorAll(".quick-add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.productId;
      const product = products.find((p) => (p.id || p.slug || p.name) === targetId || p.name === targetId);
      if (!product) return;

      if (hasProductVariants(product)) {
        openVariantModal(product);
      } else {
        cartState.addToCart(product);
        showToast(`Ajouté au panier : ${product.name}`);
        openCartDrawer();
      }
    });
  });

  // Re-run intersection observer on newly rendered cards
  setupIntersectionObserver();
}

function setupIntersectionObserver() {
  const elements = document.querySelectorAll(".reveal:not(.is-visible)");
  if (!elements.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
  );

  elements.forEach((el) => observer.observe(el));
}

function setupMarketingPopup() {
  const popup = document.getElementById("marketing-popup");
  const closeBtn = document.getElementById("close-marketing-popup");
  if (!popup || !closeBtn) return;

  try {
    if (sessionStorage.getItem(CONFIG.STORAGE_POPUP_KEY)) return;
  } catch (e) {
    // Storage access fallback
  }

  const timer = setTimeout(() => {
    popup.classList.add("is-active");
  }, 18000);

  const dismiss = () => {
    popup.classList.remove("is-active");
    clearTimeout(timer);
    try {
      sessionStorage.setItem(CONFIG.STORAGE_POPUP_KEY, "true");
    } catch (e) {}
  };

  closeBtn.addEventListener("click", dismiss);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popup.classList.contains("is-active")) {
      dismiss();
    }
  });
}
