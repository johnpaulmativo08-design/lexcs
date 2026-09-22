import {escapeHtml as e,icon,statusIndicator,showDetails} from './components.js?v=3';
import {db,rows} from './backend-ui.js';
export function connectSchedule(content,onClose){
  const button=content.querySelector('[data-manage-slots]');if(!button)return;
  button.onclick=async()=>{
    const dialog=showDetails('Receiving slots','<div class="slot-manager" aria-live="polite"></div>',button);
    dialog.addEventListener('close',()=>{if(content.isConnected)onClose?.();},{once:true});
    dialog.classList.add('slot-dialog');
    const root=dialog.querySelector('.slot-manager');
    let state={slots:[],orders:[],filter:'all',range:'week'};
    const load=async()=>{
      root.innerHTML='<div class="slot-loading">Loading receiving slots...</div>';
      try{
        const [slots,orders]=await Promise.all([
          rows(db.client.from('availability_slots').select('*').order('starts_at')),
          db.orders()
        ]);
        state={...state,slots,orders:orders.filter(order=>order.status!=='cancelled')};
        renderSlotManager(root,state,load);
      }catch(error){
        root.innerHTML='<div class="slot-empty" role="alert">Could not load receiving slots: '+e(error.message)+'</div>';
      }
    };
    await load();
  };
}

