import {escapeHtml as e,icon,money,toolbar,panel} from '../components.js?v=3';
import {db,allRows,grid,fail} from '../backend-ui.js';

const phDate=value=>new Date(value).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'});
const dateKey=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const total=values=>values.reduce((sum,value)=>sum+Math.round(Number(value||0)*100),0)/100;
const labels={awaiting_payment:'Awaiting Payment',verification_pending:'Verification Pending',paid:'Paid',rejected:'Rejected'};

export async function renderReports(content,subpage){
 content.innerHTML='<p class="notice">Loading saved orders and verified payments…</p>';
 try{
  const [orders,payments,methods,profiles]=await Promise.all([
   allRows(()=>db.client.from('orders').select('*,order_items(*)').order('created_at',{ascending:false})),
   allRows(()=>db.client.from('order_payment_attempts').select('*').order('created_at',{ascending:false})),
   db.client.from('payment_methods').select('id,display_name').then(db.unwrap),
   db.client.from('profiles').select('id,full_name').then(db.unwrap)
  ]);
  const byOrder=new Map(orders.map(order=>[order.id,order])),byMethod=new Map(methods.map(method=>[method.id,method.display_name])),byAdmin=new Map(profiles.map(profile=>[profile.id,profile.full_name]));
  const verified=payments.filter(payment=>payment.status==='paid');
  const gross=total(orders.filter(order=>order.status!=='cancelled').map(order=>order.total_amount));
  const received=total(verified.map(payment=>payment.amount));
  const outstanding=total(orders.filter(order=>order.status!=='cancelled'&&order.total_amount!==null).map(order=>Math.max(0,Number(order.total_amount)-Number(order.amount_paid))));
  const summary='<div class="report-stats">'+[['Gross Order Value',gross],['Verified Payments Received',received],['Outstanding Balance',outstanding]].map(([label,value])=>'<section class="stat"><div><strong>'+money(value)+'</strong></div><h2>'+e(label)+'</h2></section>').join('')+'</div>';
  const links='<div class="report-links"><a class="button" href="#reports/transactions">'+icon('orders')+' Sales Orders</a><a class="button" href="#reports/payments">'+icon('check')+' Payments</a><a class="button" href="#reports/revenue">'+icon('revenue')+' Revenue by Month</a></div>';
  if(!subpage){
   const top=new Map();orders.filter(order=>order.status==='completed').forEach(order=>order.order_items.forEach(item=>top.set(item.name_snapshot,(top.get(item.name_snapshot)||0)+item.quantity)));
   content.innerHTML='<header class="module-heading"><div><h1>Reports</h1><p>Gross orders and verified money received are separate figures.</p></div></header>'+summary+links+
    '<div class="report-grid">'+panel('Payment overview','<p>Verified received: <strong>'+money(received)+'</strong></p><p>'+payments.filter(payment=>payment.status==='verification_pending').length+' transfers awaiting Admin review</p><p>Pending and rejected attempts are not counted as revenue.</p>','<a class="button" href="#reports/payments">View payments</a>')+
    '<div class="report-side">'+panel('Top completed products',[...top].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,count])=>'<p>'+e(name)+' · '+count+'</p>').join('')||'No completed product sales yet.')+panel('Orders','<p>'+orders.length+' saved orders</p>','<a class="button" href="#reports/transactions">View orders</a>')+'</div></div>';
   return;
  }
  const page=['transactions','payments','revenue'].includes(subpage)?subpage:'transactions';
  const controls='<label>From <input type="date" id="report-from"></label><label>To <input type="date" id="report-to"></label><select id="report-method" aria-label="Payment method"><option value="">All methods</option>'+methods.map(method=>'<option value="'+e(method.id)+'">'+e(method.display_name)+'</option>').join('')+'</select><select id="report-payment-status" aria-label="Payment status"><option value="">All payment statuses</option>'+Object.entries(labels).map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')+'</select><select id="report-order-status" aria-label="Order status"><option value="">All order statuses</option>'+['pending','confirmed','preparing','ready','completed','cancelled'].map(status=>'<option>'+status+'</option>').join('')+'</select><button class="button" id="print-report">'+icon('reports')+' Print</button>';
  content.innerHTML='<header class="module-heading"><div><h1>Reports</h1><p>Received revenue includes verified payment attempts only.</p></div></header>'+summary+links+toolbar(controls)+'<div id="report-data"></div>';
  const draw=()=>{
   const q=content.querySelector('.search').value.toLowerCase(),from=content.querySelector('#report-from').value,to=content.querySelector('#report-to').value,method=content.querySelector('#report-method').value,paymentStatus=content.querySelector('#report-payment-status').value,orderStatus=content.querySelector('#report-order-status').value;
   const within=value=>(!from||dateKey(value)>=from)&&(!to||dateKey(value)<=to);
   const matchesOrder=order=>!orderStatus||order.status===orderStatus;
   const matchingPayment=payment=>(!method||payment.payment_method_id===method)&&(!paymentStatus||payment.status===paymentStatus)&&matchesOrder(byOrder.get(payment.order_id)||{});
   const filteredPayments=payments.filter(payment=>within(payment.status==='paid'?payment.verified_at:payment.submitted_at||payment.created_at)&&matchingPayment(payment)&&JSON.stringify([payment.transaction_reference,byOrder.get(payment.order_id)?.order_number,byOrder.get(payment.order_id)?.customer_name]).toLowerCase().includes(q));
   const filteredOrders=orders.filter(order=>within(order.created_at)&&matchesOrder(order)&&(!method||payments.some(payment=>payment.order_id===order.id&&payment.payment_method_id===method))&&(!paymentStatus||payments.some(payment=>payment.order_id===order.id&&payment.status===paymentStatus))&&JSON.stringify([order.order_number,order.customer_name,order.created_at]).toLowerCase().includes(q));
   if(page==='payments')content.querySelector('#report-data').innerHTML=grid(['Date','Order','Customer','Method','Reference','Amount','Status','Verified by / at'],filteredPayments.map(payment=>{const order=byOrder.get(payment.order_id);return '<tr><td>'+e(phDate(payment.status==='paid'?payment.verified_at:payment.submitted_at||payment.created_at))+'</td><td>#'+e(order?.order_number||'—')+'</td><td>'+e(order?.customer_name||'—')+'</td><td>'+e(byMethod.get(payment.payment_method_id)||'Manual QR')+'</td><td>'+e(payment.transaction_reference||'—')+'</td><td>'+money(payment.amount)+'</td><td>'+e(labels[payment.status])+'</td><td>'+e(payment.verified_by?byAdmin.get(payment.verified_by)||payment.verified_by:'—')+(payment.verified_at?' · '+e(phDate(payment.verified_at)):'')+'</td></tr>';}).join('')||'<tr><td colspan="8">No transactions found for the selected period.</td></tr>');
   else if(page==='revenue'){
    const monthly=new Map();filteredPayments.filter(payment=>payment.status==='paid').forEach(payment=>{const month=dateKey(payment.verified_at).slice(0,7);monthly.set(month,(monthly.get(month)||0)+Math.round(Number(payment.amount)*100));});
    content.querySelector('#report-data').innerHTML=grid(['Month','Verified Payments Received'],[...monthly].sort((a,b)=>b[0].localeCompare(a[0])).map(([month,centavos])=>'<tr><td>'+e(month)+'</td><td>'+money(centavos/100)+'</td></tr>').join('')||'<tr><td colspan="2">No verified payments found for the selected period.</td></tr>');
   }else content.querySelector('#report-data').innerHTML=grid(['Date','Order','Customer','Order Total','Verified Paid','Remaining','Payment','Order Status'],filteredOrders.map(order=>'<tr><td>'+e(phDate(order.created_at))+'</td><td>#'+e(order.order_number)+'</td><td>'+e(order.customer_name)+'</td><td>'+(order.total_amount===null?'Pending quote':money(order.total_amount))+'</td><td>'+money(order.amount_paid)+'</td><td>'+(order.total_amount===null?'Pending quote':money(Math.max(0,Number(order.total_amount)-Number(order.amount_paid))))+'</td><td>'+e(order.payment_status)+'</td><td>'+e(order.status)+'</td></tr>').join('')||'<tr><td colspan="8">No orders found for the selected period.</td></tr>');
  };
  content.querySelectorAll('.toolbar input,.toolbar select').forEach(input=>input.addEventListener('input',draw));
  content.querySelector('#print-report').onclick=()=>window.print();draw();
 }catch(error){fail(content,error);}
}
