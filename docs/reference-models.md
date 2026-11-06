# User-trained reference resemblance

Advanced → References → Train Selection fits a byte or overlapping-pair model
to the current selected bytes. The named library is stored separately in
`thea.referenceModels`. Rename, delete and JSON file transfer are available there.
Models ship with no architecture corpus or third-party training data.

A reference entry can assign Surprise Hue or Coverage Lightness. These create
ordinary `analysis` recipes with a model ID, a selection-scoped window (initially
32 bytes) and a projection. Surprise is average negative log likelihood in bits
per scored gram. The convenience hue action explicitly normalizes 0–16 bits;
the raw score remains in inspection and the mapping is editable. Coverage is the
fraction of scored grams seen in training, not confidence or classification accuracy.

Artifacts contain version, ID, revision, name, gram order, exact counts, total
prior mass and training provenance. Smoothing distributes a fixed total prior
mass (default one) across the complete alphabet. All counts and training totals
validate before publication. Profiles store model IDs, not large model tables;
export/import the reference artifacts alongside presets that use them. A missing
model is an explicit analysis error and does not silently become a zero score.

`trainReference` yields between bounded chunks; the browser uses
`trainReferenceSource` to read Blob intervals in 64 KiB chunks, carrying pair
boundaries without allocating the entire selection. `prepareReference` builds one
log-probability table per artifact revision, while the provider prepares only
requested score windows. Models and windows are shared across projections.
Source reads and model/result estimates participate in provider budgets. The
artifact library is bounded to 64 models and 1 MiB of JSON by default. Normal
camera frames reuse validated artifacts while storage remains unchanged.

`scoreReferences` compares only models of the same gram order. It returns all
scores, evidence count, top-two margin, and explicit insufficient, unseen,
ambiguous or match status. It never converts these into calibrated probabilities.
Validation fixtures use separate scoring bytes; an interactive user can still
train and score the same interval, which is descriptive in-sample resemblance.

`tests/reference-models.js` covers exact training, held-out scoring, ties, unknown
content, evidence thresholds, artifact/storage validation, cancellation, revision
freshness, point provenance and actual worker execution.
