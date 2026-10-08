import {defaultRayState,encodeRayState,type RayLesson} from '../ray/state';
import {shadowLabHref} from '../shadow/state';
export const topics=[
 {id:'visibility',number:'01',name:'可见性与阴影',english:'VISIBILITY & SHADOWS',question:'光，能到达这个表面吗？',description:'从屏幕深度、光源视角到完整几何，认识不同可见性近似的能力与边界。',color:'#487668',future:['VSM / EVSM'],status:'open'},
 {id:'materials',number:'02',name:'材质与光照',english:'MATERIALS & LIGHTING',question:'到达表面的光，会去哪里？',description:'把材质参数还原成方向、分布和能量，再理解它们怎样形成画面。',color:'#a16c42',future:['Tiled / Clustered Lighting','全局光照'],status:'open'},
 {id:'transport',number:'03',name:'反射与光输运',english:'REFLECTIONS & TRANSPORT',question:'画面之外，还有哪些光路？',description:'追踪反射与间接光，区分表示中缺失的信息和计算中的近似。',color:'#566b98',future:['复杂反射','更完整的光传输'],status:'open'},
 {id:'reconstruction',number:'04',name:'采样与重建',english:'SAMPLING & RECONSTRUCTION',question:'有限的样本，怎样成为稳定的图像？',description:'从选择样本到利用历史，理解噪声、偏差、拖影与细节之间的取舍。',color:'#8b617e',future:['超分辨率','更多重建策略'],status:'open'},
 {id:'geometry',number:'05',name:'几何与调度',english:'GEOMETRY & SCHEDULING',question:'怎样更少计算，仍找到正确结果？',description:'从一条射线和一个包围盒出发，逐步走向空间查询与 GPU 工作组织。',color:'#647c8c',future:['Hi-Z','GPU Driven','LOD / Visibility Buffer'],status:'open'},
 {id:'media',number:'06',name:'介质与合成',english:'MEDIA & COMPOSITING',question:'光穿过空气与透明表面时，会怎样？',description:'从线性颜色与透明覆盖出发，理解合成顺序、加权近似及其边界。',color:'#879184',future:['体积雾与大气','水面'],status:'open'},
] as const;
export type TopicId=typeof topics[number]['id'];
export interface Article {id:string;code:string;title:string;shortTitle:string;description:string;topic:TopicId;level:'入门'|'进阶';knowledge:string;prerequisiteReading:string[];tags:string[];labId:string;rayLesson?:RayLesson;status:'available'}
const entry=(data:Omit<Article,'status'>):Article=>({...data,status:'available'});
export const articles:readonly Article[]=[
 entry({id:'gtao',code:'AO-01',title:'从 SSAO 到 GTAO：屏幕里的深度，能告诉我们多少遮挡？',shortTitle:'从 SSAO 到 GTAO',description:'从接触暗部走向样本、地平线与切片积分，看清屏幕空间遗漏了什么。',topic:'visibility',level:'进阶',knowledge:'向量点积与基础 Shader',prerequisiteReading:['depth','spaces'],tags:['屏幕空间','环境遮挡','积分'],labId:'ao'}),
 entry({id:'shadow-mapping',code:'SH-01',title:'阴影贴图：从光源看一遍，为什么还会漏影与长痘？',shortTitle:'阴影贴图',description:'检查真实光图中的投影、覆盖、深度比较与偏移。',topic:'visibility',level:'入门',knowledge:'矩阵变换与透视投影',prerequisiteReading:['depth','spaces'],tags:['光栅化','深度','直接阴影'],labId:'shadows'}),
 entry({id:'pcf-pcss',code:'SH-02',title:'从 PCF 到 PCSS：变软的边缘，什么时候才像半影？',shortTitle:'从 PCF 到 PCSS',description:'从可见性过滤走向遮挡距离、半影半径和单点几何参考。',topic:'visibility',level:'进阶',knowledge:'光源空间深度比较',prerequisiteReading:['shadow-mapping'],tags:['过滤','软阴影'],labId:'shadows'}),
 entry({id:'csm',code:'SH-03',title:'CSM：有限的阴影纹素，应该分给谁？',shortTitle:'级联阴影 · CSM',description:'四级真实深度图、重叠区间与稳定投影，检查资源分配和接缝。',topic:'visibility',level:'进阶',knowledge:'光源深度比较与投影',prerequisiteReading:['shadow-mapping','pcf-pcss'],tags:['阴影','级联','WebGPU'],labId:'csm'}),
 entry({id:'ray-shadows',code:'RT03',title:'光追阴影',shortTitle:'光追阴影',description:'把查询限制在接收点和灯面之间，对照面积可见率与深度图近似。',topic:'visibility',level:'进阶',knowledge:'射线求交与阴影深度比较',prerequisiteReading:['ray-intersections','shadow-mapping','pcf-pcss'],tags:['光线追踪','面积光源'],labId:'ray-effects',rayLesson:'shadows'}),
 entry({id:'pbr',code:'MA-01',title:'PBR：粗糙度、金属度与一束光的去向',shortTitle:'PBR：材质与 BRDF',description:'拆开 D、F、G，检查材质参数、反射瓣与半球积分。',topic:'materials',level:'入门',knowledge:'向量、基础光照与线性颜色',prerequisiteReading:['spaces','color'],tags:['BRDF','GGX','材质'],labId:'materials'}),
 entry({id:'ibl',code:'MA-02',title:'IBL：整个环境，怎样照亮一个表面？',shortTitle:'环境光照与预滤波 · IBL',description:'从方向积分走到预滤波近似，用独立 CPU 半球参考拆分误差。',topic:'materials',level:'进阶',knowledge:'BRDF、线性颜色与方向采样',prerequisiteReading:['pbr','color'],tags:['环境光照','预滤波','积分'],labId:'ibl'}),
 entry({id:'ssr',code:'RF-01',title:'SSR：沿屏幕追踪的反射，会在哪里失去线索？',shortTitle:'屏幕空间反射 · SSR',description:'跟随实际投影射线，区分步进误差与屏幕缺失的信息。',topic:'transport',level:'进阶',knowledge:'深度重建与反射方向',prerequisiteReading:['depth','pbr'],tags:['屏幕空间','反射'],labId:'ssr'}),
 entry({id:'ray-reflections',code:'RT04',title:'光追反射',shortTitle:'光追反射',description:'从主命中发出镜面射线，用同场景的镜像相机核对结果。',topic:'transport',level:'进阶',knowledge:'射线求交与镜面反射方向',prerequisiteReading:['ray-intersections','ssr'],tags:['光线追踪','反射'],labId:'ray-effects',rayLesson:'reflections'}),
 entry({id:'path-tracing',code:'RT05',title:'最小路径追踪',shortTitle:'最小路径追踪',description:'让一次相交连接成光路，逐跳核对 PDF、吞吐量与终止。',topic:'transport',level:'进阶',knowledge:'求交、Lambert 反射与概率密度',prerequisiteReading:['ray-intersections','pbr'],tags:['光线追踪','间接光'],labId:'path-tracing',rayLesson:'path'}),
 entry({id:'ray-mis',code:'RT06',title:'采样与 MIS',shortTitle:'采样与 MIS',description:'比较不同分布与显式采灯，用一致的 PDF 组合估计。',topic:'reconstruction',level:'进阶',knowledge:'有限路径积分与 PDF',prerequisiteReading:['path-tracing','pbr'],tags:['光线追踪','蒙特卡洛','采样'],labId:'path-tracing',rayLesson:'mis'}),
 entry({id:'taa',code:'RE-01',title:'TAA：把过去的像素带回来，为什么还会闪烁与拖影？',shortTitle:'时域抗锯齿 · TAA',description:'从亚像素抖动走到重投影、历史验证与颜色约束。',topic:'reconstruction',level:'进阶',knowledge:'投影、采样与线性颜色',prerequisiteReading:['depth','spaces'],tags:['时域','抗锯齿'],labId:'taa'}),
 entry({id:'ray-denoising',code:'RT07',title:'低样本间接光重建',shortTitle:'低样本间接光重建',description:'过滤去反照率的间接光，同时检查噪声、拖影与细节损失。',topic:'reconstruction',level:'进阶',knowledge:'路径采样与时域重投影',prerequisiteReading:['path-tracing','ray-mis','taa'],tags:['光线追踪','时域','降噪'],labId:'path-tracing',rayLesson:'denoise'}),
 entry({id:'ray-intersections',code:'RT01',title:'光线与求交',shortTitle:'光线与求交',description:'从一个像素发出光线，逐项核对命中位置、距离与法线。',topic:'geometry',level:'入门',knowledge:'向量、点积与叉积',prerequisiteReading:['spaces'],tags:['光线追踪','空间查询'],labId:'rays',rayLesson:'rays'}),
 entry({id:'ray-bvh',code:'RT02',title:'BVH：少测几何，保持同样命中',shortTitle:'BVH：少测几何，保持同样命中',description:'从暴力查询走向包围盒层级，检查剪枝后的命中与工作量。',topic:'geometry',level:'进阶',knowledge:'射线与基础求交',prerequisiteReading:['ray-intersections'],tags:['光线追踪','加速结构'],labId:'rays',rayLesson:'bvh'}),
 entry({id:'transparency',code:'CO-01',title:'透明与 WBOIT：顺序稳定，就代表颜色正确吗？',shortTitle:'透明排序与 WBOIT',description:'交叉平面、逐像素排序参考与双遍加权混合，保留高 alpha 反例。',topic:'media',level:'入门',knowledge:'线性颜色、alpha 与深度',prerequisiteReading:['color','depth'],tags:['透明','合成','近似'],labId:'transparency'}),
 entry({id:'hdr',code:'CO-02',title:'HDR 合成：保存光量以后，画面经历了什么？',shortTitle:'HDR、Bloom 与显示',description:'真实线性缓冲、亮区滤波与顺序反例，逐点核对显示前后的信号。',topic:'media',level:'进阶',knowledge:'线性颜色与显示映射',prerequisiteReading:['color','pbr'],tags:['HDR','Bloom','合成'],labId:'hdr'}),
];
export const foundations=[
 {id:'depth',title:'深度缓冲存了什么？',description:'投影深度、透视除法与位置重建。',href:'/foundations/depth/',number:'01'},
 {id:'spaces',title:'法线属于哪个空间？',description:'把位置、方向和法线放在同一个参考系。',href:'/foundations/spaces/',number:'02'},
 {id:'color',title:'线性颜色、HDR 与曝光',description:'黑白中点、线性混合、预乘 alpha 与显示映射。',href:'/foundations/color/',number:'03'},
];
export const labs=[
 {id:'ao',name:'环境遮挡实验室',href:'/lab/',description:'SSAO、地平线与 GTAO 切片积分；完整几何参考。',articles:['gtao']},
 {id:'shadows',name:'阴影实验室',href:'/labs/shadows/',description:'真实光图、PCF / PCSS、逐纹素比较与单点面积参考。',articles:['shadow-mapping','pcf-pcss']},
 {id:'materials',name:'材质实验室',href:'/labs/materials/',description:'粗糙度、金属度、D / F / G 与独立半球积分。',articles:['pbr']},
 {id:'ssr',name:'屏幕反射实验室',href:'/labs/ssr/',description:'两种步进、真实深度交叉与完整几何对照。',articles:['ssr']},
 {id:'taa',name:'时域抗锯齿实验室',href:'/labs/taa/',description:'抖动、历史验证、确定性回放与同帧参考。',articles:['taa']},
 {id:'rays',name:'求交与 BVH 实验室',href:'/labs/rays/',description:'实际 GPU 查询日志与独立 CPU 命中核对。',articles:['ray-intersections','ray-bvh']},
 {id:'ray-effects',name:'光追效果实验室',href:'/labs/ray-effects/',description:'灯面可见率、单次镜面与屏幕近似的差别。',articles:['ray-shadows','ray-reflections']},
 {id:'path-tracing',name:'光输运实验室',href:'/labs/path-tracing/',description:'路径贡献、采样权重与低样本间接光重建。',articles:['path-tracing','ray-mis','ray-denoising']},
 {id:'ibl',name:'环境光照实验室',href:'/labs/ibl/',description:'GPU 方向积分、预滤波图集与独立 CPU 半球参考。',articles:['ibl']},
 {id:'transparency',name:'透明合成实验室',href:'/labs/transparency/',description:'交叉平面、精确排序参考与双遍 WBOIT 累积。',articles:['transparency']},
 {id:'csm',name:'级联阴影实验室',href:'/labs/csm/',description:'四张方向光深度图、稳定投影与实际 GPU 级联检查。',articles:['csm']},
 {id:'hdr',name:'HDR 合成实验室',href:'/labs/hdr/',description:'亮区、Bloom、线性合成与非线性顺序反例。',articles:['hdr']},
];
export const learningPaths=[
 {id:'first-frame',number:'01',name:'从第一帧开始',description:'先补齐坐标与深度，从直接阴影与材质入门，再选择 AO、反射和重建方向。',audience:'已有基础编程经验，第一次系统阅读实时渲染。',steps:['spaces','depth','shadow-mapping','pbr','gtao','ssr','taa']},
 {id:'shadows',number:'02',name:'阴影为什么这样变化',description:'从一张深度图走向软阴影，再用几何查询检查近似。',audience:'想理解锯齿、偏移、半影和信息缺失。',steps:['shadow-mapping','pcf-pcss','csm','ray-shadows']},
 {id:'reflections',number:'03',name:'镜子里的世界从哪里来',description:'从材质响应，经屏幕反射，走向完整几何的第二次命中。',audience:'已了解深度与法线，关注反射实现。',steps:['pbr','ssr','ray-reflections']},
 {id:'ray-tracing',number:'04',name:'一步步走进光线追踪',description:'保留原光追系列的连续阅读体验，横跨几何、阴影、光输运和重建。',audience:'想从求交实现走到最小路径追踪与低样本重建。',steps:['ray-intersections','ray-bvh','ray-shadows','ray-reflections','path-tracing','ray-mis','ray-denoising']},
 {id:'reconstruction',number:'05',name:'如何相信过去的样本',description:'从抗锯齿的历史验证，走向间接光信号的时域与空间重建。',audience:'已有采样基础；间接光部分可先补路径追踪与 MIS。',steps:['taa','ray-denoising']},
 {id:'lighting-compositing',number:'06',name:'从线性光量到最终颜色',description:'连接颜色编码、材质响应、环境光照与透明合成。',audience:'理解基础 Shader，想分清光照计算与最终显示。',steps:['color','pbr','ibl','transparency','hdr']},
];
export function getArticle(id:string){const a=articles.find(a=>a.id===id);if(!a)throw Error('Unknown article: '+id);return a;}
export function getTopic(id:string){const t=topics.find(t=>t.id===id);if(!t)throw Error('Unknown topic: '+id);return t;}
export const articleHref=(a:Article|string)=>'/articles/'+(typeof a==='string'?a:a.id)+'/';
export const topicHref=(id:TopicId)=>'/topics/'+id+'/';
export function resource(id:string){const f=foundations.find(f=>f.id===id);if(f)return {...f,kind:'基础说明'};const a=getArticle(id);return {id:a.id,title:a.shortTitle,description:a.description,href:articleHref(a),kind:getTopic(a.topic).name};}
export const topicArticles=(id:TopicId)=>articles.filter(a=>a.topic===id);
export const articlePaths=(id:string)=>learningPaths.filter(p=>p.steps.includes(id));
export function articleLabHref(a:Article|string){const item=typeof a==='string'?getArticle(a):a;
 if(item.rayLesson){const s={...defaultRayState(item.rayLesson),learning:{article:item.id,chapter:'lab'}};return (labs.find(l=>l.id===item.labId)!.href)+encodeRayState(s);}
 if(item.id==='shadow-mapping'||item.id==='pcf-pcss')return shadowLabHref(item.id==='shadow-mapping'?'mapping':'filtering',{learning:{article:item.id,chapter:'lab'}});
 return labs.find(l=>l.id===item.labId)!.href;
}
