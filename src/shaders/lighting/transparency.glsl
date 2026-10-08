precision highp float;precision highp int;
in vec2 vUv;out vec4 outColor;
uniform int uPass,uLayer,uCrossing,uReverse,uPanel;
uniform float uAlpha,uPower;
uniform sampler2D uAccum,uReveal,uSorted,uImage;
uniform vec2 uInspect;
const vec3 BG=vec3(.06,.085,.11);
vec3 color(int i){return i==0?vec3(.9,.12,.06):i==1?vec3(.04,.6,.75):vec3(.6,.12,.85);}
bool covered(vec2 p,int i){vec2 center=i==0?vec2(-.2,0):i==1?vec2(.2,.04):vec2(0,-.15);return all(lessThanEqual(abs(p-center),vec2(.63,.62)));}
float depth(vec2 p,int i){float d=i==0?.42:i==1?.48:.56;if(uCrossing==1)d+=i==0?.23*p.x:i==1?-.23*p.x:.2*p.y;return d;}
vec3 reference(vec2 p){int ids[3];ids[0]=0;ids[1]=1;ids[2]=2;for(int i=0;i<3;i++)for(int j=i+1;j<3;j++)if(depth(p,ids[i])<depth(p,ids[j])||(depth(p,ids[i])==depth(p,ids[j])&&ids[i]<ids[j])){int k=ids[i];ids[i]=ids[j];ids[j]=k;}vec3 result=BG;for(int i=0;i<3;i++)if(covered(p,ids[i]))result=color(ids[i])*uAlpha+result*(1.-uAlpha);return result;}
// @snippet oit-resolve-start
vec3 resolve(vec2 uv){vec4 a=texture(uAccum,uv);float t=texture(uReveal,uv).r;return (a.a>0.?a.rgb/a.a:vec3(0))*(1.-t)+BG*t;}
// @snippet oit-resolve-end
vec3 encode(vec3 x){return mix(12.92*x,1.055*pow(max(x,vec3(0)),vec3(1./2.4))-.055,step(vec3(.0031308),x));}
void main(){vec2 p=vUv*2.-1.;if(uPass<3){if(!covered(p,uLayer))discard;
 // @snippet oit-accum-start
 float w=max(.01,pow(1.-depth(p,uLayer),uPower));
 if(uPass==0)outColor=vec4(color(uLayer)*uAlpha*w,uAlpha*w);
 else if(uPass==1)outColor=vec4(0,0,0,uAlpha);
 else outColor=vec4(color(uLayer)*uAlpha,uAlpha);
 // @snippet oit-accum-end
 return;}
 if(uPass==3){vec2 uv=vec2(fract(vUv.x*3.),vUv.y);int panel=int(floor(vUv.x*3.));outColor=vec4(panel==0?texture(uSorted,uv).rgb:panel==1?reference(uv*2.-1.):resolve(uv),1);return;}
 if(uPass==4){outColor=vec4(encode(texture(uImage,vUv).rgb),1);return;}
 if(uPass==5){outColor=vec4(uPanel==0?texture(uSorted,uInspect).rgb:uPanel==1?reference(uInspect*2.-1.):resolve(uInspect),1);return;}
 outColor=uPass==6?texture(uAccum,uInspect):texture(uReveal,uInspect);
}
