import { CONFIG } from "./config.js";

/**
 * JACMAT STORE — State Management
 * Persistent, reactive shopping cart with quantity aggregation.
 */
class CartState {
  constructor() {
    this.items = this.loadCart();
    this.listeners = [];
  }

  loadCart() {
    try {
      const stored = localStorage.getItem(CONFIG.STORAGE_CART_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("Could not load cart from localStorage", e);
      return [];
    }
  }

  saveCart() {
    try {
      localStorage.setItem(CONFIG.STORAGE_CART_KEY, JSON.stringify(this.items));
    } catch (e) {
      console.warn("Could not save cart to localStorage", e);
    }
    this.notify();
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach((listener) => listener(this.items));
  }

  generateKey(productName, variants = {}) {
    const variantStr = Object.entries(variants)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join("|");
    return `${productName}_${variantStr}`.toLowerCase().replace(/[^a-z0-9|:]/g, "-");
  }

  addToCart(product, variants = {}, quantity = 1) {
    const qty = Math.max(1, Number(quantity) || 1);
    const cartId = this.generateKey(product.name, variants);
    const existingIndex = this.items.findIndex((item) => item.cartId === cartId);

    const basePrice = Number(product.price) || 0;
    const salePrice = product.salePrice !== null && product.salePrice !== undefined && product.salePrice !== ""
      ? Number(product.salePrice)
      : null;
    const effectivePrice = salePrice !== null && Number.isFinite(salePrice) && salePrice > 0 && salePrice < basePrice
      ? salePrice
      : basePrice;

    if (existingIndex > -1) {
      this.items[existingIndex].quantity += qty;
      this.items[existingIndex].price = effectivePrice;
    } else {
      this.items.push({
        cartId,
        name: String(product.name || ""),
        price: effectivePrice,
        image: Array.isArray(product.images) && product.images[0] ? product.images[0] : "/logo.png",
        variants: { ...variants },
        quantity: qty,
        preOrder: Boolean(product.preOrder)
      });
    }

    this.saveCart();
    return this.items;
  }

  updateQuantity(cartId, newQuantity) {
    const qty = Number(newQuantity);
    if (qty <= 0) {
      this.removeFromCart(cartId);
      return;
    }

    const item = this.items.find((i) => i.cartId === cartId);
    if (item) {
      item.quantity = Math.min(20, qty);
      this.saveCart();
    }
  }

  removeFromCart(cartId) {
    this.items = this.items.filter((i) => i.cartId !== cartId);
    this.saveCart();
  }

  clearCart() {
    this.items = [];
    this.saveCart();
  }

  getCart() {
    return [...this.items];
  }

  getCartCount() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  getCartTotal() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }
}

export const cartState = new CartState();
