precision highp float;
in vec3 vWorld;
uniform vec3 uAlbedo,uEye;
uniform float uObject;
uniform int uShading;
layout(location=0)out vec4 outPosition;
layout(location=1)out vec4 outNormal;
layout(location=2)out vec4 outRadiance;
void main(){vec3 ng=normalize(cross(dFdx(vWorld),dFdy(vWorld)));if(!gl_FrontFacing)ng=-ng;
 vec3 ns=dot(vWorld-uEye,ng)<0.?ng:-ng;
 vec3 c=uShading==0?uAlbedo:uAlbedo*(.18+.82*max(0.,dot(ns,normalize(vec3(-.55,.85,.65)))));
 outPosition=vec4(vWorld,uObject+1.);outNormal=vec4(ng,1.);outRadiance=vec4(c,1.);
}
