@group(0) @binding(0) var source:texture_2d<f32>;
struct Display{size:vec2f,exposure:f32,mode:f32};
@group(0) @binding(1) var<uniform> display:Display;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {let dims=vec2i(textureDimensions(source));let xy=clamp(vec2i(p.xy/display.size*vec2f(dims)),vec2i(0),dims-1);var c=max(textureLoad(source,xy,0).rgb,vec3f(0));if(display.mode<.5||display.mode>2.5){c*=exp2(display.exposure);c=c/(1+c);}if(display.mode<1.5){c=pow(c,vec3f(1/2.2));}else{c=mix(c*12.92,1.055*pow(c,vec3f(1/2.4))-.055,step(vec3f(.0031308),c));}return vec4f(c,1);}
