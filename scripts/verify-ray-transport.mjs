// Run: node scripts/verify-ray-transport.mjs
// No server is needed. CHROME_PATH overrides Chromium; TEST_URL optionally
// supplies the page origin instead of the default isolated data URL.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '@playwright/test';
import {tsImport} from 'tsx/esm/api';

const root=new URL('../',import.meta.url);
const output=new URL('test-results/ray-transport-results.json',root);
const [{createSnapshot},{buildBVH},{packScene},...sources]=await Promise.all([
 tsImport('../src/lib/ray/scenes.ts',import.meta.url),
 tsImport('../src/lib/ray/bvh.ts',import.meta.url),
 tsImport('../src/lib/ray/pack.ts',import.meta.url),
 ...['ray/query','ray/lighting','pbr/brdf','ray/transport'].map(name=>readFile(new URL(`src/shaders/${name}.glsl`,root),'utf8')),
]);
const source=sources.join('\n');
const report={startedAt:new Date().toISOString(),shaderSHA256:createHash('sha256').update(source).digest('hex'),
 executionUrl:process.env.TEST_URL||'isolated data URL',samples:4096,cases:[],errors:[]};
const browser=await chromium.launch({
 executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),
 headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader'],
});
const page=await browser.newPage();
page.on('pageerror',error=>report.errors.push(error.message));

const vector=(value)=>[...value];
function packed(snapshot) {
 const packed=packScene(snapshot,buildBVH(snapshot.primitives,'sah'));
 return {...packed,nodes:vector(packed.nodes),primitives:vector(packed.primitives),materials:vector(packed.materials),light:snapshot.light};
}
function rectangleFixture({kind='lambert',rho=[.5,.5,.5],receiver=true,light=true,lightAlbedo=[1,1,1]}={}) {
 const primitives=[];
 const triangle=(a,b,c,materialId,id)=>primitives.push({kind:'triangle',a,b,c,radius:0,id,objectId:id,materialId,previousOffset:[0,0,0]});
 if(receiver) {
  triangle([-10,-10,0],[10,-10,0],[10,10,0],0,0);
  triangle([-10,-10,0],[10,10,0],[-10,10,0],0,1);
 }
 if(light) {
  // Winding points down (-z), exactly matching the sampled light normal.
  triangle([-2,-2,2],[-2,2,2],[2,2,2],1,2);
  triangle([-2,-2,2],[2,2,2],[2,-2,2],1,3);
 }
 return packed({version:1,frame:0,primitives,environment:[0,0,0],
  materials:[{albedo:rho,emission:[0,0,0],kind,roughness:.4},{albedo:lightAlbedo,emission:[3,4,5],kind:'lambert',roughness:.4}],
  light:{center:[0,0,2],u:[2,0,0],v:[0,2,0],normal:[0,0,-1],emission:light?[3,4,5]:[0,0,0]},
 });
}
function record(name,metrics,validate) {
 const entry={name,...metrics,passed:false}; report.cases.push(entry);
 validate(); entry.passed=true; console.log(`PASS ${name}`);
}
function finiteImage(result) {
 assert.equal(result.invalid,0,'Every image sample must have valid alpha');
 assert.equal(result.nonfinite,0,'Every component must be finite');
 assert.equal(result.glError,0,'No WebGL error');
 assert.ok(result.min.every(value=>value>=0),'Radiance must be nonnegative');
}
function close(actual,expected,tolerance,message) {
 actual.forEach((value,index)=>assert.ok(Math.abs(value-expected[index])<=tolerance,`${message}: ${actual} vs ${expected}`));
}
// Independent double-precision area integration; this never calls the shader's
// sample/PDF/BSDF routines. Receiver is at the origin, normal +z, light z=2.
function rectangleLambertIntegral(resolution=256) {
 let factor=0;
 for(let x=0;x<resolution;x++)for(let y=0;y<resolution;y++) {
  const px=-2+(x+.5)*4/resolution,py=-2+(y+.5)*4/resolution,r2=px*px+py*py+4;
  factor+=4/(r2*r2)*16/(resolution*resolution*Math.PI);
 }
 return [1.5*factor,2*factor,2.5*factor];
}
// Independent CPU implementation of the documented uint32 counter RNG.
function random(pixel,sample,bounce,dimension,seed=7) {
 const hash=(input)=>{let x=input>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);return (x^(x>>>16))>>>0;};
 let h=hash(seed^0xa511e9b3);
 for(const value of [pixel[0],Math.imul(pixel[1],0x9e3779b9),Math.imul(sample,0x85ebca6b),Math.imul(bounce,0xc2b2ae35),Math.imul(dimension,0x27d4eb2f)])h=hash(h^value);
 return (h>>>8)/16777216;
}

