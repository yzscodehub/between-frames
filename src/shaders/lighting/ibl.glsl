precision highp float;
precision highp int;
in vec2 vUv;out vec4 outColor;
uniform int uPass,uEnvironment,uDiffuse,uPanel;
uniform float uRoughness,uRotation,uExposure;
uniform sampler2D uAtlas,uImage;
uniform vec2 uInspect;
const float PI=3.141592653589793;
vec3 env(vec3 d){if(uEnvironment==0)return vec3(1);float t=radians(uRotation);d=vec3(cos(t)*d.x-sin(t)*d.z,d.y,sin(t)*d.x+cos(t)*d.z);float a=pow(max(0.,dot(d,normalize(vec3(-.6,.65,.4)))),uEnvironment==2?512.:24.);float b=pow(max(0.,dot(d,normalize(vec3(.8,.1,-.5)))),16.);return vec3(.06,.08,.12)+a*vec3(4,3,2)+b*vec3(.2,.6,1.5);}
float radical(uint b){b=(b<<16u)|(b>>16u);b=((b&0x55555555u)<<1u)|((b&0xAAAAAAAAu)>>1u);b=((b&0x33333333u)<<2u)|((b&0xCCCCCCCCu)>>2u);b=((b&0x0F0F0F0Fu)<<4u)|((b&0xF0F0F0F0u)>>4u);b=((b&0x00FF00FFu)<<8u)|((b&0xFF00FF00u)>>8u);return float(b)*2.3283064365386963e-10;}
mat3 basis(vec3 n){vec3 t=normalize(cross(abs(n.z)<.99?vec3(0,0,1):vec3(0,1,0),n));return mat3(t,cross(n,t),n);}
vec3 halfSample(int i,float r,vec3 n){float x=(float(i)+.5)/256.,y=radical(uint(i)),a=r*r;float z=sqrt((1.-y)/(1.+(a*a-1.)*y)),p=2.*PI*x;return basis(n)*vec3(sqrt(1.-z*z)*cos(p),sqrt(1.-z*z)*sin(p),z);}
vec3 cosineSample(int i,vec3 n){float x=(float(i)+.5)/256.,p=2.*PI*radical(uint(i));return basis(n)*vec3(sqrt(x)*cos(p),sqrt(x)*sin(p),sqrt(1.-x));}
// @snippet ibl-integral-start
vec3 integrate(vec3 n,vec3 v,float r){vec3 sum=vec3(0);float nv=max(.00001,dot(n,v));for(int i=0;i<256;i++){if(uDiffuse==1){sum+=env(cosineSample(i,n));continue;}vec3 h=halfSample(i,r,n),l=reflect(-v,h);float nl=dot(n,l),nh=max(.00001,dot(n,h)),vh=max(0.,dot(v,h));if(nl>0.){float g=pbrSmithG1(nv,r*r)*pbrSmithG1(nl,r*r);sum+=env(l)*pbrSchlick(vec3(.04),vh)*g*vh/(nv*nh);}}return sum/256.;}
vec2 brdfIntegral(vec3 n,vec3 v,float r){vec2 sum=vec2(0);float nv=max(.00001,dot(n,v));for(int i=0;i<256;i++){vec3 h=halfSample(i,r,n),l=reflect(-v,h);float nl=dot(n,l);if(nl>0.){float vh=max(0.,dot(v,h)),g=pbrSmithG1(nv,r*r)*pbrSmithG1(nl,r*r)*vh/(nv*max(.00001,dot(n,h))),fc=pow(1.-vh,5.);sum+=vec2(1.-fc,fc)*g;}}return sum/256.;}
// @snippet ibl-integral-end
vec2 uvFor(vec3 d){return vec2(atan(d.z,d.x)/(2.*PI)+.5,acos(clamp(d.y,-1.,1.))/PI);}
vec3 mapAt(vec3 d,float level){vec2 uv=uvFor(d);uv=clamp(uv,vec2(.5/64.,.5/32.),vec2(1.-.5/64.,1.-.5/32.));return texture(uAtlas,vec2((uv.x+level)/7.,uv.y)).rgb;}
vec3 approximate(vec3 n,vec3 v){if(uDiffuse==1)return mapAt(n,6.);float f=(uRoughness-.2)/.16,lo=floor(f),hi=min(lo+1.,5.);vec3 r=reflect(-v,n),filtered=mix(mapAt(r,lo),mapAt(r,hi),fract(f));vec2 ab=brdfIntegral(n,v,uRoughness);return filtered*(.04*ab.x+ab.y);}
vec3 shade(vec2 uv,int panel){vec2 p=(uv-.5)*2.4;float z=1.-dot(p,p);if(z<=0.)return vec3(.018,.025,.035);vec3 n=normalize(vec3(p,sqrt(z))),v=vec3(0,0,1);vec3 exact=integrate(n,v,uRoughness),approx=approximate(n,v);return panel==0?exact:panel==1?approx:abs(exact-approx)*4.;}
vec3 encode(vec3 x){return mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),x));}
void main(){
 if(uPass==0){float level=floor(vUv.x*7.),x=fract(vUv.x*7.),p=(x-.5)*2.*PI,t=vUv.y*PI;vec3 n=vec3(cos(p)*sin(t),cos(t),sin(p)*sin(t)),sum=vec3(0);float w=0.;for(int i=0;i<256;i++){if(level>5.5){sum+=env(cosineSample(i,n));w+=1.;}else{vec3 h=halfSample(i,.2+level*.16,n),l=reflect(-n,h);float nl=max(0.,dot(n,l));sum+=env(l)*nl;w+=nl;}}outColor=vec4(sum/max(w,.00001),1);return;}
 if(uPass==1){outColor=vec4(shade(vec2(fract(vUv.x*3.),vUv.y),int(floor(vUv.x*3.))),1);return;}
 if(uPass==2){vec3 c=texture(uImage,vUv).rgb*exp2(uExposure);outColor=vec4(encode(c/(1.+c)),1);return;}
 outColor=vec4(shade(uInspect,uPanel),1);
}
