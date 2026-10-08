import {test} from 'node:test';
import assert from 'node:assert/strict';
import type {BVH,Primitive,Ray,Vec3} from '../src/lib/ray/types';
import {RAY_LIMITS} from '../src/lib/ray/types';
import {dot,intersectBounds,intersectPrimitive,makeRay,offsetOrigin,primitiveBounds,traceBrute} from '../src/lib/ray/geometry';
import {buildBVH,traceBVH} from '../src/lib/ray/bvh';
import {createSnapshot,scenePresets} from '../src/lib/ray/scenes';
import {packScene} from '../src/lib/ray/pack';

const triangle=(id=0):Primitive=>({kind:'triangle',a:[-1,-1,0],b:[1,-1,0],c:[0,1,0],radius:0,id,objectId:id,materialId:0,previousOffset:[0,0,0]});
const sphere=(id=0,center:Vec3=[0,0,0],radius=1):Primitive=>({...triangle(id),kind:'sphere',a:center,radius});
const near=(a:number,b:number,e=1e-9)=>assert.ok(Math.abs(a-b)<=e,`${a} ≈ ${b}`);
function randomGenerator(seed=97){let s=seed;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}

test('CPU plane/Gram triangle oracle supports front/back, edges, and finite t intervals',()=>{
 const p=triangle(),ray=makeRay([0,0,2],[0,0,-1]);
 const hit=intersectPrimitive(ray,p)!;assert.ok(hit.frontFace);near(hit.t,2);near(hit.barycentric.reduce((a,b)=>a+b,0),1);assert.deepEqual(hit.geometricNormal,[0,0,1]);
 const back=intersectPrimitive(makeRay([0,0,-2],[0,0,1]),p)!;assert.equal(back.frontFace,false);near(dot(back.shadingNormal,[0,0,1]),-1);
 assert.ok(intersectPrimitive({...ray,tMin:2,tMax:2},p));assert.equal(intersectPrimitive({...ray,tMax:1.99},p),null);
 assert.ok(intersectPrimitive(makeRay([-1,-1,2],[0,0,-1]),p));
 assert.equal(intersectPrimitive(makeRay([0,0,2],[1,0,0]),p),null);
 assert.equal(intersectPrimitive(ray,{...p,c:[0,-1,0]}),null);
 assert.equal(intersectPrimitive(makeRay([2,2,2],[0,0,-1]),p),null);
});

test('analytic spheres handle inside, tangent, non-unit direction, and finite segments',()=>{
 const p=sphere();near(intersectPrimitive(makeRay([0,0,3],[0,0,-1]),p)!.t,2);
 const inside=intersectPrimitive(makeRay([0,0,0],[1,0,0]),p)!;near(inside.t,1);assert.equal(inside.frontFace,false);
 near(intersectPrimitive(makeRay([1,0,3],[0,0,-1]),p)!.t,3);
 near(intersectPrimitive({origin:[0,0,3],direction:[0,0,-2],tMin:0,tMax:5},p)!.t,1);
 assert.equal(intersectPrimitive(makeRay([0,0,3],[0,0,-1],0,1.99),p),null);
 assert.equal(intersectPrimitive(makeRay([0,0,3],[0,0,-1]),{...p,radius:0}),null);
 const far=intersectPrimitive(makeRay([0,0,100000],[0,0,-1]),p)!;near(far.t,99999,1e-6);
});

test('parallel AABB slabs, boundary rays, inside origins, and t clipping are inclusive',()=>{
 const box={min:[-1,-1,-1] as Vec3,max:[1,1,1] as Vec3};
 assert.deepEqual(intersectBounds(makeRay([0,0,3],[0,0,-1]),box),[2,4]);
 assert.deepEqual(intersectBounds(makeRay([1,0,3],[0,0,-1]),box),[2,4]);
 assert.equal(intersectBounds(makeRay([1.001,0,3],[0,0,-1]),box),null);
 assert.deepEqual(intersectBounds(makeRay([0,0,0],[1,0,0]),box),[0,1]);
 assert.deepEqual(intersectBounds(makeRay([0,0,3],[0,0,-1],2,2),box),[2,2]);
 assert.equal(intersectBounds(makeRay([0,0,3],[0,0,1]),box),null);
});

