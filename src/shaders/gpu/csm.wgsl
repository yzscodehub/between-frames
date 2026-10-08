struct Camera {vp:mat4x4f,view:mat4x4f,lightVP:array<mat4x4f,4>,splits:vec4f,position:vec4f,light:vec4f,options:vec4f,texels:vec4f};
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var shadow0:texture_depth_2d;
@group(0) @binding(2) var shadow1:texture_depth_2d;
@group(0) @binding(3) var shadow2:texture_depth_2d;
@group(0) @binding(4) var shadow3:texture_depth_2d;
@group(0) @binding(5) var shadowSampler:sampler_comparison;
struct Input {@location(0) position:vec4f,@location(1) normal:vec4f,@location(2) base:vec4f,@location(3) extra:vec4f};
struct Output {@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) base:vec4f,@location(3) material:vec3f,@location(4) @interpolate(flat) id:u32};

@vertex fn vertex(i:Input)->Output {var o:Output;o.position=camera.vp*vec4f(i.position.xyz,1);o.world=i.position.xyz;o.normal=i.normal.xyz;o.base=i.base;o.material=vec3f(i.normal.w,i.base.w,i.extra.x);o.id=u32(i.position.w);return o;}
fn choose(depth:f32)->u32 {if(depth<=camera.splits.x){return 0u;}if(depth<=camera.splits.y){return 1u;}if(depth<=camera.splits.z){return 2u;}return 3u;}
fn visibility(world:vec3f,nl:f32,level:u32)->f32 {let p=camera.lightVP[level]*vec4f(world,1);let q=p.xyz/p.w;let uv=q.xy*vec2f(.5,-.5)+.5;if(any(uv<vec2f(0))||any(uv>vec2f(1))||q.z<0||q.z>1){return 1;}let slope=sqrt(max(0.,1-nl*nl))/max(nl,.1);let bias=(.001+1.5*camera.texels[level]*slope)/199.9;var sum=0.;for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){let tap=uv+vec2f(f32(x),f32(y))/vec2f(textureDimensions(shadow0));if(level==0u){sum+=textureSampleCompareLevel(shadow0,shadowSampler,tap,q.z-bias);}else if(level==1u){sum+=textureSampleCompareLevel(shadow1,shadowSampler,tap,q.z-bias);}else if(level==2u){sum+=textureSampleCompareLevel(shadow2,shadowSampler,tap,q.z-bias);}else{sum+=textureSampleCompareLevel(shadow3,shadowSampler,tap,q.z-bias);}}}return sum/9;}
struct FragmentOut {@location(0) color:vec4f,@location(1) checks:vec4f};
@fragment fn fragment(i:Output)->FragmentOut {let n=normalize(i.normal);let v=normalize(camera.position.xyz-i.world);let l=normalize(camera.light.xyz);let h=normalize(v+l);let nl=max(dot(n,l),0.);let nv=max(dot(n,v),.0001);let nh=max(dot(n,h),0.);let vh=max(dot(v,h),0.);let r=max(i.material.x,.05);let a=r*r;let a2=a*a;let denominator=(1-nh*nh)+a2*nh*nh;let D=a2/(3.14159265*denominator*denominator);let gl=2*nl/max(.00001,nl+sqrt(a2+(1-a2)*nl*nl));let gv=2*nv/(nv+sqrt(a2+(1-a2)*nv*nv));let f0=mix(vec3f(.04),i.base.rgb,i.material.y);let F=f0+(vec3f(1)-f0)*pow(1-vh,5);var base=i.base.rgb;if(i.id==1u){let tile=fract(i.world.xz*.6);let edge=select(1.,.83,tile.x<.025||tile.y<.025);base*=edge;}
 let brdf=(1-i.material.y)*(vec3f(1)-F)*base/3.14159265+F*D*gl*gv/max(.00001,4*nl*nv);let viewDepth=-(camera.view*vec4f(i.world,1)).z;let level=choose(viewDepth);var shadowValue=visibility(i.world,nl,level);var weight=0.;
 // @snippet csm-select-start
 if(camera.options.y>.5&&level<3u){var start=.1;if(level>0u){start=camera.splits[level-1u];}let end=camera.splits[level];weight=smoothstep(end-(end-start)*.1,end,viewDepth);shadowValue=mix(shadowValue,visibility(i.world,nl,level+1u),weight);}
 // @snippet csm-select-end
 let direct=brdf*nl*shadowValue*vec3f(3.8,3.15,2.35);
 // Explicit P0 art-direction fill, not the validated IBL integral. P1 replaces
 // this preview term with the shared material/environment pipeline.
 let fill=base*(1-i.material.y)*mix(vec3f(.035,.028,.02),vec3f(.16,.24,.3),n.y*.5+.5);let rim=F*vec3f(.12,.19,.24)*pow(1-nv,2);var result=direct+fill+rim+base*i.material.z;if(camera.options.z>.5){let colors=array<vec3f,4>(vec3f(.8,.18,.1),vec3f(.12,.7,.25),vec3f(.12,.35,.85),vec3f(.65,.15,.8));result=mix(result,mix(colors[level],colors[min(level+1u,3u)],weight),.7);}var out:FragmentOut;out.color=vec4f(result,1);out.checks=vec4f(viewDepth,f32(level),weight,shadowValue);return out;}
