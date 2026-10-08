/** A 2D rectangular occluder; angles measured above a horizontal receiver. */
export interface Occluder {x:number;width:number;bottom:number;height:number}
export function horizonWalk(shape:Occluder,count=12,extent=3.4){
 let horizon=0;
 return Array.from({length:count},(_,i)=>{
  const x=(i+1)*extent/count;
  const y=x>=shape.x&&x<=shape.x+shape.width?shape.bottom+shape.height:0;
  const angle=Math.atan2(y,x),before=horizon;horizon=Math.max(horizon,angle);
  return {x,y,angle,before,horizon,updated:angle>before+1e-8};
 });
}
export function exactBlockedInterval(shape:Occluder){return {low:Math.atan2(shape.bottom,shape.x+shape.width),high:Math.atan2(shape.bottom+shape.height,shape.x)};}
