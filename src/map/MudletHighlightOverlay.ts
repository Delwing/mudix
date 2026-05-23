import type {
    CircleShape,
    MapState,
    SceneOverlay,
    SceneOverlayContext,
    Shape,
    ViewportBounds,
} from 'mudlet-map-renderer';
import type {MapStore, RoomHighlight} from './MapStore';
import type {MudixMapReader} from './MudixMapReader';

/**
 * Mudlet-style room highlight overlay. Registered with the renderer via
 * `addSceneOverlay`, so it's engine-agnostic and also appears in SVG/PNG
 * exports.
 *
 * Mudlet draws each highlight as a `QRadialGradient` circle centred on the
 * room, with `setColorAt(0, color1)` and `setColorAt(0.95, color2)` and a
 * radius of `roomSize * highlight.radius`. The renderer's `Paint` only
 * supports a solid fill, so we approximate the gradient by emitting N
 * concentric filled disks (outermost first) whose colour+alpha is sampled
 * from Mudlet's gradient at each disk's outer edge. Konva paints them in
 * array order, so each inner disk covers the outer ones, leaving a stepped
 * gradient that visually matches Mudlet's smooth one.
 *
 * The renderer's built-in `renderHighlight(id, color)` takes a single solid
 * colour and discards the gradient — this overlay replaces it so scripts
 * that pass real (r1,g1,b1, r2,g2,b2, a1, a2, radius) tuples render the way
 * Mudlet draws them.
 */
const GRADIENT_RINGS = 16;
/** Matches Mudlet's `QRadialGradient` outer stop position. */
const OUTER_STOP = 0.95;

export class MudletHighlightOverlay implements SceneOverlay {
    private ctx?: SceneOverlayContext;
    private mapStoreUnsub?: () => void;
    private areaHandler?: () => void;

    constructor(
        private readonly mapStore: MapStore,
        private readonly reader: MudixMapReader,
    ) {}

    attach(ctx: SceneOverlayContext): void {
        this.ctx = ctx;
        // Script-driven highlightRoom / unHighlightRoom flows through MapStore;
        // area / level switches flow through MapState. Either kind of change
        // means we need to re-emit shapes.
        this.mapStoreUnsub = this.mapStore.subscribe(() => ctx.invalidate());
        this.areaHandler = () => ctx.invalidate();
        ctx.state.events.on('area', this.areaHandler);
    }

    detach(): void {
        this.mapStoreUnsub?.();
        if (this.areaHandler && this.ctx) {
            this.ctx.state.events.off('area', this.areaHandler);
        }
        this.ctx = undefined;
    }

    /** Force a re-render from outside. The renderer's `refresh()` doesn't
     *  emit any state event we listen to, but a change to settings.roomSize
     *  moves every highlight circle's radius. */
    refresh(): void {
        this.ctx?.invalidate();
    }

    render(state: MapState, _bounds: ViewportBounds): Shape[] | void {
        const {currentArea, currentZIndex, settings} = state;
        if (currentArea === undefined || currentZIndex === undefined) return;
        const roomSize = settings.roomSize;
        const shapes: Shape[] = [];
        for (const [roomId, hl] of this.mapStore.getRoomHighlights()) {
            const room = this.reader.getRoom(roomId);
            if (!room || room.area !== currentArea || room.z !== currentZIndex) continue;
            const radiusFactor = hl.radius > 0 ? hl.radius : 1;
            const fullRadius = roomSize * radiusFactor;
            emitGradientDisks(shapes, room.x, room.y, fullRadius, hl);
        }
        return shapes;
    }
}

/** Emit N concentric filled disks for one highlight, outer→inner, sampling
 *  Mudlet's `QRadialGradient(0=color1, 0.95=color2)` at each disk's outer edge. */
function emitGradientDisks(out: Shape[], cx: number, cy: number, fullRadius: number, hl: RoomHighlight): void {
    for (let i = GRADIENT_RINGS; i >= 1; i--) {
        const t = i / GRADIENT_RINGS;
        const radius = fullRadius * t;
        if (radius <= 0) continue;
        const {r, g, b, a} = sampleGradient(t, hl);
        out.push({
            type: 'circle',
            cx,
            cy,
            radius,
            paint: {fill: `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`},
        } satisfies CircleShape);
    }
}

function sampleGradient(gradientPos: number, hl: RoomHighlight): {r: number; g: number; b: number; a: number} {
    if (gradientPos >= OUTER_STOP) {
        return {r: hl.r2, g: hl.g2, b: hl.b2, a: hl.a2};
    }
    const t = gradientPos / OUTER_STOP;
    return {
        r: Math.round(hl.r1 + (hl.r2 - hl.r1) * t),
        g: Math.round(hl.g1 + (hl.g2 - hl.g1) * t),
        b: Math.round(hl.b1 + (hl.b2 - hl.b1) * t),
        a: hl.a1 + (hl.a2 - hl.a1) * t,
    };
}
