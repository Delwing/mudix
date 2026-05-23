import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader, Package, RefreshCw } from 'lucide-react';
import { ResizableModal } from '../../ResizableModal';
import { Button } from '../../components/Button';
import { renderMarkdown } from '../../markdown';
import {
    REPO_SITE_URL,
    fetchPackageCatalog,
    downloadPackageBytes,
    packageIconUrl,
    type PackageRepoCatalog,
    type PackageRepoEntry,
} from '../../../import/packageRepository';

interface Props {
    /** Names of packages already installed on this profile — used to flag matching entries. */
    installedNames: Set<string>;
    /** Active proxy URL, used to retry catalog/download fetches when a direct fetch fails CORS. */
    proxyUrl?: string;
    onClose: () => void;
    /**
     * Called after the user clicks Install on an entry. The caller fetches/installs/commits
     * to the store — keeping that flow in ScriptEditorPanel means we don't need to plumb the
     * VFS, scripting engine, or store mutators through the modal.
     *
     * Must throw on failure so the modal can surface the error inline.
     */
    onInstall: (entry: PackageRepoEntry, bytes: Uint8Array) => Promise<void>;
}

interface RowState {
    status: 'idle' | 'installing' | 'installed' | 'error';
    error?: string;
}

/** Tiny formatter: "1.3M ago" / "2d ago" / "3w ago" / "Apr 2024" for the upload timestamp. */
function formatRelative(uploadedSec: number | undefined): string | null {
    if (!uploadedSec) return null;
    const diff = Date.now() / 1000 - uploadedSec;
    if (diff < 60)         return 'just now';
    if (diff < 3600)       return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)      return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(uploadedSec * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

export function PackageRepositoryModal({ installedNames, proxyUrl, onClose, onInstall }: Props) {
    const [catalog, setCatalog] = useState<PackageRepoCatalog | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState('');
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [rowState, setRowState] = useState<Record<string, RowState>>({});

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        fetchPackageCatalog(proxyUrl)
            .then(c => { setCatalog(c); setLoading(false); })
            .catch(err => { setError(err instanceof Error ? err.message : String(err)); setLoading(false); });
    }, [proxyUrl]);

    useEffect(() => { load(); }, [load]);

    const filtered = useMemo(() => {
        const all = catalog?.packages ?? [];
        const q = filter.trim().toLowerCase();
        const matched = !q ? all : all.filter(p =>
            p.mpackage.toLowerCase().includes(q) ||
            (p.title?.toLowerCase().includes(q) ?? false) ||
            (p.author?.toLowerCase().includes(q) ?? false) ||
            (p.description?.toLowerCase().includes(q) ?? false),
        );
        // Sort by displayed title (falling back to mpackage id), case- and locale-aware
        // so "Áchaea" sorts next to "Achaea" and "abc" next to "ABC".
        return [...matched].sort((a, b) =>
            (a.title || a.mpackage).localeCompare(b.title || b.mpackage, undefined, { sensitivity: 'base' }),
        );
    }, [catalog, filter]);

    const handleInstall = useCallback(async (entry: PackageRepoEntry) => {
        setRowState(s => ({ ...s, [entry.mpackage]: { status: 'installing' } }));
        try {
            const bytes = await downloadPackageBytes(entry, proxyUrl);
            await onInstall(entry, bytes);
            setRowState(s => ({ ...s, [entry.mpackage]: { status: 'installed' } }));
        } catch (err) {
            setRowState(s => ({
                ...s,
                [entry.mpackage]: { status: 'error', error: err instanceof Error ? err.message : String(err) },
            }));
        }
    }, [onInstall, proxyUrl]);

    const toggleExpanded = useCallback((mpackage: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(mpackage)) next.delete(mpackage); else next.add(mpackage);
            return next;
        });
    }, []);

    return (
        <ResizableModal
            title="Mudlet Package Repository"
            onClose={onClose}
            defaultW={760}
            defaultH={560}
            minW={460}
            minH={320}
            headerExtra={
                <button
                    className="modal-close"
                    onClick={load}
                    type="button"
                    title="Reload catalog"
                    aria-label="Reload catalog"
                    style={{ fontSize: 14 }}
                >
                    <RefreshCw size={14} strokeWidth={1.8} style={{ verticalAlign: 'middle' }} />
                </button>
            }
        >
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', gap: 8, padding: 12, boxSizing: 'border-box' }}>
                <p style={{ margin: 0, fontSize: 11.5, opacity: 0.75 }}>
                    Browse community packages from{' '}
                    <a href={REPO_SITE_URL} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                        Mudlet's package repository
                    </a>
                    . Installed packages can be re-installed to update.
                </p>
                <input
                    className="input"
                    type="text"
                    value={filter}
                    placeholder="Search by name, author, description…"
                    onChange={e => setFilter(e.target.value)}
                    disabled={loading || !!error}
                    autoFocus
                />
                <div
                    style={{
                        flex: 1,
                        width: '100%',
                        minWidth: 0,
                        overflowY: 'auto',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        background: 'var(--bg-input)',
                        padding: 8,
                    }}
                >
                    {loading && (
                        <div style={{ padding: 24, textAlign: 'center', fontSize: 12, opacity: 0.7, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                            <Loader size={14} strokeWidth={1.8} className="package-repo__spin" />
                            Loading catalog…
                        </div>
                    )}
                    {error && !loading && (
                        <div style={{ padding: 16, textAlign: 'center', fontSize: 12 }}>
                            <div style={{ color: 'var(--danger, #e06c75)', marginBottom: 8 }}>Failed to load catalog: {error}</div>
                            <Button variant="secondary" size="sm" onClick={load}>Retry</Button>
                        </div>
                    )}
                    {!loading && !error && filtered.length === 0 && (
                        <div style={{ padding: 24, textAlign: 'center', fontSize: 12, opacity: 0.6 }}>
                            {catalog && catalog.packages.length > 0 ? 'No packages match the filter.' : 'No packages available.'}
                        </div>
                    )}
                    {!loading && !error && filtered.map(entry => {
                        const state = rowState[entry.mpackage] ?? { status: 'idle' as const };
                        const isInstalled = installedNames.has(entry.mpackage) || state.status === 'installed';
                        const isInstalling = state.status === 'installing';
                        const isExpanded = expanded.has(entry.mpackage);
                        const iconUrl = packageIconUrl(entry);
                        const uploaded = formatRelative(entry.uploaded);
                        return (
                            <div key={entry.mpackage} className="script-editor__pkg-card" style={{ marginBottom: 8 }}>
                                <div className="script-editor__pkg-icon-frame">
                                    {iconUrl
                                        ? <img className="script-editor__pkg-icon-img" src={iconUrl} alt="" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                        : <Package className="script-editor__pkg-icon-fallback" size={28} strokeWidth={1.4} />}
                                </div>
                                <div className="script-editor__pkg-body">
                                    <div className="script-editor__pkg-title">
                                        {entry.title || entry.mpackage}
                                        {isInstalled && (
                                            <span
                                                title="Already installed on this profile"
                                                style={{ marginLeft: 8, fontSize: 10, padding: '1px 6px', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 3, display: 'inline-flex', alignItems: 'center', gap: 3, verticalAlign: 'middle' }}
                                            >
                                                <Check size={10} strokeWidth={2} /> INSTALLED
                                            </span>
                                        )}
                                    </div>
                                    <div className="script-editor__pkg-byline">
                                        {entry.title && entry.title !== entry.mpackage && <span>{entry.mpackage}</span>}
                                        {entry.version && <><span className="script-editor__pkg-byline-sep">·</span><span>v{entry.version}</span></>}
                                        {entry.author && <><span className="script-editor__pkg-byline-sep">·</span><span>{entry.author}</span></>}
                                        {uploaded && <><span className="script-editor__pkg-byline-sep">·</span><span title={entry.uploaded ? new Date(entry.uploaded * 1000).toLocaleString() : ''}>updated {uploaded}</span></>}
                                    </div>
                                    {entry.description && (
                                        <div className="script-editor__pkg-desc-wrap">
                                            <div
                                                className={`script-editor__pkg-desc${isExpanded ? ' script-editor__pkg-desc--expanded' : ''}`}
                                                dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.description) }}
                                            />
                                            <button
                                                className="script-editor__pkg-desc-toggle"
                                                onClick={() => toggleExpanded(entry.mpackage)}
                                            >
                                                {isExpanded ? 'Show less' : 'Show more'}
                                            </button>
                                        </div>
                                    )}
                                    <div className="script-editor__pkg-footer">{entry.filename}</div>
                                    {state.status === 'error' && (
                                        <div style={{ color: 'var(--danger, #e06c75)', fontSize: 11, marginTop: 4 }}>
                                            Install failed: {state.error}
                                        </div>
                                    )}
                                </div>
                                <Button
                                    variant={isInstalled ? 'secondary' : 'primary'}
                                    size="sm"
                                    onClick={() => handleInstall(entry)}
                                    disabled={isInstalling}
                                    title={isInstalled ? 'Re-install to update' : 'Install this package'}
                                >
                                    {isInstalling
                                        ? <><Loader size={11} strokeWidth={1.8} className="package-repo__spin" style={{ marginRight: 4, verticalAlign: 'middle' }} />Installing…</>
                                        : isInstalled ? 'Reinstall' : 'Install'}
                                </Button>
                            </div>
                        );
                    })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-dim)' }}>
                    <span>
                        {catalog ? `${filtered.length} of ${catalog.packages.length} packages` : ''}
                        {catalog?.updated && <> · catalog updated {catalog.updated}</>}
                    </span>
                    <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
                </div>
            </div>
        </ResizableModal>
    );
}
