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
  for (const table of ['profiles','orders','order_items','inventory_items','inventory_batches','inventory_movements','inventory_notifications','inventory_alert_state','reviews']) {
    const { data, error } = await client.from(table).select('*');
    assert.ok(error || data.length === 0, `${table} leaked private records`);
    console.log(`PASS guest cannot retrieve ${table}`);
  }
  const { error } = await client.rpc('create_order', { payload: {} });
  assert.ok(error, 'Guest checkout must fail');
  console.log('PASS guest checkout denied');
  for (const [name, payload] of [['inventory_snapshot', {}], ['inventory_action', { payload: {} }], ['read_inventory_notifications', { mark_all: true, notification_id: null }]]) {
    const response = await client.rpc(name, payload);
    assert.ok(response.error, `Guest ${name} must fail`);
    console.log(`PASS guest ${name} denied`);
  }
  const slots = await client.rpc('get_availability', { from_date: new Date().toISOString(), to_date: new Date(Date.now()+30*86400000).toISOString() });
  assert.equal(slots.error, null, slots.error?.message);
  console.log(`PASS public slot query: ${slots.data.length} slots (no invented capacity)`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
