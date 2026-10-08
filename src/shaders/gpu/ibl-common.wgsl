struct Params {values:vec4f,inspect:vec4f};
@group(0) @binding(0) var<uniform> u:Params;
const PI=3.141592653589793;
fn env(direction:vec3f)->vec3f {if(u.values.w<.5){return vec3f(1);}let t=radians(u.values.y);let d=vec3f(cos(t)*direction.x-sin(t)*direction.z,direction.y,sin(t)*direction.x+cos(t)*direction.z);let exponent=select(24.,512.,u.values.w>1.5);let a=pow(max(0.,dot(d,normalize(vec3f(-.6,.65,.4)))),exponent);let b=pow(max(0.,dot(d,normalize(vec3f(.8,.1,-.5)))),16);return vec3f(.06,.08,.12)+a*vec3f(4,3,2)+b*vec3f(.2,.6,1.5);}
fn radical(bits:u32)->f32 {return f32(reverseBits(bits))*2.3283064365386963e-10;}
fn basis(n:vec3f)->mat3x3f {let up=select(vec3f(0,1,0),vec3f(0,0,1),abs(n.z)<.99);let t=normalize(cross(up,n));return mat3x3f(t,cross(n,t),n);}
fn halfSample(i:u32,r:f32,n:vec3f)->vec3f {let x=(f32(i)+.5)/256;let y=radical(i);let a=r*r;let z=sqrt((1-y)/(1+(a*a-1)*y));let p=2*PI*x;return basis(n)*vec3f(sqrt(1-z*z)*cos(p),sqrt(1-z*z)*sin(p),z);}
fn cosineSample(i:u32,n:vec3f)->vec3f {let x=(f32(i)+.5)/256;let p=2*PI*radical(i);return basis(n)*vec3f(sqrt(x)*cos(p),sqrt(x)*sin(p),sqrt(1-x));}
fn smithG1(c:f32,a:f32)->f32 {let a2=a*a;return 2*c/(c+sqrt(a2+(1-a2)*c*c));}
// @snippet ibl-integral-start
fn integrate(n:vec3f,v:vec3f,r:f32)->vec3f {var sum=vec3f(0);let nv=max(.00001,dot(n,v));for(var i=0u;i<256u;i++){if(u.values.z>.5){sum+=env(cosineSample(i,n));continue;}let h=halfSample(i,r,n);let l=reflect(-v,h);let nl=dot(n,l);let nh=max(.00001,dot(n,h));let vh=max(0.,dot(v,h));if(nl>0){let g=smithG1(nv,r*r)*smithG1(nl,r*r);let F=.04+.96*pow(1-vh,5);sum+=env(l)*F*g*vh/(nv*nh);}}return sum/256;}
fn brdfIntegral(n:vec3f,v:vec3f,r:f32)->vec2f {var sum=vec2f(0);let nv=max(.00001,dot(n,v));for(var i=0u;i<256u;i++){let h=halfSample(i,r,n);let l=reflect(-v,h);let nl=dot(n,l);if(nl>0){let vh=max(0.,dot(v,h));let g=smithG1(nv,r*r)*smithG1(nl,r*r)*vh/(nv*max(.00001,dot(n,h)));let fc=pow(1-vh,5);sum+=vec2f(1-fc,fc)*g;}}return sum/256;}
// @snippet ibl-integral-end
