import {escapeHtml as e,icon} from '../components.js?v=3';
import {db,rows,fail,loadingTable} from '../backend-ui.js?v=3';

// Prices and availability of the bento and cupcake designers' options (public.design_options, phases 32 and 36).
// Checkout prices designs on the server from this table, so a change here applies to the next quote.
const GROUPS={
 bento:[['border','Borders'],['accent','Decorations'],['message','Message'],['lettering','Lettering styles'],['topper','Toppers'],['font','Message fonts'],['color','Colors (frosting, lettering, ribbon, drip)']],
 cupcake:[['flavor','Flavors'],['style','Piping styles'],['pattern','Box arrangement'],['finish','Finishing touches'],['theme','Theme toppers'],['color','Frosting colors']],
 donut:[['flavor','Flavors'],['pattern','Glaze dip'],['finish','Finishes'],['sprinkle','Sprinkles'],['theme','Theme toppers'],['message','Fondant message'],['color','Glaze, sprinkle and letter colors']]};
const UNIT={bento:'cake',cupcake:'box',donut:'box'};
const FREE=new Set(['color','font','flavor']);
const heading='<header class="module-heading"><div><h1>Designer options</h1><p>Extras charged for each choice in the bento, cupcake and donut designers (per cake, or once per cupcake or donut box). Turn an option off to hide it from customers.</p></div></header>';

export async function renderDesignOptions(content){
 content.innerHTML=heading+loadingTable(['Option','Extra per cake','Offered',''],8);
 try{
  const options=await rows(db.client.from('design_options').select('id,product_id,group_key,code,label,price,hex,is_active,sort_order').order('group_key').order('sort_order'));
  const ids=[...new Set(options.map(o=>o.product_id))];
  const products=ids.length?await rows(db.client.from('products').select('id,name,customization_config').in('id',ids).order('name')):[];
  if(!options.length){content.innerHTML=heading+'<section class="panel"><p>No designer options yet. Apply database phase 32 first.</p></section>';return;}
  const kind=p=>['cupcake','donut'].includes(p.customization_config?.designer)?p.customization_config.designer:'bento';
  const sorted=[...products].sort((a,b)=>kind(a).localeCompare(kind(b))||a.name.localeCompare(b.name));
  content.innerHTML=heading+sorted.map(p=>'<h2 style="margin:24px 0 8px">'+e(p.name)+'</h2>'+GROUPS[kind(p)].map(([key,title])=>{
   const list=options.filter(o=>o.product_id===p.id&&o.group_key===key);if(!list.length)return '';
   const unit=UNIT[kind(p)];
   return '<section class="panel design-options"><h2 class="panel-title"><span>'+e(title)+'</span></h2><div class="table-wrap"><table class="data-table" style="min-width:560px;table-layout:fixed"><colgroup><col><col style="width:170px"><col style="width:120px"><col style="width:150px"></colgroup><thead><tr><th>Option</th><th>Extra per '+unit+' (₱)</th><th>Offered</th><th><span class="sr-only">Save</span></th></tr></thead><tbody>'
    +list.map(o=>'<tr data-option="'+e(o.id)+'"><td>'+(o.hex?'<span aria-hidden="true" style="display:inline-block;width:16px;height:16px;border-radius:50%;vertical-align:-3px;margin-right:8px;border:1px solid #d9cde3;background:'+e(o.hex)+'"></span>':'')+e(o.label)+'</td>'
     +'<td><label class="sr-only" for="price-'+e(o.id)+'">Extra for '+e(o.label)+'</label><input id="price-'+e(o.id)+'" type="number" min="0" max="10000" step="0.5" inputmode="decimal" value="'+Number(o.price)+'" data-price style="width:110px"'+((FREE.has(key)&&o.code!=='mix')||o.code==='none'||(key==='lettering'&&o.code==='piped')?' disabled title="Always free"':'')+'></td>'
     +'<td><label><input type="checkbox" data-active '+(o.is_active?'checked':'')+(o.code==='none'||(key==='lettering'&&o.code==='piped')||(key==='font'&&o.code==='rounded')?' disabled title="Always offered"':'')+'> <span>'+(o.is_active?'Yes':'No')+'</span></label></td>'
     +'<td><button class="button" type="button" data-save disabled>Save</button> <span class="design-option-status" role="status"></span></td></tr>').join('')
    +'</tbody></table></div></section>';
  }).join('')).join('');
  content.addEventListener('input',event=>{const row=event.target.closest('[data-option]');if(!row)return;row.querySelector('[data-save]').disabled=false;row.querySelector('.design-option-status').textContent='';});
  content.addEventListener('change',event=>{const row=event.target.closest('[data-option]');if(!row)return;row.querySelector('[data-save]').disabled=false;if(event.target.matches('[data-active]'))event.target.nextElementSibling.textContent=event.target.checked?'Yes':'No';});
  content.addEventListener('click',async event=>{
   const button=event.target.closest('[data-save]');if(!button)return;
   const row=button.closest('[data-option]'),status=row.querySelector('.design-option-status');
   const price=Number(row.querySelector('[data-price]').value);
   if(!Number.isFinite(price)||price<0||price>10000){status.textContent='Enter an amount from 0 to 10,000.';return;}
   button.disabled=true;status.textContent='Saving…';
   try{
    // .select() returns the changed row; an empty result means the database refused the change (not signed in as Admin).
    const saved=await rows(db.client.from('design_options').update({price:Math.round(price*100)/100,is_active:row.querySelector('[data-active]').checked,updated_at:new Date().toISOString()}).eq('id',row.dataset.option).select('id'));
    if(!saved?.length)throw new Error('No option was updated.');
    status.textContent='Saved';
   }catch(error){console.warn('Design option save failed:',error);status.textContent='Could not save. Try again.';button.disabled=false;}
  });
 }catch(error){fail(content,error);}
}
