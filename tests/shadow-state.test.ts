import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeShadowState,defaultShadowState,encodeShadowState,shadowGeometryKey,shadowLabHref,shadowReferenceKey} from '../src/lib/shadow/state';
import type {ShadowLesson,ShadowState} from '../src/lib/shadow/types';
const encoded=(value:unknown)=>'#shadow='+encodeURIComponent(JSON.stringify(value));
const rejects=(value:unknown,lesson:ShadowLesson='mapping')=>{const result=decodeShadowState(encoded(value),lesson);assert.ok(result.notice);assert.deepEqual(result.state,defaultShadowState(lesson));};

test('mapping and filtering shares restore every geometry, algorithm, camera and learning field',()=>{
 for(const lesson of ['mapping','filtering'] as const){
  const state:ShadowState={...defaultShadowState(lesson),preset:'layers',algorithm:'pcf',resolution:1024,fov:95,bias:.013,planeCorrection:false,filterRadius:8.5,lightSize:1.3,height:1.7,seed:613,view:'visibility',compare:true,camera:{position:[6,4,9],target:[0,.7,0]},learning:{article:lesson==='mapping'?'shadow-mapping':'pcf-pcss',chapter:'blockers'}};
  const result=decodeShadowState(encodeShadowState(state));assert.equal(result.notice,undefined);assert.deepEqual(result.state,state);
  const url=shadowLabHref(lesson,state);assert.ok(url.startsWith('/labs/shadows/#shadow='));assert.deepEqual(decodeShadowState(url.slice(url.indexOf('#'))).state,state);
 }
});

test('unsupported and incomplete old versions visibly fall back to the requested lesson',()=>{
 for(const lesson of ['mapping','filtering'] as const){
  const state=defaultShadowState(lesson);rejects({...state,version:0},lesson);rejects({...state,version:2},lesson);
  const incomplete:Record<string,unknown>={...state};delete incomplete.planeCorrection;rejects(incomplete,lesson);
  for(const hash of ['#shadow=%E0%A4%A','#shadow=null','#shadow={broken','#shadow='+encodeURIComponent('x'.repeat(4096))]){const result=decodeShadowState(hash,lesson);assert.ok(result.notice);assert.deepEqual(result.state,state);}
  assert.deepEqual(decodeShadowState('#ray=unrelated',lesson),{state});
 }
});

test('invalid shadow enums, budgets, camera geometry and learning destinations are rejected',()=>{
 const state=defaultShadowState();
 for(const patch of [{lesson:'constructor'},{preset:'room'},{algorithm:'average-depth'},{resolution:2048},{resolution:'512'},{fov:39},{fov:111},{bias:-.001},{bias:.081},{filterRadius:13},{lightSize:-.1},{height:0},{seed:1.5},{seed:65536},{view:'unknown'},{compare:1},{planeCorrection:'true'},{camera:{position:[0,0,0],target:[0,0,0]}},{camera:{position:[0,0,36],target:[0,0,0]}},{camera:{position:[NaN,0,1],target:[0,0,0]}},{learning:null},{learning:0},{learning:{}},{learning:{article:'https://example.com',chapter:'map'}},{learning:{article:'shadow-mapping',chapter:null}},{learning:{article:'pcf-pcss',chapter:'../map'}}])rejects({...state,...patch});
 const boundary={...state,lightSize:0,filterRadius:0,bias:0};assert.deepEqual(decodeShadowState(encodeShadowState(boundary)).state,boundary);
});

test('frozen-world area reference invalidates for geometry, light size and seed but not map algorithms',()=>{
 const state=defaultShadowState('filtering'),geometry=shadowGeometryKey(state),reference=shadowReferenceKey(state);
 for(const patch of [{preset:'steps' as const},{height:1.5}]){assert.notEqual(shadowGeometryKey({...state,...patch}),geometry);assert.notEqual(shadowReferenceKey({...state,...patch}),reference);}
 for(const patch of [{lightSize:0},{lightSize:1.2},{seed:18}]){assert.equal(shadowGeometryKey({...state,...patch}),geometry);assert.notEqual(shadowReferenceKey({...state,...patch}),reference);}
 for(const patch of [{algorithm:'hard' as const},{algorithm:'pcf' as const},{resolution:128 as const},{fov:45},{bias:.05},{planeCorrection:false},{filterRadius:12},{view:'map' as const},{compare:true},{camera:{position:[4,3,8] as [number,number,number],target:[0,.5,0] as [number,number,number]}},{learning:{article:'pcf-pcss' as const,chapter:'samples'}}]){assert.equal(shadowGeometryKey({...state,...patch}),geometry);assert.equal(shadowReferenceKey({...state,...patch}),reference);}
});

test('default states are isolated and lesson links enforce the requested lesson/version',()=>{
 const a=defaultShadowState(),b=defaultShadowState();a.camera.position[0]=100;a.camera.target[1]=100;assert.deepEqual(b.camera,defaultShadowState().camera);
 assert.equal(defaultShadowState('mapping').algorithm,'hard');assert.equal(defaultShadowState('filtering').algorithm,'pcss');
 const url=shadowLabHref('filtering',{lesson:'mapping',version:99 as 1});const restored=decodeShadowState(url.slice(url.indexOf('#'))).state;assert.equal(restored.lesson,'filtering');assert.equal(restored.version,1);
});
