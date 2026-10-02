import {escapeHtml as e} from '../components.js?v=3';
import {db,rows,fail,loadingTable} from '../backend-ui.js?v=3';

// Prices and availability of the bento, cupcake, donut and cake pop designers' options (public.design_options,
// phases 32 and 36-38). Checkout prices designs on the server from this table, so a change applies to the next quote.
// One product at a time (product buttons), sections that open and close (dropdown buttons), steppers and on/off
// switches; changes are collected and saved together from the bar at the bottom. Every option can carry a price
// (phase 41); "No …" choices stay free.
const GROUPS={
 bento:[['border','Borders'],['accent','Decorations'],['message','Message'],['lettering','Lettering styles'],['topper','Toppers'],['font','Message fonts'],['color','Colors (frosting, lettering, ribbon, drip)']],
 cupcake:[['flavor','Flavors'],['style','Piping styles'],['pattern','Box arrangement'],['finish','Finishing touches'],['theme','Theme toppers'],['color','Frosting colors']],
 cakepop:[['style','Pop shape'],['flavor','Flavors'],['pattern','Coating'],['finish','Finishes'],['sprinkle','Sprinkles'],['theme','Theme toppers'],['message','Fondant message'],['color','Coating, sprinkle and letter colors']],
 donut:[['flavor','Flavors'],['pattern','Glaze dip'],['finish','Finishes'],['sprinkle','Sprinkles'],['theme','Theme toppers'],['message','Fondant message'],['color','Glaze, sprinkle and letter colors']]};
