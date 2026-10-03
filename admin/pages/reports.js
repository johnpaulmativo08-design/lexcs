import {escapeHtml as e,icon,money,toolbar} from '../components.js?v=3';
import {db,allRows,grid,fail,loadingMetrics,loadingTable,loadingList} from '../backend-ui.js?v=3';

// Reports: how the business is doing over a chosen period (compared with the period before it), plus the
// detailed records (orders, payments, revenue by month) with filters, CSV download and print.
// Money received = verified payment attempts only; order value counts every non-cancelled order.
const phDate=value=>new Date(value).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',year:'numeric',month:'short',day:'numeric'});
const dateKey=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const addDays=(key,n)=>new Date(Date.parse(key+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const daysBetween=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
const total=values=>values.reduce((sum,value)=>sum+Math.round(Number(value||0)*100),0)/100;
const peso=v=>'₱'+Number(v||0).toLocaleString('en-PH',{minimumFractionDigits:0,maximumFractionDigits:2});
const labels={awaiting_payment:'Awaiting Payment',verification_pending:'Verification Pending',paid:'Paid',rejected:'Rejected'};
const WEEKDAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const PERIODS=[['week','This week'],['month','This month'],['last-month','Last month'],['90','Last 90 days'],['custom','Custom']];
const STORE='lexc_admin_report_period';

function periodRange(choice,from,to){
 const today=dateKey(new Date());
 if(choice==='week'){const d=new Date(today+'T12:00:00Z').getUTCDay();const start=addDays(today,-((d+6)%7));return [start,today];}
 if(choice==='month')return [today.slice(0,8)+'01',today];
 if(choice==='last-month'){const first=today.slice(0,8)+'01',end=addDays(first,-1);return [end.slice(0,8)+'01',end];}
 if(choice==='90')return [addDays(today,-89),today];
 return [from||addDays(today,-29),to||today];
}
const within=(value,[a,b])=>{if(!value)return false;const k=dateKey(value);return k>=a&&k<=b;};
const change=(now,before)=>{if(!before&&!now)return '<span class="rep-delta">No change</span>';if(!before)return '<span class="rep-delta is-up">New this period</span>';const pct=Math.round((now-before)/before*100);return '<span class="rep-delta '+(pct>0?'is-up':pct<0?'is-down':'')+'">'+(pct>0?'▲ ':pct<0?'▼ ':'')+Math.abs(pct)+'% vs previous period</span>';};
const bars=(rows,format=v=>v)=>{const max=Math.max(1,...rows.map(r=>r[1]));return '<div class="rep-bars">'+rows.map(([label,value,extra])=>'<div class="rep-bar-row"><span class="rep-bar-label">'+e(label)+'</span><span class="rep-bar-track"><span style="width:'+Math.max(2,Math.round(value/max*100))+'%"></span></span><span class="rep-bar-value">'+e(format(value))+(extra?' <small>'+e(extra)+'</small>':'')+'</span></div>').join('')+'</div>';};
const card=(title,body,extra='')=>'<section class="panel rep-card"><header class="rep-card-head"><h2>'+e(title)+'</h2>'+extra+'</header>'+body+'</section>';
const none=text=>'<p class="rep-empty">'+e(text)+'</p>';

export async function renderReports(content,subpage){
 const head=(text)=>'<header class="module-heading"><div><h1>Reports</h1><p>'+e(text)+'</p></div></header>';
 const tabs=active=>'<nav class="rep-tabs" aria-label="Report views"><a href="#reports"'+(active==='overview'?' aria-current="page"':'')+'>Overview</a><a href="#reports/transactions"'+(active==='transactions'?' aria-current="page"':'')+'>Orders</a><a href="#reports/payments"'+(active==='payments'?' aria-current="page"':'')+'>Payments</a><a href="#reports/revenue"'+(active==='revenue'?' aria-current="page"':'')+'>Revenue by month</a></nav>';
 const page=['transactions','payments','revenue'].includes(subpage)?subpage:'overview';
 content.innerHTML=head('How the business is doing, compared with the period before.')+tabs(page)+loadingMetrics(5)+(page==='overview'?'<div class="rep-grid">'+card('Sales',loadingList(4))+card('Best sellers',loadingList(5))+'</div>':loadingTable(['Date','Order','Customer','Amount','Status'],6));
 try{
  const [orders,lines,payments,methods,profiles]=await Promise.all([
   allRows(()=>db.client.from('orders').select('*').order('created_at',{ascending:false})),
   allRows(()=>db.client.from('order_items').select('id,order_id,name_snapshot,variant_label_snapshot,quantity,line_total,customization').order('id')),
   allRows(()=>db.client.from('order_payment_attempts').select('*').order('created_at',{ascending:false})),
   db.client.from('payment_methods').select('id,code,display_name').then(db.unwrap),
   db.client.from('profiles').select('id,full_name').then(db.unwrap)
  ]);
  const linesOf=new Map();lines.forEach(l=>{if(!linesOf.has(l.order_id))linesOf.set(l.order_id,[]);linesOf.get(l.order_id).push(l);});
  orders.forEach(o=>{o.order_items=linesOf.get(o.id)||[];});
  const byOrder=new Map(orders.map(o=>[o.id,o])),byMethod=new Map(methods.map(m=>[m.id,m.display_name])),byAdmin=new Map(profiles.map(p=>[p.id,p.full_name]));
  if(page==='overview') return overview(content,{orders,payments,byMethod},head,tabs);
  records(content,page,{orders,payments,methods,byOrder,byMethod,byAdmin},head,tabs);
 }catch(error){fail(content,error);}
}

async function overview(content,{orders,payments,byMethod},head,tabs){
 let saved={};try{saved=JSON.parse(localStorage.getItem(STORE)||'{}');}catch{}
 const state={choice:PERIODS.some(p=>p[0]===saved.choice)?saved.choice:'month',from:saved.from||'',to:saved.to||''};
 // Design option labels (colors, toppers, …) and stock data load once, in the background of the first draw.
 const extra=Promise.all([
  db.client.from('design_options').select('group_key,code,label').then(db.unwrap).catch(()=>[]),
  allRows(()=>db.client.from('inventory_movements').select('item_id,batch_id,quantity_delta,reason,created_at').in('reason',['usage','waste','expired'])).catch(()=>[]),
  allRows(()=>db.client.from('inventory_batches').select('id,item_id,quantity_received,purchase_price')).catch(()=>[]),
  allRows(()=>db.client.from('inventory_items').select('id,name,unit')).catch(()=>[])
 ]);
 const draw=async()=>{
  const range=periodRange(state.choice,state.from,state.to),span=daysBetween(range[0],range[1])+1;
  const prev=[addDays(range[0],-span),addDays(range[0],-1)];
  const live=o=>o.status!=='cancelled';
  const ordersIn=r=>orders.filter(o=>live(o)&&within(o.created_at,r));
  const paidIn=r=>payments.filter(p=>p.status==='paid'&&within(p.verified_at,r));
  const cur={orders:ordersIn(range),paid:paidIn(range)},old={orders:ordersIn(prev),paid:paidIn(prev)};
  const sum=(list,key)=>total(list.map(x=>x[key]));
  const received=sum(cur.paid,'amount'),receivedBefore=sum(old.paid,'amount');
  const value=sum(cur.orders,'total_amount'),valueBefore=sum(old.orders,'total_amount');
  const avg=cur.orders.length?value/cur.orders.length:0,avgBefore=old.orders.length?valueBefore/old.orders.length:0;
  const addOns=sum(cur.orders,'customization_total'),addOnsBefore=sum(old.orders,'customization_total');
  const owed=total(orders.filter(o=>live(o)&&o.total_amount!==null).map(o=>Math.max(0,Number(o.total_amount)-Number(o.amount_paid))));
  const kpi=(label,val,delta,note)=>'<section class="panel rep-kpi"><span>'+e(label)+'</span><strong>'+val+'</strong>'+delta+(note?'<small>'+e(note)+'</small>':'')+'</section>';
  // sales chart: per day, or per week for long periods
  const weekly=span>45,buckets=new Map();
  for(let d=0;d<span;d+=weekly?7:1)buckets.set(addDays(range[0],d),0);
  cur.paid.forEach(p=>{const k=dateKey(p.verified_at),i=daysBetween(range[0],k),start=addDays(range[0],weekly?i-i%7:i);buckets.set(start,(buckets.get(start)||0)+Math.round(Number(p.amount)*100));});
  const peak=Math.max(1,...buckets.values());
  const chart='<div class="rep-chart" role="img" aria-label="Money received per '+(weekly?'week':'day')+'">'+[...buckets].map(([k,c])=>'<div class="rep-col" title="'+e(phDate(k+'T12:00:00+08:00')+' · '+peso(c/100))+'"><span class="rep-col-bar" style="height:'+(c?Math.max(3,Math.round(c/peak*100)):0)+'%"></span><span class="rep-col-label">'+e(new Date(k+'T12:00:00+08:00').toLocaleDateString('en-PH',{month:'short',day:'numeric'}))+'</span></div>').join('')+'</div>';
  // best sellers (by product and size)
  const items=cur.orders.flatMap(o=>o.order_items||[]);
  const seller=new Map();items.forEach(i=>{const k=i.name_snapshot+(i.variant_label_snapshot?' · '+i.variant_label_snapshot:'');const s=seller.get(k)||{qty:0,sales:0};s.qty+=Number(i.quantity);s.sales+=Number(i.line_total);seller.set(k,s);});
  const best=[...seller].sort((a,b)=>b[1].sales-a[1].sales).slice(0,8);
  // busy days, pickup vs delivery, payment methods, late balances
  const weekday=Array(7).fill(0);cur.orders.forEach(o=>{if(o.receiving_start)weekday[new Date(new Date(o.receiving_start).toLocaleString('en-US',{timeZone:'Asia/Manila'})).getDay()]++;});
  const pickup=cur.orders.filter(o=>o.fulfillment_method==='pickup').length,delivery=cur.orders.length-pickup;
  const byMethodSum=new Map();cur.paid.forEach(p=>{const n=byMethod.get(p.payment_method_id)||'Manual QR';byMethodSum.set(n,(byMethodSum.get(n)||0)+Number(p.amount));});
  const late=orders.filter(o=>live(o)&&o.total_amount!==null&&Number(o.amount_paid)<Number(o.total_amount)&&o.receiving_end&&Date.now()-Date.parse(o.receiving_end)>3*3600000&&['ready','completed'].includes(o.status)).sort((a,b)=>Date.parse(a.receiving_end)-Date.parse(b.receiving_end));
  const [options,moves,batches,stockItems]=await extra;
  // design add-ons: how many items were designed, and the most-picked choices
  const labelOf=new Map(options.map(o=>[o.group_key+':'+o.code,o.label]));
  const picks=new Map(),designed=items.filter(i=>i.customization&&i.customization.designer);
  const add=(group,code)=>{if(!code||code==='none')return;const name=labelOf.get(group+':'+code)||code;picks.set(name,(picks.get(name)||0)+1);};
  designed.forEach(i=>{const c=i.customization;
   [c.frosting_color,c.drip_color,c.bow_color,c.lettering_color].forEach(x=>add('color',x));
   (c.accents||[]).forEach(x=>add('accent',x));(c.border||[]).forEach(x=>add('border',x));add('topper',c.topper);
   [...(c.a?.colors||[]),...(c.b?.colors||[]),...(c.glazes||[]),...(c.sprinkle_colors||[])].forEach(x=>add('color',x));
   (c.finishes||[]).forEach(x=>add('finish',x));add('theme',c.theme);add('sprinkle',c.sprinkles);});
  const byDesigner=new Map();designed.forEach(i=>byDesigner.set(i.customization.designer,(byDesigner.get(i.customization.designer)||0)+Number(i.quantity)));
  const designerName={bento:'Bento cakes',cupcake:'Cupcakes',donut:'Mini donuts',cakepop:'Cake pops'};
  // ingredients: most used, and waste value (batch purchase price ÷ quantity received)
  const itemName=new Map(stockItems.map(i=>[i.id,i])),unitCost=new Map(batches.filter(b=>Number(b.quantity_received)>0&&b.purchase_price!==null).map(b=>[b.id,Number(b.purchase_price)/Number(b.quantity_received)]));
  const batchItem=new Map(batches.map(b=>[b.id,b.item_id]));
  const used=new Map();let wasteValue=0,wasteUnpriced=0;
  moves.filter(m=>within(m.created_at,range)).forEach(m=>{const id=m.item_id||batchItem.get(m.batch_id),q=-Number(m.quantity_delta);if(q<=0)return;
   if(m.reason==='usage')used.set(id,(used.get(id)||0)+q);
   else{const cost=unitCost.get(m.batch_id);if(cost===undefined)wasteUnpriced++;else wasteValue+=q*cost;}});
  const usedTop=[...used].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([id,q])=>[itemName.get(id)?.name||'Item',Math.round(q*100)/100,itemName.get(id)?.unit||'']);

  content.innerHTML=head('How the business is doing, compared with the period before.')+tabs('overview')+
   '<div class="rep-period"><div class="rep-period-buttons" role="group" aria-label="Period">'+PERIODS.map(([k,l])=>'<button type="button" data-period="'+k+'" aria-pressed="'+(state.choice===k)+'">'+l+'</button>').join('')+'</div>'+
   (state.choice==='custom'?'<label>From <input type="date" data-from value="'+e(range[0])+'"></label><label>To <input type="date" data-to value="'+e(range[1])+'"></label>':'')+
   '<span class="rep-range">'+e(phDate(range[0]+'T12:00:00+08:00'))+' – '+e(phDate(range[1]+'T12:00:00+08:00'))+'</span></div>'+
   '<div class="rep-kpis">'+kpi('Sales received',peso(received),change(received,receivedBefore),'Verified payments')+kpi('Orders',String(cur.orders.length),change(cur.orders.length,old.orders.length),'Not cancelled')+kpi('Average order',peso(avg),change(avg,avgBefore),'Order value ÷ orders')+kpi('Design add-ons',peso(addOns),change(addOns,addOnsBefore),'Extras from the designers')+kpi('Balances owed',peso(owed),'<span class="rep-delta">Right now</span>','Unpaid parts of open orders')+'</div>'+
   card('Money received per '+(weekly?'week':'day'),received?chart:none('No verified payments in this period.'))+
   '<div class="rep-grid">'+
    card('Best sellers',best.length?bars(best.map(([n,s])=>[n,s.sales,s.qty+' sold']),peso):none('No orders in this period.'))+
    card('Custom designs',designed.length?'<p class="rep-note">'+designed.length+' of '+items.length+' order lines were designed ('+Math.round(designed.length/Math.max(1,items.length)*100)+'%)</p>'+bars([...byDesigner].map(([k,v])=>[designerName[k]||k,v]),v=>v+' ordered')+'<h3 class="rep-sub">Most-picked choices</h3>'+(picks.size?bars([...picks].sort((a,b)=>b[1]-a[1]).slice(0,8),v=>v+'×'):none('No choices recorded.')):none('No designed orders in this period.'))+
    card('Busy days',cur.orders.length?bars(WEEKDAYS.map((d,i)=>[d,weekday[i]]),v=>v+' orders')+'<p class="rep-note">Pickup '+pickup+' · Delivery '+delivery+'</p>':none('No orders in this period.'))+
    card('Payments by method',byMethodSum.size?bars([...byMethodSum],peso):none('No verified payments in this period.'))+
    card('Late balances',late.length?'<p class="rep-note">Unpaid more than 3 hours after pickup or delivery (the ₱50 late-fee rule).</p><div class="rep-list">'+late.slice(0,8).map(o=>'<a class="rep-list-row" href="#orders/detail/'+encodeURIComponent(o.id)+'"><span><strong>#'+e(o.order_number)+' · '+e(o.customer_name)+'</strong><small>Due '+e(phDate(o.receiving_end))+'</small></span><strong>'+peso(Number(o.total_amount)-Number(o.amount_paid))+'</strong></a>').join('')+'</div>':none('No late balances. 🎉'))+
    card('Ingredients',(usedTop.length?'<h3 class="rep-sub">Most used</h3>'+bars(usedTop.map(([n,q,u])=>[n,q,u]),v=>v.toLocaleString('en-PH')):none('No ingredient use recorded in this period.'))+'<p class="rep-note">Waste and expired stock: <strong>'+peso(wasteValue)+'</strong>'+(wasteUnpriced?' (+'+wasteUnpriced+' without a purchase price)':'')+'</p>')+
   '</div>';
  content.querySelectorAll('[data-period]').forEach(b=>b.onclick=()=>{state.choice=b.dataset.period;save();draw();});
  content.querySelector('[data-from]')?.addEventListener('change',ev=>{state.from=ev.target.value;save();draw();});
  content.querySelector('[data-to]')?.addEventListener('change',ev=>{state.to=ev.target.value;save();draw();});
 };
 const save=()=>{try{localStorage.setItem(STORE,JSON.stringify(state));}catch{}};
 await draw();
}

function records(content,page,{orders,payments,methods,byOrder,byMethod,byAdmin},head,tabs){
 const controls='<label>From <input type="date" id="report-from"></label><label>To <input type="date" id="report-to"></label><select id="report-method" aria-label="Payment method"><option value="">All methods</option>'+methods.map(m=>'<option value="'+e(m.id)+'">'+e(m.display_name)+'</option>').join('')+'</select><select id="report-payment-status" aria-label="Payment status"><option value="">All payment statuses</option>'+Object.entries(labels).map(([v,l])=>'<option value="'+v+'">'+l+'</option>').join('')+'</select><select id="report-order-status" aria-label="Order status"><option value="">All order statuses</option>'+['pending','confirmed','preparing','ready','completed','cancelled'].map(s=>'<option>'+s+'</option>').join('')+'</select><button class="button" id="csv-report">'+icon('save')+' Download CSV</button><button class="button" id="print-report">'+icon('reports')+' Print</button>';
 content.innerHTML=head('Received revenue includes verified payment attempts only.')+tabs(page)+toolbar(controls)+'<div id="report-data"></div>';
 let table={head:[],rows:[]};
 const draw=()=>{
  const q=content.querySelector('.search').value.toLowerCase(),from=content.querySelector('#report-from').value,to=content.querySelector('#report-to').value,method=content.querySelector('#report-method').value,paymentStatus=content.querySelector('#report-payment-status').value,orderStatus=content.querySelector('#report-order-status').value;
  const inRange=value=>(!from||dateKey(value)>=from)&&(!to||dateKey(value)<=to);
  const matchesOrder=order=>!orderStatus||order.status===orderStatus;
  const matchingPayment=p=>(!method||p.payment_method_id===method)&&(!paymentStatus||p.status===paymentStatus)&&matchesOrder(byOrder.get(p.order_id)||{});
  const fp=payments.filter(p=>inRange(p.status==='paid'?p.verified_at:p.submitted_at||p.created_at)&&matchingPayment(p)&&JSON.stringify([p.transaction_reference,byOrder.get(p.order_id)?.order_number,byOrder.get(p.order_id)?.customer_name]).toLowerCase().includes(q));
  const fo=orders.filter(o=>inRange(o.created_at)&&matchesOrder(o)&&(!method||payments.some(p=>p.order_id===o.id&&p.payment_method_id===method))&&(!paymentStatus||payments.some(p=>p.order_id===o.id&&p.status===paymentStatus))&&JSON.stringify([o.order_number,o.customer_name,o.created_at]).toLowerCase().includes(q));
  if(page==='payments'){
   table={head:['Date','Order','Customer','Method','Reference','Amount','Status','Verified by / at'],rows:fp.map(p=>{const o=byOrder.get(p.order_id);return [phDate(p.status==='paid'?p.verified_at:p.submitted_at||p.created_at),'#'+(o?.order_number||'—'),o?.customer_name||'—',byMethod.get(p.payment_method_id)||'Manual QR',p.transaction_reference||'—',money(p.amount),labels[p.status]||p.status,(p.verified_by?byAdmin.get(p.verified_by)||p.verified_by:'—')+(p.verified_at?' · '+phDate(p.verified_at):'')];})};
  }else if(page==='revenue'){
   const monthly=new Map();fp.filter(p=>p.status==='paid').forEach(p=>{const m=dateKey(p.verified_at).slice(0,7);monthly.set(m,(monthly.get(m)||0)+Math.round(Number(p.amount)*100));});
   table={head:['Month','Verified Payments Received'],rows:[...monthly].sort((a,b)=>b[0].localeCompare(a[0])).map(([m,c])=>[m,money(c/100)])};
  }else{
   table={head:['Date','Order','Customer','Order Total','Verified Paid','Remaining','Payment','Order Status'],rows:fo.map(o=>[phDate(o.created_at),'#'+o.order_number,o.customer_name,o.total_amount===null?'Pending quote':money(o.total_amount),money(o.amount_paid),o.total_amount===null?'Pending quote':money(Math.max(0,Number(o.total_amount)-Number(o.amount_paid))),o.payment_status,o.status])};
  }
  content.querySelector('#report-data').innerHTML=grid(table.head,table.rows.map(r=>'<tr>'+r.map(c=>'<td>'+e(c)+'</td>').join('')+'</tr>').join('')||'<tr><td colspan="'+table.head.length+'">Nothing found for the selected filters.</td></tr>');
 };
 content.querySelectorAll('.toolbar input,.toolbar select').forEach(input=>input.addEventListener('input',draw));
 content.querySelector('#print-report').onclick=()=>window.print();
 content.querySelector('#csv-report').onclick=()=>{
  const cell=v=>{const s=String(v??'');return /[",\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
  const csv='﻿'+[table.head,...table.rows].map(r=>r.map(cell).join(',')).join('\r\n');
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='lexc-'+page+'-'+dateKey(new Date())+'.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
 };
 draw();
}
