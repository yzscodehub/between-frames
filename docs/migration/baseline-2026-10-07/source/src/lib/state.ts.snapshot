export type SceneName = 'contact' | 'corner' | 'thin' | 'layers' | 'bench' | 'room';
export type Mode = 'explore' | 'inspect' | 'benchmark';
export type View = 'beauty' | 'ao' | 'raw' | 'depth' | 'normal' | 'reference' | 'difference' | 'compare' | 'none';
export type ChapterId='contact'|'ssao'|'horizon'|'gtao'|'limits';
export interface LearningContext {chapter:ChapterId;lesson:'contact'|'noise'|'thin'|'room'}
export interface LabState {
  version: 2; comparison: 'beauty' | 'ao'; scene: SceneName; mode: Mode; algorithm: 'gtao' | 'ssao' | 'hbao'; view: View;
  focus?: 'primary' | 'detail'; learning?: LearningContext;
  radius: number; slices: number; steps: number; filter: boolean; lift: number; seed: number;
  camera: { position: [number, number, number]; target: [number, number, number] };
}
export const defaultState = (): LabState => ({version: 2, comparison: 'beauty', scene: 'bench', mode: 'explore', algorithm: 'gtao', view: 'beauty', radius: 1.4, slices: 4, steps: 6, filter: true, lift: 0, seed: 17, camera: {position: [4.65, 4.2, 5.6], target: [0, .3, 0]}});
export const sceneLabels: Record<SceneName,string> = {contact:'接触与距离',corner:'墙角与台阶',thin:'悬空薄板',layers:'前景与背景',bench:'凹槽与台阶测试台',room:'室内阅读角'};
const finite = (x: unknown, min: number, max: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
export function decodeState(hash: string): {state: LabState; notice?: string} {
  if (!hash.startsWith('#state=')) return {state: defaultState()};
  try {
    if(hash.length > 4096) throw new Error();
    const s = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (s.version !== 2) return {state: defaultState(), notice:'此链接的实验版本无法恢复；场景已更新，已加载新版默认预设。'};
    s.comparison ??= 'beauty';
    if (!['beauty','ao'].includes(s.comparison)) throw new Error();
    if(s.focus!==undefined&&!['primary','detail'].includes(s.focus))throw new Error();
    if(s.learning!==undefined&&(!s.learning||!['contact','ssao','horizon','gtao','limits'].includes(s.learning.chapter)||!['contact','noise','thin','room'].includes(s.learning.lesson)))throw new Error();
    const vector = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(x => finite(x,-100,100));
    if (!Object.hasOwn(sceneLabels,s.scene) || !['explore','inspect','benchmark'].includes(s.mode) || !['gtao','ssao','hbao'].includes(s.algorithm) || !['beauty','ao','raw','depth','normal','reference','difference','compare','none'].includes(s.view) || !finite(s.radius,.3,3) || !Number.isInteger(s.slices) || !finite(s.slices,1,8) || !Number.isInteger(s.steps) || !finite(s.steps,2,12) || !finite(s.lift,0,2) || !Number.isInteger(s.seed) || !finite(s.seed,0,65535) || typeof s.filter !== 'boolean' || !vector(s.camera?.position) || !vector(s.camera?.target)) throw new Error();
    const distance = Math.hypot(...s.camera.position.map((v: number,i: number)=>v-s.camera.target[i]));
    if(distance < .2 || distance > 50) throw new Error();
    // A selected surface is a transient resource: shared inspection resumes as exploration.
    if(s.mode === 'inspect') s.mode = 'explore';
    if(s.mode !== 'benchmark' && ['reference','difference'].includes(s.view)) s.view='ao';
    return {state:s};
  } catch {return {state:defaultState(),notice:'实验链接不完整或参数无效，已恢复默认预设。'};}
}
export const encodeState = (s: LabState) => '#state=' + encodeURIComponent(JSON.stringify(s));
export function invalidateBenchmark(s: LabState): LabState {
  return {...s, mode:'explore', view:['reference','difference'].includes(s.view)?'ao':s.view};
}
