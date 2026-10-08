import ObservationGuide from './reading/ObservationGuide';
import {aoGuides} from './reading/guides';
import {useEffect,useRef,useState} from 'react';
import {defaultState,decodeState,encodeState,sceneLabels,type LabState,type SceneName,type View} from '../lib/state';
import {algorithmDescriptions,lessons,lessonState,type LessonId} from '../lib/lessons';
import type {AORenderer,Inspection,Metrics,LabReport} from '../lib/renderer';
import SampleSpace from './SampleSpace';
import {focusPoint} from '../lib/focus';
import {sceneCamera} from '../lib/scene';
import type {FocusReport} from '../lib/renderer';
const chapterLabels={contact:'接触与遮挡',ssao:'SSAO 采样',horizon:'地平线方法',gtao:'GTAO 积分',limits:'对照与边界'};
type SelectionIndex={slice:number;sample:number};

function InspectionPanel({data,selection,onSelect}:{data:Inspection;selection:SelectionIndex;onSelect:(v:SelectionIndex)=>void}){
 const {slice,sample}=selection;
 const index=Math.min(slice,data.slices.length-1),row=data.slices[index];if(!row)return null;
 const selected=row.samples[Math.min(sample,row.samples.length-1)];
 const point=(theta:number,r=100)=>[150+Math.sin(theta)*r,140-Math.cos(theta)*r];
 const low=Math.max(row.low,row.gamma-Math.PI/2),high=Math.min(row.high,row.gamma+Math.PI/2);
 const pts=Array.from({length:61},(_,i)=>point(low+(high-low)*i/60));
 const occlusion=(Math.max(0,Math.cos(row.high)+Math.sin(row.gamma))+Math.max(0,Math.cos(row.low)-Math.sin(row.gamma)))/2;
 return <section className="inspection">
  <div className="inspection-head"><div><span className="eyebrow">实验 03 / 进入一个样本</span><h3>从屏幕位置，到空间关系。</h3></div><span className="ao-value"><small>原始可见度 A</small>{data.raw.toFixed(4)}</span></div>
  <div className="sample-navigation">
   <label>切片 / 样本组 <output>{index+1} / {data.slices.length}</output><input aria-label="检查切片" type="range" min="0" max={data.slices.length-1} value={index} onChange={e=>{onSelect({slice:+e.target.value,sample:0})}}/></label>
   <label>逐样本查看 <output>{Math.min(sample,row.samples.length-1)+1} / {row.samples.length}</output><input aria-label="检查样本" type="range" min="0" max={row.samples.length-1} value={Math.min(sample,row.samples.length-1)} onChange={e=>{onSelect({slice:index,sample:+e.target.value})}}/></label>
  </div>
  <div className="inspection-body spatial-inspection"><SampleSpace data={data} sample={selected} samples={row.samples}/><div className="slice-detail"><span className="eyebrow">地平线 / 同一位置的切片</span>
   <svg viewBox="0 0 300 285" aria-label="实际样本确定的地平线与法线投影" role="img"><path d="M30 140H270M150 165V18" stroke="#c8d3db" strokeDasharray="3 4"/><polygon points={[[150,140],...pts].map(p=>p.join(',')).join(' ')} fill="#dfb26733" stroke="#c87927"/>{[row.low,row.high].map((v,i)=><line key={i} x1="150" y1="140" x2={point(v)[0]} y2={point(v)[1]} stroke="#b6587b" strokeWidth="2"/>)}<line x1="150" y1="140" x2={point(row.gamma,118)[0]} y2={point(row.gamma,118)[1]} stroke="#2a6bbb" strokeWidth="3"/><circle cx="150" cy="140" r="4" fill="#152d3a"/><text x="160" y="20">v</text><text x="165" y="166">p</text></svg>
   <p className="fine">{data.algorithm==='ssao'?'此切片为同位置 GTAO 辅助解释；SSAO 的样本位置与判定见左图。':'角度与法线投影直接来自 GPU。'} 蓝色为法线投影，紫色为地平线。</p>
   <dl className="compact-readouts"><div><dt>法线偏角 γ</dt><dd>{(row.gamma*180/Math.PI).toFixed(2)}°</dd></div><div><dt>投影长度</dt><dd>{row.length.toFixed(5)}</dd></div>{data.algorithm==='hbao'&&<div><dt>本组地平线遮挡量</dt><dd>{occlusion.toFixed(6)}</dd></div>}<div><dt>{data.algorithm==='gtao'?'GPU 切片积分':'辅助 GTAO 积分'}</dt><dd>{row.gpu.toFixed(6)}</dd></div><div><dt>独立数值积分</dt><dd>{row.numeric.toFixed(6)}</dd></div><div><dt>最大积分差</dt><dd data-testid="integral-error">{data.error.toExponential(2)}</dd></div></dl>
  </div></div>
  <div className="sample-data"><span>采样纹素 UV <b>{selected.u.toFixed(3)}, {selected.v.toFixed(3)}</b></span><span>表面距离 <b>{selected.distance<0?'无效 / 出屏 / 超半径':selected.distance.toFixed(3)}</b></span><span>{data.algorithm==='ssao'?'深度判定':'校正后地平线余弦'}<b>{selected.distance<0?'不计入':data.algorithm==='ssao'?(selected.value>.5?'遮挡':'可见'):selected.value.toFixed(4)}</b></span></div>
  <p className="fine">所有位置均在观察空间。UV 原点在左下；地平线样本按左、右交替排列。灰色样本点不代表完整几何。</p>
 </section>;
}

