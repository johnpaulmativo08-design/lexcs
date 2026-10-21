// Receiving capacity calendar for the dashboard: one month at a time (this month to the end of the booking horizon),
// each day coloured by how many of its daily reservations are taken — the limit is per day (6 unless that date has its
// own limit), exactly as the database checks it. Hovering a day (or focusing / tapping it) reveals how that day's
// reservations fall across the hourly receiving times. Read-only: slots are still managed with "Manage slots".
import {escapeHtml as e} from './components.js?v=3';
import {dateKey} from './dashboard-model.js?v=2';

const WEEK=['S','M','T','W','T','F','S'];
const hm=value=>new Date(value).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'});
const longDay=key=>new Date(key+'T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',weekday:'long',month:'long',day:'numeric'});
const monthName=ym=>new Date(ym+'-15T12:00:00+08:00').toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'long',year:'numeric'});
const shiftMonth=(ym,n)=>{const d=new Date(Date.UTC(+ym.slice(0,4),+ym.slice(5,7)-1+n,1));return d.toISOString().slice(0,7);};
// last day of the month after next (Philippine time): how far ahead customers can book
export function horizonEnd(today){const d=new Date(Date.UTC(+today.slice(0,4),+today.slice(5,7)+2,0));return d.toISOString().slice(0,10);}

const hhmm=v=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v));
const plural=(n,word)=>n+' '+word+(n===1?'':'s');
const levelOf=day=>{
 if(!day)return 'none';
 if(day.closed)return 'closed';
 if(!day.slots.length&&!day.booked)return 'none';
 if(day.booked>=day.capacity)return 'full';
 return day.booked/day.capacity>=.8?'almost':'free';
};
const LEVEL_TEXT={none:'No slots',closed:'Closed',full:'Full',almost:'Almost full',free:'Open'};

// date → {capacity, booked, closed, other, slots:[{start,end,open,count}]}: reservations counted per day against that
// day's limit (booking_date_settings, default 6); the hourly slots only show when on the day they are received
export function capacityByDate(slots,entries,settings){
 const days=new Map(),day=key=>{if(!days.has(key))days.set(key,{slots:[],capacity:6,booked:0,closed:false,other:0});return days.get(key);};
 settings.forEach(x=>{const d=day(x.booking_date);d.capacity=Number(x.capacity||6);d.closed=!!x.is_closed;});
 slots.slice().sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)).forEach(x=>day(dateKey(x.starts_at)).slots.push({start:x.starts_at,end:x.ends_at,open:!!x.is_open,count:0}));
 entries.filter(b=>b.status!=='cancelled').forEach(b=>{const d=day(b.booking_date);d.booked++;const t=String(b.scheduled_start||'').slice(0,5),slot=d.slots.find(x=>hhmm(x.start)===t);if(slot)slot.count++;else d.other++;});
 return days;
}
// the next n days in the shape the "Next 7 days" list and the Today tile use
export function nextDays(days,today,n=7){
 return Array.from({length:n},(_,i)=>{const date=new Date(Date.parse(today+'T00:00:00Z')+i*86400000).toISOString().slice(0,10),d=days.get(date)||{capacity:6,booked:0,closed:false,slots:[]};
  const capacity=d.closed?0:d.capacity;return {date,capacity,booked:d.booked,closed:d.closed,remaining:Math.max(0,capacity-d.booked),percent:capacity?Math.min(100,Math.round(d.booked/capacity*100)):0,closedBooked:d.closed?d.booked:0};});
}

export function capacityCalendarHTML(){
 return '<div class="cap-cal" data-cap-cal><div class="cap-cal-head"><button type="button" class="cap-nav" data-cap-move="-1" aria-label="Previous month">‹</button><strong data-cap-month></strong><button type="button" class="cap-nav" data-cap-move="1" aria-label="Next month">›</button></div>'+
  '<div class="cap-cal-grid" data-cap-grid></div>'+
  '<div class="cap-legend" aria-hidden="true">'+['free','almost','full','closed'].map(l=>'<span><i class="cap-swatch is-'+l+'"></i>'+LEVEL_TEXT[l]+'</span>').join('')+'</div>'+
  '<p class="cap-hint">Up to 6 reservations a day. Hover over a day to see them by hour'+(matchMedia('(hover:hover)').matches?'':' (tap on phones)')+'.</p>'+
  '<div class="cap-pop" role="tooltip" id="cap-pop" hidden></div></div>';
}

