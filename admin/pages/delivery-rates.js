// Admin → Delivery rates (phase 94). The owner's own delivery rates; the site uses them to ESTIMATE the delivery fee
// from the driving distance (shop → customer's pin). They are not Lalamove's prices: enter rates you have checked.
// Saved with public.save_delivery_pricing (admin only); the example uses public.preview_delivery_fee (saved rates).
import {escapeHtml as e,icon,money,notice} from '../components.js?v=3';
import {db,fail,loadingForm} from '../backend-ui.js?v=3';

const TOWNS=['Angeles City','Apalit','Arayat','Bacolor','Candaba','Floridablanca','Guagua','Lubao','Mabalacat City','Macabebe','Magalang','Masantol','Mexico','Minalin','Porac','San Fernando','San Luis','San Simon','Santa Ana','Santa Rita','Santo Tomas','Sasmuan'];
const num=(name,label,value,hint,extra='')=>'<label class="form-field">'+e(label)+'<input name="'+name+'" type="number" inputmode="decimal" min="0" step="0.01" value="'+e(value??'')+'" '+extra+'>'+(hint?'<small class="dr-hint">'+e(hint)+'</small>':'')+'</label>';
const pick=(name,label,value,options)=>'<label class="form-field">'+e(label)+'<select name="'+name+'">'+options.map(([v,t])=>'<option value="'+e(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+e(t)+'</option>').join('')+'</select></label>';

export async function renderDeliveryRates(content){
 const head='<header class="module-heading"><div><h1>Delivery rates</h1><p>Your rates for estimating the Lalamove delivery fee from the driving distance.</p></div></header>';
 content.innerHTML=head+loadingForm(6);
 try{
  let r;
  try{r=db.unwrap(await db.client.from('delivery_pricing').select('*').eq('id',1).maybeSingle());}
  catch(error){content.innerHTML=head+notice('Delivery rates are not set up yet. Run database/phase94-delivery-fee-quotes.sql in the Supabase SQL editor first.');return;}
  r=r||{};
  const sur=Object.fromEntries((r.surcharges||[]).map(s=>[s.town,s.amount]));
  content.innerHTML=head+
   notice('These are estimates from your own rates, not Lalamove quotations. Enter rates you have checked in the Lalamove app for the vehicle you book. Customers pay this fee to LexC’s with their first payment (no VAT on it); you then book and pay the rider.')+
   '<form class="panel dr-form form-body" data-rates>'+
    '<label class="dr-switch"><input type="checkbox" name="enabled"'+(r.enabled?' checked':'')+'><span><strong>Charge delivery fees at checkout</strong><small>When off, delivery works as before: ₱0 at checkout and the customer pays the rider.</small></span></label>'+
    '<fieldset class="dr-group"><legend>Rate</legend><div class="dr-grid">'+
     '<label class="form-field">Vehicle<input name="vehicle" maxlength="40" value="'+e(r.vehicle||'Motorcycle')+'" required></label>'+
     num('base_fee','Base fee (₱)',r.base_fee,'Charged for every delivery.','required')+
     num('included_km','Distance included in the base fee (km)',r.included_km??0,'0 if every km is charged.')+
     num('per_km_fee','Fee per extra km (₱)',r.per_km_fee??0,'For each km beyond the included distance.')+
     pick('km_counting','Count extra distance',r.km_counting||'exact',[['exact','Exactly (e.g. 5.4 km)'],['started_km','Per started km (5.4 → 6 km)']])+
     num('minimum_fee','Minimum fee (₱)',r.minimum_fee??0,'The fee is never below this.')+
     pick('round_to','Round the fee to',r.round_to??1,[['0.01','No rounding'],['1','₱1'],['5','₱5'],['10','₱10']])+
     pick('round_mode','Rounding',r.round_mode||'up',[['up','Always up'],['nearest','To the nearest']])+
     num('max_km','Farthest delivery (km of driving)',r.max_km??80,'Pins farther than this are refused.','min="1" max="500"')+
    '</div></fieldset>'+
    '<details class="dr-group dr-towns"'+(Object.keys(sur).length?' open':'')+'><summary>Area surcharges (optional)</summary><p class="dr-hint">Extra pesos added for a delivery to a town, for example far or hard-to-reach areas. Leave empty for none.</p><div class="dr-grid dr-grid--towns">'+
     TOWNS.map(t=>'<label class="form-field">'+e(t)+'<input type="number" inputmode="decimal" min="0" step="0.01" data-town="'+e(t)+'" value="'+e(sur[t]??'')+'" aria-label="Surcharge for '+e(t)+' (₱), empty for none"></label>').join('')+
    '</div></details>'+
    '<label class="form-field">Where these rates come from<input name="source_note" maxlength="300" value="'+e(r.source_note||'')+'" placeholder="e.g. Lalamove app, motorcycle, checked Nov 2026"></label>'+
    '<p role="alert"></p><div class="dr-actions"><button class="button primary" type="submit">'+icon('save')+' Save rates</button>'+(r.updated_at?'<small class="dr-hint">Last saved '+e(new Date(r.updated_at).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}))+'</small>':'')+'</div>'+
   '</form>'+
   '<section class="panel dr-form dr-try"><h2>Try the saved rates</h2><div class="dr-grid"><label class="form-field">Driving distance (km)<input type="number" min="0" step="0.1" value="8.5" data-try-km></label>'+
    '<label class="form-field">Town<select data-try-town><option value="">—</option>'+TOWNS.map(t=>'<option>'+e(t)+'</option>').join('')+'</select></label></div><p class="dr-result" data-try-out aria-live="polite"></p></section>';

  const form=content.querySelector('[data-rates]'),say=t=>{form.querySelector('[role=alert]').textContent=t;};
  const out=content.querySelector('[data-try-out]');
  const tryIt=async()=>{
   const km=Number(content.querySelector('[data-try-km]').value),town=content.querySelector('[data-try-town]').value||null;
   if(!(km>=0)){out.textContent='';return;}
   try{const p=await db.rpc('preview_delivery_fee',{distance_km:km,town});
    out.innerHTML=p?'<strong>'+money(p.fee)+'</strong> <span>'+e(money(p.base_fee)+' base'+(Number(p.extra_km)>0?' + '+p.extra_km+' km × '+money(p.per_km_fee):'')+(Number(p.surcharge)>0?' + '+money(p.surcharge)+' '+p.town:'')+(Number(p.minimum_fee)>Number(p.before_rounding)?' · minimum applied':'')+(Number(p.before_rounding)!==Number(p.fee)?' · rounded from '+money(p.before_rounding):''))+'</span>':'Save a base fee first.';}
   catch(error){out.textContent=error.message;}};
  content.querySelector('[data-try-km]').oninput=tryIt;content.querySelector('[data-try-town]').onchange=tryIt;tryIt();

  form.onsubmit=async event=>{
   event.preventDefault();say('');const f=form.elements,button=form.querySelector('button[type=submit]');
   const surcharges=[...form.querySelectorAll('[data-town]')].filter(i=>i.value!==''&&Number(i.value)>0).map(i=>({town:i.dataset.town,amount:i.value}));
   if(f.enabled.checked&&f.base_fee.value===''){say('Enter the base fee before switching delivery fees on.');f.base_fee.focus();return;}
   button.disabled=true;
   try{
    await db.rpc('save_delivery_pricing',{settings:{enabled:f.enabled.checked,vehicle:f.vehicle.value,base_fee:f.base_fee.value,included_km:f.included_km.value,per_km_fee:f.per_km_fee.value,
     km_counting:f.km_counting.value,minimum_fee:f.minimum_fee.value,round_to:f.round_to.value,round_mode:f.round_mode.value,max_km:f.max_km.value,surcharges,source_note:f.source_note.value}});
    say(f.enabled.checked?'Saved. New delivery orders now get these fees.':'Saved. Delivery fees are off: customers pay the rider.');tryIt();
   }catch(error){say(error.message);}finally{button.disabled=false;}
  };
 }catch(error){fail(content,error);}
}
