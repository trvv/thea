# Conditional surprise

Current delivery: The selected first-order conditional model is implemented. Alternative training scopes and higher-order contexts below remain extensions. See [implemented behavior](../statistical-analyses.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Proposal: a new statistical provider. The original design below describes its scope and possible extensions. See the [ideas index](README.md) for related proposals.

## Question and useful patterns

How unexpected is this byte given the bytes that came before it? Local entropy
measures the distribution of values, but does not describe their ordering. A
repeating `00 01 02 ... FF` ramp can contain many different values while having
predictable transitions. Conditional surprise could distinguish that structure
from data whose next byte is difficult for a simple model to predict.

Potential uses include recurring record headers, protocol-like state changes,
structured regions with occasional unusual transitions, and comparisons between
high-entropy but predictable and less predictable regions. This is a model-relative
measurement, not a file-type classifier or proof of encryption.

## First model

Start with a first-order byte-transition table over an explicitly chosen scope.
For preceding byte `a` and current byte `b`, count valid adjacent transitions:

```text
C(a,b) = occurrences of a followed by b
C(a)   = sum of C(a,x) over all 256 possible successors
P(b|a) = (C(a,b) + alpha) / (C(a) + 256*alpha)
s(i)   = -log2(P(byte[i] | byte[i-1]))
```

Use positive additive smoothing. A possible initial choice is `alpha = 1/256`,
which distributes one total pseudocount across a row; this is a proposed default,
not an existing setting. An unseen context then yields a uniform row. Expose the
smoothing parameter and raw probability rather than baking an unexplained score
into the source catalog.

Surprise describes a particular observation. Conditional entropy instead averages
surprise over a distribution; the two outputs should have distinct names. These
information-measure relationships are background in [MIT's information theory
notes](https://ocw.mit.edu/courses/6-441-information-theory-spring-2016/2243edffb30f57181ed97dcb77691580_MIT6_441S16_chapter_1.pdf).

## Scope, normalization and missing context

The first implementation could fit one model to the selected interval. Only
transitions whose two bytes lie inside that interval contribute. The initial
byte has no predecessor in that model and needs an unavailable/validity result;
do not manufacture a transition from zero just because ordinary byte recipes
currently zero-fill an out-of-range lookup.

Scoring against the same data used to fit the model is descriptive and can
understate surprise, especially in small samples. Inspection should identify that
choice. Later alternatives include a preceding training window, a reference
selection, or a sliding local model. Those change the analysis and require explicit
scope parameters, not a renderer-specific heuristic.

An individual rare transition can exceed eight bits of surprise even though a
byte alphabet has 256 symbols. Preserve raw bits. A display mapping could cap at
an explicitly chosen `C` and use `min(s, C)/C`; inspection must retain the uncapped
value, probability, smoothing, and counts. Unavailable context should remain
separate from a genuinely unsurprising transition, for example through a validity
projection that a user may map to opacity.

## Mixing and visualizations

Keep point population independent of the model. Byte points score their address;
tuple points initially score the current first-occurrence address; bin points
need an explicit byte correspondence. None of these relationships should prevent
using the result alongside spectral position, entropy, or occurrence counts.

Useful configurations include:

- Existing linear/Hilbert coordinates with hue from surprise and brightness from
  byte value, revealing unusual transitions without losing the source structure.
- A byte-pair plot positioned by the pair and colored by its conditional surprise;
  opacity can still show occurrence count.
- A cube with previous value, current value, and surprise as separate axes.

A conceptual operation would select an address, model scope, context length and
smoothing, with probability/surprise/validity projections. This is API design
notation, not a supported recipe syntax. Higher-order contexts should wait until
the first-order model demonstrates value.

## Preparation and performance

The first-order joint table has 65,536 cells, plus 256 row totals. Reuse exact
pair-count preparation where the scope agrees, without reinterpreting the
existing display-normalized occurrence factors as raw counts. A fixed table of
Float64 counters occupies about 512 KiB before other buffers; its supported counts
must remain within the exact integer range.

Build once per source/scope/model revision; all points and channels using that
model share it. Camera and appearance changes should reuse it. Sliding scopes
can update entering/leaving valid pair starts using the same staged-cancellation
principle as [histograms](../../src/analysis/histograms.js). A separate model per point would
be far more expensive and should not be an implicit upgrade.

## Inspection and first increment

Report both byte addresses/values, model range, transition and row counts,
`alpha`, estimated probability, raw bits, display cap, and validity. If a local
model is added, show its exact training range and whether the scored transition
is included.

Start with one selected-window model and probability/surprise/validity outputs.
Validate constant runs, repeated ramps, alternating sequences, injected anomalies,
unseen contexts, selection boundaries, and equivalent cached/fresh models. Check
that changing sampling limits does not change exact model counts, and that the
large scalar score is normalized before the existing output clamp.

A useful completion example is a repeated ramp with one altered transition:
ordinary entropy stays broadly similar while the new visualization exposes the
alteration under the documented model.
