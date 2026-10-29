import { fetchProducts, formatPrice, getEffectivePrice, hasProductVariants, getProductCategory, getProductCategoryLabel, slugify } from "../api.js";
import { cartState } from "../state.js";
import { openVariantModal } from "../components/variant-modal.js";
import { showToast } from "../components/toast.js";
import { openCartDrawer } from "../components/cart-drawer.js";
import { CONFIG } from "../config.js";
import { escapeHtml, sanitizeImageUrl } from "../utils/sanitize.js";

let allPublishedProducts = [];
let activeHomeFilter = "all";

export async function initHomePage() {
  setupIntersectionObserver();
  setupMarketingPopup();
  setupHomeCategoryTabs();
  await loadFeaturedDrops();
}

function setupHomeCategoryTabs() {
  const tabsContainer = document.getElementById("home-category-tabs");
  if (!tabsContainer) return;

  tabsContainer.querySelectorAll(".home-filter-pill").forEach((pill) => {
    pill.addEventListener("click", () => {
      const filterVal = pill.dataset.filter || "all";
      if (filterVal === activeHomeFilter) return;
      activeHomeFilter = filterVal;

      tabsContainer.querySelectorAll(".home-filter-pill").forEach((btn) => {
        const isCurrent = btn === pill;
        btn.classList.toggle("is-active", isCurrent);
        btn.setAttribute("aria-selected", isCurrent ? "true" : "false");
      });

      renderFeaturedDrops();
    });
  });
}

async function loadFeaturedDrops() {
  const container = document.getElementById("featured-drops-container");
  if (!container) return;

  const products = await fetchProducts();
  if (!products || products.length === 0) {
    container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--color-muted);">Impossible de charger les produits pour le moment.</p>`;
    return;
  }

  const publishedOnly = products.filter((p) => !p.status || p.status === "published");
  const seenIds = new Set();
  allPublishedProducts = [];
  publishedOnly.forEach((p) => {
    const id = p.id || p.slug || p.name;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      allPublishedProducts.push(p);
    }
  });

  renderFeaturedDrops();
}

function renderFeaturedDrops() {
  const container = document.getElementById("featured-drops-container");
  if (!container) return;

  const filtered = allPublishedProducts.filter((product) => {
    if (activeHomeFilter === "all") return true;
    const cat = getProductCategory(product);
    return cat === activeHomeFilter;
  });

  const displayList = filtered.slice(0, 8);

  if (displayList.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 48px 20px; color: var(--color-muted);">
        Aucune pièce disponible dans cet univers pour le moment.
      </div>
    `;
    return;
  }

  container.innerHTML = displayList
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

      const sizesList =
        product.variants && Array.isArray(product.variants.Taille) && product.variants.Taille.length > 0
          ? product.variants.Taille.slice(0, 5).map(escapeHtml).join(" · ")
          : "";

      let badgeHtml = "";
      if (product.soldOut) {
        badgeHtml = `<span class="badge badge-soldout">Épuisé</span>`;
      } else if (hasSale) {
        badgeHtml = `<span class="badge badge-drop" style="background:#b91c1c;">Offre</span>`;
      } else if (product.preOrder) {
        badgeHtml = `<span class="badge badge-preorder">Pré-commande</span>`;
      } else {
        badgeHtml = `<span class="badge badge-drop">Nouveau Drop</span>`;
      }

      const priceHtml = hasSale
        ? `<span class="product-price"><del style="opacity:0.45;font-size:0.84em;margin-right:6px;font-weight:500;">${formatPrice(product.price)}$</del>${formatPrice(effectivePrice)}$</span>`
        : `<span class="product-price">${formatPrice(effectivePrice)}$</span>`;

      const quickActionMarkup = product.soldOut
        ? ""
        : `
          <button type="button" class="editorial-quick-add quick-add-btn" data-product-id="${escapeHtml(product.id || product.slug || product.name)}" aria-label="Ajouter ${safeName}">
            <span>${needsVariantModal ? "+ Choisir la taille" : "+ Ajout rapide"}</span>
          </button>
        `;

      return `
        <article class="product-card editorial-product-card reveal ${product.soldOut ? "is-sold-out" : ""}" data-product-id="${slug}">
          <div class="product-media editorial-product-media">
            <div class="product-badges">${badgeHtml}</div>
            <a href="/product?p=${encodeURIComponent(product.slug || slugify(product.name))}" aria-label="Voir ${safeName}" class="product-media-link">
              <img src="${primaryImg}" alt="${safeName}" class="product-img img-primary" loading="lazy">
              ${
                hasSecondary
                  ? `<img src="${secondaryImg}" alt="${safeName} vue alternative" class="product-img img-secondary" loading="lazy">`
                  : `<img src="${primaryImg}" alt="${safeName}" class="product-img no-secondary" loading="lazy">`
              }
            </a>
            ${quickActionMarkup}
          </div>
          <div class="product-content editorial-product-meta">
            <div class="editorial-meta-top">
              <span class="product-category-tag">${safeCategory}</span>
              ${sizesList ? `<span class="editorial-sizes-hint">${sizesList}</span>` : ""}
            </div>
            <div class="editorial-meta-main">
              <h3 class="product-title">
                <a href="/product?p=${encodeURIComponent(product.slug || slugify(product.name))}">${safeName}</a>
              </h3>
              ${priceHtml}
            </div>
            ${
              product.soldOut
                ? ""
                : `<button type="button" class="editorial-mobile-add-btn quick-add-btn" data-product-id="${escapeHtml(product.id || product.slug || product.name)}">
                    ${needsVariantModal ? "Choisir la taille" : "Ajouter au panier"}
                  </button>`
            }
          </div>
        </article>
      `;
    })
    .join("");

  // Attach quick-add event listeners
  container.querySelectorAll(".quick-add-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const targetId = btn.dataset.productId;
      const product = allPublishedProducts.find(
        (p) => (p.id || p.slug || p.name) === targetId || p.name === targetId
      );
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
    { threshold: 0.1, rootMargin: "0px 0px -30px 0px" }
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
