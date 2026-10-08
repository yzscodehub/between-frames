import type {SceneName} from './state';
export type FocusId='primary'|'detail';
export interface FocusPoint {label:string;position:[number,number,number];hint:string}
const points:Record<SceneName,Record<FocusId,FocusPoint>>={
 contact:{primary:{label:'球体接触',position:[-.75,0,.83],hint:'抬升前后比较球体脚下的可见度。'},detail:{label:'薄板前沿',position:[.85,0,1.23],hint:'观察有限厚度薄板附近的遮挡范围。'}},
 bench:{primary:{label:'球体与台座',position:[-.9,.2,1.3],hint:'在同一个局部区域比较采样噪声。'},detail:{label:'窄槽内壁',position:[.86,.65,-.5],hint:'看细小间隙是否被过度遮挡或滤波抹平。'}},
 thin:{primary:{label:'板下空隙',position:[0,0,.8],hint:'对照完整几何，检查地平线丢失的可见空隙。'},detail:{label:'立柱接触',position:[-1.32,0,.8],hint:'区分真实接触遮挡与薄板造成的扩大遮挡。'}},
 corner:{primary:{label:'台阶前沿',position:[-.85,0,.05],hint:'比较台阶附近的接触与噪声。'},detail:{label:'墙角接缝',position:[-1.65,.75,-1.44],hint:'观察多个方向同时被遮挡时的变化。'}},
 layers:{primary:{label:'前景柱脚',position:[.6,0,1.36],hint:'移动相机观察第一层深度带来的变化。'},detail:{label:'背景墙面',position:[-1.5,.9,-1.65],hint:'对照前景周围可能出现的错误遮挡。'}},
 room:{primary:{label:'桌脚接触',position:[1.06,0,.91],hint:'比较细桌脚周围的局部遮挡。'},detail:{label:'层板下方',position:[1.2,.45,-1.77],hint:'观察薄层板投向墙面的遮挡范围。'}}
};
export function focusPoint(scene:SceneName,id:FocusId='primary'){return points[scene][id];}
