import ObservationGuide from '../reading/ObservationGuide';
import {pbrGuides} from '../reading/guides';
import {useEffect,useRef,useState} from 'react';
import type {PbrWebGPURenderer as PbrRenderer} from '../../lib/pbr/webgpu-renderer';
import type {PbrReport,PbrState,PbrView,Vec3} from '../../lib/pbr/types';
import {decodePbrState,defaultPbrState,pbrLabHref,pbrTasks,pbrTaskState} from '../../lib/pbr/state';
import {colorToLinear,evaluateBrdf} from '../../lib/pbr/brdf';
import './pbr.css';
const viewLabels:Record<PbrView,string>={beauty:'完整直接光',diffuse:'Diffuse 辐射度',specular:'Specular 辐射度',d:'D · 分布',f:'F · Fresnel',g:'G · 遮蔽'};
const triple=(value:number[])=>value.map(v=>Number.isFinite(v)?v.toFixed(5):'无效').join(' / ');
function Lobe({state,noV}:{state:PbrState;noV:number}){
 const normal:Vec3=[0,0,1],view:Vec3=[Math.sqrt(Math.max(0,1-noV*noV)),0,noV];
 const curves=[.12,state.roughness,.8].map(roughness=>Array.from({length:121},(_,index)=>{const angle=(-89+index*178/120)*Math.PI/180,light:Vec3=[Math.sin(angle),0,Math.cos(angle)],e=evaluateBrdf({baseColor:colorToLinear(state.baseColor),roughness,metallic:state.metallic},normal,view,light),value=e.specular.reduce((a,b)=>a+b,0)/3*e.noL;return (25+index*390/120)+','+(150-Math.min(1,Math.log2(1+value*20)/12)*125);}).join(' '));
 return <figure className="pbr-lobe"><svg viewBox="0 0 440 175" role="img" aria-label="独立CPU计算的镜面角域剖面，三个粗糙度使用同一对数纵轴"><path d="M25 20V150H420" fill="none" stroke="#bcc9cf"/><path d="M220 20V150" stroke="#dce3e7" strokeDasharray="3 4"/>{curves.map((points,index)=><polyline key={index} points={points} fill="none" stroke={['#cf9f54','#397e93','#a77aa8'][index]} strokeWidth={index===1?2.5:1.4}/>)}<g fill="#627684" fontSize="10"><text x="25" y="166">−89°</text><text x="208" y="166">0°</text><text x="392" y="166">89°</text><text x="28" y="14">log₂(1 + 20 · fₛ · NoL)</text></g></svg><figcaption>CPU 角域剖面 · 金色 r=0.12 / 蓝色当前 r / 紫色 r=0.8。固定对数纵轴；这条二维曲线的面积不等于半球积分。</figcaption></figure>;
}
export default function PbrLab({embedded=false}:{embedded?:boolean}){
 const host=useRef<HTMLDivElement>(null),engine=useRef<PbrRenderer|null>(null),stateRef=useRef(defaultPbrState()),reportRef=useRef<PbrReport>({});
 const [state,setState]=useState(defaultPbrState),[report,setReport]=useState<PbrReport>({}),[attempt,setAttempt]=useState(0),[notice,setNotice]=useState('点击球面读取实际 GPU 数值；拖动改变相机。'),[link,setLink]=useState('');
 const receive=(patch:PbrReport)=>{reportRef.current={...reportRef.current,...patch};setReport(reportRef.current);if(patch.state){stateRef.current=patch.state;setState(patch.state);}};
 useEffect(()=>{let disposed=false;const parsed=attempt?{state:stateRef.current}:embedded?{state:defaultPbrState()}:decodePbrState(location.hash);stateRef.current=parsed.state;setState(parsed.state);reportRef.current={ready:false,pending:true};setReport(reportRef.current);if(parsed.notice)setNotice(parsed.notice);
  import('../../lib/pbr/webgpu-renderer').then(async({PbrWebGPURenderer})=>{if(disposed||!host.current)return;try{const created=await PbrWebGPURenderer.create(host.current,parsed.state,receive);if(disposed){created.dispose();return;}engine.current=created;}catch(error){receive({ready:false,pending:false,error:String(error instanceof Error?error.message:error)});}}).catch(error=>receive({ready:false,pending:false,error:String(error)}));
  const restore=()=>{if(embedded)return;const next=decodePbrState(location.hash);engine.current?.update(next.state);setNotice(next.notice??'已恢复材质、相机和显示参数。');};window.addEventListener('hashchange',restore);
  return()=>{disposed=true;window.removeEventListener('hashchange',restore);engine.current?.dispose();engine.current=null;};
 },[attempt]);
 useEffect(()=>{if(embedded)return;const context=(document as any).modelContext;if(!context?.registerTool)return;const controller=new AbortController();Promise.resolve(context.registerTool({name:'read_pbr_experiment',description:'只读返回材质参数、实际GPU逐像素BRDF、独立CPU校验与半球积分。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('不接受参数');return {...reportRef.current,state:engine.current?.exportState()??stateRef.current};}},{signal:controller.signal})).catch(()=>{});return()=>controller.abort();},[]);
 const ready=!!report.ready,pending=!!report.pending,inspection=report.inspection,integrating=!!report.integralProgress&&report.integralProgress<1;
 const change=(patch:Partial<PbrState>)=>engine.current?.update({...stateRef.current,...patch});
 const load=(task:0|1|2)=>{engine.current?.setPaused(false);engine.current?.update(pbrTaskState(task));setNotice('已载入任务起点；恢复本节将回到这个任务。');};
 const reset=()=>{engine.current?.setPaused(false);engine.current?.update(pbrTaskState(stateRef.current.task));setNotice('已恢复当前引导任务的参数与相机。');};
 async function share(){const url=new URL(pbrLabHref({...stateRef.current,learning:stateRef.current.learning??{article:'pbr',chapter:'lab'}}),location.origin).href;setLink(url);try{await navigator.clipboard.writeText(url);setNotice('实验链接已复制。');}catch{setNotice('复制下方链接即可分享。');}}
 const task=pbrTasks[state.task],diagnostic=['d','f','g'].includes(state.view);
 return <section className="pbr-lab">
  <header className="pbr-heading"><span className="eyebrow">MATERIAL LAB / SINGLE-SCATTER GGX</span><h3>先观察高光，再查一束光的去向。</h3><p>同一方向光、同一入射强度。三球材质只改变粗糙度；透视下各点的视线仍不同。CPU 校验和积分都使用线性值。</p></header>
  <div className="pbr-tasks"><div className="pbr-tabs">{pbrTasks.map((item,index)=><button key={item.name} disabled={!ready||pending} aria-pressed={state.task===index} onClick={()=>load(index as 0|1|2)}>{index+1} · {item.name}</button>)}</div><h4>{task.question}</h4><p>{task.action}</p></div>
  <ObservationGuide key={state.task} {...pbrGuides[state.task]}/>
  <div className="pbr-toolbar"><label>显示分量<select aria-label="材质显示分量" disabled={!ready} value={state.view} onChange={event=>change({view:event.target.value as PbrView})}>{Object.entries(viewLabels).map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><button disabled={!ready} aria-pressed={state.compare} onClick={()=>change({compare:!state.compare})}>三球粗糙度对照</button><span className="pbr-status" role="status">{report.error?'静态说明可读':!ready?'初始化中…':pending?'等待当前状态计算':'WebGPU · 就绪'}</span></div>
  <div className="pbr-viewport" ref={host}>
   {ready&&!pending&&inspection&&<span className="pbr-marker" aria-hidden="true" style={{left:inspection.uv[0]*100+'%',top:(1-inspection.uv[1])*100+'%'}}/>}
   {!ready&&<div className="pbr-fallback"><strong>{report.error??'准备材质 Shader…'}</strong><svg viewBox="0 0 480 130" role="img" aria-label="BRDF原理示意：法线分布D、Fresnel F与遮蔽G共同形成镜面响应"><g fill="#f2f7fa" stroke="#a9becb"><circle cx="100" cy="55" r="31"/><circle cx="240" cy="55" r="31"/><circle cx="380" cy="55" r="31"/></g><g fill="#396579" textAnchor="middle" fontSize="17"><text x="100" y="61">D</text><text x="240" y="61">F</text><text x="380" y="61">G</text><text x="240" y="113" fontSize="12">微法线分布 × 界面反射 × 可见比例</text></g></svg><p>原理示意，不是 GPU 输出。静态公式、边界和实验步骤在正文中完整保留。</p>{report.error&&<button onClick={()=>setAttempt(n=>n+1)}>重试材质实验</button>}</div>}
   {pending&&ready&&<div className="pbr-pending">参数已变化；旧检查已隐藏。单步或恢复后计算。</div>}
  </div>
  <p className="pbr-caption">{state.compare?'左球 r=0.12 · 中球为当前参数 · 右球 r=0.80；地面为固定介电材质。':'单球使用当前参数；地面为固定介电材质。'} {diagnostic?'D/F/G 是诊断信号，不乘光强、阴影或曝光。D 使用 log₂(1+D)/8 显示。':'图像使用曝光 → Reinhard → 显示编码；检查器保留映射前的线性辐射度。'}</p>
  <div className="pbr-actions"><button disabled={!ready||pending} onClick={()=>engine.current?.pick(state.task===1?.56:.5,.5)}>检查材质球示例点</button><button disabled={!ready} onClick={()=>engine.current?.setPaused(!report.paused)}>{report.paused?'恢复更新':'暂停更新'}</button><button disabled={!ready} onClick={()=>engine.current?.step()}>单步计算</button><button disabled={!ready} onClick={reset}>恢复本节示例</button><button onClick={share}>分享材质实验</button></div><p className="pbr-notice" role="status">{notice}</p>
  <fieldset className="pbr-fieldset" disabled={!ready}><div className="pbr-controls">
   <label>粗糙度 <output>{state.roughness.toFixed(2)}</output><input aria-label="材质粗糙度" type="range" min=".03" max="1" step=".01" value={state.roughness} onChange={e=>change({roughness:+e.target.value})}/></label>
   <label>金属度 <output>{state.metallic.toFixed(2)}</output><input aria-label="材质金属度" type="range" min="0" max="1" step=".05" value={state.metallic} onChange={e=>change({metallic:+e.target.value})}/></label>
   <label>基础颜色 · sRGB<input aria-label="材质基础颜色" type="color" value={state.baseColor} onChange={e=>change({baseColor:e.target.value})}/></label>
  </div><details className="pbr-options" open={embedded?undefined:true}><summary>灯光、曝光与几何遮挡 · 自由探索</summary><div className="pbr-controls">
   <label>方向光强 <output>{state.intensity.toFixed(1)}</output><input aria-label="材质方向光强" type="range" min="0" max="8" step=".1" value={state.intensity} onChange={e=>change({intensity:+e.target.value})}/></label>
   <label>灯光方位 <output>{state.lightAzimuth}°</output><input aria-label="材质灯光方位" type="range" min="-180" max="180" step="1" value={state.lightAzimuth} onChange={e=>change({lightAzimuth:+e.target.value})}/></label>
   <label>灯光仰角 <output>{state.lightElevation}°</output><input aria-label="材质灯光仰角" type="range" min="5" max="85" step="1" value={state.lightElevation} onChange={e=>change({lightElevation:+e.target.value})}/></label>
   <label>显示曝光 <output>{state.exposure.toFixed(1)} EV</output><input aria-label="材质显示曝光" type="range" min="-4" max="4" step=".1" value={state.exposure} disabled={diagnostic} onChange={e=>change({exposure:+e.target.value})}/></label>
   <label className="pbr-check"><input aria-label="材质几何阴影" type="checkbox" checked={state.shadows} onChange={e=>change({shadows:e.target.checked})}/> 几何遮挡 · 与微表面 G 分开</label>
  </div></details></fieldset>
  <Lobe state={state} noV={Math.max(.03,inspection?.terms.noV??.8)}/>
  {ready&&!pending&&inspection&&<section className="pbr-inspection"><header><span className="eyebrow">ACTUAL GPU PIXEL / OBJECT {inspection.objectId}</span><h4>把像素拆成可核对的量 <span className={inspection.valid&&inspection.maxRelativeError<.005?'pbr-good':'pbr-warning'}>{inspection.valid?'有限结果':'非法结果'}</span></h4></header>
   <div className="pbr-values">{[
    ['实际 roughness / α',inspection.material.roughness.toFixed(3)+' / '+inspection.terms.alpha.toFixed(5)],['线性 baseColor',triple(inspection.material.baseColor)],['NoL / NoV',inspection.terms.noL.toFixed(5)+' / '+inspection.terms.noV.toFixed(5)],['NoH / VoH',inspection.terms.noH.toFixed(5)+' / '+inspection.terms.voH.toFixed(5)],['F₀ · RGB',triple(inspection.terms.f0)],['F · RGB',triple(inspection.terms.f)],['D · 密度，可大于 1',inspection.terms.d.toExponential(5)],['G₁(L) / G₁(V) / G',triple([inspection.terms.g1L,inspection.terms.g1V,inspection.terms.g])],['Diffuse BRDF',triple(inspection.terms.diffuse)],['Specular BRDF',triple(inspection.terms.specular)],['几何可见性 V',inspection.visibility],['GPU 线性辐射度',triple(inspection.radiance)],['独立 CPU 线性辐射度',triple(inspection.cpuRadiance)],['最大归一化 GPU/CPU 差',inspection.maxRelativeError.toExponential(3)],
   ].map(([label,value])=><div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}</div>
   <p className="fine">GPU 从同一画面内核的 12 个 vec4 的异步存储缓冲读回。CPU 采用独立的斜率域 D 与 λ 形式 Smith；误差为 |GPU−CPU| / max(1, |CPU|)，不包含色调映射。NoV 是法线与视线的点积；F 使用 VoH。固定光源与较远相机下，F 可能近似均匀，改变法线不必显著改变 VoH。</p>
  </section>}
  <section className="pbr-integral"><h4>独立 CPU 半球积分</h4><p>固定选中材质与 NoV，计算 ∫ fᵣ·NoL dω。它不含方向光强、几何遮挡或曝光；不是当前图像亮度，也不是二维剖面曲线的面积。</p><div className="pbr-actions"><button disabled={!ready||pending||!inspection||inspection.terms.noV<=0||integrating} onClick={()=>engine.current?.generateIntegral()}>计算 8192 样本半球积分</button>{integrating&&<button onClick={()=>engine.current?.cancelIntegral()}>取消积分</button>}</div>{integrating&&<progress aria-label="材质积分进度" max="1" value={report.integralProgress}/>}
   {report.integral&&!pending&&inspection&&<div className="pbr-values pbr-integral-values">{[['Diffuse',report.integral.diffuse],['Specular',report.integral.specular],['合计 · RGB',report.integral.total],['4096 → 8192 变化',report.integral.convergence]].map(([label,value])=><div key={String(label)}><span>{String(label)}</span><strong>{triple(value as number[])}</strong></div>)}</div>}
   <p className="fine">GGX 项用半向量重要性采样，Lambert 项用余弦采样。有限样本不是全参数守恒证明；常见 diffuse/specular 耦合是教学近似，极端白色／掠射配置可能超过 1。单散射遗漏的多次微表面反射也会造成能量损失，积分不会被人为夹到 1。</p>
  </section>
  <div className="pbr-stats"><span>图像 <b>400 × 250</b></span><span>CPU 提交 <b>{report.cpuMs===undefined?'—':report.cpuMs.toFixed(2)+' ms'}</b></span><span>GPU <b>{report.gpuMs==null?'不可用':report.gpuMs.toFixed(2)+' ms'}</b></span></div><p className="fine pbr-device">{report.device?'设备：'+report.device+'。':''}性能不含调试回读与 CPU 积分。</p>
  {link&&<label className="pbr-share">实验链接<input aria-label="材质实验分享链接" readOnly value={link} onFocus={e=>e.target.select()}/></label>}
  <footer className="pbr-footer"><span>参数 → BRDF → 线性辐射度 → 显示</span><a href={embedded?pbrLabHref({...state,learning:{article:'pbr',chapter:'lab'}}):'/articles/pbr/#'+(state.learning?.chapter??'lab')}>{embedded?'携参数打开完整实验室':'返回文章章节'}</a></footer>
 </section>;
}
