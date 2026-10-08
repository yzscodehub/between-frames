precision highp float;
in vec3 position;
in vec3 normal;
uniform mat4 modelMatrix,viewMatrix,projectionMatrix,uPreviousModel,uPreviousVP;
uniform mat3 uWorldNormal;
out vec3 vWorld,vNormal,vLocal;
out vec4 vPreviousClip;
out float vDepth;
void main(){
 vec4 world=modelMatrix*vec4(position,1);
 vWorld=world.xyz;vLocal=position;vNormal=normalize(uWorldNormal*normal);
 vDepth=-(viewMatrix*world).z;
 vPreviousClip=uPreviousVP*uPreviousModel*vec4(position,1);
 gl_Position=projectionMatrix*viewMatrix*world;
}
