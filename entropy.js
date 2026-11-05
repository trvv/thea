/** Rolling local Shannon entropy. Normalize by the requested window's achievable entropy. */
export function windowEntropy(bytes,size,quantized=false){
 const result=quantized?new Uint8Array(bytes.length):new Float32Array(bytes.length),counts=new Uint32Array(256);
 const weights=Float64Array.from({length:size+1},(_,n)=>n?n*Math.log2(n):0);
 const maximum=Math.min(8,Math.log2(size));if(!maximum)return result;
 let start=0,end=0,sum=0;
 const update=(byte,delta)=>{const count=counts[byte];sum+=weights[count+delta]-weights[count];counts[byte]+=delta;};
 for(let i=0;i<bytes.length;i++){
  const left=Math.max(0,i-Math.floor(size/2)),right=Math.min(bytes.length,i+size-Math.floor(size/2));
  while(start<left)update(bytes[start++],-1);
  while(end<right)update(bytes[end++],1);
  const length=end-start;
  const value=Math.max(0,Math.min(1,(Math.log2(length)-sum/length)/maximum));
  result[i]=quantized?Math.round(value*255):value;
 }
 return result;
}

/** Preserve the built-in 32-byte factor's 8-bit quantization. */
export const entropyShading=bytes=>windowEntropy(bytes,32,true);
