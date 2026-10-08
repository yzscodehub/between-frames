import ObservationGuide from '../reading/ObservationGuide';
import {rayPredictions,rayBoundaries} from '../reading/guides';
import {useId,useState} from 'react';
import {defaultRayState,type RayLesson,type RayState} from '../../lib/ray/state';

export interface GuidedTasksProps {
 lesson:RayLesson;
 disabled?:boolean;
 onLoad:(patch:Partial<RayState>,task:number)=>void;
}
interface GuidedTask {
 label:string;
 question:string;
 operation:string;
 evidence:string;
 setup:string;
 patch:Partial<RayState>;
}

const tasks:Record<RayLesson,readonly [GuidedTask,GuidedTask,GuidedTask]>={
 rays:[
  {
   label:'一条射线',question:'GPU 与独立 CPU 是否找到同一个表面？',
   operation:'点击三角形内部的一个像素，再点背景；先避开轮廓和共有边。',
   evidence:'比较 hit/miss、GPU 与 CPU 的 t、稳定图元 ID；命中才有可比较的距离。',
   setup:'三角形与解析球 · 最近命中 · tMin 0.0001，tMax 50。',
   patch:{preset:'triangle',query:'closest',origin:'camera',camera:{position:[.4,1.2,5],target:[.35,1,.25]}},
  },
  {
   label:'重心与区间',question:'表面移走，或射线提前结束，命中会怎样变化？',
   operation:'只把三角形平移从 −0.6 调到 0.6，每次重选同一屏幕像素；再收短 tMax，观察交点何时被排除。',
   evidence:'核对 GPU/CPU 三个重心权重及其和是否约为 1，再比较图元 ID、t 与 hit/miss。',
   setup:'三角形从 −0.6 起步 · 固定相机 · 最近命中。',
   patch:{preset:'triangle',variant:-.6,query:'closest',camera:{position:[.4,1.2,5],target:[.35,1,.25]}},
  },
  {
   label:'表面偏移',question:'从命中位置再次出发，会不会立刻撞回自身？',
   operation:'保持 tMin=0，在有表面的像素检查二次查询；把表面偏移倍率从 0 改到 1，再比较。',
   evidence:'看实际 origin 是否移动，以及是否出现近零 t；没有自相交的像素不必强行产生变化。',
   setup:'表面起点模式 · tMin 0 · 偏移倍率 0。',
   patch:{preset:'triangle',origin:'surface',tMin:0,offsetScale:0,camera:{position:[.4,1.2,5],target:[.35,1,.25]}},
  },
 ],
 bvh:[
  {
   label:'核对单射线',question:'少做图元测试后，最近命中还相同吗？',
   operation:'在散布场景选一个命中像素，切换暴力与 BVH；保持相机、数量与有效区间不变。',
   evidence:'先核对 t 与 ID，再读节点访问和图元测试数；二者不是 GPU 毫秒。',
   setup:'均匀散布 · 512 图元 · median · 暴力/BVH 并排。',
   patch:{preset:'scatter',count:512,builder:'median',query:'closest',compare:true},
  },
  {
   label:'改变分布',question:'簇状几何会让 median 与 SAH 做不同的工作吗？',
   operation:'记住一个像素位置，依次比较 median 与 sah（每次重建后重新点击同一屏幕位置）；再选穿过簇间空隙的像素重复。',
   evidence:'核对命中一致，比较树深度、节点访问与图元测试数；一次减少不代表处处更快。',
   setup:'簇状分布 · 512 图元 · SAH 起步 · 查询成本视图。',
   patch:{preset:'clusters',count:512,builder:'sah',view:3,compare:true},
  },
  {
   label:'增加规模',question:'很多包围盒重叠时，树还能排除多少几何？',
   operation:'保持重叠分布，按 128、512、2048 改变图元预算；每档重新检查相同屏幕位置。',
   evidence:'记录当前档的实际图元数、节点和图元测试数；不同数量是不同工作负载。',
   setup:'重叠包围盒 · 128 图元起步 · 160 × 100 · 并排成本视图。',
   patch:{preset:'overlap',count:128,builder:'median',view:3,compare:true,quality:'low'},
  },
 ],
 shadows:[
  {label:'半影宽度',question:'半影为什么有宽度？',operation:'保持相机与遮挡板高度，在相同 64 spp 下把灯尺寸从 0.3 调到 1.2。',evidence:'比较阴影核心与过渡宽度；改变灯尺寸改变了问题，不只是减小噪声。',setup:'灯尺寸 0.3 · 64 spp · 遮挡板高度 1.18 · 160 × 100。',patch:{targetSpp:64,batch:1,lightSize:.3,variant:.65,quality:'low'}},
  {label:'增加样本',question:'变平滑的是随机颗粒，还是半影？',operation:'固定灯尺寸与遮挡板，把目标样本从 1 提高到 16、64、256；冻结条件生成参考。',evidence:'区分噪声与部分可见比例。对照中的三个方法使用相同场景和相机。',setup:'灯尺寸 1 · 1 spp 起步 · 四格对照 · 160 × 100。',patch:{compare:true,targetSpp:1,batch:1,lightSize:1,quality:'low'}},
  {label:'近似与偏移',question:'PCSS 与 RT 都柔和，为何还有差异？',operation:'先比较薄板附近的重叠阴影，再将表面偏移倍率依次设为 0、1、4；一次只改一个条件。',evidence:'看轮廓、实际阴影射线起点与终止原因；数值偏移过大可能漏掉近处遮挡。',setup:'遮挡板高度 0.4 · 偏移 1 · 64 spp · 160 × 100。',patch:{compare:true,targetSpp:64,batch:1,variant:0,offsetScale:1,quality:'low'}},
 ],
 reflections:[
  {
   label:'对照 SSR',question:'三种反射获取方式能否给出相同的镜中表面？',
   operation:'在地面镜内部比较 SSR、单次光追与镜像相机；先避开轮廓，看 RT 与镜像参考的差异图。',
   evidence:'只比较共用局部颜色模型下的反射；SSR 的环境回退不等于真实命中。',
   setup:'y=0 地面镜 · 自发光颜色 · 三种方法与差异图并排。',
   patch:{compare:true,targetSpp:1,environment:0,quality:'low'},
  },
  {
   label:'物体出屏',question:'主相机看不见物体时，反射光线还可能碰到它吗？',
   operation:'从这个侧视角缓慢拖动相机，让物体接近画面边缘；每次用当前镜像参考核对镜中结果。',
   evidence:'观察 SSR 与完整几何反射在哪里分离；相机转动也改变反射方向，不能只凭物体出屏下结论。',
   setup:'侧视地面镜 · 固定几何与帧号 · 确定性单次反射。',
   patch:{compare:true,targetSpp:1,environment:0,quality:'low',camera:{position:[4.5,2.5,7.5],target:[0,0,.5]}},
  },
  {
   label:'检查两段路径',question:'镜面像素的颜色具体来自第二条光线的哪个命中？',
   operation:'点击“检查中心路径”，逐事件查看主命中与反射命中；必要时改选地面镜内部像素。',
   evidence:'核对两段 origin、direction、图元 ID 与 β；这只是一次反射，不会自动继续反射。',
   setup:'相机朝向地面镜 · 局部光照模型 · 不做随机累积。',
   patch:{view:0,compare:true,targetSpp:1,environment:0,camera:{position:[0,2.3,8.8],target:[0,0,1]},quality:'low'},
  },
 ],
 path:[
  {
   label:'增加一次散射',question:'允许第二次散射后，哪些间接路径才有机会贡献？',
   operation:'固定条件，在 1 次与 2 次最大散射之间比较同样的 64 spp；两次都关闭 RR。',
   evidence:'看同一接收区与逐事件贡献；改变散射上限会改变目标，增加 spp 只改变估计质量。',
   setup:'Lambert 房间 · BSDF-only / cosine · 1 次散射 · 64 spp。',
   patch:{maxScattering:1,targetSpp:64,batch:1,estimator:'bsdf',sampling:'cosine',environment:0,rr:false,quality:'low'},
  },
  {
   label:'观察累积',question:'偶然出现的亮样本，怎样进入逐渐稳定的平均？',
   operation:'冻结相机与帧号，将目标样本数从 16 增至 64、256；需要时生成同状态的高样本参考。',
   evidence:'比较当前单样本、累积和实际 spp；参考误差不保证随每一个新样本单调下降。',
   setup:'2 次散射 · 16 spp 起步 · 每次增加 1 条路径 · 并排。',
   patch:{maxScattering:2,targetSpp:16,batch:1,compare:true,estimator:'bsdf',environment:0,quality:'low'},
  },
  {
   label:'RR 与终止',question:'随机提前结束路径后，存活权重怎样补偿？',
   operation:'在 8 次散射下切换 RR，保持相同 spp；检查不同样本，寻找 RR 终止和存活后的 β。',
   evidence:'区分 RR 终止、散射上限和未命中；比较路径记录及参考，不要求低样本图逐像素相同。',
   setup:'8 次最大散射 · RR 开启 · 64 spp · 160 × 100。',
   patch:{maxScattering:8,rr:true,targetSpp:64,batch:1,estimator:'bsdf',environment:0,quality:'low'},
  },
 ],
 mis:[
  {label:'方向分布',question:'余弦分布改变了亮度，还是改变了方差？',operation:'保持 BSDF-only 与同一有限散射目标，在漫反射区域比较 uniform 和 cosine。',evidence:'看线性均值、噪声以及 f × cos / pdf；等样本并不保证一次序列误差单调下降。',setup:'黑环境 · BSDF-only / uniform · 2 次散射 · 64 spp。',patch:{estimator:'bsdf',sampling:'uniform',maxScattering:2,targetSpp:64,environment:0,quality:'low'}},
  {label:'小灯面',question:'一个很小的灯面，值得专门取样吗？',operation:'固定灯面 0.3 倍，分别选择 BSDF-only 与 NEE；再放大灯面重复。',evidence:'比较同 spp 的噪声和选中样本的实际阴影查询数；显式采灯也会增加工作量。',setup:'灯尺寸 0.3 · BSDF-only 起步 · 64 spp · 160 × 100。',patch:{lightSize:.3,estimator:'bsdf',sampling:'cosine',targetSpp:64,environment:0,quality:'low'}},
  {label:'GGX 与权重',question:'MIS 在哪里改善估计，哪里未必占优？',operation:'选右侧 GGX 球，在两个粗糙度下切换 BSDF-only、NEE、MIS；检查所选路径的两种 PDF 与权重。',evidence:'所有竞争 PDF 都是立体角密度；粗糙度会改变目标，策略比较必须固定粗糙度。',setup:'GGX 粗糙度 0.15 · MIS · 64 spp · 160 × 100。',patch:{estimator:'mis',sampling:'cosine',roughness:.15,targetSpp:64,environment:0,quality:'low'}},
 ],
 denoise:[
  {
   label:'先看静态 B',question:'原始噪声属于间接光 B，还是已经乘了表面颜色？',
   operation:'保持第 0 帧，比较每帧 1、4、16 条路径；生成这个固定帧的 B 参考后再读误差。',
   evidence:'比较 raw B 与 B 参考；不要拿 B 和直接光、最终合成互相作差。',
   setup:'第 0 帧 · 1 spp/帧 · 历史关闭 · 空间滤波关闭 · raw B。',
   patch:{frame:0,batch:1,history:false,spatial:false,view:1,compare:false,estimator:'mis',environment:0,quality:'low'},
  },
  {
   label:'运动与显露',question:'物体移开之后，新露出的表面应该接收谁的历史？',
   operation:'从第 0 帧播放刚体序列，观察历史拒绝视图；暂停后切换 raw/history，并生成当前帧参考。',
   evidence:'看运动轮廓后的拒绝区域和局部残留；拒绝后重新出现噪声可能是合理代价。',
   setup:'刚体运动 · 1 spp/帧 · 历史开启 · 空间滤波关闭 · 拒绝视图。',
   patch:{frame:0,motion:'object',batch:1,history:true,spatial:false,view:5,compare:false,estimator:'mis',environment:0,quality:'low'},
  },
  {
   label:'历史与空间',question:'颗粒减少的同时，细小间接光变化是否也被平滑？',
   operation:'先播放再停在同一帧，比较历史与空间滤波开关；交替看 raw、history、filtered 和同帧参考。',
   evidence:'同时检查墙面噪声和几何交界细节；最终合成的材质纹理不等于 B 中保留了细节。',
   setup:'1 spp/帧 · 历史与三遍空间滤波开启 · 四幅 B 视图并排。',
   patch:{frame:0,batch:1,history:true,spatial:true,view:3,compare:true,estimator:'mis',environment:0,quality:'low'},
  },
 ],
};

