const db=window.LexcBackend;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=value=>new Date(value).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'});
const short=value=>String(value||'').slice(0,8);

// Shared operations for the full chat page and its compact Messenger presentation.
// Both surfaces read and write the same Supabase conversations and messages.
export async function readChatThread(conversationId){
  const recent=await db.client.from('chat_messages').select('*').eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(200).then(db.unwrap);
  return recent.reverse();
}
export async function markChatRead(rows,{admin}){
  const ids=rows.filter(m=>!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer')).map(m=>m.id);
  if(!ids.length)return;
  const {error}=await db.client.from('chat_messages').update({read_at:new Date().toISOString()}).in('id',ids);
  if(error)throw error;
}
export async function sendChatMessage({conversationId,userId,admin,body}){
  return db.client.from('chat_messages').insert({conversation_id:conversationId,sender_id:userId,sender_type:admin?'admin':'customer',body:body.trim()}).then(db.unwrap);
}
export async function ensureCustomerChat({userId,orderId=null}){
  const query=()=>orderId?db.client.from('chat_conversations').select('*').eq('customer_id',userId).eq('order_id',orderId).maybeSingle():db.client.from('chat_conversations').select('*').eq('customer_id',userId).is('order_id',null).maybeSingle();
  const existing=await query().then(db.unwrap);
  if(existing)return existing;
  const result=await db.client.from('chat_conversations').insert({customer_id:userId,...(orderId?{order_id:orderId}:{})}).select().single();
  if(!result.error)return result.data;
  if(result.error.code==='23505')return query().then(db.unwrap);
  throw result.error;
}
// ---- Bento design card (posted by the database after a successful order, phase 33) ----------------
// Each line shows the angled + top-view pictures (private storage, short-lived signed links),
// the summary and price, and an "Open in 3D" link that rebuilds the exact design in the designer.
const DESIGN_KEYS=['frosting_color','border','accents','bow_color','message','lettering','lettering_color','topper','topper_text','layout','drip_color','font'];
const siteIndex=new URL('../index.html',import.meta.url).href;
const CUPCAKE_KEYS=['flavor','pattern','finishes','theme','theme_note'];
const DONUT_KEYS=['style','flavors','pattern','glazes','finishes','sprinkles','sprinkle_colors','theme','theme_note','message','message_text','message_color'];
const partOf=p=>p&&{style:p.style,colors:p.colors};
function designLink(line){
  const kind=line.design?.designer,cupcake=kind==='cupcake',d={};
  for(const key of cupcake?CUPCAKE_KEYS:kind==='donut'||kind==='cakepop'?DONUT_KEYS:DESIGN_KEYS)if(line.design?.[key]!=null)d[key]=line.design[key];
  if(cupcake){d.a=partOf(line.design.a);if(line.design.b)d.b=partOf(line.design.b);}
  const bytes=new TextEncoder().encode(JSON.stringify({v:line.variant_id,d}));
  const code=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return siteIndex+(cupcake?'?cupcake=':kind==='donut'?'?donut=':kind==='cakepop'?'?cakepop=':'?design=')+code;
}
// The order summary the database posts into an order's chat when the customer orders (phase 47).
const phWhen=(value,options)=>new Date(value).toLocaleString('en-PH',{timeZone:'Asia/Manila',...options});
// The card starts closed; remember which ones the reader opened so a chat refresh does not close them again.
const openOrderCards=new Set();
// inside admin it opens the order in Orders; for customers it opens that order's payment page
const paymentPage=new URL('../payment/index.html',import.meta.url).href;
function orderLink(orderId){
  if(!orderId)return '';
  const admin=/\/admin\//.test(location.pathname);
  return '<a class="order-card-link" href="'+escapeHtml(admin?'#orders/detail/'+orderId:paymentPage+'?order='+encodeURIComponent(orderId))+'">'+(admin?'Open full order':'View order & payment')+'</a>';
}
document.addEventListener('toggle',event=>{const card=event.target;if(!card.matches?.('details.order-card'))return;card.open?openOrderCards.add(card.dataset.order):openOrderCards.delete(card.dataset.order);},true);
function orderSummaryHTML(s,orderId){
  const row=(label,value,strong)=>'<div class="order-card-row'+(strong?' is-total':'')+'"><span>'+label+'</span>'+(strong?'<strong>':'<b>')+value+(strong?'</strong>':'</b>')+'</div>';
  const items=(s.items||[]).map(i=>'<li><div><strong>'+escapeHtml(i.name)+'</strong><span>'+escapeHtml(i.option||'')+(Number(i.qty)>1?' × '+Number(i.qty):'')+'</span>'+(i.details?'<small>'+escapeHtml(i.details)+'</small>':'')+'</div><b>'+money(i.total)+'</b></li>').join('');
  const delivery=s.fulfillment==='lalamove';
  const fee=!delivery?'':s.delivery_fee_status==='quoted'?money(s.delivery_fee):'LexC’s will set it';
  const day=s.receiving_start?phWhen(s.receiving_start,{weekday:'short',month:'short',day:'numeric',year:'numeric'}):'';
  const hours=s.receiving_start&&s.receiving_end?phWhen(s.receiving_start,{hour:'numeric',minute:'2-digit'})+' – '+phWhen(s.receiving_end,{hour:'numeric',minute:'2-digit'}):'';
  const count=(s.items||[]).reduce((sum,i)=>sum+Number(i.qty||0),0),key=String(s.order_number);
  return '<details class="order-card" data-order="'+escapeHtml(key)+'"'+(openOrderCards.has(key)?' open':'')+'><summary><span class="order-card-head"><strong>Order #'+escapeHtml(s.order_number)+'</strong><small>'+count+' item'+(count===1?'':'s')+(s.ordered_at?' · '+escapeHtml(phWhen(s.ordered_at,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})):'')+'</small></span><b>'+(s.total===null||s.total===undefined?'Total after delivery fee':money(s.total))+'</b><span class="order-card-toggle" aria-hidden="true"></span></summary><div class="order-card-body">'+
    '<ul class="order-card-items">'+items+'</ul>'+
    '<div class="order-card-sums">'+row('Items',money(s.items_subtotal))+(Number(s.customization_total)>0?row('Design options',money(s.customization_total)):'')+(delivery?row('Delivery fee',fee):'')+
    row('Total',s.total===null||s.total===undefined?'After the delivery fee':money(s.total),true)+(s.deposit_due!==null&&s.deposit_due!==undefined&&Number(s.deposit_rate)<1?row('Downpayment ('+Math.round(Number(s.deposit_rate)*100)+'%)',money(s.deposit_due)):'')+'</div>'+
    '<div class="order-card-meta"><p><span>'+(delivery?'Delivery (Lalamove)':'Pickup')+'</span>'+escapeHtml([day,hours].filter(Boolean).join(' · '))+'</p>'+
    '<p><span>Contact</span>'+escapeHtml([s.name,s.phone].filter(Boolean).join(' · '))+'</p>'+(delivery&&s.address?'<p><span>Address</span>'+escapeHtml(s.address)+'</p>':'')+(s.notes?'<p><span>Notes</span>'+escapeHtml(s.notes)+'</p>':'')+'</div>'+orderLink(orderId)+'</div></details>';
}
export function designCardHTML(m){
  if(m.message_type==='order_summary'&&m.attachments&&typeof m.attachments==='object')return orderSummaryHTML(m.attachments,m.order_id);
  if(m.message_type!=='design_card'||!Array.isArray(m.attachments))return '';
  const picture=(path,label)=>path?'<button type="button" class="design-card-pic" data-design-img="'+escapeHtml(path)+'" aria-label="Open '+label+' picture full size"><img alt="'+label+'" hidden><span class="skel" aria-hidden="true"></span><small>'+label+'</small></button>':'';
  return '<div class="design-card">'+m.attachments.map(line=>'<section class="design-card-line"><div class="design-card-pics">'+picture(line.angle_path,['cupcake','donut','cakepop'].includes(line.design?.designer)?'Box picture':'Angled view')+picture(line.top_path,'Top view')+'</div>'+
    '<strong>'+escapeHtml(line.name)+(Number(line.qty)>1?' × '+Number(line.qty):'')+'</strong><p>'+escapeHtml(line.summary||'')+'</p><div class="design-card-foot"><b>'+money(line.unit_price)+(['cupcake','donut','cakepop'].includes(line.design?.designer)?' per box':' per cake')+'</b><a href="'+escapeHtml(designLink(line))+'" target="_blank" rel="noopener">'+(['cupcake','donut','cakepop'].includes(line.design?.designer)?'Open design ↗':'Open in 3D ↗')+'</a></div></section>').join('')+'</div>';
}
const signedPictures=new Map();
export function hydrateDesignImages(root){
  root.querySelectorAll('[data-design-img]').forEach(async button=>{
    const path=button.dataset.designImg,img=button.querySelector('img');if(!img||img.getAttribute('src'))return;
    try{
      let cached=signedPictures.get(path);
      if(!cached||Date.now()-cached.at>45000){cached={at:Date.now(),url:db.privateImage('customer-references',path)};signedPictures.set(path,cached);}
      img.onload=()=>{img.hidden=false;button.querySelector('.skel')?.remove();};
      img.src=await cached.url;
      button.onclick=()=>window.open(img.src,'_blank','noopener');
    }catch(error){signedPictures.delete(path);button.querySelector('.skel')?.remove();button.querySelector('small').textContent='Picture unavailable';}
  });
}
export function subscribeChatChanges(onChange,onStatus=()=>{}){
  const channel=db.client.channel('lexc-chat-'+crypto.randomUUID())
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_conversations'},onChange)
    .on('postgres_changes',{event:'*',schema:'public',table:'chat_messages'},onChange)
    .subscribe(onStatus);
  return ()=>db.client.removeChannel(channel);
}

