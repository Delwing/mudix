import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Folder, FolderOpen, FolderPlus, File, RefreshCw, Upload, Trash2, Home } from 'lucide-react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { ResizableModal } from './ResizableModal';
import { ContextMenu } from './components';
import { useAppStore } from '../storage';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

// ─── VFS Move Helpers ──────────────────────────────────────────────────────

function canMove(srcPath: string, destDirPath: string): boolean {
    const srcParent = srcPath.substring(0, srcPath.lastIndexOf('/'));
    if (destDirPath === srcParent) return false;           // already there
    if (destDirPath === srcPath) return false;             // self
    if (destDirPath.startsWith(srcPath + '/')) return false; // own descendant
    return true;
}

function copyDirRecursive(vfs: ProfileVFS, srcDir: string, destDir: string): void {
    vfs.mkdir(destDir);
    for (const name of vfs.readdir(srcDir)) {
        const src = `${srcDir}/${name}`;
        const dest = `${destDir}/${name}`;
        if (vfs.stat(src)?.type === 'dir') {
            copyDirRecursive(vfs, src, dest);
        } else {
            vfs.writeFile(dest, vfs.readFile(src));
        }
    }
}

function moveVFSNode(vfs: ProfileVFS, srcPath: string, destDirPath: string): void {
    const name = srcPath.substring(srcPath.lastIndexOf('/') + 1);
    const destPath = `${destDirPath}/${name}`;
    const info = vfs.stat(srcPath);
    if (!info) throw new Error(`Not found: ${srcPath}`);
    if (info.type === 'file') {
        vfs.writeFile(destPath, vfs.readFile(srcPath));
        vfs.deleteFile(srcPath);
    } else {
        copyDirRecursive(vfs, srcPath, destPath);
        vfs.rmdir(srcPath);
    }
}

// ─── Preview Strategy System ───────────────────────────────────────────────

interface FilePreviewStrategy {
    canPreview: (filename: string) => boolean;
    Preview: React.FC<{ content: string; filename: string }>;
}

function PlainTextPreview({ content }: { content: string; filename: string }) {
    return <pre className="vfs-preview-text">{content}</pre>;
}

function JsonPreview({ content }: { content: string; filename: string }) {
    const formatted = useMemo(() => {
        try { return JSON.stringify(JSON.parse(content), null, 2); }
        catch { return content; }
    }, [content]);
    return <pre className="vfs-preview-text">{formatted}</pre>;
}

const plainTextStrategy: FilePreviewStrategy = { canPreview: () => true, Preview: PlainTextPreview };
const jsonStrategy: FilePreviewStrategy = { canPreview: (n) => n.endsWith('.json'), Preview: JsonPreview };

// Add new strategies here — order matters, first match wins
const previewStrategies: FilePreviewStrategy[] = [jsonStrategy, plainTextStrategy];

function getPreviewStrategy(filename: string): FilePreviewStrategy {
    return previewStrategies.find(s => s.canPreview(filename)) ?? plainTextStrategy;
}

// ─── VFS Tree ──────────────────────────────────────────────────────────────

interface VFSNode {
    name: string;
    path: string;
    type: 'file' | 'dir';
    children?: VFSNode[];
    size?: number;
}

