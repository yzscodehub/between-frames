import {Vector3,Vector4} from 'three';
import type {Matrix4} from 'three';
import type {TAAState,Vec3} from './state';
export function halton(index:number,base:number){let f=1,result=0;for(let i=index;i>0;i=Math.floor(i/base)){f/=base;result+=f*(i%base);}return result;}
/** Positive jitter shifts the projected IMAGE right/up, measured in raster pixels. */
export const frameJitter=(frame:number,enabled=true):[number,number]=>enabled?[halton(frame%16+1,2)-.5,halton(frame%16+1,3)-.5]:[0,0];
export function jitterProjection(projection:Matrix4,jitter:readonly number[],width:number,height:number){
 const p=projection.clone();p.elements[8]-=2*jitter[0]/width;p.elements[9]-=2*jitter[1]/height;return p;
}
function hash(x:number){x=(x^(x>>>16))>>>0;x=Math.imul(x,0x7feb352d);x=(x^(x>>>15))>>>0;x=Math.imul(x,0x846ca68b);return ((x^(x>>>16))>>>0)/4294967296;}
/** 64 distinct stratified subpixel samples, a separately seeded reference sequence. */
export function referenceJitter(index:number,seed:number):[number,number]{const cell=(index*37)%64;return [((cell%8)+hash(seed+index*13+9137))/8-.5,(Math.floor(cell/8)+hash(seed+index*29+24133))/8-.5];}
export function cameraAt(s:TAAState,frame:number){
 const position=[...s.camera.position] as Vec3,target=[...s.camera.target] as Vec3;
 if(s.motion==='camera')position[0]+=Math.sin(frame*.025)*1.5;
 if(s.motion==='cut'&&frame>=60){position[0]-=4.5;position[2]+=1.5;}
 return {position,target};
}
export const objectOffset=(s:TAAState,frame:number)=>s.motion==='object'?Math.sin(frame*.055)*1.75:0;
export function projectPoint(point:Vec3,vp:Matrix4){const p=new Vector4(...point,1).applyMatrix4(vp);return {uv:[p.x/p.w*.5+.5,p.y/p.w*.5+.5] as [number,number],depth:p.w,clip:p.toArray()};}
/** Geometry buffers use jittered coordinates; accumulated color lives on fixed pixel indices. */
export function historyColorUv(geometryUv:readonly number[],currentJitter:readonly number[],previousJitter:readonly number[],width:number,height:number):[number,number]{
 return [geometryUv[0]+(currentJitter[0]-previousJitter[0])/width,geometryUv[1]+(currentJitter[1]-previousJitter[1])/height];
}
export function previousPoint(current:Vec3,currentModel:Matrix4,previousModel:Matrix4):Vec3{return new Vector3(...current).applyMatrix4(currentModel.clone().invert()).applyMatrix4(previousModel).toArray() as Vec3;}
export function clipAabb(color:Vec3,min:Vec3,max:Vec3):Vec3{
 const center=min.map((v,i)=>(v+max[i])/2),extent=min.map((v,i)=>(max[i]-v)/2+1e-5),delta=color.map((v,i)=>v-center[i]),ratio=Math.max(...delta.map((v,i)=>Math.abs(v/extent[i])));
 return color.map((v,i)=>ratio>1?center[i]+delta[i]/ratio:v) as Vec3;
}
export function historyBlend(current:Vec3,history:Vec3,oldAge:number,requestedWeight:number,accepted:boolean){
 const weight=accepted?Math.min(requestedWeight,oldAge/(oldAge+1)):0;
 return {color:current.map((v,i)=>v*(1-weight)+history[i]*weight) as Vec3,weight,age:accepted?Math.min(oldAge+1,256):1};
}
