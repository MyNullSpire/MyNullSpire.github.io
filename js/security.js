import { safeHttpUrl } from './dom.js';

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFD\uFE70-\uFEFC\u200F\u2067]/u;
const ALLOWED = {
  A: new Set(['href','target','rel','title']),
  IMG: new Set(['src','alt','title','width','height','loading','decoding','referrerpolicy','fetchpriority','sizes','class']),
  CODE: new Set(['class']), PRE: new Set(['class']),
  INPUT: new Set(['type','checked','disabled','aria-label','class']),
  TABLE: new Set(['class']), THEAD: new Set(['class']), TBODY: new Set(['class']), TR: new Set(['class']), TH: new Set(['class']), TD: new Set(['class']),
  P:new Set(['class']), H1:new Set(['class']), H2:new Set(['class']), H3:new Set(['class']), H4:new Set(['class']), H5:new Set(['class']), H6:new Set(['class']),
  UL:new Set(['class']), OL:new Set(['class']), LI:new Set(['class']), BLOCKQUOTE:new Set(['class']), HR:new Set(['class']),
  STRONG:new Set(['class']), B:new Set(['class']), EM:new Set(['class']), I:new Set(['class']), DEL:new Set(['class']), S:new Set(['class']), U:new Set(['class']), MARK:new Set(['class']), KBD:new Set(['class']), SMALL:new Set(['class']), SUB:new Set(['class']), SUP:new Set(['class']), BR:new Set(['class']), SPAN:new Set(['class']),
  DIV:new Set(['class']), SECTION:new Set(['class']), ARTICLE:new Set(['class']), DETAILS:new Set(['class','open']), SUMMARY:new Set(['class']), FIGURE:new Set(['class']), FIGCAPTION:new Set(['class'])
};
const ALLOWED_TAGS = new Set([...Object.keys(ALLOWED)]);
const SAFE_CONTENT_CLASSES = new Set(['md-code','md-line','md-align-left','md-align-center','md-align-right','post-inline-image','post-inline-image-index','post-inline-image-original']);

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function escapeAttr(value) { return escapeHtml(value); }

export function detectDirection(text = '') {
  for (const char of String(text)) {
    if (!/[\p{L}\p{N}]/u.test(char)) continue;
    if (/[\p{N}]/u.test(char)) continue;
    if (RTL_RE.test(char)) return 'rtl';
    return 'ltr';
  }
  return 'ltr';
}
export function applyDirection(element, text = '') {
  const direction = detectDirection(text);
  element.dir = direction;
  element.classList.toggle('is-rtl', direction === 'rtl');
  element.classList.toggle('is-ltr', direction === 'ltr');
  return direction;
}

function validUrl(raw, image = false) {
  const url = safeHttpUrl(raw);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if (image && !['http:','https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch { return ''; }
}

function normalizeImageUrl(raw) {
  const href = validUrl(raw, true);
  if (!href) return '';
  try {
    const parsed = new URL(href);
    if (parsed.hostname.toLowerCase() === 'github.com') {
      const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(.+)$/i);
      if (match && /\.(?:png|jpe?g|gif|webp|avif|svg)$/i.test(match[3].split('?')[0])) {
        return new URL(`https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3]}`).href;
      }
    }
    return parsed.href;
  } catch { return href; }
}

function parseReferenceDefinitions(lines) {
  const refs = new Map();
  const kept = [];
  for (const line of lines) {
    const match = line.match(/^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/);
    if (!match) { kept.push(line); continue; }
    const key = match[1].trim().toLowerCase().replace(/\s+/g,' ');
    const url = match[2] || match[3] || '';
    const title = match[4] || match[5] || match[6] || '';
    const href = validUrl(url, false);
    if (key && href) refs.set(key, { href, title });
  }
  return { lines: kept, refs };
}

function parseDestination(inner) {
  let value = String(inner || '').trim();
  const titleMatch = value.match(/\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))\s*$/);
  const title = titleMatch ? (titleMatch[1] || titleMatch[2] || titleMatch[3] || '') : '';
  if (titleMatch) value = value.slice(0, titleMatch.index).trim();
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1,-1);
  value = value.replace(/\s*=\s*\d+(?:x\d*)?\s*$/i, '').trim();
  return { value, title };
}

