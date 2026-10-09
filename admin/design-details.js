// The bake sheet for a DIY design (bento, cupcakes, mini donuts, cake pops): used in Orders and in the 3D viewer.
import {escapeHtml as e,money} from './components.js?v=3';

// Bento designs (phase 32) are shown as a readable bake sheet; older custom items keep the raw details.
// Letters typed per cupcake / per mini donut (phase 50): "1: LOVE · 3: MOM" (pieces left empty get no letters).
const piecesText=(c,noun)=>(c.message_pieces||[]).map((p,i)=>p?(i+1)+': '+p:'').filter(Boolean).join(' · ')+((c.message_pieces||[]).length?' (by '+noun+' position in the box)':'');
function cupcakeDetails(c){
 const part=p=>p?(p.style_label||p.style)+' — '+(p.color_labels||p.colors||[]).join(', '):'';
 const rows=[['Size',c.size==='regular'?'3oz cupcakes':'Mini cupcakes'],['Flavor',c.flavor_label||c.flavor],['Arrangement',c.pattern_label||c.pattern],
  [c.pattern==='alternate'?'Design A':c.pattern==='assorted'?'Palette':'Design',part(c.a)]];
 if(c.b)rows.push(['Design B',part(c.b)]);
 rows.push(['Finishing',(c.finishes||[]).map(f=>String(f).replace(/_/g,' ')).join(', ')||'None'],['Theme',c.theme&&c.theme!=='none'?(c.theme_label||c.theme)+(c.theme_note?': '+c.theme_note:''):'None']);
 if(c.message==='letters')rows.push(['Fondant letters',piecesText(c,'cupcake')+' · '+(c.message_color_label||c.message_color)]);
 rows.push(['Design extras',money(c.extras_per_item||0)+' per box']);
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>Cupcake design</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+e(v)+'</dd>').join('')+'</dl></div>';
}
function donutDetails(c){
 const rows=[...(c.designer==='cakepop'?[['Pop',c.style_label||c.style]]:[]),['Flavor',(c.flavor_labels||c.flavors||[]).join(' + ')],[c.designer==='cakepop'?'Coating':'Glaze',(c.pattern_label||c.pattern)+' — '+(c.glaze_labels||c.glazes||[]).join(', ')],
  ['Finishes',(c.finish_labels||c.finishes||[]).join(', ')||'None'],['Sprinkles',(c.sprinkles_label||c.sprinkles)+((c.sprinkle_color_labels||[]).length?' ('+c.sprinkle_color_labels.join(', ')+')':'')],
  ['Toppers',c.theme&&c.theme!=='none'?(c.theme_label||c.theme)+(c.theme_note?': '+c.theme_note:''):'None'],
  ...(c.designer==='cakepop'?[]:[['Message',c.message&&c.message!=='none'?(c.message_label||c.message)+' '+(c.message_pieces?piecesText(c,'donut'):'"'+c.message_text+'"')+' · '+(c.message_color_label||c.message_color):'None']]),['Design extras',money(c.extras_per_item||0)+' per box']];
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>'+(c.designer==='cakepop'?'Cake pop design':'Donut design')+'</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+e(v)+'</dd>').join('')+'</dl></div>';
}
export function designDetails(c){
 if(c.designer==='cupcake')return cupcakeDetails(c);
 if(c.designer==='donut'||c.designer==='cakepop')return donutDetails(c);
 if(c.designer!=='bento')return '<pre style="white-space:pre-wrap">'+e(JSON.stringify(c,null,2))+'</pre>';
 const name=code=>String(code||'').replace(/_/g,' ');
 const rows=[['Frosting',c.frosting_color_label||name(c.frosting_color)],['Border',(c.border||[]).map(name).join(', ')||'None'],
  ['Decorations',(c.accents||[]).map(a=>name(a)+(a==='ribbon_bows'&&c.bow_color?' ('+name(c.bow_color)+')':'')+(a==='drip'?' ('+(c.drip_color?name(c.drip_color):'matching, darker frosting')+')':'')).join(', ')||'None'],
  ['Message',c.message?'':'None'],['Lettering',c.message?name(c.lettering)+', '+name(c.lettering_color)+(c.font?', font: '+name(c.font):''):'—'],
  ['Topper',c.topper&&c.topper!=='none'?name(c.topper)+(c.topper_text?' '+c.topper_text:''):'None'],['Placement',c.layout?'Arranged by the customer — follow the design pictures':'Standard'],['Design extras',money(c.extras_per_item||0)+' per cake']];
 return '<div style="margin:8px 0 4px;padding:10px 12px;border:1px solid #e5ddec;border-radius:10px;background:#fcf9fe"><strong>Bento design</strong><dl style="display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;margin:8px 0 0">'
  +rows.map(([k,v])=>'<dt style="color:#705c7c">'+e(k)+'</dt><dd style="margin:0">'+(k==='Message'&&c.message?'<span style="display:block;white-space:pre-wrap;font-size:1.05rem;font-weight:700;padding:6px 8px;background:#fff;border:1px dashed #c8b2dc;border-radius:8px">'+e(c.message)+'</span>':e(v))+'</dd>').join('')+'</dl></div>';
}
