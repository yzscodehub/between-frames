import {useState} from 'react';
import type {ShadowInspection as Inspection} from '../../lib/shadow/types';
const fixed=(n:number)=>Number.isFinite(n)?n.toFixed(6):'—';
export default function ShadowInspection({data,resolution,algorithm}:{data:Inspection;resolution:number;algorithm:string}){
 const [stage,setStage]=useState<'filter'|'search'>('filter'),[index,setIndex]=useState(0);
 const samples=data.samples.filter(s=>s.stage===stage),selected=Math.min(index,Math.max(0,samples.length-1)),sample=samples[selected];
 const radius=Math.max(2/resolution,...samples.map(s=>Math.max(Math.abs(s.uv[0]-data.lightUv[0]),Math.abs(s.uv[1]-data.lightUv[1]))))*1.25;
 const px=(u:number)=>330+(u-data.lightUv[0])*90/radius,py=(v:number)=>125-(v-data.lightUv[1])*90/radius;
 return <section className="shadow-inspection"><header><span className="eyebrow">选中像素 / 实际 GPU 输出 · {algorithm}</span><h4>{data.covered?'从一次比较，到一个采样窗口':'当前查询无法完整比较'}</h4></header>
 <div className="shadow-inspection-grid"><div>
 <svg viewBox="0 0 450 270" role="img" aria-label="选中表面投影到光图的位置与Shader实际采样点">
  <rect x="12" y="25" width="190" height="190" fill="#edf3f7" stroke="#bbcbd6"/>{[1,2,3].map(i=><g stroke="#d7e2e9" key={i}><path d={`M${12+i*47.5} 25v190 M12 ${25+i*47.5}h190`}/></g>)}
  <circle cx={12+Math.max(0,Math.min(1,data.lightUv[0]))*190} cy={215-Math.max(0,Math.min(1,data.lightUv[1]))*190} r="5" fill="#217c9c"/>
  <text x="12" y="240">整张光图 · [0,1]²</text><text x="12" y="258">UV {data.lightUv.map(n=>n.toFixed(3)).join(', ')}</text>
  <rect x="235" y="30" width="190" height="190" fill="#f8fafb" stroke="#bbcbd6"/>
  {Array.from({length:9},(_,i)=><g key={i} stroke="#e2e9ee"><path d={`M${240+i*22.5} 35v180 M240 ${35+i*22.5}h180`}/></g>)}
  <path d="M324 125h12 M330 119v12" stroke="#17384d"/>
  {samples.map((s,i)=><circle key={i} cx={px(s.uv[0])} cy={py(s.uv[1])} r={i===selected?5:2.5} fill={!s.valid?'#c47923':s.blocker?'#ac496b':s.visible?'#3c947e':'#506372'} stroke={i===selected?'#17384d':'none'}/>)}
  <text x="235" y="240">{stage==='search'?'搜索遮挡者':'过滤可见度'} · 局部放大</text><text x="235" y="258">比例尺示意 · 非纹素网格</text>
 </svg>
 <div className="shadow-small-tabs"><button aria-pressed={stage==='filter'} onClick={()=>setStage('filter')}>滤波样本</button><button disabled={!data.samples.some(s=>s.stage==='search')} aria-pressed={stage==='search'} onClick={()=>setStage('search')}>遮挡搜索样本</button></div>
 <label>检查样本 <output>{samples.length?selected+1:0} / {samples.length}</output><input aria-label="阴影检查样本" type="range" min="0" max={Math.max(0,samples.length-1)} value={selected} onChange={e=>setIndex(+e.target.value)}/></label>
 {sample&&<dl className="shadow-readings">{[['实际采样 UV',sample.uv.map(fixed).join(', ')],['存储深度',sample.depth>=0?fixed(sample.depth):'—'],['比较阈值（偏移 / 平面修正后）',sample.valid||sample.receiver!==-1?fixed(sample.receiver):'—'],['本次结果',!sample.valid?(sample.uv.some(v=>v<0||v>=1)?'光图窗口越界':'接收平面交点 / 深度范围无效'):stage==='search'?(sample.blocker?'是遮挡者':'不是遮挡者'):(sample.visible?'可见 1':'遮挡 0')]].map(([a,b])=><div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>}
 <p className="fine">绿：可见；灰：遮挡；紫：搜索找到的遮挡者；橙：光图窗口越界或接收平面比较无效。重复 UV 表示多个样本读取同一纹素。</p>
 </div><div><dl className="shadow-readings">{[
 ['表面位置 P',data.position.map(n=>n.toFixed(3)).join(', ')],['几何法线',data.normal.map(n=>n.toFixed(3)).join(', ')],['稳定对象 ID',String(data.objectId)],
 ['接收点深度 [0,1]',fixed(data.receiverDepth)],['中心纹素深度 [0,1]',data.storedDepth>=0?fixed(data.storedDepth):'—（未取样）'],['接收点 / 中心纹素轴距',`${data.receiverDistance.toFixed(3)} / ${data.storedDepth>=0?data.storedDistance.toFixed(3):'—'}`],
 ['当前算法可见度',data.covered?fixed(data.visibility):'—（无法完整比较）'],['遮挡者数量',String(data.blockerCount)],['遮挡者平均轴距',data.blockerCount?data.blockerDistance.toFixed(4):'—'],['搜索 / 滤波半径（纹素）',`${data.searchRadiusTexels?.toFixed(2)??'—'} / ${data.radiusTexels.toFixed(2)}`],
 ['CPU 光图纹素射线深度',data.cpuMapDepth===null?'无有效纹素射线':fixed(data.cpuMapDepth)],['光图深度与 CPU 差值',data.mapDepthError===null?'—':data.mapDepthError.toExponential(2)],['同一 GPU 样本的 CPU 复算差',data.mathError===null?'—':data.mathError.toExponential(2)],['中心光线 CPU 可见度',data.cpuVisibility===null?'—':String(data.cpuVisibility)]
 ].map(([a,b])=><div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
 <p className="shadow-callout">光图深度用独立 CPU 几何求交核对；滤波复算使用已读回的 GPU 样本。两项检查验证的是不同环节，中心光线也不等于面积灯可见率。</p></div></div></section>;
}
