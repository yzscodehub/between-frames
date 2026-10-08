@group(0) @binding(0) var inputImage:texture_2d<f32>;
@group(0) @binding(1) var outputImage:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> params:vec4f;
@group(0) @binding(3) var rawImage:texture_2d<f32>;
fn fetch(p:vec2i)->vec3f {return textureLoad(inputImage,clamp(p,vec2i(0),vec2i(textureDimensions(inputImage))-1),0).rgb;}
// @snippet hdr-extract-start
@compute @workgroup_size(8,8) fn extract(@builtin(global_invocation_id) id:vec3u){let size=textureDimensions(outputImage);if(any(id.xy>=size)){return;}let p=vec2i(id.xy)*2;let c=(fetch(p)+fetch(p+vec2i(1,0))+fetch(p+vec2i(0,1))+fetch(p+vec2i(1,1)))/4;let luminance=dot(c,vec3f(.2126,.7152,.0722));let bright=c*max(0.,luminance-params.x)/max(luminance,.000001);textureStore(outputImage,vec2i(id.xy),vec4f(bright,1));}
// @snippet hdr-extract-end
fn filtered(p:vec2i,direction:vec2i)->vec3f {let weights=array<f32,5>(1,4,6,4,1);var color=vec3f(0);for(var i=0;i<5;i++){color+=fetch(p+direction*(i-2))*weights[i]/16;}return color;}
@compute @workgroup_size(8,8) fn horizontal(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(outputImage))){return;}textureStore(outputImage,vec2i(id.xy),vec4f(filtered(vec2i(id.xy),vec2i(1,0)),1));}
@compute @workgroup_size(8,8) fn vertical(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(outputImage))){return;}textureStore(outputImage,vec2i(id.xy),vec4f(filtered(vec2i(id.xy),vec2i(0,1)),1));}
// @snippet hdr-combine-start
@compute @workgroup_size(8,8) fn combine(@builtin(global_invocation_id) id:vec3u){if(any(id.xy>=textureDimensions(outputImage))){return;}let raw=textureLoad(rawImage,vec2i(id.xy),0).rgb;let bloom=fetch(vec2i(id.xy/2u));var result=raw+params.y*bloom;if(params.w>.5){let a=raw*exp2(params.z);let b=bloom*exp2(params.z);result=clamp(a/(1+a)+params.y*b/(1+b),vec3f(0),vec3f(1));}textureStore(outputImage,vec2i(id.xy),vec4f(result,1));}
// @snippet hdr-combine-end