test('closest tie chooses stable primitive ID through primitive permutation and BVH reordering',()=>{
 const primitives=[triangle(10),triangle(2),triangle(9),triangle(3),triangle(18),triangle(1)],ray=makeRay([0,0,3],[0,0,-1]);
 for(const method of ['median','sah'] as const){
  const bvh=buildBVH(primitives,method);assert.equal(traceBrute(ray,primitives).hit?.primitiveId,1);assert.equal(traceBVH(ray,bvh).hit?.primitiveId,1);
  assert.equal(traceBrute(ray,primitives,true).status,'hit');assert.equal(traceBVH(ray,bvh,true).status,'hit');
 }
});

test('all scene presets stay within budgets and independent brute agrees with both BVHs',()=>{
 const random=randomGenerator();
 for(const preset of scenePresets)for(const count of [512,2048]){
  const scene=createSnapshot(preset,count,7);assert.ok(scene.primitives.length<=count);assert.equal(new Set(scene.primitives.map(p=>p.id)).size,scene.primitives.length);
  for(const method of ['median','sah'] as const){
   const bvh=buildBVH(scene.primitives,method);assert.ok(bvh.depth<=RAY_LIMITS.depth);assert.ok(bvh.nodes.every(n=>n.count<=4));
   for(let sample=0;sample<90;sample++){
    const origin:Vec3=[(random()-.5)*9,random()*6,(random()-.5)*10];
    const target:Vec3=[(random()-.5)*4,random()*3,(random()-.5)*4];
    const ray=makeRay(origin,[target[0]-origin[0],target[1]-origin[1],target[2]-origin[2]],1e-4,50);
    const brute=traceBrute(ray,scene.primitives),accelerated=traceBVH(ray,bvh);
    assert.equal(accelerated.status,brute.status,`${preset}/${method}/${sample}`);assert.equal(accelerated.hit?.primitiveId,brute.hit?.primitiveId);
    if(brute.hit)near(accelerated.hit!.t,brute.hit.t,1e-8);
    assert.equal(traceBVH(ray,bvh,true).status,traceBrute(ray,scene.primitives,true).status);
   }
  }
 }
});

test('pathological centroids fall back to median; leaves, depth, stack, and trace logs stay bounded',()=>{
 const primitives=Array.from({length:2048},(_,i)=>sphere(i));
 const bvh=buildBVH(primitives,'sah');assert.ok(bvh.fallback);assert.equal(bvh.depth,10);assert.equal(bvh.ordered.length,2048);
 assert.ok(bvh.nodes.every(n=>n.count<=4));
 const result=traceBVH(makeRay([0,0,3],[0,0,-1]),bvh);assert.equal(result.status,'hit');assert.equal(result.hit?.primitiveId,0);
 assert.equal(result.nodeVisits,bvh.nodes.length);assert.equal(result.primitiveTests,2048);assert.equal(result.visited.length,256);assert.equal(result.logTruncated,true);
 const skew=buildBVH(Array.from({length:2048},(_,i)=>sphere(i,[Math.pow(1.14,i),0,0],.1)),'sah');
 assert.ok(skew.depth<=32);assert.ok(skew.nodes.every(n=>n.count<=4));
});

