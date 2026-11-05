import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { compileRecipes, constant, hilbertCoordinate, hilbert3DCoordinate } from '../recipes.js';
import { emitRecipeShader } from '../recipe-shaders.js';
const fixtures=[];
const cases={
 autoHilbert:{x:hilbertCoordinate(0),y:hilbertCoordinate(1),z:'value',w:constant(1)},
 hilbert3D:{x:hilbert3DCoordinate(0),y:hilbert3DCoordinate(1),z:hilbert3DCoordinate(2),w:constant(1)},
 hilbert3DScalar:{x:hilbert3DCoordinate(0,'position',3),y:hilbert3DCoordinate(1,'position',3),z:hilbert3DCoordinate(2,'position',3),w:constant(1)},
 hilbert3DEndpoint:{x:hilbert3DCoordinate(0,constant(1),10),y:hilbert3DCoordinate(1,constant(1),10),z:hilbert3DCoordinate(2,constant(1),10),w:constant(1)},
 hilbert:{x:hilbertCoordinate(0,'position',3),y:hilbertCoordinate(1,'position',3),z:{op:'component',component:0,input:{op:'linear',input:'position'}},w:'value'},
 arithmetic:{x:{op:'fract',input:{op:'multiply',a:'position',b:constant(3)}},y:{op:'divide',a:'position',b:constant(0)},z:{op:'power',input:'position',exponent:2},w:{op:'abs',input:{op:'subtract',a:'position',b:constant(0.5)}}},
 byte:{x:{op:'normalize',min:0,max:255,input:{op:'byte',offset:{op:'add',a:{op:'offset'},b:constant(1)}}},y:{op:'entropy',window:64,offset:{op:'offset'}},z:{op:'spectrum',kind:'phase',input:'position'},w:{op:'spectrum',kind:'amplitude',input:'position'}},
 other:{x:{op:'floor',input:'position'},y:{op:'clamp',input:{op:'invert',input:'position'},min:0.2,max:0.8},z:{op:'spectrum',kind:'frequency',input:'position'},w:{op:'power',input:constant(0),exponent:0}}
};
cases.hilbert3DLarge=Object.fromEntries(['x','y','z','w'].map((name,axis)=>[name,axis===3?constant(1):{op:'fract',input:{op:'multiply',a:hilbert3DCoordinate(axis,{op:'offset'},10),b:constant(128)}}]));
cases.largeIndex={x:{op:'normalize',min:0,max:255,input:{op:'byte',offset:{op:'add',a:{op:'offset'},b:constant(1)}}},y:constant(0),z:constant(0),w:constant(1)};
for(const [name,roots] of Object.entries(cases)){
 const large=name==='largeIndex'||name==='hilbert3DLarge';
 const offsetBase=large?2**24:0,selectionLength=large?2**24+128:64;
 const program=compileRecipes(roots),shader=emitRecipeShader(program,'glsl');
 const bindings=shader.bindings.map(binding=>`float ${binding.name}(int index) { return ${binding.kind==='byte'?(large?'float(index & 255)':'float(index)'):binding.kind==='entropy'?'float(index) / 64.0':binding.component==='phase'?'float(index) / 32.0':'1.0 - float(index) / 32.0'}; }`).join('\n');
 const source=`#version 300 es
precision highp float;
precision highp int;
${shader.source}
${bindings}
out vec4 color;
void main(){
 float offset=gl_FragCoord.x-0.5;
 float factors[15];for(int i=0;i<15;i++)factors[i]=0.0;
 factors[0]=offset/64.0;factors[2]=offset/64.0;
 RecipeResult result=evaluateRecipes(factors,int(offset)+${offsetBase},${selectionLength},vec2(8.0,8.0),int(offset),64);
 color=vec4(result.x,result.y,result.z,result.w);
}`;
 const evaluate=program.createEvaluator(),factors=new Float64Array(program.factorCount),expected=[];
 for(let i=0;i<64;i++){
  factors[0]=i/64;factors[2]=i/64;
  evaluate(factors,{offset:i+offsetBase,length:selectionLength,pointIndex:i,pointCount:64,grid:[8,8],byte:index=>large?index&255:index<64?index:0,entropy:index=>index/64,
   spectrum:(kind,position)=>{const index=Math.min(32,Math.floor(position*33));return kind==='frequency'?2*index/64:kind==='phase'?index/32:1-index/32;}});
  for(const key of ['x','y','z','w'])expected.push(Math.round(factors[program.bindings[key]]*255));
 }
 fixtures.push({name,source,expected});
 const wgsl=emitRecipeShader(program,'wgsl');assert(!wgsl.source.includes('undefined'));assert(wgsl.source.includes('fn evaluateRecipes'));
}
const directory=await mkdtemp(join(tmpdir(),'thea-recipe-shaders-'));
try {
 const input=join(directory,'fixtures.json');await writeFile(input,JSON.stringify(fixtures));
 const child=Bun.spawn(['python3',new URL('./recipe-glsl.py',import.meta.url).pathname,input],{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const [out,err]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text()]);
 assert.equal(await child.exited,0,err);console.log(out.trim());
}finally{await rm(directory,{recursive:true,force:true});}
