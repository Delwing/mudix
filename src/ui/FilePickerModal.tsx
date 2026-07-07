import { useMemo, useState } from 'react';
import { Folder, FolderOpen, File, Home, ChevronRight, ChevronDown } from 'lucide-react';
import { ResizableModal } from './ResizableModal';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';
import { buildTree, type VFSNode } from './FileBrowserModal';

/**
 * The Lua `invokeFileDialog(...)` picker. The calling Lua handler is parked on
 * its coroutine until this resolves, so every exit path (Select, Cancel, the
 * header ✕) must call `onDone` — with the picked absolute VFS path, or '' for
 * cancel (Mudlet's return value for a dismissed dialog).
 *
 * `mode === 'file'` picks a file; `mode === 'folder'` picks a directory and
 * hides files entirely, mirroring QFileDialog::getOpenFileName vs
 * getExistingDirectory in Mudlet.
 */
interface FilePickerModalProps {
    vfs: ProfileVFS | null;
    mode: 'file' | 'folder';
    title: string;
    /** VFS path to reveal on open; '' or invalid falls back to the root. */
    location: string;
    onDone: (path: string) => void;
}

/** Resolve the requested start location to an existing dir under the profile
 *  root, tolerating relative paths and files (their parent dir is used). */
function resolveStartDir(vfs: ProfileVFS, location: string): string {
    const root = vfs.profilePath;
    let p = (location || '').trim().replace(/\/+$/, '');
    if (!p) return root;
    if (!p.startsWith(root)) p = `${root}/${p.replace(/^\/+/, '')}`;
    const st = vfs.stat(p);
    if (st?.type === 'dir') return p;
    if (st?.type === 'file') {
        const parent = p.substring(0, p.lastIndexOf('/'));
        if (vfs.stat(parent)?.type === 'dir') return parent;
    }
    return root;
}

/** Every ancestor dir between the root (exclusive) and `dir` (inclusive). */
function ancestorChain(root: string, dir: string): string[] {
    if (dir === root) return [];
    const chain: string[] = [];
    let p = dir;
    while (p.length > root.length) {
        chain.push(p);
        p = p.substring(0, p.lastIndexOf('/'));
    }
    return chain;
}

interface PickerRowProps {
    node: VFSNode;
    depth: number;
    mode: 'file' | 'folder';
    expanded: Set<string>;
    selectedPath: string | null;
    onToggle: (path: string) => void;
    onSelect: (node: VFSNode) => void;
    onConfirm: (node: VFSNode) => void;
}

function PickerRow({ node, depth, mode, expanded, selectedPath, onToggle, onSelect, onConfirm }: PickerRowProps) {
    const indent = depth * 16;
    const isSelected = node.path === selectedPath;

    if (node.type === 'dir') {
        const isOpen = expanded.has(node.path);
        const children = mode === 'folder'
            ? node.children?.filter(c => c.type === 'dir')
            : node.children;
        return (
            <div>
                <div
                    className={`vfs-row vfs-dir${mode === 'folder' && isSelected ? ' vfs-selected' : ''}`}
                    style={{ paddingLeft: indent + 4 }}
                    onClick={() => { onToggle(node.path); if (mode === 'folder') onSelect(node); }}
                    onDoubleClick={() => { if (mode === 'folder') onConfirm(node); }}
                >
                    <span className="vfs-chevron">
                        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                    </span>
                    <span className="vfs-icon">
                        {isOpen ? <FolderOpen size={13} /> : <Folder size={13} />}
                    </span>
                    <span className="vfs-name">{node.name}/</span>
                </div>
                {isOpen && children?.map(child => (
                    <PickerRow
                        key={child.path}
                        node={child}
                        depth={depth + 1}
                        mode={mode}
                        expanded={expanded}
                        selectedPath={selectedPath}
                        onToggle={onToggle}
                        onSelect={onSelect}
                        onConfirm={onConfirm}
                    />
                ))}
            </div>
        );
    }

    // File rows only render in file mode (folder mode filters them out above).
    return (
        <div
            className={`vfs-row vfs-file${isSelected ? ' vfs-selected' : ''}`}
            style={{ paddingLeft: indent + 20 }}
            onClick={() => onSelect(node)}
            onDoubleClick={() => onConfirm(node)}
        >
            <span className="vfs-icon"><File size={13} /></span>
            <span className="vfs-name">{node.name}</span>
        </div>
    );
}

export function FilePickerModal({ vfs, mode, title, location, onDone }: FilePickerModalProps) {
    const root = vfs?.profilePath ?? '';

    const tree = useMemo(() => (vfs ? buildTree(vfs, root) : []), [vfs, root]);

    const [expanded, setExpanded] = useState<Set<string>>(() => {
        if (!vfs) return new Set();
        return new Set(ancestorChain(root, resolveStartDir(vfs, location)));
    });
    // Folder mode starts with the requested dir selected — Enter-equivalent
    // "Select" right away picks the start location, like QFileDialog.
    const [selected, setSelected] = useState<string | null>(() => {
        if (!vfs || mode !== 'folder') return null;
        return resolveStartDir(vfs, location);
    });

    const toggle = (path: string) => setExpanded(prev => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
    });

    const confirm = (path: string | null) => onDone(path ?? '');
    const displayPath = selected
        ? (selected === root ? '(profile root)' : selected.substring(root.length + 1))
        : mode === 'file' ? 'Select a file…' : 'Select a folder…';

    return (
        <ResizableModal
            title={title || (mode === 'file' ? 'Select a file' : 'Select a folder')}
            onClose={() => confirm(null)}
            defaultW={420}
            defaultH={480}
            minW={300}
            minH={280}
        >
            <div className="picker-tree-panel">
                {!vfs ? (
                    <p className="vfs-empty">No profile mounted.</p>
                ) : (
                    <div className="vfs-tree">
                        {mode === 'folder' && (
                            <div
                                className={`vfs-row vfs-dir${selected === root ? ' vfs-selected' : ''}`}
                                style={{ paddingLeft: 4 }}
                                onClick={() => setSelected(root)}
                                onDoubleClick={() => confirm(root)}
                            >
                                <span className="vfs-icon"><Home size={13} /></span>
                                <span className="vfs-name">(profile root)</span>
                            </div>
                        )}
                        {tree
                            .filter(n => mode === 'file' || n.type === 'dir')
                            .map(node => (
                                <PickerRow
                                    key={node.path}
                                    node={node}
                                    depth={0}
                                    mode={mode}
                                    expanded={expanded}
                                    selectedPath={selected}
                                    onToggle={toggle}
                                    onSelect={n => setSelected(n.path)}
                                    onConfirm={n => confirm(n.path)}
                                />
                            ))}
                    </div>
                )}
            </div>
            <div className="merge-footer">
                <span className="picker-path" title={selected ?? ''}>{displayPath}</span>
                <button type="button" className="merge-btn-secondary" onClick={() => confirm(null)}>
                    Cancel
                </button>
                <button
                    type="button"
                    className="merge-btn-primary"
                    disabled={!selected}
                    onClick={() => confirm(selected)}
                >
                    Select
                </button>
            </div>
        </ResizableModal>
    );
}
