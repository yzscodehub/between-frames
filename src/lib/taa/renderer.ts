import * as T from 'three';
import meshVertex from '../../shaders/taa/mesh.vert.glsl?raw';
import meshFragment from '../../shaders/taa/mesh.frag.glsl?raw';
import resolveFragment from '../../shaders/taa/resolve.glsl?raw';
import {RayGPUTimer} from '../ray/timer';
import {createScene} from './scene';
import {cameraAt,frameJitter,jitterProjection,referenceJitter} from './math';
import {sequenceKey,type TAAState} from './state';

const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
const display='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage,uOther,uMeta,uClip;uniform int uMode;uniform float uExposure;void main(){vec3 c=texture(uImage,vUv).rgb;if(uMode==1){float r=texture(uMeta,vUv).b;c=r<.5?vec3(.05,.48,.27):r<1.5?vec3(.18,.27,.5):r<2.5?vec3(.8,.38,.1):r<3.5?vec3(.75,.12,.35):r<4.5?vec3(.65,.35,.8):r<5.5?vec3(.25,.6,.8):vec3(.08);}else if(uMode==2){vec4 p=texture(uClip,vUv);vec2 d=p.w>0.?vUv-(p.xy/p.w*.5+.5):vec2(0);c=vec3(.5+d*14.,.5);}else if(uMode==3){float d=dot(abs(c-texture(uOther,vUv).rgb),vec3(1./3.));c=mix(vec3(.03,.07,.1),vec3(1.,.25,.04),clamp(d*5.,0.,1.));}else c*=exp2(uExposure);outColor=vec4(pow(max(c,vec3(0)),vec3(1./2.2)),1.);}';
const average='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uSample,uOld;uniform float uCount;void main(){vec3 c=texture(uSample,vUv).rgb;outColor=vec4((texture(uOld,vUv).rgb*uCount+c)/(uCount+1.),1.);}';
const target=(w:number,h:number,count=1,depth=false)=>new T.WebGLRenderTarget(w,h,{count,type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:depth,stencilBuffer:false});
export interface TAAInspection {frame:number;current:number[];objectId:number;position:number[];depth:number;uv:number[];previousUv:number[];historyUv:number[];history:number[];oldObjectId:number;clipped:number[];weight:number;final:number[];age:number;normal:number[];reason:number;jitter:number[];previousJitter:number[];previousClip:number[];oldDepth:number;normalDot:number;oldAge:number;hasHistory:boolean;minimum:number[];maximum:number[]}
export interface TAAMetrics {frame:number;samples:number;coverage:number;invalidPixels:number;status:'valid'|'invalid';currentMAE:number;taaMAE:number;taaRMSE:number;convergence:number;rejectedMAE:number|null}
export interface TAAReport {device?:string;state?:TAAState;ready?:boolean;pending?:boolean;paused?:boolean;playing?:boolean;replay?:number;error?:string;inspection?:TAAInspection|null;referenceReady?:boolean;referenceRunning?:boolean;referenceProgress?:number;metrics?:TAAMetrics|null;renderCount?:number;jitter?:number[];cpuMs?:number;gpuMs?:number|null}

