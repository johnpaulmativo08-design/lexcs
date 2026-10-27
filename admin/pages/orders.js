import {escapeHtml as e,icon,money,notice,statusIndicator,toolbar,showDetails} from '../components.js?v=3';
import {db,grid,fail,loadingTable} from '../backend-ui.js?v=3';
import {renderOrderPayments} from './payments.js?v=5';
import {orderInventorySection,mountOrderInventory,showShortageFromError} from './order-inventory.js?v=5';
import {designDetails} from '../design-details.js?v=1';
import {openDesignViewer} from '../design-viewer.js?v=2';
import {ask} from '../../shared/ask.js?v=1';

// What the customer still has to pay on an order (shown in the order details and the chat's order panel).
const balanceCard=o=>{
 if(o.total_amount===null||o.status==='cancelled')return '';
 const left=Math.max(0,Number(o.total_amount)-Number(o.amount_paid||0));
 return left>0?'<div class="balance-card"><span>Remaining balance to be paid by the customer</span><strong>'+money(left)+'</strong><small>'+money(o.amount_paid)+' of '+money(o.total_amount)+' verified'+(o.payment_status==='verification_pending'?' · a payment proof is waiting to be checked':'')+'</small></div>':'<div class="balance-card is-paid"><span>Payment</span><strong>Fully paid ✓</strong><small>'+money(o.amount_paid)+' verified</small></div>';
};
export async function renderOrders(content){
 content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders and payments.</p></div></header>'+loadingTable(['Order','Customer','Ordered','Total','Payment','Status','Due date','Action']);
 try{
  const orders=await db.orders();let history=false;
  content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders, payments, and fulfillment progress.</p></div></header>'+notice('Manual QR payments are counted only after Admin verifies the actual bank credit.')+toolbar('<select id="status"><option value="">All statuses</option>'+['pending','confirmed','preparing','ready','completed','cancelled'].map(s=>'<option>'+s+'</option>').join('')+'</select>')+'<div class="report-links"><button class="button primary" data-view="current">'+icon('orders')+' Current Orders</button><button class="button" data-view="history">'+icon('clock')+' Order History</button></div><div id="orders-table"></div><section id="order-payments" class="panel payment-tests-panel"><div class="payment-test-heading"><h2>Order payments</h2></div>'+loadingTable(['Order','Customer','Submitted','Required amount','Method','Reference','Status','Action'])+'</section>';
  // when the customer placed the order: date on top, time underneath (Philippine time)
  const orderedAt=value=>{const d=new Date(value),opt={timeZone:'Asia/Manila'};return e(d.toLocaleDateString('en-PH',{...opt,month:'short',day:'numeric',year:'numeric'}))+'<br><small>'+e(d.toLocaleTimeString('en-PH',{...opt,hour:'numeric',minute:'2-digit'}))+'</small>';};
  const orderTone=status=>status==='completed'?'success':status==='cancelled'?'neutral':status==='pending'?'warning':status==='ready'?'info':'success';
   const payTone=status=>status==='paid'||status==='partially_paid'?'success':status==='refunded'?'neutral':status==='failed'||status==='rejected'?'danger':'warning';
  const readableStatus=status=>String(status||'Unknown').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
  const draw=()=>{
   const search=content.querySelector('.search').value.toLowerCase(),status=content.querySelector('#status').value;
   const filtered=orders.filter(o=>(['completed','cancelled'].includes(o.status)===history)&&(!status||o.status===status)&&JSON.stringify([o.order_number,o.customer_name]).toLowerCase().includes(search));
   content.querySelector('#orders-table').innerHTML=grid(['Order','Customer','Ordered','Total','Payment','Status','Due date','Action'],filtered.map(o=>'<tr><td>#'+e(o.order_number)+'</td><td>'+e(o.customer_name)+'</td><td class="order-placed">'+orderedAt(o.created_at)+'</td><td>'+(o.total_amount===null?'Pending quote':money(o.total_amount))+'</td><td>'+(o.status==='pending'&&o.payment_status==='unpaid'?statusIndicator('Opens after confirm','neutral'):statusIndicator(readableStatus(o.payment_status),payTone(o.payment_status)))+'</td><td>'+statusIndicator(readableStatus(o.status),orderTone(o.status))+'</td><td>'+new Date(o.receiving_start).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'})+'</td><td><button class="button" data-order="'+e(o.id)+'">'+icon('eye')+' View</button></td></tr>').join('')||'<tr><td colspan="8" class="empty">No matching orders. Try a different search or status.</td></tr>');
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
   const dialog=showDetails('Order #'+o.order_number,'<p><strong>Ordered:</strong> '+e(new Date(o.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))+' · <strong>Due:</strong> '+e(new Date(o.receiving_start).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))+'</p><p>'+e(o.customer_name)+' · '+e(o.contact_phone)+'</p><p>'+e(o.address)+'</p><p>'+e(o.notes)+'</p><p><strong>Total:</strong> '+(o.total_amount===null?'Pending quote':money(o.total_amount))+(Number(o.vat_amount)>0?' (incl. VAT '+money(o.vat_amount)+')':'')+' · <strong>Required:</strong> '+(o.deposit_due===null?'Pending quote':money(o.deposit_due))+' · <strong>Verified paid:</strong> '+money(o.amount_paid)+'</p>'+balanceCard(o)+'<div class="order-status-actions order-status-actions--top" data-actions>'+next.map(s=>'<button class="button'+(s==='confirmed'?' button--primary':'')+'" data-status="'+s+'"'+(s==='preparing'&&!['partially_paid','paid'].includes(o.payment_status)?' disabled title="Verify the payment first"':'')+'>'+(s==='confirmed'?'Confirm order':s==='cancelled'?'Cancel order':s==='preparing'?'Start making':'Mark '+s)+'</button>').join('')+'</div><p role="alert"></p>'+quoteForm+(o.status==='pending'?'<p class="notice">The customer can pay only after you confirm this order. They then choose the downpayment ('+(o.deposit_due===null?'after the delivery fee':money(o.deposit_due))+') or the full amount ('+(o.total_amount===null?'after the delivery fee':money(o.total_amount))+').'+(o.total_amount===null?' Set the delivery fee first.':'')+'</p>':'')+'<ul>'+o.order_items.map((i,n)=>'<li>'+e(i.name_snapshot)+' · '+e(i.variant_label_snapshot)+' × '+i.quantity+' · '+money(i.line_total)+(i.customization?designDetails(i.customization):'')+(['bento','cupcake','donut','cakepop'].includes(i.customization?.designer)?'<button class="button button--primary" data-view-3d="'+n+'">View in 3D</button> ':'')+((i.inspiration_paths||[]).length?'<p class="order-inspiration"><strong>Customer’s inspiration:</strong> '+i.inspiration_paths.map((p,k)=>'<button class="button" data-reference="'+e(p)+'">Photo '+(k+1)+'</button>').join(' ')+'</p>':'')+(i.reference_image_path?'<button class="button" data-reference="'+e(i.reference_image_path)+'">'+(['bento','cupcake','donut','cakepop'].includes(i.customization?.designer)?'View design picture':'View private reference')+'</button>':'')+'</li>').join('')+'</ul>'+'<details class="order-inv-drop"><summary>Inventory consumption <small>materials for this order</small></summary>'+orderInventorySection()+'</details>',b,{footer:false});
   dialog.classList.add('order-dialog');
   mountOrderInventory(dialog,o,{onChanged:()=>{}});
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
   (async()=>{try{const pending=db.unwrap(await db.client.from('order_payment_attempts').select('id,amount,transaction_reference,proof_storage_path').eq('order_id',o.id).eq('status','verification_pending').order('created_at',{ascending:false}).limit(1));const p=pending[0],row=dialog.querySelector('[data-actions]');if(!p||!row)return;
     row.insertAdjacentHTML('afterend','<form class="order-proof" data-proof-form><div class="order-proof-head"><strong>Payment proof · '+money(p.amount)+'</strong><span>Reference: '+e(p.transaction_reference||'—')+'</span></div>'+(p.proof_storage_path?'<button type="button" class="button" data-pay-receipt>View receipt</button>':'')+'<p class="order-proof-hint">Check that '+money(p.amount)+' actually arrived in the bank or wallet before confirming.</p><label>Bank note <small>(optional to confirm, needed to reject)</small><input name="reason" maxlength="1000" autocomplete="off" placeholder="e.g. Received 2:04 PM, ref 34688789"></label><div class="order-proof-actions"><button type="submit" class="button order-proof-ok" data-decision="paid">'+icon('check')+' Confirm payment</button><button type="submit" class="button order-proof-no" data-decision="rejected">Reject</button></div><p class="order-proof-error" role="alert"></p></form>');
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
