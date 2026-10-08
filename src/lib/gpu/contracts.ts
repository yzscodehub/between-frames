export type Quality='low'|'standard'|'high';
export const qualityProfiles={low:{width:960,height:540,bytes:192*1024**2},standard:{width:1280,height:720,bytes:384*1024**2},high:{width:1920,height:1080,bytes:768*1024**2}} as const;
export interface ExperimentState<P=Record<string,unknown>> {version:2;experimentId:string;sceneId:string;sceneRevision:number;camera:{position:number[];target:number[]};parameters:P;seed:number;quality:Quality;frame:number}
export class RevisionGate {private serial=0;advance(){return ++this.serial;}current(){return this.serial;}accepts(token:number){return token===this.serial;}}
export class ResourceBudget {
 private allocations=new Map<object,{bytes:number;label:string}>();used=0;
 constructor(readonly limit:number){}
 reserve(key:object,bytes:number,label:string){if(!Number.isSafeInteger(bytes)||bytes<0)throw Error('非法资源大小');if(this.allocations.has(key))throw Error('资源重复登记');if(this.used+bytes>this.limit)throw Error(`资源预算不足：${label}`);this.allocations.set(key,{bytes,label});this.used+=bytes;}
 release(key:object){const entry=this.allocations.get(key);if(entry){this.used-=entry.bytes;this.allocations.delete(key);}}
 snapshot(){return {used:this.used,limit:this.limit,count:this.allocations.size};}
}
export interface PassDeclaration {name:string;reads:readonly string[];writes:readonly string[];encode:(encoder:GPUCommandEncoder)=>void}
export function validatePasses(passes:readonly PassDeclaration[],external:readonly string[]=[]){const available=new Set(external),names=new Set<string>();for(const p of passes){if(names.has(p.name))throw Error('重复阶段：'+p.name);names.add(p.name);for(const read of p.reads){if(p.writes.includes(read))throw Error('同阶段读写冲突：'+p.name+'/'+read);if(!available.has(read))throw Error('读取尚未产生的资源：'+read);}p.writes.forEach(w=>available.add(w));}}
export function encodePasses(encoder:GPUCommandEncoder,passes:readonly PassDeclaration[],external:readonly string[]=[]){validatePasses(passes,external);for(const p of passes)p.encode(encoder);}
