// Run: node admin/verify.cjs <path-to-playwright> [screenshot-directory]
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require(process.argv[2] || 'playwright');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const failed = [];
    page.on('response', response => { if (response.status() >= 400) failed.push(response.url()); });
    await page.goto('http://127.0.0.1:8000/admin/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL('**/login.html');
    await page.locator('[name=email]').fill('admin@lexcsnacktime.local');
    await page.locator('[name=password]').fill(process.env.LEXC_ADMIN_PASSWORD || '');
    await page.getByRole('button',{name:'Log In',exact:true}).click();
    await page.waitForURL('**/#dashboard');
    await page.evaluate(() => document.fonts.ready);
    assert.equal((await page.locator('.sidebar').boundingBox()).width, 232);
    assert.equal((await page.locator('.header').boundingBox()).height, 70);
    await page.locator('[data-refresh-dashboard]').waitFor();
    assert.equal(await page.locator('.ops-metric').count(), 5);
    assert.equal(await page.locator('.ops-capacity [role="meter"]').count(), 7);
    assert.equal(await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), true);
    if (process.argv[3]) await page.screenshot({ path: path.join(process.argv[3], 'admin-dashboard.png'), fullPage: true });
    await page.goto('http://127.0.0.1:8000/admin/#products');
    await page.locator('.admin-product').first().waitFor();
    assert.equal(await page.locator('.admin-product').count(), 25);
    await page.getByRole('button',{name:'View details'}).first().click();
    assert.equal(await page.locator('dialog[open]').count(),1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog').count(),0);
    await page.getByRole('searchbox').fill('Banana Loaf');
    assert.equal(await page.locator('.admin-product').count(), 2);
    await page.getByRole('searchbox').fill('');
    await page.locator('#category').selectOption('yema');
    assert.equal(await page.locator('.admin-product').count(), 1);
    assert.match(await page.locator('.variants').innerText(), /280/);
    await page.goto('http://127.0.0.1:8000/admin/#products/packages');
    await page.locator('.package-card').first().waitFor();
    assert.equal(await page.locator('.package-card').count(), 3);
    for (const route of ['products', 'products/packages', 'inventory', 'inventory/restock', 'orders', 'reports', 'reports/transactions', 'reports/revenue', 'gallery', 'profile', 'profile/password']) {
      await page.goto(`http://127.0.0.1:8000/admin/#${route}`, { waitUntil:'domcontentloaded' });
      await page.locator('#content').locator(':scope > *').first().waitFor();
      assert.equal(await page.locator('.nav-item[aria-current="page"]').count(), 1);
    }
    for (const width of [1440, 1366, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of ['dashboard','products','products/packages','inventory','inventory/restock','orders','reports','reports/transactions','reports/revenue','gallery','profile','profile/password']) {
        await page.goto(`http://127.0.0.1:8000/admin/#${route}`);
        if (route === 'products') await page.locator('.admin-product').first().waitFor();
        if (route === 'products/packages') await page.locator('.package-card').first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `Overflow on ${route} at ${width}`);
        if (process.argv[3] && [1440,390].includes(width)) await page.screenshot({path:path.join(process.argv[3],`admin-${route.replaceAll('/','-')}-${width}.png`),fullPage:true});
      }
    }
    await page.locator('.mobile-menu').click();
    assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'), 'true');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.mobile-menu').getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
    assert.deepEqual(failed, []);
    // Separate customer context: do not alter a user's browser/cart/account.
    const customer = await browser.newPage();
    await customer.route('https://**/*', route => route.abort());
    await customer.goto('http://127.0.0.1:8000/', {waitUntil:'domcontentloaded'});
    await customer.evaluate(() => navigate('shop'));
    assert.equal(await customer.locator('#productsGrid .product-card').count(), 25);
    await customer.evaluate(() => { document.querySelector('#size-2').value = '1'; addToCartById(2); });
    assert.deepEqual(await customer.evaluate(() => ({price:cart[0].price, size:cart[0].sizeLabel, qty:cart[0].qty})), {price:620,size:'36pcs',qty:1});
    await customer.evaluate(() => { changeQty(0,1); goToCheckout(); });
    assert.equal(await customer.locator('.page.active').getAttribute('id'),'page-login');
    await customer.evaluate(() => completeCustomerLogin({name:'Test Customer',email:'test@example.com'}));
    assert.match(await customer.locator('#checkoutGrandTotal').innerText(), /1,240/);
    await customer.evaluate(() => { document.querySelector('#coDate').value='2026-12-20'; document.querySelector('#coTime').value='10:00 AM'; renderCheckout(); });
    assert.equal(await customer.locator('#coDate').inputValue(), '');
    assert.equal(await customer.locator('#coTime').inputValue(), '');
    await customer.evaluate(() => { handleForgotPassword(); });
    assert.ok(await customer.getByText(/Password reset isn't available yet/).count());
    await customer.evaluate(() => addPackageToCart('Mini Bliss',1800));
    assert.equal(await customer.evaluate(() => cart.find(item=>item.id==='pkg-Mini Bliss').price),1800);
    await customer.close();
    console.log('PASS: ADMIN shell, catalog search/filter, packages, routes, calendar, assets, responsive overflow, drawer, runtime checks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
