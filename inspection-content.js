/** Plain DOM inspection content. Provider data is rendered as text, never interpreted as HTML. */
import { recipeLabel } from './recipes.js';
import { factorOptions } from './factor-catalog.js';
const labels=new Map(factorOptions.map(({value,label})=>[value,label]));
const title=value=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase());
const format=value=>Array.isArray(value)?value.map(format).join(', '):String(value);
const element=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function fields(data) {
 const table=element('table');
 for(const [name,value] of Object.entries(data)) {
  if(value===undefined)continue;
  const row=element('tr'),key=element('th',title(name)),cell=element('td');
  key.scope='row';
  if(value&&typeof value==='object'&&!Array.isArray(value)) {
   const details=element('details');details.append(element('summary',title(name)),fields(value));cell.append(details);
  }else cell.textContent=format(value);
  row.append(key,cell);table.append(row);
 }
 return table;
}
export function inspectionContent(info) {
 const body=element('div'),point=info.point;
 const heading=point.population==='bytes'?point.sampleRange?`Bytes [${point.sampleRange.start}, ${point.sampleRange.endExclusive})`:`Byte ${point.byteValue} @ ${point.sourceOffset}`
  :point.population==='bins'?`Bin ${point.bin.bin} / ${point.bin.binCount}`
  :`${point.population==='pairs'?'Pair':'Triple'} [${point.tuple.join(', ')}] @ ${point.sourceOffset}`;
 body.append(element('strong',heading),fields(point));
 const nodeContent=(id,seen)=>{
  const node=info.nodes[id],details=element('details');details.open=true;
  const description=`${node.op==='factor'?labels.get(node.name)||node.name:title(node.op)} = ${format(node.value)}`;
  if(seen.has(id))return element('div',description);
  seen.add(id);details.append(element('summary',description));
  const {id:ignoredId,args,type,op,name,value,source,...parameters}=node;
  if(Object.keys(parameters).length)details.append(fields(parameters));
  if(source)details.append(fields(source));
  for(const input of args)details.append(nodeContent(input,seen));
  return details;
 };
 for(const trait of info.traits) {
  const details=element('details');details.open=true;
  const expression=labels.get(trait.expression)||recipeLabel(trait.expression);
  details.append(element('summary',`${trait.name}: ${expression} = ${format(trait.value??trait.rendered)}`));
  if(trait.root!==undefined)details.append(nodeContent(trait.root,new Set()));
  if(trait.mapping)details.append(fields(trait.mapping));
  if(trait.rendered!==undefined)details.append(fields({rendered:trait.rendered}));
  body.append(details);
 }
 const rendering=element('details');rendering.append(element('summary','Rendering'),fields(info.rendering));body.append(rendering);
 return body;
}
