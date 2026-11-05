/** Shared CPU reference rasterizer. Optimizations depend on mark properties, never presets. */
const black=new Uint32Array(Uint8ClampedArray.from([0,0,0,255]).buffer)[0];

export function paintCPU(context, prepared, projection, scratch) {
 const {width,height,projected,order,spatial,cellWidth,cellHeight}=projection;
 if(!scratch.image||scratch.width!==width||scratch.height!==height) {
  scratch.width=width;scratch.height=height;scratch.image=context.createImageData(width,height);
  scratch.packed=new Uint32Array(scratch.image.data.buffer);
 }
 const pixels=scratch.image.data,packed=scratch.packed;
 packed.fill(black);
 const colors=new Uint32Array(prepared.colors.buffer,prepared.colors.byteOffset,prepared.colors.length/4);
 const square=prepared.shape==='square';
 for(let n=0;n<prepared.size;n++) {
  const i=order?order[n]:n,q=i*4,x=projected[q],y=projected[q+1],size=prepared.sizes[i];
  const halfX=(spatial?projected[q+3]:cellWidth/2)*size,halfY=(spatial?projected[q+3]:cellHeight/2)*size;
  const alpha=prepared.colors[q+3]/255;
  if(!alpha||!(halfX>0&&halfY>0))continue;
  const left=Math.max(0,Math.floor(x-halfX)),right=Math.min(width-1,Math.ceil(x+halfX));
  const top=Math.max(0,Math.floor(y-halfY)),bottom=Math.min(height-1,Math.ceil(y+halfY));
  const firstFull=Math.max(left,Math.ceil(x-halfX-0.25)),lastFull=Math.min(right,Math.floor(x+halfX-0.75));
  for(let py=top;py<=bottom;py++) {
   const y0=(py+0.25-y)/halfY,y1=(py+0.75-y)/halfY;
   const vertical=Number(Math.abs(y0)<=1)+Number(Math.abs(y1)<=1);
   if(square&&!vertical)continue;
   const fill=square&&alpha===1&&vertical===2&&firstFull<=lastFull;
   if(fill)packed.fill(colors[i],py*width+firstFull,py*width+lastFull+1);
   for(let px=left;px<=right;px++) {
    if(fill&&px===firstFull){px=lastFull;continue;}
    const x0=(px+0.25-x)/halfX,x1=(px+0.75-x)/halfX;
    const coverage=square?vertical*(Number(Math.abs(x0)<=1)+Number(Math.abs(x1)<=1))
     :Number(x0*x0+y0*y0<=1)+Number(x1*x1+y0*y0<=1)+Number(x0*x0+y1*y1<=1)+Number(x1*x1+y1*y1<=1);
    if(!coverage)continue;
    const a=alpha*coverage/4,p=(py*width+px)*4;
    if(a===1)packed[py*width+px]=colors[i];
    else for(let c=0;c<3;c++)pixels[p+c]=Math.round(prepared.colors[q+c]*a+pixels[p+c]*(1-a));
   }
  }
 }
 context.putImageData(scratch.image,0,0);
}
