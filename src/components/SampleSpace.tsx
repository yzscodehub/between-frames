import {useState} from 'react';
import type {Inspection,SampleData} from '../lib/renderer';
type V=[number,number,number];
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const norm=(a:V):V=>{const l=Math.hypot(...a)||1;return a.map(x=>x/l) as V};
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export default function SampleSpace({data,sample,samples}:{data:Inspection;sample:SampleData;samples:SampleData[]}){
 const [yaw,setYaw]=useState(-30),[pitch,setPitch]=useState(22);
 const origin=data.position,normal=norm(data.normal),view=norm(origin.map(x=>-x) as V);
 const points=samples.filter(x=>x.surface&&x.distance>0).map(x=>sub(x.surface!,origin));
 const extent=Math.max(.2,...points.map(p=>Math.hypot(...p)),sample.candidate?Math.hypot(...sub(sample.candidate,origin)):0);
 const project=(p:V):[number,number]=>{const a=yaw*Math.PI/180,b=pitch*Math.PI/180,x=p[0]*Math.cos(a)+p[2]*Math.sin(a),z=-p[0]*Math.sin(a)+p[2]*Math.cos(a),y=p[1]*Math.cos(b)-z*Math.sin(b);return [210+x/extent*122,163-y/extent*122]};
 const scale=(p:V,k:number)=>p.map(x=>x*k) as V;
 const t=norm(cross(normal,Math.abs(normal[2])<.9?[0,0,1]:[0,1,0])),b=cross(normal,t);
 const plane=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>project(t.map((x,j)=>(x*u+b[j]*v)*extent*.55) as V));
 const q=sample.candidate?sub(sample.candidate,origin):null,s=sample.surface?sub(sample.surface,origin):null;
 const line=(v:V,color:string,label:string,from:V=[0,0,0])=>{const a=project(from),p=project(v);return <g key={label}><line x1={a[0]} y1={a[1]} x2={p[0]} y2={p[1]} stroke={color} strokeWidth="2"/><circle cx={p[0]} cy={p[1]} r="4" fill={color}/><text x={p[0]+7} y={p[1]-7} style={{fill:color}}>{label}</text></g>};
 return <div className="sample-space"><div><span className="eyebrow">样本空间 / 实际坐标的三维投影</span><svg viewBox="0 0 420 290" role="img" aria-label="选中表面点 p，法线 n，观察方向 v，以及候选点 q 和深度表面点 s 的局部三维关系"><polygon points={plane.map(x=>x.join(',')).join(' ')} fill="#dfe8ed88" stroke="#a6bdc9"/>{points.map((p,i)=>{const xy=project(p);return <circle key={i} cx={xy[0]} cy={xy[1]} r="2.5" fill="#a9b7c1"/>})}{line(scale(normal,extent*.72),'#2d6fb8','n')}{line(scale(view,extent*.75),'#8795a0','v')}{s&&line(s,'#b85580','s')}{q&&line(q,'#ce862e','q')}{s&&q&&<line x1={project(s)[0]} y1={project(s)[1]} x2={project(q)[0]} y2={project(q)[1]} stroke="#986c48" strokeDasharray="4 4"/>}<circle cx="210" cy="163" r="5" fill="#163c4e"/><text x="196" y="182">p</text><text x="15" y="274">局部范围 ±{extent.toFixed(2)} · 旋转下方控件观察深度</text></svg></div><div className="sample-space-controls"><label>方位 <input aria-label="样本空间方位" type="range" min="-180" max="180" value={yaw} onChange={e=>setYaw(+e.target.value)}/></label><label>俯仰 <input aria-label="样本空间俯仰" type="range" min="-75" max="75" value={pitch} onChange={e=>setPitch(+e.target.value)}/></label></div><p className="fine">p：接收点 · s：深度读取的表面 · q：SSAO 候选点。灰点是同组有效表面样本，灰色平面仅表示 p 的局部切平面，不是重建的场景几何。q 的连续投影与 s 的采样纹素中心最多相差半个像素，因此虚线不是一次精确射线命中。</p>{sample.candidate&&sample.surface&&<div className="depth-verdict"><b>{sample.value>.5?'候选点落在深度表面之后':'本样本未判为遮挡'}</b><span>s.z = {sample.surface[2].toFixed(3)}，q.z = {sample.candidate[2].toFixed(3)}，深度偏移 = 0.012。最终还检查作用半径。</span></div>}</div>
}
