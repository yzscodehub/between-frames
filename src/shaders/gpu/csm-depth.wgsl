@group(0) @binding(0) var<uniform> matrix:mat4x4f;
@vertex fn vertex(@location(0) position:vec4f)->@builtin(position) vec4f {return matrix*vec4f(position.xyz,1);}
