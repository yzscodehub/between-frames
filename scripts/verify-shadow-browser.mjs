// Run after the app is built/served: node --import tsx scripts/verify-shadow-browser.mjs
// This script never builds or starts a server.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {PerspectiveCamera,Vector3} from 'three';
import {createShadowScene} from '../src/lib/shadow/scene.ts';
import {linearDepth,penumbraUv,referenceVisibility} from '../src/lib/shadow/math.ts';
import {makeRay,traceBrute} from '../src/lib/ray/geometry.ts';

const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[],passed=[],evidence=[];
page.setDefaultTimeout(20000);
page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await mkdir('test-results',{recursive:true});
await page.addInitScript(()=>{window.__shadowTools={};Object.defineProperty(document,'modelContext',{value:{registerTool(tool){window.__shadowTools[tool.name]=tool;}}});});
const read=()=>page.evaluate(()=>window.__shadowTools.read_shadow_experiment.execute({}));
async function ready(){await canvas().waitFor({state:'attached'});await canvas().scrollIntoViewIfNeeded();await page.waitForFunction(()=>{const tool=window.__shadowTools?.read_shadow_experiment;if(!tool)return false;const r=tool.execute({});return r.ready&&!r.pending;});const r=await read();assert.ok(!r.error,r.error);return r;}
async function test(name,run){await run();passed.push(name);console.log('PASS',name);}
async function setRange(label,value){
 await page.getByLabel(label,{exact:true}).evaluate((element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(value));element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},value);
}
async function algorithm(name){await page.getByRole('button',{name:{hard:'硬阴影',pcf:'PCF',pcss:'PCSS'}[name],exact:true}).click();return ready();}
async function preset(name){await page.getByLabel('阴影场景',{exact:true}).selectOption(name);return ready();}
const canvas=()=>page.locator('.shadow-viewport canvas');
async function pick(uv){
 const state=(await read()).state,box=await canvas().boundingBox();assert.ok(box);
 const columns=state.compare?2:1,rows=state.compare?2:1;
 await canvas().click({position:{x:box.width*uv[0]/columns,y:box.height*(1-uv[1])/rows}});
 return (await read()).inspection??null;
}
function worldUv(world,state){const camera=new PerspectiveCamera(45,1.6,.1,100);camera.position.set(...state.camera.position);camera.lookAt(...state.camera.target);camera.updateMatrixWorld();const p=new Vector3(...world).project(camera);return [(p.x+1)/2,(p.y+1)/2];}
function candidates(state){
 const points=[[.53,.3],[.47,.3],[.6,.35],[.4,.4],[.65,.28],[.35,.28],[.5,.2],[.5,.45]],light=[-3.5,7,4.5],y=state.height+.14;
 const scene=createShadowScene(state);try{for(const mesh of scene.meshes.slice(1))points.push(worldUv(mesh.position.toArray(),state));}finally{scene.dispose();}
 // Project actual plate-shadow edge locations rather than assuming a fixed
 // screen pixel remains near a penumbra in every state or camera position.
 for(const x of [-.8,0,.8])for(const z of [-.7,0,.7]){
  if(x===0&&z===0)continue;
  const scale=light[1]/(light[1]-y),point=[light[0]+(.8+x-light[0])*scale,0,light[2]+(.65+z-light[2])*scale];
  for(const offset of [-.06,0,.06])points.push(worldUv([point[0]+offset,0,point[2]+offset],state));
 }
 for(const x of [-4,-2,0,2,4])for(const z of [-4,-2,0,2,4])points.push(worldUv([x,0,z],state));
 return points.filter(([u,v])=>u>.03&&u<.97&&v>.03&&v<.97);
}
async function findPoint(predicate,label,points){
 const state=(await read()).state;
 for(const uv of points??candidates(state)){const inspection=await pick(uv);if(inspection&&predicate(inspection))return inspection;}
 throw new Error(`No actual surface sample found: ${label}`);
}
function validateInspection(i,state){
 assert.ok(i.position.every(Number.isFinite)&&i.normal.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...i.normal)-1)<.005);
 assert.ok(Number.isInteger(i.objectId)&&i.objectId>=0);assert.ok(i.receiverDistance>0);assert.ok(i.visibility>=0&&i.visibility<=1);
 assert.ok(i.covered);assert.ok(i.mapDepthError!==null&&i.mapDepthError<2e-4,`CPU map depth error ${i.mapDepthError}`);
 assert.ok(i.mathError!==null&&i.mathError<2e-6,`same GPU taps re-evaluation ${i.mathError}`);
 for(const sample of i.samples){if(!sample.valid)continue;assert.ok(sample.depth>=0&&sample.depth<=1);assert.ok(Number.isFinite(sample.receiver));assert.equal(sample.visible,sample.receiver<=sample.depth?1:0);}
 if(state.algorithm==='pcss'&&i.blockerCount>0){
  const blockers=i.samples.filter(s=>s.stage==='search'&&s.valid&&s.blocker),mean=blockers.reduce((sum,s)=>sum+linearDepth(s.depth,.5,25),0)/blockers.length;
  assert.equal(blockers.length,i.blockerCount);assert.ok(Math.abs(mean-i.blockerDistance)<2e-4);
  const radius=penumbraUv(state.lightSize,i.receiverDistance,i.blockerDistance,Math.tan(state.fov*Math.PI/360))*state.resolution;
  assert.ok(Math.abs(radius-i.radiusTexels)<.002*Math.max(1,radius));
 }
 const scene=createShadowScene(state),camera=new PerspectiveCamera(45,1.6,.1,50);camera.position.set(...state.camera.position);camera.lookAt(...state.camera.target);camera.updateMatrixWorld();
 try{
  const direction=new Vector3(i.uv[0]*2-1,i.uv[1]*2-1,0).applyMatrix4(camera.projectionMatrixInverse).transformDirection(camera.matrixWorld),hit=traceBrute(makeRay(camera.position.toArray(),direction.toArray(),0,50),scene.primitives).hit;
  assert.ok(hit,'GPU primary surface has an independent CPU hit');assert.equal(i.objectId,hit.objectId);
  assert.ok(Math.hypot(...i.position.map((v,axis)=>v-hit.position[axis]))<.003,'raster world position must match the CPU triangle');
  assert.ok(i.normal.reduce((sum,v,axis)=>sum+v*hit.geometricNormal[axis],0)>.97,'raster Ng must match the mesh winding');
 }finally{scene.dispose();}
}
async function generateReference(){await page.getByRole('button',{name:'生成单点 1024 样本参考',exact:true}).click();await page.waitForFunction(()=>{const r=window.__shadowTools.read_shadow_experiment.execute({});return r.reference?.samples===1024&&r.referenceProgress===1;},undefined,{timeout:120000});return read();}
function cpuReference(state,inspection){
 const scene=createShadowScene(state),light=new PerspectiveCamera(state.fov,1,.5,25);light.position.set(-3.5,7,4.5);light.lookAt(0,0,0);light.updateMatrixWorld();
 const u=new Vector3(1,0,0).transformDirection(light.matrixWorld).multiplyScalar(state.lightSize).toArray(),v=new Vector3(0,1,0).transformDirection(light.matrixWorld).multiplyScalar(state.lightSize).toArray();
 try{return referenceVisibility(inspection.position,inspection.normal,scene.primitives,{center:light.position.toArray(),u,v,capacity:1024,samples:1024,seed:state.seed,nearEpsilon:1e-4});}finally{scene.dispose();}
}

