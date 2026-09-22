import {escapeHtml as e,icon,notice,toolbar} from '../components.js?v=3';
import {db,rows,grid,field,form,fail} from '../backend-ui.js';
export async function renderGallery(content){
 try{
  const [reviews,gallery]=await Promise.all([rows(db.client.from('reviews').select('*').order('created_at',{ascending:false})),db.gallery()]);
  content.innerHTML='<header class="module-heading"><div><h1>Reviews &amp; Gallery</h1><p>Moderate customer feedback and curate public gallery images.</p></div></header>'+toolbar('<button class="button primary" id="add-gallery">'+icon('plus')+' Add Gallery Photo</button><select id="visibility"><option value="">All</option><option>visible</option><option>hidden</option></select>')+'<section class="panel"><h2 class="panel-title"><span>Customer Reviews</span>'+icon('reports')+'</h2><div id="reviews"></div></section><h2 class="section-heading">Curated Gallery</h2><div class="product-grid" id="gallery"></div>';
  const draw=()=>{
   const visibility=content.querySelector('#visibility').value,q=content.querySelector('.search').value.toLowerCase();
   const match=i=>(!visibility||i.visibility===visibility)&&JSON.stringify(i).toLowerCase().includes(q);
   content.querySelector('#reviews').innerHTML=grid(['Customer','Rating','Review','Visibility'],reviews.filter(match).map(r=>'<tr><td>'+e(r.public_display_name)+'</td><td>'+r.rating+'/5</td><td>'+e(r.review_text)+'</td><td><button class="button" data-review="'+r.id+'">'+icon('eye')+' '+e(r.visibility)+' · toggle</button></td></tr>').join('')||'<tr><td colspan="4">No reviews yet.</td></tr>');
   content.querySelector('#gallery').innerHTML=gallery.filter(match).map(g=>'<article class="admin-product"><img class="product-photo" src="'+e(db.mediaURL(g.image_path))+'" alt="'+e(g.label)+'"><h2>'+e(g.label)+'</h2><p>'+e(g.description)+'</p><button class="button" data-gallery="'+g.id+'">'+icon('eye')+' '+e(g.visibility)+' · toggle</button></article>').join('');
  };
  content.querySelector('#add-gallery').onclick=()=>form('Add Gallery Photo',field('label','Label','','text','required')+field('description','Description')+field('category','Category','themed')+field('image','Photo','','file','accept="image/jpeg,image/png,image/webp" required'),async(data,form)=>{const image_path=await db.upload('catalog-media','gallery/'+crypto.randomUUID(),form.elements.image.files[0]);await rows(db.client.from('gallery_entries').insert({label:data.label,description:data.description,category:data.category,image_path,visibility:'hidden'}));await renderGallery(content);});
  content.onclick=async event=>{const b=event.target.closest('[data-review],[data-gallery]');if(!b)return;const review=!!b.dataset.review;const r=(review?reviews:gallery).find(r=>r.id===(b.dataset.review||b.dataset.gallery));try{await rows(db.client.from(review?'reviews':'gallery_entries').update({visibility:r.visibility==='visible'?'hidden':'visible'}).eq('id',r.id));r.visibility=r.visibility==='visible'?'hidden':'visible';draw();}catch(error){fail(content,error);}};
  content.querySelector('.search').oninput=draw;content.querySelector('#visibility').onchange=draw;draw();
 }catch(error){fail(content,error);}
}
