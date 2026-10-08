import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decodeSSRState,defaultSSRState,encodeSSRState,ssrGeometryKey,ssrHref,ssrQueryKey} from '../src/lib/ssr/state';
test('SSR shares round-trip camera, method and failure-scenario controls',()=>{
 const s={...defaultSSRState(),preset:'hidden' as const,method:'view' as const,steps:64,stride:4,viewStep:.7,thickness:.013,range:17,offset:3,epsilon:.002,shading:'local' as const,view:'status' as const,compare:false,camera:{position:[5,3,7] as [number,number,number],target:[0,.8,0] as [number,number,number]},learning:{article:'ssr' as const,chapter:'missing'}};
 assert.deepEqual(decodeSSRState(encodeSSRState(s)),{state:s});const href=ssrHref(s);assert.deepEqual(decodeSSRState(href.slice(href.indexOf('#'))).state,s);
});
test('invalid and old SSR shares restore defaults with a notice',()=>{
 const s=defaultSSRState();for(const patch of [{version:2},{preset:'constructor'},{method:'dda-paper'},{steps:257},{steps:12.5},{stride:0},{viewStep:0},{thickness:0},{range:31},{offset:8},{epsilon:-1},{camera:{position:[0,0,0],target:[0,0,0]}},{learning:null},{learning:{article:'ssr',chapter:'../x'}},{compare:1}]){const r=decodeSSRState('#ssr='+encodeURIComponent(JSON.stringify({...s,...patch})));assert.ok(r.notice);assert.deepEqual(r.state,s);}
 assert.ok(decodeSSRState('#ssr=%E0%A4%A').notice);assert.deepEqual(decodeSSRState(''),{state:s});
});
test('query state invalidates on geometry, camera and stepping but not display layout',()=>{
 const s=defaultSSRState();assert.notEqual(ssrGeometryKey({...s,offset:1}),ssrGeometryKey(s));assert.equal(ssrGeometryKey({...s,steps:64}),ssrGeometryKey(s));
 for(const patch of [{steps:64},{stride:2},{method:'view' as const},{thickness:.4},{range:10},{epsilon:.002},{shading:'local' as const}])assert.notEqual(ssrQueryKey({...s,...patch}),ssrQueryKey(s));
 assert.equal(ssrQueryKey({...s,compare:false,view:'depth'}),ssrQueryKey(s));const other=defaultSSRState();s.camera.position[0]=99;assert.notEqual(s.camera.position[0],other.camera.position[0]);
});
