# Map architecture: separating data from view

## Where we are

After the script/map load-order fix, timing matches Mudlet: `WindowManager.bootstrapMap()` runs before `ScriptingEngine.applyScriptsFromStore()`, scripts and `sysLoadEvent` see an initialized `MapStore`, and `sysMapLoadEvent` fires after a successful binary ingest (both at boot and on subsequent `loadMap()` calls).

What still isn't right: the data layer and the view layer are entangled. Two leaks today —

1. `WindowManager.cachedMapData` holds renderer-format data (`{ mapData, colors }` from `readerExport`) on the session manager. That's a view-shaped object living in the session/data layer.
2. Binary rooms / areas / env-colors only exist inside that cached payload. `MapStore` gets the binary's hashes (via `setHashMap`) and map-level user data, but not the rooms themselves. As a result, `getRoomIDbyHash` and `getMapUserData` work against binary maps, but `getRoomName(id)`, `getRoomCoordinates(id)`, `getRoomArea(id)`, etc. don't see binary rooms.

Mudlet's shape: `TMap` is the data source-of-truth, owned by `Host`. `T2DMap` is a view that draws from the data model. You can `loadMap()` without ever opening the map widget; scripts query rooms either way.

## Why this isn't fixed yet

`mudlet-map-renderer` exposes `MapReader` as a concrete class, not an interface. `MapRenderer`'s constructor:

```ts
constructor(mapReader: MapReader, settings?: Settings, container?: HTMLDivElement, ...)
```

The same goes for what `MapReader` returns — `Area`, `Plane`, `Exit` are concrete classes with private state, used internally by the renderer's draw path. There is no public interface to implement.

That leaves three shapes for a downstream like Mudix:

- **Translate-on-render.** Keep `MapReader` as-is; rebuild it from `mapStore.toRendererData()` whenever the store changes. Memoize by a store version counter; for large maps, scope the rebuild to dirty areas. Contained complexity but real translation cost on every mutation.
- **Patch the renderer upstream.** Extract an interface from `MapReader`'s public surface and have `MapRenderer` accept that interface. Downstream apps can then hand the renderer a live reader that queries their own data model — no translation, no rebuilds. Architecturally correct.
- **Hacky subclass.** TS-private fields are runtime-plain, so `MudixMapReader extends MapReader` and override the public methods. But the renderer reaches through to `Area` → `Plane` → `Exit`, each with internal state of its own. Fragile against renderer upgrades; not worth the maintenance tax.

`mudlet-map-renderer` is ours (see the `-konva` versioned package). The upstream patch is the right path.

## Future work in Mudix (blocked on the upstream patch)

Once `MapRenderer` accepts a reader interface:

1. **Unify map data in `MapStore`.** Binary ingest deserializes rooms / areas / areaNames / hashes / customEnvColors / userData into `MapStore`. `MapStore.rooms` is already typed as `Map<number, MudletRoom>`, so the ingest itself is mostly a copy loop. Bump `nextRoomId` / `nextAreaId` past any binary IDs to keep `createRoomID()` collision-free. Batch the store's `notify()` calls during bulk ingest so subscribers don't fire per-room.
2. **Drop view-shaped leaks from `WindowManager`.** Remove `cachedMapData`, `hashToRoomId`, and `setHashMap`. Hash lookups go through `mapStore.getRoomIDbyHash` only.
3. **Implement `MudixMapReader`.** Queries `MapStore` for rooms/areas live. `MapPanel` constructs it once on mount and hands it to `MapRenderer`. No more `initRenderer` rebuilds on store change — the renderer redraws against the existing reader, and the reader sees current data.
4. **`MapPanel` becomes a pure view.** The `mapStore.subscribe` effect currently re-runs `initRenderer(toRendererData())` on every change. With a live reader, the subscribe callback just asks the renderer to redraw (e.g. via the dirty-area mechanism on `Area.markDirty`). Binary ingest writes only to `MapStore`; the panel's role is render lifecycle, not data plumbing.
5. **Audit `centerView`.** Currently uses `readerRef.current.getRoom(roomId)` to look up the room's area/z. Still works under a live reader — but verify when the time comes that the live reader's `getRoom` returns shape-compatible data.

