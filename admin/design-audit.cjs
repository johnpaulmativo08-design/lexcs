const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.argv[2]);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>document.fonts.ready);
  const result=await page.evaluate(()=>{
   const properties=['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','textTransform','textDecoration','color','backgroundColor','backgroundImage','border','borderRadius','boxShadow','opacity','filter','backdropFilter','padding','gap','display','gridTemplateColumns','maxWidth','minWidth','position','overflow'];
   const selectors=['body','nav','.nav-logo','.nav-links a','.hero-h1','.hero-sub','.hero-desc','.section-title','.section-label','.btn-primary','.btn-outline','.feature-card','.preview-card','.product-card','.product-img','.product-name','.product-desc','.product-price','.product-badge','.auth-heading','.auth-label','.auth-input','.auth-btn','.auth-error','.auth-success','.sort-select','.footer-desc','.cart-drawer','.shop-sidebar','.shop-layout','.dt-modal','.checkout-wrap'];
   const computed=Object.fromEntries(selectors.map(selector=>{
    const element=document.querySelector(selector);if(!element)return[selector,null];
    const css=getComputedStyle(element),rect=element.getBoundingClientRect();
    return [selector,{...Object.fromEntries(properties.map(key=>[key,css[key]])),width:rect.width,height:rect.height}];
   }));
   const rules=[];
   for(const sheet of document.styleSheets){try {for(const rule of sheet.cssRules)rules.push(rule.cssText);}catch{}}
   return {viewport:innerWidth,computed,rules};
  });
  const dir=path.join(__dirname,'verification');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'customer-design.json'),JSON.stringify(result,null,2));
  await page.evaluate(()=>{document.querySelectorAll('.fade-up').forEach(el=>el.classList.add('visible'));document.getAnimations().forEach(a=>a.pause());});
  await page.screenshot({path:path.join(dir,'customer-home-before.png'),animations:'disabled'});
  await page.evaluate(()=>navigate('shop'));
  await page.screenshot({path:path.join(dir,'customer-shop-before.png'),animations:'disabled'});
  console.log(JSON.stringify(result.computed,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
