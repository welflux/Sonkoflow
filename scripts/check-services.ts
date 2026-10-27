import { createClient } from '@supabase/supabase-js';
import { providerFetch } from '../server/transport.js';
const names=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','SUPABASE_SECRET_KEY','SESSION_ENCRYPTION_KEY','RATE_LIMIT_KEY'];
const missing=names.filter(name=>!process.env[name]);
for(const name of names)console.log(`${name}: ${process.env[name]?'present':'missing'}`);
if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SECRET_KEY){
 console.log('BLOCKED: Supabase URL and backend secret must be applied to this running environment. No connection was attempted.');process.exitCode=2;
}else{
 try{
  const url=new URL(process.env.SUPABASE_URL);if(url.protocol!=='https:')throw new Error('TLS_REQUIRED');
  const client=createClient(url.origin,process.env.SUPABASE_SECRET_KEY,{global:{fetch:providerFetch},auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await client.auth.admin.listUsers({page:1,perPage:1});
  if(auth.error){console.log(`Backend authentication check: FAILED (HTTP ${auth.error.status??'unknown'}). No account data displayed.`);process.exitCode=1;}
  else console.log('Backend authentication check: passed (read-only; account details suppressed).');
  const tables=['profiles','projects','images','processing_jobs','usage_events','app_sessions','rate_limits'];
  for(const table of tables){const result=await client.from(table).select('*').limit(0);const ok=!result.error&&result.status>=200&&result.status<300;console.log(`${table} schema check: ${ok?'passed':'FAILED'} (HTTP ${result.status})`);if(!ok)process.exitCode=1;}
  const bucket=await client.storage.getBucket('photos');
  if(bucket.error||!bucket.data){console.log('Private photos bucket: FAILED / unavailable');process.exitCode=1;}
  else{const valid=bucket.data.public===false&&Number(bucket.data.file_size_limit)===10485760&&bucket.data.allowed_mime_types?.length===1&&bucket.data.allowed_mime_types[0]==='image/webp';console.log(`Private photos bucket settings: ${valid?'passed':'FAILED'}`);if(!valid)process.exitCode=1;}
 }catch{console.log('Service check FAILED. Verify network access, TLS trust, endpoint, and credential bindings. Secret values and raw provider errors are suppressed.');process.exitCode=1;}
 if(missing.length){console.log('Full application verification remains blocked by missing variables listed above.');process.exitCode=2;}
}
