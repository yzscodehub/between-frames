struct Camera {vp:mat4x4f,lightVP:mat4x4f,position:vec4f,light:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var shadow:texture_depth_2d;
@group(0) @binding(2) var shadowSampler:sampler_comparison;
struct Input {@location(0) position:vec4f,@location(1) normal:vec4f,@location(2) base:vec4f,@location(3) extra:vec4f};
struct Output {@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) base:vec4f,@location(3) material:vec3f,@location(4) @interpolate(flat) id:u32};
@vertex fn depthVertex(i:Input)->@builtin(position) vec4f {return camera.lightVP*vec4f(i.position.xyz,1);}
@vertex fn vertex(i:Input)->Output {var o:Output;o.position=camera.vp*vec4f(i.position.xyz,1);o.world=i.position.xyz;o.normal=i.normal.xyz;o.base=i.base;o.material=vec3f(i.normal.w,i.base.w,i.extra.x);o.id=u32(i.position.w);return o;}
fn visibility(world:vec3f,nl:f32)->f32 {let p=camera.lightVP*vec4f(world,1);let q=p.xyz/p.w;let uv=q.xy*vec2f(.5,-.5)+.5;if(any(uv<vec2f(0))||any(uv>vec2f(1))||q.z<0||q.z>1){return 1;}let bias=max(.0004,.002*(1-nl));var sum=0.;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){sum+=textureSampleCompareLevel(shadow,shadowSampler,uv+vec2f(f32(x),f32(y))/vec2f(textureDimensions(shadow)),q.z-bias);}}return sum/9;}
@fragment fn fragment(i:Output)->@location(0) vec4f {let n=normalize(i.normal);let v=normalize(camera.position.xyz-i.world);let l=normalize(camera.light.xyz);let h=normalize(v+l);let nl=max(dot(n,l),0.);let nv=max(dot(n,v),.0001);let nh=max(dot(n,h),0.);let vh=max(dot(v,h),0.);let r=max(i.material.x,.05);let a=r*r;let a2=a*a;let denominator=(1-nh*nh)+a2*nh*nh;let D=a2/(3.14159265*denominator*denominator);let gl=2*nl/max(.00001,nl+sqrt(a2+(1-a2)*nl*nl));let gv=2*nv/(nv+sqrt(a2+(1-a2)*nv*nv));let f0=mix(vec3f(.04),i.base.rgb,i.material.y);let F=f0+(vec3f(1)-f0)*pow(1-vh,5);var base=i.base.rgb;if(i.id==1u){let tile=fract(i.world.xz*.6);let edge=select(1.,.83,tile.x<.025||tile.y<.025);base*=edge;}
 let brdf=(1-i.material.y)*(vec3f(1)-F)*base/3.14159265+F*D*gl*gv/max(.00001,4*nl*nv);let direct=brdf*nl*visibility(i.world,nl)*vec3f(3.8,3.15,2.35);
 // Explicit P0 art-direction fill, not the validated IBL integral. P1 replaces
 // this preview term with the shared material/environment pipeline.
 let fill=base*(1-i.material.y)*mix(vec3f(.035,.028,.02),vec3f(.16,.24,.3),n.y*.5+.5);let rim=F*vec3f(.12,.19,.24)*pow(1-nv,2);return vec4f(direct+fill+rim+base*i.material.z,1);}
