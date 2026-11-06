# Reusable recipe experiments

`src/recipes/recipe-experiments.js` exports three factories that return ordinary serializable
expression data. They add no population, provider family, preset painter or menu
entry. Their outputs compile, inspect and save through the existing recipe/profile
pipeline. The analysis proposals remain in [ideas](ideas/README.md); the factories
below are implemented.

## Byte differences

```js
import { byteDifferences } from "./src/recipes/recipe-experiments.js";

const { signed, magnitude, valid } = byteDifferences({ lag: 16 });
const appearance = view.effectiveAppearance;
view.appearance = {
  ...appearance,
  hue: signed,
  lightness: magnitude,
  opacity: {
    op: "multiply",
    a:
      appearance.opacity === "none"
        ? { op: "constant", value: 1 }
        : appearance.opacity,
    b: valid,
  },
};
```

The lag defaults to one source byte and must be an integer from 1 to 1,000,000.
Signed is `(byte[i] - byte[i-lag] + 255) / 510`; zero change is 0.5. Magnitude is
`abs(byte[i] - byte[i-lag]) / 255`. Valid is zero for the first `lag` selected
addresses and one afterward. It masks missing input without turning the zero-fill
lookup into a misleading first-byte jump. Values themselves retain their ordinary
lookup behavior even where valid is zero; apply the mask to visibility explicitly.

This compares representative byte reads. It does not compare averaged source
intervals, average all differences inside a sampled interval, or interpret a
255-to-zero wrap as a small modular increment. Population and coordinates remain
unchanged in the example. Existing opacity is multiplied by validity rather than
silently discarded; hue and lightness are deliberately replaced.

## Lagged coordinates

```js
import { laggedCoordinates } from "./src/recipes/recipe-experiments.js";

const { position, valid } = laggedCoordinates({ lag: 16, dimensions: 3 });
view.pointConfiguration = {
  ...view.pointConfiguration,
  space: "cube",
  footprint: "point",
  position,
};
const appearance = view.effectiveAppearance;
view.appearance = {
  ...appearance,
  opacity: {
    op: "multiply",
    a:
      appearance.opacity === "none"
        ? { op: "constant", value: 1 }
        : appearance.opacity,
    b: valid,
  },
};
```

Coordinates are normalized byte reads at `i`, `i+lag`, and optionally `i+2*lag`.
Defaults are lag one, three dimensions. Two dimensions return a three-slot position
array with `"none"` for Z, so an unused third byte read never enters the DAG; use a
square or circle space for that case. The lag maximum is 1,000,000 in two dimensions
and 500,000 in three, ensuring every generated literal fits recipe validation.
Validity excludes starts whose final required byte lies outside the selection.
Lags longer than the selection are valid configurations with no valid starts.

The example changes space, footprint and position; it preserves population,
dimension settings, sampling, inversion, backend and appearance besides the explicit
opacity mask. Choose other spaces deliberately. A pair/triple population uses its
current occurrence representative, not a new histogram of delayed pairs/triples.
A bin population uses its existing byte correspondence; the coordinates are not
intrinsic DFT coefficients. Sample limits do not renumber source addresses.

## Entropy contrast in bits

```js
import { entropyContrast } from "./src/recipes/recipe-experiments.js";

const { small, large, contrast, magnitude } = entropyContrast({
  smallWindow: 32,
  largeWindow: 256,
});
view.appearance = {
  ...view.effectiveAppearance,
  hue: contrast,
  lightness: large,
};
```

Windows must be integers from 1 to 4096, with `smallWindow <= largeWindow`; equal
sizes are allowed. Defaults are 32 and 256. Each normalized provider output is
first multiplied by `min(8, log2(window))` to recover its bit scale. Returned
`small` and `large` divide those values by eight for display. `contrast` maps
`Hsmall - Hlarge` from `[-8, 8]` to `[0, 1]`, and `magnitude` maps the absolute bit
difference from `[0, 8]`. Zero contrast is 0.5; positive contrast means greater
small-window entropy in bit units. A one-byte window has zero entropy.

At an interior point of a repeating 00–FF ramp, a 32-byte window has five bits and
a 256-byte window has eight. Small is therefore 5/8, large is one, contrast is
5/16 and magnitude is 3/8. Subtracting the two providers' normalized values would
instead conflate their different achievable maxima.

The factory intentionally retains the existing 32-byte provider's 8-bit
quantization. Multiplying by five cannot restore precision already rounded away.
Other windows use existing Float32 results. Root-source context outside the selected
interval remains available; file edges clip the input while retaining the requested
window's normalization denominator. These are addressed neighborhoods, not an
average over all bytes represented by a sampled mark. Finite-window estimator
bias remains even after converting to common bit units.

## Composition, persistence and verification

Factories do not mutate views or share mutable output objects across calls. You
can use any returned scalar in a named factor, position or appearance recipe.
Their internal expressions are ordinary graphs, so shared byte reads and entropy
windows are interned/prepared once by the normal compiler/provider. Byte differences
and delayed coordinates request no FFT, entropy or histogram on their own; entropy
contrast requests only its reachable windows. Unrelated channels may independently
require additional providers.

Apply only the channels needed for an experiment and use **Preset → Save As** to
save the resulting view normally. The saved JSON contains expressions rather than
a reference to these factories, so loading requires no special experiment schema.
Updating parameters means generating new expression data and replacing the chosen
channels. There is no executable JavaScript stored in a recipe.

`bun tests/recipe-experiments.js` checks constants, ramps, wraparound, repeated
records, prefix/tail masks, exact addresses beyond Float32's adjacent-integer range,
bit-scaled entropy, file context, legacy quantization, provider requirements,
parameter rejection and profile round trips.
