precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth, tNormal;
uniform mat4 inverseProjection, projection;
uniform vec2 resolution, inspectUv;
uniform float radius, seed;
uniform int slices, steps, algorithm, debugMode;
const float PI = 3.141592653589793;
const float BIAS = 0.012;
// Nearest depth and normal reads describe the same rasterized texel center.
// Keep this unclamped: an off-screen request must remain invalid.
vec2 texelCenter(vec2 uv) { return (floor(uv * resolution) + 0.5) / resolution; }
vec3 positionAt(vec2 uv) {
  uv = texelCenter(uv);
  vec4 p = inverseProjection * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
bool inside(vec2 uv) { return all(greaterThanEqual(uv,vec2(0.0))) && all(lessThan(uv,vec2(1.0))); }
float hash(vec2 p) { return fract(sin(dot(p,vec2(12.9898,78.233))+seed)*43758.5453); }
// @snippet slice-start
float primitive(float theta, float gamma) {
  return -cos(gamma) * cos(theta) * cos(theta) * 0.5
       + sin(gamma) * (theta * 0.5 - sin(2.0 * theta) * 0.25);
}
float integrateSlice(float gamma, float low, float high, float projectedLength) {
  float a = max(low, gamma - PI * 0.5);
  float b = min(high, gamma + PI * 0.5);
  if (a >= b || projectedLength < 0.00001) return 0.0;
  float left = a < 0.0 ? primitive(a,gamma)-primitive(min(b,0.0),gamma) : 0.0;
  float right = b > 0.0 ? primitive(b,gamma)-primitive(max(a,0.0),gamma) : 0.0;
  return projectedLength * (left + right);
}
// @snippet slice-end
vec3 sliceTangent(vec3 v, vec2 direction) {
  vec3 t = vec3(direction / (resolution * vec2(projection[0][0],projection[1][1])),0.0);
  return normalize(t-v*dot(t,v));
}
vec4 horizonSample(vec2 uv, vec3 p, vec3 n, vec3 v, vec2 direction, float gamma, int k, float signSide) {
  float f = (float(k)+0.65)/float(steps);
  float pixelRadius = min(150.0, radius * projection[1][1] * resolution.y / (-2.0*p.z));
  vec2 suv = texelCenter(uv + signSide * direction * max(1.5, f*f*pixelRadius) / resolution);
  if(!inside(suv) || texture2D(tNormal,suv).a < 0.5) return vec4(suv,-1.0,-1.0);
  vec3 delta = positionAt(suv)-p;
  float d=length(delta);
  if(d < BIAS || d > radius) return vec4(suv,-1.0,-1.0);
  // Rounding the screen ray to a texel changes its azimuth. Transport its
  // angle relative to the actual slice's surface tangent into this slice.
  // Merely projecting delta onto this slice would move a tilted flat surface
  // above its tangent and create false AO. Coplanar samples stay tangent here.
  vec3 lateral=delta-v*dot(delta,v);
  float lateralLength=length(lateral);
  if(lateralLength<0.00001) return vec4(suv,-1.0,-1.0);
  float actualGamma=atan(dot(n,signSide*lateral/lateralLength),dot(n,v));
  float rawTheta=acos(clamp(dot(delta/d,v),-1.0,1.0));
  float correctedTheta=clamp(rawTheta+signSide*(gamma-actualGamma),0.0,PI);
  // Debug metadata: texel-center UV, actual distance, corrected horizon cosine.
  return vec4(suv,d,cos(correctedTheta));
}
vec4 sliceInfo(vec2 uv,vec3 p,vec3 n,int index) {
  vec3 v=normalize(-p);
  float phi=(float(index)+hash(floor(uv*resolution)))/float(slices)*PI;
  vec2 direction=vec2(cos(phi),sin(phi));
  vec3 t=sliceTangent(v,direction);
  float nx=dot(n,t), nz=dot(n,v), projectedLength=length(vec2(nx,nz));
  float gamma=atan(nx,nz), hplus=-1.0, hminus=-1.0;
  for(int k=0;k<12;k++) { if(k>=steps) break;
    vec4 sp=horizonSample(uv,p,n,v,direction,gamma,k,1.0), sm=horizonSample(uv,p,n,v,direction,gamma,k,-1.0);
    if(sp.z>0.0) hplus=max(hplus,sp.w);
    if(sm.z>0.0) hminus=max(hminus,sm.w);
  }
  return vec4(gamma,-acos(hminus),acos(hplus),projectedLength);
}
// @snippet ssao-start
vec3 ssaoCandidate(vec2 uv,vec3 p,vec3 n,int index) {
  float count=float(slices*steps*2);
  float a=(float(index)+0.5)/count;
  float angle=2.0*PI*fract(float(index)*0.61803398875+hash(floor(uv*resolution)));
  vec3 tangent=normalize(cross(abs(n.z)<0.9?vec3(0,0,1):vec3(0,1,0),n));
  vec3 bitangent=cross(n,tangent);
  vec3 dir=tangent*(sqrt(a)*cos(angle))+bitangent*(sqrt(a)*sin(angle))+n*sqrt(1.0-a);
  float scale=fract(float(index)*0.754877666+0.17);
  return p+dir*radius*(0.1+0.9*scale*scale);
}
vec4 ssaoSample(vec2 uv,vec3 p,vec3 n,int index) {
  vec3 q=ssaoCandidate(uv,p,n,index);
  vec4 clip=projection*vec4(q,1); vec2 suv=texelCenter(clip.xy/clip.w*.5+.5);
  if(clip.w<=0.0 || !inside(suv) || texture2D(tNormal,suv).a<0.5) return vec4(suv,-1,0);
  vec3 surface=positionAt(suv);
  float d=length(surface-p);
  float blocked=(surface.z >= q.z+BIAS && d<radius)?1.0:0.0;
  return vec4(suv,d,blocked);
}
// @snippet ssao-end
void main(){
  vec2 uv=texelCenter(debugMode==1?inspectUv:vUv);
  vec4 normal=texture2D(tNormal,uv);
  if(normal.a<.5){gl_FragColor=vec4(1,1,1,0);return;}
  vec3 p=positionAt(uv),n=normalize(normal.xyz);
  if(debugMode==1){
    int col=int(gl_FragCoord.x), row=int(gl_FragCoord.y);
    if(row>=slices){gl_FragColor=vec4(0);return;}
    vec4 info=sliceInfo(uv,p,n,row);
    if(col==0) gl_FragColor=info;
    else if(col==1) gl_FragColor=vec4(integrateSlice(info.x,info.y,info.z,info.w),p);
    else if(col==2) gl_FragColor=vec4(n,1.0);
    else {
      int j=(col-3)/3; int record=(col-3)-j*3;
      int k=j/2; float signSide=mod(float(j),2.0)<.5?-1.0:1.0;
      float phi=(float(row)+hash(floor(uv*resolution)))/float(slices)*PI;
      if(k>=steps) gl_FragColor=vec4(0,0,-1,-1);
      else {
        vec4 sampleData=algorithm==1 ? ssaoSample(uv,p,n,row*steps*2+j) : horizonSample(uv,p,n,normalize(-p),vec2(cos(phi),sin(phi)),info.x,k,signSide);
        if(record==0) gl_FragColor=sampleData;
        else if(record==1) {
          bool valid=inside(sampleData.xy)&&texture2D(tNormal,sampleData.xy).a>.5;
          gl_FragColor=valid?vec4(positionAt(sampleData.xy),1.0):vec4(0.0);
        } else gl_FragColor=algorithm==1?vec4(ssaoCandidate(uv,p,n,row*steps*2+j),1.0):vec4(0.0);
      }
    }return;
  }
  float value=0.0;
  if(algorithm==0){for(int i=0;i<8;i++){if(i>=slices)break;vec4 h=sliceInfo(uv,p,n,i);value+=integrateSlice(h.x,h.y,h.z,h.w);}value/=float(slices);}
  // @snippet horizon-start
  else if(algorithm==2){
    // HBAO-inspired teaching variant: hard radius, no distance falloff.
    // Per-side occluded angular measure: sin(horizon) - sin(tangent).
    for(int i=0;i<8;i++){
      if(i>=slices)break;
      vec4 h=sliceInfo(uv,p,n,i);
      float tangentPlus=-sin(h.x), tangentMinus=sin(h.x);
      value+=max(0.0,cos(h.z)-tangentPlus)+max(0.0,cos(h.y)-tangentMinus);
    }
    value=1.0-value/float(2*slices);
  }
  // @snippet horizon-end
  else {for(int i=0;i<192;i++){if(i>=slices*steps*2)break;value+=ssaoSample(uv,p,n,i).w;}value=1.0-value/float(slices*steps*2);}
  gl_FragColor=vec4(vec3(clamp(value,0.0,1.0)),1.0);
}
