import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,PerspectiveCamera,Vector3,Vector4} from 'three';
import type {Primitive,Vec3} from '../src/lib/ray/types';
import {add,cross,length,scale} from '../src/lib/ray/geometry';
import {areaLightVisibilitySample,blockerAverage,blockerSearchUv,coveredUv,cpuShadowTexelDepth,evaluatePcf,filterGrid,hammersley2D,lightTexelRay,linearDepth,nearestTexel,pcfVisibility,penumbraUv,penumbraWorld,perspectiveDepth,pointVisibility,projectToLight,receiverPlaneDepth,referenceVisibility,squareLightPoint} from '../src/lib/shadow/math';

const near=(a:number,b:number,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} ≈ ${b}`);
function lightCamera(nearPlane=.5,far=25){const camera=new PerspectiveCamera(75,1,nearPlane,far);camera.position.set(-3.5,7,4.5);camera.lookAt(0,0,0);camera.updateMatrixWorld();return camera;}
function horizontalQuad(y:number,minX=-10,maxX=10,minZ=-10,maxZ=10,startId=0):Primitive[]{
 const a:Vec3=[minX,y,maxZ],b:Vec3=[maxX,y,maxZ],c:Vec3=[maxX,y,minZ],d:Vec3=[minX,y,minZ];
 return [[a,b,c],[a,c,d]].map((points,index)=>({kind:'triangle',a:points[0],b:points[1],c:points[2],radius:0,id:startId+index,objectId:startId,materialId:0,previousOffset:[0,0,0]}));
}

test('perspective depth matches a real projection matrix across near/far ranges',()=>{
 for(const n of [.1,.5,2])for(const f of [10,25,80]){
  const camera=new PerspectiveCamera(75,1.4,n,f);near(perspectiveDepth(n,n,f),0);near(perspectiveDepth(f,n,f),1);
  const harmonic=2*n*f/(n+f);near(perspectiveDepth(harmonic,n,f),.5);near(linearDepth(.5,n,f),harmonic);
  for(const d of [n,harmonic,(n+f)/2,f]){
   const clip=new Vector4(.1,.2,-d,1).applyMatrix4(camera.projectionMatrix),expected=clip.z/clip.w*.5+.5;
   near(perspectiveDepth(d,n,f),expected);near(linearDepth(expected,n,f),d,2e-11);
  }
 }
 assert.throws(()=>perspectiveDepth(0),/positive/);assert.throws(()=>linearDepth(.5,1,1),/near/);
});

test('blocker averaging happens after linearizing depth, and only accepts closer blockers',()=>{
 const depths=[perspectiveDepth(1),perspectiveDepth(9)],wrong=linearDepth((depths[0]+depths[1])/2),average=blockerAverage(depths.map(d=>linearDepth(d)),10);
 near(average.distance!,5);assert.equal(average.count,2);assert.ok(Math.abs(wrong-5)>3);
 assert.deepEqual(blockerAverage([0,-1,2,4.99,5,8,NaN],5,.02),{count:1,distance:2});
 assert.deepEqual(blockerAverage([5,8],5),{count:0,distance:null});
});

test('UV coverage never clamps missing requests into an apparently lit texel',()=>{
 assert.deepEqual(nearestTexel([.501,.249],[8,4]),{pixel:[4,0],uv:[4.5/8,.5/4]});
 assert.deepEqual(nearestTexel([0,0],128),{pixel:[0,0],uv:[.5/128,.5/128]});
 for(const uv of [[1,.5],[-.0001,.5],[.5,1],[NaN,.5],[.5,Infinity]] as [number,number][]){assert.equal(coveredUv(uv),false);assert.equal(nearestTexel(uv,512),null);}
 const pcf=evaluatePcf([{depth:1,receiver:.5,valid:true},{depth:1,receiver:.5,valid:false}]);assert.equal(pcf.visibility,null);assert.equal(pcf.validSamples,1);assert.equal(pcf.missingSamples,1);assert.deepEqual(pcf.comparisons,[1,null]);
});

test('PCF compares before averaging; radius zero exactly reduces to the hard comparison',()=>{
 assert.equal(pcfVisibility([.2,.8],.6),.5);assert.equal(pcfVisibility([(.2+.8)/2],.6),0,'averaging raw depth estimates a different quantity');
 assert.equal(pcfVisibility([2],2.001,.002),1);assert.equal(pcfVisibility([2],2.001,0),0);
 const zero=filterGrid(0);assert.equal(zero.length,81);assert.ok(zero.every(([x,y])=>x===0&&y===0));
 assert.equal(pcfVisibility(zero.map(()=>.2),.3),0);assert.equal(pcfVisibility(zero.map(()=>.8),.3),1);
 assert.equal(evaluatePcf([]).visibility,null);assert.equal(evaluatePcf([{depth:NaN,receiver:.5,valid:true}]).visibility,null);
 assert.deepEqual(filterGrid(4,1),[[0,0]]);
});

test('contact penumbra is zero and similar triangles convert world half-width to UV radius',()=>{
 near(penumbraWorld(.5,5,2),.75);near(penumbraUv(.5,5,2,1),.075);near(penumbraUv(.5,5,2,1,2),.0375);
 near(penumbraWorld(.5,2,2),0);near(penumbraUv(.5,2,2,1),0);near(penumbraWorld(.5,2,3),0);near(penumbraWorld(.5,2,0),0);near(penumbraWorld(0,5,2),0);
 near(penumbraUv(5,50,20,1),penumbraUv(.5,5,2,1));near(blockerSearchUv(.5,5,1,1),.2);near(blockerSearchUv(0,5,1,1),0);
 assert.ok(blockerSearchUv(.5,5,3,1)<blockerSearchUv(.5,5,.5,1));
});

test('CPU texel ray respects axial clip planes and unit world directions',()=>{
 const camera=lightCamera(),ray=lightTexelRay([.73,.21],256,camera.matrixWorld,camera.projectionMatrixInverse)!;
 near(length(ray.direction),1);
 const nearWorld=add(ray.origin,scale(ray.direction,ray.tMin)),farWorld=add(ray.origin,scale(ray.direction,ray.tMax));
 near(-new Vector3(...nearWorld).applyMatrix4(camera.matrixWorldInverse).z,.5);near(-new Vector3(...farWorld).applyMatrix4(camera.matrixWorldInverse).z,25);
 assert.ok(ray.tMin>.5);assert.equal(lightTexelRay([1.01,.5],256,camera.matrixWorld,camera.projectionMatrixInverse),null);
});

test('independent full triangle query matches analytic receiver-plane depth at actual texel centers',()=>{
 const camera=lightCamera(),floor=horizontalQuad(0),vp=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),receiver:Vec3=[.73,0,.29],projection=projectToLight(receiver,vp);
 assert.ok(projection.covered);const texel=nearestTexel(projection.uv,128)!;
 const expected=receiverPlaneDepth(texel.uv,receiver,[0,1,0],camera.matrixWorld,camera.projectionMatrixInverse)!,sample=cpuShadowTexelDepth(floor,projection.uv,128,camera.matrixWorld,camera.projectionMatrixInverse)!;
 assert.ok(sample.hit);near(sample.hit.position[1],0);near(sample.distance,expected);near(sample.depth,perspectiveDepth(expected));
 const originalDistance=-new Vector3(...receiver).applyMatrix4(camera.matrixWorldInverse).z;assert.ok(Math.abs(expected-originalDistance)>1e-5,'continuous receiver depth differs from the sampled texel plane depth');
 const ray=lightTexelRay(projection.uv,128,camera.matrixWorld,camera.projectionMatrixInverse)!,parallelNormal=cross(ray.direction,[1,0,0]);
 assert.equal(receiverPlaneDepth(texel.uv,receiver,parallelNormal,camera.matrixWorld,camera.projectionMatrixInverse),null);
 assert.equal(cpuShadowTexelDepth(floor,[-.1,.5],128,camera.matrixWorld,camera.projectionMatrixInverse),null);
 const miss=cpuShadowTexelDepth([],projection.uv,128,camera.matrixWorld,camera.projectionMatrixInverse)!;assert.equal(miss.hit,null);assert.equal(miss.depth,1);assert.equal(miss.distance,25);
 assert.equal(projectToLight(camera.position.clone().add(new Vector3(0,1,0)).toArray() as Vec3,vp).covered,false);
});

test('area-light samples have deterministic fixed prefixes and cover both halves before 512',()=>{
 const points=Array.from({length:1024},(_,index)=>hammersley2D(index,1024,17));assert.ok(points.every(coveredUv));assert.equal(new Set(points.map(p=>p.join(','))).size,1024);
 const quarters=[0,0,0,0];points.slice(0,512).forEach(([u,v])=>quarters[(u<.5?0:1)+(v<.5?0:2)]++);assert.ok(quarters.every(n=>n>115&&n<141),String(quarters));
 assert.deepEqual(points.slice(0,512),Array.from({length:512},(_,index)=>hammersley2D(index,1024,17)));assert.notDeepEqual(points[0],hammersley2D(0,1024,18));
 const light={center:[1,2,3] as Vec3,u:[.5,0,0] as Vec3,v:[0,0,.5] as Vec3};assert.deepEqual(squareLightPoint(light,[0,1]),[.5,2,3.5]);
});

test('CPU area visibility traces finite mesh segments including real zero contributions and endpoint exclusions',()=>{
 const position:Vec3=[0,0,0],normal:Vec3=[0,1,0],light={center:[0,2,0] as Vec3,u:[1,0,0] as Vec3,v:[0,0,1] as Vec3};
 const floor=horizontalQuad(0),emitter=horizontalQuad(2,-1,1,-1,1,2),behind=horizontalQuad(3,-10,10,-10,10,4);
 assert.equal(referenceVisibility(position,normal,[...floor,...emitter,...behind],light).value,1);
 const occluder=horizontalQuad(1,-2,2,-2,2,6),blocked=referenceVisibility(position,normal,[...floor,...occluder],light);
 assert.equal(blocked.value,0);assert.equal(blocked.checkpoint,0);assert.equal(blocked.convergence,0);assert.ok(Number.isFinite(blocked.value));
 assert.equal(pointVisibility(position,normal,light.center,behind),1);assert.equal(pointVisibility(position,normal,light.center,occluder),0);
 const pointLight={...light,u:[0,0,0] as Vec3,v:[0,0,0] as Vec3};assert.equal(referenceVisibility(position,normal,occluder,pointLight).value,0);
});

test('512→1024 reports the change in one prefix estimate, not a confidence interval',()=>{
 const position:Vec3=[0,0,0],normal:Vec3=[0,1,0],triangles=horizontalQuad(1,0,2,-2,2),light={center:[0,2,0] as Vec3,u:[1,0,0] as Vec3,v:[0,0,1] as Vec3,capacity:1024,seed:17};
 const full=referenceVisibility(position,normal,triangles,light),prefix=referenceVisibility(position,normal,triangles,{...light,samples:512});
 near(full.value,.5);near(full.checkpoint,prefix.value);near(full.convergence,Math.abs(full.value-prefix.value));assert.equal(full.samples,1024);assert.ok(Math.abs(prefix.value-.5)<.03);
 let first=0,all=0;for(let index=0;index<1024;index++){const value=areaLightVisibilitySample(position,normal,triangles,{...light,index});all+=value;if(index<512)first+=value;}
 near(full.value,all/1024);near(full.checkpoint,first/512);assert.deepEqual(Object.keys(full).sort(),['checkpoint','convergence','samples','value']);
});
