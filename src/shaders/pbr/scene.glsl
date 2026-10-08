// Prepend precision declarations and brdf.glsl. World directions point away
// from the surface; all material colors and radiance remain linear.
in vec2 vUv;
out vec4 outColor;
uniform mat4 uInvProjection;
uniform mat4 uCameraWorld;
uniform vec3 uBaseColor;
uniform vec3 uLightDirection;
uniform float uRoughness;
uniform float uMetallic;
uniform float uIntensity;
uniform int uCompare;
uniform int uShadows;
uniform int uView;
uniform int uDebug;
uniform vec2 uInspectUv;
const float PBR_PI=3.14159265358979323846;

struct PbrHit {float t;vec3 position;vec3 normal;int objectId;};
vec4 sphere(int id) {
  if(id==1)return vec4(-1.65,.7,0.,.7);
  if(id==2)return vec4(0.,.7,0.,.7);
  return vec4(1.65,.7,0.,.7);
}
float sphereDistance(vec3 origin,vec3 direction,vec4 ball) {
  vec3 relative=origin-ball.xyz;
  float center=-dot(relative,direction),a=dot(direction,direction);
  center/=a;
  vec3 perpendicular=relative+center*direction;
  float radial=ball.w*ball.w-dot(perpendicular,perpendicular);
  if(radial<0.)return 1e20;
  float span=sqrt(radial/a),near=center-span,far=center+span;
  return near>1e-4?near:far>1e-4?far:1e20;
}
PbrHit intersectScene(vec3 origin,vec3 direction) {
  PbrHit hit;hit.t=1e20;hit.objectId=-1;hit.position=vec3(0.);hit.normal=vec3(0.);
  for(int id=1;id<=3;id++){
    if(uCompare==0&&id!=2)continue;
    vec4 ball=sphere(id);float t=sphereDistance(origin,direction,ball);
    if(t<hit.t){hit.t=t;hit.objectId=id;hit.position=origin+direction*t;hit.normal=normalize(hit.position-ball.xyz);}
  }
  if(abs(direction.y)>1e-7){
    float t=-origin.y/direction.y;vec3 p=origin+direction*t;
    if(t>1e-4&&t<hit.t&&abs(p.x)<4.8&&abs(p.z)<4.){hit.t=t;hit.objectId=0;hit.position=p;hit.normal=vec3(0.,1.,0.);}
  }
  return hit;
}
float visibility(PbrHit hit,vec3 light) {
  if(uShadows==0)return 1.;
  vec3 origin=hit.position+hit.normal*0.0005;
  for(int id=1;id<=3;id++){
    if(uCompare==0&&id!=2)continue;
    if(sphereDistance(origin,light,sphere(id))<1e19)return 0.;
  }
  return 1.;
}
void main() {
  vec2 uv=uDebug!=0?uInspectUv:vUv;
  vec4 point=uInvProjection*vec4(uv*2.-1.,0.,1.);
  vec3 origin=uCameraWorld[3].xyz,direction=normalize(mat3(uCameraWorld)*(point.xyz/point.w));
  PbrHit hit=intersectScene(origin,direction);
  if(hit.objectId<0){
    outColor=uDebug!=0?vec4(0.,0.,0.,-1.):vec4(mix(vec3(.022,.038,.063),vec3(.11,.17,.22),vUv.y),1.);
    return;
  }
  vec3 base=uBaseColor;float roughness=uRoughness,metallic=uMetallic;
  if(hit.objectId==1)roughness=.12;
  if(hit.objectId==3)roughness=.8;
  if(hit.objectId==0){base=vec3(.22,.255,.29);roughness=.75;metallic=0.;}
  vec3 n=hit.normal,v=normalize(origin-hit.position),l=normalize(uLightDirection),sum=v+l;
  vec3 h=dot(sum,sum)>1e-20?normalize(sum):vec3(0.);
  float noL=clamp(dot(n,l),0.,1.),noV=clamp(dot(n,v),0.,1.),noH=clamp(dot(n,h),0.,1.),voH=clamp(dot(v,h),0.,1.);
  float alpha=pow(clamp(roughness,.03,1.),2.);
  // @snippet material-start
  vec3 f0=mix(vec3(.04),base,metallic);
  vec3 f=pbrSchlick(f0,voH);
  float d=0.,g1L=0.,g1V=0.,g=0.;
  vec3 diffuse=vec3(0.),specular=vec3(0.);
  if(noL>0.&&noV>0.&&noH>0.&&voH>0.){
    d=pbrGgxD(noH,alpha);
    g1L=pbrSmithG1(noL,alpha);g1V=pbrSmithG1(noV,alpha);g=g1L*g1V;
    diffuse=(1.-metallic)*(vec3(1.)-f)*base/PBR_PI;
    specular=f*d*g/(4.*noL*noV);
  }
  // @snippet material-end
  float visible=visibility(hit,l);
  vec3 diffuseRadiance=diffuse*uIntensity*noL*visible;
  vec3 specularRadiance=specular*uIntensity*noL*visible;
  vec3 radiance=diffuseRadiance+specularRadiance;
  if(uDebug!=0){
    int pixel=int(floor(gl_FragCoord.x));
    if(pixel==0)outColor=vec4(hit.position,float(hit.objectId));
    else if(pixel==1)outColor=vec4(n,roughness);
    else if(pixel==2)outColor=vec4(noL,noV,noH,voH);
    else if(pixel==3)outColor=vec4(d,g1L,g1V,g);
    else if(pixel==4)outColor=vec4(f,metallic);
    else if(pixel==5)outColor=vec4(diffuse,visible);
    else if(pixel==6)outColor=vec4(specular,uIntensity);
    else if(pixel==7)outColor=vec4(radiance,1.);
    else if(pixel==8)outColor=vec4(v,alpha);
    else if(pixel==9)outColor=vec4(l,1.);
    else if(pixel==10)outColor=vec4(f0,1.);
    else outColor=vec4(base,1.);
    return;
  }
  if(uView==1)radiance=diffuseRadiance;
  else if(uView==2)radiance=specularRadiance;
  else if(uView==3)radiance=vec3(clamp(log2(1.+d)/8.,0.,1.));
  else if(uView==4)radiance=f;
  else if(uView==5)radiance=vec3(g);
  outColor=vec4(radiance,1.);
}
