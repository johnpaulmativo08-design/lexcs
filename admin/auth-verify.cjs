const assert = require('node:assert/strict');
const { chromium } = require(process.argv[2]);
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  const page = await browser.newPage();
  for (const route of ['dashboard','products','inventory','inventory/restock','orders','reports','reports/revenue','reports/transactions','gallery','profile','profile/password']) {
   await page.goto('http://127.0.0.1:8000/admin/#'+route);
   await page.waitForURL('**/login.html');
  }
  await page.locator('[name=email]').fill('admin@lexcsnacktime.local');
  await page.screenshot({path:require('node:path').join(__dirname,'verification/admin-login.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1280,height:900});
  await page.locator('[name=password]').fill('wrong');
  await page.getByRole('button',{name:'Log In',exact:true}).click();
  assert.equal(await page.locator('#login-error').innerText(),'Incorrect email or password.');
  assert.ok(page.url().endsWith('login.html'));
  await page.locator('[name=password]').fill(process.env.LEXC_ADMIN_PASSWORD || '');
  await page.getByRole('button',{name:'Log In',exact:true}).click();
  await page.waitForURL('**/#dashboard');
  await page.reload();
  await page.goto('http://127.0.0.1:8000/', {waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{navigate('shop');addToCartById(2);goToCheckout();});
  assert.equal(await page.locator('.page.active').getAttribute('id'),'page-login');
  await page.goto('http://127.0.0.1:8000/admin/#dashboard');
  await page.locator('.logout').click();
  await page.waitForURL('**/login.html');
  await page.goto('http://127.0.0.1:8000/admin/#products');
  await page.waitForURL('**/login.html');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('admin_logged_in')),null);
  console.log('PASS: all admin guards, wrong credentials, correct login, refresh, logout, reentry.');
 } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