const phDateKey=value=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(part=>[part.type,part.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
};
const phDay=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric'}).format(new Date(value));
const phTime=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const todayKey=()=>phDateKey(new Date());
const addDays=(date,days)=>new Date(date.getFullYear(),date.getMonth(),date.getDate()+days);
const addDateStringDays=(date,days)=>{
  const [year,month,day]=date.split('-').map(Number);
  const next=new Date(Date.UTC(year,month-1,day+days));
  return next.toISOString().slice(0,10);
};
const slotPayload=(slot,changes={})=>({id:slot.id,starts_at:slot.starts_at,ends_at:slot.ends_at,capacity:slot.capacity,is_open:slot.is_open,...changes});
const slotOrders=(orders,id)=>orders.filter(order=>order.slot_id===id);
const slotStatus=(slot,booked)=>{
  if(!slot.is_open)return 'closed';
  if(booked>=Number(slot.capacity))return 'full';
  if(booked/Number(slot.capacity)>=.8)return 'almost';
  return 'open';
};
const statusLabel={open:'Open',almost:'Almost full',full:'Full',closed:'Closed'};

function slotRangeFilter(slot,range){
  const key=phDateKey(slot.starts_at),today=todayKey();
  if(range==='today')return key===today;
  if(range==='week'){
    const date=new Date(),end=phDateKey(addDays(date,6));
    return key>=today&&key<=end;
  }
  return true;
}

function renderSlotManager(root,state,refresh){
  const bookingCounts=new Map();
  state.orders.forEach(order=>bookingCounts.set(order.slot_id,(bookingCounts.get(order.slot_id)||0)+1));
  const visible=state.slots.filter(slot=>slotRangeFilter(slot,state.range)).filter(slot=>{
    const status=slotStatus(slot,bookingCounts.get(slot.id)||0);
    return state.filter==='all'||state.filter===status;
  });
  const today=todayKey();
  const todaySlots=state.slots.filter(slot=>phDateKey(slot.starts_at)===today);
  const totalCapacity=state.slots.reduce((sum,slot)=>sum+Number(slot.capacity||0),0);
  const totalBooked=state.slots.reduce((sum,slot)=>sum+(bookingCounts.get(slot.id)||0),0);
  root.innerHTML=
    '<p class="slot-help">Times use Philippine time. Booked counts ignore cancelled orders, and existing backend rules prevent duplicate or unsafe capacity changes.</p>'+
    '<div class="slot-summary">'+
      slotMetric('Today',todaySlots.length)+
      slotMetric('Booked',totalBooked)+
      slotMetric('Available capacity',Math.max(0,totalCapacity-totalBooked))+
      slotMetric('Closed',state.slots.filter(slot=>!slot.is_open).length)+
    '</div>'+
    '<form class="slot-create">'+
      '<div class="slot-create-head"><div><strong>Create receiving slots</strong><span>Pick a start date manually or hover the quick dates to preview a bulk range.</span></div><output data-bulk-preview>Specific date only</output></div>'+
      '<div class="slot-date-strip" aria-label="Quick start dates">'+quickDateButtons(21)+'</div>'+
      '<div class="slot-form-grid">'+
        slotField('date','Date','','date','required')+
        slotField('start','Start','','time','required')+
        slotField('end','End','','time','required')+
        slotField('capacity','Capacity','','number','min="1" step="1" required')+
      '</div>'+
      '<label class="form-field slot-repeat">Repeat days<select name="repeat"><option value="1">Once</option><option value="5">5 days</option><option value="7">7 days</option><option value="14">14 days</option></select></label>'+
      '<button class="button primary" type="submit">'+icon('plus')+' Create slot</button>'+
      '<p role="alert" class="form-error" hidden></p>'+
    '</form>'+
    '<div class="slot-toolbar">'+
      '<select data-range aria-label="Slot date range"><option value="week">Next 7 days</option><option value="today">Today</option><option value="all">All slots</option></select>'+
      '<select data-filter aria-label="Slot status filter"><option value="all">All statuses</option><option value="open">Open</option><option value="almost">Almost full</option><option value="full">Full</option><option value="closed">Closed</option></select>'+
      '<button class="button" type="button" data-refresh>'+icon('refresh')+' Refresh</button>'+
    '</div>'+
    '<div class="slot-groups">'+(visible.length?renderSlotGroups(visible,state.orders,bookingCounts):'<div class="slot-empty">No receiving slots match this view.</div>')+'</div>';
  root.querySelector('[data-range]').value=state.range;
  root.querySelector('[data-filter]').value=state.filter;
  root.querySelector('[data-range]').onchange=event=>{state.range=event.target.value;renderSlotManager(root,state,refresh);};
  root.querySelector('[data-filter]').onchange=event=>{state.filter=event.target.value;renderSlotManager(root,state,refresh);};
  root.querySelector('[data-refresh]').onclick=refresh;
  connectQuickDates(root);
  root.querySelector('.slot-create').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,error=form.querySelector('[role=alert]'),submit=form.querySelector('[type=submit]');
    const data=Object.fromEntries(new FormData(form));
    submit.disabled=true;error.hidden=true;
    try{
      await createSlots(data);
      form.reset();
      await refresh();
    }catch(problem){error.textContent=problem.message;error.hidden=false;}
    finally{submit.disabled=false;}
  };
  root.querySelectorAll('[data-toggle-slot]').forEach(button=>button.onclick=async()=>{
    const slot=state.slots.find(item=>item.id===button.dataset.toggleSlot);
    button.disabled=true;
    try{await db.rpc('save_slot',{payload:slotPayload(slot,{is_open:!slot.is_open})});await refresh();}
    catch(error){showSlotError(root,error);}
    finally{button.disabled=false;}
  });
  root.querySelectorAll('[data-capacity-slot]').forEach(input=>input.onchange=async()=>{
    const slot=state.slots.find(item=>item.id===input.dataset.capacitySlot);
    const capacity=Math.max(1,Number(input.value||slot.capacity));
    input.disabled=true;
    try{await db.rpc('save_slot',{payload:slotPayload(slot,{capacity})});await refresh();}
    catch(error){input.value=slot.capacity;showSlotError(root,error);}
    finally{input.disabled=false;}
  });
}

function slotMetric(label,value){return '<section><strong>'+e(value)+'</strong><span>'+e(label)+'</span></section>';}
function slotField(name,label,value='',type='text',extra=''){return '<label class="form-field">'+e(label)+'<input name="'+e(name)+'" type="'+type+'" value="'+e(value)+'" '+extra+'></label>';}
function quickDateButtons(count){
  return Array.from({length:count},(_,index)=>{
    const date=addDateStringDays(todayKey(),index);
    return '<button type="button" class="slot-date-chip" data-pick-date="'+e(date)+'"><span>'+e(new Intl.DateTimeFormat('en-PH',{weekday:'short'}).format(new Date(date+'T00:00:00+08:00')))+'</span><strong>'+e(new Intl.DateTimeFormat('en-PH',{month:'short',day:'numeric'}).format(new Date(date+'T00:00:00+08:00')))+'</strong></button>';
  }).join('');
}

