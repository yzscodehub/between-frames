import type {PbrState} from './types';
export const defaultPbrState=():PbrState=>({version:1,roughness:.32,metallic:0,baseColor:'#c9784f',intensity:3,lightAzimuth:30,lightElevation:45,exposure:0,view:'beauty',compare:true,shadows:false,task:0,camera:{position:[3.6,2.5,6.5],target:[0,.65,0]}});
export const pbrTasks=[
 {name:'粗糙度与反射瓣',question:'更尖的高光，是否意味着总反射能量更多？',action:'保持光强与曝光，改变中间球的粗糙度；对照左右固定粗糙度，再检查像素和半球积分。',patch:{roughness:.32,metallic:0,compare:true,view:'beauty'}},
 {name:'视角与金属度',question:'为什么掠射更亮，金属的反射还会带颜色？',action:'选择材质球，比较 metallic=0 与 1 的 F0 和 diffuse。旋转相机至掠射，保持光强，检查 F 与 VoH，同时记录 NoV。',patch:{roughness:.4,metallic:0,compare:false,view:'f',camera:{position:[2.1,1.5,3.7],target:[0,.7,0]}}},
 {name:'拆开 D、F、G',question:'一个亮点，来自分布、Fresnel 还是可见微表面？',action:'切换 diffuse、specular、D、F、G；点击同一表面核对 GPU/CPU 数值，再生成该视角的半球积分。',patch:{roughness:.55,metallic:.65,compare:false,view:'specular',camera:{position:[2.1,1.5,3.7],target:[0,.7,0]}}},
] satisfies Array<{name:string;question:string;action:string;patch:Partial<PbrState>}>;
export function pbrTaskState(task:0|1|2):PbrState{return structuredClone({...defaultPbrState(),...pbrTasks[task].patch,task});}
export const encodePbrState=(state:PbrState)=>'#pbr='+encodeURIComponent(JSON.stringify(state));
export const pbrLabHref=(patch:Partial<PbrState>={})=>'/labs/materials/'+encodePbrState({...defaultPbrState(),...patch});
export function decodePbrState(hash:string):{state:PbrState;notice?:string}{
 if(!hash.startsWith('#pbr='))return {state:defaultPbrState()};
 try{
  if(hash.length>4096)throw 0;const s=JSON.parse(decodeURIComponent(hash.slice(5))) as PbrState;
  const finite=(x:unknown,lo:number,hi:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=lo&&x<=hi;
  if(s.version!==1||!/^#[0-9a-fA-F]{6}$/.test(s.baseColor)||!['beauty','diffuse','specular','d','f','g'].includes(s.view)||typeof s.compare!=='boolean'||typeof s.shadows!=='boolean'||![0,1,2].includes(s.task))throw 0;
  for(const [x,lo,hi]of [[s.roughness,.03,1],[s.metallic,0,1],[s.intensity,0,8],[s.lightAzimuth,-180,180],[s.lightElevation,5,85],[s.exposure,-4,4]])if(!finite(x,lo,hi))throw 0;
  for(const v of [s.camera?.position,s.camera?.target])if(!Array.isArray(v)||v.length!==3||!v.every(x=>finite(x,-30,30)))throw 0;
  const distance=Math.hypot(...s.camera.position.map((x,i)=>x-s.camera.target[i]));if(distance<1||distance>20)throw 0;
  if(s.learning!==undefined&&(!s.learning||typeof s.learning!=='object'||s.learning.article!=='pbr'||typeof s.learning.chapter!=='string'||!/^[-a-z]+$/.test(s.learning.chapter)))throw 0;
  return {state:s};
 }catch{return {state:defaultPbrState(),notice:'材质链接不完整或版本不兼容，已恢复默认实验。'};}
}
export const pbrIntegrandKey=(s:PbrState)=>JSON.stringify([s.roughness,s.metallic,s.baseColor,s.intensity,s.lightAzimuth,s.lightElevation,s.compare,s.shadows,s.camera]);
