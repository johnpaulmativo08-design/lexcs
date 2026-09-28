import { escapeHtml as e, icon, showDetails } from './components.js?v=3';
export const db = window.LexcBackend;
export const rows = async query => db.unwrap(await query);
export async function allRows(query) {
  const result=[];
  for(let offset=0;;offset+=500){
    const page=await rows(query().range(offset,offset+499));
    result.push(...page);
    if(page.length<500)return result;
  }
}
export const button = (label, id) => '<button class="button" data-action="'+e(id)+'">'+e(label)+'</button>';
export const field = (name,label,value='',type='text',extra='') => '<label class="form-field">'+e(label)+'<input name="'+e(name)+'" type="'+type+'" value="'+e(value)+'" '+extra+'></label>';
export function grid(columns, body) {
  return '<div class="panel table-scroll"><table class="data-table"><thead><tr>'+columns.map(c=>'<th scope="col">'+e(c)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
export const skel = (kind='line',extra='') => '<span class="skel skel-'+kind+(extra?' '+extra:'')+'" aria-hidden="true"></span>';
export function loadingTable(columns=6,rows=6){
  const labels=Array.isArray(columns)?columns:Array.from({length:columns},()=>null);
  return '<div class="panel table-scroll admin-loading-table" role="status" aria-label="Loading records" aria-busy="true"><table class="data-table"><thead><tr>'+labels.map(label=>'<th scope="col">'+(label?e(label):skel('line','skel-line--short'))+'</th>').join('')+'</tr></thead><tbody aria-hidden="true">'+Array.from({length:rows},()=>'<tr>'+labels.map((_,index)=>'<td>'+skel(index===labels.length-2?'badge':'line',index%3===0?'skel-line--short':'')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
export function loadingCards(count=6){return '<div class="skel-card-grid" role="status" aria-label="Loading cards" aria-busy="true">'+Array.from({length:count},()=>'<article class="skel-panel skel-product" aria-hidden="true">'+skel('image')+'<div class="skel-stack">'+skel('title')+skel('line','skel-line--long')+skel('line','skel-line--short')+skel('button')+'</div></article>').join('')+'</div>';}
export function loadingMetrics(count=4){return '<div class="skel-stat-grid" role="status" aria-label="Loading summary" aria-busy="true">'+Array.from({length:count},()=>'<div class="skel-panel skel-stat" aria-hidden="true">'+skel('line','skel-line--short')+skel('value')+skel('line')+'</div>').join('')+'</div>';}
export function loadingList(count=5){return '<div class="skel-list" role="status" aria-label="Loading list" aria-busy="true">'+Array.from({length:count},()=>'<div class="skel-list-row" aria-hidden="true">'+skel('circle')+'<span class="skel-stack">'+skel('line','skel-line--long')+skel('line','skel-line--short')+'</span>'+skel('badge')+'</div>').join('')+'</div>';}
export function loadingChart(){return '<div class="skel-chart" role="status" aria-label="Loading chart" aria-busy="true">'+[35,60,44,72,50,84,68,93].map(height=>'<span class="skel" aria-hidden="true" style="--skel-height:'+height+'%"></span>').join('')+'</div>';}
export function loadingForm(count=3){return '<div class="skel-form" role="status" aria-label="Loading form" aria-busy="true">'+Array.from({length:count},()=>'<div class="skel-form-field" aria-hidden="true">'+skel('line','skel-line--short')+skel('line')+'</div>').join('')+skel('button')+'</div>';}
export function form(title, fields, save, opener) {
  const dialog=showDetails(title,'<form>'+fields+'<p role="alert" class="form-error" hidden></p><button class="button primary" type="submit">'+icon('save')+' Save</button></form>',opener);
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,submit=form.querySelector('[type=submit]'),error=form.querySelector('[role=alert]');
    submit.disabled=true;error.hidden=true;
    try{await save(Object.fromEntries(new FormData(form)),form);dialog.close();}
    catch(problem){error.textContent=problem.message;error.hidden=false;}
    finally{submit.disabled=false;}
  };
  return dialog;
}
export function fail(content,error){console.warn('Admin page failed:',error);const header=content.querySelector('header.module-heading,header.booking-heading,.ops-heading,.inventory-head')?.outerHTML||'';content.innerHTML=header+'<section class="panel admin-error-state" role="alert"><h2>We could not load this page</h2><p>Check your connection, then try again. Your saved records have not been changed.</p><button class="button primary" type="button" onclick="location.reload()">Try again</button></section>';}
