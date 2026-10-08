struct Params {lightView:mat4x4f,lightProjection:mat4x4f,lightWorld:mat4x4f,lightInverse:mat4x4f,range:vec4f,settings:vec4f,mode:vec4f,inspect:vec4f};
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var positions:texture_2d<f32>;
@group(0) @binding(2) var normals:texture_2d<f32>;
@group(0) @binding(3) var shadow:texture_depth_2d;
@group(0) @binding(4) var<storage,read> albedos:array<vec4f>;
@group(0) @binding(5) var<storage,read_write> debug:array<vec4f,332>;
struct Surface {position:vec3f,normal:vec3f,albedo:vec3f,objectId:f32,valid:bool};
struct Tap {uv:vec2f,depth:f32,receiver:f32,distance:f32,visible:bool,valid:bool,blocker:bool,stage:i32};
struct Result {uv:vec2f,receiverDepth:f32,receiverDistance:f32,storedDepth:f32,storedDistance:f32,visibility:f32,blockerDistance:f32,radius:f32,searchRadius:f32,blockers:i32,searches:i32,filters:i32,covered:bool,centerValid:bool};
fn finite(x:f32)->bool{return x==x&&abs(x)<3.4e38;}
fn onMap(uv:vec2f)->bool{return all(uv>=vec2f(0))&&all(uv<vec2f(1));}
fn linearDepth(d:f32)->f32{return u.range.x*u.range.y/(u.range.y-d*(u.range.y-u.range.x));}
fn projected(z:f32)->f32{return u.range.y*(z-u.range.x)/(z*(u.range.y-u.range.x));}
fn emptyTap(stage:i32)->Tap{return Tap(vec2f(-1),-1,-1,0,false,false,false,stage);}
fn surfaceAt(uv:vec2f)->Surface{let xy=clamp(vec2i(vec2f(uv.x,1-uv.y)*vec2f(320,200)),vec2i(0),vec2i(319,199));let p=textureLoad(positions,xy,0);var color=vec3f(0);if(p.w>0){color=albedos[u32(p.w)-1u].rgb;}return Surface(p.xyz,textureLoad(normals,xy,0).xyz,color,p.w-1,p.w>0);}
fn shadowTap(requested:vec2f,s:Surface,stage:i32)->Tap {var tap=emptyTap(stage);tap.uv=requested;if(!onMap(requested)){return tap;}let size=vec2i(textureDimensions(shadow));let pixel=clamp(vec2i(floor(requested*vec2f(size))),vec2i(0),size-1);tap.uv=(vec2f(pixel)+.5)/vec2f(size);
 // @snippet compare-start
 tap.depth=textureLoad(shadow,vec2i(pixel.x,size.y-1-pixel.y),0);tap.distance=linearDepth(tap.depth);var receiver=-(u.lightView*vec4f(s.position,1)).z;
 if(u.settings.w>.5){let local=u.lightInverse*vec4f(tap.uv*2-1,0,1);let direction=normalize((u.lightWorld*vec4f(local.xyz/local.w,0)).xyz);let origin=u.lightWorld[3].xyz;let denominator=dot(s.normal,direction);if(abs(denominator)<1e-7){return tap;}let distance=dot(s.normal,s.position-origin)/denominator;if(distance<=0||!finite(distance)){return tap;}receiver=-(u.lightView*vec4f(origin+direction*distance,1)).z;}
 tap.receiver=projected(receiver-u.settings.x);tap.valid=receiver>=u.range.x&&receiver<=u.range.y&&finite(tap.receiver)&&finite(tap.depth);tap.visible=tap.valid&&tap.receiver<=tap.depth;tap.blocker=tap.valid&&!tap.visible;
 // @snippet compare-end
 return tap;
}
fn recordTap(input:Result,tap:Tap,write:bool)->Result {var r=input;let index=r.searches+r.filters;if(write){debug[u32(8+index*2)]=vec4f(tap.uv,tap.depth,tap.receiver);debug[u32(9+index*2)]=vec4f(select(0.,1.,tap.visible),select(0.,1.,tap.valid),select(0.,1.,tap.blocker),f32(tap.stage));}if(tap.stage==0){r.searches++;}else{r.filters++;}if(!tap.valid){r.covered=false;}return r;}
fn query(s:Surface,algorithm:i32,write:bool)->Result {var r:Result;r.uv=vec2f(-1);r.receiverDepth=-1;r.storedDepth=-1;if(!s.valid){return r;}let view=u.lightView*vec4f(s.position,1);let clip=u.lightProjection*view;r.receiverDistance=-view.z;if(clip.w<=0){return r;}r.uv=clip.xy/clip.w*.5+.5;r.receiverDepth=clip.z/clip.w*.5+.5;if(!onMap(r.uv)||r.receiverDepth<0||r.receiverDepth>1){return r;}let center=shadowTap(r.uv,s,1);r.storedDepth=center.depth;r.storedDistance=center.distance;r.centerValid=center.valid;r.covered=center.valid;if(algorithm==0||(algorithm==2&&u.settings.z<=0)){r=recordTap(r,center,write);r.visibility=select(0.,1.,center.visible);return r;}
 let resolution=f32(textureDimensions(shadow).x);var radius=u.settings.y/resolution;if(algorithm==2){let bound=max(u.range.x,u.range.w);let searchRadius=u.settings.z*max(0.,r.receiverDistance-bound)/(2*u.range.z*bound*r.receiverDistance);r.searchRadius=searchRadius*resolution;var sum=0.;for(var y=-4;y<=4;y++){for(var x=-4;x<=4;x++){let tap=shadowTap(r.uv+vec2f(f32(x),f32(y))*searchRadius/4,s,0);r=recordTap(r,tap,write);if(tap.blocker){sum+=tap.distance;r.blockers++;}}}if(r.blockers==0){r.visibility=1;return r;}
 // @snippet pcss-start
 r.blockerDistance=sum/f32(r.blockers);let worldRadius=u.settings.z*max(0.,r.receiverDistance-r.blockerDistance)/r.blockerDistance;let uvRadius=worldRadius/(2*u.range.z*r.receiverDistance);r.radius=uvRadius*resolution;radius=r.radius/resolution;
 // @snippet pcss-end
 }r.radius=radius*resolution;var visible=0.;for(var y=-4;y<=4;y++){for(var x=-4;x<=4;x++){let tap=shadowTap(r.uv+vec2f(f32(x),f32(y))*radius/4,s,1);r=recordTap(r,tap,write);visible+=select(0.,1.,tap.visible);}}r.visibility=visible/81;return r;
}
@vertex fn vertex(@builtin(vertex_index) id:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[id],0,1);}
@fragment fn fragment(@builtin(position) point:vec4f)->@location(0) vec4f {var algorithm=i32(u.mode.x);var view=i32(u.mode.y);var xy=point.xy;if(u.mode.z>.5){let panel=i32(floor(xy.y/200))*2+i32(floor(xy.x/320));xy=vec2f(xy.x%320,xy.y%200);if(panel==3){view=2;}else{algorithm=panel;view=select(0,1,view==1);}}let uv=vec2f(xy.x/320,1-xy.y/200);if(view==2){let size=vec2i(textureDimensions(shadow));let pixel=clamp(vec2i(vec2f(uv.x,1-uv.y)*vec2f(size)),vec2i(0),size-1);let d=linearDepth(textureLoad(shadow,pixel,0));return vec4f(vec3f(clamp(d/u.range.y,0,1)),1);}let s=surfaceAt(uv);let r=query(s,algorithm,false);if(!s.valid){return vec4f(mix(vec3f(.5,.61,.7),vec3f(.79,.84,.88),uv.y),1);}if(!r.covered){return vec4f(.95,.22,.025,1);}if(view==1){return vec4f(vec3f(r.visibility),1);}var color=s.albedo;let derivative=max(abs(dpdx(s.position.xz))+abs(dpdy(s.position.xz)),vec2f(.0001));if(s.objectId<.5){let grid=abs(fract(s.position.xz+.5)-.5)/derivative;let line=1-min(1.,min(grid.x,grid.y));color*=1-.14*line;}let l=normalize(u.lightWorld[3].xyz-s.position);return vec4f(color*(.22+.78*max(dot(s.normal,l),0.)*r.visibility),1);}
@compute @workgroup_size(1) fn inspect(){let s=surfaceAt(u.inspect.xy);let r=query(s,i32(u.mode.x),true);debug[0]=vec4f(s.position,s.objectId);debug[1]=vec4f(s.normal,select(0.,1.,r.covered));debug[2]=vec4f(r.uv,r.receiverDepth,r.storedDepth);debug[3]=vec4f(r.receiverDistance,r.storedDistance,r.visibility,f32(r.blockers));debug[4]=vec4f(r.blockerDistance,r.radius,f32(r.searches),f32(r.filters));debug[5]=vec4f(r.searchRadius,u.mode.x,select(0.,1.,s.valid),select(0.,1.,r.centerValid));debug[6]=vec4f(u.settings.x,u.settings.w,u.range.xy);debug[7]=vec4f(0);}
