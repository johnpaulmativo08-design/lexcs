// Admin → "View in 3D": a view-only 3D window for a customer's DIY design, opened from the order chat and from Orders.
// The model is the shop's own designer in view-only mode (index.html?…&embed=viewer: only the 3D stage, nothing
// saved, no price or cart), so it always matches what the customer designed. The bake sheet sits beside it.
import {escapeHtml as e,money} from './components.js?v=3';
import {designDetails} from './design-details.js?v=1';
import {designLink} from '../shared/design-link.js?v=1';

const STYLE=`
.dv{width:min(1200px,calc(100vw - 24px));height:min(820px,calc(100dvh - 24px));max-width:none;max-height:none;padding:0;border:0;border-radius:18px;background:#fff;color:#241a38;box-shadow:0 30px 80px rgba(30,16,60,.35);overflow:hidden}
.dv::backdrop{background:rgba(24,14,44,.55)}
.dv-frame{display:grid;grid-template-rows:auto auto minmax(0,1fr);height:100%}
.dv-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #eee6f6}
.dv-head h2{margin:0;font-size:18px;line-height:1.2}
.dv-head p{margin:2px 0 0;color:#7c6d91;font-size:13px}
.dv-head>div{flex:1;min-width:0}
.dv-close{display:grid;place-items:center;width:40px;height:40px;border:1px solid #e3d9f0;border-radius:12px;background:#fff;color:#3a2160;font-size:22px;line-height:1;cursor:pointer}
.dv-close:hover{background:#f6f1fd}
.dv-tabs{display:flex;gap:8px;overflow-x:auto;padding:10px 18px 0}
.dv-tabs:empty{display:none}
.dv-tabs button{flex:none;min-height:36px;padding:0 14px;border:1.5px solid #e1d6f1;border-radius:999px;background:#fff;color:#4b3a6b;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}
.dv-tabs button[aria-selected=true]{border-color:#7551aa;background:#f1eafd;color:#3b1f77}
.dv-body{display:grid;grid-template-columns:minmax(0,1fr) 340px;min-height:0}
.dv-stage{position:relative;min-height:0;background:#f6eefb}
.dv-stage iframe{position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;transition:opacity .25s ease}
.dv-stage iframe.is-ready{opacity:1}
.dv-loading{position:absolute;inset:0;display:grid;place-items:center;align-content:center;gap:10px;color:#6d5c86;font-size:14px}
.dv-loading i{width:34px;height:34px;border:3px solid #e1d3f4;border-top-color:#7551aa;border-radius:50%;animation:dv-spin .9s linear infinite}
@keyframes dv-spin{to{transform:rotate(360deg)}}
.dv-side{overflow:auto;padding:16px 18px;border-left:1px solid #eee6f6;font-size:14px}
.dv-side h3{margin:0 0 2px;font-size:16px}
.dv-side .dv-meta{margin:0 0 10px;color:#7c6d91;font-size:13px}
.dv-side .dv-summary{margin:0 0 10px;padding:10px 12px;border-radius:10px;background:#faf7fe;color:#3d3150;line-height:1.45}
.dv-side .dv-tip{margin:12px 0 0;color:#7c6d91;font-size:12.5px;line-height:1.45}
.dv-side .dv-open{display:inline-block;margin-top:10px;color:#5a32b8;font-size:13px;font-weight:700}
@media (max-width:820px){.dv{width:100vw;height:100dvh;border-radius:0}.dv-body{grid-template-columns:1fr;grid-template-rows:minmax(300px,58%) minmax(0,1fr)}.dv-side{border-left:0;border-top:1px solid #eee6f6}}
@media (prefers-reduced-motion:reduce){.dv-stage iframe{transition:none}.dv-loading i{animation:none}}`;

const kindName={bento:'Bento cake',cupcake:'Cupcakes',donut:'Mini donuts',cakepop:'Cake pops'};

export function openDesignViewer(lines,index=0,{title=''}={}){
  if(!document.getElementById('dv-style'))document.head.append(Object.assign(document.createElement('style'),{id:'dv-style',textContent:STYLE}));
  const list=(lines||[]).filter(line=>line?.design?.designer);
  if(!list.length)return;
  let current=Math.min(Math.max(0,index),list.length-1);
  const opener=document.activeElement;
  const dialog=document.createElement('dialog');
  dialog.className='dv';dialog.setAttribute('aria-labelledby','dv-title');
  dialog.innerHTML=`<div class="dv-frame"><header class="dv-head"><div><h2 id="dv-title"></h2><p>View only · drag to turn, scroll or pinch to zoom</p></div>
    <button type="button" class="dv-close" aria-label="Close 3D view">×</button></header>
    <div class="dv-tabs" role="tablist" aria-label="Designed items">${list.length>1?list.map((line,i)=>`<button type="button" role="tab" data-dv-tab="${i}">${e(line.name||kindName[line.design.designer])}${Number(line.qty)>1?' × '+Number(line.qty):''}</button>`).join(''):''}</div>
    <div class="dv-body"><div class="dv-stage"><div class="dv-loading" role="status"><i aria-hidden="true"></i>Building the 3D design…</div></div><aside class="dv-side"></aside></div></div>`;
  const stage=dialog.querySelector('.dv-stage'),side=dialog.querySelector('.dv-side'),loading=dialog.querySelector('.dv-loading');
  function show(i){
    current=i;const line=list[i],kind=line.design.designer;
    dialog.querySelector('#dv-title').textContent=[title,line.name||kindName[kind]].filter(Boolean).join(' · ');
    dialog.querySelectorAll('[data-dv-tab]').forEach(tab=>tab.setAttribute('aria-selected',String(Number(tab.dataset.dvTab)===i)));
    side.innerHTML=`<h3>${e(line.name||kindName[kind])}${Number(line.qty)>1?' × '+Number(line.qty):''}</h3>
      <p class="dv-meta">${e(kindName[kind]||'Custom design')}${line.unit_price!=null?' · '+money(line.unit_price)+(kind==='bento'?' per cake':' per box'):''}</p>
      ${line.summary?`<p class="dv-summary">${e(line.summary)}</p>`:''}${designDetails(line.design)}
      <p class="dv-tip">The 3D model is a guide. Bake from the details above; handmade decorations vary slightly.</p>
      <a class="dv-open" href="${e(designLink(line))}" target="_blank" rel="noopener">Open in the shop designer ↗</a>`;
    stage.querySelector('iframe')?.remove();loading.hidden=false;
    const frame=document.createElement('iframe');
    frame.title='3D view of '+(line.name||kindName[kind]);
    frame.src=designLink(line,{viewer:true});
    // the designer builds its 3D scene a moment after the page loads
    frame.addEventListener('load',()=>setTimeout(()=>{loading.hidden=true;frame.classList.add('is-ready');},900),{once:true});
    stage.append(frame);
  }
  dialog.querySelector('.dv-close').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  dialog.querySelectorAll('[data-dv-tab]').forEach(tab=>tab.onclick=()=>{if(Number(tab.dataset.dvTab)!==current)show(Number(tab.dataset.dvTab));});
  dialog.addEventListener('close',()=>{dialog.remove();if(opener?.isConnected)opener.focus({preventScroll:true});},{once:true});
  document.body.append(dialog);
  show(current);
  dialog.showModal();
  dialog.querySelector('.dv-close').focus();
}
