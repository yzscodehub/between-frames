import * as T from 'three';
import type {TAAState} from './state';
import {objectOffset} from './math';
export function createScene(){
 const scene=new T.Scene(),meshes:T.Mesh[]=[];
 const add=(geometry:T.BufferGeometry,color:string,position:number[],pattern=0,rotation:number[]=[0,0,0])=>{
  const material=new T.MeshBasicMaterial({color}),mesh=new T.Mesh(geometry,material);
  mesh.position.fromArray(position);mesh.rotation.set(rotation[0],rotation[1],rotation[2]);mesh.userData={id:meshes.length+1,color:new T.Color(color),pattern,base:mesh.position.clone()};meshes.push(mesh);scene.add(mesh);return mesh;
 };
 add(new T.PlaneGeometry(12,10),'#b6c5cc',[0,0,0],1,[-Math.PI/2,0,0]);
 add(new T.BoxGeometry(6.7,3.4,.12),'#d6e4df',[0,1.7,-2.3],2);
 for(let i=0;i<13;i++)add(new T.BoxGeometry(.026+i*.001,1.1+i*.1,.035),i%2?'#cedcd7':'#b88545',[-2.8+i*.43,.55+i*.05,-.8]);
 add(new T.BoxGeometry(3.8,.035,.05),'#e7bd71',[-.2,1.4,.1],0,[0,0,.37]);
 add(new T.SphereGeometry(.46,28,20),'#417c93',[2,.46,1.25]);
 const moving=add(new T.BoxGeometry(.95,1.65,.65),'#c9583f',[0,.825,.8]);
 const at=(s:TAAState,frame:number)=>{moving.position.copy(moving.userData.base);moving.position.x+=objectOffset(s,frame);scene.updateMatrixWorld(true);};
 return {scene,meshes,moving,at,dispose(){for(const m of meshes){m.geometry.dispose();(m.material as T.Material).dispose();}scene.clear();}};
}
