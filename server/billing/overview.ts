import type {SupabaseClient} from '@supabase/supabase-js';
import type {Identity} from '../services.js';
import {AppError} from '../security.js';
import {offers, plans, type OfferId} from './catalog.js';

// Read-only: viewing usage must never initialize an account or grant allowance.
export async function billingOverview(admin: SupabaseClient, identity: Identity, purchasingEnabled: boolean) {
  const owner=identity.userId;
  const results=await Promise.all([
    admin.rpc('billing_tier',{owner}),
    admin.from('billing_settings').select('enabled').eq('id',true).single(),
    admin.from('pack_credit_accounts').select('balance_credits,reserved_credits').eq('user_id',owner).maybeSingle(),
    admin.from('images').select('byte_size',{count:'exact'}).eq('user_id',owner).limit(1000),
    admin.from('projects').select('id',{count:'exact',head:true}).eq('user_id',owner),
    admin.from('processing_jobs').select('id',{count:'exact',head:true}).eq('user_id',owner).eq('status','completed'),
    admin.from('processing_batches').select('id',{count:'exact',head:true}).eq('user_id',owner),
    admin.from('brand_profiles').select('id',{count:'exact',head:true}).eq('user_id',owner).eq('deleted',false),
    identity.client.from('billing_subscriptions').select('provider_id,checkout_id,plan,state,paid_until').eq('user_id',owner).order('paid_until',{ascending:false}),
    identity.client.from('billing_receipts').select('payment_id,amount_cents,units,refunded_cents,created_at').eq('user_id',owner).order('created_at',{ascending:false}).limit(50),
  ]);
  if(results.some(result=>result.error)) throw new AppError(503,'billing_overview_unavailable','Your usage and billing records could not load. Please try again.');
  const [tier,settings,balance,images,projects,completed,batches,brands,subs,receipts]=results;
  const plan=String(tier.data);
  if(!settings.data || typeof settings.data.enabled !== 'boolean' || !Object.hasOwn(plans,plan) || images.count !== images.data?.length || [images,projects,completed,batches,brands].some(result=>!Number.isSafeInteger(result.count) || Number(result.count) < 0))
    throw new AppError(503,'billing_overview_unavailable','Your usage totals could not be verified. Please try again.');
  const limits=settings.data!.enabled ? plans[plan as keyof typeof plans] : {images:100,storage:250*1048576,projects:100};
  const subscriptions=subs.data ?? [];
  let checkouts: any[]=[];
  if(subscriptions.length) {
    const result=await identity.client.from('billing_checkouts').select('id,offer_id,amount_cents')
      .eq('user_id',owner).in('id',subscriptions.map(sub=>sub.checkout_id));
    if(result.error) throw new AppError(503,'billing_overview_unavailable','Subscription terms could not load. Please try again.');
    checkouts=result.data ?? [];
  }
  return {
    purchasing_enabled:purchasingEnabled,plan,
    account:balance.data ?? {balance_credits:0,reserved_credits:0},
    allowance_recorded:!!balance.data,
    usage:{storage_bytes:(images.data ?? []).reduce((sum,image)=>sum+Number(image.byte_size),0),images:images.count,
      projects:projects.count,completed_edits:completed.count,bulk_requests:batches.count,brand_profiles:brands.count},
    limits:{storage_bytes:limits.storage,images:limits.images,projects:limits.projects},
    subscriptions:subscriptions.map(sub=>{
      const checkout=checkouts.find(item=>item.id===sub.checkout_id);
      const offer=checkout && offers[checkout.offer_id as OfferId];
      return {provider_id:sub.provider_id,plan:sub.plan,state:sub.state,paid_until:sub.paid_until,
        interval:offer?.interval ?? null,amount_cents:checkout?.amount_cents ?? null};
    }),
    receipts:receipts.data ?? [],
  };
}
