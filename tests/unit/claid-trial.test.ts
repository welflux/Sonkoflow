import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ClaidTrial,trialPolicy,trialSlotId,trialInput,publicTrialSettings} from '../../server/processing/claid-trial.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const policy={owner_id:owner,expires_at:new Date(Date.now()+86400000).toISOString(),max_credits:6};
const env={AI_CLAID_API_KEY:'test-key-not-a-real-credential',AI_CLAID_TRIAL_JSON:JSON.stringify(policy)};
test('private trial fails closed without credentials, bounded policy or with public engines/billing active',()=>{
 assert.equal(trialPolicy({}),null);
 assert.equal(trialPolicy({...env,AI_CLAID_API_KEY:''}),null);
 for(const flag of ['AI_PROCESSING_ENABLED','AI_MULTI_ENGINE_ENABLED','AI_TOPAZ_ENABLED','AI_CLAID_ENABLED','BILLING_ENABLED'])assert.equal(trialPolicy({...env,[flag]:'1'}),null);
 for(const patch of [{max_credits:7},{owner_id:'owner@example.test'},{expires_at:new Date(Date.now()+8*86400000).toISOString()}])assert.equal(trialPolicy({...env,AI_CLAID_TRIAL_JSON:JSON.stringify({...policy,...patch})}),null);
 assert.equal(trialPolicy(env)?.max_credits,6);
});
test('trial slot identifiers survive configuration changes and process restarts',()=>{
 const ids=Array.from({length:2},(_,i)=>trialSlotId(owner,i));
 assert.equal(new Set(ids).size,2);assert.notEqual(trialSlotId(other,0),ids[0]);
 assert.deepEqual(ids,[trialSlotId(owner,0),trialSlotId(owner,1)]);
 for(const id of ids)assert.match(id,/^[a-f0-9-]{36}$/);
});
test('trial accepts only fixed Claid operations with explicit provider consent',()=>{
 const input={project_id:owner,input_image_id:other,submission_key:owner,mode:'personal',operation:'enhance',provider_consent:true};
 assert.equal(trialInput.parse(input).operation,'enhance');
 for(const patch of [{provider_consent:false},{operation:'product_finish'},{engine:'openai'},{model:'custom'},{instructions:'replace the face'}])assert.throws(()=>trialInput.parse({...input,...patch}));
 assert.equal(trialInput.parse({...input,mode:'product',operation:'product_finish'}).operation,'product_finish');
});
test('unrelated accounts cannot discover, submit or recover an owner trial',async()=>{
 const admin={from(){throw Error('Database should not be queried for another owner')}} as any;
 const trial=new ClaidTrial(admin,'1'.repeat(64),env);
 const identity={userId:other} as any;
 assert.equal(await trial.capabilities(identity),null);
 await assert.rejects(trial.get(identity,trialSlotId(owner,0)),e=>(e as any).status===404);
 await assert.rejects(trial.submit(identity,{} as any),e=>(e as any).status===404);
 await assert.rejects(trial.recover(identity,trialSlotId(owner,0)),e=>(e as any).status===404);
});
test('delivery receipts remain sealed and are stripped from customer history settings',()=>{
 const s={background:'preserve',claid_trial:{operation:'enhance',reserved_api_credits:3,receipt_sealed:'ciphertext'}};
 assert.deepEqual(publicTrialSettings(s),{background:'preserve',claid_trial:{operation:'enhance',reserved_api_credits:3}});
 assert.equal(s.claid_trial.receipt_sealed,'ciphertext');
 assert.equal(publicTrialSettings(null),null);
});
