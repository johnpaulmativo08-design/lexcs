import {escapeHtml as e, icon, notice, panel, empty, statusIndicator, showDetails} from './components.js?v=3';
import {db, rows} from './backend-ui.js';
import {connectSchedule} from './dashboard-data.js?v=5';
import {summarizeDashboard, dateKey, dayOffset} from './dashboard-model.js';

const time = value => new Date(value).toLocaleString('en-PH', {timeZone:'Asia/Manila', month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});
const orderLink = order => '#orders/detail/' + encodeURIComponent(order.id);
const link = (href, label) => `<a class="button" href="${e(href)}">${icon('arrow')} ${e(label)}</a>`;
const tone = status => status === 'ready' ? 'info' : status === 'pending' ? 'warning' : 'success';

// Fetch every page so the API row limit cannot silently truncate totals or ledgers.
async function allRows(query) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rows(query().range(offset, offset + 499));
    result.push(...page);
    if (page.length < 500) return result;
  }
}

export async function renderOperations(content) {
  content.className = 'operations-dashboard';
  content.innerHTML = notice('Loading today’s operations…');
  const refresh = async () => {
    const button = content.querySelector('[data-refresh-dashboard]');
    const restoreFocus = button === document.activeElement;
    if (button) button.disabled = true;
    try {
      const today = dateKey(new Date()), end = dayOffset(today, 7);
      const [orders, stock, batches, movements, slots] = await Promise.all([
        allRows(() => db.client.from('orders').select('id,order_number,customer_name,status,receiving_start,receiving_end,slot_id,fulfillment_method,delivery_fee_status,created_at').order('id')),
        allRows(() => db.client.from('inventory_stock').select('*').eq('is_archived', false).order('id')),
        allRows(() => db.client.from('inventory_batches').select('id,item_id,batch_code,expires_on').order('id')),
        allRows(() => db.client.from('inventory_movements').select('id,batch_id,quantity_delta,reason,created_at').order('id')),
        allRows(() => db.client.from('availability_slots').select('*').gte('starts_at', today+'T00:00:00+08:00').lt('starts_at', end+'T00:00:00+08:00').order('id'))
      ]);
      if (!content.isConnected) return;
      draw(content, summarizeDashboard({orders, stock, batches, movements, slots}), refresh);
      if(restoreFocus)content.querySelector('[data-refresh-dashboard]').focus();
    } catch (error) {
      if (!content.isConnected) return;
      let alert = content.querySelector('[data-dashboard-error]');
      if (!alert) { alert = document.createElement('div'); alert.dataset.dashboardError = ''; content.prepend(alert); }
      alert.innerHTML = `<p class="notice" role="alert">Could not refresh operations: ${e(error.message)}. Previously displayed figures have not been updated.</p><button class="button">Try again</button>`;
      alert.querySelector('button').onclick = refresh;
    } finally { if (button) button.disabled = false; }
  };
  await refresh();
}

function draw(content, data, refresh) {
  const {todayOrders, pending, low, out, expiring, expired, production, handoffs, attention, capacity, activity} = data;
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
  content.innerHTML = `<div class="ops-heading"><div><h1>Dashboard</h1><h2>Your bakery at a glance</h2><p>${e(new Date().toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric'}))} · Philippine time</p></div><div class="ops-actions"><span role="status">Updated ${e(new Date().toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}))}</span><button class="button" data-refresh-dashboard>${icon('refresh')} Refresh</button></div></div>`+
    `<div class="ops-metrics">${metric('Today’s orders',todayOrders.length,'Scheduled today · excludes cancelled','today','info')}${metric('Pending review',pending.length,'Orders awaiting confirmation','pending','warning')}${metric('Low stock',low.length,'Above zero, at or below minimum','low','warning')}${metric('Expiring soon',expiring.length,'Stocked batches · next 7 days','expiring','warning')}${metric('Out of stock',out.length,'Active items with no stock','out','danger')}</div>`+
    `<div class="ops-main">${section('Orders requiring attention',attention,'Pending review, overdue handoffs, or delivery quotes','attention')}${section('Today’s production',production,'Confirmed / preparing today · exceptions listed under attention','production')}</div>`+
    `<div class="ops-secondary">${section('Upcoming pickups & deliveries',handoffs,'Ready orders and future bookings · exceptions listed under attention','handoffs')}${panel('Inventory warnings', `<p class="ops-caption">${warnings.length} warnings · only batches with remaining stock</p>`+(warnings.length?'<div class="ops-list">'+warningRows(warnings.slice(0,5))+'</div>':empty('No stock or expiry warnings.')), '<button class="button" data-warnings>'+icon('alert')+' View all</button>')}</div>`+
    `<div class="ops-secondary">${panel('Receiving capacity',`<p class="ops-caption">Next 7 days · receiving bookings, not production hours</p><div class="ops-capacity">${capacity.map(day=>`<div><div class="ops-capacity-label"><strong>${e(new Date(day.date+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'short',day:'numeric'}))}</strong><span>${day.booked} / ${day.capacity} booked</span></div><div class="slot-progress" role="meter" aria-label="${e(day.date)} open slot capacity used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${day.percent}"><span style="width:${day.percent}%"></span></div><small>${day.closedBooked ? day.closedBooked+' bookings in closed slots · ' : ''}${day.capacity ? day.remaining+' places available' : 'No open slots'}</small></div>`).join('')}</div>`, '<button class="button" data-manage-slots>'+icon('clock')+' Manage slots</button>')}${panel('Recent activity',activity.length?'<div class="ops-list">'+activity.map(item=>`<a class="ops-row" href="${e(item.href)}"><div><strong>${e(item.label)}</strong><small>${e(time(item.at))}</small></div>${icon('arrow')}</a>`).join('')+'</div>':empty('No recorded activity yet.'),link('#reports','Reports'))}</div>`;
  content.querySelector('[data-refresh-dashboard]').onclick = refresh;
  const lists = {today:todayOrders,pending,production,handoffs,attention};
  const titles = {today:'Today’s orders',pending:'Pending review',production:'Today’s production',handoffs:'Upcoming pickups & deliveries',attention:'Orders requiring attention'};
  const showOrders = (key, opener) => showDetails(titles[key], list(lists[key], 'Scheduled receiving times', Infinity)+link('#orders','Open Orders'), opener);
  content.querySelectorAll('[data-list]').forEach(b=>b.onclick=()=>showOrders(b.dataset.list,b));
  content.querySelectorAll('[data-metric]').forEach(b=>b.onclick=()=>{
    const key=b.dataset.metric;
    if(key==='low'||key==='out') location.hash='inventory/filter/'+key;
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
