import { CONFIG } from "./config.js";
import { applyLocalStoreSync } from "./store-sync.js";
import { sanitizeImageUrl } from "./utils/sanitize.js";

/**
 * Format image path to always have a leading slash and safe protocol
 */
export function formatImageUrl(url) {
  return sanitizeImageUrl(url, "/logo.png");
}

/**
 * Compute effective price (taking salePrice into account when active)
 */
export function getEffectivePrice(product) {
  if (!product) return 0;
  const basePrice = Number(product.price) || 0;
  const sale = product.salePrice !== null && product.salePrice !== undefined && product.salePrice !== ""
    ? Number(product.salePrice)
    : null;
  if (sale !== null && Number.isFinite(sale) && sale > 0 && sale < basePrice) {
    return sale;
  }
  return basePrice;
}

/**
 * Determine whether a product requires variant selection before adding to cart
 */
export function hasProductVariants(product) {
  if (!product) return false;
  if (product.isVariable) return true;
  if (product.variants && typeof product.variants === "object") {
    return Object.values(product.variants).some((vals) => {
      if (!Array.isArray(vals) || vals.length === 0) return false;
      if (vals.length > 1) return true;
      const single = String(vals[0] || "").trim().toLowerCase();
      return single !== "unique" && single !== "tu" && single !== "taille unique";
    });
  }
  return false;
}

/**
 * Fetch products list from API / Store with real-time updates and strict draft filtering
 */
export async function fetchProducts(options = {}) {
  try {
    let data = null;
    try {
      const res = await fetch(`${CONFIG.PRODUCTS_URL}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
      });
      if (res.ok) {
        const parsed = await res.json();
        if (Array.isArray(parsed)) {
          data = parsed;
        }
      }
    } catch {
      // Fallback to static products.json only if API request failed
    }

    if (data === null) {
      const fallbackRes = await fetch(`/products.json?v=${Date.now()}`, { cache: "no-store" });
      if (fallbackRes.ok) {
        const fallbackParsed = await fallbackRes.json();
        if (Array.isArray(fallbackParsed)) {
          data = fallbackParsed;
        }
      }
    }

    if (!Array.isArray(data)) {
      data = [];
    }

    // Apply live store synchronization (status overrides, newly created pieces, deleted items)
    data = applyLocalStoreSync(data);

    // Normalize all image paths with leading slash
    data.forEach((p) => {
      if (Array.isArray(p.images) && p.images.length > 0) {
        p.images = p.images.map(formatImageUrl);
      } else {
        p.images = ["/logo.png"];
      }
    });

    // Unless explicitly requesting all products (admin), ONLY return published pieces to the storefront
    if (options.includeDrafts) {
      return data;
    }

    // Strict filter: Exclude any masked / draft piece
    const publishedProducts = data.filter((p) => p.status !== "draft");
    return publishedProducts;
  } catch (error) {
    console.error("Failed to load products", error);
    return [];
  }
}

/**
 * Clean text for search / comparisons
 */
export function normalizeText(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Create a URL slug
 */
export function slugify(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Format currency price
 */
export function formatPrice(value) {
  const price = Number(value) || 0;
  return Number.isInteger(price) ? String(price) : price.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * Categorize product by keywords
 */
export function getProductCategory(product) {
  if (product && product.category) return product.category;
  const name = normalizeText(product ? product.name : "");
  if (/(cap|bonnet|slide|slipper|sock|jic)/.test(name)) return "accessories";
  if (/(hoodie|pull|blazer|winter|crew)/.test(name)) return "outerwear";
  return "tops";
}

/**
 * Human-readable category label in French
 */
export function getProductCategoryLabel(product) {
  const cat = getProductCategory(product);
  if (cat === "accessories") return "Accessoire";
  if (cat === "outerwear") return "Outerwear";
  if (cat === "tops") return "Top & T-Shirt";
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

/**
 * Build WhatsApp pre-filled message URL for a single product
 */
export function buildProductWhatsAppUrl(product, selectedVariants = {}) {
  const variantParts = Object.entries(selectedVariants)
    .map(([key, val]) => `${key}: ${val}`)
    .join(", ");
  const variantText = variantParts ? ` (${variantParts})` : "";
  const effectivePrice = getEffectivePrice(product);
  const message = `Bonjour Jacmat Store ! Je souhaite commander : *${product.name}*${variantText} au prix de *${formatPrice(effectivePrice)}$*.\nPouvez-vous me confirmer la disponibilité et la livraison à Kinshasa ?`;
  return `https://api.whatsapp.com/send?phone=${CONFIG.WHATSAPP_PHONE}&text=${encodeURIComponent(message)}`;
}

/**
 * Build WhatsApp pre-filled message URL for an entire cart
 */
export function buildCartWhatsAppUrl(cartItems, total) {
  const itemsList = cartItems
    .map((item, idx) => {
      const variants = item.variants ? Object.entries(item.variants).map(([k, v]) => `${k}:${v}`).join(", ") : "";
      const varStr = variants ? ` [${variants}]` : "";
      return `${idx + 1}. *${item.name}* x${item.quantity}${varStr} - ${formatPrice(item.price * item.quantity)}$`;
    })
    .join("\n");

  const message = `Bonjour Jacmat Store ! Voici ma commande :\n\n${itemsList}\n\n*TOTAL : ${formatPrice(total)}$*\n\nJe souhaite organiser la livraison avec vous.`;
  return `https://api.whatsapp.com/send?phone=${CONFIG.WHATSAPP_PHONE}&text=${encodeURIComponent(message)}`;
}
