import {escapeHtml as e,icon,money,notice,statusIndicator,toolbar,showDetails} from '../components.js?v=3';
import {db,grid,fail,loadingTable} from '../backend-ui.js?v=3';
import {renderOrderPayments} from './payments.js?v=3';
import {orderInventorySection,mountOrderInventory,showShortageFromError} from './order-inventory.js?v=2';

// Bento designs (phase 32) are shown as a readable bake sheet; older custom items keep the raw details.
function cupcakeDetails(c){
 const part=p=>p?(p.style_label||p.style)+' — '+(p.color_labels||p.colors||[]).join(', '):'';
 const rows=[['Size',c.size==='regular'?'3oz cupcakes':'Mini cupcakes'],['Flavor',c.flavor_label||c.flavor],['Arrangement',c.pattern_label||c.pattern],
  [c.pattern==='alternate'?'Design A':c.pattern==='assorted'?'Palette':'Design',part(c.a)]];
 if(c.b)rows.push(['Design B',part(c.b)]);
 rows.push(['Finishing',(c.finishes||[]).map(f=>String(f).replace(/_/g,' ')).join(', ')||'None'],['Theme',c.theme&&c.theme!=='none'?(c.theme_label||c.theme)+(c.theme_note?': '+c.theme_note:''):'None'],['Design extras',money(c.extras_per_item||0)+' per box']);
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>Cupcake design</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+e(v)+'</dd>').join('')+'</dl></div>';
}
function designDetails(c){
 if(c.designer==='cupcake')return cupcakeDetails(c);
 if(c.designer!=='bento')return '<pre style="white-space:pre-wrap">'+e(JSON.stringify(c,null,2))+'</pre>';
 const name=code=>String(code||'').replace(/_/g,' ');
 const rows=[['Frosting',c.frosting_color_label||name(c.frosting_color)],['Border',(c.border||[]).map(name).join(', ')||'None'],
  ['Decorations',(c.accents||[]).map(a=>name(a)+(a==='ribbon_bows'&&c.bow_color?' ('+name(c.bow_color)+')':'')+(a==='drip'?' ('+(c.drip_color?name(c.drip_color):'matching, darker frosting')+')':'')).join(', ')||'None'],
  ['Message',c.message?'':'None'],['Lettering',c.message?name(c.lettering)+', '+name(c.lettering_color)+(c.font?', font: '+name(c.font):''):'—'],
  ['Topper',c.topper&&c.topper!=='none'?name(c.topper)+(c.topper_text?' '+c.topper_text:''):'None'],['Placement',c.layout?'Arranged by the customer — follow the design pictures':'Standard'],['Design extras',money(c.extras_per_item||0)+' per cake']];
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>Bento design</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+(k==='Message'&&c.message?'<span style="display:block;white-space:pre-wrap;font-size:1.05rem;font-weight:700;padding:6px 8px;background:#fff;border:1px dashed #c8b2dc;border-radius:8px">'+e(c.message)+'</span>':e(v))+'</dd>').join('')+'</dl></div>';
}
async function renderPaymentTests(content){
 const panel=content.querySelector('#payment-tests');
 if(!panel)return;
 panel.innerHTML='<div class="payment-test-heading"><div><h2>QR payment tests</h2><p>Real ₱1 MariBank transfers · Verify against the bank account before approval.</p></div></div>'+loadingTable(['Customer','Created','Amount','Reference','Status','Action'],5);
 try{
  const tests=db.unwrap(await db.client.from('payment_tests').select('*').order('created_at',{ascending:false}).limit(50));
  if(!panel.isConnected)return;
  panel.innerHTML='<div class="payment-test-heading"><div><h2>QR payment tests</h2><p>Real ₱1 MariBank transfers · Verify against the bank account before approval.</p></div><a class="button" href="../payment-test/" target="_blank" rel="noopener">Open customer test</a></div>'+
   (tests.length?grid(['Customer','Created','Amount','Reference','Status','Action'],tests.map(test=>{
    const status=test.status==='verified'?'Verified':test.status==='submitted'?'Needs review':test.status==='rejected'?'Rejected':'Awaiting transfer';
    return '<tr><td>'+e(test.customer_name)+'</td><td>'+e(new Date(test.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'}))+'</td><td>₱1.00</td><td>'+e(test.payment_reference||'—')+'</td><td>'+statusIndicator(status,test.status==='verified'?'success':test.status==='rejected'?'danger':'warning')+'</td><td>'+(test.status==='submitted'?'<button class="button" data-payment-test="'+e(test.id)+'">Review</button>':'—')+'</td></tr>';
   }).join('')):'<p>No QR payment tests yet.</p>');
  panel.querySelectorAll('[data-payment-test]').forEach(button=>button.onclick=()=>{
   const test=tests.find(row=>row.id===button.dataset.paymentTest);
   const dialog=showDetails('Review ₱1 MariBank test',
    '<p><strong>Customer:</strong> '+e(test.customer_name)+'</p><p><strong>Amount to find in MariBank:</strong> ₱1.00</p><p><strong>Customer reference:</strong> '+e(test.payment_reference)+'</p><p>Check your MariBank transaction history for an actual ₱1.00 credit with this reference. A customer-submitted reference alone does not prove payment.</p><form id="review-qr-test"><label class="form-field">Decision<select name="decision"><option value="verified">Verified in MariBank</option><option value="rejected">Could not verify</option></select></label><label class="form-field">Bank confirmation details or rejection reason<input name="note" maxlength="500" required placeholder="Bank transaction date/time or reason"></label><p role="alert"></p><button class="button primary" type="submit">Save decision</button></form>',button);
   dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,submit=form.querySelector('button');submit.disabled=true;
    try{await db.rpc('review_payment_test',{test_id:test.id,decision:form.elements.decision.value,note:form.elements.note.value.trim()});dialog.close();await renderPaymentTests(content);}
    catch(error){dialog.querySelector('[role=alert]').textContent=error.message;submit.disabled=false;}
   };
  });
 }catch(error){if(panel.isConnected){console.warn('QR payment tests could not load:',error);panel.innerHTML='<div class="payment-test-heading"><div><h2>QR payment tests</h2></div></div><p role="alert">QR payment tests could not load.</p><button class="button" type="button" data-test-retry>Try again</button>';panel.querySelector('[data-test-retry]').onclick=()=>renderPaymentTests(content);}}
}
export async function renderOrders(content){
 content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders and payments.</p></div></header>'+loadingTable(['Order','Customer','Total','Payment','Status','Due date','Action']);
 try{
  const orders=await db.orders();let history=false;
  content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders, payments, and fulfillment progress.</p></div></header>'+notice('Manual QR payments are counted only after Admin verifies the actual bank credit.')+toolbar('<select id="status"><option value="">All statuses</option>'+['pending','confirmed','preparing','ready','completed','cancelled'].map(s=>'<option>'+s+'</option>').join('')+'</select>')+'<div class="report-links"><button class="button primary" data-view="current">'+icon('orders')+' Current Orders</button><button class="button" data-view="history">'+icon('clock')+' Order History</button></div><div id="orders-table"></div><section id="order-payments" class="panel payment-tests-panel"><div class="payment-test-heading"><h2>Order payments</h2></div>'+loadingTable(['Order','Customer','Submitted','Required amount','Method','Reference','Status','Action'])+'</section><section id="payment-tests" class="panel payment-tests-panel"><div class="payment-test-heading"><h2>QR payment tests</h2></div>'+loadingTable(['Customer','Created','Amount','Reference','Status','Action'])+'</section>';
  const orderTone=status=>status==='completed'?'success':status==='cancelled'?'neutral':status==='pending'?'warning':status==='ready'?'info':'success';
   const payTone=status=>status==='paid'||status==='partially_paid'?'success':status==='refunded'?'neutral':status==='failed'||status==='rejected'?'danger':'warning';
  const readableStatus=status=>String(status||'Unknown').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase());
  const draw=()=>{
   const search=content.querySelector('.search').value.toLowerCase(),status=content.querySelector('#status').value;
   const filtered=orders.filter(o=>(['completed','cancelled'].includes(o.status)===history)&&(!status||o.status===status)&&JSON.stringify([o.order_number,o.customer_name]).toLowerCase().includes(search));
   content.querySelector('#orders-table').innerHTML=grid(['Order','Customer','Total','Payment','Status','Due date','Action'],filtered.map(o=>'<tr><td>#'+e(o.order_number)+'</td><td>'+e(o.customer_name)+'</td><td>'+(o.total_amount===null?'Pending quote':money(o.total_amount))+'</td><td>'+statusIndicator(readableStatus(o.payment_status),payTone(o.payment_status))+'</td><td>'+statusIndicator(readableStatus(o.status),orderTone(o.status))+'</td><td>'+new Date(o.receiving_start).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium'})+'</td><td><button class="button" data-order="'+e(o.id)+'">'+icon('eye')+' View</button></td></tr>').join('')||'<tr><td colspan="7" class="empty">No matching orders. Try a different search or status.</td></tr>');
  };
  content.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{history=b.dataset.view==='history';draw();});
  content.querySelector('.search').oninput=draw;content.querySelector('#status').onchange=draw;
  content.onclick=event=>{
   const b=event.target.closest('[data-order]');if(!b)return;
   const o=orders.find(o=>o.id===b.dataset.order);
   const next={pending:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled']}[o.status]||[];
   const canQuote=o.fulfillment_method==='lalamove'&&o.status!=='cancelled'&&Number(o.amount_paid||0)===0&&o.payment_status!=='verification_pending';
   const quoteForm=canQuote?'<form id="delivery-quote"><label class="form-field">Delivery fee (₱)<input name="fee" type="number" min="0" max="99999" step="0.01" required value="'+e(o.delivery_fee??'')+'"></label><button class="button" type="submit">'+(o.delivery_fee_status==='quoted'?'Update delivery quote':'Set delivery quote')+'</button></form>':'';
   const dialog=showDetails('Order #'+o.order_number,'<div class="order-detail-status">'+statusIndicator(o.status,orderTone(o.status),'Order')+statusIndicator(o.payment_status,payTone(o.payment_status),'Payment')+statusIndicator(o.fulfillment_method==='lalamove'?'Delivery':'Pickup','info','Fulfillment')+'</div><p>'+e(o.customer_name)+' · '+e(o.contact_phone)+'</p><p>'+e(o.address)+'</p><p>'+e(o.notes)+'</p><p><strong>Total:</strong> '+(o.total_amount===null?'Pending quote':money(o.total_amount))+' · <strong>Required:</strong> '+(o.deposit_due===null?'Pending quote':money(o.deposit_due))+' · <strong>Verified paid:</strong> '+money(o.amount_paid)+'</p>'+quoteForm+'<ul>'+o.order_items.map(i=>'<li>'+e(i.name_snapshot)+' · '+e(i.variant_label_snapshot)+' × '+i.quantity+' · '+money(i.line_total)+(i.customization?designDetails(i.customization):'')+(i.reference_image_path?'<button class="button" data-reference="'+e(i.reference_image_path)+'">'+(['bento','cupcake'].includes(i.customization?.designer)?'View design picture':'View private reference')+'</button>':'')+'</li>').join('')+'</ul>'+orderInventorySection()+'<div class="order-status-actions">'+next.map(s=>'<button class="button'+(s==='confirmed'?' button--primary':'')+'" data-status="'+s+'">'+(s==='confirmed'?'Confirm order':s==='cancelled'?'Cancel order':'Mark '+s)+'</button>').join('')+'</div><p role="alert"></p>',b);
   mountOrderInventory(dialog,o,{onChanged:()=>{}});
   const quote=dialog.querySelector('#delivery-quote');
   if(quote)quote.onsubmit=async event=>{
    event.preventDefault();const submit=quote.querySelector('button');submit.disabled=true;
    try{await db.rpc('quote_order_delivery',{target_order:o.id,quoted_fee:Number(quote.elements.fee.value)});dialog.close();await renderOrders(content);}
    catch(error){dialog.querySelector('.dialog-body > [role=alert]').textContent=error.message;submit.disabled=false;}
   };
   dialog.querySelectorAll('[data-status]').forEach(button=>button.onclick=async()=>{button.disabled=true;dialog.querySelector('.dialog-body > [role=alert]').textContent='';try{await db.rpc('set_order_status',{order_id:o.id,next_status:button.dataset.status});dialog.close();await renderOrders(content);}catch(error){if(!showShortageFromError(error,dialog,o.order_number))dialog.querySelector('.dialog-body > [role=alert]').textContent=error.message;button.disabled=false;}});
   dialog.querySelectorAll('[data-reference]').forEach(button=>button.onclick=async()=>{try{const url=await db.privateImage('customer-references',button.dataset.reference);const img=document.createElement('img');img.src=url;img.alt='Private customer reference';button.replaceWith(img);}catch(error){dialog.querySelector('.dialog-body > [role=alert]').textContent=error.message;}});
  };
  // Dashboard links reuse the existing order detail dialog and status actions.
  const detailId=location.hash.split('/')[1]==='detail'?location.hash.split('/')[2]:null;
  const target=orders.find(o=>o.id===detailId);
  if(target){history=['completed','cancelled'].includes(target.status);content.querySelector('.search').value=String(target.order_number);}
  draw();
  await Promise.all([renderOrderPayments(content,orders,()=>renderOrders(content)),renderPaymentTests(content)]);
  if(target)content.querySelector('[data-order="'+target.id+'"]').click();
 }catch(error){fail(content,error);}
}
