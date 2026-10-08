import {ResourceBudget,qualityProfiles,type Quality} from './contracts';
export interface AdapterRecord {vendor:string;architecture:string;description:string;fallback:boolean;timestamp:boolean}
export class GpuSession {
 readonly format=navigator.gpu.getPreferredCanvasFormat();readonly budget:ResourceBudget;readonly resources=new Set<GPUBuffer|GPUTexture>();disposed=false;
 private constructor(readonly device:GPUDevice,readonly canvas:HTMLCanvasElement,readonly context:GPUCanvasContext,readonly adapter:AdapterRecord,quality:Quality,readonly onLost:(message:string)=>void){this.budget=new ResourceBudget(qualityProfiles[quality].bytes);context.configure({device,format:this.format,alphaMode:'opaque'});device.lost.then(info=>{if(!this.disposed)onLost('WebGPU 设备丢失：'+info.message);});device.addEventListener('uncapturederror',e=>{if(!this.disposed)onLost('WebGPU 验证失败：'+e.error.message);});}
 static async create(canvas:HTMLCanvasElement,onLost:(message:string)=>void,quality:Quality='standard'){
 if(!navigator.gpu)throw Error('此浏览器无法使用 WebGPU。正文与静态说明仍可阅读。');const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('未找到 WebGPU 适配器。');const timestamp=adapter.features.has('timestamp-query');const device=await adapter.requestDevice({requiredFeatures:timestamp?['timestamp-query']:[]});const context=canvas.getContext('webgpu');if(!context){device.destroy();throw Error('无法创建 WebGPU 画布。');}
 const info=adapter.info;return new GpuSession(device,canvas,context,{vendor:info.vendor,architecture:info.architecture,description:info.description,fallback:info.isFallbackAdapter,timestamp},quality,onLost);
 }
 buffer(label:string,size:number,usage:GPUBufferUsageFlags){const token={};this.budget.reserve(token,size,label);try{const buffer=this.device.createBuffer({label,size,usage});this.budget.release(token);this.budget.reserve(buffer,size,label);this.resources.add(buffer);return buffer;}catch(e){this.budget.release(token);throw e;}}
 texture(label:string,width:number,height:number,format:GPUTextureFormat,usage:GPUTextureUsageFlags){const bpp:Partial<Record<GPUTextureFormat,number>>={rgba32float:16,rgba16float:8,rg32float:8,r32float:4,rgba8unorm:4,depth32float:4};if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||!bpp[format])throw Error('未登记或非法纹理格式/尺寸：'+format);const bytes=width*height*bpp[format]!,token={};this.budget.reserve(token,bytes,label);try{const t=this.device.createTexture({label,size:[width,height],format,usage});this.budget.release(token);this.budget.reserve(t,bytes,label);this.resources.add(t);return t;}catch(e){this.budget.release(token);throw e;}}
 release(resource:GPUBuffer|GPUTexture){if(this.resources.delete(resource)){resource.destroy();this.budget.release(resource);}}
 async shader(code:string,label:string){const module=this.device.createShaderModule({code,label});const info=await module.getCompilationInfo();const errors=info.messages.filter(m=>m.type==='error');if(errors.length)throw Error(label+': '+errors.map(e=>`${e.lineNum}:${e.linePos} ${e.message}`).join('\n'));return module;}
 async readBuffer(source:GPUBuffer,bytes:number){if(bytes%4)throw Error('读回长度必须4字节对齐');const staging=this.buffer('async readback',bytes,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);try{const cmd=this.device.createCommandEncoder();cmd.copyBufferToBuffer(source,0,staging,0,bytes);this.device.queue.submit([cmd.finish()]);await staging.mapAsync(GPUMapMode.READ);return staging.getMappedRange().slice(0);}finally{this.release(staging);}}
 dispose(){if(this.disposed)return;this.disposed=true;this.context.unconfigure();for(const r of [...this.resources])this.release(r);this.device.destroy();}
}
export class GpuTimer {
 readonly queries:GPUQuerySet|null;readonly result:GPUBuffer|null;busy=false;
 constructor(readonly session:GpuSession){this.queries=session.adapter.timestamp?session.device.createQuerySet({type:'timestamp',count:2}):null;this.result=this.queries?session.buffer('timestamp resolve',16,GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC):null;}
 writes(){return this.queries&&!this.busy?{querySet:this.queries,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}:undefined;}
 resolve(encoder:GPUCommandEncoder){if(!this.queries||!this.result||this.busy)return false;encoder.resolveQuerySet(this.queries,0,2,this.result,0);this.busy=true;return true;}
 async read(){if(!this.result)return null;try{const data=new BigUint64Array(await this.session.readBuffer(this.result,16));return Number(data[1]-data[0])/1e6;}finally{this.busy=false;}}
 dispose(){this.queries?.destroy();if(this.result)this.session.release(this.result);}
}
