struct Params {values:vec4f,inspect:vec4f};
@group(0) @binding(0) var<uniform> u:Params;
const BG=vec3f(.06,.085,.11);
fn color(id:i32)->vec3f {if(id==0){return vec3f(.9,.12,.06);}if(id==1){return vec3f(.04,.6,.75);}return vec3f(.6,.12,.85);}
fn covered(p:vec2f,id:i32)->bool {var center=vec2f(0,-.15);if(id==0){center=vec2f(-.2,0);}if(id==1){center=vec2f(.2,.04);}return all(abs(p-center)<=vec2f(.63,.62));}
fn depth(p:vec2f,id:i32)->f32 {var d=.56;if(id==0){d=.42;}if(id==1){d=.48;}if(u.values.z>.5){if(id==0){d+=.23*p.x;}else if(id==1){d-=.23*p.x;}else{d+=.2*p.y;}}return d;}
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
fn point(position:vec4f)->vec2f {return vec2f(position.x/160,1-position.y/160)*2-1;}
// @snippet oit-accum-start
@fragment fn accumulate(@builtin(position) position:vec4f)->@location(0) vec4f {let p=point(position);let id=i32(u.values.w);if(!covered(p,id)){discard;}let w=max(.01,pow(1-depth(p,id),u.values.y));return vec4f(color(id)*u.values.x*w,u.values.x*w);}
@fragment fn revealage(@builtin(position) position:vec4f)->@location(0) vec4f {if(!covered(point(position),i32(u.values.w))){discard;}return vec4f(0,0,0,u.values.x);}
@fragment fn ordered(@builtin(position) position:vec4f)->@location(0) vec4f {let id=i32(u.values.w);if(!covered(point(position),id)){discard;}return vec4f(color(id)*u.values.x,u.values.x);}
// @snippet oit-accum-end
