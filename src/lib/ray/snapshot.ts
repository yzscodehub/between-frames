import type {SceneSnapshot} from './types';
import type {RayState} from './state';
/** New immutable snapshot per request. Geometry, light sampling and material tables
 * are configured together before BVH construction and atomic GPU installation. */
export function configureSnapshot(input:SceneSnapshot,state:Pick<RayState,'lesson'|'preset'|'lightSize'|'environment'|'roughness'|'variant'>,version:number):SceneSnapshot {
 const s=structuredClone(input);s.version=version;
 if(state.lesson==='bvh'&&['scatter','clusters','overlap'].includes(state.preset))for(const p of s.primitives){
  if(p.kind!=='sphere')continue;
  // The BVH lesson varies a triangle budget. Keep one primitive per source
  // object and preserve its identity/motion, leaving query fixtures untouched.
  const [x,y,z]=p.a,r=p.radius;
  p.kind='triangle';p.a=[x-r,y-r,z];p.b=[x+r,y-r,z];p.c=[x,y+r,z+r*.2];p.radius=0;
 }
 if(state.lesson==='shadows'){
  s.primitives=s.primitives.filter(p=>[0,5,6,7].includes(p.objectId));
  const y=.4+Math.max(0,state.variant)*1.2;
  const corners:[[number,number,number],[number,number,number],[number,number,number],[number,number,number]]=[[.15,y,1.3],[1.75,y,1.3],[1.75,y,-.1],[.15,y,-.1]];
  for(const vertices of [[0,1,2],[0,2,3]])s.primitives.push({kind:'triangle',a:corners[vertices[0]],b:corners[vertices[1]],c:corners[vertices[2]],radius:0,id:14+s.primitives.filter(p=>p.objectId===8).length,objectId:8,materialId:0,previousOffset:[0,0,0]});
 }
 // A distinct reflector target stays legible when directional shading is disabled.
 if(state.lesson==='reflections'){const materialId=s.materials.length;s.materials.push({albedo:[.18,.45,.74],emission:[0,0,0],kind:'lambert',roughness:.35});for(const p of s.primitives)if(p.objectId===6)p.materialId=materialId;}
 const factor=state.lightSize;
 for(const p of s.primitives)if(p.kind==='triangle'&&s.materials[p.materialId].emission.some(x=>x>0)){
  for(const field of ['a','b','c'] as const)p[field]=p[field].map((x,i)=>s.light.center[i]+(x-s.light.center[i])*factor) as typeof p.a;
 }
 s.light.u=s.light.u.map(v=>v*factor) as typeof s.light.u;s.light.v=s.light.v.map(v=>v*factor) as typeof s.light.v;
 s.environment=[state.environment,state.environment,state.environment];
 if(['path','mis','denoise'].includes(state.lesson))for(const m of s.materials){
  if(m.emission.some(x=>x>0))continue;
  if(state.lesson!=='mis'||m.kind!=='ggx')m.kind='lambert';
  m.roughness=state.roughness;
 }
 return s;
}
export function freezeSnapshot(s:SceneSnapshot):SceneSnapshot {
 for(const p of s.primitives){for(const a of [p.a,p.b,p.c,p.previousOffset])Object.freeze(a);Object.freeze(p);}
 for(const m of s.materials){Object.freeze(m.albedo);Object.freeze(m.emission);Object.freeze(m);}
 Object.freeze(s.primitives);Object.freeze(s.materials);for(const a of [s.light.center,s.light.u,s.light.v,s.light.normal,s.light.emission,s.environment])Object.freeze(a);Object.freeze(s.light);return Object.freeze(s);
}
