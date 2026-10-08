// Prepend the existing read-only ray/query.glsl for the full-geometry reference.
in vec2 vUv;
out vec4 outColor;
uniform sampler2D tPosition,tNormal,tRadiance,tDepth;
uniform mat4 uViewMatrix,uProjection,uCameraWorld;
uniform vec2 uResolution,uNearFar,uInspectUv;
uniform float uStride,uViewStep,uThickness,uRange,uEpsilon;
uniform int uSteps,uMethod,uShading,uMode,uDebug;
uniform vec3 uEnvironment;
const int MAX_STEPS=256;
struct Trace {int status;int steps;vec3 point;int objectId;vec2 hitUv;float t;float delta;vec3 color;vec4 sampleA;vec4 sampleB;};
bool inside(vec2 uv){return all(greaterThanEqual(uv,vec2(0)))&&all(lessThan(uv,vec2(1)));}
float axialDepth(float depth){return uNearFar.x*uNearFar.y/(uNearFar.y-depth*(uNearFar.y-uNearFar.x));}
vec3 localShade(Hit h,vec3 incoming){vec3 rho=texelFetch(tMaterials,ivec2(0,h.materialId),0).rgb;if(uShading==0)return rho;vec3 n=dot(incoming,h.geometricNormal)<0.?h.geometricNormal:-h.geometricNormal;return rho*(.18+.82*max(dot(n,normalize(vec3(-.55,.85,.65))),0.));}
Trace emptyTrace(){Trace t;t.status=0;t.steps=0;t.point=vec3(0);t.objectId=-1;t.hitUv=vec2(-1);t.t=-1.;t.delta=0.;t.color=uEnvironment;t.sampleA=vec4(-1);t.sampleB=vec4(-1);return t;}
void record(inout Trace result,int selected,vec2 uv,float rayDepth,float sceneDepth,float t,float delta,int kind,int objectId){
 if(result.steps==selected){result.sampleA=vec4(uv,rayDepth,sceneDepth);result.sampleB=vec4(t,delta,float(kind),float(objectId));}result.steps++;
}
// Fetch the actual native depth texel. Outside UVs are classified BEFORE access.
bool depthAt(vec2 uv,out float depth,out int objectId){
 if(!inside(uv))return false;ivec2 size=textureSize(tDepth,0),pixel=ivec2(floor(uv*vec2(size)));
 float raw=texelFetch(tDepth,pixel,0).r;objectId=int(round(texelFetch(tPosition,pixel,0).a))-1;
 if(raw>=1.||objectId<0){depth=-1.;return false;}depth=axialDepth(raw);return rtFinite(depth)&&depth>0.;
}
bool projectionAt(vec3 point,out vec2 uv){vec4 clip=uProjection*vec4(point,1.);if(clip.w<=0.||!rtFinite(clip.w)){uv=vec2(-1);return false;}uv=clip.xy/clip.w*.5+.5;return true;}

// @snippet dda-start
vec3 perspectiveSegment(vec3 a,vec3 b,float k0,float k1,float lambda){
 // Q=P/w and k=1/w interpolate linearly along the SCREEN segment.
 return mix(a*k0,b*k1,lambda)/mix(k0,k1,lambda);
}
// @snippet dda-end

