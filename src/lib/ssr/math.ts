import {Vector3,Vector4} from 'three';
import type {Matrix4} from 'three';
import type {Vec3} from '../ray/types';
export const insideUv=(uv:[number,number])=>uv.every(v=>Number.isFinite(v)&&v>=0&&v<1);
export const linearDepth=(depth:number,near:number,far:number)=>near*far/(far-depth*(far-near));
export function reflectDirection(direction:Vec3,normal:Vec3):Vec3 {const d=direction.reduce((s,n,i)=>s+n*normal[i],0);return direction.map((n,i)=>n-2*d*normal[i]) as Vec3;}
export function perspectivePoint(a:Vec3,b:Vec3,wa:number,wb:number,lambda:number):Vec3 {const k=(1-lambda)/wa+lambda/wb;return a.map((n,i)=>(n*(1-lambda)/wa+b[i]*lambda/wb)/k) as Vec3;}
export function projectView(point:Vec3,projection:Matrix4):[number,number]|null {const clip=new Vector4(...point,1).applyMatrix4(projection);if(clip.w<=0)return null;return [clip.x/clip.w*.5+.5,clip.y/clip.w*.5+.5];}
export function screenDdaPoints(origin:Vec3,end:Vec3,projection:Matrix4,resolution:[number,number],stride=1){
 const a=new Vector4(...origin,1).applyMatrix4(projection),b=new Vector4(...end,1).applyMatrix4(projection);if(a.w<=0||b.w<=0)return [];
 const p0=[a.x/a.w*.5+.5,a.y/a.w*.5+.5],p1=[b.x/b.w*.5+.5,b.y/b.w*.5+.5],major=Math.max(Math.abs(p1[0]-p0[0])*resolution[0],Math.abs(p1[1]-p0[1])*resolution[1],1e-5),points=[];
 for(let i=1;i<=Math.ceil(major/stride);i++){const lambda=Math.min(1,i*stride/major);points.push({lambda,uv:p0.map((n,j)=>n+(p1[j]-n)*lambda) as [number,number],point:perspectivePoint(origin,end,a.w,b.w,lambda)});}return points;
}
/** A crossing must be refined even if its coarse endpoint skipped the thickness slab. */
export const needsRefinement=(previous:number|null,current:number,thickness:number)=>previous!==null&&previous<0&&current>=0||previous===null&&current>=0&&current<=thickness;
export function localColor(albedo:Vec3,normal:Vec3,incoming:Vec3,shading:'flat'|'local'):Vec3 {
 if(shading==='flat')return [...albedo];const n=new Vector3(...normal);if(n.dot(new Vector3(...incoming))>0)n.negate();const weight=.18+.82*Math.max(0,n.dot(new Vector3(-.55,.85,.65).normalize()));return albedo.map(c=>c*weight) as Vec3;
}