try{
 await page.goto(base+'/labs/shadows/');await ready();
 await test('guided tasks activate only when loaded and reset restores each exact task state',async()=>{
  const activeTasks=page.locator('.shadow-task button[aria-pressed="true"]');assert.equal(await activeTasks.count(),0);
  await page.getByRole('button',{name:'3 · 偏移的代价',exact:true}).click();await ready();
  const mapping=(await read()).state;assert.equal(mapping.lesson,'mapping');assert.equal(mapping.preset,'steps');assert.equal(mapping.algorithm,'hard');assert.equal(mapping.bias,0);assert.equal(mapping.planeCorrection,false);
  assert.equal(await activeTasks.innerText(),'3 · 偏移的代价');await setRange('阴影深度偏移',.019);await ready();assert.equal((await read()).state.bias,.019);
  await page.getByRole('button',{name:'恢复本节示例',exact:true}).click();await ready();assert.deepEqual((await read()).state,mapping);assert.equal(await activeTasks.innerText(),'3 · 偏移的代价');
  await page.getByRole('button',{name:'PCF / PCSS',exact:true}).click();await ready();assert.equal(await activeTasks.count(),0);
  await page.getByRole('button',{name:'1 · 先比较再平均',exact:true}).click();await ready();
  const filtering=(await read()).state;assert.equal(filtering.lesson,'filtering');assert.equal(filtering.preset,'steps');assert.equal(filtering.algorithm,'pcf');assert.equal(filtering.resolution,256);assert.equal(filtering.filterRadius,2);
  await setRange('PCF 固定半径',7.5);await ready();assert.equal((await read()).state.filterRadius,7.5);
  await page.getByRole('button',{name:'恢复本节示例',exact:true}).click();await ready();assert.deepEqual((await read()).state,filtering);assert.equal(await activeTasks.innerText(),'1 · 先比较再平均');
  evidence.push({taskReset:{mapping,filtering}});await page.screenshot({path:'test-results/shadow-task-reset.png',fullPage:true});
 });
 await page.getByRole('button',{name:'PCF / PCSS',exact:true}).click();await ready();
 await page.getByLabel('阴影显示信号',{exact:true}).selectOption('visibility');await ready();
 await test('three mesh scenes and three algorithms expose matching real GPU and CPU records',async()=>{
  for(const scene of ['contact','steps','layers'])for(const method of ['hard','pcf','pcss']){
   await preset(scene);await algorithm(method);
   const i=await findPoint(i=>i.objectId>0&&i.covered&&i.mapDepthError!==null&&i.mapDepthError<2e-4&&i.mathError!==null,'covered non-ground mesh surface'),state=(await read()).state;validateInspection(i,state);
   evidence.push({scene,method,uv:i.uv,position:i.position,normal:i.normal,mapDepthError:i.mapDepthError,mathError:i.mathError,visibility:i.visibility});
  }
 });
 await test('zero PCF radius and zero-size PCSS reproduce the same hard lookup',async()=>{
  await preset('contact');await algorithm('hard');const hard=await findPoint(i=>i.covered,'hard shadow point'),uv=hard.uv;
  await setRange('PCF 固定半径',0);await ready();await algorithm('pcf');const pcf=await pick(uv);assert.ok(pcf?.covered);assert.equal(pcf.visibility,hard.visibility);assert.equal(pcf.radiusTexels,0);
  await setRange('灯面半边长',0);await ready();await algorithm('pcss');const pcss=await pick(uv);assert.ok(pcss?.covered);assert.equal(pcss.visibility,hard.visibility);assert.equal(pcss.radiusTexels,0);
 });
 await test('actual blocker distances generate nonzero, state-dependent penumbra radii',async()=>{
  await setRange('灯面半边长',.4);await setRange('遮挡板高度',.6);await setRange('光源视角',90);await ready();
  let first=await findPoint(i=>i.covered&&i.objectId===0&&i.blockerCount>0&&i.radiusTexels>.01,'floor with real blockers');validateInspection(first,(await read()).state);
  const uv=first.uv;await setRange('灯面半边长',.9);await ready();let larger=await pick(uv);assert.ok(larger?.covered&&larger.blockerCount>0&&larger.radiusTexels>0);assert.ok(Math.abs(larger.radiusTexels-first.radiusTexels)>.001);validateInspection(larger,(await read()).state);
  await setRange('遮挡板高度',1.2);await ready();let higher=await pick(uv);
  // The same receiver can become unoccluded. If that happened, record the zero
  // radius honestly and inspect a new actual shadow point for the new geometry.
  assert.ok(higher&&higher.objectId===0);assert.ok(Math.hypot(...higher.position.map((v,j)=>v-first.position[j]))<.01);
  if(!higher.covered||higher.blockerCount===0)higher=await findPoint(i=>i.covered&&i.objectId===0&&i.blockerCount>0&&i.radiusTexels>0,'raised plate blockers');
  validateInspection(higher,(await read()).state);assert.ok(Math.abs(higher.blockerDistance-larger.blockerDistance)>.001||Math.abs(higher.radiusTexels-larger.radiusTexels)>.001);
  evidence.push({penumbra:{first,larger,higher}});
 });
 await test('out-of-map or incomplete filter coverage is explicit and not presented as fully lit',async()=>{
  await algorithm('pcf');await setRange('PCF 固定半径',12);await setRange('光源视角',40);await ready();
  const missing=await findPoint(i=>!i.covered,'missing map coverage');const displayedVisibility=await page.getByText('当前算法可见度',{exact:true}).locator('..').locator('dd').innerText();assert.ok(displayedVisibility.startsWith('—'),'incomplete data must not be displayed as a numeric visibility');
  assert.ok(!missing.covered);evidence.push({uncovered:{uv:missing.uv,lightUv:missing.lightUv,samples:missing.samples.filter(s=>!s.valid).length}});
  await setRange('光源视角',90);await setRange('PCF 固定半径',2);await ready();await algorithm('pcss');
 });
 await test('selected-point 1024 reference agrees with independent geometry and survives algorithm changes',async()=>{
  const selected=await findPoint(i=>i.covered&&i.objectId===0&&i.radiusTexels>0&&i.visibility>.02&&i.visibility<.98,'fractional penumbra reference point');
  let report=await generateReference(),expected=cpuReference(report.state,selected);assert.deepEqual(report.reference,expected);assert.equal(report.reference.samples,1024);assert.equal(report.reference.convergence,Math.abs(report.reference.value-report.reference.checkpoint));
  const preserved=structuredClone(report.reference),position=[...report.inspection.position];
  await algorithm('hard');report=await read();assert.deepEqual(report.reference,preserved);assert.deepEqual(report.inspection.position,position);
  await page.getByLabel('光图分辨率',{exact:true}).selectOption('256');await ready();report=await read();assert.deepEqual(report.reference,preserved);
  await setRange('灯面半边长',.65);await ready();assert.equal((await read()).reference,null);
  evidence.push({reference:{selected:report.inspection.uv,state:report.state,reference:preserved}});
 });
 await test('reference cancellation and geometry invalidation reject stale asynchronous completion',async()=>{
  await findPoint(i=>i.covered,'reference cancellation receiver');await page.getByRole('button',{name:'生成单点 1024 样本参考',exact:true}).click();
  await page.waitForFunction(()=>{const r=window.__shadowTools.read_shadow_experiment.execute({});return r.referenceProgress>0&&r.referenceProgress<1;});
  await page.getByRole('button',{name:'取消单点参考',exact:true}).click();await page.waitForTimeout(120);let r=await read();assert.equal(r.reference,null);assert.equal(r.referenceProgress,0);
  await page.getByRole('button',{name:'生成单点 1024 样本参考',exact:true}).click();await page.waitForFunction(()=>window.__shadowTools.read_shadow_experiment.execute({}).referenceProgress>0);
  await setRange('遮挡板高度',1.35);await ready();await page.waitForTimeout(120);r=await read();assert.equal(r.reference,null);assert.equal(r.referenceProgress,0);
 });
 await test('paused edits clear old inspections and a single step computes the edited state',async()=>{
  await findPoint(i=>i.covered,'pause receiver');await page.getByRole('button',{name:'暂停更新',exact:true}).click();await setRange('阴影深度偏移',.007);
  let r=await read();assert.equal(r.paused,true);assert.equal(r.pending,true);assert.equal(r.inspection,null);assert.equal(await page.locator('.shadow-inspection').count(),0);
  await page.getByRole('button',{name:'单步计算',exact:true}).click();await ready();r=await read();assert.equal(r.paused,true);assert.equal(r.state.bias,.007);
  await page.getByRole('button',{name:'恢复更新',exact:true}).click();await ready();
 });
 await test('sharing restores the complete state including an actually dragged camera',async()=>{
  const old=(await read()).state.camera,box=await canvas().boundingBox();await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.58,box.y+box.height*.46,{steps:6});await page.mouse.up();await ready();
  const before=(await read()).state;assert.notDeepEqual(before.camera,old);await page.getByRole('button',{name:'分享阴影实验',exact:true}).click();const link=await page.getByLabel('阴影实验分享链接',{exact:true}).inputValue();
  await page.goto(link);await ready();assert.deepEqual((await read()).state,{...before,learning:before.learning??{article:'pcf-pcss',chapter:'lab'}});
 });
 await test('rapid geometry edits and offscreen changes resume without stale data',async()=>{
  const select=page.getByLabel('阴影场景',{exact:true});await select.selectOption('layers');await select.selectOption('steps');await select.selectOption('contact');await ready();assert.equal((await read()).state.preset,'contact');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await page.waitForTimeout(100);
  const box=await canvas().boundingBox();assert.ok(box.y+box.height<0,'canvas should be outside the viewport');await setRange('阴影深度偏移',.004);await page.waitForTimeout(80);
  await canvas().scrollIntoViewIfNeeded();await ready();const r=await read();assert.equal(r.state.bias,.004);assert.equal(r.state.preset,'contact');await findPoint(i=>i.covered,'resumed receiver');
 });
 await test('four panels and mobile inspection fit the page',async()=>{
  if(!(await read()).state.compare){await page.getByRole('button',{name:'四格对照',exact:true}).click();await ready();}
  await canvas().screenshot({path:'test-results/shadow-comparison.png'});await page.screenshot({path:'test-results/shadow-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(100);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/shadow-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1050});
 });
 await test('both articles and extracted running shader code remain readable without JavaScript',async()=>{
  const context=await browser.newContext({javaScriptEnabled:false}),p=await context.newPage();
  try{for(const slug of ['shadow-mapping','pcf-pcss']){await p.goto(base+'/articles/'+slug+'/');assert.ok((await p.locator('h1').innerText()).length>2);assert.ok(await p.locator('h2').count()>=5);assert.ok((await p.locator('body').innerText()).length>1200);const code=await p.locator('.shadow-runtime-source code').textContent();assert.ok(code&&code.length>100);assert.ok(code.includes(slug==='shadow-mapping'?'textureLoad':'worldRadius'));assert.equal(await p.locator('.shadow-lab').count(),1);}}finally{await context.close();}
 });
 await test('a device without WebGPU retains explicit fallback and static explanation',async()=>{
  const context=await browser.newContext();await context.addInitScript(()=>{Object.defineProperty(navigator,'gpu',{value:undefined});});const p=await context.newPage();
  try{await p.goto(base+'/labs/shadows/');await p.getByRole('button',{name:'重试阴影实验',exact:true}).waitFor();assert.ok((await p.locator('.shadow-fallback').innerText()).includes('静态步骤'));assert.ok((await p.locator('h1').innerText()).length>0);}finally{await context.close();}
 });
 assert.deepEqual(errors,[]);await writeFile('test-results/shadow-browser-results.json',JSON.stringify({passed,evidence,errors},null,2));console.log('ALL',passed.length,'shadow browser scenarios passed');
}catch(error){console.error('BROWSER ERRORS',errors);await page.screenshot({path:'test-results/shadow-browser-failure.png',fullPage:true}).catch(()=>{});await writeFile('test-results/shadow-browser-results.json',JSON.stringify({passed,evidence,errors,failure:String(error)},null,2));throw error;}finally{await browser.close();}