export default function GuidedTasks({lesson,onLoad,disabled=false}:GuidedTasksProps){
 const id=useId();
 const [selection,setSelection]=useState({lesson,task:0,loaded:false});
 const selected=selection.lesson===lesson?selection.task:0;
 const task=tasks[lesson][selected];
 const loaded=selection.lesson===lesson&&selection.loaded;
 function load(index:number){
  const next=structuredClone({...defaultRayState(lesson),...tasks[lesson][index].patch});
  setSelection({lesson,task:index,loaded:true});
  onLoad(next,index);
 }
 return <section className="ray-guided" aria-label="本节三个引导实验">
  <div className="small-tabs" role="group" aria-label="选择实验任务">
   {tasks[lesson].map((item,index)=><button type="button" disabled={disabled} key={item.label} aria-pressed={selected===index} aria-controls={id} onClick={()=>load(index)}>{index+1} · {item.label}</button>)}
  </div>
  <div id={id} aria-live="polite" aria-atomic="true">
   <p><strong>问题：</strong>{task.question}</p>
   <ObservationGuide key={lesson+selected} focus={task.evidence} action={task.operation} evidence={rayPredictions[lesson][selected]} caution={rayBoundaries[lesson]}/>
   <p className="fine">{loaded?'任务起点：':'点击任务按钮载入起点：'}{task.setup} 展开参数后，只改变当前任务指定的变量。</p>
  </div>
 </section>;
}
