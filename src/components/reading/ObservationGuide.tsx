import './reading.css';
export default function ObservationGuide({focus,action,evidence,caution}:{focus:string;action:string;evidence:string;caution:string}){
 return <aside className="observation-guide" aria-label="观察助手"><div><span>01 · 看哪里</span><p>{focus}</p></div><div><span>02 · 只改什么</span><p>{action}</p></div><details><summary>03 · 预测后，查看判断依据</summary><p>{evidence}</p><p className="observation-caution">边界：{caution}</p></details></aside>;
}
