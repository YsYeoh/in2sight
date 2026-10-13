/* in2sight reference kit — behaviour. Mockup only. */
(function(){
const P={search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',plus:'<path d="M12 5v14M5 12h14"/>',down:'<path d="m6 9 6 6 6-6"/>',up:'<path d="m18 15-6-6-6 6"/>',left:'<path d="m15 18-6-6 6-6"/>',right:'<path d="m9 18 6-6-6-6"/>',x:'<path d="M18 6 6 18M6 6l12 12"/>',check:'<path d="M20 6 9 17l-5-5"/>',minus:'<path d="M5 12h14"/>',
calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',filter:'<path d="M22 3H2l8 9.5V19l4 2v-8.5z"/>',more:'<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
refresh:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',alert:'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>',
ok:'<circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/>',aup:'<path d="M12 19V5M5 12l7-7 7 7"/>',adown:'<path d="M12 5v14M19 12l-7 7-7-7"/>',sort:'<path d="m7 15 5 5 5-5M7 9l5-5 5 5"/>',user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
sliders:'<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',dash:'<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
tag:'<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01"/>',globe:'<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/>',list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',cal2:'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18M8 2v4M16 2v4M8 14h.01M12 14h.01M16 14h.01"/>',
download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',eye:'<path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
cam:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17.5 6.5h.01"/>',lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',bell:'<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',flag:'<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'};
const icon=(n,s)=>`<svg class="ic" viewBox="0 0 24 24"${s?` style="width:${s}px;height:${s}px"`:''}>${P[n]||''}</svg>`;
const THEMES={ink:'Ink',sunset:'Sunset',forest:'Forest',mono:'Mono'};
const S={theme:'ink',mode:'l',d:'dense',lang:'en',rad:'soft'};
try{Object.assign(S,JSON.parse(localStorage.getItem('kit')||'{}'))}catch(e){}
let root,dict={en:{},zh:{}},bar;
const $$=(s,r=document)=>[...r.querySelectorAll(s)];
function save(){try{localStorage.setItem('kit',JSON.stringify(S))}catch(e){}}
function hydrate(r=document){$$('i[data-ic]',r).forEach(e=>{const t=document.createElement('span');t.style.display='contents';t.innerHTML=icon(e.dataset.ic,e.dataset.s);e.replaceWith(t.firstChild)})}
function t(k){return (dict[S.lang]||{})[k]??(dict.en||{})[k]??k}
function applyI18n(){$$('[data-i]').forEach(e=>e.textContent=t(e.dataset.i));$$('[data-ip]').forEach(e=>e.placeholder=t(e.dataset.ip));$$('[data-it]').forEach(e=>e.dataset.tip=t(e.dataset.it));document.documentElement.lang=S.lang==='zh'?'zh-CN':'en'}
function apply(){root.dataset.theme=S.theme;root.dataset.mode=S.mode;root.dataset.d=S.d;root.dataset.r=S.rad;
  $$('button',bar).forEach(b=>b.classList.toggle('on',b.dataset.t===S.theme||b.dataset.m===S.mode||b.dataset.d===S.d||b.dataset.l===S.lang||b.dataset.rad===S.rad));applyI18n();document.dispatchEvent(new Event('kit:change'))}
function toast(kind,title,msg){let c=document.querySelector('.toasts');if(!c){c=document.createElement('div');c.className='toasts ui';c.dataset.theme=S.theme;c.dataset.mode=S.mode;c.dataset.d=S.d;document.body.appendChild(c)}
  c.dataset.theme=S.theme;c.dataset.mode=S.mode;c.dataset.d=S.d;c.dataset.r=S.rad;
  const e=document.createElement('div');e.className='toast '+kind;e.innerHTML=icon(kind==='er'?'alert':kind==='ok'?'ok':'info',18)+`<div><b>${title}</b><span>${msg||''}</span></div>`;c.appendChild(e);
  setTimeout(()=>{e.classList.add('out');setTimeout(()=>e.remove(),220)},3200)}
function closeMenus(except){$$('.menu.open').forEach(m=>{if(m!==except){m.classList.remove('open');m.parentElement.querySelector('.select')?.classList.remove('open')}})}
function enter(){if(!window.gsap)return;gsap.fromTo($$('.sec,.demo,.card:not(.no-enter)',root),{y:10,opacity:0},{y:0,opacity:1,duration:.45,stagger:.025,ease:'power2.out',clearProps:'transform,opacity'})}
function init(opts={}){
  (window.__kl||[]).forEach(([t,f])=>document.removeEventListener(t,f));window.__kl=[];
  const on=(t,f)=>{window.__kl.push([t,f]);document.addEventListener(t,f)};
  dict=opts.i18n||dict;root=document.querySelector('.ui');
  bar=document.createElement('div');bar.className='ui-bar';
  bar.innerHTML=Object.entries(THEMES).map(([k,v])=>`<button data-t="${k}">${v}</button>`).join('')+'<span class="sep"></span><button data-m="l">Light</button><button data-m="d">Dark</button><span class="sep"></span><button data-d="dense">Dense</button><button data-d="comfy">Comfortable</button><span class="sep"></span><button data-rad="sharp">Sharp</button><button data-rad="soft">Soft</button><button data-rad="round">Round</button><span class="sep"></span><button data-l="en">EN</button><button data-l="zh">简体</button><span class="sep"></span><button data-r="1">▶ Replay</button>';
  root.prepend(bar);
  bar.onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.t)S.theme=b.dataset.t;if(b.dataset.m)S.mode=b.dataset.m;if(b.dataset.d)S.d=b.dataset.d;if(b.dataset.rad)S.rad=b.dataset.rad;if(b.dataset.l)S.lang=b.dataset.l;save();apply();if(b.dataset.r){enter();document.dispatchEvent(new Event('kit:replay'))}};
  hydrate(root);apply();
  on('click',e=>{
    const tr=e.target.closest('[data-menu]');
    if(tr){const pop=tr.closest('.pop'),m=pop.querySelector('.menu'),o=!m.classList.contains('open');closeMenus(m);m.classList.toggle('open',o);(pop.querySelector('.select')||tr).classList.toggle('open',o);return}
    const it=e.target.closest('.menu-item');
    if(it){const pop=it.closest('.pop'),sel=pop&&pop.querySelector('.select .v');
      if(sel&&!it.dataset.keep){it.parentElement.querySelectorAll('.menu-item').forEach(x=>x.classList.toggle('sel',x===it));sel.textContent=it.dataset.label||it.firstElementChild?.nextSibling?.textContent?.trim()||it.textContent.trim()}
      if(!it.dataset.keep)closeMenus();if(it.dataset.toast)fire(it.dataset.toast);return}
    if(!e.target.closest('.menu'))closeMenus();
    const tb=e.target.closest('.tab');if(tb){tb.parentElement.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on',x===tb));const g=tb.closest('[data-tabgroup]')||root;$$('.panel',g).forEach(p=>p.classList.toggle('on',p.id===tb.dataset.for))}
    const sg=e.target.closest('.seg button');if(sg)sg.parentElement.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===sg));
    const op=e.target.closest('[data-open]');if(op){const o=document.getElementById(op.dataset.open);o.classList.add('open');applyOverlay(o)}
    if(e.target.closest('[data-close]')||e.target.classList.contains('overlay'))e.target.closest('.overlay')?.classList.remove('open');
    const ts=e.target.closest('[data-toast]');if(ts)fire(ts.dataset.toast);
  });
  on('keydown',e=>{if(e.key==='Escape'){$$('.overlay.open').forEach(o=>o.classList.remove('open'));closeMenus()}});
  const ready=()=>{enter();document.dispatchEvent(new Event('kit:gsap'))};if(window.gsap)setTimeout(ready);else{const g=document.createElement('script');g.src='https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js';g.onload=ready;document.head.appendChild(g)}
}
function fire(s){const [k,a,b]=s.split('|');toast(k,a,b)}
function applyOverlay(o){o.classList.add('ui');o.dataset.theme=S.theme;o.dataset.mode=S.mode;o.dataset.d=S.d;o.dataset.r=S.rad}
window.UI={init,icon,hydrate,toast,t,state:S,enter};
})();
