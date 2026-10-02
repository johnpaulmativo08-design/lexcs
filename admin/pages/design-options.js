import {escapeHtml as e} from '../components.js?v=3';
import {db,rows,fail,loadingTable} from '../backend-ui.js?v=3';

// Prices and availability of the bento, cupcake, donut and cake pop designers' options (public.design_options,
// phases 32 and 36-38). Checkout prices designs on the server from this table, so a change applies to the next quote.
// One product at a time (product buttons), jump buttons per group, steppers and on/off switches; changes are
// collected and saved together from the bar at the bottom.
const GROUPS={
 bento:[['border','Borders'],['accent','Decorations'],['message','Message'],['lettering','Lettering styles'],['topper','Toppers'],['font','Message fonts'],['color','Colors (frosting, lettering, ribbon, drip)']],
 cupcake:[['flavor','Flavors'],['style','Piping styles'],['pattern','Box arrangement'],['finish','Finishing touches'],['theme','Theme toppers'],['color','Frosting colors']],
 cakepop:[['style','Pop shape'],['flavor','Flavors'],['pattern','Coating'],['finish','Finishes'],['sprinkle','Sprinkles'],['theme','Theme toppers'],['message','Fondant message'],['color','Coating, sprinkle and letter colors']],
 donut:[['flavor','Flavors'],['pattern','Glaze dip'],['finish','Finishes'],['sprinkle','Sprinkles'],['theme','Theme toppers'],['message','Fondant message'],['color','Glaze, sprinkle and letter colors']]};
const UNIT={bento:'cake',cupcake:'box',donut:'box',cakepop:'box'};
const EMOJI={bento:'🎂',cupcake:'🧁',donut:'🍩',cakepop:'🍭'};
const FREE=new Set(['color','font','flavor']);
const FILTERS=[['all','All'],['on','Offered'],['off','Hidden'],['paid','With extra charge']];
const STORE='lexc_admin_design_product';
const heading='<header class="module-heading"><div><h1>Designer options</h1><p>Extras charged for each choice in the bento, cupcake, donut and cake pop designers (per cake, or once per box). Turn an option off to hide it from customers.</p></div></header>';
const priceLocked=o=>(FREE.has(o.group_key)&&o.code!=='mix')||o.code==='none'||(o.group_key==='lettering'&&o.code==='piped');
const activeLocked=o=>o.code==='none'||(o.group_key==='lettering'&&o.code==='piped')||(o.group_key==='font'&&o.code==='rounded');
const peso=n=>'₱'+Number(n).toLocaleString('en-PH',{maximumFractionDigits:2});
const remember=(k,v)=>{try{localStorage.setItem(k,v);}catch{}};
const recall=k=>{try{return localStorage.getItem(k);}catch{return null;}};

