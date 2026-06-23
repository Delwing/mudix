# Map architecture: separating data from view — done

The data layer and view layer are now cleanly split. This file is a record of
what shipped; the plan it used to describe is complete.

## What shipped

**Upstream (`mudlet-map-renderer`, now v2.5.x).** The renderer exposes
`IMapReader`, `IArea`, `IPlane`, `IExit` as public interfaces, and
`MapRenderer`'s constructor accepts an `IMapReader` rather than the concrete
`MapReader`. A `mudlet-map-renderer/binary` subpath ships `BinaryMapReader`
(peer-dep on `mudlet-map-binary-reader`, zero bundle cost otherwise).

**Mudix.**

- `MapStore` is the single source of truth. `loadFromBinary` deserializes
  rooms / areas / hashes / env-colors / user data into the store, so
  `getRoomName`, `getRoomCoordinates`, `getRoomArea`, `getRoomIDbyHash`, etc.
  all see binary rooms uniformly — the same as programmatically-built ones.
- `MudixMapReader` (`src/map/MudixMapReader.ts`) is a live `IMapReader` over
  `MapStore`, version-gated so the inner reader only rebuilds when the store
  actually mutates. `MapPanel` constructs it once on mount and holds it for the
  panel's lifetime — no per-change `initRenderer` rebuilds.
- The old view-shaped leaks on the session manager (`cachedMapData`,
  `setHashMap`, `hashToRoomId`, `initRenderer`) are gone. `MapPanel` is a pure
  view: binary ingest writes only to `MapStore`; the panel owns render
  lifecycle, not data plumbing.

## Optional follow-up (not planned, perf only)

`MudixMapReader.buildInner()` still round-trips through
`readerExport(store.toMudletMap())` to produce the renderer's `{mapData,
colors}` wire format, with a pixmap-stripping hack to keep the `cloneDeep`
cheap on label-heavy maps. A fully-live reader would skip `readerExport`
entirely by implementing `IArea` / `IPlane` / `IExit` directly against
`MapStore`. The interfaces are public, so it's feasible — but the current path
is version-gated (rebuilds only on real mutation) and the clone cost is already
defused, so the payoff is marginal. Pursue only if large maps show measurable
render-rebuild cost.
