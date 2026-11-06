# Files, bookmarks and source metadata

Advanced → Open File uses the native file picker. The browser keeps the File as
a seekable Blob; source bytes are not put into localStorage. Preset JSON file
import/export is separate from source loading. Fragment URL loading still works.

Advanced → Bookmarks saves named source ranges, with rename/delete/load actions.
Bookmarks store source identity, absolute offset and exact length; they do not
replace visualization presets. Loading a range creates a selection bar if needed
and preserves its exact interval even if the current grid has a different row
width. Resizing the selected bar returns to ordinary layout sizing.

File identity uses name, size and last-modified metadata. URL identity uses the
resolved URL, size and available ETag/Last-Modified headers. These are practical
identity checks, not cryptographic content verification. Unnamed Blobs use a
session-only token. Bookmarks for a different identity remain unavailable until
that source is loaded; no local path is reopened automatically. The bounded
library is `thea.bookmarks`, independent from presets and source bytes.

`host.setSourceMetadata({segments, annotations})` accepts source-bound metadata:

```js
host.setSourceMetadata({
  segments: [
    {
      start: 4096,
      endExclusive: 8192,
      address: "0x140001000",
      addressSpace: "main",
      label: "code",
    },
  ],
  annotations: [{ start: 4100, endExclusive: 4116, label: "candidate field" }],
});
```

Spans are half-open absolute file offsets. Addresses are integer strings and use
BigInt for exact wide offsets. Multiple overlapping address spaces are allowed;
unmapped source bytes remain valid. Inspection shows applicable mappings and
annotations as plain text. Metadata is not a parser, executable-address guess,
per-point rendering object, or persistent preset field. Replacing the source
clears it in both panes.

Occurrence navigation emits a bubbling, composed, cancellable `address-select`
event with source, sourceOffset, length, frame and relationship. Prevent its
default to suppress the subsequent normal seek. External Ghidra/IDA transport is
outside the current browser-app scope; the event can support a later adapter.
Bin inspection keeps its proportional byte correspondence separate and does not
offer pattern-occurrence navigation as if a coefficient had a unique byte.

`tests/bookmarks.js`, `tests/source-metadata.js`, occurrence tests and component
tests cover identity, exact intervals, validation/atomic failures, wide mappings,
overlapping spaces, replacement and navigation ownership.
