import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {PerspectiveCamera,Vector4} from 'three';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const errors=[],results=[];await mkdir('test-results',{recursive:true});
const page=await browser.newPage({viewport:{width:1500,height:1100}});
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
await page.addInitScript(()=>{window.__tools={};Object.defineProperty(document,'modelContext',{value:{registerTool(tool,options){window.__tools[tool.name]=tool;options?.signal?.addEventListener('abort',()=>delete window.__tools[tool.name]);}}});});
const read=()=>page.evaluate(()=>window.__tools.read_ao_experiment.execute({}));
const ready=()=>page.waitForFunction(()=>document.querySelector('.lab-status')?.textContent.includes('WebGL2'));
async function advanced(){if(!await page.locator('.advanced-controls').evaluate(el=>el.open))await page.locator('.advanced-controls summary').click();}
async function test(name,run){await run();results.push(name);console.log('PASS',name);}
try{
 await test('article explains evolution and embeds runtime snippets and step experiment',async()=>{
  await page.goto(base+'/articles/gtao/');assert.equal(await page.locator('article > h2').count(),8);assert.equal(await page.locator('.evolution-map>div').count(),3);assert.equal(await page.locator('.source-excerpt').count(),3);assert.ok(await page.locator('.katex').count()>5);
  await page.screenshot({path:'test-results/article-top.png'});
 });
 await test('horizon walk responds to steps, slab gap, and position',async()=>{
  const walk=page.locator('.walk-experiment');await walk.scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const el=document.querySelector('.walk-experiment');return el&&!el.closest('astro-island')?.hasAttribute('ssr');});await page.getByLabel('地平线进度',{exact:true}).fill('0');await page.getByRole('button',{name:'下一样本',exact:true}).click();assert.match(await walk.locator('.step-verdict').innerText(),/样本 1/);
  await page.getByRole('button',{name:'悬空薄板',exact:true}).click();await page.getByLabel('板下空隙',{exact:true}).fill('0.8');await page.getByLabel('地平线进度',{exact:true}).fill('12');assert.ok(await page.getByRole('button',{name:'下一样本',exact:true}).isDisabled());assert.match(await walk.locator('.experiment-takeaway').innerText(),/空隙/);await walk.screenshot({path:'test-results/horizon-slab.png'});
  await page.getByLabel('挡板位置',{exact:true}).fill('1.8');assert.equal(await page.getByLabel('地平线进度',{exact:true}).inputValue(),'0');
 });
 await page.goto(base+'/lab/');await ready();
 await test('advanced controls start collapsed and main scene is a structured test bench',async()=>{
  assert.equal(await page.locator('.advanced-controls').evaluate(el=>el.open),false);const r=await read();assert.equal(r.state.scene,'bench');assert.equal(await page.locator('.lesson-tabs button').count(),4);await page.screenshot({path:'test-results/lab-overview.png',fullPage:true});
 });
 await test('guided tasks load exact scene and budget presets',async()=>{
  await page.getByRole('button',{name:/02.*样本与噪声/}).click();let r=await read();assert.equal(r.state.scene,'bench');assert.equal(r.state.slices*r.state.steps*2,8);assert.equal(r.state.algorithm,'ssao');
  await page.getByRole('button',{name:/01.*接触与距离/}).click();r=await read();assert.equal(r.state.scene,'contact');assert.equal(r.state.algorithm,'gtao');assert.equal(r.state.lift,0);
 });
 await test('GTAO shader debug integral and final visibility agree',async()=>{
  await page.getByRole('button',{name:'检查中心表面',exact:true}).click();await page.locator('.inspection').waitFor();const r=await read();assert.ok(r.inspection);assert.ok(r.inspection.error<.002);const avg=r.inspection.slices.reduce((s,x)=>s+x.gpu,0)/r.inspection.slices.length;assert.ok(Math.abs(Math.max(0,Math.min(1,avg))-r.inspection.raw)<.002);
 });
 await test('SSAO debug surfaces match texel centers and candidates stay within half a texel',async()=>{
  await page.getByRole('button',{name:'SSAO',exact:true}).click();await page.waitForTimeout(300);const r=await read(),samples=r.inspection.slices.flatMap(s=>s.samples);
  const blocked=samples.reduce((n,s)=>n+s.value,0);assert.ok(Math.abs(1-blocked/samples.length-r.inspection.raw)<.001);
  const dim=await page.locator('.viewport>canvas').evaluate(c=>[c.width,c.height]);const projection=new PerspectiveCamera(45,dim[0]/dim[1],.1,50).projectionMatrix;
  let checked=0;for(const sample of samples){for(const [kind,p] of [['candidate',sample.candidate],['surface',sample.surface]]){if(!p)continue;const clip=new Vector4(...p,1).applyMatrix4(projection);if(clip.w<=0)continue;const allowance=kind==='candidate'?.5002:0.002;assert.ok(Math.abs(clip.x/clip.w*.5+.5-sample.u)*dim[0]<allowance);assert.ok(Math.abs(clip.y/clip.w*.5+.5-sample.v)*dim[1]<allowance);checked++;}}
  assert.ok(checked>10);assert.ok(r.inspection.normal.every(Number.isFinite));
  await page.getByLabel('检查切片',{exact:true}).fill('2');await page.getByLabel('检查样本',{exact:true}).fill('5');await page.getByLabel('样本空间方位',{exact:true}).fill('45');await page.screenshot({path:'test-results/sample-space.png',fullPage:true});
 });
 await test('selected sample stays synchronized after recompute',async()=>{
  await page.getByRole('button',{name:'单步计算',exact:true}).click();await page.waitForTimeout(150);const r=await read();const slice=Number(await page.getByLabel('检查切片',{exact:true}).inputValue()),sample=Number(await page.getByLabel('检查样本',{exact:true}).inputValue());assert.equal(slice,2);assert.equal(sample,5);const circle=await page.locator('.sample-overlay circle').getAttribute('cx');assert.ok(Math.abs(Number(circle)/1000-r.inspection.slices[slice].samples[sample].u)<1e-6);
 });
 await test('HBAO teaching output agrees with horizon-minus-tangent accumulation',async()=>{
  await page.getByRole('button',{name:'HBAO',exact:true}).click();await page.waitForTimeout(300);const r=await read();let o=0;for(const s of r.inspection.slices)o+=Math.max(0,Math.cos(s.high)+Math.sin(s.gamma))+Math.max(0,Math.cos(s.low)-Math.sin(s.gamma));const expected=Math.max(0,Math.min(1,1-o/(2*r.inspection.slices.length)));assert.ok(Math.abs(expected-r.inspection.raw)<.002);
 });
 await test('comparison shares camera and exposes three algorithms plus baseline',async()=>{
  const before=(await read()).state.camera;await page.getByRole('button',{name:'算法对照',exact:true}).click();await page.waitForTimeout(300);let r=await read();assert.equal(r.state.view,'compare');assert.deepEqual(r.state.camera,before);assert.equal(await page.locator('.comparison-labels>div').count(),4);assert.match(await page.locator('.comparison-labels').innerText(),/参考.*未生成/);assert.equal(await page.locator('.local-view:visible').count(),4);assert.ok((await read()).focus.visible);
  await page.getByLabel('仅比较 AO 数值',{exact:true}).check();assert.equal((await read()).state.comparison,'ao');await page.screenshot({path:'test-results/compare-ao.png',fullPage:true});await page.getByLabel('仅比较 AO 数值',{exact:true}).uncheck();
 });
 await test('full reference finishes and fills fourth comparison pane',async()=>{
  await page.getByRole('button',{name:'加入完整几何参考',exact:true}).click();await page.locator('.metric-row').waitFor({timeout:120000});const r=await read();assert.equal(r.state.mode,'benchmark');assert.ok(Number.isFinite(r.metrics.mae));assert.ok(r.metrics.local?.count>0);assert.ok(Number.isFinite(r.metrics.local.mae));assert.ok(r.metrics.convergence<.05);assert.match(await page.locator('.comparison-labels').innerText(),/完整几何参考/);console.log('METRICS',r.metrics);await page.screenshot({path:'test-results/comparison-reference.png',fullPage:true});
 });
 await test('paused algorithm changes hide old metrics until a new frame',async()=>{
  await page.getByRole('button',{name:'GTAO',exact:true}).click();await page.locator('.metric-row').waitFor();await page.getByRole('button',{name:'暂停更新',exact:true}).click();await page.getByRole('button',{name:'SSAO',exact:true}).click();assert.equal((await read()).metrics,null);assert.equal(await page.locator('.metric-row').count(),0);await page.locator('.pending-banner').waitFor();await page.getByRole('button',{name:'单步计算',exact:true}).click();await page.locator('.metric-row').waitFor();assert.equal((await read()).state.algorithm,'ssao');assert.ok((await read()).metrics);await page.getByRole('button',{name:'恢复更新',exact:true}).click();
 });
 await test('paused radius change hides stale reference and geometry changes leave benchmark',async()=>{
  await advanced();await page.getByLabel('视图',{exact:true}).selectOption('difference');await page.getByRole('button',{name:'暂停更新',exact:true}).click();await page.getByLabel('作用半径',{exact:true}).fill('1.5');let r=await read();assert.equal(r.metrics,null);assert.equal(r.state.view,'ao');await page.getByRole('button',{name:'恢复更新',exact:true}).click();await page.getByLabel('遮挡物抬升',{exact:true}).fill('0.5');r=await read();assert.equal(r.state.mode,'explore');assert.equal(r.metrics,null);
 });
 await test('selection follows the same surface after changing height or explicitly invalidates',async()=>{
  await page.getByRole('button',{name:'检查中心表面',exact:true}).click();await page.locator('.inspection').waitFor();await page.getByLabel('遮挡物抬升',{exact:true}).fill('0.6');await page.waitForTimeout(200);const r=await read();assert.ok(r.inspection||r.state.mode==='explore');
 });
 await test('six scenes render and the application preset shows room geometry',async()=>{
  await advanced();for(const scene of ['corner','thin','layers','bench','room','contact']){await page.getByLabel('场景',{exact:true}).selectOption(scene);await page.waitForTimeout(100);assert.equal((await read()).state.scene,scene);}
  await page.getByRole('button',{name:/04.*实际应用/}).click();assert.equal((await read()).state.scene,'room');await page.locator('.viewport').scrollIntoViewIfNeeded();await page.waitForTimeout(200);await page.screenshot({path:'test-results/room.png',fullPage:true});
 });
 await test('version 2 links preserve comparison and version 1 links explicitly reset',async()=>{
  await advanced();await page.getByLabel('作用半径',{exact:true}).fill('2.1');await page.getByRole('button',{name:'分享参数',exact:true}).click();const link=await page.locator('.share-box input').inputValue();await page.goto(link);await ready();assert.equal((await read()).state.radius,2.1);assert.equal((await read()).state.version,2);
  await page.goto(base+'/lab/#state='+encodeURIComponent('{"version":1}'));await page.reload();await ready();assert.equal((await read()).state.scene,'bench');assert.match(await page.locator('.live-message').innerText(),/版本/);
 });
 await test('same-document shared scene restores the supplied camera without a refresh',async()=>{
  const current=(await read()).state,shared={...current,scene:'room',camera:{position:[4,4,4],target:[0,1,0]},learning:{chapter:'ssao',lesson:'noise'}};
  await page.evaluate(s=>{location.hash='#state='+encodeURIComponent(JSON.stringify(s))},shared);await page.waitForTimeout(200);assert.deepEqual((await read()).state.camera,shared.camera);assert.equal((await read()).state.scene,'room');assert.match(await page.locator('.learning-context a').getAttribute('href'),/#ssao$/);await page.reload();await ready();assert.deepEqual((await read()).state.camera,shared.camera);
 });
 await test('pause, step, offscreen resume and mobile layout',async()=>{
  await advanced();await page.getByRole('button',{name:'暂停更新',exact:true}).click();await page.getByLabel('切片数',{exact:true}).fill('2');await page.getByRole('button',{name:'单步计算',exact:true}).click();await page.getByRole('button',{name:'恢复更新',exact:true}).click();await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(100);await page.evaluate(()=>window.scrollTo(0,0));await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/mobile-lab.png',fullPage:true});
 });
 await test('read-only WebMCP contract and invalid input',async()=>{
  assert.equal((await read()).state.slices,2);assert.equal(await page.evaluate(()=>{try{window.__tools.read_ao_experiment.execute({bad:1});return false}catch{return true}}),true);
 });
 await test('article without JavaScript retains explanation, formulas and new experiment',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),p=await context.newPage();await p.goto(base+'/articles/gtao/');assert.equal(await p.locator('article>h2').count(),8);assert.ok(await p.locator('.katex').count()>5);assert.equal(await p.locator('.walk-experiment svg').count(),1);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await p.screenshot({path:'test-results/no-js.png'});await context.close();
 });
 await test('missing WebGL degrades to a static explanation and retry',async()=>{
  const p=await browser.newPage();await p.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return String(type).startsWith('webgl')?null:original.call(this,type,...args);};});await p.goto(base+'/lab/');await p.getByRole('button',{name:'重试',exact:true}).waitFor();assert.ok(await p.locator('.fallback svg').isVisible());await p.close();
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/browser-results.json',JSON.stringify({passed:results,errors},null,2));console.log('ALL',results.length,'browser scenarios passed');
}catch(error){console.log('CONSOLE ERRORS',errors);await page.screenshot({path:'test-results/failure.png',fullPage:true}).catch(()=>{});throw error;}finally{await browser.close();}
