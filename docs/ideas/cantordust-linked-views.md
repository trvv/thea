# Linked views over one source selection

Current delivery: One linked comparison pane is implemented; detached workspaces and cross-highlighting remain separate extensions. See [implemented behavior](../comparison-views.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Original proposal: Multiple independent components are already possible; coordinated
selection and shared immutable analysis are the missing product behavior.

## What CantorDust implements

[MainInterface.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/MainInterface.java) can open visualizers in additional
windows while its main interface supplies common macro/micro selection sliders.
Each view can expose a different projection of the same selected bytes. The
upstream implementation uses desktop windows; Thea need not reproduce that UI.

Thea's DataScroll owns one final visualization and nested source-selection bars.
Putting two DataScroll elements on a page does not automatically synchronize their
selection or share provider results. Side-by-side entropy, tuple and bitmap views
would make it easier to validate a visual hypothesis without repeatedly changing
one preset and losing the comparison.

## Smallest useful implementation

Start with one optional second DataScrollView driven by the existing host's final
absolute source interval. Each view owns configuration, camera and rendering
freshness, while the host owns source and selection exactly once. Keep the default
single-view page unchanged. A context action can create/remove the comparison
view, rather than adding permanent help or status furniture.

Load a preset into the chosen view, leaving the other view unchanged. The existing
preset library stores one view plus bar count; do not silently redefine those
snapshots as workspaces. A future versioned workspace can contain view profiles
and selection linkage separately if persistence is desired.

## Linking choices

Initial linking should share source and selected interval only. Camera, hover,
axis dimensions and appearance remain independent. Cross-highlighting can follow
once mark provenance yields meaningful source spans or occurrence keys. A spectral
bin and a tuple do not have a one-to-one geometric correspondence. When no exact
relationship exists, show the shared evidence interval or nothing rather than
highlighting an arbitrary point.

Avoid listeners that echo the same selection back and forth. A single host model
can assign a revision and update every view once. View disconnection must release
render jobs and subscriptions without closing the shared immutable source cache.

## Performance and order

Implement after source-scoped overview summaries and a clear provider cache budget.
Two views can double FFT/entropy work if each creates independent workers and caches.
Share immutable prepared results keyed by source revision, exact interval,
parameters and boundary semantics; do not share mutable renderer state or transferred
ArrayBuffers that another view still needs. A reference-counted service or one
source worker may help, but only after local ownership and eviction are specified.

Start with sequential preparation or a shared concurrency limit; creating one
unbounded worker pool per view can make interaction worse. Offscreen comparison
views should avoid continuous redraws. Camera-only changes must retain analysis.

Acceptance: two projections show the same absolute interval, one update per seek,
independent preset/camera edits, bounded preparation reuse, correct source replace,
removal during an outstanding render, and no stale cross-highlights. A sparse
large-source fixture should demonstrate the memory budget with both views alive.
