import * as T from 'three';
import query from '../../shaders/ray/query.glsl?raw';
import lighting from '../../shaders/ray/lighting.glsl?raw';
import transport from '../../shaders/ray/transport.glsl?raw';
import sharedBrdf from '../../shaders/pbr/brdf.glsl?raw';
import {RayEffects} from './effects';
import {Reconstruction} from './reconstruction';
import {rayIntegrandKey,type RayState} from './state';
import type {SceneSnapshot} from './types';
const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}';
const rt=(w:number,h:number)=>new T.WebGLRenderTarget(w,h,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
const accumulator='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uSample,uPrevious;uniform float uCount;void main(){vec4 c=texture(uSample,vUv);if(uCount==0.){outColor=c;return;}vec4 p=texture(uPrevious,vUv);outColor=vec4((p.rgb*uCount+c.rgb)/(uCount+1.),min(c.a,p.a));}';
const difference='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uA,uB;void main(){vec4 a=texture(uA,vUv),b=texture(uB,vUv);float d=dot(abs(a.rgb-b.rgb),vec3(.333333));outColor=vec4(mix(vec3(.04,.1,.17),vec3(1.,.25,.08),clamp(d*4.,0.,1.)),min(a.a,b.a));}';
export interface PathEvent {origin:number[];direction:number[];generatedPdf:number;position:number[];primitiveId:number;normal:number[];objectId:number;beta:number[];materialId:number;lightPdf:number;bsdfPdf:number;misWeight:number;termination:number;distance:number;nodes:number;tests:number;contribution:number[]}
export interface PathInspection {sample:number;frame:number;mode:number;radiance:number[];status:number;rayCounts:number[];nodes:number;tests:number;scattering:number;termination:number;truncated:boolean;events:PathEvent[]}
export interface ReferenceMetrics {mae:number;rmse:number;convergence:number;coverage:number;samples:number;component:string;status:'valid'|'invalid';invalidPixels:number}
export class ProgressiveRay {
 material:T.RawShaderMaterial;accumulator:T.RawShaderMaterial;difference:T.RawShaderMaterial;
 sample:T.WebGLRenderTarget;refSample:T.WebGLRenderTarget;sum:T.WebGLRenderTarget[];refSum:T.WebGLRenderTarget[];checkpoint:T.WebGLRenderTarget;refImage:T.WebGLRenderTarget;blank:T.WebGLRenderTarget;diff:T.WebGLRenderTarget;baselines:T.WebGLRenderTarget[];debug=rt(8,9);reconstruction:Reconstruction;effects:RayEffects;
 count=0;index=0;refIndex=0;refReady=false;refProgress=0;refGeneration=0;refRequest=0;lastDenoiseFrame=-1;metrics:ReferenceMetrics|null=null;disposed=false;referenceRunning=false;baselineKey='';
 constructor(public renderer:T.WebGLRenderer,public camera:T.PerspectiveCamera,public snapshot:SceneSnapshot,public state:RayState,public width:number,public height:number,uniforms:Record<string,T.IUniform>,public pass:(m:T.RawShaderMaterial,t:T.WebGLRenderTarget|null)=>void,public notify:()=>void){
  const mat=(fragmentShader:string,uniforms:Record<string,T.IUniform>)=>new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader,uniforms});
  this.material=mat(query+'\n'+lighting+'\n'+sharedBrdf+'\n'+transport,{...uniforms,uMode:{value:0},uLocalModel:{value:0},uSampleIndex:{value:0},uSeed:{value:state.seed},uMaxScattering:{value:state.maxScattering},uEstimator:{value:0},uSampling:{value:1},uRR:{value:0},uRoughness:{value:state.roughness},uLightCenter:{value:new T.Vector3()},uLightU:{value:new T.Vector3()},uLightV:{value:new T.Vector3()},uLightNormal:{value:new T.Vector3()},uLightEmission:{value:new T.Vector3()},uEnvironment:{value:new T.Vector3()}});
  this.accumulator=mat(accumulator,{uSample:{value:null},uPrevious:{value:null},uCount:{value:0}});this.difference=mat(difference,{uA:{value:null},uB:{value:null}});
  this.sample=rt(width,height);this.refSample=rt(width,height);this.sum=[rt(width,height),rt(width,height)];this.refSum=[rt(width,height),rt(width,height)];this.checkpoint=rt(width,height);this.refImage=rt(width,height);this.blank=rt(width,height);this.diff=rt(width,height);this.baselines=[rt(width,height),rt(width,height)];
  const old=renderer.getRenderTarget(),color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();renderer.setClearColor('#dce5ec',1);renderer.setRenderTarget(this.blank);renderer.clear();renderer.setRenderTarget(old);renderer.setClearColor(color,alpha);
  this.reconstruction=new Reconstruction(width,height,camera,uniforms);this.effects=new RayEffects(renderer,snapshot,camera,uniforms,state);this.effects.resize(width,height);this.configure(state,snapshot);
 }
 mode(){return this.state.lesson==='shadows'?1:this.state.lesson==='reflections'?2:this.state.lesson==='denoise'?3:0;}
 component(){return this.mode()===1?'光源面积可见比例':this.mode()===3?'B：间接漫反射 / 接收面反照率':'线性辐亮度';}
 configure(state:RayState,snapshot=this.snapshot){if(this.disposed)return;const localModel=state.lesson==='reflections'&&state.view===1?1:0;if(snapshot!==this.snapshot||rayIntegrandKey(state)!==rayIntegrandKey(this.state)||this.material.uniforms.uLocalModel.value!==localModel){this.cancelReference();this.baselineKey='';}this.state=structuredClone(state);this.snapshot=snapshot;const u=this.material.uniforms;u.uMode.value=this.mode();u.uLocalModel.value=localModel;u.uSeed.value=state.seed;u.uMaxScattering.value=state.maxScattering;u.uEstimator.value=['bsdf','nee','mis'].indexOf(state.estimator);u.uSampling.value=state.sampling==='uniform'?0:1;u.uRR.value=state.rr?1:0;u.uRoughness.value=state.roughness;
  for(const [name,value] of Object.entries({uLightCenter:snapshot.light.center,uLightU:snapshot.light.u,uLightV:snapshot.light.v,uLightNormal:snapshot.light.normal,uLightEmission:snapshot.light.emission,uEnvironment:snapshot.environment}))u[name].value.set(...value);
  this.effects.update(snapshot,state);
 }
 reset(preserveHistory=false){if(this.disposed)return;this.count=0;this.index=0;this.lastDenoiseFrame=-1;this.cancelReference();if(!preserveHistory)this.reconstruction.reset();}
 cancelReference(){this.refGeneration++;cancelAnimationFrame(this.refRequest);this.refRequest=0;this.refReady=false;this.refProgress=0;this.referenceRunning=false;this.metrics=null;}
 add(sample:T.Texture,previous:T.Texture,out:T.WebGLRenderTarget,count:number){const u=this.accumulator.uniforms;u.uSample.value=sample;u.uPrevious.value=previous;u.uCount.value=count;this.pass(this.accumulator,out);}
 render(out:T.WebGLRenderTarget,allowAdvance=true){
  if(this.disposed)return false;
  const u=this.material.uniforms;u.uDebug.value=0;u.uMode.value=this.mode();u.uSeed.value=this.state.seed;
  if(this.mode()===3){
   if(this.lastDenoiseFrame===this.state.frame&&this.reconstruction.hasHistory){this.reconstruction.present(out,this.pass,this.state.view);return false;}
   if(!allowAdvance)return false;
   let frameIndex=0;for(let i=0;i<this.state.batch;i++){u.uSampleIndex.value=this.state.frame*4096+i;this.pass(this.material,this.sample);const next=1-frameIndex;this.add(this.sample.texture,this.sum[frameIndex].texture,this.sum[next],i);frameIndex=next;}this.add(this.sum[frameIndex].texture,this.sum[frameIndex].texture,this.sample,0);u.uMode.value=4;this.pass(this.material,this.reconstruction.direct);u.uMode.value=3;
   const moving=this.snapshot.primitives.find(p=>p.previousOffset.some(v=>Math.abs(v)>1e-10));
   this.reconstruction.process(this.sample.texture,out,this.pass,{frame:this.state.frame,history:this.state.history,spatial:this.state.spatial,view:this.state.view,movingObject:moving?.objectId??-1,previousOffset:moving?.previousOffset??[0,0,0]});this.lastDenoiseFrame=this.state.frame;this.count=this.state.batch;return false;
  }
  const goal=this.mode()===2?1:this.state.targetSpp;
  if(allowAdvance){const batch=Math.max(0,Math.min(this.state.batch,goal-this.count));for(let i=0;i<batch;i++){u.uSampleIndex.value=this.count;this.pass(this.material,this.sample);const next=1-this.index;this.add(this.sample.texture,this.sum[this.index].texture,this.sum[next],this.count);this.index=next;this.count++;this.metrics=null;}}
  if(this.count===0)return true;
  this.add(this.sum[this.index].texture,this.sum[this.index].texture,out,0);
  return this.count<goal;
 }
 comparison(live:T.WebGLRenderTarget):T.Texture[]{
  const key=JSON.stringify([this.snapshot.version,this.camera.matrixWorld.elements,this.state.tMin,this.state.tMax,this.state.offsetScale,this.mode()]);const refresh=key!==this.baselineKey;this.baselineKey=key;
  if(this.mode()===1){if(refresh){this.effects.render('shadowmap',this.baselines[0]);this.effects.render('pcss',this.baselines[1]);}return [this.baselines[0].texture,this.baselines[1].texture,live.texture,this.refReady?this.refImage.texture:this.blank.texture];}
  if(this.mode()===2){if(refresh){this.effects.render('ssr',this.baselines[0]);this.effects.render('mirror',this.baselines[1]);}this.makeDifference(live.texture,this.baselines[1].texture);return [this.baselines[0].texture,live.texture,this.baselines[1].texture,this.diff.texture];}
  if(this.mode()===3){const rec=this.reconstruction;return [this.sample.texture,rec.history[rec.index].textures[0],rec.getFilteredTarget().textures[0],this.refReady?this.refImage.texture:this.blank.texture];}
  this.makeDifference(live.texture,this.refReady?this.refImage.texture:this.blank.texture);return [this.sample.texture,live.texture,this.refReady?this.refImage.texture:this.blank.texture,this.refReady?this.diff.texture:this.blank.texture];
 }
 makeDifference(a:T.Texture,b:T.Texture){this.difference.uniforms.uA.value=a;this.difference.uniforms.uB.value=b;this.pass(this.difference,this.diff);}
 inspect(uv:[number,number],sampleIndex:number):PathInspection {
  if(this.disposed)throw new Error('ProgressiveRay was disposed.');
  const u=this.material.uniforms,previous={debug:u.uDebug.value,sample:u.uSampleIndex.value,mode:u.uMode.value,seed:u.uSeed.value,uv:u.uInspectUv.value.clone()};const a=new Float32Array(8*9*4);
  try{u.uInspectUv.value.set(...uv);u.uDebug.value=1;u.uSampleIndex.value=this.mode()===3?this.state.frame*4096+sampleIndex:sampleIndex;u.uMode.value=this.mode();u.uSeed.value=this.state.seed;this.pass(this.material,this.debug);this.renderer.readRenderTargetPixels(this.debug,0,0,8,9,a);}
  finally{u.uDebug.value=previous.debug;u.uSampleIndex.value=previous.sample;u.uMode.value=previous.mode;u.uSeed.value=previous.seed;u.uInspectUv.value.copy(previous.uv);}
  const events:PathEvent[]=[];const logs=Math.min(8,a[12]);
  for(let i=0;i<logs;i++){const o=(i+1)*32;events.push({origin:Array.from(a.slice(o,o+3)),direction:Array.from(a.slice(o+4,o+7)),generatedPdf:a[o+7],position:Array.from(a.slice(o+8,o+11)),primitiveId:a[o+11],normal:Array.from(a.slice(o+12,o+15)),objectId:a[o+15],beta:Array.from(a.slice(o+16,o+19)),materialId:a[o+19],lightPdf:a[o+20],bsdfPdf:a[o+21],misWeight:a[o+22],termination:a[o+23],distance:a[o+24],nodes:a[o+25],tests:a[o+26],contribution:Array.from(a.slice(o+28,o+31))});}
  return {sample:sampleIndex,frame:this.state.frame,mode:this.mode(),radiance:Array.from(a.slice(0,3)),status:a[3],rayCounts:Array.from(a.slice(4,8)),nodes:a[8],tests:a[9],scattering:a[10],termination:a[11],truncated:a[14]>.5,events};
 }
 reference(live:T.WebGLRenderTarget){
  if(this.disposed)return;
  this.cancelReference();const token=this.refGeneration,mode=this.mode(),frame=this.state.frame,seed=this.state.seed;this.referenceRunning=true;let count=0,index=0;const u=this.material.uniforms;
  const tick=()=>{if(this.disposed||token!==this.refGeneration)return;
   this.refRequest=0;const previous={debug:u.uDebug.value,sample:u.uSampleIndex.value,mode:u.uMode.value,seed:u.uSeed.value};
   try{u.uDebug.value=0;u.uMode.value=mode;u.uSeed.value=seed+7919;
    for(let i=0;i<8&&count<1024;i++){u.uSampleIndex.value=(mode===3?frame*4096:0)+count;this.pass(this.material,this.refSample);const next=1-index;this.add(this.refSample.texture,this.refSum[index].texture,this.refSum[next],count);index=next;count++;if(count===512)this.add(this.refSum[index].texture,this.refSum[index].texture,this.checkpoint,0);}
   }finally{u.uDebug.value=previous.debug;u.uSampleIndex.value=previous.sample;u.uMode.value=previous.mode;u.uSeed.value=previous.seed;}
   this.refProgress=count/1024;
   if(count<1024){this.refRequest=requestAnimationFrame(tick);this.notify();return;}
   this.refReady=true;this.referenceRunning=false;this.refIndex=index;this.add(this.refSum[index].texture,this.refSum[index].texture,this.refImage,0);
   this.measure(this.mode()===3?this.reconstruction.getFilteredTarget():live);this.notify();
  };this.refRequest=requestAnimationFrame(tick);
 }
 measure(live:T.WebGLRenderTarget){
  if(!this.refReady||this.disposed)return;
  const length=this.width*this.height*4,a=new Float32Array(length),b=new Float32Array(length),c=new Float32Array(length);
  this.renderer.readRenderTargetPixels(live,0,0,this.width,this.height,a);this.renderer.readRenderTargetPixels(this.refImage,0,0,this.width,this.height,b);this.renderer.readRenderTargetPixels(this.checkpoint,0,0,this.width,this.height,c);
  let mae=0,sq=0,con=0,count=0,invalidPixels=0;
  for(let i=0;i<length;i+=4){
   let finite=true;for(let j=0;j<4;j++)if(!Number.isFinite(a[i+j])||!Number.isFinite(b[i+j])||!Number.isFinite(c[i+j]))finite=false;
   // B's receiver mask legitimately has alpha=0 outside diffuse geometry.
   // Reference transport still uses alpha=1 for a valid zero/miss sample, so
   // invalid reference/checkpoint pixels must never disappear into coverage.
   if(!finite||b[i+3]<.5||c[i+3]<.5||(this.mode()!==3&&a[i+3]<.5)){invalidPixels++;continue;}
   if(a[i+3]<.5)continue;
   for(let j=0;j<3;j++){const d=a[i+j]-b[i+j];mae+=Math.abs(d);sq+=d*d;con+=Math.abs(b[i+j]-c[i+j]);}count++;
  }
  this.metrics={mae:mae/Math.max(1,count*3),rmse:Math.sqrt(sq/Math.max(1,count*3)),convergence:con/Math.max(1,count*3),coverage:count/(this.width*this.height),samples:1024,component:this.component(),status:invalidPixels?'invalid':'valid',invalidPixels};
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.cancelReference();for(const t of [this.sample,this.refSample,...this.sum,...this.refSum,this.checkpoint,this.refImage,this.blank,this.diff,...this.baselines,this.debug])t.dispose();this.material.dispose();this.accumulator.dispose();this.difference.dispose();this.effects.dispose();this.reconstruction.dispose();}
}
