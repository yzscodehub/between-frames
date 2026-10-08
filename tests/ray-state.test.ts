import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultRayState,decodeRayState,encodeRayState,rayCamera,rayIntegrandKey,rayLessons,type RayLesson,type RayState} from '../src/lib/ray/state';
import {rayLabHref} from '../src/lib/ray/catalog';

const encodeUnknown=(value:unknown)=>'#ray='+encodeURIComponent(JSON.stringify(value));
function rejects(value:unknown,lesson:RayLesson='rays'){
 const decoded=decodeRayState(encodeUnknown(value),lesson);assert.ok(decoded.notice);assert.deepEqual(decoded.state,defaultRayState(lesson));
}

test('all seven lesson states round-trip through shares with camera, strategy and reconstruction controls',()=>{
 for(const lesson of Object.keys(rayLessons) as RayLesson[]){
  const state:RayState={...defaultRayState(lesson),builder:'sah',traversal:'brute',count:2048,query:'any',origin:'inside',tMin:.002,tMax:80,offsetScale:.5,variant:.3,frame:119,motion:'camera',history:false,spatial:false,view:5,compare:true,seed:31415,maxScattering:8,targetSpp:1024,batch:16,estimator:'mis',sampling:'uniform',roughness:.13,lightSize:1.7,environment:.4,rr:true,exposure:-1,quality:'low',camera:{position:[4.5,3.1,6],target:[0,2.1,0]},learning:{article:'ray-denoising',chapter:'history'}};
  const restored=decodeRayState(encodeRayState(state));assert.equal(restored.notice,undefined);assert.deepEqual(restored.state,state);
  const link=rayLabHref(lesson,state),hash=link.slice(link.indexOf('#'));
  assert.deepEqual(decodeRayState(hash).state,state);assert.ok(link.startsWith(lesson==='rays'||lesson==='bvh'?'/labs/rays/':lesson==='shadows'||lesson==='reflections'?'/labs/ray-effects/':'/labs/path-tracing/'));
 }
});

test('earlier version-1 shares restore newly added history, spatial and motion defaults',()=>{
 const state=defaultRayState('denoise'),legacy:Record<string,unknown>={...state,frame:12,lightSize:.7};delete legacy.motion;delete legacy.history;delete legacy.spatial;
 const restored=decodeRayState(encodeUnknown(legacy));assert.equal(restored.notice,undefined);assert.deepEqual(restored.state,{...state,frame:12,lightSize:.7});
 assert.deepEqual(decodeRayState('').state,defaultRayState());assert.deepEqual(decodeRayState('#state=unrelated','mis').state,defaultRayState('mis'));
 rejects({...state,version:0},'denoise');rejects({...state,version:2},'denoise');
});

test('malformed learning destinations cannot pass through string coercion',()=>{
 const state=defaultRayState();
 for(const learning of [{},{article:null,chapter:null},{article:undefined,chapter:'history'},{article:'ray-mis',chapter:undefined},{article:123,chapter:'history'},'ray-mis',{article:['ray-mis'],chapter:'history'},{article:'https://example.com',chapter:'history'},{article:'../ray-mis',chapter:'history'},{article:'ray-mis',chapter:'#history'}])rejects({...state,learning});
 const valid={...state,learning:{article:'ray-mis',chapter:'variance'}};assert.deepEqual(decodeRayState(encodeRayState(valid)).state,valid);
});

test('invalid budgets, enum values, camera geometry and encoded inputs restore safe lesson defaults',()=>{
 const state=defaultRayState('path');
 for(const invalid of [{lesson:'constructor'},{preset:'unknown'},{builder:'sah12'},{traversal:'native'},{query:'all'},{motion:'free'},{count:2049},{count:3},{count:4.2},{frame:-1},{frame:121},{view:1.2},{seed:65536},{maxScattering:9},{targetSpp:0},{batch:33},{tMin:.1,tMax:.1},{tMin:-.1},{tMax:Infinity},{roughness:0},{lightSize:2.1},{environment:1.1},{exposure:NaN},{history:0},{spatial:'true'},{compare:1},{rr:'yes'},{camera:{position:[0,0,0],target:[0,0,0]}},{camera:{position:[0,0,41],target:[0,0,0]}},{camera:{position:[0,0,1],target:[0,0]}},{camera:{position:[NaN,0,1],target:[0,0,0]}}])rejects({...state,...invalid},'path');
 for(const encoded of ['#ray=%E0%A4%A','#ray={broken','#ray=null','#ray='+encodeURIComponent('x'.repeat(8192))]){const result=decodeRayState(encoded,'path');assert.ok(result.notice);assert.deepEqual(result.state,state);}
});

test('integrand invalidation covers scene and estimator inputs while display-only state is excluded',()=>{
 const state=defaultRayState('denoise'),key=rayIntegrandKey(state);
 const changes:Partial<RayState>[]=[{lesson:'mis'},{motion:'cut'},{preset:'triangle'},{count:2048},{variant:.3},{frame:1},{camera:{position:[1,2.3,8.8],target:[0,2.1,0]}},{quality:'low'},{seed:18},{maxScattering:3},{estimator:'nee'},{sampling:'uniform'},{roughness:.7},{lightSize:.4},{environment:.5},{rr:true},{origin:'inside'},{tMin:.005},{tMax:25},{offsetScale:0}];
 for(const changed of changes)assert.notEqual(rayIntegrandKey({...state,...changed}),key,JSON.stringify(changed));
 for(const changed of [{exposure:2},{view:4},{compare:true},{targetSpp:1024},{batch:4},{history:false},{spatial:false},{builder:'sah' as const},{traversal:'brute' as const},{learning:{article:'ray-denoising',chapter:'history'}}])assert.equal(rayIntegrandKey({...state,...changed}),key,JSON.stringify(changed));
});

test('defaults and camera presets do not share mutable arrays across experiments',()=>{
 const a=defaultRayState('reflections'),b=defaultRayState('reflections');a.camera.position[0]=99;a.camera.target[0]=99;assert.deepEqual(b.camera,rayCamera('room'));
 assert.equal(defaultRayState('denoise').estimator,'mis');assert.equal(defaultRayState('mis').estimator,'mis');assert.equal(defaultRayState('path').estimator,'bsdf');
});

 test('reflection shading model changes the target while reconstruction buffer views do not',()=>{const r=defaultRayState('reflections'),d=defaultRayState('denoise');assert.notEqual(rayIntegrandKey(r),rayIntegrandKey({...r,view:0}));assert.equal(rayIntegrandKey(d),rayIntegrandKey({...d,view:4}));});
