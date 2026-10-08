export type Vec3=[number,number,number];
export interface TAAState {version:1;frame:number;scene:'studio'|'fine';motion:'static'|'object'|'camera'|'cut';jitter:boolean;validation:boolean;clipping:boolean;weight:number;quality:'standard'|'low';view:'final'|'current'|'reject'|'velocity';compare:boolean;exposure:number;seed:number;camera:{position:Vec3;target:Vec3}}
export const defaultTAAState=():TAAState=>({version:1,frame:0,scene:'studio',motion:'static',jitter:true,validation:true,clipping:true,weight:.9,quality:'standard',view:'final',compare:false,exposure:0,seed:17,camera:{position:[5.4,3.7,7.8],target:[0,1,0]}});
export const encodeTAAState=(s:TAAState)=>'#taa='+encodeURIComponent(JSON.stringify(s));
export const taaLabHref=(patch:Partial<TAAState>={})=>'/labs/taa/'+encodeTAAState({...defaultTAAState(),...patch,version:1});
export function decodeTAAState(hash:string):{state:TAAState;notice?:string}{
 if(!hash.startsWith('#taa='))return {state:defaultTAAState()};
 try{if(hash.length>4096)throw 0;const s=JSON.parse(decodeURIComponent(hash.slice(5))) as TAAState;
  const finite=(x:unknown,a:number,b:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
  if(s.version!==1||!['studio','fine'].includes(s.scene)||!['static','object','camera','cut'].includes(s.motion)||!['standard','low'].includes(s.quality)||!['final','current','reject','velocity'].includes(s.view))throw 0;
  if(!finite(s.frame,0,120)||!Number.isInteger(s.frame)||!finite(s.weight,0,.98)||!finite(s.exposure,-4,4)||!finite(s.seed,0,65535)||!Number.isInteger(s.seed))throw 0;
  if([s.jitter,s.validation,s.clipping,s.compare].some(x=>typeof x!=='boolean'))throw 0;
  for(const v of [s.camera?.position,s.camera?.target])if(!Array.isArray(v)||v.length!==3||!v.every(x=>finite(x,-30,30)))throw 0;
  const distance=Math.hypot(...s.camera.position.map((x,i)=>x-s.camera.target[i]));if(distance<1||distance>40)throw 0;
  return {state:s};
 }catch{return {state:defaultTAAState(),notice:'TAA 链接无效或版本不兼容，已恢复默认条件。'};}
}
export const sequenceKey=(s:TAAState)=>JSON.stringify([s.scene,s.motion,s.jitter,s.validation,s.clipping,s.weight,s.quality,s.seed,s.camera]);
