import { useCallback, useMemo, useState } from 'react';
import { File } from 'lucide-react';
import { ResizableModal } from '../../ResizableModal';
import { Button } from '../../components/Button';
import type { ProfileVFS } from '../../../scripting/vfs/ProfileVFS';

const ELIGIBLE_RE = /\.(xml|mpackage|zip)$/i;

/** Walk the VFS under `root` and collect every file whose name matches the eligibility regex. */
function collectModuleCandidates(vfs: ProfileVFS, root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        let names: string[];
        try { names = vfs.readdir(dir); } catch { return; }
        for (const name of names) {
            const path = `${dir}/${name}`;
            const info = vfs.stat(path);
            if (!info) continue;
            if (info.type === 'dir') walk(path);
            else if (ELIGIBLE_RE.test(name)) out.push(path);
        }
    };
    walk(root);
    return out.sort();
}

interface Props {
    vfs: ProfileVFS;
    onClose: () => void;
    onPick: (absolutePath: string) => void;
}

export function VfsModulePickerModal({ vfs, onClose, onPick }: Props) {
    const candidates = useMemo(() => collectModuleCandidates(vfs, vfs.profilePath), [vfs]);
    const [selected, setSelected] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    const filtered = useMemo(() => {
        const q = filter.trim().toLowerCase();
        if (!q) return candidates;
        return candidates.filter(p => p.toLowerCase().includes(q));
    }, [candidates, filter]);

    const handleConfirm = useCallback(() => {
        if (!selected) return;
        onPick(selected);
        onClose();
    }, [selected, onPick, onClose]);

    return (
        <ResizableModal
            title="Import module from VFS"
            onClose={onClose}
            defaultW={560}
            defaultH={440}
            minW={380}
            minH={280}
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8, padding: 12, boxSizing: 'border-box' }}>
                <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
                    Pick an XML or .mpackage file from this profile's VFS. Plain XML files are referenced
                    in place — the module will reload and sync against the path you choose.
                </p>
                <input
                    className="input"
                    type="text"
                    value={filter}
                    placeholder="Filter…"
                    onChange={e => setFilter(e.target.value)}
                    autoFocus
                />
                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border, #333)', borderRadius: 3, background: 'var(--bg-elevated, #1a1a1a)' }}>
                    {filtered.length === 0 ? (
                        <div style={{ padding: 16, textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
                            {candidates.length === 0 ? 'No XML / .mpackage / .zip files in this profile.' : 'No matches.'}
                        </div>
                    ) : (
                        filtered.map(path => {
                            const display = path.startsWith(vfs.profilePath + '/')
                                ? path.slice(vfs.profilePath.length + 1)
                                : path;
                            const isSelected = path === selected;
                            return (
                                <div
                                    key={path}
                                    onClick={() => setSelected(path)}
                                    onDoubleClick={() => { setSelected(path); handleConfirm(); }}
                                    style={{
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        fontFamily: 'monospace',
                                        cursor: 'pointer',
                                        background: isSelected ? 'var(--accent-bg, #2563eb33)' : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                    }}
                                >
                                    <File size={12} strokeWidth={1.6} />
                                    <span>{display}</span>
                                </div>
                            );
                        })
                    )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <Button variant="secondary" onClick={onClose}>Cancel</Button>
                    <Button variant="primary" onClick={handleConfirm} disabled={!selected}>
                        Import
                    </Button>
                </div>
            </div>
        </ResizableModal>
    );
}
