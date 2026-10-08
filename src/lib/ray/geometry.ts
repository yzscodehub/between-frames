import type {Bounds, Hit, Primitive, QueryResult, Ray, Vec3} from './types';

export const add=(a:Vec3,b:Vec3):Vec3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const scale=(a:Vec3,s:number):Vec3=>[a[0]*s,a[1]*s,a[2]*s];
export const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const length=(a:Vec3)=>Math.hypot(...a);
export const normalize=(a:Vec3):Vec3=>{const l=length(a);return l>0?scale(a,1/l):[0,0,0];};
export const at=(ray:Ray,t:number):Vec3=>add(ray.origin,scale(ray.direction,t));
export const finiteVector=(v:Vec3)=>v.every(Number.isFinite);
export const validRay=(r:Ray)=>finiteVector(r.origin)&&finiteVector(r.direction)&&Number.isFinite(dot(r.direction,r.direction))&&dot(r.direction,r.direction)>0&&Number.isFinite(r.tMin)&&r.tMin>=0&&(Number.isFinite(r.tMax)||r.tMax===Infinity)&&r.tMax>=r.tMin;

/** t is distance when direction has unit length. Direct Ray inputs need not be normalized. */
export function makeRay(origin:Vec3,direction:Vec3,tMin=0,tMax=Infinity):Ray {
 return {origin:[...origin],direction:normalize(direction),tMin,tMax};
}

/** Shared selection contract, independent of each intersection algorithm. */
export const tieTolerance=(a:number,b:number)=>1e-6*Math.max(1,Math.abs(a),Math.abs(b));
export function nearerHit(candidate:Hit,current:Hit|null):boolean {
 if(!current)return true;
 const epsilon=tieTolerance(candidate.t,current.t);
 return candidate.t<current.t-epsilon||(Math.abs(candidate.t-current.t)<=epsilon&&candidate.primitiveId<current.primitiveId);
}

function hitRecord(ray:Ray,p:Primitive,t:number,n:Vec3,barycentric:Vec3):Hit {
 const frontFace=dot(ray.direction,n)<0;
 return {hit:true,t,position:at(ray,t),geometricNormal:n,shadingNormal:frontFace?n:scale(n,-1),frontFace,primitiveId:p.id,objectId:p.objectId,materialId:p.materialId,barycentric};
}

/** CPU oracle: intersect a plane, then solve its Gram matrix for barycentric weights.
 * Deliberately does not share the GPU's Möller–Trumbore code or Float32 arithmetic. */
export function intersectTriangle(ray:Ray,p:Primitive):Hit|null {
 const u=sub(p.b,p.a),v=sub(p.c,p.a),rawNormal=cross(u,v);
 const uu=dot(u,u),uv=dot(u,v),vv=dot(v,v),normalLength=length(rawNormal);
 if(!(normalLength>1e-14*Math.max(uu,vv))||!Number.isFinite(normalLength))return null;
 const n=scale(rawNormal,1/normalLength),denom=dot(n,ray.direction);
 if(Math.abs(denom)<=1e-12*length(ray.direction))return null;
 const t=dot(n,sub(p.a,ray.origin))/denom;
 if(!Number.isFinite(t)||t<ray.tMin||t>ray.tMax)return null;
 const w=sub(at(ray,t),p.a),wu=dot(w,u),wv=dot(w,v),det=normalLength*normalLength;
 const b=(vv*wu-uv*wv)/det,c=(uu*wv-uv*wu)/det,a=1-b-c;
 const edgeTolerance=1e-10;
 if(a < -edgeTolerance||b < -edgeTolerance||c < -edgeTolerance)return null;
 return hitRecord(ray,p,t,n,[a,b,c]);
}

/** Stable quadratic roots preserve the near hit when a sphere is far from the origin. */
export function intersectSphere(ray:Ray,p:Primitive):Hit|null {
 if(!(p.radius>0)||!Number.isFinite(p.radius))return null;
 const offset=sub(ray.origin,p.a),a=dot(ray.direction,ray.direction),b=2*dot(offset,ray.direction),c=dot(offset,offset)-p.radius*p.radius;
 const discriminant=b*b-4*a*c;
 if(discriminant<0||!Number.isFinite(discriminant))return null;
 const root=Math.sqrt(discriminant),q=-.5*(b+(b<0?-root:root));
 let t0:number,t1:number;
 if(q===0)t0=t1=-b/(2*a);else {t0=q/a;t1=c/q;}
 if(t0>t1)[t0,t1]=[t1,t0];
 const t=t0>=ray.tMin&&t0<=ray.tMax?t0:t1>=ray.tMin&&t1<=ray.tMax?t1:NaN;
 if(!Number.isFinite(t))return null;
 return hitRecord(ray,p,t,normalize(sub(at(ray,t),p.a)),[1,0,0]);
}

export function intersectPrimitive(ray:Ray,p:Primitive):Hit|null {
 return p.kind==='sphere'?intersectSphere(ray,p):intersectTriangle(ray,p);
}

/** Inclusive slab intersection; a zero direction never computes 0 * Infinity. */
export function intersectBounds(ray:Ray,bounds:Bounds,maxT=ray.tMax):[number,number]|null {
 let near=ray.tMin,far=Math.min(maxT,ray.tMax);
 for(let axis=0;axis<3;axis++){
  const d=ray.direction[axis],o=ray.origin[axis],lo=bounds.min[axis],hi=bounds.max[axis];
  if(d===0){if(o<lo||o>hi)return null;continue;}
  let a=(lo-o)/d,b=(hi-o)/d;if(a>b)[a,b]=[b,a];
  near=Math.max(near,a);far=Math.min(far,b);if(near>far)return null;
 }
 return [near,far];
}

export function primitiveBounds(p:Primitive):Bounds {
 if(p.kind==='sphere')return {min:[p.a[0]-p.radius,p.a[1]-p.radius,p.a[2]-p.radius],max:[p.a[0]+p.radius,p.a[1]+p.radius,p.a[2]+p.radius]};
 return {min:[Math.min(p.a[0],p.b[0],p.c[0]),Math.min(p.a[1],p.b[1],p.c[1]),Math.min(p.a[2],p.b[2],p.c[2])],max:[Math.max(p.a[0],p.b[0],p.c[0]),Math.max(p.a[1],p.b[1],p.c[1]),Math.max(p.a[2],p.b[2],p.c[2])]};
}

export function traceBrute(ray:Ray,primitives:Primitive[],any=false):QueryResult {
 if(!validRay(ray))return {hit:null,status:'invalid',nodeVisits:0,primitiveTests:0,visited:[],logTruncated:false};
 let hit:Hit|null=null,primitiveTests=0;
 for(const p of primitives){
  primitiveTests++;const candidate=intersectPrimitive(ray,p);
  if(candidate&&nearerHit(candidate,hit)){hit=candidate;if(any)break;}
 }
 return {hit,status:hit?'hit':'miss',nodeVisits:0,primitiveTests,visited:[],logTruncated:false};
}

/** Scale-aware origin offset uses the geometric side of the outgoing ray. */
export function offsetOrigin(position:Vec3,geometricNormal:Vec3,direction:Vec3,sceneScale=1):Vec3 {
 const amount=2e-5*Math.max(Math.abs(sceneScale),1e-3,...position.map(Math.abs));
 return add(position,scale(geometricNormal,dot(direction,geometricNormal)>=0?amount:-amount));
}
