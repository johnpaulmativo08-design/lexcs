import {escapeHtml as e,icon,money,notice,statusIndicator,toolbar,showDetails} from '../components.js?v=3';
import {db,grid,fail,loadingTable} from '../backend-ui.js?v=3';
import {renderOrderPayments} from './payments.js?v=5';
import {orderInventorySection,mountOrderInventory,showShortageFromError} from './order-inventory.js?v=5';
import {orderDeliverySection,mountOrderDelivery} from './order-delivery.js?v=4';
import {designDetails} from '../design-details.js?v=1';
import {openDesignViewer} from '../design-viewer.js?v=2';
import {ask} from '../../shared/ask.js?v=1';
import {glyph,line} from '../glyphs.js?v=1';

// The spot the customer pinned at checkout (saved in the address as a Google Maps link): a small OpenStreetMap preview.
const pinMap=address=>{const m=String(address||'').match(/https:\/\/maps\.google\.com\/\?q=(-?[0-9.]+),(-?[0-9.]+)/);if(!m)return '';const lat=+m[1],lng=+m[2],d=.004;
 return '<figure class="order-pin"><iframe title="Delivery pin on the map" referrerpolicy="no-referrer" src="https://www.openstreetmap.org/export/embed.html?bbox='+(lng-d)+'%2C'+(lat-d)+'%2C'+(lng+d)+'%2C'+(lat+d)+'&amp;layer=mapnik&amp;marker='+lat+'%2C'+lng+'"></iframe><figcaption><span>Customer’s pin · '+lat.toFixed(5)+', '+lng.toFixed(5)+'</span><a href="'+e(m[0])+'" target="_blank" rel="noopener">Open in Google Maps</a></figcaption></figure>';};

