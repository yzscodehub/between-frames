import {useState} from 'react';
import type {SSRInspection} from '../../lib/ssr/types';
import {sampleKinds,ssrStatuses} from '../../lib/ssr/types';
const fixed=(v:number)=>Number.isFinite(v)?v.toFixed(4):'—';
export default function Inspection({data}:{data:SSRInspection}){
 const [step,setStep]=useState(0),index=Math.min(step,Math.max(0,data.samples.length-1)),sample=data.samples[index];
 const maximum=Math.max(1,...data.samples.flatMap(s=>[s.rayDepth,s.sceneDepth]).filter(v=>v>=0));
 const x=(i:number)=>30+i/Math.max(1,data.samples.length-1)*370,y=(v:number)=>235-v/maximum*190;
 function path(field:'rayDepth'|'sceneDepth'){let active=false;return data.samples.map((s,i)=>{const v=s[field];if(v<0||!Number.isFinite(v)){active=false;return '';}const value=`${active?'L':'M'}${x(i)} ${y(v)}`;active=true;return value;}).join(' ');}
 const agrees=data.reference.status<2&&(data.reference.status===1)===data.cpu.hit&&(!data.cpu.hit||data.reference.objectId===data.cpu.objectId&&(data.referencePositionError??1)<.003)&&data.referenceColorError<.002;
 return <section className="ssr-inspection"><header><span className="eyebrow">实际 GPU 步进 / 独立 CPU 几何检查</span><h4>{ssrStatuses[data.status]??'未知状态'} · {data.steps} 次采样</h4></header>
  {data.objectId!==0?<p>当前点是普通物体。请点击地面镜内部，观察从镜面发出的屏幕空间路径。</p>:<>
  <div className="ssr-inspection-grid"><div>
   <svg viewBox="0 0 430 290" role="img" aria-label="实际GPU采样UV在当前相机屏幕上的路径"><defs><clipPath id="ssr-screen-clip"><rect x="25" y="25" width="375" height="230"/></clipPath></defs><rect x="25" y="25" width="375" height="230" fill="#edf4f7" stroke="#bacdd7"/>
    <g clipPath="url(#ssr-screen-clip)"><polyline fill="none" stroke="#287d91" strokeWidth="1.5" points={data.samples.map(s=>`${25+s.uv[0]*375},${255-s.uv[1]*230}`).join(' ')}/>{data.samples.map((s,i)=><circle key={i} cx={25+s.uv[0]*375} cy={255-s.uv[1]*230} r={i===index?5:2} fill={s.kind===3?'#218f64':s.kind===5?'#d97538':s.kind===4?'#97aabb':'#286e89'}/>)}<circle cx={25+data.uv[0]*375} cy={255-data.uv[1]*230} r="5" fill="#d47e47"/></g>
    <text x="25" y="279">UV 由每一次真实步进投影得到；橙点是起始像素。</text>
   </svg>
   <svg viewBox="0 0 430 275" role="img" aria-label="实际GPU光线轴向深度与场景轴向深度逐步比较"><path d="M30 25v210h370" stroke="#b7cbd4" fill="none"/><path d={path('rayDepth')} fill="none" stroke="#238ba0" strokeWidth="2"/><path d={path('sceneDepth')} fill="none" stroke="#cf8354" strokeWidth="2"/><line x1={x(index)} y1="25" x2={x(index)} y2="235" stroke="#718b9b" strokeDasharray="3 3"/><text x="35" y="19">轴向距离 0—{maximum.toFixed(1)}</text><text x="35" y="257">蓝：光线深度　橙：场景深度（缺数据处断开）</text></svg>
   <label>检查步进 <output>{data.samples.length?index+1:0} / {data.samples.length}</output><input aria-label="SSR 检查步进" type="range" min="0" max={Math.max(0,data.samples.length-1)} value={index} onChange={e=>setStep(+e.target.value)}/></label>
   {sample&&<dl>{[['UV',sample.uv.map(fixed).join(', ')],['光线 / 场景轴距',`${fixed(sample.rayDepth)} / ${sample.sceneDepth<0?'无深度':fixed(sample.sceneDepth)}`],['深度差 Δz',sample.sceneDepth<0?'—':fixed(sample.delta)],['射线距离 t',fixed(sample.t)],['样本类别',sampleKinds[sample.kind]??String(sample.kind)],['样本对象',String(sample.objectId)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
  </div><div><dl>{[
   ['SSR 终止',ssrStatuses[data.status]],['镜面位置 P',data.position.map(fixed).join(', ')],['几何法线 Ng',data.normal.map(fixed).join(', ')],['偏移后 origin',data.origin.map(fixed).join(', ')],['反射方向',data.direction.map(fixed).join(', ')],
   ['SSR 对象 / t',data.status===1?`${data.hitObjectId} / ${fixed(data.hitDistance)}`:'没有接受的深度命中'],['细化后厚度残差',data.status===1?fixed(data.depthDelta):'—'],['完整几何对象 / t',data.reference.status===1?`${data.reference.objectId} / ${fixed(data.reference.t)}`:data.reference.status===0?'完整几何未命中':'查询无效 / 溢出'],['SSR 线性颜色',data.color.map(fixed).join(', ')],['参考线性颜色',data.reference.color.map(fixed).join(', ')],
   ['参考 GPU / CPU 对象',`${data.reference.objectId} / ${data.cpu.objectId}`],['参考位置误差',data.referencePositionError===null?'—':data.referencePositionError.toExponential(2)],['参考颜色误差',data.referenceColorError.toExponential(2)],
  ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p className={agrees?'ssr-good':'ssr-warning'}>{agrees?'完整几何 GPU 查询与独立 CPU 对照一致。':'完整几何 GPU / CPU 需要检查边界或差异。'}</p>
  <p className="fine">SSR 深度命中与完整几何命中是两种判断。对象不同、漏采样或环境回退都保留在读数中，不把它们合并为“正确命中”。位置/颜色误差检查的是完整几何参考与 CPU，不是替 SSR 掩盖差异。</p></div></div></>}
 </section>;
}
