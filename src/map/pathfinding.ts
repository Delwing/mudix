import type {MudletRoom} from 'mudlet-map-binary-reader';

// Mudlet direction number → field name on MudletRoom
const DIR_FIELD: Record<number, string> = {
    1: 'north', 2: 'northeast', 3: 'northwest', 4: 'east', 5: 'west',
    6: 'south', 7: 'southeast', 8: 'southwest', 9: 'up', 10: 'down',
    11: 'in', 12: 'out',
};

// Short direction names emitted into speedWalkDir / used to key exitWeights.
const DIR_SHORT: Record<number, string> = {
    1: 'n', 2: 'ne', 3: 'nw', 4: 'e', 5: 'w',
    6: 's', 7: 'se', 8: 'sw', 9: 'up', 10: 'down',
    11: 'in', 12: 'out',
};

export interface PathfindResult {
    /** Room ids visited in order, excluding the start room. Matches Mudlet's
     *  speedWalkPath, which prepends each step until reaching `from` but never
     *  prepends `from` itself. */
    path: number[];
    /** Direction taken at each step — short name ("n"/"ne"/"up"/"down"/"in"/"out")
     *  for stock exits or the verbatim command string for special exits. Same
     *  length as `path` / `weights`. */
    dirs: string[];
    /** Edge cost per step (target room weight, or per-exit weight override). */
    weights: number[];
    /** Sum of `weights` — Mudlet's getPath returns this alongside the bool. */
    totalWeight: number;
}

/**
 * Mudlet `findPath(from, to)` — A* shortest path. Heuristic mirrors Mudlet's
 * TAstar.h: 3D Euclidean distance when both rooms share an area, constant 1
 * (equivalent to Dijkstra) when they don't — Mudlet falls back because raw
 * coordinates aren't comparable across areas. Edge cost is the per-exit
 * override in `exitWeights[key]` if set, otherwise the target room's `weight`
 * (clamped to ≥1 to keep the heap monotonic).
 *
 * Skips locked rooms (`isLocked`), locked stock-direction exits (`exitLocks`
 * carries the 1-12 dir codes), and locked special exits. The binary reader
 * keys special-exit locks by destination room id (`mSpecialExitLocks` is an
 * array of target ids) — its round-trip loses per-command resolution when
 * multiple cmds share a destination, but that's the on-disk representation.
 *
 * Trivial `from == to` returns an empty path with totalWeight 0 (also
 * Mudlet's behavior). Returns null when either room is missing or no route
 * exists.
 */
export function findPath(
    rooms: ReadonlyMap<number, MudletRoom>,
    from: number,
    to: number,
): PathfindResult | null {
    const startRoom = rooms.get(from);
    const goalRoom = rooms.get(to);
    if (!startRoom || !goalRoom) return null;
    if (from === to) return { path: [], dirs: [], weights: [], totalWeight: 0 };

    const goalArea = goalRoom.area;
    const gx = goalRoom.x, gy = goalRoom.y, gz = goalRoom.z;
    const heuristic = (id: number): number => {
        const r = rooms.get(id);
        if (!r || r.area !== goalArea) return 1;
        const dx = gx - r.x, dy = gy - r.y, dz = gz - r.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };

    // Binary min-heap of [fScore, id]. Stale entries (a room re-inserted with
    // a better g) are filtered by checking gScore on pop.
    const open: Array<[number, number]> = [];
    const heapPush = (item: [number, number]): void => {
        open.push(item);
        let i = open.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (open[p][0] <= open[i][0]) break;
            [open[p], open[i]] = [open[i], open[p]];
            i = p;
        }
    };
    const heapPop = (): [number, number] | undefined => {
        const top = open[0];
        const last = open.pop();
        if (open.length > 0 && last) {
            open[0] = last;
            let i = 0;
            const n = open.length;
            for (;;) {
                const l = i * 2 + 1, r = l + 1;
                let best = i;
                if (l < n && open[l][0] < open[best][0]) best = l;
                if (r < n && open[r][0] < open[best][0]) best = r;
                if (best === i) break;
                [open[best], open[i]] = [open[i], open[best]];
                i = best;
            }
        }
        return top;
    };

    const gScore = new Map<number, number>();
    const came = new Map<number, { from: number; dir: string; cost: number }>();
    gScore.set(from, 0);
    heapPush([heuristic(from), from]);

    while (open.length > 0) {
        const [f, current] = heapPop()!;
        if (current === to) {
            const path: number[] = [];
            const dirs: string[] = [];
            const weights: number[] = [];
            let total = 0;
            let cur = to;
            while (cur !== from) {
                const link = came.get(cur);
                if (!link) return null;
                path.unshift(cur);
                dirs.unshift(link.dir);
                weights.unshift(link.cost);
                total += link.cost;
                cur = link.from;
            }
            return { path, dirs, weights, totalWeight: total };
        }
        // Skip stale heap entries — a better path was already queued.
        const curG = gScore.get(current);
        if (curG === undefined || f - heuristic(current) > curG + 1e-9) continue;

        const room = rooms.get(current);
        if (!room || room.isLocked) continue;

        const exitWeights = room.exitWeights ?? {};
        const lockedDirs = room.exitLocks ?? [];

        // Stock 12 directions
        for (const dirIntStr of Object.keys(DIR_FIELD)) {
            const di = Number(dirIntStr);
            if (lockedDirs.includes(di)) continue;
            const field = DIR_FIELD[di];
            const target = (room as unknown as Record<string, number>)[field];
            if (!target || target <= 0 || target === current) continue;
            const targetRoom = rooms.get(target);
            if (!targetRoom || targetRoom.isLocked) continue;
            const shortKey = DIR_SHORT[di];
            const rawCost = exitWeights[shortKey] ?? targetRoom.weight ?? 1;
            const cost = rawCost > 0 ? rawCost : 1;
            const tentative = curG + cost;
            if (tentative < (gScore.get(target) ?? Infinity)) {
                gScore.set(target, tentative);
                came.set(target, { from: current, dir: shortKey, cost });
                heapPush([tentative + heuristic(target), target]);
            }
        }

        // Special exits — keyed by command string. Lock filter is by
        // destination id (binary-reader convention; see function docs).
        const lockedSpecialTargets = room.mSpecialExitLocks ?? [];
        for (const [cmd, target] of Object.entries(room.mSpecialExits ?? {})) {
            if (!target || target <= 0 || target === current) continue;
            if (lockedSpecialTargets.includes(target)) continue;
            const targetRoom = rooms.get(target);
            if (!targetRoom || targetRoom.isLocked) continue;
            const rawCost = exitWeights[cmd] ?? targetRoom.weight ?? 1;
            const cost = rawCost > 0 ? rawCost : 1;
            const tentative = curG + cost;
            if (tentative < (gScore.get(target) ?? Infinity)) {
                gScore.set(target, tentative);
                came.set(target, { from: current, dir: cmd, cost });
                heapPush([tentative + heuristic(target), target]);
            }
        }
    }
    return null;
}
