# Template-based content resemblance

Current delivery: User-trained byte/pair reference artifacts and resemblance scores are implemented. A shipped architecture corpus and calibrated classifier remain separate work. See [implemented behavior](../reference-models.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Original proposal: A resemblance score can suggest what to investigate; it is not
a reliable file-type or instruction-set determination.

## What CantorDust implements

[ClassifierModel.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/ClassifierModel.java) compares local byte contexts
against trained content classes and stores a class per block. Its class list
includes architecture families, text, compression and image-like examples.
[NGramModel.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/NGramModel.java) hashes n-grams into fixed bucket tables
and scores them using summed log probabilities. Source comments describe the
memory reduction from boxed maps and the small-template bias caused by naive
additive smoothing. The current implementation separates block spacing from the
larger evidence window used to decide each block's label.

Thea has entropy, tuple counts and spectrum factors but no trained reference
models or local resemblance scores. [Conditional surprise](conditional-surprise.md)
is related infrastructure, while answering a different question: it can learn
from the current selection rather than named external examples.

## First increment

Implement comparison against one user-supplied reference interval using a small
byte or pair distribution model. Expose average negative log likelihood in bits
per scored item, coverage and validity. A second reference permits a score margin.
This gives useful meaning and inspectable fixtures before shipping an architecture
classifier or any substantial training assets.

Next add explicit reusable model artifacts with schema version, alphabet/order,
smoothing, sample count and content provenance. Model training consumes bytes;
profile JSON references a model identity and parameters rather than embedding
an arbitrary executable component or huge tables. Different-size training sets
must share a consistent unseen-symbol probability policy. Equal score under tiny
contexts is insufficient evidence, not class zero.

## Uncertainty and visualization

Keep winning class, top-two score margin, evidence size and unknown/insufficient
status separate. A softmax over class scores does not by itself produce calibrated
probabilities. Evaluate held-out content from independent files and include data
outside every trained class before presenting confidence. Architecture names must
not become authoritative labels in the page.

Expose individual class scores as ordinary factors, allowing hue, opacity or
position recipes to combine them with entropy and byte structure. Categorical
palette lookup is an optional expression concern. Inspection should identify
model version, context bounds, n-gram count, smoothing and relevant scores.

## Cost and sequencing

Do this after provider budgets, cancellation, raw distributions and local scoring
are established. Fixed buckets bound memory but introduce collisions; exact pair
models are practical, exact four-byte alphabets are not. Compute requested blocks
and halos rather than allocating whole-source labels. Shared adjacent evidence
can use rolling score sums while retaining exact boundary policy.

Do not import upstream template binaries casually: establish source, redistribution
rights, size budget and reproducibility for every training artifact. CantorDust's
repository license alone does not establish the provenance of external training
content. The current proposal copies no model data or Java implementation.

Fixtures should cover tiny contexts, unseen grams, equal models, train/test
separation, unequal training sizes, explicit unknown data, hash collision effects,
source-edge clipping, cancellation and stable scores under render sampling.
