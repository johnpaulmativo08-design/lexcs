// Database adapter for the existing storefront controls.
let liveCatalog=[], liveSlots=[], selectedSlotId=null, checkoutSaving=false;
function customerActionError(error,fallback){
 const message=String(error?.message||'');
 if(/no longer available|price has changed|booking date|receiving time|payment method|valid bank transaction reference|only jpg|only png|only webp/i.test(message))return message;
 console.warn('Customer action failed:',error);
 return fallback;
}
let savedInvoiceItems=[];
const phDate=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const phTime=value=>new Date(value).toLocaleTimeString('en-PH',{timeZone:'Asia/Manila',hour:'2-digit',minute:'2-digit',hour12:false});
const slotLabel=s=>phTime(s.starts_at)+'–'+phTime(s.ends_at);
const bookingDateLabel=value=>new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',weekday:'short',month:'short',day:'numeric',year:'numeric'}).format(new Date(value+'T12:00:00+08:00'));
async function loadStorefront(){
 window.lexcCatalogState='loading';
 renderShop();renderGallery();
 const packageContainer=document.querySelector('#page-packages .pkg-grid');
 if(packageContainer)packageContainer.innerHTML=Array.from({length:3},()=>'<div class="pkg-card pkg-card-skeleton" aria-hidden="true"><span class="skel skel-title"></span><span class="skel skel-line skel-line--short"></span><span class="skel skel-value"></span><span class="skel skel-button"></span><span class="skel skel-line skel-line--long"></span><span class="skel skel-line"></span></div>').join('');
 try{
  const [catalog,categories,gallery,methods]=await Promise.all([LexcBackend.catalog(),LexcBackend.categories(),LexcBackend.gallery(),LexcBackend.client.from('payment_methods').select('code,display_name').eq('active',true).then(LexcBackend.unwrap)]);
  liveCatalog=catalog.filter(p=>p.status==='active');
  const methodRoot=document.getElementById('checkoutPaymentMethods');
  methodRoot.innerHTML=methods.map(m=>'<button type="button" class="co-option" data-payment-code="'+authEscape(m.code)+'" aria-pressed="false"><span class="co-option-icon"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h3"/></svg></span><span>'+authEscape(m.display_name)+'</span></button>').join('')||'<p>Online payment is temporarily unavailable.</p>';
  methodRoot.querySelectorAll('[data-payment-code]').forEach(button=>button.onclick=()=>selectPayment(button,button.dataset.paymentCode));
  products.splice(0,products.length,...liveCatalog.filter(p=>p.kind==='standard').map((p,index)=>({
   id:p.legacy_id||10000+index,product_id:p.id,name:p.name,desc:p.description,cat:p.categories?.slug||'',emoji:p.emoji||'🧁',badge:p.badge_label,stars:'',isTest:p.is_test_product,
   sizes:p.product_variants.filter(v=>v.is_active).map(v=>({id:v.id,label:v.label,price:Number(v.price)}))
  })).filter(p=>p.sizes.length).map(p=>({...p,price:p.sizes[0].price})));
  for(const p of products){const db=liveCatalog.find(d=>d.id===p.product_id);if(db.image_path)PRODUCT_IMAGES[p.id]=LexcBackend.mediaURL(db.image_path);}
  galleryItems.splice(0,galleryItems.length,...gallery.filter(g=>g.visibility==='visible').map(g=>({img:LexcBackend.mediaURL(g.image_path),label:g.label,desc:g.description,cat:g.category,size:g.display_size==='tall'?'tall':''})));
  const filters=document.getElementById('catFilters'),all=filters.querySelector('[data-cat=all]')?.outerHTML||'';
  filters.innerHTML=all+categories.filter(c=>c.is_active).map(c=>'<button class="filter-item" data-cat="'+authEscape(c.slug)+'">'+authEscape(c.name)+' <span>'+products.filter(p=>p.cat===c.slug).length+'</span></button>').join('');
  if (packageContainer) {
    packageContainer.innerHTML = liveCatalog.filter(p => p.kind === 'package').map((p,index) => {
      const price = p.product_variants.find(v => v.is_active)?.price;
      return '<div class="pkg-card '+['pkg-mini','pkg-sweet','pkg-golden'][index%3]+'"><div class="pkg-badge">'+authEscape(p.name)+'</div><div class="pkg-price-tag">Starts at</div><div class="pkg-price">₱ '+Number(price||0).toLocaleString()+'</div><button class="pkg-order-btn pkg-btn-plum" data-package="'+p.id+'" '+(price===undefined?'disabled':'')+'>ORDER NOW</button><ul class="pkg-items">'+(p.package_contents||[]).map(item=>'<li>'+authEscape(item)+'</li>').join('')+'</ul></div>';
    }).join('')||'<div class="shop-no-results"><strong>No packages available right now.</strong><p>Browse individual pastries while we prepare more packages.</p><button class="btn-primary" type="button" onclick="navigate(\'shop\')">Browse pastries</button></div>';
    packageContainer.querySelectorAll('[data-package]').forEach(button => button.onclick = () => addPackageToCart(liveCatalog.find(p => p.id === button.dataset.package).name));
  }
  window.lexcCatalogState='ready';
  renderShop();updateCategoryCounts();renderCart();renderGallery();
 }catch(error){console.warn('Storefront could not load:',error);window.lexcCatalogState='error';renderShop();renderGallery();if(packageContainer)packageContainer.innerHTML='<div class="shop-no-results" role="alert"><strong>Packages could not load.</strong><p>Check your connection and try again.</p><button class="btn-primary" type="button" onclick="loadStorefront()">Try again</button></div>';document.getElementById('checkoutPaymentMethods').innerHTML='<p role="alert">Payment methods could not load. <button type="button" class="btn-outline" onclick="loadStorefront()">Try again</button></p>';}
}
function addPackageToCart(name){
 if(cart.some(item=>item.isTest))return showToast('Payment Test Product must be checked out separately.');
 const p=liveCatalog.find(p=>p.kind==='package'&&p.name===name),v=p?.product_variants.find(v=>v.is_active);
 if(!v)return showToast('This package is unavailable.');
 const item=cart.find(i=>i.variant_id===v.id);
 if(item){item.qty++;item.selected=true;}else cart.push({id:'pkg-'+p.id,product_id:p.id,variant_id:v.id,name:'Package: '+p.name,emoji:'🎁',sizeLabel:v.label,price:Number(v.price),qty:1,selected:true});
 renderCart();openCart();
}
async function renderDtSlots(){
 const list=document.getElementById('dtSlotsList'),date=dtSelectedDate;
 selectedSlotId=null;
 if(!date){list.setAttribute('aria-busy','false');list.textContent='Please select a date first.';return;}
 const bookingDay=dtAvailability?.get(date);
 if(!bookingDay||bookingDay.is_closed||bookingDay.remaining_slots<=0||!bookingDay.has_receiving_slot){list.setAttribute('aria-busy','false');list.innerHTML='<div class="dt-slot-summary"><strong>This date is unavailable</strong>Please choose an available date in the calendar.</div>';return;}
 list.setAttribute('aria-busy','true');
 list.innerHTML='<div class="dt-slot-skeleton" role="status" aria-label="Loading receiving times">'+Array.from({length:3},()=>'<span class="skel" aria-hidden="true"></span>').join('')+'</div>';
 try{
  const from=new Date(date+'T00:00:00+08:00'),to=new Date(from.getTime()+86400000);
  const slots=await LexcBackend.rpc('get_availability',{from_date:from.toISOString(),to_date:to.toISOString()});
  if(dtSelectedDate!==date)return;liveSlots=slots;
  const summary='<div class="dt-slot-summary"><strong>'+bookingDateLabel(date)+'</strong>'+bookingDay.remaining_slots+' of '+bookingDay.capacity+' booking slots remaining · Choose a receiving window.</div>';
  list.innerHTML=slots.length?summary+slots.map(s=>'<button type="button" class="dt-slot'+(s.remaining<=0?' full':'')+'" data-slot="'+s.id+'" '+(s.remaining<=0?'disabled':'')+'><span class="dt-slot-time">'+slotLabel(s)+'</span><span class="dt-slot-status '+(s.remaining>0?'avail':'full')+'">'+(s.remaining>0?'Available':'Fully booked')+'</span></button>').join(''):summary+'<div class="dt-slot-summary">No receiving window is available for this date. Please choose another available date.</div>';
  list.setAttribute('aria-busy','false');
  list.querySelectorAll('[data-slot]').forEach(button=>button.onclick=()=>{
   selectedSlotId=button.dataset.slot;dtSelectedSlot=slotLabel(liveSlots.find(s=>s.id===selectedSlotId));
   list.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===button));
   document.getElementById('dtConfirmBtn').disabled=false;
  });
 }catch(error){list.setAttribute('aria-busy','false');list.innerHTML='<div class="dt-slot-summary" role="alert"><strong>Availability could not load</strong><p>Please try this date again.</p><button type="button" class="btn-outline" onclick="renderDtSlots()">Try again</button></div>';console.warn('Availability failed:',error);}
}
function confirmDateTime(){
 if(!selectedSlotId||!dtSelectedDate)return;
 document.getElementById('coDate').value=dtSelectedDate;document.getElementById('coTime').value=dtSelectedSlot;
 document.getElementById('coDate').dataset.slotId=selectedSlotId;
 document.getElementById('coDateLabel').textContent=bookingDateLabel(dtSelectedDate);document.getElementById('coTimeLabel').textContent=dtSelectedSlot;closeDateTimeModal();
}
async function submitCheckout(){
 if(checkoutSaving)return;if(!currentUser){navigate('checkout');return;}
  const selectedItems=cartSelectedItems();
  if(!selectedItems.length)return showToast('Select at least one cart item to place an order.');
 const field=id=>document.getElementById(id).value.trim();
 if(!field('coDate')||!field('coTime'))return showToast('Choose a booking date and receiving time.');
 if(!selectedDelivery||!selectedPayment)return showToast('Choose fulfillment and a payment method.');
  if(cartIsPaymentTest()&&(selectedItems.some(item=>!item.isTest)||selectedDelivery!=='Pick-up'))return showToast('Payment Test Product must be checked out separately for pickup.');
  if(selectedItems.some(i=>!i.variant_id))return showToast('Your selected cart contains older items. Remove and re-add them from the updated catalog.');
  const fingerprint=JSON.stringify({cart:selectedItems,name:field('coName'),phone:field('coContact'),address:field('coAddress'),slot:document.getElementById('coDate').dataset.slotId,delivery:selectedDelivery,notes:field('coNotes'),payment:selectedPayment});
 let request=readAuthStorage(localStorage,'lexc_checkout_request',null);
 if(!request||request.fingerprint!==fingerprint)request={fingerprint,id:crypto.randomUUID()};
 localStorage.setItem('lexc_checkout_request',JSON.stringify(request));checkoutSaving=true;
 const submitButton=document.getElementById('placeOrderButton');submitButton.disabled=true;submitButton.textContent='Creating your order…';
 try{
  const latest = await LexcBackend.catalog();
  let priceChanged = false;
   for (const item of selectedItems) {
    const product = latest.find(product => product.id === item.product_id);
    const variant = product?.product_variants.find(variant => variant.id === item.variant_id && variant.is_active);
    if (!product || product.status !== 'active' || !variant) throw new Error(item.name + ' is no longer available. Please update your cart.');
    if (Number(item.price) !== Number(variant.price)) { item.price = Number(variant.price); priceChanged = true; }
  }
  if (priceChanged) {
    renderCart(); renderCheckout();
    showToast('A product price has changed. Review the updated total before placing your order.');
    return;
  }
  const selectedDate=field('coDate');
  const freshAvailability=await LexcBackend.rpc('get_customer_booking_dates',{from_date:selectedDate,to_date:selectedDate});
  const selectedDay=freshAvailability[0];
  if(!selectedDay||selectedDay.is_closed||selectedDay.remaining_slots<=0||!selectedDay.has_receiving_slot)throw new Error('This booking date is no longer available. Please choose another date.');
   const order=await LexcBackend.rpc('create_order',{payload:{request_id:request.id,name:field('coName'),phone:field('coContact'),address:field('coAddress'),notes:field('coNotes'),slot_id:document.getElementById('coDate').dataset.slotId,fulfillment:selectedDelivery==='Lalamove'?'lalamove':'pickup',payment_method:selectedPayment,items:selectedItems.map(i=>({variant_id:i.variant_id,qty:i.qty,customization:i.customization||null,reference_image_path:i.reference_image_path||null}))}});
   const orderedItems=new Set(selectedItems);
   cart=cart.filter(item=>!orderedItems.has(item));renderCart();localStorage.removeItem('lexc_checkout_request');
  try { await flushCustomerCart(); } catch (syncError) { console.warn('Order created, but cart sync needs retry:', syncError); }
  location.replace('payment/index.html?order='+encodeURIComponent(order.id));
 }catch(error){showToast(customerActionError(error,'We could not place your order. Please try again; your selected cart items are still saved.'));}finally{checkoutSaving=false;submitButton.disabled=false;submitButton.textContent='Place Order →';}
}
let customerShowCancelled=false;
async function cancelMyOrder(orderId,orderNumber){
 if(!confirm('Cancel order #'+orderNumber+'? This releases its booking date. The order stays in history for payment and seller records.'))return;
 const button=[...document.querySelectorAll('[data-cancel-order]')].find(item=>item.dataset.cancelOrder===orderId);
 if(button)button.disabled=true;
 try{
  await LexcBackend.rpc('cancel_my_order',{order_id:orderId});
  showToast('Order cancelled. Your booking slot is available again.');
   await showMyOrders();
 }catch(error){showToast(customerActionError(error,'Order cancellation could not be completed. Please try again.'));if(button)button.disabled=false;}
}
 async function showMyOrders(focusOrderId){
  if(!currentUser){openCart();return;}
  if(!document.getElementById('cartDrawer').classList.contains('open')){openCart(focusOrderId);return;}
  const container=document.getElementById('shoppingOrdersList');
 container.innerHTML='<div class="customer-orders-skeleton" role="status" aria-label="Loading your orders" aria-busy="true">'+Array.from({length:3},()=>'<article class="customer-order-card" aria-hidden="true"><span class="skel skel-line skel-line--short"></span><span class="skel skel-badge"></span><span class="skel skel-title"></span><span class="skel skel-line skel-line--long"></span><span class="skel skel-button"></span></article>').join('')+'</div>';
 try{
  const [orders,bookings,payments,methods]=await Promise.all([LexcBackend.orders(),LexcBackend.rpc('get_my_bookings',{}),LexcBackend.client.from('order_payment_attempts').select('*').order('created_at',{ascending:false}).then(LexcBackend.unwrap),LexcBackend.client.from('payment_methods').select('id,display_name').then(LexcBackend.unwrap)]);
   if(!document.getElementById('cartDrawer').classList.contains('open'))return;
  const mine=orders.filter(order => order.customer_id === currentUser.id), bookingByOrder=new Map(bookings.map(booking=>[booking.order_id,booking]));
  const cancelledCount=mine.filter(order=>order.status==='cancelled').length;
   const toggle=document.getElementById('drawerToggleCancelledOrders');
  toggle.hidden=!cancelledCount;
  toggle.textContent=customerShowCancelled?'Hide cancelled':'Show cancelled ('+cancelledCount+')';
  const visibleOrders=mine.filter(order=>customerShowCancelled||order.status!=='cancelled'||order.id===focusOrderId);
  const paymentByOrder=new Map();payments.forEach(payment=>{if(!paymentByOrder.has(payment.order_id))paymentByOrder.set(payment.order_id,payment);});
  const methodById=new Map(methods.map(method=>[method.id,method.display_name]));
  const typeLabel=value=>value==='lalamove'?'Delivery':'Pickup';
  const paymentLabel=value=>({unpaid:'Awaiting Payment',verification_pending:'Verification Pending',rejected:'Rejected',partially_paid:'Downpayment Paid',paid:'Fully Paid',failed:'Payment Failed',refunded:'Refunded'}[value]||String(value||'Unpaid').replaceAll('_',' '));
  const moneyValue=value=>value===null||value===undefined?'Pending delivery quote':'₱'+Number(value).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
  container.innerHTML=visibleOrders.length?visibleOrders.map(o=>{
   const b=bookingByOrder.get(o.id),p=paymentByOrder.get(o.id);
   const bookingStatus=String(b?.booking_status||o.status||'pending').toLowerCase();
   const products=(o.order_items||[]).map(i=>i.name_snapshot).filter(Boolean);
   const productSummary=products.length?authEscape(products[0])+(products.length>1?' +'+(products.length-1)+' more':''):'Order items';
   const bookingDate=b?.booking_date||(o.receiving_start?phDate(o.receiving_start):null);
   const schedule=[typeLabel(b?.fulfillment_method||o.fulfillment_method),bookingDate,b?.scheduled_start?String(b.scheduled_start).slice(0,5):null].filter(Boolean).join(' · ');
   const method=p?methodById.get(p.payment_method_id)||'Manual QR':'No payment submitted';
   const statusClass=['pending','cancelled','completed','ready'].includes(bookingStatus)?' is-'+bookingStatus:'';
   const details='<div class="customer-order-details"><span>Total: '+moneyValue(o.total_amount)+'</span><span>Required now: '+moneyValue(o.deposit_due)+'</span><span>Verified paid: '+moneyValue(o.amount_paid)+'</span><span>Remaining: '+moneyValue(o.total_amount===null?null:Number(o.total_amount)-Number(o.amount_paid||0))+'</span><span>Method: '+authEscape(method)+'</span><span>Products: '+authEscape((o.order_items||[]).map(i=>i.name_snapshot+' ×'+i.quantity).join(', ')||'Not available')+'</span>'+(p?.status==='rejected'?'<span>Payment issue: '+authEscape(p.rejection_reason||'Please resubmit')+'</span>':'')+'</div>';
   const canCancel=o.status==='pending'&&['unpaid','rejected'].includes(o.payment_status)&&Number(o.amount_paid||0)===0;
   return '<article class="customer-order-card'+(o.id===focusOrderId?' is-focused':'')+'" data-order-id="'+authEscape(o.id)+'"><div class="customer-order-top"><div><span class="customer-order-number">Order #'+authEscape(o.order_number)+'</span><span class="customer-order-date">'+authEscape(bookingDate||'Booking date pending')+'</span></div><span class="customer-order-status'+statusClass+'">'+authEscape(bookingStatus.replaceAll('_',' '))+'</span></div><p class="customer-order-product">'+productSummary+'</p><p class="customer-order-schedule">'+authEscape(schedule||'Schedule pending')+'</p><div class="customer-order-bottom"><div class="customer-order-payment"><strong>'+authEscape(paymentLabel(o.payment_status))+'</strong><span>'+authEscape(method)+' · '+moneyValue(o.total_amount)+'</span></div><div class="customer-order-actions"><a class="btn-primary" href="payment/index.html?order='+encodeURIComponent(o.id)+'">'+(o.payment_status==='rejected'?'Resubmit payment':'View order & payment')+'</a><a class="btn-outline" href="chat/?order='+encodeURIComponent(o.id)+'">Message LexC</a>'+(canCancel?'<button class="customer-order-cancel" type="button" data-cancel-order="'+authEscape(o.id)+'" data-order-number="'+authEscape(o.order_number)+'">Cancel order</button>':'')+(o.status==='completed'?'<button class="btn-outline customer-review-cta" data-review="'+authEscape(o.id)+'">Rate your treats</button>':'')+'</div></div><details class="customer-order-more"><summary>Order details</summary>'+details+'</details></article>';
  }).join(''):'<div class="customer-orders-state"><h2>'+(!mine.length?'No orders yet':'No active orders')+'</h2><p>'+(!mine.length?'Your bookings and payments will appear here after checkout.':'Cancelled orders are hidden. Use “Show cancelled” to see them.')+'</p><a class="btn-primary" href="#" onclick="event.preventDefault();navigate(\'shop\')">Browse products</a></div>';
  const focused=[...container.querySelectorAll('[data-order-id]')].find(item=>item.dataset.orderId===focusOrderId);
  focused?.scrollIntoView({block:'center'});
  container.querySelectorAll('[data-review]').forEach(button => button.onclick = () => showReviewForm(button.dataset.review));
  container.querySelectorAll('[data-cancel-order]').forEach(button=>button.onclick=()=>cancelMyOrder(button.dataset.cancelOrder,button.dataset.orderNumber));
  }catch(error){console.warn('Orders failed:',error);container.innerHTML='<div class="customer-orders-state"><h2>Orders could not load</h2><p>Your saved orders are still available. Check your connection and try again.</p><button class="btn-outline" type="button" onclick="showMyOrders()">Try again</button></div>';}
}
function openOrderFromReturnLink(){
 const target=new URLSearchParams(location.search).get('order');
 if(!currentUser||!target||!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(target))return;
 const url=new URL(location.href);url.searchParams.delete('order');history.replaceState(null,'',url);
 showMyOrders(target);
}
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
  container.innerHTML=Array.from({length:3},()=>'<article class="t-card t-card-skeleton" aria-hidden="true"><span class="skel skel-line skel-line--long"></span><span class="skel skel-line"></span><div class="skel-list-row"><span class="skel skel-circle"></span><span class="skel skel-stack"><span class="skel skel-line"></span><span class="skel skel-line skel-line--short"></span></span></div></article>').join('');
  container.setAttribute('aria-busy','true');
  try {
    const reviews = await LexcBackend.rpc('get_public_reviews', {});
    container.innerHTML = reviews.length ? reviews.map(review =>
      '<article class="t-card"><div class="t-quote">"</div><p class="t-text">' +
      authEscape(review.review_text) + '</p><div class="t-author"><div class="t-avatar">⭐</div><div><div class="t-name">' +
      authEscape(review.public_display_name) + '</div><div class="t-role">' +
      review.rating + '/5 · Verified order</div></div></div></article>'
    ).join('') : '<p>No published reviews yet. Customers can review completed orders from My Orders.</p>';
  } catch (error) {console.warn('Customer reviews could not load:',error);container.innerHTML='<div class="shop-no-results" role="alert"><strong>Reviews could not load.</strong><p>Check your connection and try again.</p><button type="button" class="btn-outline" onclick="loadPublicReviews()">Try again</button></div>';}
  finally{container.setAttribute('aria-busy','false');}
}
loadStorefront();
loadPublicReviews();
