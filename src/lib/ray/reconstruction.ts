import * as T from 'three';
import query from '../../shaders/ray/query.glsl?raw';
import {gbuffer,temporal,atrous,compose} from '../../shaders/ray/reconstruction';
const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0,1);}';
const rt=(w:number,h:number,count=1)=>new T.WebGLRenderTarget(w,h,{count,type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:false});
export class Reconstruction {
 geometry:[T.WebGLRenderTarget,T.WebGLRenderTarget];history:[T.WebGLRenderTarget,T.WebGLRenderTarget];filtered:[T.WebGLRenderTarget,T.WebGLRenderTarget];direct:T.WebGLRenderTarget;
 geometryMaterial:T.RawShaderMaterial;temporalMaterial:T.RawShaderMaterial;atrousMaterial:T.RawShaderMaterial;composeMaterial:T.RawShaderMaterial;
 index=0;hasHistory=false;previousVP=new T.Matrix4();previousView=new T.Matrix4();lastFrame=-1;disposed=false;lastSpatial=false;
 constructor(public width:number,public height:number,public camera:T.PerspectiveCamera,uniforms:Record<string,T.IUniform>){
  this.geometry=[rt(width,height,4),rt(width,height,4)];this.history=[rt(width,height,2),rt(width,height,2)];this.filtered=[rt(width,height),rt(width,height)];this.direct=rt(width,height);
  const mat=(f:string,u:Record<string,T.IUniform>)=>new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:f,uniforms:u});
  this.geometryMaterial=mat(query+'\n'+gbuffer,{...uniforms,uInvProjection:{value:camera.projectionMatrixInverse},uCameraWorld:{value:camera.matrixWorld},uViewMatrix:{value:camera.matrixWorldInverse},uMovingObject:{value:-1},uPreviousOffset:{value:new T.Vector3()}});
  const samplers=(names:string[])=>Object.fromEntries(names.map(n=>[n,{value:null}]));
  this.temporalMaterial=mat(temporal,{...samplers(['uCurrent','uPosition','uNormal','uPreviousPoint','uOldPosition','uOldNormal','uOldAlbedo','uHistory','uMoments']),uPreviousViewProjection:{value:this.previousVP},uPreviousView:{value:this.previousView},uHasHistory:{value:0},uHistoryEnabled:{value:1}});
  this.atrousMaterial=mat(atrous,{...samplers(['uSource','uPosition','uNormal','uMoments']),uResolution:{value:new T.Vector2(width,height)},uStep:{value:1}});
  this.composeMaterial=mat(compose,{...samplers(['uRaw','uHistory','uFiltered','uDirect','uAlbedo','uMoments']),uView:{value:0}});
 }
 reset(){this.hasHistory=false;this.lastFrame=-1;this.lastSpatial=false;this.previousVP.identity();this.previousView.identity();}
 resize(w:number,h:number){w=Math.max(1,Math.floor(w));h=Math.max(1,Math.floor(h));if(w===this.width&&h===this.height)return;this.width=w;this.height=h;for(const t of [...this.geometry,...this.history,...this.filtered,this.direct])t.setSize(w,h);this.atrousMaterial.uniforms.uResolution.value.set(w,h);this.reset();}
 process(raw:T.Texture,out:T.WebGLRenderTarget,pass:(m:T.RawShaderMaterial,t:T.WebGLRenderTarget|null)=>void,options:{frame:number;history:boolean;spatial:boolean;view:number;movingObject:number;previousOffset:[number,number,number]}){
  if(this.disposed)throw new Error('Reconstruction was disposed.');
  // A display/readback request for the same sequence frame must not consume a
  // second noisy sample or exchange the ping-pong targets. Reset explicitly
  // before recomputing a changed integrand at an existing frame number.
  if(options.frame===this.lastFrame){this.present(out,pass,options.view);return;}
  const next=1-this.index,cur=this.geometry[next],old=this.geometry[this.index];
  if(this.lastFrame>=0&&options.frame!==this.lastFrame+1)this.hasHistory=false;
  this.camera.updateMatrixWorld();
  this.geometryMaterial.uniforms.uMovingObject.value=options.movingObject;this.geometryMaterial.uniforms.uPreviousOffset.value.set(...options.previousOffset);pass(this.geometryMaterial,cur);
  const u=this.temporalMaterial.uniforms;u.uCurrent.value=raw;u.uPosition.value=cur.textures[0];u.uNormal.value=cur.textures[1];u.uPreviousPoint.value=cur.textures[3];u.uOldPosition.value=old.textures[0];u.uOldNormal.value=old.textures[1];u.uOldAlbedo.value=old.textures[2];u.uHistory.value=this.history[this.index].textures[0];u.uMoments.value=this.history[this.index].textures[1];u.uHasHistory.value=this.hasHistory?1:0;u.uHistoryEnabled.value=options.history?1:0;pass(this.temporalMaterial,this.history[next]);
  let source=this.history[next].textures[0];const a=this.atrousMaterial.uniforms;a.uPosition.value=cur.textures[0];a.uNormal.value=cur.textures[1];a.uMoments.value=this.history[next].textures[1];
  if(options.spatial)for(let i=0;i<3;i++){a.uSource.value=source;a.uStep.value=2**i;pass(this.atrousMaterial,this.filtered[i%2]);source=this.filtered[i%2].texture;}
  const c=this.composeMaterial.uniforms;c.uRaw.value=raw;c.uHistory.value=this.history[next].textures[0];c.uFiltered.value=source;c.uDirect.value=this.direct.texture;c.uAlbedo.value=cur.textures[2];c.uMoments.value=this.history[next].textures[1];
  this.index=next;this.hasHistory=true;this.lastFrame=options.frame;this.lastSpatial=options.spatial;this.previousVP.multiplyMatrices(this.camera.projectionMatrix,this.camera.matrixWorldInverse);this.previousView.copy(this.camera.matrixWorldInverse);
  this.present(out,pass,options.view);
 }
 /** Display an already processed frame. This never changes moments, age or camera history. */
 present(out:T.WebGLRenderTarget,pass:(m:T.RawShaderMaterial,t:T.WebGLRenderTarget|null)=>void,view=0){if(this.disposed)throw new Error('Reconstruction was disposed.');if(this.lastFrame<0)return false;this.composeMaterial.uniforms.uView.value=view;pass(this.composeMaterial,out);return true;}
 /** First attachment is the actual displayed B, including with spatial filtering disabled. */
 getFilteredTarget():T.WebGLRenderTarget{return this.lastSpatial?this.filtered[0]:this.history[this.index];}
 dispose(){if(this.disposed)return;this.disposed=true;for(const t of [...this.geometry,...this.history,...this.filtered,this.direct])t.dispose();for(const m of [this.geometryMaterial,this.temporalMaterial,this.atrousMaterial,this.composeMaterial])m.dispose();}
}