// Order details card: numbered sections (customer, pickup or delivery, payment) and a status timeline.
const when=(value,opts)=>value?new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',...opts}):'';
const longDate=value=>when(value,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const row=(iconName,label,value)=>value?'<div class="od-row">'+line(iconName)+'<div><small>'+e(label)+'</small><span>'+value+'</span></div></div>':'';
const section=(n,title,body,extra='')=>'<section class="od-sec'+extra+'"><h3><span class="od-num">'+n+'</span>'+e(title)+'</h3>'+body+'</section>';
// What the customer still has to pay; amounts are the server's (total, verified paid), never recomputed from items.
const paymentSection=o=>{
 const pending=o.total_amount===null,left=pending?null:Math.max(0,Number(o.total_amount)-Number(o.amount_paid||0)),waiting=o.payment_status==='verification_pending';
 const sum=(label,value)=>'<div><dt>'+e(label)+'</dt><dd>'+value+'</dd></div>';
 const lines='<dl class="od-sum">'+sum('Order total',pending?'Pending quote':money(o.total_amount)+(Number(o.vat_amount)>0?'<small>incl. VAT '+money(o.vat_amount)+'</small>':''))+sum('Downpayment required',o.deposit_due===null?'Pending quote':money(o.deposit_due))+sum('Verified paid',money(o.amount_paid))+'</dl>';
 const due=o.status==='cancelled'?'<div class="od-due">'+glyph('stop')+'<div><small>Order cancelled</small><strong>'+money(o.amount_paid)+' was verified</strong></div></div>'
  :pending?'<div class="od-due">'+glyph('info')+'<div><small>Balance</small><strong>Set after the quote</strong></div></div>'
  :left>0?'<div class="od-due">'+glyph(waiting?'info':'warn')+'<div><small>Balance to collect</small><strong>'+money(left)+'</strong>'+(waiting?'<em>A payment proof is waiting to be checked</em>':'')+'</div></div>'
  :'<div class="od-due">'+glyph('ok')+'<div><small>Payment</small><strong>Fully paid</strong></div></div>';
 return lines+due;
};
const STEPS=[['pending','Order placed','bag'],['confirmed','Confirmed','check'],['preparing','Baking','cake'],['ready','Ready','box'],['completed','Completed','done']];
const timeline=o=>{
 const cancelled=o.status==='cancelled',now=STEPS.findIndex(([k])=>k===o.status),pickup=o.fulfillment_method!=='lalamove';
 const pill=cancelled?'<span class="od-pill is-stop">'+glyph('stop')+'Cancelled</span>':o.status==='completed'?'<span class="od-pill is-ok">'+glyph('ok')+'Completed</span>':'<span class="od-pill">'+glyph('info')+'In progress</span>';
 const note={pending:'Waiting for you to confirm',confirmed:'Customer can pay now',preparing:'Ingredients taken from stock',ready:pickup?'Ready for pickup':'Ready to ship by Lalamove',completed:'Handed over and paid'};
 const past={pending:'Sent by the customer',confirmed:'You approved the order',preparing:'Made in the kitchen',ready:pickup?'Was ready for pickup':'Handed to the rider'};
 const steps=STEPS.map(([k,label,ic],i)=>{const state=cancelled?(i===0?'is-done':''):i<now||o.status==='completed'?'is-done':i===now?'is-now':'';
  const at=i===0?longDate(o.created_at):i===now&&!cancelled&&o.updated_at?longDate(o.updated_at):'';
  return '<li class="'+state+'"'+(state==='is-now'?' aria-current="step"':'')+'><span class="od-step-ic">'+line(k==='ready'&&!pickup?'truck':ic)+'</span><div><b>'+e(label)+'</b><small>'+e(state==='is-done'&&past[k]?past[k]:state?note[k]:k==='ready'?(pickup?'Ready for pickup':'Ready to ship'):'Not yet')+'</small></div>'+(at?'<time>'+e(at)+'</time>':'')+'</li>';}).join('');
 return '<section class="od-time"><header><span class="od-chip">Timeline</span><i aria-hidden="true"></i>'+pill+'</header><ol>'+steps+'</ol></section>';
};
const orderCard=o=>{
 const pickup=o.fulfillment_method!=='lalamove',addr=String(o.address||'');
 const addressText=e(addr.replace(/\n?Map pin: https:\/\/maps\.google\.com\/\?q=-?[0-9.]+,-?[0-9.]+/,'').trim()).replace(/\n/g,'<br>');
 const phone=o.contact_phone?'<a href="tel:'+e(String(o.contact_phone).replace(/[^\d+]/g,''))+'">'+e(o.contact_phone)+'</a>':'';
 return '<div class="od">'+
  '<div class="od-grid"><div class="od-col">'+
   section(1,'Customer',row('user','Name',e(o.customer_name))+row('phone','Contact number',phone)+row('calendar','Ordered',e(longDate(o.created_at))))+
   section(2,pickup?'Store pickup':'Lalamove delivery',row('calendar',pickup?'Pickup':'Deliver on',e(when(o.receiving_start,{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})))+(pickup?'':row('pin','Address',addressText||'—')+pinMap(addr))+(o.notes?'<div class="od-note">'+line('note')+'<div><small>Note from the customer</small><p>'+e(o.notes)+'</p></div></div>':''))+
  '</div><div class="od-col">'+section(3,'Payment',paymentSection(o),' od-pay')+timeline(o)+'</div></div></div>';
};
export async function renderOrders(content){
 content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders and payments.</p></div></header>'+loadingTable(['Order','Customer','Ordered','Total','Payment','Status','Due date','Action']);
 try{
  const orders=await db.orders();let history=false;
  // newest movement first: any status or payment change (orders.updated_at) or a Lalamove step (order_deliveries.updated_at)
  const moved=new Map(orders.map(o=>[o.id,Date.parse(o.updated_at||o.created_at)]));
  try{(db.unwrap(await db.client.from('order_deliveries').select('order_id,updated_at'))||[]).forEach(d=>{const t=Date.parse(d.updated_at);if(t>(moved.get(d.order_id)||0))moved.set(d.order_id,t);});}catch(error){console.warn('Delivery times not loaded:',error);}
  orders.sort((a,b)=>(moved.get(b.id)||0)-(moved.get(a.id)||0));
  content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders, payments, and fulfillment progress.</p></div></header>'+notice('Manual QR payments are counted only after Admin verifies the actual bank credit.')+toolbar('<select id="status"><option value="">All statuses</option>'+['pending','confirmed','preparing','ready','completed','cancelled'].map(s=>'<option>'+s+'</option>').join('')+'</select>')+'<div class="report-links"><button class="button primary" data-view="current">'+icon('orders')+' Current Orders</button><button class="button" data-view="history">'+icon('clock')+' Order History</button></div><div id="orders-table"></div><section id="order-payments" class="panel payment-tests-panel"><div class="payment-test-heading"><h2>Order payments</h2></div>'+loadingTable(['Order','Customer','Submitted','Required amount','Method','Reference','Status','Action'])+'</section>';
  // when the customer placed the order: date on top, time underneath (Philippine time)
  const orderedAt=value=>{const d=new Date(value),opt={timeZone:'Asia/Manila'};return e(d.toLocaleDateString('en-PH',{...opt,month:'short',day:'numeric',year:'numeric'}))+'<br><small>'+e(d.toLocaleTimeString('en-PH',{...opt,hour:'numeric',minute:'2-digit'}))+'</small>';};
  // "Updated …" under the order time when something happened after it was placed (why it moved to the top)
  const updatedAt=o=>{const t=moved.get(o.id),c=Date.parse(o.created_at);if(!t||t-c<60000)return '';const d=new Date(t),opt={timeZone:'Asia/Manila'},today=d.toLocaleDateString('en-CA',opt)===new Date().toLocaleDateString('en-CA',opt);return '<br><small class="order-moved">Updated '+e(today?d.toLocaleTimeString('en-PH',{...opt,hour:'numeric',minute:'2-digit'}):d.toLocaleDateString('en-PH',{...opt,month:'short',day:'numeric'}))+'</small>';};
  const orderTone=status=>status==='completed'?'success':status==='cancelled'?'neutral':status==='pending'?'warning':status==='ready'?'info':'success';
   const payTone=status=>status==='paid'||status==='partially_paid'?'success':status==='refunded'?'neutral':status==='failed'||status==='rejected'?'danger':'warning';
  const readableStatus=status=>String(status||'Unknown').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
  const draw=()=>{
   const search=content.querySelector('.search').value.toLowerCase(),status=content.querySelector('#status').value;
   const filtered=orders.filter(o=>(['completed','cancelled'].includes(o.status)===history)&&(!status||o.status===status)&&JSON.stringify([o.order_number,o.customer_name]).toLowerCase().includes(search));
   content.querySelector('#orders-table').innerHTML=grid(['Order','Customer','Ordered','Total','Payment','Status','Due date','Action'],filtered.map(o=>'<tr><td>#'+e(o.order_number)+'</td><td>'+e(o.customer_name)+'</td><td class="order-placed">'+orderedAt(o.created_at)+updatedAt(o)+'</td><td>'+(o.total_amount===null?'Pending quote':money(o.total_amount))+'</td><td>'+(o.status==='pending'&&o.payment_status==='unpaid'?statusIndicator('Opens after confirm','neutral'):statusIndicator(readableStatus(o.payment_status),payTone(o.payment_status)))+'</td><td>'+statusIndicator(readableStatus(o.status),orderTone(o.status))+'</td><td>'+new Date(o.receiving_start).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'})+'</td><td><button class="button" data-order="'+e(o.id)+'">'+icon('eye')+' View</button></td></tr>').join('')||'<tr><td colspan="8" class="empty">No matching orders. Try a different search or status.</td></tr>');
  };
  content.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{history=b.dataset.view==='history';draw();});
  content.querySelector('.search').oninput=draw;content.querySelector('#status').onchange=draw;
  content.onclick=event=>{
   const b=event.target.closest('[data-order]');if(!b)return;
   const o=orders.find(o=>o.id===b.dataset.order);
   const next={pending:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled']}[o.status]||[];
   // the Lalamove fee step is off for now (phase 52): the customer pays the rider directly
   const canQuote=false&&o.fulfillment_method==='lalamove'&&o.status!=='cancelled'&&Number(o.amount_paid||0)===0&&o.payment_status!=='verification_pending';
   const quoteForm=canQuote?'<form id="delivery-quote"><label class="form-field">Delivery fee (₱)<input name="fee" type="number" min="0" max="99999" step="0.01" required value="'+e(o.delivery_fee??'')+'"></label><button class="button" type="submit">'+(o.delivery_fee_status==='quoted'?'Update delivery quote':'Set delivery quote')+'</button></form>':'';
   const dialog=showDetails('Order #'+o.order_number,orderCard(o)+'<div class="order-status-actions order-status-actions--top" data-actions>'+next.map(s=>'<button class="button'+(s==='confirmed'?' button--primary':'')+'" data-status="'+s+'"'+(s==='preparing'&&!['partially_paid','paid'].includes(o.payment_status)?' disabled title="Verify the payment first"':'')+'>'+(s==='confirmed'?'Confirm order':s==='cancelled'?'Cancel order':s==='preparing'?'Start making':'Mark '+s)+'</button>').join('')+'</div><p role="alert"></p>'+orderDeliverySection(o)+quoteForm+(o.status==='pending'?'<p class="notice">The customer can pay only after you confirm this order. They then choose the downpayment ('+(o.deposit_due===null?'after the delivery fee':money(o.deposit_due))+') or the full amount ('+(o.total_amount===null?'after the delivery fee':money(o.total_amount))+').'+(o.total_amount===null?' Set the delivery fee first.':'')+'</p>':'')+'<ul>'+o.order_items.map((i,n)=>'<li>'+e(i.name_snapshot)+' · '+e(i.variant_label_snapshot)+' × '+i.quantity+' · '+money(i.line_total)+(i.customization?designDetails(i.customization):'')+(['bento','cupcake','donut','cakepop'].includes(i.customization?.designer)?'<button class="button button--primary" data-view-3d="'+n+'">View in 3D</button> ':'')+((i.inspiration_paths||[]).length?'<p class="order-inspiration"><strong>Customer’s inspiration:</strong> '+i.inspiration_paths.map((p,k)=>'<button class="button" data-reference="'+e(p)+'">Photo '+(k+1)+'</button>').join(' ')+'</p>':'')+(i.reference_image_path?'<button class="button" data-reference="'+e(i.reference_image_path)+'">'+(['bento','cupcake','donut','cakepop'].includes(i.customization?.designer)?'View design picture':'View private reference')+'</button>':'')+'</li>').join('')+'</ul>'+'<details class="order-inv-drop"><summary>Inventory consumption <small>materials for this order</small></summary>'+orderInventorySection()+'</details>',b,{footer:false});
   dialog.classList.add('order-dialog');
   mountOrderInventory(dialog,o,{onChanged:()=>{}});
   mountOrderDelivery(dialog,o);
   const quote=dialog.querySelector('#delivery-quote');
   if(quote)quote.onsubmit=async event=>{
    event.preventDefault();const submit=quote.querySelector('button');submit.disabled=true;
    try{await db.rpc('quote_order_delivery',{target_order:o.id,quoted_fee:Number(quote.elements.fee.value)});dialog.close();await renderOrders(content);}
    catch(error){dialog.querySelector('.dialog-body > [role=alert]').textContent=error.message;submit.disabled=false;}
   };
   dialog.querySelectorAll('[data-status]').forEach(button=>button.onclick=async()=>{button.disabled=true;dialog.querySelector('.dialog-body > [role=alert]').textContent='';try{await db.rpc('set_order_status',{order_id:o.id,next_status:button.dataset.status});dialog.close();await renderOrders(content);}catch(error){{const drop=dialog.querySelector('.order-inv-drop');if(drop)drop.open=true;}if(!showShortageFromError(error,dialog,o.order_number))dialog.querySelector('.dialog-body > [role=alert]').textContent=error.message;button.disabled=false;}});
   // view-only 3D window for the item's DIY design (several designed items: tabs inside the window)
   const designed=o.order_items.map((i,n)=>({n,line:{name:i.name_snapshot,qty:i.quantity,unit_price:i.customization?.extras_per_item!=null?Number(i.unit_price)+Number(i.customization.extras_per_item):i.unit_price,summary:i.customization?.summary,design:i.customization,variant_id:i.variant_id,inspiration:i.inspiration_paths||[]}})).filter(x=>['bento','cupcake','donut','cakepop'].includes(x.line.design?.designer));
   dialog.querySelectorAll('[data-view-3d]').forEach(button=>button.onclick=()=>openDesignViewer(designed.map(x=>x.line),designed.findIndex(x=>x.n===Number(button.dataset.view3d)),{title:'Order #'+o.order_number}));
   // a receipt waiting for review: the same proof card as in Chat & Orders (confirm or reject from here)
   (async()=>{try{const pending=db.unwrap(await db.client.from('order_payment_attempts').select('id,amount,transaction_reference,proof_storage_path,provider_payment_id,provider_method,provider_amount').eq('order_id',o.id).eq('status','verification_pending').order('created_at',{ascending:false}).limit(1));const p=pending[0],row=dialog.querySelector('[data-actions]');if(!p||!row)return;
     row.insertAdjacentHTML('afterend','<form class="order-proof" data-proof-form><div class="order-proof-head"><strong>'+(p.provider_payment_id?'Paid online (PayMongo'+(p.provider_method?' · '+e(p.provider_method==='qrph'?'QR Ph':p.provider_method==='gcash'?'GCash':p.provider_method):'')+')':'Payment proof')+' · '+money(p.amount)+'</strong><span>'+(p.provider_payment_id?'PayMongo payment':'Reference')+': '+e(p.transaction_reference||'—')+'</span></div>'+(p.proof_storage_path?'<button type="button" class="button" data-pay-receipt>View receipt</button>':'')+(p.provider_payment_id&&Math.round(Number(p.provider_amount)*100)!==Math.round(Number(p.amount)*100)?'<p class="order-proof-error">PayMongo reported '+money(p.provider_amount)+', not '+money(p.amount)+'. Check before confirming.</p>':'')+'<p class="order-proof-hint">'+(p.provider_payment_id?'Check that the payment shows as paid in your PayMongo dashboard before confirming.':'Check that '+money(p.amount)+' actually arrived in the bank or wallet before confirming.')+'</p><label>Bank note <small>(optional to confirm, needed to reject)</small><input name="reason" maxlength="1000" autocomplete="off" placeholder="e.g. Received 2:04 PM, ref 34688789"></label><div class="order-proof-actions"><button type="submit" class="button order-proof-ok" data-decision="paid">'+icon('check')+' Confirm payment</button><button type="submit" class="button order-proof-no" data-decision="rejected">Reject</button></div><p class="order-proof-error" role="alert"></p></form>');
     const form=dialog.querySelector('[data-proof-form]'),say=t=>{form.querySelector('[role=alert]').textContent=t;};
     form.querySelector('[data-pay-receipt]')?.addEventListener('click',async()=>{try{window.open(await db.privateImage('payment-proofs',p.proof_storage_path),'_blank','noopener');}catch(error){say(error.message);}});
     form.onsubmit=async event=>{event.preventDefault();const decision=event.submitter?.dataset.decision||'paid',reason=form.elements.reason.value.trim();
       if(decision==='rejected'&&!reason){say('Write the reason so the customer knows what to fix.');form.elements.reason.focus();return;}
       if(!await ask(decision==='paid'?'Mark '+money(p.amount)+' as received for Order #'+o.order_number+'? Only confirm after checking the money arrived.':'The customer will be asked to send a new payment proof.',{title:decision==='paid'?'Confirm payment?':'Reject this proof?',confirm:decision==='paid'?'Confirm payment':'Reject proof',tone:decision==='paid'?'success':'danger'}))return;
       form.querySelectorAll('button').forEach(b=>b.disabled=true);
       try{await db.rpc('review_order_payment',{target_payment:p.id,decision,review_reason:reason||'Amount checked and received ('+money(p.amount)+'), confirmed in Orders.'});dialog.close();await renderOrders(content);}
       catch(error){say(error.message);form.querySelectorAll('button').forEach(b=>b.disabled=false);}};
   }catch(error){console.warn('Payment check failed:',error);}})();
   dialog.querySelectorAll('[data-reference]').forEach(button=>button.onclick=async()=>{try{const url=await db.privateImage('customer-references',button.dataset.reference);const img=document.createElement('img');img.src=url;img.alt='Private customer reference';button.replaceWith(img);}catch(error){dialog.querySelector('.dialog-body > [role=alert]').textContent=error.message;}});
  };
  // Dashboard links reuse the existing order detail dialog and status actions.
  const detailId=location.hash.split('/')[1]==='detail'?location.hash.split('/')[2]:null;
  const target=orders.find(o=>o.id===detailId);
  if(target){history=['completed','cancelled'].includes(target.status);content.querySelector('.search').value=String(target.order_number);}
  draw();
  await Promise.all([renderOrderPayments(content,orders,()=>renderOrders(content))]);
  if(target)content.querySelector('[data-order="'+target.id+'"]').click();
 }catch(error){fail(content,error);}
}
