// query.glsl + lighting.glsl are prepended by RayEffects. Every surface in the
// depth maps is found by the exact shared query, including analytic spheres.
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform mat4 uEffectView;
uniform mat4 uEffectProjection;
uniform mat4 uLightInvProjection;
uniform mat4 uLightWorld;
uniform mat4 uLightView;
uniform mat4 uLightProjection;
uniform vec2 uLightNearFar;
uniform vec2 uLightHalfSize;
uniform vec2 uLightTanHalfFov;
uniform vec2 uEffectResolution;
uniform vec2 uShadowResolution;
uniform sampler2D tEffectShadow;
uniform sampler2D tEffectPosition;
uniform sampler2D tEffectRadiance;
uniform float uRayMin;
uniform float uRayMax;
uniform float uOffsetScale;
uniform float uSceneScale;
uniform vec3 uEnvironment;
uniform int uEffectPass; // 0 shadow depth, 1 position, 2 local radiance, 3 hard, 4 PCSS, 5 SSR, 6 mirror camera.
uniform int uEffectDebug; // 0 color, 1 validity / SSR termination, 2 depth, 3 PCSS radius.
uniform float uSsrThickness;
uniform float uSsrMaxDistance;

Ray fxCameraRay(vec2 uv,mat4 inverseProjection,mat4 world) {
 vec4 q=inverseProjection*vec4(uv*2.0-1.0,0.0,1.0);
 Ray ray;ray.origin=(world*vec4(0,0,0,1)).xyz;ray.direction=normalize(mat3(world)*(q.xyz/q.w));ray.tMin=uRayMin;ray.tMax=uRayMax;return ray;
}
vec3 fxOffset(Hit hit,vec3 direction) {
 return hit.position+(rtOffsetOrigin(hit.position,hit.geometricNormal,direction,uSceneScale)-hit.position)*uOffsetScale;
}
float fxLinearDepth(float depth) {
 float n=uLightNearFar.x,f=uLightNearFar.y;return n*f/(f-depth*(f-n));
}
float fxDepth(float distance) {
 float n=uLightNearFar.x,f=uLightNearFar.y;return f/(f-n)-f*n/((f-n)*distance);
}
bool fxOnscreen(vec2 uv) {return all(greaterThanEqual(uv,vec2(0)))&&all(lessThanEqual(uv,vec2(1)));}
vec2 fxPenumbraUv(float receiver,float blocker) {
 // First world-space penumbra half-width, then world -> projected UV.
 vec2 radius=uLightHalfSize*max(0.0,receiver-blocker)/max(blocker,1e-6);
 return radius/(2.0*uLightTanHalfFov*receiver);
}
vec4 fxFailure(int status) {return vec4(status==RT_OVERFLOW?vec3(1,.18,0):vec3(1,0,1),0);}
vec4 fxShadowTexel(vec2 uv,out vec2 centerUv) {
 ivec2 dimensions=textureSize(tEffectShadow,0);
 ivec2 pixel=clamp(ivec2(floor(uv*vec2(dimensions))),ivec2(0),dimensions-1);
 centerUv=(vec2(pixel)+.5)/vec2(dimensions);
 return texelFetch(tEffectShadow,pixel,0);
}
float fxReceiverPlaneDepth(vec2 texelUv,vec3 normal,float planeConstant,float fallback) {
 vec3 direction=vec3((texelUv*2.0-1.0)*uLightTanHalfFov,-1.0);
 float denominator=dot(normal,direction);
 if(abs(denominator)<1e-6)return fallback;
 float depth=planeConstant/denominator;
 // A nearly tangent receiver can place the extrapolated tangent plane behind
 // the light. Use its actual depth there; this is still a PCSS approximation.
 return depth>0.0&&rtFinite(depth)?depth:fallback;
}
float fxReceiverBias(float depth) {
 // Small numeric bias in axial world units. Texel footprint scaling handles
 // float/tangent roundoff without skipping any object's real self-occlusion.
 float texelFootprint=2.0*depth*max(uLightTanHalfFov.x/uShadowResolution.x,uLightTanHalfFov.y/uShadowResolution.y);
 return (max(2e-5*uSceneScale,3e-6*depth)+.002*texelFootprint)*max(uOffsetScale,.05);
}

