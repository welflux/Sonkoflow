import type { SupabaseClient } from '@supabase/supabase-js';
import type { Identity } from '../services.js';
import { z } from 'zod';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { AppError, hash, seal, unseal, uuid } from '../security.js';
import { providerFormData, timedProviderFetch } from '../transport.js';
import { loadEngineRegistry, ADAPTER_VERSION } from './engine-registry.js';
import { downloadRemoteOutput, readRemoteJSON } from './remote-providers.js';
import { ProviderFailure, validateOutput } from './provider.js';

const POLICY_VERSION='claid-owner-trial-v1';
const policySchema=z.object({owner_id:uuid,expires_at:z.iso.datetime({offset:true}),max_credits:z.number().int().min(3).max(6)}).strict();
export const trialInput=z.object({project_id:uuid,input_image_id:uuid,submission_key:uuid,mode:z.enum(['personal','portrait','product']),operation:z.enum(['enhance','product_finish']),provider_consent:z.literal(true)}).strict().superRefine((v,c)=>{if(v.operation==='product_finish'&&v.mode!=='product')c.addIssue({code:'custom',path:['operation'],message:'Background finishing requires a product photograph.'})});
export type TrialInput=z.infer<typeof trialInput>;
export function trialPolicy(env:NodeJS.ProcessEnv,now=Date.now()) {
  try {
    const p=policySchema.parse(JSON.parse(env.AI_CLAID_TRIAL_JSON||''));
    if(!env.AI_CLAID_API_KEY||env.AI_CLAID_API_KEY.length>4096||/[\r\n\0]/.test(env.AI_CLAID_API_KEY)||env.BILLING_ENABLED==='1'||env.AI_PROCESSING_ENABLED==='1'||env.AI_MULTI_ENGINE_ENABLED==='1'||env.AI_TOPAZ_ENABLED==='1'||env.AI_CLAID_ENABLED==='1')return null;
    // An operator cannot accidentally leave a public or permanent trial active.
    if(Date.parse(p.expires_at)>now+7*86400000)return null;
    return p;
  } catch {return null}
}
export function trialSlotId(owner:string,slot:number){
  const h=hash(`${POLICY_VERSION}:${owner}:${slot}`);
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export function publicTrialSettings(settings:any){
  if(!settings?.claid_trial)return settings;
  const {receipt_sealed,...safe}=settings.claid_trial;
  return {...settings,claid_trial:safe};
}
function checked(error:any){if(error)throw new AppError(503,'trial_storage_unavailable','Trial storage is unavailable. No automatic processing retry was made.');}
export class ClaidTrial {
  readonly policy;
  private readonly engine;
  private readonly active=new Map<string,Promise<void>>();
  constructor(readonly admin:SupabaseClient,readonly encryptionKey:string,readonly env:NodeJS.ProcessEnv=process.env,readonly fetcher:typeof fetch=timedProviderFetch(300000)){
    this.policy=trialPolicy(env);this.engine=loadEngineRegistry(env).engines.claid;
  }
  private owner(identity:Identity){if(!this.policy||identity.userId!==this.policy.owner_id)throw new AppError(404,'not_found','Trial not found.');}
  private ids(){return Array.from({length:Math.floor(this.policy!.max_credits/3)},(_,i)=>trialSlotId(this.policy!.owner_id,i));}
  private async rows(){const r=await this.admin.from('processing_jobs').select('*').in('id',this.ids()).eq('user_id',this.policy!.owner_id);checked(r.error);return r.data??[];}
  async capabilities(identity?:Identity){
    if(!identity||!this.policy||identity.userId!==this.policy.owner_id)return null;
    const rows=await this.rows(),remaining=Math.max(0,this.ids().length-rows.length),expired=Date.now()>=Date.parse(this.policy.expires_at);
    return {enabled:!expired&&remaining>0,expired,remaining_requests:remaining,reserved_credits_per_request:3,max_trial_credits:this.policy.max_credits,expires_at:this.policy.expires_at,jobs:rows.map(j=>this.present(j))};
  }
  present(j:any){return {id:j.id,status:j.status,input_image_id:j.input_image_id,output_image_id:j.output_image_id,operation:j.settings?.claid_trial?.operation,created_at:j.created_at,can_recover:!!j.settings?.claid_trial?.receipt_sealed&&['uncertain','persisting'].includes(j.status),message:j.status==='completed'?'Claid result saved. Compare it with your original before use.':j.status==='failed'?'Claid rejected this request. This trial slot stays reserved.':'An interrupted request may have consumed trial credits. Do not submit it again; recover the existing result if available.'};}
  async get(identity:Identity,id:string){
    this.owner(identity);if(!this.ids().includes(id))throw new AppError(404,'not_found','Trial not found.');
    const r=await this.admin.from('processing_jobs').select('*').eq('id',id).eq('user_id',identity.userId).maybeSingle();checked(r.error);if(!r.data)throw new AppError(404,'not_found','Trial not found.');
    const j=r.data;
    if(j.status==='running'&&!this.active.has(id)&&Date.now()-Date.parse(j.created_at)>360000){
      const changed=await this.admin.from('processing_jobs').update({status:'uncertain',error_code:'provider_interrupted',safe_to_retry:false}).eq('id',id).eq('status','running');checked(changed.error);j.status='uncertain';
    }
    return j;
  }
  async submit(identity:Identity,input:TrialInput){
    this.owner(identity);
    const fingerprint=hash(JSON.stringify(input));
    const prior=await this.admin.from('processing_jobs').select('*').eq('user_id',identity.userId).eq('submission_key',input.submission_key).maybeSingle();checked(prior.error);
    if(prior.data){if(!this.ids().includes(prior.data.id)||prior.data.request_fingerprint!==fingerprint)throw new AppError(409,'submission_conflict','This submission identifier belongs to different settings.');return prior.data;}
    if(Date.now()>=Date.parse(this.policy!.expires_at))throw new AppError(403,'trial_expired','This private trial has expired.');
    const source=await identity.client.from('images').select('*').eq('id',input.input_image_id).eq('project_id',input.project_id).eq('user_id',identity.userId).eq('role','original').eq('status','ready').maybeSingle();checked(source.error);
    if(!source.data)throw new AppError(404,'not_found','Choose your own ready original photograph.');
    const size=source.data.width*source.data.height;
    if(!Number.isSafeInteger(size)||size>25000000||size<4096)throw new AppError(400,'invalid_image','Choose an original within the existing image limits.');
    for(const id of this.ids()){
      const j={id,user_id:identity.userId,project_id:input.project_id,input_image_id:input.input_image_id,submission_key:input.submission_key,mode:input.mode,instructions:'',status:'running',model:'claid:owner-trial',quality:'high',output_size:`${source.data.width}x${source.data.height}`,prompt_version:POLICY_VERSION,request_fingerprint:fingerprint,result_image_id:randomUUID(),lease_owner:randomUUID(),lease_until:new Date(Date.now()+360000).toISOString(),provider_started_at:new Date().toISOString(),reserved_micro_usd:0,settings:{background:input.operation==='product_finish'?'clean':'preserve',framing:'match',preserve_appearance:true,provider_consent:true,claid_trial:{version:POLICY_VERSION,adapter_version:ADAPTER_VERSION,operation:input.operation,reserved_api_credits:3,actual_api_credits:null,actual_cost_micro_usd:null}},price_snapshot:{provider:'claid',basis:'free_trial_api_credits',reserved_api_credits:3,actual_cost_micro_usd:null}};
      const r=await this.admin.from('processing_jobs').insert(j).select('*').single();
      if(r.error?.code==='23505'){
        // Another process may have received this same idempotent submission.
        const duplicate=await this.admin.from('processing_jobs').select('*').eq('user_id',identity.userId).eq('submission_key',input.submission_key).maybeSingle();checked(duplicate.error);
        if(duplicate.data){if(duplicate.data.request_fingerprint!==fingerprint)throw new AppError(409,'submission_conflict','Submission settings changed.');return duplicate.data;}continue;
      }
      checked(r.error);
      const task=this.run(r.data,source.data).finally(()=>this.active.delete(id));this.active.set(id,task);return r.data;
    }
    throw new AppError(409,'trial_limit','The private trial limit has been reached. No provider request was made.');
  }
  private async patch(j:any,data:any){const r=await this.admin.from('processing_jobs').update({...data,updated_at:new Date().toISOString()}).eq('id',j.id).eq('user_id',j.user_id);checked(r.error);Object.assign(j,data);}
  private async step(j:any,action:string,p:any={}){const r=await this.admin.rpc('processing_step',{job:j.id,worker:j.lease_owner,action,p});checked(r.error);if(r.data!==true)throw new Error('trial_checkpoint_failed');}
  private async run(j:any,source:any){
    try{
      const original=await this.admin.storage.from('photos').download(source.object_key);if(original.error||!original.data||original.data.size>10485760)throw new Error('source_read');
      const bytes=Buffer.from(await original.data.arrayBuffer());if(hash(bytes)!==source.checksum)throw new Error('source_checksum');
      const png=await sharp(bytes,{limitInputPixels:25000000,animated:false,failOn:'warning'}).png().toBuffer();
      const operation=j.settings.claid_trial.operation;
      const form=providerFormData();form.set('file',new Blob([new Uint8Array(png)],{type:'image/png'}),'original.png');
      form.set('data',JSON.stringify({operations:{resizing:{width:source.width,height:source.height,fit:'bounds'},background:operation==='product_finish'?{remove:true,color:'#FFFFFF'}:{remove:false},adjustments:{hdr:100}},output:{format:'png'}}));
      const usage=await this.admin.from('usage_events').insert({user_id:j.user_id,job_id:j.id,operation:'processing',units:0,idempotency_key:`processing:${j.id}`,model:j.model,cost_basis:'free_trial_api_credits_unknown'});checked(usage.error);
      const response=await this.fetcher('https://api.claid.ai/v1/image/edit/upload',{method:'POST',headers:{Authorization:`Bearer ${this.engine.key}`},body:form,redirect:'error',signal:AbortSignal.timeout(300000)});
      if(!response.ok){await response.body?.cancel();await this.patch(j,{status:response.status>=500?'uncertain':'failed',error_code:[401,403].includes(response.status)?'provider_credentials':response.status===402?'provider_billing':response.status>=500?'provider_unavailable':'provider_rejected',safe_to_retry:false,completed_at:new Date().toISOString()});return;}
      const body=await readRemoteJSON(response),url=body?.data?.output?.tmp_url;
      if(typeof url!=='string'||url.length>4096)throw new Error('delivery_receipt_missing');
      const settings={...j.settings,claid_trial:{...j.settings.claid_trial,receipt_sealed:seal({url},this.encryptionKey)}};
      const rawId=response.headers.get('x-request-id'),requestId=rawId&&/^[a-zA-Z0-9_-]{1,200}$/.test(rawId)?rawId:null;
      await this.patch(j,{settings,result_received_at:new Date().toISOString(),provider_request_id:requestId});
      await this.step(j,'response',{request_id:requestId,usage:{provider:'claid',operation,reserved_api_credits:3,actual_api_credits:null,actual_cost_micro_usd:null},cost:null});
      await this.finish(j,url);
    }catch{
      await this.hold(j);
      console.error(JSON.stringify({event:'claid_trial_uncertain',job_id:j.id}));
    }
  }
  private async hold(j:any){
    try{
      const current=await this.admin.from('processing_jobs').select('status').eq('id',j.id).eq('user_id',j.user_id).single();
      if(current.data?.status==='completed')return;
      await this.patch(j,{status:current.data?.status==='persisting'?'persisting':'uncertain',error_code:'provider_interrupted',safe_to_retry:false});
    }catch{}
  }
  private async finish(j:any,url:string){
    const encoded=await downloadRemoteOutput(this.engine,j.output_size,url,AbortSignal.timeout(90000),this.fetcher);
    const output=await validateOutput(encoded,j.output_size),key=`${j.user_id}/${j.result_image_id}.webp`;
    await this.step(j,'prepare',{filename:`claid-trial-${j.result_image_id}.webp`,byte_size:output.bytes.length,width:output.width,height:output.height,checksum:output.checksum});
    const upload=await this.admin.storage.from('photos').upload(key,output.bytes,{contentType:'image/webp',upsert:true});checked(upload.error);
    const verify=await this.admin.storage.from('photos').download(key);if(verify.error||!verify.data||hash(Buffer.from(await verify.data.arrayBuffer()))!==output.checksum)throw new Error('output_verification');
    await this.step(j,'complete');
    const event=await this.admin.from('usage_events').update({units:1,cost_basis:'free_trial_api_credits_unknown'}).eq('job_id',j.id).eq('user_id',j.user_id);if(event.error)console.error(JSON.stringify({event:'claid_trial_usage_label_pending',job_id:j.id}));
  }
  async recover(identity:Identity,id:string){
    const j=await this.get(identity,id);
    if(!['uncertain','persisting'].includes(j.status)||!j.settings?.claid_trial?.receipt_sealed)throw new AppError(409,'trial_no_receipt','No saved provider result is available for recovery. Do not resubmit this request.');
    if(this.active.has(id))return j;
    const receipt=unseal(j.settings.claid_trial.receipt_sealed,this.encryptionKey);
    const task=this.finish(j,receipt.url).catch(()=>this.hold(j)).finally(()=>this.active.delete(id));
    this.active.set(id,task);return j;
  }
  async drain(){await Promise.allSettled(this.active.values());}
}
