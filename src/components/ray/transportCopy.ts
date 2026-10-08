import type {RayLesson} from '../../lib/ray/state';
export const rayTitles:Record<RayLesson,string>={rays:'从一个像素，追踪真实的相交过程。',bvh:'少检查一些图元，命中结果会变吗？',shadows:'从表面向灯面看，有多少光源仍可见？',reflections:'屏幕之外，镜子还看到了什么？',path:'同一像素的颜色，怎样由路径贡献组成？',mis:'同样的积分，怎样把样本用在有效方向？',denoise:'噪声减少以后，历史还代表当前表面吗？'};
export function comparisonLabels(lesson:RayLesson){return lesson==='shadows'?['中心光图','PCSS 教学','光追面积可见度','高样本参考']:lesson==='reflections'?['SSR','单次光追反射','镜像相机参考','绝对差 ×4']:lesson==='denoise'?['原始 B','时域 B','重建 B','高样本 B 参考']:['当前单样本','渐进累积','高样本参考','绝对差 ×4'];}
