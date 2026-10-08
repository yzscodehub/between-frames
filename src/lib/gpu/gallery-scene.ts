import {BoxGeometry,CylinderGeometry,SphereGeometry,TorusGeometry,Matrix4,Vector3,Matrix3,type BufferGeometry} from 'three';
export interface GallerySnapshot {version:number;sceneId:'gallery';vertices:Float32Array<ArrayBuffer>;objects:Array<{id:number;name:string;firstVertex:number;vertexCount:number}>;camera:{position:[number,number,number];target:[number,number,number]}}
export function createGallery():GallerySnapshot {const data:number[]=[],objects:GallerySnapshot['objects']=[];let id=0;
 function add(name:string,geometry:BufferGeometry,position:number[],color:number[],roughness=.65,metallic=0,rotation:number[]=[0,0,0],emission=0){const objectId=++id,firstVertex=data.length/16;const matrix=new Matrix4().makeRotationX(rotation[0]).multiply(new Matrix4().makeRotationY(rotation[1])).multiply(new Matrix4().makeRotationZ(rotation[2]));matrix.setPosition(...position as [number,number,number]);const normalMatrix=new Matrix3().getNormalMatrix(matrix),mesh=geometry.toNonIndexed(),p=mesh.getAttribute('position'),n=mesh.getAttribute('normal');for(let i=0;i<p.count;i++){const v=new Vector3().fromBufferAttribute(p,i).applyMatrix4(matrix),normal=new Vector3().fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize();data.push(v.x,v.y,v.z,objectId,normal.x,normal.y,normal.z,roughness,...color,metallic,emission,0,0,0);}objects.push({id:objectId,name,firstVertex,vertexCount:data.length/16-firstVertex});mesh.dispose();geometry.dispose();}
 const box=(name:string,size:number[],p:number[],color:number[],r=.65,m=0)=>add(name,new BoxGeometry(...size as [number,number,number]),p,color,r,m);
 box('石灰石地台',[12,.3,10],[0,-.15,0],[.52,.43,.31],.8);box('暖色背墙',[12,4.5,.25],[0,2.1,-4.8],[.6,.32,.19]);box('冷色侧墙',[.25,4.5,10],[-6,2.1,0],[.16,.31,.34]);
 for(let i=0;i<7;i++){box('背墙木格栅 '+i,[.1,3.7,.18],[-5.25+i*1.6,2,-4.57],[.18,.08,.035],.65);}
 box('展示背板',[7,2.7,.18],[.2,1.9,-4.55],[.15,.24,.25]);box('背板线脚',[7.3,.08,.25],[.2,3.3,-4.5],[.82,.55,.2],.3,.5);
 const centers=[-2.8,0,2.8];for(let i=0;i<3;i++){add('展台 '+i,new CylinderGeometry(1,1.06,.8,48),[centers[i],.4,0],[.62,.58,.45],.65);add('展台顶 '+i,new CylinderGeometry(1.01,1.01,.07,48),[centers[i],.835,0],[.15,.2,.19],.4);}
 add('陶瓷球',new SphereGeometry(.72,48,32),[-2.8,1.59,0],[.08,.42,.46],.26,0);
 add('黄铜环',new TorusGeometry(.65,.22,24,64),[0,1.65,0],[.83,.52,.13],.23,.9,[.1,.3,0]);
 add('赤陶雕塑',new SphereGeometry(.74,12,8),[2.8,1.6,0],[.65,.17,.08],.78,0);
 for(let i=0;i<6;i++){box('悬挂灯框 '+i,[.08,.08,5.5],[-4.5+i*1.7,4.5,-.4],[.08,.1,.1],.35,.5);}
 add('发光灯带',new BoxGeometry(7,.05,.18),[0,4.4,.6],[1,.65,.24],.5,0,[0,0,0],3);
 box('前景长凳',[3.8,.25,.85],[.5,.65,3.5],[.23,.1,.045]);for(const x of [-.9,1.9])box('长凳支脚',[.12,.55,.6],[x,.28,3.5],[.08,.1,.1],.3,.7);
 add('花盆',new CylinderGeometry(.42,.31,.65,24),[-4.7,.325,2.4],[.34,.18,.12]);for(let i=0;i<6;i++)add('植物叶团 '+i,new SphereGeometry(.35,12,8),[-4.7+Math.sin(i)*.24,.9+i*.15,2.4+Math.cos(i)*.2],[.08,.22,.11],.9);
 return {version:1,sceneId:'gallery',vertices:new Float32Array(data),objects,camera:{position:[8.5,6.8,10],target:[0,1.4,-.6]}};
}
