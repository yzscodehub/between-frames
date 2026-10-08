import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const source=await readFile(new URL('../src/shaders/taa/resolve.glsl',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage();
 await page.goto('data:text/html,<title>TAA GPU verification</title>');
 const results=await page.evaluate(source=>{
  const gl=document.createElement('canvas').getContext('webgl2');if(!gl||!gl.getExtension('EXT_color_buffer_float'))throw Error('Float WebGL2 unavailable');
  const compile=(type,text)=>{const s=gl.createShader(type);gl.shaderSource(s,'#version 300 es\n'+text);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
  const p=gl.createProgram();gl.attachShader(p,compile(gl.VERTEX_SHADER,'precision highp float;out vec2 vUv;void main(){vec2 q=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=q;gl_Position=vec4(q*2.-1.,0,1);}'));gl.attachShader(p,compile(gl.FRAGMENT_SHADER,source));gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p));gl.useProgram(p);
  const loc=n=>gl.getUniformLocation(p,n),textures={};
  const tex=(w,h,a)=>{const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,w,h,0,gl.RGBA,gl.FLOAT,a);return t;};
  const names=['uCurrent','uPosition','uNormal','uPreviousClip','uOldColor','uOldMeta','uOldPosition','uOldNormal'];
  const buffers={};
  names.forEach((n,i)=>{buffers[n]=new Float32Array(64);gl.activeTexture(gl.TEXTURE0+i);textures[n]=tex(4,4,buffers[n]);gl.uniform1i(loc(n),i);});
  const fbo=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);
  for(let i=0;i<2;i++){gl.activeTexture(gl.TEXTURE0+8+i);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0+i,gl.TEXTURE_2D,tex(13,1,null),0);}
  gl.drawBuffers([gl.COLOR_ATTACHMENT0,gl.COLOR_ATTACHMENT1]);if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('FBO incomplete');
  gl.viewport(0,0,13,1);gl.uniform2f(loc('uResolution'),4,4);gl.uniform2f(loc('uInspectUv'),.625,.625);gl.uniform2f(loc('uJitter'),.25,0);gl.uniform2f(loc('uPreviousJitter'),-.25,0);gl.uniform1i(loc('uDebug'),1);gl.uniform1f(loc('uWeight'),.9);
  const fill=(name,value)=>{for(let i=0;i<16;i++)buffers[name].set(value,i*4);};
  function reset(){
   fill('uCurrent',[0,0,0,1]);fill('uPosition',[0,0,-2,7]);fill('uNormal',[0,0,1,2]);fill('uPreviousClip',[0,.5,0,2]);
   fill('uOldColor',[0,0,0,1]);buffers.uOldColor.set([1,1,1,1],(2*4+2)*4);
   fill('uOldMeta',[1,.5,0,7]);fill('uOldPosition',[0,0,-2,7]);fill('uOldNormal',[0,0,1,2]);
   gl.uniform1i(loc('uHasHistory'),1);gl.uniform1i(loc('uValidate'),1);gl.uniform1i(loc('uClip'),0);
  }
  function draw(){names.forEach((n,i)=>{gl.activeTexture(gl.TEXTURE0+i);gl.bindTexture(gl.TEXTURE_2D,textures[n]);gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,4,4,gl.RGBA,gl.FLOAT,buffers[n]);});gl.drawArrays(gl.TRIANGLES,0,3);const a=new Float32Array(52);gl.readBuffer(gl.COLOR_ATTACHMENT0);gl.readPixels(0,0,13,1,gl.RGBA,gl.FLOAT,a);if(gl.getError())throw Error('GPU error');return Array.from(a);}
  const r=[];reset();r.push({name:'fixed-grid color accumulates distinct subpixel samples',a:draw()});
  reset();gl.uniform1i(loc('uHasHistory'),0);r.push({name:'first-frame reset',a:draw()});
  reset();fill('uOldPosition',[0,0,-2,9]);r.push({name:'object rejection',a:draw()});
  reset();fill('uOldNormal',[0,0,1,4]);r.push({name:'depth rejection',a:draw()});
  reset();fill('uOldNormal',[1,0,0,2]);r.push({name:'normal rejection',a:draw()});
  reset();fill('uPreviousClip',[6,.5,0,2]);r.push({name:'UV rejection',a:draw()});
  reset();fill('uOldMeta',[1,.5,0,9]);r.push({name:'history owner rejection',a:draw()});
  reset();gl.uniform1i(loc('uClip'),1);r.push({name:'RGB clipping limits historical outlier',a:draw()});
  reset();fill('uOldPosition',[0,0,-2,9]);gl.uniform1i(loc('uValidate'),0);r.push({name:'explicit validation-off counterexample',a:draw()});
  reset();fill('uPreviousClip',[.2,.2,0,2]);r.push({name:'bilinear color reconstruction uses all four color taps',a:draw()});
  reset();fill('uPreviousClip',[.2,.2,0,2]);fill('uOldMeta',[4,.5,0,7]);buffers.uOldMeta.set([12,.5,0,7],(2*4+2)*4);r.push({name:'bilinear age conservatively takes the youngest contributing history',a:draw()});
  return r;
 },source);
 const near=(a,b,e=2e-5)=>assert.ok(Math.abs(a-b)<e,a+' != '+b);
 results.forEach(r=>assert.ok(r.a.every(Number.isFinite),r.name));
 near(results[0].a[10],.5);near(results[0].a[48],.625);near(results[0].a[12],1);near(results[0].a[20],.5);near(results[0].a[19],.5);near(results[0].a[23],2);near(results[0].a[27],0);
 for(const [i,reason]of [[1,1],[2,3],[3,4],[4,5],[5,2],[6,3]]){near(results[i].a[27],reason);near(results[i].a[19],0);near(results[i].a[23],1);}
 assert.ok(results[7].a[20]<.00002);near(results[8].a[27],0);near(results[8].a[20],.5);
 near(results[9].a[48],.675);near(results[9].a[49],.55);near(results[9].a[12],.56);near(results[9].a[20],.28);
 near(results[10].a[19],.8);near(results[10].a[23],5);near(results[10].a[20],.448);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/taa-gpu.json',JSON.stringify({passed:results.length,results},null,2));console.log('PASS '+results.length+' real WebGL2 TAA resolve cases');
}finally{await browser.close();}
