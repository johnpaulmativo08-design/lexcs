// Lalamove delivery card for customers (My Orders and the order chat) — phase 79; "I received my order" — phase 88.
// The details are copied by LexC's from the Lalamove app; the customer confirms the delivery themself.
// window.LexcDelivery.card(row, options) · any [data-received="<order id>"] button confirms (tap twice).
(function(){
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const time=value=>{if(!value)return '';const d=new Date(value),day=k=>k.toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
  return d.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})+(day(d)===day(new Date())?'':', '+d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}));};
 const safeLink=url=>{try{const u=new URL(url);return u.protocol==='https:'?u:null;}catch{return null;}};
 const scooter='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8.5 17h7M14 6h3l2 6.5M18 17l-2.6-6.5H11l-2.5 4M5 10h4"/></svg>';
 const TEXT={
  booked:['Your order is on the way','A Lalamove rider is bringing your treats. Tap “I received my order” when they arrive.'],
  picked_up:['Your order is on the way','A Lalamove rider is bringing your treats. Tap “I received my order” when they arrive.'],
  delivered:['Received','Thanks for confirming! Enjoy your treats.'],
  failed:['Delivery didn’t go through','LexC’s will message you here to sort it out.']
 };
 const STEPS=[['booked','On the way'],['delivered','Received']];
 // row: an order_deliveries row. options.step shows the card as of that step (chat history); options.compact = chat size.
 function card(d,options={}){
  if(!d)return '';
  const step=options.step||d.step,now=d.step,[title,line]=TEXT[step]||TEXT.booked;
  const at={booked:d.booked_at,picked_up:d.picked_up_at,delivered:d.delivered_at,failed:d.failed_at}[step];
  const rank=step==='failed'?-1:step==='delivered'?1:0;   // older "picked up" rows count as on the way
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
   (!options.compact&&!/\/admin\//.test(location.pathname)&&['booked','picked_up'].includes(now)&&d.order_id?'<button type="button" class="lx-dlv-received" data-received="'+esc(d.order_id)+'"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg><span>I received my order</span></button>':'')+
   (live&&['booked','picked_up'].includes(step)?'<a class="lx-dlv-live" href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer"><span class="lx-dlv-pulse" aria-hidden="true"></span>'+(lalamove?'Track live on Lalamove':'Open tracking link')+'<span aria-hidden="true">↗</span></a>':'')+
  '</section>';
 }
 // "I received my order": the first tap asks, the second confirms (phase 88 tells LexC's in the order chat)
 async function confirmReceived(button){
  const id=button.dataset.received,label=button.querySelector('span')||button,original=button.dataset.label||(button.dataset.label=label.textContent);
  if(button.dataset.armed!=='1'){button.dataset.armed='1';button.classList.add('is-armed');label.textContent='Tap again to confirm';clearTimeout(button._t);button._t=setTimeout(()=>{button.dataset.armed='';button.classList.remove('is-armed');label.textContent=original;},4000);return;}
  clearTimeout(button._t);button.disabled=true;label.textContent='Confirming…';
  try{
   const db=window.LexcBackend;db.unwrap(await db.client.rpc('confirm_order_received',{target_order:id}));
   window.showToast?.('Thanks! LexC’s has been told you received your order.',{type:'success'});
   document.dispatchEvent(new CustomEvent('lexc:order-received',{detail:{orderId:id}}));
   if(document.getElementById('cartDrawer')?.classList.contains('open')&&typeof window.showMyOrders==='function')window.showMyOrders(id);
  }catch(error){button.disabled=false;button.dataset.armed='';button.classList.remove('is-armed');label.textContent=original;window.showToast?.(error.message||'Could not confirm. Try again.',{type:'error'});}
 }
 document.addEventListener('click',event=>{const b=event.target.closest?.('[data-received]');if(b&&!b.disabled){event.preventDefault();confirmReceived(b);}});
 window.LexcDelivery={card};
})();
