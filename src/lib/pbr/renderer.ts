import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import sharedBrdf from '../../shaders/pbr/brdf.glsl?raw';
import sceneShader from '../../shaders/pbr/scene.glsl?raw';
import {RayGPUTimer} from '../ray/timer';
import {colorToLinear,evaluateBrdf,integralSample} from './brdf';
import {pbrIntegrandKey} from './state';
import type {BrdfTerms,PbrInspection,PbrIntegral,PbrReport,PbrState,Vec3} from './types';
const views=['beauty','diffuse','specular','d','f','g'];
const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
const display='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage;uniform float uExposure;uniform int uDiagnostic;void main(){vec3 value=max(texture(uImage,vUv).rgb,vec3(0.));if(uDiagnostic==0){value*=exp2(uExposure);value=value/(1.+value);}outColor=vec4(pow(value,vec3(1./2.2)),1.);}';
const target=(width:number,height:number)=>new T.WebGLRenderTarget(width,height,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
export class PbrRenderer {
 readonly renderer:T.WebGLRenderer;readonly camera=new T.PerspectiveCamera(42,1.6,.1,50);readonly controls:OrbitControls;
 readonly scene=new T.Scene();readonly screenCamera=new T.Camera();readonly quad:T.Mesh;
 readonly material:T.RawShaderMaterial;readonly display:T.RawShaderMaterial;readonly image=target(400,250);readonly debug=target(12,1);
 readonly observer:IntersectionObserver;readonly timer:RayGPUTimer;
 state:PbrState;inspection:PbrInspection|null=null;integral:PbrIntegral|null=null;selected:[number,number]|null=null;
 paused=false;pending=true;visible=true;disposed=false;lost=false;dirty=true;inspectDirty=false;applying=false;
 frameRequest=0;generation=0;integralRequest=0;integralGeneration=0;private pointer=[0,0];
 constructor(public host:HTMLElement,state:PbrState,public onReport:(report:PbrReport)=>void){
  this.state=structuredClone(state);this.renderer=new T.WebGLRenderer({alpha:false,antialias:false});
  if(!this.renderer.extensions.has('EXT_color_buffer_float')){this.renderer.dispose();throw Error('此设备缺少浮点缓冲，仍可阅读静态 BRDF 说明。');}
  this.renderer.setPixelRatio(1);this.renderer.setSize(400,250,false);this.host.style.aspectRatio='1.6';this.host.append(this.renderer.domElement);
  this.renderer.domElement.setAttribute('aria-label','PBR 材质球；拖动改变观察方向，点击实际像素检查 BRDF');
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.minDistance=1;this.controls.maxDistance=20;
  this.material=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:'precision highp float;precision highp int;\n'+sharedBrdf+'\n'+sceneShader,uniforms:{
   uInvProjection:{value:this.camera.projectionMatrixInverse},uCameraWorld:{value:this.camera.matrixWorld},uBaseColor:{value:new T.Vector3()},uLightDirection:{value:new T.Vector3()},uRoughness:{value:state.roughness},uMetallic:{value:state.metallic},uIntensity:{value:state.intensity},uCompare:{value:state.compare?1:0},uShadows:{value:1},uView:{value:0},uDebug:{value:0},uInspectUv:{value:new T.Vector2(.5,.5)},
  }});
  this.display=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:display,uniforms:{uImage:{value:this.image.texture},uExposure:{value:state.exposure},uDiagnostic:{value:0}}});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.material);this.quad.frustumCulled=false;this.scene.add(this.quad);
  this.timer=new RayGPUTimer(this.renderer.getContext() as WebGL2RenderingContext,(gpuMs,tag)=>{if(!this.disposed&&tag===pbrIntegrandKey(this.state))this.onReport({gpuMs});});
  this.applyCamera();this.uniforms();this.controls.addEventListener('change',this.cameraChanged);
  this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
  this.observer=new IntersectionObserver(([entry])=>{this.visible=entry.isIntersecting;if(this.visible)this.request();else this.cancelFrame();});this.observer.observe(host);
  const gl=this.renderer.getContext(),info=gl.getExtension('WEBGL_debug_renderer_info');
  this.onReport({state:this.exportState(),pending:true,paused:false,device:String(gl.getParameter(info?info.UNMASKED_RENDERER_WEBGL:gl.RENDERER))});this.request();
 }
 private uniforms(){
  const s=this.state,u=this.material.uniforms,az=s.lightAzimuth*Math.PI/180,el=s.lightElevation*Math.PI/180;
  u.uBaseColor.value.set(...colorToLinear(s.baseColor));u.uRoughness.value=s.roughness;u.uMetallic.value=s.metallic;u.uIntensity.value=s.intensity;
  u.uLightDirection.value.set(Math.sin(az)*Math.cos(el),Math.sin(el),Math.cos(az)*Math.cos(el));
  u.uCompare.value=s.compare?1:0;u.uShadows.value=s.shadows?1:0;u.uView.value=views.indexOf(s.view);
  this.display.uniforms.uExposure.value=s.exposure;this.display.uniforms.uDiagnostic.value=views.indexOf(s.view)>=3?1:0;
 }
 private applyCamera(){this.applying=true;this.camera.position.set(...this.state.camera.position);this.controls.target.set(...this.state.camera.target);this.camera.lookAt(this.controls.target);this.controls.update();this.camera.updateMatrixWorld();this.applying=false;}
 private cameraChanged=()=>{if(this.applying||this.disposed)return;this.state.camera={position:this.camera.position.toArray() as Vec3,target:this.controls.target.toArray() as Vec3};this.selected=null;this.invalidate();this.onReport({state:this.exportState()});this.request();};
 private pointerDown=(event:PointerEvent)=>{this.pointer=[event.clientX,event.clientY];};
 private pointerUp=(event:PointerEvent)=>{if(Math.hypot(event.clientX-this.pointer[0],event.clientY-this.pointer[1])>5)return;const box=this.renderer.domElement.getBoundingClientRect();this.pick((event.clientX-box.left)/box.width,1-(event.clientY-box.top)/box.height);};
 private contextLost=(event:Event)=>{event.preventDefault();this.lost=true;this.paused=true;this.cancelFrame();this.cancelIntegral();this.inspection=null;this.selected=null;this.onReport({ready:false,pending:false,paused:true,inspection:null,error:'图形上下文丢失，请重试材质实验。'});};
 private cancelFrame(){this.generation++;cancelAnimationFrame(this.frameRequest);this.frameRequest=0;}
 private request(){if(this.disposed||this.lost||this.paused||!this.visible||this.frameRequest||!this.dirty)return;const token=this.generation;this.frameRequest=requestAnimationFrame(()=>{if(token!==this.generation)return;this.frameRequest=0;if(!this.paused&&this.visible)this.render();});}
 private invalidate(){this.dirty=true;this.pending=true;this.inspectDirty=this.selected!==null;this.inspection=null;this.cancelIntegral();this.onReport({pending:true,inspection:null,gpuMs:null});}
 exportState(){return structuredClone(this.state);}
 update(input:PbrState){
  if(this.disposed)return;const previous=this.state,next=structuredClone(input),changed=pbrIntegrandKey(previous)!==pbrIntegrandKey(next);
  this.cancelFrame();this.state=next;
  if(JSON.stringify(previous.camera)!==JSON.stringify(next.camera)||previous.compare!==next.compare)this.selected=null;
  this.applyCamera();this.uniforms();
  if(changed)this.invalidate();else if(previous.view!==next.view){this.dirty=true;this.pending=true;this.onReport({pending:true});}
  this.onReport({state:this.exportState()});
  if(!changed&&!this.pending){this.present();return;}
  if(!changed&&this.paused&&previous.view!==next.view)this.render();else this.request();
 }
 setPaused(value:boolean){if(this.disposed)return;this.cancelFrame();this.paused=value;this.onReport({paused:value});if(!value)this.request();}
 step(){if(this.disposed||this.lost)return;this.cancelFrame();this.render();}
 private pass(material:T.RawShaderMaterial,destination:T.WebGLRenderTarget|null){this.quad.material=material;this.renderer.setRenderTarget(destination);this.renderer.render(this.scene,this.screenCamera);}
 private present(){this.pass(this.display,null);}
 private render(){
  if(this.disposed||this.lost)return;this.camera.updateMatrixWorld();const start=performance.now();this.timer.begin(pbrIntegrandKey(this.state));this.material.uniforms.uDebug.value=0;this.pass(this.material,this.image);this.timer.end();const cpuMs=performance.now()-start;
  this.dirty=false;this.pending=false;this.present();if(this.selected&&this.inspectDirty)this.inspect();this.onReport({ready:true,pending:false,cpuMs});
 }
 pick(u=.5,v=.5){
  if(this.disposed||this.lost||!Number.isFinite(u)||!Number.isFinite(v))return;this.cancelFrame();this.cancelIntegral();
  this.selected=[(Math.min(399,Math.max(0,Math.floor(u*400)))+.5)/400,(Math.min(249,Math.max(0,Math.floor(v*250)))+.5)/250];this.inspectDirty=true;
  if(this.dirty)this.render();else{this.inspect();this.present();}
 }
 private inspect(){
  if(!this.selected)return;const uniforms=this.material.uniforms;uniforms.uInspectUv.value.set(...this.selected);uniforms.uDebug.value=1;
  const data=new Float32Array(48);try{this.pass(this.material,this.debug);this.renderer.readRenderTargetPixels(this.debug,0,0,12,1,data);}finally{uniforms.uDebug.value=0;}
  this.inspectDirty=false;if(data[3]<0){this.selected=null;this.inspection=null;this.onReport({inspection:null});return;}
  const vec=(offset:number)=>Array.from(data.slice(offset,offset+3)) as Vec3;
  const material={baseColor:vec(44),roughness:data[7],metallic:data[19]},cpu=evaluateBrdf(material,vec(4),vec(32),vec(36));
  const terms:BrdfTerms={noL:data[8],noV:data[9],noH:data[10],voH:data[11],alpha:data[35],d:data[12],g1L:data[13],g1V:data[14],g:data[15],f0:vec(40),f:vec(16),diffuse:vec(20),specular:vec(24),brdf:vec(20).map((v,i)=>v+data[24+i]) as Vec3};
  const cpuRadiance=cpu.brdf.map(v=>v*data[27]*cpu.noL*data[23]) as Vec3;
  const expected=[cpu.d,cpu.g1L,cpu.g1V,cpu.g,...cpu.f,...cpu.diffuse,...cpu.specular,...cpuRadiance],actual=[terms.d,terms.g1L,terms.g1V,terms.g,...terms.f,...terms.diffuse,...terms.specular,...vec(28)];
  const error=Math.max(...expected.map((value,index)=>Math.abs(value-actual[index])/Math.max(1,Math.abs(value))));
  this.inspection={uv:this.selected,position:vec(0),normal:vec(4),objectId:data[3],material,viewDirection:vec(32),lightDirection:vec(36),visibility:data[23],intensity:data[27],terms,radiance:vec(28),cpu,cpuRadiance,maxRelativeError:error,valid:data[31]>.5&&Array.from(data).every(Number.isFinite)};
  this.onReport({inspection:this.inspection});
 }
 generateIntegral(){
  if(this.disposed||!this.inspection||this.inspection.terms.noV<=0)return;this.cancelIntegral();
  const token=this.integralGeneration,material=structuredClone(this.inspection.material),noV=this.inspection.terms.noV,samples=8192,d:Vec3=[0,0,0],s:Vec3=[0,0,0];let count=0,checkpoint:Vec3=[0,0,0];
  const tick=()=>{if(this.disposed||token!==this.integralGeneration)return;this.integralRequest=0;
   for(let batch=0;batch<256&&count<samples;batch++){const sample=integralSample(material,noV,count,samples);for(let c=0;c<3;c++){d[c]+=sample.diffuse[c];s[c]+=sample.specular[c];}count++;if(count===samples/2)checkpoint=d.map((v,c)=>(v+s[c])/count) as Vec3;}
   if(count<samples)this.integralRequest=requestAnimationFrame(tick);
   else{const diffuse=d.map(v=>v/samples) as Vec3,specular=s.map(v=>v/samples) as Vec3,total=diffuse.map((v,c)=>v+specular[c]) as Vec3;this.integral={diffuse,specular,total,samples,convergence:total.map((v,c)=>Math.abs(v-checkpoint[c])) as Vec3};}
   this.onReport({integral:this.integral,integralProgress:count/samples});
  };this.integralRequest=requestAnimationFrame(tick);
 }
 cancelIntegral(){this.integralGeneration++;cancelAnimationFrame(this.integralRequest);this.integralRequest=0;this.integral=null;if(!this.disposed)this.onReport({integral:null,integralProgress:0});}
 dispose(){if(this.disposed)return;this.disposed=true;this.cancelFrame();this.cancelIntegral();this.observer.disconnect();this.timer.dispose();this.controls.dispose();const canvas=this.renderer.domElement;canvas.removeEventListener('pointerdown',this.pointerDown);canvas.removeEventListener('pointerup',this.pointerUp);canvas.removeEventListener('webglcontextlost',this.contextLost);this.image.dispose();this.debug.dispose();this.material.dispose();this.display.dispose();this.quad.geometry.dispose();this.renderer.dispose();canvas.remove();}
}
