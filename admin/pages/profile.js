import {escapeHtml as e,icon,notice} from '../components.js?v=3';
import {db,rows,field,fail,loadingForm,skel} from '../backend-ui.js?v=3';
// live password checklist (same rules as the shop)
const PW_RULES=[["len","At least 8 characters",p=>p.length>=8],["cap","One capital letter (A–Z)",p=>/[A-Z]/.test(p)],["num","One number (0–9)",p=>/[0-9]/.test(p)],["spec","At most one special character (optional)",p=>(p.match(/[^A-Za-z0-9]/g)||[]).length<=1]];
const pwChecks=()=>'<ul class="pw-checks" data-pw-checks aria-live="polite">'+PW_RULES.map(([k,t])=>'<li data-rule="'+k+'">'+t+'</li>').join("")+'<li data-rule="match" hidden>Passwords match</li></ul>';
// Change email: the same admin account (same ID, role and history) moves to a new address. Supabase only switches
// after the 6-digit code (or link) sent to the new address is confirmed, so it must be an inbox that receives mail.
const FAKE_DOMAIN=/(^|\.)(local|localhost|localdomain|test|example|invalid|internal|lan|home|corp|intranet)$|^example\.(com|net|org)$/i;
const deliverable=domain=>!!domain&&!FAKE_DOMAIN.test(domain);
function realEmail(value){
 const email=value.trim().toLowerCase();
 if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email))throw new Error('Enter a complete email address, like name@gmail.com.');
 if(!deliverable(email.split('@')[1]))throw new Error('Use a real email address that can receive mail (not .local, .test or example.com).');
 return email;
}
const friendly=error=>/already been registered|already registered|email_exists/i.test(error.message)?'That email already belongs to another account on the site. Use a different one.':/invalid login credentials/i.test(error.message)?'Your current password is incorrect.':/token has expired|invalid.*(otp|token)|otp_expired/i.test(error.message)?'That code is wrong or has expired. Check the newest email or send a new code.':error.message;
function renderEmail(content,user,head,card){
 const current=user.email||'',oldDomain=current.split('@')[1]||'';
 const page=(body)=>{content.innerHTML=head+'<div class="profile-layout">'+card+'<section class="profile-form panel"><h2>Change Email</h2>'+body+'</section></div>';};
 const askNew=(message='')=>{
  page('<form class="form-body" data-email-new>'+'<p class="profile-forgot">You log in to the admin with this email, and codes and password resets are sent to it. Your account, role and records stay the same; only the address changes.</p>'+
   (deliverable(oldDomain)?'':'<p class="notice">Your current address (@'+e(oldDomain)+') cannot receive email. Before you continue, open Supabase → Authentication → Sign In / Providers → Email and turn off <strong>Secure email change</strong>, so only the new address has to confirm. Turn it back on once the change is done.</p>')+
   field('current_email','Current email',current,'email','disabled')+field('new_email','New email','','email','required autocomplete="email" placeholder="name@gmail.com"')+field('password','Current password','','password','required autocomplete="current-password"')+
   '<p role="alert">'+e(message)+'</p><button class="button primary">'+icon('check')+' Send code to new email</button></form>');
  content.querySelector('[data-email-new]').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button.primary'),alert=form.querySelector('[role=alert]');button.disabled=true;alert.textContent='';
   try{
    const next=realEmail(form.elements.new_email.value);
    if(next===current.toLowerCase())throw new Error('That is already your admin email.');
    await db.signIn(current,form.elements.password.value);
    db.unwrap(await db.client.auth.updateUser({email:next},{emailRedirectTo:new URL('./#profile/email',location.href).href}));
    askCode(next,'');
   }catch(error){alert.textContent=friendly(error);button.disabled=false;}};
 };
 const askCode=(next,message)=>{
  page('<form class="form-body" data-email-code><p class="profile-forgot">We sent a 6-digit code to <strong>'+e(next)+'</strong>. Enter it below to finish. If the email shows a link instead, open it on this device.</p>'+
   field('code','6-digit code','','text','required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6"')+
   '<p role="alert">'+e(message)+'</p><button class="button primary">'+icon('check')+' Confirm new email</button><p class="profile-forgot"><button type="button" class="text-button" data-resend>Send the code again</button> · <button type="button" class="text-button" data-restart>Use a different email</button></p></form>');
  const form=content.querySelector('[data-email-code]'),alert=form.querySelector('[role=alert]'),resend=form.querySelector('[data-resend]');
  const cool=(s)=>{resend.disabled=true;const tick=()=>{if(!resend.isConnected)return;if(s<=0){resend.disabled=false;resend.textContent='Send the code again';return;}resend.textContent='Send again in '+s+' s';s--;setTimeout(tick,1000);};tick();};
  cool(60);
  form.elements.code.addEventListener('input',ev=>{ev.target.value=ev.target.value.replace(/\D/g,'').slice(0,6);});
  resend.onclick=async()=>{alert.textContent='';try{db.unwrap(await db.client.auth.resend({type:'email_change',email:next}));alert.textContent='A new code is on its way to '+next+'.';cool(60);}catch(error){alert.textContent=friendly(error);}};
  form.querySelector('[data-restart]').onclick=()=>askNew();
  form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button.primary');button.disabled=true;alert.textContent='';
   try{
    const code=form.elements.code.value.trim();if(!/^\d{6}$/.test(code))throw new Error('Enter the 6 digits from the email.');
    const data=db.unwrap(await db.client.auth.verifyOtp({email:next,token:code,type:'email_change'}));
    const now=(data.user||(await db.client.auth.getUser()).data.user)?.email||'';
    if(now.toLowerCase()===next)return done(next);
    // "Secure email change" is on: Supabase also waits for the confirmation sent to the old address
    alert.textContent='The new address is confirmed, but Supabase is also waiting for a confirmation sent to your old address. If that address cannot receive mail, turn off Secure email change in Supabase (Authentication → Sign In / Providers → Email), then choose “Use a different email” and send the code again.';
   }catch(error){alert.textContent=friendly(error);}finally{button.disabled=false;}};
 };
 const done=next=>{page('<div class="form-body"><p class="notice">Done. Your admin email is now <strong>'+e(next)+'</strong>. Use it, with the same password, the next time you log in.</p><p class="profile-forgot">If you turned off Secure email change in Supabase for this, you can turn it back on now.</p><a class="button primary" href="#profile">'+icon('profile')+' Back to My Profile</a></div>');};
 // a change already started (or opened from the email link) carries on where it left off
 if(user.new_email&&user.new_email.toLowerCase()!==current.toLowerCase())askCode(user.new_email.toLowerCase(),'');
 else askNew();
}
export async function renderProfile(content,subpage){
 content.innerHTML='<header class="module-heading"><div><h1>Profile</h1><p>Manage your administrator information and account security.</p></div></header><div class="profile-layout"><section class="profile-card panel skel-stack" aria-label="Loading administrator profile">'+skel('circle')+skel('title')+skel('line','skel-line--short')+'</section><section class="profile-form panel"><h2>'+(subpage==='password'?'Change Password':'Personal Information')+'</h2>'+loadingForm(3)+'</section></div>';
 try{
  const user=await db.identity(),password=subpage==='password';
  const head='<header class="module-heading"><div><h1>Profile</h1><p>Manage your administrator information and account security.</p></div></header>';
  const card='<section class="profile-card panel"><div class="profile-initials">'+e(user.name.slice(0,2).toUpperCase())+'</div><h2>'+e(user.name)+'</h2><p>Administrator</p><a class="button" href="#profile">'+icon('profile')+' My Profile</a><a class="button" href="#profile/password">'+icon('archive')+' Change Password</a><a class="button" href="#profile/email">'+icon('pencil')+' Change Email</a></section>';
  if(subpage==='email')return renderEmail(content,user,head,card);
  content.innerHTML=head+'<div class="profile-layout">'+card+'<section class="profile-form panel"><h2>'+(password?'Change Password':'Personal Information')+'</h2><form class="form-body">'+(password?field('current','Current password','','password','required')+field('password','New password','','password','minlength="8" required')+pwChecks()+field('confirm','Confirm password','','password','minlength="8" required'):field('full_name','Full name',user.name,'text','required maxlength="150"')+'<p class="profile-forgot">Forgot your password? <button type="button" class="text-button" data-forgot>Email me a reset link</button></p>'+field('email','Email',user.email,'email','disabled')+'<p class="profile-forgot"><a class="text-button" href="#profile/email">Change email</a></p>'+field('phone','Phone',user.profile.phone||'','tel'))+'<p role="alert"></p><button class="button primary">'+icon('save')+' Save</button></form></section></div>';
  // reset link by email; it opens the shop, which asks for the new password
  content.querySelector('[data-forgot]')?.addEventListener('click',async event=>{const b=event.currentTarget;b.disabled=true;b.textContent='Sending…';try{db.unwrap(await db.client.auth.resetPasswordForEmail(user.email,{redirectTo:new URL('../index.html',location.href).href}));b.textContent='Reset link sent to '+user.email;}catch(error){b.disabled=false;b.textContent='Email me a reset link';content.querySelector('[role=alert]').textContent=error.message;}});
  if(password){const form=content.querySelector('form');form.addEventListener('input',()=>{const p=form.elements.password.value,c=form.elements.confirm.value,list=form.querySelector('[data-pw-checks]');PW_RULES.forEach(([k,,test])=>{const li=list.querySelector('[data-rule="'+k+'"]');li.classList.toggle('is-ok',!!p&&test(p));li.classList.toggle('is-bad',!!p&&!test(p));});const m=list.querySelector('[data-rule="match"]');m.hidden=!c;if(c){const ok=c===p;m.classList.toggle('is-ok',ok);m.classList.toggle('is-bad',!ok);m.textContent=ok?'Passwords match':'Passwords do not match yet';}});}
  content.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{
   if(password){const p=form.elements.password.value;if(p.length<8||!/[A-Z]/.test(p)||!/[0-9]/.test(p)||(p.match(/[^A-Za-z0-9]/g)||[]).length>1)throw new Error('Use at least 8 characters with one capital letter and one number; at most one special character.');if(p!==form.elements.confirm.value)throw new Error('Passwords do not match.');await db.signIn(user.email,form.elements.current.value);db.unwrap(await db.client.auth.updateUser({password:form.elements.password.value}));form.reset();}
   else await rows(db.client.from('profiles').update({full_name:form.elements.full_name.value.trim(),phone:form.elements.phone.value.trim()}).eq('id',user.id));
   form.querySelector('[role=alert]').textContent='Saved successfully.';
  }catch(error){form.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}};
 }catch(error){fail(content,error);}
}
