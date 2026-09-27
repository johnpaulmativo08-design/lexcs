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
export function loadingTable(columns=6,rows=5){return '<div class="panel table-scroll admin-loading-table" role="status" aria-label="Loading records"><table class="data-table"><thead><tr>'+Array.from({length:columns},()=>'<th><span class="ui-skeleton">Loading heading</span></th>').join('')+'</tr></thead><tbody>'+Array.from({length:rows},()=>'<tr>'+Array.from({length:columns},()=>'<td><span class="ui-skeleton">Loading record</span></td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
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
export function fail(content,error){console.warn('Admin page failed:',error);content.innerHTML='<section class="panel admin-error-state" role="alert"><h2>We could not load this page</h2><p>Check your connection, then try again. Your saved records have not been changed.</p><button class="button primary" type="button" onclick="location.reload()">Try again</button></section>';}
