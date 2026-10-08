import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSnapshot} from '../src/lib/ray/scenes';
import {configureSnapshot,freezeSnapshot} from '../src/lib/ray/snapshot';
import {defaultRayState,type RayLesson} from '../src/lib/ray/state';
import {buildBVH} from '../src/lib/ray/bvh';
import {packScene} from '../src/lib/ray/pack';
import {cross,dot,length,sub} from '../src/lib/ray/geometry';
import type {Primitive,SceneSnapshot} from '../src/lib/ray/types';
const near=(a:number,b:number,e=1e-10)=>assert.ok(Math.abs(a-b)<e,`${a} ≈ ${b}`);
const emissive=(s:SceneSnapshot,p:Primitive)=>s.materials[p.materialId].emission.some(v=>v>0);

test('configuration clones geometry, lights and material state without mutating its input',()=>{
 const input=createSnapshot('room',512,7),before=structuredClone(input);
 const first=configureSnapshot(input,{...defaultRayState('path'),lightSize:.4,environment:.6,roughness:.17},23);
 assert.deepEqual(input,before);assert.equal(first.version,23);assert.equal(first.frame,7);assert.deepEqual(first.environment,[.6,.6,.6]);
 assert.notEqual(first,input);assert.notEqual(first.primitives,input.primitives);assert.notEqual(first.primitives[0].a,input.primitives[0].a);assert.notEqual(first.materials[0].albedo,input.materials[0].albedo);assert.notEqual(first.light.u,input.light.u);
 first.primitives[0].a[0]=100;first.materials[0].albedo[0]=0;first.light.center[0]=100;assert.deepEqual(input,before);
 const second=configureSnapshot(input,{...defaultRayState('path'),lightSize:2},24);near(length(second.light.u),length(input.light.u)*2);assert.deepEqual(input,before);
});

test('rectangular light sampling and emissive triangle geometry scale together exactly once',()=>{
 const input=createSnapshot('room');
 for(const factor of [.1,.4,1,2]){
  const configured=configureSnapshot(input,{...defaultRayState('mis'),lightSize:factor},9),light=configured.light;
  light.u.forEach((v,i)=>near(v,input.light.u[i]*factor));light.v.forEach((v,i)=>near(v,input.light.v[i]*factor));assert.deepEqual(light.center,input.light.center);assert.deepEqual(light.emission,input.light.emission);
  let triangleArea=0;
  for(const p of configured.primitives){
   const source=input.primitives.find(q=>q.id===p.id)!;assert.equal(p.objectId,source.objectId);assert.equal(p.materialId,source.materialId);
   if(!emissive(configured,p)){assert.deepEqual(p,source);continue;}
   assert.equal(p.kind,'triangle');
   for(const field of ['a','b','c'] as const){
    p[field].forEach((v,i)=>near(v,light.center[i]+(source[field][i]-light.center[i])*factor));
    const delta=sub(p[field],light.center);near(dot(delta,light.normal),0);near(Math.abs(dot(delta,light.u)/dot(light.u,light.u)),1);near(Math.abs(dot(delta,light.v)/dot(light.v,light.v)),1);
   }
   const normal=cross(sub(p.b,p.a),sub(p.c,p.a));assert.ok(dot(normal,light.normal)>0);triangleArea+=length(normal)/2;
  }
  near(triangleArea,4*length(cross(light.u,light.v)));near(triangleArea,4*length(cross(input.light.u,input.light.v))*factor*factor);
 }
});

test('lesson material contracts keep reflection mirror, path/reconstruction Lambert and MIS GGX',()=>{
 const input=createSnapshot('room');
 for(const lesson of ['reflections','path','mis','denoise'] as RayLesson[]){
  const configured=configureSnapshot(input,{...defaultRayState(lesson),roughness:.19},11);
  if(lesson==='reflections'){assert.equal(configured.materials[4].kind,'mirror');assert.equal(configured.materials[6].kind,'ggx');}
  else for(let index=0;index<configured.materials.length;index++){
   const material=configured.materials[index];if(material.emission.some(v=>v>0)){assert.deepEqual(material,input.materials[index]);continue;}
   assert.equal(material.kind,lesson==='mis'&&index===6?'ggx':'lambert');near(material.roughness,.19);assert.deepEqual(material.albedo,input.materials[index].albedo);
  }
 }
});

