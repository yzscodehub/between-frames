struct View { vp:mat4x4f };
@group(0) @binding(0) var<uniform> camera:View;
struct VertexOut {@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) @interpolate(flat) object:u32};
@vertex fn vertex(@location(0) point:vec4f)->VertexOut {var out:VertexOut;let clip=camera.vp*vec4f(point.xyz,1);out.position=vec4f(clip.xy,(clip.z+clip.w)*.5,clip.w);out.world=point.xyz;out.object=u32(point.w);return out;}
struct GBuffer {@location(0) position:vec4f,@location(1) normal:vec4f};
@fragment fn fragment(input:VertexOut,@builtin(front_facing) front:bool)->GBuffer {var n=-normalize(cross(dpdx(input.world),dpdy(input.world)));if(!front){n=-n;}var out:GBuffer;out.position=vec4f(input.world,f32(input.object)+1);out.normal=vec4f(n,1);return out;}
