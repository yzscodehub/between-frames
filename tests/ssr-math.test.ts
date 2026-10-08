import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera,Vector3,Vector4} from 'three';
import {insideUv,linearDepth,localColor,needsRefinement,perspectivePoint,projectView,reflectDirection,screenDdaPoints} from '../src/lib/ssr/math';
import {createSSRScene} from '../src/lib/ssr/scene';
import {defaultSSRState} from '../src/lib/ssr/state';
import {cross,dot,length,sub,traceBrute,makeRay} from '../src/lib/ray/geometry';
import type {Vec3} from '../src/lib/ray/types';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);
test('native perspective depth linearizes to positive camera axial distance',()=>{
 for(const n of [.1,.5])for(const f of [25,50])for(const d of [n,1,7,f]){const c=new PerspectiveCamera(45,1.6,n,f),clip=new Vector4(0,0,-d,1).applyMatrix4(c.projectionMatrix);near(linearDepth(clip.z/clip.w*.5+.5,n,f),d);}
});
test('reflection preserves tangential components and unit length',()=>{
 const d=new Vector3(.3,-.8,-.5).normalize().toArray() as Vec3,n:Vec3=[0,1,0],r=reflectDirection(d,n);near(length(r),1);near(r[0],d[0]);near(r[1],-d[1]);near(r[2],d[2]);near(dot(r,n),-dot(d,n));
});
test('perspective-correct interpolation projects to a linear screen segment',()=>{
 const projection=new PerspectiveCamera(55,1.6,.1,50).projectionMatrix,a:Vec3=[-1,.3,-2],b:Vec3=[2,-.8,-12],uv0=projectView(a,projection)!,uv1=projectView(b,projection)!;
 for(const lambda of [.1,.25,.5,.75,.9]){const p=perspectivePoint(a,b,2,12,lambda),uv=projectView(p,projection)!;near(uv[0],uv0[0]+(uv1[0]-uv0[0])*lambda);near(uv[1],uv0[1]+(uv1[1]-uv0[1])*lambda);near(length(cross(sub(p,a),sub(b,a))),0);}
 const naive=a.map((v,i)=>(v+b[i])/2) as Vec3;assert.ok(Math.abs(projectView(naive,projection)![0]-(uv0[0]+uv1[0])/2)>.02);
});
test('screen DDA visits adjacent major-axis pixels at stride one',()=>{
 const projection=new PerspectiveCamera(55,1.6,.1,50).projectionMatrix,points=screenDdaPoints([-.7,.2,-2],[2,-1,-12],projection,[320,200],1);assert.ok(points.length>20);
 for(let i=1;i<points.length;i++){const a=points[i-1].uv.map((v,j)=>Math.floor(v*[320,200][j])),b=points[i].uv.map((v,j)=>Math.floor(v*[320,200][j]));assert.ok(Math.abs(a[0]-b[0])<=1);assert.ok(Math.abs(a[1]-b[1])<=1);}
 near(points.at(-1)!.lambda,1);assert.ok(screenDdaPoints([-.7,.2,-2],[2,-1,-12],projection,[320,200],4).length<points.length);
});
test('a large step crossing must be refined before applying thickness',()=>{
 assert.equal(needsRefinement(-.3,2,.05),true);assert.equal(needsRefinement(null,2,.05),false);assert.equal(needsRefinement(null,.03,.05),true);assert.equal(needsRefinement(.2,.3,.05),false);
 assert.equal(insideUv([1,.5]),false);assert.equal(insideUv([-.01,.5]),false);assert.equal(insideUv([.5,.5]),true);assert.equal(insideUv([NaN,.5]),false);
});
test('procedural scenes use the same explicit mesh triangles and stable moving identities',()=>{
 for(const preset of ['gallery','thin','hidden'] as const){const a=createSSRScene({...defaultSSRState(),preset}),b=createSSRScene({...defaultSSRState(),preset,offset:2});try{
  assert.ok(a.snapshot.primitives.length>20&&a.snapshot.primitives.length<2048);assert.ok(a.snapshot.primitives.every(p=>p.kind==='triangle'));assert.equal(a.snapshot.materials[0].kind,'mirror');
  assert.deepEqual(a.snapshot.primitives.map(p=>[p.id,p.objectId,p.materialId]),b.snapshot.primitives.map(p=>[p.id,p.objectId,p.materialId]));
  const hit=traceBrute(makeRay([0,3,3],[0,-1,0]),a.snapshot.primitives).hit;assert.equal(hit?.objectId,0);near(hit!.position[1],0);
 }finally{a.dispose();b.dispose();}}
});
test('flat and local diagnostics preserve the shared linear color definition',()=>{
 const rho:Vec3=[.2,.4,.8];assert.deepEqual(localColor(rho,[0,1,0],[0,-1,0],'flat'),rho);
 const normal=new Vector3(-.55,.85,.65).normalize().toArray() as Vec3,incoming=normal.map(v=>-v) as Vec3;localColor(rho,normal,incoming,'local').forEach((c,i)=>near(c,rho[i]));
 assert.deepEqual(localColor(rho,[0,-1,0],[0,1,0],'local'),rho.map(v=>v*.18));
});
