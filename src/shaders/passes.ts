export const fullscreenVertex = `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`;
export const normalVertex = `varying vec3 vNormal;void main(){vNormal=normalMatrix*normal;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
export const normalFragment = `varying vec3 vNormal;uniform float surfaceId;void main(){gl_FragColor=vec4(normalize(vNormal),surfaceId);}`;
export const filterFragment = `precision highp float;varying vec2 vUv;uniform sampler2D source,tDepth,tNormal;uniform vec2 resolution;uniform mat4 inverseProjection;
float zAt(vec2 uv){vec4 p=inverseProjection*vec4(uv*2.-1.,texture2D(tDepth,uv).r*2.-1.,1.);return p.z/p.w;}
void main(){vec4 n=texture2D(tNormal,vUv);if(n.a<.5){gl_FragColor=vec4(1,1,1,0);return;}float z=zAt(vUv),sum=0.,weight=0.;for(int y=-2;y<=2;y++)for(int x=-2;x<=2;x++){vec2 uv=vUv+vec2(float(x),float(y))/resolution;vec4 other=texture2D(tNormal,uv);if(other.a<.5)continue;float w=exp(-float(x*x+y*y)/4.)*exp(-abs(zAt(uv)-z)*30.)*pow(max(0.,dot(n.xyz,other.xyz)),16.);sum+=texture2D(source,uv).r*w;weight+=w;}gl_FragColor=vec4(vec3(sum/max(weight,.0001)),1.);}`;
export const displayFragment = `
precision highp float;
varying vec2 vUv;
uniform sampler2D source,rawAO,tDepth,tNormal,reference;
uniform mat4 inverseProjection,cameraWorld;
uniform int view;
uniform vec2 selected,focusUv,focusHalf;
uniform float aspect;
vec3 palette(float id){
 if(id<1.5)return vec3(.34,.39,.43);
 if(id<2.5)return vec3(.17,.40,.60);
 if(id<3.5)return vec3(.72,.74,.70);
 if(id<4.5)return vec3(.64,.30,.16);
 if(id<5.5)return vec3(.20,.37,.33);
 return vec3(.10,.15,.20);
}
void main(){
 if(view==10){gl_FragColor=vec4(.90,.93,.95,1.);return;}
 vec4 n=texture2D(tNormal,vUv);vec3 col=mix(vec3(.84,.89,.92),vec3(.96,.97,.98),vUv.y);
 if(n.a>.5){
  float a=texture2D(source,vUv).r;
  vec4 p=inverseProjection*vec4(vUv*2.-1.,texture2D(tDepth,vUv).r*2.-1.,1.);
  vec3 world=(cameraWorld*vec4(p.xyz/p.w,1.)).xyz;
  vec3 nw=normalize(mat3(cameraWorld)*n.xyz);
  if(view==0||view==8){
    if(view==8)a=1.;
    vec3 base=palette(n.a);
    if(n.a<1.5){vec2 g=abs(fract(world.xz+.5)-.5)/max(fwidth(world.xz),vec2(.0001));float line=1.-min(min(g.x,g.y),1.);base=mix(base,base*.78,line*.32);}
    float direct=max(0.,dot(nw,normalize(vec3(-.6,1.,.8))));
    float sky=.80+.20*max(nw.y,0.);
    col=base*(.76*a*sky+.24*direct);
    col=pow(col,vec3(1./2.2));
  }else if(view==9)col=vec3(1.);else if(view==1)col=vec3(a);
  else if(view==2)col=vec3(texture2D(rawAO,vUv).r);
  else if(view==3)col=vec3(clamp(-p.z/p.w/15.,0.,1.));
  else if(view==4)col=n.xyz*.5+.5;
  else if(view==5)col=vec3(texture2D(reference,vUv).r);
  else {float d=abs(a-texture2D(reference,vUv).r);col=mix(vec3(.06,.14,.22),vec3(1.,.36,.17),clamp(d*4.,0.,1.));}
 }
 if(selected.x>=0.){float dist=length((vUv-selected)*vec2(aspect,1.));if(dist>.011&&dist<.016)col=vec3(.95,.65,.19);}
 if(focusUv.x>=0.){
  vec2 delta=abs(vUv-focusUv),edge=abs(delta-focusHalf),pixel=fwidth(vUv)*1.3;
  if((edge.x<pixel.x&&delta.y<focusHalf.y)||(edge.y<pixel.y&&delta.x<focusHalf.x))col=mix(col,vec3(.93,.60,.19),.8);
 }
 gl_FragColor=vec4(col,1.);
}`;
