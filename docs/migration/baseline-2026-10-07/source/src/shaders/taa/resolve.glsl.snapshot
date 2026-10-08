precision highp float;
precision highp int;
in vec2 vUv;
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outMeta;
uniform sampler2D uCurrent,uPosition,uNormal,uPreviousClip,uOldColor,uOldMeta,uOldPosition,uOldNormal;
uniform vec2 uResolution,uInspectUv,uJitter,uPreviousJitter;
uniform float uWeight;
uniform int uHasHistory,uValidate,uClip,uDebug;
struct Result {vec3 current;vec3 history;vec3 clipped;vec3 finalColor;vec3 lo;vec3 hi;vec4 position;vec4 normal;vec4 previous;vec2 uv;vec2 oldUv;vec2 historyUv;float weight;float age;float oldAge;float oldId;float oldDepth;float normalDot;int reason;};
Result evaluate(vec2 uv){
 ivec2 size=ivec2(uResolution),pixel=clamp(ivec2(floor(uv*uResolution)),ivec2(0),size-1);
 Result r;r.uv=(vec2(pixel)+.5)/uResolution;
 r.current=texelFetch(uCurrent,pixel,0).rgb;r.position=texelFetch(uPosition,pixel,0);r.normal=texelFetch(uNormal,pixel,0);
 r.previous=texelFetch(uPreviousClip,pixel,0);r.oldUv=vec2(-1);r.historyUv=vec2(-1);r.history=r.current;r.clipped=r.current;
 r.lo=r.current;r.hi=r.current;r.weight=0.;r.age=1.;r.oldAge=0.;r.oldId=0.;r.oldDepth=0.;r.normalDot=0.;r.reason=0;
 if(r.position.w<.5)r.reason=6;
 else if(uHasHistory==0)r.reason=1;
 // @snippet reprojection-start
 // Geometry validation uses the previous jittered projection, with no extra jitter.
 if(r.previous.w>0.)r.oldUv=r.previous.xy/r.previous.w*.5+.5;
 // History COLOR is a fixed output lattice. Remove jitter motion, preserving true motion.
 r.historyUv=r.oldUv+(uJitter-uPreviousJitter)/uResolution;
 vec2 oldPixel=r.oldUv*uResolution-.5;
 ivec2 base=ivec2(floor(oldPixel));vec2 f=fract(oldPixel);
 if(r.reason==0&&(r.previous.w<=0.||any(lessThan(r.oldUv,vec2(0)))||any(greaterThanEqual(r.oldUv,vec2(1)))||any(lessThan(r.historyUv,vec2(0)))||any(greaterThanEqual(r.historyUv,vec2(1)))))r.reason=2;
 // Validate the geometry footprint separately from the color footprint.
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  float w=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y);if(w<1e-6)continue;
  ivec2 p=base+ivec2(x,y);
  if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,size))){if(r.reason==0)r.reason=2;continue;}
  vec4 pos=texelFetch(uOldPosition,p,0),n=texelFetch(uOldNormal,p,0);
  if(r.reason==0){
   r.oldId=pos.w;r.oldDepth=n.w;r.normalDot=dot(r.normal.xyz,n.xyz);
   if(uValidate!=0){
    if(abs(pos.w-r.position.w)>.25)r.reason=3;
    else if(abs(n.w-r.previous.w)>max(.025,.015*r.previous.w))r.reason=4;
    else if(r.normalDot<.92)r.reason=5;
   }
  }
 }
 vec2 colorPixel=r.historyUv*uResolution-.5;ivec2 colorBase=ivec2(floor(colorPixel));vec2 colorF=fract(colorPixel);
 vec3 sum=vec3(0);float age=256.;
 for(int y=0;y<2;y++)for(int x=0;x<2;x++){
  float w=(x==0?1.-colorF.x:colorF.x)*(y==0?1.-colorF.y:colorF.y);if(w<1e-6)continue;
  ivec2 p=colorBase+ivec2(x,y);
  if(any(lessThan(p,ivec2(0)))||any(greaterThanEqual(p,size))){if(r.reason==0)r.reason=2;continue;}
  vec4 meta=texelFetch(uOldMeta,p,0);
  if(r.reason==0&&uValidate!=0&&abs(meta.a-r.position.w)>.25){r.oldId=meta.a;r.reason=3;}
  sum+=texelFetch(uOldColor,p,0).rgb*w;age=min(age,meta.r);
 }
 if(r.reason==0&&age<1.)r.reason=1;
 r.oldAge=age;
 if(uHasHistory!=0)r.history=sum;
 // @snippet reprojection-end
 // @snippet clipping-start
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec3 c=texelFetch(uCurrent,clamp(pixel+ivec2(x,y),ivec2(0),size-1),0).rgb;
  r.lo=min(r.lo,c);r.hi=max(r.hi,c);
 }
 r.clipped=r.history;
 if(uClip!=0){
  vec3 center=(r.lo+r.hi)*.5,extent=(r.hi-r.lo)*.5+vec3(1e-5),delta=r.history-center;
  vec3 scaled=abs(delta/extent);float m=max(scaled.x,max(scaled.y,scaled.z));
  if(m>1.)r.clipped=center+delta/m;
 }
 r.weight=r.reason==0?min(uWeight,age/(age+1.)):0.;
 r.age=r.reason==0?min(age+1.,256.):1.;
 r.finalColor=mix(r.current,r.clipped,r.weight);
 // @snippet clipping-end
 return r;
}
void main(){
 Result r=evaluate(uDebug!=0?uInspectUv:vUv);
 outMeta=vec4(r.age,r.weight,float(r.reason),r.position.w);
 if(uDebug==0){outColor=vec4(r.finalColor,1);return;}
 int p=int(floor(gl_FragCoord.x));
 if(p==0)outColor=vec4(r.current,r.position.w);
 else if(p==1)outColor=vec4(r.position.xyz,r.normal.w);
 else if(p==2)outColor=vec4(r.uv,r.oldUv);
 else if(p==3)outColor=vec4(r.history,r.oldId);
 else if(p==4)outColor=vec4(r.clipped,r.weight);
 else if(p==5)outColor=vec4(r.finalColor,r.age);
 else if(p==6)outColor=vec4(r.normal.xyz,float(r.reason));
 else if(p==7)outColor=vec4(uJitter,uPreviousJitter);
 else if(p==8)outColor=r.previous;
 else if(p==9)outColor=vec4(r.oldDepth,r.normalDot,r.oldAge,float(uHasHistory));
 else if(p==10)outColor=vec4(r.lo,float(uValidate));
 else if(p==11)outColor=vec4(r.hi,float(uClip));
 else outColor=vec4(r.historyUv,r.uv-r.historyUv);
}