test('budget exhaustion is overflow, malformed inputs are invalid, and empty trees miss',()=>{
 const box={min:[-1,-1,-1] as Vec3,max:[1,1,1] as Vec3};
 const bvh:BVH={nodes:[{...box,left:0,right:1,start:0,count:0},{...box,left:-1,right:-1,start:0,count:1}],ordered:[sphere()],method:'median',depth:1,buildMs:0,fallback:false};
 const ray=makeRay([0,0,3],[0,0,-1]);assert.equal(traceBVH(ray,bvh).status,'overflow');
 bvh.nodes[1]={...bvh.nodes[1],min:[9,9,9],max:[10,10,10]};const visits=traceBVH(ray,bvh);assert.equal(visits.status,'overflow');assert.equal(visits.nodeVisits,4095);
 const invalid:Ray={...ray,direction:[0,0,0]};assert.equal(traceBVH(invalid,buildBVH([])).status,'invalid');assert.equal(traceBrute(invalid,[]).status,'invalid');
 assert.equal(traceBrute({...ray,tMax:NaN},[]).status,'invalid');assert.equal(traceBVH(ray,buildBVH([])).status,'miss');
 assert.equal(traceBrute({...ray,direction:[1e200,0,0]},[]).status,'invalid');
 assert.throws(()=>buildBVH(Array.from({length:2049},(_,i)=>sphere(i))),/budget/);
 assert.throws(()=>buildBVH([sphere(0),sphere(0)]),/unique/);
});

test('scale-aware geometric offset prevents outgoing self-hit at multiple scales',()=>{
 for(const unit of [.001,1,1000]){
  const p=sphere(0,[0,0,0],unit),position:Vec3=[unit,0,0],normal:Vec3=[1,0,0];
  assert.equal(traceBrute(makeRay(position,normal),[p]).status,'hit');
  const origin=offsetOrigin(position,normal,normal,unit);assert.ok(origin[0]>position[0]);assert.equal(traceBrute(makeRay(origin,normal),[p]).status,'miss');
  const inward=offsetOrigin(position,normal,[-1,0,0],unit);assert.ok(inward[0]<position[0]);assert.ok(traceBrute(makeRay(inward,[-1,0,0]),[p]).hit!.t>unit);
 }
});

test('world snapshots preserve IDs and previous-point translations; room light and mirror are explicit',()=>{
 const previous=createSnapshot('triangle',512,10,.3),current=createSnapshot('triangle',512,11,.3);
 current.primitives.forEach((p,i)=>{assert.equal(p.id,previous.primitives[i].id);for(let k=0;k<3;k++)near(p.a[k]+p.previousOffset[k],previous.primitives[i].a[k]);});
 const shifted=createSnapshot('triangle',512,11,.8);near(shifted.primitives[2].a[0]-current.primitives[2].a[0],.5);
 const room=createSnapshot('room');assert.deepEqual(room.light.normal,[0,-1,0]);assert.equal(room.materials[room.primitives[0].materialId].kind,'mirror');
 assert.equal(room.primitives.filter(p=>room.materials[p.materialId].emission.some(v=>v>0)).length,2);
 assert.ok(createSnapshot('scatter',2048).primitives.some(p=>p.kind==='sphere'));
});

test('GPU row ABI retains world geometry, stable IDs, leaf encoding and conservative Float32 bounds',()=>{
 const scene=createSnapshot('scatter',512,2),bvh=buildBVH(scene.primitives,'sah'),packed=packScene(scene,bvh);
 assert.equal(packed.nodes.length,bvh.nodes.length*8);assert.equal(packed.primitives.length,512*24);assert.equal(packed.materials.length,scene.materials.length*12);
 bvh.nodes.forEach((node,i)=>{
  for(let k=0;k<3;k++){assert.ok(packed.nodes[i*8+k]<=node.min[k]);assert.ok(packed.nodes[i*8+4+k]>=node.max[k]);}
  assert.equal(packed.nodes[i*8+3],node.count?-(node.start+1):node.left);assert.equal(packed.nodes[i*8+7],node.count?node.count:node.right);
 });
 bvh.ordered.forEach((p,i)=>{const at=i*24;assert.equal(packed.primitives[at+16],p.id);assert.equal(packed.primitives[at+15],p.objectId);assert.equal(packed.primitives[at+11],p.materialId);assert.equal(packed.primitives[at+3],p.kind==='sphere'?1:0);near(packed.primitives[at+7],p.radius,1e-7);assert.equal(packed.primitives[at+20],0);});
 const bounds=primitiveBounds(sphere(0,[1,2,3],.5));assert.deepEqual(bounds,{min:[.5,1.5,2.5],max:[1.5,2.5,3.5]});
 assert.throws(()=>packScene(createSnapshot('triangle'),bvh),/differ/);
 const unrepresentable=createSnapshot('triangle');unrepresentable.primitives[0].a[0]=1e80;
 assert.throws(()=>packScene(unrepresentable,buildBVH(unrepresentable.primitives)),/Float32/);
});

