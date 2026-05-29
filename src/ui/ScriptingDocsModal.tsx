import { useMemo, useRef, useState } from 'react';
import { ResizableModal } from './ResizableModal';
import { useAppStore } from '../storage';
import { REFERENCE_GROUPS } from '../scripting/lua/luaCompletions';
import './ScriptingDocsModal.css';

interface ScriptingDocsModalProps {
    connectionId: string;
    onClose: () => void;
}

const slug = (s: string) => 'doc-' + s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

/**
 * A read-only browser for the Lua scripting API, sourced from the same
 * REFERENCE_GROUPS catalogue that backs editor autocomplete — so the docs
 * never drift from what the runtime actually exposes.
 */
export function ScriptingDocsModal({ connectionId, onClose }: ScriptingDocsModalProps) {
    const savedBounds = useAppStore(s => s.connectionModalBounds[connectionId]?.['scriptingDocs']);
    const saveModalBounds = useAppStore(s => s.saveModalBounds);

    const [query, setQuery] = useState('');
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const bodyRef = useRef<HTMLDivElement>(null);

    const groups = useMemo(() => {
        const q = query.trim().toLowerCase();
        const withNames = REFERENCE_GROUPS.map(g => ({
            ...g,
            entries: g.entries.map(e => ({ ...e, name: g.prefix + e.label })),
        }));
        if (!q) return withNames;
        return withNames
            .map(g => ({
                ...g,
                entries: g.entries.filter(e => {
                    if (e.name.toLowerCase().includes(q)) return true;
                    if (typeof e.detail === 'string' && e.detail.toLowerCase().includes(q)) return true;
                    return typeof e.info === 'string' && e.info.toLowerCase().includes(q);
                }),
            }))
            .filter(g => g.entries.length > 0);
    }, [query]);

    const totalCount = useMemo(
        () => groups.reduce((n, g) => n + g.entries.length, 0),
        [groups],
    );

    const scrollTo = (id: string) => {
        bodyRef.current
            ?.querySelector(`#${CSS.escape(id)}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const toggleGroup = (title: string) =>
        setCollapsed(prev => {
            const next = new Set(prev);
            if (next.has(title)) next.delete(title);
            else next.add(title);
            return next;
        });

    // While searching, force every group expanded so matches are visible.
    const searching = query.trim().length > 0;

    return (
        <ResizableModal
            title="Scripting reference"
            onClose={onClose}
            savedBounds={savedBounds}
            onBoundsChange={b => saveModalBounds(connectionId, 'scriptingDocs', b)}
            defaultW={900}
            defaultH={640}
            minW={560}
            minH={380}
            className="scripting-docs"
            bodyClassName="scripting-docs__body"
        >
            <aside className="docs-sidebar">
                <div className="docs-sidebar__search">
                    <input
                        type="text"
                        className="docs-search"
                        placeholder="Search…"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        autoFocus
                    />
                    <span className="docs-search__count">{totalCount}</span>
                </div>
                <nav className="docs-index">
                    {groups.length === 0 && (
                        <div className="docs-index__empty">No matches</div>
                    )}
                    {groups.map(group => {
                        const isCollapsed = !searching && collapsed.has(group.title);
                        return (
                            <div key={group.title} className="docs-index__group">
                                <button
                                    type="button"
                                    className="docs-index__cat"
                                    onClick={() => (searching ? scrollTo(slug(group.title)) : toggleGroup(group.title))}
                                    aria-expanded={!isCollapsed}
                                >
                                    <span className={`docs-index__caret${isCollapsed ? ' is-collapsed' : ''}`}>▾</span>
                                    <span className="docs-index__cat-name">{group.title}</span>
                                    <span className="docs-index__cat-count">{group.entries.length}</span>
                                </button>
                                {!isCollapsed && (
                                    <ul className="docs-index__list">
                                        {group.entries.map(e => (
                                            <li key={e.name}>
                                                <button
                                                    type="button"
                                                    className="docs-index__item"
                                                    onClick={() => scrollTo(slug(e.name))}
                                                    title={e.name}
                                                >
                                                    {e.name}
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </nav>
            </aside>

            <div className="docs-content" ref={bodyRef}>
                {groups.length === 0 ? (
                    <div className="docs-empty">No matches for “{query}”</div>
                ) : groups.map(group => (
                    <section key={group.title} className="docs-group" id={slug(group.title)}>
                        <h3 className="docs-group__title">{group.title}</h3>
                        <ul className="docs-list">
                            {group.entries.map(e => (
                                <li key={e.name} className="docs-item" id={slug(e.name)}>
                                    <div className="docs-item__head">
                                        <span className="docs-item__name">{e.name}</span>
                                        {e.detail && (
                                            <span className="docs-item__sig">{e.detail}</span>
                                        )}
                                    </div>
                                    {typeof e.info === 'string' && e.info && (
                                        <div className="docs-item__info">{e.info}</div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </ResizableModal>
    );
}
