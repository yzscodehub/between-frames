precision highp float;
in vec3 vWorld,vNormal,vLocal;
in vec4 vPreviousClip;
in float vDepth;
uniform vec3 uColor;
uniform float uObject,uPattern,uFrequency;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outPosition;
layout(location=2) out vec4 outNormal;
layout(location=3) out vec4 outPrevious;
void main(){
 vec3 normal=normalize(vNormal),color=uColor;
 if(uPattern<1.5&&uPattern>.5){float checker=mod(floor(vWorld.x*uFrequency)+floor(vWorld.z*uFrequency),2.);color*=mix(.18,1.,checker);}
 if(uPattern>1.5){float stripe=step(.48,fract((vLocal.x*.65+vLocal.y)*uFrequency));color=mix(vec3(.055,.09,.13),uColor,stripe);}
 float light=.22+.78*max(dot(normal,normalize(vec3(-.6,1.,.7))),0.);
 outColor=vec4(color*light,1);
 outPosition=vec4(vWorld,uObject);
 outNormal=vec4(normal,vDepth);
 outPrevious=vPreviousClip;
}
