// Run: node scripts/verify-ray-query.mjs
// Isolated WebGL2 + RGBA32F readback; no application server is required.
// CHROME_PATH overrides Chromium, TEST_URL optionally supplies a page origin.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from '@playwright/test';
import {tsImport} from 'tsx/esm/api';
const root=new URL('../',import.meta.url);
const source=(await Promise.all(['query','trace'].map(name=>readFile(new URL(`src/shaders/ray/${name}.glsl`,root),'utf8')))).join('\n');
const report={startedAt:new Date().toISOString(),shaderSHA256:createHash('sha256').update(source).digest('hex'),passed:0,results:[]};
const [{createSnapshot},{buildBVH},{packScene},{traceBrute}]=await Promise.all([
 tsImport('../src/lib/ray/scenes.ts',import.meta.url),tsImport('../src/lib/ray/bvh.ts',import.meta.url),
 tsImport('../src/lib/ray/pack.ts',import.meta.url),tsImport('../src/lib/ray/geometry.ts',import.meta.url),
]);
const scatterSnapshot=createSnapshot('scatter',512,0),scatterData=packScene(scatterSnapshot,buildBVH(scatterSnapshot.primitives,'median'));
const scatter={...scatterData,nodes:[...scatterData.nodes],primitives:[...scatterData.primitives],materials:[...scatterData.materials]};
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();
 await page.goto(process.env.TEST_URL||'data:text/html,<meta charset=utf-8><title>Ray query GPU verification</title>');
 const results=await page.evaluate(({source,scatter})=>{
  const canvas=document.createElement('canvas');canvas.width=263;canvas.height=1;
  const gl=canvas.getContext('webgl2');if(!gl)throw Error('no WebGL2');
  if(!gl.getExtension('EXT_color_buffer_float'))throw Error('No float framebuffer');
  const compile=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();
  gl.attachShader(p,compile(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;\nin vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}'));
  gl.attachShader(p,compile(gl.FRAGMENT_SHADER,'#version 300 es\n'+source));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const i=(n,v)=>gl.uniform1i(gl.getUniformLocation(p,n),v),f=(n,v)=>gl.uniform1f(gl.getUniformLocation(p,n),v),v2=(n,x,y)=>gl.uniform2f(gl.getUniformLocation(p,n),x,y),v3=(n,x,y,z)=>gl.uniform3f(gl.getUniformLocation(p,n),x,y,z),m=(n,a)=>gl.uniformMatrix4fv(gl.getUniformLocation(p,n),false,new Float32Array(a));
  const texture=(unit,name,width,height,values)=>{const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,new Float32Array(values));i(name,unit);return t;};
  const nodes=[-1,-1,-2,1, 1,1,1,2, -1,-1,-1,-1, 1,1,1,1, -1,-1,-2,-2, 1,1,-2,1];
  const primitives=[0,0,0,1, 0,0,0,1, 0,0,0,0, 0,0,0,5, 7,0,0,0, 0,0,0,0, -1,-1,-2,0, 1,-1,-2,0, 0,1,-2,0, 0,0,0,6, 8,0,0,0, 0,0,0,0];
  texture(0,'tNodes',2,3,nodes);texture(1,'tPrimitives',6,2,primitives);texture(2,'tMaterials',3,1,[.5,.5,.5,0,0,0,0,.5,0,0,0,0]);
  const target=texture(3,'unused',263,1,new Float32Array(263*4));const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('framebuffer invalid');
  const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),gl.STATIC_DRAW);const attr=gl.getAttribLocation(p,'position');gl.enableVertexAttribArray(attr);gl.vertexAttribPointer(attr,3,gl.FLOAT,false,0,0);gl.viewport(0,0,263,1);
  m('uInvProjection',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,-1,1]);m('uCameraWorld',[1,0,0,0,0,1,0,0,0,0,1,0,0,0,3,1]);v2('uInspectUv',.5,.5);v2('uResolution',263,1);v3('uTestOrigin',0,0,0);
  i('uPrimitiveCount',2);i('uNodeCount',3);i('uTraversal',1);i('uAnyHit',0);i('uLogBudget',256);i('uDebug',1);i('uView',0);i('uOriginMode',0);f('uRayMin',.0001);f('uRayMax',50);f('uOffsetScale',1);f('uSceneScale',1);
  const draw=(name)=>{gl.drawArrays(gl.TRIANGLES,0,3);const values=new Float32Array(263*4);gl.readPixels(0,0,263,1,gl.RGBA,gl.FLOAT,values);const result={name,finite:Array.from(values).every(Number.isFinite),status:values[7],hit:Array.from(values.slice(0,4)),position:Array.from(values.slice(4,7)),normal:Array.from(values.slice(8,12)),barycentric:Array.from(values.slice(1048,1052)),counts:Array.from(values.slice(12,16)),ray:Array.from(values.slice(16,24)),events:Array.from(values.slice(24,40)),error:gl.getError()};return result;};
  const results=[];results.push(draw('bvh-front-sphere'));
  // Changing the diagnostic target width must not move the frozen ray or
  // alter ANY of the original 262 texels, including unused event slots.
  const extended=new Float32Array(263*4);gl.readPixels(0,0,263,1,gl.RGBA,gl.FLOAT,extended);
  gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,target);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,262,1,0,gl.RGBA,gl.FLOAT,null);gl.viewport(0,0,262,1);
  gl.drawArrays(gl.TRIANGLES,0,3);const legacy=new Float32Array(262*4);gl.readPixels(0,0,262,1,gl.RGBA,gl.FLOAT,legacy);
  results[0].legacyPrefixIdentical=legacy.every((value,index)=>value===extended[index]);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,263,1,0,gl.RGBA,gl.FLOAT,null);gl.viewport(0,0,263,1);
  i('uTraversal',0);results.push(draw('brute-front-sphere'));i('uTraversal',1);
  i('uOriginMode',2);results.push(draw('sphere-inside'));i('uOriginMode',0);
  f('uRayMax',1);results.push(draw('range-miss'));f('uRayMax',50);
  f('uRayMin',2.1);results.push(draw('sphere-back-root'));f('uRayMin',4.5);results.push(draw('triangle-barycentric'));f('uRayMin',.0001);
  i('uLogBudget',1);results.push(draw('truncated-log'));i('uLogBudget',256);
  i('uOriginMode',1);f('uOffsetScale',0);f('uRayMin',0);results.push(draw('surface-no-offset'));f('uOffsetScale',1);results.push(draw('surface-with-offset'));i('uOriginMode',0);f('uRayMin',.0001);
  i('uPrimitiveCount',2049);results.push(draw('explicit-overflow'));i('uPrimitiveCount',2);
  f('uRayMin',-1);results.push(draw('invalid-range'));f('uRayMin',.0001);
  i('uAnyHit',1);results.push(draw('any-hit'));
  // Regression: the old discriminant subtracts two large, nearly equal
  // quantities for this small distant sphere, producing an inaccurate normal.
  texture(0,'tNodes',2,scatter.nodeCount,scatter.nodes);texture(1,'tPrimitives',6,scatter.primitiveCount,scatter.primitives);texture(2,'tMaterials',3,scatter.materialCount,scatter.materials);
  i('uPrimitiveCount',scatter.primitiveCount);i('uNodeCount',scatter.nodeCount);i('uAnyHit',0);
  m('uCameraWorld',[1,0,0,0,0,1,0,0,0,0,1,0,6,4.5,8,1]);
  m('uInvProjection',[1,0,0,0,0,1,0,0,0,0,1,0,-.45976457,-.31981471,-.82845348,1]);
  const distant=draw('scatter-small-sphere');i('uTraversal',0);
  results.push({...distant,brute:draw('scatter-small-sphere-brute')});
  return results;
 },{source,scatter});
 report.results=results;
 const by=Object.fromEntries(results.map(result=>[result.name,result]));
 const check=(condition,message)=>assert.ok(condition,message);
 check(results.length===13,'Expected twelve original scenarios plus the distant-sphere regression');
 check(results.every(result=>result.finite&&result.error===0),'Readbacks must be finite with no WebGL errors');
 check(by['bvh-front-sphere'].legacyPrefixIdentical,'Columns 0..261 must exactly match the original debug target');
 check(by['bvh-front-sphere'].status===1&&Math.abs(by['bvh-front-sphere'].hit[0]-2)<1e-5,'Front sphere distance');
 assert.deepEqual(by['bvh-front-sphere'].hit.slice(1),[7,5,0],'Stable primitive/object/material IDs');
 assert.deepEqual(by['brute-front-sphere'].hit,by['bvh-front-sphere'].hit,'Brute and BVH closest results');
 assert.deepEqual(by['brute-front-sphere'].counts,[0,2,0,0],'Brute queries do not fabricate node events');
 assert.deepEqual(by['bvh-front-sphere'].events.filter((_value,index)=>index%4===0),[0,1,2,-1],'Actual BVH event IDs and empty-slot marker');
 check(by['sphere-inside'].status===1&&Math.abs(by['sphere-inside'].hit[0]-1)<1e-5&&by['sphere-inside'].normal[3]===0,'Inside sphere uses outward normal and back-face flag');
 check(by['range-miss'].status===0&&by['range-miss'].hit[0]===-1,'Finite tMax returns an ordinary miss');
 check(Math.abs(by['sphere-back-root'].hit[0]-4)<1e-5,'tMin skips the near root and accepts the far root');
 check(by['triangle-barycentric'].status===1&&by['triangle-barycentric'].hit[1]===8,'Triangle selected by ray interval');
 assert.deepEqual(by['triangle-barycentric'].barycentric,[.25,.25,.5,1],'Appended triangle barycentrics use (a,b,c) order');
 assert.deepEqual(by['bvh-front-sphere'].barycentric,[1,0,0,1],'Sphere barycentric sentinel');
 assert.deepEqual(by['range-miss'].barycentric,[0,0,0,0],'Miss barycentric texel');
 check(by['truncated-log'].counts[2]===1&&by['truncated-log'].counts[3]===1,'Event budget truncation must be explicit');
 assert.deepEqual(by['truncated-log'].hit,by['bvh-front-sphere'].hit,'Logging must not truncate closest-hit computation');
 assert.deepEqual(by['truncated-log'].counts.slice(0,2),by['bvh-front-sphere'].counts.slice(0,2),'Logging must not change actual traversal work');
 check(by['surface-no-offset'].status===1&&Math.abs(by['surface-no-offset'].hit[0])<1e-6,'Zero offset and inclusive tMin expose a surface self-intersection within Float32 precision');
 check(by['surface-with-offset'].status===0&&by['surface-with-offset'].ray[2]>1,'Scale-related offset leaves the sphere surface');
 check(by['explicit-overflow'].status===2,'Primitive budget exhaustion is overflow, never a miss');
 check(by['invalid-range'].status===3,'Invalid ray intervals are invalid, never a miss');
 check(by['any-hit'].status===1&&by['any-hit'].hit[1]===7,'Any-hit returns an actual accepted primitive');
 check(by['any-hit'].counts[0]<by['bvh-front-sphere'].counts[0],'Any-hit stops before the queued far node');
 const distant=by['scatter-small-sphere'],ray={origin:distant.ray.slice(0,3),direction:distant.ray.slice(4,7),tMin:distant.ray[3],tMax:distant.ray[7]};
 // Compare to the existing independent DOUBLE QUADRATIC oracle, using the
 // actual GPU-read ray rather than a separately normalized CPU approximation.
 const cpu=traceBrute(ray,scatterSnapshot.primitives).hit;
 check(cpu!==null&&cpu.primitiveId===468,'The regression must target scatter primitive 468');
 const distanceError=Math.abs(distant.hit[0]-cpu.t),normalError=Math.hypot(...cpu.geometricNormal.map((value,index)=>distant.normal[index]-value));
 Object.assign(distant,{cpu:{t:cpu.t,normal:cpu.geometricNormal,primitiveId:cpu.primitiveId},distanceError,normalError});
 check(distant.status===1&&distant.hit[1]===468,'BVH must preserve the small sphere hit');
 check(distanceError<2e-5,'Closest-approach sphere distance should agree within 2e-5 world units');
 check(normalError<.0002,'Small-sphere normal error must improve without relaxing the application threshold');
 check(distant.brute.status===1&&distant.brute.finite&&distant.brute.error===0,'The brute regression query must be valid');
 assert.deepEqual(distant.brute.hit,distant.hit,'BVH and brute must agree for the distant sphere');
 assert.deepEqual(distant.brute.normal,distant.normal,'Traversal must not change the stabilized normal');
 report.passed=results.length;
 for(const result of results)console.log('PASS',result.name);
 console.log('ALL 13 actual GPU query/readback scenarios passed; test-results/ray-query-results.json');
}catch(error){
 report.failure=String(error.stack||error);throw error;
}finally{
 report.finishedAt=new Date().toISOString();
 await mkdir(new URL('test-results/',root),{recursive:true});
 await writeFile(new URL('test-results/ray-query-results.json',root),JSON.stringify(report,null,2));
 await browser.close();
}
