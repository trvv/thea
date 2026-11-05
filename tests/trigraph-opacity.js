import assert from 'node:assert/strict';
import { trigraphCounts, trigraphImage } from '../trigraph.js';
const pack=(x,y,z)=>x*65536+y*256+z;
const pose={yaw:0,pitch:0};
const options={frequencyOpacity:true};
const front=pack(128,128,255),rear=pack(128,128,0),center=128*257+128;
const one=trigraphImage(new Map([[front,1]]),257,257,pose,{},undefined,options);
const both=trigraphImage(new Map([[front,1],[rear,1]]),257,257,pose,{},undefined,options);
assert(both[center]>one[center],'Particles behind translucent ones must contribute');
assert.equal(one[center],Math.round(255*(1-Math.exp(-0.25*Math.log1p(1)))));
const common=trigraphImage(new Map([[front,16]]),257,257,pose,{},undefined,options);
assert(common[center]>one[center],'Frequency must increase opacity');
assert.deepEqual(both,trigraphImage(new Map([[rear,1],[front,1]]),257,257,pose,{},undefined,options));
let seed=355;const data=Uint8Array.from({length:16000},()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;});
const source=new Blob([data]),cache={},raster={};
for(let i=0;i<45;i++){
 const hist=await trigraphCounts({source,offset:i*13,length:i%7===0?5000:5500},cache);
 const rotation={yaw:i<30?-0.6:0.3,pitch:0.4};
 const opacity=i%11!==0;
 const settings={frequencyOpacity:opacity};
 const actual=trigraphImage(hist.counts,257,193,rotation,raster,hist,settings).slice();
 const expected=trigraphImage(hist.counts,257,193,rotation,{},undefined,settings);
 for(let pixel=0;pixel<actual.length;pixel++)assert(Math.abs(actual[pixel]-expected[pixel])<=1,`Opacity cache mismatch: frame ${i}, pixel ${pixel}`);
}
console.log('Opacity checks pass: frequency mapping, transparent overlap, order independence, incremental updates, camera changes, toggling back to opaque.');
