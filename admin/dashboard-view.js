import {escapeHtml as e, icon, notice, panel, empty, statusIndicator, showDetails} from './components.js?v=3';
import {db, allRows, loadingMetrics, loadingList, loadingChart} from './backend-ui.js?v=3';
import {connectSchedule} from './dashboard-data.js?v=6';
import {summarizeDashboard, dateKey, dayOffset} from './dashboard-model.js?v=2';

const time = value => new Date(value).toLocaleString('en-PH', {timeZone:'Asia/Manila', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
const orderLink = order => '#orders/detail/' + encodeURIComponent(order.id);
const link = (href, label) => `<a class="button" href="${e(href)}">${icon('arrow')} ${e(label)}</a>`;
const tone = status => status === 'ready' ? 'info' : status === 'pending' ? 'warning' : 'success';

export async function renderOperations(content) {
  content.className = 'operations-dashboard';
  const skeleton=()=>`<div class="ops-heading"><div><h1>Dashboard</h1><p>Philippine time</p></div><div class="ops-actions"><button class="button" data-refresh-dashboard disabled>Refresh</button></div></div>${loadingMetrics(3)}${loadingMetrics(4)}<div class="dash-grid"><div class="dash-col">${panel('Orders requiring attention',loadingList(5))}${panel('Today’s production',loadingList(4))}</div><div class="dash-col">${panel('Inventory warnings',loadingList(4))}${panel('Receiving capacity',loadingChart())}</div></div>`;
  content.innerHTML = skeleton();
  const refresh = async () => {
    const button = content.querySelector('[data-refresh-dashboard]');
    const restoreFocus = button === document.activeElement;
    if (button) button.disabled = true;
    content.innerHTML=skeleton();
    try {
      const today = dateKey(new Date()), end = dayOffset(today, 7);
      const [orders, stock, batches, movements, slots, paymentAttempts] = await Promise.all([
        allRows(() => db.client.from('orders').select('id,order_number,customer_name,status,receiving_start,receiving_end,slot_id,fulfillment_method,delivery_fee_status,created_at').order('id')),
        allRows(() => db.client.from('inventory_stock').select('*').eq('is_archived', false).order('id')),
        allRows(() => db.client.from('inventory_batches').select('id,item_id,batch_code,expires_on').order('id')),
        allRows(() => db.client.from('inventory_movements').select('id,batch_id,quantity_delta,reason,created_at').order('id')),
        allRows(() => db.client.from('availability_slots').select('*').gte('starts_at', today+'T00:00:00+08:00').lt('starts_at', end+'T00:00:00+08:00').order('id')),
        allRows(() => db.client.from('order_payment_attempts').select('id,order_id,amount,status,verified_at').order('id'))
      ]);
      if (!content.isConnected) return;
      draw(content, summarizeDashboard({orders, stock, batches, movements, slots, paymentAttempts}), refresh);
      if(restoreFocus)content.querySelector('[data-refresh-dashboard]').focus();
    } catch (error) {
      if (!content.isConnected) return;
      console.warn('Dashboard could not load:',error);
      content.innerHTML='<div class="ops-heading"><div><h1>Dashboard</h1><p>Your bakery at a glance</p></div></div><section class="panel admin-error-state" role="alert"><h2>Dashboard could not load</h2><p>Check your connection and try again. No records were changed.</p><button class="button primary" type="button" data-retry-dashboard>Try again</button></section>';
      content.querySelector('[data-retry-dashboard]').onclick=refresh;
    } finally { if (button) button.disabled = false; }
  };
  await refresh();
}

function draw(content, data, refresh) {
  const {todayOrders, pending, low, out, expiring, expired, production, handoffs, attention, capacity, activity, pendingPayments} = data;
  const metric = (label, value, detail, action, severity = 'neutral') => `<button class="panel ops-metric" data-metric="${action}">${statusIndicator(label, value ? severity : 'neutral')}<strong>${value}</strong><small>${e(detail)}</small><span class="ops-metric-action">View details →</span></button>`;
  const orderRows = orders => orders.map(order => `<a class="ops-row" href="${orderLink(order)}"><div><strong>#${e(order.order_number)} · ${e(order.customer_name)}</strong><small>${e(time(order.receiving_start))} · ${order.fulfillment_method === 'pickup' ? 'Pickup' : 'Delivery'}</small>${order.reason ? `<small class="ops-attention">${e(order.reason)}</small>` : ''}</div>${statusIndicator(order.status, tone(order.status))}</a>`).join('');
  const list = (orders, description, limit=5) => `<p class="ops-caption">${e(description)} · ${orders.length} orders</p>` + (orders.length ? `<div class="ops-list">${orderRows(orders.slice(0,limit))}</div>` : empty('Nothing in this queue.'));
  const section = (title, orders, description, id) => panel(title, list(orders, description), `<button class="button" data-list="${id}">${icon('eye')} View all (${orders.length})</button>`);
  const warnings = [
    ...out.map(i=>({name:i.name, detail:`${i.stock} ${i.unit} remaining`, label:'Out of stock', tone:'danger', href:'#inventory/filter/out'})),
    ...expired.map(i=>({name:i.name, detail:`Batch ${i.batch_code} · expired ${i.expires_on} · ${i.remaining} ${i.unit} left`, label:'Expired', tone:'danger', href:'#inventory/restock'})),
    ...low.map(i=>({name:i.name, detail:`${i.stock} ${i.unit} left · minimum ${i.min_stock}`, label:'Low stock', tone:'warning', href:'#inventory/filter/low'})),
    ...expiring.map(i=>({name:i.name, detail:`Batch ${i.batch_code} · expires ${i.expires_on} · ${i.remaining} ${i.unit} left`, label:'Expiring', tone:'warning', href:'#inventory/restock'}))
  ];
  const warningRows = items => items.map(i=>`<a class="ops-row" href="${i.href}"><div><strong>${e(i.name)}</strong><small>${e(i.detail)}</small></div>${statusIndicator(i.label,i.tone)}</a>`).join('');
  const hour = Number(new Date().toLocaleString('en-PH', {timeZone:'Asia/Manila', hour:'numeric', hour12:false}));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const peso = centavos => '₱' + (centavos/100).toLocaleString('en-PH', {minimumFractionDigits:0, maximumFractionDigits:2});
  const stockAlerts = out.length + low.length + expiring.length + expired.length;
  // "Needs you now": three action tiles; calm when there is nothing to do.
  const action = (key, title, count, detail, toneName, iconName) => `<button type="button" class="dash-action${count ? ' is-'+toneName : ' is-clear'}" data-metric="${key}">
      <span class="dash-action-icon">${icon(count ? iconName : 'check')}</span>
      <span class="dash-action-body"><span class="dash-action-title">${e(title)}</span><strong>${count}</strong><small>${count ? detail : 'All clear'}</small></span>
      <span class="dash-action-go" aria-hidden="true">${icon('arrow')}</span></button>`;
  const stockDetail = [out.length && out.length+' out', low.length && low.length+' low', expiring.length && expiring.length+' expiring', expired.length && expired.length+' expired'].filter(Boolean).join(' · ');
  const todayStat = (label, value, detail) => `<div class="dash-stat"><span>${e(label)}</span><strong>${value}</strong><small>${e(detail)}</small></div>`;
  const next = data.nextHandoff;
  content.innerHTML = `<div class="ops-heading"><div><h1>Dashboard</h1><p class="dash-greeting">${greeting}, LexC’s · ${e(new Date().toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric'}))}</p></div><div class="ops-actions"><span role="status">Updated ${e(new Date().toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}))}</span><button class="button" data-refresh-dashboard>${icon('refresh')} Refresh</button></div></div>`+
    `<h2 class="dash-label">Needs you now</h2><div class="dash-actions">${action('pending','Orders to confirm',pending.length,'Waiting for your confirmation','warning','orders')}${action('payments','Payments to verify',pendingPayments,'Check the bank or e-wallet, then verify','warning','check')}${action('stock','Stock alerts',stockAlerts,stockDetail,out.length||expired.length?'danger':'warning','alert')}</div>`+
    `<h2 class="dash-label">Today</h2><section class="panel dash-today">${todayStat('Orders today',todayOrders.length,'Pickups and deliveries scheduled')}${todayStat('Received today',peso(data.receivedTodayCentavos),'Verified payments only')}${todayStat('Next handoff',next?e(new Date(next.receiving_start).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})):'—',next?'#'+next.order_number+' · '+(next.fulfillment_method==='pickup'?'Pickup':'Delivery')+' · '+new Date(next.receiving_start).toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}):'Nothing scheduled')}${todayStat('Places left today',capacity[0]?.capacity?capacity[0].remaining:'—',capacity[0]?.capacity?capacity[0].booked+' of '+capacity[0].capacity+' booked':'No open slots today')}</section>`+
    `<div class="dash-grid"><div class="dash-col">${section('Orders requiring attention',attention,'Pending review, overdue handoffs, or delivery quotes','attention')}${section('Today’s production',production,'Confirmed / preparing today','production')}${section('Upcoming pickups & deliveries',handoffs,'Ready orders and future reservations','handoffs')}</div>`+
    `<div class="dash-col">${panel('Inventory warnings', `<p class="ops-caption">${warnings.length ? warnings.length+' warnings' : 'Stock and expiry'}</p>`+(warnings.length?'<div class="ops-list">'+warningRows(warnings.slice(0,5))+'</div>':empty('No stock or expiry warnings.')), '<button class="button" data-warnings>'+icon('alert')+' View all</button>')}`+
    `${panel('Receiving capacity',`<p class="ops-caption">Next 7 days · receiving reservations</p><div class="ops-capacity">${capacity.map(day=>`<div><div class="ops-capacity-label"><strong>${e(new Date(day.date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'short',day:'numeric'}))}</strong><span>${day.booked} / ${day.capacity} booked</span></div><div class="slot-progress" role="meter" aria-label="${e(day.date)} open slot capacity used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${day.percent}"><span style="width:${day.percent}%"></span></div><small>${day.closedBooked ? day.closedBooked+' reservations in closed slots · ' : ''}${day.capacity ? day.remaining+' places available' : 'No open slots'}</small></div>`).join('')}</div>`, '<button class="button" data-manage-slots>'+icon('clock')+' Manage slots</button>')}`+
    `${panel('Recent activity',activity.length?'<div class="ops-list">'+activity.map(item=>`<a class="ops-row" href="${e(item.href)}"><div><strong>${e(item.label)}</strong><small>${e(time(item.at))}</small></div>${icon('arrow')}</a>`).join('')+'</div>':empty('No recorded activity yet.'),link('#reports','Reports'))}</div></div>`;
  content.querySelector('[data-refresh-dashboard]').onclick = refresh;
  const lists = {today:todayOrders,pending,production,handoffs,attention};
  const titles = {today:'Today’s orders',pending:'Pending review',production:'Today’s production',handoffs:'Upcoming pickups & deliveries',attention:'Orders requiring attention'};
  const showOrders = (key, opener) => showDetails(titles[key], list(lists[key], 'Scheduled receiving times', Infinity)+link('#orders','Open Orders'), opener);
  content.querySelectorAll('[data-list]').forEach(b=>b.onclick=()=>showOrders(b.dataset.list,b));
  content.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>{
    const key=b.dataset.metric;
    if(key==='low'||key==='out') location.hash='inventory/filter/'+key;
    else if(key==='stock') showDetails('Stock alerts',warningRows(warnings)||empty('No stock or expiry warnings.'),b);
    else if(key==='payments'||key==='verified') location.hash='orders';
    else if(key==='expiring') showDetails('Expiring batches · next 7 days',warningRows(warnings.filter(i=>i.label==='Expiring'))||empty('No stocked batches expire in this period.'),b);
    else showOrders(key,b);
  });
  content.querySelector('[data-warnings]').onclick=event=>showDetails('Inventory warnings',warningRows(warnings)||empty('No stock or expiry warnings.'),event.currentTarget);
  connectSchedule(content, refresh);
  content.querySelectorAll('.ops-capacity [role="meter"]').forEach(meter=>{
    const value=Number(meter.getAttribute('aria-valuenow'));
    meter.classList.add(value>=100?'danger':value>=80?'warning':'normal');
  });
}
