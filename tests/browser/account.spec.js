import {test,expect} from '@playwright/test';
async function fixture(page,{accountFailure=false,saveFailure=false}={}) {
 const state={profile:{display_name:'Alex Morgan',audience:'ecommerce'},details:{job_title:'Product photographer',location:'Cape Town, South Africa',time_zone:'Africa/Johannesburg'},recovery:[]};

 await page.route(/\/app(?:\/.*)?$/,async route=>route.fulfill({response:await page.request.get('/account/signin')}));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;const method=route.request().method();let body={};let status=200;
  if(path==='/api/session')body={profile:state.profile};
  else if(path==='/api/account'){status=accountFailure?503:200;body=accountFailure?{error:{message:'Unavailable'}}:{account:{email:'alex@example.test',email_verified:true,created_at:'2026-01-02T08:00:00Z',providers:['google','email'],details:state.details}};}
  else if(path==='/api/profile'){state.profile=route.request().postDataJSON();body={profile:state.profile};}
  else if(path==='/api/account/details'){if(saveFailure){status=503;body={error:{message:'Could not save work details. Try again.'}};}else{state.details=route.request().postDataJSON();body={details:state.details};}}
  else if(path==='/api/auth/recover'){state.recovery.push(route.request().postDataJSON());body={message:'If an account exists, a password recovery email will be sent.'};}
  else if(path==='/api/billing/account')body={plan:'pro',account:{balance_credits:250,reserved_credits:20},subscriptions:[{state:'active'}],receipts:[]};
  else {status=404;body={error:{message:'Not found'}};}
  await route.fulfill({status,json:body});
 });
 return state;
}
test('account overview uses real account fields and a responsive premium layout',async({page},info)=>{
 await fixture(page);await page.goto('/app/profile');
 await expect(page.getByRole('heading',{name:'Profile & account'})).toBeVisible();
 await expect(page.locator('#account-email')).toHaveText('alex@example.test');
 await expect(page.locator('#email-verification')).toContainText('Verified');
 await expect(page.locator('#account-providers')).toHaveText('Google · Email & password');
 await expect(page.locator('#account-plan-summary')).toContainText('230 processing units available');
 await expect(page.locator('#account-plan-summary')).toContainText('Verified subscription active');
 if(page.viewportSize().width <= 760) expect((await page.locator('.account-overview-copy').boundingBox()).width).toBeGreaterThan(160);
 await expect(page.getByRole('heading',{name:'Workspace sessions'})).toHaveCount(0);
 await expect(page.getByRole('link',{name:/Manage plan & billing/})).toHaveAttribute('href','/app/billing');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await page.screenshot({path:`test-results/account-profile-${info.project.name}.png`,fullPage:true});
});
test('profile and work details save independently, survive reload and cancel unsaved changes',async({page})=>{
 const state=await fixture(page);await page.goto('/app/profile');
 await page.getByLabel('Display name').fill('Unsaved name');await page.locator('#personal-profile .account-cancel').click();await expect(page.getByLabel('Display name')).toHaveValue('Alex Morgan');
 await page.getByLabel('Display name').fill('Jamie Reed');await page.getByRole('button',{name:'Save profile',exact:true}).click();await expect(page.locator('#account-name')).toHaveText('Jamie Reed');
 await page.getByLabel('Job title').fill('Art director');await page.getByLabel('Location',{exact:false}).fill('London');await page.getByLabel('Time zone').selectOption('Europe/London');
 await page.getByRole('button',{name:'Save work details'}).click();await expect(page.locator('#work-profile .notice')).toContainText('saved');expect(state.details.job_title).toBe('Art director');
 await page.getByLabel('Job title').fill('Discard me');await page.locator('#work-profile .account-cancel').click();await expect(page.getByLabel('Job title')).toHaveValue('Art director');
 await page.reload();await expect(page.getByLabel('Display name')).toHaveValue('Jamie Reed');await expect(page.getByLabel('Job title')).toHaveValue('Art director');await expect(page.getByLabel('Time zone')).toHaveValue('Europe/London');
});
test('password recovery is requested only through an explicit action',async({page})=>{
 const state=await fixture(page);await page.goto('/app/profile');
 await expect(page.locator('#account-providers')).toContainText('Google');expect(state.recovery).toHaveLength(0);
 await page.getByRole('button',{name:'Send password reset link'}).click();await expect(page.locator('#recovery-notice')).toContainText('recovery email');expect(state.recovery).toEqual([{email:'alex@example.test'}]);

});
test('failed account loading and saving never produce fake security details or success',async({page})=>{
 await fixture(page,{saveFailure:true});await page.goto('/app/profile');await page.getByLabel('Job title').fill('Not saved');await page.getByRole('button',{name:'Save work details'}).click();await expect(page.locator('#work-profile .notice')).toContainText('Could not save');await expect(page.getByLabel('Job title')).toHaveValue('Not saved');
 await page.unroute('**/api/**');await fixture(page,{accountFailure:true});await page.reload();await expect(page.locator('#page-notice')).toContainText('could not load');await expect(page.getByRole('button',{name:'Send password reset link'})).toBeDisabled();await expect(page.getByLabel('Display name')).toBeEditable();
});
