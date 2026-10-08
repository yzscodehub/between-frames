import {useState} from 'react';
import {CONTRIBUTION_DOMAIN, CONTRIBUTION_PRESETS, CONTRIBUTION_STEPS, DEG, contributionWeight, evaluateContribution} from '../lib/contribution';
import './ContributionExplorer.css';

const points = (low: number, high: number, project: (theta: number) => number[], count = 121) =>
  Array.from({length: count}, (_, i) => project(low + (high - low) * i / (count - 1)));
const coordinates = (list: number[][]) => list.map(p => p.join(',')).join(' ');

export default function ContributionExplorer() {
  const [gamma, setGamma] = useState(-60);
  const [length, setLength] = useState(1);
  const {gamma: g, measure, exact, numeric, error} = evaluateContribution(gamma, length);
  const {low, high} = CONTRIBUTION_DOMAIN;
  const center = [210, 177];
  const point = (theta: number, radius = 111) => [center[0] + Math.sin(theta) * radius, center[1] - Math.cos(theta) * radius];
  const normal = point(g, 136 * length);
  const normalLabel = point(g, 136 * length + 17);
  const arrow = [normal, point(g - .045 / length, 136 * length - 11), point(g + .045 / length, 136 * length - 11)];
  const plotX = (theta: number) => 44 + (theta + Math.PI / 2) / Math.PI * 352;
  const plotY = (weight: number) => 163 - weight * 120;
  const measureCurve = (theta: number) => [plotX(theta), plotY(Math.abs(Math.sin(theta)))];
  const weightedCurve = (theta: number) => [plotX(theta), plotY(contributionWeight(theta, g, length))];
  const area = (curve: (theta: number) => number[]) => coordinates([[plotX(low), plotY(0)], ...points(low, high, curve), [plotX(high), plotY(0)]]);
  const retained = exact / (measure * length);

  return <section className="contribution-experiment" aria-label="固定可见角域的余弦贡献实验">
    <header className="contribution-heading">
      <span className="eyebrow">实验 03 / 可见范围相同，贡献会相同吗？</span>
      <h3>开口不动，只转动法线</h3>
      <p>先比较前两个预设：橙色可见角域完全相同，朝向开口的法线却能接收更多贡献。</p>
      <div className="contribution-presets" aria-label="推荐观察顺序">
        {CONTRIBUTION_PRESETS.map(preset => <button key={preset.label} type="button" aria-pressed={gamma === preset.gamma && length === preset.length} onClick={() => {setGamma(preset.gamma); setLength(preset.length);}}>{preset.label}</button>)}
      </div>
    </header>

    <div className="contribution-body">
      <div className="contribution-visuals">
        <figure>
          <svg viewBox="0 0 420 328" role="img" aria-label={`固定可见区间负25度到80度。法线偏角${gamma}度，投影长度${length.toFixed(2)}。蓝色虚线表示法线朝向的半圆。`}>
            <circle cx={center[0]} cy={center[1]} r="111" fill="#f7f9fb" stroke="#d2dee5"/>
            <path d="M65 177H355 M210 307V30" stroke="#c2cfd7" strokeDasharray="4 5" fill="none"/>
            <polygon points={coordinates([center, ...points(low, high, t => point(t))])} fill="#e4ab5439" stroke="#c87927" strokeWidth="1.5"/>
            <polyline points={coordinates(points(g - Math.PI / 2, g + Math.PI / 2, t => point(t, 122)))} fill="none" stroke="#4d80bd" strokeDasharray="4 5" strokeWidth="2"/>
            {[low, high].map(t => <circle key={t} cx={point(t)[0]} cy={point(t)[1]} r="3" fill="#c87927"/>)}
            <line x1={center[0]} y1={center[1]} x2={normal[0]} y2={normal[1]} stroke="#245ab5" strokeWidth="3"/>
            <polygon points={coordinates(arrow)} fill="#245ab5"/>
            <circle cx={center[0]} cy={center[1]} r="4" fill="#152d3a"/>
            <text x="196" y="30" textAnchor="end">v</text>
            <text x="156" y="59" textAnchor="end">−25°</text>
            <text x="336" y="161">80°</text>
            <text x={normalLabel[0] + (gamma < 0 ? -7 : 7)} y={normalLabel[1] + 5} textAnchor={gamma < 0 ? 'end' : 'start'} className="contribution-normal-label">nφ</text>
            <text x="201" y="196" textAnchor="end">p</text>
            <text x="210" y="321" textAnchor="middle">同一切片 · θ 从观察方向 v 起算</text>
          </svg>
          <figcaption><span><i className="contribution-key visible"/>固定可见窗口 V = 1</span><span><i className="contribution-key normal"/>投影法线 nφ</span><span>蓝色虚线：余弦为正的半圆</span></figcaption>
        </figure>
        <figure className="contribution-curve">
          <div className="contribution-plot-title">把角度展开，看窗口内的曲线面积</div>
          <svg viewBox="0 0 440 220" role="img" aria-label="虚线为球面测度绝对值sinθ；蓝线再乘法线余弦与投影长度。仅固定可见窗口中的面积计入数值。">
            <rect x={plotX(low)} y="37" width={plotX(high) - plotX(low)} height="126" fill="#e4ab5412"/>
            {[0, .5, 1].map(value => <g key={value}><line x1="44" y1={plotY(value)} x2="396" y2={plotY(value)} stroke="#e2e9ed"/><text x="33" y={plotY(value) + 4} textAnchor="end">{value.toFixed(1)}</text></g>)}
            <polygon points={area(measureCurve)} fill="#e4ab544a"/>
            <polygon points={area(weightedCurve)} fill="#2a6bbb47"/>
            <polyline points={coordinates(points(-Math.PI / 2, Math.PI / 2, measureCurve))} fill="none" stroke="#9c774b" strokeDasharray="4 4" strokeWidth="1.8"/>
            <polyline points={coordinates(points(-Math.PI / 2, Math.PI / 2, weightedCurve))} fill="none" stroke="#245ab5" strokeWidth="2.3"/>
            {[low, high].map(t => <line key={t} x1={plotX(t)} y1="36" x2={plotX(t)} y2="168" stroke="#c87927" strokeDasharray="3 4"/>)}
            <text x={plotX(low)} y="25" textAnchor="middle">−25°</text><text x={plotX(high)} y="25" textAnchor="middle">80°</text>
            {[-90, 0, 90].map(angle => <text key={angle} x={plotX(angle * DEG)} y="186" textAnchor="middle">{angle}°</text>)}
            <text x="220" y="211" textAnchor="middle">θ · 只累计橙色窗口内的面积</text>
          </svg>
          <figcaption><span><i className="contribution-key measure"/>虚线：|sin θ|</span><span><i className="contribution-key normal"/>蓝线：ℓ max(0, cos(θ − γ)) |sin θ|</span></figcaption>
        </figure>
      </div>

      <div className="contribution-controls">
        <label>法线在切片内的偏角 γ <output>{gamma}°</output><input aria-label="贡献实验法线偏角" type="range" min="-75" max="75" step="1" value={gamma} onChange={event => setGamma(+event.target.value)}/></label>
        <label>法线投影长度 ℓ <output>{length.toFixed(2)}</output><input aria-label="贡献实验法线投影长度" type="range" min=".1" max="1" step=".05" value={length} onChange={event => setLength(+event.target.value)}/></label>
        <p className="contribution-fixed-domain">可见区间固定为 [−25°, 80°]，宽度 105°。拖动滑块不会改变它。</p>

        <dl className="contribution-readouts">
          <div className="contribution-measure"><dt>不加余弦的角域测度 Mφ <small>∫ V |sin θ| dθ · 始终不变</small></dt><dd>{measure.toFixed(6)}</dd></div>
          <div><dt>GTAO 解析加权贡献 Cφ <small>ℓ ∫ V max(0, cos(θ − γ)) |sin θ| dθ</small></dt><dd>{exact.toFixed(6)}</dd></div>
          <div><dt>独立数值加权贡献 Cφ <small>{CONTRIBUTION_STEPS.toLocaleString('en-US')} 个中点样本，直接累加权重</small></dt><dd>{numeric.toFixed(6)}</dd></div>
        </dl>
        <p className="contribution-error">解析与数值绝对差：<strong>{error.toExponential(2)}</strong></p>
        <p className="contribution-fixed-domain">Cφ 已包含投影长度 ℓ，但仍只是单切片贡献。完整 AO 可见度需要对全部切片求平均。</p>
        <div className="contribution-observation" role="status">
          <span className="eyebrow">当前观察</span>
          <p>同样的开口，余弦权重保留了 {(retained * 100).toFixed(1)}% 的角域测度{length < 1 ? `；投影长度再乘 ${length.toFixed(2)}` : ''}。{gamma < -35 ? '右侧开口大多偏离法线，部分方向的余弦已降到零。' : '靠近法线的可见方向权重更高，偏离法线的方向权重更低。'}</p>
        </div>
      </div>
    </div>

    <footer className="contribution-takeaway">
      <p><strong>GTAO 在这里的收益：</strong>可见边界给定后，直接解析积分带余弦的目标；独立数值积分在核对同一个目标。Mφ 是去掉余弦的教学对照，不是原始 HBAO 的输出。</p>
      <details>
        <summary>这些数值怎样变成完整 AO？</summary>
        <p>Cφ 只是一条切片的贡献，不是完整 AO，也不能随意截到 0–1。这里的 ℓ = ‖nφ‖ 是单位三维法线投影到该切片后的长度，蓝色箭头随它缩短。</p>
        <p>完整可见度还需对 φ ∈ [0, π) 的全部切片求平均：A = (1/π) ∫ Cφ dφ；等间隔采样时为所有 Cφ 的平均值。换切片时，γ 和 ℓ 都必须由同一个三维法线重新计算。无遮挡时，完整结果才归一化为 A = 1。</p>
        <p>这里已经把负余弦置零，等价于裁到法线半球。两种面积都含 |sin θ|，因此对比改变的是余弦权重，而不是把球面测度混同于角度宽度。</p>
      </details>
    </footer>
  </section>;
}
