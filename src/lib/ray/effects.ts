import * as T from 'three';
import queryShader from '../../shaders/ray/query.glsl?raw';
import lightingShader from '../../shaders/ray/lighting.glsl?raw';
import effectsShader from '../../shaders/ray/effects.glsl?raw';
import type {SceneSnapshot} from './types';
import type {RayState} from './state';
export * from './effects-math';

export type RayEffectKind='shadowmap'|'pcss'|'ssr'|'mirror';
export type RayEffectState=Partial<RayState>&{effectDebug?:number;shadowMapSize?:number;ssrThickness?:number;ssrMaxDistance?:number};
const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}';
const target=(w:number,h:number)=>new T.WebGLRenderTarget(w,h,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});

/** Owns only effect resources. The caller retains renderer, camera and query textures.
 * update() after snapshot/state changes; resize() with per-panel resolution.
 * render() preserves framebuffer/viewport/scissor state and returns linear RGB.
 * alpha=0 means invalid query or absent shadow-map coverage, not a valid reference.
 */
export class RayEffects {
 readonly scene=new T.Scene();readonly viewCamera=new T.Camera();readonly lightCamera=new T.PerspectiveCamera(100,1,.04,100);
 readonly material:T.RawShaderMaterial;readonly quad:T.Mesh;
 readonly shadow=target(256,256);readonly position=target(320,200);readonly radiance=target(320,200);
 readonly dummy:T.DataTexture;
 state:RayEffectState;snapshot:SceneSnapshot;shadowDirty=true;gbufferDirty=true;disposed=false;cameraKey='';sceneKey='';
 readonly limitations={shadow:'中心透视光图覆盖以外 alpha=0；PCSS 是 blocker 平均深度与滤波近似。',ssr:'只访问当前相机可见深度；屏幕外、遮挡背后或未找到深度交叉返回环境，不能作为完整几何参考。',mirror:'y=0 单平面镜像相机参考；其他镜面朝向返回 alpha=0。'};
 constructor(readonly renderer:T.WebGLRenderer,snapshot:SceneSnapshot,readonly camera:T.PerspectiveCamera,queryUniforms:Record<string,T.IUniform>,state:RayEffectState={}){
  this.snapshot=snapshot;this.state={...state};
  this.dummy=new T.DataTexture(new Float32Array([0,0,0,-1]),1,1,T.RGBAFormat,T.FloatType);this.dummy.needsUpdate=true;
  this.material=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:queryShader+'\n'+lightingShader+'\n'+effectsShader,uniforms:{
   ...queryUniforms,uInvProjection:{value:camera.projectionMatrixInverse},uCameraWorld:{value:camera.matrixWorld},uEffectView:{value:camera.matrixWorldInverse},uEffectProjection:{value:camera.projectionMatrix},
   uLightInvProjection:{value:this.lightCamera.projectionMatrixInverse},uLightWorld:{value:this.lightCamera.matrixWorld},uLightView:{value:this.lightCamera.matrixWorldInverse},uLightProjection:{value:this.lightCamera.projectionMatrix},
   uLightNearFar:{value:new T.Vector2()},uLightHalfSize:{value:new T.Vector2()},uLightTanHalfFov:{value:new T.Vector2()},uEffectResolution:{value:new T.Vector2(320,200)},uShadowResolution:{value:new T.Vector2(256,256)},
   tEffectShadow:{value:this.dummy},tEffectPosition:{value:this.dummy},tEffectRadiance:{value:this.dummy},uEnvironment:{value:new T.Vector3()},uEffectPass:{value:3},uEffectDebug:{value:0},uLocalModel:{value:0},
   uRayMin:{value:state.tMin??1e-4},uRayMax:{value:state.tMax??50},uOffsetScale:{value:state.offsetScale??1},uSceneScale:queryUniforms.uSceneScale??{value:1},uSsrThickness:{value:.08},uSsrMaxDistance:{value:30},
  }});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.material);this.quad.frustumCulled=false;this.scene.add(this.quad);this.update(snapshot,state);
 }
 update(snapshot:SceneSnapshot,state:RayEffectState=this.state){
  const nextKey=JSON.stringify([snapshot.version,snapshot.frame,snapshot.primitives.length,snapshot.light,state.tMin,state.tMax,state.offsetScale,state.environment,state.lightSize,state.quality,state.shadowMapSize,state.lesson==='reflections'?state.view:null]);
  if(snapshot!==this.snapshot||nextKey!==this.sceneKey){this.shadowDirty=true;this.gbufferDirty=true;}
  this.snapshot=snapshot;this.state={...state};this.sceneKey=nextKey;
  const u=this.material.uniforms,light=snapshot.light;
  this.lightCamera.position.set(...light.center);this.lightCamera.up.set(...light.v).normalize();this.lightCamera.lookAt(new T.Vector3(...light.center).add(new T.Vector3(...light.normal)));
  this.lightCamera.far=Math.max(20,state.tMax??50);this.lightCamera.updateProjectionMatrix();this.lightCamera.updateMatrixWorld();
  u.uLightNearFar.value.set(this.lightCamera.near,this.lightCamera.far);
  u.uLightHalfSize.value.set(new T.Vector3(...light.u).length(),new T.Vector3(...light.v).length());
  const tan=Math.tan(T.MathUtils.degToRad(this.lightCamera.fov*.5));u.uLightTanHalfFov.value.set(tan*this.lightCamera.aspect,tan);
  u.uEnvironment.value.set(...snapshot.environment);u.uRayMin.value=state.tMin??1e-4;u.uRayMax.value=state.tMax??50;u.uOffsetScale.value=state.offsetScale??1;
  u.uEffectDebug.value=state.effectDebug??0;u.uLocalModel.value=state.lesson==='reflections'&&state.view===1?1:0;u.uSsrThickness.value=state.ssrThickness??.08;u.uSsrMaxDistance.value=Math.min(state.tMax??50,state.ssrMaxDistance??30);
  const size=Math.min(1024,Math.max(64,Math.floor(state.shadowMapSize??(state.quality==='low'?256:512))));
  if(this.shadow.width!==size){this.shadow.setSize(size,size);u.uShadowResolution.value.set(size,size);this.shadowDirty=true;}
 }
 resize(width:number,height:number){
  width=Math.max(1,Math.floor(width));height=Math.max(1,Math.floor(height));
  if(this.position.width!==width||this.position.height!==height){this.position.setSize(width,height);this.radiance.setSize(width,height);this.material.uniforms.uEffectResolution.value.set(width,height);this.gbufferDirty=true;}
 }
 private pass(mode:number,destination:T.WebGLRenderTarget){
  const u=this.material.uniforms;u.uEffectPass.value=mode;
  // Never bind a texture being written, even for an inactive uniform branch.
  u.tEffectShadow.value=destination===this.shadow?this.dummy:this.shadow.texture;
  u.tEffectPosition.value=destination===this.position?this.dummy:this.position.texture;
  u.tEffectRadiance.value=destination===this.radiance?this.dummy:this.radiance.texture;
  this.renderer.setRenderTarget(destination);this.renderer.setViewport(0,0,destination.width,destination.height);this.renderer.setScissorTest(false);this.renderer.render(this.scene,this.viewCamera);
 }
 render(kind:RayEffectKind,destination:T.WebGLRenderTarget):T.Texture {
  if(this.disposed)throw new Error('RayEffects was disposed.');
  this.resize(destination.width,destination.height);this.camera.updateMatrixWorld();
  const cameraKey=this.camera.matrixWorld.elements.join(',')+'|'+this.camera.projectionMatrix.elements.join(',');
  if(cameraKey!==this.cameraKey){this.gbufferDirty=true;this.cameraKey=cameraKey;}
  const previousTarget=this.renderer.getRenderTarget(),viewport=this.renderer.getViewport(new T.Vector4()),scissor=this.renderer.getScissor(new T.Vector4()),scissorTest=this.renderer.getScissorTest();
  try{
   if((kind==='shadowmap'||kind==='pcss')&&this.shadowDirty){this.pass(0,this.shadow);this.shadowDirty=false;}
   if(kind==='ssr'&&this.gbufferDirty){this.pass(1,this.position);this.pass(2,this.radiance);this.gbufferDirty=false;}
   this.pass(kind==='shadowmap'?3:kind==='pcss'?4:kind==='ssr'?5:6,destination);
  }finally{this.renderer.setRenderTarget(previousTarget);this.renderer.setViewport(viewport);this.renderer.setScissor(scissor);this.renderer.setScissorTest(scissorTest);}
  return destination.texture;
 }
 dispose(){if(this.disposed)return;this.disposed=true;this.shadow.dispose();this.position.dispose();this.radiance.dispose();this.material.dispose();this.quad.geometry.dispose();this.dummy.dispose();}
}
