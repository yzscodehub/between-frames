import type {Ray,Vec3} from './types';
import {add,dot,scale,sub} from './geometry';

/** OpenGL depth [0,1] to positive light-view axial distance (not ray length). */
export function linearizePerspectiveDepth(depth:number,near:number,far:number):number {
 return near*far/(far-depth*(far-near));
}
export function perspectiveDepth(distance:number,near:number,far:number):number {
 return far/(far-near)-far*near/((far-near)*distance);
}
/** Radius of the penumbra on a parallel receiver, by similar triangles. */
export function pcssPenumbra(lightHalfExtent:number,receiverDistance:number,blockerDistance:number):number {
 return blockerDistance>0?lightHalfExtent*Math.max(0,receiverDistance-blockerDistance)/blockerDistance:0;
}
/** World radius projected to a UV radius using the receiver's axial distance. */
export function pcssPenumbraUv(lightHalfExtent:number,receiverDistance:number,blockerDistance:number,tanHalfFov:number,aspect=1):number {
 return receiverDistance>0?pcssPenumbra(lightHalfExtent,receiverDistance,blockerDistance)/(2*receiverDistance*tanHalfFov*aspect):0;
}
export function nearestShadowTexelUv(uv:[number,number],resolution:[number,number]):[number,number] {
 return uv.map((v,i)=>(Math.min(resolution[i]-1,Math.max(0,Math.floor(v*resolution[i])))+.5)/resolution[i]) as [number,number];
}
/** Positive axial depth where an actual light-map texel ray meets the receiver plane. */
export function receiverPlaneDepth(texelUv:[number,number],point:Vec3,normal:Vec3,tanHalfFov:[number,number]):number|null {
 const direction:Vec3=[(texelUv[0]*2-1)*tanHalfFov[0],(texelUv[1]*2-1)*tanHalfFov[1],-1];
 const denominator=dot(direction,normal);if(Math.abs(denominator)<1e-12)return null;
 const depth=dot(point,normal)/denominator;return Number.isFinite(depth)&&depth>0?depth:null;
}
export function reflectPoint(point:Vec3,planePoint:Vec3,unitNormal:Vec3):Vec3 {
 return sub(point,scale(unitNormal,2*dot(sub(point,planePoint),unitNormal)));
}
export function reflectVector(direction:Vec3,unitNormal:Vec3):Vec3 {
 return sub(direction,scale(unitNormal,2*dot(direction,unitNormal)));
}
/** Reflect the whole camera ray; clip its virtual-camera segment before the plane. */
export function reflectedCameraRay(ray:Ray,planePoint:Vec3=[0,0,0],unitNormal:Vec3=[0,1,0],epsilon=1e-4):Ray|null {
 const origin=reflectPoint(ray.origin,planePoint,unitNormal),direction=reflectVector(ray.direction,unitNormal),denominator=dot(direction,unitNormal);
 if(Math.abs(denominator)<1e-12)return null;
 const planeT=dot(sub(planePoint,origin),unitNormal)/denominator;
 if(planeT<0)return null;
 return {origin,direction,tMin:planeT+epsilon,tMax:planeT+ray.tMax};
}
export function planeRayPoint(ray:Ray,planePoint:Vec3=[0,0,0],unitNormal:Vec3=[0,1,0]):Vec3|null {
 const denominator=dot(ray.direction,unitNormal);if(Math.abs(denominator)<1e-12)return null;
 const t=dot(sub(planePoint,ray.origin),unitNormal)/denominator;return t>=0?add(ray.origin,scale(ray.direction,t)):null;
}