export class TAARenderer {
 device='';renderer:T.WebGLRenderer;camera=new T.PerspectiveCamera(45,1.6,.1,40);world=createScene();
 geometryMaterial:T.RawShaderMaterial;resolveMaterial:T.RawShaderMaterial;displayMaterial:T.RawShaderMaterial;averageMaterial:T.RawShaderMaterial;
 fullscreen=new T.Scene();screenCamera=new T.Camera();quad:T.Mesh;timer:RayGPUTimer;observer:IntersectionObserver;
 state:TAAState;w=320;h=200;gbuffer:T.WebGLRenderTarget[]=[];history:T.WebGLRenderTarget[]=[];refGeometry:T.WebGLRenderTarget;refSum:T.WebGLRenderTarget[];reference:T.WebGLRenderTarget;checkpoint:T.WebGLRenderTarget;blank:T.WebGLRenderTarget;debug=target(13,1,2);
 index=0;processed=-1;hasHistory=false;renderCount=0;paused=true;playing=false;visible=true;disposed=false;contextLost=false;
 replay=-1;queued:number|null=null;requestId=0;scheduleToken=0;referenceId=0;referenceToken=0;referenceProgress=0;referenceReady=false;referenceRunning=false;
 previousVP=new T.Matrix4();previousModels:T.Matrix4[]=[];activePrevious:T.Matrix4[]=[];selected:[number,number]|null=null;inspection:TAAInspection|null=null;metrics:TAAMetrics|null=null;
 pointerStart:[number,number]=[0,0];
 constructor(public host:HTMLElement,state:TAAState,public notify:(r:TAAReport)=>void){
  this.state=structuredClone(state);
  this.renderer=new T.WebGLRenderer({antialias:false,alpha:false});
  if(!this.renderer.extensions.has('EXT_color_buffer_float')){this.renderer.dispose();this.world.dispose();throw Error('本机缺少浮点颜色缓冲；静态 TAA 说明仍可阅读。');}
  const gl=this.renderer.getContext(),debugInfo=gl.getExtension('WEBGL_debug_renderer_info');this.device=String(gl.getParameter(debugInfo?debugInfo.UNMASKED_RENDERER_WEBGL:gl.RENDERER));
  this.renderer.setPixelRatio(1);this.renderer.setClearColor(0x283948,0);host.append(this.renderer.domElement);
  this.renderer.domElement.setAttribute('aria-label','TAA 光栅场景；点击同一屏幕位置检查历史重投影');
  const material=(f:string,u:Record<string,T.IUniform>)=>new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:f,uniforms:u,depthTest:false,depthWrite:false});
  this.geometryMaterial=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:meshVertex,fragmentShader:meshFragment,depthTest:true,depthWrite:true,side:T.DoubleSide,uniforms:{uPreviousModel:{value:new T.Matrix4()},uPreviousVP:{value:new T.Matrix4()},uWorldNormal:{value:new T.Matrix3()},uColor:{value:new T.Color()},uObject:{value:0},uPattern:{value:0},uFrequency:{value:5}}});
  this.resolveMaterial=material(resolveFragment,{...Object.fromEntries(['uCurrent','uPosition','uNormal','uPreviousClip','uOldColor','uOldMeta','uOldPosition','uOldNormal'].map(n=>[n,{value:null}])),uResolution:{value:new T.Vector2()},uInspectUv:{value:new T.Vector2(.5,.5)},uJitter:{value:new T.Vector2()},uPreviousJitter:{value:new T.Vector2()},uWeight:{value:state.weight},uHasHistory:{value:0},uValidate:{value:1},uClip:{value:1},uDebug:{value:0}});
  this.displayMaterial=material(display,{uImage:{value:null},uOther:{value:null},uMeta:{value:null},uClip:{value:null},uMode:{value:0},uExposure:{value:0}});
  this.averageMaterial=material(average,{uSample:{value:null},uOld:{value:null},uCount:{value:0}});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.resolveMaterial);this.quad.frustumCulled=false;this.fullscreen.add(this.quad);
  for(const [i,mesh] of this.world.meshes.entries())mesh.onBeforeRender=()=>{
   const u=this.geometryMaterial.uniforms;u.uPreviousModel.value.copy(this.activePrevious[i]??mesh.matrixWorld);u.uWorldNormal.value.getNormalMatrix(mesh.matrixWorld);
   u.uColor.value.copy(mesh.userData.color);u.uObject.value=mesh.userData.id;u.uPattern.value=mesh.userData.pattern;
   u.uFrequency.value=this.state.scene==='fine'?18:6;this.geometryMaterial.uniformsNeedUpdate=true;
  };
  this.refGeometry=target(1,1,4,true);this.refSum=[target(1,1),target(1,1)];this.reference=target(1,1);this.checkpoint=target(1,1);this.blank=target(1,1);
  this.timer=new RayGPUTimer(this.renderer.getContext() as WebGL2RenderingContext,(gpuMs,tag)=>{if(!this.disposed&&tag===this.tag())this.notify({gpuMs});});
  this.resize();this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
  this.observer=new IntersectionObserver(([entry])=>{this.visible=entry.isIntersecting;if(this.visible){if(this.referenceRunning)this.scheduleReference();else this.schedule();}else{this.cancelScheduled();cancelAnimationFrame(this.referenceId);this.referenceId=0;}});
  this.observer.observe(host.closest('.taa-lab')??host);this.configure(state,true);
 }
 tag(){return sequenceKey(this.state)+'|'+this.processed;}
 resize(){
  this.w=this.state.quality==='low'?160:320;this.h=this.state.quality==='low'?100:200;
  for(const t of [...this.gbuffer,...this.history])t.dispose();
  this.gbuffer=[target(this.w,this.h,4,true),target(this.w,this.h,4,true)];this.history=[target(this.w,this.h,2),target(this.w,this.h,2)];
  for(const t of [this.refGeometry,...this.refSum,this.reference,this.checkpoint,this.blank])t.setSize(this.w,this.h);
  this.resolveMaterial.uniforms.uResolution.value.set(this.w,this.h);this.camera.aspect=this.w/this.h;
  this.sizeCanvas();this.pass(this.averageMaterial,this.blank,true);
 }
 sizeCanvas(){this.renderer.setSize(this.w*(this.state.compare?2:1),this.h*(this.state.compare?2:1),false);this.host.style.aspectRatio='1.6';}
 setCamera(frame:number,jitter:[number,number]){
  const c=cameraAt(this.state,frame);this.camera.position.set(...c.position);this.camera.lookAt(...c.target);this.camera.updateMatrixWorld();this.camera.updateProjectionMatrix();
  this.camera.projectionMatrix.copy(jitterProjection(this.camera.projectionMatrix,jitter,this.w,this.h));this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
 }
 raster(out:T.WebGLRenderTarget,frame:number,jitter:[number,number],models:T.Matrix4[],vp:T.Matrix4){
  this.setCamera(frame,jitter);this.world.at(this.state,frame);this.activePrevious=models;this.geometryMaterial.uniforms.uPreviousVP.value.copy(vp);
  this.world.scene.overrideMaterial=this.geometryMaterial;this.renderer.setRenderTarget(out);this.renderer.setViewport(0,0,this.w,this.h);this.renderer.setScissorTest(false);this.renderer.clear();this.renderer.render(this.world.scene,this.camera);this.world.scene.overrideMaterial=null;
 }
 pass(mat:T.RawShaderMaterial,out:T.WebGLRenderTarget|null,clear=false){
  this.quad.material=mat;this.renderer.setRenderTarget(out);this.renderer.setScissorTest(false);if(out)this.renderer.setViewport(0,0,out.width,out.height);
  if(clear){this.renderer.clear();return;}this.renderer.render(this.fullscreen,this.screenCamera);
 }
 renderFrame(frame:number){
  if(this.disposed||this.contextLost||frame===this.processed)return;
  const start=performance.now(),next=1-this.index,j=frameJitter(frame,this.state.jitter);
  const continuous=this.processed===frame-1&&!(this.state.motion==='cut'&&frame===60);
  this.setCamera(frame,j);
  if(this.processed<0){this.previousVP.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);this.world.at(this.state,frame);this.previousModels=this.world.meshes.map(m=>m.matrixWorld.clone());}
  this.state.frame=frame;this.timer.begin(sequenceKey(this.state)+'|'+frame);
  this.raster(this.gbuffer[next],frame,j,this.previousModels,this.previousVP);
  const u=this.resolveMaterial.uniforms,cur=this.gbuffer[next],old=this.gbuffer[this.index];
  u.uCurrent.value=cur.textures[0];u.uPosition.value=cur.textures[1];u.uNormal.value=cur.textures[2];u.uPreviousClip.value=cur.textures[3];
  u.uOldColor.value=this.history[this.index].textures[0];u.uOldMeta.value=this.history[this.index].textures[1];u.uOldPosition.value=old.textures[1];u.uOldNormal.value=old.textures[2];
  u.uJitter.value.set(...j);u.uPreviousJitter.value.set(...frameJitter(Math.max(0,this.processed),this.state.jitter));
  u.uHasHistory.value=this.hasHistory&&continuous?1:0;u.uWeight.value=this.state.weight;u.uValidate.value=this.state.validation?1:0;u.uClip.value=this.state.clipping?1:0;u.uDebug.value=0;
  this.pass(this.resolveMaterial,this.history[next]);this.timer.end();const cpuMs=performance.now()-start;
  this.index=next;this.processed=frame;this.hasHistory=true;this.renderCount++;
  this.previousVP.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);this.previousModels=this.world.meshes.map(m=>m.matrixWorld.clone());
  if(this.selected)this.inspect(this.selected,false);
  this.present();this.report({cpuMs,pending:false});
 }
 present(){
  if(this.disposed||this.contextLost||this.processed<0)return;
  const u=this.displayMaterial.uniforms,cur=this.gbuffer[this.index],hist=this.history[this.index];
  u.uExposure.value=this.state.exposure;u.uMeta.value=hist.textures[1];u.uClip.value=cur.textures[3];u.uOther.value=this.referenceReady?this.reference.texture:this.blank.texture;
  const mode=this.state.view==='reject'?1:this.state.view==='velocity'?2:0;
  const images=this.state.compare?[cur.textures[0],hist.textures[0],this.referenceReady?this.reference.texture:this.blank.texture,this.referenceReady?hist.textures[0]:this.blank.texture]:[this.state.view==='current'?cur.textures[0]:hist.textures[0]];
  this.renderer.setRenderTarget(null);this.renderer.setScissorTest(true);this.quad.material=this.displayMaterial;
  images.forEach((image,i)=>{const x=this.state.compare?(i%2)*this.w:0,y=this.state.compare?(i<2?this.h:0):0;this.renderer.setViewport(x,y,this.w,this.h);this.renderer.setScissor(x,y,this.w,this.h);u.uImage.value=image;u.uMode.value=this.state.compare?(i===3&&this.referenceReady?3:0):mode;this.renderer.render(this.fullscreen,this.screenCamera);});
  this.renderer.setScissorTest(false);
 }
 report(extra:TAAReport={}){if(!this.disposed)this.notify({device:this.device,state:structuredClone(this.state),ready:!this.contextLost&&this.processed>=0,paused:this.paused,playing:this.playing,replay:this.replay,renderCount:this.renderCount,jitter:frameJitter(this.state.frame,this.state.jitter),inspection:this.inspection,referenceReady:this.referenceReady,referenceRunning:this.referenceRunning,referenceProgress:this.referenceProgress,metrics:this.metrics,...extra});}
 cancelScheduled(){this.scheduleToken++;cancelAnimationFrame(this.requestId);this.requestId=0;}
 schedule(){
  if(this.disposed||this.contextLost||!this.visible||this.requestId||this.referenceRunning)return;
  if(this.queued===null&&this.replay<0&&!this.playing)return;
  const token=this.scheduleToken;
  this.requestId=requestAnimationFrame(()=>{this.requestId=0;if(token!==this.scheduleToken||this.disposed||!this.visible)return;
   const frame=this.queued!==null?this.queued:this.processed+1;this.queued=null;
   if(frame<=120)this.renderFrame(frame);
   if(this.replay>=0&&this.processed>=this.replay){this.replay=-1;this.paused=true;}
   if(this.processed>=120){this.playing=false;this.paused=true;this.replay=-1;}
   this.report();this.schedule();
  });
 }
 configure(input:TAAState,force=false){
  const next=structuredClone(input),changed=sequenceKey(this.state)!==sequenceKey(next)||next.frame!==this.state.frame||force;
  if(!changed){const resize=this.state.compare!==next.compare;this.state=next;if(resize)this.sizeCanvas();this.present();this.report();return;}
  this.cancelScheduled();this.cancelReference(false);this.playing=false;this.paused=false;
  const resize=next.quality!==this.state.quality;this.state=next;if(resize)this.resize();else this.sizeCanvas();
  this.replay=next.frame;this.state.frame=0;this.processed=-1;this.index=0;this.hasHistory=false;this.selected=null;this.inspection=null;this.queued=0;
  this.report({pending:true,gpuMs:null});this.schedule();
 }
 seek(frame:number){this.configure({...this.state,frame:Math.max(0,Math.min(120,Math.floor(frame)))},true);}
 play(value:boolean){
  this.cancelScheduled();this.cancelReference(false);this.replay=-1;this.queued=null;this.playing=value&&this.processed<120;this.paused=!this.playing;this.report();this.schedule();
 }
 next(){if(this.disposed||this.processed>=120||this.replay>=0)return;this.cancelScheduled();this.cancelReference(false);this.playing=false;this.paused=true;this.queued=this.processed+1;this.report({pending:true});this.schedule();}
 pointerDown=(e:PointerEvent)=>{this.pointerStart=[e.clientX,e.clientY];};
 pointerUp=(e:PointerEvent)=>{
  if(Math.hypot(e.clientX-this.pointerStart[0],e.clientY-this.pointerStart[1])>5||this.processed<0)return;
  const box=this.renderer.domElement.getBoundingClientRect();let x=(e.clientX-box.left)/box.width,y=(e.clientY-box.top)/box.height;
  if(x<0||x>=1||y<0||y>=1)return;if(this.state.compare){x=(x*2)%1;y=(y*2)%1;}this.inspect([x,1-y]);
 };
 inspect(uv:[number,number]=[.5,.5],notify=true){
  if(this.disposed||this.contextLost||this.processed<0)return;
  this.selected=uv;const u=this.resolveMaterial.uniforms;u.uInspectUv.value.set(...uv);u.uDebug.value=1;this.pass(this.resolveMaterial,this.debug);u.uDebug.value=0;
  const a=new Float32Array(52);this.renderer.readRenderTargetPixels(this.debug,0,0,13,1,a);const row=(r:number)=>Array.from(a.slice(r*4,r*4+3));
  this.inspection={frame:this.state.frame,current:row(0),objectId:a[3],position:row(1),depth:a[7],uv:Array.from(a.slice(8,10)),previousUv:Array.from(a.slice(10,12)),historyUv:Array.from(a.slice(48,50)),history:row(3),oldObjectId:a[15],clipped:row(4),weight:a[19],final:row(5),age:a[23],normal:row(6),reason:a[27],jitter:Array.from(a.slice(28,30)),previousJitter:Array.from(a.slice(30,32)),previousClip:Array.from(a.slice(32,36)),oldDepth:a[36],normalDot:a[37],oldAge:a[38],hasHistory:a[39]>.5,minimum:row(10),maximum:row(11)};
  if(notify){this.present();this.report();}
 }
 refCount=0;refIndex=0;refFrame=0;refKey='';
 generateReference(){
  if(this.disposed||this.contextLost||this.processed<0||this.replay>=0)return;
  this.cancelScheduled();this.cancelReference(false);this.playing=false;this.paused=true;this.queued=null;
  this.referenceRunning=true;this.refCount=0;this.refIndex=0;this.refFrame=this.state.frame;this.refKey=this.tag();this.report();this.scheduleReference();
 }
 scheduleReference(){
  if(this.disposed||!this.visible||!this.referenceRunning||this.referenceId)return;
  const token=this.referenceToken;
  this.referenceId=requestAnimationFrame(()=>{this.referenceId=0;if(this.disposed||token!==this.referenceToken||!this.referenceRunning||!this.visible||this.refKey!==this.tag())return;
   for(let n=0;n<4&&this.refCount<64;n++){
    this.raster(this.refGeometry,this.refFrame,referenceJitter(this.refCount,this.state.seed),this.previousModels,this.previousVP);
    const next=1-this.refIndex;this.average(this.refGeometry.textures[0],this.refSum[this.refIndex].texture,this.refSum[next],this.refCount);this.refIndex=next;this.refCount++;
    if(this.refCount===32)this.average(this.refSum[this.refIndex].texture,this.refSum[this.refIndex].texture,this.checkpoint,0);
   }
   this.setCamera(this.state.frame,frameJitter(this.state.frame,this.state.jitter));this.referenceProgress=this.refCount/64;
   if(this.refCount===64){this.average(this.refSum[this.refIndex].texture,this.refSum[this.refIndex].texture,this.reference,0);this.referenceRunning=false;this.referenceReady=true;this.measure(false);}
   this.present();this.report();if(this.referenceRunning)this.scheduleReference();
  });
 }
 average(sample:T.Texture,old:T.Texture,out:T.WebGLRenderTarget,count:number){const u=this.averageMaterial.uniforms;u.uSample.value=sample;u.uOld.value=old;u.uCount.value=count;this.pass(this.averageMaterial,out);}
 cancelReference(notify=true){this.referenceToken++;cancelAnimationFrame(this.referenceId);this.referenceId=0;this.referenceRunning=false;this.referenceProgress=0;this.referenceReady=false;this.metrics=null;if(notify){this.present();this.report();}}
 measure(notify=true){
  if(!this.referenceReady||this.refFrame!==this.state.frame)return;
  const read=(target:T.WebGLRenderTarget,attachment=0)=>{const a=new Float32Array(this.w*this.h*4);this.renderer.readRenderTargetPixels(target,0,0,this.w,this.h,a,undefined,attachment);return a;};
  const current=read(this.gbuffer[this.index]),taa=read(this.history[this.index]),ref=read(this.reference),cp=read(this.checkpoint),meta=read(this.history[this.index],1);
  let cur=0,error=0,square=0,con=0,n=0,rejected=0,nReject=0,invalidPixels=0;
  // Background is a valid AA signal: a center miss may have subpixel coverage in the reference.
  for(let i=0;i<current.length;i+=4){
   let finite=true;for(let c=0;c<3;c++)if(![current[i+c],taa[i+c],ref[i+c],cp[i+c]].every(Number.isFinite))finite=false;
   if(!finite){invalidPixels++;continue;}n++;const reject=meta[i+2]>=2&&meta[i+2]<=5;if(reject)nReject++;
   for(let c=0;c<3;c++){const e=Math.abs(taa[i+c]-ref[i+c]);cur+=Math.abs(current[i+c]-ref[i+c]);error+=e;square+=e*e;con+=Math.abs(ref[i+c]-cp[i+c]);if(reject)rejected+=e;}
  }
  this.metrics={frame:this.state.frame,samples:64,coverage:n/(this.w*this.h),invalidPixels,status:invalidPixels?'invalid':'valid',currentMAE:cur/Math.max(1,n*3),taaMAE:error/Math.max(1,n*3),taaRMSE:Math.sqrt(square/Math.max(1,n*3)),convergence:con/Math.max(1,n*3),rejectedMAE:nReject?rejected/(nReject*3):null};if(notify)this.report();
 }
 lost=(event:Event)=>{event.preventDefault();this.contextLost=true;this.playing=false;this.paused=true;this.replay=-1;this.cancelScheduled();this.cancelReference(false);this.notify({ready:false,pending:false,playing:false,paused:true,replay:-1,referenceReady:false,referenceRunning:false,referenceProgress:0,error:'图形上下文丢失；请重试实验。'});};
 snapshot(){return {device:this.device,state:structuredClone(this.state),ready:!this.contextLost&&this.processed>=0,paused:this.paused,playing:this.playing,replay:this.replay,frame:this.processed,renderCount:this.renderCount,inspection:this.inspection,referenceReady:this.referenceReady,referenceRunning:this.referenceRunning,referenceProgress:this.referenceProgress,metrics:this.metrics,jitter:frameJitter(this.state.frame,this.state.jitter)};}
 dispose(){
  if(this.disposed)return;this.cancelScheduled();this.cancelReference(false);this.disposed=true;this.observer.disconnect();this.timer.dispose();
  this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);this.renderer.domElement.removeEventListener('webglcontextlost',this.lost);
  for(const t of [...this.gbuffer,...this.history,this.refGeometry,...this.refSum,this.reference,this.checkpoint,this.blank,this.debug])t.dispose();
  this.world.dispose();for(const m of [this.geometryMaterial,this.resolveMaterial,this.displayMaterial,this.averageMaterial])m.dispose();this.quad.geometry.dispose();this.renderer.domElement.remove();this.renderer.dispose();
 }
}
