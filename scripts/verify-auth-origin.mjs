import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const base=process.argv[2]||'https://sonkoflow.com';
if(new URL(base).origin!==base||new URL(base).protocol!=='https:')throw Error('Use the exact approved HTTPS origin.');
const dir=mkdtempSync(join(tmpdir(),'sonko-auth-origin-'));
const checks=[];
function request(path,{method='GET',origin,token,cookie}={}){
 const headersPath=join(dir,'headers');
 const args=['--silent','--show-error','--max-time','20','--dump-header',headersPath,'--write-out','\nAUTH_STATUS:%{http_code}',base+path];
 if(method==='POST')args.push('--request','POST','--header','Content-Type: application/json','--data','{}');
 if(origin!==undefined)args.push('--header','Origin: '+origin);
 if(cookie)args.push('--header','Cookie: '+cookie);
 if(token)args.push('--header','X-Sonkoflow-Auth-Request: '+token);
 const result=spawnSync('curl',args,{encoding:'utf8',maxBuffer:65536});
 if(result.status!==0)throw Error('Auth origin check transport unavailable.');
 const match=result.stdout.match(/\nAUTH_STATUS:(\d+)$/);let body;
 try{body=JSON.parse(result.stdout.slice(0,match?.index))}catch{}
 return{status:Number(match?.[1]),body,headers:readFileSync(headersPath,'utf8')};
}
function check(name,response,expected){checks.push({name,ok:response.status===expected,status:response.status})}
try{
 // With no login session, signout is rejected before its handler and changes no user data.
 check('canonical_origin_keeps_authentication_required',request('/api/auth/signout',{method:'POST',origin:base}),401);
 check('unproved_missing_origin_rejected',request('/api/auth/signout',{method:'POST'}),403);
 check('unproved_opaque_origin_rejected',request('/api/auth/signout',{method:'POST',origin:'null'}),403);
 const proof=request('/api/public/auth-request');
 const cookie=proof.headers.match(/^set-cookie:\s*(__Host-sonkoflow_auth_request=[^;\r\n]+)([^\r\n]*)/im);
 checks.push({name:'verification_cookie_is_secure_and_noncacheable',ok:proof.status===200&&typeof proof.body?.token==='string'&&!!cookie&&/HttpOnly/i.test(cookie[2])&&/Secure/i.test(cookie[2])&&/SameSite=Strict/i.test(cookie[2])&&/^cache-control:\s*no-store/im.test(proof.headers),status:proof.status});
 if(cookie&&proof.body?.token){
  const options={method:'POST',cookie:cookie[1],token:proof.body.token};
  check('proved_opaque_origin_still_requires_login',request('/api/auth/signout',{...options,origin:'null'}),401);
  check('proved_missing_origin_still_requires_login',request('/api/auth/signout',options),401);
  check('explicit_foreign_origin_stays_rejected',request('/api/auth/signout',{...options,origin:'https://foreign-origin.invalid'}),403);
 }
 console.log(JSON.stringify({origin:base,passed:checks.filter(c=>c.ok).length,total:checks.length,checks},null,2));
 if(checks.length!==7||checks.some(c=>!c.ok))process.exitCode=1;
}finally{rmSync(dir,{recursive:true,force:true})}
