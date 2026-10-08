import * as T from 'three';
import type {SceneName} from './state';
export type Box = {center:[number,number,number]; size:[number,number,number]; material?:number};
export type SceneDescription = {sphere:[number,number,number,number]; boxes:Box[]};
const box=(center:Box['center'],size:Box['size'],material=3):Box=>({center,size,material});
export function sceneDescription(name:SceneName,lift:number):SceneDescription {
 const empty:[number,number,number,number]=[0,0,0,0];
 switch(name){
 case 'contact':return {sphere:[-.9,.65+lift,.15,.65],boxes:[box([.75,.4,-.4],[.75,.8,.75],4),box([.85,.48+lift,.85],[1.3,.12,.58],5)]};
 case 'corner':return {sphere:empty,boxes:[box([0,1.5,-1.5],[4,3,.12]),box([-1.9,1.5,0],[.12,3,3]),box([-.95,.24,-.55],[1.25,.48,.8],4)]};
 case 'thin':return {sphere:empty,boxes:[box([0,.5+lift,0],[2.5,.075,1.3],5),box([-1.32,.46,0],[.12,.92,1.3],4),box([1.05,.18,-1.05],[.5,.36,.5],3)]};
 case 'layers':return {sphere:empty,boxes:[box([.6,1.1+lift,1],[.5,2.2,.45],4),box([0,1.4,-1.7],[4,2.8,.1]),box([-.85,.3,-.8],[.8,.6,.8],5)]};
 case 'bench':return {sphere:[-1.12,.8+lift,.65,.6],boxes:[
  box([0,.1,0],[4.8,.2,3.8]),
  box([-.95,.36,-.75],[1.4,.32,.45],4),box([-.95,.61,-1.2],[1.4,.82,.45],4),
  box([.72,.48,-.92],[.28,.56,1.16],3),box([1.27,.48,-.92],[.28,.56,1.16],3),
  box([.95,.5+lift,.72],[1.32,.08,1.0],5),box([1.6,.35,.72],[.12,.3,1.0],5),
  box([-2.25,.57,-.4],[.12,.74,2.8],3)
 ]};
 case 'room':return {sphere:empty,boxes:[
  box([0,1.7,-1.85],[4.9,3.4,.16]),box([-2.42,1.7,.05],[.16,3.4,3.8]),
  box([-1.5,.26,.48],[1.3,.52,1.55],5),box([-1.99,.9,.48],[.26,.75,1.55],5),
  box([-1.37,.76,-.18],[1.05,.28,.3],5),
  box([.35,.7,.45],[1.65,.12,1.0],4),
  ...[[-.3,.12],[1,.12],[-.3,.8],[1,.8]].map(([x,z])=>box([x,.32,z],[.09,.64,.09],6)),
  box([1.15,1.64+lift,-1.51],[1.95,.09,.44],4),box([1.15,.88,-1.51],[1.95,.09,.44],4),
  box([.6,1.05,-1.51],[.24,.25,.23],5),box([.93,1.12,-1.51],[.14,.39,.2],4),
  box([-.85,1.9,-1.72],[.95,1.1,.09],6),box([-.85,1.9,-1.65],[.81,.95,.08],4)
 ]};
 }
}
export function sceneCamera(name:SceneName):{position:[number,number,number];target:[number,number,number]} {
 const views:Record<SceneName,{position:[number,number,number];target:[number,number,number]}>= {
  contact:{position:[3,2.65,4.0],target:[0,.38,.2]},
  bench:{position:[4.65,4.2,5.6],target:[0,.3,0]},
  thin:{position:[2.9,1.65,3.4],target:[0,.35,0]},
  corner:{position:[3.4,2.9,4],target:[-.45,.7,-.3]},
  layers:{position:[2.4,2.5,4.8],target:[0,.65,-.1]},
  room:{position:[5.3,3.65,6],target:[-.2,1.15,-.15]}
 };return structuredClone(views[name]);
}
export function buildScene(name:SceneName,lift:number,material:T.Material){
 const group=new T.Group();
 function add(mesh:T.Mesh,id:number){mesh.userData.surfaceId=id;mesh.onBeforeRender=()=>{if(material instanceof T.ShaderMaterial){material.uniforms.surfaceId.value=id;material.uniformsNeedUpdate=true;}};group.add(mesh);}
 const floor=new T.Mesh(new T.PlaneGeometry(20,20),material);floor.rotation.x=-Math.PI/2;add(floor,1);
 const spec=sceneDescription(name,lift);
 if(spec.sphere[3]>0){const sphere=new T.Mesh(new T.SphereGeometry(spec.sphere[3],96,64),material);sphere.position.set(spec.sphere[0],spec.sphere[1],spec.sphere[2]);add(sphere,2);}
 for(const b of spec.boxes){const mesh=new T.Mesh(new T.BoxGeometry(...b.size),material);mesh.position.set(...b.center);add(mesh,b.material??3);}
 return group;
}
export function disposeGeometry(group:T.Group){group.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose()});}
