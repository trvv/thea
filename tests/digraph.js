import assert from 'node:assert/strict';
import { windowCounts } from '../histograms.js';
import { executeRender } from '../rendering.js';
import { occurrenceFactor } from '../appearance.js';
import { RenderCanvas } from './render-canvas.js';
const source=new Blob([Uint8Array.from([99,1,2,1,2,3,88])]),cache={};
const job={kind:'view',region:'digraph',source,offset:1,length:5,columns:256,rows:256,shaders:[]};
await executeRender(new RenderCanvas(),job,cache);
const points=cache.preparedPoints;
assert.equal(points.size,3,'Distinct overlapping pairs should produce one point each');
const actual=new Map();
for(let i=0;i<points.size;i++) {
 const x=Math.round((points.positions[i*3]+1)*127.5),y=Math.round((points.positions[i*3+1]+1)*127.5);
 actual.set(`${x}/${y}`,points.colors[i*4]);
}
assert.deepEqual([...actual.keys()],['1/2','2/1','2/3'],'Pair axes or first-occurrence order changed');
assert.equal(actual.get('1/2'),Math.round(255*occurrenceFactor(2)));
assert.equal(actual.get('2/1'),Math.round(255*occurrenceFactor(1)));
for(const bytes of [[],[255]]) {
 const empty={};await executeRender(new RenderCanvas(),{...job,source:new Blob([Uint8Array.from(bytes)]),offset:0,length:bytes.length},empty);
 assert.equal(empty.preparedPoints.size,0);
}
// Count every pair independently over chunk and selection boundaries.
const large=Uint8Array.from({length:131100},(_,i)=>(i*37+(i>>>4))%256),countsCache={};
for(const [offset,length] of [[0,65537],[1,65538],[65535,65539],[65536,65538]]) {
 const counts=await windowCounts({source:new Blob([large]),offset,length},countsCache,2);
 const expected=new Float64Array(65536);
 for(let i=offset;i+1<offset+length;i++)expected[large[i]*256+large[i+1]]++;
 assert.deepEqual(counts.counts,expected);
}
console.log('Digraph checks pass: distinct overlapping pairs, axes, occurrence shading, empty/short input, chunk and selection bounds.');
