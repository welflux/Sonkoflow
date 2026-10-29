import {test} from 'node:test';
import assert from 'node:assert/strict';
import {billingOverview} from '../../server/billing/overview.js';
function fixture({enabled=false,tier='free',fail='',truncated=false,empty=false}={}){
 const queries:any[]=[];
 const results:any={billing_settings:{data:{enabled}},pack_credit_accounts:{data:empty?null:{balance_credits:100,reserved_credits:20}},images:{data:[{byte_size:1000},{byte_size:2000}],count:truncated?3:2},projects:{count:4},processing_jobs:{count:7},processing_batches:{count:2},brand_profiles:{count:3},billing_subscriptions:{data:empty?[]:[{provider_id:'SUB1',checkout_id:'CHECK1',plan:'starter',state:'active',paid_until:'2027-10-29T00:00:00Z'}]},billing_checkouts:{data:[{id:'CHECK1',offer_id:'starter_annual',amount_cents:8640}]},billing_receipts:{data:empty?[]:[{payment_id:'PAY1',amount_cents:8640,units:1200,refunded_cents:0,created_at:'2026-10-29T00:00:00Z'}]}};
 const client:any={rpc:async(name:string,args:any)=>{assert.equal(name,'billing_tier');assert.deepEqual(args,{owner:'owner'});return {data:tier,error:null};},from(table:string){const record:any={table,filters:[],fields:''};queries.push(record);const query:any={select(fields:string){record.fields=fields;return query;},eq(key:string,value:any){record.filters.push([key,value]);return query;},order(){return query;},limit(){return query;},in(key:string,values:any){record.in=[key,values];return query;},single(){return query;},maybeSingle(){return query;},then(resolve:any){return Promise.resolve({...results[table],error:table===fail?{}:null}).then(resolve);}};return query;}};
 return {client,identity:{userId:'owner',client} as any,queries};
}
test('overview reads verified owner-scoped records while purchasing is disabled, without granting units',async()=>{
 const f=fixture();const result=await billingOverview(f.client,f.identity,false);assert.equal(result.purchasing_enabled,false);assert.equal(result.usage.storage_bytes,3000);assert.equal(result.usage.completed_edits,7);assert.equal(result.account.balance_credits,100);assert.equal(result.limits.storage_bytes,250*1048576);
 for(const query of f.queries.filter(q=>q.table!=='billing_settings'))assert(query.filters.some(([key,value]:any)=>key==='user_id'&&value==='owner'),query.table);
 assert.deepEqual(result.subscriptions[0],{provider_id:'SUB1',plan:'starter',state:'active',paid_until:'2027-10-29T00:00:00Z',interval:'year',amount_cents:8640});
 assert(!JSON.stringify(result).includes('CHECK1'));assert(f.queries.find(q=>q.table==='brand_profiles').filters.some(([key,value]:any)=>key==='deleted'&&value===false));
});
test('overview reflects enforced free limits and does not fabricate a sample allowance for new accounts',async()=>{
 const f=fixture({enabled:true,empty:true});const result=await billingOverview(f.client,f.identity,false);assert.equal(result.limits.images,10);assert.equal(result.limits.storage_bytes,25*1048576);assert.equal(result.allowance_recorded,false);assert.deepEqual(result.account,{balance_credits:0,reserved_credits:0});assert.deepEqual(result.receipts,[]);
});
test('unverifiable or truncated usage fails rather than displaying misleading zero or partial totals',async()=>{
 for(const options of [{fail:'images'},{fail:'billing_receipts'},{truncated:true},{tier:'unknown'}]){const f=fixture(options);await assert.rejects(()=>billingOverview(f.client,f.identity,false),(error:any)=>error.status===503);}
});
