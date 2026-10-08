import type {Bounds, BVH, BVHNode, Primitive, QueryResult, Ray} from './types';
import {RAY_LIMITS} from './types';
import {finiteVector,intersectBounds,intersectPrimitive,nearerHit,primitiveBounds,tieTolerance,validRay} from './geometry';

const LEAF_SIZE=4,BINS=12;
const emptyBounds=():Bounds=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]});
function include(a:Bounds,b:Bounds):Bounds {for(let k=0;k<3;k++){a.min[k]=Math.min(a.min[k],b.min[k]);a.max[k]=Math.max(a.max[k],b.max[k]);}return a;}
const area=(a:Bounds)=>{const x=Math.max(0,a.max[0]-a.min[0]),y=Math.max(0,a.max[1]-a.min[1]),z=Math.max(0,a.max[2]-a.min[2]);return 2*(x*y+y*z+z*x);};
const center=(p:Primitive,axis:number)=>p.kind==='sphere'?p.a[axis]:(p.a[axis]+p.b[axis]+p.c[axis])/3;
function boundsOf(items:Primitive[]):Bounds {return items.reduce((b,p)=>include(b,primitiveBounds(p)),emptyBounds());}
function centerBounds(items:Primitive[]):Bounds {const b=emptyBounds();for(const p of items)for(let k=0;k<3;k++){const c=center(p,k);b.min[k]=Math.min(b.min[k],c);b.max[k]=Math.max(b.max[k],c);}return b;}
function median(items:Primitive[],bounds:Bounds):[Primitive[],Primitive[]] {
 let axis=0;for(let k=1;k<3;k++)if(bounds.max[k]-bounds.min[k]>bounds.max[axis]-bounds.min[axis])axis=k;
 const sorted=[...items].sort((a,b)=>center(a,axis)-center(b,axis)||a.id-b.id),middle=Math.floor(sorted.length/2);
 return [sorted.slice(0,middle),sorted.slice(middle)];
}
function sah(items:Primitive[],bounds:Bounds):[Primitive[],Primitive[]]|null {
 let best=Infinity,bestAxis=-1,bestBin=-1;
 for(let axis=0;axis<3;axis++){
  const extent=bounds.max[axis]-bounds.min[axis];if(!(extent>1e-12*Math.max(1,Math.abs(bounds.min[axis]),Math.abs(bounds.max[axis]))))continue;
  const bins=Array.from({length:BINS},()=>({bounds:emptyBounds(),count:0}));
  const index=(p:Primitive)=>Math.min(BINS-1,Math.max(0,Math.floor((center(p,axis)-bounds.min[axis])/extent*BINS)));
  for(const p of items){const b=bins[index(p)];b.count++;include(b.bounds,primitiveBounds(p));}
  const leftCount:number[]=[],rightCount:number[]=[],leftArea:number[]=[],rightArea:number[]=[];
  let count=0,box=emptyBounds();for(let i=0;i<BINS;i++){count+=bins[i].count;if(bins[i].count)include(box,bins[i].bounds);leftCount[i]=count;leftArea[i]=count?area(box):0;}
  count=0;box=emptyBounds();for(let i=BINS-1;i>=0;i--){count+=bins[i].count;if(bins[i].count)include(box,bins[i].bounds);rightCount[i]=count;rightArea[i]=count?area(box):0;}
  for(let i=0;i<BINS-1;i++)if(leftCount[i]&&rightCount[i+1]){const cost=leftArea[i]*leftCount[i]+rightArea[i+1]*rightCount[i+1];if(cost<best){best=cost;bestAxis=axis;bestBin=i;}}
 }
 if(bestAxis<0)return null;
 const extent=bounds.max[bestAxis]-bounds.min[bestAxis],left:Primitive[]=[],right:Primitive[]=[];
 for(const p of items){const bin=Math.min(BINS-1,Math.max(0,Math.floor((center(p,bestAxis)-bounds.min[bestAxis])/extent*BINS)));(bin<=bestBin?left:right).push(p);}
 return left.length&&right.length?[left,right]:null;
}

