import { CONFIG } from './config.js';

function safeRead(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  getCart() {
    const cart = safeRead(CONFIG.storage.cart, {});
    return cart && typeof cart === 'object' ? cart : {};
  },
  setCart(cart) {
    try { localStorage.setItem(CONFIG.storage.cart, JSON.stringify(cart)); } catch {}
  },
  getTheme() {
    try { return localStorage.getItem(CONFIG.storage.theme); } catch { return null; }
  },
  setTheme(theme) {
    try { localStorage.setItem(CONFIG.storage.theme, theme); } catch {}
  }
};