export function bindCapacityCalendar(root,days,today){
 const cal=root.querySelector('[data-cap-cal]');if(!cal)return;
 const grid=cal.querySelector('[data-cap-grid]'),pop=cal.querySelector('.cap-pop'),first=today.slice(0,7),last=horizonEnd(today).slice(0,7);
 let month=first,pinned=null,current=null,showTimer,hideTimer;
 const hide=()=>{pop.hidden=true;pinned=null;current=null;grid.querySelectorAll('.cap-day.is-on').forEach(b=>b.classList.remove('is-on'));};
 const show=cell=>{
  const key=cell.dataset.date,day=days.get(key),level=levelOf(day);
  pop.innerHTML='<div class="cap-pop-head"><strong>'+e(longDay(key))+'</strong><span class="cap-tag is-'+level+'">'+LEVEL_TEXT[level]+'</span></div>'+
   '<p class="cap-pop-sum">'+(!day?'No reservations yet · 6 left':day.closed?'Closed for reservations'+(day.booked?' · '+plural(day.booked,'reservation')+' already made':''):day.booked+' of '+day.capacity+' reservations · '+Math.max(0,day.capacity-day.booked)+' left')+'</p>'+
   (day&&day.slots.length?'<ul class="cap-slots">'+day.slots.map(s=>'<li class="'+(!s.open?'is-closed':s.count?'is-taken':'is-free')+'"><span>'+e(hm(s.start)+' – '+hm(s.end))+'</span><span class="cap-slot-bar"><i style="width:'+(day.capacity?Math.min(100,Math.round(s.count/day.capacity*100)):0)+'%"></i></span><b>'+(s.count?s.count+' reserved':s.open?'—':'Closed')+'</b></li>').join('')+
    (day.other?'<li class="is-taken"><span>Other times</span><span class="cap-slot-bar"><i style="width:'+Math.min(100,Math.round(day.other/day.capacity*100))+'%"></i></span><b>'+day.other+' reserved</b></li>':'')+'</ul>'
   :'<p class="cap-pop-sum">No receiving times set for this day.</p>');
  pop.hidden=false;grid.querySelectorAll('.cap-day.is-on').forEach(b=>b.classList.remove('is-on'));cell.classList.add('is-on');
  current=cell;place(cell);
 };
 // floats above the page (the panel would clip it): under the day, or above it when the screen has no room below
 const place=cell=>{
  const r=cell.getBoundingClientRect(),w=pop.offsetWidth,h=pop.offsetHeight;
  pop.style.left=Math.max(8,Math.min(innerWidth-w-8,r.left+r.width/2-w/2))+'px';
  pop.style.top=(r.bottom+6+h>innerHeight-8&&r.top-h-6>=8?r.top-h-6:Math.min(r.bottom+6,Math.max(8,innerHeight-h-8)))+'px';
 };
 const draw=()=>{
  cal.querySelector('[data-cap-month]').textContent=monthName(month);
  cal.querySelector('[data-cap-move="-1"]').disabled=month<=first;cal.querySelector('[data-cap-move="1"]').disabled=month>=last;
  const start=new Date(month+'-01T12:00:00Z'),lead=start.getUTCDay(),count=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate();
  let html=WEEK.map(d=>'<span class="cap-wd" aria-hidden="true">'+d+'</span>').join('')+'<span class="cap-blank"></span>'.repeat(lead);
  for(let n=1;n<=count;n++){
   const key=month+'-'+String(n).padStart(2,'0'),day=days.get(key),level=levelOf(day),pct=day&&day.capacity?Math.min(100,Math.round(day.booked/day.capacity*100)):0;
   const label=longDay(key)+': '+(day&&!day.closed?day.booked+' of '+day.capacity+' reservations':LEVEL_TEXT[level]);
   html+='<button type="button" class="cap-day is-'+level+(key<today?' is-past':'')+(key===today?' is-today':'')+'" data-date="'+key+'" data-row="'+Math.floor((lead+n-1)/7)+'" aria-label="'+e(label)+'" aria-describedby="cap-pop"><span class="cap-num">'+n+'</span>'+(day&&!day.closed&&(day.slots.length||day.booked)?'<span class="cap-meter"><i style="width:'+pct+'%"></i></span>':'')+'</button>';
  }
  grid.innerHTML=html;hide();
  grid.querySelectorAll('.cap-day').forEach(cell=>{
   cell.addEventListener('mouseenter',()=>{if(!matchMedia('(hover:hover)').matches||pinned)return;clearTimeout(hideTimer);showTimer=setTimeout(()=>show(cell),90);});
   cell.addEventListener('mouseleave',()=>{clearTimeout(showTimer);if(!pinned)hideTimer=setTimeout(()=>{if(!pop.matches(':hover'))hide();},120);});
   cell.addEventListener('focus',()=>{if(!pinned)show(cell);});
   cell.addEventListener('blur',()=>{if(!pinned)hideTimer=setTimeout(hide,120);});
   cell.addEventListener('click',()=>{if(pinned===cell){hide();return;}show(cell);pinned=cell;});   // tap on phones keeps it open
  });
 };
 pop.addEventListener('mouseenter',()=>clearTimeout(hideTimer));
 pop.addEventListener('mouseleave',()=>{if(!pinned)hideTimer=setTimeout(hide,100);});
 cal.querySelectorAll('[data-cap-move]').forEach(b=>b.onclick=()=>{month=shiftMonth(month,Number(b.dataset.capMove));draw();});
 cal.addEventListener('keydown',ev=>{if(ev.key==='Escape')hide();});
 document.addEventListener('click',ev=>{if(pinned&&cal.isConnected&&!cal.contains(ev.target))hide();});
 // scrolling keeps the popover beside its day; it closes once the day leaves the screen
 addEventListener('scroll',()=>{if(!cal.isConnected||pop.hidden||!current)return;const r=current.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)hide();else place(current);},{capture:true,passive:true});
 addEventListener('resize',()=>{if(cal.isConnected)hide();});
 draw();
}
