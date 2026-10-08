// Standalone native raster + float readback: node --import tsx scripts/verify-ssr-gpu.mjs
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import * as T from 'three';
import {defaultSSRState} from '../src/lib/ssr/state.ts';
import {createSSRScene} from '../src/lib/ssr/scene.ts';
import {localColor} from '../src/lib/ssr/math.ts';
import {buildBVH} from '../src/lib/ray/bvh.ts';
import {packScene} from '../src/lib/ray/pack.ts';
import {traceBrute} from '../src/lib/ray/geometry.ts';
const state=defaultSSRState(),width=160,height=100;
const camera=new T.PerspectiveCamera(45,1.6,.1,50);camera.position.set(...state.camera.position);camera.lookAt(...state.camera.target);camera.updateMatrixWorld();
const source={mesh:await readFile(new URL('../src/shaders/ssr/mesh.vert.glsl',import.meta.url),'utf8'),gbuffer:await readFile(new URL('../src/shaders/ssr/gbuffer.frag.glsl',import.meta.url),'utf8'),resolve:(await readFile(new URL('../src/shaders/ray/query.glsl',import.meta.url),'utf8'))+'\n'+await readFile(new URL('../src/shaders/ssr/resolve.glsl',import.meta.url),'utf8')};
const scenes=['gallery','thin','hidden'].map(preset=>createSSRScene({...state,preset})),payload=scenes.map((world,i)=>{const p=packScene(world.snapshot,buildBVH(world.snapshot.primitives,'sah'));return {preset:['gallery','thin','hidden'][i],packed:{...p,nodes:Array.from(p.nodes),primitives:Array.from(p.primitives),materials:Array.from(p.materials)},meshes:world.meshes.map(m=>({positions:Array.from(m.geometry.getAttribute('position').array),indices:m.geometry.index?Array.from(m.geometry.index.array):null,model:m.matrixWorld.elements,color:m.material.color.toArray(),id:m.userData.objectId}))};});
const matrices={view:camera.matrixWorldInverse.elements,projection:camera.projectionMatrix.elements,world:camera.matrixWorld.elements};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{const page=await browser.newPage();const results=await page.evaluate(({source,payload,matrices,width,height,eye})=>{
 const gl=document.createElement('canvas').getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('No float WebGL2');
 const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,'#version 300 es\n'+source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
 const program=(v,f)=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,f));gl.bindAttribLocation(p,0,'position');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
 const mesh=program(source.mesh,source.gbuffer),resolve=program('precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}',source.resolve);
 const loc=(p,n)=>gl.getUniformLocation(p,n),matrix=(p,n,v)=>gl.uniformMatrix4fv(loc(p,n),false,new Float32Array(v));
 const tex=(w,h,data=null,depth=false)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,depth?gl.DEPTH_COMPONENT24:gl.RGBA32F,w,h,0,depth?gl.DEPTH_COMPONENT:gl.RGBA,depth?gl.UNSIGNED_INT:gl.FLOAT,data?new Float32Array(data):null);return t;};
 const framebuffer=(colors,depth)=>{const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);colors.forEach((t,i)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,t,0));if(depth)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depth,0);gl.drawBuffers(colors.map((_,i)=>gl.COLOR_ATTACHMENT0+i));if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Framebuffer incomplete');return f;};
 const position=tex(width,height),normal=tex(width,height),radiance=tex(width,height),depth=tex(width,height,null,true),gb=framebuffer([position,normal,radiance],depth),output=framebuffer([tex(width,height)]),debug=framebuffer([tex(522,1)]);
 const vao=(positions,indices)=>{const array=gl.createVertexArray();gl.bindVertexArray(array);const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);if(indices){const e=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,e);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(indices),gl.STATIC_DRAW);}return {array,count:indices?indices.length:positions.length/3,indexed:!!indices};};
 const quad=vao([-1,-1,0,3,-1,0,-1,3,0]);
 const set=(values)=>{gl.useProgram(resolve);for(const [name,value]of Object.entries(values)){if(Array.isArray(value)){if(value.length===2)gl.uniform2fv(loc(resolve,name),value);else gl.uniform3fv(loc(resolve,name),value);}else if(['uSteps','uMethod','uShading','uMode','uDebug','uNodeCount','uPrimitiveCount','uTraversal','uAnyHit','uLogBudget'].includes(name))gl.uniform1i(loc(resolve,name),value);else gl.uniform1f(loc(resolve,name),value);}};
 const bind=(unit,name,t)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.uniform1i(loc(resolve,name),unit);};
 const read=(w,h)=>{const out=new Float32Array(w*h*4);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,out);if(gl.getError())throw Error('WebGL read error');if(!out.every(Number.isFinite))throw Error('Nonfinite GPU data');return Array.from(out);};
 const draw=(mode)=>{set({uMode:mode,uDebug:0});gl.bindFramebuffer(gl.FRAMEBUFFER,output);gl.viewport(0,0,width,height);gl.bindVertexArray(quad.array);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,3);return read(width,height);};
 const inspect=(uv)=>{set({uDebug:1,uInspectUv:uv});gl.bindFramebuffer(gl.FRAMEBUFFER,debug);gl.viewport(0,0,522,1);gl.bindVertexArray(quad.array);gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.drawArrays(gl.TRIANGLES,0,3);return read(522,1);};
 const results=[];
 for(const scene of payload){
  gl.useProgram(mesh);gl.bindFramebuffer(gl.FRAMEBUFFER,gb);gl.viewport(0,0,width,height);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);matrix(mesh,'viewMatrix',matrices.view);matrix(mesh,'projectionMatrix',matrices.projection);gl.uniform3fv(loc(mesh,'uEye'),eye);gl.uniform1i(loc(mesh,'uShading'),0);
  for(const m of scene.meshes){const geometry=vao(m.positions,m.indices);matrix(mesh,'modelMatrix',m.model);gl.uniform3fv(loc(mesh,'uAlbedo'),m.color);gl.uniform1f(loc(mesh,'uObject'),m.id);gl.bindVertexArray(geometry.array);if(geometry.indexed)gl.drawElements(gl.TRIANGLES,geometry.count,gl.UNSIGNED_INT,0);else gl.drawArrays(gl.TRIANGLES,0,geometry.count);}
  const positions=read(width,height),p=scene.packed;
  const nodes=tex(2,p.nodeCount,p.nodes),primitives=tex(6,p.primitiveCount,p.primitives),materials=tex(3,p.materialCount,p.materials);
  gl.useProgram(resolve);matrix(resolve,'uViewMatrix',matrices.view);matrix(resolve,'uProjection',matrices.projection);matrix(resolve,'uCameraWorld',matrices.world);
  bind(0,'tPosition',position);bind(1,'tNormal',normal);bind(2,'tRadiance',radiance);bind(3,'tDepth',depth);bind(4,'tNodes',nodes);bind(5,'tPrimitives',primitives);bind(6,'tMaterials',materials);
  set({uNodeCount:p.nodeCount,uPrimitiveCount:p.primitiveCount,uTraversal:1,uAnyHit:0,uLogBudget:0,uResolution:[width,height],uNearFar:[.1,50],uEnvironment:[.035,.055,.08],uSteps:256,uStride:1,uViewStep:.25,uThickness:.08,uRange:24,uEpsilon:.001,uMethod:0,uShading:0});
  const screen=draw(0),reference=draw(1),status=draw(3),inspections=[],hitUvs=[];let mirror=0,hit=0,miss=0,different=0;
  for(let index=0;index<width*height;index++){if(positions[index*4+3]!==1)continue;mirror++;if(status[index*4+1]>.7&&status[index*4]<.2)hit++;else miss++;if(Math.abs(screen[index*4]-reference[index*4])+Math.abs(screen[index*4+1]-reference[index*4+1])+Math.abs(screen[index*4+2]-reference[index*4+2])>.1)different++;
   const uv=[(index%width+.5)/width,(Math.floor(index/width)+.5)/height];
   if(status[index*4+1]>.7&&status[index*4]<.2&&hit%45===0&&hitUvs.length<20){hitUvs.push(uv);inspections.push(inspect(uv));}
   else if(mirror%1800===0)inspections.push(inspect(uv));
  }
  const uv=[.5,.23];set({uMethod:1,uViewStep:1,uSteps:256,uThickness:.003});const largeStep=hitUvs.map(uv=>inspect(uv));set({uMethod:0,uSteps:8,uStride:1});const budget=inspect(uv);
  results.push({preset:scene.preset,mirror,hit,miss,different,inspections,largeStep,budget});
 }
 return results;
},{source,payload,matrices,width,height,eye:camera.position.toArray()});
 const report=[];
 let refinedOvershoots=0;
 for(let i=0;i<results.length;i++){const r=results[i],scene=scenes[i];assert.ok(r.mirror>500);assert.ok(r.hit>20);assert.ok(r.miss>20);assert.ok(r.different>10);let maxPosition=0,maxColor=0,maxPrimaryPixelError=0,checks=0,referenceHits=0;
  for(const data of r.inspections){
   const primaryDirection=new T.Vector3(data[36]*2-1,data[37]*2-1,0).applyMatrix4(camera.projectionMatrixInverse).transformDirection(camera.matrixWorld),primary=traceBrute({origin:camera.position.toArray(),direction:primaryDirection.toArray(),tMin:1e-4,tMax:50},scene.snapshot.primitives).hit;
   assert.ok(primary);assert.equal(primary.objectId,data[3]);
   // Native rasterization quantizes projected vertices to subpixel precision.
   // Validate the same mesh plane and <1/8-pixel reprojection, rather than
   // pretending the interpolated world position is an exact analytic camera ray.
   const projected=new T.Vector3(...data.slice(0,3)).project(camera),pixelError=Math.hypot((projected.x*.5+.5-data[36])*width,(projected.y*.5+.5-data[37])*height);maxPrimaryPixelError=Math.max(maxPrimaryPixelError,pixelError);assert.ok(pixelError<.125);
   assert.ok(Math.abs(primary.geometricNormal.reduce((sum,v,k)=>sum+v*(data[k]-primary.position[k]),0))<1e-4);assert.ok(primary.geometricNormal.reduce((sum,v,k)=>sum+v*data[4+k],0)>.97);
   const origin=data.slice(8,11),direction=data.slice(12,15),cpu=traceBrute({origin,direction,tMin:1e-4,tMax:24},scene.snapshot.primitives);assert.equal(data[31]===1,!!cpu.hit);if(cpu.hit){referenceHits++;assert.equal(data[27],cpu.hit.objectId);maxPosition=Math.max(maxPosition,Math.hypot(...cpu.hit.position.map((v,k)=>v-data[24+k])));}
   const c=cpu.hit?localColor(scene.snapshot.materials[cpu.hit.materialId].albedo,cpu.hit.geometricNormal,direction,'flat'):scene.snapshot.environment,weighted=c.map((v,k)=>v*scene.snapshot.materials[0].albedo[k]);maxColor=Math.max(maxColor,...weighted.map((v,k)=>Math.abs(v-data[28+k])));checks++;
   const steps=data[11];assert.ok(steps>=0&&steps<=256);for(let j=0;j<steps;j++){const at=(10+j*2)*4;if(data[at+6]===3)assert.ok(data[23]<=.08001);}
  }
  for(const data of r.largeStep)if(data[7]===1){assert.ok(data[23]<=.00301);for(let j=0;j<data[11];j++){const at=(10+j*2)*4;if(data[at+6]===3&&data[at+5]>.0031)refinedOvershoots++;}}
  assert.ok(checks>3&&referenceHits>3);assert.ok(maxPosition<.003);assert.ok(maxColor<.002);assert.equal(r.budget[7],6);report.push({preset:r.preset,mirror:r.mirror,screenHits:r.hit,screenMisses:r.miss,referenceDifferences:r.different,checks,referenceHits,maxPosition,maxColor,maxPrimaryPixelError,budgetStatus:r.budget[7]});console.log('PASS',JSON.stringify(report.at(-1)));
 }
 assert.ok(refinedOvershoots>0,'real GPU coarse crossings must be refined before thickness');console.log('PASS refined coarse overshoots',refinedOvershoots);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/ssr-gpu-results.json',JSON.stringify(report,null,2));console.log('ALL SSR native raster/reference checks passed');
}finally{scenes.forEach(scene=>scene.dispose());await browser.close();}
