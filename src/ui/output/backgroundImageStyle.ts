import type React from 'react';
import { cssTextToParts } from '../labels/qtCss';

export interface BackgroundImageSpec {
    /** Resolved image URL (for modes 1-3) or raw CSS stylesheet (mode 4). */
    url: string;
    /** Mudlet BgImageMode: 1=border (stretched via border-image), 2=center,
     *  3=tile, 4=raw stylesheet (url field is the stylesheet body). */
    mode: number;
}

const cssUrl = (raw: string) => `url("${raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;

/**
 * Translates a Mudlet background-image spec into inline React CSS, mirroring
 * the QSS produced by TConsole::setConsoleBackgroundImage in Mudlet's C++ so
 * imported scripts look the same. Mode 4 takes the user-authored stylesheet
 * body and parses its declarations through the same path setLabelStyleSheet
 * uses, so multi-property CSS strings (with their own `url(...)` refs) layer
 * cleanly. Returns null for unsupported modes — the caller leaves the element
 * style untouched. */
export function backgroundImageStyle(spec: BackgroundImageSpec | undefined): React.CSSProperties | null {
    if (!spec) return null;
    if (spec.mode === 1) {
        return { borderImage: cssUrl(spec.url), borderImageSlice: '0 fill' };
    }
    if (spec.mode === 2) {
        return {
            backgroundImage: cssUrl(spec.url),
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundOrigin: 'content-box',
        };
    }
    if (spec.mode === 3) {
        return { backgroundImage: cssUrl(spec.url), backgroundRepeat: 'repeat' };
    }
    if (spec.mode === 4) {
        return cssTextToParts(spec.url).inline;
    }
    return null;
}
