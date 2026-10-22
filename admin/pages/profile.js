import {escapeHtml as e,icon,notice} from '../components.js?v=3';
import {db,rows,field,fail,loadingForm,skel} from '../backend-ui.js?v=3';
// live password checklist (same rules as the shop)
const PW_RULES=[["len","At least 8 characters",p=>p.length>=8],["cap","One capital letter (A–Z)",p=>/[A-Z]/.test(p)],["num","One number (0–9)",p=>/[0-9]/.test(p)],["spec","At most one special character (optional)",p=>(p.match(/[^A-Za-z0-9]/g)||[]).length<=1]];
const pwChecks=()=>'<ul class="pw-checks" data-pw-checks aria-live="polite">'+PW_RULES.map(([k,t])=>'<li data-rule="'+k+'">'+t+'</li>').join("")+'<li data-rule="match" hidden>Passwords match</li></ul>';
// Transfer admin access: hand the admin role to another account you own (e.g. your Gmail); this account is retired.
// The database checks everything (phase72): current admin, signed in within 5 minutes, target exists and has a
// confirmed email. This page re-checks the password first so that 5-minute window is fresh.
function renderTransfer(content,user,head,card){
 content.innerHTML=head+'<div class="profile-layout">'+card+'<section class="profile-form panel"><h2>Transfer Admin Access</h2><form class="form-body" data-transfer>'+
  '<p class="profile-forgot">Move the admin role to another account you own, for example your Gmail. That account becomes the admin. This one (<strong>'+e(user.email)+'</strong>) is retired: it can never sign in again and its email stops belonging to any account. Past records still show it as who did them, and orders, payments, stock and chats stay exactly as they are.</p>'+
  '<p class="notice">Before you start: sign up on the shop with the new email and confirm it with the 6-digit code (or use Continue with Google). Only an account with a confirmed email can receive admin access.</p>'+
  field('target','New admin email','','email','required autocomplete="off" placeholder="name@gmail.com"')+
  field('password','Your current password','','password','required autocomplete="current-password"')+
  field('confirm','Type TRANSFER to confirm','','text','required autocomplete="off" autocapitalize="characters" spellcheck="false"')+
  '<p role="alert"></p><button class="button primary">'+icon('profile')+' Transfer admin access</button></form></section></div>';
 const form=content.querySelector('[data-transfer]'),alert=form.querySelector('[role=alert]');
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button.primary');alert.textContent='';
  const target=form.elements.target.value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(target)){alert.textContent='Enter the full email address of the new admin account.';return;}
  if(target===String(user.email).toLowerCase()){alert.textContent='That is already the admin account.';return;}
  if(form.elements.confirm.value.trim()!=='TRANSFER'){alert.textContent='Type TRANSFER in capital letters to confirm.';return;}
  button.disabled=true;
  try{
   try{await db.signIn(user.email,form.elements.password.value);}catch(error){throw new Error(/invalid login credentials/i.test(error.message)?'Your current password is incorrect.':error.message);}
   await db.rpc('transfer_admin',{target_email:target});
   form.outerHTML='<div class="form-body"><p class="notice">Done. <strong>'+e(target)+'</strong> is now the admin. This account is retired. Signing you out…</p></div>';
   try{sessionStorage.setItem('lexc_admin_moved_to',target);}catch{}
   setTimeout(async()=>{try{await db.client.auth.signOut({scope:'local'});}catch{}location.replace('../');},2500);   // its sessions were already ended in the database
  }catch(error){button.disabled=false;alert.textContent=/transfer_admin|schema cache|could not find the function/i.test(error.message)?'Transferring needs a one-time database update: run database/phase72-transfer-admin-access.sql in the Supabase SQL editor.':error.message;}
 };
}
// Forgot password, done here: email a 6-digit code (the same Supabase recovery email the shop uses), then enter it
// with a new password. The admin never has to go through the shop's log-in page.
const resetBlock=user=>'<div class="profile-reset"><p class="profile-forgot">Forgot your password? <button type="button" class="text-button" data-forgot>Email me a reset code</button></p>'+
 '<form class="form-body profile-reset-form" data-reset hidden><p class="profile-reset-sent">We sent a 6-digit code to <strong>'+e(user.email)+'</strong>. It may take a minute to arrive.</p>'+
 field('code','6-digit code','','text','inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" required')+
 field('password','New password','','password','minlength="8" autocomplete="new-password" required')+pwChecks()+field('confirm','Confirm new password','','password','minlength="8" autocomplete="new-password" required')+
 '<p role="alert"></p><div class="profile-reset-actions"><button class="button primary" type="submit">'+icon('save')+' Reset password</button><button type="button" class="text-button" data-resend>Send a new code</button></div></form></div>';
