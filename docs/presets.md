# Saved presets

The context menu's Preset submenu manages a local preset library. Saved entries
persist in localStorage and the last selected preset is restored when a new
`DataScroll` is constructed, including after a page refresh.

## Menu actions

| Path under Preset                                               | Behavior                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Load → built-in preset (including curves, Byte Frequency and Packed Pixels) | Apply a built-in view and remember that choice.                               |
| Load → Saved → name                                             | Load a saved snapshot and its bar count.                                      |
| Save As                                                         | Save the current configuration under a new name.                              |
| Manage → name → Update                                          | Replace that saved entry with the current view and bar count.                 |
| Manage → name → Duplicate                                       | Copy the stored snapshot under a new name, without changing the current view. |
| Manage → name → Rename                                          | Change the name while keeping the entry's identity and settings.              |
| Manage → name → Delete                                          | Remove the saved entry; the currently displayed view remains usable.          |
| Manage → name → Copy JSON                                       | Copy that entry's stored settings.                                            |
| Copy JSON                                                       | Copy the current view and bar count, including unsaved edits.                 |
| Import JSON                                                     | Validate pasted JSON, ask for a name, then save and load it.                  |
| Import File | Validate a preset JSON file, ask for a name, then save and load it. |
| Export File | Download the current view and bar count as preset JSON. |

Names are trimmed, case-sensitive, and limited to 80 characters. Save As, Duplicate
and Rename reject a name already used by another saved entry. Update is the
explicit overwrite operation. Canceling a naming/import prompt leaves storage
and the view unchanged. Built-ins cannot be renamed or deleted; Save As creates
an editable snapshot of one.

A saved entry is marked selected only while its settings and bar count match the
current view. Edits do not overwrite it automatically: use Update or Save As.
The last chosen built-in restores its defaults; unsaved edits to that view are
not restored.

## Snapshot contents

Saved snapshots use the existing version 3 profile format for population, sample
limit/policy, coordinate recipes, ranges, Fit/Scale/Truncate flags, space,
appearance, named factors, text options, backend and camera. Default appearance
mappings are materialized at save time. The preset wrapper also stores bar count.

Source bytes, file URLs, selected offsets and selected lengths are session state,
not reusable preset data. Loading geometry preserves the current selected range;
changing bar count follows the normal scope-controller behavior. In particular,
a preset with zero bars selects the whole current source.

## Storage and copying

`src/presets/preset-library.js` owns the versioned `thea.presets` localStorage key:

```text
version: 1
presets: [{id, name, profile, barCount}, ...]
selected: a saved ID or a builtin:<region> identifier
```

Library version 1 is independent of the nested view profile version. Every read
validates profiles through the existing migration/validation functions, and every
mutation reads the latest stored library rather than writing a stale component
copy. Settings returned to callers are owned snapshots.

A successful mutation replaces one validated localStorage value. A failed write,
name collision, invalid import or unsupported/corrupt stored library does not
replace existing data. Action errors are surfaced through `data-error` and a
native error dialog. If startup cannot read a valid library, the ordinary default
view remains available; invalid stored data is not silently reset or overwritten.

Storage is per browser origin, including its port. Copy JSON and Import JSON can
transfer presets between origins. Clipboard copying uses `navigator.clipboard`
when available; if copying is unavailable or rejected, a native prompt provides
the JSON for manual copying. Copied entries omit their local IDs and imports get
new identities. Bare versioned view profiles are accepted too, using a default
bar count of two.

Deleting the selected saved entry clears its remembered selection without
changing the current in-memory view. Other saved entries remain intact. Multiple
hosts can share the same library; opening their menu reads the current entries,
while an already displayed view is not replaced by another host's selection.

## Validation

`tests/preset-library.js` checks CRUD, collisions, ownership, selection, JSON
transfer, profile migration, stale updates and damaged/unavailable/full storage.
`tests/data-scroll.js` checks menu actions and host restoration. The browser smoke
suite exercises actual menu buttons, clipboard/import fallback, quota errors,
and a real navigation/reload that restores the saved profile and bar count.
