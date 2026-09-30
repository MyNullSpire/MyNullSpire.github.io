import { products, stories, reviews } from './data.js';
import { CONFIG } from './config.js';
import { storage } from './storage.js';
import { Store } from './store.js';
import { fetchLessons, repoUrl } from './github.js';
import { $, $$, money, renderProducts, renderCart, productDetail, checkoutDetail } from './ui.js';

const store = new Store();
const state = { storyIndex:0, reviewIndex:0 };

function initTheme(){
  const saved = storage.getTheme();
  const theme = saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme;
}
function toggleTheme(){
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  storage.setTheme(next);
}
function showToast(message){
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(()=>toast.classList.remove('show'),2200);
}
function openOverlay(open){
  const overlay = $('#overlay');
  overlay.hidden = !open;
  requestAnimationFrame(()=>overlay.classList.toggle('visible',open));
  document.body.classList.toggle('no-scroll',open);
}
function setCart(open){
  $('#cartDrawer').classList.toggle('open',open);
  $('#cartDrawer').setAttribute('aria-hidden',String(!open));
  openOverlay(open);
}
function updateCart(){
  $('#cartCount').textContent = store.count();
  $('#cartTotal').textContent = money(store.total());
  renderCart($('#cartItems'),store.items());
}
function renderCatalog(){
  const list = store.visibleProducts();
  renderProducts($('#productGrid'),list);
  $('#emptyState').hidden = list.length !== 0;
}
function filterCatalog(filter){
  $$('.filter').forEach(button=>button.classList.toggle('active',button.dataset.filter===filter));
  store.setFilter(filter);
  renderCatalog();
}
function openProduct(id){
  const product = store.getProduct(id);
  if(!product) return;
  $('#modalContent').innerHTML = productDetail(product);
  $('#modalLayer').hidden = false;
  document.body.classList.add('no-scroll');
}
function closeModal(){
  $('#modalLayer').hidden = true;
  document.body.classList.remove('no-scroll');
}
function addProduct(id){
  store.add(id);
  updateCart();
  showToast(`${store.getProduct(id).name} added to your cart.`);
}
function renderStories(){
  $('#storiesRail').innerHTML = stories.map(story=>`<article class="story-card" data-story-id="${story.id}" tabindex="0" role="button" aria-label="Open ${story.title}"><img src="${story.image}" alt="${story.title}" width="1080" height="1350" loading="lazy"><div class="story-copy"><span class="story-index">STORY ${story.index}</span><h3>${story.title}</h3><span class="story-time">${story.time} READ</span></div></article>`).join('');
}
function openStory(index){
  state.storyIndex = (index + stories.length) % stories.length;
  updateStoryViewer();
  $('#storyViewer').hidden=false;
  document.body.classList.add('no-scroll');
}
function closeStory(){ $('#storyViewer').hidden=true; document.body.classList.remove('no-scroll'); }
function updateStoryViewer(){
  const story = stories[state.storyIndex];
  $('#storyImage').src=story.image; $('#storyImage').alt=story.title; $('#storyTitle').textContent=story.title; $('#storyBody').textContent=story.body;
  const bar=$('.story-progress span'); bar.style.animation='none'; void bar.offsetWidth; bar.style.animation='storyProgress 6s linear both';
}
function renderReviews(){
  $('#reviewTrack').innerHTML = reviews.map(review=>`<article class="review-card"><div class="stars">★★★★★</div><blockquote>“${review.quote}”</blockquote><div class="review-author"><span class="avatar">${review.initials}</span><div><b>${review.name}</b><span>${review.role}</span></div></div></article>`).join('');
  updateReviewPosition();
}
function updateReviewPosition(){
  const track=$('#reviewTrack');
  const card=$('.review-card',track); if(!card) return;
  const gap=12;
  const perView=innerWidth<=760?1:innerWidth<=980?2:3;
  const step=card.getBoundingClientRect().width+gap;
  const max=Math.max(0,reviews.length-perView);
  state.reviewIndex=Math.min(state.reviewIndex,max);
  track.style.transform=`translate3d(${-state.reviewIndex*step}px,0,0)`;
}
function issueCardMarkup(issue){
  return `<article class="issue-card reveal visible"><img src="${issue.image}" alt="" loading="lazy" width="1200" height="760"><div class="issue-meta"><span class="issue-label">${issue.number ? `GitHub #${issue.number}` : 'LOCAL LESSON'}</span>${(issue.labels || []).map(label=>`<span class="issue-label">${label}</span>`).join('')}</div><h3>${issue.title}</h3><p>${issue.excerpt || 'Open the lesson for the full guide.'}</p><div class="issue-foot"><span>${issue.updatedAt ? `Updated ${new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric'}).format(new Date(issue.updatedAt))}` : 'Free lesson'}</span>${issue.url ? `<a href="${issue.url}" target="_blank" rel="noreferrer noopener">Read issue ↗</a>` : `<a href="#stories">Open story ↗</a>`}</div></article>`;
}
function renderIssueCards(issues){
  const grid=$('#issueGrid');
  grid.innerHTML = issues.length ? issues.map(issueCardMarkup).join('') : stories.slice(0,4).map(story=>issueCardMarkup({image:story.image,title:story.title,excerpt:story.body})).join('');
}
async function loadGitHubLessons(){
  $('#githubRepoLink').href = repoUrl();
  const status=$('#githubStatus');
  const grid=$('#issueGrid');
  grid.innerHTML='<div class="issue-skeleton"></div><div class="issue-skeleton"></div><div class="issue-skeleton"></div><div class="issue-skeleton"></div>';
  try{
    const issues=await fetchLessons();
    renderIssueCards(issues.slice(0,CONFIG.github.limit));
    status.innerHTML='<span class="status-dot"></span><span>Live from GitHub</span>';
  }catch(error){
    renderIssueCards([]);
    status.innerHTML='<span class="status-dot"></span><span>Local fallback</span>';
  }
}
function setupReveal(){
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const els=$$('.reveal');
  if(reduce){els.forEach(el=>el.classList.add('visible'));return;}
  const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('visible');observer.unobserve(entry.target);}}),{threshold:.12,rootMargin:'0px 0px -5% 0px'});
  els.forEach(el=>observer.observe(el));
}
function setupEvents(){
  $('#themeToggle').addEventListener('click',toggleTheme);
  $('#openCart').addEventListener('click',()=>setCart(true)); $('#closeCart').addEventListener('click',()=>setCart(false)); $('#overlay').addEventListener('click',()=>setCart(false));
  $('#menuToggle').addEventListener('click',()=>{const menu=$('#menuToggle'); const nav=$('#primaryNav'); const open=!nav.classList.contains('open'); nav.classList.toggle('open',open); menu.classList.toggle('is-open',open); menu.setAttribute('aria-expanded',String(open));});
  $$('.nav a').forEach(a=>a.addEventListener('click',()=>{$('#primaryNav').classList.remove('open');$('#menuToggle').classList.remove('is-open');$('#menuToggle').setAttribute('aria-expanded','false');}));
  $('#categoryFilters').addEventListener('click',e=>{const button=e.target.closest('[data-filter]');if(button) filterCatalog(button.dataset.filter);});
  $('#searchInput').addEventListener('input',e=>{store.setSearch(e.target.value);renderCatalog();}); $('#sortSelect').addEventListener('change',e=>{store.setSort(e.target.value);renderCatalog();});
  $('#productGrid').addEventListener('click',e=>{const add=e.target.closest('[data-add]');if(add){addProduct(add.dataset.add);return;}const quick=e.target.closest('[data-quick-view]');if(quick)openProduct(quick.dataset.quickView);});
  $('#productGrid').addEventListener('keydown',e=>{if(e.key!=='Enter'&&e.key!==' ')return;const quick=e.target.closest('[data-quick-view]');if(quick){e.preventDefault();openProduct(quick.dataset.quickView);}});
  $('#cartItems').addEventListener('click',e=>{const qty=e.target.closest('[data-qty]');const remove=e.target.closest('[data-remove]');if(qty){const id=qty.dataset.qty;const delta=Number(qty.dataset.delta);const current=store.cart[id]||0;store.update(id,current+delta);updateCart();}if(remove){store.remove(remove.dataset.remove);updateCart();}});
  $('#modalLayer').addEventListener('click',e=>{if(e.target.closest('[data-close-modal]'))closeModal();const add=e.target.closest('[data-modal-add]');if(add){addProduct(add.dataset.modalAdd);closeModal();setCart(true);}});
  $('#modalLayer').addEventListener('submit',e=>{if(e.target.id!=='checkoutForm')return;e.preventDefault();store.cart={};storage.setCart(store.cart);updateCart();closeModal();showToast('Demo order created. Connect your backend to process payment.');});
  $('#storiesRail').addEventListener('click',e=>{const card=e.target.closest('[data-story-id]');if(card)openStory(stories.findIndex(story=>story.id===card.dataset.storyId));});
  $('#storyPrev').addEventListener('click',()=>openStory(state.storyIndex-1)); $('#storyNext').addEventListener('click',()=>openStory(state.storyIndex+1)); $$('#storyViewer [data-close-story]').forEach(el=>el.addEventListener('click',closeStory));
  $('#reviewPrev').addEventListener('click',()=>{state.reviewIndex--;updateReviewPosition();}); $('#reviewNext').addEventListener('click',()=>{state.reviewIndex++;updateReviewPosition();});
  $('#addBundle').addEventListener('click',()=>{['identity-kit','shielddesk','restorebox'].forEach(id=>store.add(id));updateCart();showToast('Starter stack added to your cart.');setCart(true);});
  $('#checkoutBtn').addEventListener('click',()=>{
    if(!store.count()){showToast('Your cart is empty.');return;}
    setCart(false);
    $('#modalContent').innerHTML=checkoutDetail(store.items(),store.total());
    $('#modalLayer').hidden=false;
    document.body.classList.add('no-scroll');
  });
  $('#backTop').addEventListener('click',()=>scrollTo({top:0,behavior:'smooth'}));
  $('#contactLink').addEventListener('click',e=>{e.preventDefault();showToast('Add your support email or contact backend here.');});
  $$('[data-info-modal]').forEach(link=>link.addEventListener('click',e=>{
    e.preventDefault();
    const kind=link.dataset.infoModal;
    const title=kind==='privacy'?'Privacy & data':'Terms of service';
    const body=kind==='privacy'?'This demo storefront stores cart and theme preferences locally in the browser. Connect your production privacy policy and backend data handling before launch.':'This is a front-end demo. Replace the demo catalog, checkout, support and legal language with your production terms before launch.';
    $('#modalContent').innerHTML=`<div class="product-detail-copy"><div class="eyebrow">Company</div><h2 id="modalTitle">${title}</h2><p>${body}</p><div class="detail-actions"><button class="button button-primary" data-close-modal type="button">Close <span>×</span></button></div></div>`;
    $('#modalLayer').hidden=false; document.body.classList.add('no-scroll');
  }));
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){setCart(false);closeModal();closeStory();}});
  addEventListener('resize',()=>requestAnimationFrame(updateReviewPosition));
}
async function init(){
  initTheme();
  $('#year').textContent=new Date().getFullYear();
  renderCatalog(); renderStories(); renderReviews(); updateCart(); setupEvents(); setupReveal();
  requestAnimationFrame(()=>setTimeout(()=>$('#siteLoader').classList.add('is-hidden'),450));
  loadGitHubLessons();
}
init();
