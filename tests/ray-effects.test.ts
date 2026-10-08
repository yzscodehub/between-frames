import {test} from 'node:test';
import assert from 'node:assert/strict';
import {linearizePerspectiveDepth,perspectiveDepth,pcssPenumbra,pcssPenumbraUv,nearestShadowTexelUv,receiverPlaneDepth,reflectPoint,reflectVector,reflectedCameraRay,planeRayPoint} from '../src/lib/ray/effects-math';
import {add,dot,intersectSphere,makeRay,normalize,scale,sub} from '../src/lib/ray/geometry';
import type {Primitive,Vec3} from '../src/lib/ray/types';
const near=(a:number,b:number,e=1e-9)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);
test('perspective shadow depths restore positive light-view axial distance before averaging blockers',()=>{
 for(const nearPlane of [.04,.1,1])for(const far of [20,50,100])for(const distance of [nearPlane,.5,2,7,far]){
  if(distance<nearPlane)continue;near(linearizePerspectiveDepth(perspectiveDepth(distance,nearPlane,far),nearPlane,far),distance,2e-10);
 }
 const a=perspectiveDepth(1,.1,50),b=perspectiveDepth(9,.1,50);
 near((linearizePerspectiveDepth(a,.1,50)+linearizePerspectiveDepth(b,.1,50))/2,5);
 assert.ok(Math.abs(linearizePerspectiveDepth((a+b)/2,.1,50)-5)>2);
});
test('PCSS similar triangles produce world penumbra then UV radius at the receiver plane',()=>{
 near(pcssPenumbra(.8,5,2),1.2);near(pcssPenumbra(.8,2,2),0);near(pcssPenumbra(.8,1,2),0);
 const tangent=Math.tan(70*Math.PI/180);near(pcssPenumbraUv(.8,5,2,tangent),1.2/(10*tangent));
 near(pcssPenumbraUv(1.6,5,2,tangent),2*pcssPenumbraUv(.8,5,2,tangent));
 near(pcssPenumbraUv(.8,5,2,tangent,2),pcssPenumbraUv(.8,5,2,tangent)/2);
 near(pcssPenumbraUv(8,50,20,tangent),pcssPenumbraUv(.8,5,2,tangent));
});
test('mirrored camera ray crosses the identical floor point and follows an ideal reflection',()=>{
 const ray=makeRay([1,3,8],[-.2,-.5,-1],1e-4,50),point=planeRayPoint(ray)!,mirror=reflectedCameraRay(ray)!;
 const mirroredPoint=planeRayPoint(mirror)!;point.forEach((v,i)=>near(v,mirroredPoint[i]));
 assert.deepEqual(reflectPoint([1,3,8],[0,0,0],[0,1,0]),[1,-3,8]);
 assert.deepEqual(mirror.direction,reflectVector(ray.direction,[0,1,0]));
 const reflectedFromHit=add(point,scale(mirror.direction,2)),virtualCameraPath=add(mirror.origin,scale(mirror.direction,mirror.tMin-1e-4+2));
 reflectedFromHit.forEach((v,i)=>near(v,virtualCameraPath[i]));assert.ok(mirror.tMin>ray.tMin);near(mirror.tMax-mirror.tMin,50-1e-4);
 assert.equal(reflectedCameraRay(makeRay([0,1,0],[1,0,0])),null);
 assert.equal(reflectedCameraRay(makeRay([0,1,0],[0,1,0])),null);
});

test('receiver depth uses the stored texel ray rather than a different continuous UV',()=>{
 const tangent=Math.tan(50*Math.PI/180),point:Vec3=[.73,.29,-3],normal=normalize([.4,.8,1]);
 const uv:[number,number]=[.5+point[0]/(6*tangent),.5+point[1]/(6*tangent)],snapped=nearestShadowTexelUv(uv,[64,64]);
 const depth=receiverPlaneDepth(snapped,point,normal,[tangent,tangent])!;
 assert.ok(Math.abs(depth-3)>.0001,'a tilted surface changes depth between these ray locations');
 const texelPoint:Vec3=[(snapped[0]*2-1)*tangent*depth,(snapped[1]*2-1)*tangent*depth,-depth];
 near(dot(sub(texelPoint,point),normal),0);near(receiverPlaneDepth(uv,point,normal,[tangent,tangent])!,3);
 assert.deepEqual(nearestShadowTexelUv([1,0],[64,64]),[63.5/64,.5/64]);
});

test('a light-facing convex sphere does not block its own local tangent plane at neighboring texels',()=>{
 const sphere:Primitive={kind:'sphere',a:[0,0,-3],b:[0,0,0],c:[0,0,0],radius:1,id:1,objectId:1,materialId:0,previousOffset:[0,0,0]},tangent=Math.tan(50*Math.PI/180);
 for(const resolution of [64,128,256])for(const x of [-.75,-.5,-.1,.1,.5,.75]){
  const normal:Vec3=[x,0,Math.sqrt(1-x*x)],point=add(sphere.a,normal),distance=-point[2];
  const uv:[number,number]=[.5+point[0]/(2*distance*tangent),.5],sampleUv=nearestShadowTexelUv(uv,[resolution,resolution]);
  const ray=makeRay([0,0,0],[(sampleUv[0]*2-1)*tangent,(sampleUv[1]*2-1)*tangent,-1]);
  const hit=intersectSphere(ray,sphere)!;assert.ok(hit);
  const tangentDepth=receiverPlaneDepth(sampleUv,point,normal,[tangent,tangent])!;
  assert.ok(tangentDepth<=-hit.position[2]+1e-10,'the sampled front surface is behind its tangent receiver');
 }
});