export async function mountChat(root,{admin=false,orderId=null}={}){
  let user,conversations=[],selected=null,messages=[],orders=[],orderItems=[],products=[],payments=[],profiles=[],inboxMessages=[],search='',filter='all',fallbackTimer,mobileListOpen=false;
  const line=(size='')=>'<span class="skel skel-line '+(size==='wide'?'skel-line--long':size==='short'?'skel-line--short':'')+'"></span>';
  const threadSkeleton=()=>'<div class="chat-stream chat-stream-loading" aria-busy="true"><div aria-hidden="true" class="chat-skeleton-messages"><div class="chat-skeleton-bubble">'+line('wide')+line('medium')+'</div><div class="chat-skeleton-bubble mine">'+line('medium')+line('short')+'</div><div class="chat-skeleton-bubble">'+line('wide')+line('short')+'</div></div></div>';
  const pageSkeleton=()=>'<div class="chat-workspace chat-workspace-loading" aria-busy="true"><aside class="chat-inbox"><header><div><h1>'+(admin?'Customer conversations':'Messages')+'</h1><p>'+(admin?'Customer support and order conversations':'Chat with LexC’s Snacktime')+'</p></div></header><div class="chat-search">'+line('wide')+'</div><div class="chat-filters">'+line('medium')+line('short')+'</div><div class="chat-rows" aria-hidden="true">'+Array.from({length:5},()=>'<div class="chat-skeleton-row"><span class="skel skel-circle"></span><span>'+line('medium')+line('wide')+line('short')+'</span></div>').join('')+'</div></aside><section class="chat-thread"><header><div>'+line('medium')+line('short')+'</div></header>'+threadSkeleton()+'<div class="chat-compose" aria-hidden="true">'+line('wide')+'<span class="skel skel-button"></span></div></section><aside class="chat-context"><h2>Conversation details</h2><div aria-hidden="true" class="chat-skeleton-context">'+Array.from({length:6},()=>line('wide')+line('short')).join('')+'</div></aside></div>';
  root.innerHTML=pageSkeleton();
  try{user=await db.identity();if(!user)throw new Error('Sign in to use LexC chat.');if(admin&&user.role!=='admin')throw new Error('Admin access required.');}
  catch(error){root.innerHTML='<div class="chat-empty" role="alert">'+escapeHtml(error.message)+' <a href="'+(admin?'login.html':'../?return=chat')+'">Sign in</a></div>';return;}
  const refresh=async(preserve=true)=>{
    const draft=root.querySelector('#chat-text')?.value||'';
    const [threadRows,orderRows,itemRows,productRows,paymentRows,messageRows,profileRows]=await Promise.all([
      db.client.from('chat_conversations').select('*').order('updated_at',{ascending:false}).limit(150).then(db.unwrap),
      db.client.from('orders').select('id,order_number,customer_name,customer_id,status,payment_status,total_amount,deposit_due,amount_paid,fulfillment_method,receiving_start').order('created_at',{ascending:false}).limit(admin?150:50).then(db.unwrap),
      db.client.from('order_items').select('order_id,line_number,product_id,name_snapshot,variant_label_snapshot,quantity,line_total').order('line_number',{ascending:true}).limit(admin?500:200).then(db.unwrap),
      db.client.from('products').select('id,image_path').limit(150).then(db.unwrap),
      db.client.from('order_payment_attempts').select('id,order_id,amount,status,transaction_reference,proof_storage_path,submitted_at,rejection_reason').order('created_at',{ascending:false}).limit(admin?150:50).then(db.unwrap),
      db.client.from('chat_messages').select('conversation_id,sender_type,body,read_at,created_at').order('created_at',{ascending:false}).limit(500).then(db.unwrap),
      db.client.from('profiles').select('id,full_name,phone').limit(admin?500:1).then(db.unwrap)
    ]);
    conversations=threadRows;orders=orderRows;orderItems=itemRows;products=productRows;payments=paymentRows;inboxMessages=messageRows;profiles=profileRows;
    // Conversations can belong to orders older than the latest ones loaded above: fetch those orders and
    // their payments too, so every chat shows its order number, status and payment.
    const missing=[...new Set([...conversations.map(c=>c.order_id),orderId].filter(id=>id&&!orders.some(o=>o.id===id)))];
    if(missing.length){
      const [more,morePayments]=await Promise.all([
        db.client.from('orders').select('id,order_number,customer_name,customer_id,status,payment_status,total_amount,deposit_due,amount_paid,fulfillment_method,receiving_start').in('id',missing).then(db.unwrap),
        db.client.from('order_payment_attempts').select('id,order_id,amount,status,transaction_reference,proof_storage_path,submitted_at,rejection_reason').in('order_id',missing).order('created_at',{ascending:false}).then(db.unwrap)]);
      orders.push(...more);payments.push(...morePayments.filter(x=>!payments.some(y=>y.id===x.id)));
    }
    const startGeneral=!admin&&new URLSearchParams(location.search).has('new');
    if(startGeneral){history.replaceState(null,'',location.pathname);}
    if(!preserve||!selected||!conversations.some(c=>c.id===selected.id))selected=orderId?(conversations.find(c=>c.order_id===orderId)||null):startGeneral?(conversations.find(c=>!c.order_id)||null):(conversations.find(c=>!c.order_id)||conversations[0]||null);
    if(selected)await loadMessages();else messages=[];
    draw();
    const input=root.querySelector('#chat-text');if(input)input.value=draft;
  };
  async function loadMessages(){
    const thread=selected;
    const [rows]=await Promise.all([readChatThread(thread.id),thread.order_id&&!orderItems.some(item=>item.order_id===thread.order_id)
      ?db.client.from('order_items').select('order_id,line_number,product_id,name_snapshot,variant_label_snapshot,quantity,line_total').eq('order_id',thread.order_id).order('line_number',{ascending:true}).then(db.unwrap).then(items=>orderItems.push(...items))
      :null]);
    messages=rows;
    try{await markChatRead(messages,{admin});}catch(error){console.warn('Chat read state could not update:',error.message);}
    const now=new Date().toISOString();
    inboxMessages.forEach(m=>{if(m.conversation_id===thread.id&&!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer'))m.read_at=now;});
  }
  function title(c){const o=orders.find(row=>row.id===c.order_id);return o?`Order #${o.order_number}`:admin?profiles.find(p=>p.id===c.customer_id)?.full_name||'General inquiry':'LexC Assistant';}
  // the Details panel closes with its × button, the Esc key, or a click anywhere outside it
  function closeDetails(){root.querySelector('.chat-workspace')?.classList.remove('show-context');}
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.querySelector('.chat-workspace.show-context'))closeDetails();});
  root.addEventListener('click',event=>{if(root.querySelector('.chat-workspace.show-context')&&!event.target.closest('.chat-context'))closeDetails();});
  // Admin can confirm or reject a payment proof right on its chat card, on every screen size.
  const reviewDrafts=new Map();
  function proofReview(p){
    if(!admin||p.status!=='verification_pending')return '';
    const id='pay-reason-'+p.id;
    return '<form class="chat-proof-review" data-pay-review="'+escapeHtml(p.id)+'"><p class="chat-proof-hint">Check that '+money(p.amount)+' actually arrived in the bank or wallet before confirming.</p><label for="'+id+'">Bank confirmation or reason</label><input id="'+id+'" name="reason" maxlength="1000" autocomplete="off" placeholder="e.g. Received 2:04 PM, ref 34688789" value="'+escapeHtml(reviewDrafts.get(p.id)||'')+'"><div class="chat-proof-actions"><button type="submit" class="is-confirm" data-decision="paid">✓ Confirm payment</button><button type="submit" class="is-reject" data-decision="rejected">Reject</button></div><p class="chat-proof-error" role="alert"></p></form>';
  }
  // the chat can be mounted into the same element again (admin routes), so replace any earlier listeners
  if(root._payReviewInput)root.removeEventListener('input',root._payReviewInput);
  if(root._payReviewSubmit)root.removeEventListener('submit',root._payReviewSubmit);
  root._payReviewInput=event=>{const form=event.target.closest('[data-pay-review]');if(form)reviewDrafts.set(form.dataset.payReview,event.target.value);};
  root.addEventListener('input',root._payReviewInput);
  root._payReviewSubmit=async event=>{
    const form=event.target.closest('[data-pay-review]');if(!form)return;
    event.preventDefault();
    const decision=event.submitter?.dataset.decision||'paid',reason=form.elements.reason.value.trim(),p=payments.find(x=>x.id===form.dataset.payReview),alert=form.querySelector('[role=alert]');
    if(!reason){alert.textContent=decision==='paid'?'Write how you confirmed it (for example the time it arrived).':'Write the reason so the customer knows what to fix.';form.elements.reason.focus();return;}
    if(!p)return;
    if(!confirm(decision==='paid'?'Mark '+money(p.amount)+' as received? This updates the order payment.':'Reject this proof? The customer will be asked to send a new one.'))return;
    form.querySelectorAll('button').forEach(b=>b.disabled=true);
    const button=event.submitter;if(button)button.textContent=decision==='paid'?'Confirming…':'Rejecting…';
    try{await db.rpc('review_order_payment',{target_payment:p.id,decision,review_reason:reason});reviewDrafts.delete(p.id);await refresh();}
    catch(error){alert.textContent=error.message;form.querySelectorAll('button').forEach(b=>b.disabled=false);if(button)button.textContent=decision==='paid'?'✓ Confirm payment':'Reject';}
  };
  root.addEventListener('submit',root._payReviewSubmit);
  function context(){
    const o=orders.find(row=>row.id===selected?.order_id);
    if(!o){const p=profiles.find(row=>row.id===selected?.customer_id);return '<h2>Conversation details</h2>'+(admin?'<p>Customer: '+escapeHtml(p?.full_name||'Customer')+'</p><p>Phone: '+escapeHtml(p?.phone||'Not provided')+'</p>':'<p>Ask about products, custom orders, pickup, or delivery. A LexC team member can join this conversation.</p>');}
    const related=payments.filter(p=>p.order_id===o.id),p=related[0],balance=o.total_amount===null?null:Math.max(0,Number(o.total_amount)-Number(o.amount_paid||0));
    return '<h2>Order #'+escapeHtml(o.order_number)+'</h2><dl><dt>Customer</dt><dd>'+escapeHtml(o.customer_name)+'</dd><dt>Order status</dt><dd>'+escapeHtml(o.status)+'</dd><dt>Payment</dt><dd>'+escapeHtml(o.payment_status)+'</dd><dt>Total</dt><dd>'+(o.total_amount===null?'Waiting for quote':money(o.total_amount))+'</dd><dt>Downpayment due</dt><dd>'+(o.deposit_due===null?'Waiting for quote':money(o.deposit_due))+'</dd><dt>Verified paid</dt><dd>'+money(o.amount_paid)+'</dd><dt>Balance</dt><dd>'+(balance===null?'Waiting for quote':money(balance))+'</dd><dt>Fulfillment</dt><dd>'+escapeHtml(o.fulfillment_method)+'</dd><dt>Schedule</dt><dd>'+escapeHtml(stamp(o.receiving_start))+'</dd></dl>'+
      (p?'<div class="chat-context-payment"><strong>Latest proof: '+escapeHtml(p.status.replaceAll('_',' '))+'</strong><p>Amount: '+money(p.amount)+'</p><p>Bank reference: '+escapeHtml(p.transaction_reference||'Not submitted')+'</p>'+(p.rejection_reason?'<p>Reason: '+escapeHtml(p.rejection_reason)+'</p>':'')+(p.proof_storage_path?'<button type="button" data-proof="'+escapeHtml(p.id)+'">View private receipt</button>':'')+(admin&&p.status==='verification_pending'?'<form id="chat-payment-review"><label>Decision<select name="decision"><option value="paid">Confirm bank credit</option><option value="rejected">Request new proof</option></select></label><label>Bank confirmation or reason<input name="reason" maxlength="1000" required></label><button type="submit">Save review</button><p role="alert"></p></form>':'')+'</div>':'')+
      (admin?'<a class="chat-context-link" href="#orders/detail/'+escapeHtml(o.id)+'">Open full order</a>':'<a class="chat-context-link" href="../payment/index.html?order='+escapeHtml(o.id)+'">Open payment</a>');
  }
  function customerOrderCard(){
    if(admin||!selected?.order_id)return '';
    const o=orders.find(row=>row.id===selected.order_id);
    if(!o)return '';
    const items=orderItems.filter(item=>item.order_id===o.id);
    const balance=o.total_amount===null?null:Math.max(0,Number(o.total_amount)-Number(o.amount_paid||0));
    const paymentURL='../payment/index.html?order='+encodeURIComponent(o.id);
    const paid=Number(o.amount_paid||0)>0;
    const state=o.status==='cancelled'?'Order cancelled':o.payment_status==='verification_pending'?'Proof awaiting verification':o.payment_status==='rejected'?'New proof needed':o.payment_status==='paid'||balance===0?'Payment verified':o.payment_status==='partially_paid'?'Downpayment paid':o.total_amount===null?'Waiting for a quote':'Payment needed';
    const stateClass=o.status==='cancelled'?'cancelled':o.payment_status==='verification_pending'?'pending':o.payment_status==='rejected'?'rejected':o.payment_status==='paid'||balance===0||o.payment_status==='partially_paid'?'paid':'due';
    return '<section class="chat-order-card" aria-label="Order summary"><div class="chat-order-title"><strong>Order summary</strong><a href="'+paymentURL+'">View details</a></div><div class="chat-order-id">Order #'+escapeHtml(o.order_number)+' <span class="chat-status '+stateClass+'">'+escapeHtml(state)+'</span></div>'+
      (items.length?'<div class="chat-order-items">'+items.map(item=>{const path=products.find(product=>product.id===item.product_id)?.image_path;return '<div><span class="chat-product-icon" aria-hidden="true">'+(path?'<img src="'+escapeHtml(db.mediaURL(path))+'" alt="">':'🧁')+'</span><span><strong>'+escapeHtml(item.name_snapshot)+'</strong><small>'+escapeHtml(item.variant_label_snapshot)+' · Qty '+item.quantity+'</small></span><b>'+money(item.line_total)+'</b></div>';}).join('')+'</div>':'')+
      '<dl><dt>Order total</dt><dd>'+(o.total_amount===null?'To be confirmed':money(o.total_amount))+'</dd><dt>Required downpayment</dt><dd>'+(o.deposit_due===null?'To be confirmed':money(o.deposit_due))+'</dd><dt>Verified paid</dt><dd>'+money(o.amount_paid)+'</dd><dt>Remaining balance</dt><dd>'+(balance===null?'To be confirmed':money(balance))+'</dd></dl>'+
      (o.status!=='cancelled'&&o.total_amount!==null&&balance>0&&o.payment_status!=='verification_pending'?'<div class="chat-payment-tip"><strong>Before sending</strong><p>The QR may not fill in the amount. Check the recipient and enter the exact amount shown on the payment page in your banking app.</p></div>':'')+
      '<div class="chat-order-actions">'+
      (o.status==='cancelled'?'<span>This order is cancelled. Do not send a payment.</span>':o.payment_status==='verification_pending'?'<span>Admin is checking the actual transfer. Please do not pay again.</span>':balance===0?'<span>LexC verified your payment.</span>':'<a href="'+paymentURL+'">'+(paid?'View remaining payment':'Open payment form')+' →</a>')+'</div></section>';
  }
  function sender(m){
    if(m.sender_type==='system')return 'LexC Assistant';
    if(admin){if(m.sender_type==='admin')return 'You · LexC staff';const o=orders.find(x=>x.id===selected?.order_id);return profiles.find(x=>x.id===selected?.customer_id)?.full_name||o?.customer_name||'Customer';}
    return m.sender_type==='admin'?'LexC staff':'You';
  }
  function messageCard(m){
    const p=payments.find(row=>row.id===m.payment_id);
    const eventClass=m.message_type!=='text'?' chat-event '+escapeHtml(m.message_type):'';
    return '<article data-mid="'+escapeHtml(m.id)+'" class="chat-message '+escapeHtml(m.sender_type)+eventClass+'"><div class="chat-bubble"><small>'+escapeHtml(sender(m))+'</small><p>'+escapeHtml(m.body)+'</p>'+designCardHTML(m)+
      (p&&m.message_type==='payment_proof'?'<div class="chat-proof"><strong>Payment proof · '+money(p.amount)+'</strong><span>Reference: '+escapeHtml(p.transaction_reference||'—')+'</span><span>Current status: '+escapeHtml(p.status.replaceAll('_',' '))+'</span>'+(p.proof_storage_path?'<button type="button" data-proof="'+escapeHtml(p.id)+'">View receipt</button>':'')+proofReview(p)+'</div>':'')+
      '<time>'+escapeHtml(stamp(m.created_at))+'</time></div></article>';
  }
  function draw(){
    const visible=conversations.filter(c=>{const o=orders.find(x=>x.id===c.order_id);const term=(title(c)+' '+(o?.customer_name||'')).toLowerCase();return term.includes(search.trim().toLowerCase())&&(filter==='all'||(filter==='orders'&&c.order_id)||(filter==='attention'&&c.state==='needs_admin'));});
    const keep=snapshot();
    const unread=new Map();for(const m of inboxMessages){if(!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer'))unread.set(m.conversation_id,(unread.get(m.conversation_id)||0)+1);}
    root.innerHTML='<div class="chat-workspace '+(selected&&!mobileListOpen?'has-thread':'')+'"><aside class="chat-inbox"><header><div><h1>'+(admin?'Customer conversations':'Messages')+'</h1><p>'+(admin?'Customer support and order conversations':'Chat with LexC’s Snacktime')+'</p></div>'+(admin?'':'<a class="chat-new-link" href="?new=1">New chat</a>')+'</header><label class="chat-search">Search conversations<input id="chat-search" type="search" value="'+escapeHtml(search)+'" placeholder="Order or customer"></label><div class="chat-filters"><button type="button" data-filter="all" '+(filter==='all'?'aria-pressed="true"':'')+'>All</button><button type="button" data-filter="orders" '+(filter==='orders'?'aria-pressed="true"':'')+'>Orders</button><button type="button" data-filter="attention" '+(filter==='attention'?'aria-pressed="true"':'')+'>Needs attention</button></div><div class="chat-rows">'+(visible.length?visible.map(c=>{const latest=inboxMessages.find(m=>m.conversation_id===c.id);return '<button type="button" class="chat-row '+(selected?.id===c.id?'selected':'')+'" data-thread="'+escapeHtml(c.id)+'"><strong>'+escapeHtml(title(c))+(unread.get(c.id)?'<b class="chat-unread">'+unread.get(c.id)+'</b>':'')+'</strong><span>'+escapeHtml(orders.find(o=>o.id===c.order_id)?.customer_name||(admin?'Customer':'General conversation'))+'</span><small>'+escapeHtml(latest?.body?.slice(0,65)||c.state.replaceAll('_',' '))+'</small></button>';}).join(''):'<p class="chat-empty">No conversations yet.</p>')+'</div></aside><section class="chat-thread">'+(selected?'<header><button type="button" id="chat-back" aria-label="Back to conversations">←</button><div><h2>'+escapeHtml(title(selected))+'</h2><span>'+escapeHtml(selected.state==='needs_admin'?'A LexC team member will reply':selected.state)+'</span></div></header><div class="chat-stream">'+(messages.length?messages.map(messageCard).join(''):'<div class="chat-empty">Send a message to start this conversation.</div>')+'</div><form id="chat-compose"><label class="visually-hidden" for="chat-text">Message</label><textarea id="chat-text" name="body" maxlength="3000" rows="2" placeholder="Write a message…" required></textarea><button type="submit">Send</button></form>':admin?'<div class="chat-empty">Select a conversation.</div>':'<div class="chat-empty">No messages yet.<br><button type="button" id="chat-start">Start chatting with LexC’s Admin</button></div>')+'</section><aside class="chat-context">'+(selected?context():'<h2>Order context</h2><p>Select a conversation to see its linked order.</p>')+'</aside></div><p class="chat-error" role="alert" hidden></p>';
    const stream=root.querySelector('.chat-stream');
    if(stream&&!admin){
      if(selected?.order_id)stream.insertAdjacentHTML('afterbegin',customerOrderCard());
      else if(!messages.length)stream.innerHTML='<div class="chat-welcome"><span class="chat-welcome-icon" aria-hidden="true">🧁</span><div><strong>Hi! Welcome to LexC’s Snacktime.</strong><p>Ask us about treats, custom orders, pickup, or delivery. A team member can help right here.</p></div></div><div class="chat-quick-links"><a href="../">View menu</a><button type="button" data-quick-message="I have a question about my order.">Ask a question</button></div>';
      const customerHeading=root.querySelector('.chat-thread header h2');
      const customerSubheading=root.querySelector('.chat-thread header span');
      if(customerHeading)customerHeading.textContent='LexC’s Snacktime';
      if(customerSubheading)customerSubheading.textContent=selected?.order_id?'Your order #'+(orders.find(o=>o.id===selected.order_id)?.order_number||'')+' · We’re here to help':'Typically replies in a few minutes';
    }
    hydrateDesignImages(root);
    restore(keep);
    const contextPanel=root.querySelector('.chat-context');
    if(contextPanel&&selected){const close=document.createElement('button');close.type='button';close.className='chat-context-close';close.setAttribute('aria-label','Close details');close.innerHTML='<span aria-hidden="true">×</span>';close.addEventListener('click',closeDetails);contextPanel.prepend(close);}
    root.querySelectorAll('[data-thread]').forEach(button=>{
      const conversation=conversations.find(c=>c.id===button.dataset.thread);
      const person=profiles.find(p=>p.id===conversation?.customer_id)?.full_name||orders.find(o=>o.id===conversation?.order_id)?.customer_name||'Customer';
      const avatar=document.createElement('span');avatar.className='chat-row-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=admin?person.trim().charAt(0).toUpperCase():'🧁';button.prepend(avatar);
      const state=document.createElement('em');state.className='chat-row-state'+(conversation?.state==='needs_admin'?' needs-attention':'');state.textContent=conversation?.state==='needs_admin'?'Needs reply':conversation?.order_id?'Order chat':'General';button.append(state);
    });
    root.querySelectorAll('[data-thread]').forEach(button=>button.onclick=async()=>{selected=conversations.find(c=>c.id===button.dataset.thread);mobileListOpen=false;const stream=root.querySelector('.chat-stream');if(stream)stream.outerHTML=threadSkeleton();try{await loadMessages();draw();const s=root.querySelector('.chat-stream');if(s)s.scrollTop=s.scrollHeight;}catch(error){showError('Conversation could not load. Please choose it again.');}});
    root.querySelector('#chat-back')?.addEventListener('click',()=>{mobileListOpen=true;root.querySelector('.chat-workspace').classList.remove('has-thread');});
    root.querySelector('#chat-start')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{if(orderId&&!orders.some(o=>o.id===orderId&&o.customer_id===user.id))throw new Error('This order is not available to your account.');selected=await ensureCustomerChat({userId:user.id,orderId});await refresh(false);}catch(error){showError(error.message);button.disabled=false;}});
    root.querySelectorAll('[data-quick-message]').forEach(button=>button.onclick=()=>{const input=root.querySelector('#chat-text');if(input){input.value=button.dataset.quickMessage;input.focus();}});
    root.querySelector('#chat-search')?.addEventListener('input',e=>{search=e.target.value;draw();});
    root.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;draw();});
    root.querySelector('#chat-compose')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),body=form.elements.body.value.trim();if(!body||button.disabled)return;button.disabled=true;try{await sendChatMessage({conversationId:selected.id,userId:user.id,admin,body});form.reset();await refresh();root.querySelector('.chat-stream')?.scrollTo(0,999999);}catch(error){showError(error.message);button.disabled=false;}});
    root.querySelector('#chat-text')?.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();event.currentTarget.form?.requestSubmit();}});
    root.querySelectorAll('[data-proof]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const p=payments.find(x=>x.id===button.dataset.proof);const url=await db.privateImage('payment-proofs',p.proof_storage_path);window.open(url,'_blank','noopener');}catch(error){showError(error.message);}finally{button.disabled=false;}});
    root.querySelector('#chat-payment-review')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),p=payments.find(x=>x.order_id===selected.order_id&&x.status==='verification_pending');button.disabled=true;try{await db.rpc('review_order_payment',{target_payment:p.id,decision:form.elements.decision.value,review_reason:form.elements.reason.value.trim()});await refresh();}catch(error){form.querySelector('[role=alert]').textContent=error.message;button.disabled=false;}});
  }
  // What a redraw must not lose: the focused field and its cursor, the open details panel, the payment
  // review being filled in, and whether the thread was scrolled to the newest message.
  function snapshot(){
    const active=root.contains(document.activeElement)?document.activeElement:null,stream=root.querySelector('.chat-stream'),review=root.querySelector('#chat-payment-review');
    return {id:active?.id||null,start:active?.selectionStart??null,end:active?.selectionEnd??null,
      context:root.querySelector('.chat-workspace')?.classList.contains('show-context')||false,
      review:review?{decision:review.elements.decision.value,reason:review.elements.reason.value}:null,
      atBottom:!stream||stream.scrollHeight-stream.scrollTop-stream.clientHeight<40,scroll:stream?.scrollTop??0,thread:selected?.id};
  }
  function restore(k){
    if(k.context)root.querySelector('.chat-workspace')?.classList.add('show-context');
    const review=root.querySelector('#chat-payment-review');
    if(review&&k.review){review.elements.decision.value=k.review.decision;review.elements.reason.value=k.review.reason;}
    const stream=root.querySelector('.chat-stream');
    if(stream)stream.scrollTop=k.thread===selected?.id&&!k.atBottom?k.scroll:stream.scrollHeight;
    if(k.id){const el=root.querySelector('#'+CSS.escape(k.id));if(el){el.focus({preventScroll:true});if(k.start!==null&&typeof el.setSelectionRange==='function'){try{el.setSelectionRange(k.start,k.end);}catch{}}}}
  }
  function showError(message){const target=root.querySelector('.chat-error');if(target){target.textContent=message;target.hidden=false;}}
  try{await refresh(false);}catch(error){root.innerHTML='<div class="chat-empty" role="alert">Chat could not load: '+escapeHtml(error.message)+' <button type="button" id="chat-retry">Try again</button></div>';root.querySelector('#chat-retry').onclick=()=>mountChat(root,{admin,orderId});return;}
  let refreshSoon;
  const stop=subscribeChatChanges(()=>{clearTimeout(refreshSoon);refreshSoon=setTimeout(()=>{if(root.isConnected)refresh().catch(error=>showError(error.message));},180);},status=>{
    if(status==='SUBSCRIBED'){clearInterval(fallbackTimer);fallbackTimer=null;}
    else if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)&&!fallbackTimer){fallbackTimer=setInterval(()=>{if(root.isConnected&&!document.hidden)refresh().catch(error=>showError(error.message));},30000);}
  });
  const observer=new MutationObserver(()=>{if(!root.isConnected){clearTimeout(refreshSoon);clearInterval(fallbackTimer);stop();observer.disconnect();}});
  if(root.parentNode)observer.observe(root.parentNode,{childList:true});
}
