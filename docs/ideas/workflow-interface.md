# Workflow and interface implementation

This develops the user's preferred workflow direction after the initial comparison
pane, occurrence navigation and preset library. These are proposals and accepted
directions, not a claim that the interfaces below are implemented.

## Panes and source tabs

Use in-app tabs for independent source workspaces, with multiple panes inside a
tab for related views. A pane owns its profile, camera, inspector and profile
history. The tab owns its source, navigation ranges, selection groups and pane
arrangement. This extends the current DataScroll ownership rather than letting
panes synchronize each other through reciprocal events.

Replace the special primary/comparison pair with an ordered collection and an
active pane. Add split, duplicate and close actions to the pane context menu.
Share navigation ranges by default; allow an explicit unlink to keep a reference
region fixed. Link groups own revisions and distribute each navigation change
once. Initially use simple split arrangements; detached windows follow later.

Inactive tabs keep their document state and immutable source Blob but stop
rendering and release owned engine/GPU leases. Closing a tab releases its source
and document state. A scrollable closable tab strip avoids wrapping many rows;
workspace saving provides a way to retain investigations without keeping every
file open. Avoid automatically drawing every inactive tab or pane.

## Point selections and cross-highlighting

The key open choice is whether point/search selections initially highlight evidence
with an explicit Zoom action, or immediately filter/recompute analysis. The
recommended first version is highlighting with explicit navigation. The current
bar-controlled analysis interval remains meaningful independently of a collection
of selected points or search matches.

Allow a single click to select/inspect, modifier clicks to toggle membership and
Clear Selection to reset it. Rectangle selection can follow with a gesture that
preserves ordinary 3D camera dragging. Store stable evidence references and
selection operations, not projected pixel coordinates. Multiple selections can
represent disjoint source spans, tuple keys, records or spectral bins. This
metadata does not impose exclusive analysis domains on visualization recipes.

Maintain two distinct relationships in provenance:

- Explicit addressed inputs: actual byte spans read by a contributing recipe,
  numeric span, entropy neighborhood or chosen tuple occurrence.
- Analysis support: the source interval and parameters used to train a histogram,
  conditional model or transform, plus the selected analysis coordinate/key.

A DFT bin depends on the entire transform interval; it has no unique source byte
address. Its selection retains the transform descriptor and bin/frequency. Another
matching spectral view can identify that bin. A linear view can outline the
transform interval without selecting every byte as an exact match. If a mixed
recipe also reads a byte or local entropy at an explicit mapped address, preserve
and highlight that separate contributing span. A proportional bin-to-byte
correspondence must not become an automatic seek target merely because it appears
as contextual metadata in inspection.

An optional future frequency-component preview could inverse-transform selected
bins into a derived signal along the source interval. That would visualize a
component's contribution, rather than inventing a unique location for a global
frequency. It is a separate analysis extension, not required for cross-highlighting.

Resolve selected evidence against each pane's presented source/range/configuration.
Draw highlights as a separate overlay so selection changes do not invalidate
analysis or color buffers. Source replacement invalidates evidence; camera motion
only changes overlay projection. Large tuple/search selections remain bounded
queries and predicates, not eager arrays of every occurrence.

## Visualizer and workspace files

Treat files as durable interchange and localStorage as a reload cache. Introduce
explicit versioned envelopes, for example `.thea-view.json` and
`.thea-workspace.json`, identified by their payload kind/version as well as their
filename. Existing preset/profile imports retain compatibility through validation.

A visualizer file contains an ordinary validated profile, including recipes and
view parameters. A workspace contains pane profiles/cameras, split arrangement,
active pane, navigation/link groups, saved evidence/query selections and source
identity/descriptors. Keep current presets as single-view documents; do not
silently redefine them as workspaces. Resolve external reference-model dependencies
explicitly so a portable file does not merely retain unavailable localStorage IDs.

Validate an entire document and its limits before replacing active state.
Import/export, clipboard and reload caching should use the same serialization
contract. File bytes stay outside localStorage. A restored local-file workspace
requires the matching source to be supplied again; names/size/mtime are practical
identity hints, not proof of content identity. URL sources may be reopened through
the existing loader with normal freshness checks.

## Drag and drop

Default binary-file drops to new in-app source tabs, preserving the current tab.
Multiple binaries create separate tabs. Existing sources are only replaced by an
explicit Replace Source action. Show ordinary filenames in the tab strip and keep
only the active workspace rendering.

A recognized workspace document opens a new workspace tab. A visualizer document
can open as an additional pane against the active source, with a way to open it in
a separate tab; this remains a proposed interaction choice. Recognize document
payloads with bounded parsing and strict validation. Arbitrary JSON files remain
valid binary source candidates rather than being assumed to contain Thea settings.

Workspace/source matching must not depend on drop order when several related files
arrive together. Match validated source descriptors where possible and ask for a
source when identity remains ambiguous. Browser drop handling must prevent default
file navigation and ignore ordinary internal text drags. No source file is silently
uploaded or saved into browser string storage.

## Search and occurrence browser

The current `src/analysis/occurrences.js` routine searches literal byte patterns,
with bounded pages, direction, wrap, source scope and cancellation. The inspector
uses it for Previous/Next; a general search panel is not yet implemented.

Add a compact search/results pane with hex and text input, explicit selected-range
or whole-source scope, paged results and visible-row virtualization. Reuse the
existing search operation, byte context and cancellable address navigation events.
A result row can navigate to or select its exact source span. Exact totals remain
optional unless already available cheaply from a matching count provider.

Keep the query independent of whichever point is inspected next. For example,
searching for `12 34` and visiting a match should continue searching for `12 34`
within the chosen scope even after navigation redraws the view. Changing the
query or source cancels obsolete work. A pinned range scope stays fixed until
explicitly changed rather than silently becoming the next visible range.

Offer selection of a match, a result page, or the query's full result set. A full
result selection stores the query/source/scope and resolves lazily against visible
marks. It does not require scanning the whole source merely to show the first page.
Overlapping matches remain exact. Disjoint matches preserve original addresses;
concatenating them would change byte adjacency, tuple counts and DFT meaning, so
that requires a separate explicit operation if ever offered.

## Structured expression editor

Start with an expandable expression tree rather than a graph framework or new
language. Open it from a trait or named factor. Native controls edit the operation,
its parameters and child expressions, with named-factor references, subtree
copy/replace and extraction into a reusable factor.

Use a draft profile. Apply validates the complete graph and commits one undoable
transaction; Cancel leaves the active visualization intact. Preserve exact numeric
strings, explicit units/normalization and existing provider semantics. JSON editing
remains available and uses the same validator. Keep automatic per-keystroke
recomputation out of the first version; an explicit preview can follow if useful.

## Implementation order

1. Generalize pane ownership and selection/link groups.
2. Implement evidence selections, multiple-point selection and cross-highlights.
3. Define portable visualizer/workspace documents and reload-cache migration.
4. Add source tabs and safe multi-file drag/drop.
5. Add persistent search queries/results and query-backed selections.
6. Add the structured expression editor over existing profile transactions.

Tests should concentrate on source/frame freshness, exact disjoint spans, mixed
recipe evidence, spectral scope versus explicit mapped reads, cancellation during
navigation, atomic document import, reference dependencies, inactive-tab resource
release, and preserved keyboard/camera interactions.
