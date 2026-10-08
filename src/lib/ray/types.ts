export type Vec3=[number,number,number];
export interface Ray {origin:Vec3;direction:Vec3;tMin:number;tMax:number}
export interface Material {albedo:Vec3;emission:Vec3;kind:'lambert'|'mirror'|'ggx';roughness:number}
export interface Primitive {kind:'triangle'|'sphere';a:Vec3;b:Vec3;c:Vec3;radius:number;id:number;objectId:number;materialId:number;previousOffset:Vec3}
export interface Bounds {min:Vec3;max:Vec3}
export interface BVHNode extends Bounds {left:number;right:number;start:number;count:number}
export interface BVH {nodes:BVHNode[];ordered:Primitive[];method:'median'|'sah';depth:number;buildMs:number;fallback:boolean}
export interface SceneSnapshot {version:number;frame:number;primitives:Primitive[];materials:Material[];light:{center:Vec3;u:Vec3;v:Vec3;normal:Vec3;emission:Vec3};environment:Vec3}
export interface Hit {hit:boolean;t:number;position:Vec3;geometricNormal:Vec3;shadingNormal:Vec3;frontFace:boolean;primitiveId:number;objectId:number;materialId:number;barycentric:Vec3}
export interface QueryResult {hit:Hit|null;status:'hit'|'miss'|'overflow'|'invalid';nodeVisits:number;primitiveTests:number;visited:number[];logTruncated:boolean}
export const RAY_LIMITS={primitives:2048,depth:32,stack:64,nodeVisits:4095,traceEvents:256,maxScattering:8} as const;
// GPU texture ABI (RGBA32F/Nearest, rows): nodes=2 texels/row;
// node[0]=min.xyz,left (leaf: -(start+1)); node[1]=max.xyz,right (leaf: count).
// primitives=6 texels/row: [a.xyz,type:triangle0/sphere1], [b.xyz,radius],
// [c.xyz,materialId], [previousOffset.xyz,objectId], [stablePrimitiveId,0,0,0], reserved.
// materials=3 texels/row: [albedo.rgb,kind:lambert0/mirror1/ggx2],
// [emission.rgb,roughness], reserved. IDs are stable even if ordered changes.
export interface PackedScene {nodes:Float32Array;primitives:Float32Array;materials:Float32Array;nodeCount:number;primitiveCount:number;materialCount:number}
