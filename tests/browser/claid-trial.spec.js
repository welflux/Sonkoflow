import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
const source='11111111-1111-4111-8111-111111111111',project='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',output='44444444-4444-4444-8444-444444444444';
async function fixture(page,{lost=false,recovery=false}={}){
 const bytes=await readFile(new URL('../../public/images/footwear-small.webp',import.meta.url));
 const state={posts:[],recoveries:0};
 let saved=recovery?{id:job,status:'uncertain',input_image_id:source,output_image_id:null,created_at:'2026-10-31T12:00:00Z',can_recover:true,message:'Recover existing result'}:null;
 const completed=()=>({id:job,status:'completed',input_image_id:source,output_image_id:output,created_at:'2026-10-31T12:00:00Z',can_recover:false,message:'Claid result saved.'});
 await page.route(/\/app(?:\/.*)?(?:\?.*)?$/,async r=>r.fulfill({response:await page.request.get('/account/signin')}));
 await page.route('**/api/**',async r=>{
  const path=new URL(r.request().url()).pathname;
  if(path==='/api/session')return r.fulfill({json:{profile:{display_name:'Trial owner',audience:'ecommerce'}}});
  if(path.endsWith('/content'))return r.fulfill({body:bytes,contentType:'image/webp'});
  if(path===`/api/images/${source}`)return r.fulfill({json:{image:{id:source,project_id:project,filename:'owned-original.webp',role:'original',status:'ready'}}});
  if(path==='/api/processing/capabilities')return r.fulfill({json:{enabled:false,claid_trial:{enabled:true,remaining_requests:saved?1:2,max_trial_credits:6,jobs:saved?[saved]:[]}}});
  if(path==='/api/claid-trial/jobs'){
   state.posts.push(r.request().postDataJSON());saved=completed();
   if(lost&&state.posts.length===1)return r.abort('failed');
   return r.fulfill({status:202,json:{job:saved}});
  }
  if(path===`/api/claid-trial/jobs/${job}/recover`){state.recoveries++;saved=completed();return r.fulfill({status:202,json:{job:saved}})}
  if(path===`/api/claid-trial/jobs/${job}`)return r.fulfill({json:{job:saved}});
  return r.fulfill({status:404,json:{error:{message:'Unknown test endpoint'}}});
 });
 page.on('dialog',d=>d.accept());return state;
}
test('owner trial submits to Claid only and displays a separate saved result and download',async({page})=>{
 const s=await fixture(page);await page.goto(`/app/edit/${source}?mode=product`);
 await expect(page.getByRole('heading',{name:'Private Claid test'})).toBeVisible();
 const button=page.getByRole('button',{name:'Enhance photograph with Claid'});await expect(button).toBeDisabled();
 await page.getByLabel(/I have permission/).check();await expect(button).toBeEnabled();await button.click();
 await expect(page.locator('#claid-trial-photo')).toHaveAttribute('src',`/api/images/${output}/content`);
 await expect(page.getByRole('link',{name:'Download result'})).toHaveAttribute('href',`/api/images/${output}/content?download=1`);
 await expect(page.locator('#reference-photo')).toHaveAttribute('src',`/api/images/${source}/content`);
 expect(s.posts).toHaveLength(1);expect(s.posts[0].operation).toBe('product_finish');expect(s.posts[0].provider_consent).toBe(true);
 expect(s.posts[0].engine).toBeUndefined();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('lost submission acknowledgement retains the same identifier instead of starting another request',async({page})=>{
 const s=await fixture(page,{lost:true});await page.goto(`/app/edit/${source}?mode=personal`);await page.getByLabel(/I have permission/).check();
 await page.getByRole('button',{name:'Enhance photograph with Claid'}).click();await expect(page.getByRole('button',{name:'Check this submission'})).toBeEnabled();
 await page.getByRole('button',{name:'Check this submission'}).click();await expect(page.locator('#claid-trial-result')).toBeVisible();
 expect(s.posts).toHaveLength(2);expect(s.posts[0].submission_key).toBe(s.posts[1].submission_key);expect(s.posts[0].operation).toBe('enhance');
});
test('recovery downloads an accepted result without a new processing submission',async({page})=>{
 const s=await fixture(page,{recovery:true});await page.goto(`/app/edit/${source}?mode=personal`);
 await page.getByRole('button',{name:/Recover existing result/}).click();await expect(page.locator('#claid-trial-result')).toBeVisible();
 expect(s.recoveries).toBe(1);expect(s.posts).toHaveLength(0);
});
