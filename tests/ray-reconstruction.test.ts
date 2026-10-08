import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as T from 'three';
import * as shaders from '../src/shaders/ray/reconstruction';

// Exercise the real helper without a WebGL context. Only the bundler's raw
// text import is stubbed; the Three targets and lifecycle code are unchanged.
const source=fs.readFileSync(new URL('../src/lib/ray/reconstruction.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsObject:{Reconstruction?:any}={};
new Function('require','exports',compiled)((name:string)=>name==='three'?T:name.endsWith('?raw')?{default:''}:shaders,exportsObject);
const Reconstruction=exportsObject.Reconstruction;
const options=(frame:number,spatial=true)=>({frame,history:true,spatial,view:0,movingObject:6,previousOffset:[.1,0,0] as [number,number,number]});

test('present and repeated process never re-accumulate or exchange the same frame',()=>{
 const camera=new T.PerspectiveCamera(45,2,.1,50),helper=new Reconstruction(8,4,camera,{}),raw=new T.Texture(),out=new T.WebGLRenderTarget(8,4),calls:any[]=[];
 const pass=(material:any,target:any)=>calls.push({material,target,hasHistory:helper.temporalMaterial.uniforms.uHasHistory.value});
 helper.process(raw,out,pass,options(0));assert.equal(calls.length,6);assert.equal(helper.lastFrame,0);assert.equal(helper.index,1);
 const index=helper.index,previousVP=helper.previousVP.clone(),history=helper.composeMaterial.uniforms.uHistory.value;
 helper.present(out,pass,4);assert.equal(calls.length,7);assert.equal(calls.at(-1).material,helper.composeMaterial);
 helper.process(new T.Texture(),out,pass,{...options(0),view:2});assert.equal(calls.length,8);assert.equal(helper.index,index);assert.equal(helper.lastFrame,0);assert.ok(helper.previousVP.equals(previousVP));
 assert.equal(helper.composeMaterial.uniforms.uHistory.value,history);assert.equal(helper.composeMaterial.uniforms.uRaw.value,raw);
 helper.dispose();raw.dispose();out.dispose();
});

test('continuous frames reuse history; gaps, reset and real resizes reject it',()=>{
 const camera=new T.PerspectiveCamera(45,2,.1,50),helper=new Reconstruction(8,4,camera,{}),raw=new T.Texture(),out=new T.WebGLRenderTarget(8,4),accepted:number[]=[];
 const pass=(material:any)=>{if(material===helper.temporalMaterial)accepted.push(material.uniforms.uHasHistory.value);};
 helper.process(raw,out,pass,options(0,false));helper.process(raw,out,pass,options(1,false));helper.process(raw,out,pass,options(4,false));assert.deepEqual(accepted,[0,1,0]);
 assert.equal(helper.getFilteredTarget(),helper.history[helper.index]);
 helper.resize(8,4);assert.equal(helper.lastFrame,4);helper.reset();assert.equal(helper.present(out,pass,0),false);
 helper.process(raw,out,pass,options(4,false));assert.equal(accepted.at(-1),0);helper.resize(16,8);assert.equal(helper.lastFrame,-1);assert.equal(helper.geometry[0].width,16);
 helper.dispose();helper.dispose();assert.throws(()=>helper.process(raw,out,pass,options(5)),/disposed/);raw.dispose();out.dispose();
});

test('three a-trous passes use independent ping-pong targets with steps 1, 2, 4',()=>{
 const helper=new Reconstruction(8,4,new T.PerspectiveCamera(),{}),raw=new T.Texture(),out=new T.WebGLRenderTarget(8,4),steps:number[]=[];
 helper.process(raw,out,(material:any,target:any)=>{if(material!==helper.atrousMaterial)return;steps.push(material.uniforms.uStep.value);assert.notEqual(material.uniforms.uSource.value,target.texture);},options(0));
 assert.deepEqual(steps,[1,2,4]);assert.equal(helper.composeMaterial.uniforms.uFiltered.value,helper.filtered[0].texture);assert.equal(helper.getFilteredTarget(),helper.filtered[0]);helper.dispose();raw.dispose();out.dispose();
});

test('independent temporal-weight oracle stays normalized with an effective 32-frame age',()=>{
 // Distribution weights expose the cap directly: the fresh sample always has
 // at least 1/32 weight, while older sample weights decay rather than vanish.
 let weights:number[]=[];
 for(let frame=0;frame<120;frame++){
  const alpha=1/(Math.min(frame,31)+1);weights=weights.map(w=>w*(1-alpha));weights.push(alpha);
  assert.ok(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(weights.at(-1)!>=1/32);
 }
 assert.ok(Math.abs(weights.at(-1)!-1/32)<1e-12);assert.ok(weights[0]>0&&weights[0]<.01);
 // Equal-weight two-sample moments are a known independent reference.
 const values=[.9,1.1],m1=values.reduce((s,v)=>s+v,0)/2,m2=values.reduce((s,v)=>s+v*v,0)/2;
 assert.ok(Math.abs(m1-1)<1e-12);assert.ok(Math.abs(m2-m1*m1-.01)<1e-12);
});
