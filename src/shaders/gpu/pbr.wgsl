struct Params { inverseProjection:mat4x4f,cameraWorld:mat4x4f,base:vec4f,light:vec4f,material:vec4f,options:vec4f,inspect:vec4f };
@group(0) @binding(0) var<uniform> u:Params;
@group(0) @binding(1) var image:texture_storage_2d<rgba32float,write>;
@group(0) @binding(2) var<storage,read_write> debug:array<vec4f,12>;
struct Hit {t:f32,position:vec3f,normal:vec3f,id:i32};
const PI=3.141592653589793;
fn sphere(id:i32)->vec4f {if(id==1){return vec4f(-1.65,.7,0,.7);}if(id==2){return vec4f(0,.7,0,.7);}return vec4f(1.65,.7,0,.7);}
fn sphereDistance(o:vec3f,d:vec3f,b:vec4f)->f32 {let relative=o-b.xyz;let a=dot(d,d);let center=-dot(relative,d)/a;let perpendicular=relative+center*d;let radial=b.w*b.w-dot(perpendicular,perpendicular);if(radial<0){return 1e20;}let span=sqrt(radial/a);let near=center-span;let far=center+span;if(near>1e-4){return near;}if(far>1e-4){return far;}return 1e20;}
fn scene(o:vec3f,d:vec3f)->Hit {var hit=Hit(1e20,vec3f(0),vec3f(0),-1);for(var id=1;id<=3;id++){if(u.options.x<.5&&id!=2){continue;}let b=sphere(id);let t=sphereDistance(o,d,b);if(t<hit.t){hit=Hit(t,o+d*t,normalize(o+d*t-b.xyz),id);}}if(abs(d.y)>1e-7){let t=-o.y/d.y;let p=o+d*t;if(t>1e-4&&t<hit.t&&abs(p.x)<4.8&&abs(p.z)<4){hit=Hit(t,p,vec3f(0,1,0),0);}}return hit;}
// @snippet ggx-start
fn ggxD(noH:f32,alpha:f32)->f32 {let a2=alpha*alpha;let nh2=noH*noH;let denominator=(1-nh2)+a2*nh2;return a2/(PI*denominator*denominator);}
fn smithG1(c:f32,alpha:f32)->f32 {let a2=alpha*alpha;return 2*c/(c+sqrt(a2+(1-a2)*c*c));}
fn schlick(f0:vec3f,c:f32)->vec3f {return f0+(vec3f(1)-f0)*pow(1-c,5);}
// @snippet ggx-end
fn visible(hit:Hit,l:vec3f)->f32 {if(u.options.y<.5){return 1;}let o=hit.position+hit.normal*.0005;for(var id=1;id<=3;id++){if(u.options.x<.5&&id!=2){continue;}if(sphereDistance(o,l,sphere(id))<1e19){return 0;}}return 1;}
fn shade(uv:vec2f,inspect:bool)->vec4f {
 // Legacy hashes retain OpenGL camera matrices; directions are reconstructed
 // explicitly. No OpenGL clip-depth value is written to the WebGPU depth buffer.
 let point=u.inverseProjection*vec4f(uv*2-1,0,1);let o=u.cameraWorld[3].xyz;let d=normalize((u.cameraWorld*vec4f(point.xyz/point.w,0)).xyz);let hit=scene(o,d);
 if(hit.id<0){if(inspect){debug[0]=vec4f(0,0,0,-1);}return vec4f(mix(vec3f(.022,.038,.063),vec3f(.11,.17,.22),uv.y),1);}
 var base=u.base.xyz;var roughness=u.material.x;var metallic=u.material.y;if(hit.id==1){roughness=.12;}if(hit.id==3){roughness=.8;}if(hit.id==0){base=vec3f(.22,.255,.29);roughness=.75;metallic=0;}
 let n=hit.normal;let v=normalize(o-hit.position);let l=normalize(u.light.xyz);var h=vec3f(0);if(dot(v+l,v+l)>1e-20){h=normalize(v+l);}let nl=clamp(dot(n,l),0,1);let nv=clamp(dot(n,v),0,1);let nh=clamp(dot(n,h),0,1);let vh=clamp(dot(v,h),0,1);let alpha=pow(clamp(roughness,.03,1),2);
 // @snippet material-start
 let f0=mix(vec3f(.04),base,metallic);let f=schlick(f0,vh);var D=0.;var gl=0.;var gv=0.;var G=0.;var diffuse=vec3f(0);var specular=vec3f(0);
 if(nl>0&&nv>0&&nh>0&&vh>0){D=ggxD(nh,alpha);gl=smithG1(nl,alpha);gv=smithG1(nv,alpha);G=gl*gv;diffuse=(1-metallic)*(vec3f(1)-f)*base/PI;specular=f*D*G/(4*nl*nv);}
 // @snippet material-end
 let visibility=visible(hit,l);let diffuseRadiance=diffuse*u.material.z*nl*visibility;let specularRadiance=specular*u.material.z*nl*visibility;var radiance=diffuseRadiance+specularRadiance;
 if(inspect){debug[0]=vec4f(hit.position,f32(hit.id));debug[1]=vec4f(n,roughness);debug[2]=vec4f(nl,nv,nh,vh);debug[3]=vec4f(D,gl,gv,G);debug[4]=vec4f(f,metallic);debug[5]=vec4f(diffuse,visibility);debug[6]=vec4f(specular,u.material.z);debug[7]=vec4f(radiance,1);debug[8]=vec4f(v,alpha);debug[9]=vec4f(l,1);debug[10]=vec4f(f0,1);debug[11]=vec4f(base,1);}
 let view=i32(u.options.z);if(view==1){radiance=diffuseRadiance;}if(view==2){radiance=specularRadiance;}if(view==3){radiance=vec3f(clamp(log2(1+D)/8,0,1));}if(view==4){radiance=f;}if(view==5){radiance=vec3f(G);}return vec4f(radiance,1);
}
@compute @workgroup_size(8,8) fn render(@builtin(global_invocation_id) id:vec3u){if(id.x>=400u||id.y>=250u){return;}let uv=vec2f((f32(id.x)+.5)/400,1-(f32(id.y)+.5)/250);textureStore(image,vec2i(id.xy),shade(uv,false));}
@compute @workgroup_size(1) fn inspect(){let unused=shade(u.inspect.xy,true);}
