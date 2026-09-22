import {escapeHtml as e,icon,money,notice,statusIndicator,toolbar} from '../components.js?v=3';
import {db,rows,field,form,fail} from '../backend-ui.js';
import {storefrontData} from '../data.js';
export async function renderProducts(content,subpage=''){
 try{
  const [products,categories,legacy]=await Promise.all([db.catalog(),db.categories(),storefrontData()]);
  const packages=subpage==='packages';
  content.innerHTML='<header class="module-heading"><div><h1>Products</h1><p>Manage pastries, packages, pricing, photos, and availability.</p></div></header>'+toolbar('<select id="category"><option value="">All categories</option>'+categories.map(c=>'<option value="'+c.id+'">'+e(c.name)+'</option>').join('')+'</select><select id="status"><option value="">All states</option><option>active</option><option>archived</option></select><button class="button primary" id="add-product">'+icon('plus')+' Add Product</button><button class="button" id="add-category">'+icon('plus')+' Category</button><a class="button" href="#products'+(packages?'':'/packages')+'">'+icon('products')+' '+(packages?'Pastry':'Packages')+'</a>')+'<div id="catalog-status"></div><div id="catalog-grid" class="product-grid"></div>';
  const draw=()=>{
   const category=content.querySelector('#category').value,status=content.querySelector('#status').value,q=content.querySelector('.search').value.toLowerCase();
   const filtered=products.filter(p=>(packages?p.kind==='package':p.kind!=='package')&&(!category||p.category_id===category)&&(!status||p.status===status)&&[p.name,p.description].join(' ').toLowerCase().includes(q));
   content.querySelector('#catalog-status').textContent=filtered.length+' products';
   content.querySelector('#catalog-grid').innerHTML=filtered.map(p=>{
    const image=p.image_path?db.mediaURL(p.image_path):legacy.images[p.legacy_id];
    return '<article class="admin-product '+(p.status==='archived'?'is-archived':'')+'">'+(image?'<img class="product-photo" src="'+e(image)+'" alt="'+e(p.name)+'">':'<div class="product-photo missing-photo">'+icon('gallery')+'<span>No photo</span></div>')+'<div class="product-card-head"><h2>'+e(p.name)+'</h2>'+statusIndicator(p.status,p.status==='archived'?'neutral':'success')+'</div><p class="product-category">'+e(p.categories?.name||p.kind)+'</p><p>'+e(p.description)+'</p><ul class="variants">'+p.product_variants.filter(v=>v.is_active).map(v=>'<li>'+e(v.label)+' | '+money(v.price)+'</li>').join('')+'</ul><div class="card-actions"><button class="edit" data-edit="'+p.id+'">'+icon('edit')+' Edit</button><button class="archive" data-archive="'+p.id+'">'+icon('archive')+' '+(p.status==='archived'?'Restore':'Archive')+'</button></div></article>';
   }).join('');
  };
  const edit=p=>{
   const variants=p?.product_variants||[{code:'option-1',label:'Standard',price:0,is_active:true}];
   form(p?'Edit Product':'Add Product',field('name','Product name',p?.name||'','text','required')+field('description','Description',p?.description||'')+'<label class="form-field">Category<select name="category_id"><option value="">None</option>'+categories.map(c=>'<option value="'+c.id+'" '+(p?.category_id===c.id?'selected':'')+'>'+e(c.name)+'</option>').join('')+'</select></label>'+field('image','Replace photo','','file','accept="image/jpeg,image/png,image/webp"')+'<label class="form-field">Variants (one per line: label | price)<textarea name="variants" rows="6" required>'+e(variants.map(v=>v.label+' | '+v.price).join('\n'))+'</textarea></label>'+(packages?'<label class="form-field">Package contents (one per line)<textarea name="contents" rows="5">'+e((p?.package_contents||[]).join('\n'))+'</textarea></label>':''),async(data,form)=>{
    const parsed=data.variants.split('\n').filter(x=>x.trim()).map((line,index)=>{const parts=line.split('|');const price=Number(parts.pop()?.trim()),label=parts.join('|').trim();if(!label||!Number.isFinite(price)||price<0)throw new Error('Each variant needs a label and nonnegative price.');return {id:variants[index]?.id,code:variants[index]?.code||'option-'+crypto.randomUUID(),label,price,is_active:true,sort_order:index};});
    if(!parsed.length)throw new Error('At least one variant is required.');
    if(p?.kind==='customizable' && (parsed.length!==3||parsed.some((v,i)=>v.code!==variants[i]?.code)))throw new Error('Keep all three existing frosting options.');
    const id=p?.id||crypto.randomUUID(),file=form.elements.image.files[0];
    const image_path=file?await db.upload('catalog-media','products/'+id,file):p?.image_path||null;
    await db.rpc('save_product',{payload:{id,name:data.name.trim(),description:data.description,category_id:data.category_id||null,kind:p?.kind||(packages?'package':'standard'),slug:p?.slug||'product-'+id,image_path,package_contents:packages?data.contents.split('\n').filter(x=>x.trim()):p?.package_contents||null,variants:parsed}});
    await renderProducts(content,subpage);
   });
  };
  content.querySelector('#add-product').onclick=()=>edit(null);
  content.querySelector('#add-category').onclick=()=>form('Add Category',field('name','Name','','text','required'),async data=>{await rows(db.client.from('categories').insert({name:data.name.trim(),slug:'category-'+crypto.randomUUID()}));await renderProducts(content,subpage);});
  content.onclick=async event=>{const b=event.target.closest('[data-edit],[data-archive]');if(!b)return;const p=products.find(p=>p.id===(b.dataset.edit||b.dataset.archive));if(b.dataset.edit)edit(p);else{try{await rows(db.client.from('products').update({status:p.status==='active'?'archived':'active'}).eq('id',p.id));await renderProducts(content,subpage);}catch(error){fail(content,error);}}};
  content.querySelector('.search').oninput=draw;content.querySelector('#category').onchange=draw;content.querySelector('#status').onchange=draw;draw();
 }catch(error){fail(content,error);}
}