void fxShadowDepth() {
 Ray ray=fxCameraRay(vUv,uLightInvProjection,uLightWorld);
 // Perspective clip distances are axial; convert them to this ray's t interval.
 vec3 localDirection=mat3(uLightView)*ray.direction;
 float axialPerT=-localDirection.z;
 ray.tMin=uLightNearFar.x/axialPerT;ray.tMax=uLightNearFar.y/axialPerT;
 QueryResult q=rtQueryMode(ray,-1,0);
 if(q.status>RT_HIT){outColor=vec4(1,0,0,-1);return;}
 if(q.status==RT_MISS){outColor=vec4(1,0,0,0);return;}
 float distance=-(uLightView*vec4(q.hit.position,1)).z;
 outColor=vec4(fxDepth(distance),distance,float(q.hit.objectId),1);
}

void fxGbuffer(bool radiance) {
 Ray ray=fxCameraRay(vUv,uInvProjection,uCameraWorld);QueryResult q=rtQueryMode(ray,-1,0);
 if(q.status>RT_HIT){outColor=vec4(0,0,0,-2);return;}
 if(q.status==RT_MISS){outColor=radiance?vec4(uEnvironment,-1):vec4(0,0,0,-1);return;}
 // RGB remains linear. Object IDs let SSR reject its starting mirror plane.
 if(radiance)outColor=vec4(rtLocalShade(q.hit,ray.direction),float(q.hit.objectId+1));
 else outColor=vec4(q.hit.position,-(uEffectView*vec4(q.hit.position,1)).z);
}

