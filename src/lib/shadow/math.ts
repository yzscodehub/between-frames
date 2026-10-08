import {Vector3,Vector4} from 'three';
import type {Matrix4} from 'three';
import type {Hit,Primitive,Ray,Vec3} from '../ray/types';
import {add,dot,finiteVector,length,makeRay,normalize,scale,sub,traceBrute} from '../ray/geometry';
import type {ShadowReference} from './types';

export type Uv=[number,number];
export type Resolution=number|[number,number];
export interface ShadowTexel {pixel:[number,number];uv:Uv}
export interface ProjectedLightPoint {uv:Uv;depth:number;w:number;covered:boolean}
export interface CpuShadowDepth {uv:Uv;depth:number;distance:number;hit:Hit|null}
export interface PcfComparison {depth:number;receiver:number;valid:boolean}
export interface PcfResult {visibility:number|null;comparisons:Array<number|null>;validSamples:number;missingSamples:number}
export interface AreaLight {center:Vec3;u:Vec3;v:Vec3}
export interface AreaSampleOptions extends AreaLight {index:number;capacity?:number;seed?:number;nearEpsilon?:number}
export interface ReferenceOptions extends AreaLight {samples?:number;capacity?:number;seed?:number;nearEpsilon?:number}

function clipPlanes(near:number,far:number){if(!Number.isFinite(near)||!Number.isFinite(far)||near<=0||far<=near)throw new RangeError('Expected 0 < near < far.');}

/** OpenGL perspective depth in [0,1]; distance is positive light-view axial z. */
export function perspectiveDepth(distance:number,near=.5,far=25):number {
 clipPlanes(near,far);if(!Number.isFinite(distance)||distance<=0)throw new RangeError('Axial distance must be positive.');
 return far/(far-near)-near*far/((far-near)*distance);
}
export function linearDepth(depth:number,near=.5,far=25):number {
 clipPlanes(near,far);if(!Number.isFinite(depth))throw new RangeError('Depth must be finite.');
 return near*far/(far-depth*(far-near));
}

/** Half-open UV coverage matches integer texel addressing; never clamps a miss. */
export function coveredUv(uv:Uv):boolean {return uv.every(v=>Number.isFinite(v)&&v>=0&&v<1);}
export function nearestTexel(uv:Uv,resolution:Resolution):ShadowTexel|null {
 const dimensions=typeof resolution==='number'?[resolution,resolution]:resolution;
 if(!dimensions.every(n=>Number.isInteger(n)&&n>0))throw new RangeError('Texture dimensions must be positive integers.');
 if(!coveredUv(uv))return null;
 const pixel:[number,number]=[Math.floor(uv[0]*dimensions[0]),Math.floor(uv[1]*dimensions[1])];
 return {pixel,uv:[(pixel[0]+.5)/dimensions[0],(pixel[1]+.5)/dimensions[1]]};
}
export function projectToLight(position:Vec3,viewProjection:Matrix4):ProjectedLightPoint {
 const clip=new Vector4(...position,1).applyMatrix4(viewProjection),w=clip.w;
 if(!Number.isFinite(w)||w===0)return {uv:[NaN,NaN],depth:NaN,w,covered:false};
 const uv:Uv=[clip.x/w*.5+.5,clip.y/w*.5+.5],depth=clip.z/w*.5+.5;
 return {uv,depth,w,covered:w>0&&coveredUv(uv)&&depth>=0&&depth<=1};
}

