// "Lalamove delivery" card inside the Admin order details dialog (phase 79; phase 88: the customer confirms receipt).
// Lalamove is not connected to this site: the owner copies the booking details from the Lalamove app and taps
// Rider booked. The customer taps "I received my order"; that arrives in Chats and fills in the Received step here.
import {escapeHtml as e,icon} from '../components.js?v=3';
import {db} from '../backend-ui.js?v=3';

const LABEL={booked:'On the way',picked_up:'On the way',delivered:'Received',failed:'Failed / returned'};
const at=value=>{if(!value)return '';const d=new Date(value),day=k=>k.toLocaleDateString('en-CA',{timeZone:'Asia/Manila'});
 return d.toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'numeric',minute:'2-digit'})+(day(d)===day(new Date())?'':' · '+d.toLocaleDateString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric'}));};
const isLalamove=url=>{try{const u=new URL(url);return u.protocol==='https:'&&/(^|\.)lalamove\.com$/i.test(u.hostname);}catch{return false;}};
const phoneOk=v=>!v||/^\+?[\d\s-]{7,24}$/.test(v)&&v.replace(/\D/g,'').length>=7;

export function orderDeliverySection(o){
 if(o.fulfillment_method!=='lalamove')return '';
 return '<section class="dlv" data-delivery aria-busy="true"><header class="dlv-head"><span class="dlv-title">'+icon('delivery')+' Lalamove delivery</span></header><div class="dlv-skel" aria-hidden="true"><span></span><span></span><span></span></div></section>';
}

export async function mountOrderDelivery(dialog,o){
 const box=dialog.querySelector('[data-delivery]');if(!box)return;
 let row=null;
 try{row=await db.client.from('order_deliveries').select('*').eq('order_id',o.id).maybeSingle().then(db.unwrap);}
 catch(error){box.removeAttribute('aria-busy');box.querySelector('.dlv-skel').outerHTML='<p class="dlv-note">Delivery tracking is not available yet. Run database/phase79 first.</p>';return;}
 draw(box,o,row);
}

function draw(box,o,d){
 box.removeAttribute('aria-busy');
 const locked=o.status==='pending'||(o.status==='cancelled'&&!d);
 // the rider is booked once the cakes are ready, so the form opens at Ready (or earlier if a booking was already recorded)
 const early=!d&&['confirmed','preparing'].includes(o.status);
 const step=d?.step||null,booked=!!step&&step!=='failed',received=step==='delivered';
 const field=(name,label,attrs='',value=d?.[name])=>'<label class="dlv-field"><span>'+label+'</span><input name="'+name+'" value="'+e(value??'')+'" autocomplete="off" '+attrs+'></label>';
 box.innerHTML='<header class="dlv-head"><span class="dlv-title">'+icon('delivery')+' Lalamove delivery</span>'+(step?'<span class="dlv-pill is-'+step+'">'+e(LABEL[step])+'</span>':'<span class="dlv-pill">Not booked yet</span>')+'</header>'+
  (early?'<p class="dlv-early">'+icon('clock')+'<span><strong>Opens when the order is Ready.</strong> Tap Mark ready above, then book the rider in the Lalamove app and record it here.</span></p>':locked?'<p class="dlv-note">'+(o.status==='pending'?'Confirm the order first, then book the rider in the Lalamove app and record it here.':'This order was cancelled.')+'</p>':
  '<ol class="dlv-steps is-two" aria-label="Delivery steps">'+
   '<li><button type="button" data-step="booked" class="'+(booked?'is-done':'')+(booked&&!received?' is-now':'')+'"'+(booked&&!received?' aria-current="step"':'')+'><span class="dlv-dot" aria-hidden="true">'+(booked?'✓':'1')+'</span><b>Rider booked</b><small>'+(d?.booked_at&&booked?e(at(d.booked_at)):'Tap when booked')+'</small></button></li>'+
   '<li><div class="dlv-received'+(received?' is-done is-now':'')+'"'+(received?' aria-current="step"':'')+'><span class="dlv-dot" aria-hidden="true">'+(received?'✓':'2')+'</span><b>'+(received?'Received':'Customer receives')+'</b><small>'+(received?e(at(d.delivered_at))+(d.received_by_customer?' · confirmed by the customer':''):booked?'Waiting for the customer to tap “I received it”':'After the rider is booked')+'</small></div></li></ol>'+
  (step==='failed'?'<p class="dlv-failed-note"><strong>Failed / returned'+(d.failed_at?' · '+e(at(d.failed_at)):'')+'</strong>'+e(d.failure_reason||'')+'</p>':'')+
  '<form class="dlv-form" novalidate>'+
   '<label class="dlv-field dlv-link"><span>Tracking link <small>from Share in the Lalamove app</small></span><span class="dlv-link-row"><input name="tracking_url" type="url" inputmode="url" value="'+e(d?.tracking_url||'')+'" placeholder="https://… (paste the share link)" autocomplete="off"><button type="button" class="button" data-paste>Paste</button><a class="button" data-open target="_blank" rel="noopener noreferrer"'+(d?.tracking_url?' href="'+e(d.tracking_url)+'"':' hidden')+'>Open</a></span><small class="dlv-hint" data-link-hint></small></label>'+
   '<div class="dlv-grid">'+field('rider_name','Rider name','maxlength="80" placeholder="As shown in the app"')+field('rider_phone','Rider phone','inputmode="tel" maxlength="24" placeholder="0917 123 4567"')+field('plate_number','Plate number','maxlength="15" placeholder="NAB 1234"')+field('booking_ref','Lalamove booking ID','maxlength="40" placeholder="Order ID in the app"')+field('fee_charged','Fee Lalamove charged (₱)','inputmode="decimal" placeholder="0.00"',d?.fee_charged!=null?Number(d.fee_charged).toFixed(2):'')+'</div>'+
   '<label class="dlv-field"><span>Note <small>(only you see this)</small></span><input name="note" maxlength="300" value="'+e(d?.note||'')+'" placeholder="e.g. Leave at the guard house" autocomplete="off"></label>'+
   '<div class="dlv-fail-form" hidden><label class="dlv-field"><span>What happened?</span><input name="failure_reason" maxlength="300" placeholder="e.g. Customer not home, returned to LexC’s" autocomplete="off"></label><div class="dlv-actions"><button type="button" class="button button--danger" data-confirm-fail>Mark failed / returned</button><button type="button" class="text-button" data-cancel-fail>Keep the delivery going</button></div></div>'+
   '<div class="dlv-actions" data-main-actions><button type="submit" class="button button--primary">'+(d?'Save details':'Save · rider booked')+'</button>'+(d&&step!=='failed'?'<button type="button" class="text-button dlv-fail-link" data-fail>Delivery failed?</button>':'')+'</div><p class="dlv-status" role="status"></p>'+
  '</form>'+
  '<p class="dlv-foot">The customer is told in chat when you tap Rider booked or add the tracking link. When they tap “I received it”, you get it in Chats — then use Mark completed once it is paid.</p>');
 if(locked||early)return;
 const form=box.querySelector('form'),status=box.querySelector('.dlv-status'),hint=box.querySelector('[data-link-hint]'),open=box.querySelector('[data-open]');
 const say=(text,bad)=>{status.textContent=text;status.classList.toggle('is-error',!!bad);};
 const linkBox=form.elements.tracking_url,mark=bad=>{linkBox.classList.toggle('is-invalid',bad);linkBox.setAttribute('aria-invalid',bad?'true':'false');};
 const checkLink=(required)=>{const v=linkBox.value.trim();mark(false);
  if(!v){open.hidden=true;if(required){hint.textContent='Paste the Lalamove tracking link first. The customer follows the rider with it.';hint.className='dlv-hint is-error';mark(true);return false;}hint.textContent='';return true;}
  if(!/^https:\/\/\S+$/.test(v)){hint.textContent='Paste the full link that starts with https://';hint.className='dlv-hint is-error';open.hidden=true;mark(true);return false;}
  hint.textContent=isLalamove(v)?'Lalamove link ✓ — the customer gets a “Track live” button':'This is not a lalamove.com link. Double-check it before saving.';hint.className='dlv-hint'+(isLalamove(v)?' is-ok':' is-warn');open.href=v;open.hidden=false;return true;};
 checkLink();
 form.addEventListener('input',event=>{if(event.target.name==='tracking_url')checkLink();say('Unsaved changes');});
 form.elements.fee_charged.addEventListener('input',event=>{const v=event.target.value.replace(/[^\d.]/g,'').replace(/^(\d*\.?)(.*)$/,(m,a,b)=>a+b.replace(/\./g,'')).replace(/(\.\d{2})\d+$/,'$1');if(v!==event.target.value)event.target.value=v;});
 box.querySelector('[data-paste]').onclick=async()=>{try{const text=(await navigator.clipboard.readText()).trim();const link=(text.match(/https:\/\/\S+/)||[text])[0];form.elements.tracking_url.value=link;checkLink();say('Unsaved changes');}catch{say('Your browser blocked pasting. Long-press the box and paste instead.',true);form.elements.tracking_url.focus();}};
 const details=()=>{const f=form.elements,get=n=>f[n].value.trim();return {tracking_url:get('tracking_url'),booking_ref:get('booking_ref'),rider_name:get('rider_name'),rider_phone:get('rider_phone'),plate_number:get('plate_number'),fee_charged:get('fee_charged'),note:get('note'),failure_reason:get('failure_reason')};};
 const save=async(nextStep,button)=>{
  if(!checkLink(nextStep!=='failed')){say('The tracking link is required.',true);linkBox.focus();return;}
  if(!phoneOk(form.elements.rider_phone.value.trim())){say('Check the rider phone number (digits only).',true);form.elements.rider_phone.focus();return;}
  const body=details();if(nextStep)body.step=nextStep;else if(!d)body.step='booked';
  const buttons=box.querySelectorAll('button');buttons.forEach(b=>b.disabled=true);button?.classList.add('is-busy');say('Saving…');
  // the database posts a chat message when the step changes, or when a tracking link arrives while the rider is out
  const told=(body.step&&body.step!==d?.step)||(body.tracking_url&&body.tracking_url!==(d?.tracking_url||'')&&['booked','picked_up'].includes(body.step||d?.step));
  try{const saved=await db.rpc('save_order_delivery',{target_order:o.id,details:body});draw(box,o,Array.isArray(saved)?saved[0]:saved);
   const s=box.querySelector('.dlv-status');if(s)s.textContent=told?'Saved · the customer was told in chat':'Saved';}
  catch(error){buttons.forEach(b=>b.disabled=false);button?.classList.remove('is-busy');say(error.message||'Could not save. Try again.',true);}
 };
 form.onsubmit=event=>{event.preventDefault();save(null,event.submitter);};
 box.querySelectorAll('[data-step]').forEach(button=>button.onclick=()=>{if(booked&&d)return;save(button.dataset.step,button);});
 const failForm=box.querySelector('.dlv-fail-form'),main=box.querySelector('[data-main-actions]');
 box.querySelector('[data-fail]')?.addEventListener('click',()=>{failForm.hidden=false;main.hidden=true;form.elements.failure_reason.focus();});
 box.querySelector('[data-cancel-fail]').onclick=()=>{failForm.hidden=true;main.hidden=false;};
 box.querySelector('[data-confirm-fail]').onclick=event=>{if(!form.elements.failure_reason.value.trim()){say('Write what happened first.',true);failForm.hidden=false;form.elements.failure_reason.focus();return;}save('failed',event.currentTarget);};
}