function wireReset(content,user){
 const form=content.querySelector('[data-reset]'),send=content.querySelector('[data-forgot]'),resend=form.querySelector('[data-resend]'),say=t=>{form.querySelector('[role=alert]').textContent=t;};
 const email=async(button,label)=>{button.disabled=true;const was=button.textContent;button.textContent='Sending…';
  try{db.unwrap(await db.client.auth.resetPasswordForEmail(user.email,{redirectTo:new URL('../index.html',location.href).href}));form.hidden=false;send.textContent='Code sent';form.elements.code.focus();return true;}
  catch(error){button.disabled=false;button.textContent=was;form.hidden=false;say(/rate|seconds|too many/i.test(error.message)?'Please wait a minute before asking for another code.':error.message);return false;}
  finally{if(label&&!button.disabled)button.textContent=label;}};
 send.onclick=()=>email(send);
 resend.onclick=async()=>{say('');if(await email(resend))say('A new code was sent to '+user.email+'.');setTimeout(()=>{resend.disabled=false;resend.textContent='Send a new code';},60000);};
 form.elements.code.addEventListener('input',()=>{const v=form.elements.code.value.replace(/\D/g,'').slice(0,6);if(v!==form.elements.code.value)form.elements.code.value=v;});
 form.addEventListener('input',()=>{const p=form.elements.password.value,c=form.elements.confirm.value,list=form.querySelector('[data-pw-checks]');PW_RULES.forEach(([k,,test])=>{const li=list.querySelector('[data-rule="'+k+'"]');li.classList.toggle('is-ok',!!p&&test(p));li.classList.toggle('is-bad',!!p&&!test(p));});const m=list.querySelector('[data-rule="match"]');m.hidden=!c;if(c){const ok=c===p;m.classList.toggle('is-ok',ok);m.classList.toggle('is-bad',!ok);m.textContent=ok?'Passwords match':'Passwords do not match yet';}});
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]');say('');
  const code=form.elements.code.value,p=form.elements.password.value;
  if(!/^\d{6}$/.test(code))return say('Enter all 6 digits of the code from the email.');
  if(!PW_RULES.every(([,,test])=>test(p)))return say('Use at least 8 characters with one capital letter and one number; at most one special character.');
  if(p!==form.elements.confirm.value)return say('The passwords do not match.');
  button.disabled=true;
  try{
   const checked=await db.client.auth.verifyOtp({email:user.email,token:code,type:'recovery'});
   if(checked.error)throw new Error(/expired|invalid|otp/i.test(checked.error.message)?'That code is wrong or has expired. Check the newest email, or send a new code.':checked.error.message);
   const up=await db.client.auth.updateUser({password:p});
   if(up.error)throw new Error(/same|different from the old/i.test(up.error.message)?'Choose a password different from your old one.':up.error.message);
   form.reset();form.querySelectorAll('[data-pw-checks] li').forEach(li=>li.classList.remove('is-ok','is-bad'));form.hidden=true;
   send.disabled=false;send.textContent='Email me a reset code';
   content.querySelector('.profile-forgot').insertAdjacentHTML('afterend','<p class="profile-reset-done" role="status">Password changed. Use the new password next time you log in.</p>');
  }catch(error){say(error.message);}finally{button.disabled=false;}};
}
export async function renderProfile(content,subpage){
 content.innerHTML='<header class="module-heading"><div><h1>Profile</h1><p>Manage your administrator information and account security.</p></div></header><div class="profile-layout"><section class="profile-card panel skel-stack" aria-label="Loading administrator profile">'+skel('circle')+skel('title')+skel('line','skel-line--short')+'</section><section class="profile-form panel"><h2>'+(subpage==='password'?'Change Password':'Personal Information')+'</h2>'+loadingForm(3)+'</section></div>';
 try{
  const user=await db.identity(),password=subpage==='password';
  // an account made with Continue with Google has no password until one is set here
  const google=(user.app_metadata?.providers||[user.app_metadata?.provider]).includes('google');
  const head='<header class="module-heading"><div><h1>Profile</h1><p>Manage your administrator information and account security.</p></div></header>';
  const card='<section class="profile-card panel"><div class="profile-initials">'+e(user.name.slice(0,2).toUpperCase())+'</div><h2>'+e(user.name)+'</h2><p>Administrator</p><a class="button" href="#profile">'+icon('profile')+' My Profile</a><a class="button" href="#profile/password">'+icon('archive')+' Change Password</a><a class="button" href="#profile/transfer">'+icon('arrow')+' Transfer Admin Access</a></section>';
  if(subpage==='transfer')return renderTransfer(content,user,head,card);
  content.innerHTML=head+'<div class="profile-layout">'+card+'<section class="profile-form panel"><h2>'+(password?'Change Password':'Personal Information')+'</h2><form class="form-body">'+(password?field('current','Current password','','password',google?'':'required')+(google?'<p class="profile-forgot">Signed up with Google and never set a password? Leave Current password blank.</p>':'')+field('password','New password','','password','minlength="8" required')+pwChecks()+field('confirm','Confirm password','','password','minlength="8" required'):field('full_name','Full name',user.name,'text','required maxlength="150"')+field('email','Email',user.email,'email','disabled')+field('phone','Phone',user.profile.phone||'','tel'))+'<p role="alert"></p><button class="button primary">'+icon('save')+' Save</button></form>'+(password?'':resetBlock(user))+'</section></div>';
  if(!password)wireReset(content,user);
  if(password){const form=content.querySelector('form');form.addEventListener('input',()=>{const p=form.elements.password.value,c=form.elements.confirm.value,list=form.querySelector('[data-pw-checks]');PW_RULES.forEach(([k,,test])=>{const li=list.querySelector('[data-rule="'+k+'"]');li.classList.toggle('is-ok',!!p&&test(p));li.classList.toggle('is-bad',!!p&&!test(p));});const m=list.querySelector('[data-rule="match"]');m.hidden=!c;if(c){const ok=c===p;m.classList.toggle('is-ok',ok);m.classList.toggle('is-bad',!ok);m.textContent=ok?'Passwords match':'Passwords do not match yet';}});}
  content.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{
   if(password){const p=form.elements.password.value;if(p.length<8||!/[A-Z]/.test(p)||!/[0-9]/.test(p)||(p.match(/[^A-Za-z0-9]/g)||[]).length>1)throw new Error('Use at least 8 characters with one capital letter and one number; at most one special character.');if(p!==form.elements.confirm.value)throw new Error('Passwords do not match.');const cur=form.elements.current.value;if(!cur&&!google)throw new Error('Enter your current password.');if(cur){try{await db.signIn(user.email,cur);}catch{throw new Error(google?'That is not your current password. If you have never set one, leave Current password blank.':'Your current password is incorrect.');}}const up=await db.client.auth.updateUser({password:form.elements.password.value});if(up.error)throw new Error(/reauthenticat/i.test(up.error.message)?'For your security, log out, sign in again with Google, then set your password right away.':up.error.message);form.reset();if(!cur){form.querySelector('[role=alert]').textContent='Password set. You can now also log in with your email and password.';return;}}
   else await rows(db.client.from('profiles').update({full_name:form.elements.full_name.value.trim(),phone:form.elements.phone.value.trim()}).eq('id',user.id));
   form.querySelector('[role=alert]').textContent='Saved successfully.';
  }catch(error){form.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}};
 }catch(error){fail(content,error);}
}
