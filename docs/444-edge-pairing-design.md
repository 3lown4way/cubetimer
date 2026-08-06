# 4×4 edge pairing design

## Scope

This stage begins from a state with all 24 centers solved and produces a state with all 12 edge pairs formed. It includes last-two-edge handling but deliberately stops before parity normalization and virtual 3×3 solving.

## Wing coordinate

The solver derives 24 oriented wing positions directly from the independent 96-facelet geometry. Each wing is represented by its 12-way color-pair type and a one-bit orientation.

## Center-preserving macros

Every search action is a six-move wing 3-cycle macro. During table construction, each macro is reapplied to the 96-facelet model and rejected unless it:

- leaves all centers solved;
- preserves every edge pair fixed by earlier phases;
- maps wings consistently with the compact coordinate.

## Exact search phases

The first eight edge types are fixed sequentially using exact reverse distance tables. Their reachable state counts are:

`552 / 462 / 380 / 306 / 240 / 182 / 132 / 90`

Their exact macro diameters are:

`8 / 7 / 9 / 8 / 8 / 8 / 8 / 5`

The remaining four edge types are solved jointly with an exact 40,320-state table of diameter 10. This final coordinate covers last-two-edge cases without a fallback path.

## Verification contract

The generated edge algorithm is reapplied to the original centered 96-facelet state. The stage is exposed only when:

- all centers remain solved;
- all 12 wing pairs are paired;
- corner, wing, center, and color inventories remain physically valid.

The result remains a partial reduction stage. It is not promoted to a complete 4×4 solution until parity normalization, virtual 3×3 conversion, the Two-Phase bridge, and final full-solution verification are complete.
