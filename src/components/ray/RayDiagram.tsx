import {useState} from 'react';
import type {BVH,SceneSnapshot,Vec3} from '../../lib/ray/types';
import type {RayInspection} from '../../lib/ray/renderer';
export default function RayDiagram({data,bvh,snapshot}:{data:RayInspection;bvh:BVH;snapshot:SceneSnapshot}){
 const [event,setEvent]=useState(0),[yaw,setYaw]=useState(-35);const index=Math.min(event,Math.max(0,data.events.length-1)),visited=data.events[index],node=visited?bvh.nodes[visited.node]:null;
 const focus=data.status===1?data.position:[0,1,0] as Vec3;const range=Math.max(2,Math.hypot(...data.ray.origin.map((v,i)=>v-focus[i]))*.7);
 const project=(p:Vec3)=>{const x=p[0]-focus[0],y=p[1]-focus[1],z=p[2]-focus[2],a=yaw*Math.PI/180;return [210+(x*Math.cos(a)+z*Math.sin(a))*130/range,165-(y*.85-(-x*Math.sin(a)+z*Math.cos(a))*.4)*130/range]};
 const rayEnd=data.status===1?data.position:data.ray.origin.map((v,i)=>v+data.ray.direction[i]*Math.min(data.ray.tMax,8)) as Vec3;
 const vertices=node?Array.from({length:8},(_,i)=>[i&1?node.max[0]:node.min[0],i&2?node.max[1]:node.min[1],i&4?node.max[2]:node.min[2]] as Vec3):[];
 const prim=snapshot.primitives.find(p=>p.id===data.primitiveId);
 return <div className="ray-diagram"><svg viewBox="0 0 420 330" role="img" aria-label="实际查询射线、命中位置和当前访问的包围盒">
 {vertices.map((v,i)=>[1,2,4].filter(bit=>(i&bit)===0).map(bit=><line key={i+'-'+bit} x1={project(v)[0]} y1={project(v)[1]} x2={project(vertices[i|bit])[0]} y2={project(vertices[i|bit])[1]} stroke={visited?.kind===0?'#bd6b89':'#6095a6'} strokeWidth="1.5"/>))}
 {prim?.kind==='triangle'&&<polygon points={[prim.a,prim.b,prim.c].map(v=>project(v).join(',')).join(' ')} fill="#357db536" stroke="#3977a2"/>}
 <line x1={project(data.ray.origin)[0]} y1={project(data.ray.origin)[1]} x2={project(rayEnd)[0]} y2={project(rayEnd)[1]} stroke="#cf8a28" strokeWidth="2"/>
 <circle cx={project(data.ray.origin)[0]} cy={project(data.ray.origin)[1]} r="4" fill="#cf8a28"/><text x={project(data.ray.origin)[0]+8} y={project(data.ray.origin)[1]-8}>origin</text>
 {data.status===1&&<><circle cx={project(data.position)[0]} cy={project(data.position)[1]} r="5" fill="#246595"/><line x1={project(data.position)[0]} y1={project(data.position)[1]} x2={project(data.position.map((v,i)=>v+data.normal[i]) as Vec3)[0]} y2={project(data.position.map((v,i)=>v+data.normal[i]) as Vec3)[1]} stroke="#2d72c2" strokeWidth="2"/><text x={project(data.position)[0]+8} y={project(data.position)[1]-8}>hit / Ng</text></>}
 <text x="20" y="310">选中射线的实际数据 · 仅绘制当前节点与命中三角形</text></svg>
 <label>示意观察方向<input aria-label="射线示意方向" type="range" min="-180" max="180" value={yaw} onChange={e=>setYaw(+e.target.value)}/></label>
 {data.events.length>0?<><label>GPU 访问事件 <output>{index+1} / {data.events.length}</output><input aria-label="访问事件" type="range" min="0" max={data.events.length-1} value={index} onChange={e=>setEvent(+e.target.value)}/></label><p className="ray-verdict">节点 {visited.node} · {['排除：未与当前区间相交','内部节点：继续遍历','叶节点：检查图元'][visited.kind]??'未知状态'}<br/>区间 [{visited.enter.toFixed(3)}, {visited.exit.toFixed(3)}]</p><button onClick={()=>setEvent(i=>Math.min(i+1,data.events.length-1))}>下一访问事件</button></>:<p className="fine">暴力遍历没有 BVH 节点日志。</p>}
 </div>;
}