/** 12-bin SAH and deterministic median use the same four-primitive leaf contract. */
export function buildBVH(primitives:Primitive[],method:'median'|'sah'='sah'):BVH {
 const start=performance.now();
 if(primitives.length>RAY_LIMITS.primitives)throw new RangeError(`Primitive budget is ${RAY_LIMITS.primitives}.`);
 const ids=new Set<number>();
 for(const p of primitives){
  if(!finiteVector(p.a)||!finiteVector(p.b)||!finiteVector(p.c)||!finiteVector(p.previousOffset)||!Number.isFinite(p.radius)||p.radius<0)throw new RangeError('Non-finite or negative geometry is not packable.');
  if(!Number.isInteger(p.id)||p.id<0||ids.has(p.id))throw new RangeError('Primitive IDs must be unique nonnegative integers.');ids.add(p.id);
 }
 const nodes:BVHNode[]=[],ordered:Primitive[]=[];let depth=0,fallback=false;
 function split(items:Primitive[],level:number):number {
  depth=Math.max(depth,level);const box=boundsOf(items),index=nodes.length;
  const node:BVHNode={...box,left:-1,right:-1,start:0,count:0};nodes.push(node);
  if(items.length<=LEAF_SIZE){node.start=ordered.length;node.count=items.length;ordered.push(...items);return index;}
  const centroids=centerBounds(items);let parts=method==='sah'?sah(items,centroids):null;
  // Leave enough levels for a balanced tree if repeated SAH splits become skewed.
  if(parts&&parts.some(p=>level+1+Math.ceil(Math.log2(Math.ceil(p.length/LEAF_SIZE)))>RAY_LIMITS.depth)){parts=null;fallback=true;}
  if(!parts){if(method==='sah')fallback=true;parts=median(items,centroids);}
  node.left=split(parts[0],level+1);node.right=split(parts[1],level+1);return index;
 }
 if(primitives.length)split([...primitives],1);
 return {nodes,ordered,method,depth,buildMs:performance.now()-start,fallback};
}

/** Traversal budgets are explicit: exhaustion never becomes a fabricated miss. */
export function traceBVH(ray:Ray,bvh:BVH,any=false):QueryResult {
 const result:QueryResult={hit:null,status:'miss',nodeVisits:0,primitiveTests:0,visited:[],logTruncated:false};
 if(!validRay(ray)){result.status='invalid';return result;}
 if(!bvh.nodes.length)return result;
 const stack=[0];
 while(stack.length){
  if(result.nodeVisits>=RAY_LIMITS.nodeVisits){result.status='overflow';return result;}
  const index=stack.pop()!,node=bvh.nodes[index];
  if(!node){result.status='invalid';return result;}
  result.nodeVisits++;if(result.visited.length<RAY_LIMITS.traceEvents)result.visited.push(index);else result.logTruncated=true;
  const maxT=result.hit?Math.min(ray.tMax,result.hit.t+tieTolerance(result.hit.t,result.hit.t)):ray.tMax;
  if(!intersectBounds(ray,node,maxT))continue;
  if(node.count>0){
   if(node.count>LEAF_SIZE||node.start<0||node.start+node.count>bvh.ordered.length){result.status='invalid';return result;}
   for(let i=0;i<node.count;i++){
    result.primitiveTests++;const candidate=intersectPrimitive(ray,bvh.ordered[node.start+i]);
    if(candidate&&nearerHit(candidate,result.hit)){result.hit=candidate;if(any){result.status='hit';return result;}}
   }
  }else{
   if(node.left<0||node.right<0){result.status='invalid';return result;}
   const left=bvh.nodes[node.left],right=bvh.nodes[node.right];
   if(!left||!right){result.status='invalid';return result;}
   const l=intersectBounds(ray,left,maxT),r=intersectBounds(ray,right,maxT);
   if(stack.length+(l?1:0)+(r?1:0)>RAY_LIMITS.stack){result.status='overflow';return result;}
   if(l&&r){if(l[0]<=r[0])stack.push(node.right,node.left);else stack.push(node.left,node.right);}
   else if(l)stack.push(node.left);else if(r)stack.push(node.right);
  }
 }
 result.status=result.hit?'hit':'miss';return result;
}
