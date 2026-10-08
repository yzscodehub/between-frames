precision highp float;
in vec3 position;
uniform mat4 modelMatrix,viewMatrix,projectionMatrix;
out vec3 vWorld;
void main(){vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}
