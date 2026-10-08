// node scripts/verify-shadow-gpu.mjs — independent real rasterization, no server.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {tsImport} from 'tsx/esm/api';
import * as T from 'three';

const root=new URL('../',import.meta.url);
const [{createShadowScene},{defaultShadowState},math,geometry]=await Promise.all([
 tsImport('../src/lib/shadow/scene.ts',import.meta.url),tsImport('../src/lib/shadow/state.ts',import.meta.url),
 tsImport('../src/lib/shadow/math.ts',import.meta.url),tsImport('../src/lib/ray/geometry.ts',import.meta.url),
]);
const names=['mesh.vert','depth.frag','gbuffer.frag','resolve'];
const sources=Object.fromEntries(await Promise.all(names.map(async name=>[name,await readFile(new URL('src/shaders/shadow/'+name+'.glsl',root),'utf8')])));
const width=320,height=200,resolution=512;
const state={...defaultShadowState('filtering'),resolution};
const camera=new T.PerspectiveCamera(45,width/height,.1,50);camera.position.set(...state.camera.position);camera.lookAt(...state.camera.target);camera.updateMatrixWorld();
const light=new T.PerspectiveCamera(state.fov,1,.5,25);light.position.set(-3.5,7,4.5);light.lookAt(0,0,0);light.updateMatrixWorld();
const worlds=['contact','steps','layers'].map(preset=>createShadowScene({...state,preset}));
const scenePayload=worlds.map((world,index)=>{
 let minimum=Infinity;for(const primitive of world.primitives)for(const point of [primitive.a,primitive.b,primitive.c])minimum=Math.min(minimum,-new T.Vector3(...point).applyMatrix4(light.matrixWorldInverse).z);
 return {preset:['contact','steps','layers'][index],searchNear:Math.max(.5,minimum),meshes:world.meshes.map(mesh=>({
  positions:Array.from(mesh.geometry.getAttribute('position').array),indices:mesh.geometry.index?Array.from(mesh.geometry.index.array):null,
  model:mesh.matrixWorld.elements,albedo:mesh.material.color.toArray(),objectId:mesh.userData.objectId,
 }))};
});
const matrices={cameraView:camera.matrixWorldInverse.elements,cameraProjection:camera.projectionMatrix.elements,lightView:light.matrixWorldInverse.elements,lightProjection:light.projectionMatrix.elements,lightWorld:light.matrixWorld.elements,lightInverse:light.projectionMatrixInverse.elements};
const report={passed:0,results:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:960,height:600}});
 page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(process.env.TEST_URL||'data:text/html,<title>Raster shadow verification</title>');
 const results=await page.evaluate(({sources,scenePayload,matrices,width,height,resolution,state})=>{
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.style.cssText='width:960px;height:600px;image-rendering:auto;display:block';document.body.style.margin='0';document.body.append(canvas);
  const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});
  if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('WebGL2 float framebuffer is required');
  const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
  const compile=(type,source)=>{const shader=gl.createShader(type);gl.shaderSource(shader,'#version 300 es\n'+source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
  const program=(v,f)=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,v));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,f));gl.bindAttribLocation(p,0,'position');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
  const depthProgram=program(sources['mesh.vert'],sources['depth.frag']),geometryProgram=program(sources['mesh.vert'],sources['gbuffer.frag']),resolveProgram=program(vertex,sources.resolve);
  const displayProgram=program(vertex,'precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uSource;void main(){outColor=vec4(pow(max(texture(uSource,vUv).rgb,vec3(0.)),vec3(1./2.2)),1.);}');
  const loc=(p,n)=>gl.getUniformLocation(p,n);
  const matrix=(p,n,v)=>gl.uniformMatrix4fv(loc(p,n),false,new Float32Array(v));
  const texture=(w,h,depth=false,byte=false)=>{
   const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
   gl.texImage2D(gl.TEXTURE_2D,0,depth?gl.DEPTH_COMPONENT24:byte?gl.RGBA8:gl.RGBA32F,w,h,0,depth?gl.DEPTH_COMPONENT:gl.RGBA,depth?gl.UNSIGNED_INT:byte?gl.UNSIGNED_BYTE:gl.FLOAT,null);return t;
  };
  const framebuffer=(colors,depth=null)=>{
   const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);
   colors.forEach((t,index)=>gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+index,gl.TEXTURE_2D,t,0));
   if(depth)gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.TEXTURE_2D,depth,0);
   gl.drawBuffers(colors.map((_t,index)=>gl.COLOR_ATTACHMENT0+index));
   if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete raster framebuffer');return f;
  };
  const shadowDepth=texture(resolution,resolution,true),shadowColor=texture(resolution,resolution,false,true),shadowFramebuffer=framebuffer([shadowColor],shadowDepth);
  const position=texture(width,height),normal=texture(width,height),albedo=texture(width,height),mainDepth=texture(width,height,true),geometryFramebuffer=framebuffer([position,normal,albedo],mainDepth);
  const output=texture(width,height),outputFramebuffer=framebuffer([output]),debug=texture(332,1),debugFramebuffer=framebuffer([debug]);
  const vao=(positions,indices=null)=>{
   const array=gl.createVertexArray();gl.bindVertexArray(array);const vertices=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vertices);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(positions),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
   if(indices){const elements=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,elements);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint32Array(indices),gl.STATIC_DRAW);}
   return {array,count:indices?indices.length:positions.length/3,indexed:!!indices};
  };
  const quad=vao([-1,-1,0,3,-1,0,-1,3,0]);
  const bind=(p,unit,name,t)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.uniform1i(loc(p,name),unit);};
  const set=(values)=>{
   gl.useProgram(resolveProgram);
   const integer=new Set(['uAlgorithm','uView','uDebug','uPlaneCorrection']);
   for(const [name,value]of Object.entries(values))if(Array.isArray(value))gl.uniform2fv(loc(resolveProgram,name),value);else if(integer.has(name))gl.uniform1i(loc(resolveProgram,name),value);else gl.uniform1f(loc(resolveProgram,name),value);
  };
  const resolveSetup=()=>{
   gl.useProgram(resolveProgram);
   for(const [name,value]of Object.entries({uLightView:matrices.lightView,uLightProjection:matrices.lightProjection,uLightWorld:matrices.lightWorld,uLightInvProjection:matrices.lightInverse}))matrix(resolveProgram,name,value);
   bind(resolveProgram,0,'tPosition',position);bind(resolveProgram,1,'tNormal',normal);bind(resolveProgram,2,'tAlbedo',albedo);bind(resolveProgram,3,'tShadowDepth',shadowDepth);
   set({uNearFar:[.5,25],uTanHalfFov:Math.tan(state.fov*Math.PI/360),uBias:state.bias,uFilterRadius:state.filterRadius,uLightSize:state.lightSize,uPlaneCorrection:1,uAlgorithm:2,uView:1,uDebug:0,uInspectUv:[.5,.5]});
  };
  const read=(w,h)=>{const data=new Float32Array(w*h*4);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,data);if(gl.getError())throw Error('WebGL error during readback');if(!data.every(Number.isFinite))throw Error('Nonfinite shadow output');return data;};
  const draw=(algorithm,view=1)=>{set({uAlgorithm:algorithm,uView:view,uDebug:0});gl.disable(gl.DEPTH_TEST);gl.depthMask(false);gl.bindFramebuffer(gl.FRAMEBUFFER,outputFramebuffer);gl.viewport(0,0,width,height);gl.bindVertexArray(quad.array);gl.drawArrays(gl.TRIANGLES,0,3);return read(width,height);};
  const inspection=(uv,algorithm,planeCorrection=1)=>{
   set({uAlgorithm:algorithm,uDebug:1,uInspectUv:uv,uPlaneCorrection:planeCorrection});gl.bindFramebuffer(gl.FRAMEBUFFER,debugFramebuffer);gl.viewport(0,0,332,1);gl.bindVertexArray(quad.array);gl.drawArrays(gl.TRIANGLES,0,3);const data=read(332,1),samples=[];
   const count=Math.round(data[18]+data[19]);for(let index=0;index<count;index++){const at=(8+index*2)*4;samples.push({uv:Array.from(data.slice(at,at+2)),depth:data[at+2],receiver:data[at+3],visible:data[at+4],valid:data[at+5]>.5,blocker:data[at+6]>.5,stage:data[at+7]<.5?'search':'filter'});}
   set({uDebug:0,uPlaneCorrection:1});return {uv,algorithm,planeCorrection,header:Array.from(data.slice(0,28)),samples};
  };
  const maximumDifference=(a,b)=>a.reduce((maximum,value,index)=>Math.max(maximum,Math.abs(value-b[index])),0);
  const results=[];
  for(const scene of scenePayload){
   const meshes=scene.meshes.map(mesh=>({...mesh,...vao(mesh.positions,mesh.indices)}));
   const raster=(p,f,w,h,view,projection)=>{
    gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.viewport(0,0,w,h);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);gl.depthFunc(gl.LEQUAL);gl.disable(gl.CULL_FACE);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);gl.clearDepth(1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    matrix(p,'viewMatrix',view);matrix(p,'projectionMatrix',projection);
    for(const mesh of meshes){matrix(p,'modelMatrix',mesh.model);gl.uniform3fv(loc(p,'uAlbedo'),mesh.albedo);gl.uniform1f(loc(p,'uObjectId'),mesh.objectId);gl.bindVertexArray(mesh.array);if(mesh.indexed)gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_INT,0);else gl.drawArrays(gl.TRIANGLES,0,mesh.count);}
   };
   raster(depthProgram,shadowFramebuffer,resolution,resolution,matrices.lightView,matrices.lightProjection);
   raster(geometryProgram,geometryFramebuffer,width,height,matrices.cameraView,matrices.cameraProjection);
   const positions=read(width,height);
   resolveSetup();set({uSearchNear:scene.searchNear});
   const hard=draw(0),pcf=draw(1),pcss=draw(2);
   let surfaceCount=0,pcfSoft=0,pcssSoft=0,selected=-1;
   for(let offset=0;offset<positions.length;offset+=4){
    if(positions[offset+3]<=0)continue;surfaceCount++;
    if(Math.abs(pcf[offset]-pcf[offset+1])<1e-6&&pcf[offset]>.001&&pcf[offset]<.999)pcfSoft++;
    if(Math.abs(pcss[offset]-pcss[offset+1])<1e-6&&pcss[offset]>.001&&pcss[offset]<.999){pcssSoft++;if(selected<0&&positions[offset+3]===1)selected=offset/4;}
   }
   if(selected<0)for(let offset=0;offset<positions.length;offset+=4)if(positions[offset+3]===1&&Math.abs(hard[offset]-hard[offset+1])<1e-6){selected=offset/4;break;}
   if(selected<0)throw Error('No covered receiver in '+scene.preset);
   const uv=[((selected%width)+.5)/width,(Math.floor(selected/width)+.5)/height];
   const inspections=[inspection(uv,0),inspection(uv,1),inspection(uv,2),inspection(uv,0,0)];
   set({uLightSize:0});const zeroLight=draw(2);set({uLightSize:state.lightSize,uFilterRadius:0});const zeroRadius=draw(1);set({uFilterRadius:state.filterRadius});
   set({uLightSize:1.5});const wide=draw(2);let missing=null;
   // Prefer an incomplete FOOTPRINT whose center remains inside the map.
   for(let pixel=0;pixel<width*height&&!missing;pixel++){
    const at=pixel*4;if(positions[at+3]<=0||Math.abs(wide[at]-.95)>.001||Math.abs(wide[at+1]-.22)>.001)continue;
    const p=[positions[at],positions[at+1],positions[at+2],1],multiply=(matrix,p)=>[0,1,2,3].map(row=>matrix[row]*p[0]+matrix[4+row]*p[1]+matrix[8+row]*p[2]+matrix[12+row]*p[3]),clip=multiply(matrices.lightProjection,multiply(matrices.lightView,p));
    const u=clip[0]/clip[3]*.5+.5,v=clip[1]/clip[3]*.5+.5;if(clip[3]<=0||u<.001||u>.999||v<.001||v>.999)continue;
    const candidate=inspection([((pixel%width)+.5)/width,(Math.floor(pixel/width)+.5)/height],2);
    if(candidate.samples.some(sample=>!sample.valid))missing=candidate;
   }
   set({uLightSize:state.lightSize});draw(2,0);
   if(scene.preset==='contact'){
    gl.useProgram(displayProgram);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,width,height);bind(displayProgram,0,'uSource',output);gl.bindVertexArray(quad.array);gl.drawArrays(gl.TRIANGLES,0,3);
   }
   results.push({preset:scene.preset,surfaceCount,pcfSoft,pcssSoft,searchNear:scene.searchNear,zeroLightError:maximumDifference(hard,zeroLight),zeroRadiusError:maximumDifference(hard,zeroRadius),inspections,missing});
  }
  return results;
 },{sources,scenePayload,matrices,width,height,resolution,state});
 report.results=results;
 for(const [index,result]of results.entries()){
  const primitives=worlds[index].primitives;let mapError=0,normalError=0,positionError=0,comparisonError=0,thresholdError=0;
  assert.ok(result.surfaceCount>1000);assert.ok(result.pcfSoft>0);assert.ok(result.pcssSoft>0);
  assert.equal(result.zeroLightError,0,'Zero-area PCSS must reduce exactly to hard comparison');assert.equal(result.zeroRadiusError,0,'Zero-radius PCF must preserve hard comparison');
  for(const sample of result.inspections){
   const h=sample.header,position=h.slice(0,3),normal=h.slice(4,7),lightUv=h.slice(8,10);
   assert.equal(h[22],1);assert.equal(h[7],1,'Main numerical checks require a fully observed kernel');
   const point=new T.Vector3(sample.uv[0]*2-1,sample.uv[1]*2-1,0).applyMatrix4(camera.projectionMatrixInverse),direction=point.transformDirection(camera.matrixWorld).toArray();
   const primary=geometry.traceBrute(geometry.makeRay(camera.position.toArray(),direction,.1,50),primitives).hit;assert.ok(primary);assert.equal(primary.objectId,h[3]);
   positionError=Math.max(positionError,Math.hypot(...primary.position.map((v,i)=>v-position[i])));normalError=Math.max(normalError,Math.hypot(...primary.geometricNormal.map((v,i)=>v-normal[i])));
   const cpuMap=math.cpuShadowTexelDepth(primitives,lightUv,resolution,light.matrixWorld,light.projectionMatrixInverse);assert.ok(cpuMap);mapError=Math.max(mapError,Math.abs(cpuMap.depth-h[11]));
   const filters=sample.samples.filter(tap=>tap.stage==='filter'),average=filters.length?math.evaluatePcf(filters).visibility:h[15]===0?1:null;
   assert.notEqual(average,null);comparisonError=Math.max(comparisonError,Math.abs(average-h[14]));
   for(const tap of sample.samples){
    assert.ok(tap.valid);assert.ok(tap.uv.every(value=>Math.abs(value*resolution-.5-Math.round(value*resolution-.5))<1e-5),'Recorded UV is the actual nearest texel center');
    assert.equal(tap.visible,tap.receiver<=tap.depth?1:0,'Compare first, then average');
    const receiver=sample.planeCorrection?math.receiverPlaneDepth(tap.uv,position,normal,light.matrixWorld,light.projectionMatrixInverse):h[12];assert.ok(receiver);
    thresholdError=Math.max(thresholdError,Math.abs(math.perspectiveDepth(receiver-state.bias)-tap.receiver));
   }
   if(sample.algorithm===2&&h[15]>0){
    assert.equal(h[18],81);assert.equal(h[19],81);const blockers=sample.samples.filter(tap=>tap.stage==='search'&&tap.blocker);
    const mean=blockers.reduce((sum,tap)=>sum+math.linearDepth(tap.depth),0)/blockers.length;
    assert.ok(Math.abs(mean-h[16])<.0002,'Blockers are averaged in linear axial distance');
    assert.ok(Math.abs(math.penumbraUv(state.lightSize,h[12],mean,Math.tan(state.fov*Math.PI/360))*resolution-h[17])<.002,'World penumbra maps to the actual texel radius');
   }
  }
  assert.ok(positionError<.002&&normalError<.002);assert.ok(mapError<.00002,'Hardware depth must match independently intersected mesh triangles');assert.ok(comparisonError<1e-6&&thresholdError<.000005);
  assert.ok(result.missing,'A wide search must expose incomplete coverage');assert.equal(result.missing.header[7],0);assert.ok(result.missing.samples.some(tap=>!tap.valid));
  Object.assign(result,{positionError,normalError,mapError,comparisonError,thresholdError});
  report.passed++;console.log('PASS',JSON.stringify({preset:result.preset,triangles:primitives.length,pcfSoft:result.pcfSoft,pcssSoft:result.pcssSoft,positionError,normalError,mapError,comparisonError,thresholdError}));
 }
 await mkdir(new URL('test-results/',root),{recursive:true});
 await page.locator('canvas').screenshot({path:new URL('test-results/shadow-raster.png',root).pathname});
 assert.deepEqual(report.errors,[]);
 console.log('PASS: actual mesh depth rasterization, shared-triangle CPU oracle, hard/PCF/PCSS, footprint coverage and zero-size limits.');
}catch(error){report.failure=String(error.stack||error);throw error;}
finally{
 await mkdir(new URL('test-results/',root),{recursive:true});await writeFile(new URL('test-results/shadow-gpu-results.json',root),JSON.stringify(report,null,2));
 worlds.forEach(world=>world.dispose());await browser.close();
}
