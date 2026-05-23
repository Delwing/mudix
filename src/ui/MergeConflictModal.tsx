import { useState, useMemo, useCallback } from 'react';
import { ResizableModal } from './ResizableModal';
import type { DiffResult, SideKind } from '../scripting/vfs/folderSync';

interface MergeConflictModalProps {
    /** Diff between the currently-mounted profile (local/IDB) and the linked folder. */
    diff: DiffResult;
    /** Display name shown in headers, e.g. the folder.name. */
    folderName: string;
    /** Cancel the link operation entirely. */
    onCancel: () => void;
    /**
     * User confirmed. `resolutions` maps each conflicting path to the winning
     * side. The caller copies winners into the folder (folder is the next
     * mount's source of truth). Files in onlyLocal are unioned in automatically.
     */
    onApply: (resolutions: Map<string, SideKind>) => void;
}

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMtime(ms: number): string {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const d = new Date(ms);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function MergeConflictModal({ diff, folderName, onCancel, onApply }: MergeConflictModalProps) {
    // Default each conflict to "folder wins" — the folder is what the user
    // just picked, so it's the side they presumably care about preserving.
    const initial = useMemo(() => {
        const m = new Map<string, SideKind>();
        for (const c of diff.conflicts) m.set(c.path, 'folder');
        return m;
    }, [diff.conflicts]);

    const [resolutions, setResolutions] = useState<Map<string, SideKind>>(initial);

    const setOne = useCallback((path: string, side: SideKind) => {
        setResolutions(prev => {
            const next = new Map(prev);
            next.set(path, side);
            return next;
        });
    }, []);

    const setAll = useCallback((side: SideKind) => {
        setResolutions(() => {
            const next = new Map<string, SideKind>();
            for (const c of diff.conflicts) next.set(c.path, side);
            return next;
        });
    }, [diff.conflicts]);

    const handleApply = useCallback(() => onApply(resolutions), [onApply, resolutions]);

    const localChosen = useMemo(
        () => Array.from(resolutions.values()).filter(s => s === 'local').length,
        [resolutions],
    );
    const folderChosen = resolutions.size - localChosen;
    const carryOver = diff.onlyLocal.length;
    const folderKept = diff.onlyFolder.length;

    return (
        <ResizableModal
            title="Resolve file conflicts"
            onClose={onCancel}
            defaultW={720}
            defaultH={520}
            minW={420}
            minH={300}
            bodyClassName="merge-modal-body"
        >
            <div className="merge-summary">
                <p>
                    The folder <strong>{folderName}</strong> already contains files that overlap with this profile.
                    Pick which side wins for each conflict. The chosen content becomes the source of truth once the folder is mounted.
                </p>
                <ul className="merge-summary-list">
                    {carryOver > 0 && (
                        <li>
                            <strong>{carryOver}</strong> local-only file{carryOver === 1 ? '' : 's'} will be copied into the folder.
                        </li>
                    )}
                    {folderKept > 0 && (
                        <li>
                            <strong>{folderKept}</strong> folder-only file{folderKept === 1 ? '' : 's'} will be kept as-is.
                        </li>
                    )}
                    <li>
                        <strong>{diff.conflicts.length}</strong> conflicting path{diff.conflicts.length === 1 ? '' : 's'}: choose below.
                    </li>
                </ul>
                <div className="merge-bulk">
                    <button type="button" className="merge-bulk-btn" onClick={() => setAll('local')}>
                        Use all local
                    </button>
                    <button type="button" className="merge-bulk-btn" onClick={() => setAll('folder')}>
                        Use all folder
                    </button>
                    <span className="merge-counts">
                        {localChosen} local · {folderChosen} folder
                    </span>
                </div>
            </div>

            <div className="merge-table-wrap">
                <table className="merge-table">
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Local</th>
                            <th>Folder</th>
                            <th className="merge-th-choice">Keep</th>
                        </tr>
                    </thead>
                    <tbody>
                        {diff.conflicts.map(c => {
                            const choice = resolutions.get(c.path) ?? 'folder';
                            return (
                                <tr key={c.path}>
                                    <td className="merge-path" title={c.path}>{c.path}</td>
                                    <td className={`merge-side${choice === 'local' ? ' merge-side-picked' : ''}`}>
                                        <span className="merge-size">{formatSize(c.local.size)}</span>
                                        <span className="merge-mtime">{formatMtime(c.local.mtimeMs)}</span>
                                    </td>
                                    <td className={`merge-side${choice === 'folder' ? ' merge-side-picked' : ''}`}>
                                        <span className="merge-size">{formatSize(c.folder.size)}</span>
                                        <span className="merge-mtime">{formatMtime(c.folder.mtimeMs)}</span>
                                    </td>
                                    <td className="merge-choice-cell">
                                        <label className="merge-choice">
                                            <input
                                                type="radio"
                                                name={`merge-${c.path}`}
                                                checked={choice === 'local'}
                                                onChange={() => setOne(c.path, 'local')}
                                            />
                                            <span>local</span>
                                        </label>
                                        <label className="merge-choice">
                                            <input
                                                type="radio"
                                                name={`merge-${c.path}`}
                                                checked={choice === 'folder'}
                                                onChange={() => setOne(c.path, 'folder')}
                                            />
                                            <span>folder</span>
                                        </label>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div className="merge-footer">
                <button type="button" className="merge-btn-secondary" onClick={onCancel}>
                    Cancel link
                </button>
                <button type="button" className="merge-btn-primary" onClick={handleApply}>
                    Apply &amp; link
                </button>
            </div>
        </ResizableModal>
    );
}
