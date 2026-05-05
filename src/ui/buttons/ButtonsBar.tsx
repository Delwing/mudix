import { useEffect, useMemo, useState, type RefObject } from 'react';
import { strToU8 } from 'fflate';
import { useAppStore } from '../../storage';
import { isEffectivelyEnabled, type ButtonLocation, type ButtonNode } from '../../storage/schema';
import type { ScriptingEngine } from '../../scripting/ScriptingEngine';
import type { ProfileVFS } from '../../scripting/vfs/ProfileVFS';
import './ButtonsBar.css';

const ICON_MIME: Record<string, string> = {
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    gif:  'image/gif',
    webp: 'image/webp',
    svg:  'image/svg+xml',
    bmp:  'image/bmp',
    ico:  'image/x-icon',
};

const EMPTY: ButtonNode[] = [];

interface ToolbarStripProps {
    side: ButtonLocation;
    toolbars: ButtonNode[];
    allButtons: ButtonNode[];
    engineRef: RefObject<ScriptingEngine | null>;
    vfs: ProfileVFS | null;
    onStateChange: (id: string, next: boolean) => void;
}

interface ButtonViewProps {
    button: ButtonNode;
    engineRef: RefObject<ScriptingEngine | null>;
    vfs: ProfileVFS | null;
    onStateChange: (id: string, next: boolean) => void;
}

function resolveIconUrl(vfs: ProfileVFS | null, iconPath: string): string | null {
    if (!vfs || !iconPath) return null;
    // Try a few likely locations: absolute, relative to profile root.
    const candidates = iconPath.startsWith('/')
        ? [iconPath]
        : [`${vfs.profilePath}/${iconPath}`, iconPath];
    for (const path of candidates) {
        try {
            if (!vfs.exists(path)) continue;
            const bytes = strToU8(vfs.readFile(path), true);
            const ext = iconPath.split('.').pop()?.toLowerCase() ?? '';
            const mime = ICON_MIME[ext] ?? 'application/octet-stream';
            return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
        } catch {
            // Try the next candidate.
        }
    }
    return null;
}

function ButtonView({ button, engineRef, vfs, onStateChange }: ButtonViewProps) {
    const [iconUrl, setIconUrl] = useState<string | null>(null);

    useEffect(() => {
        if (!button.icon) { setIconUrl(null); return; }
        const url = resolveIconUrl(vfs, button.icon);
        setIconUrl(url);
        return () => { if (url) URL.revokeObjectURL(url); };
    }, [vfs, button.icon]);

    const handleClick = () => {
        const next = button.isPushDown ? !button.buttonState : true;
        engineRef.current?.executeButton(button, next);
        if (button.isPushDown) onStateChange(button.id, next);
    };

    const pressed = button.isPushDown && button.buttonState;
    const cls = [
        'mudix-btn',
        pressed ? 'mudix-btn--pressed' : '',
        button.isPushDown ? 'mudix-btn--toggle' : '',
    ].filter(Boolean).join(' ');

    return (
        <button
            type="button"
            className={cls}
            title={button.tooltip || button.name}
            aria-pressed={button.isPushDown ? pressed : undefined}
            onClick={handleClick}
        >
            {iconUrl
                ? <img className="mudix-btn__icon" src={iconUrl} alt="" />
                : <span className="mudix-btn__label">{button.name}</span>}
        </button>
    );
}

function ToolbarStrip({ side, toolbars, allButtons, engineRef, vfs, onStateChange }: ToolbarStripProps) {
    if (toolbars.length === 0) return null;
    const cls = `mudix-toolbar-strip mudix-toolbar-strip--${side}`;
    return (
        <div className={cls}>
            {toolbars.map(toolbar => {
                const children = allButtons.filter(b =>
                    b.parentId === toolbar.id && !b.isGroup && isEffectivelyEnabled(b, allButtons),
                );
                if (children.length === 0) return null;
                const cols = toolbar.columns ?? 0;
                const useGrid = cols > 0;
                const tbCls = useGrid
                    ? `mudix-toolbar mudix-toolbar--grid mudix-toolbar--${toolbar.orientation}`
                    : `mudix-toolbar mudix-toolbar--${toolbar.orientation}`;
                // Mudlet's buttonColumn = cross-axis cell count, so the role flips:
                //   horizontal toolbar → N rows, buttons fill column-by-column
                //   vertical toolbar   → N columns, buttons fill row-by-row
                const gridStyle: React.CSSProperties | undefined = useGrid
                    ? toolbar.orientation === 'horizontal'
                        ? { gridTemplateRows: `repeat(${cols}, auto)`, gridAutoFlow: 'column' }
                        : { gridTemplateColumns: `repeat(${cols}, minmax(0, auto))` }
                    : undefined;
                return (
                    <div key={toolbar.id} className={tbCls} style={gridStyle} title={toolbar.name}>
                        {children.map(b => (
                            <ButtonView
                                key={b.id}
                                button={b}
                                engineRef={engineRef}
                                vfs={vfs}
                                onStateChange={onStateChange}
                            />
                        ))}
                    </div>
                );
            })}
        </div>
    );
}

interface ButtonsLayerProps {
    connectionId: string;
    engineRef: RefObject<ScriptingEngine | null>;
    vfs: ProfileVFS | null;
}

/**
 * Returns the four edge strips of toolbars (top/bottom/left/right). The caller
 * places each strip in the appropriate spot inside ContentLayout.
 */
export function useButtonStrips({ connectionId, engineRef, vfs }: ButtonsLayerProps) {
    const buttons = useAppStore(s => connectionId ? (s.connectionButtons[connectionId] ?? EMPTY) : EMPTY);
    const updateButton = useAppStore(s => s.updateButton);

    const onStateChange = (id: string, next: boolean) => {
        updateButton(connectionId, id, { buttonState: next });
    };

    const enabledToolbars = useMemo(
        () => buttons.filter(b => b.isGroup && isEffectivelyEnabled(b, buttons)),
        [buttons],
    );

    const byLocation = (loc: ButtonLocation) => enabledToolbars.filter(t => t.location === loc);

    const strip = (side: ButtonLocation) => (
        <ToolbarStrip
            side={side}
            toolbars={byLocation(side)}
            allButtons={buttons}
            engineRef={engineRef}
            vfs={vfs}
            onStateChange={onStateChange}
        />
    );

    return {
        top:    strip('top'),
        bottom: strip('bottom'),
        left:   strip('left'),
        right:  strip('right'),
    };
}
