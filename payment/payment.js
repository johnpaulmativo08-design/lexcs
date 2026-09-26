const backend=window.LexcBackend;
const root=document.getElementById('payment-content');
const feedback=document.getElementById('feedback');
const orderId=new URLSearchParams(location.search).get('order');
const ordersURL='../?order='+encodeURIComponent(orderId||'');
document.getElementById('back-to-orders').href=ordersURL;
const e=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+Number(value??0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const when=value=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'});
const statusName={unpaid:'Awaiting Payment',awaiting_payment:'Awaiting Payment',verification_pending:'Verification Pending',partially_paid:'Downpayment Paid',paid:'Paid',rejected:'Rejected',refunded:'Refunded'};
let user,order,methods=[],attempts=[];

function say(text,error=false){feedback.textContent=text;feedback.hidden=!text;feedback.classList.toggle('error',error);}
function methodFor(attempt){return methods.find(method=>method.id===attempt.payment_method_id);}
async function validImage(file){
  if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>5242880)
    throw new Error('Only JPG, PNG, or WEBP files up to 5 MB are accepted.');
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  const png=[137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte);
  const webp=String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
  if(!((file.type==='image/jpeg'&&jpeg)||(file.type==='image/png'&&png)||(file.type==='image/webp'&&webp)))
    throw new Error('The selected file is not a valid JPG, PNG, or WEBP image.');
}
function renderLogin(){
  root.innerHTML='<section class="card state-card access-card"><h2>Sign in to continue payment</h2><p>Use the same LexC customer account you used at checkout. Your saved order will still be here.</p><form id="pay-login"><label class="field">Email<input type="email" name="email" required autocomplete="email"></label><label class="field">Password<input type="password" name="password" required autocomplete="current-password"></label><button>Sign in</button></form><a class="text-link" href="'+e(ordersURL)+'">Back to My Orders</a></section>';
  root.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    try{user=await backend.signIn(form.elements.email.value,form.elements.password.value);await load();}
    catch(error){say(error.message,true);}finally{button.disabled=false;}
  };
}
async function load(){
  if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(orderId||'')){root.innerHTML='<section class="card state-card"><h2>No order selected</h2><p>Open payment from My Orders to continue with your saved order.</p><a class="button" href="../">Go to My Orders</a></section>';return;}
  user=await backend.identity();if(!user){renderLogin();return;}
  try{
    const [savedOrder,savedMethods,savedAttempts]=await Promise.all([
      backend.client.from('orders').select('*,order_items(*)').eq('id',orderId).single().then(backend.unwrap),
      backend.client.from('payment_methods').select('*').eq('active',true).then(backend.unwrap),
      backend.client.from('order_payment_attempts').select('*').eq('order_id',orderId).order('created_at',{ascending:false}).then(backend.unwrap)
    ]);
    if(savedOrder.customer_id!==user.id)throw new Error('This order does not belong to your account.');
    order=savedOrder;methods=savedMethods;attempts=savedAttempts;render();
  }catch(error){root.innerHTML='<section class="card state-card"><h2>We could not load this order</h2><p class="error">'+e(error.message)+'</p><div class="state-actions"><button type="button" id="retry-payment">Try again</button><a class="button secondary" href="'+e(ordersURL)+'">My Orders</a></div></section>';root.querySelector('#retry-payment').onclick=load;}
}
function render(){
  const active=attempts.find(attempt=>['awaiting_payment','verification_pending'].includes(attempt.status));
  const last=attempts[0];
  const remaining=order.total_amount===null?null:Math.max(0,Number(order.total_amount)-Number(order.amount_paid||0));
  const status=order.payment_status;
  const due=order.status==='cancelled'||remaining===0?0:order.total_amount===null?null:active?.status==='verification_pending'?null:active?.status==='awaiting_payment'?Number(active.amount):Number(order.amount_paid||0)<Number(order.deposit_due)?Math.max(0,Number(order.deposit_due)-Number(order.amount_paid||0)):remaining;
  const dueLabel=order.status==='cancelled'?'Order cancelled':order.total_amount===null?'Waiting for quote':active?.status==='verification_pending'?'Proof under review':remaining===0?'Payment verified':'Amount due now';
  const dueValue=due===null?active?.status==='verification_pending'?'Under review':'To be confirmed':due===0?'No payment due':money(due);
  const pageTitle=document.querySelector('main>h1');
  pageTitle.textContent=due!==null&&due>0&&order.status!=='cancelled'&&active?.status!=='verification_pending'?'Pay '+money(due):'Order payment';
  const orderStrip='<section class="payment-strip" aria-label="Current order payment"><div class="strip-order"><small>ORDER #'+e(order.order_number)+'</small><span class="status '+e(status)+'">'+e(statusName[status]||status)+'</span></div><div class="strip-amount"><small>'+e(dueLabel)+'</small><strong>'+e(dueValue)+'</strong></div><a href="'+e(ordersURL)+'">My Orders <span aria-hidden="true">→</span></a><a href="../chat/?order='+encodeURIComponent(order.id)+'">Chat about this order</a></section>';
  const orderSummary='<details class="card order-card"><summary><span>Order details & balance</span><span aria-hidden="true">⌄</span></summary><div class="order-detail-body"><p class="order-meta">'+e(when(order.created_at))+' · '+e(order.fulfillment_method==='pickup'?'Pickup':'Delivery')+'</p>'+ 
    order.order_items.map(item=>'<div class="summary-row"><span>'+e(item.name_snapshot)+' · '+e(item.variant_label_snapshot)+' ×'+item.quantity+'</span><strong>'+money(item.line_total)+'</strong></div>').join('')+
    '<div class="summary-row"><span>Order total</span><strong>'+(order.total_amount===null?'Pending delivery quote':money(order.total_amount))+'</strong></div>'+
    '<div class="summary-row"><span>Required '+(Number(order.deposit_rate)===1?'payment':'downpayment')+'</span><strong>'+(order.deposit_due===null?'Pending delivery quote':money(order.deposit_due))+'</strong></div>'+
    '<div class="summary-row"><span>Verified amount paid</span><strong>'+money(order.amount_paid)+'</strong></div>'+
    '<div class="summary-row total"><span>Remaining balance</span><strong>'+(remaining===null?'Pending delivery quote':money(remaining))+'</strong></div>'+
    '<div class="actions"><button class="button secondary" type="button" id="refresh-payment">Refresh status</button></div></div></details>';
  let paymentArea='';
  if(order.status==='cancelled')paymentArea='<section class="card state-card"><span class="state-icon cancelled-icon" aria-hidden="true">×</span><h2>Order cancelled</h2><p>Do not transfer money for this order. If you already transferred, contact LexC’s with your bank receipt.</p><a class="button" href="'+e(ordersURL)+'">Return to My Orders</a></section>';
  else if(order.total_amount===null)paymentArea='<section class="card state-card"><span class="state-icon pending-icon" aria-hidden="true">⋯</span><h2>Waiting for your delivery quote</h2><p>Your order and booking are saved. The exact payable amount will appear here after LexC’s sets the delivery fee. Please do not transfer yet.</p><button class="button" type="button" id="state-refresh">Check for quote</button><a class="text-link" href="'+e(ordersURL)+'">Return to My Orders</a></section>';
  else if(active?.status==='verification_pending')paymentArea='<section class="card state-card proof-success"><span class="state-icon pending-icon" aria-hidden="true">✓</span><h2>Proof received</h2><span class="status verification_pending">Awaiting Admin verification</span><p>We saved your proof for '+money(active.amount)+' sent through '+e(methodFor(active)?.display_name||'manual QR')+'. Keep your bank receipt. Please do not transfer again while LexC’s checks it.</p><p class="note">Proof submission is not payment confirmation. Admin must match it to the actual incoming transfer.</p><a class="button" href="'+e(ordersURL)+'">View My Orders</a><button class="button secondary" type="button" id="state-refresh">Refresh status</button></section>';
  else if(active?.status==='awaiting_payment')paymentArea=paymentForm(active);
  else if(remaining===0)paymentArea='<section class="card state-card"><span class="state-icon paid-icon" aria-hidden="true">✓</span><span class="eyebrow">PAYMENT COMPLETE</span><h2>Payment verified</h2><span class="status paid">Paid</span><p>LexC’s verified '+money(order.amount_paid)+' received for this order.</p><a class="button" href="'+e(ordersURL)+'">View My Orders</a></section>';
  else paymentArea=methodChoice(last);
  root.innerHTML=orderStrip+'<div class="layout"><div class="payment-main">'+paymentArea+history()+'</div>'+orderSummary+'</div>';
  const step=order.status==='cancelled'||order.total_amount===null?0:active?.status==='verification_pending'?3:active?.status==='awaiting_payment'?2:remaining===0?3:1;
  root.dataset.stage=String(step);
  document.querySelectorAll('[data-step]').forEach(item=>{
    const number=Number(item.dataset.step);
    item.classList.toggle('current',number===step);
    item.classList.toggle('done',number<step||(!active&&remaining===0));
    if(number===step)item.setAttribute('aria-current','step');
    else item.removeAttribute('aria-current');
  });
  root.querySelector('#refresh-payment')?.addEventListener('click',()=>load());
  root.querySelector('#state-refresh')?.addEventListener('click',()=>load());
  root.querySelector('#start-payment')?.addEventListener('click',startPayment);
  root.querySelector('#proof-form')?.addEventListener('submit',submitPayment);
  root.querySelector('#copy-amount')?.addEventListener('click',async()=>{
    try{await navigator.clipboard.writeText(Number(active.amount).toFixed(2));say('Amount copied: '+money(active.amount)+'. Check it in your banking app before sending.');}
    catch{say('Could not copy automatically. Enter '+money(active.amount)+' in your banking app.',true);}
  });
  root.querySelector('#proof-form input[type=file]')?.addEventListener('change',event=>{
    const name=root.querySelector('#selected-proof');
    if(name)name.textContent=event.currentTarget.files[0]?.name||'No receipt selected';
  });
  root.querySelectorAll('[data-proof]').forEach(button=>button.onclick=async()=>{
    button.disabled=true;
    try{const url=await backend.privateImage('payment-proofs',button.dataset.proof);window.open(url,'_blank','noopener');}
    catch(error){say('Unable to open private proof: '+error.message,true);}finally{button.disabled=false;}
  });
}
function methodChoice(last){
  if(order.status==='cancelled')return '<section class="card"><h2>Order cancelled</h2><p>Payment cannot be started for a cancelled order.</p></section>';
  if(!methods.length)return '<section class="card state-card"><h2>QR payment is temporarily unavailable</h2><p>Please return later. Your order remains saved; do not send money to an account not shown here.</p><a class="button" href="'+e(ordersURL)+'">View My Orders</a></section>';
  const choices=methods.map((method,index)=>'<label class="method-choice"><input type="radio" name="method" value="'+e(method.code)+'" '+((order.requested_payment_method===method.code||(!methods.some(m=>m.code===order.requested_payment_method)&&index===0))?'checked':'')+'><span class="method-mark" aria-hidden="true">'+e(method.display_name.slice(0,1))+'</span><span><strong>'+e(method.display_name)+'</strong><small>'+e(method.account_name)+' · '+e(method.masked_account)+'</small></span></label>').join('');
  return '<section class="card choice-card"><span class="eyebrow">PAYMENT ACCOUNT</span><h2>'+(last?.status==='rejected'?'Choose an account to try again':'Where would you like to pay?')+'</h2>'+(last?.status==='rejected'?'<p class="error">Your previous proof was not accepted: '+e(last.rejection_reason||'Please check your transfer details and try again.')+'</p>':'')+'<p class="section-intro">Choose the account first. The next screen shows its QR, recipient, and exact amount.</p><div class="method-list">'+choices+'</div><button id="start-payment" type="button">Show payment QR →</button><p class="fine-print">This does not send money or mark your order paid.</p></section>';
}
function paymentForm(attempt){
  const method=methodFor(attempt),qr=method?.qr_image_path||'';
  const isOnePesoExample=Number(attempt.amount)===1&&Number(order.deposit_rate)===1&&order.order_items.some(item=>item.name_snapshot?.startsWith('Product A'));
  return '<section class="card payment-card"><span class="eyebrow">SEND THE TRANSFER</span><div class="compact-payment-heading"><h2>'+e(method?.display_name||'Manual payment')+' QR</h2><span>Send '+money(attempt.amount)+'</span></div>'+
    (isOnePesoExample?'<p class="test-note">This is a real ₱1 payment test. No physical Product A will be delivered.</p>':'')+
    '<div class="compact-payment-core"><div class="qr-panel"><img class="qr-image" src="../'+e(qr)+'" alt="'+e(method?.display_name||'Manual payment')+' receiving QR"><div class="qr-actions"><a class="button secondary" href="../'+e(qr)+'" download="lexc-'+e(method?.code||'payment')+'-qr.'+(qr.toLowerCase().endsWith('.png')?'png':'jpg')+'">Save QR</a><a class="button secondary" href="../'+e(qr)+'" target="_blank" rel="noopener">View larger</a></div></div><div class="compact-payment-info"><div class="pay-amount"><span>Send exactly</span><strong>'+money(attempt.amount)+'</strong><button class="button secondary" id="copy-amount" type="button">Copy amount</button></div><div class="recipient"><span>RECIPIENT</span><strong>'+e(method?.account_name)+'</strong><small>'+e(method?.masked_account)+'</small></div><p class="compact-qr-note">Check the recipient and enter the amount in your banking app. A fixed QR may not include it; transfer fees are separate.</p></div></div>'+ 
    '<p class="same-phone"><strong>Using one phone?</strong> Save the QR, then import it in your bank or wallet app if supported. Otherwise scan from another screen.</p>'+ 
    '<details class="proof-disclosure" id="proof-disclosure"><summary><span>Already paid? Upload receipt <small>Only after your bank confirms the transfer</small></span><span aria-hidden="true">⌄</span></summary><div class="proof-intro">Use the transaction reference from your banking app—not your LexC order number.</div><form id="proof-form"><label class="field">Bank transaction reference<input type="text" name="reference" minlength="6" maxlength="100" pattern="[A-Za-z0-9 _./-]{6,100}" required autocomplete="off" placeholder="Shown on your successful transfer"></label><label class="field">Transfer receipt <small>JPG, PNG, or WEBP · up to 5 MB</small><input type="file" name="proof" accept="image/jpeg,image/png,image/webp" required><span id="selected-proof" class="selected-proof">No receipt selected</span></label><button type="submit">Send proof for verification</button></form><p class="fine-print">Proof submission does not mark the order paid. Admin verifies the incoming transfer. Do not send another transfer while verification is pending.</p></details></section>';
}
function history(){
  if(!attempts.length)return '';
  return '<details class="card history"><summary>Payment history <span aria-hidden="true">⌄</span></summary><div class="history-body">'+attempts.map(attempt=>'<div class="attempt"><strong>'+e(when(attempt.created_at))+' · '+money(attempt.amount)+'</strong> <span class="status '+e(attempt.status)+'">'+e(statusName[attempt.status]||attempt.status)+'</span><br>'+e(methodFor(attempt)?.display_name||'Manual QR')+(attempt.transaction_reference?'<br>Reference: '+e(attempt.transaction_reference):'')+(attempt.rejection_reason?'<br>Reason: '+e(attempt.rejection_reason):'')+(attempt.proof_storage_path?'<br><button type="button" class="button secondary" data-proof="'+e(attempt.proof_storage_path)+'">View my proof</button>':'')+'</div>').join('')+'</div></details>';
}
async function startPayment(event){
  const button=event.currentTarget,method=root.querySelector('[name=method]:checked')?.value;
  if(!method)return say('Choose a payment method.',true);
  button.disabled=true;button.textContent='Preparing payment…';
  try{await backend.rpc('start_order_payment',{target_order:order.id,method_code:method});say('Payment prepared. Check the recipient before transferring.');await load();}
  catch(error){say(error.message,true);button.disabled=false;button.textContent='Show payment QR →';}
}
async function submitPayment(event){
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');
  const attempt=attempts.find(item=>item.status==='awaiting_payment');if(!attempt)return say('Payment attempt is no longer available.',true);
  button.disabled=true;button.textContent='Checking and uploading proof…';
  try{
    const file=form.elements.proof.files[0];await validImage(file);
    const reference=form.elements.reference.value.trim();
    if(!/^[A-Za-z0-9 _./-]{6,100}$/.test(reference))throw new Error('Enter a valid bank transaction reference.');
    const uploadBody=new FormData();uploadBody.append('paymentId',attempt.id);uploadBody.append('file',file);
    const {data:uploaded,error:uploadError}=await backend.client.functions.invoke('upload-payment-proof',{body:uploadBody});
    if(uploadError||!uploaded?.path)throw new Error(uploaded?.error||'Proof upload failed. Please try again.');
    const path=uploaded.path;
    await backend.rpc('submit_order_payment',{target_payment:attempt.id,reference_number:reference,proof_path:path});
    say('Payment details submitted. Waiting for seller verification.');await load();
  }catch(error){say(error.message,true);button.disabled=false;button.textContent='Send proof for verification';}
}
load().catch(error=>{root.innerHTML='<section class="card state-card"><h2>Payment could not load</h2><p class="error">'+e(error.message)+'</p><a class="button" href="'+e(ordersURL)+'">Back to My Orders</a></section>';});
