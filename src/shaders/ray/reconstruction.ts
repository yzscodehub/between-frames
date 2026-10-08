export const gbuffer=/* glsl */`
in vec2 vUv;
layout(location=0) out vec4 outPosition;
layout(location=1) out vec4 outNormal;
layout(location=2) out vec4 outAlbedo;
layout(location=3) out vec4 outPrevious;
uniform mat4 uInvProjection,uCameraWorld,uViewMatrix;
uniform float uRayMin,uRayMax;
uniform int uMovingObject;
uniform vec3 uPreviousOffset;
void main(){
 vec4 q=uInvProjection*vec4(vUv*2.-1.,0,1);Ray ray;ray.origin=uCameraWorld[3].xyz;ray.direction=normalize(mat3(uCameraWorld)*(q.xyz/q.w));ray.tMin=uRayMin;ray.tMax=uRayMax;
 QueryResult result=rtQueryMode(ray,-1,0);
 if(result.status!=RT_HIT){float valid=result.status==RT_MISS?0.:-1.;outPosition=vec4(0,0,0,valid);outNormal=vec4(0);outAlbedo=vec4(0,0,0,valid);outPrevious=vec4(0);return;}
 Hit h=result.hit;vec3 oldP=h.position+(h.objectId==uMovingObject?uPreviousOffset:vec3(0));
 outPosition=vec4(h.position,float(h.objectId+1));outNormal=vec4(h.shadingNormal,float(h.materialId));
 outAlbedo=vec4(texelFetch(tMaterials,ivec2(0,h.materialId),0).rgb,-(uViewMatrix*vec4(h.position,1)).z);outPrevious=vec4(oldP,1);
}`;
export const temporal=/* glsl */`
precision highp float;
in vec2 vUv;
layout(location=0) out vec4 outHistory;
layout(location=1) out vec4 outMoments;
uniform sampler2D uCurrent,uPosition,uNormal,uPreviousPoint,uOldPosition,uOldNormal,uOldAlbedo,uHistory,uMoments;
uniform mat4 uPreviousViewProjection,uPreviousView;
uniform int uHasHistory,uHistoryEnabled;
float luminance(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
void main(){
 vec4 p=texture(uPosition,vUv),sampleValue=texture(uCurrent,vUv);vec3 current=max(sampleValue.rgb,vec3(0));float y=luminance(current);
 bool invalidSample=p.a<0.||sampleValue.a<=0.||any(isnan(p))||any(isinf(p))||any(isnan(sampleValue))||any(isinf(sampleValue));
 if(p.a<.5||invalidSample){outHistory=vec4(0);outMoments=vec4(0,0,0,invalidSample?6.:0.);return;}
 // reason: 0 fresh, 1 accepted, 2 offscreen, 3 object, 4 depth/position,
 // 5 luminance-clipped, 6 invalid data, 7 normal, 8 history disabled.
 float reason=uHistoryEnabled==1?0.:8.;bool valid=uHasHistory==1&&uHistoryEnabled==1;
 vec3 previousPoint=texture(uPreviousPoint,vUv).xyz;vec2 uv=vec2(0);vec4 history=vec4(0),moments=vec4(0);
 if(valid){
  vec4 clip=uPreviousViewProjection*vec4(previousPoint,1);
  if(clip.w<=0.){valid=false;reason=2.;}
  else {uv=clip.xy/clip.w*.5+.5;if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1)))){valid=false;reason=2.;}}
 }
 if(valid){
  vec4 oldP=texture(uOldPosition,uv),oldN=texture(uOldNormal,uv),n=texture(uNormal,vUv);
  // Identity is the first geometric gate. Equal materials are insufficient.
  if(abs(oldP.a-p.a)>.1){valid=false;reason=3.;}
  else {
   float expectedDepth=-(uPreviousView*vec4(previousPoint,1)).z,oldDepth=texture(uOldAlbedo,uv).a;
   float depthTolerance=.015+.01*max(expectedDepth,oldDepth);
   if(expectedDepth<=0.||oldDepth<=0.||abs(expectedDepth-oldDepth)>depthTolerance||distance(oldP.xyz,previousPoint)>.025+.01*expectedDepth){valid=false;reason=4.;}
   else if(dot(oldN.xyz,n.xyz)<.9){valid=false;reason=7.;}
  }
 }
 if(valid){history=texture(uHistory,uv);moments=texture(uMoments,uv);if(history.a<1.||any(isnan(history))||any(isinf(history))||any(isnan(moments))||any(isinf(moments))){valid=false;reason=6.;}}
 // Effective age caps at 32, so even a long stationary sequence gives each
 // fresh sample at least 1/32 weight. It is an EMA cap, not an unbiased reset.
 float count=valid?min(history.a,31.):0.;vec3 old=history.rgb;
 if(valid){
   float sigma=sqrt(max(0.,moments.y-moments.x*moments.x));float oldY=luminance(old),span=max(.2,3.*sigma);
   if(abs(oldY-y)>span){
    count=min(count,3.);reason=5.;float clipped=max(0.,clamp(oldY,y-span,y+span));
    old=oldY>.00001?old*(clipped/oldY):vec3(clipped);
    // Keep moments consistent with the clipped mean instead of retaining a
    // stale bright second moment after a lighting change.
    moments.x=clipped;moments.y=clipped*clipped+min(sigma*sigma,span*span);
   }else reason=1.;
 }
 float a=1./(count+1.);vec3 mean=mix(old,current,a);float m1=mix(moments.x,y,a),m2=mix(moments.y,y*y,a);
 if(!valid){mean=current;m1=y;m2=y*y;}
 outHistory=vec4(mean,count+1.);outMoments=vec4(m1,m2,max(0.,m2-m1*m1),reason);
}`;
export const atrous=/* glsl */`
precision highp float;
in vec2 vUv;out vec4 outColor;
uniform sampler2D uSource,uPosition,uNormal,uMoments;
uniform vec2 uResolution;
uniform float uStep;
float lum(vec3 c){return dot(c,vec3(.2126,.7152,.0722));}
float kernel(int i){return i==0?6.:(abs(i)==1?4.:1.);}
void main(){vec4 p=texture(uPosition,vUv),center=texture(uSource,vUv);if(p.a<.5||center.a<1.){outColor=vec4(0);return;}vec3 n=texture(uNormal,vUv).xyz,sum=vec3(0);float total=0.,variance=texture(uMoments,vUv).z;
 for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){
 vec2 uv=vUv+vec2(float(x),float(y))*uStep/uResolution;if(any(lessThan(uv,vec2(0)))||any(greaterThanEqual(uv,vec2(1))))continue;
 vec4 q=texture(uPosition,uv);if(abs(q.a-p.a)>.1)continue;
 vec4 source=texture(uSource,uv);if(source.a<1.)continue;vec3 c=source.rgb;float v=texture(uMoments,uv).z;
 float w=kernel(x)*kernel(y)*pow(max(0.,dot(n,texture(uNormal,uv).xyz)),32.)*exp(-distance(p.xyz,q.xyz)/(max(.06,uStep*.06)))*exp(-abs(lum(c)-lum(center.rgb))/(3.*sqrt(max(0.,variance+v))+.1));
 sum+=c*w;total+=w;}
 outColor=vec4(sum/max(total,.00001),center.a);
}`;
export const compose=/* glsl */`
precision highp float;
in vec2 vUv;out vec4 outColor;
uniform sampler2D uRaw,uHistory,uFiltered,uDirect,uAlbedo,uMoments;
uniform int uView;
void main(){vec4 sampleValue=texture(uRaw,vUv),albedo=texture(uAlbedo,vUv),direct=texture(uDirect,vUv);vec3 raw=sampleValue.rgb,h=texture(uHistory,vUv).rgb,f=texture(uFiltered,vUv).rgb;vec4 m=texture(uMoments,vUv);vec3 c;
 if(uView==1)c=raw;else if(uView==2)c=h;else if(uView==3)c=f;else if(uView==4)c=vec3(sqrt(max(0.,m.z)));else if(uView==5)c=m.w==1.?vec3(.1,.6,.3):(m.w==5.?vec3(.85,.5,.1):vec3(.75,.12,.24));else c=direct.rgb+albedo.rgb*f;
 // B is accumulated and filtered directly. Never divide a noisy image by rho.
 bool valid=sampleValue.a>0.&&direct.a>0.&&albedo.a>=0.&&!any(isnan(c))&&!any(isinf(c));outColor=valid?vec4(c,1):vec4(1,0,1,0);
}`;
