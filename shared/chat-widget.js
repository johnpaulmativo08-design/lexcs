import {readChatThread,markChatRead,sendChatMessage,ensureCustomerChat,subscribeChatChanges,designCardHTML,hydrateDesignImages} from './chat.js?v=19';

const db=window.LexcBackend;
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const time=value=>new Date(value).toLocaleTimeString('en-PH',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Manila'});
const mobile=()=>matchMedia('(max-width: 800px)').matches;
const maxPopups=()=>matchMedia('(max-width: 1120px)').matches?1:2;

export async function mountChatWidget({admin=false}={}){
  const trigger=document.querySelector(admin?'#admin-chats-toggle':'#customer-chat-toggle');
  if(!trigger||trigger.dataset.mounted)return;
  trigger.dataset.mounted='true';
  const root=document.createElement('div');root.id=admin?'admin-chat-ui':'customer-chat-ui';root.className='lexc-chat-ui';document.body.append(root);
  let identity=null,adminOnStore=false,conversations=[],orders=[],profiles=[],latest=[],unreadRows=[],drawer=false,filter='all',search='',popupIds=[],minimized=new Set(),expanded=false,threads=new Map(),drafts=new Map(),scrollPositions=new Map(),sending=new Set(),error='',loading=true,unsub=null,fallback=null,request=0,connecting=null;
  const current=()=>admin?(mobile()?popupIds.at(-1):null):popupIds[0];
  const conversation=id=>conversations.find(c=>c.id===id);
  const order=c=>orders.find(o=>o.id===c?.order_id);
  const title=c=>admin?(order(c)?.customer_name||profiles.find(p=>p.id===c?.customer_id)?.full_name||'Customer'):"LexC’s Admin";
  const unread=id=>unreadRows.filter(m=>m.conversation_id===id).length;
  const skeletonLine=(width='')=>`<span class="skel skel-line ${width==='wide'?'skel-line--long':width==='short'?'skel-line--short':''}"></span>`;
  const inboxSkeleton=()=>`<div class="lcw-skeleton-list" aria-hidden="true">${Array.from({length:5},()=>`<div class="lcw-skeleton-row"><span class="skel skel-circle"></span><span>${skeletonLine('medium')}${skeletonLine('wide')}</span><span class="skel skel-badge"></span></div>`).join('')}</div>`;
  const messageSkeleton=()=>`<div class="lcw-skeleton-thread" aria-hidden="true"><div>${skeletonLine('wide')}${skeletonLine('medium')}</div><div class="mine">${skeletonLine('medium')}${skeletonLine('short')}</div><div>${skeletonLine('wide')}${skeletonLine('short')}</div></div>`;
  const active=id=>popupIds.includes(id)&&!minimized.has(id)&&(admin?(!mobile()||drawer&&current()===id):drawer);
  function badge(){const n=admin?conversations.filter(c=>unread(c.id)).length:unreadRows.length;const node=trigger.querySelector('[data-chat-count]');if(node){node.textContent=n;node.hidden=!n;}trigger.setAttribute('aria-label',admin?`Chats${n?`, ${n} unread`:''}`:`Chat with LexC’s Admin${n?`, ${n} unread`:''}`);}
  async function refresh(){
    const token=++request;
    const rows=await Promise.all([
      db.client.from('chat_conversations').select('id,customer_id,order_id,state,updated_at').order('updated_at',{ascending:false}).limit(200).then(db.unwrap),
      admin?db.client.from('orders').select('id,order_number,customer_name').order('created_at',{ascending:false}).limit(300).then(db.unwrap):Promise.resolve([]),
      admin?db.client.from('profiles').select('id,full_name').limit(500).then(db.unwrap):Promise.resolve([]),
      db.client.from('chat_messages').select('conversation_id,body,created_at,sender_type').order('created_at',{ascending:false}).limit(800).then(db.unwrap),
      (admin?db.client.from('chat_messages').select('id,conversation_id,sender_type,read_at').is('read_at',null).eq('sender_type','customer'):db.client.from('chat_messages').select('id,conversation_id,sender_type,read_at').is('read_at',null).neq('sender_type','customer')).limit(2000).then(db.unwrap)
    ]);
    if(token!==request)return;
    [conversations,orders,profiles,latest,unreadRows]=rows;loading=false;
    if(!admin&&!popupIds.length){const c=conversations.find(c=>!c.order_id)||conversations[0];if(c)popupIds=[c.id];}
    badge();draw();
    await Promise.all(popupIds.filter(active).map(id=>loadThread(id)));
  }
  async function loadThread(id){
    if(!conversation(id))return;
    const reader=identity?.id,rows=await readChatThread(id);if(identity?.id!==reader)return;threads.set(id,rows);
    if(active(id)){
      try{await markChatRead(rows,{admin});unreadRows=unreadRows.filter(m=>m.conversation_id!==id);}catch(err){console.warn('Chat read state:',err);}
    }
    badge();draw();
  }
  function capture(){root.querySelectorAll('[data-compose]').forEach(form=>{drafts.set(form.dataset.compose,form.elements.body.value);});root.querySelectorAll('[data-stream]').forEach(stream=>{scrollPositions.set(stream.dataset.stream,stream.scrollHeight-stream.clientHeight-stream.scrollTop<24?null:stream.scrollTop);});}
  function messageView(id){if(!threads.has(id))return messageSkeleton();const rows=threads.get(id)||[];return rows.length?rows.map(m=>`<div class="lcw-message ${esc(m.sender_type)} ${m.sender_type===(admin?'admin':'customer')?'mine':''}"><div>${esc(m.body)}${designCardHTML(m)}<time>${time(m.created_at)}</time></div></div>`).join(''):'<p class="lcw-empty">No messages yet. Send a message to start the conversation.</p>';}
  function composer(id){return `<form class="lcw-compose" data-compose="${esc(id)}"><label class="lcw-sr" for="lcw-text-${esc(id)}">Message</label><textarea id="lcw-text-${esc(id)}" name="body" rows="1" maxlength="3000" placeholder="${admin?'Reply to customer…':'Message LexC’s Admin…'}" required>${esc(drafts.get(id)||'')}</textarea><button type="submit" aria-label="Send message" ${sending.has(id)?'disabled':''}>➤</button></form>`;}
  function threadView(id,{popup=false}={}){
    const c=conversation(id),o=order(c),mini=minimized.has(id);
    return `<section class="lcw-thread ${popup?'lcw-popup':''} ${mini?'is-minimized':''}" data-thread="${esc(id)}" aria-label="Chat with ${esc(title(c))}"><header><span class="lcw-avatar">${esc(title(c).charAt(0).toUpperCase())}</span><span class="lcw-title"><strong>${esc(title(c))}</strong><small>${admin?'Customer':'LexC’s Snacktime'}</small></span>${admin&&mobile()?'<button type="button" data-action="back" aria-label="Back to customer inbox">←</button>':''}<button type="button" data-action="minimize" data-id="${esc(id)}" aria-label="${mini?'Restore':'Minimize'} chat">${mini?'▢':'—'}</button>${!admin?`<button type="button" data-action="expand" aria-label="${expanded?'Restore tray':'Expand chat'}">${expanded?'↙':'↗'}</button>`:''}<button type="button" data-action="close" data-id="${esc(id)}" aria-label="Close chat">×</button></header>${mini?'':`${o?`<div class="lcw-order">Order #${esc(o.order_number)} · ${esc(c.state||'Open')}</div>`:''}<div class="lcw-stream" data-stream="${esc(id)}">${messageView(id)}</div>${composer(id)}`}</section>`;
  }
  function listView(){const rows=conversations.filter(c=>{if(filter==='unread'&&!unread(c.id))return false;if(filter==='orders'&&!c.order_id)return false;const term=search.toLowerCase();return !term||[title(c),order(c)?.order_number,c.order_id].some(v=>String(v||'').toLowerCase().includes(term));});return `<aside class="lcw-drawer" aria-label="Customer chats"><header><h2>Chats</h2><button type="button" data-action="drawer-close" aria-label="Close chats">×</button></header><div class="lcw-list-tools"><input type="search" data-search aria-label="Search customers or orders" placeholder="Search customer or order…" value="${esc(search)}"><div class="lcw-filters">${[['all','All'],['unread','Unread'],['orders','Orders']].map(([key,label])=>`<button type="button" data-filter="${key}" aria-pressed="${filter===key}">${label}</button>`).join('')}</div></div><div class="lcw-list" aria-busy="${loading}">${loading?inboxSkeleton():error&&!rows.length?'<div class="lcw-empty" role="alert">Chats could not load. <button type="button" data-action="retry">Try again</button></div>':rows.length?rows.map(c=>{const m=latest.find(x=>x.conversation_id===c.id),o=order(c);return `<button type="button" class="lcw-row" data-open="${esc(c.id)}"><span class="lcw-avatar">${esc(title(c).charAt(0).toUpperCase())}</span><span><strong>${esc(title(c))}</strong><small>${esc(o?'Order #'+o.order_number:m?.body||'General inquiry')}</small>${o&&m?`<small>${esc(m.body)}</small>`:''}</span>${unread(c.id)?'<i aria-label="Unread messages"></i>':''}</button>`;}).join(''):'<p class="lcw-empty">No customer conversations found.</p>'}</div></aside>`;}
  function draw(){capture();trigger.setAttribute('aria-expanded',String(admin?drawer:!!root.querySelector('.lcw-tray')));if(admin){
      root.innerHTML=`<div class="lcw-popup-stack">${popupIds.filter(id=>conversation(id)).slice(-maxPopups()).map(id=>threadView(id,{popup:true})).join('')}</div>${drawer?(mobile()&&current()?`<div class="lcw-mobile-thread">${threadView(current())}</div>`:listView()):''}${error?`<p class="lcw-error" role="alert">${esc(error)}</p>`:''}`;
    }else{
      const id=popupIds[0],c=conversation(id),isOpen=drawer;
      root.classList.toggle('is-expanded',expanded);
      root.innerHTML=isOpen?`<div class="lcw-tray">${c?threadView(id):`<section class="lcw-thread"><header><span class="lcw-avatar">L</span><span class="lcw-title"><strong>LexC’s Admin</strong><small>LexC’s Snacktime</small></span><button type="button" data-action="minimize" aria-label="Minimize chat">—</button><button type="button" data-action="close" aria-label="Close chat">×</button></header><div class="lcw-stream"><p class="lcw-empty">Hi! Ask us about your order, pickup, delivery, or treats.</p></div>${identity?composer('new'):adminOnStore?'<p class="lcw-signin">Use the <a href="/admin/#dashboard">Admin Chats</a> workspace to reply to customers.</p>':'<p class="lcw-signin">Please <a href="/?return=chat">sign in</a> to message us.</p>'}</section>`}</div>${error?`<p class="lcw-error" role="alert">${esc(error)}</p>`:''}`:'';
      trigger.hidden=isOpen;trigger.classList.toggle('lcw-minimized',minimized.size>0&&!isOpen);trigger.innerHTML=(minimized.size&&!isOpen?'<span class="lcw-avatar">L</span>':'<svg class="ui-icon ui-icon--small" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.1 9.1 0 0 1-4-.9L3 21l1.5-4.4A8.4 8.4 0 1 1 21 11.5Z"/></svg><span>Chat</span>')+'<span data-chat-count hidden></span>';
      badge();
    }
    hydrateDesignImages(root);
    root.querySelectorAll('[data-stream]').forEach(el=>{const saved=scrollPositions.get(el.dataset.stream);el.scrollTop=saved==null?el.scrollHeight:saved;});
    trigger.setAttribute('aria-expanded',String(drawer));
  }
  async function open(id){capture();error='';if(mobile()&&admin){popupIds=[id];drawer=true;}else{popupIds=popupIds.filter(x=>x!==id);popupIds.push(id);while(popupIds.length>maxPopups())popupIds.shift();drawer=false;}minimized.delete(id);draw();await loadThread(id);}
  async function send(id,body){if(sending.has(id)||!body.trim()||!identity)return;sending.add(id);error='';draw();try{let target=id;if(id==='new'){const c=await ensureCustomerChat({userId:identity.id});conversations.unshift(c);target=c.id;popupIds=[target];drafts.delete('new');}await sendChatMessage({conversationId:target,userId:identity.id,admin,body});const field=root.querySelector(`form[data-compose="${id}"] textarea`);if(field)field.value='';drafts.delete(target);await refresh();await loadThread(target);}catch(err){error=err.message;draw();}finally{sending.delete(id);draw();}}
  trigger.addEventListener('click',async()=>{error='';if(admin){drawer=!drawer;draw();}else{drawer=true;minimized.clear();draw();if(popupIds[0])await loadThread(popupIds[0]);}trigger.setAttribute('aria-expanded',String(drawer));});
  root.addEventListener('click',async e=>{const button=e.target.closest('button');if(!button)return;capture();if(button.dataset.filter){filter=button.dataset.filter;draw();return;}if(button.dataset.open){await open(button.dataset.open);return;}switch(button.dataset.action){case 'retry':loading=true;error='';draw();await connect();break;case 'drawer-close':drawer=false;draw();break;case 'back':popupIds=[];draw();break;case 'minimize':if(admin){const id=button.dataset.id;minimized.has(id)?minimized.delete(id):minimized.add(id);}else{drawer=false;minimized.add(popupIds[0]||'new');}draw();break;case 'close':if(admin){popupIds=popupIds.filter(id=>id!==button.dataset.id);minimized.delete(button.dataset.id);}else{drawer=false;expanded=false;minimized.clear();}draw();break;case 'expand':expanded=!expanded;draw();break;}});
  root.addEventListener('input',e=>{if(e.target.matches('[data-search]')){search=e.target.value;const focus=e.target.selectionStart;draw();const field=root.querySelector('[data-search]');field?.focus();field?.setSelectionRange(focus,focus);}else if(e.target.matches('textarea')){drafts.set(e.target.form.dataset.compose,e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';}});
  root.addEventListener('keydown',e=>{if(e.target.matches('textarea')&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.target.form.requestSubmit();}});
  root.addEventListener('submit',e=>{if(!e.target.matches('[data-compose]'))return;e.preventDefault();const form=e.target,id=form.dataset.compose,body=form.elements.body.value;send(id,body);});
  matchMedia('(max-width: 800px)').addEventListener('change',()=>{if(admin&&mobile())popupIds=popupIds.slice(-1);draw();});
  function connect(){if(connecting)return connecting;connecting=(async()=>{
    identity=await db.identity();adminOnStore=!admin&&identity?.role==='admin';if(adminOnStore)identity=null;
    if(!identity||admin&&identity.role!=='admin'){loading=false;if(!admin)draw();return;}
    await refresh();unsub?.();unsub=subscribeChatChanges(()=>{clearTimeout(root._chatRefresh);root._chatRefresh=setTimeout(()=>refresh().catch(err=>{error=err.message;draw();}),150);},status=>{if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status)&&!fallback)fallback=setInterval(()=>refresh().catch(console.warn),30000);if(status==='SUBSCRIBED'&&fallback){clearInterval(fallback);fallback=null;}});
  })().catch(err=>{loading=false;error=err.message;draw();}).finally(()=>{connecting=null;});return connecting;}
  const {data:{subscription}}=db.client.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT'){request++;unsub?.();unsub=null;if(fallback)clearInterval(fallback);fallback=null;identity=null;adminOnStore=false;conversations=[];orders=[];profiles=[];latest=[];unreadRows=[];popupIds=[];threads.clear();drafts.clear();drawer=false;error='';draw();}
    else if(event==='SIGNED_IN'&&!identity)setTimeout(()=>connect(),0);
  });
  await connect();
  window.addEventListener('pagehide',()=>{unsub?.();subscription.unsubscribe();if(fallback)clearInterval(fallback);},{once:true});
}