Trace traceScreen(vec3 worldOrigin,vec3 worldDirection,int startObject,int selected){
 Trace result=emptyTrace();result.status=6;
 vec3 origin=(uViewMatrix*vec4(worldOrigin,1.)).xyz,direction=normalize(mat3(uViewMatrix)*worldDirection);
 if(!rtFinite3(origin)||!rtFinite3(direction)){result.status=7;return result;}
 float lengthLimit=uRange;bool nearClipped=false;
 if(direction.z>0.){float nearT=(-uNearFar.x-origin.z)/direction.z;if(nearT<=0.){result.status=3;return result;}if(nearT<lengthLimit){lengthLimit=max(0.,nearT-1e-4);nearClipped=true;}}
 if(direction.z<0.){float farT=(-uNearFar.y-origin.z)/direction.z;if(farT>0.)lengthLimit=min(lengthLimit,farT);}
 vec3 end=origin+direction*lengthLimit;vec4 h0=uProjection*vec4(origin,1.),h1=uProjection*vec4(end,1.);
 if(h0.w<=0.||h1.w<=0.){result.status=3;return result;}
 float k0=1./h0.w,k1=1./h1.w;vec2 p0=h0.xy*k0*.5+.5,p1=h1.xy*k1*.5+.5;
 float major=max(max(abs(p1.x-p0.x)*uResolution.x,abs(p1.y-p0.y)*uResolution.y),1e-5);
 float previousT=0.,previousDelta=0.;bool previousValid=false,sawDepth=false;
 for(int i=0;i<MAX_STEPS;i++){
  if(i>=uSteps)break;
  float lambda=min(1.,float(i+1)*uStride/major);
  vec3 point=uMethod==0?perspectiveSegment(origin,end,k0,k1,lambda):origin+direction*min(lengthLimit,float(i+1)*uViewStep);
  float t=clamp(dot(point-origin,direction),0.,lengthLimit),rayDepth=-point.z;vec2 uv;
  if(!projectionAt(point,uv)||rayDepth<uNearFar.x){record(result,selected,uv,rayDepth,-1.,t,0.,7,-1);result.status=3;return result;}
  if(!inside(uv)){record(result,selected,uv,rayDepth,-1.,t,0.,5,-1);result.status=2;return result;}
  float sceneDepth;int objectId;bool valid=depthAt(uv,sceneDepth,objectId),atEnd=t>=lengthLimit-1e-5;
  if(!valid||objectId==startObject){
   record(result,selected,uv,rayDepth,valid?sceneDepth:-1.,t,0.,valid?4:0,objectId);previousValid=false;previousT=t;
   if(atEnd){result.status=nearClipped?3:(sawDepth?5:4);return result;}continue;
  }
  sawDepth=true;float delta=rayDepth-sceneDepth;int kind=1;
  // @snippet crossing-start
  bool crossing=previousValid&&previousDelta<0.&&delta>=0.;
  bool isolated=!previousValid&&delta>=0.&&delta<=uThickness;
  // Never discard a crossing because the coarse step overshot thickness.
  if(crossing||isolated){
   kind=2;float lo=previousT,hi=t;
   for(int refine=0;refine<8;refine++){
    float middle=(lo+hi)*.5;vec3 q=origin+direction*middle;vec2 st;float d;int object;
    bool projected=projectionAt(q,st),exists=projected&&depthAt(st,d,object)&&object!=startObject;
    if(exists&&-q.z>=d)hi=middle;else lo=middle;
   }
   vec3 q=origin+direction*hi;vec2 st;float d;int object;
   bool projected=projectionAt(q,st),exists=projected&&depthAt(st,d,object)&&object!=startObject;
   float residual=exists?-q.z-d:1e10;
   if(exists&&residual>=-1e-5&&residual<=uThickness){
    result.status=1;result.point=worldOrigin+worldDirection*hi;result.objectId=object;result.hitUv=st;result.t=hi;result.delta=residual;result.color=texture(tRadiance,st).rgb;
    record(result,selected,uv,rayDepth,sceneDepth,t,delta,3,objectId);return result;
   }
   kind=6;
  }
  // @snippet crossing-end
  record(result,selected,uv,rayDepth,sceneDepth,t,delta,kind,objectId);
  previousValid=true;previousT=t;previousDelta=delta;
  if(atEnd){result.status=nearClipped?3:5;return result;}
 }
 return result;
}
vec3 statusColor(int status){if(status==1)return vec3(.12,.72,.38);if(status==2)return vec3(.95,.35,.06);if(status==3)return vec3(.7,.3,.8);if(status==4)return vec3(.18,.4,.7);if(status==5)return vec3(.32,.43,.52);if(status==6)return vec3(.95,.66,.12);if(status==7)return vec3(1,0,1);return vec3(.22,.27,.32);}
void main(){
 int pixel=int(gl_FragCoord.x);vec2 uv=uDebug!=0?uInspectUv:vUv;
 vec4 p=texture(tPosition,uv);vec3 normal=texture(tNormal,uv).xyz;int objectId=int(round(p.a))-1;
 vec3 base=p.a>0.?texture(tRadiance,uv).rgb:uEnvironment;
 if(uDebug==0&&uMode==4){float d=texture(tDepth,uv).r;outColor=vec4(vec3(d>=1.?1.:axialDepth(d)/uNearFar.y),1);return;}
 bool mirror=objectId==0;vec3 incoming=normalize(p.xyz-uCameraWorld[3].xyz),direction=normalize(reflect(incoming,normal));
 vec3 origin=p.xyz+normal*(dot(direction,normal)>=0.?uEpsilon:-uEpsilon);
 Trace ssr=emptyTrace();QueryResult reference=rtEmptyResult();vec3 reflected=base;
 if(mirror){
  if(uDebug!=0||uMode!=1)ssr=traceScreen(origin,direction,objectId,uDebug!=0?(pixel-10)/2:-1);
  if(uDebug!=0||uMode==1||uMode==2){Ray ray;ray.origin=origin;ray.direction=direction;ray.tMin=1e-4;ray.tMax=uRange;reference=rtQueryMode(ray,-1,0);reflected=reference.status==RT_HIT?localShade(reference.hit,direction):uEnvironment;}
 }
 vec3 mirrorRho=texelFetch(tMaterials,ivec2(0,0),0).rgb,ssrColor=mirror?mirrorRho*ssr.color:base,referenceColor=mirror?mirrorRho*reflected:base;
 if(uDebug!=0){
  if(pixel==0)outColor=vec4(p.xyz,float(objectId));
  else if(pixel==1)outColor=vec4(normal,float(ssr.status));
  else if(pixel==2)outColor=vec4(origin,float(ssr.steps));
  else if(pixel==3)outColor=vec4(direction,0.);
  else if(pixel==4)outColor=vec4(ssr.point,float(ssr.objectId));
  else if(pixel==5)outColor=vec4(ssr.hitUv,ssr.t,ssr.delta);
  else if(pixel==6)outColor=vec4(reference.hit.position,float(reference.hit.objectId));
  else if(pixel==7)outColor=vec4(referenceColor,float(reference.status));
  else if(pixel==8)outColor=vec4(ssrColor,reference.hit.t);
  else if(pixel==9)outColor=vec4(uv,float(uSteps),float(uMethod));
  else outColor=(pixel-10)%2==0?ssr.sampleA:ssr.sampleB;
  return;
 }
 if(uMode==3){outColor=vec4(mirror?statusColor(ssr.status):base*.3,1);return;}
 if(reference.status>RT_HIT||ssr.status==7){outColor=vec4(1,0,1,0);return;}
 if(uMode==2){float error=dot(abs(ssrColor-referenceColor),vec3(1./3.));outColor=vec4(mix(vec3(.03,.07,.11),vec3(.96,.25,.08),clamp(error*4.,0.,1.)),1);return;}
 outColor=vec4(uMode==1?referenceColor:ssrColor,1);
}
