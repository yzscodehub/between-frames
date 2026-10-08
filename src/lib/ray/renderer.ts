import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import queryShader from '../../shaders/ray/query.glsl?raw';
import traceShader from '../../shaders/ray/trace.glsl?raw';
import type {BVH,PackedScene,SceneSnapshot,Vec3,Ray,QueryResult} from './types';
import {traceBrute} from './geometry';
import {type RayState,rayIntegrandKey,rayCamera} from './state';
import {ProgressiveRay,type PathInspection,type ReferenceMetrics} from './progressive';
import {freezeSnapshot} from './snapshot';
import {RayGPUTimer} from './timer';
const vertex=`precision highp float; in vec3 position; out vec2 vUv; void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}`;
const display=`precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage;uniform float uExposure;uniform int uTone;void main(){vec4 c=texture(uImage,vUv);vec3 linear=c.rgb*exp2(uExposure);if(uTone==1)linear=linear/(1.+linear);outColor=vec4(pow(max(linear,vec3(0.)),vec3(1./2.2)),1.);}`;
const makeTarget=(w:number,h:number)=>new T.WebGLRenderTarget(w,h,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
function texture(data:Float32Array,w:number,h:number){const t=new T.DataTexture(data,w,Math.max(1,h),T.RGBAFormat,T.FloatType);t.minFilter=t.magFilter=T.NearestFilter;t.generateMipmaps=false;t.needsUpdate=true;return t;}
export interface RayInspection {ray:Ray;status:number;t:number;primitiveId:number;objectId:number;materialId:number;position:Vec3;normal:Vec3;barycentric:Vec3;frontFace:boolean;nodes:number;tests:number;truncated:boolean;events:{node:number;enter:number;exit:number;kind:number}[];cpu:QueryResult;distanceError:number|null;normalError:number|null;consistent:boolean;uv:[number,number]}
export interface RayReport {notice?:string;device?:string;ready?:boolean;pending?:boolean;state?:RayState;snapshot?:SceneSnapshot;bvh?:BVH;inspection?:RayInspection|null;cpuMs?:number;uploadMs?:number;gpuMs?:number|null;error?:string;size?:string;sampleCount?:number;progress?:number;pathInspection?:PathInspection|null;referenceMetrics?:ReferenceMetrics|null;referenceReady?:boolean;playing?:boolean;replaying?:number;paused?:boolean}
export class RayRenderer {
 device='';gpuTimer:RayGPUTimer;state:RayState;renderer:T.WebGLRenderer;camera=new T.PerspectiveCamera(45,1.6,.1,100);controls:OrbitControls;
 world=new T.Scene();viewCamera=new T.Camera();quad:T.Mesh;material:T.RawShaderMaterial;display:T.RawShaderMaterial;
 targets=[makeTarget(320,200),makeTarget(320,200)];debug=makeTarget(263,1);textures:T.DataTexture[]=[];
 width=320;height=200;generation=0;disposed=false;visible=true;paused=false;pending=true;frameRequest=0;applyingCamera=false;selected:[number,number]|null=null;
 inspection:RayInspection|null=null;snapshot:SceneSnapshot|null=null;bvh:BVH|null=null;worker:Worker;observer:IntersectionObserver;
 progressive:ProgressiveRay|null=null;pathInspection:PathInspection|null=null;selectedSample=0;inspectionDirty=false;playing=false;seekTarget=-1;
 onReport:(r:RayReport)=>void;lastPointer=[0,0];contextLost=false;advanceRequest=0;scheduleGeneration=0;stepAfterInstall=false;
 constructor(public host:HTMLElement,state:RayState,onReport:(r:RayReport)=>void){
  this.state=this.prepare(state);this.onReport=onReport;if(this.state.lesson==='denoise'&&this.state.frame>0){this.seekTarget=this.state.frame;this.state=this.atFrame(this.state,0);}
  this.renderer=new T.WebGLRenderer({alpha:false,antialias:false});if(!this.renderer.extensions.has('EXT_color_buffer_float')){this.renderer.dispose();throw new Error('此设备缺少浮点渲染缓冲，仍可阅读静态说明。');}
  this.gpuTimer=new RayGPUTimer(this.renderer.getContext() as WebGL2RenderingContext,(ms,tag)=>{if(!this.disposed&&tag===this.timerKey())this.onReport({gpuMs:ms});});
  const gl=this.renderer.getContext(),debugInfo=gl.getExtension('WEBGL_debug_renderer_info');this.device=String(gl.getParameter(debugInfo?debugInfo.UNMASKED_RENDERER_WEBGL:gl.RENDERER));this.onReport({device:this.device});
  this.renderer.setPixelRatio(1);host.appendChild(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','GPU 软件光追场景，拖动旋转，点击像素检查射线');
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.minDistance=.5;this.controls.maxDistance=40;
  const dummy=texture(new Float32Array(24),6,1);this.textures.push(dummy);
  this.material=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:queryShader+'\n'+traceShader,uniforms:{
   tNodes:{value:dummy},tPrimitives:{value:dummy},tMaterials:{value:dummy},uNodeCount:{value:0},uPrimitiveCount:{value:0},uTraversal:{value:1},uAnyHit:{value:0},uOriginMode:{value:0},uOffsetScale:{value:1},uSceneScale:{value:1},uTestOrigin:{value:new T.Vector3()},uView:{value:0},uRayMin:{value:state.tMin},uRayMax:{value:state.tMax},uInvProjection:{value:this.camera.projectionMatrixInverse},uCameraWorld:{value:this.camera.matrixWorld},uResolution:{value:new T.Vector2(320,200)},uInspectUv:{value:new T.Vector2(.5,.5)},uDebug:{value:0},uLogBudget:{value:256}
  }});
  this.display=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:display,uniforms:{uImage:{value:this.targets[0].texture},uExposure:{value:state.exposure},uTone:{value:0}}});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.material);this.quad.frustumCulled=false;this.world.add(this.quad);
  this.resize();this.applyCamera();this.controls.addEventListener('change',this.cameraChanged);
  this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
  this.observer=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;if(this.visible)this.request();else this.cancelScheduled();});this.observer.observe(host);
  this.worker=new Worker(new URL('./scene.worker.ts',import.meta.url),{type:'module'});
  this.worker.onmessage=event=>{const r=event.data;if(this.disposed||r.generation!==this.generation)return;if(r.error){this.fail(r.error);return;}this.install(r.snapshot,r.bvh,r.packed);};
  this.worker.onerror=event=>{if(!this.disposed)this.fail(event.message||'场景构建失败，请重试实验。');};
  this.rebuild();
 }
 cameraChanged=()=>{if(this.applyingCamera||this.pending)return;this.state.camera={position:this.camera.position.toArray() as Vec3,target:this.controls.target.toArray() as Vec3};this.progressive?.reset();this.selected=null;this.inspection=null;this.pathInspection=null;this.onReport({pathInspection:null,referenceMetrics:null,referenceReady:false,progress:0,sampleCount:0,state:this.exportState(),inspection:null,pending:true});this.request();};
 pointerDown=(e:PointerEvent)=>{this.lastPointer=[e.clientX,e.clientY]};
 pointerUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-this.lastPointer[0],e.clientY-this.lastPointer[1])>5||this.pending)return;const b=this.renderer.domElement.getBoundingClientRect();let u=(e.clientX-b.left)/b.width;let v=1-(e.clientY-b.top)/b.height;if(this.state.compare){u=(u*2)%1;if(this.advanced())v=(v*2)%1;}this.pick(u,v);};
 lost=(e:Event)=>{e.preventDefault();this.contextLost=true;this.fail('图形上下文丢失，请重试实验。');};
 fail(message:string){this.inspection=null;this.pathInspection=null;this.pending=false;this.paused=true;this.playing=false;this.seekTarget=-1;this.cancelScheduled();this.progressive?.cancelReference();this.controls.enabled=false;this.onReport({ready:false,pending:false,paused:true,playing:false,replaying:-1,progress:0,referenceReady:false,referenceMetrics:null,inspection:null,pathInspection:null,error:message});}
 applyCamera(){this.applyingCamera=true;this.camera.position.set(...this.state.camera.position);this.controls.target.set(...this.state.camera.target);this.camera.lookAt(this.controls.target);this.controls.update();this.camera.updateMatrixWorld();this.applyingCamera=false;}
 resize(){this.width=this.state.quality==='low'?160:320;this.height=this.state.quality==='low'?100:200;this.renderer.setSize(this.width*(this.state.compare?2:1),this.height*(this.state.compare&&this.advanced()?2:1),false);this.host.style.aspectRatio=this.state.compare&&!this.advanced()?'3.2':'1.6';this.targets.forEach(t=>t.setSize(this.width,this.height));this.camera.aspect=this.width/this.height;this.camera.updateProjectionMatrix();if(this.material)this.material.uniforms.uResolution.value.set(this.width,this.height);this.onReport({size:`${this.width} × ${this.height}`});}
 rebuild(){this.cancelScheduled();this.progressive?.cancelReference();this.generation++;this.pending=true;this.controls.enabled=false;this.selected=null;this.inspection=null;this.pathInspection=null;this.onReport({pending:true,inspection:null,pathInspection:null,progress:0,referenceReady:false,referenceMetrics:null,gpuMs:null});this.worker.postMessage({generation:this.generation,preset:this.state.preset,count:this.state.count,frame:this.state.frame,variant:this.state.variant,method:this.state.builder,configuration:this.state});}
 install(snapshot:SceneSnapshot,bvh:BVH,packed:PackedScene){
  const max=this.renderer.capabilities.maxTextureSize;if(Math.max(packed.nodeCount,packed.primitiveCount,packed.materialCount)>max){this.fail('本机纹理容量不足，请减少场景规模。');return;}
  const next=[texture(packed.nodes,2,packed.nodeCount),texture(packed.primitives,6,packed.primitiveCount),texture(packed.materials,3,packed.materialCount)];
  const uploadStart=performance.now();for(const data of next)this.renderer.initTexture(data);const uploadMs=performance.now()-uploadStart;
  this.textures.forEach(t=>t.dispose());this.textures=next;[this.material.uniforms.tNodes.value,this.material.uniforms.tPrimitives.value,this.material.uniforms.tMaterials.value]=next;
  this.material.uniforms.uNodeCount.value=packed.nodeCount;this.material.uniforms.uPrimitiveCount.value=packed.primitiveCount;
  const sphere=snapshot.primitives.find(p=>p.kind==='sphere');if(this.state.origin==='inside'&&!sphere){this.state.origin='camera';this.onReport({notice:'此预设没有解析球，已改为相机射线。'});}this.material.uniforms.uTestOrigin.value.set(...(sphere?.a??[0,1,0]));
  const root=bvh.nodes[0];this.material.uniforms.uSceneScale.value=root?Math.max(...root.max.map((v,i)=>v-root.min[i])):1;
  this.snapshot=freezeSnapshot(snapshot);this.bvh=bvh;this.pending=false;this.controls.enabled=this.state.lesson!=='denoise';this.updateUniforms();
  this.configureProgressive();this.onReport({ready:true,pending:this.paused&&!this.stepAfterInstall,snapshot,bvh,uploadMs,state:this.exportState()});if(this.stepAfterInstall){this.stepAfterInstall=false;this.render(true);}else this.request();
 }
 configureProgressive(){
  if(!this.advanced()){this.progressive?.dispose();this.progressive=null;return;}
  if(this.pending||!this.snapshot)return;
  if(this.progressive&&(this.progressive.width!==this.width||this.progressive.height!==this.height)){this.progressive.dispose();this.progressive=null;}
  if(!this.progressive)this.progressive=new ProgressiveRay(this.renderer,this.camera,this.snapshot,this.state,this.width,this.height,this.material.uniforms,(m,t)=>this.pass(m,t),()=>this.progressReport());
  else this.progressive.configure(this.state,this.snapshot);
 }
 updateUniforms(){const s=this.state,u=this.material.uniforms;u.uTraversal.value=s.traversal==='bvh'?1:0;u.uAnyHit.value=s.query==='any'?1:0;u.uOriginMode.value=['camera','surface','inside'].indexOf(s.origin);u.uOffsetScale.value=s.offsetScale;u.uRayMin.value=s.tMin;u.uRayMax.value=s.tMax;u.uView.value=s.view;this.display.uniforms.uExposure.value=s.exposure;}
 advanced(s=this.state){return !['rays','bvh'].includes(s.lesson);}
 prepare(input:RayState){const s=structuredClone(input);if(this.advanced(s)){s.preset='room';s.count=Math.max(14,s.count);s.origin='camera';s.query='closest';if(s.lesson==='path'){s.estimator='bsdf';s.sampling='cosine';}if(s.estimator!=='bsdf'||s.lesson==='denoise')s.environment=0;}return s;}
 atFrame(s:RayState,frame:number):RayState {const next=structuredClone(s);next.frame=frame;if(s.motion==='camera')next.camera={position:[Math.sin(frame*.015)*1.2,2.3,8.8],target:[0,2.1,0]};else if(s.motion==='cut')next.camera=frame<60?rayCamera('room'):{position:[4.5,3.1,6],target:[0,2.1,0]};return next;}
 historyKey(s:RayState){return JSON.stringify([s.lesson,s.motion,s.preset,s.count,s.builder,s.variant,s.lightSize,s.roughness,s.environment,s.estimator,s.sampling,s.seed,s.maxScattering,s.rr,s.quality,s.history,s.spatial,s.batch]);}
 update(input:RayState){if(this.disposed)return;this.cancelScheduled();const old=this.state,next=this.prepare(input);const integrandChanged=rayIntegrandKey(old)!==rayIntegrandKey(next);const sequential=next.lesson==='denoise'&&next.frame===old.frame+1&&this.historyKey(old)===this.historyKey(next)&&!(next.motion==='cut'&&next.frame===60);
  const rebuild=old.preset!==next.preset||old.count!==next.count||old.builder!==next.builder||old.variant!==next.variant||old.frame!==next.frame||old.lesson!==next.lesson||old.lightSize!==next.lightSize||old.roughness!==next.roughness||old.environment!==next.environment||old.motion!==next.motion;
  const resize=old.quality!==next.quality,resetAccumulation=integrandChanged||old.history!==next.history||old.spatial!==next.spatial||(next.lesson==='denoise'&&old.batch!==next.batch)||(next.lesson!=='denoise'&&next.targetSpp<(this.progressive?.count??0));this.state=next;
  if(old.lesson!==next.lesson){this.playing=false;this.seekTarget=-1;this.onReport({playing:false,replaying:-1});}
  if(resize){this.progressive?.dispose();this.progressive=null;}
  if(resetAccumulation){this.progressive?.reset(sequential);this.pathInspection=null;this.inspection=null;this.inspectionDirty=true;this.onReport({pathInspection:null,inspection:null,referenceMetrics:null,referenceReady:false,progress:0,sampleCount:0,pending:true,gpuMs:null});}
  this.applyCamera();if(resize||old.compare!==next.compare||this.advanced(old)!==this.advanced(next))this.resize();this.updateUniforms();if(!rebuild)this.configureProgressive();
  if(!this.advanced()&&this.progressive){this.progressive.dispose();this.progressive=null;}
  if(old.query!==next.query||old.traversal!==next.traversal){this.inspection=null;this.inspectionDirty=true;this.onReport({inspection:null,pending:true});}
  this.onReport({state:this.exportState()});if(rebuild)this.rebuild();else if(this.paused&&!resetAccumulation&&!this.pending&&(this.progressive?.count??1)>0&&old.query===next.query&&old.traversal===next.traversal&&(old.view!==next.view||old.exposure!==next.exposure||old.compare!==next.compare))this.render(false);else this.request();
 }
 progressReport(){if(this.disposed||!this.progressive)return;const p=this.progressive;this.onReport({sampleCount:p.count,progress:p.refProgress,referenceMetrics:p.metrics,referenceReady:p.refReady,pathInspection:this.pathInspection,playing:this.playing,replaying:this.seekTarget});this.present();}
 generateReference(){if(!this.progressive||this.pending||this.disposed||this.contextLost)return;this.cancelScheduled();this.playing=false;this.paused=true;this.seekTarget=-1;if(this.progressive.count===0)this.render(true);this.progressive.reference(this.targets[0]);this.onReport({playing:false,replaying:-1,paused:true,progress:0,referenceReady:false,referenceMetrics:null});}
 measureReference(){this.progressive?.measure(this.state.lesson==='denoise'?this.progressive.reconstruction.getFilteredTarget():this.targets[0]);this.progressReport();}
 play(value:boolean){if(this.state.lesson!=='denoise'||this.disposed)return;this.cancelScheduled();this.progressive?.cancelReference();this.playing=value&&this.state.frame<120;this.paused=!this.playing;this.seekTarget=-1;this.onReport({playing:this.playing,paused:this.paused,replaying:-1,progress:0,referenceReady:false,referenceMetrics:null});if(this.playing)this.request();}
 advanceFrame(){if(this.pending||this.disposed||this.contextLost||this.paused||!this.visible||this.state.lesson!=='denoise'||(!this.playing&&this.seekTarget<=this.state.frame))return;if(this.state.frame>=120){this.finishSequence();return;}this.update(this.atFrame(this.state,this.state.frame+1));}
 nextFrame(){if(this.state.lesson!=='denoise'||this.pending||this.disposed||this.contextLost)return;if(this.state.frame>=120){this.finishSequence();return;}this.cancelScheduled();this.progressive?.cancelReference();this.playing=false;this.paused=true;this.seekTarget=-1;this.update(this.atFrame(this.state,this.state.frame+1));this.stepAfterInstall=true;this.onReport({playing:false,paused:true,replaying:-1,progress:0,referenceReady:false,referenceMetrics:null});}
 finishSequence(){this.cancelScheduled();this.playing=false;this.paused=true;this.seekTarget=-1;this.onReport({playing:false,paused:true,replaying:-1});}
 seek(frame:number){if(this.state.lesson!=='denoise'||this.disposed||!Number.isFinite(frame))return;this.cancelScheduled();this.playing=false;this.paused=false;this.seekTarget=Math.max(0,Math.min(120,Math.floor(frame)));this.progressive?.reset();this.pathInspection=null;this.inspection=null;this.inspectionDirty=true;this.update(this.atFrame(this.state,0));this.onReport({playing:false,paused:false,replaying:this.seekTarget,pathInspection:null,inspection:null,progress:0,referenceReady:false,referenceMetrics:null,sampleCount:0});}
 setInspectSample(sample:number){if(!Number.isFinite(sample)||this.disposed)return;this.selectedSample=Math.max(0,Math.min(4095,Math.floor(sample)));this.inspectionDirty=true;if(this.selected&&!this.pending&&!this.contextLost){this.inspect();this.present();}}

 capabilities(){return {backend:'WebGL2 software ray tracing',floatColorBuffer:true,gpuTimer:!!this.gpuTimer.ext,device:this.device};}
 exportState(){return structuredClone(this.state);}
 cancelScheduled(){this.scheduleGeneration++;cancelAnimationFrame(this.frameRequest);cancelAnimationFrame(this.advanceRequest);this.frameRequest=0;this.advanceRequest=0;this.stepAfterInstall=false;}
 request(){if(this.disposed||this.pending||!this.visible||this.paused||this.contextLost||this.frameRequest)return;const generation=this.scheduleGeneration;this.frameRequest=requestAnimationFrame(()=>{if(generation!==this.scheduleGeneration)return;this.frameRequest=0;if(!this.paused&&this.visible)this.render();});}
 requestAdvance(){if(this.advanceRequest||this.paused||!this.visible)return;const generation=this.scheduleGeneration;this.advanceRequest=requestAnimationFrame(()=>{if(generation!==this.scheduleGeneration)return;this.advanceRequest=0;this.advanceFrame();});}
 pass(mat:T.RawShaderMaterial,target:T.WebGLRenderTarget|null){this.quad.material=mat;this.renderer.setRenderTarget(target);this.renderer.render(this.world,this.viewCamera);}
 timerKey(){return rayIntegrandKey(this.state)+JSON.stringify([this.state.compare,this.state.traversal,this.state.query]);}
 render(allowAdvance=!this.paused){if(this.pending||this.disposed||this.contextLost)return;this.camera.updateMatrixWorld();const start=performance.now();this.gpuTimer.begin(this.timerKey());const u=this.material.uniforms;u.uDebug.value=0;
  if(this.advanced()&&this.progressive){
   const more=this.progressive.render(this.targets[0],allowAdvance);this.gpuTimer.end();const submission=performance.now()-start;if(this.selected&&this.inspectionDirty)this.inspect();this.present();this.onReport({ready:true,pending:false,cpuMs:submission,sampleCount:this.progressive.count,progress:this.progressive.refProgress,referenceMetrics:this.progressive.metrics,referenceReady:this.progressive.refReady,playing:this.playing,replaying:this.seekTarget});
   if(this.state.lesson==='denoise'&&((this.playing&&this.state.frame>=120)||this.seekTarget===this.state.frame))this.finishSequence();
   else if(this.state.lesson==='denoise'&&(this.playing||this.seekTarget>this.state.frame)&&!this.paused)this.requestAdvance();
   else if(more)this.request();return;
  }
  if(this.state.compare){u.uTraversal.value=0;this.pass(this.material,this.targets[0]);u.uTraversal.value=1;this.pass(this.material,this.targets[1]);u.uTraversal.value=this.state.traversal==='bvh'?1:0;}
  else this.pass(this.material,this.targets[0]);
  this.gpuTimer.end();const cpu=performance.now()-start;
  if(this.selected)this.inspect();this.present();this.onReport({ready:true,pending:false,cpuMs:cpu});
 }
 present(){
  this.renderer.setRenderTarget(null);this.display.uniforms.uTone.value=this.advanced()&&this.state.lesson!=='shadows'?1:0;
  if(this.state.compare){const images=this.advanced()&&this.progressive?this.progressive.comparison(this.targets[0]):this.targets.map(t=>t.texture);const rows=images.length>2?2:1;this.renderer.setRenderTarget(null);this.renderer.setScissorTest(true);
   for(let i=0;i<images.length;i++){const x=(i%2)*this.width,y=rows===2?(i<2?this.height:0):0;this.renderer.setViewport(x,y,this.width,this.height);this.renderer.setScissor(x,y,this.width,this.height);this.display.uniforms.uImage.value=images[i];this.quad.material=this.display;this.renderer.render(this.world,this.viewCamera);}this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,this.width*2,this.height*rows);
  }else{this.display.uniforms.uImage.value=this.targets[0].texture;this.pass(this.display,null);}
 }

 pick(u=.5,v=.5){if(this.pending||this.disposed||this.contextLost||!Number.isFinite(u)||!Number.isFinite(v))return;this.inspectionDirty=true;this.selectedSample=Math.max(0,(this.progressive?.count??1)-1);this.selected=[(Math.min(this.width-1,Math.max(0,Math.floor(u*this.width)))+.5)/this.width,(Math.min(this.height-1,Math.max(0,Math.floor(v*this.height)))+.5)/this.height];this.inspect();this.present();}
 inspect(){if(!this.selected||!this.snapshot)return;if(this.advanced()&&this.progressive){this.selectedSample=Math.min(this.selectedSample,Math.max(0,this.progressive.count-1));this.pathInspection=this.progressive.inspect(this.selected,this.selectedSample);this.inspectionDirty=false;this.onReport({pathInspection:this.pathInspection});return;}this.material.uniforms.uInspectUv.value.set(...this.selected);this.material.uniforms.uDebug.value=1;this.pass(this.material,this.debug);this.material.uniforms.uDebug.value=0;
  const data=new Float32Array(263*4);this.renderer.readRenderTargetPixels(this.debug,0,0,263,1,data);const ray:Ray={origin:[data[16],data[17],data[18]],direction:[data[20],data[21],data[22]],tMin:data[19],tMax:data[23]};
  const cpu=traceBrute(ray,this.snapshot.primitives,this.state.query==='any');const events=[];for(let i=0;i<Math.min(data[14],256);i++){const o=(i+6)*4;events.push({node:data[o],enter:data[o+1],exit:data[o+2],kind:data[o+3]});}
  const gpuHit=data[7]===1,error=gpuHit&&cpu.hit?Math.abs(data[0]-cpu.hit.t):null,normalError=gpuHit&&cpu.hit?Math.hypot(...cpu.hit.geometricNormal.map((value,index)=>data[8+index]-value)):null;
  const closestMatches=!gpuHit||(cpu.hit!==null&&data[1]===cpu.hit.primitiveId&&error!==null&&error<.002*Math.max(1,data[0])&&normalError!==null&&normalError<.002&&(data[11]>.5)===cpu.hit.frontFace);
  this.inspection={ray,status:data[7],t:data[0],primitiveId:data[1],objectId:data[2],materialId:data[3],position:[data[4],data[5],data[6]],normal:[data[8],data[9],data[10]],barycentric:[data[1048],data[1049],data[1050]],frontFace:data[11]>.5,nodes:data[12],tests:data[13],truncated:data[15]>.5,events,cpu,distanceError:error,normalError,consistent:data[7]<2&&(cpu.status==='hit'||cpu.status==='miss')&&gpuHit===!!cpu.hit&&(this.state.query==='any'||closestMatches),uv:this.selected};this.onReport({inspection:this.inspection});
 }
 setPaused(value:boolean){if(this.disposed)return;this.cancelScheduled();this.paused=value;if(value){this.playing=false;this.seekTarget=-1;}else if(this.progressive?.referenceRunning){this.progressive.cancelReference();this.onReport({progress:0,referenceReady:false,referenceMetrics:null});}this.onReport({paused:value,playing:this.playing,replaying:this.seekTarget});if(!value)this.request();}
 step(){if(this.disposed||this.contextLost)return;this.cancelScheduled();if(this.progressive?.referenceRunning){this.progressive.cancelReference();this.onReport({progress:0,referenceReady:false,referenceMetrics:null});}if(this.pending){this.stepAfterInstall=true;return;}this.render(true);}
 dispose(){if(this.disposed)return;this.disposed=true;this.generation++;this.cancelScheduled();this.worker.terminate();this.progressive?.dispose();this.gpuTimer.dispose();this.observer.disconnect();this.controls.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown);this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);this.renderer.domElement.removeEventListener('webglcontextlost',this.lost);this.textures.forEach(t=>t.dispose());this.targets.forEach(t=>t.dispose());this.debug.dispose();this.material.dispose();this.display.dispose();this.quad.geometry.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
