import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import meshVertex from '../../shaders/shadow/mesh.vert.glsl?raw';
import depthFragment from '../../shaders/shadow/depth.frag.glsl?raw';
import gbufferFragment from '../../shaders/shadow/gbuffer.frag.glsl?raw';
import resolveFragment from '../../shaders/shadow/resolve.glsl?raw';
import {RayGPUTimer} from '../ray/timer';
import type {Vec3} from '../ray/types';
import {createShadowScene,type ShadowScene} from './scene';
import {shadowGeometryKey,shadowReferenceKey} from './state';
import {areaLightVisibilitySample,cpuShadowTexelDepth,evaluatePcf,pointVisibility} from './math';
import type {ShadowInspection,ShadowReference,ShadowReport,ShadowSample,ShadowState} from './types';

const WIDTH=320,HEIGHT=200,DEBUG_WIDTH=332;
const fullVertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
const displayFragment='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uSource;void main(){vec3 color=texture(uSource,vUv).rgb;outColor=vec4(pow(max(color,vec3(0.)),vec3(1./2.2)),1.);}';
const colorTarget=(w=WIDTH,h=HEIGHT)=>new T.WebGLRenderTarget(w,h,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
const algorithmIndex=(state:ShadowState)=>['hard','pcf','pcss'].indexOf(state.algorithm);
const cameraKey=(state:ShadowState)=>JSON.stringify(state.camera);

/** Real mesh rasterization owns both depth passes. CPU queries are used only
 * for selected-point validation and the explicitly requested area reference. */
export class ShadowRenderer {
 readonly renderer:T.WebGLRenderer;
 readonly camera=new T.PerspectiveCamera(45,WIDTH/HEIGHT,.1,50);
 readonly lightCamera=new T.PerspectiveCamera(75,1,.5,25);
 readonly controls:OrbitControls;
 readonly timer:RayGPUTimer;
 readonly observer:IntersectionObserver;
 readonly depthMaterial:T.RawShaderMaterial;
 readonly gbufferMaterial:T.RawShaderMaterial;
 readonly resolveMaterial:T.RawShaderMaterial;
 readonly displayMaterial:T.RawShaderMaterial;
 readonly fullscreen=new T.Scene();
 readonly fullscreenCamera=new T.Camera();
 readonly quad:T.Mesh;
 readonly gbuffer=new T.WebGLRenderTarget(WIDTH,HEIGHT,{count:3,type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true,stencilBuffer:false});
 readonly images=[colorTarget(),colorTarget(),colorTarget(),colorTarget()];
 readonly debug=colorTarget(DEBUG_WIDTH,1);
 lightTarget:T.WebGLRenderTarget;
 geometry:ShadowScene;
 state:ShadowState;
 inspection:ShadowInspection|null=null;
 reference:ShadowReference|null=null;
 referenceProgress=0;
 selected:[number,number]|null=null;
 selectedAlgorithm:ShadowState['algorithm']|null=null;
 paused=false;visible=true;disposed=false;contextLost=false;pending=true;
 lightDirty=true;gbufferDirty=true;resolveDirty=true;inspectionDirty=false;
 frameRequest=0;scheduleGeneration=0;referenceRequest=0;referenceGeneration=0;
 applyingCamera=false;
 private pointerStart:[number,number]=[0,0];

 constructor(public host:HTMLElement,state:ShadowState,public onReport:(report:ShadowReport)=>void) {
  this.state=structuredClone(state);
  this.renderer=new T.WebGLRenderer({alpha:false,antialias:false});
  if(!this.renderer.extensions.has('EXT_color_buffer_float')){
   this.renderer.dispose();throw new Error('本机缺少浮点 G-buffer，仍可阅读静态阴影说明。');
  }
  this.renderer.setPixelRatio(1);this.renderer.setClearColor(0x000000,0);
  this.renderer.domElement.setAttribute('aria-label','真实光栅阴影场景；拖动旋转相机，点击接收面检查光图采样');
  this.host.appendChild(this.renderer.domElement);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);
  this.controls.enableDamping=false;this.controls.minDistance=1;this.controls.maxDistance=35;
  this.lightCamera.position.set(-3.5,7,4.5);this.lightCamera.lookAt(0,0,0);this.lightCamera.updateMatrixWorld();
  this.depthMaterial=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:meshVertex,fragmentShader:depthFragment,side:T.DoubleSide,depthTest:true,depthWrite:true,blending:T.NoBlending});
  this.gbufferMaterial=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:meshVertex,fragmentShader:gbufferFragment,side:T.DoubleSide,depthTest:true,depthWrite:true,blending:T.NoBlending,uniforms:{uAlbedo:{value:new T.Color()},uObjectId:{value:0}}});
  this.lightTarget=this.createLightTarget(state.resolution);
  this.resolveMaterial=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:fullVertex,fragmentShader:resolveFragment,depthTest:false,depthWrite:false,uniforms:{
   tPosition:{value:this.gbuffer.textures[0]},tNormal:{value:this.gbuffer.textures[1]},tAlbedo:{value:this.gbuffer.textures[2]},tShadowDepth:{value:this.lightTarget.depthTexture},
   uLightView:{value:this.lightCamera.matrixWorldInverse},uLightProjection:{value:this.lightCamera.projectionMatrix},uLightWorld:{value:this.lightCamera.matrixWorld},uLightInvProjection:{value:this.lightCamera.projectionMatrixInverse},
   uNearFar:{value:new T.Vector2(.5,25)},uTanHalfFov:{value:1},uSearchNear:{value:.5},uBias:{value:state.bias},uFilterRadius:{value:state.filterRadius},uLightSize:{value:state.lightSize},
   uPlaneCorrection:{value:state.planeCorrection?1:0},uAlgorithm:{value:algorithmIndex(state)},uView:{value:0},uDebug:{value:0},uInspectUv:{value:new T.Vector2(.5,.5)},
  }});
  this.displayMaterial=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:fullVertex,fragmentShader:displayFragment,depthTest:false,depthWrite:false,uniforms:{uSource:{value:this.images[0].texture}}});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.resolveMaterial);this.quad.frustumCulled=false;this.fullscreen.add(this.quad);
  this.geometry=createShadowScene(this.state);this.bindMeshes();this.configureLight();this.applyCamera();this.resizeCanvas();
  this.timer=new RayGPUTimer(this.renderer.getContext() as WebGL2RenderingContext,(gpuMs,tag)=>{if(!this.disposed&&tag===this.renderKey())this.onReport({gpuMs});});
  this.controls.addEventListener('change',this.cameraChanged);
  this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);
  this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
  this.renderer.domElement.addEventListener('webglcontextlost',this.contextLostHandler);
  this.observer=new IntersectionObserver(([entry])=>{this.visible=entry.isIntersecting;if(this.visible)this.request();else this.cancelScheduled();});
  this.observer.observe(host);
  const gl=this.renderer.getContext(),deviceInfo=gl.getExtension('WEBGL_debug_renderer_info');
  const device=gl.getParameter(deviceInfo?deviceInfo.UNMASKED_RENDERER_WEBGL:gl.RENDERER);
  this.onReport({state:this.exportState(),pending:true,paused:false,triangles:this.geometry.triangleCount,device:'WebGL2 · '+String(device)});
  this.request();
 }

 private createLightTarget(resolution:number) {
  const target=new T.WebGLRenderTarget(resolution,resolution,{type:T.UnsignedByteType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true,stencilBuffer:false});
  const depth=new T.DepthTexture(resolution,resolution,T.UnsignedIntType);
  depth.format=T.DepthFormat;depth.minFilter=depth.magFilter=T.NearestFilter;depth.generateMipmaps=false;
  target.depthTexture=depth;
  return target;
 }
 private bindMeshes() {
  for(const mesh of this.geometry.meshes){
   const albedo=(mesh.material as T.MeshBasicMaterial).color.clone(),objectId=Number(mesh.userData.objectId);
   mesh.onBeforeRender=(_renderer,_scene,_camera,_geometry,material)=>{
    if(material!==this.gbufferMaterial)return;
    this.gbufferMaterial.uniforms.uAlbedo.value.copy(albedo);this.gbufferMaterial.uniforms.uObjectId.value=objectId;
    this.gbufferMaterial.uniformsNeedUpdate=true;
   };
  }
 }
 private configureLight() {
  this.lightCamera.fov=this.state.fov;this.lightCamera.updateProjectionMatrix();this.lightCamera.updateMatrixWorld();
  let minimum=Infinity;
  const point=new T.Vector3();
  for(const primitive of this.geometry.primitives)for(const vertex of [primitive.a,primitive.b,primitive.c]){
   point.set(...vertex).applyMatrix4(this.lightCamera.matrixWorldInverse);minimum=Math.min(minimum,-point.z);
  }
  // All real caster vertices participate. Do not discard vertices behind near:
  // triangles crossing near must retain the projection near as the lower bound.
  const bound=Math.max(this.lightCamera.near,Number.isFinite(minimum)?minimum:this.lightCamera.near);
  const u=this.resolveMaterial.uniforms;
  u.uSearchNear.value=bound;u.uTanHalfFov.value=Math.tan(T.MathUtils.degToRad(this.state.fov*.5));
  u.uBias.value=this.state.bias;u.uFilterRadius.value=this.state.filterRadius;u.uLightSize.value=this.state.lightSize;
  u.uPlaneCorrection.value=this.state.planeCorrection?1:0;u.uAlgorithm.value=algorithmIndex(this.state);
 }
 private applyCamera() {
  this.applyingCamera=true;this.camera.position.set(...this.state.camera.position);this.controls.target.set(...this.state.camera.target);
  this.camera.lookAt(this.controls.target);this.controls.update();this.camera.updateMatrixWorld();this.applyingCamera=false;
 }
 private resizeCanvas() {
  this.renderer.setSize(WIDTH*(this.state.compare?2:1),HEIGHT*(this.state.compare?2:1),false);
  this.host.style.aspectRatio='1.6';
 }
 private cameraChanged=()=>{
  if(this.applyingCamera||this.disposed)return;
  this.state.camera={position:this.camera.position.toArray() as Vec3,target:this.controls.target.toArray() as Vec3};
  this.clearSelection();this.gbufferDirty=true;this.invalidate();this.onReport({state:this.exportState()});this.request();
 };
 private pointerDown=(event:PointerEvent)=>{this.pointerStart=[event.clientX,event.clientY];};
 private pointerUp=(event:PointerEvent)=>{
  if(this.disposed||Math.hypot(event.clientX-this.pointerStart[0],event.clientY-this.pointerStart[1])>5)return;
  const box=this.renderer.domElement.getBoundingClientRect();
  let u=(event.clientX-box.left)/box.width,v=(event.clientY-box.top)/box.height;
  if(u<0||u>=1||v<0||v>=1)return;
  if(this.state.compare){
   const panel=Math.floor(v*2)*2+Math.floor(u*2);if(panel===3)return;
   const algorithm=(['hard','pcf','pcss'] as const)[panel];
   if(algorithm!==this.state.algorithm)this.update({...this.state,algorithm});
   u=(u*2)%1;v=(v*2)%1;
  }else if(this.state.view==='map')return;
  this.pick(u,1-v);
 };
 private contextLostHandler=(event:Event)=>{
  event.preventDefault();this.contextLost=true;this.paused=true;this.pending=false;this.cancelScheduled();this.clearSelection();
  this.onReport({ready:false,pending:false,paused:true,error:'图形上下文丢失，请重新载入阴影实验。'});
 };
 private renderKey(){return JSON.stringify(this.state);}
 private cancelScheduled(){this.scheduleGeneration++;cancelAnimationFrame(this.frameRequest);this.frameRequest=0;}
 private request(){
  if(this.disposed||this.contextLost||this.paused||!this.visible||this.frameRequest||!this.resolveDirty)return;
  const generation=this.scheduleGeneration;
  this.frameRequest=requestAnimationFrame(()=>{if(generation!==this.scheduleGeneration)return;this.frameRequest=0;if(!this.paused&&this.visible)this.render();});
 }
 private invalidate(){
  this.resolveDirty=true;this.pending=true;this.inspectionDirty=this.selected!==null;this.inspection=null;
  this.onReport({pending:true,inspection:null,gpuMs:null});
 }
 private clearSelection(){
  this.selected=null;this.selectedAlgorithm=null;this.inspection=null;this.inspectionDirty=false;this.cancelReference();
  this.onReport({inspection:null});
 }
 exportState(){return structuredClone(this.state);}
 update(input:ShadowState) {
  if(this.disposed)return;
  const next=structuredClone(input),previous=this.state;
  const geometryChanged=shadowGeometryKey(previous)!==shadowGeometryKey(next),cameraChanged=cameraKey(previous)!==cameraKey(next);
  const referenceChanged=shadowReferenceKey(previous)!==shadowReferenceKey(next);
  this.cancelScheduled();this.state=next;
  if(geometryChanged||cameraChanged)this.clearSelection();else if(referenceChanged)this.cancelReference();
  if(geometryChanged){this.geometry.dispose();this.geometry=createShadowScene(next);this.bindMeshes();this.lightDirty=true;this.gbufferDirty=true;}
  if(cameraChanged){this.applyCamera();this.gbufferDirty=true;}
  if(previous.resolution!==next.resolution){
   this.lightTarget.dispose();this.lightTarget=this.createLightTarget(next.resolution);this.resolveMaterial.uniforms.tShadowDepth.value=this.lightTarget.depthTexture;this.lightDirty=true;
  }
  if(previous.fov!==next.fov)this.lightDirty=true;
  this.configureLight();if(previous.compare!==next.compare)this.resizeCanvas();
  this.invalidate();this.onReport({state:this.exportState(),triangles:this.geometry.triangleCount});this.request();
 }
 setPaused(value:boolean) {
  if(this.disposed)return;this.cancelScheduled();this.paused=value;this.onReport({paused:value});if(!value)this.request();
 }
 step(){if(this.disposed||this.contextLost)return;this.cancelScheduled();this.render();}
 private pass(material:T.RawShaderMaterial,target:T.WebGLRenderTarget|null) {
  this.renderer.setScissorTest(false);this.renderer.setRenderTarget(target);
  this.quad.material=material;this.renderer.render(this.fullscreen,this.fullscreenCamera);
 }
 private render() {
  if(this.disposed||this.contextLost)return;
  this.camera.updateMatrixWorld();const begin=performance.now();this.timer.begin(this.renderKey());
  this.renderer.setScissorTest(false);this.renderer.setClearColor(0x000000,0);
  if(this.lightDirty){
   this.geometry.scene.overrideMaterial=this.depthMaterial;
   this.renderer.setRenderTarget(this.lightTarget);this.renderer.render(this.geometry.scene,this.lightCamera);this.lightDirty=false;
  }
  if(this.gbufferDirty){
   this.geometry.scene.overrideMaterial=this.gbufferMaterial;
   this.renderer.setRenderTarget(this.gbuffer);this.renderer.render(this.geometry.scene,this.camera);this.gbufferDirty=false;
  }
  this.geometry.scene.overrideMaterial=null;
  const u=this.resolveMaterial.uniforms;u.uDebug.value=0;
  if(this.state.compare){
   for(let algorithm=0;algorithm<3;algorithm++){u.uAlgorithm.value=algorithm;u.uView.value=this.state.view==='visibility'?1:0;this.pass(this.resolveMaterial,this.images[algorithm]);}
   u.uView.value=2;this.pass(this.resolveMaterial,this.images[3]);
  }else{
   u.uAlgorithm.value=algorithmIndex(this.state);u.uView.value=['lit','visibility','map'].indexOf(this.state.view);this.pass(this.resolveMaterial,this.images[0]);
  }
  u.uAlgorithm.value=algorithmIndex(this.state);this.timer.end();const cpuMs=performance.now()-begin;
  this.resolveDirty=false;this.pending=false;this.present();
  // Both GPU debug rendering and synchronous readback are outside the ordinary
  // rendering timing interval and happen only for an explicitly selected point.
  if(this.selected&&this.inspectionDirty)this.inspect();
  this.onReport({ready:true,pending:false,cpuMs,state:this.exportState()});
 }
 private present() {
  this.renderer.setRenderTarget(null);
  if(!this.state.compare){this.displayMaterial.uniforms.uSource.value=this.images[0].texture;this.pass(this.displayMaterial,null);return;}
  this.renderer.setScissorTest(true);this.quad.material=this.displayMaterial;
  for(let panel=0;panel<4;panel++){
   const x=(panel%2)*WIDTH,y=panel<2?HEIGHT:0;
   this.renderer.setViewport(x,y,WIDTH,HEIGHT);this.renderer.setScissor(x,y,WIDTH,HEIGHT);
   this.displayMaterial.uniforms.uSource.value=this.images[panel].texture;
   this.renderer.render(this.fullscreen,this.fullscreenCamera);
  }
  this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,WIDTH*2,HEIGHT*2);
 }
 pick(u=.5,v=.5) {
  if(this.disposed||this.contextLost||!Number.isFinite(u)||!Number.isFinite(v))return;
  this.cancelScheduled();
  this.cancelReference();
  this.selected=[(Math.min(WIDTH-1,Math.max(0,Math.floor(u*WIDTH)))+.5)/WIDTH,(Math.min(HEIGHT-1,Math.max(0,Math.floor(v*HEIGHT)))+.5)/HEIGHT];
  this.selectedAlgorithm=this.state.algorithm;this.inspectionDirty=true;
  if(this.resolveDirty)this.render();else {this.inspect();this.present();}
 }
 private inspect() {
  if(!this.selected)return;
  const u=this.resolveMaterial.uniforms;
  u.uInspectUv.value.set(...this.selected);u.uAlgorithm.value=algorithmIndex(this.state);u.uDebug.value=1;
  const data=new Float32Array(DEBUG_WIDTH*4);
  try{this.pass(this.resolveMaterial,this.debug);this.renderer.readRenderTargetPixels(this.debug,0,0,DEBUG_WIDTH,1,data);}finally{u.uDebug.value=0;}
  this.inspectionDirty=false;
  if(data[22]<.5){this.selected=null;this.inspection=null;this.onReport({inspection:null});return;}
  const position:Vec3=[data[0],data[1],data[2]],normal:Vec3=[data[4],data[5],data[6]];
  const searches=Math.max(0,Math.min(81,Math.round(data[18]))),filters=Math.max(0,Math.min(81,Math.round(data[19])));
  const samples:ShadowSample[]=[];
  for(let index=0;index<searches+filters;index++){
   const offset=(8+index*2)*4;
   samples.push({uv:[data[offset],data[offset+1]],depth:data[offset+2],receiver:data[offset+3],visible:data[offset+4],valid:data[offset+5]>.5,blocker:data[offset+6]>.5,stage:data[offset+7]<.5?'search':'filter'});
  }
  const covered=data[7]>.5,filterSamples=samples.filter(sample=>sample.stage==='filter');
  const independentlyAveraged=filters?evaluatePcf(filterSamples).visibility:covered&&data[15]===0?1:null;
  const map=cpuShadowTexelDepth(this.geometry.primitives,[data[8],data[9]],this.state.resolution,this.lightCamera.matrixWorld,this.lightCamera.projectionMatrixInverse,.5,25);
  this.inspection={uv:this.selected,position,normal,objectId:Math.round(data[3]),lightUv:[data[8],data[9]],receiverDepth:data[10],storedDepth:data[11],receiverDistance:data[12],storedDistance:data[13],visibility:data[14],blockerCount:Math.round(data[15]),blockerDistance:data[16],radiusTexels:data[17],searchRadiusTexels:data[20],covered,samples,cpuMapDepth:map?.depth??null,mapDepthError:map&&data[11]>=0?Math.abs(map.depth-data[11]):null,cpuVisibility:pointVisibility(position,normal,this.lightCamera.position.toArray() as Vec3,this.geometry.primitives),mathError:covered&&independentlyAveraged!==null?Math.abs(independentlyAveraged-data[14]):null};
  this.onReport({inspection:this.inspection});
 }
 generateReference() {
  if(this.disposed||this.contextLost||!this.inspection)return;
  this.cancelReference();
  const token=this.referenceGeneration,position=[...this.inspection.position] as Vec3,normal=[...this.inspection.normal] as Vec3,primitives=this.geometry.primitives;
  const center=this.lightCamera.position.toArray() as Vec3;
  const right=new T.Vector3().setFromMatrixColumn(this.lightCamera.matrixWorld,0).multiplyScalar(this.state.lightSize).toArray() as Vec3;
  const up=new T.Vector3().setFromMatrixColumn(this.lightCamera.matrixWorld,1).multiplyScalar(this.state.lightSize).toArray() as Vec3;
  const seed=this.state.seed;let count=0,total=0,checkpoint=0;
  const tick=()=>{
   if(this.disposed||token!==this.referenceGeneration)return;
   this.referenceRequest=0;
   for(let batch=0;batch<32&&count<1024;batch++){
    total+=areaLightVisibilitySample(position,normal,primitives,{center,u:right,v:up,index:count,capacity:1024,seed,nearEpsilon:1e-4});count++;
    if(count===512)checkpoint=total/512;
   }
   this.referenceProgress=count/1024;
   if(count<1024)this.referenceRequest=requestAnimationFrame(tick);
   else this.reference={value:total/count,checkpoint,convergence:Math.abs(total/count-checkpoint),samples:count};
   this.onReport({referenceProgress:this.referenceProgress,reference:this.reference});
  };
  this.referenceRequest=requestAnimationFrame(tick);
 }
 cancelReference() {
  this.referenceGeneration++;cancelAnimationFrame(this.referenceRequest);this.referenceRequest=0;
  this.reference=null;this.referenceProgress=0;
  if(!this.disposed)this.onReport({reference:null,referenceProgress:0});
 }
 dispose() {
  if(this.disposed)return;this.disposed=true;this.cancelScheduled();this.cancelReference();this.observer.disconnect();this.timer.dispose();this.controls.dispose();
  const canvas=this.renderer.domElement;canvas.removeEventListener('pointerdown',this.pointerDown);canvas.removeEventListener('pointerup',this.pointerUp);canvas.removeEventListener('webglcontextlost',this.contextLostHandler);
  this.geometry.dispose();this.lightTarget.dispose();this.gbuffer.dispose();for(const image of this.images)image.dispose();this.debug.dispose();
  this.depthMaterial.dispose();this.gbufferMaterial.dispose();this.resolveMaterial.dispose();this.displayMaterial.dispose();this.quad.geometry.dispose();this.renderer.dispose();canvas.remove();
 }
}
