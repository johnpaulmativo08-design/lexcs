// A link that rebuilds an ordered DIY design in its designer on the shop site (bento, cupcakes, mini donuts, cake pops).
// With {viewer:true} the designer opens in view-only mode (embed=viewer): just the 3D stage, nothing saved or editable.
const DESIGN_KEYS=['frosting_color','border','accents','bow_color','message','lettering','lettering_color','topper','topper_text','layout','drip_color','font'];
const CUPCAKE_KEYS=['flavor','pattern','finishes','theme','theme_note','message','message_pieces','message_color'];
const DONUT_KEYS=['style','flavors','pattern','glazes','finishes','sprinkles','sprinkle_colors','theme','theme_note','message','message_text','message_pieces','message_color'];
const siteIndex=new URL('../index.html',import.meta.url).href;
const partOf=p=>p&&{style:p.style,colors:p.colors};
export const DESIGNERS=['bento','cupcake','donut','cakepop'];
export function designLink(line,{viewer=false}={}){
  const kind=line.design?.designer,cupcake=kind==='cupcake',d={};
  for(const key of cupcake?CUPCAKE_KEYS:kind==='donut'||kind==='cakepop'?DONUT_KEYS:DESIGN_KEYS)if(line.design?.[key]!=null)d[key]=line.design[key];
  if(cupcake){d.a=partOf(line.design.a);if(line.design.b)d.b=partOf(line.design.b);}
  const bytes=new TextEncoder().encode(JSON.stringify({v:line.variant_id,d}));
  const code=btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return siteIndex+(cupcake?'?cupcake=':kind==='donut'?'?donut=':kind==='cakepop'?'?cakepop=':'?design=')+code+(viewer?'&embed=viewer':'');
}
