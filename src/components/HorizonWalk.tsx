import {useState} from 'react';
import {horizonWalk,exactBlockedInterval,type Occluder} from '../lib/horizon';
export default function HorizonWalk(){
 const [kind,setKind]=useState<'wall'|'slab'>('wall'),[x,setX]=useState(1.1),[bottom,setBottom]=useState(.55),[step,setStep]=useState(5);
 const shape:Occluder={x,width:.85,bottom:kind==='wall'?0:bottom,height:kind==='wall'?1.1:.16};
 const samples=horizonWalk(shape),current=step>0?samples[step-1]:null,h=current?.horizon??0,exact=exactBlockedInterval(shape);
 const px=(x:number)=>74+x*127,py=(y:number)=>258-y*127;
 const arc=(a:number,b:number,r:number)=>Array.from({length:40},(_,i)=>{const t=a+(b-a)*i/39;return [74+Math.cos(t)*r,258-Math.sin(t)*r].join(',')}).join(' ');
 const update=(next:number)=>{setStep(0);setX(Math.max(.4,Math.min(2.4,next)))};
 const drag=(e:React.PointerEvent<SVGRectElement>)=>{if(e.buttons!==1)return;const svg=e.currentTarget.ownerSVGElement!,rect=svg.getBoundingClientRect();update(((e.clientX-rect.left)*640/rect.width-74)/127-.425);};
 return <section className="walk-experiment"><header className="experiment-heading"><div><span className="eyebrow">实验 02 / 地平线逐步构建</span><h3>增加了一个样本，边界改变了吗？</h3></div><div className="small-tabs"><button aria-pressed={kind==='wall'} onClick={()=>{setKind('wall');setStep(0)}}>落地挡板</button><button aria-pressed={kind==='slab'} onClick={()=>{setKind('slab');setStep(0)}}>悬空薄板</button></div></header>
 <div className="walk-body"><div><svg viewBox="0 0 640 330" role="img" aria-label="沿接收平面采样，每个样本尝试更新地平线；悬空板保留下方可见空隙">
 <defs><pattern id="horizon-grid" width="31.75" height="31.75" patternUnits="userSpaceOnUse"><path d="M31.75 0H0V31.75" fill="none" stroke="#e5ebef" strokeWidth="1"/></pattern></defs><rect x="50" y="30" width="540" height="240" fill="url(#horizon-grid)"/>
 <polygon points={`74,258 ${arc(0,h,170)}`} fill="#bf668531"/>
 <polyline points={arc(exact.low,exact.high,187)} fill="none" stroke="#b55579" strokeWidth="7"/>
 {kind==='slab'&&<polyline points={arc(0,exact.low,187)} fill="none" stroke="#318d80" strokeWidth="7"/>}
 <path d="M50 258H590" stroke="#597381" strokeWidth="2"/><path d="M74 258V53" stroke="#568ac7" strokeWidth="2"/><text x="82" y="53">n</text><text x="53" y="283">p</text>
 <rect x={px(shape.x)} y={py(shape.bottom+shape.height)} width={shape.width*127} height={shape.height*127} fill="#406577" rx="2" className="draggable-occluder" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={drag}/>
 <text x={px(shape.x)+7} y={py(shape.bottom+shape.height)-12} fill="#345569">{kind==='wall'?'落地挡板':'悬空薄板'} · 可左右拖动</text>
 {samples.slice(0,step).map((s,i)=><g key={i}><line x1="74" y1="258" x2={px(s.x)} y2={py(s.y)} stroke={i===step-1?'#d98e32':'#b7c7cf'} strokeWidth={i===step-1?2:1} strokeDasharray={i===step-1?'':'3 4'}/><circle cx={px(s.x)} cy={py(s.y)} r={i===step-1?5:3} fill={s.updated?'#ba507e':'#80949e'}/></g>)}
 {[0,1,2,3].map(i=><text key={i} x={px(i)-4} y="301">{i}</text>)}<text x="515" y="301">距离</text>
 </svg><div className="diagram-legend"><span><i className="legend-dot rose"/>地平线假设的遮挡</span><span><i className="legend-dot teal"/>薄板下面仍可见</span><span><i className="legend-dot amber"/>当前样本</span></div></div>
 <div className="walk-controls"><label>已处理样本 <output>{step} / 12</output><input aria-label="地平线进度" type="range" min="0" max="12" value={step} onChange={e=>setStep(+e.target.value)}/></label><div className="walk-actions"><button className="primary" disabled={step===12} onClick={()=>setStep(s=>s+1)}>下一样本</button><button onClick={()=>setStep(0)}>从头观察</button></div><label>挡板位置 <output>{x.toFixed(2)}</output><input aria-label="挡板位置" type="range" min=".4" max="2.4" step=".05" value={x} onChange={e=>update(+e.target.value)}/></label>{kind==='slab'&&<label>板下空隙 <output>{bottom.toFixed(2)}</output><input aria-label="板下空隙" type="range" min=".15" max="1.3" step=".05" value={bottom} onChange={e=>{setBottom(+e.target.value);setStep(0)}}/></label>}
 <div className="step-verdict" role="status"><span className="eyebrow">{current?`样本 ${step}`:'等待第一个样本'}</span><strong>{current?(current.updated?'更新地平线':'保留已有边界'):'还没有遮挡信息'}</strong><p>{current?`${(current.before*180/Math.PI).toFixed(1)}° → ${(h*180/Math.PI).toFixed(1)}°。${current.updated?'这个样本高于此前边界。':'这个样本没有超出已有边界。'}`:'点“下一样本”，观察橙色线。'}</p></div>
 <p className="fine">真实遮挡角度：{(exact.low*180/Math.PI).toFixed(1)}°–{(exact.high*180/Math.PI).toFixed(1)}°。地平线假设：0°–{(h*180/Math.PI).toFixed(1)}°。</p></div></div>
 <footer className="experiment-takeaway"><b>观察结论</b>{kind==='slab'?'有限厚度的板只遮住一段角度。单一地平线却把边界以下全部当作遮挡，绿色空隙因此丢失。':'最远的样本不一定决定遮挡。只要更靠近的样本产生更高角度，它就会更新地平线。'}<small>这是二维高度场采样示意，粗线是矩形精确遮挡角域；角度覆盖不是最终 AO 值。GTAO 仍需在可见区间中加入权重。</small></footer>
 </section>
}
