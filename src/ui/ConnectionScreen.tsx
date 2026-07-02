import { useRef, useState } from 'react';
import { FolderSymlink, Info, Trash2 } from 'lucide-react';
import { Button, useConfirm } from './components';
import { ConnectionFormModal } from './ConnectionFormModal';
import { AboutModal } from './AboutModal';
import { connectionDisplayAddr, useAppStore, type MudConnection } from '../storage';
import { extractMudletProfileZip, resolveModulesFromTree, addModuleToBundle, type MudletProfileBundle } from '../import/mudletProfileImport';
import { importMudletProfile, bundleFromDirectory, linkMudletFolder } from '../import/applyMudletProfile';
import { ModuleResolveModal, type ModuleUpload } from './ModuleResolveModal';
import type { MudletModuleRef } from '../import/mudletHost';

/** Deterministic background color for a profile's name tile — same name always
 *  yields the same hue, so each profile gets a stable, distinct color. */
function avatarColor(name: string): string {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
    return `hsl(${Math.abs(h) % 360} 42% 38%)`;
}

/** Shared canvas 2D context for measuring text width when fitting a name into
 *  the icon tile. Created lazily, reused across calls. */
let measureCtx: CanvasRenderingContext2D | null = null;

/** Largest font (px) at which `name` fits the tile on one line — mirrors
 *  Mudlet's customIcon(), which starts large and shrinks to a floor until the
 *  profile name fits the 120×30 box. */
function fitNameFontSize(name: string): number {
    const MAX = 18, MIN = 7, MAX_W = 110; // tile is 120px wide, minus padding
    if (typeof document === 'undefined') return 12;
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    if (!measureCtx) return 12;
    for (let size = MAX; size > MIN; size--) {
        measureCtx.font = `600 ${size}px sans-serif`;
        if (measureCtx.measureText(name).width <= MAX_W) return size;
    }
    return MIN;
}

/** Mudlet-style profile icon. Renders the custom icon when one is set
 *  (setProfileIcon), otherwise a colored tile with the profile name — matching
 *  Mudlet's behaviour of drawing the name onto profiles without an icon. */
function ProfileAvatar({ name, icon }: { name: string; icon?: string }) {
    if (icon) {
        return <img className="connection-avatar" src={icon} alt="" aria-hidden="true" />;
    }
    const label = name || '?';
    return (
        <span
            className="connection-avatar connection-avatar--name"
            style={{ backgroundColor: avatarColor(name) }}
            aria-hidden="true"
        >
            <span className="connection-avatar-text" style={{ fontSize: `${fitNameFontSize(label)}px` }}>
                {label}
            </span>
        </span>
    );
}

interface Props {
    connections: MudConnection[];
    connecting: boolean;
    connectingId: string | null;
    onConnect: (connection: MudConnection) => void;
    onOpen: (connection: MudConnection) => void;
    onAdd: (data: Omit<MudConnection, 'id'>) => string;
    onUpdate: (id: string, data: Omit<MudConnection, 'id'>) => void;
    onDelete: (id: string) => void;
    onOpenSettings: () => void;
}

