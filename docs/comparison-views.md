# Comparison view

Advanced → Comparison View creates one optional second pane. The host owns the
root Blob and selected interval once; both panes receive the same absolute range.
Each pane owns its profile, camera, scheduler and inspection state. Right-click
the desired pane to edit it or load a preset there. Removing the pane releases its
worker and returns editing to the primary view.

The second pane initially clones the primary profile. Subsequent changes remain
independent. Geometry changes in the comparison do not resize the shared selected
interval. Source replacement updates both panes; source-specific annotations are
cleared. Profile undo belongs to the edited pane, while range navigation is shared.
Named presets still represent one view rather than a workspace. Comparison-pane
existence is session state and is not restored as part of a preset.

Source-owned overview summaries can be shared inside an execution context.
Each pane's analysis/worker caches remain separately owned; this is not a claim
of cross-worker FFT or entropy sharing. There is at most one comparison and each
engine retains its bounded active/pending queue. Use provider budgets for costly
configurations. No detached-window protocol or cross-highlighting is implied.

Component and Chromium tests cover exact shared ranges, independent edits,
active-pane menus, nonoverlapping pane geometry, source replacement and removal.