try {
 await page.goto(process.env.TEST_URL||'data:text/html,<meta charset=utf-8><title>Ray transport GPU verification</title>');
 report.gpu=await page.evaluate((source)=>{
  const canvas=document.createElement('canvas');
  const gl=canvas.getContext('webgl2');
  if(!gl)throw Error('WebGL2 is unavailable');
  if(!gl.getExtension('EXT_color_buffer_float'))throw Error('RGBA32F render targets are unavailable');
  const logs=[];
  const compile=(type,text)=>{const shader=gl.createShader(type);gl.shaderSource(shader,text);gl.compileShader(shader);const log=gl.getShaderInfoLog(shader);if(log)logs.push(log);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(log);return shader;};
  const program=gl.createProgram();
  const vertex=compile(gl.VERTEX_SHADER,'#version 300 es\nprecision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}');
  gl.attachShader(program,vertex);
  gl.attachShader(program,compile(gl.FRAGMENT_SHADER,'#version 300 es\n'+source));gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const integerNames=new Set(['uNodeCount','uPrimitiveCount','uTraversal','uAnyHit','uLogBudget','uDebug','uMode','uSampleIndex','uSeed','uMaxScattering','uEstimator','uSampling','uRR']);
  const locations=new Map();
  const location=(name)=>{if(!locations.has(name))locations.set(name,gl.getUniformLocation(program,name));return locations.get(name);};
  const set=(values)=>{for(const [name,value]of Object.entries(values)){const at=location(name);if(Array.isArray(value)){if(value.length===16)gl.uniformMatrix4fv(at,false,value);else if(value.length===3)gl.uniform3fv(at,value);else gl.uniform2fv(at,value);}else if(integerNames.has(name))gl.uniform1i(at,value);else gl.uniform1f(at,value);}};
  const textures=[];
  const texture=(unit,name,width,height,values)=>{
   if(textures[unit])gl.deleteTexture(textures[unit]);
   const item=gl.createTexture();textures[unit]=item;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,item);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,values?new Float32Array(values):null);
   if(name)gl.uniform1i(location(name),unit);return item;
  };
  const framebuffer=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
  const resize=(width,height)=>{const target=texture(3,null,width,height,null);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,target,0);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete float framebuffer');gl.viewport(0,0,width,height);};
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),gl.STATIC_DRAW);
  const attribute=gl.getAttribLocation(program,'position');gl.enableVertexAttribArray(attribute);gl.vertexAttribPointer(attribute,3,gl.FLOAT,false,0,0);
  const upload=(scene)=>{
   texture(0,'tNodes',2,Math.max(scene.nodeCount,1),scene.nodes);texture(1,'tPrimitives',6,Math.max(scene.primitiveCount,1),scene.primitives);texture(2,'tMaterials',3,Math.max(scene.materialCount,1),scene.materials);
   set({uNodeCount:scene.nodeCount,uPrimitiveCount:scene.primitiveCount,uLightCenter:scene.light.center,uLightU:scene.light.u,uLightV:scene.light.v,uLightNormal:scene.light.normal,uLightEmission:scene.light.emission});
  };
  const camera=(origin,direction)=>{
   const normalize=(v)=>{const length=Math.hypot(...v);return v.map(x=>x/length);};
   const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
   const forward=normalize(direction),right=normalize(cross(forward,Math.abs(forward[1])>.99?[1,0,0]:[0,1,0]));
   const backward=forward.map(x=>-x),up=cross(backward,right);
   // Freeze the primary ray across the image; pixels supply independent RNG
   // counters, giving 4096 samples of one integral without 4096 readback calls.
   set({uInvProjection:[0,0,0,0,0,0,0,0,0,0,1,0,0,0,-1,1],uCameraWorld:[...right,0,...up,0,...backward,0,...origin,1]});
  };
  const images=new Map();
  const image=(name,samples=4096)=>{
   set({uDebug:0,uResolution:[samples,1]});resize(samples,1);gl.drawArrays(gl.TRIANGLES,0,3);
   const data=new Float32Array(samples*4);gl.readPixels(0,0,samples,1,gl.RGBA,gl.FLOAT,data);images.set(name,data);
   const mean=[0,0,0],variance=[0,0,0],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let invalid=0,nonfinite=0;
   for(let p=0;p<samples;p++){if(data[p*4+3]!==1)invalid++;for(let c=0;c<4;c++)if(!Number.isFinite(data[p*4+c]))nonfinite++;for(let c=0;c<3;c++){const value=data[p*4+c];mean[c]+=value/samples;min[c]=Math.min(min[c],value);max[c]=Math.max(max[c],value);}}
   for(let p=0;p<samples;p++)for(let c=0;c<3;c++)variance[c]+=(data[p*4+c]-mean[c])**2/Math.max(1,samples-1);
   return {samples,mean,standardError:variance.map(v=>Math.sqrt(v/samples)),min,max,invalid,nonfinite,glError:gl.getError(),selected:Array.from(data.slice(Math.floor(samples/2)*4,Math.floor(samples/2)*4+3))};
  };
  const debug=()=>{
   set({uDebug:1,uResolution:[4096,1],uInspectUv:[.5,.5]});resize(8,9);gl.drawArrays(gl.TRIANGLES,0,3);
   const data=new Float32Array(8*9*4);gl.readPixels(0,0,8,9,gl.RGBA,gl.FLOAT,data);
   return {header:Array.from(data.slice(0,16)),events:Array.from({length:8},(_,i)=>Array.from(data.slice((i+1)*32,(i+2)*32))),nonfinite:Array.from(data).filter(v=>!Number.isFinite(v)).length,glError:gl.getError()};
  };
  const compare=(a,b)=>{const x=images.get(a),y=images.get(b);if(x.length!==y.length)return Infinity;let error=0;for(let i=0;i<x.length;i++)error=Math.max(error,Math.abs(x[i]-y[i]));return error;};
  let rngProgram=null;
  const rng=(sample)=>{
   if(!rngProgram) {
    // Compile the ACTUAL shader RNG functions into a tiny readback entry point,
    // isolating exact uint arithmetic from approximate sqrt/sin/normalization.
    const functions=source.slice(source.indexOf('uint ptHash('),source.indexOf('PTEvent ptEmptyEvent('));
    rngProgram=gl.createProgram();gl.attachShader(rngProgram,vertex);
    gl.attachShader(rngProgram,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;precision highp int;uniform int uSeed,uSampleIndex;out vec4 outColor;\n'+functions+'\nvoid main(){outColor=vec4(ptRandom(ivec2(2048,0),0,2),ptRandom(ivec2(2048,0),2,4),ptRandom(ivec2(17,23),5,0),ptRandom(ivec2(4095,0),7,3));}'));
    gl.bindAttribLocation(rngProgram,attribute,'position');gl.linkProgram(rngProgram);
    if(!gl.getProgramParameter(rngProgram,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(rngProgram));
   }
   gl.useProgram(rngProgram);gl.uniform1i(gl.getUniformLocation(rngProgram,'uSeed'),7);gl.uniform1i(gl.getUniformLocation(rngProgram,'uSampleIndex'),sample);
   resize(1,1);gl.drawArrays(gl.TRIANGLES,0,3);const values=new Float32Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.FLOAT,values);
   gl.useProgram(program);return {values:Array.from(values),glError:gl.getError()};
  };
  set({uTraversal:1,uAnyHit:0,uLogBudget:0,uRayMin:.0001,uRayMax:50,uOffsetScale:1,uSceneScale:1,uSampleIndex:0,uSeed:7,uMode:0,uMaxScattering:1,uEstimator:0,uSampling:1,uRR:0,uRoughness:.4,uEnvironment:[0,0,0],uInspectUv:[.5,.5]});
  window.__transport={set,upload,camera,image,debug,compare,rng};
  return {renderer:gl.getParameter(gl.RENDERER),vendor:gl.getParameter(gl.VENDOR),version:gl.getParameter(gl.VERSION),compileLogs:logs};
 },source);
 const set=(values)=>page.evaluate(v=>window.__transport.set(v),values);
 const upload=(scene)=>page.evaluate(v=>window.__transport.upload(v),scene);
 const camera=(origin,direction)=>page.evaluate(v=>window.__transport.camera(...v),[origin,direction]);
 const image=(name,samples=4096)=>page.evaluate(v=>window.__transport.image(...v),[name,samples]);
 const debug=()=>page.evaluate(()=>window.__transport.debug());
 const compare=(a,b)=>page.evaluate(v=>window.__transport.compare(...v),[a,b]);

 await upload(rectangleFixture());await camera([0,0,1],[0,0,-1]);
 for(let mode=0;mode<=4;mode++) {
  await set({uMode:mode,uEstimator:2});const result=await debug();
  record(`mode-${mode}-finite-debug`,result,()=>{assert.equal(result.header[3],0);assert.equal(result.nonfinite,0);assert.equal(result.glError,0);assert.equal(result.header[15],mode);});
 }

 await upload(rectangleFixture({light:false,rho:[.5,.25,.75]}));
 await set({uMode:0,uEstimator:0,uMaxScattering:1,uEnvironment:[.4,.6,.8]});
 const environment=await image('constant-environment');
 record('constant-environment-Lambert',{...environment,expected:[.2,.15,.6]},()=>{finiteImage(environment);close(environment.min,[.2,.15,.6],2e-6,'Cosine throughput');close(environment.max,[.2,.15,.6],2e-6,'Cosine throughput');});

 await upload(rectangleFixture());await set({uEnvironment:[0,0,0]});
 const expected=rectangleLambertIntegral(),refined=rectangleLambertIntegral(512);
 close(expected,refined,1e-5,'Independent numerical integral refinement');
 for(let estimator=0;estimator<3;estimator++) {
  await set({uEstimator:estimator});const result=await image(`estimator-${estimator}`);
  const relativeErrors=result.mean.map((v,i)=>v/expected[i]-1);
  record(['BSDF','NEE','MIS'][estimator]+'-area-integral',{...result,expected,relativeErrors,relativeTolerance:.025},()=>{finiteImage(result);assert.ok(relativeErrors.every(v=>Math.abs(v)<.025));});
 }
 await set({uMode:4});const direct=await image('direct16');
 record('direct16-area-integral',{...direct,expected},()=>{finiteImage(direct);assert.ok(direct.mean.every((v,i)=>Math.abs(v/expected[i]-1)<.01));});
 for(const [name,mode,depth]of [['depth0-no-direct',0,0],['B-depth1-zero',3,1],['B-direct-excluded',3,2]]) {
  await set({uMode:mode,uMaxScattering:depth});const result=await image(name);
  record(name,result,()=>{finiteImage(result);close(result.max,[0,0,0],0,name);});
 }

 await upload(rectangleFixture({kind:'mirror'}));await set({uMode:0,uMaxScattering:1});
 for(let estimator=0;estimator<3;estimator++) {
  await set({uEstimator:estimator});const result=await image(`delta-${estimator}`);
  record(`delta-emitter-depth1-estimator-${estimator}`,{...result,expected:[1.5,2,2.5]},()=>{finiteImage(result);close(result.min,[1.5,2,2.5],1e-5,'Delta endpoint');close(result.max,[1.5,2,2.5],1e-5,'Delta endpoint');});
 }
 await upload(rectangleFixture({kind:'ggx'}));await set({uEstimator:2});const ggx=await image('ggx');
 record('GGX-NDF-MIS-finite',ggx,()=>{finiteImage(ggx);assert.ok(ggx.mean[0]>0&&ggx.mean[0]<3);});

 // Albedo zero isolates directional Le even in the R4 local shade model.
 await upload(rectangleFixture({receiver:false,lightAlbedo:[0,0,0]}));
 for(const mode of [0,2,4])for(const front of [true,false]) {
  await set({uMode:mode,uMaxScattering:0});await camera(front?[0,0,1]:[0,0,3],front?[0,0,1]:[0,0,-1]);
  const result=await image(`emission-${mode}-${front}`,64),expected=front?[3,4,5]:[0,0,0];
  record(`mode-${mode}-emitter-${front?'front':'back'}`,{...result,expected},()=>{finiteImage(result);close(result.min,expected,1e-6,'One-sided emission');close(result.max,expected,1e-6,'One-sided emission');});
 }

 const room=createSnapshot('room',14,0);
 room.materials=room.materials.map(material=>({...material,kind:'lambert'}));
 room.materials[4].albedo=[.7,.7,.7];
 await upload(packed(room));await camera([0,1,2],[0,-1,-2]);
 await set({uMode:3,uMaxScattering:2,uEstimator:1,uRR:0});
 const colored=await image('B-rho07',1024);room.materials[4].albedo=[0,0,0];await upload(packed(room));
 const black=await image('B-rho0',1024),demodError=await compare('B-rho07','B-rho0');
 record('indirect-B-zero-rho-invariance',{colored,black,maxDifference:demodError},()=>{finiteImage(colored);finiteImage(black);assert.ok(colored.mean[0]>0);assert.equal(demodError,0);});
 await set({uMaxScattering:1});const bDepth1=await image('room-B-depth1',1024);
 record('room-B-depth1-zero',bDepth1,()=>{finiteImage(bDepth1);close(bDepth1.max,[0,0,0],0,'One scatter excludes indirect');});
 room.materials[4].albedo=[.7,.7,.7];await upload(packed(room));await set({uMode:0,uMaxScattering:3,uRR:0});
 const noRR=await image('depth3-noRR',1024);await set({uRR:1});const rr=await image('depth3-RR',1024),rrError=await compare('depth3-noRR','depth3-RR');
 record('RR-no-remaining-scattering',{withoutRR:noRR,withRR:rr,maxDifference:rrError},()=>{finiteImage(noRR);finiteImage(rr);assert.equal(rrError,0);});

 await set({uMaxScattering:6});let terminated=null,survived=null;
 for(let sample=0;sample<64&&(!terminated||!survived);sample++) {
  await set({uSampleIndex:sample});const result=await debug();
  if(result.header[11]===4)terminated={sample,scattering:result.header[10]};
  if(result.header[13]>=4&&result.events[2][23]===0) {
   const before=result.events[2],after=result.events[3],rho=room.materials[before[19]].albedo;
   const weighted=before.slice(16,19).map((v,i)=>v*rho[i]),probability=Math.max(.05,Math.min(.95,Math.max(...weighted)));
   const expectedBeta=weighted.map(v=>v/probability),actualBeta=after.slice(16,19);
   close(actualBeta,expectedBeta,2e-5,'Roulette surviving beta includes 1/p');
   assert.ok(random([2048,0],sample,2,4)<probability,'CPU RNG predicts roulette survival');
   survived={sample,probability,actualBeta,expectedBeta};
  }
 }
 record('RR-termination-and-survival-weight',{terminated,survived},()=>{assert.ok(terminated&&terminated.scattering>=3&&terminated.scattering<6);assert.ok(survived);});

 await set({uSampleIndex:0,uRR:0,uMaxScattering:8});
 const rngDiagnostic=await page.evaluate(()=>window.__transport.rng(11));
 const expectedRandom=[random([2048,0],11,0,2),random([2048,0],11,2,4),random([17,23],11,5,0),random([4095,0],11,7,3)];
 record('counter-RNG-independent-CPU-oracle',{...rngDiagnostic,expected:expectedRandom},()=>{assert.equal(rngDiagnostic.glError,0);assert.deepEqual(rngDiagnostic.values,expectedRandom);});
 let lastEndpoint=null;
 for(let sample=0;sample<64&&!lastEndpoint;sample++) {
  await set({uSampleIndex:sample});const result=await debug();
  if(result.header[13]===9) {
   const rendered=await image('ninth-endpoint');
   close(rendered.selected,result.header.slice(0,3),2e-5,'Debug logging must not truncate transport');
   lastEndpoint={sample,header:result.header,selectedRadiance:rendered.selected};
  }
 }
 record('eight-scatter-ninth-query-log-truncation',{endpoint:lastEndpoint},()=>{assert.ok(lastEndpoint);assert.equal(lastEndpoint.header[10],8);assert.equal(lastEndpoint.header[14],1);});
 assert.deepEqual(report.errors,[]);
} catch(error) {
 report.failure=String(error.stack||error);throw error;
} finally {
 report.passed=report.cases.filter(result=>result.passed).length;report.finishedAt=new Date().toISOString();
 await mkdir(new URL('test-results/',root),{recursive:true});
 await writeFile(output,JSON.stringify(report,null,2));
 await browser.close();
 console.log(`${report.passed}/${report.cases.length} transport checks passed; ${fileURLToPath(output)}`);
}