After this, room queries from scripts behave like Mudlet's: any room — programmatic or binary — is uniformly visible to `getRoomName`, `getRoomCoordinates`, `getRoomArea`, etc.

## Upstream task — `mudlet-map-renderer`

**Goal.** Let downstream apps supply a live reader instead of a `MapData.Map` blob.

**Scope.**

1. Extract a public interface from `MapReader`'s observable surface. Approximate shape (verify against current `MapReader.d.ts`):

   ```ts
   export interface IMapReader {
       getArea(areaId: number): IArea;
       getExplorationArea(areaId: number): IExplorationArea | undefined;
       getAreas(): IArea[];
       getRooms(): MapData.Room[];
       getRoom(roomId: number): MapData.Room;
       decorateWithExploration(visitedRooms?: Iterable<number> | Set<number>): Set<number> | undefined;
       getVisitedRooms(): Set<number> | undefined;
       clearExplorationDecoration(): void;
       isExplorationEnabled(): boolean;
       setVisitedRooms(visitedRooms: Iterable<number> | Set<number>): Set<number>;
       addVisitedRoom(roomId: number): boolean;
       addVisitedRooms(roomIds: Iterable<number>): number;
       hasVisitedRoom(roomId: number): boolean;
       getColorValue(envId: number): string;
       getSymbolColor(envId: number, opacity?: number): string;
   }
   ```

2. Do the same for the objects `MapReader` returns and the renderer subsequently calls methods on — at minimum `Area` (→ `IArea`), `Plane` (→ `IPlane`), `Exit` (→ `IExit`), `ExplorationArea` (→ `IExplorationArea`). Each interface mirrors only what the renderer (and other public consumers) actually call on those objects; private/protected members are not part of the interface.

3. Change `MapRenderer`'s constructor signature to accept `IMapReader` instead of the concrete `MapReader`:

   ```ts
   constructor(mapReader: IMapReader, settings?: Settings, container?: HTMLDivElement, backendFactory?: ...)
   ```

   Same for `AreaMapRenderer`.

4. The existing concrete `MapReader` class implements `IMapReader` (and similarly `Area implements IArea`, etc.). All current call sites that construct `new MapReader(mapData, envs)` keep working unchanged — structural compatibility is the upgrade path.

5. Export the interfaces from the package's public entry (`dist/index.d.ts`).

**Non-goals.**

- Don't reshape the data formats (`MapData.Map`, `MapData.Room`, …). Those stay as-is.
- Don't make the renderer reactive to data changes on its own. The redraw lifecycle (existing `Area.markDirty()` / `getVersion()` mechanism) stays the renderer's contract; downstream apps trigger redraws when their data changes.

**Acceptance.**

- Existing demos and tests in `mudlet-map-renderer` pass without modification.
- A new test (or demo example) shows `MapRenderer` constructed from a hand-rolled `IMapReader` implementation that does not extend `MapReader`. The renderer draws correctly for a small synthetic map and reflects updates when the custom reader's underlying data changes + the dirty-mark contract is invoked.
- Public surface remains backwards-compatible: importing and using `MapReader` as today still works.

**Notes for the implementing agent.**

- Start by reading every renderer-side call site that touches a `MapReader`, `Area`, `Plane`, `Exit`, or `ExplorationArea` instance. Anything called from outside those classes is part of the interface; anything called only from within stays a private/protected method on the concrete class.
- Watch for places where the renderer relies on object identity (e.g. caching by `Area` reference). Those still work under the interface contract because the live reader returns stable instances, but flag any case where the renderer assumes `MapReader.prototype` methods specifically.
- `Area.protected markDirty()` — decide whether the dirty-versioning lives on the interface (`markDirty()` / `getVersion()`) or stays an implementation detail that downstream readers replicate themselves. Probably keep `getVersion()` on the interface and let `markDirty` be the concrete class's affair.
