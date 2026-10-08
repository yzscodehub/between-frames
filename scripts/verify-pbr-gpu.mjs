// node scripts/verify-pbr-gpu.mjs — real GLSL, independent CPU math, no server.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {tsImport} from 'tsx/esm/api';
import * as T from 'three';
const root=new URL('../',import.meta.url);
const [{evaluateBrdf,colorToLinear},shared,scene]=await Promise.all([tsImport('../src/lib/pbr/brdf.ts',import.meta.url),readFile(new URL('src/shaders/pbr/brdf.glsl',root),'utf8'),readFile(new URL('src/shaders/pbr/scene.glsl',root),'utf8')]);
const camera=new T.PerspectiveCamera(42,1.6,.1,50);camera.position.set(3.6,2.5,6.5);camera.lookAt(0,.65,0);camera.updateMatrixWorld();
const report={passed:[],errors:[]};
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':undefined),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:800,height:500}});
 await page.goto('data:text/html,<title>PBR GPU verification</title>');
 const result=await page.evaluate(({shared,scene,projection,world,base})=>{
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=250;canvas.style.cssText='width:800px;height:500px;display:block';document.body.style.margin='0';document.body.append(canvas);
  const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('WebGL2 float render target unavailable');
  const vertex='#version 300 es\nprecision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
  const compile=(kind,source)=>{const shader=gl.createShader(kind);gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));return shader;};
  const program=fragment=>{const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;precision highp int;\n'+fragment));gl.bindAttribLocation(p,0,'position');gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));return p;};
  const sceneProgram=program(shared+'\n'+scene);
  const functionProgram=program(shared+'\nuniform float uR,uCos;uniform vec3 uF0;out vec4 outColor;void main(){float a=uR*uR;int col=int(gl_FragCoord.x);if(col==0)outColor=vec4(pbrGgxD(1.,a),pbrSmithG1(uCos,a),pbrSmithG1(uCos,a),a);else outColor=vec4(pbrSchlick(uF0,uCos),1.);}');
  const displayProgram=program('in vec2 vUv;uniform sampler2D uImage;out vec4 outColor;void main(){vec3 v=texture(uImage,vUv).rgb;v=v/(1.+v);outColor=vec4(pow(max(v,vec3(0.)),vec3(1./2.2)),1.);}');
  const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  const image=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,image);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
  const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,image,0);
  const size=(w,h)=>{gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.bindTexture(gl.TEXTURE_2D,image);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,null);gl.viewport(0,0,w,h);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete framebuffer');};
  const read=(w,h)=>{gl.drawArrays(gl.TRIANGLES,0,3);const values=new Float32Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.FLOAT,values);if(gl.getError())throw Error('WebGL error');if(!values.every(Number.isFinite))throw Error('Nonfinite GPU output');return Array.from(values);};
  const functions=[];gl.useProgram(functionProgram);size(2,1);
  for(const roughness of [.03,.05,.35,1])for(const cosine of [.03,.2,1]){
   gl.uniform1f(gl.getUniformLocation(functionProgram,'uR'),roughness);gl.uniform1f(gl.getUniformLocation(functionProgram,'uCos'),cosine);gl.uniform3f(gl.getUniformLocation(functionProgram,'uF0'),.04,.3,.8);
   functions.push({roughness,cosine,values:read(2,1)});
  }
  gl.useProgram(sceneProgram);
  const loc=name=>gl.getUniformLocation(sceneProgram,name),i=(n,v)=>gl.uniform1i(loc(n),v),f=(n,v)=>gl.uniform1f(loc(n),v);
  gl.uniformMatrix4fv(loc('uInvProjection'),false,new Float32Array(projection));gl.uniformMatrix4fv(loc('uCameraWorld'),false,new Float32Array(world));gl.uniform3fv(loc('uBaseColor'),base);
  gl.uniform3f(loc('uLightDirection'),Math.sin(Math.PI/6)*Math.SQRT1_2,Math.SQRT1_2,Math.cos(Math.PI/6)*Math.SQRT1_2);
  f('uIntensity',3);i('uCompare',1);i('uShadows',0);i('uDebug',1);i('uView',0);
  const pixels=[];size(12,1);
  for(const roughness of [.03,.12,.35,.8,1])for(const metallic of [0,1])for(const uv of [[.50125,.502],[.54,.502],[.44,.502],[.62,.35],[.35,.5]]){
   f('uRoughness',roughness);f('uMetallic',metallic);gl.uniform2fv(loc('uInspectUv'),uv);pixels.push({roughness,metallic,uv,values:read(12,1)});
  }
  f('uRoughness',.32);f('uMetallic',0);gl.uniform2f(loc('uInspectUv'),.50125,.502);f('uIntensity',3);const before=read(12,1);f('uIntensity',6);const twice=read(12,1);f('uIntensity',3);
  i('uDebug',0);size(400,250);const frames=[];for(const view of [0,1,2,3,4,5]){i('uView',view);const values=read(400,250),at=(125*400+200)*4;frames.push(values.slice(at,at+4));}
  i('uView',0);i('uShadows',1);read(400,250);
  gl.useProgram(displayProgram);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,400,250);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,image);gl.uniform1i(gl.getUniformLocation(displayProgram,'uImage'),0);gl.drawArrays(gl.TRIANGLES,0,3);
  return {functions,pixels,before,twice,frames};
 },{shared,scene,projection:camera.projectionMatrixInverse.elements,world:camera.matrixWorld.elements,base:colorToLinear('#c9784f')});
 let peakRelativeError=0,maskingError=0,fresnelError=0,pixelRelativeError=0,validPixels=0;
 for(const test of result.functions){
  const alpha=Math.fround(Math.fround(test.roughness)*Math.fround(test.roughness)),cosine=Math.fround(test.cosine),expectedD=1/(Math.PI*alpha*alpha);
  peakRelativeError=Math.max(peakRelativeError,Math.abs(test.values[0]/expectedD-1));
  const lambda=(Math.sqrt(1+alpha*alpha*(1-cosine*cosine)/(cosine*cosine))-1)/2;
  maskingError=Math.max(maskingError,Math.abs(test.values[1]-1/(1+lambda)));
  for(let c=0;c<3;c++){const f0=Math.fround([.04,.3,.8][c]),expected=f0+(1-f0)*(1-cosine)**5;fresnelError=Math.max(fresnelError,Math.abs(expected-test.values[4+c]));}
 }
 assert.ok(peakRelativeError<2e-6,'Lowest roughness NoH=1 must remain accurate, not merely finite');assert.ok(maskingError<2e-6&&fresnelError<2e-6);report.passed.push('shared GGX axis peak at r=.03, grazing Smith and Schlick');
 for(const pixel of result.pixels){
  const a=pixel.values;if(a[3]<0)continue;validPixels++;const vec=o=>a.slice(o,o+3);
  const material={baseColor:vec(44),roughness:a[7],metallic:a[19]},e=evaluateBrdf(material,vec(4),vec(32),vec(36));
  const expected=[e.d,e.g1L,e.g1V,e.g,...e.f,...e.diffuse,...e.specular,...e.brdf.map(v=>v*e.noL*a[27]*a[23])],actual=[a[12],a[13],a[14],a[15],...vec(16),...vec(20),...vec(24),...vec(28)];
  pixelRelativeError=Math.max(pixelRelativeError,...expected.map((value,index)=>Math.abs(value-actual[index])/Math.max(1,Math.abs(value))));
  if(material.metallic===1)assert.deepEqual(vec(20),[0,0,0]);
  if(material.metallic===0)assert.ok(vec(40).every(v=>Math.abs(v-.04)<1e-7));
 }
 assert.ok(validPixels>=30);assert.ok(pixelRelativeError<.005);report.passed.push('actual scene pixel D/F/G, diffuse, specular and linear radiance agree with independent CPU');
 for(let c=0;c<3;c++)assert.ok(Math.abs(result.twice[28+c]-2*result.before[28+c])<1e-6);
 assert.deepEqual(result.twice.slice(8,27),result.before.slice(8,27));report.passed.push('incident-light scaling changes radiance, not BRDF');
 for(let c=0;c<3;c++)assert.ok(Math.abs(result.frames[0][c]-result.frames[1][c]-result.frames[2][c])<2e-6);report.passed.push('rendered diffuse plus specular equals linear beauty');
 Object.assign(report,{validPixels,peakRelativeError,maskingError,fresnelError,pixelRelativeError});
 await mkdir(new URL('test-results/',root),{recursive:true});await page.locator('canvas').screenshot({path:new URL('test-results/pbr-materials.png',root).pathname});
 console.log('PASS',JSON.stringify(report));
}catch(error){report.failure=String(error.stack||error);throw error;}
finally{await mkdir(new URL('test-results/',root),{recursive:true});await writeFile(new URL('test-results/pbr-gpu-results.json',root),JSON.stringify(report,null,2));await browser.close();}
