import { products } from './data.js';
import { storage } from './storage.js';

export class Store {
  constructor() {
    this.filter = 'all';
    this.search = '';
    this.sort = 'featured';
    this.cart = storage.getCart();
  }
  setFilter(filter) { this.filter = filter; }
  setSearch(search) { this.search = search.trim().toLowerCase(); }
  setSort(sort) { this.sort = sort; }
  getProduct(id) { return products.find(product => product.id === id); }
  visibleProducts() {
    const filtered = products.filter(product => {
      const categoryMatch = this.filter === 'all' || product.category === this.filter;
      const haystack = `${product.name} ${product.tag} ${product.description}`.toLowerCase();
      const searchMatch = !this.search || haystack.includes(this.search);
      return categoryMatch && searchMatch;
    });
    return [...filtered].sort((a,b) => {
      if (this.sort === 'price-low') return a.price - b.price;
      if (this.sort === 'price-high') return b.price - a.price;
      if (this.sort === 'name') return a.name.localeCompare(b.name);
      return a.featured - b.featured;
    });
  }
  add(id, quantity=1) {
    if (!this.getProduct(id)) return;
    this.cart[id] = Math.max(0, (this.cart[id] || 0) + quantity);
    storage.setCart(this.cart);
  }
  update(id, quantity) {
    if (!this.getProduct(id)) return;
    if (quantity <= 0) delete this.cart[id]; else this.cart[id] = quantity;
    storage.setCart(this.cart);
  }
  remove(id) {
    delete this.cart[id];
    storage.setCart(this.cart);
  }
  count() { return Object.values(this.cart).reduce((sum, qty) => sum + qty, 0); }
  items() { return Object.entries(this.cart).map(([id, quantity]) => ({ product:this.getProduct(id), quantity })).filter(item => item.product); }
  total() { return this.items().reduce((sum, item) => sum + item.product.price * item.quantity, 0); }
}
