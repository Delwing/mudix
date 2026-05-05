import { useEffect, useState } from 'react';
import type { GaugeManager, GaugeState } from './GaugeManager';
import './GaugeOverlay.css';

interface GaugeOverlayProps {
    manager: GaugeManager;
    parent: string;
}

export function GaugeOverlay({ manager, parent }: GaugeOverlayProps) {
    const [gauges, setGauges] = useState<GaugeState[]>(() => manager.list(parent));
    useEffect(() => manager.subscribe(parent, setGauges), [manager, parent]);
    if (gauges.length === 0) return null;
    return (
        <div className="gauge-overlay">
            {gauges.map(g => <Gauge key={g.name} g={g} />)}
        </div>
    );
}

function Gauge({ g }: { g: GaugeState }) {
    if (!g.visible) return null;

    const { x, y, width, height, r, g: gn, b, value, orientation } = g;
    const rgb = `rgb(${r}, ${gn}, ${b})`;
    const rgbBack = `rgba(${r}, ${gn}, ${b}, 0.39)`; // Mudlet alpha 100/255 ≈ 0.39

    let frontW = width, frontH = height, frontX = 0, frontY = 0;
    switch (orientation) {
        case 'horizontal': frontW = width * value; break;
        case 'vertical':   frontH = height * value; frontY = height * (1 - value); break;
        case 'goofy':      frontW = width * value;  frontX = width * (1 - value); break;
        case 'batty':      frontH = height * value; break;
    }

    const containerStyle: React.CSSProperties = {
        left: x, top: y, width, height,
    };
    const backStyle: React.CSSProperties = {
        background: rgbBack,
        ...(g.cssBack ? cssTextToStyle(g.cssBack) : {}),
    };
    const frontStyle: React.CSSProperties = {
        left: frontX, top: frontY,
        width: frontW, height: frontH,
        background: rgb,
        ...(g.cssFront ? cssTextToStyle(g.cssFront) : {}),
    };
    const textStyle: React.CSSProperties = g.cssText ? cssTextToStyle(g.cssText) : {};

    return (
        <div className="gauge" style={containerStyle}>
            <div className="gauge-back"  style={backStyle}  />
            <div className="gauge-front" style={frontStyle} />
            <div className="gauge-text"  style={textStyle} dangerouslySetInnerHTML={{ __html: g.html }} />
        </div>
    );
}

// Mudlet style sheets are Qt CSS strings like "background-color: red; border: 1px solid #000;".
// Lower-case keys map cleanly to camelCase React style props for the common subset
// (background, color, border, font-size, opacity, etc.). Properties we don't recognize
// are dropped; this is intentional since Qt-specific selectors don't translate to DOM.
function cssTextToStyle(css: string): React.CSSProperties {
    const out: Record<string, string> = {};
    for (const decl of css.split(';')) {
        const i = decl.indexOf(':');
        if (i < 0) continue;
        const key = decl.slice(0, i).trim();
        const val = decl.slice(i + 1).trim();
        if (!key || !val) continue;
        const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        out[camel] = val;
    }
    return out as React.CSSProperties;
}