function lightRay(uv:Uv,lightWorld:Matrix4,inverseProjection:Matrix4):{origin:Vec3;direction:Vec3;axialPerT:number}|null {
 if(!coveredUv(uv))return null;
 const point=new Vector4(uv[0]*2-1,uv[1]*2-1,0,1).applyMatrix4(inverseProjection);
 if(!Number.isFinite(point.w)||point.w===0)return null;
 const local=new Vector3(point.x/point.w,point.y/point.w,point.z/point.w).normalize();
 const origin=new Vector3().setFromMatrixPosition(lightWorld).toArray() as Vec3,direction=local.clone().transformDirection(lightWorld).toArray() as Vec3;
 return -local.z>0?{origin,direction,axialPerT:-local.z}:null;
}
/** The UV must be the actual nearest texel center, not the continuous receiver UV. */
export function receiverPlaneDepth(texelUv:Uv,position:Vec3,normal:Vec3,lightWorld:Matrix4,inverseProjection:Matrix4):number|null {
 const ray=lightRay(texelUv,lightWorld,inverseProjection);if(!ray)return null;
 const denominator=dot(normal,ray.direction);if(Math.abs(denominator)<1e-12*length(normal))return null;
 const t=dot(sub(position,ray.origin),normal)/denominator,distance=t*ray.axialPerT;
 return Number.isFinite(distance)&&distance>0?distance:null;
}
/** Raster near/far clips are axial distances, so divide by the ray's axial component. */
export function lightTexelRay(uv:Uv,resolution:Resolution,lightWorld:Matrix4,inverseProjection:Matrix4,near=.5,far=25):Ray|null {
 clipPlanes(near,far);const texel=nearestTexel(uv,resolution);if(!texel)return null;
 const ray=lightRay(texel.uv,lightWorld,inverseProjection);if(!ray)return null;
 return {...ray,tMin:near/ray.axialPerT,tMax:far/ray.axialPerT};
}
/** Independent double CPU geometry query at the raster depth texel's center. */
export function cpuShadowTexelDepth(primitives:Primitive[],uv:Uv,resolution:Resolution,lightWorld:Matrix4,inverseProjection:Matrix4,near=.5,far=25):CpuShadowDepth|null {
 const texel=nearestTexel(uv,resolution),ray=lightTexelRay(uv,resolution,lightWorld,inverseProjection,near,far);if(!texel||!ray)return null;
 const result=traceBrute(ray,primitives);if(result.status==='invalid'||result.status==='overflow')return null;
 if(!result.hit)return {uv:texel.uv,depth:1,distance:far,hit:null};
 const local=new Vector3(...result.hit.position).applyMatrix4(lightWorld.clone().invert()),distance=-local.z;
 return {uv:texel.uv,depth:perspectiveDepth(distance,near,far),distance,hit:result.hit};
}

/** Inputs must have the same measure. For normalized raster depth, provide the
 * already biased projected receiver and leave bias=0; for axial depth bias is world length. */
export function evaluatePcf(samples:readonly PcfComparison[],bias=0):PcfResult {
 if(!Number.isFinite(bias)||bias<0)throw new RangeError('Bias must be a finite nonnegative distance in the input measure.');
 const comparisons=samples.map(sample=>sample.valid&&Number.isFinite(sample.depth)&&Number.isFinite(sample.receiver)?(sample.receiver-bias<=sample.depth?1:0):null);
 const validSamples=comparisons.filter(v=>v!==null).length,missingSamples=samples.length-validSamples;
 // An incomplete footprint is not an estimate of a completely observed kernel.
 const visibility=validSamples>0&&missingSamples===0?comparisons.reduce<number>((sum,v)=>sum+(v??0),0)/validSamples:null;
 return {visibility,comparisons,validSamples,missingSamples};
}
export function pcfVisibility(depths:readonly number[],receiver:number,bias=0):number|null {
 return evaluatePcf(depths.map(depth=>({depth,receiver,valid:true})),bias).visibility;
}
export function filterGrid(radius:number,width=9):Uv[] {
 if(!Number.isFinite(radius)||radius<0||!Number.isInteger(width)||width<1||width%2!==1)throw new RangeError('Expected a nonnegative radius and odd grid width.');
 const result:Uv[]=[];for(let y=0;y<width;y++)for(let x=0;x<width;x++)result.push(width===1?[0,0]:[(x/(width-1)*2-1)*radius,(y/(width-1)*2-1)*radius]);return result;
}
export function blockerAverage(distances:readonly number[],receiverDistance:number,bias=0):{count:number;distance:number|null} {
 const blockers=distances.filter(d=>Number.isFinite(d)&&d>0&&d<receiverDistance-bias);
 return {count:blockers.length,distance:blockers.length?blockers.reduce((sum,d)=>sum+d,0)/blockers.length:null};
}
export function penumbraWorld(lightHalfSize:number,receiverDistance:number,blockerDistance:number):number {
 if(![lightHalfSize,receiverDistance,blockerDistance].every(Number.isFinite)||lightHalfSize<0||receiverDistance<=0)throw new RangeError('Invalid penumbra geometry.');
 return blockerDistance>0&&blockerDistance<receiverDistance?lightHalfSize*(receiverDistance-blockerDistance)/blockerDistance:0;
}
export function penumbraUv(lightHalfSize:number,receiverDistance:number,blockerDistance:number,tanHalfFov:number,aspect=1):number {
 if(!Number.isFinite(tanHalfFov)||!Number.isFinite(aspect)||tanHalfFov<=0||aspect<=0)throw new RangeError('Projection scale must be positive.');
 return penumbraWorld(lightHalfSize,receiverDistance,blockerDistance)/(2*tanHalfFov*aspect*receiverDistance);
}
/** searchNear is a conservative scene-depth lower bound, at least the projection near plane. */
export function blockerSearchUv(lightHalfSize:number,receiverDistance:number,searchNear:number,tanHalfFov:number,aspect=1):number {
 if(![lightHalfSize,receiverDistance,searchNear,tanHalfFov,aspect].every(Number.isFinite)||lightHalfSize<0||receiverDistance<=0||searchNear<=0||tanHalfFov<=0||aspect<=0)throw new RangeError('Invalid blocker search geometry.');
 return lightHalfSize*Math.max(0,receiverDistance-searchNear)/(2*tanHalfFov*aspect*searchNear*receiverDistance);
}

