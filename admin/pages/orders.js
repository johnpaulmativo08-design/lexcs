import {escapeHtml as e,icon,money,notice,statusIndicator,toolbar,showDetails} from '../components.js?v=3';
import {db,grid,fail} from '../backend-ui.js';
export async function renderOrders(content){
 content.innerHTML=notice('Loading saved orders…');
 try{
  const orders=await db.orders();let history=false;
  content.innerHTML='<header class="module-heading"><div><h1>Orders</h1><p>Manage customer orders and fulfillment progress.</p></div></header>'+notice('Saved orders · payment preferences do not collect payment.')+toolbar('<select id="status"><option value="">All statuses</option>'+['pending','confirmed','preparing','ready','completed','cancelled'].map(s=>'<option>'+s+'</option>').join('')+'</select>')+'<div class="report-links"><button class="button primary" data-view="current">'+icon('orders')+' Current Orders</button><button class="button" data-view="history">'+icon('clock')+' Order History</button></div><div id="orders-table"></div>';
  const orderTone=status=>status==='completed'?'success':status==='cancelled'?'neutral':status==='pending'?'warning':status==='ready'?'info':'success';
  const payTone=status=>status==='paid'?'success':status==='refunded'?'neutral':status==='failed'?'danger':'warning';
  const draw=()=>{
   const search=content.querySelector('.search').value.toLowerCase(),status=content.querySelector('#status').value;
   const filtered=orders.filter(o=>(['completed','cancelled'].includes(o.status)===history)&&(!status||o.status===status)&&JSON.stringify([o.order_number,o.customer_name]).toLowerCase().includes(search));
   content.querySelector('#orders-table').innerHTML=grid(['Order ID','Customer','Items','Amount','Payment','Fulfillment','Status','Date','Action'],filtered.map(o=>'<tr><td>#'+o.order_number+'</td><td>'+e(o.customer_name)+'</td><td>'+o.order_items.reduce((n,i)=>n+i.quantity,0)+'</td><td>'+(o.total_amount===null?'Pending quote':money(o.total_amount))+'</td><td>'+statusIndicator(o.payment_status,payTone(o.payment_status),o.requested_payment_method||'')+'</td><td>'+statusIndicator(o.fulfillment_method==='lalamove'?'Delivery':'Pickup','info')+'</td><td>'+statusIndicator(o.status,orderTone(o.status))+'</td><td>'+new Date(o.receiving_start).toLocaleString('en-PH',{timeZone:'Asia/Manila'})+'</td><td><button class="button" data-order="'+o.id+'">'+icon('eye')+' View</button></td></tr>').join('')||'<tr><td colspan="9">No matching orders.</td></tr>');
  };
  content.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{history=b.dataset.view==='history';draw();});
  content.querySelector('.search').oninput=draw;content.querySelector('#status').onchange=draw;
  content.onclick=event=>{
   const b=event.target.closest('[data-order]');if(!b)return;
   const o=orders.find(o=>o.id===b.dataset.order);
   const next={pending:['confirmed','cancelled'],confirmed:['preparing','cancelled'],preparing:['ready','cancelled'],ready:['completed','cancelled']}[o.status]||[];
   const dialog=showDetails('Order #'+o.order_number,'<div class="order-detail-status">'+statusIndicator(o.status,orderTone(o.status),'Order')+statusIndicator(o.payment_status,payTone(o.payment_status),'Payment')+statusIndicator(o.fulfillment_method==='lalamove'?'Delivery':'Pickup','info','Fulfillment')+'</div><p>'+e(o.customer_name)+' · '+e(o.contact_phone)+'</p><p>'+e(o.address)+'</p><p>'+e(o.notes)+'</p><ul>'+o.order_items.map(i=>'<li>'+e(i.name_snapshot)+' · '+e(i.variant_label_snapshot)+' × '+i.quantity+' · '+money(i.line_total)+(i.customization?'<pre style="white-space:pre-wrap">'+e(JSON.stringify(i.customization,null,2))+'</pre>':'')+(i.reference_image_path?'<button class="button" data-reference="'+e(i.reference_image_path)+'">View private reference</button>':'')+'</li>').join('')+'</ul>'+next.map(s=>'<button class="button" data-status="'+s+'">'+s+'</button>').join('')+'<p role="alert"></p>',b);
   dialog.querySelectorAll('[data-status]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await db.rpc('set_order_status',{order_id:o.id,next_status:button.dataset.status});dialog.close();await renderOrders(content);}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;button.disabled=false;}});
   dialog.querySelectorAll('[data-reference]').forEach(button=>button.onclick=async()=>{try{const url=await db.privateImage('customer-references',button.dataset.reference);const img=document.createElement('img');img.src=url;img.alt='Private customer reference';button.replaceWith(img);}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}});
  };
  // Dashboard links reuse the existing order detail dialog and status actions.
  const detailId=location.hash.split('/')[1]==='detail'?location.hash.split('/')[2]:null;
  const target=orders.find(o=>o.id===detailId);
  if(target){history=['completed','cancelled'].includes(target.status);content.querySelector('.search').value=String(target.order_number);}
  draw();
  if(target)content.querySelector('[data-order="'+target.id+'"]').click();
 }catch(error){fail(content,error);}
}