// Returns visibility and diagnostic coverage, never disguising absent map data
// as a geometry-reference result. A center perspective map covers one frustum.
void fxShadow(Hit hit,bool soft) {
 vec4 lightPoint=uLightView*vec4(hit.position,1),clip=uLightProjection*lightPoint;
 float receiver=-lightPoint.z;
 vec2 uv=clip.xy/clip.w*.5+.5;
 if(clip.w<=0.0||receiver<uLightNearFar.x||receiver>uLightNearFar.y||!fxOnscreen(uv)){
  outColor=vec4(.55,.16,.015,0);return;
 }
 // Receiver-plane depth varies across samples; estimate it analytically from
 // the hit plane in light-view space to reduce tilted-plane self shadowing.
 vec3 localNormal=normalize(mat3(uLightView)*hit.geometricNormal);
 float planeConstant=dot(localNormal,lightPoint.xyz);
 vec2 centerUv;vec4 center=fxShadowTexel(uv,centerUv);
 float centerReceiver=fxReceiverPlaneDepth(centerUv,localNormal,planeConstant,receiver);
 if(center.a<0.0){outColor=fxFailure(RT_INVALID);return;}
 if(!soft){
  float visibility=centerReceiver-fxReceiverBias(centerReceiver)<=fxLinearDepth(center.r)?1.0:0.0;
  outColor=uEffectDebug==2?vec4(vec3(fxLinearDepth(center.r)/uLightNearFar.y),1):vec4(vec3(visibility),1);return;
 }
 vec2 searchRadius=uLightHalfSize*(receiver-uLightNearFar.x)/(2.0*uLightTanHalfFov*uLightNearFar.x*receiver);
 searchRadius=min(searchRadius,vec2(1));
 float blockers=0.0,blockerSum=0.0;bool complete=true;
 // A center-biased spiral resolves narrow blockers even when the conservative
 // near-plane search bound spans most of the map. PCSS remains an approximation.
 for(int i=0;i<81;i++){
  float f=float(i)/80.0,angle=float(i)*2.39996323;
  vec2 delta=vec2(cos(angle),sin(angle))*f*f*searchRadius;
  vec2 sampleUv=uv+delta;if(!fxOnscreen(sampleUv))continue;
  vec2 texelUv;vec4 sampleDepth=fxShadowTexel(sampleUv,texelUv);if(sampleDepth.a<0.0){complete=false;continue;}
  float sampleReceiver=fxReceiverPlaneDepth(texelUv,localNormal,planeConstant,receiver);
  float blocker=fxLinearDepth(sampleDepth.r);
  if(sampleDepth.a>0.0&&blocker<sampleReceiver-fxReceiverBias(sampleReceiver)){
   // Reject blockers that cannot fall between any point of this rectangular
   // emitter and this receiver, rather than averaging distant room walls.
   vec2 footprint=fxPenumbraUv(receiver,blocker)+1.0/uShadowResolution;
   if(all(lessThanEqual(abs(texelUv-uv),footprint))){blockerSum+=blocker;blockers+=1.0;}
  }
 }
 if(!complete){outColor=fxFailure(RT_INVALID);return;}
 if(blockers==0.0){outColor=vec4(vec3(1),1);return;}
 float averageBlocker=blockerSum/blockers;vec2 radius=fxPenumbraUv(receiver,averageBlocker);
 if(uEffectDebug==3){outColor=vec4(clamp(radius*uShadowResolution/24.0,0.0,1.0),0,1);return;}
 float visible=0.0,samples=0.0;
 for(int y=0;y<9;y++)for(int x=0;x<9;x++){
  vec2 delta=(vec2(float(x),float(y))/8.0*2.0-1.0)*radius,st=uv+delta;
  if(!fxOnscreen(st)){complete=false;continue;}
  vec2 texelUv;vec4 sampleDepth=fxShadowTexel(st,texelUv);if(sampleDepth.a<0.0){complete=false;continue;}
  float sampleReceiver=fxReceiverPlaneDepth(texelUv,localNormal,planeConstant,receiver);
  float blocker=fxLinearDepth(sampleDepth.r);
  visible+=sampleReceiver-fxReceiverBias(sampleReceiver)<=blocker?1.0:0.0;samples+=1.0;
 }
 if(!complete||samples==0.0){outColor=vec4(.55,.16,.015,0);return;}
 outColor=uEffectDebug==2?vec4(vec3(averageBlocker/uLightNearFar.y),1):vec4(vec3(visible/samples),1);
}

vec3 fxSsr(Hit primary,vec3 incoming,out int termination) {
 vec3 direction=normalize(reflect(incoming,primary.shadingNormal)),origin=fxOffset(primary,direction);
 float previousT=max(uRayMin,.025),previousDelta=-1.0;bool previousValid=false;
 termination=2; // 1 depth hit, 2 no crossing, 3 screen exit, 4 behind camera, 5 invalid depth.
 for(int i=0;i<96;i++){
  // Short near steps make contact hits less likely to jump over a thin surface.
  float f=float(i+1)/96.0,t=.025+uSsrMaxDistance*f*f;
  vec3 point=origin+direction*t;vec4 view=uEffectView*vec4(point,1),clip=uEffectProjection*view;
  if(clip.w<=0.0){termination=4;break;}
  vec2 uv=clip.xy/clip.w*.5+.5;if(!fxOnscreen(uv)){termination=3;break;}
  vec4 position=texture(tEffectPosition,uv),local=texture(tEffectRadiance,uv);
  if(position.a==-2.0){termination=5;break;}
  if(position.a<=0.0||int(round(local.a))-1==primary.objectId){previousValid=false;previousT=t;continue;}
  float delta=-view.z-position.a;
  // Refine every front-to-back depth crossing before applying thickness. A
  // coarse march can jump over the entire thickness interval between steps.
  bool crossing=previousValid&&previousDelta<0.0&&delta>=0.0;
  bool isolated=!previousValid&&delta>=0.0&&delta<=uSsrThickness;
  if(crossing||isolated){
   float lo=previousT,hi=t;
   for(int refine=0;refine<7;refine++){
    float middle=(lo+hi)*.5;vec4 vm=uEffectView*vec4(origin+direction*middle,1),cm=uEffectProjection*vm;
    vec2 um=cm.xy/cm.w*.5+.5;vec4 pm=texture(tEffectPosition,um);
    if(pm.a>0.0&&-vm.z>=pm.a)hi=middle;else lo=middle;
   }
   vec4 hitView=uEffectView*vec4(origin+direction*hi,1),hitClip=uEffectProjection*hitView;
   vec2 hitUv=hitClip.xy/hitClip.w*.5+.5;
   if(hitClip.w>0.0&&fxOnscreen(hitUv)){
    vec4 foundPosition=texture(tEffectPosition,hitUv),found=texture(tEffectRadiance,hitUv);
    float hitDelta=-hitView.z-foundPosition.a;
    if(foundPosition.a>0.0&&found.a>0.0&&int(round(found.a))-1!=primary.objectId&&hitDelta>=0.0&&hitDelta<=uSsrThickness){termination=1;return found.rgb;}
   }
  }
  previousDelta=delta;previousValid=true;previousT=t;
 }
 return uEnvironment;
}

