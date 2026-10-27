// Lalamove delivery card for customers (My Orders and the order chat) — phase 79.
// The details are copied by LexC's from the Lalamove app; this only shows them. window.LexcDelivery.card(row, options)
(function(){
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const time=value=>{if(!value)return '';const d=new Date(value),day=k=>k.toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  return d.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})+(day(d)===day(new Date())?'':', '+d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}));};
 const safeLink=url=>{try{const u=new URL(url);return u.protocol==='https:'?u:null;}catch{return null;}};
 const scooter='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7M14 6h3l2 6.5M18 17l-2.6-6.5H11l-2.5 4M5 10h4"/></svg>';
 const TEXT={
  booked:['A rider is booked','Your rider is heading to LexC’s to pick up your order.'],
  picked_up:['Your order is on the way','Your rider has your treats and is heading to you.'],
  delivered:['Delivered','Enjoy your treats! Thank you for ordering from LexC’s.'],
  failed:['Delivery didn’t go through','LexC’s will message you here to sort it out.']
 };
 const STEPS=[['booked','Booked'],['picked_up','On the way'],['delivered','Delivered']];
 // row: an order_deliveries row. options.step shows the card as of that step (chat history); options.compact = chat size.
 function card(d,options={}){
  if(!d)return '';
  const step=options.step||d.step,now=d.step,[title,line]=TEXT[step]||TEXT.booked;
  const at={booked:d.booked_at,picked_up:d.picked_up_at,delivered:d.delivered_at,failed:d.failed_at}[step];
  const rank=step==='failed'?-1:STEPS.findIndex(s=>s[0]===step);
  const link=safeLink(d.tracking_url),live=link&&['booked','picked_up'].includes(now);
  const lalamove=link&&/(^|\.)lalamove\.com$/i.test(link.hostname);
  const rider=[d.rider_name,d.plate_number].filter(Boolean).join(' · ');
  const phone=d.rider_phone?String(d.rider_phone).replace(/[^\d+]/g,''):'';
  const fee=d.fee_charged!=null&&['booked','picked_up'].includes(now)?'₱'+Number(d.fee_charged).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2}):'';
  return '<section class="lx-dlv is-'+esc(step)+(options.compact?' is-compact':'')+'" aria-label="Delivery: '+esc(title)+'">'+
   '<div class="lx-dlv-top"><span class="lx-dlv-icon">'+(step==='delivered'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>':scooter)+'</span><div><strong>'+esc(title)+'</strong><small>'+esc((at?time(at)+' · ':'')+'Lalamove delivery')+'</small></div></div>'+
   (options.compact?'':'<p class="lx-dlv-line">'+esc(step==='failed'&&d.failure_reason?d.failure_reason:line)+'</p>')+
   (step==='failed'||options.compact?'':'<ol class="lx-dlv-track" aria-label="Delivery progress">'+STEPS.map(([,label],i)=>'<li class="'+(i<rank?'is-done':i===rank?'is-now':'')+'"'+(i===rank?' aria-current="step"':'')+'><span aria-hidden="true"></span>'+esc(label)+'</li>').join('')+'</ol>')+
   (!options.compact&&(rider||phone||fee)&&now!=='delivered'?'<dl class="lx-dlv-info">'+(rider?'<dt>Rider</dt><dd>'+esc(rider)+'</dd>':'')+(phone?'<dt>Contact</dt><dd><a href="tel:'+esc(phone)+'">'+esc(d.rider_phone)+'</a></dd>':'')+(fee?'<dt>Delivery fee</dt><dd>'+esc(fee)+' <small>pay the rider</small></dd>':'')+'</dl>':'')+
   (live&&['booked','picked_up'].includes(step)?'<a class="lx-dlv-live" href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer"><span class="lx-dlv-pulse" aria-hidden="true"></span>'+(lalamove?'Track live on Lalamove':'Open tracking link')+'<span aria-hidden="true">↗</span></a>':'')+
  '</section>';
 }
 window.LexcDelivery={card};
})();
