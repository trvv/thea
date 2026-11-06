import assert from "node:assert/strict";
import {
  validateSourceMetadata,
  describeSourceOffset,
} from "../source-metadata.js";
const source = {
  segments: [
    {
      start: 16,
      endExclusive: 32,
      address: "0xFFFFFFFFFFFFFFF0",
      label: "Code",
      addressSpace: "main",
    },
    { start: 20, endExclusive: 24, address: "0x2000", addressSpace: "overlay" },
  ],
  annotations: [
    {
      start: 18,
      endExclusive: 22,
      label: "<script>raw label</script>",
      kind: "field",
    },
  ],
};
const metadata = validateSourceMetadata(source, 64);
assert.equal(
  describeSourceOffset(metadata, 20).addresses["Mapping 1"].address,
  "0xFFFFFFFFFFFFFFF4",
);
assert.equal(
  describeSourceOffset(metadata, 20).addresses["Mapping 2"].address,
  "0x2000",
);
assert.equal(
  describeSourceOffset(metadata, 20).annotations["Annotation 1"].label,
  source.annotations[0].label,
);
assert.deepEqual(describeSourceOffset(metadata, 32).addresses, {});
source.segments[0].start = 0;
assert.equal(metadata.segments[0].start, 16);
for (const invalid of [
  { segments: [{ start: -1, endExclusive: 8, address: "0" }] },
  { annotations: [{ start: 0, endExclusive: 65 }] },
  { segments: [{ start: 0, endExclusive: 1, address: 4096 }] },
  { segments: [{ start: 0, endExclusive: 1, address: "-1" }] },
])
  assert.throws(() => validateSourceMetadata(invalid, 64));
console.log(
  "Source metadata passes: exact wide addresses, overlapping spaces, half-open bounds, annotations, ownership and validation.",
);
