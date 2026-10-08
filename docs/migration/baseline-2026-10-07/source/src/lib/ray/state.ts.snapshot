import type {Vec3} from './types';
export type RayLesson='rays'|'bvh'|'shadows'|'reflections'|'path'|'mis'|'denoise';
export interface RayState {version:1;lesson:RayLesson;preset:'triangle'|'scatter'|'clusters'|'overlap'|'room';count:number;builder:'median'|'sah';traversal:'brute'|'bvh';query:'closest'|'any';origin:'camera'|'surface'|'inside';tMin:number;tMax:number;offsetScale:number;variant:number;frame:number;motion:'object'|'camera'|'cut';view:number;compare:boolean;history:boolean;spatial:boolean;seed:number;maxScattering:number;targetSpp:number;batch:number;estimator:'bsdf'|'nee'|'mis';sampling:'uniform'|'cosine';roughness:number;lightSize:number;environment:number;rr:boolean;exposure:number;quality:'standard'|'low';camera:{position:Vec3;target:Vec3};learning?:{article:string;chapter:string}}
export const rayLessons:Record<RayLesson,string>={rays:'光线与求交',bvh:'BVH 与剪枝',shadows:'光追阴影',reflections:'光追反射',path:'最小路径追踪',mis:'采样与 MIS',denoise:'间接光重建'};
export function rayCamera(preset:RayState['preset']):RayState['camera'] {return preset==='room'?{position:[0,2.3,8.8],target:[0,2.1,0]}:{position:[6,4.5,8],target:[0,.6,0]};}
export function defaultRayState(lesson:RayLesson='rays'):RayState {const preset=lesson==='rays'?'triangle':lesson==='bvh'?'scatter':'room';return {version:1,lesson,preset,count:512,builder:'median',traversal:'bvh',query:'closest',origin:'camera',tMin:1e-4,tMax:50,offsetScale:1,variant:0,frame:0,motion:'object',view:lesson==='reflections'?1:0,compare:false,history:true,spatial:true,seed:17,maxScattering:2,targetSpp:256,batch:1,estimator:lesson==='mis'||lesson==='denoise'?'mis':'bsdf',sampling:'cosine',roughness:.35,lightSize:1,environment:0,rr:false,exposure:0,quality:'standard',camera:lesson==='shadows'?{position:[5,4.8,6.4],target:[0,.5,-.4]}:rayCamera(preset)};}
const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
export function decodeRayState(hash:string,lesson:RayLesson='rays'):{state:RayState;notice?:string}{
 if(!hash.startsWith('#ray='))return {state:defaultRayState(lesson)};
 try {if(hash.length>8192)throw 0;const s=JSON.parse(decodeURIComponent(hash.slice(5))) as RayState;
  s.motion??='object';if(!['object','camera','cut'].includes(s.motion))throw 0;s.history??=true;s.spatial??=true;
  const vec=(v:unknown)=>Array.isArray(v)&&v.length===3&&v.every(x=>finite(x,-100,100));
  if(s.version!==1||!Object.hasOwn(rayLessons,s.lesson)||!['triangle','scatter','clusters','overlap','room'].includes(s.preset)||!['median','sah'].includes(s.builder)||!['brute','bvh'].includes(s.traversal)||!['closest','any'].includes(s.query)||!['camera','surface','inside'].includes(s.origin)||!['standard','low'].includes(s.quality)||!['bsdf','nee','mis'].includes(s.estimator)||!['uniform','cosine'].includes(s.sampling))throw 0;
  for(const [v,min,max] of [[s.count,4,2048],[s.tMin,0,.1],[s.tMax,.1,100],[s.offsetScale,0,4],[s.variant,-1,1],[s.frame,0,120],[s.view,0,9],[s.seed,0,65535],[s.maxScattering,1,8],[s.targetSpp,1,4096],[s.batch,1,32],[s.roughness,.05,1],[s.lightSize,.1,2],[s.environment,0,1],[s.exposure,-4,4]])if(!finite(v,min,max))throw 0;
  for(const v of [s.count,s.frame,s.view,s.seed,s.maxScattering,s.targetSpp,s.batch])if(!Number.isInteger(v))throw 0;
  if(s.tMin>=s.tMax||typeof s.compare!=='boolean'||typeof s.rr!=='boolean'||typeof s.history!=='boolean'||typeof s.spatial!=='boolean'||!vec(s.camera?.position)||!vec(s.camera?.target))throw 0;
  const length=Math.hypot(...s.camera.position.map((v,i)=>v-s.camera.target[i]));if(length<.5||length>40)throw 0;
  if(s.learning&&(typeof s.learning.article!=='string'||typeof s.learning.chapter!=='string'||!/^([a-z]+-?)+$/.test(s.learning.article)||!/^([a-z]+-?)+$/.test(s.learning.chapter)))throw 0;
  return {state:s};
 }catch{return {state:defaultRayState(lesson),notice:'光追链接不完整或版本不兼容，已恢复默认实验。'};}
}
export const encodeRayState=(state:RayState)=>'#ray='+encodeURIComponent(JSON.stringify(state));
export const rayIntegrandKey=(s:RayState)=>JSON.stringify([s.lesson,s.motion,s.preset,s.count,s.variant,s.frame,s.camera,s.quality,s.seed,s.maxScattering,s.estimator,s.sampling,s.roughness,s.lightSize,s.environment,s.rr,s.origin,s.tMin,s.tMax,s.offsetScale,s.lesson==='reflections'?s.view:null]);
