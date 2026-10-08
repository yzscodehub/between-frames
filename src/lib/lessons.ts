import {defaultState,type LabState} from './state';
import {sceneCamera} from './scene';
export const lessons = [
 {id:'contact',number:'01',title:'接触与距离',question:'物体离开表面后，接触区域怎样变化？',action:'拖动「遮挡物抬升」，对照左侧球体与右侧薄板。',observe:'关注物体脚下，而不是物体自身的明暗。切换「无 AO」可以分离形状着色与环境遮挡。',scene:'contact',algorithm:'gtao',slices:4,steps:6,filter:true},
 {id:'noise',number:'02',title:'样本与噪声',question:'增加样本，能解决所有错误吗？',action:'先用 8 次采样观察测试台，再提高到 48 次。',observe:'台阶边缘的噪声会减轻，但薄板与窄槽的偏差未必消失。用算法对照固定住相机。',scene:'bench',algorithm:'ssao',slices:1,steps:4,filter:false},
 {id:'thin',number:'03',title:'薄板反例',question:'一个薄片，为什么会被当成一整片遮挡？',action:'进入固定基准，生成参考，再查看薄板下面的空隙。',observe:'地平线只记录边界，不能表示边界后又变得可见的方向。更多样本不能消除这一假设。',scene:'thin',algorithm:'hbao',slices:4,steps:8,filter:false},
 {id:'room',number:'04',title:'实际应用',question:'这些误差，在实际画面里意味着什么？',action:'对照书架、桌脚、坐垫和墙角。然后查看纯 AO。',observe:'大结构帮助定位，小接触处暴露差异。纯 AO 和同一套材质显示要一起观察，避免被颜色误导。',scene:'room',algorithm:'gtao',slices:6,steps:8,filter:true}
] as const;
export type LessonId = typeof lessons[number]['id'];
export function lessonState(id:LessonId):LabState {const l=lessons.find(x=>x.id===id)!;return {...defaultState(),scene:l.scene,algorithm:l.algorithm,slices:l.slices,steps:l.steps,filter:l.filter,camera:sceneCamera(l.scene)};}
export const algorithmDescriptions={
 ssao:{title:'SSAO · 候选点比较',idea:'在法线半球放置候选点，投影后用深度判断遮挡。',solves:'用屏幕深度代替逐方向几何求交。',limits:'采样噪声，以及“点在深度后面”的近似。'},
 hbao:{title:'HBAO 思路 · 地平线',idea:'沿方向寻找最高遮挡边界，再累计 sin h − sin t。',solves:'把逐点占据判断改成方向上的遮挡范围。',limits:'教学版采用硬半径；角域测度与余弦加权目标不同，也无法表达薄板下的空隙。'},
 gtao:{title:'GTAO · 加权积分',idea:'在视线切片中保留法线投影，解析计算余弦加权贡献。',solves:'让切片表达直接对应本文的 AO 积分目标。',limits:'输入仍是一层深度；厚度、出屏和隐藏几何仍然缺失。'}
};