const UNIT={bento:'cake',cupcake:'box',donut:'box',cakepop:'box'};
// Line icons (24px, stroke = currentColor) for the products and the option groups.
const SVG=d=>'<svg class="dopt-ico" viewBox="0 0 24 24" aria-hidden="true">'+d+'</svg>';
const TXT=(t,size)=>'<text x="12" y="'+(size>15?18:17)+'" text-anchor="middle" font-size="'+size+'" font-family="Georgia,serif" fill="currentColor" stroke="none">'+t+'</text>';
const ICON={
 bento:'<path d="M4 21h16M5 21v-8h14v8M5 16.5c2 1.5 4-1.5 7 0s5-1.5 7 0M12 13V9.5"/><path d="M10 7c0-1.3 2-3.5 2-3.5s2 2.2 2 3.5a2 2 0 0 1-4 0Z"/>',
 cupcake:'<path d="M6 12h12l-1.6 9H7.6L6 12Z"/><path d="M5.2 12a3 3 0 0 1 1.9-5 5 5 0 0 1 9.8 0 3 3 0 0 1 1.9 5"/><path d="M10 12l.5 9M14 12l-.5 9"/>',
 donut:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M8 6.5l.6 1M15.6 6l-.6 1M17.6 11l-1 .3M6.4 13l1-.2M10 17.4l.4-1M15 16.6l-.5-.9"/>',
 cakepop:'<circle cx="12" cy="8" r="5"/><path d="M12 13v8M9.6 6.4l1 .5M13.6 4.9l.3 1M14.1 8.9l1-.2"/>',
 border:'<path d="M3 9c2-2 4-2 6 0s4 2 6 0 4-2 6 0M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',
 accent:'<circle cx="12" cy="12" r="2.4"/><path d="M12 9.6a3.1 3.1 0 1 1 0-6.2 3.1 3.1 0 1 1 0 6.2ZM14.4 12a3.1 3.1 0 1 1 6.2 0 3.1 3.1 0 1 1-6.2 0ZM12 14.4a3.1 3.1 0 1 1 0 6.2 3.1 3.1 0 1 1 0-6.2ZM9.6 12a3.1 3.1 0 1 1-6.2 0 3.1 3.1 0 1 1 6.2 0Z"/>',
 message:'<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>',
 lettering:TXT('Aa',13), font:TXT('A',18),
 topper:'<path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.4 2.8 1-6.1-4.4-4.3 6.1-.8L12 3Z"/>',
 color:'<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
 flavor:'<circle cx="12" cy="12" r="9"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="10" r="1"/><circle cx="10" cy="15" r="1"/><circle cx="15.2" cy="15" r=".8"/>',
 style:'<path d="M12 21c-4 0-6-1.8-6-3.8s2-3.2 4-3.2c-2 0-3.2-1.4-3.2-3S8.4 8 11 8c-1 0-2-1-2-2.4S10.4 3 12 3s3 1 3 2.6S14 8 13 8c2.6 0 4.2 1.4 4.2 3s-1.2 3-3.2 3c2 0 4 1.2 4 3.2S16 21 12 21Z"/>',
 pattern:'<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>',
 finish:'<path d="M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8L11 3ZM18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z"/>',
 sprinkle:'<path d="M6 7l2 1M14 5l1 2M18 10l2-1M5 14l2-1M10.5 11.5l1 2M15 15l2 1M8 18.5l2-1M13.5 19.5l1-2"/>',
 theme:'<path d="M4 20 9 7l8 8-13 5Z"/><path d="M14 3.5v2M18.5 5.5 17 7M20.5 10h-2M12.5 6.5l1-1"/>',
 chev:'<path d="m9 6 6 6-6 6"/>', down:'<path d="m6 9 6 6 6-6"/>', search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'};
// One line under each group title, by designer.
const DESC={border:'Piped borders around the cake.',accent:'Decorations customers can add to the cake.',lettering:'How the message is written on the cake.',topper:'A topper to make it extra special.',font:'Fonts for the custom message.',
 color:{bento:'Frosting, lettering, ribbon and drip colors.',cupcake:'Frosting colors for the piping.',donut:'Glaze, sprinkle and letter colors.',cakepop:'Coating and sprinkle colors.'},
 message:{bento:'A custom message on the cake.',donut:'Fondant letters or name plaques.',cakepop:'Cake pops have no message.'},
 flavor:{cupcake:'Cake flavor for the box.',donut:'Donut flavors, one or mixed.',cakepop:'Cake pop flavors, one or mixed.'},
 style:{cupcake:'Piping styles for the frosting.',cakepop:'Round cake pops or mini donut pops.'},
 pattern:{cupcake:'How the box is arranged.',donut:'How the glazes are dipped across the box.',cakepop:'How the coatings are arranged.'},
 finish:'Finishing touches on top.',sprinkle:'Sprinkles on the glaze or coating.',theme:'Fondant theme toppers.'};
// How the extra is charged, per group (default: once per cake or box when chosen).
const HOW={color:'once for each color the customer uses',flavor:'for each flavor chosen (Mixed flavors: once, when a box has more than one)',font:'when the cake has a message'};
const FILTERS=[['all','All'],['on','Offered'],['off','Hidden'],['paid','With extra charge']];
const STORE='lexc_admin_design_product';
const heading='<header class="module-heading dopt-heading"><div><h1>Designer Options</h1><p>Set an extra price for any choice in the bento, cupcake, donut and cake pop designers (₱0 = free), and turn an option off to hide it from customers. Open a section with its button.</p></div></header>';
const priceLocked=o=>o.code==='none';
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
  const view={product:sorted.some(p=>p.id===recall(STORE))?recall(STORE):sorted[0]?.id,filter:'all',query:'',section:null,open:new Set()};   // open: "productId:group" sections shown open; section: show only that group
  const isOpen=key=>view.open.has(view.product+':'+key)||view.section===key||view.filter!=='all'||view.query.trim()!=='';

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
   if(view.section&&o.group_key!==view.section)return false;
   return view.filter==='all'||(view.filter==='on'&&c.is_active)||(view.filter==='off'&&!c.is_active)||(view.filter==='paid'&&c.price>0);
  };

  function rowHtml(o,unit){
   const c=current(o),changed=edits.has(o.id),pl=priceLocked(o),al=activeLocked(o);
   return '<div class="dopt-row'+(changed?' is-changed':'')+(c.is_active?'':' is-off')+'" data-option="'+e(o.id)+'">'
    +'<div class="dopt-name">'+(o.hex?'<span class="dopt-swatch" aria-hidden="true" style="background:'+e(o.hex)+'"></span>':'')+'<span><strong>'+e(o.label)+'</strong>'+(changed?'<em class="dopt-flag">Unsaved</em>':'')+'</span></div>'
    +'<div class="dopt-price">'+(pl?'<span class="dopt-free" title="Choosing nothing is always free">No charge</span>'
      :'<button type="button" class="dopt-step" data-step="-1" aria-label="₱1 less for '+e(o.label)+'"'+(c.price<=0?' disabled':'')+'>−</button>'
      +'<label class="sr-only" for="price-'+e(o.id)+'">Extra per '+unit+' for '+e(o.label)+'</label><span class="dopt-peso" aria-hidden="true">₱</span><input id="price-'+e(o.id)+'" type="number" min="0" max="10000" step="0.5" inputmode="decimal" value="'+c.price+'" data-price>'
      +'<button type="button" class="dopt-step" data-step="1" aria-label="₱1 more for '+e(o.label)+'">+</button>'
      +'<button type="button" class="dopt-chip" data-free'+(c.price===0?' disabled':'')+'>Free</button>')+'</div>'
    +'<div class="dopt-offer"><button type="button" class="dopt-switch" role="switch" aria-checked="'+c.is_active+'" data-toggle aria-label="Offer '+e(o.label)+' to customers"'+(al?' disabled title="Always offered"':'')+'><span class="dopt-knob" aria-hidden="true"></span><span class="dopt-switch-text">'+(c.is_active?'Offered':'Hidden')+'</span></button></div>'
    +'<div class="dopt-undo">'+(changed?'<button type="button" class="dopt-chip" data-undo aria-label="Undo changes to '+e(o.label)+'">Undo</button>':'')+'</div></div>';
  }

  function render(){
   const p=sorted.find(x=>x.id===view.product),k=kind(p),unit=UNIT[k];
   const groups=GROUPS[k].map(([key,title])=>({key,title:title.replace(/ \(.*\)$/,''),list:options.filter(o=>o.product_id===p.id&&o.group_key===key)})).filter(g=>g.list.length);
   if(view.section&&!groups.some(g=>g.key===view.section))view.section=null;
   const mine=options.filter(o=>o.product_id===p.id),count={all:mine.length,on:mine.filter(o=>current(o).is_active).length,off:mine.filter(o=>!current(o).is_active).length,paid:mine.filter(o=>current(o).price>0).length};
   const allOpen=groups.every(g=>isOpen(g.key)),scroll=window.scrollY;
   root.innerHTML=
    '<nav class="dopt-products" aria-label="Choose a product">'+sorted.map(x=>{
      const n=[...edits.keys()].filter(id=>byId.get(id).product_id===x.id).length;
      return '<button type="button" data-product="'+e(x.id)+'" aria-pressed="'+(x.id===p.id)+'"><span class="dopt-product-ico">'+SVG(ICON[kind(x)])+'</span><span class="dopt-product-name">'+e(x.name)+'</span>'+SVG(ICON.chev)+(n?'<b class="dopt-badge" title="Unsaved changes">'+n+'</b>':'')+'</button>';
    }).join('')+'</nav>'
    +'<div class="dopt-toolbar"><label class="dopt-search">'+SVG(ICON.search)+'<span class="sr-only">Find an option</span><input type="search" placeholder="Find an option, color or style…" value="'+e(view.query)+'" data-search></label>'
    +'<div class="dopt-filters" role="group" aria-label="Show">'+FILTERS.map(([v,l])=>'<button type="button" data-filter="'+v+'" aria-pressed="'+(view.filter===v)+'"><span>'+l+'</span><b>'+count[v]+'</b></button>').join('')+'</div></div>'
    +'<div class="dopt-jump" aria-label="Sections"><button type="button" class="dopt-sec" data-sections aria-pressed="'+!view.section+'">All sections</button>'
    +groups.map(g=>'<button type="button" class="dopt-sec" data-jump="'+e(g.key)+'" aria-pressed="'+(view.section===g.key)+'">'+e(g.title)+' <b>'+g.list.filter(o=>current(o).is_active).length+'/'+g.list.length+'</b></button>').join('')
    +'<button type="button" class="dopt-sec dopt-expand" data-expand="'+(allOpen?'close':'open')+'">'+(allOpen?'Close all':'Open all')+'</button></div>'
    +groups.map(g=>{
      const shown=g.list.filter(visible);if(!shown.length)return '';
      const lockedAll=g.list.every(activeLocked),open=isOpen(g.key),changed=g.list.filter(o=>edits.has(o.id)).length;
      const desc=typeof DESC[g.key]==='object'?DESC[g.key][k]:DESC[g.key];
      return '<section class="dopt-group'+(open?' is-open':'')+'" id="dopt-'+e(g.key)+'" data-group="'+e(g.key)+'">'
       +'<button type="button" class="dopt-toggle" data-section="'+e(g.key)+'" aria-expanded="'+open+'" aria-controls="dopt-body-'+e(g.key)+'">'
       +'<span class="dopt-group-ico">'+SVG(ICON[g.key]||ICON.finish)+'</span>'
       +'<span class="dopt-group-text"><span class="dopt-group-title">'+e(g.title)+'</span>'+(desc?'<span class="dopt-group-desc">'+e(desc)+'</span>':'')+'</span>'
       +'<span class="dopt-group-pills">'+(changed?'<span class="dopt-pill is-unsaved">'+changed+' unsaved</span>':'')
       +'<span class="dopt-pill">'+g.list.filter(o=>current(o).is_active).length+' of '+g.list.length+' offered</span>'+'</span>'
       +'<span class="dopt-caret">'+SVG(ICON.down)+'</span></button>'
       +(open?'<div class="dopt-body" id="dopt-body-'+e(g.key)+'"><div class="dopt-body-top"><p class="dopt-how">Extra charged '+(HOW[g.key]||'once per '+unit+' when chosen')+'.</p>'
         +(lockedAll?'':'<div class="dopt-group-actions"><button type="button" class="dopt-chip" data-all="on">Offer all</button><button type="button" class="dopt-chip" data-all="off">Hide all</button></div>')+'</div>'
         +'<div class="dopt-head" aria-hidden="true"><span>Option</span><span>Extra price (₱)</span><span>Customers see it</span><span></span></div>'
         +shown.map(o=>rowHtml(o,unit)).join('')+'</div>':'')+'</section>';
    }).join('')
    +(groups.some(g=>g.list.some(visible))?'':'<section class="dopt-group dopt-empty"><p>No options match. <button type="button" class="dopt-chip" data-clear>Show everything</button></p></section>')
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
   if(t.dataset.product){view.product=t.dataset.product;view.section=null;remember(STORE,view.product);render();window.scrollTo({top:root.offsetTop-12});return;}
   if(t.dataset.filter){view.filter=t.dataset.filter;render();return;}
   if(t.hasAttribute('data-clear')){view.filter='all';view.query='';view.section=null;render();return;}
   if(t.hasAttribute('data-sections')){view.section=null;render();return;}
   if(t.dataset.jump){view.section=view.section===t.dataset.jump?null:t.dataset.jump;view.open.add(view.product+':'+t.dataset.jump);render();return;}
   if(t.dataset.section){const id=view.product+':'+t.dataset.section;view.open.has(id)?view.open.delete(id):view.open.add(id);render();root.querySelector('[data-section="'+CSS.escape(t.dataset.section)+'"]')?.focus();return;}
   if(t.dataset.expand){const keys=GROUPS[kind(sorted.find(x=>x.id===view.product))].map(([k])=>view.product+':'+k);keys.forEach(k=>t.dataset.expand==='open'?view.open.add(k):view.open.delete(k));render();return;}
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
