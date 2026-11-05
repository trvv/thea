/** Point arrangement is independent of point population and statistical providers. */
import { spaces } from './spaces.js';
import { hilbert3D } from './hilbert.js';

export const layoutOptions = [
 {value:'mapped',label:'Mapped Coordinates'},
 {value:'linear',label:'Linear 2D'},
 {value:'linear3d',label:'Linear 3D'},
 {value:'hilbert',label:'Hilbert 2D'},
 {value:'hilbert3d',label:'Hilbert 3D'}
];

export function positionMappings(configuration) {
 if (configuration.layout === 'mapped') return configuration.position;
 return ['column','row',configuration.layout.endsWith('3d')?'slice':'none'];
}

export function pointGrid(configuration, count, sampleLayout) {
 const total=Math.max(1,count),layout=configuration.layout;
 if(layout==='hilbert'||layout==='hilbert3d') {
  const dimensions=layout==='hilbert3d'?3:2;
  const order=Math.min(dimensions===3?10:15,Math.ceil(Math.log2(total)/dimensions));
  const side=2**order;
  return {columns:side,rows:side,slices:dimensions===3?side:1,order};
 }
 const spatial=layout==='linear3d'||layout==='mapped'&&(spaces[configuration.space].length===3||configuration.grid?.rows>0);
 const columns=configuration.grid?.columns||Math.max(1,Math.ceil(spatial?Math.cbrt(total):Math.sqrt(total*(sampleLayout.aspect??sampleLayout.columns/sampleLayout.rows))));
 const rows=spatial?(configuration.grid?.rows||Math.max(1,Math.ceil(Math.sqrt(total/columns)))):Math.max(1,Math.ceil(total/columns));
 return {columns,rows,slices:spatial?Math.max(1,Math.ceil(total/(columns*rows))):1};
}

/** Write normalized cell centers, with no lookup table proportional to grid volume. */
export function gridCoordinates(index, grid, layout, out) {
 const {columns,rows,slices}=grid;
 if(layout==='hilbert3d')return hilbert3D(Math.min(index,columns**3-1),grid.order,out);
 if(layout==='hilbert') {
  let remaining=Math.min(index,columns*rows-1),x=0,y=0;
  for(let scale=1;scale<columns;scale*=2) {
   const rx=Math.floor(remaining/2)&1,ry=(remaining^rx)&1;
   if(!ry){if(rx){x=scale-1-x;y=scale-1-y;}[x,y]=[y,x];}
   x+=scale*rx;y+=scale*ry;remaining=Math.floor(remaining/4);
  }
  out[0]=(x+0.5)/columns;out[1]=(y+0.5)/rows;out[2]=0.5;
 }else {
  out[0]=(index%columns+0.5)/columns;
  out[1]=(Math.floor(index/columns)%rows+0.5)/rows;
  out[2]=(Math.floor(index/(columns*rows))+0.5)/slices;
 }
 return out;
}
