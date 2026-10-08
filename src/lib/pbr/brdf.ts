import type {BrdfTerms,PbrIntegral,PbrMaterial,Vec3} from './types';
const PI=Math.PI;
export const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const normalize=(a:Vec3):Vec3=>{const length=Math.hypot(...a);return length>0?a.map(v=>v/length) as Vec3:[0,0,0];};
const scale=(a:Vec3,s:number)=>a.map(v=>v*s) as Vec3;
const add=(a:Vec3,b:Vec3)=>a.map((v,i)=>v+b[i]) as Vec3;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
export function colorToLinear(hex:string):Vec3 {
 return [1,3,5].map(offset=>{const v=parseInt(hex.slice(offset,offset+2),16)/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}) as Vec3;
}
export function schlick(f0:Vec3,cosine:number):Vec3{return f0.map(value=>value+(1-value)*(1-clamp(cosine))**5) as Vec3;}
/** Independent double oracle uses the slope-domain NDF and lambda form of
 * Smith masking, rather than evaluating the shader's algebra line by line. */
export function evaluateBrdf(material:PbrMaterial,normal:Vec3,view:Vec3,light:Vec3):BrdfTerms {
 const noL=clamp(dot(normal,light)),noV=clamp(dot(normal,view)),half=normalize(add(view,light));
 const noH=clamp(dot(normal,half)),voH=clamp(dot(view,half)),alpha=Math.max(.03,Math.min(1,material.roughness))**2;
 const f0=material.baseColor.map(c=>.04*(1-material.metallic)+c*material.metallic) as Vec3;
 const f=schlick(f0,voH);let d=0,g1L=0,g1V=0;
 if(noL>0&&noV>0&&noH>0&&voH>0){
  const cos2=noH*noH,tan2=(1-cos2)/cos2;
  d=1/(PI*alpha*alpha*cos2*cos2*(1+tan2/(alpha*alpha))**2);
  const masking=(cosine:number)=>2/(1+Math.sqrt(1+alpha*alpha*(1-cosine*cosine)/(cosine*cosine)));
  g1L=masking(noL);g1V=masking(noV);
 }
 const g=g1L*g1V;
 const diffuse=material.baseColor.map((c,i)=>noL>0&&noV>0?(1-material.metallic)*(1-f[i])*c/PI:0) as Vec3;
 const specular=f.map(c=>noL>0&&noV>0?c*d*g/(4*noL*noV):0) as Vec3;
 return {noL,noV,noH,voH,alpha,d,g1L,g1V,g,f0,f,diffuse,specular,brdf:add(diffuse,specular)};
}
function radicalInverse(index:number){let value=0,place=.5;for(let i=index>>>0;i;i>>>=1,place*=.5)value+=(i&1)*place;return value;}
/** Each contribution estimates integral f(wi,wo) cos(theta_i) dwi.
 * Specular uses GGX half-vector importance sampling, so narrow low-r peaks
 * remain represented. Rejected lower-hemisphere reflections contribute zero. */
export function integralSample(material:PbrMaterial,noV:number,index:number,capacity:number):{diffuse:Vec3;specular:Vec3}{
 const k=(index*(Math.floor(capacity*.61803398875)|1))%capacity,u=(k+.5)/capacity,phi=2*PI*radicalInverse(k);
 const v:Vec3=[Math.sqrt(Math.max(0,1-noV*noV)),0,noV],n:Vec3=[0,0,1];
 const z=Math.sqrt(1-u),radius=Math.sqrt(u),l:Vec3=[radius*Math.cos(phi),radius*Math.sin(phi),z];
 const diffuse=scale(evaluateBrdf(material,n,v,l).diffuse,PI);
 const alpha=Math.max(.03,Math.min(1,material.roughness))**2,slope=alpha*Math.sqrt(u/(1-u)),h=normalize([slope*Math.cos(phi),slope*Math.sin(phi),1]);
 const voH=dot(v,h),reflected=add(scale(h,2*voH),scale(v,-1));
 let specular:Vec3=[0,0,0];
 if(voH>0&&reflected[2]>0){const e=evaluateBrdf(material,n,v,reflected),pdf=e.d*h[2]/(4*voH);if(pdf>0)specular=scale(e.specular,reflected[2]/pdf);}
 return {diffuse,specular};
}
export function integrateBrdf(material:PbrMaterial,noV:number,samples=8192):PbrIntegral {
 if(!(noV>0&&noV<=1)||!Number.isInteger(samples)||samples<2||(samples&(samples-1))!==0)throw new RangeError('Expected positive NoV and a power-of-two sample count.');
 const diffuse:Vec3=[0,0,0],specular:Vec3=[0,0,0];let checkpoint:Vec3=[0,0,0];
 for(let i=0;i<samples;i++){const sample=integralSample(material,noV,i,samples);for(let c=0;c<3;c++){diffuse[c]+=sample.diffuse[c];specular[c]+=sample.specular[c];}if(i+1===samples/2)checkpoint=diffuse.map((d,c)=>(d+specular[c])/(i+1)) as Vec3;}
 const d=scale(diffuse,1/samples),s=scale(specular,1/samples),total=add(d,s);
 return {diffuse:d,specular:s,total,samples,convergence:total.map((v,c)=>Math.abs(v-checkpoint[c])) as Vec3};
}