export default function AOLab({embedded=false,profile='full'}:{embedded?:boolean;profile?:'contact'|'sampling'|'full'}){
 const full=profile==='full',contact=profile==='contact',sampling=profile==='sampling';
 const initial=()=>sampling?{...lessonState('noise'),learning:{chapter:'ssao' as const,lesson:'noise' as const}}:contact||embedded?{...lessonState('contact'),...(contact?{camera:{position:[3.8,3.4,5.3] as [number,number,number],target:[0,1,.2] as [number,number,number]}}:{}),learning:{chapter:'contact' as const,lesson:'contact' as const}}:defaultState();
 const host=useRef<HTMLDivElement>(null),zoom=useRef<(HTMLCanvasElement|null)[]>([]),engine=useRef<AORenderer|null>(null),stateRef=useRef(initial());
 const [state,setState]=useState(initial),[ready,setReady]=useState(false),[error,setError]=useState('');
 const [message,setMessage]=useState('先选一个观察任务。相机和算法共享同一场景；拖动可旋转，点击表面可检查。');
 const [inspection,setInspection]=useState<Inspection|null>(null),[metrics,setMetrics]=useState<Metrics|null>(null),[progress,setProgress]=useState(0);
 const [paused,setPaused]=useState(false),[cpu,setCpu]=useState(0),[size,setSize]=useState(''),[attempt,setAttempt]=useState(0),[share,setShare]=useState('');
 const [selection,setSelection]=useState<SelectionIndex>({slice:0,sample:0}),[lesson,setLesson]=useState<LessonId|null>(sampling?'noise':contact||embedded?'contact':null);
 const [pending,setPending]=useState(false),[focus,setFocus]=useState<FocusReport>({uv:null,label:'推荐位置',hint:'',visible:false});
 const active=lessons.find(x=>x.id===lesson),description=algorithmDescriptions[state.algorithm];
 const report=(r:LabReport)=>{
  setReady(r.ready);if(r.message){setMessage(r.message);if(!r.ready)setError(r.message);}
  if(r.state){stateRef.current=r.state;setState(r.state);}if(r.inspection!==undefined)setInspection(r.inspection);if(r.pending!==undefined)setPending(r.pending);if(r.focus)setFocus(r.focus);
  if(r.metrics!==undefined)setMetrics(r.metrics);if(r.progress!==undefined)setProgress(r.progress);if(r.cpuMs!==undefined)setCpu(r.cpuMs);if(r.size)setSize(r.size);
 };
 useEffect(()=>{
  let cancelled=false;const parsed=embedded||!full?{state:initial()}:decodeState(location.hash);
  stateRef.current=parsed.state;setState(parsed.state);setLesson(parsed.state.learning?.lesson??(sampling?'noise':contact||embedded?'contact':null));if(parsed.notice)setMessage(parsed.notice);setError('');setReady(false);setPaused(false);setPending(false);
  import('../lib/renderer').then(({AORenderer})=>{if(cancelled||!host.current)return;try{engine.current=new AORenderer(host.current,parsed.state,report);engine.current.inspectionEnabled=!contact;engine.current.setZoomTargets(zoom.current);if(sampling)engine.current.pickFocus();}catch(e){setError(e instanceof Error?e.message:'图形实验初始化失败。');}}).catch(()=>setError('实验模块加载失败，请重试。'));
  const restore=()=>{if(embedded||!full)return;const p=decodeState(location.hash);setLesson(p.state.learning?.lesson??null);engine.current?.restoreState(p.state);setMessage(p.notice??'已恢复分享参数，可以重新选点检查。');};window.addEventListener('hashchange',restore);
  return()=>{cancelled=true;window.removeEventListener('hashchange',restore);engine.current?.dispose();engine.current=null;};
 },[attempt,profile]);
 useEffect(()=>{
  const context=(document as any).modelContext;if(!context?.registerTool||!full)return;
  const controller=new AbortController();Promise.resolve(context.registerTool({name:'read_ao_experiment',description:'读取 AO 场景、算法、模式、实际样本位置及参考误差，不修改状态。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:(input:unknown)=>{if(!input||typeof input!=='object'||Object.keys(input).length)throw new Error('不接受参数');return {state:engine.current?.exportState()??stateRef.current,inspection:engine.current?.inspection??null,metrics:engine.current?.metrics??null,focus:engine.current?.focus??null};}},{signal:controller.signal})).catch(()=>{});return()=>controller.abort();
 },[]);
 function change(patch:Partial<LabState>){const next={...stateRef.current,...patch};if(patch.scene&&patch.scene!==stateRef.current.scene&&!patch.camera)next.camera=sceneCamera(patch.scene);if(engine.current)engine.current.update(next);else{stateRef.current=next;setState(next);}}
 function loadLesson(id:LessonId){setLesson(id);setPaused(false);engine.current?.setPaused(false);change({...lessonState(id),learning:{chapter:({contact:'contact',noise:'ssao',thin:'horizon',room:'limits'} as const)[id],lesson:id}});setMessage(lessons.find(x=>x.id===id)!.action);}
 function reset(){setLesson(sampling?'noise':contact||embedded?'contact':null);setPaused(false);engine.current?.setPaused(false);change(initial());setSelection({slice:0,sample:0});if(sampling)engine.current?.pickFocus();setMessage('已恢复本节场景与推荐观察角度。');}
 async function copyLink(){const url=new URL('/lab/',location.origin);url.hash=encodeState(engine.current?.exportState()??state);setShare(url.href);try{await navigator.clipboard.writeText(url.href);setMessage('实验链接已复制。接收者可在相同条件下重新选点。');}catch{setMessage('请复制下方实验链接。');}}
 function generateReference(){engine.current?.generateReference();host.current?.scrollIntoView({block:'center',behavior:'auto'});}
 function benchmark(){setPaused(false);engine.current?.setPaused(false);change({mode:'benchmark',view:'compare'});generateReference();}
 const selectedRow=inspection?.slices[Math.min(selection.slice,(inspection?.slices.length??1)-1)];
 const selected=selectedRow?.samples[Math.min(selection.sample,selectedRow.samples.length-1)];
 const learning=state.learning;
 const referenceReady=progress===1;
 return <div data-profile={profile} className={'ao-lab revised-lab profile-'+profile+' '+(embedded?'embedded':'')}>
  {full&&!embedded&&learning&&<div className="learning-context"><span>当前任务：{lessons.find(x=>x.id===learning.lesson)?.title}</span><a href={'/articles/gtao/#'+learning.chapter}>回到「{chapterLabels[learning.chapter]}」章节</a></div>}
  {full&&<div className="lesson-tabs" aria-label="观察任务">{lessons.map(l=><button key={l.id} aria-pressed={lesson===l.id} onClick={()=>loadLesson(l.id)}><span className="mono">{l.number}</span>{l.title}</button>)}</div>}
  <div className="lesson-brief"><span className="eyebrow">{active?'当前观察任务':'受控测试台 / 同场景比较'}</span><h3>{active?.question??'同一片几何，为什么得到不同的遮挡？'}</h3><p>{active?.action??'观察左侧球体接触、后方台阶、右侧凹槽与薄板。用算法对照固定条件，再进入一个像素。'}</p></div>
  <ObservationGuide {...aoGuides[contact?'contact':sampling?'sampling':'full']}/>
  <div className="algorithm-toolbar">{full?<div className="algorithm-tabs" aria-label="算法">{(['ssao','hbao','gtao'] as const).map((a,i)=><button key={a} aria-label={a.toUpperCase()} aria-pressed={state.algorithm===a} onClick={()=>change({algorithm:a})}><small>0{i+1}</small>{a.toUpperCase()}{a==='hbao'&&<span>教学</span>}</button>)}</div>:<span className="profile-purpose">{contact?'只改变距离，观察接触':'SSAO：一个候选点，一次深度比较'}</span>}<div className="display-actions">{!sampling&&<button aria-pressed={state.view==='none'} onClick={()=>change({view:state.view==='none'?'beauty':'none'})}>无 AO</button>}{full&&<button aria-pressed={state.view==='compare'} onClick={()=>change({view:state.view==='compare'?'beauty':'compare'})}>算法对照</button>}</div></div>
  <div className="lab-workspace"><div className="viewport-column"><div className="viewport" ref={host}>
   {state.view==='compare'&&<div className="comparison-labels" aria-hidden="true">{['SSAO','HBAO · 教学','GTAO',referenceReady?'完整几何参考 · 1024 spp':progress>0&&progress<1?`参考计算 ${Math.round(progress*100)}%`:'完整几何参考 · 未生成'].map((label,i)=><div key={label}><span><b>{String(i+1).padStart(2,'0')}</b>{label}</span></div>)}</div>}
   {inspection&&selected&&state.view!=='compare'&&<svg className="sample-overlay" viewBox="0 0 1000 625" aria-hidden="true"><line x1={inspection.uv[0]*1000} y1={(1-inspection.uv[1])*625} x2={selected.u*1000} y2={(1-selected.v)*625} stroke="#bd618d" strokeWidth="1.5" strokeDasharray="4 3"/><circle cx={selected.u*1000} cy={(1-selected.v)*625} r="4" fill="#bd618d" stroke="white"/></svg>}
   {!ready&&<div className="fallback"><svg viewBox="0 0 400 210" role="img" aria-label="静态替代图：遮挡物缩小可见角度"><path d="M35 165H365M200 165V28" stroke="#a6bbc8" strokeDasharray="4 5"/><path d="M200 165 120 65A130 130 0 0 1 315 105Z" fill="#dfb26733" stroke="#d59443"/><path d="M200 165 165 40" stroke="#6594d7" strokeWidth="3"/><text x="213" y="187">p</text><text x="163" y="27">n</text></svg><p>{error||'静态示意：可见角度与法线'}</p><p className="fine">样本给出遮挡边界；法线与方向共同决定贡献。开启 JavaScript 后可操作场景。</p>{error&&<button onClick={()=>setAttempt(x=>x+1)}>重试</button>}</div>}
   {state.view==='compare'&&!referenceReady&&<div className="reference-placeholder"><span>{progress>0?'正在计算完整几何参考':'完整几何参考尚未生成'}</span><small>{progress>0?`${Math.round(progress*100)}%`:'此位置始终保留给参考结果'}</small></div>}
   {pending&&paused&&<div className="pending-banner" role="status">参数已改变，画面与指标等待重新计算。点击“单步计算”或恢复更新。</div>}
  </div>
  {!contact&&<div className="viewport-toolbar"><span className="lab-status">{ready?'WebGL2 · 按需渲染':'静态说明可用'}</span><div><button disabled={!ready||state.mode==='benchmark'} onClick={()=>sampling?engine.current?.pickFocus():engine.current?.pick()}>{sampling?'检查推荐表面':'检查中心表面'}</button><button disabled={!ready} onClick={()=>{setPaused(!paused);engine.current?.setPaused(!paused)}}>{paused?'恢复更新':'暂停更新'}</button><button disabled={!ready} onClick={()=>engine.current?.step()}>单步计算</button></div></div>}
  <p className="live-message" role="status">{message}</p>
  </div><aside className="observation-panel"><span className="eyebrow">{state.view==='compare'?'同步局部对照':'LOOK CLOSER / 局部放大'}</span>
   {full&&<label>观察位置<select aria-label="观察位置" value={state.focus??'primary'} onChange={e=>change({focus:e.target.value as 'primary'|'detail',mode:state.mode==='inspect'?'explore':state.mode})}><option value="primary">{focusPoint(state.scene,'primary').label}</option><option value="detail">{focusPoint(state.scene,'detail').label}</option></select></label>}
   <div className={'local-views '+(state.view==='compare'?'is-comparing':'')}>
   {['SSAO','HBAO 教学','GTAO','完整几何参考'].map((label,i)=><figure key={label} className={'local-view '+(state.view!=='compare'&&i>0?'hidden-local':'')}><canvas ref={el=>{zoom.current[i]=el}} width="240" height="240" className="zoom-canvas" aria-label={state.view==='compare'?label+' 同一局部区域':'当前观察位置局部放大'}/><figcaption>{state.view==='compare'?label:focus.label}</figcaption>{(!focus.visible||(state.view==='compare'&&i===3&&!referenceReady))&&<span className="local-unavailable">{state.view==='compare'&&i===3&&!referenceReady?'参考未就绪':'观察点不可见'}</span>}</figure>)}
   </div>
   <p className="fine">{focus.visible?`${focus.label} · 所有面板放大同一图像区域，无平滑插值。`:'推荐位置被遮挡或移出画面，请调整相机或更换观察位置。'}</p>
   {!sampling&&<><label>遮挡物抬升 <output>{state.lift.toFixed(2)}</output><input aria-label="遮挡物抬升" type="range" min="0" max="2" step=".05" value={state.lift} disabled={state.scene==='corner'} onChange={e=>change({lift:+e.target.value})}/></label><div className="scale-caption"><span>0 · 接触 / 初始高度</span><span>2 · 悬空</span></div></>}
   {!contact&&<div className="budget-control"><span>采样预算</span><div><button aria-pressed={state.slices===1&&state.steps===4} onClick={()=>change({slices:1,steps:4,filter:false})}>8 次</button><button aria-pressed={state.slices===4&&state.steps===6} onClick={()=>change({slices:4,steps:6})}>48 次</button><button aria-pressed={state.slices===8&&state.steps===12} onClick={()=>change({slices:8,steps:12})}>192 次</button></div></div>}
   {full&&<label className="check"><input type="checkbox" checked={state.filter} onChange={e=>change({filter:e.target.checked})}/> 空间滤波</label>}
   {state.view==='compare'&&<label className="check"><input type="checkbox" checked={state.comparison==='ao'} onChange={e=>change({comparison:e.target.checked?'ao':'beauty'})}/> 仅比较 AO 数值</label>}
   <p className="observation-tip">{contact?'预测：距离增加后，球体脚下与薄板下方会怎样变化？方块保持不动，作为对照。':sampling?'先选择一个样本，看 q 与 s 的深度关系，再增加样本。增加采样不能恢复屏幕外的几何。':focus.hint||active?.observe}</p>
  </aside></div>
  {full&&<div className="method-explanation"><div><span className="eyebrow">当前方法</span><h4>{description.title}</h4><p>{description.idea}</p></div><div><strong>解决什么</strong><p>{description.solves}</p></div><div><strong>还剩什么</strong><p>{description.limits}</p></div></div>}
  {state.view==='compare'&&state.mode!=='benchmark'&&<div className="reference-invite"><p>所有面板共享相机、半径、种子与预算。加入参考会恢复此场景的固定相机与初始高度。</p><button className="primary" disabled={!ready} onClick={benchmark}>加入完整几何参考</button></div>}
  {full&&<details className="advanced-controls"><summary>高级参数与检查模式 <span>{state.slices*state.steps*2} 次采样 / 像素 · {size||'—'}</span></summary><div className="advanced-grid">
   <label>场景<select aria-label="场景" value={state.scene} onChange={e=>{setLesson(null);change({scene:e.target.value as SceneName})}}>{Object.entries(sceneLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   <label>视图<select aria-label="视图" value={state.view} onChange={e=>change({view:e.target.value as View})}>{[['beauty','统一材质'],['none','无 AO'],['compare','算法对照'],['ao','可见度 AO'],['raw','原始 AO'],['depth','观察空间深度'],['normal','观察空间法线'],...(referenceReady?[['reference','完整几何参考'],['difference','绝对误差 ×4']]:[])].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <label>作用半径 <output>{state.radius.toFixed(1)}</output><input aria-label="作用半径" type="range" min=".3" max="3" step=".1" value={state.radius} onChange={e=>change({radius:+e.target.value})}/></label>
   <label>切片 / 样本组 <output>{state.slices}</output><input aria-label="切片数" type="range" min="1" max="8" value={state.slices} onChange={e=>change({slices:+e.target.value})}/></label>
   <label>每侧采样 <output>{state.steps}</output><input aria-label="每侧采样" type="range" min="2" max="12" value={state.steps} onChange={e=>change({steps:+e.target.value})}/></label>
   <label>实验模式<select aria-label="实验模式" value={state.mode} onChange={e=>{if(e.target.value==='inspect')engine.current?.pick();else change({mode:e.target.value as LabState['mode']});}}><option value="explore">自由探索</option><option value="inspect">单点检查</option><option value="benchmark">固定基准</option></select></label>
   <div className="control-actions"><button onClick={reset}>恢复本节示例</button><button onClick={copyLink}>分享参数</button></div>
   <p className="fine">CPU 提交 {cpu.toFixed(2)} ms · GPU 时间未测量。并排对照会计算三种方法，提交时间不能作为单算法性能。</p>
  </div></details>}
  {share&&<label className="share-box">实验链接<input readOnly value={share} onFocus={e=>e.target.select()}/></label>}
  {state.mode==='benchmark'&&<section className="benchmark"><div><h3>固定基准 / 完整几何 AO</h3><p className="fine">320 × 200，固定相机和几何；余弦加权半球、硬半径。球体、盒体与平面解析求交，球面与显示网格存在微小差别。</p></div><button className="primary" disabled={!ready||(progress>0&&progress<1)} onClick={generateReference}>{progress>0&&progress<1?`计算中 ${Math.round(progress*100)}%`:'生成 1024 样本参考'}</button>{metrics&&!pending&&<div className="metric-row"><span>{state.algorithm.toUpperCase()} MAE <b>{metrics.mae.toFixed(5)}</b></span><span>RMSE <b>{metrics.rmse.toFixed(5)}</b></span>{metrics.local&&<span data-testid="local-error">{metrics.local.label} · 局部 MAE <b>{metrics.local.mae.toFixed(5)}</b><small>{metrics.local.count} 个有效像素</small></span>}<span>512→1024 平均变化 <b>{metrics.convergence.toFixed(5)}</b></span></div>}<p className="fine">统计对象为当前选中的 {state.algorithm.toUpperCase()}，{state.filter?'滤波后':'未滤波'}。HBAO 教学版的角域测度与参考目标不同，误差不能解释为“实现错误”；收敛变化也不是误差上界。</p></section>}
  {inspection&&<InspectionPanel data={inspection} selection={selection} onSelect={setSelection}/>}
  <div className="lab-bottom">{!full&&<button disabled={!ready} onClick={reset}>恢复本节示例</button>}<span>{contact?'观察结论：距离改变了局部可见性。':sampling?'观察结论：深度比较是一种可见性近似。':`无时间累积 · 种子 ${state.seed}`} · A：1 可见 / 0 遮挡</span>{embedded&&<a href={'/lab/'+encodeState(state)}>携当前问题进入完整实验室</a>}{!embedded&&<a href={'/articles/gtao/#'+(learning?.chapter??'limits')}>返回{chapterLabels[learning?.chapter??'limits']}</a>}</div>
  <noscript><p>JavaScript 未启用。请阅读静态示意和各节解释；三维实验需要 WebGL2。</p></noscript>
 </div>;
}