void fxReflection(Ray primaryRay,Hit primary,bool ssr) {
 vec4 material=texelFetch(tMaterials,ivec2(0,primary.materialId),0);
 if(int(round(material.a))!=1){outColor=vec4(rtLocalShade(primary,primaryRay.direction),1);return;}
 if(ssr){
  int termination;vec3 local=fxSsr(primary,primaryRay.direction,termination);
  if(uEffectDebug==1){outColor=vec4(termination==1?vec3(.05,.8,.2):termination==3?vec3(1,.35,.03):termination==5?vec3(1,0,1):vec3(.05,.12,.5),termination==5?0:1);return;}
  outColor=vec4(material.rgb*local,termination==5?0:1);return;
 }
 // Independent planar reference: reflect the whole camera ray in y=0, then
 // discard the virtual-camera segment before its intersection with that plane.
 if(abs(primary.position.y)>1e-3||abs(primary.geometricNormal.y)<.999){outColor=vec4(1,0,1,0);return;}
 Ray reflected=primaryRay;reflected.origin.y=-reflected.origin.y;reflected.direction.y=-reflected.direction.y;
 if(abs(reflected.direction.y)<1e-8){outColor=vec4(uEnvironment,1);return;}
 float planeT=-reflected.origin.y/reflected.direction.y;
 float epsilon=max(uRayMin,2e-5*max(uSceneScale,max(abs(primary.position.x),abs(primary.position.z)))*uOffsetScale);
 reflected.tMin=planeT+max(epsilon,1e-6);reflected.tMax=planeT+uRayMax;
 QueryResult q=rtQueryMode(reflected,-1,0);
 if(q.status>RT_HIT){outColor=fxFailure(q.status);return;}
 vec3 local=q.status==RT_HIT?rtLocalShade(q.hit,reflected.direction):uEnvironment;
 outColor=vec4(material.rgb*local,1);
}

void main(){
 if(uEffectPass==0){fxShadowDepth();return;}
 if(uEffectPass==1||uEffectPass==2){fxGbuffer(uEffectPass==2);return;}
 Ray ray=fxCameraRay(vUv,uInvProjection,uCameraWorld);QueryResult primary=rtQueryMode(ray,-1,0);
 if(primary.status>RT_HIT){outColor=fxFailure(primary.status);return;}
 if(primary.status==RT_MISS){outColor=vec4(uEffectPass==3||uEffectPass==4?vec3(0):uEnvironment,1);return;}
 if(uEffectPass==3||uEffectPass==4){fxShadow(primary.hit,uEffectPass==4);return;}
 fxReflection(ray,primary.hit,uEffectPass==5);
}
