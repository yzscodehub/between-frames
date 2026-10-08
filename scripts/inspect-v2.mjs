import {chromium} from '@playwright/test';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1500,height:1100}});page.on('pageerror',e=>console.log('PAGE',e.message));page.on('console',m=>{if(m.type()==='error')console.log('ERR',m.text())});
await page.goto('http://127.0.0.1:4321/lab/');await page.waitForFunction(()=>document.querySelector('.lab-status')?.textContent.includes('WebGL2'));await page.screenshot({path:'test-results/v2-overview.png',fullPage:true});
await page.getByRole('button',{name:'算法对照',exact:true}).click();await page.waitForTimeout(500);await page.screenshot({path:'test-results/v2-compare.png',fullPage:true});
await page.getByRole('button',{name:/04.*实际应用/}).click();await page.waitForTimeout(300);await page.screenshot({path:'test-results/v2-room.png',fullPage:true});
await page.getByRole('button',{name:'检查中心表面',exact:true}).click();await page.waitForTimeout(300);await page.screenshot({path:'test-results/v2-inspection.png',fullPage:true});
await page.goto('http://127.0.0.1:4321/articles/gtao/#horizon');await page.locator('.walk-experiment').scrollIntoViewIfNeeded();await page.waitForTimeout(400);await page.locator('.walk-experiment').screenshot({path:'test-results/v2-horizon.png'});
await browser.close();
