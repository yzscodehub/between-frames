// Standalone real-WebGL regression. Run with `node --import tsx scripts/verify-ray-effects.mjs`.
// It does not start a server or depend on the application UI.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import * as T from 'three';
import {createSnapshot} from '../src/lib/ray/scenes.ts';
import {buildBVH} from '../src/lib/ray/bvh.ts';
import {packScene} from '../src/lib/ray/pack.ts';
import {traceBrute,makeRay,offsetOrigin,dot,scale,add,sub,normalize,length} from '../src/lib/ray/geometry.ts';

const source=['query','lighting','effects'].map(name=>fs.readFileSync(new URL(`../src/shaders/ray/${name}.glsl`,import.meta.url),'utf8')).join('\n');
const transportSource=['ray/query','ray/lighting','pbr/brdf','ray/transport'].map(name=>fs.readFileSync(new URL(`../src/shaders/${name}.glsl`,import.meta.url),'utf8')).join('\n');
const snapshot=createSnapshot('room'),bvh=buildBVH(snapshot.primitives),packed=packScene(snapshot,bvh),width=96,height=60;
const camera=new T.PerspectiveCamera(45,width/height,.1,100);camera.position.set(0,2.3,8.8);camera.lookAt(0,2.1,0);camera.updateMatrixWorld();
const light=new T.PerspectiveCamera(100,1,.04,50);light.position.set(...snapshot.light.center);light.up.set(...snapshot.light.v).normalize();light.lookAt(new T.Vector3(...snapshot.light.center).add(new T.Vector3(...snapshot.light.normal)));light.updateMatrixWorld();
const matrices={uInvProjection:camera.projectionMatrixInverse.elements,uCameraWorld:camera.matrixWorld.elements,uEffectView:camera.matrixWorldInverse.elements,uEffectProjection:camera.projectionMatrix.elements,uLightInvProjection:light.projectionMatrixInverse.elements,uLightWorld:light.matrixWorld.elements,uLightView:light.matrixWorldInverse.elements,uLightProjection:light.projectionMatrix.elements};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();
 const result=await page.evaluate(({source,transportSource,packed,matrices,width,height})=>{
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('WebGL float targets unavailable');
  const compile=(kind,source)=>{const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
  const program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}'));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\n'+source));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const i=(name,value)=>gl.uniform1i(gl.getUniformLocation(program,name),value),f=(name,value)=>gl.uniform1f(gl.getUniformLocation(program,name),value),v2=(name,x,y)=>gl.uniform2f(gl.getUniformLocation(program,name),x,y);
  const tex=(w,h,data)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,data?new Float32Array(data):null);return t;};
  const nodes=tex(2,packed.nodeCount,packed.nodes),primitives=tex(6,packed.primitiveCount,packed.primitives),materials=tex(3,packed.materialCount,packed.materials),shadow=tex(256,256),position=tex(width,height),radiance=tex(width,height),output=tex(width,height),dummy=tex(1,1,[0,0,0,-1]);
  const bind=(unit,name,texture)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);i(name,unit);};
  bind(0,'tNodes',nodes);bind(1,'tPrimitives',primitives);bind(2,'tMaterials',materials);
  Object.entries(matrices).forEach(([name,elements])=>gl.uniformMatrix4fv(gl.getUniformLocation(program,name),false,new Float32Array(elements)));
  i('uNodeCount',packed.nodeCount);i('uPrimitiveCount',packed.primitiveCount);i('uTraversal',1);i('uAnyHit',0);i('uLogBudget',0);i('uEffectDebug',0);f('uRayMin',1e-4);f('uRayMax',50);f('uOffsetScale',1);f('uSceneScale',6);f('uSsrThickness',.08);f('uSsrMaxDistance',30);
  v2('uLightNearFar',.04,50);v2('uLightHalfSize',.8,.6);v2('uLightTanHalfFov',Math.tan(50*Math.PI/180),Math.tan(50*Math.PI/180));v2('uEffectResolution',width,height);v2('uShadowResolution',256,256);gl.uniform3f(gl.getUniformLocation(program,'uEnvironment'),0,0,0);
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),gl.STATIC_DRAW);const attribute=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  const draw=(mode,target,w=width,h=height)=>{
   bind(3,'tEffectShadow',target===shadow?dummy:shadow);bind(4,'tEffectPosition',target===position?dummy:position);bind(5,'tEffectRadiance',target===radiance?dummy:radiance);
   gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete framebuffer');
   i('uEffectPass',mode);gl.viewport(0,0,w,h);gl.drawArrays(gl.TRIANGLES,0,3);const data=new Float32Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,data);const error=gl.getError();if(error)throw Error(`WebGL error ${error} in pass ${mode}`);return Array.from(data);
  };
  const map=draw(0,shadow,256,256),positions=draw(1,position),local=draw(2,radiance),hard=draw(3,output),pcss=draw(4,output),ssr=draw(5,output),mirror=draw(6,output);i('uEffectDebug',1);const ssrDebug=draw(5,output);f('uSsrThickness',.003);const thinSsrDebug=draw(5,output);
  i('uEffectDebug',0);f('uSsrThickness',.08);i('uLocalModel',1);
  const flatLocal=draw(2,radiance),flatSsr=draw(5,output),flatMirror=draw(6,output);
  // Compile the actual RT reflection entry point as a second program. It
  // consumes the same packed scene, camera and material-color model while the
  // mirror baseline uses its independent reflected-camera construction.
  const rayProgram=gl.createProgram();
  gl.attachShader(rayProgram,compile(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}'));
  gl.attachShader(rayProgram,compile(gl.FRAGMENT_SHADER,'#version 300 es\n'+transportSource));gl.bindAttribLocation(rayProgram,attribute,'position');gl.linkProgram(rayProgram);
  if(!gl.getProgramParameter(rayProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(rayProgram));gl.useProgram(rayProgram);
  const rayLocation=name=>gl.getUniformLocation(rayProgram,name);
  for(const [name,value]of Object.entries({tNodes:0,tPrimitives:1,tMaterials:2,uNodeCount:packed.nodeCount,uPrimitiveCount:packed.primitiveCount,uTraversal:1,uAnyHit:0,uLogBudget:0,uDebug:0,uMode:2,uLocalModel:1,uMaxScattering:1,uEstimator:0,uSampling:1,uRR:0,uSeed:0,uSampleIndex:0}))gl.uniform1i(rayLocation(name),value);
  for(const [name,value]of Object.entries({uRayMin:1e-4,uRayMax:50,uOffsetScale:1,uSceneScale:6,uRoughness:.35}))gl.uniform1f(rayLocation(name),value);
  for(const name of ['uInvProjection','uCameraWorld'])gl.uniformMatrix4fv(rayLocation(name),false,new Float32Array(matrices[name]));
  gl.uniform2f(rayLocation('uResolution'),width,height);gl.uniform3f(rayLocation('uEnvironment'),0,0,0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,output,0);gl.viewport(0,0,width,height);gl.drawArrays(gl.TRIANGLES,0,3);
  const flatRayData=new Float32Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.FLOAT,flatRayData);if(gl.getError())throw Error('WebGL error in flat RT reflection');
  return {map,positions,local,hard,pcss,ssr,mirror,ssrDebug,thinSsrDebug,flatLocal,flatSsr,flatMirror,flatRay:Array.from(flatRayData)};
 },{source,transportSource,packed:{...packed,nodes:Array.from(packed.nodes),primitives:Array.from(packed.primitives),materials:Array.from(packed.materials)},matrices,width,height});
 const local=(h,d,flat=false)=>{const mat=snapshot.materials[h.materialId],front=dot(d,h.geometricNormal)<0,n=front?h.geometricNormal:scale(h.geometricNormal,-1),ld=new T.Vector3(-.55,.85,.65).normalize();return mat.albedo.map((a,i)=>(front?mat.emission[i]:0)+a*(flat?1:.18+.82*Math.max(0,dot(n,ld.toArray()))));};
 const visibility=(hit,point)=>{const direction=normalize(sub(point,hit.position)),origin=offsetOrigin(hit.position,hit.geometricNormal,direction,6),segment=sub(point,origin);return !traceBrute(makeRay(origin,segment,1e-4,length(segment)-2e-4),snapshot.primitives,true).hit;};
 let primaryHits=0,mirrorPixels=0,mirrorMaxError=0,positionMaxError=0,ssrHits=0,ssrMisses=0,thinSsrHits=0,softPixels=0,missingMap=0,litSpherePixels=0,hardAcne=0,softAcne=0,darkSpherePixels=0,retainedSelfShadow=0,flatLocalMaxError=0,flatMirrorMaxError=0,flatRayMirrorMaxError=0,flatChangedPixels=0,flatSsrChangedPixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=(y*width+x)*4,point=new T.Vector3((x+.5)/width*2-1,(y+.5)/height*2-1,0).applyMatrix4(camera.projectionMatrixInverse),direction=point.transformDirection(camera.matrixWorld).toArray(),ray=makeRay(camera.position.toArray(),direction,1e-4,50),primary=traceBrute(ray,snapshot.primitives).hit;
  if(!primary)continue;primaryHits++;for(let axis=0;axis<3;axis++)positionMaxError=Math.max(positionMaxError,Math.abs(primary.position[axis]-result.positions[index+axis]));
  const flatPrimary=local(primary,direction,true);
  for(let channel=0;channel<3;channel++){flatLocalMaxError=Math.max(flatLocalMaxError,Math.abs(result.flatLocal[index+channel]-flatPrimary[channel]));flatRayMirrorMaxError=Math.max(flatRayMirrorMaxError,Math.abs(result.flatRay[index+channel]-result.flatMirror[index+channel]));}
  if(result.flatLocal.slice(index,index+3).some((value,channel)=>Math.abs(value-result.local[index+channel])>.01))flatChangedPixels++;
  if(result.pcss[index+3]>0&&result.pcss[index]>.001&&result.pcss[index]<.999)softPixels++;
  if(result.pcss[index+3]===0)missingMap++;
  if(snapshot.primitives.find(p=>p.id===primary.primitiveId)?.kind==='sphere'&&result.pcss[index+3]>0){
   const facing=dot(primary.geometricNormal,normalize(sub(snapshot.light.center,primary.position))),visible=visibility(primary,snapshot.light.center);
   if(facing>.25&&visible){
    let allVisible=true;for(const u of [-1,0,1])for(const v of [-1,0,1])if(!visibility(primary,add(add(snapshot.light.center,scale(snapshot.light.u,u)),scale(snapshot.light.v,v))))allVisible=false;
    if(allVisible){litSpherePixels++;if(result.hard[index]<.5)hardAcne++;if(result.pcss[index]<.95)softAcne++;}
   }
   if(facing<-.25&&!visible){darkSpherePixels++;if(result.hard[index]<.5)retainedSelfShadow++;}
  }
  if(snapshot.materials[primary.materialId].kind!=='mirror')continue;mirrorPixels++;
  const d=new T.Vector3(...direction).reflect(new T.Vector3(...primary.shadingNormal)).toArray(),secondary=traceBrute(makeRay(offsetOrigin(primary.position,primary.geometricNormal,d,6),d,1e-4,50),snapshot.primitives).hit;
  const expected=secondary?local(secondary,d):[0,0,0],rho=snapshot.materials[primary.materialId].albedo;
  for(let channel=0;channel<3;channel++)mirrorMaxError=Math.max(mirrorMaxError,Math.abs(result.mirror[index+channel]-expected[channel]*rho[channel]));
  const flatExpected=secondary?local(secondary,d,true):[0,0,0];
  for(let channel=0;channel<3;channel++)flatMirrorMaxError=Math.max(flatMirrorMaxError,Math.abs(result.flatMirror[index+channel]-flatExpected[channel]*rho[channel]));
  if(result.ssrDebug[index+1]>.7&&result.ssrDebug[index]<.1&&result.flatSsr.slice(index,index+3).some((value,channel)=>Math.abs(value-result.ssr[index+channel])>.01))flatSsrChangedPixels++;
  if(result.ssrDebug[index+1]>.7&&result.ssrDebug[index]<.1)ssrHits++;else ssrMisses++;
  if(result.thinSsrDebug[index+1]>.7&&result.thinSsrDebug[index]<.1)thinSsrHits++;
 }
 assert.ok(primaryHits>100);assert.ok(mirrorPixels>50);assert.ok(positionMaxError<.002,`G-buffer positions ${positionMaxError}`);assert.ok(mirrorMaxError<.015,`Independent mirror camera/reference ${mirrorMaxError}`);assert.ok(softPixels>0,'PCSS never produced a penumbra');assert.ok(ssrHits>0,'SSR never found screen depth');assert.ok(ssrMisses>0,'SSR never exposed missing screen data');
 assert.ok(litSpherePixels>20);assert.ok(hardAcne/litSpherePixels<.02,`hard acne ${hardAcne}/${litSpherePixels}`);assert.ok(softAcne/litSpherePixels<.03,`PCSS acne ${softAcne}/${litSpherePixels}`);
 assert.ok(darkSpherePixels>10);assert.ok(retainedSelfShadow/darkSpherePixels>.95,'true same-object self-occlusion was removed');assert.ok(thinSsrHits>ssrHits*.6,'depth crossings were discarded before refinement');
 assert.ok(flatLocalMaxError<1e-5,'Flat G-buffer colors must equal albedo + directional emission');
 assert.ok(flatMirrorMaxError<1e-5,'Flat mirror colors must match independent CPU reflection with the same reflectance attenuation');
 assert.ok(flatRayMirrorMaxError<1e-5,'Flat RT and independent mirror-camera pixels must agree');
 assert.ok(flatChangedPixels>100&&flatSsrChangedPixels>10,'Switching models must update primary and SSR secondary colors');
 for(const [name,array] of Object.entries(result))assert.ok(array.every(Number.isFinite),`${name} has nonfinite data`);
 console.log(JSON.stringify({primaryHits,mirrorPixels,positionMaxError,mirrorMaxError,softPixels,missingMap,ssrHits,ssrMisses,thinSsrHits,litSpherePixels,hardAcne,softAcne,darkSpherePixels,retainedSelfShadow,flatLocalMaxError,flatMirrorMaxError,flatRayMirrorMaxError,flatChangedPixels,flatSsrChangedPixels}));console.log('PASS: shared GLSL compiles; light depth, PCSS, SSR, local shading, flat emission-color geometry, CPU mirror and RT/mirror-camera equivalence validated.');
}finally{await browser.close();}