function radicalInverse2(value:number){let result=0,factor=.5;for(let n=value>>>0;n;n>>>=1){result+=(n&1)*factor;factor*=.5;}return result;}
function hash32(value:number){let n=(value+0x9e3779b9)>>>0;n=Math.imul(n^(n>>>16),0x85ebca6b);n=Math.imul(n^(n>>>13),0xc2b2ae35);return (n^(n>>>16))>>>0;}
function gcd(a:number,b:number):number {while(b){const next=a%b;a=b;b=next;}return a;}
/** A fixed-capacity Hammersley set in deterministic permuted order, with a
 * seed-dependent torus shift. The 512 checkpoint reuses the first 512 points of
 * the 1024 set; permutation avoids filling only half the light before that checkpoint. */
export function hammersley2D(index:number,capacity=1024,seed=17):Uv {
 if(!Number.isInteger(capacity)||capacity<1||capacity>65536||!Number.isInteger(index)||index<0||index>=capacity)throw new RangeError('Hammersley index must fit the fixed capacity.');
 let multiplier=Math.floor(capacity*.6180339887498949)|1;while(gcd(multiplier,capacity)!==1)multiplier+=2;
 const k=(index*multiplier)%capacity,u=(k+.5)/capacity,v=radicalInverse2(k),shiftU=hash32(seed^0xa511e9b3)/4294967296,shiftV=hash32(seed^0x63d83595)/4294967296;
 return [(u+shiftU)%1,(v+shiftV)%1];
}
export function squareLightPoint(light:AreaLight,uv:Uv):Vec3 {
 return add(add(light.center,scale(light.u,2*uv[0]-1)),scale(light.v,2*uv[1]-1));
}
/** Geometric finite-segment visibility; zero is a valid result, not a failed query. */
export function pointVisibility(position:Vec3,normal:Vec3,point:Vec3,primitives:Primitive[],nearEpsilon=1e-4):number {
 if(!finiteVector(position)||!finiteVector(normal)||!finiteVector(point)||!Number.isFinite(nearEpsilon)||nearEpsilon<0)throw new RangeError('Visibility geometry must be finite.');
 const originalDirection=sub(point,position);if(length(originalDirection)<=nearEpsilon)return 1;
 const unitNormal=normalize(normal),side=dot(originalDirection,unitNormal)>=0?1:-1,origin=add(position,scale(unitNormal,side*nearEpsilon)),segment=sub(point,origin),distance=length(segment);
 if(distance<=nearEpsilon)return 1;
 const query=traceBrute(makeRay(origin,segment,0,distance-nearEpsilon),primitives,true);
 if(query.status==='invalid'||query.status==='overflow')throw new Error('CPU visibility query failed.');
 return query.hit?0:1;
}
export function areaLightVisibilitySample(position:Vec3,normal:Vec3,primitives:Primitive[],options:AreaSampleOptions):number {
 const uv=hammersley2D(options.index,options.capacity??1024,options.seed??17);
 return pointVisibility(position,normal,squareLightPoint(options,uv),primitives,options.nearEpsilon??1e-4);
}
/** A deterministic finite-sample reference, not a confidence interval or exact truth.
 * Renderer code may call areaLightVisibilitySample in cancellable batches instead. */
export function referenceVisibility(position:Vec3,normal:Vec3,primitives:Primitive[],options:ReferenceOptions):ShadowReference {
 const samples=options.samples??1024,capacity=options.capacity??1024;
 if(!Number.isInteger(samples)||samples<1||samples>capacity)throw new RangeError('Reference sample count must fit the fixed sequence capacity.');
 let total=0,checkpoint=0;const checkpointAt=Math.min(512,samples);
 for(let index=0;index<samples;index++){
  total+=areaLightVisibilitySample(position,normal,primitives,{...options,index,capacity});
  if(index+1===checkpointAt)checkpoint=total/checkpointAt;
 }
 const value=total/samples;return {value,checkpoint,convergence:Math.abs(value-checkpoint),samples};
}
