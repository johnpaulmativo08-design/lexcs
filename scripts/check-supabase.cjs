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
  const method=await client.from('payment_methods').select('code,active,qr_image_path').eq('active',true);
  assert.equal(method.error,null,method.error?.message);
  assert.deepEqual(method.data.map(row=>row.code).sort(),['gcash','maribank'],'only the GCash and MariBank QRs are active');
  for(const code of ['maribank','gcash']) {
    const match=method.data.filter(row=>row.code===code);
    assert.equal(match.length,1,`${code} method must exist once`);
    assert.equal(match[0].active,true,`${code} method must be active`);
    assert.ok(fs.existsSync(match[0].qr_image_path),`${code} QR image must exist`);
  }
  console.log('PASS GCash and MariBank QR methods');
  for (const table of ['profiles','orders','order_items','customer_carts','inventory_items','inventory_batches','inventory_movements','inventory_notifications','inventory_alert_state','reviews','order_payment_attempts']) {
    const { data, error } = await client.from(table).select('*');
    assert.ok(error || data.length === 0, `${table} leaked private records`);
    console.log(`PASS guest cannot retrieve ${table}`);
  }
  const { error } = await client.rpc('create_order', { payload: {} });
  assert.ok(error, 'Guest checkout must fail');
  console.log('PASS guest checkout denied');
  for (const [name, payload] of [['inventory_snapshot', {}], ['inventory_action', { payload: {} }], ['read_inventory_notifications', { mark_all: true, notification_id: null }], ['start_order_payment',{target_order:'00000000-0000-4000-8000-000000000000',method_code:'maribank'}],['submit_order_payment',{target_payment:'00000000-0000-4000-8000-000000000000',reference_number:'TEST-NOT-REAL',proof_path:'none'}],['review_order_payment',{target_payment:'00000000-0000-4000-8000-000000000000',decision:'paid',review_reason:'test'}],['quote_order_delivery',{target_order:'00000000-0000-4000-8000-000000000000',quoted_fee:1}],['cancel_my_order',{order_id:'00000000-0000-4000-8000-000000000000'}]]) {
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
