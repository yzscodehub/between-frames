/** Asynchronous disjoint-aware timer; unavailable is never replaced with CPU time. */
export class RayGPUTimer {
 ext:any;query:WebGLQuery|null=null;active=false;poll=0;disposed=false;tag='';
 constructor(public gl:WebGL2RenderingContext,public result:(ms:number|null,tag:string)=>void){this.ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');}
 begin(tag:string){if(!this.ext||this.query||this.disposed||this.gl.isContextLost())return;this.query=this.gl.createQuery();if(!this.query)return;this.tag=tag;this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT,this.query);this.active=true;}
 end(){if(!this.active||!this.query)return;this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);this.active=false;const q=this.query,tag=this.tag;let attempts=0;
  const check=()=>{if(this.disposed||this.query!==q)return;this.poll=0;if(this.gl.isContextLost()||this.gl.getParameter(this.ext.GPU_DISJOINT_EXT)){this.gl.deleteQuery(q);this.query=null;this.result(null,tag);return;}if(this.gl.getQueryParameter(q,this.gl.QUERY_RESULT_AVAILABLE)){const value=this.gl.getQueryParameter(q,this.gl.QUERY_RESULT);this.gl.deleteQuery(q);this.query=null;this.result(Number.isFinite(value)?value/1e6:null,tag);}else if(++attempts<180)this.poll=requestAnimationFrame(check);else{this.gl.deleteQuery(q);this.query=null;this.result(null,tag);}};this.poll=requestAnimationFrame(check);
 }
 dispose(){if(this.disposed)return;this.disposed=true;cancelAnimationFrame(this.poll);this.poll=0;if(this.active&&!this.gl.isContextLost())this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);if(this.query)this.gl.deleteQuery(this.query);this.active=false;this.query=null;}
}
