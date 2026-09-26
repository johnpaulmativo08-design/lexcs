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
  return '<div class="panel table-scroll"><table class="data-table"><thead><tr>'+columns.map(c=>'<th>'+e(c)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
}
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
export function fail(content,error){content.innerHTML='<p role="alert" class="notice">'+e(error.message)+'</p>';}
