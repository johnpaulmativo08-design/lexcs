// Read-only Data API checks. Uses the publishable key, never service-role access.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('shared/supabase-config.js', 'utf8'), context);
const { url, key } = context.window.LexcSupabaseConfig;
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
async function main() {
  for (const table of ['categories','products','product_variants','gallery_entries']) {
    const { data, error } = await client.from(table).select('id');
    assert.equal(error, null, `${table}: ${error?.message}`);
    assert.ok(data.length > 0);
    console.log(`PASS public ${table}: ${data.length} records`);
  }
  const method=await client.from('payment_methods').select('code,active,qr_image_path').in('code',['maribank','gcash','maya']);
  assert.equal(method.error,null,method.error?.message);
  for(const code of ['maribank','gcash','maya']) {
    const match=method.data.filter(row=>row.code===code);
    assert.equal(match.length,1,`${code} method must exist once`);
    assert.equal(match[0].active,true,`${code} method must be active`);
    assert.ok(fs.existsSync(match[0].qr_image_path),`${code} QR image must exist`);
  }
  const testProduct=await client.from('products').select('id,is_test_product,product_variants(price)').eq('slug','product-a-payment-system-test');
  assert.equal(testProduct.error,null,testProduct.error?.message);
  assert.equal(testProduct.data.length,1,'Product A must exist once');
  assert.equal(testProduct.data[0].is_test_product,true);
  assert.equal(Number(testProduct.data[0].product_variants[0]?.price),1);
  console.log('PASS MariBank, GCash, Maya methods and unique ₱1 Product A');
  for (const table of ['profiles','orders','order_items','customer_carts','inventory_items','inventory_batches','inventory_movements','inventory_notifications','inventory_alert_state','reviews','payment_tests','order_payment_attempts']) {
    const { data, error } = await client.from(table).select('*');
    assert.ok(error || data.length === 0, `${table} leaked private records`);
    console.log(`PASS guest cannot retrieve ${table}`);
  }
  const { error } = await client.rpc('create_order', { payload: {} });
  assert.ok(error, 'Guest checkout must fail');
  console.log('PASS guest checkout denied');
  for (const [name, payload] of [['inventory_snapshot', {}], ['inventory_action', { payload: {} }], ['read_inventory_notifications', { mark_all: true, notification_id: null }], ['start_payment_test', { request_id: '00000000-0000-4000-8000-000000000000' }], ['review_payment_test', { test_id: '00000000-0000-4000-8000-000000000000', decision: 'verified', note: 'test' }], ['start_order_payment',{target_order:'00000000-0000-4000-8000-000000000000',method_code:'maribank'}],['submit_order_payment',{target_payment:'00000000-0000-4000-8000-000000000000',reference_number:'TEST-NOT-REAL',proof_path:'none'}],['review_order_payment',{target_payment:'00000000-0000-4000-8000-000000000000',decision:'paid',review_reason:'test'}],['quote_order_delivery',{target_order:'00000000-0000-4000-8000-000000000000',quoted_fee:1}],['cancel_my_order',{order_id:'00000000-0000-4000-8000-000000000000'}]]) {
    const response = await client.rpc(name, payload);
    assert.ok(response.error, `Guest ${name} must fail`);
    console.log(`PASS guest ${name} denied`);
  }
  const proofUpload=await client.functions.invoke('upload-payment-proof',{body:new FormData()});
  assert.ok(proofUpload.error,'Guest proof upload must fail');
  console.log('PASS guest proof upload denied');
  const slots = await client.rpc('get_availability', { from_date: new Date().toISOString(), to_date: new Date(Date.now()+30*86400000).toISOString() });
  assert.equal(slots.error, null, slots.error?.message);
  console.log(`PASS public slot query: ${slots.data.length} slots (no invented capacity)`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
