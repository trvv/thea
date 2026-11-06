# Ideas and future work

This folder collects proposals and experiments. It is not a list of implemented
features. Current behavior is documented in the [main documentation](../README.md),
[pipeline contracts](../pipeline.md), and [recipe reference](../recipes.md).

The [sequential implementation plan](PLAN.md) combines all proposals below and
the source-backed [CantorDust comparison](cantordust-comparison.md). It records
delivery order, dependencies, acceptance gates and completed increments. The
[analysis review](analysis-implementation.md) and
[infrastructure review](infrastructure-implementation.md) provide implementation
details for that single plan.

The goal is to add useful measurements while keeping analysis sources freely
mixable. A byte, tuple or frequency-bin population determines which marks exist;
it does not exclusively own a family of factors. Future optimizations should
follow the requested operations and shared pipeline stages rather than preset
names.

See [remaining proposed work](REMAINING-WORK.md) for a consolidated, current list
and [the performance follow-up](PERFORMANCE-PLAN.md) for the active implementation.

See [workflow and interface design](workflow-interface.md) for pane ownership,
cross-highlighting, selections, portable files, tabs/drop handling, search and
structured editing.

## Analysis proposals

| Idea                                                      | Main question                                                       | Initial implementation boundary                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [Conditional surprise](conditional-surprise.md)           | How unexpected is a byte given its predecessor?                     | One explicitly scoped transition model with smoothing, probability, surprise and validity.       |
| [Lag dependence](lag-dependence.md)                       | Which byte separations preserve relationships?                      | One configurable lag; equality/difference before local mutual information or automatic searches. |
| [Distribution change](distribution-change.md)             | Where do neighboring byte distributions change?                     | Two explicit histograms and one named bounded comparison metric.                                 |
| [Repetition distance](repetition-distance.md)             | Where did this byte block occur previously?                         | Exact fixed-width nearest matches inside a configured history.                                   |
| [Bit structure](bit-structure.md)                         | Which individual bits or masks carry structure?                     | Existing bit-extraction experiments, then compact operations and shared rolling bit statistics.  |
| [Numeric interpretations](numeric-interpretations.md)     | Do explicit word/float interpretations expose coherent values?      | Configurable 16/32-bit reads with endian, validity, normalization and byte provenance.           |
| [Localized spectral energy](localized-spectral-energy.md) | Where does a periodic component start or disappear?                 | Explicit frames and one local band-energy projection, not a new mandatory spectrogram mode.      |
| [Multibyte encoding ideas](<MULTIBYTE ENCODING IDEAS.md>) | Can the inspected byte participate in a useful text interpretation? | Bounded UTF-8 context first; UTF-16/32 candidates and encoding-derived factors later.            |

Each proposal discusses its meaning, parameters, boundaries, visualization uses,
population relationships, performance, inspection and acceptance fixtures. Any
API sketches in those documents are proposals unless explicitly marked as current
recipe examples.

Delivered browser milestones now include the statistical, numeric/text, packed-pixel, reference, occurrence and comparison features. Consult the [PLAN delivery audit](PLAN.md#browser-delivery-audit) for exact boundaries and the optional research gates, rather than treating every proposed extension as done.

## Experiments using current recipes

These can be explored before adding new provider families or source enums:

- [Byte differences](byte-differences.md): signed/magnitude changes, configurable
  comparison offsets, edge masks, and representative-versus-averaged semantics.
- [Lagged coordinate plots](lagged-coordinate-plots.md): explicit delayed-byte
  coordinates in two or three dimensions, with population and shading independent.
- [Entropy across scales](multiscale-entropy.md): short/long neighborhoods,
  normalized-versus-bit comparisons, signed contrast, and provider reuse.

The JavaScript examples create existing recipe data and assign it to a host's
`view`. They do not introduce executable user expressions or a new language.

## Shared design requirements

1. **State the address relationship.** Byte-local measurements on a tuple use an
   occurrence; those on a bin need a byte correspondence. A global spectrum
   coefficient is not a local byte explanation.
2. **State the scope and boundaries.** Root-source context, selected intervals,
   training histories, alignment origins, missing input and padding are distinct
   choices. File-edge clipping must be inspectable.
3. **Preserve raw meaning before display mapping.** Counts, probabilities, bits,
   numeric values and addresses need explicit normalization. Nonfinite or missing
   input must not become a misleading valid zero.
4. **Keep aggregation explicit.** Reading at one representative, averaging a
   measurement over bytes, and reducing over every tuple occurrence are different
   analyses. Sampling limits do not silently redefine exact statistics.
5. **Prepare reachable work once.** Shared expressions/providers should reuse
   byte reads, count tables or coefficients. Sparse lookups should not require an
   unbounded whole-source result array by design.
6. **Explain results through inspection.** Keep input ranges, parameters,
   intermediate values and final trait mapping available on demand. Do not attach
   a large metadata object to every rendered mark.
7. **Keep ordinary configurations on the same pipeline.** New providers should
   not introduce dedicated preset painters, exclusive domains, or a second layout
   mechanism.

## Suggested exploration order

Start with the three recipe experiments to find useful visual configurations and
exercise inspection. They offer concrete results with little new machinery.

For new measurements, conditional surprise and one-lag equality/dependence are
promising next steps: they examine ordering that ordinary byte entropy leaves
unexplained. Distribution change adds a different question about neighboring
composition. The order should follow useful fixtures and measured preparation
cost rather than becoming a commitment to build everything.

Bit operations and numeric reads offer relatively direct interpretation tools.
Repetition indexes and localized transforms deserve explicit memory/work budgets
before broad deployment. Multibyte decoding can begin independently as an
on-demand inspection feature; plausible local matches are useful even without a
file-wide encoding decision.

## Existing planning documents

- [CantorDust comparison](cantordust-comparison.md): packed pixels, byte-frequency
  population, coordinate curves, occurrence/address navigation, linked views,
  content resemblance and density mapping, with pinned upstream source evidence.
- [Sequential plan](PLAN.md): combined implementation order and current progress.

- [Detailed next steps](next-steps.md): provider paging, instrumentation, overview
  sharing, selective GPU execution, occurrence relationships, editing and testing.
- [Direction and open decisions](roadmap.md): broader project direction and the
  existing foundations that make these ideas possible.

Those documents were moved here with the multibyte proposal so future work has
one home. [Measured performance](../performance.md) remains outside this folder
because it records current results and limitations rather than a proposed feature.
