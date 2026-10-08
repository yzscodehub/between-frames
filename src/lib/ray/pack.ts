import type {Bounds, BVH, PackedScene, SceneSnapshot} from './types';
import {RAY_LIMITS} from './types';

const scratch=new Float32Array(1),bits=new Uint32Array(scratch.buffer);
/** Round an AABB outward, so Float32 texture packing cannot shrink a CPU bound. */
function outward(value:number,up:boolean):number {
 scratch[0]=value;const rounded=scratch[0];
 if((up&&rounded>=value)||(!up&&rounded<=value))return rounded;
 if(rounded===0){bits[0]=up?1:0x80000001;return scratch[0];}
 bits[0]+=(rounded>0)===up?1:-1;return scratch[0];
}

/** Row-major RGBA32F; primitive rows follow BVH order, IDs remain stable. */
export function packScene(snapshot:SceneSnapshot,bvh:BVH):PackedScene {
 if(bvh.ordered.length>RAY_LIMITS.primitives||bvh.nodes.length>RAY_LIMITS.nodeVisits)throw new RangeError('Packed scene exceeds the GPU traversal budget.');
 if(snapshot.primitives.length!==bvh.ordered.length)throw new RangeError('Snapshot and BVH primitive counts differ.');
 const source=new Map(snapshot.primitives.map(p=>[p.id,p]));
 for(const p of bvh.ordered)if(source.get(p.id)!==p)throw new RangeError('BVH does not belong to this scene snapshot.');
 const primitives=new Float32Array(Math.max(1,bvh.ordered.length)*24);
 bvh.ordered.forEach((p,index)=>{
  if(p.id>0xffffff||p.objectId>0xffffff||!Number.isInteger(p.objectId)||p.objectId<0||!Number.isInteger(p.materialId)||p.materialId<0||p.materialId>=snapshot.materials.length)throw new RangeError('Packed IDs must be exact Float32 integers with an existing material.');
  const at=index*24;primitives.set([...p.a,p.kind==='sphere'?1:0,...p.b,p.radius,...p.c,p.materialId,...p.previousOffset,p.objectId,p.id,0,0,0,0,0,0,0],at);
 });
 if(!primitives.every(Number.isFinite))throw new RangeError('Scene values exceed finite Float32 range.');
 // Quantize primitives BEFORE deriving upload bounds. Rounding a CPU sphere's
 // center and radius independently can move its effective surface outside an
 // outward-rounded CPU box (e.g. center=1+5e-8,r=1 becomes center=1,r=1).
 const quantizedBounds:Bounds[]=bvh.ordered.map((_,index)=>{
  const at=index*24,box:Bounds={min:[0,0,0],max:[0,0,0]};
  for(let axis=0;axis<3;axis++){
   if(primitives[at+3]===1){box.min[axis]=primitives[at+axis]-primitives[at+7];box.max[axis]=primitives[at+axis]+primitives[at+7];}
   else {box.min[axis]=Math.min(primitives[at+axis],primitives[at+4+axis],primitives[at+8+axis]);box.max[axis]=Math.max(primitives[at+axis],primitives[at+4+axis],primitives[at+8+axis]);}
  }
  return box;
 });
 const expanded:Array<Bounds|undefined>=new Array(bvh.nodes.length),active=new Uint8Array(bvh.nodes.length);
 const include=(a:Bounds,b:Bounds)=>{for(let axis=0;axis<3;axis++){a.min[axis]=Math.min(a.min[axis],b.min[axis]);a.max[axis]=Math.max(a.max[axis],b.max[axis]);}};
 function uploadBounds(index:number):Bounds {
  if(!Number.isInteger(index)||index<0||index>=bvh.nodes.length||active[index])throw new RangeError('Invalid BVH node topology.');
  const cached=expanded[index];if(cached)return cached;
  active[index]=1;const node=bvh.nodes[index],box:Bounds={min:[...node.min],max:[...node.max]};
  if(node.count>0){
   if(node.start<0||node.start+node.count>quantizedBounds.length)throw new RangeError('Invalid BVH leaf range.');
   for(let i=0;i<node.count;i++)include(box,quantizedBounds[node.start+i]);
  }else {include(box,uploadBounds(node.left));include(box,uploadBounds(node.right));}
  active[index]=0;expanded[index]=box;return box;
 }
 const nodes=new Float32Array(Math.max(1,bvh.nodes.length)*8);
 bvh.nodes.forEach((node,index)=>{
  // Every ancestor unions the expanded child bounds plus its original CPU box.
  // Only texture bounds change; tree structure, ordering and stable IDs do not.
  const box=uploadBounds(index),at=index*8;
  for(let axis=0;axis<3;axis++){nodes[at+axis]=outward(box.min[axis],false);nodes[at+4+axis]=outward(box.max[axis],true);}
  nodes[at+3]=node.count>0?-(node.start+1):node.left;nodes[at+7]=node.count>0?node.count:node.right;
 });
 const materials=new Float32Array(Math.max(1,snapshot.materials.length)*12);
 snapshot.materials.forEach((m,index)=>materials.set([...m.albedo,m.kind==='mirror'?1:m.kind==='ggx'?2:0,...m.emission,m.roughness,0,0,0,0],index*12));
 if(!nodes.every(Number.isFinite)||!primitives.every(Number.isFinite)||!materials.every(Number.isFinite))throw new RangeError('Scene values exceed finite Float32 range.');
 return {nodes,primitives,materials,nodeCount:bvh.nodes.length,primitiveCount:bvh.ordered.length,materialCount:snapshot.materials.length};
}