const RAW_INLINE_TAG_RE = /^<\/?(?:br|strong|b|em|i|del|s|u|mark|kbd|small|sub|sup|a|img|span)(?:\s+[^<>]*?)?\/?>/i;

function inlineHtml(source, imageMode = 'post', refs = new Map()) {
  const text = String(source || '');
  let out = '';
  let i = 0;
  const pushText = value => { out += escapeHtml(value); };
  while (i < text.length) {
    const rawTag = text.slice(i).match(RAW_INLINE_TAG_RE);
    if (rawTag) {
      out += rawTag[0];
      i += rawTag[0].length;
      continue;
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end !== -1) { out += `<code>${escapeHtml(text.slice(i+1,end))}</code>`; i = end + 1; continue; }
    }
    if (text.startsWith('![', i)) {
      const closeAlt = text.indexOf('](', i + 2);
      if (closeAlt !== -1) {
        const end = text.indexOf(')', closeAlt + 2);
        if (end !== -1) {
          const alt = text.slice(i + 2, closeAlt);
          const inner = text.slice(closeAlt + 2, end).trim();
          const destination = parseDestination(inner);
          const href = normalizeImageUrl(destination.value);
          if (href) {
            const title = destination.title;
            const src = new URL(href); src.searchParams.set('v','1');
            const cls = imageMode === 'index' ? 'post-inline-image post-inline-image-index' : 'post-inline-image post-inline-image-original';
            const sizeAttrs = imageMode === 'index' ? ' width="640" height="360" loading="lazy" fetchpriority="low" sizes="(max-width: 720px) 100vw, 640px"' : ' loading="lazy" sizes="100vw"';
            out += `<img class="${cls}" src="${escapeAttr(src.href)}" alt="${escapeAttr(alt)}" decoding="async" referrerpolicy="no-referrer"${title ? ` title="${escapeAttr(title)}"` : ''}${sizeAttrs}>`;
            i = end + 1; continue;
          }
        }
      }
    }
    if (text[i] === '[') {
      const close = text.indexOf('](', i + 1);
      if (close !== -1) {
        const end = text.indexOf(')', close + 2);
        if (end !== -1) {
          const label = text.slice(i + 1, close);
          const inner = text.slice(close + 2, end).trim();
          const destination = parseDestination(inner);
          const href = validUrl(destination.value, false);
          if (href) {
            const title = destination.title;
            out += `<a href="${escapeAttr(href)}" target="_blank" rel="noreferrer noopener"${title ? ` title="${escapeAttr(title)}"` : ''}>${inlineHtml(label, imageMode, refs)}</a>`;
            i = end + 1; continue;
          }
        }
      }
    }
    if (text.startsWith('![') || text[i] === '[') {
      const isImage = text.startsWith('![', i);
      const start = i + (isImage ? 2 : 1);
      const close = text.indexOf(']', start);
      if (close !== -1) {
        const label = text.slice(start, close);
        let end = close + 1;
        let refKey = '';
        if (text[end] === '[') {
          const refClose = text.indexOf(']', end + 1);
          if (refClose !== -1) { refKey = text.slice(end + 1, refClose) || label; end = refClose + 1; }
        } else if (label) {
          refKey = label;
        }
        const ref = refs.get(String(refKey).trim().toLowerCase().replace(/\s+/g,' '));
        if (ref) {
          if (isImage) {
            const src = new URL(ref.href); src.searchParams.set('v','1');
            const cls = imageMode === 'index' ? 'post-inline-image post-inline-image-index' : 'post-inline-image post-inline-image-original';
            const sizeAttrs = imageMode === 'index' ? ' width="640" height="360" loading="lazy" fetchpriority="low" sizes="(max-width: 720px) 100vw, 640px"' : ' loading="lazy" sizes="100vw"';
            out += `<img class="${cls}" src="${escapeAttr(src.href)}" alt="${escapeAttr(label)}" decoding="async" referrerpolicy="no-referrer"${ref.title ? ` title="${escapeAttr(ref.title)}"` : ''}${sizeAttrs}>`;
          } else {
            out += `<a href="${escapeAttr(ref.href)}" target="_blank" rel="noreferrer noopener"${ref.title ? ` title="${escapeAttr(ref.title)}"` : ''}>${inlineHtml(label || ref.href, imageMode, refs)}</a>`;
          }
          i = end; continue;
        }
      }
    }
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const marker = text.slice(i,i+2); const end = text.indexOf(marker, i + 2);
      if (end > i + 2) { out += `<strong>${inlineHtml(text.slice(i+2,end), imageMode, refs)}</strong>`; i=end+2; continue; }
    }
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2);
      if (end > i + 2) { out += `<del>${inlineHtml(text.slice(i+2,end), imageMode, refs)}</del>`; i=end+2; continue; }
    }
    if (text[i] === '*' || text[i] === '_') {
      const marker = text[i]; const end = text.indexOf(marker, i + 1);
      if (end > i + 1 && !/^\s/.test(text[i+1]) && !/\s$/.test(text.slice(i+1,end))) {
        out += `<em>${inlineHtml(text.slice(i+1,end), imageMode, refs)}</em>`; i=end+1; continue;
      }
    }
    if (text.startsWith('<https://', i) || text.startsWith('<http://', i)) {
      const end = text.indexOf('>', i + 1);
      if (end !== -1) {
        const url = validUrl(text.slice(i+1,end));
        if (url) { out += `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(url)}</a>`; i=end+1; continue; }
      }
    }
    const bare = text.slice(i).match(/^(https?:\/\/[^\s<>()"']+)/i);
    if (bare) {
      const raw = bare[1].replace(/[),.;]+$/g,'');
      const url = validUrl(raw);
      if (url) { out += `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">${escapeHtml(raw)}</a>`; i += raw.length; continue; }
    }
    pushText(text[i]); i += 1;
  }
  return out;
}