test('packed sphere cancellation expands bounds to include the geometry actually uploaded',()=>{
 for(const sign of [-1,1]){
  const scene=createSnapshot('triangle');scene.primitives=[sphere(0,[sign*(1+5e-8),0,0],1)];
  const bvh=buildBVH(scene.primitives),before=structuredClone(bvh),packed=packScene(scene,bvh);
  const quantized={...scene.primitives[0],a:Array.from(packed.primitives.slice(0,3)) as Vec3,radius:packed.primitives[7]};
  const ray=makeRay([0,0,3],[0,0,-1]);
  assert.equal(intersectBounds(ray,bvh.nodes[0]),null,'outward rounding only the original box misses this parallel slab');
  assert.ok(intersectPrimitive(ray,quantized),'the uploaded Float32 sphere is tangent to x=0');
  const packedBounds={min:Array.from(packed.nodes.slice(0,3)) as Vec3,max:Array.from(packed.nodes.slice(4,7)) as Vec3};
  assert.ok(intersectBounds(ray,packedBounds),'uploaded nodes must contain the uploaded sphere');
  assert.ok(packedBounds.min[0]<=quantized.a[0]-quantized.radius);assert.ok(packedBounds.max[0]>=quantized.a[0]+quantized.radius);
  assert.deepEqual(bvh,before,'packing must not change the CPU BVH');
 }
});

test('quantized bounds propagate from leaves through every ancestor without changing ABI or IDs',()=>{
 const scene=createSnapshot('triangle');scene.primitives=Array.from({length:128},(_,i)=>sphere(i,[1+5e-8,i*3,0],1+2e-8));
 for(const method of ['median','sah'] as const){
  const bvh=buildBVH(scene.primitives,method),before=structuredClone(bvh),packed=packScene(scene,bvh);
  const ordered=bvh.ordered.map((p,i)=>({...p,a:Array.from(packed.primitives.slice(i*24,i*24+3)) as Vec3,radius:packed.primitives[i*24+7]}));
  const nodes=bvh.nodes.map((n,i)=>({...n,min:Array.from(packed.nodes.slice(i*8,i*8+3)) as Vec3,max:Array.from(packed.nodes.slice(i*8+4,i*8+7)) as Vec3}));
  const uploaded={...bvh,nodes,ordered};assert.ok(nodes.length>1);
  nodes.forEach((node,i)=>{
   assert.ok(node.min[0]<=0,`ancestor ${i} must include Float32 cancellation`);
   for(let axis=0;axis<3;axis++){assert.ok(node.min[axis]<=bvh.nodes[i].min[axis]);assert.ok(node.max[axis]>=bvh.nodes[i].max[axis]);}
   assert.equal(packed.nodes[i*8+3],node.count?-(node.start+1):node.left);assert.equal(packed.nodes[i*8+7],node.count?node.count:node.right);
   if(!node.count)for(const child of [nodes[node.left],nodes[node.right]])for(let axis=0;axis<3;axis++){assert.ok(node.min[axis]<=child.min[axis]);assert.ok(node.max[axis]>=child.max[axis]);}
  });
  for(const id of [0,31,63,95,127]){
   const ray=makeRay([0,id*3,3],[0,0,-1]),brute=traceBrute(ray,ordered),accelerated=traceBVH(ray,uploaded);
   assert.equal(brute.status,'hit');assert.equal(accelerated.hit?.primitiveId,brute.hit?.primitiveId);near(accelerated.hit!.t,brute.hit!.t);
  }
  assert.deepEqual(bvh,before);ordered.forEach((p,i)=>assert.equal(packed.primitives[i*24+16],p.id));
 }
});