export function ConnectionScreen({ connections, connecting, connectingId, onConnect, onOpen, onAdd, onUpdate, onDelete, onOpenSettings }: Props) {
    const confirm = useConfirm();
    const reorderConnections = useAppStore(s => s.reorderConnections);
    // null = editor closed; { connection: null } = add a new one; { connection: c } = edit c.
    const [editor, setEditor] = useState<{ connection: MudConnection | null } | null>(null);
    const [aboutOpen, setAboutOpen] = useState(false);
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    // Drag-to-rearrange state: `dragId` is the tile being dragged, `overId` the
    // tile it's currently hovering (drawn with a drop indicator).
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);
    // Set when an imported profile references modules whose files weren't found —
    // the modal asks the user to upload or drop each before the import completes.
    const [pendingImport, setPendingImport] = useState<{ bundle: MudletProfileBundle; unresolved: MudletModuleRef[] } | null>(null);
    const zipInputRef = useRef<HTMLInputElement>(null);
    // Directory import needs the File System Access API; fall back to .zip elsewhere.
    const dirPicker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;

    // The new connection lands in the store, so the list re-renders on its own.
    const runImport = async (fn: () => Promise<void>) => {
        setImporting(true);
        setImportError(null);
        try {
            await fn();
        } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') return; // user cancelled the picker
            setImportError(err instanceof Error ? err.message : String(err));
        } finally {
            setImporting(false);
        }
    };

    // Auto-resolve modules found in the imported tree; defer to the modal for the
    // rest, otherwise provision the profile immediately.
    const beginImport = async (bundle: MudletProfileBundle) => {
        const { resolved, unresolved } = resolveModulesFromTree(bundle);
        for (const r of resolved) addModuleToBundle(bundle, r.ref.key, r.xmlBytes);
        if (unresolved.length) { setPendingImport({ bundle, unresolved }); return; }
        await importMudletProfile(bundle);
    };

    const handleImportFolder = () => {
        if (!dirPicker) return;
        void runImport(async () => beginImport(await bundleFromDirectory(await dirPicker.call(window))));
    };

    // Link (not copy): the folder stays the source of truth; current/*.xml is
    // re-read on every open.
    const handleLinkFolder = () => {
        if (!dirPicker) return;
        void runImport(async () => { await linkMudletFolder(await dirPicker.call(window)); });
    };

    const handleZipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        void runImport(async () => {
            const bytes = new Uint8Array(await file.arrayBuffer());
            return beginImport(extractMudletProfileZip(bytes, file.name.replace(/\.zip$/i, '')));
        });
    };

    const finishPendingImport = (uploads: ModuleUpload[]) => {
        const p = pendingImport;
        if (!p) return;
        setPendingImport(null);
        void runImport(async () => {
            for (const u of uploads) addModuleToBundle(p.bundle, u.key, u.bytes);
            await importMudletProfile(p.bundle);
        });
    };

    const handleDelete = async (c: MudConnection) => {
        const ok = await confirm<boolean>({
            title: 'Delete profile?',
            tone: 'danger',
            message: (
                <>
                    Permanently delete <strong>{c.name}</strong>? Its scripts, aliases, triggers and saved layout
                    will be removed. This cannot be undone.
                </>
            ),
            buttons: [
                { label: 'Cancel', value: false, variant: 'secondary' },
                { label: 'Delete', value: true, variant: 'danger', autoFocus: true },
            ],
            dismissValue: false,
        });
        if (!ok) return;
        if (editor?.connection?.id === c.id) setEditor(null);
        onDelete(c.id);
    };

    // ── Drag-to-rearrange (native HTML5 DnD) ──────────────────────────────
    const handleDragStart = (id: string) => (e: React.DragEvent) => {
        setDragId(id);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to be set for the drag to fire at all.
        e.dataTransfer.setData('text/plain', id);
    };
    const handleDragOver = (id: string) => (e: React.DragEvent) => {
        if (!dragId || dragId === id) return;
        e.preventDefault(); // allow drop
        e.dataTransfer.dropEffect = 'move';
        if (overId !== id) setOverId(id);
    };
    const handleDrop = (targetId: string) => (e: React.DragEvent) => {
        e.preventDefault();
        const sourceId = dragId;
        setDragId(null);
        setOverId(null);
        if (!sourceId || sourceId === targetId) return;
        const ids = connections.map(c => c.id);
        const from = ids.indexOf(sourceId);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) return;
        ids.splice(from, 1);
        ids.splice(ids.indexOf(targetId) + (to > from ? 1 : 0), 0, sourceId);
        reorderConnections(ids);
    };
    const handleDragEnd = () => { setDragId(null); setOverId(null); };

    return (
        <>
        <div className="connection-screen">
            <div className="connection-panel">
                <div className="connection-panel-tools">
                    <button className="connection-settings-btn" onClick={onOpenSettings} type="button" aria-label="Settings">
                        ⚙
                    </button>
                    <button className="connection-about-btn" onClick={() => setAboutOpen(true)} type="button" aria-label="About mudix">
                        <Info size={16} />
                    </button>
                </div>
                <div className="connection-brand">mudix</div>

                <div className="connection-grid" role="list">
                        {connections.map(c => (
                            <div
                                key={c.id}
                                role="listitem"
                                className={
                                    'connection-tile' +
                                    (dragId === c.id ? ' is-dragging' : '') +
                                    (overId === c.id && dragId !== c.id ? ' is-over' : '') +
                                    (editor?.connection?.id === c.id ? ' connection-card--editing' : '')
                                }
                                draggable={!connecting}
                                onDragStart={handleDragStart(c.id)}
                                onDragOver={handleDragOver(c.id)}
                                onDrop={handleDrop(c.id)}
                                onDragEnd={handleDragEnd}
                            >
                                <div className="connection-tile__header">
                                    <ProfileAvatar name={c.name} icon={c.icon} />
                                    <Button
                                        variant="primary"
                                        className="connection-tile__connect"
                                        onClick={() => onConnect(c)}
                                        disabled={connecting}
                                    >
                                        {connectingId === c.id ? 'Connecting…' : 'Connect'}
                                    </Button>
                                </div>
                                <div className="connection-tile__body">
                                    <span className="connection-name connection-tile__name">
                                        {c.name}
                                        {c.mudletLinked && (
                                            <FolderSymlink
                                                size={13}
                                                style={{ opacity: 0.65, flexShrink: 0 }}
                                                aria-label="Linked Mudlet folder"
                                            >
                                                <title>Linked Mudlet folder — source of truth on disk</title>
                                            </FolderSymlink>
                                        )}
                                    </span>
                                    <span className="connection-addr">{connectionDisplayAddr(c)}</span>
                                </div>
                                <div className="connection-tile__actions">
                                    <Button
                                        variant="secondary"
                                        size="sm"
                                        onClick={() => onOpen(c)}
                                        disabled={connecting}
                                        title="Open profile offline"
                                    >
                                        Open
                                    </Button>
                                    <span className="connection-tile__actions-spacer" />
                                    <Button
                                        variant="icon"
                                        size="sm"
                                        onClick={() => setEditor({ connection: c })}
                                        disabled={connecting}
                                        aria-label="Edit connection"
                                        title="Edit"
                                    >
                                        ✎
                                    </Button>
                                    <Button
                                        variant="icon"
                                        size="sm"
                                        onClick={() => { void handleDelete(c); }}
                                        disabled={connecting}
                                        aria-label="Delete connection"
                                        title="Delete"
                                    >
                                        <Trash2 size={14} />
                                    </Button>
                                </div>
                            </div>
                        ))}
                        <button
                            type="button"
                            className="connection-tile connection-tile--add"
                            onClick={() => setEditor({ connection: null })}
                            disabled={connecting}
                        >
                            <span className="connection-tile__add-plus" aria-hidden="true">+</span>
                            <span className="connection-tile__add-label">Add connection</span>
                        </button>
                </div>

                <div className="connection-import-row" style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
                    {dirPicker && (
                        <Button variant="secondary" size="sm" onClick={handleImportFolder} disabled={connecting || importing}>
                            {importing ? 'Importing…' : 'Import Mudlet folder…'}
                        </Button>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => zipInputRef.current?.click()} disabled={connecting || importing}>
                        {importing && !dirPicker ? 'Importing…' : 'Import .zip…'}
                    </Button>
                    {dirPicker && (
                        <Button variant="secondary" size="sm" onClick={handleLinkFolder} disabled={connecting || importing}
                            title="Link a Mudlet profile folder — it stays the source of truth and is re-read from its newest save on every open">
                            Link Mudlet folder…
                        </Button>
                    )}
                </div>
                {importError && (
                    <div className="connection-import-error" style={{ color: 'var(--danger, #e06c75)', fontSize: 12, textAlign: 'center', marginTop: 6 }}>
                        Import failed: {importError}
                    </div>
                )}
                <input ref={zipInputRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={handleZipChange} />
            </div>
        </div>
        {editor && (
            <ConnectionFormModal
                connection={editor.connection}
                firstConnection={connections.length === 0}
                busy={connecting}
                onAdd={onAdd}
                onUpdate={onUpdate}
                onClose={() => setEditor(null)}
            />
        )}
        {pendingImport && (
            <ModuleResolveModal
                modules={pendingImport.unresolved}
                onComplete={finishPendingImport}
                onCancel={() => setPendingImport(null)}
            />
        )}
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
        </>
    );
}
