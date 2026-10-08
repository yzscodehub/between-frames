import ObservationGuide from '../reading/ObservationGuide';
import {taaGuides} from '../reading/guides';
import {useEffect,useRef,useState} from 'react';
import {decodeTAAState,defaultTAAState,taaLabHref,type TAAState} from '../../lib/taa/state';
import type {TAARenderer,TAAReport} from '../../lib/taa/renderer';
import './taa.css';
const tasks=[
 {name:'抖动与累积',question:'静止的几何，每帧换一个亚像素位置会发生什么？',action:'从第 0 帧逐步前进，观察斜线和细杆。关闭抖动后会从起点重放；冻结当前帧生成独立 64 样本参考。',patch:{motion:'static',jitter:true,clipping:false,weight:.9,compare:true}},
 {name:'运动与显露',question:'新露出的表面应该继承谁的历史？',action:'播放刚体序列，再暂停查看历史拒绝。比较验证开关；相机切换模式的第 60 帧会清空历史。',patch:{motion:'object',validation:true,clipping:false,weight:.9,view:'reject'}},
 {name:'权重与颜色约束',question:'更稳定的历史，是否也会留下旧颜色？',action:'保持同一目标帧，比较历史权重 0.5 / 0.95 与 RGB 约束开关；每次修改会确定性重放，避免混入旧策略历史。',patch:{motion:'object',validation:true,clipping:true,weight:.95,compare:true}},
] satisfies Array<{name:string;question:string;action:string;patch:Partial<TAAState>}>;
const reasons=['接受历史','首帧 / 历史已清空','前帧 UV / 双线性窗口出界','对象身份不同','前帧深度不匹配','法线不匹配','背景，无接收表面'];
const vec=(a:number[]|undefined,n=4)=>a?.map(x=>Number.isFinite(x)?x.toFixed(n):'无效').join(', ')??'—';

