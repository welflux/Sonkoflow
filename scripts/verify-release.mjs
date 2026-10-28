import{spawnSync}from'node:child_process';
const base=process.argv[2]||'https://sonkoflow.com';const origin=new URL(base);if(origin.protocol!=='https:'||origin.origin!==base)throw Error('Supply the exact approved HTTPS origin, without a trailing slash.');
function get(path){
  const r=spawnSync('curl',['--silent','--show-error','--max-time','15','--write-out','\nRELEASE_STATUS:%{http_code}\nRELEASE_REDIRECT:%{redirect_url}',base+path],{encoding:'utf8',maxBuffer:3*1024*1024});
  if(r.status!==0)return{status:0,error:'transport_unavailable',body:''};
  const meta=r.stdout.match(/\nRELEASE_STATUS:(\d+)\nRELEASE_REDIRECT:([^\n]*)$/);
  const status=Number(meta?.[1]??0),body=meta?r.stdout.slice(0,meta.index):r.stdout;
  let json;try{json=JSON.parse(body);}catch{}
  let location=meta?.[2];if(location){const target=new URL(location,base);if(target.origin===base)location=target.pathname+target.search;}
  return{status,body,json,location};
}
const checks=[];function record(name,ok,detail){checks.push({name,ok,...detail});}
const home=get('/');record('new_homepage',home.status===200&&home.body.includes('/brand/wordmark-ink.svg')&&home.body.includes('Made for'),{status:home.status});
const health=get('/api/health');record('backend_health',health.status===200&&health.json?.status==='ok',{status:health.status});
const catalog=get('/api/public/pricing');record('pricing_catalog',catalog.status===200&&catalog.json?.offers?.starter_monthly?.cents===900&&catalog.json?.offers?.pro_monthly?.cents===1900,{status:catalog.status,checkoutEnabled:catalog.json?.checkout_enabled??null});
const auth=get('/api/public/auth');record('google_capability',auth.status===200&&typeof auth.json?.google==='boolean',{status:auth.status,googleEnabled:auth.json?.google??null});
const account=get('/account/signin');record('account_shell',account.status===200&&account.body.includes('/brand/wordmark-ink.svg')&&account.body.includes('id="workspace"'),{status:account.status});
const session=get('/api/session');record('anonymous_session_denied',session.status===401,{status:session.status});
const workspace=get('/app');record('anonymous_workspace_redirect',workspace.status===302&&workspace.location==='/account',{status:workspace.status});
for(const path of ['/pricing','/terms','/privacy','/cookies','/legal','/brand/wordmark-ink.svg']){const r=get(path);record(`public_route:${path}`,r.status===200,{status:r.status});}
console.log(JSON.stringify({origin:base,tlsVerification:'curl default verification retained',passed:checks.filter(c=>c.ok).length,total:checks.length,checks},null,2));if(checks.some(c=>!c.ok))process.exitCode=1;
