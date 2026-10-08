import assert from 'node:assert/strict';
import test from 'node:test';
import {Matrix4,PerspectiveCamera} from 'three';
import {cameraAt,clipAabb,frameJitter,historyBlend,historyColorUv,jitterProjection,objectOffset,previousPoint,projectPoint,referenceJitter} from '../src/lib/taa/math';
import {decodeTAAState,defaultTAAState,encodeTAAState,sequenceKey} from '../src/lib/taa/state';
const close=(a:number,b:number,e=1e-10)=>assert.ok(Math.abs(a-b)<e,a+' differs from '+b);
test('TAA projection offset is exactly a pixel-space image displacement, with GL positive Y',()=>{
 const c=new PerspectiveCamera(45,1.6,.1,40);const point:[number,number,number]=[.3,.4,-4];
 const original=projectPoint(point,c.projectionMatrix),shifted=projectPoint(point,jitterProjection(c.projectionMatrix,[.25,-.375],320,200));
 close((shifted.uv[0]-original.uv[0])*320,.25);close((shifted.uv[1]-original.uv[1])*200,-.375);
 close(shifted.depth,original.depth);
});
test('TAA separates jittered geometry validation from fixed-lattice color accumulation',()=>{
 const width=320,height=200,c=new PerspectiveCamera(45,1.6,.1,40),p:[number,number,number]=[.1,.2,-5];
 const now=frameJitter(7),before=frameJitter(6),a=projectPoint(p,jitterProjection(c.projectionMatrix,now,width,height)),b=projectPoint(p,jitterProjection(c.projectionMatrix,before,width,height));
 const history=historyColorUv(b.uv,now,before,width,height);
 close(history[0],a.uv[0]);close(history[1],a.uv[1]);assert.notDeepEqual(a.uv,b.uv);
 // A known subpixel step: old sample is white, new sample is black.
 const f=(u:number)=>u>=.5?1:0,j0=-.25,j1=.25,u=.5;
 const oldSignal=(pixelUv:number)=>f(pixelUv-j0/width),current=f(u-j1/width);
 const geometryUv=u+(j0-j1)/width,colorUv=historyColorUv([geometryUv,.5],[j1,0],[j0,0],width,height)[0];
 assert.equal(oldSignal(geometryUv),current,'following the same world sample would cancel sampling');
 const mixed=historyBlend([current,current,current],[oldSignal(colorUv),oldSignal(colorUv),oldSignal(colorUv)],1,.9,true);
 close(mixed.color[0],.5);assert.equal(mixed.age,2);
});
test('TAA previous object transform maps a translated point back before projecting',()=>{
 const current=new Matrix4().makeTranslation(2,0,0),old=new Matrix4().makeTranslation(.5,0,0);
 assert.deepEqual(previousPoint([3,1,-4],current,old),[1.5,1,-4]);
 const camera=new PerspectiveCamera(45,1.6,.1,40);camera.position.set(1,0,0);camera.lookAt(0,0,-5);camera.updateMatrixWorld();
 const vp=camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse),r=projectPoint([1.5,1,-4],vp);assert.ok(r.depth>0&&r.uv.every(Number.isFinite));
});
test('TAA clipping lies on AABB and rejection discards old color and resets age',()=>{
 const clipped=clipAabb([4,2,-1],[0,0,0],[1,1,1]);assert.ok(clipped.every(v=>v>=-2e-5&&v<=1+2e-5));
 const rejected=historyBlend([.2,.3,.4],[10,20,30],51,.98,false);assert.deepEqual(rejected,{color:[.2,.3,.4],weight:0,age:1});
 close(historyBlend([0,0,0],[1,1,1],1,.98,true).weight,.5);
});
test('16-point jitter repeats while 64-reference samples are distinct stratified cells',()=>{
 for(let i=0;i<16;i++)assert.deepEqual(frameJitter(i),frameJitter(i+16));
 const points=Array.from({length:64},(_,i)=>referenceJitter(i,17));assert.equal(new Set(points.map(p=>p.join(','))).size,64);
 assert.equal(new Set(points.map(p=>Math.floor((p[0]+.5)*8)+','+Math.floor((p[1]+.5)*8))).size,64);
 assert.ok(points.flat().every(v=>v>=-.5&&v<.5));assert.notDeepEqual(referenceJitter(0,17),referenceJitter(0,18));
});
test('controlled camera cut and moving-object states are deterministic',()=>{
 const s=defaultTAAState();s.motion='cut';assert.notDeepEqual(cameraAt(s,59),cameraAt(s,60));assert.deepEqual(cameraAt(s,60),cameraAt(s,120));
 s.motion='object';assert.notEqual(objectOffset(s,0),objectOffset(s,30));assert.equal(objectOffset(s,30),objectOffset(s,30));
});
test('TAA share state round-trips, rejects invalid state, and presentation does not change sequence key',()=>{
 const s={...defaultTAAState(),frame:77,weight:.95};assert.deepEqual(decodeTAAState(encodeTAAState(s)).state,s);
 assert.equal(sequenceKey(s),sequenceKey({...s,view:'reject',exposure:3,compare:true}));
 assert.notEqual(sequenceKey(s),sequenceKey({...s,clipping:false}));
 for(const patch of [{frame:121},{weight:1},{jitter:1},{motion:'free'},{camera:{position:[0,0,0],target:[0,0,0]}}])assert.ok(decodeTAAState(encodeTAAState({...s,...patch} as any)).notice);
});
