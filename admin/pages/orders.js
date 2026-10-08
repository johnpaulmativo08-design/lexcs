import {escapeHtml as e,icon,money,notice,statusIndicator,toolbar,showDetails} from '../components.js?v=3';
import {db,grid,fail,loadingTable} from '../backend-ui.js?v=3';
import {renderOrderPayments} from './payments.js?v=4';
import {orderInventorySection,mountOrderInventory,showShortageFromError} from './order-inventory.js?v=2';

// Bento designs (phase 32) are shown as a readable bake sheet; older custom items keep the raw details.
// Letters typed per cupcake / per mini donut (phase 50): "1: LOVE · 3: MOM" (pieces left empty get no letters).
const piecesText=(c,noun)=>(c.message_pieces||[]).map((p,i)=>p?(i+1)+': '+p:'').filter(Boolean).join(' · ')+((c.message_pieces||[]).length?' (by '+noun+' position in the box)':'');
function cupcakeDetails(c){
 const part=p=>p?(p.style_label||p.style)+' — '+(p.color_labels||p.colors||[]).join(', '):'';
 const rows=[['Size',c.size==='regular'?'3oz cupcakes':'Mini cupcakes'],['Flavor',c.flavor_label||c.flavor],['Arrangement',c.pattern_label||c.pattern],
  [c.pattern==='alternate'?'Design A':c.pattern==='assorted'?'Palette':'Design',part(c.a)]];
 if(c.b)rows.push(['Design B',part(c.b)]);
 rows.push(['Finishing',(c.finishes||[]).map(f=>String(f).replace(/_/g,' ')).join(', ')||'None'],['Theme',c.theme&&c.theme!=='none'?(c.theme_label||c.theme)+(c.theme_note?': '+c.theme_note:''):'None']);
 if(c.message==='letters')rows.push(['Fondant letters',piecesText(c,'cupcake')+' · '+(c.message_color_label||c.message_color)]);
 rows.push(['Design extras',money(c.extras_per_item||0)+' per box']);
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>Cupcake design</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+e(v)+'</dd>').join('')+'</dl></div>';
}
function donutDetails(c){
 const rows=[...(c.designer==='cakepop'?[['Pop',c.style_label||c.style]]:[]),['Flavor',(c.flavor_labels||c.flavors||[]).join(' + ')],[c.designer==='cakepop'?'Coating':'Glaze',(c.pattern_label||c.pattern)+' — '+(c.glaze_labels||c.glazes||[]).join(', ')],
  ['Finishes',(c.finish_labels||c.finishes||[]).join(', ')||'None'],['Sprinkles',(c.sprinkles_label||c.sprinkles)+((c.sprinkle_color_labels||[]).length?' ('+c.sprinkle_color_labels.join(', ')+')':'')],
  ['Toppers',c.theme&&c.theme!=='none'?(c.theme_label||c.theme)+(c.theme_note?': '+c.theme_note:''):'None'],
  ...(c.designer==='cakepop'?[]:[['Message',c.message&&c.message!=='none'?(c.message_label||c.message)+' '+(c.message_pieces?piecesText(c,'donut'):'"'+c.message_text+'"')+' · '+(c.message_color_label||c.message_color):'None']]),['Design extras',money(c.extras_per_item||0)+' per box']];
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>'+(c.designer==='cakepop'?'Cake pop design':'Donut design')+'</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+e(v)+'</dd>').join('')+'</dl></div>';
}
function designDetails(c){
 if(c.designer==='cupcake')return cupcakeDetails(c);
 if(c.designer==='donut'||c.designer==='cakepop')return donutDetails(c);
 if(c.designer!=='bento')return '<pre style="white-space:pre-wrap">'+e(JSON.stringify(c,null,2))+'</pre>';
 const name=code=>String(code||'').replace(/_/g,' ');
 const rows=[['Frosting',c.frosting_color_label||name(c.frosting_color)],['Border',(c.border||[]).map(name).join(', ')||'None'],
  ['Decorations',(c.accents||[]).map(a=>name(a)+(a==='ribbon_bows'&&c.bow_color?' ('+name(c.bow_color)+')':'')+(a==='drip'?' ('+(c.drip_color?name(c.drip_color):'matching, darker frosting')+')':'')).join(', ')||'None'],
  ['Message',c.message?'':'None'],['Lettering',c.message?name(c.lettering)+', '+name(c.lettering_color)+(c.font?', font: '+name(c.font):''):'—'],
  ['Topper',c.topper&&c.topper!=='none'?name(c.topper)+(c.topper_text?' '+c.topper_text:''):'None'],['Placement',c.layout?'Arranged by the customer — follow the design pictures':'Standard'],['Design extras',money(c.extras_per_item||0)+' per cake']];
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>Bento design</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+(k==='Message'&&c.message?'<span style="display:block;white-space:pre-wrap;font-size:1.05rem;font-weight:700;padding:6px 8px;background:#fff;border:1px dashed #c8b2dc;border-radius:8px">'+e(c.message)+'</span>':e(v))+'</dd>').join('')+'</dl></div>';
}
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
   const dialog=showDetails('Order #'+o.order_number,'<div class="order-detail-status">'+statusIndicator(o.status,orderTone(o.status),'Order')+statusIndicator(o.payment_status,payTone(o.payment_status),'Payment')+statusIndicator(o.fulfillment_method==='lalamove'?'Delivery':'Pickup','info','Fulfillment')+'</div><p><strong>Ordered:</strong> '+e(new Date(o.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))+' · <strong>Due:</strong> '+e(new Date(o.receiving_start).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))+'</p><p>'+e(o.customer_name)+' · '+e(o.contact_phone)+'</p><p>'+e(o.address)+'</p><p>'+e(o.notes)+'</p><p><strong>Total:</strong> '+(o.total_amount===null?'Pending quote':money(o.total_amount))+' · <strong>Required:</strong> '+(o.deposit_due===null?'Pending quote':money(o.deposit_due))+' · <strong>Verified paid:</strong> '+money(o.amount_paid)+'</p>'+quoteForm+(o.status==='pending'?'<p class="notice">The customer can pay only after you confirm this order. They then choose the downpayment ('+(o.deposit_due===null?'after the delivery fee':money(o.deposit_due))+') or the full amount ('+(o.total_amount===null?'after the delivery fee':money(o.total_amount))+').'+(o.total_amount===null?' Set the delivery fee first.':'')+'</p>':'')+'<ul>'+o.order_items.map(i=>'<li>'+e(i.name_snapshot)+' · '+e(i.variant_label_snapshot)+' × '+i.quantity+' · '+money(i.line_total)+(i.customization?designDetails(i.customization):'')+(i.reference_image_path?'<button class="button" data-reference="'+e(i.reference_image_path)+'">'+(['bento','cupcake','donut','cakepop'].includes(i.customization?.designer)?'View design picture':'View private reference')+'</button>':'')+'</li>').join('')+'</ul>'+orderInventorySection()+'<div class="order-status-actions">'+next.map(s=>'<button class="button'+(s==='confirmed'?' button--primary':'')+'" data-status="'+s+'">'+(s==='confirmed'?'Confirm order':s==='cancelled'?'Cancel order':'Mark '+s)+'</button>').join('')+'</div><p role="alert"></p>',b);
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
  await Promise.all([renderOrderPayments(content,orders,()=>renderOrders(content))]);
  if(target)content.querySelector('[data-order="'+target.id+'"]').click();
 }catch(error){fail(content,error);}
}
