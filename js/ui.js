import { categories } from './data.js';

export const $ = (selector, scope=document) => scope.querySelector(selector);
export const $$ = (selector, scope=document) => [...scope.querySelectorAll(selector)];
export const money = value => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);

function safeText(text='') {
  return String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
}

export function productCard(product) {
  return `<article class="product-card reveal visible" data-product-id="${product.id}">
    <div class="product-image-wrap" data-quick-view="${product.id}" role="button" tabindex="0" aria-label="View ${safeText(product.name)}"><img class="product-image" src="${product.image}" alt="${safeText(product.name)} product artwork" loading="lazy" width="1200" height="760"></div>
    <div class="product-top"><span class="category">${safeText(categories[product.category] || product.category)}</span><span class="price">${money(product.price)}</span></div>
    <h3>${safeText(product.name)}</h3>
    <p>${safeText(product.description)}</p>
    <div class="product-bottom"><span class="product-tag">${safeText(product.tag)}</span><div class="product-actions"><button class="quick-btn" data-quick-view="${product.id}" type="button">View</button><button class="add-btn" data-add="${product.id}" type="button">Add</button></div></div>
  </article>`;
}

export function renderProducts(container, products) {
  container.innerHTML = products.map(productCard).join('');
}

export function cartRow(item) {
  const {product, quantity} = item;
  return `<div class="cart-row" data-cart-row="${product.id}">
    <div class="cart-thumb"><img src="${product.image}" alt="" loading="lazy"></div>
    <div><h3>${safeText(product.name)}</h3><p>${safeText(product.tag)}</p><div class="cart-controls"><button class="qty-btn" data-qty="${product.id}" data-delta="-1" type="button" aria-label="Decrease quantity">−</button><span class="qty-value">${quantity}</span><button class="qty-btn" data-qty="${product.id}" data-delta="1" type="button" aria-label="Increase quantity">+</button><button class="remove" data-remove="${product.id}" type="button">Remove</button></div></div>
    <strong>${money(product.price * quantity)}</strong>
  </div>`;
}

export function renderCart(container, items) {
  container.innerHTML = items.length ? items.map(cartRow).join('') : '<div class="cart-empty">Your cart is empty.<br>Start with one protection layer and build from there.</div>';
}

export function checkoutDetail(items, total) {
  return `<div class="checkout-detail"><div class="eyebrow">Secure checkout</div><h2 id="modalTitle">Finish your order.</h2><p class="checkout-lead">This frontend is ready for a real checkout service. For this demo, submitting the form only creates a local order confirmation.</p><div class="checkout-summary">${items.map(item=>`<div><span>${safeText(item.product.name)} × ${item.quantity}</span><b>${money(item.product.price*item.quantity)}</b></div>`).join('')}<div class="checkout-total"><span>Total</span><strong>${money(total)}</strong></div></div><form class="checkout-form" id="checkoutForm"><div class="form-row"><label>Full name<input name="name" required placeholder="Alex Morgan"></label><label>Email<input type="email" name="email" required placeholder="alex@example.com"></label></div><label>Company (optional)<input name="company" placeholder="Your company"></label><label><span>Billing country</span><select name="country"><option>United States</option><option>United Kingdom</option><option>Germany</option><option>United Arab Emirates</option><option>Azerbaijan</option></select></label><label class="check-row"><input type="checkbox" required><span>I confirm these products are for lawful defensive use.</span></label><button class="button button-primary" type="submit">Place demo order <span>→</span></button></form></div>`;
}

export function productDetail(product) {
  return `<div class="product-detail"><img src="${product.image}" alt="${safeText(product.name)} artwork" width="1200" height="760"><div class="product-detail-copy"><div class="eyebrow">${safeText(categories[product.category] || product.category)}</div><h2 id="modalTitle">${safeText(product.name)}</h2><p>${safeText(product.description)}</p><div class="detail-price">${money(product.price)}</div><div class="detail-meta">${product.meta.map(meta=>`<div><small>INCLUDED</small><b>${safeText(meta)}</b></div>`).join('')}</div><div class="detail-actions"><button class="button button-primary" data-modal-add="${product.id}" type="button">Add to cart <span>→</span></button><button class="button-link" data-close-modal type="button">Keep browsing</button></div></div></div>`;
}