test('snapshot identities stay stable through frames, moving-point correspondence and BVH packing',()=>{
 const state=defaultRayState('denoise'),previous=configureSnapshot(createSnapshot('room',512,39),state,50),current=configureSnapshot(createSnapshot('room',512,40),state,51);
 assert.deepEqual(current.primitives.map(p=>[p.id,p.objectId,p.materialId]),previous.primitives.map(p=>[p.id,p.objectId,p.materialId]));
 current.primitives.forEach((p,index)=>{for(const field of ['a','b','c'] as const){if(p.kind==='sphere'&&field!=='a')continue;p[field].forEach((v,axis)=>near(v+p.previousOffset[axis],previous.primitives[index][field][axis]));}});
 assert.ok(current.primitives.find(p=>p.objectId===6)!.previousOffset.some(v=>v!==0));assert.ok(current.primitives.filter(p=>p.objectId!==6).every(p=>p.previousOffset.every(v=>v===0)));
 freezeSnapshot(current);
 for(const method of ['median','sah'] as const){const bvh=buildBVH(current.primitives,method),packed=packScene(current,bvh);assert.equal(packed.primitiveCount,current.primitives.length);assert.deepEqual([...bvh.ordered.map(p=>p.id)].sort((a,b)=>a-b),current.primitives.map(p=>p.id));bvh.ordered.forEach((p,i)=>assert.equal(packed.primitives[i*24+16],p.id));}
});

test('shadow setup keeps stable finite blockers and lights as the controlled slab moves',()=>{
 const input=createSnapshot('room'),low=configureSnapshot(input,{...defaultRayState('shadows'),variant:0},2),high=configureSnapshot(input,{...defaultRayState('shadows'),variant:1},3);
 assert.ok(low.primitives.every(p=>[0,5,6,7,8].includes(p.objectId)));assert.equal(new Set(low.primitives.map(p=>p.id)).size,low.primitives.length);
 assert.deepEqual(low.primitives.map(p=>[p.id,p.objectId]),high.primitives.map(p=>[p.id,p.objectId]));
 const slabs=low.primitives.filter(p=>p.objectId===8);assert.equal(slabs.length,2);assert.deepEqual(slabs.map(p=>p.id),[14,15]);
 low.primitives.forEach((p,i)=>{if(p.objectId!==8){assert.deepEqual(p,high.primitives[i]);return;}for(const field of ['a','b','c'] as const){near(p[field][1],.4);near(high.primitives[i][field][1],1.6);}});
 assert.equal(low.primitives.filter(p=>emissive(low,p)).length,2);
});

test('freezing a configured snapshot protects every externally reachable mutable geometry field',()=>{
 const frozen=freezeSnapshot(configureSnapshot(createSnapshot('room'),defaultRayState('path'),13));
 const checked=new Set<object>();function assertDeepFrozen(value:unknown){if(!value||typeof value!=='object'||checked.has(value))return;checked.add(value);assert.ok(Object.isFrozen(value));Object.values(value).forEach(assertDeepFrozen);}
 assertDeepFrozen(frozen);
 assert.throws(()=>{frozen.version=99;},TypeError);assert.throws(()=>{frozen.primitives[0].a[0]=99;},TypeError);assert.throws(()=>{frozen.primitives[0].previousOffset[0]=99;},TypeError);assert.throws(()=>{frozen.materials[0].albedo[0]=0;},TypeError);assert.throws(()=>{frozen.light.u[0]=0;},TypeError);assert.throws(()=>{frozen.environment[0]=1;},TypeError);
 const next=configureSnapshot(frozen,{...defaultRayState('path'),lightSize:.5},14);assert.equal(next.version,14);assert.equal(frozen.version,13);assert.ok(!Object.isFrozen(next));
});

test('BVH stress lessons use the requested triangle budget without changing primitive identities or query fixtures',()=>{
 for(const preset of ['scatter','clusters','overlap'] as const){
  const input=createSnapshot(preset,512,12),before=structuredClone(input),configured=configureSnapshot(input,{...defaultRayState('bvh'),preset},71);
  assert.equal(configured.primitives.length,512);assert.ok(configured.primitives.every(p=>p.kind==='triangle'));
  assert.ok(input.primitives.some(p=>p.kind==='sphere'));assert.deepEqual(input,before);
  configured.primitives.forEach((p,i)=>{
   const original=input.primitives[i];assert.equal(p.id,original.id);assert.equal(p.objectId,original.objectId);assert.equal(p.materialId,original.materialId);assert.deepEqual(p.previousOffset,original.previousOffset);
   if(original.kind==='triangle')assert.deepEqual(p,original);
   else {assert.equal(p.radius,0);assert.ok(length(cross(sub(p.b,p.a),sub(p.c,p.a)))>0);near((p.a[0]+p.b[0])/2,original.a[0]);}
  });
  const bvh=buildBVH(configured.primitives,'sah'),packed=packScene(configured,bvh);assert.equal(packed.primitiveCount,512);for(let i=0;i<512;i++)assert.equal(packed.primitives[i*24+3],0);
  const query=configureSnapshot(input,{...defaultRayState('rays'),preset},72);assert.deepEqual(query.primitives,input.primitives);
 }
 const room=configureSnapshot(createSnapshot('room'),{...defaultRayState('bvh'),preset:'room'},73);assert.ok(room.primitives.some(p=>p.kind==='sphere'));
});
