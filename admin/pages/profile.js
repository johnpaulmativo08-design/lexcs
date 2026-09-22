import {escapeHtml as e,icon,notice} from '../components.js?v=3';
import {db,rows,field,fail} from '../backend-ui.js';
export async function renderProfile(content,subpage){
 try{
  const user=await db.identity(),password=subpage==='password';
  content.innerHTML='<header class="module-heading"><div><h1>Profile</h1><p>Manage your administrator information and account security.</p></div></header><div class="profile-layout"><section class="profile-card panel"><div class="profile-initials">'+e(user.name.slice(0,2).toUpperCase())+'</div><h2>'+e(user.name)+'</h2><p>Administrator</p><a class="button" href="#profile">'+icon('profile')+' My Profile</a><a class="button" href="#profile/password">'+icon('archive')+' Change Password</a></section><section class="profile-form panel"><h2>'+(password?'Change Password':'Personal Information')+'</h2><form class="form-body">'+(password?field('current','Current password','','password','required')+field('password','New password','','password','minlength="8" required')+field('confirm','Confirm password','','password','minlength="8" required'):field('full_name','Full name',user.name,'text','required maxlength="150"')+field('email','Email',user.email,'email','disabled')+field('phone','Phone',user.profile.phone||'','tel'))+'<p role="alert"></p><button class="button primary">'+icon('save')+' Save</button></form></section></div>';
  content.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{
   if(password){if(form.elements.password.value!==form.elements.confirm.value)throw new Error('Passwords do not match.');await db.signIn(user.email,form.elements.current.value);db.unwrap(await db.client.auth.updateUser({password:form.elements.password.value}));form.reset();}
   else await rows(db.client.from('profiles').update({full_name:form.elements.full_name.value.trim(),phone:form.elements.phone.value.trim()}).eq('id',user.id));
   form.querySelector('[role=alert]').textContent='Saved successfully.';
  }catch(error){form.querySelector('[role=alert]').textContent=error.message;}finally{button.disabled=false;}};
 }catch(error){fail(content,error);}
}
