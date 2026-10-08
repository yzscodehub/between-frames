export type LightingKind='ibl'|'transparency';
export interface LightingState {version:1;kind:LightingKind;task:number;roughness:number;environment:number;rotation:number;diffuse:boolean;exposure:number;alpha:number;crossing:boolean;reverse:boolean;power:number}
export const defaultLightingState=(kind:LightingKind):LightingState=>({version:1,kind,task:0,roughness:.52,environment:1,rotation:0,diffuse:kind==='ibl',exposure:0,alpha:.45,crossing:true,reverse:false,power:kind==='transparency'?0:3});
export const lightingHash=(s:LightingState)=>'#'+s.kind+'='+encodeURIComponent(JSON.stringify(s));
export function decodeLighting(hash:string,kind:LightingKind):{state:LightingState;notice?:string}{
 if(!hash.startsWith('#'+kind+'='))return {state:defaultLightingState(kind)};
 try{if(hash.length>3000)throw 0;const s=JSON.parse(decodeURIComponent(hash.slice(kind.length+2)));if(s.version!==1||s.kind!==kind)throw 0;
 for(const [key,min,max] of [['task',0,2],['roughness',.2,1],['environment',0,2],['rotation',-180,180],['exposure',-3,3],['alpha',0,1],['power',0,8]] as const)if(typeof s[key]!=='number'||!Number.isFinite(s[key])||s[key]<min||s[key]>max)throw 0;
 if(!Number.isInteger(s.task)||!Number.isInteger(s.environment)||!['diffuse','crossing','reverse'].every(k=>typeof s[k]==='boolean'))throw 0;
 return {state:s};}catch{return {state:defaultLightingState(kind),notice:'链接无效或版本不兼容，已恢复默认预设。'};}
}
export function lightingTask(kind:LightingKind,task:number):LightingState{const s=defaultLightingState(kind);return {...s,task,...(kind==='ibl'?[{environment:1,diffuse:true},{environment:1,roughness:.52},{environment:2,roughness:.36}][task]:[{crossing:true,alpha:.45,power:0},{crossing:true,alpha:.45,power:3},{crossing:true,alpha:.95,power:3}][task])};}
