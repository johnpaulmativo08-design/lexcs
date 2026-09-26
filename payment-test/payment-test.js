const backend=window.LexcBackend;
const loginPanel=document.getElementById('login-panel');
const testPanel=document.getElementById('test-panel');
const notice=document.getElementById('notice');
let currentUser=null;
let currentTest=null;

const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const statusLabel={awaiting_transfer:'Awaiting transfer',submitted:'Waiting for Admin review',verified:'Verified · ₱1 received',rejected:'Not verified'};
function message(text,error=false){notice.textContent=text;notice.hidden=!text;notice.classList.toggle('error',error);}
function renderTest(test){
  currentTest=test;
  document.getElementById('active-test').hidden=false;
  document.getElementById('test-id').textContent='#'+test.id.slice(0,8);
  document.getElementById('test-state').textContent=statusLabel[test.status]||test.status;
  document.getElementById('payment-instructions').hidden=!['awaiting_transfer','rejected'].includes(test.status);
  if(test.status==='rejected')message(test.review_note||'Admin could not match the transfer. Check your details and resubmit the correct reference.',true);
}
async function loadHistory(){
  const rows=backend.unwrap(await backend.client.from('payment_tests').select('*').order('created_at',{ascending:false}));
  document.getElementById('test-history').innerHTML=rows.length?rows.map(row=>
    '<div class="history-row"><strong>₱1.00 MariBank QR test <span class="status '+escapeHtml(row.status)+'">'+escapeHtml(statusLabel[row.status]||row.status)+'</span></strong><span>'+escapeHtml(new Date(row.created_at).toLocaleString('en-PH'))+'</span>'+(row.payment_reference?'<br>Reference: '+escapeHtml(row.payment_reference):'')+(row.review_note?'<br>Admin note: '+escapeHtml(row.review_note):'')+'</div>'
  ).join(''):'No tests yet. Start one above.';
  if(!currentTest&&rows[0]&&rows[0].status!=='verified')renderTest(rows[0]);
  else if(currentTest){const fresh=rows.find(row=>row.id===currentTest.id);if(fresh)renderTest(fresh);}
}
async function refresh(){
  try{currentUser=await backend.identity();}catch(error){message(error.message,true);}
  loginPanel.hidden=!!currentUser;testPanel.hidden=!currentUser;
  if(currentUser){document.getElementById('customer-name').textContent='Signed in as '+(currentUser.name||currentUser.email);await loadHistory();}
}
document.getElementById('login-form').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{await backend.signIn(form.elements.email.value,form.elements.password.value);message('Signed in.');await refresh();}
  catch(error){message(error.message,true);}finally{button.disabled=false;}
};
document.getElementById('sign-out').onclick=async()=>{await backend.signOut();currentTest=null;message('Signed out.');await refresh();};
document.getElementById('start-test').onclick=async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{const test=await backend.rpc('start_payment_test',{request_id:crypto.randomUUID()});renderTest(test);message('Test started. Only transfer after confirming the recipient in your banking app.');await loadHistory();}
  catch(error){message(error.message,true);}finally{button.disabled=false;}
};
document.getElementById('reference-form').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
  try{const test=await backend.rpc('submit_payment_test',{test_id:currentTest.id,transfer_reference:form.elements.reference.value.trim()});renderTest(test);message('Reference submitted. Admin will verify the actual MariBank credit.');await loadHistory();}
  catch(error){message(error.message,true);}finally{button.disabled=false;}
};
refresh().catch(error=>message(error.message,true));
