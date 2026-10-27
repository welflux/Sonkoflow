import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
if(process.env.SESSION_ENCRYPTION_KEY && process.env.RATE_LIMIT_KEY){
 console.log('Local session keys are already provided by the environment. No file created.');
}else{
 try{
  await writeFile('.env',`# Local-only keys. Do not commit or share this file.\nSESSION_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nRATE_LIMIT_KEY=${randomBytes(32).toString('hex')}\n`,{flag:'wx',mode:0o600});
  console.log('Created ignored .env with two independent local session keys. No Supabase credentials were copied.');
 }catch(error){if(error.code==='EEXIST')console.log('Existing .env preserved. No keys replaced.');else throw error;}
}
