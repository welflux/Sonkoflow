import { test, expect } from '@playwright/test';
test('navigation, artwork, disclosures, and layout',async({page},testInfo)=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 await expect(page).toHaveTitle(/SONKOFLOW/);
 await expect(page.getByRole('heading',{level:1})).toContainText('Product photography');
 await expect(page.locator('#availability')).toContainText('in development');
 for(const image of await page.locator('img').all()){await image.scrollIntoViewIfNeeded();await expect.poll(()=>image.evaluate(el=>el.complete&&el.naturalWidth>0)).toBeTruthy();} await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
 for(const href of await page.locator('a').evaluateAll(els=>els.map(el=>el.getAttribute('href')))){
  expect(href.startsWith('#')).toBeTruthy();if(href!=='#')await expect(page.locator(href)).toHaveCount(1);
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 await expect(page.locator('body')).not.toContainText('Try SONKOFLOW Free');
 expect(errors).toEqual([]);
 await page.screenshot({path:`test-results/${testInfo.project.name}.png`,fullPage:true});
});
test('mobile menu and escape',async({page})=>{
 await page.goto('/');const menu=page.getByRole('button',{name:/Menu/});
 if(await menu.isVisible()){
 await menu.click();await expect(menu).toHaveAttribute('aria-expanded','true');
 await page.locator('#navigation').getByRole('link',{name:'Brand Studio'}).click();await expect(menu).toHaveAttribute('aria-expanded','false');
 await menu.click();await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-expanded','false');await expect(menu).toBeFocused();
 }
});
test('comparison and FAQ are functional',async({page})=>{
 await page.goto('/');const slider=page.getByRole('slider');await slider.fill('70');
 await expect(page.locator('.comparison')).toHaveCSS('--split','70%');
 await slider.focus();await page.keyboard.press('ArrowRight');await expect(slider).toHaveValue('71');
 const question=page.locator('summary').first();await question.click();await expect(page.locator('details').first()).toHaveAttribute('open','');await expect(page.locator('details').first()).toContainText('Not yet');
});
test('reduced motion is respected',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.locator('.hero-art')).toHaveCSS('animation-name','none');
});
