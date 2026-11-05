/**
 * Lazy window providers and per-sample inputs. File-relative reads, selection-relative recipe
 * offsets, and normalized spectrum positions have distinct contracts.
 * @module point-factors
 * @see docs/recipes.md
 */
import { compileRecipes, recipeRoots } from './recipes.js';
import { factorCount, factorIndices as slots, requiredFactors } from './factors.js';
import { occurrenceFactor } from './appearance.js';
import { fourierSpectrum } from './fourier.js';

// Providers are selected from the active channels, including only visible axes.
// Each cache holds one window; camera/style changes reuse the selected data.
/**
 * Prepare only reachable providers, then expose a visitor over sampled byte offsets. A recipe
 * context uses selection-relative offsets; halo reads for entropy remain file-relative.
 * @param {object} cache One mutable cache owner per canvas/thread; stable sourceId survives Blob
 *   cloning.
 * @param {function(): boolean} current Checked after awaited reads before publishing new cache
 *   contents.
 * @param {object} helpers Injected byte/layout helpers avoid importing the render dispatcher back
 *   into its provider.
 * @returns {Promise<function|null>} Visitor that reuses its factor array and context; consumers
 *   must copy values they retain.
 */
export async function pointFactors(job, appearance, cache, current, helpers, compiled) {
 const config = job.configuration;
 const program=compiled||compileRecipes(recipeRoots(config,appearance),config.recipes);
 const used=new Set(program.required);
 if(job.shaders.includes('character')||job.shaders.includes('hex'))used.add('value');
 const source = job.sourceId ?? job.source, key = `${job.offset}/${job.length}`;
 const entropy = used.has('entropy');
 const windows=new Set(program.providers.entropy);if(entropy)windows.add(32);
 const padding=Math.max(0,...[...windows].map(size=>Math.floor(size/2)));
 const afterPadding=Math.max(0,...[...windows].map(size=>size-Math.floor(size/2)-1));
 const legacyCount = used.has('count');
 const byteCounts = used.has('byteCount') || (legacyCount && !['digraph','trigraph'].includes(job.region));
 const pairCounts = used.has('pairCount') || (legacyCount && job.region === 'digraph');
 const tripleCounts = used.has('tripleCount') || (legacyCount && job.region === 'trigraph');
 const phase = used.has('phase')||program.providers.spectrum.has('phase'), amplitude = used.has('amplitude')||program.providers.spectrum.has('amplitude');
 const needBytes = program.providers.byte || windows.size>0 || phase || amplitude || byteCounts || pairCounts || tripleCounts
  || ['value','byte1','byte2','byte3','previous'].some(factor => used.has(factor));
 let bytes, metrics, spectrum, amplitudes, phases, peak = 0;
 let counts;
 const matches = entry => entry?.source === source && entry.key === key;
 if (needBytes) {
  const start = Math.max(0, job.offset-padding);
  const end = Math.min(job.source.size, job.offset + job.length + afterPadding);
  let window = cache.factorWindow;
  if (!matches(window) || window.start > start || window.end < end) {
   const data = new Uint8Array(await job.source.slice(start, end).arrayBuffer());
   if (!current()) return null;
   if (data.length < job.length + job.offset - start) throw new Error('Byte source ended before its declared size.');
   window = cache.factorWindow = { source, key, start, end, data };
  }
  bytes = window.data.subarray(job.offset - window.start, job.offset - window.start + job.length);
  if (windows.has(32)) {
   if (!matches(cache.factorEntropy)) cache.factorEntropy = { source, key,
    values: helpers.entropyShading(window.data).subarray(job.offset - window.start, job.offset - window.start + job.length) };
   metrics = cache.factorEntropy.values;
  }
 }
 if(windows.size){
  if(!matches(cache.recipeEntropy))cache.recipeEntropy={source,key,values:new Map()};
  for(const size of windows)if(!cache.recipeEntropy.values.has(size)){
   if(size===32)cache.recipeEntropy.values.set(size,Float32Array.from(metrics,value=>value/255));
   else {
    const window=cache.factorWindow;
    const normalized=windowEntropy(window.data,size);
    const first=job.offset-window.start;
    cache.recipeEntropy.values.set(size,normalized.slice(first,first+job.length));
   }
  }
 }

 if (byteCounts || pairCounts || tripleCounts) {
  if (!matches(cache.factorCounts)) cache.factorCounts = { source, key };
  counts = cache.factorCounts;
  const needByte = byteCounts && !counts.byte, needPair = pairCounts && !counts.pair, needTriple = tripleCounts && !counts.triple;
  if (needByte) counts.byte = new Float64Array(256);
  if (needPair) counts.pair = new Float64Array(65536);
  if (needTriple) counts.triple = new Map();
  if (needByte || needPair || needTriple) for (let i = 0; i < bytes.length; i++) {
   if (needByte) counts.byte[bytes[i]]++;
   if (needPair && i + 1 < bytes.length) counts.pair[bytes[i] * 256 + bytes[i + 1]]++;
   if (needTriple && i + 2 < bytes.length) {
    const tuple = bytes[i] * 65536 + bytes[i + 1] * 256 + bytes[i + 2];
    counts.triple.set(tuple, (counts.triple.get(tuple) || 0) + 1);
   }
  }
 }
 const bins = job.length ? Math.floor(job.length / 2) + 1 : 0;
 if (phase || amplitude) {
  if (!matches(cache.factorSpectrum)) cache.factorSpectrum = { source, key, ...fourierSpectrum(bytes) };
  spectrum = cache.factorSpectrum;
  if (phase && !spectrum.phases) {
   spectrum.phases = new Float64Array(bins);
   for (let k = 0; k < bins; k++) {
    const re = spectrum.real[k], im = spectrum.imaginary[k], magnitude = Math.hypot(re, im);
    const angle = Math.abs(im) < magnitude * 1e-12 ? re >= 0 ? 0 : Math.PI : Math.atan2(im, re);
    spectrum.phases[k] = (angle + Math.PI) / (2 * Math.PI);
   }
  }
  if (amplitude && !spectrum.amplitudes) {
   spectrum.amplitudes = new Float64Array(bins);
   for (let k = 0; k < bins; k++) {
    const value = Math.hypot(spectrum.real[k], spectrum.imaginary[k]) / job.length * (k === 0 || k * 2 === job.length ? 1 : 2);
    spectrum.amplitudes[k] = value; peak = Math.max(peak, value);
   }
   const scale = peak ? 1 / Math.log1p(peak) : 0;
   for (let k = 0; k < bins; k++) spectrum.amplitudes[k] = spectrum.amplitudes[k] < peak * 1e-10 ? 0 : Math.log1p(spectrum.amplitudes[k]) * scale;
  }
  phases = spectrum.phases; amplitudes = spectrum.amplitudes;
 }
 if (!current()) return null;
 const { columns, rows } = job.sampleLayout, count = columns * rows;
 const layout = used.has('column') || used.has('row');
 let cells;
 if (layout && config.layout === 'hilbert') {
  if (cache.pointHilbertSide !== columns) {
   cache.pointHilbertSide = columns; cache.pointHilbertCells = helpers.hilbertCells(columns);
  }
  cells = cache.pointHilbertCells;
 }
 const text = job.shaders.includes('character') || job.shaders.includes('hex');
 const values = new Float64Array(Math.max(factorCount,program.factorCount));
 const context={offset:0,length:job.length,grid:[columns,rows],
  byte(index){index=Math.floor(index);return index>=0&&index<job.length?bytes[index]:0;},
  entropy(index,size){index=Math.floor(index);return index>=0&&index<job.length?cache.recipeEntropy.values.get(size)[index]:0;},
  spectrum(kind,position){
   if(!bins)return 0;
   const bin=Math.min(bins-1,Math.floor(Math.max(0,Math.min(1,position))*bins));
   return kind==='frequency'?2*bin/Math.max(1,job.length):kind==='phase'?phases[bin]:amplitudes[bin];
  }
 };
 return visit => {
  for (let i = 0; i < count; i++) {
   const sample = config.layout === 'hilbert' || job.length > count ? Math.floor(i * job.length / count) : i;
   if (sample >= job.length) continue;
   let value = bytes?.[sample] ?? 0, metric = metrics?.[sample] ?? 0;
   if (!text && config.layout !== 'hilbert' && job.length > count && (used.has('value') || entropy)) {
    const end = Math.floor((i + 1) * job.length / count); value = metric = 0;
    for (let j = sample; j < end; j++) { value += bytes?.[j] ?? 0; metric += metrics?.[j] ?? 0; }
    value /= end - sample; metric /= end - sample;
   }
   values[slots.value] = value / 255; values[slots.entropy] = metric / 255;
   values[slots.position] = sample / Math.max(1, job.length - 1);
   const cell = cells ? cells[i] : i;
   values[slots.column] = (cell % columns + 0.5) / columns;
   values[slots.row] = (Math.floor(cell / columns) + 0.5) / rows;
   if (used.has('byte2')) values[slots.byte2] = (bytes[sample + 1] ?? 0) / 255;
   if (used.has('byte3')) values[slots.byte3] = (bytes[sample + 2] ?? 0) / 255;
   if (used.has('previous')) values[slots.previous] = (bytes[sample - 1] ?? 0) / 255;
   if (byteCounts) values[slots.byteCount] = occurrenceFactor(counts.byte[bytes[sample]]);
   if (pairCounts) values[slots.pairCount] = sample + 1 < job.length ? occurrenceFactor(counts.pair[bytes[sample] * 256 + bytes[sample + 1]]) : 0;
   if (tripleCounts) values[slots.tripleCount] = sample + 2 < job.length ? occurrenceFactor(counts.triple.get(bytes[sample] * 65536 + bytes[sample + 1] * 256 + bytes[sample + 2]) || 0) : 0;
   if (legacyCount) values[slots.count] = values[job.region === 'trigraph' ? slots.tripleCount : job.region === 'digraph' ? slots.pairCount : slots.byteCount];
   // The one-sided spectrum spans the same normalized offset as the byte samples.
   const bin = Math.min(bins - 1, Math.floor(sample * bins / job.length));
   if (used.has('frequency')) values[slots.frequency] = 2 * bin / Math.max(1, job.length);
   if (phase) values[slots.phase] = phases[bin];
   if (amplitude) values[slots.amplitude] = amplitudes[bin];
   const label = !text ? undefined : job.shaders.includes('hex') ? bytes[sample].toString(16).padStart(2, '0').toUpperCase()
    : helpers.byteCharacter(bytes[sample], job.encoding, job.blankSpaces, job.blankNulls);
   context.offset=sample;visit(values, label, context);
  }
 };
}

// Normalized local entropy for configurable windows. The 32-byte built-in keeps
// its existing quantization; custom windows use a sliding count table as well.
/**
 * Maintain count-table entropy in linear time for configurable neighborhoods. Normalize by
 * achievable entropy for the requested window, not by the visible byte count near file edges.
 */
export function windowEntropy(bytes,size){
 const result=new Float32Array(bytes.length),counts=new Uint32Array(256);
 const weights=Float64Array.from({length:size+1},(_,n)=>n?n*Math.log2(n):0);
 const maximum=Math.min(8,Math.log2(size));if(!maximum)return result;
 let start=0,end=0,sum=0;
 const update=(byte,delta)=>{const count=counts[byte];sum+=weights[count+delta]-weights[count];counts[byte]+=delta;};
 for(let i=0;i<bytes.length;i++){
  const left=Math.max(0,i-Math.floor(size/2)),right=Math.min(bytes.length,i+size-Math.floor(size/2));
  while(start<left)update(bytes[start++],-1);
  while(end<right)update(bytes[end++],1);
  const length=end-start;
  result[i]=Math.max(0,Math.min(1,(Math.log2(length)-sum/length)/maximum));
 }
 return result;
}
