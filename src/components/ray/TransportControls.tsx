import type {RayState} from '../../lib/ray/state';
import type {ReferenceMetrics} from '../../lib/ray/progressive';

export interface TransportControlsProps {
  state: RayState;
  ready: boolean;
  pending: boolean;
  samples: number;
  progress: number;
  referenceReady: boolean;
  metrics: ReferenceMetrics | null;
  playing: boolean;
  replay: number;
  onChange: (patch: Partial<RayState>) => void;
  onReference: () => void;
  onCancelReference: () => void;
  onMeasure: () => void;
  onPlay: (value: boolean) => void;
  onFrame: (target: number) => void;
  onNextFrame: () => void;
  onResetHistory: () => void;
}

const sampleChoices = [1,16,64,256,1024];
const batchChoices = [1,4,16];
const viewLabels = ['最终合成 final','当前帧间接光 raw','时域历史 history','空间滤波 filtered','亮度方差 variance','历史拒绝 reject'];
const numeric = (value: number) => Number.isFinite(value) ? value.toExponential(3) : '—';

export default function TransportControls({
  state,ready,pending,samples,progress,referenceReady,metrics,playing,replay,
  onChange,onReference,onCancelReference,onMeasure,onPlay,onFrame,onNextFrame,onResetHistory,
}: TransportControlsProps) {
  const denoise = state.lesson === 'denoise';
  const reflection = state.lesson === 'reflections';
  const shadow = state.lesson === 'shadows';
  const path = state.lesson === 'path';
  const mis = state.lesson === 'mis';
  const finiteTransport = path || mis || denoise;
  const shadowVariant = Math.max(0,Math.min(1,state.variant));
  const referenceProgress = Number.isFinite(progress) ? Math.max(0,Math.min(1,progress)) : 0;
  const referencing = referenceProgress > 0 && referenceProgress < 1;
  const replaying = denoise && replay >= 0;
  const locked = !ready || referencing || replaying;
  const actionable = ready && !pending && !referencing && !replaying;
  const validMetrics = referenceReady && !pending && !referencing ? metrics : null;
  const hasCoverage = validMetrics !== null && validMetrics.coverage > 0;

  if (!denoise && !reflection && !shadow && !path && !mis) return null;

  return <section className="ray-transport-controls" aria-label="光传输实验参数">
    <div className="ray-signal-note">
      {shadow && <>
        <strong>比较矩形光源的面积平均可见度：1 完全可见，0 完全遮挡。</strong>
        <span>Shadow Map 读取中心光图（{state.quality==='low'?256:512}²）；PCSS 使用 81 次遮挡搜索与 9×9 滤波；RT 均匀采样灯面。这一信号不包含物理直接光照的距离、余弦与材质权重。</span>
      </>}
      {reflection && <>
        <strong>SSR、RT 与镜像相机共用同一颜色定义，仅比较一次平面镜面反射。</strong>
        <span>先用自发光颜色（ρ + Le）核对几何，再切换局部光照。局部模型为 Le + ρ × (0.18 + 0.82 max(n·ℓ, 0))，是非物理的形状明暗模型，不是完整全局光照。镜像相机参考限于 y=0 平面。</span>
      </>}
      {(path || mis) && <>
        <strong>当前目标最多包含 {state.maxScattering} 次表面散射。</strong>
        <span>有限散射参考不包含预算以外的光路。增加 spp 降低随机路径噪声；默认相机无亚像素抖动，因此不会同时解决几何抗锯齿。</span>
        {mis && <span>NEE/MIS 对照使用黑色环境，显式采样同一个矩形发光面；相同 spp 不等于相同射线数量。</span>}
      </>}
      {denoise && <>
        <strong>重建 B = E_ind / π，最后合成 Le + direct + ρB；最多 {state.maxScattering} 次散射。</strong>
        <span>B 通过将第一处 Lambert 接收面设白直接生成，不除以 ρ。直接层独立使用 16 个灯样本；镜面与 GGX 首接收面不适用此分解。</span>
        <span>当前帧样本、时域历史与固定帧参考分别保存。三遍 à-trous 为教学重建，不是完整 SVGF。</span>
      </>}
    </div>

    <div className="ray-controls">
      {!denoise && !reflection && <label>目标样本数 / 像素
        <select aria-label="目标样本数" value={state.targetSpp} disabled={locked} onChange={event=>onChange({targetSpp:Number(event.target.value)})}>
          {!sampleChoices.includes(state.targetSpp) && <option value={state.targetSpp} disabled>{state.targetSpp} spp（恢复值）</option>}
          {sampleChoices.map(value=><option key={value} value={value}>{value} spp</option>)}
        </select>
      </label>}
      {finiteTransport && <label>最大散射次数 <output>{state.maxScattering}</output>
        <input aria-label="最大散射次数" type="range" min="1" max="8" step="1" value={state.maxScattering} disabled={locked} onChange={event=>onChange({maxScattering:Number(event.target.value)})}/>
      </label>}
      {reflection&&<label>反射验证模型<select aria-label="反射验证模型" value={state.view} disabled={locked} onChange={event=>onChange({view:Number(event.target.value)})}><option value="1">自发光颜色 · 验证几何</option><option value="0">共享局部光照 · 验证着色</option></select></label>}
      {mis && <>
        <label>估计器
          <select aria-label="光照估计器" value={state.estimator} disabled={locked} onChange={event=>onChange({estimator:event.target.value as RayState['estimator'],environment:0})}>
            <option value="bsdf">BSDF-only</option><option value="nee">NEE</option><option value="mis">MIS · power 2</option>
          </select>
        </label>
        <label>Lambert 方向采样
          <select aria-label="Lambert 方向采样" value={state.sampling} disabled={locked} onChange={event=>onChange({sampling:event.target.value as RayState['sampling']})}>
            <option value="uniform">均匀半球 uniform</option><option value="cosine">余弦半球 cosine</option>
          </select>
        </label>
        <label>GGX 粗糙度 <output>{state.roughness.toFixed(2)}</output>
          <input aria-label="GGX 粗糙度" type="range" min=".05" max="1" step=".01" value={state.roughness} disabled={locked} onChange={event=>onChange({roughness:Number(event.target.value)})}/>
        </label>
      </>}
      {!reflection && <label>矩形光源尺寸倍率 <output>{state.lightSize.toFixed(2)}</output>
        <input aria-label="矩形光源尺寸" type="range" min=".1" max="2" step=".05" value={state.lightSize} disabled={locked} onChange={event=>onChange({lightSize:Number(event.target.value)})}/>
      </label>}
      {shadow && <>
        <label>遮挡板高度 <output>{(.4+1.2*shadowVariant).toFixed(2)} 场景单位</output>
          <input aria-label="遮挡板高度" type="range" min="0" max="1" step=".025" value={shadowVariant} disabled={locked} onChange={event=>onChange({variant:Number(event.target.value)})}/>
        </label>
        <label>表面偏移倍率 <output>{state.offsetScale.toFixed(1)}</output>
          <input aria-label="阴影表面偏移倍率" type="range" min="0" max="4" step=".1" value={state.offsetScale} disabled={locked} onChange={event=>onChange({offsetScale:Number(event.target.value)})}/>
        </label>
      </>}
      {path && <label>常量环境 / BSDF-only
        <select aria-label="常量环境" value={state.environment} disabled={locked} onChange={event=>onChange({environment:Number(event.target.value),estimator:'bsdf'})}>
          {state.environment!==0 && state.environment!==1 && <option value={state.environment} disabled>{state.environment.toFixed(2)}（恢复值）</option>}
          <option value="0">关闭 · 黑色环境</option><option value="1">开启 · 常量环境</option>
        </select>
      </label>}
      {(path || mis) && <label className="check">
        <input aria-label="俄罗斯轮盘赌" type="checkbox" checked={state.rr} disabled={locked} onChange={event=>onChange({rr:event.target.checked})}/> 俄罗斯轮盘赌 RR
        <span>{state.maxScattering<=3 ? '（当前散射上限下不触发）' : '（第三次散射后，仍可继续时启用）'}</span>
      </label>}
      {!reflection&&<label>随机种子<input aria-label="随机种子" type="number" min="0" max="65535" step="1" value={state.seed} disabled={locked} onChange={event=>{const seed=Number(event.target.value);if(Number.isInteger(seed)&&seed>=0&&seed<=65535)onChange({seed})}}/></label>}
      <label>显示曝光 <output>{state.exposure.toFixed(1)} EV</output>
        <input aria-label="显示曝光" type="range" min="-4" max="4" step=".1" value={state.exposure} disabled={!ready} onChange={event=>onChange({exposure:Number(event.target.value)})}/>
      </label>
      <label>质量档
        <select aria-label="传输实验质量" value={state.quality} disabled={locked} onChange={event=>onChange({quality:event.target.value as RayState['quality']})}>
          <option value="standard">320 × 200</option><option value="low">160 × 100</option>
        </select>
      </label>
    </div>

    {denoise && <div className="ray-controls temporal-controls">
      <label>受控运动
        <select aria-label="受控运动" value={state.motion} disabled={locked} onChange={event=>onChange({motion:event.target.value as RayState['motion']})}>
          <option value="object">刚体运动</option><option value="camera">相机运动</option><option value="cut">相机切换</option>
        </select>
      </label>
      <label>序列帧号 <output>{state.frame} / 120</output>
        <input aria-label="序列帧号" type="range" min="0" max="120" step="1" value={state.frame} disabled={locked} onChange={event=>onFrame(Number(event.target.value))}/>
      </label>
      <label>每帧样本数 / 像素
        <select aria-label="每帧样本数" value={state.batch} disabled={locked} onChange={event=>onChange({batch:Number(event.target.value)})}>
          {!batchChoices.includes(state.batch) && <option value={state.batch} disabled>{state.batch} spp（恢复值）</option>}
          {batchChoices.map(value=><option key={value} value={value}>{value} spp / 帧</option>)}
        </select>
      </label>
      <label>信号视图
        <select aria-label="间接光信号视图" value={state.view} disabled={!ready} onChange={event=>onChange({view:Number(event.target.value)})}>
          {state.view>=viewLabels.length && <option value={state.view} disabled>未支持的恢复视图 {state.view}</option>}
          {viewLabels.map((label,value)=><option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="check"><input aria-label="时域历史" type="checkbox" checked={state.history} disabled={locked} onChange={event=>onChange({history:event.target.checked})}/> 接受有效时域历史</label>
      <label className="check"><input aria-label="空间滤波" type="checkbox" checked={state.spatial} disabled={locked} onChange={event=>onChange({spatial:event.target.checked})}/> 三遍 à-trous 空间滤波</label>
      <div className="ray-actions">
        <button type="button" aria-pressed={playing} disabled={locked || (!playing && (pending || state.frame>=120))} onClick={()=>onPlay(!playing)}>{playing?'暂停回放':'播放受控序列'}</button>
        <button type="button" disabled={!actionable || playing || state.frame>=120} onClick={onNextFrame}>下一帧</button>
        <button type="button" disabled={!actionable || playing} onClick={onResetHistory}>重置时域历史</button>
      </div>
      <p className="fine" role="status">{replaying ? '正在重放：当前 '+state.frame+'，目标 '+replay+' 帧。' : '当前第 '+state.frame+' 帧。'} 回放按实际计算速度推进，不代表达到 60 fps。修改帧内样本数会改变噪声预算，不能与跨帧历史长度混为一谈。</p>
    </div>}

    <div className="ray-accumulation">
      <span>{pending ? '输入已变化，等待当前状态结果。' : reflection ? '确定性单次反射 · 不做随机累积' : denoise ? '当前帧 '+samples+' spp · 历史另计' : '静态累积 '+samples+' / '+state.targetSpp+' spp'}</span>
      {!reflection && <>
        <button type="button" disabled={!actionable} onClick={()=>{onPlay(false);onReference();}}>
          {referencing ? '参考生成中 '+Math.round(referenceProgress*100)+'%' : referenceReady ? '冻结并重新生成 1024 样本参考' : '冻结并生成 1024 样本参考'}
        </button>
        <button type="button" disabled={!actionable || !referenceReady || playing} onClick={onMeasure}>更新参考误差</button>
        {referencing && <button type="button" onClick={onCancelReference}>取消参考</button>}
        {referencing && <progress aria-label="固定状态参考进度" max={1} value={referenceProgress}/>}
        <span>{referenceReady && !pending ? '固定状态参考已就绪' : referencing ? '正在使用独立样本生成参考' : '参考尚未生成或已失效'}</span>
      </>}
    </div>

    {validMetrics && !reflection && <div className="ray-reference-metrics" aria-label="固定状态参考统计">
      <b>参考目标：{denoise ? 'B = E_ind / π（首接收面设白）' : validMetrics.component} · {validMetrics.samples} spp</b>
      {validMetrics.status==='invalid'&&<strong role="alert">基准失败：{validMetrics.invalidPixels} 个像素含溢出或非法结果；下列仅为诊断统计。</strong>}
      <span>有效覆盖 {Number.isFinite(validMetrics.coverage) ? (validMetrics.coverage*100).toFixed(1)+'%' : '—'}</span>
      <span>MAE {hasCoverage ? numeric(validMetrics.mae) : '—'}</span>
      <span>RMSE {hasCoverage ? numeric(validMetrics.rmse) : '—'}</span>
      <span>512 → 1024 平均变化 {hasCoverage ? numeric(validMetrics.convergence) : '—'}</span>
      {!hasCoverage && <span>没有可比较的有效像素。</span>}
    </div>}
    {!reflection && <p className="ray-transport-note">
      误差在线性数值与双方有效区域内计算；曝光仅用于显示。{!denoise&&' 图像统计包含有效未命中背景的零值，不是仅边缘区域误差。'}512 → 1024 的变化是收敛诊断，不是误差上界。
      {denoise && ' 此处比较重建后的 B 与固定帧 B 参考，不把最终合成、直接光和历史缓存混作同一个目标。'}
    </p>}
  </section>;
}