export default function TAALab({embedded=false}:{embedded?:boolean}){
 const host=useRef<HTMLDivElement>(null),engine=useRef<TAARenderer|null>(null),stateRef=useRef(defaultTAAState()),reportRef=useRef<TAAReport>({}),example=useRef<TAAState|null>(null);
 const [state,setState]=useState(defaultTAAState),[report,setReport]=useState<TAAReport>({}),[task,setTask]=useState(-1),[attempt,setAttempt]=useState(0),[share,setShare]=useState(''),[notice,setNotice]=useState('每次“下一帧”只处理一个新帧；切换视图不会积累历史。');
 function receive(r:TAAReport){reportRef.current={...reportRef.current,...r};setReport(reportRef.current);if(r.state){stateRef.current=r.state;setState(r.state);}}
 useEffect(()=>{
  let cancelled=false;const parsed=attempt>0?{state:stateRef.current}:embedded?{state:defaultTAAState()}:decodeTAAState(location.hash);
  stateRef.current=parsed.state;setState(parsed.state);reportRef.current={ready:false,pending:true};setReport(reportRef.current);if(parsed.notice)setNotice(parsed.notice);
  import('../../lib/taa/renderer').then(({TAARenderer})=>{if(cancelled||!host.current)return;try{engine.current=new TAARenderer(host.current,parsed.state,receive);}catch(e){receive({ready:false,pending:false,error:e instanceof Error?e.message:String(e)});}}).catch(e=>receive({ready:false,pending:false,error:String(e)}));
  const restore=()=>{if(embedded)return;const next=decodeTAAState(location.hash);engine.current?.configure(next.state,true);setNotice(next.notice??'从第 0 帧重放，重建当前参数下的历史。');};window.addEventListener('hashchange',restore);
  return()=>{cancelled=true;window.removeEventListener('hashchange',restore);engine.current?.dispose();engine.current=null;};
 },[attempt,embedded]);
 useEffect(()=>{
  if(embedded)return;const context=(document as any).modelContext;if(!context?.registerTool)return;const controller=new AbortController();
  Promise.resolve(context.registerTool({name:'read_taa_experiment',description:'只读返回TAA确定性序列、真实GPU点检查、同帧参考与统计；不修改实验。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw Error('不接受参数');return {...reportRef.current,...engine.current?.snapshot()};}},{signal:controller.signal})).catch(()=>{});
  return()=>controller.abort();
 },[embedded]);
 const ready=!!report.ready,replaying=(report.replay??-1)>=0,refBusy=!!report.referenceRunning,locked=!ready||replaying||refBusy,inspection=report.inspection;
 const change=(patch:Partial<TAAState>)=>engine.current?.configure({...stateRef.current,...patch});
 function load(index:number){const next={...defaultTAAState(),...tasks[index].patch};example.current=structuredClone(next);setTask(index);engine.current?.configure(next,true);}
 async function sharing(){const url=new URL(taaLabHref(stateRef.current),location.origin).href;setShare(url);try{await navigator.clipboard.writeText(url);setNotice('已复制参数链接；打开后从第 0 帧确定性重放，不传输历史纹理。');}catch{setNotice('请复制下方链接。');}}
 return <section className="taa-lab" data-taa-lab>
  <header><span className="eyebrow">TEMPORAL AA / 真实光栅与重投影</span><h3>当前像素，能相信哪一份历史？</h3><p>16 点 Halton 抖动循环 · 世界几何验证 · RGB 邻域约束。历史年龄不是独立 spp。</p></header>
  <div className="taa-tasks">{tasks.map((t,i)=><button key={t.name} type="button" disabled={locked} aria-pressed={task===i} onClick={()=>load(i)}>{i+1} · {t.name}</button>)}</div>
  <div className="taa-brief"><strong>{task<0?'选择一个任务，载入可复现的起点。':tasks[task].question}</strong><p>{task<0?'也可直接检查当前静态场景，先观察细杆和斜线。':tasks[task].action}</p></div>
 <ObservationGuide key={task} {...taaGuides[Math.max(0,task)]}/>
  <div className="taa-viewport" ref={host}>
   {state.compare&&<div className="taa-labels"><span>当前单样本</span><span>TAA</span><span>同帧 64 样本参考</span><span>TAA / 参考差异 ×5</span></div>}
   {state.compare&&!report.referenceReady&&<><div className="taa-empty ref">参考尚未生成</div><div className="taa-empty diff">参考完成后显示差异</div></>}
   {!ready&&<div className="taa-fallback"><svg viewBox="0 0 400 100" aria-label="当前样本与经过验证、颜色约束的历史混合" role="img"><rect x="12" y="20" width="100" height="55" rx="6"/><rect x="150" y="20" width="100" height="55" rx="6"/><rect x="288" y="20" width="100" height="55" rx="6"/><path d="M113 48h35m103 0h35"/><text x="28" y="53">当前样本</text><text x="163" y="53">验证历史</text><text x="300" y="53">约束与混合</text></svg><p>{report.error??'准备真实网格光栅与历史缓冲…'}</p><p>静态原理：将当前表面投影到上一帧，核对身份、深度与法线，再约束历史颜色。条件不符时只采用当前值。</p>{report.error&&<button onClick={()=>setAttempt(v=>v+1)}>重试 TAA 实验</button>}</div>}
   {ready&&replaying&&<div className="taa-progress">正在重放到第 {report.replay} 帧，当前 {state.frame}。旧策略历史已清空。</div>}
  </div>
  <div className="taa-actions">
   <button disabled={!ready||(!replaying&&!report.playing&&state.frame>=120)} onClick={()=>replaying?engine.current?.play(false):engine.current?.play(!report.playing)}>{replaying?'取消重放':report.playing?'暂停播放':'播放序列'}</button>
   <button disabled={locked||report.playing||state.frame>=120} onClick={()=>engine.current?.next()}>下一帧</button>
   <button disabled={!ready} onClick={()=>engine.current?.inspect()}>检查中心像素</button>
   <button disabled={!ready} onClick={()=>engine.current?.configure(example.current?structuredClone(example.current):defaultTAAState(),true)}>恢复当前任务</button>
   <button disabled={locked||report.pending} onClick={sharing}>分享 TAA 实验</button>
  </div>
  <p className="taa-note" role="status">{notice} 回放按实际计算速度进行，不代表 60 fps。</p>
  <div className="taa-controls">
   <label>确定性帧号 <output>{state.frame} / 120</output><input aria-label="TAA 帧号" type="range" min="0" max="120" step="1" value={state.frame} disabled={locked} onChange={e=>engine.current?.seek(+e.target.value)}/></label>
   <label>受控序列<select aria-label="TAA 运动" value={state.motion} disabled={locked} onChange={e=>change({motion:e.target.value as TAAState['motion']})}><option value="static">静态</option><option value="object">刚体横移</option><option value="camera">相机平移</option><option value="cut">第 60 帧相机切换</option></select></label>
   <label>场景频率<select aria-label="TAA 场景" value={state.scene} disabled={locked} onChange={e=>change({scene:e.target.value as TAAState['scene']})}><option value="studio">棋盘与斜线</option><option value="fine">更细的棋盘与斜线</option></select></label>
   <label>历史权重上限 <output>{state.weight.toFixed(2)}</output><input aria-label="TAA 历史权重" type="range" min="0" max=".98" step=".01" value={state.weight} disabled={locked} onChange={e=>change({weight:+e.target.value})}/></label>
   <label className="taa-check"><input aria-label="TAA 亚像素抖动" type="checkbox" checked={state.jitter} disabled={locked} onChange={e=>change({jitter:e.target.checked})}/> 16 点亚像素抖动</label>
   <label className="taa-check"><input aria-label="TAA 历史验证" type="checkbox" checked={state.validation} disabled={locked} onChange={e=>change({validation:e.target.checked})}/> 对象 / 深度 / 法线验证</label>
   <label className="taa-check"><input aria-label="TAA RGB 约束" type="checkbox" checked={state.clipping} disabled={locked} onChange={e=>change({clipping:e.target.checked})}/> 3×3 RGB 包围盒约束</label>
   <label>图像分辨率<select aria-label="TAA 质量" value={state.quality} disabled={locked} onChange={e=>change({quality:e.target.value as TAAState['quality']})}><option value="standard">320 × 200</option><option value="low">160 × 100</option></select></label>
   <label>显示信号<select aria-label="TAA 视图" value={state.view} disabled={!ready} onChange={e=>change({view:e.target.value as TAAState['view'],compare:false})}><option value="final">TAA 结果</option><option value="current">当前单样本</option><option value="reject">历史拒绝原因</option><option value="velocity">重投影位移（含抖动）</option></select></label>
   <label>显示曝光 <output>{state.exposure.toFixed(1)} EV</output><input aria-label="TAA 曝光" type="range" min="-4" max="4" step=".1" value={state.exposure} disabled={!ready} onChange={e=>change({exposure:+e.target.value})}/></label>
   <label className="taa-check"><input aria-label="TAA 四格对照" type="checkbox" checked={state.compare} disabled={!ready} onChange={e=>change({compare:e.target.checked})}/> 四格对照</label>
  </div>
  <p className="taa-note">验证关闭仅用于制造反例；首帧、相机切换和 UV 越界仍不使用历史。双线性历史的四个有效权重邻居都需通过验证，边界处可能保守拒绝。调整策略、分辨率或场景会从 0 重放；曝光和视图只展示。</p>
  <div className="taa-reference"><h4>冻结同一帧的 64 样本参考</h4><p>64 个单独的亚像素光栅样本，固定相机与几何；不混入运动前后帧。32 → 64 变化是收敛诊断，不是误差上界。</p><div className="taa-actions"><button disabled={locked||report.pending} onClick={()=>engine.current?.generateReference()}>生成同帧 64 样本参考</button>{refBusy&&<button onClick={()=>engine.current?.cancelReference()}>取消 TAA 参考</button>}<button disabled={!ready||!report.referenceReady||report.playing||replaying} onClick={()=>engine.current?.measure()}>重新统计参考误差</button></div>{refBusy&&<progress max="1" value={report.referenceProgress} aria-label="TAA 参考进度"/>}
   {report.metrics?.status==='invalid'&&<p role="alert">基准含非法像素，下列数值只作诊断。</p>}
   {report.metrics&&report.referenceReady&&<dl className="taa-metrics">{[['固定帧',report.metrics.frame],['当前样本 MAE',report.metrics.currentMAE.toFixed(6)],['TAA MAE',report.metrics.taaMAE.toFixed(6)],['TAA RMSE',report.metrics.taaRMSE.toFixed(6)],['32 → 64 平均变化',report.metrics.convergence.toExponential(2)],['有效图像覆盖',(100*report.metrics.coverage).toFixed(1)+'%'],['非法像素',report.metrics.invalidPixels],['拒绝区域 MAE',report.metrics.rejectedMAE?.toFixed(6)??'无此区域']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
   <p className="taa-note">统计比较全图有限 RGB 对，包括有效背景与轮廓，使用线性颜色且不含显示曝光；非法像素单独记录，不能当作零误差。完整图像读回仅在生成或更新基准时执行。</p>
  </div>
  {inspection&&!report.pending&&<section className="taa-inspection"><h4>实际 GPU 点检查 · 第 {inspection.frame} 帧</h4><strong>{reasons[inspection.reason]??'无效结果'}</strong><svg viewBox="0 0 400 180" aria-label="实际当前UV与上一帧几何验证UV" role="img"><rect x="35" y="15" width="330" height="135" fill="#eef4f8" stroke="#9bafbc"/><path d={'M'+(35+330*inspection.uv[0])+' '+(150-135*inspection.uv[1])+'L'+(35+330*inspection.previousUv[0])+' '+(150-135*inspection.previousUv[1])} stroke="#b66d36" strokeWidth="2"/><circle cx={35+330*inspection.uv[0]} cy={150-135*inspection.uv[1]} r="5" fill="#286c9b"/><circle cx={35+330*inspection.previousUv[0]} cy={150-135*inspection.previousUv[1]} r="3" fill="#c9793c"/><text x="35" y="172">蓝：当前 UV　橙：前帧几何 UV；历史颜色 UV 见读数</text></svg>
   <dl className="taa-metrics">{[
    ['当前 / 前帧抖动（像素）',vec(inspection.jitter)+' / '+vec(inspection.previousJitter)],
    ['当前 / 前帧几何 UV',vec(inspection.uv)+' / '+vec(inspection.previousUv)],
    ['历史颜色 UV（去除抖动位移）',vec(inspection.historyUv)],
    ['当前位置 / 对象 ID',vec(inspection.position,3)+' / '+inspection.objectId],
    ['前帧历史缓冲有效',inspection.hasHistory?'是':'否'],['参与验证的旧对象 ID',inspection.hasHistory?inspection.oldObjectId:'— 无历史'],['当前单样本 RGB',vec(inspection.current)],['重采样历史 RGB',inspection.hasHistory?vec(inspection.history):'— 无历史'],['约束后历史 RGB',vec(inspection.clipped)],['最终 RGB',vec(inspection.final)],
    ['实际历史权重 / 年龄',inspection.weight.toFixed(5)+' / '+inspection.age],['预测前帧轴距 / 邻居轴距',inspection.previousClip[3].toFixed(5)+' / '+inspection.oldDepth.toFixed(5)],['法线点积',inspection.normalDot.toFixed(5)],['邻域 RGB 下界',vec(inspection.minimum)],['邻域 RGB 上界',vec(inspection.maximum)]
   ].map(([k,v])=><div key={String(k)}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="taa-note">旧 ID / 轴距 / 法线值来自实际双线性邻居：拒绝时保留触发拒绝的邻居，通过时显示最后一个邻居。年龄是有效历史链长度，16 点循环会重复，不能标成独立 spp。</p></section>}
  <div className="taa-timing"><span>CPU 核心提交：{report.cpuMs?.toFixed(2)??'—'} ms</span><span>GPU 光栅 + TAA：{report.gpuMs==null?'不可用':report.gpuMs.toFixed(2)+' ms'}</span><span>已处理帧：{report.renderCount??0}</span></div>
  {report.device&&<p className="taa-note taa-device">设备：{report.device}。GPU 时间只表示当前执行设备的光栅与 TAA 计算，调试读回另计。</p>}
  {share&&<label className="taa-share">分享链接<input value={share} readOnly onFocus={e=>e.target.select()}/></label>}
  <footer><span>GL UV 从左下起算 · 线性 RGB · 受控刚体</span><a href={embedded?taaLabHref(state):'/articles/taa/#lab'}>{embedded?'携状态打开完整实验室':'返回文章实验'}</a></footer>
 </section>;
}