export async function renderDesignOptions(content){
 content.innerHTML=heading+loadingTable(['Option','Extra','Offered',''],8);
 try{
  const options=await rows(db.client.from('design_options').select('id,product_id,group_key,code,label,price,hex,is_active,sort_order').order('group_key').order('sort_order'));
  const ids=[...new Set(options.map(o=>o.product_id))];
  const products=ids.length?await rows(db.client.from('products').select('id,name,customization_config').in('id',ids).order('name')):[];
  if(!options.length){content.innerHTML=heading+'<section class="panel"><p>No designer options yet. Apply database phase 32 first.</p></section>';return;}
  const kind=p=>['cupcake','donut','cakepop'].includes(p.customization_config?.designer)?p.customization_config.designer:'bento';
  const sorted=[...products].sort((a,b)=>kind(a).localeCompare(kind(b))||a.name.localeCompare(b.name));
  const byId=new Map(options.map(o=>[o.id,o]));
  const edits=new Map();   // option id -> {price, is_active} that differ from the saved row
  const view={product:sorted.some(p=>p.id===recall(STORE))?recall(STORE):sorted[0]?.id,filter:'all',query:''};

  // A fresh root each render, so event listeners never pile up on the shared content element.
  const root=document.createElement('div');root.className='dopt';
  content.innerHTML=heading;content.append(root);
  const current=o=>({price:edits.get(o.id)?.price??Number(o.price),is_active:edits.get(o.id)?.is_active??o.is_active});
  const setEdit=(o,patch)=>{
   const next={...current(o),...patch};
   if(next.price===Number(o.price)&&next.is_active===o.is_active)edits.delete(o.id);else edits.set(o.id,next);
  };
  const visible=o=>{
   const c=current(o),q=view.query.trim().toLowerCase();
   if(q&&!(o.label.toLowerCase().includes(q)||o.code.toLowerCase().includes(q)))return false;
   return view.filter==='all'||(view.filter==='on'&&c.is_active)||(view.filter==='off'&&!c.is_active)||(view.filter==='paid'&&c.price>0);
  };

  function rowHtml(o,unit){
   const c=current(o),changed=edits.has(o.id),pl=priceLocked(o),al=activeLocked(o);
   return '<div class="dopt-row'+(changed?' is-changed':'')+(c.is_active?'':' is-off')+'" data-option="'+e(o.id)+'">'
    +'<div class="dopt-name">'+(o.hex?'<span class="dopt-swatch" aria-hidden="true" style="background:'+e(o.hex)+'"></span>':'')+'<span><strong>'+e(o.label)+'</strong>'+(changed?'<em class="dopt-flag">Unsaved</em>':'')+'</span></div>'
    +'<div class="dopt-price">'+(pl?'<span class="dopt-free" title="This choice is always free">Always free</span>'
      :'<button type="button" class="dopt-step" data-step="-1" aria-label="₱1 less for '+e(o.label)+'"'+(c.price<=0?' disabled':'')+'>−</button>'
      +'<label class="sr-only" for="price-'+e(o.id)+'">Extra per '+unit+' for '+e(o.label)+'</label><span class="dopt-peso" aria-hidden="true">₱</span><input id="price-'+e(o.id)+'" type="number" min="0" max="10000" step="0.5" inputmode="decimal" value="'+c.price+'" data-price>'
      +'<button type="button" class="dopt-step" data-step="1" aria-label="₱1 more for '+e(o.label)+'">+</button>'
      +'<button type="button" class="dopt-chip" data-free'+(c.price===0?' disabled':'')+'>Free</button>')+'</div>'
    +'<div class="dopt-offer"><button type="button" class="dopt-switch" role="switch" aria-checked="'+c.is_active+'" data-toggle aria-label="Offer '+e(o.label)+' to customers"'+(al?' disabled title="Always offered"':'')+'><span class="dopt-knob" aria-hidden="true"></span><span class="dopt-switch-text">'+(c.is_active?'Offered':'Hidden')+'</span></button></div>'
    +'<div class="dopt-undo">'+(changed?'<button type="button" class="dopt-chip" data-undo aria-label="Undo changes to '+e(o.label)+'">Undo</button>':'')+'</div></div>';
  }

  function render(){
   const p=sorted.find(x=>x.id===view.product),k=kind(p),unit=UNIT[k];
   const groups=GROUPS[k].map(([key,title])=>({key,title,list:options.filter(o=>o.product_id===p.id&&o.group_key===key)})).filter(g=>g.list.length);
   const scroll=window.scrollY;
   root.innerHTML=
    '<nav class="dopt-products" aria-label="Choose a product">'+sorted.map(x=>{
      const n=[...edits.keys()].filter(id=>byId.get(id).product_id===x.id).length;
      return '<button type="button" data-product="'+e(x.id)+'" aria-pressed="'+(x.id===p.id)+'"><span aria-hidden="true">'+EMOJI[kind(x)]+'</span><span>'+e(x.name)+'</span>'+(n?'<b class="dopt-badge" title="Unsaved changes">'+n+'</b>':'')+'</button>';
    }).join('')+'</nav>'
    +'<div class="dopt-toolbar"><label class="dopt-search"><span class="sr-only">Find an option</span><input type="search" placeholder="Find an option…" value="'+e(view.query)+'" data-search></label>'
    +'<div class="dopt-filters" role="group" aria-label="Show">'+FILTERS.map(([v,l])=>'<button type="button" data-filter="'+v+'" aria-pressed="'+(view.filter===v)+'">'+l+'</button>').join('')+'</div></div>'
    +'<div class="dopt-jump" aria-label="Jump to a group">'+groups.map(g=>'<button type="button" data-jump="'+e(g.key)+'">'+e(g.title.replace(/ \(.*\)$/,''))+' <small>'+g.list.filter(o=>current(o).is_active).length+'/'+g.list.length+'</small></button>').join('')+'</div>'
    +groups.map(g=>{
      const shown=g.list.filter(visible);if(!shown.length)return '';
      const lockedAll=g.list.every(activeLocked);
      return '<section class="panel dopt-group" id="dopt-'+e(g.key)+'" data-group="'+e(g.key)+'"><header class="dopt-group-head"><div><h2>'+e(g.title)+'</h2><p>'+g.list.filter(o=>current(o).is_active).length+' of '+g.list.length+' offered · extra charged once per '+unit+'</p></div>'
       +(lockedAll?'':'<div class="dopt-group-actions"><button type="button" class="dopt-chip" data-all="on">Offer all</button><button type="button" class="dopt-chip" data-all="off">Hide all</button></div>')+'</header>'
       +'<div class="dopt-head" aria-hidden="true"><span>Option</span><span>Extra per '+unit+'</span><span>Customers see it</span><span></span></div>'
       +shown.map(o=>rowHtml(o,unit)).join('')+'</section>';
    }).join('')
    +(groups.some(g=>g.list.some(visible))?'':'<section class="panel"><p>No options match. <button type="button" class="dopt-chip" data-clear>Show everything</button></p></section>')
    +'<div class="dopt-bar" role="region" aria-label="Unsaved changes"'+(edits.size?'':' hidden')+'><span><strong>'+edits.size+'</strong> unsaved change'+(edits.size===1?'':'s')+'</span><span class="dopt-bar-status" role="status"></span><button type="button" class="button" data-discard>Undo all</button><button type="button" class="button primary" data-save-all>Save changes</button></div>';
   window.scrollTo(0,scroll);
  }

  // Re-render one row in place (keeps the cursor in a price box while typing), and the counters around it.
  function refresh(o,keepFocus){
   const row=root.querySelector('[data-option="'+o.id+'"]');
   if(!row||!keepFocus){render();return;}
   const input=row.querySelector('[data-price]'),sel=input?.selectionStart;
   const tmp=document.createElement('div');tmp.innerHTML=rowHtml(o,UNIT[kind(sorted.find(x=>x.id===o.product_id))]);
   const fresh=tmp.firstChild,freshInput=fresh.querySelector('[data-price]');
   // keep the live input element so typing is not interrupted
   if(input&&freshInput){freshInput.replaceWith(input);}
   row.replaceWith(fresh);
   if(input){input.focus();try{input.setSelectionRange(sel,sel);}catch{}}
   const bar=root.querySelector('.dopt-bar');bar.hidden=!edits.size;bar.querySelector('strong').textContent=edits.size;
   bar.querySelector('strong').nextSibling.textContent=' unsaved change'+(edits.size===1?'':'s');
  }

  async function saveAll(){
   const bar=root.querySelector('.dopt-bar'),status=bar.querySelector('.dopt-bar-status'),buttons=bar.querySelectorAll('button');
   for(const [id,c] of edits)if(!Number.isFinite(c.price)||c.price<0||c.price>10000){status.textContent=byId.get(id).label+': enter an amount from 0 to 10,000.';return;}
   buttons.forEach(b=>b.disabled=true);status.textContent='Saving…';
   const results=await Promise.allSettled([...edits].map(async([id,c])=>{
    const price=Math.round(c.price*100)/100;
    // .select() returns the changed row; an empty result means the database refused the change (not signed in as Admin).
    const saved=await rows(db.client.from('design_options').update({price,is_active:c.is_active,updated_at:new Date().toISOString()}).eq('id',id).select('id'));
    if(!saved?.length)throw new Error('No option was updated.');
    Object.assign(byId.get(id),{price,is_active:c.is_active});return id;
   }));
   let failed=0;
   results.forEach(r=>{if(r.status==='fulfilled')edits.delete(r.value);else{failed++;console.warn('Design option save failed:',r.reason);}});
   render();
   const s=root.querySelector('.dopt-bar-status');
   if(failed){s.textContent=failed+' could not be saved. Try again.';}
   else{const toast=document.createElement('div');toast.className='dopt-toast';toast.role='status';toast.textContent='Saved. Customers see the new prices on their next quote.';root.append(toast);setTimeout(()=>toast.remove(),3200);}
  }

  root.addEventListener('click',event=>{
   const t=event.target.closest('button');if(!t||t.disabled)return;
   const row=t.closest('[data-option]'),o=row&&byId.get(row.dataset.option);
   if(t.dataset.product){view.product=t.dataset.product;remember(STORE,view.product);render();window.scrollTo({top:root.offsetTop-12});return;}
   if(t.dataset.filter){view.filter=t.dataset.filter;render();return;}
   if(t.hasAttribute('data-clear')){view.filter='all';view.query='';render();return;}
   if(t.dataset.jump){root.querySelector('#dopt-'+CSS.escape(t.dataset.jump))?.scrollIntoView({behavior:'smooth',block:'start'});return;}
   if(t.dataset.all){const key=t.closest('[data-group]').dataset.group;options.filter(x=>x.product_id===view.product&&x.group_key===key&&!activeLocked(x)).forEach(x=>setEdit(x,{is_active:t.dataset.all==='on'}));render();return;}
   if(t.hasAttribute('data-discard')){edits.clear();render();return;}
   if(t.hasAttribute('data-save-all')){saveAll();return;}
   if(!o)return;
   if(t.dataset.step){setEdit(o,{price:Math.min(10000,Math.max(0,Math.round(((Number.isFinite(current(o).price)?current(o).price:0)+Number(t.dataset.step))*100)/100))});render();}
   else if(t.hasAttribute('data-free')){setEdit(o,{price:0});render();}
   else if(t.hasAttribute('data-toggle')){setEdit(o,{is_active:!current(o).is_active});render();}
   else if(t.hasAttribute('data-undo')){edits.delete(o.id);render();}
  });
  root.addEventListener('input',event=>{
   if(event.target.matches('[data-search]')){view.query=event.target.value;const pos=event.target.selectionStart;render();const s=root.querySelector('[data-search]');s.focus();s.setSelectionRange(pos,pos);return;}
   if(!event.target.matches('[data-price]'))return;
   const o=byId.get(event.target.closest('[data-option]').dataset.option),v=event.target.value===''?NaN:Number(event.target.value);
   setEdit(o,{price:v});refresh(o,true);
  });
  root.addEventListener('change',event=>{if(event.target.matches('[data-price]'))render();});
  const saveKey=event=>{if(!root.isConnected){document.removeEventListener('keydown',saveKey);return;}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&edits.size){event.preventDefault();saveAll();}};
  document.addEventListener('keydown',saveKey);
  const warn=event=>{if(!root.isConnected){window.removeEventListener('beforeunload',warn);return;}if(edits.size){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',warn);
  render();
 }catch(error){fail(content,error);}
}
