// Development integration tests. Credentials come only from the process environment.
// Test fixtures are explicitly named; never point this at a production project.
const {createClient}=require('@supabase/supabase-js');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const config={window:{}};vm.runInNewContext(fs.readFileSync('shared/supabase-config.js','utf8'),config);
const {url,key}=config.window.LexcSupabaseConfig;
const make=()=>createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
const admin=make(),a=make(),b=make(),guest=make(),fixtures={};
const ok=result=>{if(result.error)throw new Error(result.error.message);return result.data;};
const pass=name=>console.log('PASS '+name);
async function main(){
 const accounts=[['admin',admin],['customer',a],['other',b]];
 for(const [name,client] of accounts){
  const credentials={email:process.env['LEXC_'+name.toUpperCase()+'_EMAIL'],password:process.env['LEXC_'+name.toUpperCase()+'_PASSWORD']};
  if(!credentials.email||!credentials.password)throw new Error('Missing test credentials for '+name);
  const auth=ok(await client.auth.signInWithPassword(credentials));
  fixtures[name]=auth.user.id;
  const profile=ok(await client.from('profiles').select('*').eq('id',auth.user.id).single());
  const role=ok(await client.from('user_roles').select('role').eq('user_id',auth.user.id).single());
  assert.equal(role.role,name==='admin'?'admin':'customer');assert.ok(profile);pass(name+' Auth, profile and role');
 }
 assert.ok((await a.from('user_roles').update({role:'admin'}).eq('user_id',fixtures.customer)).error);pass('customer role escalation blocked');
 assert.deepEqual(ok(await a.from('inventory_items').select('*')),[]);pass('customer cannot read admin inventory');
 const newProduct=crypto.randomUUID();
 fixtures.product=newProduct;
 ok(await admin.rpc('save_product',{payload:{id:newProduct,slug:'verification-'+newProduct,name:'[TEST] Verification pastry',description:'Disposable integration fixture',kind:'standard',variants:[{code:'standard',label:'Test box',price:42,sort_order:0}]}}));
 const variant=ok(await admin.from('product_variants').select('*').eq('product_id',newProduct).single());fixtures.variant=variant.id;
 assert.equal(Number(variant.price),42);pass('admin product and variant transaction');
 assert.ok((await a.from('products').update({name:'ILLEGAL'}).eq('id',newProduct).select()).error || ok(await admin.from('products').select('name').eq('id',newProduct).single()).name==='[TEST] Verification pastry');pass('customer catalog write blocked');
 const start=new Date(Date.now()+40*86400000);start.setUTCHours(2,0,0,0);
 const end=new Date(start.getTime()+3600000);
 const slot=ok(await admin.rpc('save_slot',{payload:{starts_at:start.toISOString(),ends_at:end.toISOString(),capacity:1,is_open:true}}));fixtures.slot=slot.id;
 const payload={request_id:crypto.randomUUID(),name:'[TEST] Checkout verification',phone:'09000000000',fulfillment:'pickup',slot_id:slot.id,payment_method:'COD',items:[{variant_id:variant.id,qty:2,price:0}]};
 fixtures.request=payload.request_id;
 const result=await Promise.all([a.rpc('create_order',{payload}),b.rpc('create_order',{payload:{...payload,request_id:crypto.randomUUID()}})]);
 assert.equal(result.filter(r=>!r.error).length,1);pass('concurrent checkout cannot exceed slot capacity');
 const winner=result[0].error?b:a,other=result[0].error?a:b,order=ok(result.find(r=>!r.error));fixtures.order=order.id;
 assert.equal(Number(order.items_subtotal),84);assert.equal(order.payment_status,'unpaid');assert.equal(order.items.length,1);pass('server pricing, item snapshots and unpaid order');
 const own=ok(await winner.from('orders').select('id').eq('id',order.id));assert.equal(own.length,1);
 assert.equal(ok(await other.from('orders').select('id').eq('id',order.id)).length,0);
 assert.equal(ok(await other.from('order_items').select('id').eq('order_id',order.id)).length,0);pass('own-order access and other-customer isolation');
 assert.ok((await admin.rpc('save_slot',{payload:{...slot,capacity:0}})).error);pass('capacity cannot be reduced below reservations');
 if(winner===a){const retry=ok(await a.rpc('create_order',{payload}));assert.equal(retry.id,order.id);pass('checkout retry idempotency');}
 const item=ok(await admin.from('inventory_items').insert({name:'[TEST] Verification ingredient '+crypto.randomUUID(),unit:'g',min_stock:5}).select().single());fixtures.inventory=item.id;
 const movement=ok(await admin.rpc('record_inventory',{payload:{request_id:crypto.randomUUID(),item_id:item.id,batch_code:'TEST-'+crypto.randomUUID(),quantity:10,reason:'receipt'}}));fixtures.batch=movement.batch_id;
 assert.ok((await admin.rpc('record_inventory',{payload:{request_id:crypto.randomUUID(),batch_id:movement.batch_id,quantity:-11,reason:'usage'}})).error);pass('stock receipt and negative-stock prevention');
 const inventory=ok(await admin.from('inventory_stock').select('stock').eq('id',item.id).single());assert.equal(Number(inventory.stock),10);
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0uoAAAAASUVORK5CYII=','base64');
 const path=fixtures.customer+'/verification/'+crypto.randomUUID()+'.png';fixtures.reference=path;
 ok(await a.storage.from('customer-references').upload(path,image,{contentType:'image/png',upsert:false}));
 assert.ok(ok(await a.storage.from('customer-references').download(path)));
 assert.ok((await b.storage.from('customer-references').download(path)).error);
 assert.ok((await guest.storage.from('customer-references').download(path)).error);
 assert.ok((await b.storage.from('customer-references').upload(fixtures.customer+'/verification/unauthorized.png',image,{contentType:'image/png'})).error);pass('private reference upload/read and cross-user/guest denial');
 assert.ok((await a.rpc('set_order_status',{order_id:order.id,next_status:'confirmed'})).error);pass('customer cannot manage order statuses');
 for(const status of ['confirmed','preparing','ready','completed'])ok(await admin.rpc('set_order_status',{order_id:order.id,next_status:status}));
 const review=ok(await winner.rpc('submit_review',{payload:{order_id:order.id,rating:5,text:'[TEST] Verified review',display_name:'Verification customer'}}));fixtures.review=review.id;
 assert.equal(review.visibility,'hidden');
 ok(await admin.from('reviews').update({visibility:'visible'}).eq('id',review.id));
 assert.ok(ok(await guest.rpc('get_public_reviews')).some(r=>r.id===review.id));pass('completed-order review and admin visibility');
 await admin.from('reviews').update({visibility:'hidden'}).eq('id',review.id);
 await admin.from('products').update({status:'archived'}).eq('id',newProduct);
 assert.equal(ok(await guest.from('products').select('id').eq('id',newProduct)).length,0);pass('archived product hidden from guests');
 ok(await admin.rpc('save_slot',{payload:{...slot,is_open:false}}));
 for(const [,client]of accounts){ok(await client.auth.signOut());}pass('all test sessions signed out');
}
main().catch(error=>{console.error('FAIL '+error.message);process.exitCode=1;}).finally(()=>console.log('FIXTURES '+JSON.stringify(fixtures)));

