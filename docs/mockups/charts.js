/* in2sight reference charts — hand-drawn SVG/HTML. The real app uses Recharts with the same visual spec. */
(function(){
let uid=0;const Charts={anim:true};
const K=n=>{const a=Math.abs(n);return a>=1e6?(n/1e6).toFixed(1).replace(/\.0$/,'')+'M':a>=1e3?(n/1e3).toFixed(1).replace(/\.0$/,'')+'K':String(Math.round(n*10)/10)};
const N=n=>Math.round(n).toLocaleString('en-US');
function nice(max,min=0){const span=(max-min)||1,raw=span/4,p=10**Math.floor(Math.log10(raw)),s=[1,2,2.5,5,10].find(m=>m*p>=raw)*p,lo=Math.floor(min/s)*s,hi=Math.ceil(max/s)*s,t=[];for(let v=lo;v<=hi+1e-9;v+=s)t.push(+v.toFixed(6));return{lo,hi,t}}
const col=(s,i)=>s.color||`var(--chart-${i%6+1})`;
function tip(el){let t=el.querySelector(':scope>.ctip');if(!t){t=document.createElement('div');t.className='ctip';el.appendChild(t)}return t}
function place(el,t,x,y){const w=t.offsetWidth,W=el.clientWidth;let l=x+14;if(l+w>W)l=x-w-14;t.style.left=Math.max(0,l)+'px';t.style.top=Math.max(0,y-t.offsetHeight-10)+'px'}
const anim=()=>Charts.anim&&window.gsap;
function mount(el,o,draw){
  el.classList.add('chart');el._hid=el._hid||new Set();let first=true;
  const run=()=>{el.innerHTML='';
    if(o.legend&&o.series){const lg=document.createElement('div');lg.className='legend';
      lg.innerHTML=o.series.map((s,i)=>`<button data-i="${i}" class="${el._hid.has(i)?'off':''}"><i style="background:${col(s,i)}"></i>${s.name}</button>`).join('');
      lg.onclick=e=>{const b=e.target.closest('button');if(!b)return;const i=+b.dataset.i;if(el._hid.has(i))el._hid.delete(i);else if(el._hid.size<o.series.length-1)el._hid.add(i);first=false;run()};el.appendChild(lg)}
    const p=document.createElement('div');p.className='plot';p.style.height=o.h+'px';el.appendChild(p);
    draw(p,el._hid,first&&Charts.anim);first=false};
  run();
  if(!el._ro){let w=el.clientWidth;el._ro=new ResizeObserver(()=>{if(Math.abs(el.clientWidth-w)>2){w=el.clientWidth;first=false;run()}});el._ro.observe(el)}
}
const M={l:38,r:8,t:8,b:22};
function xlabels(o,n,X,iw,H){const step=Math.ceil(n/Math.max(2,Math.floor(iw/58)));return o.labels.map((l,i)=>i%step===0?`<text x="${X(i)}" y="${H-6}" text-anchor="${i===0?'start':i===n-1?'end':'middle'}">${l}</text>`:'').join('')}

/* ---------- line / area ---------- */
function line(el,o){mount(el,o,(p,hid,first)=>{
  const W=p.clientWidth,H=o.h,iw=W-M.l-M.r,ih=H-M.t-M.b;
  const ser=o.series.map((s,i)=>({...s,i,color:col(s,i)})).filter(s=>!hid.has(s.i));
  const sc=nice(Math.max(...ser.flatMap(s=>s.data),1),0),n=o.labels.length,X=i=>M.l+i/(n-1)*iw,Y=v=>M.t+ih-(v-sc.lo)/(sc.hi-sc.lo)*ih,id='g'+(++uid);
  let s=`<svg width="${W}" height="${H}">`;
  if(o.area)s+=`<defs>${ser.map(x=>`<linearGradient id="${id}${x.i}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${x.color}" stop-opacity=".30"/><stop offset="1" stop-color="${x.color}" stop-opacity="0"/></linearGradient>`).join('')}</defs>`;
  s+=sc.t.map(v=>`<line x1="${M.l}" x2="${W-M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--border)" ${v===sc.lo?'':'stroke-dasharray="3 4"'}/><text x="${M.l-8}" y="${Y(v)+3}" text-anchor="end">${K(v)}</text>`).join('')+xlabels(o,n,X,iw,H);
  const d=a=>a.map((v,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  ser.forEach(x=>{if(o.area)s+=`<path class="ar" d="${d(x.data)}L${X(n-1)},${Y(sc.lo)}L${X(0)},${Y(sc.lo)}Z" fill="url(#${id}${x.i})"/>`;
    s+=`<path class="ln" d="${d(x.data)}" fill="none" stroke="${x.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${x.dashed?'stroke-dasharray="4 4" opacity=".6"':''}/>`});
  s+=`<line class="cx" y1="${M.t}" y2="${M.t+ih}" stroke="var(--muted-foreground)" stroke-dasharray="3 3" opacity="0"/>`+ser.map(x=>`<circle class="dt" r="4" fill="var(--surface)" stroke="${x.color}" stroke-width="2" opacity="0"/>`).join('')+`<rect class="hit" x="${M.l}" y="${M.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  p.innerHTML=s;const svg=p.firstChild,cx=svg.querySelector('.cx'),dts=[...svg.querySelectorAll('.dt')],t=tip(el),f=o.fmt||N;
  svg.querySelector('.hit').onpointermove=e=>{const r=svg.getBoundingClientRect(),i=Math.max(0,Math.min(n-1,Math.round((e.clientX-r.left-M.l)/iw*(n-1))));
    cx.setAttribute('x1',X(i));cx.setAttribute('x2',X(i));cx.setAttribute('opacity',1);
    dts.forEach((c,k)=>{c.setAttribute('cx',X(i));c.setAttribute('cy',Y(ser[k].data[i]));c.setAttribute('opacity',1)});
    t.innerHTML=`<b>${o.labels[i]}</b>`+ser.map(x=>`<div><i style="background:${x.color}"></i>${x.name}<span>${f(x.data[i])}</span></div>`).join('');t.style.opacity=1;
    const er=el.getBoundingClientRect();place(el,t,X(i)+p.getBoundingClientRect().left-er.left,e.clientY-er.top)};
  svg.querySelector('.hit').onpointerleave=()=>{cx.setAttribute('opacity',0);dts.forEach(c=>c.setAttribute('opacity',0));t.style.opacity=0};
  if(first&&anim()){svg.querySelectorAll('.ln').forEach(l=>{const L=l.getTotalLength();gsap.fromTo(l,{strokeDasharray:L,strokeDashoffset:L},{strokeDashoffset:0,duration:1.1,ease:'power2.inOut',clearProps:'strokeDasharray,strokeDashoffset'})});gsap.from(svg.querySelectorAll('.ar'),{opacity:0,duration:.8,delay:.4})}
})}

/* ---------- bars (grouped / stacked / diverging) ---------- */
function bars(el,o){mount(el,o,(p,hid,first)=>{
  const W=p.clientWidth,H=o.h,iw=W-M.l-M.r,ih=H-M.t-M.b,n=o.labels.length;
  const ser=o.series.map((s,i)=>({...s,i,color:col(s,i)})).filter(s=>!hid.has(s.i));
  let hi=0,lo=0;for(let j=0;j<n;j++){if(o.stacked){let a=0,b=0;ser.forEach(s=>s.data[j]>=0?a+=s.data[j]:b+=s.data[j]);hi=Math.max(hi,a);lo=Math.min(lo,b)}else ser.forEach(s=>{hi=Math.max(hi,s.data[j]);lo=Math.min(lo,s.data[j])})}
  const sc=nice(Math.max(hi,1),lo),Y=v=>M.t+ih-(v-sc.lo)/(sc.hi-sc.lo)*ih,bw=iw/n,k=o.stacked?1:ser.length,w1=Math.max(2,Math.min((bw*.7)/k-(k>1?2:0),30)),gw=k*w1+(k-1)*2;
  const X=i=>M.l+i*bw+bw/2;let s=`<svg width="${W}" height="${H}">`;
  s+=sc.t.map(v=>`<line x1="${M.l}" x2="${W-M.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="${v===0?'var(--muted-foreground)':'var(--border)'}" ${v===0||v===sc.lo?'':'stroke-dasharray="3 4"'} ${v===0?'opacity=".5"':''}/><text x="${M.l-8}" y="${Y(v)+3}" text-anchor="end">${K(v)}</text>`).join('')+xlabels(o,n,X,iw,H);
  for(let j=0;j<n;j++){let pos=0,neg=0;ser.forEach((x,q)=>{const v=x.data[j],x0=X(j)-gw/2+(o.stacked?0:q*(w1+2));let y0,y1;
    if(o.stacked){if(v>=0){y0=Y(pos);pos+=v;y1=Y(pos)}else{y0=Y(neg);neg+=v;y1=Y(neg)}}else{y0=Y(0);y1=Y(v)}
    const top=Math.min(y0,y1),h=Math.max(Math.abs(y0-y1),v?1:0);
    s+=`<rect class="b" data-j="${j}" x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${w1}" height="${h.toFixed(1)}" rx="${o.stacked?1.5:Math.min(4,w1/2)}" fill="${x.color}" ${o.stacked?'stroke="var(--surface)" stroke-width="1"':''} style="transform-box:fill-box;transform-origin:center ${v<0?'top':'bottom'};transition:opacity .12s"/>`})}
  s+=`<rect class="hit" x="${M.l}" y="${M.t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;p.innerHTML=s;
  const svg=p.firstChild,bs=[...svg.querySelectorAll('.b')],t=tip(el),f=o.fmt||N;
  svg.querySelector('.hit').onpointermove=e=>{const r=svg.getBoundingClientRect(),j=Math.max(0,Math.min(n-1,Math.floor((e.clientX-r.left-M.l)/bw)));
    bs.forEach(b=>b.style.opacity=b.dataset.j==j?1:.4);
    t.innerHTML=`<b>${o.labels[j]}</b>`+ser.map(x=>`<div><i style="background:${x.color}"></i>${x.name}<span>${f(x.data[j])}</span></div>`).join('')+(o.stacked&&ser.length>1?`<div style="border-top:1px solid var(--border);margin-top:3px;padding-top:3px">Σ<span>${f(ser.reduce((a,x)=>a+x.data[j],0))}</span></div>`:'');
    t.style.opacity=1;const er=el.getBoundingClientRect();place(el,t,X(j)+p.getBoundingClientRect().left-er.left,e.clientY-er.top)};
  svg.querySelector('.hit').onpointerleave=()=>{bs.forEach(b=>b.style.opacity=1);t.style.opacity=0};
  if(first&&anim())gsap.fromTo(bs,{scaleY:0},{scaleY:1,duration:.6,ease:'power3.out',stagger:.012,clearProps:'transform'});
})}

/* ---------- donut ---------- */
function donut(el,o){el.classList.add('chart','donut');
  const tot=o.parts.reduce((a,p)=>a+p.value,0),R=50,C=2*Math.PI*R,gap=2;let acc=0;
  const segs=o.parts.map((p,i)=>{const len=p.value/tot*C,s={...p,i,len,off:acc,color:col(p,i)};acc+=len;return s});
  el.innerHTML=`<svg width="140" height="140" viewBox="0 0 140 140"><g transform="rotate(-90 70 70)">`+segs.map(s=>`<circle data-i="${s.i}" cx="70" cy="70" r="${R}" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${Math.max(s.len-gap,1)} ${C-s.len+gap}" stroke-dashoffset="${-s.off}"/>`).join('')+`</g><text class="cv" x="70" y="68" text-anchor="middle" style="font:600 20px var(--font);fill:var(--foreground)">${o.center.v}</text><text class="cl" x="70" y="84" text-anchor="middle">${o.center.l}</text></svg><div class="dl2">`+segs.map(s=>`<div data-i="${s.i}"><i style="background:${s.color}"></i>${s.name}<b>${o.fmt?o.fmt(s.value):N(s.value)}</b><em>${Math.round(s.value/tot*100)}%</em></div>`).join('')+'</div>';
  const cs=[...el.querySelectorAll('circle')],rows=[...el.querySelectorAll('.dl2 div')],cv=el.querySelector('.cv'),cl=el.querySelector('.cl');
  const hl=i=>{cs.forEach((c,k)=>{c.style.opacity=i==null||k===i?1:.3;c.setAttribute('stroke-width',k===i?20:16)});rows.forEach((r,k)=>r.classList.toggle('hl',k===i));
    if(i==null){cv.textContent=o.center.v;cl.textContent=o.center.l}else{cv.textContent=Math.round(segs[i].value/tot*100)+'%';cl.textContent=segs[i].name}};
  [...cs,...rows].forEach(n=>{n.onpointerenter=()=>hl(+n.dataset.i);n.onpointerleave=()=>hl(null)});
  if(Charts.anim&&window.gsap){gsap.from(el.querySelector('g'),{rotation:-120,svgOrigin:'70 70',duration:.9,ease:'power3.out'});gsap.from(cs,{opacity:0,duration:.5,stagger:.1})}
}

/* ---------- heatmap ---------- */
function heat(el,o){el.classList.add('chart');const cols=o.cols.length;
  const vals=o.data.flat(),mx=Math.max(...vals),top=[...vals].sort((a,b)=>b-a)[2];
  el.innerHTML=`<div class="heat" style="grid-template-columns:28px repeat(${cols},1fr)"><span></span>`+o.cols.map((c,i)=>`<span style="text-align:center">${i%3===0?c:''}</span>`).join('')+o.rows.map((r,y)=>`<span>${r}</span>`+o.data[y].map((v,x)=>`<i data-y="${y}" data-x="${x}" class="${v>=top?'pk':''}" style="background:color-mix(in srgb,var(--primary) ${Math.round(6+v/mx*88)}%,var(--surface))"></i>`).join('')).join('')+`</div><div class="scale">${o.lo}<i></i>${o.hi}</div>`;
  const t=tip(el);
  el.querySelectorAll('.heat i').forEach(c=>{c.onpointermove=e=>{const y=+c.dataset.y,x=+c.dataset.x;t.innerHTML=`<b>${o.rows[y]} ${o.cols[x]}:00</b><div>${o.metric}<span>${o.data[y][x].toFixed(1)}%</span></div>`;t.style.opacity=1;const er=el.getBoundingClientRect(),cr=c.getBoundingClientRect();place(el,t,cr.left-er.left+cr.width/2,cr.top-er.top)};c.onpointerleave=()=>t.style.opacity=0});
  if(Charts.anim&&window.gsap)gsap.from(el.querySelectorAll('.heat i'),{scale:0,opacity:0,duration:.35,ease:'back.out(2)',stagger:{grid:[o.rows.length,cols],from:'center',amount:.8},clearProps:'transform'});
}

/* ---------- ring / spark / hbars / funnel ---------- */
function ring(el,o){const R=o.r||30,C=2*Math.PI*R,sz=R*2+14,pct=Math.min(1,o.value/o.max);el.classList.add('ring');
  el.innerHTML=`<svg width="${sz}" height="${sz}" viewBox="0 0 ${sz} ${sz}"><g transform="rotate(-90 ${sz/2} ${sz/2})"><circle cx="${sz/2}" cy="${sz/2}" r="${R}" fill="none" stroke="var(--surface-2)" stroke-width="7"/><circle class="v" cx="${sz/2}" cy="${sz/2}" r="${R}" fill="none" stroke="${o.color||'var(--chart-1)'}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C*(1-pct)}"/></g></svg><div class="c"><b>${o.text}</b><span>${o.label}</span></div>`;
  if(Charts.anim&&window.gsap)gsap.from(el.querySelector('.v'),{strokeDashoffset:C,duration:1.1,ease:'power2.out'});
}
function spark(el,o){const W=100,H=o.h||28,d=o.data,mn=Math.min(...d),mx=Math.max(...d),c=o.color||'var(--chart-1)',id='s'+(++uid),n=d.length;
  const Y=v=>H-3-(v-mn)/(mx-mn||1)*(H-6),X=i=>i/(n-1)*W,pts=d.map((v,i)=>`${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  let b=`<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="display:block">`;
  if(o.type==='bar'){const bw=W/n;b+=d.map((v,i)=>`<rect class="sb" x="${(i*bw+bw*.15).toFixed(1)}" y="${Y(v).toFixed(1)}" width="${(bw*.7).toFixed(1)}" height="${(H-Y(v)).toFixed(1)}" rx="1" fill="${c}" opacity="${.45+.55*(v-mn)/(mx-mn||1)}" style="transform-box:fill-box;transform-origin:bottom"/>`).join('')}
  else{if(o.type==='area')b+=`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".3"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><polygon points="0,${H} ${pts} ${W},${H}" fill="url(#${id})"/>`;
    b+=`<polyline class="sl" points="${pts}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>`}
  el.innerHTML=b+'</svg>';
  if(Charts.anim&&window.gsap){const l=el.querySelector('.sl');if(l){const L=l.getTotalLength();gsap.fromTo(l,{strokeDasharray:L,strokeDashoffset:L},{strokeDashoffset:0,duration:.9,ease:'power2.inOut',clearProps:'strokeDasharray,strokeDashoffset'})}else gsap.from(el.querySelectorAll('.sb'),{scaleY:0,duration:.5,stagger:.02,ease:'power3.out',clearProps:'transform'})}
}
function hbars(el,o){const mx=o.max||Math.max(...o.rows.map(r=>r.value));
  el.innerHTML=o.rows.map((r,i)=>`<div class="hb"><span>${r.label}</span><div class="tr"><div class="fl" data-w="${r.value/mx*100}" style="width:${r.value/mx*100}%;background:${r.color||col({},i)}"></div></div><b>${o.fmt?o.fmt(r.value):N(r.value)}</b></div>`).join('');
  if(Charts.anim&&window.gsap)gsap.from(el.querySelectorAll('.fl'),{width:0,duration:.8,ease:'power3.out',stagger:.07});
}
function funnel(el,o){const f=o.steps[0].value;
  el.innerHTML=o.steps.map((s,i)=>{const w=Math.max(s.value/f*100,8),cv=i?(s.value/o.steps[i-1].value*100).toFixed(1)+'%':'';return `<div class="fn"><span>${s.name}</span><div class="bar" data-w="${w}" style="width:${w}%;background:color-mix(in srgb,var(--chart-${(o.c||1)}) ${100-i*22}%,var(--surface))"><span>${N(s.value)}</span><span class="cv">${cv}</span></div></div>`}).join('');
  if(Charts.anim&&window.gsap)gsap.from(el.querySelectorAll('.bar'),{width:0,duration:.8,ease:'power3.out',stagger:.12});
}
Charts.line=line;Charts.bars=bars;Charts.donut=donut;Charts.heat=heat;Charts.ring=ring;Charts.spark=spark;Charts.hbars=hbars;Charts.funnel=funnel;Charts.K=K;Charts.N=N;
window.Charts=Charts;
})();
