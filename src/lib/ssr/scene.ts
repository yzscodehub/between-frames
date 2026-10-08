import * as T from 'three';
import type {Primitive,SceneSnapshot,Vec3} from '../ray/types';
import type {SSRState} from './types';
export function createSSRScene(state:SSRState){
 const scene=new T.Scene(),meshes:T.Mesh[]=[],materials:SceneSnapshot['materials']=[];
 function add(name:string,g:T.BufferGeometry,color:string,position:Vec3,rotation:Vec3=[0,0,0]){
  const m=new T.MeshBasicMaterial({color,side:T.DoubleSide}),mesh=new T.Mesh(g,m);mesh.name=name;mesh.position.set(...position);mesh.rotation.set(...rotation);mesh.userData.objectId=meshes.length;meshes.push(mesh);scene.add(mesh);materials.push({albedo:m.color.toArray() as Vec3,emission:[0,0,0],kind:meshes.length===1?'mirror':'lambert',roughness:.4});
 }
 add('mirror-floor',new T.PlaneGeometry(14,12),'#d4e5e8',[0,0,0],[-Math.PI/2,0,0]);
 if(state.preset==='thin'){
  for(let i=0;i<6;i++)add('thin-column-'+i,new T.BoxGeometry(.09,1.65,.2),['#df8659','#73b0b5','#d7b26a'][i%3],[-2+i*.8, .825,-.5]);
  add('background',new T.BoxGeometry(5.6,2.1,.25),'#728eaa',[0,1.05,-2.7]);
  add('moving-block',new T.BoxGeometry(.8,.65,.6),'#cf675a',[state.offset,.325,1]);
 }else if(state.preset==='hidden'){
  add('hidden-coral',new T.BoxGeometry(1.55,1.85,1),'#de8056',[state.offset,.925,-1.65]);
  add('foreground-screen',new T.BoxGeometry(3.4,1.9,.16),'#648ca0',[0,2.05,.25]);
  add('visible-cube',new T.BoxGeometry(.75,.75,.75),'#d9b875',[-2.5,.375,-.3]);
 }else{
  add('moving-coral',new T.BoxGeometry(1.2,2.2,1.2),'#df8a65',[-1.6+state.offset,1.1,-.5],[0,.2,0]);
  add('faceted-teal',new T.IcosahedronGeometry(.85,1),'#76b1b1',[.35,.85,-.2],[0,.3,0]);
  add('gold-ring',new T.TorusGeometry(.68,.19,8,24),'#d7b267',[2.1,1.05,-1.7],[.12,-.22,0]);
  add('small-violet',new T.OctahedronGeometry(.53),'#9388ac',[-.2,.53,-2.8]);
 }
 scene.updateMatrixWorld(true);const primitives:Primitive[]=[];
 for(const mesh of meshes){const positions=mesh.geometry.getAttribute('position'),indices=mesh.geometry.getIndex(),count=indices?.count??positions.count;const vertex=(offset:number)=>new T.Vector3().fromBufferAttribute(positions,indices?indices.getX(offset):offset).applyMatrix4(mesh.matrixWorld).toArray() as Vec3;
  for(let i=0;i<count;i+=3)primitives.push({kind:'triangle',a:vertex(i),b:vertex(i+1),c:vertex(i+2),radius:0,id:primitives.length,objectId:mesh.userData.objectId,materialId:mesh.userData.objectId,previousOffset:[0,0,0]});
 }
 const snapshot:SceneSnapshot={version:1,frame:0,primitives,materials,light:{center:[0,6,0],u:[1,0,0],v:[0,0,1],normal:[0,-1,0],emission:[0,0,0]},environment:[.035,.055,.08]};
 return {scene,meshes,snapshot,dispose(){meshes.forEach(mesh=>{mesh.geometry.dispose();(mesh.material as T.Material).dispose();});scene.clear();}};
}
