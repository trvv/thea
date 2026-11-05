/**
 * Stable source-factor slots shared by CPU evaluation and emitted shader interfaces. Reordering
 * slots is an ABI change, even if menu labels stay the same.
 * @module factor-catalog
 */
// A point's factors have stable slots, independent of the selected preset.
export const factorIndices = {
 value: 0, byte1: 0, entropy: 1, position: 2, count: 3, column: 4, row: 5,
 byte2: 6, byte3: 7, previous: 8, phase: 9, frequency: 10, amplitude: 11,
 byteCount: 12, pairCount: 13, tripleCount: 14, slice: 15
};
export const factorCount = 16;
const names = {
 none: 'None', value: 'Byte Value', previous: 'Previous Byte', byte2: 'Next Byte', byte3: 'Byte +2',
 entropy: 'Local Entropy', position: 'Position', column: 'Column', row: 'Row', slice: 'Slice',
 byteCount: 'Byte Occurrences', pairCount: 'Pair Occurrences', tripleCount: 'Triple Occurrences',
 phase: 'DFT Phase', frequency: 'DFT Frequency', amplitude: 'DFT Amplitude'
};
export const factorOptions = Object.entries(names).map(([value, label]) => ({ value, label }));
export const appearanceChannels = ['hue', 'saturation', 'lightness', 'opacity', 'size'];
