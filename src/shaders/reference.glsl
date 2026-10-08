precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth,tNormal,previous;
uniform mat4 inverseProjection,cameraWorld;
uniform float radius;
uniform int batch,sceneId;
uniform vec4 sphere;
uniform vec3 boxCenters[24],boxSizes[24];
uniform int boxCount;
const float PI=3.141592653589793;
float sphereHit(vec3 o,vec3 d){vec3 oc=o-sphere.xyz;float b=dot(oc,d),c=dot(oc,oc)-sphere.w*sphere.w,h=b*b-c;if(h<0.0)return 1e6;float t=-b-sqrt(h);if(t<.001)t=-b+sqrt(h);return t>.001?t:1e6;}
float boxHit(vec3 o,vec3 d,vec3 c,vec3 size){vec3 inv=1.0/(d+vec3(1e-9));vec3 a=(c-size*.5-o)*inv,b=(c+size*.5-o)*inv;vec3 lo=min(a,b),hi=max(a,b);float enter=max(lo.x,max(lo.y,lo.z)),leave=min(hi.x,min(hi.y,hi.z));if(enter>leave||leave<.001)return 1e6;return enter>.001?enter:leave;}
float nearest(vec3 o,vec3 d){float t=1e6;if(sphere.w>0.0)t=sphereHit(o,d);for(int i=0;i<24;i++){if(i>=boxCount)break;t=min(t,boxHit(o,d,boxCenters[i],boxSizes[i]));}if(d.y<-.00001){float plane=-o.y/d.y;vec3 p=o+d*plane;if(plane>.001&&abs(p.x)<10.0&&abs(p.z)<10.0)t=min(t,plane);}return t;}
float radicalInverse(int index){float value=0.0,f=.5;int n=index;for(int k=0;k<16;k++){value+=float(n-2*(n/2))*f;n/=2;f*=.5;}return value;}
void main(){vec4 nn=texture2D(tNormal,vUv);if(nn.a<.5){gl_FragColor=vec4(1,1,1,0);return;}vec4 q=inverseProjection*vec4(vUv*2.0-1.0,texture2D(tDepth,vUv).r*2.0-1.0,1);vec3 p=(cameraWorld*vec4(q.xyz/q.w,1)).xyz,n=normalize(mat3(cameraWorld)*nn.xyz);vec3 t=normalize(cross(abs(n.z)<.9?vec3(0,0,1):vec3(0,1,0),n)),b=cross(n,t);float sum=0.0;
for(int i=0;i<32;i++){int index=batch*32+i;float u=radicalInverse(index+1);float v=fract(float(index)*0.61803398875+fract(sin(dot(floor(vUv*vec2(320,200)),vec2(12.9898,78.233)))*43758.5453));vec3 d=t*(sqrt(u)*cos(2.0*PI*v))+b*(sqrt(u)*sin(2.0*PI*v))+n*sqrt(1.0-u);sum+=nearest(p+n*.012,d)<radius?0.0:1.0;}
float old=batch==0?0.0:texture2D(previous,vUv).r;float mean=(old*float(batch)+sum/32.0)/float(batch+1);gl_FragColor=vec4(vec3(mean),1);}
