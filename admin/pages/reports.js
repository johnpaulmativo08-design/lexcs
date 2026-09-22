import {escapeHtml as e,icon,money,notice,toolbar,stats,panel} from '../components.js?v=3';
import {db,grid,fail} from '../backend-ui.js';
export async function renderReports(content,subpage){
 try{
  const orders=await db.orders(),revenue=subpage==='revenue';
  if (!subpage) {
    const collected = orders.reduce((sum, order) => sum + Number(order.amount_paid), 0);
    const totals = new Map();
    orders.filter(order => order.status === 'completed').forEach(order => order.order_items.forEach(item => totals.set(item.name_snapshot, (totals.get(item.name_snapshot) || 0) + item.quantity)));
    const top = [...totals].sort((a,b) => b[1]-a[1]).slice(0,5).map(([name,count]) => '<p>'+e(name)+' · '+count+'</p>').join('') || 'No completed product sales yet.';
    content.innerHTML = '<header class="module-heading"><div><h1>Reports</h1><p>Review order activity, revenue, and product performance.</p></div></header>'+notice('Live orders and collected amounts. Payment processing is not connected.') + '<div class="report-stats">'+stats()+'</div><div class="report-links"><a class="button" href="#reports/transactions">'+icon('orders')+' Order Transactions</a><a class="button" href="#reports/revenue">'+icon('revenue')+' Revenue</a></div><div class="report-grid">'+panel('Sales Overview','<div class="chart-empty">Collected revenue: '+money(collected)+'</div><div class="chart-days">Sun　 Mon　 Tue　 Wed　 Thu　 Fri　 Sat</div>','','sales-panel')+'<div class="report-side">'+panel('Top Product','<div class="empty">'+top+'</div>')+panel('Order Transaction','<div class="empty">'+orders.length+' saved orders</div>','<a class="button" href="#reports/transactions">'+icon('eye')+' View</a>')+'</div></div>';
    content.querySelectorAll('.stat strong').forEach((el,i) => { el.textContent = [money(collected),orders.length][i]; el.removeAttribute('aria-label'); });
    return;
  }
  content.innerHTML='<header class="module-heading"><div><h1>Reports</h1><p>Review order activity, revenue, and product performance.</p></div></header>'+notice('Recorded orders and collected amounts. No payment integration is connected.')+stats()+'<div class="report-links"><a class="button" href="#reports/transactions">'+icon('orders')+' Order Transactions</a><a class="button" href="#reports/revenue">'+icon('revenue')+' Revenue</a></div>'+toolbar('<button class="button" id="print-report">'+icon('reports')+' Print</button>')+'<div id="report-data"></div>';
  const values=[money(orders.reduce((n,o)=>n+Number(o.amount_paid),0)),orders.length];content.querySelectorAll('.stat strong').forEach((el,i)=>{el.textContent=values[i];el.removeAttribute('aria-label');});
  const draw=()=>{
   const q=content.querySelector('.search').value.toLowerCase(),filtered=orders.filter(o=>JSON.stringify([o.order_number,o.customer_name,o.created_at]).toLowerCase().includes(q));
   if(revenue){const months=new Map();filtered.forEach(o=>{const m=o.created_at.slice(0,7);months.set(m,(months.get(m)||0)+Number(o.amount_paid));});content.querySelector('#report-data').innerHTML=grid(['Month','Collected Revenue'],[...months].sort((a,b)=>b[0].localeCompare(a[0])).map(([m,total])=>'<tr><td>'+m+'</td><td>'+money(total)+'</td></tr>').join('')||'<tr><td colspan="2">No records yet.</td></tr>');}
   else content.querySelector('#report-data').innerHTML=grid(['Order ID','Name','Fulfillment','Items','Total amount','Payment status','Date'],filtered.map(o=>'<tr><td>#'+o.order_number+'</td><td>'+e(o.customer_name)+'</td><td>'+e(o.fulfillment_method)+'</td><td>'+o.order_items.map(i=>e(i.name_snapshot)+' ×'+i.quantity).join('<br>')+'</td><td>'+(o.total_amount===null?'Pending quote':money(o.total_amount))+'</td><td>'+e(o.payment_status)+'</td><td>'+e(new Date(o.created_at).toLocaleDateString())+'</td></tr>').join('')||'<tr><td colspan="7">No orders yet.</td></tr>');
  };
  content.querySelector('.search').oninput=draw;content.querySelector('#print-report').onclick=()=>window.print();draw();
 }catch(error){fail(content,error);}
}
