import { Suspense, lazy, useMemo } from 'react';
import type { EditorPlugin } from 'mudlet-map-editor';
import { ResizableModal } from './ResizableModal';
import { useAppStore } from '../storage';
import { loadMap as loadMapBytes } from '../storage/mapStorage';
import type { WindowManager } from './windows/WindowManager';

// Lazy boundary keeps the editor bundle (Monaco + Konva + i18next) and its
// stylesheet out of mudix's startup. The editor's stylesheet ships with every
// selector pre-prefixed with `.mudlet-editor-root` (postcss-prefix-selector
// during the library build, see the editor's vite.lib.config.ts), so its
// rules only match elements inside its own root subtree and there's nothing
// for mudix to scope around. We can import the CSS as a normal side-effect.
const EditorApp = lazy(async () => {
    await import('mudlet-map-editor/styles.css');
    const mod = await import('mudlet-map-editor');
    return { default: mod.App };
});

interface MapEditorModalProps {
    connectionId: string;
    connectionName: string;
    manager: WindowManager;
    onClose: () => void;
}

export function MapEditorModal({ connectionId, connectionName, manager, onClose }: MapEditorModalProps) {
    const savedBounds = useAppStore(s => s.connectionModalBounds[connectionId]?.['mapEditor']);
    const saveModalBounds = useAppStore(s => s.saveModalBounds);

    // Editor is mounted exactly once per modal open; the plugin instance must
    // be stable across re-renders so the editor's `useMemo([plugins])` arrays
    // (sidebarTabs, swatchSets, roomPanelSections) don't tear down each render.
    const plugins = useMemo<EditorPlugin[]>(() => {
        // Sync the editor's serialised bytes back into mudix's MapStore +
        // IndexedDB. Copy into a standalone ArrayBuffer first — manager.loadMap
        // eventually hands the buffer to the binary parser which mutates it
        // in-place via Buffer.swap16(); the editor still references its own.
        const syncBytes = (bytes: Uint8Array) => {
            const copy = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(copy).set(bytes);
            if (!manager.loadMap(copy)) {
                console.warn('[MapEditorModal] manager.loadMap rejected editor bytes');
            }
        };
        return [{
            id: 'mudix-bridge',
            // Replace the editor's built-in Mudlet logo (a logo.png served
            // from the editor's public folder, which 404s when embedded)
            // with mudix's own wordmark. `.brand` carries mudix's accent
            // colour, weight, and letter-spacing; `font-family: inherit`
            // overrides the brand class's own `var(--font-ui)` so the
            // wordmark uses the editor's Montserrat-style font and
            // baseline-aligns with the editor's h1 title beside it.
            renderLogo: () => <span className="brand" style={{ fontFamily: 'inherit' }}>mudix</span>,
            // The map under edit was seeded from mudix's IndexedDB in
            // onAppReady, so the URL-load action has no role here — drop
            // it. We also swap "save"'s onClick: the editor's default
            // downloads a .dat file *and* fires onMapSave; mudix only
            // needs the in-memory bytes to round-trip back into MapStore,
            // so we go straight through syncBytes (no browser download)
            // and update the editor's `savedUndoLength` ourselves — without
            // that the dirty marker (*) never clears and the click looks
            // like a no-op even though the sync succeeded.
            toolbarActions: (actions) =>
                actions
                    .filter(a => a.id !== 'loadUrl')
                    .map(a => a.id !== 'save' ? a : {
                        ...a,
                        onClick: async () => {
                            const { getMapBytes, store } = await import('mudlet-map-editor');
                            const bytes = getMapBytes();
                            if (!bytes) return;
                            syncBytes(bytes);
                            store.setState((s) => ({ savedUndoLength: s.undo.length }));
                        },
                    }),
            // onAppReady is awaited by the editor before it proceeds —
            // perfect window to seed the current map bytes before any UI
            // renders. The package only re-exports `loadUrlIntoStore` (not
            // loadFileIntoStore), so we hand it the bytes through a blob
            // URL and revoke it once the editor finishes parsing.
            async onAppReady() {
                let url: string | null = null;
                try {
                    const bytes = await loadMapBytes(connectionId);
                    if (!bytes) return;
                    const { loadUrlIntoStore } = await import('mudlet-map-editor');
                    url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
                    await loadUrlIntoStore(url);
                } catch (err) {
                    console.warn('[MapEditorModal] seed from IndexedDB failed:', err);
                } finally {
                    if (url) URL.revokeObjectURL(url);
                }
            },
            // Still wired so that *other* save paths (e.g. the load-file
            // action's reload-then-save chain, or any keyboard shortcut
            // that triggers the editor's internal handleSave) also sync
            // back into mudix.
            onMapSave: syncBytes,
        }];
    }, [connectionId, manager]);

    return (
        <ResizableModal
            title={`Map Editor — ${connectionName}`}
            onClose={onClose}
            savedBounds={savedBounds}
            onBoundsChange={(b) => saveModalBounds(connectionId, 'mapEditor', b)}
            defaultW={Math.min(1400, Math.max(900, window.innerWidth - 80))}
            defaultH={Math.min(900, Math.max(600, window.innerHeight - 80))}
            minW={600}
            minH={400}
            bodyClassName="map-editor-modal-body"
        >
            <Suspense fallback={<div className="map-editor-loading">Loading editor…</div>}>
                <EditorApp plugins={plugins} title="Map Editor" />
            </Suspense>
        </ResizableModal>
    );
}
