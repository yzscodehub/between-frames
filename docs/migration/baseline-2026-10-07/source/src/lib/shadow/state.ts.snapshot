import type {ShadowLesson,ShadowState} from './types';
export const defaultShadowState=(lesson:ShadowLesson='mapping'):ShadowState=>({version:1,lesson,preset:'contact',algorithm:lesson==='mapping'?'hard':'pcss',resolution:512,fov:75,bias:.002,planeCorrection:true,filterRadius:2,lightSize:.5,height:.8,seed:17,view:'lit',compare:false,camera:{position:[7,5.5,8],target:[0,.6,0]}});
export const encodeShadowState=(s:ShadowState)=>'#shadow='+encodeURIComponent(JSON.stringify(s));
export const shadowLabHref=(lesson:ShadowLesson,patch:Partial<ShadowState>={})=>'/labs/shadows/'+encodeShadowState({...defaultShadowState(lesson),...patch,lesson,version:1});
export function decodeShadowState(hash:string,lesson:ShadowLesson='mapping'):{state:ShadowState;notice?:string}{
 if(!hash.startsWith('#shadow='))return {state:defaultShadowState(lesson)};
 try{if(hash.length>4096)throw 0;const s=JSON.parse(decodeURIComponent(hash.slice(8))) as ShadowState;
 const finite=(x:unknown,min:number,max:number)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max;
 if(s.version!==1||!['mapping','filtering'].includes(s.lesson)||!['contact','steps','layers'].includes(s.preset)||!['hard','pcf','pcss'].includes(s.algorithm)||![128,256,512,1024].includes(s.resolution)||!['lit','visibility','map'].includes(s.view)||typeof s.planeCorrection!=='boolean'||typeof s.compare!=='boolean')throw 0;
 for(const [v,min,max] of [[s.fov,40,110],[s.bias,0,.08],[s.filterRadius,0,12],[s.lightSize,0,1.5],[s.height,.15,2.5],[s.seed,0,65535]])if(!finite(v,min,max))throw 0;
 if(!Number.isInteger(s.seed))throw 0;
 for(const v of [s.camera?.position,s.camera?.target])if(!Array.isArray(v)||v.length!==3||!v.every(x=>finite(x,-50,50)))throw 0;
 const d=Math.hypot(...s.camera.position.map((v,i)=>v-s.camera.target[i]));if(d<1||d>35)throw 0;
 if(s.learning!==undefined&&(!s.learning||typeof s.learning!=='object'||!['shadow-mapping','pcf-pcss'].includes(s.learning.article)||typeof s.learning.chapter!=='string'||!/^[-a-z]+$/.test(s.learning.chapter)))throw 0;
 return {state:s};
 }catch{return {state:defaultShadowState(lesson),notice:'阴影实验链接不完整或版本不兼容，已恢复默认示例。'};}
}
/** Reprojection/appearance changes do not alter a frozen world's area-visibility reference. */
export const shadowGeometryKey=(s:ShadowState)=>JSON.stringify([s.preset,s.height]);
export const shadowReferenceKey=(s:ShadowState)=>JSON.stringify([s.preset,s.height,s.lightSize,s.seed]);
