import {useState} from 'react';
import {sliceIntegral,numericalSlice} from '../lib/math';
export default function SliceExplorer(){
 const [gamma,setGamma]=useState(20),[left,setLeft]=useState(65),[right,setRight]=useState(80);
 const r=Math.PI/180,g=gamma*r,lo=Math.max(-left*r,g-Math.PI/2),hi=Math.min(right*r,g+Math.PI/2);
 const exact=sliceIntegral(g,-left*r,right*r),numeric=numericalSlice(g,-left*r,right*r);
 const point=(t:number,rad=135)=>[230+Math.sin(t)*rad,180-Math.cos(t)*rad];
 const pts=Array.from({length:81},(_,i)=>point(lo+(hi-lo)*i/80));
 return <div className="slice-experiment"><div className="diagram-wrap"><span className="eyebrow">原理示意 / 独立数值验证</span><svg viewBox="0 0 460 365" role="img" aria-label="以观察方向为轴的完整圆形切片，橙色是可见角度，蓝色是法线">
 <path d="M 60 180 H 400 M 230 329 V 25" stroke="#a8b6bb" strokeDasharray="4 5" fill="none"/>
 <circle cx="230" cy="180" r="135" fill="none" stroke="#bbc7cc"/>
 <polygon points={[[230,180],...pts].map(p=>p.join(',')).join(' ')} fill="#e4ab5429" stroke="#cc7d24"/>
 {[-left*r,right*r].map((t,i)=><line key={i} x1="230" y1="180" x2={point(t)[0]} y2={point(t)[1]} stroke="#bb587b" strokeWidth="3"/>)}
 <line x1="230" y1="180" x2={point(g,155)[0]} y2={point(g,155)[1]} stroke="#2a6bbb" strokeWidth="3"/>
 <circle cx="230" cy="180" r="5" fill="#132c38"/><text x="242" y="28">v</text><text x={point(g,170)[0]} y={point(g,170)[1]}>n</text><text x="230" y="351" textAnchor="middle">表面点 p · 完整角域</text></svg>
 <p>橙色区域是裁剪后的可见角度；贡献还包含余弦权重和球面测度 |sin θ|。</p></div>
 <div className="diagram-controls">{[['法线偏角 γ',gamma,setGamma,-75,75],['左侧可见角',left,setLeft,0,180],['右侧可见角',right,setRight,0,180]].map(([label,value,set,min,max])=><label key={String(label)}>{String(label)} <output>{Number(value)}°</output><input type="range" min={Number(min)} max={Number(max)} value={Number(value)} onChange={e=>(set as (v:number)=>void)(+e.target.value)}/></label>)}
 <div className="numbers"><div><small>解析切片积分</small><strong>{exact.toFixed(6)}</strong></div><div><small>4096 点数值积分</small><strong>{numeric.toFixed(6)}</strong></div></div><p className="fine">误差 {Math.abs(exact-numeric).toExponential(2)}。单个切片贡献可以大于 1；完整 AO 还需乘投影长度并对方向取平均。</p><button onClick={()=>{setGamma(20);setLeft(65);setRight(80)}}>恢复本节示例</button></div></div>
}
