# Morton coordinates and alternative space-filling curves

Current delivery: Morton 2D/3D expressions are implemented. H-curve remains behind the original independent-definition/fixture gate. See [implemented behavior](../recipes.md) and [PLAN audit](PLAN.md#browser-delivery-audit). The remainder retains the original design discussion.

Original proposal: These are explicit expression transforms, never a return of a
global Layout switch.

## What CantorDust implements

[MetricMap.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/MetricMap.java) selects Hilbert, linear, Z-order and H-curve
mappings. [Zorder.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/Zorder.java) implements bit-interleaved coordinates;
[HCurve.java](https://github.com/Battelle/cantordust/blob/32aff4173b640d440641ea9076c80fe85000b2f0/resources/HCurve.java) implements a recursive two-dimensional mapping
with power-of-two square constraints. Thea already implements explicit 2D/3D
Hilbert coordinate recipes. Morton and H-curve operators are the actual gaps.

## Why add Morton first

Morton order is useful for testing whether data is tiled or arranged by interleaved
coordinate bits. It provides a different spatial grouping from Hilbert without
changing the underlying population or analysis. It is also small enough to add
as one pure vector operation with a clear integer contract.

Start with morton2d(index, order), returning normalized cell centers using the
same exact-index versus normalized-scalar conventions as Hilbert. Define x as
the even numbered low index bits and y as the odd ones, or document another
convention once and fix it in fixtures. Extend to morton3d with interleaved xyz
bits once two-dimensional semantics are established. Do not silently flip axes
to match a screenshot: recipes can explicitly permute components.

## Pipeline integration

Add vector validation, typed DAG compilation, CPU evaluation, expression menus,
provenance descriptions and shader emission together. Exact indices must not
first pass through Float32 normalized values. Bound orders using the intersection
of JavaScript exact integer support and actual shader integer capacity; a simple
initial implementation may share Hilbert's conservative limits. Avoid JavaScript
bitwise operators beyond their 32-bit contract.

The operator takes a point ordinal, byte index or other explicit expression.
Geometry dimensions then scale/truncate its outputs in the existing way. A bin
population or tuple population can use Morton just as byte points can; the
transform must not claim a privileged analysis domain.

## H-curve and completion criteria

Treat H-curve as a later experiment until an independent definition, orientation
and useful fixtures are agreed. The upstream class is an implementation example,
not a specification or proof of invertibility. There is no reason to recreate its
mutable point-to-index cache when Thea already retains mark provenance.

Exhaustively check uniqueness and bounds at small orders, known index-coordinate
pairs, and inverse round trips if an inverse is added. Morton is not continuously
adjacent like Hilbert, so Manhattan adjacency is the wrong acceptance criterion.
Test 2D/3D CPU-shader agreement at largest supported indices and saved-profile
round trips. Implement after the compact bit operations foundation; no new provider
or memory-heavy preparation is necessary.
