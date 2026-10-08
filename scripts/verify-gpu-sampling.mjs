import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,rm,writeFile} from 'node:fs/promises';
import {PerspectiveCamera,Vector3,Vector4} from 'three';

const base=process.env.TEST_URL||'http://127.0.0.1:4321';
const output='test-results/gpu-sampling-results.json';
const errors=[],results=[];
let lastReport=null;
// These targets are on the contact scene's large floor, at least the .6
// sampling radius from every sphere/box. The public canvas picks the floor;
// the recommended focus target is deliberately irrelevant to this fixture.
const fixtures=[
 {name:'center-floor',position:[0,1,4],target:[0,0,2],uv:[.5,.5]},
 {name:'oblique-floor',position:[.4,1.2,4.5],target:[.1,0,2.2],uv:[.45,.5]},
 {name:'grazing-floor',position:[-.3,.6,4.6],target:[-.1,0,2.5],uv:[.55,.48]},
];
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const browser=await chromium.launch({
 executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
 headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page=await browser.newPage({viewport:{width:1200,height:1000}});
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
await page.addInitScript(()=>{
 window.__tools={};
 Object.defineProperty(document,'modelContext',{value:{registerTool(tool,options){
  window.__tools[tool.name]=tool;
  options?.signal?.addEventListener('abort',()=>delete window.__tools[tool.name]);
 }}});
});
const read=()=>page.evaluate(()=>window.__tools.read_ao_experiment.execute({}));
await mkdir('test-results',{recursive:true});

function projectionUv(position,camera) {
 const clip=new Vector4(...position,1).applyMatrix4(camera.projectionMatrix);
 return {uv:[clip.x/clip.w*.5+.5,clip.y/clip.w*.5+.5],w:clip.w};
}

// Recover a continuous screen ray consistent with every exported texel and
// the slice's azimuth bin. Reconstructing at that ray with the texel's depth
// reproduces the old mismatch as a negative control, without changing the app.
function legacyScreenRequests(slice,sliceIndex,position,camera,dimensions,state,uv) {
 const pixelRadius=Math.min(150,state.radius*camera.projectionMatrix.elements[5]*dimensions[1]/(-2*position.z));
 const bounds=[[-1,1],[0,1]];
 const offsets=slice.samples.map((sample,index)=>{
  const side=index%2===0?-1:1,f=(Math.floor(index/2)+.65)/state.steps,offset=Math.max(1.5,f*f*pixelRadius);
  for(let component=0;component<2;component++) {
   const pixelDelta=Math.round(side*([sample.u,sample.v][component]-uv[component])*dimensions[component]);
   bounds[component][0]=Math.max(bounds[component][0],(pixelDelta-.5)/offset);
   bounds[component][1]=Math.min(bounds[component][1],(pixelDelta+.5)/offset);
  }
  return side*offset;
 });
 assert.ok(bounds.every(([low,high])=>low<=high),'GPU texels must admit a consistent continuous screen ray');
 // GLSL's approximate sin/cos need not have exactly unit length. Keep each
 // component inside its observed interval instead of renormalizing the ray.
 const direction=bounds.map(([low,high])=>(low+high)/2),phi=Math.atan2(direction[1],direction[0]);
 assert.ok(Math.abs(Math.hypot(...direction)-1)<.004);
 assert.ok(phi>=sliceIndex*Math.PI/state.slices-.002&&phi<=(sliceIndex+1)*Math.PI/state.slices+.002);
 const requests=offsets.map(offset=>[uv[0]+direction[0]*offset/dimensions[0],uv[1]+direction[1]*offset/dimensions[1]]);
 for(let index=0;index<requests.length;index++) for(let component=0;component<2;component++) {
  const predicted=(Math.floor(requests[index][component]*dimensions[component])+.5)/dimensions[component];
  assert.ok(Math.abs(predicted-[slice.samples[index].u,slice.samples[index].v][component])*dimensions[component]<1e-4,'the negative-control ray must reproduce the actual GPU texel choices');
 }
 return requests;
}

function validate(report,dimensions,fixture,algorithm) {
 const inspection=report.inspection;
 assert.ok(inspection,`${fixture.name}: public surface pick must produce an inspection`);
 assert.equal(inspection.algorithm,algorithm);
 const camera=new PerspectiveCamera(45,dimensions[0]/dimensions[1],.1,50);
 camera.position.fromArray(report.state.camera.position);
 camera.lookAt(new Vector3(...report.state.camera.target));camera.updateMatrixWorld();
 const position=new Vector3(...inspection.position),normal=new Vector3(...inspection.normal).normalize();
 const world=position.clone().applyMatrix4(camera.matrixWorld),view=position.clone().negate().normalize();
 // This SwiftShader readback has a small common plane offset (~3e-4 here).
 // The tighter relative-plane and pixel-scale checks below detect wrong rays.
 assert.ok(Math.abs(world.y)<.0005,`selected point must lie on world y=0; got ${world.y}`);
 assert.ok(world.z>1.65,'the selected floor point must remain clear of contact-scene blockers');
 const metrics={fixture:fixture.name,algorithm,dimensions,uv:inspection.uv,world:world.toArray(),raw:inspection.raw,
  validSamples:0,maxPlaneResidual:0,maxTexelCenterError:0,maxSurfaceProjectionError:0,
  maxDistanceError:0,maxCandidateTexelOffset:0,maxHorizonTangentError:0,maxHorizonTransportError:0,maxLocalPlaneResidual:0,minOnePixelPlaneShift:Infinity,maxLegacyMixedUvPlaneResidual:0};
 for(const [sliceIndex,slice] of inspection.slices.entries()) {
 const legacyRequests=algorithm==='ssao'?null:legacyScreenRequests(slice,sliceIndex,position,camera,dimensions,report.state,inspection.uv);
 for(let index=0;index<slice.samples.length;index++) {
  const sample=slice.samples[index];
  const texelError=Math.max(...[sample.u,sample.v].map((uv,axis)=>Math.abs(uv*dimensions[axis]-.5-Math.round(uv*dimensions[axis]-.5))));
  metrics.maxTexelCenterError=Math.max(metrics.maxTexelCenterError,texelError);
  assert.ok(texelError<1e-4,`debug UV must describe a texel center, error=${texelError}`);
  if(sample.candidate) {
   const candidate=projectionUv(sample.candidate,camera);
   if(candidate.w>0) {
    const offset=Math.max(Math.abs(candidate.uv[0]-sample.u)*dimensions[0],Math.abs(candidate.uv[1]-sample.v)*dimensions[1]);
    metrics.maxCandidateTexelOffset=Math.max(metrics.maxCandidateTexelOffset,offset);
    assert.ok(offset<=.501,`SSAO candidate must select the recorded nearest texel, offset=${offset}`);
   }
  }
  if(!sample.surface)continue;
  const projected=projectionUv(sample.surface,camera).uv;
  const projectionError=Math.max(Math.abs(projected[0]-sample.u)*dimensions[0],Math.abs(projected[1]-sample.v)*dimensions[1]);
  metrics.maxSurfaceProjectionError=Math.max(metrics.maxSurfaceProjectionError,projectionError);
  assert.ok(projectionError<1e-4,`reconstructed surface must project to the recorded texel center, error=${projectionError}`);
  if(sample.distance<=0||sample.distance>=report.state.radius)continue;
  metrics.validSamples++;
  const surface=new Vector3(...sample.surface),delta=surface.clone().sub(position);
  const surfaceWorld=surface.clone().applyMatrix4(camera.matrixWorld);
  const planeResidual=Math.abs(surfaceWorld.y);
  metrics.maxPlaneResidual=Math.max(metrics.maxPlaneResidual,planeResidual);
  metrics.maxLocalPlaneResidual=Math.max(metrics.maxLocalPlaneResidual,Math.abs(surfaceWorld.y-world.y));
  metrics.minOnePixelPlaneShift=Math.min(metrics.minOnePixelPlaneShift,Math.abs(2*surface.z*normal.y/(camera.projectionMatrix.elements[5]*dimensions[1])));
  assert.ok(planeResidual<.0005,`nearest-depth surface must remain on the analytic floor, residual=${planeResidual}`);
  if(legacyRequests) {
   const legacyUv=legacyRequests[index];
   const wrongSurface=new Vector3((legacyUv[0]*2-1)*(-surface.z)/camera.projectionMatrix.elements[0],(legacyUv[1]*2-1)*(-surface.z)/camera.projectionMatrix.elements[5],surface.z).applyMatrix4(camera.matrixWorld);
   metrics.maxLegacyMixedUvPlaneResidual=Math.max(metrics.maxLegacyMixedUvPlaneResidual,Math.abs(wrongSurface.y-world.y));
  }
  const distanceError=Math.abs(delta.length()-sample.distance);
  metrics.maxDistanceError=Math.max(metrics.maxDistanceError,distanceError);
  assert.ok(distanceError<2e-6,'debug distance must use the actual reconstructed surface');
  if(algorithm==='ssao')continue;
  const side=index%2===0?-1:1;
  const tangentError=Math.abs(sample.value+side*Math.sin(slice.gamma));
  metrics.maxHorizonTangentError=Math.max(metrics.maxHorizonTangentError,tangentError);
  assert.ok(tangentError<.00025,`coplanar sample must stay on the nominal slice tangent, error=${tangentError}`);
  // Independently rebuild the correction from actual GPU-read positions.
  const lateral=delta.clone().addScaledVector(view,-delta.dot(view)).normalize().multiplyScalar(side);
  const actualGamma=Math.atan2(normal.dot(lateral),normal.dot(view));
  const rawTheta=Math.acos(clamp(delta.dot(view)/delta.length(),-1,1));
  const correctedTheta=clamp(rawTheta+side*(slice.gamma-actualGamma),0,Math.PI);
  const transportError=Math.abs(sample.value-Math.cos(correctedTheta));
  metrics.maxHorizonTransportError=Math.max(metrics.maxHorizonTransportError,transportError);
  assert.ok(transportError<.0002,`GPU horizon must match the corrected cosine, error=${transportError}`);
 }
 }
 assert.ok(metrics.validSamples>(algorithm==='ssao'?95:120),'the floor fixture must exercise enough in-radius samples');
 assert.ok(metrics.maxLocalPlaneResidual<metrics.minOnePixelPlaneShift*.025,'local plane error must be less than 1/40 of a vertical texel mismatch');
 assert.ok(metrics.maxPlaneResidual<metrics.minOnePixelPlaneShift*.2,'absolute floor residual must remain below 1/5 of a vertical texel mismatch');
 if(algorithm!=='ssao')assert.ok(metrics.maxLegacyMixedUvPlaneResidual>Math.max(.0005,20*metrics.maxLocalPlaneResidual),'the negative control must expose the former UV/depth mismatch');
 if(algorithm==='ssao') {
  const samples=inspection.slices.flatMap(slice=>slice.samples),expected=1-samples.reduce((sum,sample)=>sum+sample.value,0)/samples.length;
  assert.ok(Math.abs(expected-inspection.raw)<1e-6);
  assert.ok(inspection.raw>.995,'the flat floor must be unoccluded by SSAO');
 } else {
  // A finite number of GTAO slices approximates the azimuth integral. HBAO's
  // flat-plane tangent subtraction is exact apart from depth/float precision.
  const tolerance=algorithm==='gtao'?.001:.0002;
  assert.ok(Math.abs(1-inspection.raw)<tolerance,`${algorithm} must leave the unobstructed plane visible; raw=${inspection.raw}`);
  if(algorithm==='gtao') {
   const expected=clamp(inspection.slices.reduce((sum,slice)=>sum+slice.gpu,0)/inspection.slices.length,0,1);
   assert.ok(Math.abs(expected-inspection.raw)<2e-6,'raw GTAO must match the shader debug slice integral');
  } else {
   const occlusion=inspection.slices.reduce((sum,slice)=>sum+Math.max(0,Math.cos(slice.high)+Math.sin(slice.gamma))+Math.max(0,Math.cos(slice.low)-Math.sin(slice.gamma)),0);
   assert.ok(Math.abs(clamp(1-occlusion/(2*inspection.slices.length),0,1)-inspection.raw)<2e-6);
  }
 }
 return metrics;
}

try {
 for(const fixture of fixtures) {
  const state={version:2,comparison:'beauty',scene:'contact',mode:'explore',algorithm:'gtao',view:'raw',
   radius:.6,slices:8,steps:12,filter:false,lift:0,seed:17,camera:{position:fixture.position,target:fixture.target}};
  await page.goto(`${base}/lab/?gpu-sampling=${fixture.name}#state=${encodeURIComponent(JSON.stringify(state))}`);
  await page.waitForFunction(()=>document.querySelector('.lab-status')?.textContent.includes('WebGL2')&&window.__tools?.read_ao_experiment);
  const canvas=page.locator('.viewport>canvas');
  await canvas.scrollIntoViewIfNeeded();
  const bounds=await canvas.boundingBox();assert.ok(bounds);
  await canvas.click({position:{x:bounds.width*fixture.uv[0],y:bounds.height*(1-fixture.uv[1])}});
  await page.waitForFunction(()=>window.__tools.read_ao_experiment.execute({}).inspection?.algorithm==='gtao');
  for(const algorithm of ['gtao','hbao','ssao']) {
   if(algorithm!=='gtao') {
    await page.getByRole('button',{name:algorithm.toUpperCase(),exact:true}).click();
    await page.waitForFunction(a=>window.__tools.read_ao_experiment.execute({}).inspection?.algorithm===a,algorithm);
   }
   const report=await read(),dimensions=await canvas.evaluate(element=>[element.width,element.height]);
   assert.deepEqual(report.state.camera,state.camera,'restored camera must remain unchanged during the test');
   lastReport={report,dimensions,fixture,algorithm};
   const result=validate(report,dimensions,fixture,algorithm);results.push(result);
   console.log('PASS',JSON.stringify(result));
  }
 }
 assert.deepEqual(errors,[]);
 await writeFile(output,JSON.stringify({passed:results.length,results,errors},null,2));
 await rm('test-results/gpu-sampling-failure.png',{force:true});
 console.log(`ALL ${results.length} actual WebGL sampling scenarios passed; ${output}`);
} catch(error) {
 await writeFile(output,JSON.stringify({passed:results.length,results,errors,lastReport,failure:String(error)},null,2));
 await page.screenshot({path:'test-results/gpu-sampling-failure.png',fullPage:true}).catch(()=>{});
 throw error;
} finally {await browser.close();}
