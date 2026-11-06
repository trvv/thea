# Profile editing

Factor menus offer Rename and Delete. Rename rewrites references in definitions,
position and appearance atomically, then validates the whole profile. Deleting a
referenced definition is rejected; unused definitions can be deleted. Failed edits
leave the active configuration unchanged. The view also exposes `renameFactor`
and `deleteFactor` for programmatic use.

Advanced offers Undo, Redo and Edit Profile JSON. Menu edits keep up to fifty
owned profile snapshots in memory. Undo/redo restores visualization settings,
including recipes, dimensions and appearance. Source bytes, selected ranges,
bar count and preset-library mutations are not profile history. Direct property
assignments are not automatically recorded as transactions. History is session
state and is not persisted in presets.

The JSON editor uses the existing versioned profile validator. Cancel and invalid
JSON leave the active profile intact. Named preset saving remains explicit.

Preset → Import File and Export File use the same versioned payload as clipboard
transfer. Sources load separately with Advanced → Open File. Source range bookmarks
remain separate from presets; see [source navigation](source-navigation.md).
Each comparison pane owns its history.

Advanced also offers Provider Budget (MiB). Zero means no configured limit;
a positive value is serialized as `configuration.providerBudget` in bytes.
Eligible providers check conservative operation-level working estimates before
allocation. This is not a process-wide JavaScript heap cap. Distinct-map estimates
and FFT work estimates are conservative policies, not engine heap measurements.
Over-budget exact analysis fails rather than shortening its interval or changing
its sample semantics; the last usable displayed frame remains available.

`tests/profile-edits.js`, `tests/provider-budget.js`, and `tests/data-scroll.js`
exercise pure transactions, name/reference failures, precision, menu history and
navigation isolation. Worker budget rejection does not disable the worker backend.
