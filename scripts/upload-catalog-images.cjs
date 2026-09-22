// Migrate existing embedded product assets without changing their assignments.
const fs=require('node:fs'),vm=require('node:vm'),{createClient}=require('@supabase/supabase-js');
const context={window:{}};vm.runInNewContext(fs.readFileSync('shared/supabase-config.js','utf8'),context);
const {url,key}=context.window.LexcSupabaseConfig;
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
async function main(){
 const auth=await client.auth.signInWithPassword({email:process.env.LEXC_ADMIN_EMAIL,password:process.env.LEXC_ADMIN_PASSWORD});if(auth.error)throw auth.error;
 const catalog=await client.from('products').select('id,legacy_id,image_path').not('legacy_id','is',null);if(catalog.error)throw catalog.error;
 const source=fs.readFileSync('index.html','utf8'),block=source.match(/const PRODUCT_IMAGES\s*=\s*\{([\s\S]*?)\n\};/)[1];
 const images=new Map([...block.matchAll(/(\d+):\s*"data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)"/g)].map(m=>[Number(m[1]),{type:m[2],bytes:Buffer.from(m[3].replace(/[\r\n]/g,''),'base64')}]));
 let count=0;
 for(const product of catalog.data){
  if(product.image_path)continue;
  const image=images.get(product.legacy_id);if(!image)continue;
  const path='products/'+product.id+'/'+crypto.randomUUID()+'.'+(image.type==='jpeg'?'jpg':image.type);
  const upload=await client.storage.from('catalog-media').upload(path,image.bytes,{contentType:'image/'+image.type,upsert:false});if(upload.error)throw upload.error;
  const update=await client.from('products').update({image_path:path}).eq('id',product.id);if(update.error)throw update.error;count++;
 }
 await client.auth.signOut();console.log('Uploaded and connected '+count+' existing catalog images.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