function buildTree(vfs: ProfileVFS, dirPath: string, depth = 0): VFSNode[] {
    if (depth > 12) return [];
    try {
        const entries = vfs.readdir(dirPath);
        const nodes = entries.map(name => {
            const fullPath = `${dirPath}/${name}`;
            const info = vfs.stat(fullPath);
            const type = info?.type ?? 'file';
            const node: VFSNode = { name, path: fullPath, type };
            if (type === 'dir') node.children = buildTree(vfs, fullPath, depth + 1);
            else node.size = info?.size ?? 0;
            return node;
        });
        return nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    } catch { return []; }
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Tree Node ─────────────────────────────────────────────────────────────

interface DragHandlers {
    dragPath: string | null;
    dropTarget: string | null;
    onDragStart: (e: React.DragEvent, node: VFSNode) => void;
    onDragEnd: () => void;
    onDragOverDir: (e: React.DragEvent, path: string) => void;
    onDragLeaveDir: (path: string) => void;
    onDropOnDir: (e: React.DragEvent, path: string) => void;
}

interface TreeNodeProps {
    node: VFSNode;
    depth: number;
    expanded: Set<string>;
    selectedPath: string | null;
    uploadDir: string;
    onToggle: (path: string) => void;
    onSelect: (node: VFSNode) => void;
    onContextMenu: (e: React.MouseEvent, node: VFSNode) => void;
    dnd: DragHandlers;
}

function TreeNode({ node, depth, expanded, selectedPath, uploadDir, onToggle, onSelect, onContextMenu, dnd }: TreeNodeProps) {
    const isOpen       = expanded.has(node.path);
    const isSelected   = node.path === selectedPath;
    const isDragging   = dnd.dragPath === node.path;
    const isDropTarget = dnd.dropTarget === node.path;
    const indent       = depth * 16;

    const dragAttrs = {
        draggable: true as const,
        onDragStart: (e: React.DragEvent) => dnd.onDragStart(e, node),
        onDragEnd: dnd.onDragEnd,
    };

    if (node.type === 'dir') {
        return (
            <div>
                <div
                    className={`vfs-row vfs-dir${isDropTarget ? ' vfs-drop-target' : ''}${isDragging ? ' vfs-dragging' : ''}`}
                    style={{ paddingLeft: indent + 4 }}
                    onClick={() => onToggle(node.path)}
                    onContextMenu={e => onContextMenu(e, node)}
                    onDragOver={e => dnd.onDragOverDir(e, node.path)}
                    onDragLeave={() => dnd.onDragLeaveDir(node.path)}
                    onDrop={e => dnd.onDropOnDir(e, node.path)}
                    {...dragAttrs}
                >
                    <span className="vfs-chevron">
                        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </span>
                    <span className="vfs-icon">
                        {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
                    </span>
                    <span className="vfs-name">{node.name}/</span>
                    {uploadDir === node.path && (
                        <span className="vfs-upload-indicator" title="Upload target">
                            <Upload size={10} />
                        </span>
                    )}
                </div>
                {isOpen && node.children?.map(child => (
                    <TreeNode
                        key={child.path}
                        node={child}
                        depth={depth + 1}
                        expanded={expanded}
                        selectedPath={selectedPath}
                        uploadDir={uploadDir}
                        onToggle={onToggle}
                        onSelect={onSelect}
                        onContextMenu={onContextMenu}
                        dnd={dnd}
                    />
                ))}
            </div>
        );
    }

    return (
        <div
            className={`vfs-row vfs-file${isSelected ? ' vfs-selected' : ''}${isDragging ? ' vfs-dragging' : ''}`}
            style={{ paddingLeft: indent + 20 }}
            onClick={() => onSelect(node)}
            onContextMenu={e => onContextMenu(e, node)}
            {...dragAttrs}
        >
            <span className="vfs-icon"><File size={13} /></span>
            <span className="vfs-name">{node.name}</span>
            {node.size !== undefined && <span className="vfs-size">{formatSize(node.size)}</span>}
        </div>
    );
}

// ─── Preview Panel ─────────────────────────────────────────────────────────

function PreviewPanel({ file, content, error }: { file: VFSNode | null; content: string | null; error: string | null }): ReactNode {
    if (!file) return <p className="vfs-preview-empty">Select a file to preview</p>;
    if (error) {
        return (
            <div className="vfs-preview-error">
                <span className="vfs-preview-error-label">Cannot read file</span>
                <span>{error}</span>
            </div>
        );
    }
    if (content === null) return null;
    const strategy = getPreviewStrategy(file.name);
    return <strategy.Preview content={content} filename={file.name} />;
}

// ─── Modal ─────────────────────────────────────────────────────────────────

type CtxMenuState = { x: number; y: number; node: VFSNode };

interface FileBrowserModalProps {
    connectionId: string;
    vfs: ProfileVFS | null;
    onClose: () => void;
}

export function FileBrowserModal({ connectionId, vfs, onClose }: FileBrowserModalProps) {
    const savedBounds     = useAppStore(s => s.connectionModalBounds[connectionId]?.['files']);
    const saveModalBounds = useAppStore(s => s.saveModalBounds);

    // ── Tree rebuild ──────────────────────────────────────────────────────

    const [rev, setRev] = useState(0);
    const bumpRev = useCallback(() => setRev(r => r + 1), []);

    const refresh = useCallback(() => {
        bumpRev();
        setSelectedFile(null);
        setPreviewContent(null);
        setPreviewError(null);
    }, [bumpRev]);

    const tree = useMemo(() => {
        if (!vfs) return [];
        return buildTree(vfs, vfs.profilePath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [vfs, rev]);

    // ── Expand/collapse ───────────────────────────────────────────────────

    const [expanded, setExpanded] = useState<Set<string>>(new Set());

    const handleToggle = useCallback((path: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            next.has(path) ? next.delete(path) : next.add(path);
            return next;
        });
    }, []);

    const pruneExpanded = useCallback((removedPath: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            for (const k of next) {
                if (k === removedPath || k.startsWith(removedPath + '/')) next.delete(k);
            }
            return next;
        });
    }, []);

    // ── Selection / preview ───────────────────────────────────────────────

    const [selectedFile, setSelectedFile] = useState<VFSNode | null>(null);
    const [previewContent, setPreviewContent] = useState<string | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);

    const handleSelect = useCallback((node: VFSNode) => {
        setSelectedFile(node);
        if (!vfs) return;
        try {
            setPreviewContent(vfs.readFile(node.path));
            setPreviewError(null);
        } catch (e) {
            setPreviewContent(null);
            setPreviewError(String(e));
        }
    }, [vfs]);

    const clearSelection = useCallback((removedPath: string) => {
        setSelectedFile(prev => {
            if (prev && (prev.path === removedPath || prev.path.startsWith(removedPath + '/'))) {
                setPreviewContent(null);
                setPreviewError(null);
                return null;
            }
            return prev;
        });
    }, []);

    // ── Upload ────────────────────────────────────────────────────────────

    const [uploadDir, setUploadDir] = useState<string>(vfs?.profilePath ?? '');
    const uploadDirRef = useRef<string>(vfs?.profilePath ?? '');
    const uploadInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const path = vfs?.profilePath ?? '';
        uploadDirRef.current = path;
        setUploadDir(path);
    }, [vfs]);

    const handleUploadClick = useCallback(() => uploadInputRef.current?.click(), []);

    const handleUploadHere = useCallback((dirPath: string) => {
        uploadDirRef.current = dirPath;
        setUploadDir(dirPath);
        setCtxMenu(null);
        uploadInputRef.current?.click();
    }, []);

    const resetUploadDir = useCallback(() => {
        const path = vfs?.profilePath ?? '';
        uploadDirRef.current = path;
        setUploadDir(path);
    }, [vfs]);

    const handleUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files ?? []);
        e.target.value = '';
        if (!vfs || files.length === 0) return;
        const targetDir = uploadDirRef.current || vfs.profilePath;

        let pending = files.length;
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = () => {
                try { vfs.writeFile(`${targetDir}/${file.name}`, reader.result as string); }
                catch (err) { console.error(`Upload failed for ${file.name}:`, err); }
                if (--pending === 0) bumpRev();
            };
            reader.onerror = () => { if (--pending === 0) bumpRev(); };
            reader.readAsText(file);
        }
    }, [vfs, bumpRev]);

    // ── New folder ────────────────────────────────────────────────────────

    const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
    const [newFolderName, setNewFolderName] = useState('');

    const handleNewFolderHere = useCallback((parentPath: string) => {
        setCtxMenu(null);
        setNewFolderParent(parentPath);
        setNewFolderName('');
        // Ensure the parent dir is expanded so the new folder appears
        setExpanded(prev => {
            const next = new Set(prev);
            next.add(parentPath);
            return next;
        });
    }, []);

    const handleCreateFolder = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        const name = newFolderName.trim();
        if (!name || !vfs || !newFolderParent) { setNewFolderParent(null); return; }
        try {
            vfs.mkdir(`${newFolderParent}/${name}`);
            bumpRev();
        } catch (err) {
            console.error('Create folder failed:', err);
        }
        setNewFolderParent(null);
        setNewFolderName('');
    }, [newFolderName, newFolderParent, vfs, bumpRev]);

    const cancelNewFolder = useCallback(() => {
        setNewFolderParent(null);
        setNewFolderName('');
    }, []);

    // ── Context menu ──────────────────────────────────────────────────────

    const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);

    const handleContextMenu = useCallback((e: React.MouseEvent, node: VFSNode) => {
        e.preventDefault();
        e.stopPropagation();
        setCtxMenu({ x: e.clientX, y: e.clientY, node });
    }, []);

    // Right-click on empty tree-panel area → root context menu
    const handleTreeBgContextMenu = useCallback((e: React.MouseEvent) => {
        if ((e.target as HTMLElement).closest('.vfs-row')) return;
        e.preventDefault();
        if (!vfs) return;
        setCtxMenu({ x: e.clientX, y: e.clientY, node: { name: '', path: vfs.profilePath, type: 'dir' } });
    }, [vfs]);

    const handleDelete = useCallback((node: VFSNode) => {
        setCtxMenu(null);
        if (!vfs) return;
        try {
            if (node.type === 'file') {
                vfs.deleteFile(node.path);
            } else {
                vfs.rmdir(node.path);
                pruneExpanded(node.path);
            }
            clearSelection(node.path);
            bumpRev();
        } catch (e) {
            console.error('Delete failed:', e);
        }
    }, [vfs, pruneExpanded, clearSelection, bumpRev]);

    // ── Drag & Drop ───────────────────────────────────────────────────────

    const [dragPath, setDragPath] = useState<string | null>(null);
    const dragPathRef = useRef<string | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);

    const handleDragStart = useCallback((e: React.DragEvent, node: VFSNode) => {
        dragPathRef.current = node.path;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', node.path);
        // Defer so the ghost image captures the undimmed element
        setTimeout(() => setDragPath(node.path), 0);
    }, []);

    const handleDragEnd = useCallback(() => {
        dragPathRef.current = null;
        setDragPath(null);
        setDropTarget(null);
    }, []);

    const handleDragOverDir = useCallback((e: React.DragEvent, dirPath: string) => {
        e.preventDefault();
        const src = dragPathRef.current;
        if (src && canMove(src, dirPath)) {
            e.dataTransfer.dropEffect = 'move';
            setDropTarget(prev => prev === dirPath ? prev : dirPath);
        } else {
            e.dataTransfer.dropEffect = 'none';
        }
    }, []);

    const handleDragLeaveDir = useCallback((dirPath: string) => {
        setDropTarget(prev => prev === dirPath ? null : prev);
    }, []);

    const handleDropOnDir = useCallback((e: React.DragEvent, destDirPath: string) => {
        e.preventDefault();
        setDropTarget(null);
        const srcPath = e.dataTransfer.getData('text/plain') || dragPathRef.current;
        dragPathRef.current = null;
        setDragPath(null);
        if (!srcPath || !vfs || !canMove(srcPath, destDirPath)) return;
        try {
            moveVFSNode(vfs, srcPath, destDirPath);
            clearSelection(srcPath);
            pruneExpanded(srcPath);
            bumpRev();
        } catch (err) {
            console.error('Move failed:', err);
        }
    }, [vfs, clearSelection, pruneExpanded, bumpRev]);

    const dnd: DragHandlers = {
        dragPath, dropTarget,
        onDragStart: handleDragStart,
        onDragEnd: handleDragEnd,
        onDragOverDir: handleDragOverDir,
        onDragLeaveDir: handleDragLeaveDir,
        onDropOnDir: handleDropOnDir,
    };

    // ── Derived ───────────────────────────────────────────────────────────

    const isAtRoot = !vfs || uploadDir === vfs.profilePath;
    const uploadTitle = isAtRoot
        ? 'Upload to profile root'
        : `Upload to: ${uploadDir.substring((vfs?.profilePath.length ?? 0) + 1)}`;

    const newFolderLabel = newFolderParent === vfs?.profilePath
        ? '/'
        : `/${newFolderParent?.substring((vfs?.profilePath.length ?? 0) + 1)}/`;

    const isRoot = (node: VFSNode) => node.path === vfs?.profilePath;

    return (
        <>
            <ResizableModal
                title="Profile Files"
                onClose={onClose}
                savedBounds={savedBounds}
                onBoundsChange={b => saveModalBounds(connectionId, 'files', b)}
                defaultW={620}
                defaultH={520}
                minW={280}
                minH={200}
                headerExtra={
                    <>
                        <input
                            ref={uploadInputRef}
                            type="file"
                            multiple
                            style={{ display: 'none' }}
                            onChange={handleUpload}
                        />
                        {!isAtRoot && (
                            <button
                                className="modal-close"
                                title="Reset upload target to root"
                                onClick={resetUploadDir}
                            >
                                <Home size={13} />
                            </button>
                        )}
                        <button
                            className="modal-close"
                            title={uploadTitle}
                            onClick={handleUploadClick}
                            disabled={!vfs}
                        >
                            <Upload size={13} />
                        </button>
                        <button className="modal-close" title="Refresh" onClick={refresh}>
                            <RefreshCw size={13} />
                        </button>
                    </>
                }
            >
                {vfs && (
                    <div
                        className={`vfs-path-bar${dropTarget === vfs.profilePath ? ' vfs-drop-target' : ''}`}
                        onContextMenu={e => handleContextMenu(e, { name: '', path: vfs.profilePath, type: 'dir' })}
                        onDragOver={e => handleDragOverDir(e, vfs.profilePath)}
                        onDragLeave={() => handleDragLeaveDir(vfs.profilePath)}
                        onDrop={e => handleDropOnDir(e, vfs.profilePath)}
                    >
                        {vfs.profilePath}
                    </div>
                )}

                {newFolderParent && (
                    <form className="vfs-new-folder-form" onSubmit={handleCreateFolder}>
                        <FolderPlus size={12} />
                        <span className="vfs-new-folder-label">{newFolderLabel}</span>
                        <input
                            autoFocus
                            className="vfs-new-folder-input"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyDown={e => e.key === 'Escape' && cancelNewFolder()}
                            placeholder="folder name…"
                        />
                    </form>
                )}

                <div className="vfs-split">
                    <div className="vfs-tree-panel" onContextMenu={handleTreeBgContextMenu}>
                        {!vfs ? (
                            <p className="vfs-empty">No profile mounted.</p>
                        ) : tree.length === 0 ? (
                            <p className="vfs-empty">Profile directory is empty.</p>
                        ) : (
                            <div className="vfs-tree">
                                {tree.map(node => (
                                    <TreeNode
                                        key={node.path}
                                        node={node}
                                        depth={0}
                                        expanded={expanded}
                                        selectedPath={selectedFile?.path ?? null}
                                        uploadDir={uploadDir}
                                        onToggle={handleToggle}
                                        onSelect={handleSelect}
                                        onContextMenu={handleContextMenu}
                                        dnd={dnd}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="vfs-preview-panel">
                        <PreviewPanel file={selectedFile} content={previewContent} error={previewError} />
                    </div>
                </div>
            </ResizableModal>

            {ctxMenu && (
                <ContextMenu x={ctxMenu.x} y={ctxMenu.y} onClose={() => setCtxMenu(null)}>
                    {ctxMenu.node.type === 'dir' && (
                        <>
                            <button
                                className="ctx-menu__item"
                                type="button"
                                onClick={() => handleNewFolderHere(ctxMenu.node.path)}
                            >
                                <FolderPlus size={13} />
                                New folder{isRoot(ctxMenu.node) ? '' : ' here'}
                            </button>
                            <button
                                className="ctx-menu__item"
                                type="button"
                                onClick={() => handleUploadHere(ctxMenu.node.path)}
                            >
                                <Upload size={13} />
                                Upload here
                            </button>
                            {!isRoot(ctxMenu.node) && (
                                <>
                                    <div className="ctx-menu__sep" />
                                    <button
                                        className="ctx-menu__item ctx-menu__item--danger"
                                        type="button"
                                        onClick={() => handleDelete(ctxMenu.node)}
                                    >
                                        <Trash2 size={13} />
                                        Delete folder
                                    </button>
                                </>
                            )}
                        </>
                    )}
                    {ctxMenu.node.type === 'file' && (
                        <button
                            className="ctx-menu__item ctx-menu__item--danger"
                            type="button"
                            onClick={() => handleDelete(ctxMenu.node)}
                        >
                            <Trash2 size={13} />
                            Delete file
                        </button>
                    )}
                </ContextMenu>
            )}
        </>
    );
}
