import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
async function fixture(page,{ready=false,empty=true,failure=false}={}){
 const state={cancelled:false,calls:0,fail:failure};
 await page.route(/\/app(?:\/.*)?$/,async route=>route.fulfill({response:await page.request.get('/account/signin')}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/session')return route.fulfill({json:{profile:{display_name:'Alex Morgan',audience:'ecommerce'}}});
  if(path==='/api/billing/subscriptions/SUB1/cancel'){state.cancelled=true;return route.fulfill({json:{ok:true}});}
  if(path==='/api/billing/overview'){
   state.calls++;
   if(state.fail)return route.fulfill({status:503,json:{error:{message:'Usage records could not be verified. Please try again.'}}});
   return route.fulfill({json:{purchasing_enabled:ready,plan:ready?'starter':'free',allowance_recorded:ready,account:{balance_credits:ready?100:0,reserved_credits:ready?20:0},
    usage:{storage_bytes:6*1048576,images:3,projects:2,completed_edits:7,bulk_requests:2,brand_profiles:1},limits:{storage_bytes:250*1048576,images:100,projects:100},
    subscriptions:ready?[{provider_id:'SUB1',plan:'starter',state:state.cancelled?'cancelled':'active',paid_until:'2027-10-29T00:00:00Z',interval:'year',amount_cents:8640}]:[],
    receipts:empty?[]:[{payment_id:'PAY1',created_at:'2026-10-29T10:00:00Z',amount_cents:8640,units:1200,refunded_cents:0},{payment_id:'=SUM(1,2)',created_at:'2026-10-28T10:00:00Z',amount_cents:500,units:50,refunded_cents:200}]}});
  }
  return route.fulfill({status:404,json:{error:{message:'Not found'}}});
 });return state;
}
test('disabled purchasing still shows actual usage, one notice and a structured empty payment state',async({page},info)=>{
 await fixture(page);await page.goto('/app/billing');await expect(page.getByRole('heading',{level:1})).toHaveText('Plan & usage');await expect(page.locator('#billing-notice')).toContainText('awaiting activation');await expect(page.locator('.billing-banner:visible')).toHaveCount(1);
 await expect(page.locator('#billing-balance')).toContainText('0 available units');await expect(page.locator('#storage-content')).toContainText('6.0 MB / 250.0 MB');await expect(page.locator('#completed-edits')).toHaveText('7');await expect(page.locator('.billing-empty')).toContainText('No verified payments yet');await expect(page.getByRole('button',{name:'Export CSV'})).toBeDisabled();
 await expect(page.locator('.sidebar-note')).toHaveCount(0);await expect(page.getByRole('link',{name:'How processing units work'})).toHaveAttribute('href','/pricing#usage');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:`test-results/billing-overview-${info.project.name}.png`,fullPage:true});
 await page.setViewportSize({width:320,height:780});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('verified subscription terms and refunds render accurately; CSV exports only verified records',async({page},info)=>{
 await fixture(page,{ready:true,empty:false});await page.goto('/app/billing');await expect(page.locator('#billing-balance')).toContainText('80 available units');await expect(page.locator('#billing-subscriptions')).toContainText('Yearly');await expect(page.locator('#billing-subscriptions')).toContainText('$86.40 / year');await expect(page.locator('#billing-receipts tbody tr')).toHaveCount(2);await expect(page.locator('#billing-receipts')).toContainText('Partially refunded');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV'}).click();const file=await download;expect(file.suggestedFilename()).toBe('sonkoflow-payment-records.csv');const contents=await readFile(await file.path(),'utf8');expect(contents).toContain('PAY1');expect(contents).toContain("'=SUM(1,2)");expect(contents).toContain('86.40');
 await page.screenshot({path:`test-results/billing-paid-${info.project.name}.png`,fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('cancelling renewal keeps the existing confirmation and refreshes verified subscription state',async({page})=>{
 const state=await fixture(page,{ready:true});await page.goto('/app/billing');page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Cancel future renewal'}).click();expect(state.cancelled).toBe(false);
 page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'Cancel future renewal'}).click();await expect(page.locator('#billing-subscriptions')).toContainText('Renewal cancelled');expect(state.cancelled).toBe(true);await expect(page.getByRole('button',{name:'Cancel future renewal'})).toHaveCount(0);
});
test('unavailable records are not shown as zero and refresh recovers without duplicate notices',async({page})=>{
 const state=await fixture(page,{failure:true});await page.goto('/app/billing');await expect(page.locator('#billing-notice')).toContainText('could not be verified');await expect(page.locator('#completed-edits')).toHaveText('—');await expect(page.locator('#allowance-content')).toContainText('temporarily unavailable');
 state.fail=false;await page.getByRole('button',{name:'Refresh usage'}).click();await expect(page.locator('#completed-edits')).toHaveText('7');await expect(page.locator('.billing-banner:visible')).toHaveCount(1);expect(state.calls).toBe(2);
});
