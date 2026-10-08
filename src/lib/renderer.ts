import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import aoFragment from '../shaders/ao.glsl?raw';
import referenceFragment from '../shaders/reference.glsl?raw';
import {fullscreenVertex,normalVertex,normalFragment,filterFragment,displayFragment} from '../shaders/passes';
import {buildScene,disposeGeometry,sceneDescription,sceneCamera} from './scene';
import {type LabState,type View} from './state';
import {numericalSlice} from './math';
import {focusPoint} from './focus';
export interface SampleData {u:number;v:number;distance:number;value:number;surface:[number,number,number]|null;candidate:[number,number,number]|null}
export interface SliceData {gamma:number;low:number;high:number;length:number;gpu:number;numeric:number;samples:SampleData[]}
export interface Inspection {uv:[number,number];position:[number,number,number];normal:[number,number,number];slices:SliceData[];raw:number;error:number;algorithm:string}
export interface Metrics {mae:number;rmse:number;convergence:number;samples:number;local?:{mae:number;rmse:number;count:number;label:string}}
export interface FocusReport {uv:[number,number]|null;label:string;hint:string;visible:boolean}
export interface LabReport {ready:boolean;message?:string;inspection?:Inspection|null;metrics?:Metrics|null;progress?:number;cpuMs?:number;mode?:LabState['mode'];state?:LabState;size?:string;pending?:boolean;focus?:FocusReport}
const views:View[]=['beauty','ao','raw','depth','normal','reference','difference','compare','none'];
const target=(w:number,h:number,depth=false)=>{const t=new T.WebGLRenderTarget(w,h,{type:T.FloatType,format:T.RGBAFormat,minFilter:T.NearestFilter,magFilter:T.NearestFilter,depthBuffer:depth});if(depth)t.depthTexture=new T.DepthTexture(w,h,T.UnsignedIntType);return t;};
export class AORenderer {
 renderer:T.WebGLRenderer; camera=new T.PerspectiveCamera(45,1,.1,50); controls:OrbitControls;
 scene=new T.Scene(); group:T.Group; normalMaterial=new T.ShaderMaterial({vertexShader:normalVertex,fragmentShader:normalFragment,uniforms:{surfaceId:{value:1}}});
 screenScene=new T.Scene();screenCamera=new T.Camera();quad:T.Mesh;
 normal=target(1,1,true);raw=target(1,1);filtered=target(1,1);debug=target(75,8);comparisons=[target(1,1),target(1,1),target(1,1)];zoomTargets:(HTMLCanvasElement|null)[]=[];refs=[target(1,1),target(1,1)];checkpoint=target(1,1);
 ao:T.ShaderMaterial;filter:T.ShaderMaterial;display:T.ShaderMaterial;ref:T.ShaderMaterial;copy:T.ShaderMaterial;
 state:LabState; width=640;height=400; visible=true;paused=false;disposed=false;dirty=true;frame=0;benchmarkFrame=0; generation=0;referenceReady=false;referenceIndex=0; pendingReference:(()=>void)|null=null;
 selection:{object:T.Object3D;local:T.Vector3}|null=null; inspection:Inspection|null=null;metrics:Metrics|null=null;
 observer:ResizeObserver;intersection:IntersectionObserver;raycaster=new T.Raycaster();callback:(r:LabReport)=>void;
 focus:FocusReport={uv:null,label:'推荐位置',hint:'',visible:false};inspectionEnabled=true;renderedKey='';applyingCamera=false;
 pointerStart:[number,number]=[0,0]; lastCpu=0;
 constructor(public host:HTMLElement,state:LabState,onReport:(r:LabReport)=>void){
  this.callback=onReport;this.state=structuredClone(state);
  this.renderer=new T.WebGLRenderer({antialias:false,alpha:false});
  if(!this.renderer.extensions.has('EXT_color_buffer_float')){this.renderer.dispose();throw new Error('此设备不支持浮点调试缓冲。请使用静态示意或换一个支持 WebGL2 的浏览器。');}
  this.renderer.setPixelRatio(1);this.renderer.setClearColor(0,0);host.appendChild(this.renderer.domElement);this.renderer.domElement.setAttribute('aria-label','可交互 AO 场景：拖动旋转，点击表面检查');
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=false;this.controls.minDistance=2;this.controls.maxDistance=18;this.controls.maxPolarAngle=Math.PI*.49;
  this.group=buildScene(state.scene,state.lift,this.normalMaterial);this.scene.add(this.group);
  const common={tDepth:{value:this.normal.depthTexture},tNormal:{value:this.normal.texture},inverseProjection:{value:this.camera.projectionMatrixInverse},projection:{value:this.camera.projectionMatrix},resolution:{value:new T.Vector2()},radius:{value:state.radius},seed:{value:state.seed},slices:{value:state.slices},steps:{value:state.steps},algorithm:{value:0},debugMode:{value:0},inspectUv:{value:new T.Vector2()}};
  this.ao=new T.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:aoFragment,uniforms:common});
  this.filter=new T.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:filterFragment,uniforms:{...common,source:{value:this.raw.texture}}});
  this.display=new T.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:displayFragment,uniforms:{...common,source:{value:this.filtered.texture},rawAO:{value:this.raw.texture},reference:{value:this.refs[0].texture},cameraWorld:{value:this.camera.matrixWorld},view:{value:0},selected:{value:new T.Vector2(-1,-1)},focusUv:{value:new T.Vector2(-1,-1)},focusHalf:{value:new T.Vector2(.12/1.6,.12)},aspect:{value:1.6}}});
  this.ref=new T.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:referenceFragment,uniforms:{...common,cameraWorld:{value:this.camera.matrixWorld},previous:{value:this.refs[0].texture},batch:{value:0},sceneId:{value:0},sphere:{value:new T.Vector4()},boxCount:{value:0},boxCenters:{value:Array.from({length:24},()=>new T.Vector3())},boxSizes:{value:Array.from({length:24},()=>new T.Vector3())}}});
  this.copy=new T.ShaderMaterial({vertexShader:fullscreenVertex,fragmentShader:'varying vec2 vUv;uniform sampler2D source;void main(){gl_FragColor=texture2D(source,vUv);}',uniforms:{source:{value:null}}});
  this.quad=new T.Mesh(new T.PlaneGeometry(2,2),this.ao);this.quad.frustumCulled=false;this.screenScene.add(this.quad);
  this.applyCamera();this.controls.addEventListener('change',this.onCamera);
  this.renderer.domElement.addEventListener('pointerdown',this.onDown);this.renderer.domElement.addEventListener('pointerup',this.onUp);
  this.renderer.domElement.addEventListener('webglcontextlost',this.onLost);this.renderer.domElement.addEventListener('webglcontextrestored',this.onRestored);
  this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
  this.intersection=new IntersectionObserver(([e])=>{this.visible=e.isIntersecting;if(this.visible){this.request();if(this.pendingReference){const resume=this.pendingReference;this.pendingReference=null;this.benchmarkFrame=requestAnimationFrame(resume);}}});this.intersection.observe(host);
  this.resize();this.update(state);onReport({ready:true,size:`${this.width} × ${this.height}`});
 }
 onLost=(e:Event)=>{e.preventDefault();this.paused=true;this.invalidateReference();this.callback({ready:false,message:'图形上下文已丢失。正文仍可阅读；请点“重试”重新初始化实验。'});};
 onRestored=()=>this.callback({ready:false,message:'图形上下文已恢复，请点“重试”重新创建实验资源。'});
 onDown=(e:PointerEvent)=>{this.pointerStart=[e.clientX,e.clientY]};
 onUp=(e:PointerEvent)=>{if(Math.hypot(e.clientX-this.pointerStart[0],e.clientY-this.pointerStart[1])>5||this.state.mode==='benchmark'||this.state.view==='compare'||!this.inspectionEnabled)return;const r=this.renderer.domElement.getBoundingClientRect();this.pick((e.clientX-r.left)/r.width,1-(e.clientY-r.top)/r.height);};
 onCamera=()=>{if(this.applyingCamera||this.state.mode!=='explore')return;this.state.camera={position:this.camera.position.toArray() as [number,number,number],target:this.controls.target.toArray() as [number,number,number]};this.callback({ready:true,state:this.exportState()});this.request();};
 applyCamera(){this.applyingCamera=true;this.camera.position.set(...this.state.camera.position);this.controls.target.set(...this.state.camera.target);this.camera.lookAt(this.controls.target);this.camera.updateMatrixWorld();this.controls.update();this.applyingCamera=false;}
 resize(){const rect=this.host.getBoundingClientRect();const w=this.state.mode==='benchmark'?320:Math.min(1280,Math.max(240,Math.round(rect.width*Math.min(window.devicePixelRatio||1,1.5))));const h=Math.round(w/1.6);if(w===this.width&&h===this.height&&this.normal.width>1)return;this.width=w;this.height=h;this.renderer.setSize(w,h,false);for(const t of [this.normal,this.raw,this.filtered,...this.comparisons,...this.refs,this.checkpoint])t.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.ao.uniforms.resolution.value.set(w,h);this.invalidateReference();this.callback({ready:true,size:`${w} × ${h}`});this.request();}
 invalidateReference(){this.generation++;this.pendingReference=null;cancelAnimationFrame(this.benchmarkFrame);this.referenceReady=false;this.metrics=null;if(['reference','difference'].includes(this.state.view))this.state.view='ao';this.callback({ready:true,metrics:null,progress:0});if(this.paused&&this.quad)this.present();}
 update(next:LabState,options:{restore?:boolean}={}){
  const old=this.state;let n=structuredClone(next);
  const geometryChanged=old.scene!==n.scene||old.lift!==n.lift;
  if(!options.restore&&old.mode==='benchmark'&&geometryChanged){n.mode='explore';n.view='ao';this.callback({ready:true,mode:'explore',message:'几何条件改变，已退出固定基准。'});}
  if(!options.restore&&n.mode==='benchmark'&&(old.mode!=='benchmark'||this.normal.width===1)){n.lift=0;n.camera=sceneCamera(n.scene);this.selection=null;this.inspection=null;this.callback({ready:true,inspection:null});}
  if(n.mode!=='benchmark'&&['reference','difference'].includes(n.view))n.view='ao';
  if(n.view==='compare'&&n.mode==='inspect')n.mode='explore';
  const rebuild=old.scene!==n.scene||old.lift!==n.lift;
  const cameraChanged=JSON.stringify(old.camera)!==JSON.stringify(n.camera);
  const calculationChanged=this.resultKey(old)!==this.resultKey(n);
  this.state=n;
  if(rebuild){const selectedIndex=this.selection?this.group.children.indexOf(this.selection.object):-1;const local=this.selection?.local.clone();this.scene.remove(this.group);disposeGeometry(this.group);this.group=buildScene(n.scene,n.lift,this.normalMaterial);this.scene.add(this.group);if(old.scene===n.scene&&selectedIndex>=0&&local){this.selection={object:this.group.children[selectedIndex],local};}else{this.selection=null;this.inspection=null;if(n.mode==='inspect')n.mode='explore';this.callback({ready:true,inspection:null});}}
  if(old.mode!==n.mode||old.radius!==n.radius||rebuild||cameraChanged)this.invalidateReference();
  if(calculationChanged){this.metrics=null;this.inspection=null;this.callback({ready:true,metrics:null,inspection:null,pending:true});}
  if(this.paused&&(old.view!==n.view||old.comparison!==n.comparison||old.focus!==n.focus)){this.metrics=null;this.callback({ready:true,metrics:null,pending:true});}
  this.controls.enabled=n.mode==='explore';this.applyCamera();this.resize();this.ao.uniforms.radius.value=n.radius;this.ao.uniforms.seed.value=n.seed;this.ao.uniforms.slices.value=n.slices;this.ao.uniforms.steps.value=n.steps;this.ao.uniforms.algorithm.value=this.algorithmIndex();
  if(n.mode==='explore'){this.selection=null;this.inspection=null;this.callback({ready:true,inspection:null});}
  this.callback({ready:true,state:this.exportState()});this.request();
 }
 resultKey(s:LabState=this.state){return JSON.stringify([s.scene,s.lift,s.radius,s.slices,s.steps,s.seed,s.algorithm,s.filter,s.camera]);}
 restoreState(next:LabState){this.update(next,{restore:true});}
 exportState(){return structuredClone(this.state);}
 request(){this.dirty=true;if(this.disposed||!this.visible||this.paused||this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.render()});}
 pass(material:T.ShaderMaterial,out:T.WebGLRenderTarget|null){this.quad.material=material;this.renderer.setRenderTarget(out);this.renderer.render(this.screenScene,this.screenCamera);}
 render(){if(this.disposed)return;const started=performance.now();this.camera.updateMatrixWorld();this.renderer.setRenderTarget(this.normal);this.renderer.clear();this.renderer.render(this.scene,this.camera);this.ao.uniforms.debugMode.value=0;
  if(this.state.view==='compare'){
    [1,2,0].forEach((algorithm,i)=>{
      this.ao.uniforms.algorithm.value=algorithm;this.pass(this.ao,this.raw);
      if(this.state.filter)this.pass(this.filter,this.comparisons[i]);
      else{this.copy.uniforms.source.value=this.raw.texture;this.pass(this.copy,this.comparisons[i]);}
    });
    this.ao.uniforms.algorithm.value=this.algorithmIndex();
  }
  this.pass(this.ao,this.raw);this.pass(this.filter,this.filtered);this.lastCpu=performance.now()-started;this.dirty=false;this.renderedKey=this.resultKey();
  if(this.selection)this.readInspection();else this.display.uniforms.selected.value.set(-1,-1);
  this.updateFocus();if(this.referenceReady)this.computeMetrics();this.present();this.callback({ready:true,cpuMs:this.lastCpu,pending:false});
 }
 algorithmIndex(){return this.state.algorithm==='gtao'?0:this.state.algorithm==='ssao'?1:2;}
 setZoomTargets(canvases:(HTMLCanvasElement|null)[]){this.zoomTargets=canvases;this.request();}
 updateFocus(){
  const point=focusPoint(this.state.scene,this.state.focus),world=new T.Vector3(...point.position);
  let uv:[number,number]|null=null,visible=false;
  if(this.inspection){uv=this.inspection.uv;visible=true;}
  else{
    const clip=world.clone().project(this.camera);uv=[clip.x*.5+.5,clip.y*.5+.5];
    if(clip.z>=-1&&clip.z<=1&&uv[0]>=0&&uv[0]<=1&&uv[1]>=0&&uv[1]<=1){
      this.raycaster.setFromCamera(new T.Vector2(clip.x,clip.y),this.camera);
      const hit=this.raycaster.intersectObjects(this.group.children)[0];visible=!!hit&&hit.point.distanceTo(world)<.07;
    }
  }
  this.focus={uv:visible?uv:null,visible,label:this.inspection?'选中表面点':point.label,hint:point.hint};
  const box=this.roiBox();
  this.display.uniforms.focusUv.value.set(...(box?[(box.x+box.size/2)/this.width,(box.y+box.size/2)/this.height] as [number,number]:[-1,-1] as [number,number]));
  this.display.uniforms.focusHalf.value.set(box?box.size/this.width/2:0,box?box.size/this.height/2:0);
  this.callback({ready:true,focus:this.focus});
 }
 pickFocus(){this.render();const uv=this.focus.uv??[.5,.38];this.pick(uv[0],uv[1]);}

 present(){
  this.display.uniforms.source.value=this.state.filter?this.filtered.texture:this.raw.texture;
  this.display.uniforms.reference.value=this.refs[this.referenceIndex].texture;
  this.display.uniforms.view.value=views.indexOf(this.state.view);
  if(!this.referenceReady&&['reference','difference'].includes(this.state.view))this.display.uniforms.view.value=1;
  if(this.state.view==='compare'){
    this.renderer.setRenderTarget(null);this.renderer.setScissorTest(true);
    for(let i=0;i<4;i++){
      const x=(i%2)*this.width/2,y=i<2?this.height/2:0;
      this.renderer.setViewport(x,y,this.width/2,this.height/2);this.renderer.setScissor(x,y,this.width/2,this.height/2);
      this.display.uniforms.source.value=i<3?this.comparisons[i].texture:this.refs[this.referenceIndex].texture;
      this.display.uniforms.view.value=i<3||this.referenceReady?(this.state.comparison==='ao'?1:0):10;
      this.quad.material=this.display;this.renderer.render(this.screenScene,this.screenCamera);
    }
    this.renderer.setScissorTest(false);this.renderer.setViewport(0,0,this.width,this.height);
  }else this.pass(this.display,null);
  this.drawLocalViews();
 }
 roiBox(){
  if(!this.focus.uv)return null;const size=Math.max(1,Math.round(this.height*.24)),uv=this.focus.uv;
  return {size,x:Math.max(0,Math.min(this.width-size,Math.round(uv[0]*this.width-size/2))),y:Math.max(0,Math.min(this.height-size,Math.round(uv[1]*this.height-size/2)))};
 }
 drawLocalViews(){
  const compare=this.state.view==='compare';
  this.zoomTargets.forEach((canvas,i)=>{
    if(!canvas)return;const ctx=canvas.getContext('2d');if(!ctx)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    if(!this.focus.uv||(compare&&i===3&&!this.referenceReady))return;
    if(!compare&&i>0)return;
    const w=compare?this.width/2:this.width,h=compare?this.height/2:this.height;
    const box=this.roiBox()!,scale=compare?.5:1,side=box.size*scale,x=box.x*scale,y=(this.height-box.y-box.size)*scale;
    const ox=compare?(i%2)*w:0,oy=compare&&i>=2?h:0;
    ctx.imageSmoothingEnabled=false;ctx.drawImage(this.renderer.domElement,ox+x,oy+y,side,side,0,0,canvas.width,canvas.height);
  });
 }

 setPaused(paused:boolean){this.paused=paused;if(!paused)this.request();}
 step(){this.render();}
 pick(u=.5,v=.38){if(this.state.mode==='benchmark'||!this.inspectionEnabled)return;if(this.state.view==='compare')this.state.view='beauty';this.render();this.raycaster.setFromCamera(new T.Vector2(u*2-1,v*2-1),this.camera);const hit=this.raycaster.intersectObjects(this.group.children)[0];if(!hit){this.callback({ready:true,message:'这里没有可检查的表面，请重新选点。'});return;}this.selection={object:hit.object,local:hit.object.worldToLocal(hit.point.clone())};this.state.mode='inspect';this.controls.enabled=false;this.callback({ready:true,mode:'inspect',state:this.exportState(),message:'相机已冻结。橙色圆环标出选中像素。'});this.readInspection();this.updateFocus();this.present();}
 readInspection(){if(!this.selection)return;const world=this.selection.object.localToWorld(this.selection.local.clone()),ndc=world.clone().project(this.camera);const u=(ndc.x+1)/2,v=(ndc.y+1)/2;
  this.raycaster.setFromCamera(new T.Vector2(ndc.x,ndc.y),this.camera);const hit=this.raycaster.intersectObjects(this.group.children)[0];if(u<0||u>=1||v<0||v>=1||!hit||hit.object!==this.selection.object||hit.point.distanceTo(world)>.06){this.selection=null;this.inspection=null;this.state.mode='explore';this.controls.enabled=true;this.callback({ready:true,inspection:null,mode:'explore',state:this.exportState(),message:'选中的表面已不可见，请重新选点。'});return;}
  const x=Math.floor(u*this.width),y=Math.floor(v*this.height),uv=new T.Vector2((x+.5)/this.width,(y+.5)/this.height);this.ao.uniforms.inspectUv.value.copy(uv);this.ao.uniforms.debugMode.value=1;this.pass(this.ao,this.debug);this.ao.uniforms.debugMode.value=0;
  const buffer=new Float32Array(75*8*4);this.renderer.readRenderTargetPixels(this.debug,0,0,75,8,buffer);const ao=new Float32Array(4);this.renderer.readRenderTargetPixels(this.raw,x,y,1,1,ao);
  const rows:SliceData[]=[];for(let row=0;row<this.state.slices;row++){const off=row*75*4,[gamma,low,high,length]=buffer.slice(off,off+4);const gpu=buffer[off+4],numeric=numericalSlice(gamma,low,high,length);const samples=[];for(let j=0;j<this.state.steps*2;j++){const o=off+(3+j*3)*4;samples.push({u:buffer[o],v:buffer[o+1],distance:buffer[o+2],value:buffer[o+3],surface:buffer[o+7]>.5?[buffer[o+4],buffer[o+5],buffer[o+6]] as [number,number,number]:null,candidate:buffer[o+11]>.5?[buffer[o+8],buffer[o+9],buffer[o+10]] as [number,number,number]:null});}rows.push({gamma,low,high,length,gpu,numeric,samples});}
  this.inspection={uv:[uv.x,uv.y],position:[buffer[5],buffer[6],buffer[7]],normal:[buffer[8],buffer[9],buffer[10]],slices:rows,raw:ao[0],error:Math.max(...rows.map(r=>Math.abs(r.gpu-r.numeric))),algorithm:this.state.algorithm};this.display.uniforms.selected.value.copy(uv);this.callback({ready:true,inspection:this.inspection});
 }
 async generateReference(){if(this.state.mode!=='benchmark')return;this.render();this.invalidateReference();const token=this.generation;const spec=sceneDescription(this.state.scene,this.state.lift);this.ref.uniforms.sceneId.value=['contact','corner','thin','layers'].indexOf(this.state.scene);this.ref.uniforms.sphere.value.set(...spec.sphere);this.ref.uniforms.boxCount.value=spec.boxes.length;spec.boxes.forEach((b,i)=>{this.ref.uniforms.boxCenters.value[i].set(...b.center);this.ref.uniforms.boxSizes.value[i].set(...b.size)});
  let batch=0;const run=()=>{if(this.disposed||token!==this.generation)return;if(!this.visible){this.pendingReference=run;return;}const out=batch%2;this.ref.uniforms.batch.value=batch;this.ref.uniforms.previous.value=this.refs[1-out].texture;this.pass(this.ref,this.refs[out]);this.referenceIndex=out;if(batch===15){this.copy.uniforms.source.value=this.refs[out].texture;this.pass(this.copy,this.checkpoint);}batch++;this.callback({ready:true,progress:batch/32});this.present();if(batch<32)this.benchmarkFrame=requestAnimationFrame(run);else{this.referenceReady=true;this.computeMetrics();this.callback({ready:true,message:'1024 样本参考已生成。512→1024 的变化是收敛诊断，不是误差上界。'});this.present();}};this.benchmarkFrame=requestAnimationFrame(run);
 }
 computeMetrics(){
  if(!this.referenceReady||this.renderedKey!==this.resultKey()||this.dirty)return;
  const total=this.width*this.height*4,a=new Float32Array(total),r=new Float32Array(total),c=new Float32Array(total);
  this.renderer.readRenderTargetPixels(this.state.filter?this.filtered:this.raw,0,0,this.width,this.height,a);
  this.renderer.readRenderTargetPixels(this.refs[this.referenceIndex],0,0,this.width,this.height,r);
  this.renderer.readRenderTargetPixels(this.checkpoint,0,0,this.width,this.height,c);
  let abs=0,squared=0,conv=0,count=0,localAbs=0,localSquared=0,localCount=0;
  const box=this.roiBox();
  for(let i=0;i<total;i+=4){
    if(r[i+3]<.5)continue;const d=a[i]-r[i];abs+=Math.abs(d);squared+=d*d;conv+=Math.abs(r[i]-c[i]);count++;
    const px=(i/4)%this.width,py=Math.floor(i/4/this.width);
    if(box&&px>=box.x&&px<box.x+box.size&&py>=box.y&&py<box.y+box.size){localAbs+=Math.abs(d);localSquared+=d*d;localCount++;}
  }
  this.metrics={mae:abs/Math.max(count,1),rmse:Math.sqrt(squared/Math.max(count,1)),convergence:conv/Math.max(count,1),samples:1024,
    ...(localCount?{local:{mae:localAbs/localCount,rmse:Math.sqrt(localSquared/localCount),count:localCount,label:this.focus.label}}:{})};
  this.callback({ready:true,metrics:this.metrics});
 }

 dispose(){this.disposed=true;this.generation++;cancelAnimationFrame(this.frame);cancelAnimationFrame(this.benchmarkFrame);this.observer.disconnect();this.intersection.disconnect();this.controls.dispose();this.renderer.domElement.removeEventListener('pointerdown',this.onDown);this.renderer.domElement.removeEventListener('pointerup',this.onUp);this.renderer.domElement.removeEventListener('webglcontextlost',this.onLost);this.renderer.domElement.removeEventListener('webglcontextrestored',this.onRestored);disposeGeometry(this.group);this.quad.geometry.dispose();for(const m of [this.normalMaterial,this.ao,this.filter,this.display,this.ref,this.copy])m.dispose();for(const t of [this.normal,this.raw,this.filtered,this.debug,...this.comparisons,...this.refs,this.checkpoint]){t.depthTexture?.dispose();t.dispose();}this.renderer.dispose();this.renderer.domElement.remove();}
}
