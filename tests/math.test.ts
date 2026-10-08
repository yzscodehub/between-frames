import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sliceIntegral,numericalSlice,hemisphereAverage} from '../src/lib/math';
import {defaultState,encodeState,decodeState,invalidateBenchmark} from '../src/lib/state';
test('analytic slices agree with independent quadrature, including clipping and tilted normals',()=>{
 for(const gamma of [-1.4,-.6,0,.4,1.4]) for(const low of [-Math.PI,-1.7,-.5,0]) for(const high of [.1,.9,2,Math.PI]){
  assert.ok(Math.abs(sliceIntegral(gamma,low,high,.7)-numericalSlice(gamma,low,high,.7,20000))<2e-7);
 }
});
test('unoccluded full hemisphere normalizes for tilted normals',()=>{
 for(const t of [0,.3,.9,1.5]) assert.ok(Math.abs(hemisphereAverage([Math.sin(t),0,Math.cos(t)])-1)<1e-6);
});
test('degenerate, closed and symmetric slices',()=>{
 assert.equal(sliceIntegral(0,0,0),0); assert.equal(sliceIntegral(0,-2,2,0),0);
 assert.equal(sliceIntegral(0,1,0),0);
 assert.ok(Math.abs(sliceIntegral(.5,-.7,1.4)-sliceIntegral(-.5,-1.4,.7))<1e-12);
 assert.ok(Math.abs(sliceIntegral(0,-Math.PI/2,Math.PI/2)-1)<1e-12);
});
test('state roundtrip, unsupported versions, invalid parameters and transient selection',()=>{
 const s=defaultState(); assert.deepEqual(decodeState(encodeState(s)).state,s);
 assert.ok(decodeState('#state='+encodeURIComponent('{"version":99}')).notice);
 assert.ok(decodeState(encodeState({...s,radius:NaN})).notice);
 assert.ok(decodeState(encodeState({...s,scene:'constructor' as any})).notice);
 assert.equal(decodeState(encodeState({...s,mode:'inspect'})).state.mode,'explore');
 assert.equal(invalidateBenchmark({...s,mode:'benchmark',view:'difference'}).view,'ao');
});
import {PerspectiveCamera,Vector3,Vector4,Matrix3,Matrix4} from 'three';
test('depth projection and inverse reconstruction recover view-space positions',()=>{
 const c=new PerspectiveCamera(45,1.6,.1,50);
 for(const p of [new Vector3(0,0,-2),new Vector3(.8,-.3,-6),new Vector3(-3,1,-20)]){
  const clip=new Vector4(p.x,p.y,p.z,1).applyMatrix4(c.projectionMatrix);clip.multiplyScalar(1/clip.w);
  const uv=[(clip.x+1)/2,(clip.y+1)/2],depth=(clip.z+1)/2;
  const q=new Vector4(2*uv[0]-1,2*uv[1]-1,2*depth-1,1).applyMatrix4(c.projectionMatrixInverse);q.multiplyScalar(1/q.w);
  assert.ok(new Vector3(q.x,q.y,q.z).distanceTo(p)<1e-10);
 }
});
test('inverse-transpose normals remain perpendicular after nonuniform scale',()=>{
 const model=new Matrix4().makeScale(2,.4,3),n=new Vector3(1,1,0).normalize(),t=new Vector3(1,-1,0).normalize();
 const transformedNormal=n.applyMatrix3(new Matrix3().getNormalMatrix(model)).normalize();t.transformDirection(model);
 assert.ok(Math.abs(transformedNormal.dot(t))<1e-12);
});
import {horizonWalk,exactBlockedInterval} from '../src/lib/horizon';
import {sceneDescription,sceneCamera} from '../src/lib/scene';
import {sceneLabels} from '../src/lib/state';
test('horizon is monotone and a floating slab has a real visible interval below it',()=>{
 const slab={x:1.1,width:.85,bottom:.55,height:.16},walk=horizonWalk(slab),exact=exactBlockedInterval(slab);
 assert.ok(exact.low>0);assert.ok(exact.high>exact.low);
 walk.forEach((s,i)=>{assert.ok(s.horizon>=s.before);if(i)assert.equal(s.before,walk[i-1].horizon);});
 assert.ok(walk.at(-1)!.horizon<=exact.high+1e-12);
 assert.equal(exactBlockedInterval({...slab,bottom:0}).low,0);
});
test('scene descriptors fit reference capacity and camera presets are valid',()=>{
 for(const name of Object.keys(sceneLabels) as (keyof typeof sceneLabels)[]){
  const spec=sceneDescription(name,0),camera=sceneCamera(name);
  assert.ok(spec.boxes.length<=24);for(const b of spec.boxes)assert.ok(b.size.every(x=>x>0));
  assert.ok(camera.position.every(Number.isFinite));
 }
 const bench=sceneDescription('bench',0);assert.ok(Math.abs(bench.sphere[1]-bench.sphere[3]-.2)<1e-9);
});
test('new comparison states roundtrip; old geometry versions explicitly invalidate',()=>{
 const state={...defaultState(),algorithm:'hbao' as const,scene:'room' as const,view:'compare' as const,comparison:'ao' as const};
 assert.deepEqual(decodeState(encodeState(state)).state,state);
 const old={...state,version:1};assert.ok(decodeState('#state='+encodeURIComponent(JSON.stringify(old))).notice);
});
test('learning context and focus roundtrip while unknown return destinations are rejected',()=>{
 const state={...defaultState(),focus:'detail' as const,learning:{chapter:'ssao' as const,lesson:'noise' as const}};
 assert.deepEqual(decodeState(encodeState(state)).state,state);
 assert.ok(decodeState(encodeState({...state,learning:{chapter:'https://example.com' as any,lesson:'noise'}})).notice);
 assert.ok(decodeState(encodeState({...state,focus:'unknown' as any})).notice);
});
import {buildScene,disposeGeometry} from '../src/lib/scene';
import {focusPoint} from '../src/lib/focus';
import {Raycaster,Vector2,MeshBasicMaterial} from 'three';
test('every recommended focus is visible on actual scene geometry from its default camera',()=>{
 const material=new MeshBasicMaterial();
 for(const name of Object.keys(sceneLabels) as (keyof typeof sceneLabels)[]){
  const setup=sceneCamera(name),camera=new PerspectiveCamera(45,1.6,.1,50);
  camera.position.set(...setup.position);camera.lookAt(...setup.target);camera.updateMatrixWorld();
  const group=buildScene(name,0,material);group.updateMatrixWorld(true);
  for(const id of ['primary','detail'] as const){
   const world=new Vector3(...focusPoint(name,id).position),clip=world.clone().project(camera);
   assert.ok(Math.abs(clip.x)<1&&Math.abs(clip.y)<1,`${name}/${id} is in the image`);
   const ray=new Raycaster();ray.setFromCamera(new Vector2(clip.x,clip.y),camera);
   const hit=ray.intersectObjects(group.children)[0];assert.ok(hit&&hit.point.distanceTo(world)<.005,`${name}/${id} is not hidden behind another surface`);
  }
  disposeGeometry(group);
 }
 material.dispose();
});
