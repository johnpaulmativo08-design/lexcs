import {ask} from './ask.js?v=1';
import {designLink} from './design-link.js?v=1';
const db=window.LexcBackend;
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'₱'+Number(value||0).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
const stamp=value=>new Date(value).toLocaleString('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'});
const short=value=>String(value||'').slice(0,8);
const ORDER_COLS='id,order_number,customer_name,customer_id,status,payment_status,total_amount,deposit_due,amount_paid,fulfillment_method,receiving_start,delivery_fee,price_review,extra_charge,vat_amount';

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
// the summary and price, and an "Open in 3D" link that rebuilds the exact design in the designer
// (in Admin: "View in 3D", a view-only 3D window inside Admin).
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
  const fee=!delivery?'':s.delivery_fee_status==='quoted'&&Number(s.delivery_fee)>0?money(s.delivery_fee):'Paid to the rider';
  const day=s.receiving_start?phWhen(s.receiving_start,{weekday:'short',month:'short',day:'numeric',year:'numeric'}):'';
  const hours=s.receiving_start&&s.receiving_end?phWhen(s.receiving_start,{hour:'numeric',minute:'2-digit'})+' – '+phWhen(s.receiving_end,{hour:'numeric',minute:'2-digit'}):'';
  const count=(s.items||[]).reduce((sum,i)=>sum+Number(i.qty||0),0),key=String(s.order_number);
  return '<details class="order-card" data-order="'+escapeHtml(key)+'"'+(openOrderCards.has(key)?' open':'')+'><summary><span class="order-card-head"><strong>Order #'+escapeHtml(s.order_number)+'</strong><small>'+count+' item'+(count===1?'':'s')+(s.ordered_at?' · '+escapeHtml(phWhen(s.ordered_at,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})):'')+'</small></span><b>'+(s.total===null||s.total===undefined?'Total after delivery fee':money(s.total))+'</b><span class="order-card-toggle" aria-hidden="true"></span></summary><div class="order-card-body">'+
    '<ul class="order-card-items">'+items+'</ul>'+
    '<div class="order-card-sums">'+row('Items',money(s.items_subtotal))+(Number(s.customization_total)>0?row('Design options',money(s.customization_total)):'')+(delivery?row('Lalamove fee',fee):'')+(Number(s.rush_fee)>0?row('Rush fee (next-day)',money(s.rush_fee)):'')+
    row('Total',s.total===null||s.total===undefined?'After the delivery fee':money(s.total),true)+(s.deposit_due!==null&&s.deposit_due!==undefined&&Number(s.deposit_rate)<1?row('Downpayment ('+Math.round(Number(s.deposit_rate)*100)+'%)',money(s.deposit_due)):'')+'</div>'+
    '<div class="order-card-meta"><p><span>'+(delivery?'Delivery (Lalamove)':'Pickup')+'</span>'+escapeHtml([day,hours].filter(Boolean).join(' · '))+'</p>'+
    '<p><span>Contact</span>'+escapeHtml([s.name,s.phone].filter(Boolean).join(' · '))+'</p>'+(delivery&&s.address?'<p><span>Address</span>'+escapeHtml(s.address)+'</p>':'')+(s.notes?'<p><span>Notes</span>'+escapeHtml(s.notes)+'</p>':'')+'</div>'+orderLink(orderId)+'</div></details>';
}
// ---- Additional price card (phase 51): LexC's added a charge for custom work; the customer accepts or declines it.
const isAdminView=()=>/\/admin\//.test(location.pathname);
function priceReviewHTML(r,orderId){
  const status=r.status||'awaiting',label={awaiting:'Waiting for your answer',accepted:'Accepted',declined:'Declined',replaced:'Replaced by a newer price'}[status]||status;
  const adminLabel={awaiting:'Waiting for the customer'}[status];
  const total=r.new_total===null||r.new_total===undefined?'To be confirmed':money(r.new_total);
  return '<section class="price-card is-'+escapeHtml(status)+'" data-price-order="'+escapeHtml(orderId||'')+'"><header><strong>Additional price</strong><span>'+escapeHtml(isAdminView()&&adminLabel?adminLabel:label)+'</span></header>'+
    (r.reason?'<p class="price-card-reason">'+escapeHtml(r.reason)+'</p>':'')+'<dl>'+(r.old_total!==null&&r.old_total!==undefined?'<dt>Previous total</dt><dd>'+money(r.old_total)+'</dd>':'')+'<dt>Additional</dt><dd>+ '+money(r.amount)+'</dd><dt>New total</dt><dd>'+total+'</dd></dl>'+
    (status==='awaiting'&&!isAdminView()&&orderId?'<div class="price-card-actions"><button type="button" class="is-accept" data-extra-answer="accept">Accept new price</button><button type="button" class="is-decline" data-extra-answer="decline">Decline</button></div><p class="price-card-error" role="alert"></p>':'')+'</section>';
}
// one listener for every place the card appears (chat page, chat bubble)
document.addEventListener('click',async event=>{
  const button=event.target.closest?.('[data-extra-answer]');if(!button)return;
  const card=button.closest('[data-price-order]'),accept=button.dataset.extraAnswer==='accept',alert=card.querySelector('[role=alert]');
  if(!await ask(accept?'The additional price is added to your order total. After that you can pay the downpayment or the full amount.':'Your order stays at its current price. LexC’s will reply here about what happens next.',{title:accept?'Accept the new price?':'Decline the additional price?',confirm:accept?'Accept':'Decline',tone:accept?'success':'danger'}))return;
  card.querySelectorAll('button').forEach(b=>b.disabled=true);button.textContent=accept?'Accepting…':'Declining…';
  try{await db.rpc('respond_order_extra',{target_order:card.dataset.priceOrder,accept});alert.textContent='';}
  catch(error){alert.textContent=error.message;card.querySelectorAll('button').forEach(b=>b.disabled=false);button.textContent=accept?'Accept new price':'Decline';}
});
// Admin: "View in 3D" opens a view-only 3D window inside Admin (admin/design-viewer.js), loaded on first use.
const viewerCards=new Map();
document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-view-design]');if(!button)return;
  const card=viewerCards.get(button.dataset.viewDesign);if(!card)return;
  import('../admin/design-viewer.js?v=2').then(m=>m.openDesignViewer(card.lines,Number(button.dataset.viewLine)||0,{title:card.title}));
});
// ---- Pictures in chat (phase 55): a customer can send up to 4 photos with an optional message ----------------
export const CHAT_PICTURE_MAX=4;
const PICTURE_TYPES=['image/jpeg','image/png','image/webp'];
// phone photos are often over 5 MB: scale to 1600 px on the long side and save as JPEG before uploading
export async function shrinkPicture(file){
  if(!PICTURE_TYPES.includes(file.type))throw new Error('Choose a photo (JPG, PNG or WebP).');
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((ok,fail)=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>fail(new Error('That photo could not be opened. Try another one.'));i.src=url;});
    const scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=Object.assign(document.createElement('canvas'),{width:Math.round(img.naturalWidth*scale),height:Math.round(img.naturalHeight*scale)});
    const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await new Promise(ok=>canvas.toBlob(ok,'image/jpeg',.85));
    if(!blob)throw new Error('That photo could not be prepared. Try another one.');
    return new File([blob],'picture.jpg',{type:'image/jpeg'});
  }finally{URL.revokeObjectURL(url);}
}
export function pickPictures(input,pending){
  const room=CHAT_PICTURE_MAX-pending.length,files=[...input.files];input.value='';
  const ok=files.filter(f=>PICTURE_TYPES.includes(f.type)).slice(0,Math.max(0,room));
  ok.forEach(file=>pending.push({file,url:URL.createObjectURL(file)}));
  return files.length>ok.length?(room<=0||files.length>room?'You can send up to '+CHAT_PICTURE_MAX+' pictures at a time.':'Only JPG, PNG or WebP photos can be sent.'):'';
}
export function pendingPicturesHTML(pending,key){
  if(!pending.length)return '';
  return '<div class="chat-pending" aria-label="Pictures to send">'+pending.map((p,i)=>'<figure><img src="'+escapeHtml(p.url)+'" alt="Picture '+(i+1)+' to send"><button type="button" data-unpick="'+escapeHtml(key)+'" data-index="'+i+'" aria-label="Remove picture '+(i+1)+'">×</button></figure>').join('')+'</div>';
}
// folder: whose private folder the photos go in (Admin sends into the customer's, phase 62)
export async function sendChatPictures({conversationId,userId,pending,caption,folder}){
  const paths=[];
  for(const p of pending)paths.push(await db.upload('customer-references',(folder||userId)+'/chat',await shrinkPicture(p.file)));
  await db.rpc('send_chat_images',{p_conversation:conversationId,p_paths:paths,p_caption:caption||null});
  pending.forEach(p=>URL.revokeObjectURL(p.url));pending.length=0;
}
function picturesHTML(m){
  const images=Array.isArray(m.attachments?.images)?m.attachments.images:[];
  return '<div class="chat-pics chat-pics--'+Math.min(images.length,4)+'">'+images.map((path,i)=>'<button type="button" class="design-card-pic chat-pic" data-design-img="'+escapeHtml(path)+'" aria-label="Open picture '+(i+1)+' full size"><img alt="Picture '+(i+1)+'" hidden><span class="skel" aria-hidden="true"></span><small></small></button>').join('')+'</div>';
}
export function designCardHTML(m){
  if(m.message_type==='image')return picturesHTML(m);
  if(m.message_type==='price_review'&&m.attachments&&typeof m.attachments==='object')return priceReviewHTML(m.attachments,m.order_id);
  if(m.message_type==='order_summary'&&m.attachments&&typeof m.attachments==='object')return orderSummaryHTML(m.attachments,m.order_id);
  if(m.message_type!=='design_card'||!Array.isArray(m.attachments))return '';
  const picture=(path,label)=>path?'<button type="button" class="design-card-pic" data-design-img="'+escapeHtml(path)+'" aria-label="Open '+label+' picture full size"><img alt="'+label+'" hidden><span class="skel" aria-hidden="true"></span><small>'+label+'</small></button>':'';
  const admin=isAdminView();if(admin)viewerCards.set(String(m.id),{lines:m.attachments,title:'Order #'+(m.body.match(/Order #(\d+)/)?.[1]||'')});
  return '<div class="design-card">'+m.attachments.map((line,i)=>'<section class="design-card-line"><div class="design-card-pics">'+picture(line.angle_path,['cupcake','donut','cakepop'].includes(line.design?.designer)?'Box picture':'Angled view')+picture(line.top_path,'Top view')+'</div>'+
    '<strong>'+escapeHtml(line.name)+(Number(line.qty)>1?' × '+Number(line.qty):'')+'</strong><p>'+escapeHtml(line.summary||'')+'</p><div class="design-card-foot"><b>'+money(line.unit_price)+(['cupcake','donut','cakepop'].includes(line.design?.designer)?' per box':' per cake')+'</b>'+(admin?'<button type="button" class="design-card-3d" data-view-design="'+escapeHtml(m.id)+'" data-view-line="'+i+'">View in 3D</button>':'<a href="'+escapeHtml(designLink(line))+'" target="_blank" rel="noopener">'+(['cupcake','donut','cakepop'].includes(line.design?.designer)?'Open design ↗':'Open in 3D ↗')+'</a>')+'</div></section>').join('')+'</div>';
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
  const pendingPictures=[];let user,conversations=[],selected=null,messages=[],orders=[],orderItems=[],products=[],payments=[],deliveries=[],profiles=[],inboxMessages=[],search='',filter='all',fallbackTimer,mobileListOpen=false;
  const line=(size='')=>'<span class="skel skel-line '+(size==='wide'?'skel-line--long':size==='short'?'skel-line--short':'')+'"></span>';
  const threadSkeleton=()=>'<div class="chat-stream chat-stream-loading" aria-busy="true"><div aria-hidden="true" class="chat-skeleton-messages"><div class="chat-skeleton-bubble">'+line('wide')+line('medium')+'</div><div class="chat-skeleton-bubble mine">'+line('medium')+line('short')+'</div><div class="chat-skeleton-bubble">'+line('wide')+line('short')+'</div></div></div>';
  const pageSkeleton=()=>'<div class="chat-workspace chat-workspace-loading" aria-busy="true"><aside class="chat-inbox"><header><div><h1>'+(admin?'Customer conversations':'Messages')+'</h1><p>'+(admin?'Customer support and order conversations':'Chat with LexC’s Snacktime')+'</p></div></header><div class="chat-search">'+line('wide')+'</div><div class="chat-filters">'+line('medium')+line('short')+'</div><div class="chat-rows" aria-hidden="true">'+Array.from({length:5},()=>'<div class="chat-skeleton-row"><span class="skel skel-circle"></span><span>'+line('medium')+line('wide')+line('short')+'</span></div>').join('')+'</div></aside><section class="chat-thread"><header><div>'+line('medium')+line('short')+'</div></header>'+threadSkeleton()+'<div class="chat-compose" aria-hidden="true">'+line('wide')+'<span class="skel skel-button"></span></div></section><aside class="chat-context"><h2>Conversation details</h2><div aria-hidden="true" class="chat-skeleton-context">'+Array.from({length:6},()=>line('wide')+line('short')).join('')+'</div></aside></div>';
  root.innerHTML=pageSkeleton();
  try{user=await db.identity();if(!user)throw new Error('Sign in to use LexC chat.');if(admin&&user.role!=='admin')throw new Error('Admin access required.');}
  catch(error){root.innerHTML='<div class="chat-empty" role="alert">'+escapeHtml(error.message)+' <a href="'+(admin?'../?login=admin':'../?return=chat')+'">Sign in</a></div>';return;}
  const refresh=async(preserve=true)=>{
    const draft=root.querySelector('#chat-text')?.value||'';
    const [threadRows,orderRows,itemRows,productRows,paymentRows,messageRows,profileRows]=await Promise.all([
      db.client.from('chat_conversations').select('*').order('updated_at',{ascending:false}).limit(150).then(db.unwrap),
      db.client.from('orders').select(ORDER_COLS).order('created_at',{ascending:false}).limit(admin?150:50).then(db.unwrap),
      db.client.from('order_items').select('order_id,line_number,product_id,name_snapshot,variant_label_snapshot,quantity,line_total').order('line_number',{ascending:true}).limit(admin?500:200).then(db.unwrap),
      db.client.from('products').select('id,image_path').limit(150).then(db.unwrap),
      db.client.from('order_payment_attempts').select('id,order_id,amount,status,payment_kind,transaction_reference,proof_storage_path,submitted_at,verified_at,rejected_at,rejection_reason').order('created_at',{ascending:false}).limit(admin?150:50).then(db.unwrap),
      db.client.from('chat_messages').select('conversation_id,sender_type,body,read_at,created_at').order('created_at',{ascending:false}).limit(500).then(db.unwrap),
      db.client.from('profiles').select('id,full_name,phone').limit(admin?500:1).then(db.unwrap)
    ]);
    conversations=threadRows;orders=orderRows;orderItems=itemRows;products=productRows;payments=paymentRows;inboxMessages=messageRows;profiles=profileRows;
    // Conversations can belong to orders older than the latest ones loaded above: fetch those orders and
    // their payments too, so every chat shows its order number, status and payment.
    const missing=[...new Set([...conversations.map(c=>c.order_id),orderId].filter(id=>id&&!orders.some(o=>o.id===id)))];
    if(missing.length){
      const [more,morePayments]=await Promise.all([
        db.client.from('orders').select(ORDER_COLS).in('id',missing).then(db.unwrap),
        db.client.from('order_payment_attempts').select('id,order_id,amount,status,payment_kind,transaction_reference,proof_storage_path,submitted_at,verified_at,rejected_at,rejection_reason').in('order_id',missing).order('created_at',{ascending:false}).then(db.unwrap)]);
      orders.push(...more);payments.push(...morePayments.filter(x=>!payments.some(y=>y.id===x.id)));
    }
    // Lalamove delivery details for delivery orders (phase 79; read-only here, empty until the table exists)
    const delivering=orders.filter(o=>o.fulfillment_method==='lalamove').map(o=>o.id).slice(0,200);
    deliveries=delivering.length?await db.client.from('order_deliveries').select('*').in('order_id',delivering).then(db.unwrap).catch(()=>[]):[];
    const startGeneral=!admin&&new URLSearchParams(location.search).has('new');
    if(startGeneral){history.replaceState(null,'',location.pathname);}
    if(!preserve||!selected||!conversations.some(c=>c.id===selected.id))selected=orderId?(conversations.find(c=>c.order_id===orderId)||null):startGeneral?(conversations.find(c=>!c.order_id)||null):admin?(conversations.find(c=>c.state!=='resolved')||null):(conversations.find(c=>!c.order_id)||conversations[0]||null);
    if(selected)await loadMessages();else messages=[];
    draw();
    const input=root.querySelector('#chat-text');if(input)input.value=draft;
  };
  async function loadMessages(){
    const thread=selected;
    // admin sees every chat of this customer together (each order chat + general); the customer sees one chat
    const group=admin?conversations.filter(c=>c.customer_id===thread.customer_id):[thread];
    const [lists]=await Promise.all([Promise.all(group.map(c=>readChatThread(c.id))),thread.order_id&&!orderItems.some(item=>item.order_id===thread.order_id)
      ?db.client.from('order_items').select('order_id,line_number,product_id,name_snapshot,variant_label_snapshot,quantity,line_total').eq('order_id',thread.order_id).order('line_number',{ascending:true}).then(db.unwrap).then(items=>orderItems.push(...items))
      :null]);
    messages=lists.flat().sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
    try{await markChatRead(messages,{admin});}catch(error){console.warn('Chat read state could not update:',error.message);}
    const now=new Date().toISOString();
    inboxMessages.forEach(m=>{if(group.some(c=>c.id===m.conversation_id)&&!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer'))m.read_at=now;});
  }
  const personName=c=>profiles.find(p=>p.id===c?.customer_id)?.full_name||orders.find(o=>o.customer_id===c?.customer_id&&o.customer_name)?.customer_name||'Customer';
  // admin inbox: conversations grouped by customer (newest chat first inside each group)
  function customerGroups(list){const groups=new Map();for(const c of list){if(!groups.has(c.customer_id))groups.set(c.customer_id,[]);groups.get(c.customer_id).push(c);}return [...groups.values()];}
  function customerRow(g,unread){
    const lead=g.find(c=>c.id===selected?.id)||g[0],numbers=g.filter(c=>c.order_id).map(c=>orders.find(o=>o.id===c.order_id)?.order_number).filter(Boolean);
    const latest=inboxMessages.find(m=>g.some(c=>c.id===m.conversation_id)),count=g.reduce((n,c)=>n+(unread.get(c.id)||0),0);
    const sub=numbers.length?numbers.length+' order chat'+(numbers.length===1?'':'s')+' · #'+numbers.slice(0,3).join(', #')+(numbers.length>3?'…':''):'General chat';
    return '<button type="button" class="chat-row '+(g.some(c=>c.id===selected?.id)?'selected':'')+'" data-thread="'+escapeHtml(lead.id)+'" data-customer="'+escapeHtml(lead.customer_id)+'"><strong>'+escapeHtml(personName(lead))+(count?'<b class="chat-unread">'+count+'</b>':'')+'</strong><span>'+escapeHtml(sub)+'</span><small>'+escapeHtml(latest?.body?.slice(0,65)||lead.state.replaceAll('_',' '))+'</small></button>';
  }
  function replyPicker(){
    const g=conversations.filter(c=>c.customer_id===selected.customer_id);if(g.length<2)return '<span>'+escapeHtml(title(selected))+'</span>';
    return '<label class="chat-reply-in"><span>Replying in</span><select id="chat-reply-in">'+g.map(c=>'<option value="'+escapeHtml(c.id)+'" '+(c.id===selected.id?'selected':'')+'>'+escapeHtml(title(c)+(c.state==='resolved'?' (archived)':''))+'</option>').join('')+'</select></label>';
  }
  function title(c){const o=orders.find(row=>row.id===c.order_id);return o?`Order #${o.order_number}`:admin?'General chat':'LexC Assistant';}
  // the Details panel closes with its × button, the Esc key, or a click anywhere outside it
  function closeDetails(){root.querySelector('.chat-workspace')?.classList.remove('show-context');}
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.querySelector('.chat-workspace.show-context'))closeDetails();});
  root.addEventListener('click',event=>{if(root.querySelector('.chat-workspace.show-context')&&!event.target.closest('.chat-context'))closeDetails();});
  // Admin can confirm or reject a payment proof right on its chat card, on every screen size.
  const reviewDrafts=new Map(),reviewErrors=new Map();
  function proofReview(p){
    if(!admin||p.status!=='verification_pending')return '';
    const id='pay-reason-'+p.id;
    return '<form class="chat-proof-review" data-pay-review="'+escapeHtml(p.id)+'"><p class="chat-proof-hint">Check that '+money(p.amount)+' actually arrived in the bank or wallet before confirming.</p><label for="'+id+'">Bank note <small>(optional to confirm, needed to reject)</small></label><input id="'+id+'" name="reason" maxlength="1000" autocomplete="off" placeholder="e.g. Received 2:04 PM, ref 34688789" value="'+escapeHtml(reviewDrafts.get(p.id)||'')+'"><div class="chat-proof-actions"><button type="submit" class="is-confirm" data-decision="paid">✓ Confirm payment</button><button type="submit" class="is-reject" data-decision="rejected">Reject</button></div><p class="chat-proof-error" role="alert">'+escapeHtml(reviewErrors.get(p.id)||'')+'</p></form>';
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
    if(!reason&&decision!=='paid'){alert.textContent='Write the reason so the customer knows what to fix.';form.elements.reason.focus();return;}
    if(!p){alert.textContent='This payment was already handled. Refreshing…';await refresh();return;}
    reviewErrors.delete(p.id);alert.textContent='';
    const button=event.submitter;
    if(!await ask(decision==='paid'?'Mark '+money(p.amount)+' as received for this order? Only confirm after checking the money arrived.':'The customer will be asked to send a new payment proof.',{title:decision==='paid'?'Confirm payment?':'Reject this proof?',confirm:decision==='paid'?'Confirm payment':'Reject proof',tone:decision==='paid'?'success':'danger'}))return;
    form.querySelectorAll('button').forEach(b=>b.disabled=true);if(button)button.textContent=decision==='paid'?'Confirming…':'Rejecting…';
    try{await db.rpc('review_order_payment',{target_payment:p.id,decision,review_reason:reason||'Amount checked and received ('+money(p.amount)+'), confirmed in chat.'});reviewDrafts.delete(p.id);}
    catch(error){
      // keep the message through live refreshes; a payment someone already handled just refreshes the chat
      const message=/already been processed/i.test(error.message)?'This payment was already reviewed. The chat is refreshed below.':/exceeds the order balance/i.test(error.message)?'This proof is more than the remaining balance. Reject it and ask the customer to send the exact amount.':error.message||'The payment could not be saved. Please try again.';
      reviewErrors.set(p.id,message);alert.textContent=message;form.querySelectorAll('button').forEach(b=>b.disabled=false);if(button)button.textContent=decision==='paid'?'✓ Confirm payment':'Reject';
      if(/already been processed/i.test(error.message))reviewErrors.delete(p.id);
    }
    try{await refresh();}catch(error){showError('The chat could not refresh: '+error.message);}
  };
  root.addEventListener('submit',root._payReviewSubmit);
  // Admin: a pending DIY order can be confirmed, given an additional price for custom work, or cancelled from its chat.
  let extraOpen=false;const extraDraft={amount:''};
  function orderActions(){
    if(!admin||!selected?.order_id)return '';
    const o=orders.find(row=>row.id===selected.order_id);
    if(!o||o.status!=='pending')return '';
    // only DIY-customized orders (their design card is in this chat) get Confirm / Additional price / Cancel here
    if(!messages.some(m=>m.message_type==='design_card'))return '';
    const r=o.price_review,waiting=r?.status==='awaiting',paying=Number(o.amount_paid||0)>0||payments.some(p=>p.order_id===o.id&&['awaiting_payment','verification_pending'].includes(p.status));
    const note=waiting?'Waiting for the customer to accept + '+money(r.amount)+'.':r?.status==='declined'?'The customer declined + '+money(r.amount)+'. Confirm at the current price, add a different amount, or cancel.':o.total_amount===null?'This order has no total yet.':'Total '+money(o.total_amount)+'. Payment opens for the customer once you confirm.';
    return '<section class="chat-order-actions-bar" aria-label="Order actions"><p>'+escapeHtml(note)+'</p><div class="chat-order-buttons">'+
      '<button type="button" class="is-confirm" data-order-act="confirm"'+(waiting||o.total_amount===null?' disabled':'')+'>✓ Confirm order</button>'+
      (paying?'':'<button type="button" class="is-extra" data-order-act="extra" aria-expanded="'+extraOpen+'">+ Additional price</button>')+
      '<button type="button" class="is-cancel" data-order-act="cancel">Cancel order</button></div>'+
      (extraOpen&&!paying?'<form class="chat-extra-form" id="chat-extra-form"><div class="chat-extra-fields"><label for="chat-extra-amount">Additional amount (₱)<input id="chat-extra-amount" name="amount" type="number" inputmode="decimal" min="1" max="100000" step="0.01" required value="'+escapeHtml(extraDraft.amount)+'" placeholder="e.g. 150"></label></div><div class="chat-proof-actions"><button type="submit" class="is-confirm">Send to customer</button><button type="button" class="is-reject" data-order-act="extra-close">Close</button></div></form>':'')+
      '<p class="chat-proof-error" role="alert"></p></section>';
  }
  if(root._extraInput)root.removeEventListener('input',root._extraInput);
  root._extraInput=event=>{if(event.target.closest('#chat-extra-form'))extraDraft[event.target.name]=event.target.value;};
  root.addEventListener('input',root._extraInput);
  function bindOrderActions(){
    const bar=root.querySelector('.chat-order-actions-bar');if(!bar)return;
    const o=orders.find(row=>row.id===selected.order_id),alert=bar.querySelector('[role=alert]');
    const busy=(button,text)=>{bar.querySelectorAll('button').forEach(b=>b.disabled=true);if(button)button.textContent=text;};
    const fail=error=>{alert.textContent=error.message;draw();const again=root.querySelector('.chat-order-actions-bar [role=alert]');if(again)again.textContent=error.message;};
    bar.querySelectorAll('[data-order-act]').forEach(button=>button.onclick=async()=>{
      const act=button.dataset.orderAct;
      if(act==='extra'||act==='extra-close'){extraOpen=act==='extra'?!extraOpen:false;draw();if(extraOpen)root.querySelector('#chat-extra-amount')?.focus();return;}
      const confirm=act==='confirm';
      if(!await ask(confirm?'The customer can pay the downpayment or the full '+money(o.total_amount)+' right after this.':'The customer is told the order is cancelled. This cannot be undone.',{title:confirm?'Confirm Order #'+o.order_number+'?':'Cancel Order #'+o.order_number+'?',confirm:confirm?'Confirm order':'Cancel order',cancel:confirm?'Not yet':'Keep order',tone:confirm?'success':'danger'}))return;
      busy(button,confirm?'Confirming…':'Cancelling…');
      try{await db.rpc('set_order_status',{order_id:o.id,next_status:confirm?'confirmed':'cancelled'});await refresh();}catch(error){fail(error);}
    });
    bar.querySelector('#chat-extra-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,amount=Number(form.elements.amount.value);
      if(!(amount>=1&&amount<=100000)){alert.textContent='Enter an amount between ₱1 and ₱100,000.';form.elements.amount.focus();return;}
      if(!await ask('Order #'+o.order_number+' goes up by '+money(amount)+(o.total_amount===null?'':' to '+money(Number(o.total_amount)+amount))+'. The customer accepts or declines it in this chat before paying.',{title:'Send the additional price?',confirm:'Send to customer'}))return;
      busy(event.submitter,'Sending…');
      try{await db.rpc('propose_order_extra',{target_order:o.id,amount,reason:''});extraOpen=false;extraDraft.amount='';await refresh();}catch(error){fail(error);}
    });
  }
  function context(){
    const o=orders.find(row=>row.id===selected?.order_id);
    if(!o){const p=profiles.find(row=>row.id===selected?.customer_id);return '<h2>Conversation details</h2>'+(admin?'<p>Customer: '+escapeHtml(p?.full_name||'Customer')+'</p><p>Phone: '+escapeHtml(p?.phone||'Not provided')+'</p>':'<p>Ask about products, custom orders, pickup, or delivery. A LexC team member can join this conversation.</p>');}
    const related=payments.filter(p=>p.order_id===o.id),p=related[0],balance=o.total_amount===null?null:Math.max(0,Number(o.total_amount)-Number(o.amount_paid||0));
    const balanceBox=admin&&balance!==null&&o.status!=='cancelled'?(balance>0?'<div class="chat-balance"><span>Remaining balance to be paid</span><strong>'+money(balance)+'</strong>'+(o.payment_status==='verification_pending'?'<small>A payment proof is waiting to be checked.</small>':'')+'</div>':'<div class="chat-balance is-paid"><span>Payment</span><strong>Fully paid ✓</strong></div>'):'';
    return '<h2>Order #'+escapeHtml(o.order_number)+'</h2>'+balanceBox+'<dl><dt>Customer</dt><dd>'+escapeHtml(o.customer_name)+'</dd><dt>Order status</dt><dd>'+escapeHtml(o.status)+'</dd><dt>Payment</dt><dd>'+escapeHtml(o.payment_status)+'</dd><dt>Total</dt><dd>'+(o.total_amount===null?'Waiting for quote':money(o.total_amount))+'</dd>'+(Number(o.vat_amount)>0?'<dt>VAT (in total)</dt><dd>'+money(o.vat_amount)+'</dd>':'')+'<dt>Downpayment due</dt><dd>'+(o.deposit_due===null?'Waiting for quote':money(o.deposit_due))+'</dd><dt>Verified paid</dt><dd>'+money(o.amount_paid)+'</dd><dt>Balance</dt><dd>'+(balance===null?'Waiting for quote':money(balance))+'</dd><dt>Fulfillment</dt><dd>'+escapeHtml(o.fulfillment_method)+'</dd><dt>Schedule</dt><dd>'+escapeHtml(stamp(o.receiving_start))+'</dd></dl>'+
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
  // Event cards in an order chat. Payment cards read the payment row; the status card reads the status from the
  // message itself, so older messages keep showing the status they announced.
  const KIND={downpayment:'Downpayment',full:'Full payment',balance:'Remaining balance'};
  const STEPS=[['pending','Placed'],['confirmed','Confirmed'],['preparing','Preparing'],['ready','Ready'],['completed','Done']];
  const when=value=>value?new Date(value).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'}):'';
  const orderOf=id=>orders.find(o=>o.id===id);
  const payLink=o=>'../payment/index.html?order='+encodeURIComponent(o.id);
  function paymentCard(m,p){
    const o=orderOf(p.order_id),balance=o&&o.total_amount!==null?Math.max(0,Number(o.total_amount)-Number(o.amount_paid||0)):null;
    const row=(label,value)=>value?'<span><b>'+escapeHtml(label)+'</b> '+escapeHtml(value)+'</span>':'';
    const receipt=p.proof_storage_path?'<button type="button" data-proof="'+escapeHtml(p.id)+'">View receipt</button>':'';
    const order=o?row('Order','#'+o.order_number):'';
    if(m.message_type==='payment_verified'){
      const next=balance===null?'':balance>0?'<div class="chat-proof-next"><span>Remaining balance <b>'+money(balance)+'</b></span>'+(!admin&&o.status!=='cancelled'?'<a href="'+payLink(o)+'">Pay the balance →</a>':'')+'</div>':'<div class="chat-proof-next is-done"><span>Order fully paid ✓</span></div>';
      return '<div class="chat-proof is-received"><strong><span class="chat-proof-mark" aria-hidden="true">✓</span>Payment received · '+money(p.amount)+'</strong>'+row('For',KIND[p.payment_kind]||'')+order+row('Reference',p.transaction_reference||'—')+row('Received',when(p.verified_at||m.created_at))+next+receipt+'</div>';
    }
    if(m.message_type==='payment_rejected'){
      return '<div class="chat-proof is-rejected"><strong>Receipt not accepted · '+money(p.amount)+'</strong>'+row('For',KIND[p.payment_kind]||'')+order+row('Reference',p.transaction_reference||'—')+row('Reason',p.rejection_reason||'See the payment page.')+
        (!admin&&o&&o.status!=='cancelled'?'<div class="chat-proof-next"><a href="'+payLink(o)+'">Upload a corrected receipt →</a></div>':'')+receipt+'</div>';
    }
    const state=p.status==='verification_pending'?'Being checked by LexC':p.status==='paid'?'Received ✓':p.status==='rejected'?'New receipt needed':p.status.replaceAll('_',' ');
    return '<div class="chat-proof"><strong>Payment proof · '+money(p.amount)+'</strong>'+row('For',KIND[p.payment_kind]||'')+order+row('Reference',p.transaction_reference||'—')+row('Status',state)+receipt+proofReview(p)+'</div>';
  }
  function statusCard(m,conversation){
    const o=orderOf(conversation?.order_id);if(!o)return '';
    const said=/confirmed your order/i.test(m.body)?'confirmed':(String(m.body).match(/changed to ([a-z ]+)\./i)||[])[1]?.trim().replaceAll(' ','_').toLowerCase();
    if(!said)return '';
    if(said==='cancelled')return '<div class="chat-statuscard is-cancelled"><strong>Order #'+escapeHtml(o.order_number)+' · Cancelled</strong></div>';
    const at=STEPS.findIndex(([k])=>k===said);if(at<0)return '';
    return '<div class="chat-statuscard"><strong>Order #'+escapeHtml(o.order_number)+' · '+escapeHtml(STEPS[at][1])+'</strong><ol class="chat-steps">'+STEPS.map(([,label],i)=>'<li class="'+(i<at?'is-done':i===at?'is-now':'')+'">'+escapeHtml(label)+'</li>').join('')+'</ol>'+
      (!admin&&said==='confirmed'&&o.status!=='cancelled'?'<a class="chat-status-link" href="'+payLink(o)+'">Open payment →</a>':!admin&&said==='ready'?'<a class="chat-status-link" href="'+payLink(o)+'">View order →</a>':'')+'</div>';
  }
  function messageCard(m){
    const p=payments.find(row=>row.id===m.payment_id);
    const eventClass=m.message_type!=='text'?' chat-event '+escapeHtml(m.message_type):'';
    return '<article data-mid="'+escapeHtml(m.id)+'" class="chat-message '+escapeHtml(m.sender_type)+eventClass+'"><div class="chat-bubble"><small>'+escapeHtml(sender(m))+'</small><p>'+escapeHtml(m.body)+'</p>'+designCardHTML(m)+
      (p&&['payment_proof','payment_verified','payment_rejected'].includes(m.message_type)?paymentCard(m,p):'')+(m.message_type==='status_update'?statusCard(m,conversations.find(c=>c.id===m.conversation_id)||selected):'')+
      (m.message_type==='delivery_update'&&window.LexcDelivery?window.LexcDelivery.card(deliveries.find(d=>d.order_id===m.order_id),{compact:true,step:m.attachments?.step}):'')+
      '<time>'+escapeHtml(stamp(m.created_at))+'</time></div></article>';
  }
  function draw(){
    const visible=conversations.filter(c=>{const o=orders.find(x=>x.id===c.order_id);const term=(title(c)+' '+(o?.customer_name||'')+' '+(admin?personName(c):'')).toLowerCase();const archived=admin&&c.state==='resolved';return term.includes(search.trim().toLowerCase())&&(filter==='archived'?archived:!archived&&(filter==='all'||(filter==='orders'&&c.order_id)||(filter==='attention'&&c.state==='needs_admin')));});
    const keep=snapshot();
    const unread=new Map();for(const m of inboxMessages){if(!m.read_at&&(admin?m.sender_type==='customer':m.sender_type!=='customer'))unread.set(m.conversation_id,(unread.get(m.conversation_id)||0)+1);}
    root.innerHTML='<div class="chat-workspace '+(selected&&!mobileListOpen?'has-thread':'')+'"><aside class="chat-inbox"><header><div><h1>'+(admin?'Customer conversations':'Messages')+'</h1><p>'+(admin?'Customer support and order conversations':'Chat with LexC’s Snacktime')+'</p></div>'+(admin?'':'<a class="chat-new-link" href="?new=1">New chat</a>')+'</header><label class="chat-search">Search conversations<input id="chat-search" type="search" value="'+escapeHtml(search)+'" placeholder="'+(admin?'Customer name or order':'Order or customer')+'"></label><div class="chat-filters"><button type="button" data-filter="all" '+(filter==='all'?'aria-pressed="true"':'')+'>All</button><button type="button" data-filter="orders" '+(filter==='orders'?'aria-pressed="true"':'')+'>Orders</button><button type="button" data-filter="attention" '+(filter==='attention'?'aria-pressed="true"':'')+'>Needs attention</button>'+(admin?'<button type="button" data-filter="archived" '+(filter==='archived'?'aria-pressed="true"':'')+'>Archived</button>':'')+'</div><div class="chat-rows">'+(visible.length&&admin?customerGroups(visible).map(g=>customerRow(g,unread)).join(''):visible.length?visible.map(c=>{const latest=inboxMessages.find(m=>m.conversation_id===c.id);return '<button type="button" class="chat-row '+(selected?.id===c.id?'selected':'')+'" data-thread="'+escapeHtml(c.id)+'"><strong>'+escapeHtml(title(c))+(unread.get(c.id)?'<b class="chat-unread">'+unread.get(c.id)+'</b>':'')+'</strong><span>'+escapeHtml(orders.find(o=>o.id===c.order_id)?.customer_name||(admin?'Customer':'General conversation'))+'</span><small>'+escapeHtml(latest?.body?.slice(0,65)||c.state.replaceAll('_',' '))+'</small></button>';}).join(''):'<p class="chat-empty">No conversations yet.</p>')+'</div></aside><section class="chat-thread">'+(selected?'<header><button type="button" id="chat-back" aria-label="'+(admin?'Back to conversations':'Back to the shop')+'"><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><div><h2>'+escapeHtml(admin?personName(selected):title(selected))+'</h2>'+(admin?replyPicker():'')+'<span>'+escapeHtml(selected.state==='needs_admin'?'A LexC team member will reply':selected.state==='resolved'?(admin?'Archived · reopens if the customer writes again':'Conversation closed · write anytime to reopen'):selected.state)+'</span></div>'+(admin?'<button type="button" class="chat-archive" data-archive="'+(selected.state==='resolved'?'0':'1')+'">'+(selected.state==='resolved'?'Unarchive':'Archive')+'</button>':'')+'</header>'+orderActions()+'<div class="chat-stream">'+(messages.length?messages.map((m,i)=>(admin&&(i===0||messages[i-1].conversation_id!==m.conversation_id)?'<div class="chat-thread-divider"><span>'+escapeHtml(title(conversations.find(c=>c.id===m.conversation_id)||selected))+'</span></div>':'')+messageCard(m)).join(''):'<div class="chat-empty">Send a message to start this conversation.</div>')+'</div>'+pendingPicturesHTML(pendingPictures,'page')+'<form id="chat-compose"><input type="file" id="chat-pic-input" accept="image/jpeg,image/png,image/webp" multiple hidden><button type="button" class="chat-attach" id="chat-attach" aria-label="Add a picture" title="Add a picture (up to '+CHAT_PICTURE_MAX+')"'+(pendingPictures.length>=CHAT_PICTURE_MAX?' disabled':'')+'><svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14"/><path d="M3 16l5-5 4 4 3-3 6 6"/><path d="M15.5 9h.01"/></svg></button>'+'<label class="visually-hidden" for="chat-text">Message</label><textarea id="chat-text" name="body" maxlength="3000" rows="2" placeholder="'+(pendingPictures.length?'Add a message (optional)…':'Write a message…')+'"></textarea><button type="submit">Send</button></form>':admin?'<div class="chat-empty">Select a conversation.</div>':'<div class="chat-empty">No messages yet.<br><button type="button" id="chat-start">Start chatting with LexC’s Admin</button></div>')+'</section><aside class="chat-context">'+(selected?context():'<h2>Order context</h2><p>Select a conversation to see its linked order.</p>')+'</aside></div><p class="chat-error" role="alert" hidden></p>';
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
    bindOrderActions();
    const contextPanel=root.querySelector('.chat-context');
    if(contextPanel&&selected){const close=document.createElement('button');close.type='button';close.className='chat-context-close';close.setAttribute('aria-label','Close details');close.innerHTML='<span aria-hidden="true">×</span>';close.addEventListener('click',closeDetails);contextPanel.prepend(close);}
    root.querySelectorAll('[data-thread]').forEach(button=>{
      const conversation=conversations.find(c=>c.id===button.dataset.thread);
      const group=admin?conversations.filter(c=>c.customer_id===conversation?.customer_id):[conversation];
      const person=admin?personName(conversation):profiles.find(p=>p.id===conversation?.customer_id)?.full_name||orders.find(o=>o.id===conversation?.order_id)?.customer_name||'Customer';
      const avatar=document.createElement('span');avatar.className='chat-row-avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=admin?person.trim().charAt(0).toUpperCase():'🧁';button.prepend(avatar);
      const needs=group.some(c=>c?.state==='needs_admin');const state=document.createElement('em');state.className='chat-row-state'+(needs?' needs-attention':'');state.textContent=needs?'Needs reply':admin&&group.every(c=>c?.state==='resolved')?'Archived':admin?'Customer':conversation?.order_id?'Order chat':'General';button.append(state);
    });
    root.querySelectorAll('[data-thread]').forEach(button=>button.onclick=async()=>{selected=conversations.find(c=>c.id===button.dataset.thread);mobileListOpen=false;const stream=root.querySelector('.chat-stream');if(stream)stream.outerHTML=threadSkeleton();try{await loadMessages();draw();const s=root.querySelector('.chat-stream');if(s)s.scrollTop=s.scrollHeight;}catch(error){showError('Conversation could not load. Please choose it again.');}});
    root.querySelector('#chat-reply-in')?.addEventListener('change',event=>{const next=conversations.find(c=>c.id===event.target.value);if(next){selected=next;draw();}});
    root.querySelector('#chat-back')?.addEventListener('click',()=>{if(!admin){if(document.referrer.startsWith(location.origin)&&history.length>1)history.back();else location.href='../';return;}mobileListOpen=true;root.querySelector('.chat-workspace').classList.remove('has-thread');});   // customers have one thread, so Back leaves the chat
    root.querySelector('#chat-start')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{if(orderId&&!orders.some(o=>o.id===orderId&&o.customer_id===user.id))throw new Error('This order is not available to your account.');selected=await ensureCustomerChat({userId:user.id,orderId});await refresh(false);}catch(error){showError(error.message);button.disabled=false;}});
    root.querySelectorAll('[data-quick-message]').forEach(button=>button.onclick=()=>{const input=root.querySelector('#chat-text');if(input){input.value=button.dataset.quickMessage;input.focus();}});
    root.querySelector('#chat-search')?.addEventListener('input',e=>{search=e.target.value;draw();});
    root.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;draw();});
    // admin: archive a finished conversation (kept in full under Archived; a new customer message reopens it)
    root.querySelector('[data-archive]')?.addEventListener('click',async event=>{const button=event.currentTarget,archived=button.dataset.archive==='1';button.disabled=true;
      try{const row=await db.rpc('set_chat_archived',{conversation_id:selected.id,archived});const c=conversations.find(x=>x.id===selected.id);if(c)c.state=row.state;selected.state=row.state;
        if(archived&&filter!=='archived'){selected=null;mobileListOpen=true;}draw();}
      catch(error){button.disabled=false;showError(/set_chat_archived|schema cache|could not find the function/i.test(error.message)?'Archiving needs a one-time database update: run database/phase70-chat-archive.sql in the Supabase SQL editor.':error.message);}});
    root.querySelector('#chat-attach')?.addEventListener('click',()=>root.querySelector('#chat-pic-input')?.click());
    root.querySelector('#chat-pic-input')?.addEventListener('change',event=>{const note=pickPictures(event.target,pendingPictures);const text=root.querySelector('#chat-text')?.value||'';draw();const input=root.querySelector('#chat-text');if(input){input.value=text;input.focus();}if(note)showError(note);});
    root.querySelectorAll('[data-unpick="page"]').forEach(button=>button.onclick=()=>{const [p]=pendingPictures.splice(Number(button.dataset.index),1);if(p)URL.revokeObjectURL(p.url);const text=root.querySelector('#chat-text')?.value||'';draw();const input=root.querySelector('#chat-text');if(input)input.value=text;});
    root.querySelector('#chat-compose')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]'),body=form.elements.body.value.trim(),pictures=pendingPictures.length>0;if((!body&&!pictures)||button.disabled)return;button.disabled=true;if(pictures)button.textContent='Sending…';try{if(pictures)await sendChatPictures({conversationId:selected.id,userId:user.id,pending:pendingPictures,caption:body,folder:admin?selected.customer_id:user.id});else await sendChatMessage({conversationId:selected.id,userId:user.id,admin,body});form.reset();await refresh();root.querySelector('.chat-stream')?.scrollTo(0,999999);}catch(error){showError(error.message);button.disabled=false;button.textContent='Send';}});
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
