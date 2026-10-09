import {escapeHtml as e,icon,toolbar} from '../components.js?v=3';
import {db,rows,field,form,fail,loadingCards} from '../backend-ui.js?v=3';
import {storefrontData} from '../data.js';
import {recipeForProduct,flaggedLines} from '../recipe-model.js?v=1';
import {openProductEditor} from './product-editor.js?v=4';
import {ask} from '../../shared/ask.js?v=1';
const money=n=>'₱'+Number(n||0).toLocaleString('en-PH',{minimumFractionDigits:0,maximumFractionDigits:2});
// Recipe status on each card: products without an active recipe are not deducted from inventory automatically.
function recipeBadge(recipe,catalogOk){
 if(!catalogOk)return '<span class="pm-recipe pm-recipe--muted">Recipe status unavailable</span>';
 if(!recipe)return '<span class="pm-recipe pm-recipe--none">'+icon('alert')+' Recipe not configured</span>';
 const n=recipe.lines.length,flags=flaggedLines(recipe);
 if(recipe.status==='active')return '<span class="pm-recipe pm-recipe--ok">'+icon('check')+' Recipe · '+n+' ingredient'+(n===1?'':'s')+'</span>';
 return '<span class="pm-recipe pm-recipe--draft">Draft recipe · '+(flags?flags+' to review':n+' ingredient'+(n===1?'':'s'))+'</span>';
}
export async function renderProducts(content,subpage=''){
 const editId=subpage==='edit'?location.hash.split('/')[2]:'';
 content.innerHTML='<header class="module-heading"><div><h1>Products</h1><p>Products, sizes and prices, photos, and the recipe each product deducts from inventory.</p></div></header>'+loadingCards(6);
 try{
  const catalogPromise=db.rpc('recipe_catalog',{}).catch(error=>{console.warn('Recipe catalog unavailable:',error);return null;});
  const [products,categories,legacy,catalog]=await Promise.all([db.catalog(),db.categories(),storefrontData(),catalogPromise]);
  const editing=editId?products.find(p=>p.id===editId):null;
  const packages=subpage==='packages'||editing?.kind==='package';
  content.innerHTML='<header class="module-heading"><div><h1>Products</h1><p>Products, sizes and prices, photos, and the recipe each product deducts from inventory.</p></div></header>'+toolbar('<select id="category" aria-label="Category"><option value="">All categories</option>'+categories.map(c=>'<option value="'+c.id+'">'+e(c.name)+'</option>').join('')+'</select><select id="status" aria-label="Status"><option value="">All states</option><option>active</option><option>archived</option></select><select id="recipe-filter" aria-label="Recipe"><option value="">Any recipe</option><option value="none">Recipe not configured</option><option value="draft">Draft recipe</option><option value="active">Active recipe</option></select><button class="button primary" id="add-product">'+icon('plus')+' Add '+(packages?'Package':'Product')+'</button><button class="button" id="add-category">'+icon('plus')+' Category</button><a class="button" href="#products'+(packages?'':'/packages')+'">'+icon('products')+' '+(packages?'Pastries':'Packages')+'</a>')+'<div id="catalog-status" class="pm-status"></div><div id="catalog-grid" class="pm-grid"></div>';
  const imageOf=p=>p.image_path?db.mediaURL(p.image_path):legacy.images[p.legacy_id];
  const draw=()=>{
   const category=content.querySelector('#category').value,status=content.querySelector('#status').value,recipeFilter=content.querySelector('#recipe-filter').value,q=content.querySelector('.search').value.toLowerCase();
   const filtered=products.filter(p=>{
    if(packages?p.kind!=='package':p.kind==='package')return false;
    if(category&&p.category_id!==category||status&&p.status!==status)return false;
    const r=catalog?recipeForProduct(catalog,p.id):null;
    if(recipeFilter&&catalog&&(recipeFilter==='none'?r:!r||r.status!==recipeFilter))return false;
    return [p.name,p.description,p.categories?.name].join(' ').toLowerCase().includes(q);
   });
   const missing=catalog?filtered.filter(p=>p.status==='active'&&recipeForProduct(catalog,p.id)?.status!=='active').length:0;
   content.querySelector('#catalog-status').innerHTML=filtered.length+' product'+(filtered.length===1?'':'s')+(missing?' · <button type="button" class="text-button pm-missing" data-show-missing>'+missing+' without an active recipe</button>':'');
   content.querySelector('#catalog-grid').innerHTML=filtered.map(p=>{
    const image=imageOf(p),live=p.product_variants.filter(v=>v.is_active),from=live.length?Math.min(...live.map(v=>Number(v.price))):null;
    const recipe=catalog?recipeForProduct(catalog,p.id):null;
    return '<article class="pm-card'+(p.status==='archived'?' is-archived':'')+'">'+
     '<button type="button" class="pm-card__media" data-edit="'+p.id+'" aria-label="Edit '+e(p.name)+'">'+(image?'<img src="'+e(image)+'" alt="" loading="lazy">':'<span class="pm-card__nophoto">'+icon('gallery')+'<small>No photo</small></span>')+(p.status==='archived'?'<span class="pm-card__flag">Archived</span>':'')+'</button>'+
     '<div class="pm-card__body"><h2>'+e(p.name)+'</h2><p class="pm-card__cat">'+e(p.categories?.name||(p.kind==='package'?'Package':'Uncategorized'))+'</p>'+
     '<p class="pm-card__price"><span>'+(from===null?'No active sizes':(live.length>1?'Starts at ':'')+'<strong>'+money(from)+'</strong>')+'</span><span>'+live.length+' size'+(live.length===1?'':'s')+'</span></p>'+recipeBadge(recipe,!!catalog)+'</div>'+
     '<div class="pm-card__actions"><button class="button button--small primary" data-edit="'+p.id+'">'+icon('edit')+' Edit product</button><button class="button button--small pm-card__archive" data-archive="'+p.id+'" aria-label="'+(p.status==='archived'?'Restore ':'Archive ')+e(p.name)+'" title="'+(p.status==='archived'?'Restore':'Archive')+'">'+icon('archive')+'</button></div></article>';
   }).join('')||'<div class="admin-empty-state"><h2>No matching products</h2><p>Try a different search, category, status or recipe filter.</p></div>';
  };
  const edit=p=>openProductEditor({product:p,categories,packages:packages||p?.kind==='package',catalog:catalogPromise.then(c=>c||db.rpc('recipe_catalog',{})),image:p?imageOf(p):'',
   onSaved:async({keepOpen}={})=>{if(keepOpen)return;if(location.hash.startsWith('#products/edit'))history.replaceState(null,'',packages?'#products/packages':'#products');await renderProducts(content,packages?'packages':'');}});
  content.querySelector('#add-product').onclick=()=>edit(null);
  content.querySelector('#add-category').onclick=()=>form('Add Category',field('name','Name','','text','required'),async data=>{await rows(db.client.from('categories').insert({name:data.name.trim(),slug:'category-'+crypto.randomUUID()}));await renderProducts(content,subpage);});
  content.onclick=async event=>{
   if(event.target.closest('[data-show-missing]')){content.querySelector('#recipe-filter').value='none';draw();return;}
   const b=event.target.closest('[data-edit],[data-archive]');if(!b)return;const p=products.find(p=>p.id===(b.dataset.edit||b.dataset.archive));
   if(b.dataset.edit)edit(p);
   else{if(p.status==='active'&&!await ask('“'+p.name+'” will be hidden from the shop. You can bring it back any time: choose “archived” in the status filter, then Restore.',{title:'Archive this product?',confirm:'Archive',tone:'danger'}))return;try{await rows(db.client.from('products').update({status:p.status==='active'?'archived':'active'}).eq('id',p.id));await renderProducts(content,subpage);}catch(error){fail(content,error);}}
  };
  content.querySelector('.search').oninput=draw;content.querySelector('#category').onchange=draw;content.querySelector('#status').onchange=draw;content.querySelector('#recipe-filter').onchange=draw;draw();
  if(editing)edit(editing);
 }catch(error){fail(content,error);}
}
