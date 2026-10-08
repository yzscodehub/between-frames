// Run against an already built/served app: node --import tsx scripts/verify-ssr-browser.mjs
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {PerspectiveCamera} from 'three';
import {createSSRScene} from '../src/lib/ssr/scene.ts';
const base=process.env.TEST_URL||'http://127.0.0.1:4321',passed=[],errors=[],evidence=[];
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1050}});page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});await mkdir('test-results',{recursive:true});
await page.addInitScript(()=>{window.__ssrTools={};Object.defineProperty(document,'modelContext',{value:{registerTool(tool){window.__ssrTools[tool.name]=tool;}}});});
const canvas=()=>page.locator('.ssr-viewport canvas'),read=()=>page.evaluate(()=>window.__ssrTools.read_ssr_experiment.execute({}));
async function ready(){await canvas().waitFor({state:'attached'});await canvas().scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const t=window.__ssrTools?.read_ssr_experiment;if(!t)return false;const r=t.execute({});return r.ready&&!r.pending;});const r=await read();assert.ok(!r.error,r.error);return r;}
async function test(name,run){await run();passed.push(name);console.log('PASS',name);}
async function range(label,value){await page.getByLabel(label,{exact:true}).evaluate((el,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(value));el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},value);}
async function pick(uv){const state=(await read()).state,b=await canvas().boundingBox();await canvas().click({position:{x:b.width*uv[0]/(state.compare?2:1),y:b.height*(1-uv[1])/(state.compare?2:1)}});return (await read()).inspection;}
function candidates(state){const camera=new PerspectiveCamera(45,1.6,.1,50);camera.position.set(...state.camera.position);camera.lookAt(...state.camera.target);camera.updateMatrixWorld();const scene=createSSRScene(state),uvs=[];
 try{for(const mesh of scene.meshes.slice(1)){const p=mesh.position.clone();p.y=-p.y;p.project(camera);for(const dx of [-.012,0,.012])for(const dy of [-.012,0,.012])uvs.push([p.x*.5+.5+dx,p.y*.5+.5+dy]);}}finally{scene.dispose();}
 for(const u of [.3,.4,.5,.6,.7])for(const v of [.15,.23,.3,.37])uvs.push([u,v]);return uvs.filter(([u,v])=>u>.02&&u<.98&&v>.02&&v<.98);
}
async function find(predicate,label){const state=(await read()).state;for(const uv of candidates(state)){const i=await pick(uv);if(i&&predicate(i))return i;}throw Error('No actual sample found: '+label);}
function validate(i){assert.equal(i.objectId,0);assert.ok(Math.abs(Math.hypot(...i.direction)-1)<.003);assert.ok(i.steps>=0&&i.steps<=256);assert.equal(i.samples.length,i.steps);assert.equal(i.reference.status===1,i.cpu.hit);if(i.cpu.hit){assert.equal(i.reference.objectId,i.cpu.objectId);assert.ok(i.referencePositionError<.003);}assert.ok(i.referenceColorError<.002);for(const sample of i.samples){assert.ok([...sample.uv,sample.rayDepth,sample.sceneDepth,sample.t,sample.delta].every(Number.isFinite));if(sample.kind===5)assert.ok(sample.uv.some(v=>v<0||v>=1));}}
try{
 await page.goto(base+'/labs/ssr/');await ready();
 await test('task presets are explicit and reset returns the exact loaded task state',async()=>{
  assert.equal(await page.locator('.ssr-task button[aria-pressed=true]').count(),0);await page.getByRole('button',{name:'2 · 步长与厚度',exact:true}).click();await ready();const initial=(await read()).state;assert.equal(initial.preset,'thin');assert.equal(initial.method,'view');await range('SSR 厚度容差',.3);await ready();await page.getByRole('button',{name:'恢复任务示例',exact:true}).click();await ready();assert.deepEqual((await read()).state,initial);
 });
 await test('all three raster scenes expose real screen steps and independent full-geometry hits',async()=>{
  await page.getByLabel('SSR 步进方式',{exact:true}).selectOption('screen');await ready();await page.getByLabel('SSR 步数预算',{exact:true}).selectOption('256');await ready();
  for(const preset of ['gallery','thin','hidden']){await page.getByLabel('SSR 场景',{exact:true}).selectOption(preset);await ready();const i=await find(i=>i.objectId===0&&i.reference.status===1,'reference hit in '+preset);validate(i);assert.ok(i.samples.length>0);evidence.push({preset,uv:i.uv,status:i.status,steps:i.steps,reference:i.reference,positionError:i.referencePositionError,colorError:i.referenceColorError});}
 });
 await test('view-space and screen-space quality settings change the actual samples, not the reference',async()=>{
  await page.getByLabel('SSR 场景',{exact:true}).selectOption('gallery');await ready();const screen=await find(i=>i.objectId===0&&i.status===1&&i.reference.status===1,'visible reflection');
  await page.getByLabel('SSR 步进方式',{exact:true}).selectOption('view');await range('SSR 视空间步长',1);await ready();const view=await pick(screen.uv);validate(view);assert.deepEqual(view.reference,screen.reference);assert.notDeepEqual(view.samples.map(s=>s.t),screen.samples.map(s=>s.t));
  await range('SSR 厚度容差',.003);await ready();const thin=await pick(screen.uv);validate(thin);if(thin.status===1)assert.ok(thin.depthDelta<=.00301);
  evidence.push({sampling:{screenSteps:screen.steps,viewSteps:view.steps,thinStatus:thin.status}});
 });
 await test('a hidden layer remains missing despite a full step budget',async()=>{
  await page.getByRole('button',{name:'3 · 缺失的一层',exact:true}).click();await ready();const missing=await find(i=>i.objectId===0&&i.reference.status===1&&(i.status!==1||i.hitObjectId!==i.reference.objectId),'hidden full-geometry target');validate(missing);
  await page.getByLabel('SSR 步数预算',{exact:true}).selectOption('64');await ready();await page.getByLabel('SSR 步数预算',{exact:true}).selectOption('256');await ready();const restored=await pick(missing.uv);assert.deepEqual(restored.reference,missing.reference);assert.ok(restored.status!==1||restored.hitObjectId!==restored.reference.objectId);evidence.push({hidden:{uv:restored.uv,status:restored.status,ssrObject:restored.hitObjectId,referenceObject:restored.reference.objectId}});
 });
 await test('budget exhaustion is distinct from a depth hit and selected logs are real data',async()=>{
  await page.getByLabel('SSR 步数预算',{exact:true}).selectOption('16');await ready();const budget=await find(i=>i.objectId===0&&i.status===6,'budget termination');assert.equal(budget.steps,16);assert.equal(budget.samples.length,16);assert.equal(budget.hitObjectId,-1);
  await range('SSR 检查步进',8);assert.ok((await page.locator('.ssr-inspection').innerText()).includes('步数预算耗尽'));await page.locator('.ssr-inspection').screenshot({path:'test-results/ssr-inspection.png'});
 });
 await test('shared local shading still agrees between complete GPU geometry and CPU',async()=>{
  await page.getByLabel('SSR 步数预算',{exact:true}).selectOption('256');await page.getByLabel('SSR 颜色模型',{exact:true}).selectOption('local');await ready();const i=await find(i=>i.objectId===0&&i.reference.status===1,'local reference hit');validate(i);assert.ok(i.referenceColorError<.002);
 });
 await test('pause hides stale inspection and step computes edited conditions',async()=>{
  await page.getByRole('button',{name:'暂停更新',exact:true}).click();await range('SSR 厚度容差',.12);let r=await read();assert.equal(r.pending,true);assert.equal(r.inspection,null);assert.equal(await page.locator('.ssr-inspection').count(),0);await page.getByRole('button',{name:'单步计算',exact:true}).click();await ready();r=await read();assert.equal(r.paused,true);assert.equal(r.state.thickness,.12);await page.getByRole('button',{name:'恢复更新',exact:true}).click();await ready();
 });
 await test('camera drag and versioned share restore the complete experiment',async()=>{
  const old=(await read()).state.camera,b=await canvas().boundingBox();await page.mouse.move(b.x+b.width*.25,b.y+b.height*.3);await page.mouse.down();await page.mouse.move(b.x+b.width*.31,b.y+b.height*.27,{steps:5});await page.mouse.up();await ready();const state=(await read()).state;assert.notDeepEqual(state.camera,old);await page.getByRole('button',{name:'分享 SSR 实验',exact:true}).click();const url=await page.getByLabel('SSR 实验分享链接',{exact:true}).inputValue();await page.goto(url);await ready();assert.deepEqual((await read()).state,{...state,learning:state.learning??{article:'ssr',chapter:'lab'}});
 });
 await test('rapid scene changes and offscreen edits resume without stale GPU state',async()=>{
  const select=page.getByLabel('SSR 场景',{exact:true});await select.selectOption('gallery');await select.selectOption('thin');await select.selectOption('hidden');await ready();assert.equal((await read()).state.preset,'hidden');await page.evaluate(()=>scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(100);await range('SSR 目标横移',1.5);await ready();assert.equal((await read()).state.offset,1.5);assert.deepEqual(errors,[]);
 });
 await test('mobile controls and actual-step diagrams do not overflow',async()=>{
  await page.getByRole('button',{name:'1 · 检查一条路径',exact:true}).click();await ready();await find(i=>i.objectId===0,'mobile mirror');await canvas().screenshot({path:'test-results/ssr-comparison.png'});await page.screenshot({path:'test-results/ssr-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/ssr-mobile.png',fullPage:true});
 });
 await test('the full article, six-element tasks, formulas and extracted source survive without JavaScript',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}}),p=await context.newPage();try{await p.goto(base+'/articles/ssr/');assert.ok((await p.locator('h1').innerText()).includes('SSR'));assert.ok(await p.locator('h2').count()>=6);assert.equal(await p.locator('.ray-task').count(),3);assert.equal(await p.locator('.ray-task dt').count(),18);assert.ok(await p.locator('.katex').count()>=3);assert.ok((await p.locator('.ssr-runtime-source code').textContent()).includes('perspectiveSegment'));assert.ok((await p.locator('body').innerText()).length>2000);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}finally{await context.close();}
 });
 await test('missing WebGL shows a labeled static explanation and retry',async()=>{
  const context=await browser.newContext();await context.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){if(['webgl','webgl2','experimental-webgl'].includes(type))return null;return original.call(this,type,...args);};});const p=await context.newPage();try{await p.goto(base+'/labs/ssr/');await p.getByRole('button',{name:'重试 SSR 实验',exact:true}).waitFor();assert.ok((await p.locator('.ssr-fallback').innerText()).includes('静态示意'));}finally{await context.close();}
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/ssr-browser-results.json',JSON.stringify({passed,evidence,errors},null,2));console.log('ALL',passed.length,'SSR browser scenarios passed');
}catch(error){await page.screenshot({path:'test-results/ssr-browser-failure.png',fullPage:true}).catch(()=>{});await writeFile('test-results/ssr-browser-results.json',JSON.stringify({passed,evidence,errors,failure:String(error)},null,2));console.log('ERRORS',errors);throw error;}finally{await browser.close();}
