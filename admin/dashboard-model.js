// Philippine business dates, independent of the administrator's device timezone.
export const dateKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
export const dayOffset = (day, count) => new Date(Date.parse(day+'T00:00:00Z')+count*86400000).toISOString().slice(0,10);
export function summarizeDashboard({orders,stock,batches,movements,slots}, now = new Date()) {
  const today=dateKey(now), end=dayOffset(today,7);
  const active=orders.filter(o=>!['completed','cancelled'].includes(o.status));
  const sorted=items=>items.sort((a,b)=>Date.parse(a.receiving_start)-Date.parse(b.receiving_start));
  const attention=sorted(active.filter(o=>o.status==='pending'||Date.parse(o.receiving_end)<now.getTime()||o.delivery_fee_status==='unquoted').map(o=>({...o,reason:[o.status==='pending'?'Awaiting confirmation':'',Date.parse(o.receiving_end)<now.getTime()?'Receiving window passed':'',o.delivery_fee_status==='unquoted'?'Delivery quote needed':''].filter(Boolean).join(' · ')})));
  const attentionIds=new Set(attention.map(o=>o.id));
  const balances=new Map();
  movements.forEach(m=>balances.set(m.batch_id,(balances.get(m.batch_id)||0)+Number(m.quantity_delta)));
  const items=new Map(stock.filter(i=>!i.is_archived).map(i=>[i.id,i]));
  const stockedBatches=batches.filter(b=>items.has(b.item_id)&&(balances.get(b.id)||0)>0&&b.expires_on).map(b=>({...b,name:items.get(b.item_id).name,unit:items.get(b.item_id).unit,remaining:balances.get(b.id)})).sort((a,b)=>a.expires_on.localeCompare(b.expires_on));
  const booked=new Map();
  orders.filter(o=>o.status!=='cancelled').forEach(o=>booked.set(o.slot_id,(booked.get(o.slot_id)||0)+1));
  const capacity=Array.from({length:7},(_,i)=>{
    const date=dayOffset(today,i),daySlots=slots.filter(s=>dateKey(s.starts_at)===date),open=daySlots.filter(s=>s.is_open);
    const total=open.reduce((n,s)=>n+Number(s.capacity),0),used=open.reduce((n,s)=>n+(booked.get(s.id)||0),0);
    return {date,capacity:total,booked:used,closedBooked:daySlots.filter(s=>!s.is_open).reduce((n,s)=>n+(booked.get(s.id)||0),0),remaining:open.reduce((n,s)=>n+Math.max(0,Number(s.capacity)-(booked.get(s.id)||0)),0),percent:total?Math.min(100,Math.round(used/total*100)):0};
  });
  const batchMap=new Map(batches.map(b=>[b.id,b]));
  // Only actual creation/ledger events; updated_at is not status history.
  const activity=[...orders.map(o=>({at:o.created_at,label:'Order #'+o.order_number+' placed',href:'#orders/detail/'+encodeURIComponent(o.id)})),...movements.filter(m=>items.has(batchMap.get(m.batch_id)?.item_id)).map(m=>{const item=items.get(batchMap.get(m.batch_id).item_id);return {at:m.created_at,label:item.name+' · '+m.reason+' · '+Number(m.quantity_delta)+' '+item.unit,href:'#inventory/restock'};})].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,5);
  return {
    todayOrders:sorted(orders.filter(o=>o.status!=='cancelled'&&dateKey(o.receiving_start)===today)),
    pending:sorted(active.filter(o=>o.status==='pending')),
    production:sorted(active.filter(o=>!attentionIds.has(o.id)&&['confirmed','preparing'].includes(o.status)&&dateKey(o.receiving_start)<=today)),
    handoffs:sorted(active.filter(o=>!attentionIds.has(o.id)&&(o.status==='ready'||(['confirmed','preparing'].includes(o.status)&&dateKey(o.receiving_start)>today)))),
    low:[...items.values()].filter(i=>Number(i.stock)>0&&Number(i.stock)<=Number(i.min_stock)),
    out:[...items.values()].filter(i=>Number(i.stock)<=0),
    expiring:stockedBatches.filter(b=>b.expires_on>=today&&b.expires_on<end),
    expired:stockedBatches.filter(b=>b.expires_on<today),attention,capacity,activity
  };
}