function renderBlocks(markdown, imageMode) {
  const rawLines = String(markdown || '').replace(/\r\n?/g,'\n').split('\n');
  const parsed = parseReferenceDefinitions(rawLines);
  const lines = parsed.lines;
  const refs = parsed.refs;
  const html=[]; let i=0;
  while (i<lines.length) {
    const line=lines[i];
    if (!line.trim()) { i++; continue; }
    const htmlBlockStart=line.match(/^\s*<(?:div|section|article|details|summary|figure|figcaption|p|h[1-6]|ul|ol|li|blockquote|table|thead|tbody|tr|th|td|pre)(?:\s+[^<>]*?)?\s*>/i);
    if (htmlBlockStart) {
      const buf=[];
      while(i<lines.length && lines[i].trim()){ buf.push(lines[i]); i++; }
      html.push(buf.join('\n'));
      continue;
    }
    const fence=line.match(/^\s*(```+|~~~+)\s*([^\s]*)?\s*$/);
    if (fence) {
      const marker=fence[1].slice(0,3); const buf=[]; i++;
      while(i<lines.length && !new RegExp(`^\\s*${marker}\\s*$`).test(lines[i])) { buf.push(lines[i]); i++; }
      if(i<lines.length) i++;
      html.push(`<pre class="md-code" dir="ltr"><code>${escapeHtml(buf.join('\n'))}</code></pre>`); continue;
    }
    const heading=line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(heading){ const tag=`h${heading[1].length}`; html.push(`<${tag} class="md-line">${inlineHtml(heading[2],imageMode,refs)}</${tag}>`); i++; continue; }
    if(/^\s*(---+|___+|\*\s*\*\s*\*)\s*$/.test(line)){ html.push('<hr>'); i++; continue; }
    if(/^\s*>/.test(line)){
      const buf=[]; while(i<lines.length && /^\s*>/.test(lines[i])){ buf.push(lines[i].replace(/^\s*>\s?/,'').trimEnd()); i++; }
      html.push(`<blockquote>${buf.map(x=>`<p class="md-line">${inlineHtml(x,imageMode,refs)}</p>`).join('')}</blockquote>`); continue;
    }
    if(/^\s*(?:[-+*]|\d+[.)])\s+/.test(line)){
      const ordered=/^\s*\d+[.)]\s+/.test(line); const tag=ordered?'ol':'ul'; const items=[];
      while(i<lines.length){ const m=lines[i].match(ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/); if(!m) break; let item=m[1]; let checked=''; const task=item.match(/^\[([ xX])\]\s+(.+)$/); if(task){ checked=`<input type="checkbox" disabled ${task[1].toLowerCase()==='x'?'checked':''} aria-label="Task">`; item=task[2]; } items.push(`<li class="md-line">${checked}${inlineHtml(item,imageMode,refs)}</li>`); i++; }
      html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    if(i+1<lines.length && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i+1])){
      const headers=lines[i].split('|').map(x=>x.trim()).filter(Boolean); const aligns=lines[i+1].split('|').map(x=>x.trim()).filter(Boolean).map(x=>x.startsWith(':')&&x.endsWith(':')?'center':x.startsWith(':')?'left':x.endsWith(':')?'right':'left'); i+=2; const rows=[]; while(i<lines.length && /\|/.test(lines[i]) && lines[i].trim()){ rows.push(lines[i].split('|').map(x=>x.trim()).filter(Boolean)); i++; }
      html.push(`<table class="md-table"><thead><tr>${headers.map((h,idx)=>`<th class="md-line md-align-${aligns[idx]||'left'}">${inlineHtml(h,imageMode,refs)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,idx)=>`<td class="md-line md-align-${aligns[idx]||'left'}">${inlineHtml(c,imageMode,refs)}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    const paragraph=[line]; i++; while(i<lines.length && lines[i].trim() && !/^\s*(#{1,6})\s+/.test(lines[i]) && !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[i]) && !/^\s*>/.test(lines[i]) && !/^\s*(```+|~~~+)/.test(lines[i]) && !/^\s*(---+|___+)/.test(lines[i])){ paragraph.push(lines[i]); i++; }
    const paragraphHtml=paragraph.map((x,idx)=>{ const hard=/ {2,}$|\\$/.test(x); const clean=hard?x.replace(/ {2,}$|\\$/,''):x; return `${idx?' ':''}${inlineHtml(clean,imageMode,refs)}${hard?'<br>':''}`; }).join('');
    html.push(`<p class="md-line">${paragraphHtml}</p>`); continue;
  }
  return html.join('');
}

function sanitizeGeneratedHtml(html) {
  const template=document.createElement('template');
  template.innerHTML=String(html||'');
  const walker=document.createTreeWalker(template.content,NodeFilter.SHOW_ELEMENT);
  const remove=[];
  while(walker.nextNode()){
    const el=walker.currentNode; const tag=el.tagName;
    if(!ALLOWED_TAGS.has(tag)){ remove.push(el); continue; }
    [...el.attributes].forEach(attr=>{
      const name=attr.name.toLowerCase(); const allowed=ALLOWED[tag]?.has(name);
      if(!allowed || name.startsWith('on') || name==='style' || name==='srcdoc') el.removeAttribute(attr.name);
      if(name==='class') {
        const safeClasses=String(el.getAttribute('class')||'').split(/\s+/).filter(value=>SAFE_CONTENT_CLASSES.has(value));
        if(safeClasses.length) el.setAttribute('class',safeClasses.join(' '));
        else el.removeAttribute('class');
      }
    });
    if(tag==='A'){
      const href=validUrl(el.getAttribute('href')); if(!href) el.removeAttribute('href'); else el.setAttribute('href',href);
      el.setAttribute('target','_blank'); el.setAttribute('rel','noreferrer noopener');
    }
    if(tag==='IMG'){
      const src=normalizeImageUrl(el.getAttribute('src')); if(!src) remove.push(el); else { el.setAttribute('src',src); el.setAttribute('loading','lazy'); el.setAttribute('decoding','async'); el.setAttribute('referrerpolicy','no-referrer'); }
    }
  }
  remove.reverse().forEach(el=>el.replaceWith(document.createTextNode(el.textContent||'')));
  return template.innerHTML;
}

export function extractFirstImageUrl(markdown='') {
  const html=sanitizeGeneratedHtml(renderBlocks(markdown,'post'));
  const template=document.createElement('template'); template.innerHTML=html;
  return template.content.querySelector('img')?.getAttribute('src') || '';
}

export function renderMarkdown(target, markdown, { imageMode='post', emptyText='' }={}) {
  target.innerHTML='';
  const source=String(markdown||'');
  if(!source.trim()){ if(emptyText) target.textContent=emptyText; return; }
  const safe=sanitizeGeneratedHtml(renderBlocks(source,imageMode));
  target.innerHTML=safe;
  target.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,th,td').forEach(el=>applyDirection(el,el.textContent||''));
  target.querySelectorAll('pre').forEach(el=>{el.dir='ltr'; el.classList.add('md-code');});
}