function connectQuickDates(root){
  const form=root.querySelector('.slot-create'),dateInput=form.querySelector('[name=date]'),repeatSelect=form.querySelector('[name=repeat]'),preview=form.querySelector('[data-bulk-preview]');
  const setPreview=date=>{
    const repeat=Number(repeatSelect.value||1),end=addDateStringDays(date,repeat-1);
    preview.textContent=repeat===1?'Specific date: '+date:'Bulk range: '+date+' to '+end+' ('+repeat+' days)';
    form.querySelectorAll('[data-pick-date]').forEach(button=>{
      const current=button.dataset.pickDate;
      button.classList.toggle('preview',current>=date&&current<=end);
      button.classList.toggle('selected',current===dateInput.value);
    });
  };
  repeatSelect.onchange=()=>{if(dateInput.value)setPreview(dateInput.value);else preview.textContent=Number(repeatSelect.value)===1?'Specific date only':'Hover a start date to preview '+repeatSelect.value+' days';};
  dateInput.oninput=()=>{if(dateInput.value)setPreview(dateInput.value);};
  form.querySelectorAll('[data-pick-date]').forEach(button=>{
    button.onmouseenter=()=>setPreview(button.dataset.pickDate);
    button.onfocus=()=>setPreview(button.dataset.pickDate);
    button.onclick=()=>{dateInput.value=button.dataset.pickDate;setPreview(button.dataset.pickDate);dateInput.focus();};
  });
  form.querySelector('.slot-date-strip').onmouseleave=()=>{if(dateInput.value)setPreview(dateInput.value);else repeatSelect.onchange();};
  repeatSelect.onchange();
}

function renderSlotGroups(slots,orders,bookingCounts){
  const grouped=new Map();
  slots.forEach(slot=>{
    const key=phDateKey(slot.starts_at);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push(slot);
  });
  return [...grouped].map(([key,items])=>
    '<section class="slot-day"><h3>'+e(phDay(items[0].starts_at))+'<span>'+e(key)+'</span></h3><div class="slot-card-grid">'+
      items.map(slot=>renderSlotCard(slot,slotOrders(orders,slot.id),bookingCounts.get(slot.id)||0)).join('')+
    '</div></section>'
  ).join('');
}

function renderSlotCard(slot,orders,booked){
  const capacity=Number(slot.capacity||0),remaining=Math.max(0,capacity-booked),status=slotStatus(slot,booked),percent=capacity?Math.min(100,Math.round(booked/capacity*100)):0;
  return '<article class="slot-card '+status+'">'+
    '<div class="slot-card-top"><div><strong>'+e(phTime(slot.starts_at)+' - '+phTime(slot.ends_at))+'</strong><span>'+e(booked+' / '+capacity+' orders booked')+'</span></div>'+statusIndicator(statusLabel[status],slotTone(status))+'</div>'+
    '<div class="slot-progress" aria-label="'+e(percent+' percent booked')+'"><span style="width:'+percent+'%"></span></div>'+
    '<div class="slot-card-meta"><span>'+e(remaining)+' remaining</span><label>Capacity <input type="number" min="'+booked+'" step="1" value="'+capacity+'" data-capacity-slot="'+e(slot.id)+'"></label></div>'+
    '<div class="slot-orders">'+(orders.length?orders.slice(0,3).map(order=>'<p>#'+e(order.order_number)+' '+e(order.customer_name||'Customer')+'</p>').join(''):'<p>No orders yet</p>')+(orders.length>3?'<p>+'+e(orders.length-3)+' more</p>':'')+'</div>'+
    '<button type="button" class="button" data-toggle-slot="'+e(slot.id)+'">'+icon(slot.is_open?'close':'check')+' '+(slot.is_open?'Close slot':'Open slot')+'</button>'+
  '</article>';
}

function slotTone(status){return status==='open'?'success':status==='almost'?'warning':status==='full'?'danger':'neutral';}

async function createSlots(data){
  const repeat=Math.max(1,Number(data.repeat||1));
  for(let index=0;index<repeat;index++){
    const date=addDateStringDays(data.date,index);
    await db.rpc('save_slot',{payload:{starts_at:date+'T'+data.start+':00+08:00',ends_at:date+'T'+data.end+':00+08:00',capacity:Number(data.capacity),is_open:true}});
  }
}

function showSlotError(root,error){
  const alert=root.querySelector('.slot-create [role=alert]');
  if(alert){alert.textContent=error.message;alert.hidden=false;}
}
