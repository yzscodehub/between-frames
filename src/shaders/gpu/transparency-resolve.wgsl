@group(0) @binding(1) var accum:texture_2d<f32>;
@group(0) @binding(2) var reveal:texture_2d<f32>;
@group(0) @binding(3) var sorted:texture_2d<f32>;
@group(0) @binding(4) var image:texture_storage_2d<rgba32float,write>;
@group(0) @binding(5) var<storage,read_write> debug:array<vec4f,5>;
fn reference(p:vec2f)->vec3f {var ids=array<i32,3>(0,1,2);for(var i=0;i<3;i++){for(var j=i+1;j<3;j++){let a=depth(p,ids[i]);let b=depth(p,ids[j]);if(a<b||(a==b&&ids[i]<ids[j])){let k=ids[i];ids[i]=ids[j];ids[j]=k;}}}var result=BG;for(var i=0;i<3;i++){if(covered(p,ids[i])){result=color(ids[i])*u.values.x+result*(1-u.values.x);}}return result;}
// @snippet oit-resolve-start
fn resolve(xy:vec2i)->vec3f {let a=textureLoad(accum,xy,0);let t=textureLoad(reveal,xy,0).r;var mean=vec3f(0);if(a.a>0){mean=a.rgb/a.a;}return mean*(1-t)+BG*t;}
// @snippet oit-resolve-end
fn value(xy:vec2i,panel:u32)->vec3f {if(panel==0u){return textureLoad(sorted,xy,0).rgb;}if(panel==2u){return resolve(xy);}let uv=vec2f((f32(xy.x)+.5)/160,1-(f32(xy.y)+.5)/160);return reference(uv*2-1);}
@compute @workgroup_size(8,8) fn render(@builtin(global_invocation_id) id:vec3u){if(id.x>=480u||id.y>=160u){return;}textureStore(image,vec2i(id.xy),vec4f(value(vec2i(i32(id.x%160u),i32(id.y)),id.x/160u),1));}
@compute @workgroup_size(1) fn inspect(){let xy=clamp(vec2i(vec2f(u.inspect.x*160,(1-u.inspect.y)*160)),vec2i(0),vec2i(159));for(var i=0u;i<3u;i++){debug[i]=vec4f(value(xy,i),1);}debug[3]=textureLoad(accum,xy,0);debug[4]=textureLoad(reveal,xy,0);}
