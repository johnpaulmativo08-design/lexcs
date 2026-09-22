// Database adapter for the existing storefront controls.
let liveCatalog=[], liveSlots=[], selectedSlotId=null, checkoutSaving=false;
let appliedTopping='none', defaultSprinkles=true, savedInvoiceItems=[];
window.addEventListener('lexc-customizer-reset',()=>{appliedTopping='none';defaultSprinkles=true;});
const phDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const phTime=value=>new Date(value).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hour12:false});
const slotLabel=s=>phTime(s.starts_at)+'–'+phTime(s.ends_at);
const bookingDateLabel=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00+08:00'));
document.getElementById('addToppingBtn').addEventListener('click',()=>{appliedTopping=document.getElementById('toppingType').value;});
document.getElementById('clearToppingsBtn').addEventListener('click',()=>{appliedTopping='none';});
document.getElementById('removeSprinklesBtn').addEventListener('click',()=>{defaultSprinkles=false;});
async function loadStorefront(){
 try{
  const [catalog,categories,gallery]=await Promise.all([LexcBackend.catalog(),LexcBackend.categories(),LexcBackend.gallery()]);
  liveCatalog=catalog.filter(p=>p.status==='active');
  products.splice(0,products.length,...liveCatalog.filter(p=>p.kind==='standard').map((p,index)=>({
   id:p.legacy_id||10000+index,product_id:p.id,name:p.name,desc:p.description,cat:p.categories?.slug||'',emoji:p.emoji||'🧁',badge:p.badge_label,stars:'',
   sizes:p.product_variants.filter(v=>v.is_active).map(v=>({id:v.id,label:v.label,price:Number(v.price)}))
  })).filter(p=>p.sizes.length).map(p=>({...p,price:p.sizes[0].price})));
  for(const p of products){const db=liveCatalog.find(d=>d.id===p.product_id);if(db.image_path)PRODUCT_IMAGES[p.id]=LexcBackend.mediaURL(db.image_path);}
  galleryItems.splice(0,galleryItems.length,...gallery.filter(g=>g.visibility==='visible').map(g=>({img:LexcBackend.mediaURL(g.image_path),label:g.label,desc:g.description,cat:g.category,size:g.display_size==='tall'?'tall':''})));
  const filters=document.getElementById('catFilters'),all=filters.querySelector('[data-cat=all]')?.outerHTML||'';
  filters.innerHTML=all+categories.filter(c=>c.is_active).map(c=>'<button class="filter-item" data-cat="'+authEscape(c.slug)+'">'+authEscape(c.name)+' <span>'+products.filter(p=>p.cat===c.slug).length+'</span></button>').join('');
  const packageCards = document.querySelectorAll('#page-packages .pkg-card');
  const packageContainer = packageCards[0]?.parentElement;
  if (packageContainer) {
    packageContainer.innerHTML = liveCatalog.filter(p => p.kind === 'package').map((p,index) => {
      const price = p.product_variants.find(v => v.is_active)?.price;
      return '<div class="pkg-card '+['pkg-mini','pkg-sweet','pkg-golden'][index%3]+'"><div class="pkg-badge">'+authEscape(p.name)+'</div><div class="pkg-price-tag">Starts at</div><div class="pkg-price">₱ '+Number(price||0).toLocaleString()+'</div><button class="pkg-order-btn pkg-btn-plum" data-package="'+p.id+'" '+(price===undefined?'disabled':'')+'>ORDER NOW</button><ul class="pkg-items">'+(p.package_contents||[]).map(item=>'<li>'+authEscape(item)+'</li>').join('')+'</ul></div>';
    }).join('');
    packageContainer.querySelectorAll('[data-package]').forEach(button => button.onclick = () => addPackageToCart(liveCatalog.find(p => p.id === button.dataset.package).name));
  }
  renderShop();updateCategoryCounts();renderCart();if(currentPage==='gallery')renderGallery();
 }catch(error){showToast('Catalog could not load: '+error.message);}
}
function addPackageToCart(name){
 const p=liveCatalog.find(p=>p.kind==='package'&&p.name===name),v=p?.product_variants.find(v=>v.is_active);
 if(!v)return showToast('This package is unavailable.');
 const item=cart.find(i=>i.variant_id===v.id);
 if(item)item.qty++;else cart.push({id:'pkg-'+p.id,product_id:p.id,variant_id:v.id,name:'Package: '+p.name,emoji:'🎁',sizeLabel:v.label,price:Number(v.price),qty:1});
 renderCart();openCart();
}
function addCustomizedToCart(){
 const p=liveCatalog.find(p=>p.kind==='customizable'),v=p?.product_variants.find(v=>v.code===customizerFrostingStyle&&v.is_active);
 if(!v)return showToast('This cupcake option is unavailable.');
 cart.push({id:'custom-'+crypto.randomUUID(),product_id:p.id,variant_id:v.id,name:p.name,emoji:'🧁',sizeLabel:v.label+' · '+customizerBaseFlavor+' · '+appliedTopping,price:Number(v.price),qty:1,customization:{base:customizerBaseFlavor,frosting:customizerFrostingStyle,color:document.getElementById('frostingColor').value,topping:appliedTopping,default_sprinkles:defaultSprinkles}});
 renderCart();showToast('Custom cupcake added to cart.');
}
async function renderDtSlots(){
 const list=document.getElementById('dtSlotsList'),date=dtSelectedDate;
 selectedSlotId=null;
 if(!date){list.textContent='Please select a date first.';return;}
 const bookingDay=dtAvailability?.get(date);
 if(!bookingDay||bookingDay.is_closed||bookingDay.remaining_slots<=0||!bookingDay.has_receiving_slot){list.innerHTML='<div class="dt-slot-summary"><strong>This date is unavailable</strong>Please choose an available date in the calendar.</div>';return;}
 list.textContent='Checking availability…';
 try{
  const from=new Date(date+'T00:00:00+08:00'),to=new Date(from.getTime()+86400000);
  const slots=await LexcBackend.rpc('get_availability',{from_date:from.toISOString(),to_date:to.toISOString()});
  if(dtSelectedDate!==date)return;liveSlots=slots;
  const summary='<div class="dt-slot-summary"><strong>'+bookingDateLabel(date)+'</strong>'+bookingDay.remaining_slots+' of '+bookingDay.capacity+' booking slots remaining · Choose a receiving window.</div>';
  list.innerHTML=slots.length?summary+slots.map(s=>'<button type="button" class="dt-slot'+(s.remaining<=0?' full':'')+'" data-slot="'+s.id+'" '+(s.remaining<=0?'disabled':'')+'><span class="dt-slot-time">'+slotLabel(s)+'</span><span class="dt-slot-status '+(s.remaining>0?'avail':'full')+'">'+(s.remaining>0?'Available':'Fully booked')+'</span></button>').join(''):summary+'<div class="dt-slot-summary">No receiving window is available for this date. Please choose another available date.</div>';
  list.querySelectorAll('[data-slot]').forEach(button=>button.onclick=()=>{
   selectedSlotId=button.dataset.slot;dtSelectedSlot=slotLabel(liveSlots.find(s=>s.id===selectedSlotId));
   list.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===button));
   document.getElementById('dtConfirmBtn').disabled=false;
  });
 }catch(error){list.textContent=error.message;}
}
function confirmDateTime(){
 if(!selectedSlotId||!dtSelectedDate)return;
 document.getElementById('coDate').value=dtSelectedDate;document.getElementById('coTime').value=dtSelectedSlot;
 document.getElementById('coDate').dataset.slotId=selectedSlotId;
 document.getElementById('coDateLabel').textContent=bookingDateLabel(dtSelectedDate);document.getElementById('coTimeLabel').textContent=dtSelectedSlot;closeDateTimeModal();
}
async function submitCheckout(){
 if(checkoutSaving)return;if(!currentUser){navigate('checkout');return;}
 if(!cart.length)return showToast('Your cart is empty.');
 const field=id=>document.getElementById(id).value.trim();
 if(!field('coDate')||!field('coTime'))return showToast('Choose a booking date and receiving time.');
 if(!selectedDelivery||!selectedPayment)return showToast('Choose fulfillment and a payment preference. No payment is collected here.');
 if(cart.some(i=>!i.variant_id))return showToast('Your saved cart contains older items. Remove and re-add them from the updated catalog.');
 const fingerprint=JSON.stringify({cart,name:field('coName'),phone:field('coContact'),address:field('coAddress'),slot:document.getElementById('coDate').dataset.slotId,delivery:selectedDelivery,notes:field('coNotes'),payment:selectedPayment});
 let request=readAuthStorage(localStorage,'lexc_checkout_request',null);
 if(!request||request.fingerprint!==fingerprint)request={fingerprint,id:crypto.randomUUID()};
 localStorage.setItem('lexc_checkout_request',JSON.stringify(request));checkoutSaving=true;
 try{
  const latest = await LexcBackend.catalog();
  let priceChanged = false;
  for (const item of cart) {
    const product = latest.find(product => product.id === item.product_id);
    const variant = product?.product_variants.find(variant => variant.id === item.variant_id && variant.is_active);
    if (!product || product.status !== 'active' || !variant) throw new Error(item.name + ' is no longer available. Please update your cart.');
    if (Number(item.price) !== Number(variant.price)) { item.price = Number(variant.price); priceChanged = true; }
  }
  if (priceChanged) {
    renderCart(); renderCheckout();
    showToast('A product price has changed. Review the updated total and choose your receiving time again.');
    return;
  }
  const selectedDate=field('coDate');
  const freshAvailability=await LexcBackend.rpc('get_customer_booking_dates',{from_date:selectedDate,to_date:selectedDate});
  const selectedDay=freshAvailability[0];
  if(!selectedDay||selectedDay.is_closed||selectedDay.remaining_slots<=0||!selectedDay.has_receiving_slot)throw new Error('This booking date is no longer available. Please choose another date.');
  const order=await LexcBackend.rpc('create_order',{payload:{request_id:request.id,name:field('coName'),phone:field('coContact'),address:field('coAddress'),notes:field('coNotes'),slot_id:document.getElementById('coDate').dataset.slotId,fulfillment:selectedDelivery==='Lalamove'?'lalamove':'pickup',payment_method:selectedPayment,items:cart.map(i=>({variant_id:i.variant_id,qty:i.qty,customization:i.customization||null,reference_image_path:i.reference_image_path||null}))}});
  savedInvoiceItems=order.items.map(i=>({name:i.name_snapshot,sizeLabel:i.variant_label_snapshot,price:Number(i.unit_price),qty:i.quantity}));
  renderInvoice({name:order.customer_name,address:order.address,contact:order.contact_phone,dateVal:phDate(order.receiving_start),timeVal:slotLabel({starts_at:order.receiving_start,ends_at:order.receiving_end}),payment:order.requested_payment_method||'unpaid',delivery:order.fulfillment_method,items:savedInvoiceItems,subtotal:Number(order.items_subtotal)});
  document.getElementById('invPayMethod').textContent=(order.requested_payment_method||'')+' · UNPAID · Order #'+order.order_number;
  if(order.total_amount===null)for(const id of ['invGrandTotal','invDownpayment','invBalance'])document.getElementById(id).textContent='Pending delivery quote';
  cart=[];renderCart();localStorage.removeItem('lexc_checkout_request');navigate('invoice');showToast('Order #'+order.order_number+' and its booking request were saved. No payment has been collected.');
 }catch(error){showToast(error.message);}finally{checkoutSaving=false;}
}
async function showMyOrders(){
 if(!currentUser)return navigate('login');
 const dialog=document.createElement('dialog');
 dialog.style.cssText='max-width:850px;width:90%;border:0;border-radius:18px;padding:24px;background:var(--cream);color:var(--plum)';
 dialog.innerHTML='<h2>My Orders</h2><div data-orders>Loading…</div><button class="btn-primary" data-close>Close</button>';
 document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=()=>{dialog.close();dialog.remove();};
 try{
  const [orders,bookings]=await Promise.all([LexcBackend.orders(),LexcBackend.rpc('get_my_bookings',{})]);
  const mine=orders.filter(order => order.customer_id === currentUser.id), bookingByOrder=new Map(bookings.map(booking=>[booking.order_id,booking]));
  const typeLabel=value=>value==='lalamove'?'Delivery':'Pickup';
  const paymentLabel=value=>({unpaid:'Downpayment Pending',partially_paid:'Downpayment Paid',paid:'Fully Paid',failed:'Payment Failed',refunded:'Refunded'}[value]||String(value||'Unpaid').replaceAll('_',' '));
  const moneyValue=value=>value===null||value===undefined?'Pending delivery quote':'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  dialog.querySelector('[data-orders]').innerHTML=mine.length?mine.map(o=>{const b=bookingByOrder.get(o.id);return '<section><h3>Order #'+o.order_number+' · '+authEscape(b?.booking_status||o.status)+'</h3><p><strong>Booking:</strong> '+authEscape(b?.booking_date||phDate(o.receiving_start))+' · '+authEscape(typeLabel(b?.fulfillment_method||o.fulfillment_method))+(b?.scheduled_start?' · '+authEscape(String(b.scheduled_start).slice(0,5)):'')+'</p><p><strong>Payment:</strong> '+authEscape(paymentLabel(b?.payment_status||o.payment_status))+' · Required downpayment: '+moneyValue(b?.deposit_due??o.deposit_due)+' · Remaining: '+moneyValue(b?.remaining_balance??(o.total_amount===null?null:Number(o.total_amount)-Number(o.amount_paid||0)))+'</p><ul>'+o.order_items.map(i=>'<li>'+authEscape(i.name_snapshot)+' · '+authEscape(i.variant_label_snapshot)+' ×'+i.quantity+'</li>').join('')+'</ul>'+(o.status==='completed'?'<button class="btn-primary" data-review="'+o.id+'">Write or update review</button>':'')+'</section>';}).join(''):'No orders yet.';
  dialog.querySelectorAll('[data-review]').forEach(button => button.onclick = () => showReviewForm(button.dataset.review));
 }catch(error){dialog.querySelector('[data-orders]').textContent=error.message;}
}
document.getElementById('coContact').insertAdjacentHTML('afterend','<label class="co-label" for="orderReference">Optional reference image (applied to customized cart items)</label><input id="orderReference" type="file" accept="image/jpeg,image/png,image/webp"><p id="referenceStatus" role="status"></p>');
document.getElementById('orderReference').onchange=async event=>{
 const status=document.getElementById('referenceStatus'),file=event.target.files[0];if(!file)return;
 if(!currentUser||!cart.some(i=>i.customization)){status.textContent='Sign in and add a customized cupcake first.';return;}
 try{status.textContent='Uploading privately…';const path=await LexcBackend.upload('customer-references',currentUser.id+'/draft',file);cart.filter(i=>i.customization).forEach(i=>i.reference_image_path=path);renderCart();status.textContent='Private reference saved with your customized items.';}catch(error){status.textContent=error.message;}
};
function showReviewForm(orderId) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'max-width:520px;width:90%;padding:24px;border:0;border-radius:18px;background:var(--cream)';
  dialog.innerHTML = '<form><h2>Review your completed order</h2><label class="co-label">Public display name<input class="co-input" name="display_name" maxlength="100" required value="'+authEscape(currentUser.name||'Customer')+'"></label><label class="co-label">Rating<select class="co-input" name="rating"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select></label><label class="co-label">Review<textarea class="co-textarea" name="text" maxlength="3000" required></textarea></label><label class="co-label">Optional photo<input name="image" type="file" accept="image/jpeg,image/png,image/webp"></label><p role="alert"></p><button class="btn-primary" type="submit">Submit for review</button><button type="button" data-close>Cancel</button></form>';
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector('[data-close]').onclick = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, button = form.querySelector('[type=submit]');
    button.disabled = true;
    try {
      const file = form.elements.image.files[0];
      const image_path = file ? await LexcBackend.upload('review-images',currentUser.id+'/'+orderId,file) : null;
      await LexcBackend.rpc('submit_review',{payload:{order_id:orderId,display_name:form.elements.display_name.value,rating:Number(form.elements.rating.value),text:form.elements.text.value,image_path}});
      dialog.close(); dialog.remove(); showToast('Review saved. It will appear publicly after approval.');
    } catch(error) { form.querySelector('[role=alert]').textContent = error.message; }
    finally { button.disabled = false; }
  };
}
async function loadPublicReviews() {
  const container = document.getElementById('publicReviews');
  try {
    const reviews = await LexcBackend.rpc('get_public_reviews', {});
    container.innerHTML = reviews.length ? reviews.map(review =>
      '<article class="t-card"><div class="t-quote">"</div><p class="t-text">' +
      authEscape(review.review_text) + '</p><div class="t-author"><div class="t-avatar">⭐</div><div><div class="t-name">' +
      authEscape(review.public_display_name) + '</div><div class="t-role">' +
      review.rating + '/5 · Verified order</div></div></div></article>'
    ).join('') : '<p>No published reviews yet. Customers can review completed orders from My Orders.</p>';
  } catch (error) {
    container.textContent = 'Customer reviews are temporarily unavailable.';
  }
}
loadStorefront();
loadPublicReviews();
