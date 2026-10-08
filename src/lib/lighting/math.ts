export type V3=[number,number,number];
export const decodeSRGB=(x:number)=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4;
export const encodeSRGB=(x:number)=>x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;
export const hexLinear=(hex:string):V3=>[1,3,5].map(i=>decodeSRGB(parseInt(hex.slice(i,i+2),16)/255)) as V3;
export const dot=(a:V3,b:V3)=>a.reduce((s,x,i)=>s+x*b[i],0);
export const normalize=(v:V3):V3=>{const n=Math.hypot(...v);return v.map(x=>x/n) as V3;};
export function environment(d:V3,preset:number,rotation:number):V3{
 if(preset===0)return [1,1,1];
 const t=rotation*Math.PI/180,c=Math.cos(t),s=Math.sin(t),v:V3=[c*d[0]-s*d[2],d[1],s*d[0]+c*d[2]];
 const a=Math.max(0,dot(v,normalize([-.6,.65,.4])))**(preset===2?512:24),b=Math.max(0,dot(v,normalize([.8,.1,-.5])))**16;
 return [0.06+4*a+.2*b,.08+3*a+.6*b,.12+2*a+1.5*b];
}
// Independent solid-angle quadrature: no GPU Hammersley or half-vector sampler.
export function integrateEnvironment(n:V3,roughness:number,preset:number,rotation:number,diffuse:boolean,samples=65536):V3{
 const v:V3=[0,0,1],nv=dot(n,v),sum:V3=[0,0,0];if(nv<=0)return sum;
 const up:V3=Math.abs(n[2])<.99?[0,0,1]:[0,1,0];const t=normalize([up[1]*n[2]-up[2]*n[1],up[2]*n[0]-up[0]*n[2],up[0]*n[1]-up[1]*n[0]]);const b:V3=[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]];
 const a=roughness**2,a2=a*a;const lambda=(c:number)=>(Math.sqrt(1+a2*(1-c*c)/(c*c))-1)/2;
 for(let i=0;i<samples;i++){const z=(i+.5)/samples,p=2*Math.PI*((i*.6180339887498949)%1),r=Math.sqrt(1-z*z);const l=n.map((x,k)=>x*z+t[k]*r*Math.cos(p)+b[k]*r*Math.sin(p)) as V3;let f=1/Math.PI;
 if(!diffuse){const h=normalize([l[0],l[1],l[2]+1]),nh=Math.max(0,dot(n,h)),vh=Math.max(0,h[2]);const D=a2/(Math.PI*(1+(a2-1)*nh*nh)**2),G=1/((1+lambda(nv))*(1+lambda(z))),F=.04+.96*(1-vh)**5;f=D*G*F/(4*nv*z);}
 const e=environment(l,preset,rotation);for(let k=0;k<3;k++)sum[k]+=e[k]*f*z*2*Math.PI/samples;
 }return sum;
}
export interface Layer {id:number;depth:number;color:V3;alpha:number}
export const BACKGROUND:V3=[.06,.085,.11];
export const LAYER_COLORS:V3[]=[[.9,.12,.06],[.04,.6,.75],[.6,.12,.85]];
// Orthographic finite planes; reference defines ray/plane distances independently.
export function layersAt(u:number,v:number,alpha:number,crossing:boolean):Layer[]{
 const x=2*u-1,y=2*v-1;return LAYER_COLORS.flatMap((color,id)=>{const cx=[-.2,.2,0][id],cy=[0,.04,-.15][id];if(Math.abs(x-cx)>.63||Math.abs(y-cy)>.62)return [];
 const origin:V3=[x,y,-1],normal:V3=crossing?[[ -.23,0,1],[.23,0,1],[0,-.2,1]][id] as V3:[0,0,1];const planePoint:V3=[0,0,[.42,.48,.56][id]];
 const distance=dot(normal,planePoint.map((a,k)=>a-origin[k]) as V3)/normal[2];return [{id,depth:origin[2]+distance,color,alpha}];});
}
export function composite(layers:Layer[],background:V3=BACKGROUND):V3{return layers.reduce((out,l)=>out.map((x,k)=>l.color[k]*l.alpha+x*(1-l.alpha)) as V3,[...background] as V3);}
export const exactComposite=(layers:Layer[])=>composite([...layers].sort((a,b)=>b.depth-a.depth||b.id-a.id));
export function weightedComposite(layers:Layer[],power:number):{color:V3;reveal:number;accum:number[]}{
 let reveal=1;const accum=[0,0,0,0];for(const l of layers){const w=Math.max(.01,(1-l.depth)**power);for(let k=0;k<3;k++)accum[k]+=l.color[k]*l.alpha*w;accum[3]+=l.alpha*w;reveal*=1-l.alpha;}
 return {color:accum.slice(0,3).map((x,k)=>(accum[3]>0?x/accum[3]:0)*(1-reveal)+BACKGROUND[k]*reveal) as V3,reveal,accum};
}
