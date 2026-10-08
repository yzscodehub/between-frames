import type {Material, Primitive, SceneSnapshot, Vec3} from './types';
import {RAY_LIMITS} from './types';
import {add,scale} from './geometry';

export type ScenePreset='triangle'|'scatter'|'clusters'|'overlap'|'room';
export const scenePresets:ScenePreset[]=['triangle','scatter','clusters','overlap','room'];
const material=(albedo:Vec3,kind:Material['kind']='lambert',emission:Vec3=[0,0,0],roughness=.35):Material=>({albedo,kind,emission,roughness});
function generator(seed:number){let state=seed>>>0;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}

/** Analytic world-space scene data, never extracted from the display mesh.
 * Light u and v are half-extent vectors; previousOffset maps current P to previous P. */
export function createSnapshot(preset:ScenePreset='triangle',count=512,frame=0,variant?:number|string):SceneSnapshot {
 if(!scenePresets.includes(preset))throw new RangeError('Unknown ray scene preset.');
 const budget=Math.max(1,Math.min(RAY_LIMITS.primitives,Math.floor(Number.isFinite(count)?count:512)));
 const materials:Material[]=[material([.64,.67,.72]),material([.88,.26,.20]),material([.24,.63,.83]),material([.72,.88,.38]),material([.91,.92,.95],'mirror'),material([1,1,1],'lambert',[13,11.5,9.5]),material([.77,.58,.28],'ggx',[0,0,0],.24)];
 const primitives:Primitive[]=[];
 const triangle=(a:Vec3,b:Vec3,c:Vec3,objectId:number,materialId=0,previousOffset:Vec3=[0,0,0])=>{
  primitives.push({kind:'triangle',a,b,c,radius:0,id:primitives.length,objectId,materialId,previousOffset});
 };
 const sphere=(center:Vec3,radius:number,objectId:number,materialId=2,previousOffset:Vec3=[0,0,0])=>{
  primitives.push({kind:'sphere',a:center,b:[0,0,0],c:[0,0,0],radius,id:primitives.length,objectId,materialId,previousOffset});
 };
 const quad=(a:Vec3,b:Vec3,c:Vec3,d:Vec3,objectId:number,materialId=0)=>{triangle(a,b,c,objectId,materialId);triangle(a,c,d,objectId,materialId);};
 const light={center:[0,4.96,-.4] as Vec3,u:[.8,0,0] as Vec3,v:[0,0,.6] as Vec3,normal:[0,-1,0] as Vec3,emission:[13,11.5,9.5] as Vec3};
 const shift=typeof variant==='number'&&Number.isFinite(variant)?variant:0;
 const motion=Math.sin(frame*.025)*.55,previousMotion=Math.sin((frame-1)*.025)*.55;
 if(preset==='triangle'){
  // Shared diagonal (primitive 0 / 1) exercises watertight edge and ID tie behavior.
  quad([-2.3,.15,-.8],[-.5,.15,-.8],[-.5,1.95,-.8],[-2.3,1.95,-.8],0,2);
  const offset:Vec3=[shift+motion,0,0],previousOffset:Vec3=[previousMotion-motion,0,0];
  triangle(add([-.4,.2,.25],offset),add([1.3,.2,.25],offset),add([.35,2.2,.25],offset),1,1,previousOffset);
  sphere([1.8,.65,-.5],.65,2,3);
  quad([-4,0,3],[4,0,3],[4,0,-4],[-4,0,-4],3,0);
 }else if(preset==='room'){
  // Every wall winding points into the open-front room. Floor is the sole mirror.
  quad([-3,0,3],[3,0,3],[3,0,-3],[-3,0,-3],0,4);
  quad([-3,0,-3],[3,0,-3],[3,5,-3],[-3,5,-3],1,0);
  quad([-3,0,3],[-3,0,-3],[-3,5,-3],[-3,5,3],2,1);
  quad([3,0,-3],[3,0,3],[3,5,3],[3,5,-3],3,3);
  quad([-3,5,-3],[3,5,-3],[3,5,3],[-3,5,3],4,0);
  const a=add(add(light.center,scale(light.u,-1)),scale(light.v,-1));
  const b=add(add(light.center,light.u),scale(light.v,-1));
  const c=add(add(light.center,light.u),light.v),d=add(add(light.center,scale(light.u,-1)),light.v);
  quad(a,b,c,d,5,5);
  sphere([-.95+motion,.85,-.8],.85,6,0,[previousMotion-motion,0,0]);
  sphere([1.15,.65,.2],.65,7,6);
 }else{
  const random=generator(preset==='scatter'?601: preset==='clusters'?1701:881);
  const clusters:Vec3[]=[[-1.8,.6,-1.5],[1.6,1.6,-1],[0,2.4,1]];
  for(let i=0;i<budget;i++){
   const u=random(),v=random(),w=random(),radius=.075+random()*.085;
   let center:Vec3;
   if(preset==='scatter')center=[(u-.5)*6,.15+v*3.4,(w-.5)*5];
   else if(preset==='clusters')center=add(clusters[i%clusters.length],[(u-.5)*1.35,(v-.5)*1.2,(w-.5)*1.35]);
   else center=[(u-.5)*.45,1.2+(v-.5)*.45,(w-.5)*.45];
   const moving=i===0?motion:0,previousOffset:Vec3=i===0?[previousMotion-motion,0,0]:[0,0,0];
   center=add(center,[moving,0,0]);
   if(i%5!==0)sphere(center,preset==='overlap'?.45+radius:radius,i,i%4,previousOffset);
   else {
    const r=preset==='overlap'?.9:radius*2.4;
    triangle(add(center,[-r,-r*.65,0]),add(center,[r,-r*.65,0]),add(center,[0,r,r*.2]),i,i%4,previousOffset);
   }
  }
 }
 // Small pedagogical scenes obey the same caller budget as stress scenes.
 const limited=primitives.slice(0,budget);
 return {version:1,frame,primitives:limited,materials,light,environment:preset==='room'?[.015,.018,.025]:[.12,.16,.23]};
}

export const constructSnapshot=createSnapshot;
