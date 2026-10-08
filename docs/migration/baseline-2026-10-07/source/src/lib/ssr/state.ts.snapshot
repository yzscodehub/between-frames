import type {SSRState} from './types';
export const defaultSSRState=():SSRState=>({version:1,preset:'gallery',method:'screen',steps:192,stride:1,viewStep:.25,thickness:.08,range:24,offset:0,epsilon:.001,shading:'flat',view:'reflection',compare:true,camera:{position:[0,3.2,7.8],target:[0,.5,-.5]}});
export const encodeSSRState=(state:SSRState)=>'#ssr='+encodeURIComponent(JSON.stringify(state));
export const ssrHref=(patch:Partial<SSRState>={})=>'/labs/ssr/'+encodeSSRState({...defaultSSRState(),...patch,version:1});
export function decodeSSRState(hash:string):{state:SSRState;notice?:string}{
 if(!hash.startsWith('#ssr='))return {state:defaultSSRState()};
 try{if(hash.length>4096)throw 0;const s=JSON.parse(decodeURIComponent(hash.slice(5))) as SSRState;const finite=(v:unknown,a:number,b:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=a&&v<=b;
  if(s.version!==1||!['gallery','thin','hidden'].includes(s.preset)||!['screen','view'].includes(s.method)||!['flat','local'].includes(s.shading)||!['reflection','status','depth'].includes(s.view)||typeof s.compare!=='boolean')throw 0;
  for(const [v,a,b] of [[s.steps,8,256],[s.stride,1,8],[s.viewStep,.025,1],[s.thickness,.001,1],[s.range,2,30],[s.offset,-7,7],[s.epsilon,0,.03]])if(!finite(v,a,b))throw 0;
  if(!Number.isInteger(s.steps)||!Number.isInteger(s.stride))throw 0;
  for(const v of [s.camera?.position,s.camera?.target])if(!Array.isArray(v)||v.length!==3||!v.every(n=>finite(n,-40,40)))throw 0;
  const distance=Math.hypot(...s.camera.position.map((n,i)=>n-s.camera.target[i]));if(distance<1||distance>30)throw 0;
  if(s.learning!==undefined&&(!s.learning||s.learning.article!=='ssr'||typeof s.learning.chapter!=='string'||!/^[-a-z]+$/.test(s.learning.chapter)))throw 0;
  return {state:s};
 }catch{return {state:defaultSSRState(),notice:'SSR 链接不完整或版本不兼容，已恢复默认实验。'};}
}
export const ssrGeometryKey=(s:SSRState)=>JSON.stringify([s.preset,s.offset]);
export const ssrQueryKey=(s:SSRState)=>JSON.stringify([ssrGeometryKey(s),s.camera,s.method,s.steps,s.stride,s.viewStep,s.thickness,s.range,s.epsilon,s.shading]);
