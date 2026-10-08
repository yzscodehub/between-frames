import {test} from 'node:test';
import assert from 'node:assert/strict';
import {colorToLinear,evaluateBrdf,integrateBrdf,normalize,schlick} from '../src/lib/pbr/brdf';
import type {PbrMaterial,Vec3} from '../src/lib/pbr/types';
const n:Vec3=[0,0,1],normal:Vec3=[0,0,1],base:Vec3=[.7,.3,.1];
const material=(roughness=.35,metallic=0):PbrMaterial=>({baseColor:base,roughness,metallic});
test('sRGB is decoded before material evaluation',()=>{assert.deepEqual(colorToLinear('#000000'),[0,0,0]);assert.deepEqual(colorToLinear('#ffffff'),[1,1,1]);assert.ok(Math.abs(colorToLinear('#808080')[0]-.21586050011389926)<1e-14);});
test('dielectric F0 and metallic diffuse exclusion remain distinct',()=>{
 const dielectric=evaluateBrdf(material(),n,normal,normal),metal=evaluateBrdf(material(.35,1),n,normal,normal);
 assert.deepEqual(dielectric.f0,[.04,.04,.04]);assert.deepEqual(metal.f0,base);assert.deepEqual(metal.diffuse,[0,0,0]);
 dielectric.diffuse.forEach((v,i)=>assert.ok(Math.abs(v-base[i]*.96/Math.PI)<1e-14));
 assert.deepEqual(schlick(base,1),base);assert.deepEqual(schlick(base,0),[1,1,1]);
});
test('axis-aligned GGX peaks and roughness mapping have an analytic value',()=>{
 for(const r of [.03,.05,.2,.6,1]){const e=evaluateBrdf(material(r),n,normal,normal);assert.equal(e.alpha,r*r);assert.ok(Math.abs(e.d* Math.PI*(r*r)**2-1)<1e-12);assert.equal(e.g,1);}
});
test('the projected NDF integrates to one on a logarithmic slope quadrature',()=>{
 // t=tan(theta), x=log(t/alpha): dOmega*cos(theta)
 // becomes 2*pi*t^2/(1+t^2)^2 dx. This resolves the narrow r=.03 peak.
 for(const roughness of [.03,.15,.5,1]){
  const alpha=roughness*roughness,count=4096,dx=28/count;let integral=0;
  for(let i=0;i<count;i++){const t=alpha*Math.exp(-14+(i+.5)*dx),cosine=1/Math.sqrt(1+t*t),h:Vec3=[t*cosine,0,cosine],d=evaluateBrdf(material(roughness),n,h,h).d;integral+=2*Math.PI*d*t*t/((1+t*t)**2)*dx;}
  assert.ok(Math.abs(integral-1)<2e-7,String(integral));
 }
});
test('RGB BRDF is reciprocal for valid direction pairs',()=>{
 for(let i=1;i<=24;i++){const v=normalize([Math.sin(i),Math.cos(i*.7),.1+i/24]),l=normalize([Math.cos(i*.3),Math.sin(i*.6),.2+(24-i)/24]);for(const metal of [0,.5,1]){
  const a=evaluateBrdf(material(.03+i/26,metal),n,v,l),b=evaluateBrdf(material(.03+i/26,metal),n,l,v);
  a.brdf.forEach((value,c)=>assert.ok(Math.abs(value-b.brdf[c])<1e-11));
 }}
});
test('invalid reflection hemispheres return finite zero contribution',()=>{
 for(const l of [[1,0,0],[0,0,-1]] as Vec3[]){const e=evaluateBrdf(material(),n,normal,l);assert.deepEqual(e.brdf,[0,0,0]);assert.ok(Object.values(e).flat().every(Number.isFinite));}
});
test('importance integration resolves a narrow perfect-conductor lobe',()=>{
 const e=integrateBrdf({baseColor:[1,1,1],roughness:.03,metallic:1},1,16384);
 assert.ok(Math.abs(e.specular[0]-1)<.002);assert.deepEqual(e.diffuse,[0,0,0]);
});
test('rough white GGX integral matches the independent closed form 1-ln(2)',()=>{
 const e=integrateBrdf({baseColor:[1,1,1],roughness:1,metallic:1},1,16384);
 assert.ok(Math.abs(e.specular[0]-(1-Math.log(2)))<.0002);
});
test('tested single-scattering conductor directions do not create energy',()=>{
 for(const roughness of [.03,.2,.6,1])for(const noV of [.05,.2,1]){
  const e=integrateBrdf({baseColor:[1,1,1],roughness,metallic:1},noV,8192);
  assert.ok(e.total.every(v=>v>=0&&v<=1.005),JSON.stringify({roughness,noV,e}));
 }
});
test('the approximate diffuse coupling exposes rather than clamps its grazing excess',()=>{
 const e=integrateBrdf({baseColor:[1,1,1],roughness:.12,metallic:0},.05,16384);
 assert.ok(e.total[0]>1.5);assert.ok(e.total[0]===e.diffuse[0]+e.specular[0]);
 assert.throws(()=>integrateBrdf(material(),0),RangeError);assert.throws(()=>integrateBrdf(material(),1,1000),RangeError);
});
