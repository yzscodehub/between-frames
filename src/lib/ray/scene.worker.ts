import {createSnapshot} from './scenes';
import {buildBVH} from './bvh';
import {packScene} from './pack';
import {configureSnapshot,freezeSnapshot} from './snapshot';
self.onmessage=(event:MessageEvent)=>{const {generation,preset,count,frame,variant,method,configuration}=event.data;try{const snapshot=configureSnapshot(createSnapshot(preset,count,configuration.lesson==='denoise'&&configuration.motion!=='object'?0:frame,variant),configuration,generation);snapshot.frame=frame;if(configuration.lesson==='denoise'&&configuration.motion!=='object')for(const p of snapshot.primitives)p.previousOffset=[0,0,0];const bvh=buildBVH(snapshot.primitives,method);const packed=packScene(snapshot,bvh);freezeSnapshot(snapshot);self.postMessage({generation,snapshot,bvh,packed}, {transfer:[packed.nodes.buffer,packed.primitives.buffer,packed.materials.buffer]});}catch(e){self.postMessage({generation,error:e instanceof Error?e.message:String(e)});}};
