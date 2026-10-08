// Standalone GPU-buffer conformance; no app server is used.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {gbuffer,temporal,atrous,compose} from '../src/shaders/ray/reconstruction.ts';
const query=fs.readFileSync(new URL('../src/shaders/ray/query.glsl',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();const results=await page.evaluate(({gbuffer,temporal,atrous,compose})=>{
  const gl=document.createElement('canvas').getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Float WebGL unavailable');
  const compile=(kind,source)=>{const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
  const program=(fragment)=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,'#version 300 es\n'+fragment));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
  const programs={gbuffer:program(gbuffer),temporal:program(temporal),atrous:program(atrous),compose:program(compose)};
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),gl.STATIC_DRAW);
  const texture=(width,height,values)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,values?new Float32Array(values):null);return {texture:t,width,height};};
  const pixel=(rgba)=>texture(1,1,rgba),framebuffer=gl.createFramebuffer();
  const integers=new Set(['uNodeCount','uPrimitiveCount','uTraversal','uAnyHit','uLogBudget','uMovingObject','uHasHistory','uHistoryEnabled','uView']);
  const draw=(program,samplers,uniforms,targets)=>{
   gl.useProgram(program);const attr=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,3,gl.FLOAT,false,0,0);
   gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);for(let attachment=0;attachment<4;attachment++)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+attachment,gl.TEXTURE_2D,null,0);
   targets.forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t.texture,0));gl.drawBuffers(targets.map((_,i)=>gl.COLOR_ATTACHMENT0+i));
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete float framebuffer');
   Object.entries(samplers).forEach(([name,t],unit)=>{if(targets.some(o=>o.texture===t.texture))throw Error('Feedback loop');gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t.texture);gl.uniform1i(gl.getUniformLocation(program,name),unit);});
   Object.entries(uniforms).forEach(([name,value])=>{const at=gl.getUniformLocation(program,name);if(typeof value==='number'){if(integers.has(name))gl.uniform1i(at,value);else gl.uniform1f(at,value);}else if(value.length===16)gl.uniformMatrix4fv(at,false,new Float32Array(value));else if(value.length===3)gl.uniform3fv(at,value);else if(value.length===2)gl.uniform2fv(at,value);});
   gl.viewport(0,0,targets[0].width,targets[0].height);gl.drawArrays(gl.TRIANGLES,0,3);const output=targets.map((target,i)=>{gl.readBuffer(gl.COLOR_ATTACHMENT0+i);const data=new Float32Array(target.width*target.height*4);gl.readPixels(0,0,target.width,target.height,gl.RGBA,gl.FLOAT,data);return Array.from(data);});
   const error=gl.getError();if(error)throw Error(`WebGL error ${error}`);return output;
  };
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],cases={};
  const runTemporal=(overrides={},uniformOverrides={})=>{
   const values={uCurrent:[1.1,1.1,1.1,1],uPosition:[0,0,-2,7],uNormal:[0,0,1,3],uPreviousPoint:[0,0,-2,1],uOldPosition:[0,0,-2,7],uOldNormal:[0,0,1,3],uOldAlbedo:[.5,.5,.5,2],uHistory:[1,1,1,8],uMoments:[1,1,0,1],...overrides};
   return draw(programs.temporal,Object.fromEntries(Object.entries(values).map(([k,v])=>[k,pixel(v)])),{uPreviousViewProjection:identity,uPreviousView:identity,uHasHistory:1,uHistoryEnabled:1,...uniformOverrides},[texture(1,1),texture(1,1)]);
  };
  cases.accepted=runTemporal();cases.sameMaterialDifferentObject=runTemporal({uOldPosition:[9,9,-9,8]});cases.depth=runTemporal({uOldAlbedo:[.5,.5,.5,5]});cases.normal=runTemporal({uOldNormal:[0,0,-1,3]});cases.offscreen=runTemporal({uPreviousPoint:[3,0,-2,1]});cases.ageCap=runTemporal({uHistory:[1,1,1,120]});cases.brightChange=runTemporal({uCurrent:[4,4,4,1],uHistory:[0,0,0,32],uMoments:[0,0,0,1]});cases.darkChange=runTemporal({uCurrent:[0,0,0,1],uHistory:[8,8,8,32],uMoments:[8,64,0,1]});cases.invalid=runTemporal({uCurrent:[1,1,1,0]});cases.disabled=runTemporal({}, {uHistoryEnabled:0});
  cases.translatedObject=runTemporal({uPosition:[.2,0,-2,7]});cases.unmappedTranslation=runTemporal({uPosition:[.2,0,-2,7],uPreviousPoint:[.2,0,-2,1]});
  cases.previousCameraDepth=runTemporal({uOldAlbedo:[.5,.5,.5,3]},{uPreviousView:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-1,1]});
  // Replay two identical deterministic 120-frame sequences using actual GPU moments.
  const sequence=()=>{let history=[1,1,1,1],moments=[1,1,0,0];for(let frame=1;frame<120;frame++){const value=frame%2?1.1:.9;[history,moments]=runTemporal({uCurrent:[value,value,value,1],uHistory:history,uMoments:moments});}return [history,moments];};
  cases.sequenceA=sequence();cases.sequenceB=sequence();
  const positions=texture(3,1,[-.001,0,-2,7,0,0,-2,8,.001,0,-2,8]),normals=texture(3,1,[0,0,1,3,0,0,1,3,0,0,1,3]),variance=texture(3,1,[1,101,100,1,1,101,100,1,1,101,100,1]);
  let filtered=texture(3,1,[10,10,10,8,1,1,1,8,1,1,1,8]);const scratch=[texture(3,1),texture(3,1)];
  for(let pass=0;pass<3;pass++){cases['atrous'+pass]=draw(programs.atrous,{uSource:filtered,uPosition:positions,uNormal:normals,uMoments:variance},{uResolution:[3,1],uStep:2**pass},[scratch[pass%2]]);filtered=scratch[pass%2];}
  const continuousPositions=texture(3,1,[-.001,0,-2,7,0,0,-2,7,.001,0,-2,7]);filtered=texture(3,1,[0,0,0,8,1,1,1,8,0,0,0,8]);
  for(let pass=0;pass<3;pass++){cases.smoothing=draw(programs.atrous,{uSource:filtered,uPosition:continuousPositions,uNormal:normals,uMoments:variance},{uResolution:[3,1],uStep:2**pass},[scratch[pass%2]]);filtered=scratch[pass%2];}
  const composition={uRaw:pixel([2,3,4,1]),uHistory:pixel([5,6,7,32]),uFiltered:pixel([8,9,10,32]),uDirect:pixel([.7,.8,.9,1]),uAlbedo:pixel([0,.1,.9,2]),uMoments:pixel([1,1.25,.25,1])};
  cases.composition=draw(programs.compose,composition,{uView:0},[texture(1,1)]);cases.rawView=draw(programs.compose,composition,{uView:1},[texture(1,1)]);cases.varianceView=draw(programs.compose,composition,{uView:4},[texture(1,1)]);
  const nodes=texture(2,1,[-1.3,-.45,-2.45,-1,1.3,.45,-1.55,2]),primitives=texture(6,2,[-.8,0,-2,1,0,0,0,.45,0,0,0,0,0,0,0,6,0,0,0,0,0,0,0,0,.8,0,-2,1,0,0,0,.45,0,0,0,0,0,0,0,7,1,0,0,0,0,0,0,0]),materials=texture(3,1,[.6,.6,.6,0,0,0,0,.3,0,0,0,0]);
  cases.gbuffer=draw(programs.gbuffer,{tNodes:nodes,tPrimitives:primitives,tMaterials:materials},{uNodeCount:1,uPrimitiveCount:2,uTraversal:1,uAnyHit:0,uLogBudget:0,uRayMin:1e-4,uRayMax:50,uInvProjection:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-1,1],uCameraWorld:identity,uViewMatrix:identity,uMovingObject:6,uPreviousOffset:[.1,0,0]},[texture(2,1),texture(2,1),texture(2,1),texture(2,1)]);
  return cases;
 },{gbuffer:query+'\n'+gbuffer,temporal,atrous,compose});
 const near=(a,b,e=1e-5)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);
 near(results.accepted[0][0],(8+1.1)/9);near(results.accepted[0][3],9);near(results.accepted[1][0],(8+1.1)/9);near(results.accepted[1][1],(8+1.21)/9);near(results.accepted[1][2],(8+1.21)/9-((8+1.1)/9)**2);
 for(const [name,reason] of [['sameMaterialDifferentObject',3],['depth',4],['normal',7],['offscreen',2],['disabled',8]]){near(results[name][0][0],1.1);assert.equal(results[name][0][3],1);assert.equal(results[name][1][3],reason);}
  near(results.ageCap[0][0],1+.1/32);assert.equal(results.ageCap[0][3],32);assert.equal(results.brightChange[1][3],5);assert.equal(results.darkChange[1][3],5);assert.ok(results.brightChange[0][0]>3.8);assert.ok(results.darkChange[0][0]<.2);assert.equal(results.invalid[0][3],0);
  assert.equal(results.translatedObject[1][3],1);assert.equal(results.previousCameraDepth[1][3],1);assert.equal(results.unmappedTranslation[1][3],4);
 assert.deepEqual(results.sequenceA,results.sequenceB);assert.equal(results.sequenceA[0][3],32);assert.ok(results.sequenceA[1][2]>0&&results.sequenceA[1][2]<.02);
  for(let pass=0;pass<3;pass++){near(results['atrous'+pass][0][0],10);near(results['atrous'+pass][0][4],1);near(results['atrous'+pass][0][8],1);}
  assert.ok(results.smoothing[0][0]>.1);assert.ok(results.smoothing[0][4]>.1&&results.smoothing[0][4]<.8);assert.ok(Math.abs(results.smoothing[0][4]-results.smoothing[0][0])<.2);
 near(results.composition[0][0],.7);near(results.composition[0][1],1.7);near(results.composition[0][2],9.9);assert.deepEqual(results.rawView[0],[2,3,4,1]);near(results.varianceView[0][0],.5);
 assert.equal(results.gbuffer[0][3],7);assert.equal(results.gbuffer[0][7],8);assert.equal(results.gbuffer[1][3],results.gbuffer[1][7]);near(results.gbuffer[3][0]-results.gbuffer[0][0],.1);near(results.gbuffer[3][4]-results.gbuffer[0][4],0);assert.ok(results.gbuffer[2][3]>0&&results.gbuffer[2][7]>0);
 for(const [name,arrays] of Object.entries(results))assert.ok(arrays.flat().every(Number.isFinite),`${name}: nonfinite GPU output`);
 console.log(JSON.stringify({cases:Object.keys(results).length,age:results.sequenceA[0][3],variance:results.sequenceA[1][2],brightChange:results.brightChange[0][0],darkChange:results.darkChange[0][0],composition:results.composition[0]}));
 console.log('PASS: object/depth/normal/reprojection rejection, moments, age cap, lighting response, 3 a-trous passes, deterministic 120-frame replay, independent B composition and motion G-buffer.');
}finally{await browser.close();}
