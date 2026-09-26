const db=window.LexcBackend;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=value=>new Date(value).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'});
const short=value=>String(value||'').slice(0,8);

export async function mountChat(root,{admin=false,orderId=null}={}){
  let user,conversations=[],selected=null,messages=[],orders=[],orderItems=[],products=[],payments=[],profiles=[],inboxMessages=[],search='',filter='all',timer,mobileListOpen=false;
  root.innerHTML='<div class="chat-loading" role="status">Loading conversations…</div>';
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
    if(orderId&&!orders.some(o=>o.id===orderId)){
      const target=await db.client.from('orders').select('id,order_number,customer_name,customer_id,status,payment_status,total_amount,deposit_due,amount_paid,fulfillment_method,receiving_start').eq('id',orderId).maybeSingle().then(db.unwrap);
      if(target)orders.unshift(target);
    }
    const startGeneral=!admin&&new URLSearchParams(location.search).has('new');
    if(startGeneral&&!conversations.some(c=>!c.order_id)){
      const result=await db.client.from('chat_conversations').insert({customer_id:user.id}).select().single();
      if(result.error?.code!=='23505'&&result.error)throw result.error;
      conversations=await db.client.from('chat_conversations').select('*').order('updated_at',{ascending:false}).limit(150).then(db.unwrap);
    }
    if(startGeneral){history.replaceState(null,'',location.pathname);}
    if(orderId&&!conversations.some(c=>c.order_id===orderId)&&!admin){
      const own=orders.find(o=>o.id===orderId&&o.customer_id===user.id);
      if(own){const result=await db.client.from('chat_conversations').insert({customer_id:user.id,order_id:orderId}).select().single();
        if(result.error?.code!=='23505'&&result.error)throw result.error;
        conversations=await db.client.from('chat_conversations').select('*').order('updated_at',{ascending:false}).limit(150).then(db.unwrap);}
    }
    if(!preserve||!selected||!conversations.some(c=>c.id===selected.id))selected=(startGeneral?conversations.find(c=>!c.order_id):null)||conversations.find(c=>c.order_id===orderId)||conversations[0]||null;
    if(selected?.order_id&&!orderItems.some(item=>item.order_id===selected.order_id)){
      const selectedItems=await db.client.from('order_items').select('order_id,line_number,product_id,name_snapshot,variant_label_snapshot,quantity,line_total').eq('order_id',selected.order_id).order('line_number',{ascending:true}).then(db.unwrap);
      orderItems.push(...selectedItems);
    }
    if(selected)await loadMessages();else messages=[];
    draw();
    const input=root.querySelector('#chat-text');if(input)input.value=draft;
  };
  async function loadMessages(){
    messages=await db.client.from('chat_messages').select('*').eq('conversation_id',selected.id).order('created_at',{ascending:true}).limit(200).then(db.unwrap);
    const unread=messages.filter(m=>!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer')).map(m=>m.id);
    if(unread.length){const {error}=await db.client.from('chat_messages').update({read_at:new Date().toISOString()}).in('id',unread);if(error)console.warn('Chat read state could not update:',error.message);}
  }
  function title(c){const o=orders.find(row=>row.id===c.order_id);return o?`Order #${o.order_number}`:admin?profiles.find(p=>p.id===c.customer_id)?.full_name||'General inquiry':'LexC Assistant';}
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
  function messageCard(m){
    const p=payments.find(row=>row.id===m.payment_id);
    const eventClass=m.message_type!=='text'?' chat-event '+escapeHtml(m.message_type):'';
    return '<article class="chat-message '+escapeHtml(m.sender_type)+eventClass+'"><div class="chat-bubble"><small>'+escapeHtml(m.sender_type==='system'?'LexC Assistant':m.sender_type==='admin'?'LexC staff':'You')+'</small><p>'+escapeHtml(m.body)+'</p>'+
      (p&&m.message_type==='payment_proof'?'<div class="chat-proof"><strong>Payment proof · '+money(p.amount)+'</strong><span>Reference: '+escapeHtml(p.transaction_reference||'—')+'</span><span>Current status: '+escapeHtml(p.status.replaceAll('_',' '))+'</span>'+(p.proof_storage_path?'<button type="button" data-proof="'+escapeHtml(p.id)+'">View receipt</button>':'')+'</div>':'')+
      '<time>'+escapeHtml(stamp(m.created_at))+'</time></div></article>';
  }
  function draw(){
    const visible=conversations.filter(c=>{const o=orders.find(x=>x.id===c.order_id);const term=(title(c)+' '+(o?.customer_name||'')).toLowerCase();return term.includes(search)&&(filter==='all'||(filter==='orders'&&c.order_id)||(filter==='attention'&&c.state==='needs_admin'));});
    const unread=new Map();for(const m of inboxMessages){if(!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer'))unread.set(m.conversation_id,(unread.get(m.conversation_id)||0)+1);}
    root.innerHTML='<div class="chat-workspace '+(selected&&!mobileListOpen?'has-thread':'')+'"><aside class="chat-inbox"><header><div><h1>'+(admin?'Customer conversations':'Messages')+'</h1><p>'+(admin?'Customer support and order conversations':'Chat with LexC’s Snacktime')+'</p></div>'+(admin?'':'<a class="chat-new-link" href="?new=1">New chat</a>')+'</header><label class="chat-search">Search conversations<input id="chat-search" type="search" value="'+escapeHtml(search)+'" placeholder="Order or customer"></label><div class="chat-filters"><button type="button" data-filter="all" '+(filter==='all'?'aria-pressed="true"':'')+'>All</button><button type="button" data-filter="orders" '+(filter==='orders'?'aria-pressed="true"':'')+'>Orders</button><button type="button" data-filter="attention" '+(filter==='attention'?'aria-pressed="true"':'')+'>Needs attention</button></div><div class="chat-rows">'+(visible.length?visible.map(c=>{const latest=inboxMessages.find(m=>m.conversation_id===c.id);return '<button type="button" class="chat-row '+(selected?.id===c.id?'selected':'')+'" data-thread="'+escapeHtml(c.id)+'"><strong>'+escapeHtml(title(c))+(unread.get(c.id)?'<b class="chat-unread">'+unread.get(c.id)+'</b>':'')+'</strong><span>'+escapeHtml(orders.find(o=>o.id===c.order_id)?.customer_name||(admin?'Customer':'General conversation'))+'</span><small>'+escapeHtml(latest?.body?.slice(0,65)||c.state.replaceAll('_',' '))+'</small></button>';}).join(''):'<p class="chat-empty">No conversations yet.</p>')+'</div></aside><section class="chat-thread">'+(selected?'<header><button type="button" id="chat-back" aria-label="Back to conversations">←</button><div><h2>'+escapeHtml(title(selected))+'</h2><span>'+escapeHtml(selected.state==='needs_admin'?'A LexC team member will reply':selected.state)+'</span></div><button type="button" id="chat-details">Details</button></header><div class="chat-stream">'+(messages.length?messages.map(messageCard).join(''):'<div class="chat-empty">Send a message to start this conversation.</div>')+'</div><form id="chat-compose"><label class="visually-hidden" for="chat-text">Message</label><textarea id="chat-text" name="body" maxlength="3000" rows="2" placeholder="Write a message…" required></textarea><button type="submit">Send</button></form>':'<div class="chat-empty">Select a conversation, or start a new chat.</div>')+'</section><aside class="chat-context">'+(selected?context():'<h2>Order context</h2><p>Select a conversation to see its linked order.</p>')+'</aside></div><p class="chat-error" role="alert" hidden></p>';
    const stream=root.querySelector('.chat-stream');
    if(stream&&!admin){
      if(selected?.order_id)stream.insertAdjacentHTML('afterbegin',customerOrderCard());
      else if(!messages.length)stream.innerHTML='<div class="chat-welcome"><span class="chat-welcome-icon" aria-hidden="true">🧁</span><div><strong>Hi! Welcome to LexC’s Snacktime.</strong><p>Ask us about treats, custom orders, pickup, or delivery. A team member can help right here.</p></div></div><div class="chat-quick-links"><a href="../">View menu</a><button type="button" data-quick-message="I have a question about my order.">Ask a question</button></div>';
      const customerHeading=root.querySelector('.chat-thread header h2');
      const customerSubheading=root.querySelector('.chat-thread header span');
      if(customerHeading)customerHeading.textContent='LexC’s Snacktime';
      if(customerSubheading)customerSubheading.textContent=selected?.order_id?'Your order #'+(orders.find(o=>o.id===selected.order_id)?.order_number||'')+' · We’re here to help':'Typically replies in a few minutes';
    }
    const contextPanel=root.querySelector('.chat-context');
    if(contextPanel&&selected){const close=document.createElement('button');close.type='button';close.className='chat-context-close';close.textContent='← Back to chat';close.addEventListener('click',()=>root.querySelector('.chat-workspace').classList.remove('show-context'));contextPanel.prepend(close);}
    root.querySelectorAll('[data-thread]').forEach(button=>{
      const conversation=conversations.find(c=>c.id===button.dataset.thread);
      const person=profiles.find(p=>p.id===conversation?.customer_id)?.full_name||orders.find(o=>o.id===conversation?.order_id)?.customer_name||'Customer';
      const avatar=document.createElement('span');avatar.className='chat-row-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=admin?person.trim().charAt(0).toUpperCase():'🧁';button.prepend(avatar);
      const state=document.createElement('em');state.className='chat-row-state'+(conversation?.state==='needs_admin'?' needs-attention':'');state.textContent=conversation?.state==='needs_admin'?'Needs reply':conversation?.order_id?'Order chat':'General';button.append(state);
    });
    root.querySelectorAll('[data-thread]').forEach(button=>button.onclick=async()=>{selected=conversations.find(c=>c.id===button.dataset.thread);mobileListOpen=false;await loadMessages();draw();root.querySelector('.chat-stream')?.scrollTo(0,999999);});
    root.querySelector('#chat-back')?.addEventListener('click',()=>{mobileListOpen=true;root.querySelector('.chat-workspace').classList.remove('has-thread');});
    root.querySelector('#chat-details')?.addEventListener('click',()=>root.querySelector('.chat-workspace').classList.toggle('show-context'));
    root.querySelectorAll('[data-quick-message]').forEach(button=>button.onclick=()=>{const input=root.querySelector('#chat-text');if(input){input.value=button.dataset.quickMessage;input.focus();}});
    root.querySelector('#chat-search')?.addEventListener('input',e=>{search=e.target.value;draw();root.querySelector('#chat-search').focus();});
    root.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;draw();});
    root.querySelector('#chat-compose')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),body=form.elements.body.value.trim();if(!body)return;button.disabled=true;try{await db.client.from('chat_messages').insert({conversation_id:selected.id,sender_id:user.id,sender_type:admin?'admin':'customer',body}).then(db.unwrap);form.reset();await refresh();root.querySelector('.chat-stream')?.scrollTo(0,999999);}catch(error){showError(error.message);button.disabled=false;}});
    root.querySelectorAll('[data-proof]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const p=payments.find(x=>x.id===button.dataset.proof);const url=await db.privateImage('payment-proofs',p.proof_storage_path);window.open(url,'_blank','noopener');}catch(error){showError(error.message);}finally{button.disabled=false;}});
    root.querySelector('#chat-payment-review')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),p=payments.find(x=>x.order_id===selected.order_id&&x.status==='verification_pending');button.disabled=true;try{await db.rpc('review_order_payment',{target_payment:p.id,decision:form.elements.decision.value,review_reason:form.elements.reason.value.trim()});await refresh();}catch(error){form.querySelector('[role=alert]').textContent=error.message;button.disabled=false;}});
  }
  function showError(message){const target=root.querySelector('.chat-error');if(target){target.textContent=message;target.hidden=false;}}
  try{await refresh(false);}catch(error){root.innerHTML='<div class="chat-empty" role="alert">Chat could not load: '+escapeHtml(error.message)+' <button type="button" id="chat-retry">Try again</button></div>';root.querySelector('#chat-retry').onclick=()=>mountChat(root,{admin,orderId});return;}
  timer=setInterval(()=>{if(!root.isConnected){clearInterval(timer);return;}if(!document.hidden)refresh().catch(error=>showError(error.message));},10000);
}
