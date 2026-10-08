import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import meshVertex from '../../shaders/ssr/mesh.vert.glsl?raw';
import gbufferFragment from '../../shaders/ssr/gbuffer.frag.glsl?raw';
import resolveFragment from '../../shaders/ssr/resolve.glsl?raw';
import query from '../../shaders/ray/query.glsl?raw';
import {buildBVH} from '../ray/bvh';
import {packScene} from '../ray/pack';
import {traceBrute} from '../ray/geometry';
import {RayGPUTimer} from '../ray/timer';
import type {Vec3} from '../ray/types';
import {createSSRScene} from './scene';
import {localColor} from './math';
import {ssrGeometryKey} from './state';
import type {SSRInspection,SSRReport,SSRSample,SSRState} from './types';

const W=320,H=200,DEBUG=522;
const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
const display='precision highp float;in vec2 vUv;out vec4 outColor;uniform sampler2D uImage;void main(){vec4 c=texture(uImage,vUv);outColor=vec4(pow(max(c.rgb,vec3(0)),vec3(1./2.2)),1.);}';
const target=(w=W,h=H)=>new T.WebGLRenderTarget(w,h,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
function dataTexture(data:Float32Array,w:number,h:number){const texture=new T.DataTexture(data,w,Math.max(h,1),T.RGBAFormat,T.FloatType);texture.minFilter=texture.magFilter=T.NearestFilter;texture.needsUpdate=true;return texture;}

export class SSRRenderer {
 readonly renderer:T.WebGLRenderer;readonly camera=new T.PerspectiveCamera(45,1.6,.1,50);readonly controls:OrbitControls;readonly observer:IntersectionObserver;readonly timer:RayGPUTimer;
 readonly gbuffer=new T.WebGLRenderTarget(W,H,{count:3,type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:true});
 readonly images=[target(),target(),target(),target()];readonly debug=target(DEBUG,1);
 readonly gbufferMaterial:T.RawShaderMaterial;readonly resolve:T.RawShaderMaterial;readonly display:T.RawShaderMaterial;readonly fullscreen=new T.Scene();readonly screenCamera=new T.Camera();readonly quad:T.Mesh;
 geometry:ReturnType<typeof createSSRScene>;textures:T.DataTexture[]=[];state:SSRState;inspection:SSRInspection|null=null;selected:[number,number]|null=null;
 pending=true;paused=false;visible=true;disposed=false;contextLost=false;gbufferDirty=true;resolveDirty=true;inspectionDirty=false;frameRequest=0;generation=0;applyingCamera=false;pointerStart=[0,0];
 constructor(public host:HTMLElement,state:SSRState,public onReport:(report:SSRReport)=>void){
  this.state=structuredClone(state);this.renderer=new T.WebGLRenderer({antialias:false,alpha:false});if(!this.renderer.extensions.has('EXT_color_buffer_float')){this.renderer.dispose();throw new Error('本机缺少浮点 G-buffer，仍可阅读静态说明。');}
  this.renderer.setPixelRatio(1);this.renderer.setClearColor(0,0);host.appendChild(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','SSR 场景：拖动相机，点击地面镜检查实际步进');
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.minDistance=1;this.controls.maxDistance=30;
  this.gbuffer.depthTexture=new T.DepthTexture(W,H,T.UnsignedIntType);this.gbuffer.depthTexture.minFilter=this.gbuffer.depthTexture.magFilter=T.NearestFilter;
  this.gbufferMaterial=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:meshVertex,fragmentShader:gbufferFragment,side:T.DoubleSide,blending:T.NoBlending,uniforms:{uEye:{value:this.camera.position},uAlbedo:{value:new T.Color()},uObject:{value:0},uShading:{value:0}}});
  this.resolve=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:query+'\n'+resolveFragment,depthTest:false,depthWrite:false,uniforms:{
   tPosition:{value:this.gbuffer.textures[0]},tNormal:{value:this.gbuffer.textures[1]},tRadiance:{value:this.gbuffer.textures[2]},tDepth:{value:this.gbuffer.depthTexture},
   tNodes:{value:null},tPrimitives:{value:null},tMaterials:{value:null},uNodeCount:{value:0},uPrimitiveCount:{value:0},uTraversal:{value:1},uAnyHit:{value:0},uLogBudget:{value:0},
   uViewMatrix:{value:this.camera.matrixWorldInverse},uProjection:{value:this.camera.projectionMatrix},uCameraWorld:{value:this.camera.matrixWorld},uResolution:{value:new T.Vector2(W,H)},uNearFar:{value:new T.Vector2(.1,50)},uInspectUv:{value:new T.Vector2(.5,.3)},
   uStride:{value:1},uViewStep:{value:.25},uThickness:{value:.08},uRange:{value:24},uEpsilon:{value:.001},uSteps:{value:192},uMethod:{value:0},uShading:{value:0},uMode:{value:0},uDebug:{value:0},uEnvironment:{value:new T.Vector3(.035,.055,.08)},
  }});
  this.display=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:display,depthTest:false,depthWrite:false,uniforms:{uImage:{value:this.images[0].texture}}});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.resolve);this.quad.frustumCulled=false;this.fullscreen.add(this.quad);
  this.geometry=createSSRScene(this.state);this.installGeometry();this.applyCamera();this.configure();this.resize();
  this.timer=new RayGPUTimer(this.renderer.getContext() as WebGL2RenderingContext,(gpuMs,key)=>{if(!this.disposed&&key===JSON.stringify(this.state))this.onReport({gpuMs});});
  this.controls.addEventListener('change',this.cameraChanged);this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);this.renderer.domElement.addEventListener('pointerup',this.pointerUp);this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
  this.observer=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;if(this.visible)this.request();else this.cancel();});this.observer.observe(host);
  const gl=this.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');this.onReport({state:this.exportState(),pending:true,paused:false,triangles:this.geometry.snapshot.primitives.length,device:String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER))});this.request();
 }
 private installGeometry(){
  const packed=packScene(this.geometry.snapshot,buildBVH(this.geometry.snapshot.primitives,'sah'));this.textures.forEach(t=>t.dispose());this.textures=[dataTexture(packed.nodes,2,packed.nodeCount),dataTexture(packed.primitives,6,packed.primitiveCount),dataTexture(packed.materials,3,packed.materialCount)];
  const u=this.resolve.uniforms;[u.tNodes.value,u.tPrimitives.value,u.tMaterials.value]=this.textures;u.uNodeCount.value=packed.nodeCount;u.uPrimitiveCount.value=packed.primitiveCount;
  for(const mesh of this.geometry.meshes){const color=(mesh.material as T.MeshBasicMaterial).color.clone(),objectId=mesh.userData.objectId;mesh.onBeforeRender=(_r,_s,_c,_g,material)=>{if(material!==this.gbufferMaterial)return;this.gbufferMaterial.uniforms.uAlbedo.value.copy(color);this.gbufferMaterial.uniforms.uObject.value=objectId;this.gbufferMaterial.uniformsNeedUpdate=true;};}
 }
 private configure(){const s=this.state,u=this.resolve.uniforms;u.uStride.value=s.stride;u.uViewStep.value=s.viewStep;u.uThickness.value=s.thickness;u.uRange.value=s.range;u.uEpsilon.value=s.epsilon;u.uSteps.value=s.steps;u.uMethod.value=s.method==='screen'?0:1;u.uShading.value=s.shading==='flat'?0:1;this.gbufferMaterial.uniforms.uShading.value=u.uShading.value;}
 private applyCamera(){this.applyingCamera=true;this.camera.position.set(...this.state.camera.position);this.controls.target.set(...this.state.camera.target);this.camera.lookAt(this.controls.target);this.controls.update();this.camera.updateMatrixWorld();this.applyingCamera=false;}
 private resize(){this.renderer.setSize(W*(this.state.compare?2:1),H*(this.state.compare?2:1),false);this.host.style.aspectRatio='1.6';}
 private cameraChanged=()=>{if(this.applyingCamera||this.disposed)return;this.state.camera={position:this.camera.position.toArray() as Vec3,target:this.controls.target.toArray() as Vec3};this.selected=null;this.gbufferDirty=true;this.invalidate();this.onReport({state:this.exportState()});this.request();};
 private pointerDown=(e:PointerEvent)=>{this.pointerStart=[e.clientX,e.clientY];};
 private pointerUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-this.pointerStart[0],e.clientY-this.pointerStart[1])>5)return;const b=this.renderer.domElement.getBoundingClientRect();let u=(e.clientX-b.left)/b.width,v=1-(e.clientY-b.top)/b.height;if(this.state.compare){u=(u*2)%1;v=(v*2)%1;}this.pick(u,v);};
 private lost=(e:Event)=>{e.preventDefault();this.contextLost=true;this.paused=true;this.pending=false;this.cancel();this.inspection=null;this.onReport({ready:false,pending:false,paused:true,inspection:null,error:'图形上下文丢失，请重试实验。'});};
 private invalidate(){this.resolveDirty=true;this.pending=true;this.inspection=null;this.inspectionDirty=!!this.selected;this.onReport({pending:true,inspection:null,gpuMs:null});}
 private cancel(){this.generation++;cancelAnimationFrame(this.frameRequest);this.frameRequest=0;}
 private request(){if(this.disposed||this.contextLost||this.paused||!this.visible||this.frameRequest||!this.resolveDirty)return;const generation=this.generation;this.frameRequest=requestAnimationFrame(()=>{this.frameRequest=0;if(generation===this.generation&&!this.paused&&this.visible)this.render();});}
 update(next:SSRState){if(this.disposed)return;const old=this.state;this.cancel();this.state=structuredClone(next);const geometry=ssrGeometryKey(old)!==ssrGeometryKey(next),camera=JSON.stringify(old.camera)!==JSON.stringify(next.camera);
  if(geometry){this.geometry.dispose();this.geometry=createSSRScene(next);this.installGeometry();this.gbufferDirty=true;}
  if(camera){this.applyCamera();this.gbufferDirty=true;}if(old.shading!==next.shading)this.gbufferDirty=true;
  if(geometry||camera)this.selected=null;if(old.compare!==next.compare)this.resize();this.configure();this.invalidate();this.onReport({state:this.exportState(),triangles:this.geometry.snapshot.primitives.length});this.request();
 }
 exportState(){return structuredClone(this.state);}
 setPaused(paused:boolean){this.cancel();this.paused=paused;this.onReport({paused});if(!paused)this.request();}
 step(){if(this.disposed||this.contextLost)return;this.cancel();this.render();}
 private pass(material:T.RawShaderMaterial,target:T.WebGLRenderTarget|null){this.renderer.setScissorTest(false);this.renderer.setRenderTarget(target);this.quad.material=material;this.renderer.render(this.fullscreen,this.screenCamera);}
 private render(){if(this.disposed||this.contextLost)return;this.camera.updateMatrixWorld();const start=performance.now();this.timer.begin(JSON.stringify(this.state));this.renderer.setScissorTest(false);this.renderer.setClearColor(0,0);
  if(this.gbufferDirty){this.geometry.scene.overrideMaterial=this.gbufferMaterial;this.renderer.setRenderTarget(this.gbuffer);this.renderer.render(this.geometry.scene,this.camera);this.geometry.scene.overrideMaterial=null;this.gbufferDirty=false;}
  const u=this.resolve.uniforms;u.uDebug.value=0;
  if(this.state.compare){for(let i=0;i<4;i++){u.uMode.value=i;this.pass(this.resolve,this.images[i]);}}else{u.uMode.value=this.state.view==='status'?3:this.state.view==='depth'?4:0;this.pass(this.resolve,this.images[0]);}
  this.timer.end();const cpuMs=performance.now()-start;this.pending=false;this.resolveDirty=false;this.present();if(this.selected&&this.inspectionDirty)this.inspect();this.onReport({ready:true,pending:false,cpuMs,state:this.exportState()});
 }
 private present(){this.renderer.setRenderTarget(null);if(!this.state.compare){this.display.uniforms.uImage.value=this.images[0].texture;this.pass(this.display,null);return;}
  this.renderer.setScissorTest(true);this.quad.material=this.display;for(let i=0;i<4;i++){const x=i%2*W,y=i<2?H:0;this.renderer.setViewport(x,y,W,H);this.renderer.setScissor(x,y,W,H);this.display.uniforms.uImage.value=this.images[i].texture;this.renderer.render(this.fullscreen,this.screenCamera);}this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,W*2,H*2);
 }
 pick(u=.5,v=.24){if(this.disposed||this.contextLost||!Number.isFinite(u)||!Number.isFinite(v))return;this.selected=[(Math.min(W-1,Math.max(0,Math.floor(u*W)))+.5)/W,(Math.min(H-1,Math.max(0,Math.floor(v*H)))+.5)/H];this.inspectionDirty=true;if(this.resolveDirty)this.render();else{this.inspect();this.present();}}
 private inspect(){if(!this.selected)return;const u=this.resolve.uniforms;u.uInspectUv.value.set(...this.selected);u.uDebug.value=1;const data=new Float32Array(DEBUG*4);try{this.pass(this.resolve,this.debug);this.renderer.readRenderTargetPixels(this.debug,0,0,DEBUG,1,data);}finally{u.uDebug.value=0;}this.inspectionDirty=false;
  if(data[3]<0){this.inspection=null;this.onReport({inspection:null});return;}
  const vec=(at:number)=>Array.from(data.slice(at,at+3)) as Vec3,steps=Math.min(256,Math.round(data[11])),samples:SSRSample[]=[];for(let i=0;i<steps;i++){const at=(10+i*2)*4;samples.push({uv:[data[at],data[at+1]],rayDepth:data[at+2],sceneDepth:data[at+3],t:data[at+4],delta:data[at+5],kind:Math.round(data[at+6]),objectId:Math.round(data[at+7])});}
  const origin=vec(8),direction=vec(12),mirror=data[3]===0,cpu=mirror?traceBrute({origin,direction,tMin:1e-4,tMax:this.state.range},this.geometry.snapshot.primitives):null;
  const color=cpu?.hit?localColor(this.geometry.snapshot.materials[cpu.hit.materialId].albedo,cpu.hit.geometricNormal,direction,this.state.shading):this.geometry.snapshot.environment;
  const weighted=mirror?color.map((c,i)=>c*this.geometry.snapshot.materials[0].albedo[i]) as Vec3:vec(28),refColor=vec(28);
  this.inspection={uv:this.selected,position:vec(0),normal:vec(4),objectId:data[3],origin,direction,status:data[7],steps,hitPosition:vec(16),hitObjectId:data[19],hitUv:[data[20],data[21]],hitDistance:data[22],depthDelta:data[23],color:vec(32),reference:{status:data[31],position:vec(24),objectId:data[27],t:data[35],color:refColor},cpu:{hit:!!cpu?.hit,position:cpu?.hit?.position??null,objectId:cpu?.hit?.objectId??-1,t:cpu?.hit?.t??-1,color:weighted},referencePositionError:cpu?.hit&&data[31]===1?Math.hypot(...cpu.hit.position.map((v,i)=>v-data[24+i])):null,referenceColorError:Math.max(...weighted.map((v,i)=>Math.abs(v-refColor[i]))),samples};this.onReport({inspection:this.inspection});
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.cancel();this.observer.disconnect();this.timer.dispose();this.controls.dispose();const canvas=this.renderer.domElement;canvas.removeEventListener('pointerdown',this.pointerDown);canvas.removeEventListener('pointerup',this.pointerUp);canvas.removeEventListener('webglcontextlost',this.lost);this.geometry.dispose();this.textures.forEach(t=>t.dispose());this.gbuffer.dispose();this.images.forEach(t=>t.dispose());this.debug.dispose();this.gbufferMaterial.dispose();this.resolve.dispose();this.display.dispose();this.quad.geometry.dispose();this.renderer.dispose();canvas.remove();}
}
