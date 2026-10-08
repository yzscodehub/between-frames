import * as T from 'three';
import shared from '../../shaders/pbr/brdf.glsl?raw';
import ibl from '../../shaders/lighting/ibl.glsl?raw';
import transparency from '../../shaders/lighting/transparency.glsl?raw';
import {type LightingState} from './state';
import {BACKGROUND,composite,exactComposite,layersAt,weightedComposite,integrateEnvironment,type V3} from './math';
const vertex='precision highp float;in vec3 position;out vec2 vUv;void main(){vUv=position.xy*.5+.5;gl_Position=vec4(position.xy,0.,1.);}';
const target=(w:number,h:number,half=false)=>new T.WebGLRenderTarget(w,h,{type:half?T.HalfFloatType:T.FloatType,format:T.RGBAFormat,depthBuffer:false,minFilter:half?T.LinearFilter:T.NearestFilter,magFilter:half?T.LinearFilter:T.NearestFilter});
export interface LightingInspection {uv:[number,number];gpu:number[][];cpu?:number[][];layers?:ReturnType<typeof layersAt>;accum?:number[];reveal?:number;reference?:{low:V3;high:V3;convergence:number;error:number};normal?:V3}
export interface LightingReport {ready?:boolean;pending?:boolean;paused?:boolean;error?:string;device?:string;inspection?:LightingInspection|null;referenceRunning?:boolean;cpuMs?:number;gpuMs?:number|null;atlasBuilds?:number;state?:LightingState}
export class LightingRenderer {
 renderer:T.WebGLRenderer;scene=new T.Scene();camera=new T.Camera();quad:T.Mesh;material:T.RawShaderMaterial;
 image=target(480,160);debug=target(1,1);atlas=target(448,32,true);accum=target(160,160,true);reveal=target(160,160,true);sorted=target(160,160,true);
 observer:IntersectionObserver;state:LightingState;ready=false;paused=false;pending=true;visible=true;disposed=false;frame=0;generation=0;referenceTimer=0;atlasKey='';atlasBuilds=0;inspection:LightingInspection|null=null;selected:[number,number]|null=null;
 constructor(public host:HTMLElement,s:LightingState,public report:(patch:LightingReport)=>void){
 this.state=structuredClone(s);this.renderer=new T.WebGLRenderer({antialias:false,alpha:false});
 if(!this.renderer.extensions.has('EXT_color_buffer_float')){this.renderer.dispose();throw Error('缺少 EXT_color_buffer_float；正文、步骤与公式仍可阅读。');}
 this.renderer.setSize(480,160,false);this.renderer.setPixelRatio(1);this.renderer.autoClear=false;host.append(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label',s.kind==='ibl'?'左：256样本环境积分；中：预滤波近似；右：线性绝对差乘4':'左：对象中心排序；中：逐像素排序参考；右：WBOIT');
 const gl=this.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');report({device:String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER))});
 this.material=new T.RawShaderMaterial({glslVersion:T.GLSL3,vertexShader:vertex,fragmentShader:s.kind==='ibl'?'precision highp float;\n'+shared+'\n'+ibl:transparency,depthTest:false,depthWrite:false,uniforms:{uPass:{value:0},uPanel:{value:0},uLayer:{value:0},uCrossing:{value:1},uReverse:{value:0},uAlpha:{value:s.alpha},uPower:{value:s.power},uRoughness:{value:s.roughness},uEnvironment:{value:s.environment},uRotation:{value:s.rotation},uDiffuse:{value:0},uExposure:{value:s.exposure},uInspect:{value:new T.Vector2(.5,.5)},uAtlas:{value:this.atlas.texture},uAccum:{value:this.accum.texture},uReveal:{value:this.reveal.texture},uSorted:{value:this.sorted.texture},uImage:{value:this.image.texture}}});
 this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.material);this.quad.frustumCulled=false;this.scene.add(this.quad);
 this.renderer.domElement.addEventListener('click',this.clicked);this.renderer.domElement.addEventListener('webglcontextlost',this.lost);
 this.observer=new IntersectionObserver(([entry])=>{this.visible=entry.isIntersecting;if(this.visible)this.request();else{cancelAnimationFrame(this.frame);this.frame=0;}});this.observer.observe(host);this.update(s);
 }
 private pass(mode:number,destination:T.WebGLRenderTarget|null){
 // Active samplers must never point at the framebuffer attachment, even when
 // the current shader branch does not sample them.
 const detached:Array<[T.IUniform,unknown]>=[];
 for(const uniform of Object.values(this.material.uniforms))if(destination&&uniform.value===destination.texture){detached.push([uniform,uniform.value]);uniform.value=null;}
 this.material.uniforms.uPass.value=mode;this.material.uniformsNeedUpdate=true;
 this.renderer.setRenderTarget(destination);this.renderer.render(this.scene,this.camera);
 for(const [uniform,value] of detached)uniform.value=value;
 }
 private clear(destination:T.WebGLRenderTarget,r:number,g:number,b:number,a:number){this.renderer.setRenderTarget(destination);this.renderer.setClearColor(new T.Color().setRGB(r,g,b),a);this.renderer.clear();}
 private blend(mode:'off'|'add'|'over'|'reveal'){const m=this.material;m.transparent=mode!=='off';m.blending=mode==='off'?T.NoBlending:T.CustomBlending;m.blendEquation=T.AddEquation;m.blendSrc=mode==='reveal'?T.ZeroFactor:T.OneFactor;m.blendDst=mode==='add'?T.OneFactor:T.OneMinusSrcAlphaFactor;m.blendSrcAlpha=null;m.blendDstAlpha=null;m.blendEquationAlpha=null;}
 update(s:LightingState){
 const onlyExposure=this.ready&&JSON.stringify({...this.state,exposure:0})===JSON.stringify({...s,exposure:0});
 if(onlyExposure){this.state=structuredClone(s);this.material.uniforms.uExposure.value=s.exposure;this.report({state:this.state});if(!this.pending)this.pass(s.kind==='ibl'?2:4,null);return;}
 this.state=structuredClone(s);this.generation++;clearTimeout(this.referenceTimer);this.inspection=null;this.pending=true;const u=this.material.uniforms;for(const [key,val] of Object.entries({uAlpha:s.alpha,uPower:s.power,uCrossing:+s.crossing,uReverse:+s.reverse,uRoughness:s.roughness,uEnvironment:s.environment,uRotation:s.rotation,uDiffuse:+s.diffuse,uExposure:s.exposure}))u[key].value=val;this.report({state:this.state,pending:true,inspection:null,referenceRunning:false});this.request();}
 private request(){if(this.disposed||!this.pending||this.paused||!this.visible||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;try{this.render();}catch(e){this.report({error:String(e),pending:false,ready:false});}});}
 setPaused(value:boolean){this.paused=value;if(value){cancelAnimationFrame(this.frame);this.frame=0;}this.report({paused:value});if(!value)this.request();}
 step(){if(!this.disposed)this.render();}
 private render(){const start=performance.now(),s=this.state;this.blend('off');if(s.kind==='ibl'){
 const key=JSON.stringify([s.environment,s.rotation]);if(key!==this.atlasKey){this.pass(0,this.atlas);this.atlasKey=key;this.atlasBuilds++;}
 this.pass(1,this.image);this.pass(2,null);
 }else{
 const order=s.reverse?[0,1,2]:[2,1,0];this.clear(this.accum,0,0,0,0);this.blend('add');for(const id of order){this.material.uniforms.uLayer.value=id;this.pass(0,this.accum);}
 this.clear(this.reveal,1,1,1,1);this.blend('reveal');for(const id of order){this.material.uniforms.uLayer.value=id;this.pass(1,this.reveal);}
 this.clear(this.sorted,...BACKGROUND,1);this.blend('over');for(const id of order){this.material.uniforms.uLayer.value=id;this.pass(2,this.sorted);}
 this.blend('off');this.pass(3,this.image);this.pass(4,null);
 }
 this.pending=false;this.ready=true;this.report({ready:true,pending:false,cpuMs:performance.now()-start,atlasBuilds:this.atlasBuilds});if(this.selected)this.pick(...this.selected);
 }
 private read(mode:number,panel=0){const out=new Float32Array(4);this.material.uniforms.uPanel.value=panel;this.blend('off');this.pass(mode,this.debug);this.renderer.readRenderTargetPixels(this.debug,0,0,1,1,out);return Array.from(out);}
 pick(u=.5,v=.5){if(!this.ready||this.pending)return;clearTimeout(this.referenceTimer);this.generation++;this.report({referenceRunning:false});const uv:[number,number]=[(Math.min(159,Math.max(0,Math.floor(u*160)))+.5)/160,(Math.min(159,Math.max(0,Math.floor(v*160)))+.5)/160];this.selected=uv;this.material.uniforms.uInspect.value.set(...uv);
 const s=this.state,gpu=[0,1,2].map(p=>this.read(s.kind==='ibl'?3:5,p).slice(0,3));const inspection:LightingInspection={uv,gpu};
 if(s.kind==='transparency'){const layers=layersAt(...uv,s.alpha,s.crossing),order=[...layers].sort((a,b)=>s.reverse?a.id-b.id:b.id-a.id);inspection.layers=layers;inspection.cpu=[composite(order),exactComposite(layers),weightedComposite(layers,s.power).color];inspection.accum=this.read(6);inspection.reveal=this.read(7)[0];}
 else {const x=(uv[0]-.5)*2.4,y=(uv[1]-.5)*2.4,z=1-x*x-y*y;if(z>0)inspection.normal=[x,y,Math.sqrt(z)];}
 this.inspection=inspection;this.report({inspection});this.pass(s.kind==='ibl'?2:4,null);
 }
 generateReference(){if(this.state.kind!=='ibl'||!this.inspection?.normal||this.pending)return;const token=++this.generation,state=structuredClone(this.state),inspection=this.inspection,n=inspection.normal!;clearTimeout(this.referenceTimer);this.report({referenceRunning:true});this.referenceTimer=window.setTimeout(()=>{const low=integrateEnvironment(n,state.roughness,state.environment,state.rotation,state.diffuse,32768),high=integrateEnvironment(n,state.roughness,state.environment,state.rotation,state.diffuse,65536);if(this.disposed||token!==this.generation)return;inspection.reference={low,high,convergence:Math.max(...high.map((v,i)=>Math.abs(v-low[i]))),error:Math.max(...high.map((v,i)=>Math.abs(v-inspection.gpu[0][i])))};this.report({inspection:{...inspection},referenceRunning:false});},30);}
 cancelReference(){clearTimeout(this.referenceTimer);this.generation++;this.report({referenceRunning:false});}
 private clicked=(e:MouseEvent)=>{const b=this.renderer.domElement.getBoundingClientRect();this.pick(((e.clientX-b.left)/b.width*3)%1,1-(e.clientY-b.top)/b.height);};
 private lost=(e:Event)=>{e.preventDefault();this.setPaused(true);this.cancelReference();this.report({ready:false,pending:false,inspection:null,error:'WebGL 上下文丢失；请重试。'});};
 dispose(){this.disposed=true;cancelAnimationFrame(this.frame);clearTimeout(this.referenceTimer);this.generation++;this.observer.disconnect();this.renderer.domElement.removeEventListener('click',this.clicked);this.renderer.domElement.removeEventListener('webglcontextlost',this.lost);for(const t of [this.image,this.debug,this.atlas,this.accum,this.reveal,this.sorted])t.dispose();this.material.dispose();this.quad.geometry.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
