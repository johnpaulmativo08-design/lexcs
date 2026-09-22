const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require(process.argv[2]);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const failed=[];page.on('response',r=>{if(r.status()>=400)failed.push(r.url());});
  await page.goto('http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>document.fonts.ready);
  const before=JSON.parse(fs.readFileSync(path.join(__dirname,'verification/customer-design.json'))).computed;
  const differences=await page.evaluate(before=>{
   const differences=[];
   for(const [selector,values] of Object.entries(before)){
    const element=document.querySelector(selector);if(!element||!values)continue;
    const style=getComputedStyle(element);
    for(const [property,value]of Object.entries(values))if(!['width','height'].includes(property)&&style[property]!==value)differences.push({selector,property,before:value,after:style[property]});
   }return differences;
  },before);
  assert.deepEqual(differences,[]);
  await page.evaluate(()=>{document.querySelectorAll('.fade-up').forEach(el=>el.classList.add('visible'));document.getAnimations().forEach(a=>a.pause());});
  await page.screenshot({path:path.join(__dirname,'verification/customer-home-after.png'),animations:'disabled'});
  const expanded={};
  for(const [route,selectors] of Object.entries({home:['.home-hero-card','.home-hero-card h1','.hero-tagline','.btn-hero-shop','.home-baked-text h2','.home-footer','.faq-question'],shop:['.shop-wrapper','.sidebar','.products-grid','.product-card','.product-img','.product-name','.product-desc','.product-price','.sort-select'],login:['.auth-wrap','.auth-card','.auth-label','.auth-input','.auth-btn'],gallery:['.gallery-masonry','.gallery-item']})){
   await page.evaluate(route=>navigate(route),route);
   expanded[route]=await page.evaluate(selectors=>Object.fromEntries(selectors.map(selector=>{
    const el=document.querySelector(selector);if(!el)return[selector,null];const css=getComputedStyle(el),r=el.getBoundingClientRect();
    return[selector,{width:r.width,height:r.height,...Object.fromEntries(['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','color','backgroundColor','padding','gap','borderRadius','display','gridTemplateColumns'].map(k=>[k,css[k]]))}];
   })),selectors);
   if(route==='shop')await page.screenshot({path:path.join(__dirname,'verification/customer-shop-after.png'),animations:'disabled'});
  }
  fs.writeFileSync(path.join(__dirname,'verification/customer-expanded.json'),JSON.stringify(expanded,null,2));
  console.log('PASS: customer computed styles unchanged after shared token extraction. Before/after screenshots captured.');
  console.log('Existing HTTP failures: '+JSON.stringify(failed));
  console.log('Font availability: '+await page.evaluate(()=>JSON.stringify([...document.fonts].map(f=>({family:f.family,status:f.status})))));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
