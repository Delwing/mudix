// MXP (MUD eXtension Protocol) — telnet option 91. An in-band, HTML-like markup
// language servers embed in the normal text stream once option 91 is negotiated.
// It carries text formatting (`<B>`, `<COLOR>`, `<FONT>`), clickable links
// (`<SEND>`, `<A>`), entities (`&lt;`, `&#160;`), custom element/entity
// definitions (`<!ELEMENT>`, `<!ENTITY>`, `<V>`), and per-line security modes via
// the `ESC[#z` CSI sequence. This parser turns one raw line (which may also carry
// ordinary ANSI SGR) into rendered {@link BufferSegment}s plus a clean,
// entity-decoded plain string for trigger matching and a list of link ranges the
// scripting engine wires into clickable hyperlinks.
//
// Reference: https://www.zuggsoft.com/zmud/mxp.htm
//
// Design notes:
//  - DOM/session-free and unit-testable. Link click behaviour (send command vs.
//    open URL) is built in the scripting engine, which has session access; this
//    module only reports *where* links are and *what* they target.
//  - The parser owns SGR carry across lines when MXP is active: it walks every
//    byte, applying ANSI SGR through `FormatState.applySgr` and layering MXP tag
//    formatting on the same pen, then returns the end-of-line snapshot.
//  - Heavy/rare tags (frames, images, gauges, dest/relocate/filter) are
//    parsed-and-discarded: the tag is consumed so it never renders literally,
//    while any enclosed text still renders inline.

import { FormatState, applyOscPaletteOps } from "../text/FormatState";
import type { BufferSegment, FormatColor, FormatStateSnapshot, FormatHyperlink } from "../text/FormatState";
import { mxpColor } from "../text/colorParsers";
import { scanEscape, parseOsc8Payload, classifyHyperlinkUri, parseOscColorPalette } from "../text/ansiEscapes";
import { parseOsc8Uri, HyperlinkPresetRegistry } from "../text/hyperlinkConfig";

/** A clickable region the parser found, expressed as offsets into `plain`. The
 *  engine builds the actual `FormatHyperlink` (with session/URL behaviour). */
export interface MxpLink {
    /** Start offset into the line's plain text (inclusive). */
    start: number;
    /** End offset into the line's plain text (exclusive). */
    end: number;
    /** `url` → open in a browser tab; `command` → send to the MUD. */
    kind: "command" | "url";
    /** The single command or URL fired on left-click. */
    payload: string;
    /** Tooltip / title text. */
    hint?: string;
    /** Present when the SEND carried a `cmd1|cmd2|…` list — the engine renders a
     *  right-click popup of `cmds` labelled by `hints`. */
    prompts?: { cmds: string[]; hints: string[] };
}

/** The result of parsing one raw MXP line. */
export interface MxpLineResult {
    /** Styled segments, ready for `new AnsiAwareBuffer(segments)`. */
    segments: BufferSegment[];
    /** MXP-stripped, ANSI-stripped, entity-decoded text — for trigger matching. */
    plain: string;
    /** End-of-line SGR/format pen, carried into the next line (replaces
     *  `computeTrailingState` while MXP is active). */
    trailingSnapshot?: FormatStateSnapshot;
    /** Clickable regions discovered on this line. */
    links: MxpLink[];
}

type MxpMode = "open" | "secure" | "locked";

interface ElementDef {
    name: string;
    /** Replacement markup, e.g. `<FONT COLOR=&col;><B>`. */
    template: string;
    /** Declared attribute names, in positional order. */
    atts: string[];
    /** Default attribute values keyed by lowercased name. */
    attDefaults: Record<string, string>;
    /** FLAG="…" bookkeeping (captured, not yet surfaced to scripts). */
    flag?: string;
    /** Usable in OPEN line mode (the `OPEN` keyword). */
    open: boolean;
    /** No closing tag (the `EMPTY` keyword). */
    empty: boolean;
}

interface OpenTag {
    name: string;
    /** Pen snapshot to restore when this tag closes. */
    closeFmt: FormatStateSnapshot;
    /** Set for `<SEND>`/`<A>` — accumulates the link target + display range. */
    link?: { start: number; href?: string; hint?: string; isUrl: boolean };
    /** Set for `<V name>` — captures the enclosed plain text into `entities`. */
    varName?: string;
    varStart?: number;
    /** Set for `<COLOR>`/`<FONT>` — on close, pop one entry off `mxpColorStack`. */
    colorOverride?: boolean;
}

const CLIENT_VERSION = "1.0";

/** Prefix for the client→server `<SUPPORTS>`/`<VERSION>` handshake replies. The
 *  `ESC[1z` secure-line-mode marker tells the server's MXP parser this inbound
 *  line is an MXP response, not a user command. Without it, servers that gate
 *  MXP input on the secure marker (e.g. Discworld) treat the reply as ordinary
 *  text — so `<SUPPORTS …>` lands in the login prompt as a bogus character name.
 *  Matches Mudlet, which sends `\n\x1b[1z<SUPPORTS …>\n` (TMxpSupportTagHandler).
 *  The terminating newline is appended by the transport (`MudClient.send`). */
const MXP_SECURE_REPLY_PREFIX = "\x1b[1z";

/** Tags honored in OPEN line mode (safe formatting + structure). Everything else
 *  — SEND/A, definitions, V — requires SECURE mode, which is MXP's whole point:
 *  it stops server-echoed user text containing `<send>` from forging clickable
 *  commands. */
const OPEN_MODE_TAGS = new Set<string>([
    "b", "bold", "strong", "i", "italic", "em", "u", "underline",
    "s", "strikeout", "strike", "del", "h", "high", "color", "c", "font",
    "br", "sbr", "nobr", "p", "hr", "version", "support",
]);

/** Reported back to the server in response to `<SUPPORT>`. `+tag` = implemented,
 *  `-tag` = explicitly unsupported. Kept in sync with the dispatch in
 *  {@link MxpParser.handleOpenTag}. */
const SUPPORTED_TAGS = [
    "+b", "+i", "+u", "+s", "+h", "+high", "+strikeout", "+color", "+c", "+font",
    "+send", "+a", "+br", "+sbr", "+nobr", "+p", "+hr", "+var", "+version", "+support",
    "-image", "-frame", "-dest", "-relocate", "-filter", "-gauge", "-stat", "-music", "-sound",
];

/** Built-in XML/HTML entities. User and `<V>`-defined entities augment these via
 *  the per-session `entities` map. */
const BUILTIN_ENTITIES: Record<string, string> = {
    lt: "<", gt: ">", amp: "&", quot: '"', apos: "'", nbsp: " ",
};

/** Cap on a held partial tag/entity. Beyond this it was never real markup, so it
 *  is flushed as literal text rather than swallowing the rest of the stream. */
const MAX_PENDING = 256;
/** Recursion guard for custom-element template expansion. */
const MAX_DEPTH = 8;

export class MxpParser {
    private readonly opts: { send: (raw: string) => void };

    // --- persistent across the whole session ---
    private elements = new Map<string, ElementDef>();
    private entities = new Map<string, string>();
    private lineMode: MxpMode = "open";
    private lockedMode: MxpMode | null = null;
    private tempSecure = false;
    private stack: OpenTag[] = [];
    /** Active MXP `<COLOR>`/`<FONT>` fg/bg overrides, innermost last. While
     *  non-empty, the top entry's colours are painted over whatever the ANSI
     *  pen holds — matching Mudlet, where an open MXP colour element overrides
     *  embedded ANSI SGR (TBuffer.cpp: `if (hasFgColor()) c.mFgColor = ...`).
     *  Stays in sync with the colour tags on `stack` (pushed in openColor,
     *  popped in finalizeTag). */
    private mxpColorStack: { fg: FormatColor | null; bg: FormatColor | null }[] = [];
    /** Partial tag/entity held from the end of the previous line. */
    private pendingTag = "";
    /** OSC 8 preset definitions seen this session (shared with the ANSI path
     *  when the engine supplies a registry). */
    private presets: HyperlinkPresetRegistry;

    // --- per-line scratch (reset at the start of parseLine) ---
    private fmt: FormatState = new FormatState();
    private out: BufferSegment[] = [];
    private run = "";
    private plain = "";
    private links: MxpLink[] = [];

    constructor(opts: { send: (raw: string) => void; presets?: HyperlinkPresetRegistry }) {
        this.opts = opts;
        this.presets = opts.presets ?? new HyperlinkPresetRegistry();
    }

    /** Clear all cross-line state. Called on (re)connect so a new session starts
     *  with no leftover definitions, open tags, or modes. */
    reset(): void {
        this.elements.clear();
        this.entities.clear();
        this.lineMode = "open";
        this.lockedMode = null;
        this.tempSecure = false;
        this.stack = [];
        this.mxpColorStack = [];
        this.pendingTag = "";
        this.fmt = new FormatState();
        this.out = [];
        this.run = "";
        this.plain = "";
        this.links = [];
        this.presets.clear();
    }

    /** Parse one raw line (post telnet-strip, post UTF-8 decode), which may carry
     *  ANSI SGR, MXP tags, `ESC[#z` modes, and entities. `baseSnapshot` is the
     *  carried pen from the previous line. */
    parseLine(rawLine: string, baseSnapshot?: FormatStateSnapshot): MxpLineResult {
        const input = this.pendingTag + rawLine;
        this.pendingTag = "";

        this.fmt = new FormatState(baseSnapshot);
        this.out = [];
        this.run = "";
        this.plain = "";
        this.links = [];

        this.parseFragment(input, 0);
        this.flushRun();
        // A held partial tag means we're logically mid-line, so the transient
        // line mode (and temp-secure) must survive into the continuation.
        if (this.pendingTag === "") this.resetTransientMode();

        const trailing = this.fmt.toSnapshot();
        return { segments: this.out, plain: this.plain, trailingSnapshot: trailing, links: this.links };
    }

    private effectiveMode(): MxpMode {
        return this.lockedMode ?? this.lineMode;
    }

    private resetTransientMode(): void {
        // Transient OPEN/SECURE/LOCKED (modes 0/1/2) last only for the current
        // line; at the newline we revert to the locked mode, or OPEN by default.
        this.lineMode = this.lockedMode ?? "open";
        this.tempSecure = false;
    }

    // ---- text emission ----

    private appendText(s: string): void {
        if (s.length === 0) return;
        this.run += s;
        this.plain += s;
    }

    private flushRun(): void {
        if (this.run.length === 0) return;
        const state = this.fmt.toSnapshot();
        // An open MXP <COLOR>/<FONT> colour wins over the ANSI pen (Mudlet
        // semantics): the ANSI fg/bg still tracks in `fmt` so it resumes once
        // the colour tag closes, but it isn't what gets painted meanwhile.
        const override = this.mxpColorStack[this.mxpColorStack.length - 1];
        if (override) {
            if (override.fg) state.foreground = override.fg;
            if (override.bg) state.background = override.bg;
        }
        this.out.push({ text: this.run, state });
        this.run = "";
    }

    // ---- scanner ----

    private parseFragment(text: string, depth: number): void {
        let i = 0;
        const n = text.length;
        while (i < n) {
            const ch = text[i];

            if (ch === "\x1b") {
                const esc = scanEscape(text, i);
                if (esc.kind === "incomplete") {
                    // Sequence cut off at end of input — hold for the next line.
                    if (depth === 0 && n - i <= MAX_PENDING) this.pendingTag = text.slice(i);
                    return;
                }
                if (esc.kind === "csi" && esc.finalByte === "m") {
                    this.flushRun();
                    this.fmt.applySgr(parseSgrParams(esc.params ?? ""));
                } else if (esc.kind === "csi" && esc.finalByte === "z") {
                    this.flushRun();
                    this.applyLineMode(parseInt(esc.params ?? "", 10) || 0);
                } else if (esc.kind === "osc" && esc.oscPayload !== undefined) {
                    // OSC 8 hyperlink: open/close a clickable link on the
                    // following text. The URI is stashed on the pen and the
                    // engine wires its click behaviour after the buffer is
                    // built (bindUrlHyperlinks); a disallowed scheme is ignored.
                    const link = parseOsc8Payload(esc.oscPayload);
                    if (link) {
                        this.flushRun();
                        if (link.uri === "") {
                            this.fmt.hyperlink = undefined;
                        } else {
                            const result = parseOsc8Uri(link.uri, this.presets);
                            if (result?.kind === "link" && classifyHyperlinkUri(result.command)) {
                                const hl: FormatHyperlink = { url: result.command, osc8: true };
                                if (Object.keys(result.config).length > 0) hl.config = result.config;
                                if (link.id) hl.linkId = link.id;
                                this.fmt.hyperlink = hl;
                            }
                            // preset definition / disallowed scheme: leave as-is.
                        }
                    } else {
                        // OSC 4/104 colour palette redefinition (no text/state
                        // change — retargets colour tables for following runs).
                        const palette = parseOscColorPalette(esc.oscPayload);
                        if (palette) applyOscPaletteOps(palette);
                    }
                }
                // Every other recognized sequence (non-OSC-8 OSC commands,
                // cursor moves, erase, charset designation, DCS strings, …) is
                // consumed and never rendered as literal text.
                i = esc.end;
                continue;
            }

            if (ch === "<") {
                const next = text[i + 1];
                // A real MXP tag opens with a letter, '/', or '!'. Anything else
                // (e.g. "5 < 10") is literal text — and in a locked line all
                // markup is literal.
                const looksLikeTag = next !== undefined && /[a-zA-Z!/]/.test(next);
                if (this.effectiveMode() === "locked" || !looksLikeTag) {
                    this.appendText("<");
                    i++;
                    continue;
                }
                const close = findTagEnd(text, i);
                if (close === -1) {
                    // Unterminated tag at end of input — hold it for the next line.
                    if (depth === 0 && n - i <= MAX_PENDING) {
                        this.pendingTag = text.slice(i);
                        return;
                    }
                    this.appendText("<");
                    i++;
                    continue;
                }
                this.handleTag(text.slice(i + 1, close), depth);
                i = close + 1;
                continue;
            }

            if (ch === "&") {
                if (this.effectiveMode() === "locked") {
                    this.appendText("&");
                    i++;
                    continue;
                }
                const semi = text.indexOf(";", i + 1);
                if (semi !== -1 && semi - i <= 33) {
                    const decoded = this.decodeEntity(text.slice(i + 1, semi));
                    if (decoded !== null) {
                        this.appendText(decoded);
                        i = semi + 1;
                        continue;
                    }
                } else if (semi === -1 && depth === 0) {
                    const rest = text.slice(i);
                    if (rest.length <= 33 && /^&[#a-zA-Z]/.test(rest)) {
                        this.pendingTag = rest;
                        return;
                    }
                }
                this.appendText("&");
                i++;
                continue;
            }

            // Plain run up to the next special character.
            let k = i;
            while (k < n) {
                const c = text[k];
                if (c === "\x1b" || c === "<" || c === "&") break;
                k++;
            }
            this.appendText(text.slice(i, k));
            i = k;
        }
    }

    // ---- line modes ----

    private applyLineMode(n: number): void {
        switch (n) {
            case 0: this.lineMode = "open"; break;
            case 1: this.lineMode = "secure"; break;
            case 2: this.lineMode = "locked"; break;
            case 3: // reset — close everything, back to defaults
                this.closeAllTags();
                this.fmt.reset();
                this.lineMode = "open";
                this.lockedMode = null;
                this.tempSecure = false;
                break;
            case 4: this.tempSecure = true; break;
            case 5: this.lockedMode = "open"; this.lineMode = "open"; break;
            case 6: this.lockedMode = "secure"; this.lineMode = "secure"; break;
            case 7: this.lockedMode = "locked"; this.lineMode = "locked"; break;
        }
    }

    private closeAllTags(): void {
        this.flushRun();
        for (let k = this.stack.length - 1; k >= 0; k--) this.finalizeTag(this.stack[k]);
        this.stack.length = 0;
    }

    // ---- tags ----

    private handleTag(raw: string, depth: number): void {
        const trimmed = raw.trim();
        if (trimmed === "") return;

        // Temp-secure (mode 4) makes exactly the next tag secure.
        const secure = this.tempSecure || this.effectiveMode() === "secure";
        this.tempSecure = false;

        if (trimmed.startsWith("!")) {
            if (secure) this.handleDefinition(trimmed);
            return;
        }
        if (trimmed.startsWith("/")) {
            const name = trimmed.slice(1).trim().split(/[\s>]/)[0].toLowerCase();
            this.handleCloseTag(name);
            return;
        }

        const sp = firstWhitespace(trimmed);
        const name = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase();
        const attrStr = sp === -1 ? "" : trimmed.slice(sp + 1);

        if (!secure && !this.openAllowed(name)) return; // discard secure-only tag in open mode
        this.handleOpenTag(name, attrStr, depth);
    }

    private openAllowed(name: string): boolean {
        if (OPEN_MODE_TAGS.has(name)) return true;
        const def = this.elements.get(name);
        return def ? def.open : false;
    }

    private handleOpenTag(name: string, attrStr: string, depth: number): void {
        const def = this.elements.get(name);
        if (def) {
            this.expandElement(def, attrStr, depth);
            return;
        }

        const { named, positional } = parseAttrs(attrStr);
        switch (name) {
            case "b": case "bold": case "strong":
                this.openFormat(name, () => { this.fmt.bold = true; }); break;
            case "i": case "italic": case "em":
                this.openFormat(name, () => { this.fmt.italic = true; }); break;
            case "u": case "underline":
                this.openFormat(name, () => { this.fmt.underline = true; }); break;
            case "s": case "strikeout": case "strike": case "del":
                this.openFormat(name, () => { this.fmt.strikethrough = true; }); break;
            case "h": case "high":
                this.openFormat(name, () => { this.fmt.bold = true; }); break;
            case "color": case "c":
                this.openColor(name, named.get("fore") ?? positional[0], named.get("back") ?? positional[1]); break;
            case "font":
                this.openColor(name, named.get("color") ?? named.get("fore"), named.get("back") ?? named.get("bgcolor")); break;
            case "send":
                this.openLink("send", named.get("href") ?? named.get("hr") ?? positional[0],
                    named.get("hint") ?? named.get("title"), false); break;
            case "a": {
                const href = named.get("href") ?? positional[0];
                const isUrl = !!href && /^(https?|mailto):/i.test(href);
                this.openLink("a", href, named.get("hint") ?? named.get("title"), isUrl);
                break;
            }
            case "v": case "var":
                this.openVar(named.get("name") ?? positional[0] ?? ""); break;
            case "br":
                this.appendText("\n"); break;
            case "sbr":
                this.appendText(" "); break;
            case "support":
                this.opts.send(`${MXP_SECURE_REPLY_PREFIX}<SUPPORTS ${SUPPORTED_TAGS.join(" ")}>`); break;
            case "version":
                this.opts.send(`${MXP_SECURE_REPLY_PREFIX}<VERSION MXP="1.0" CLIENT="mudix" VERSION="${CLIENT_VERSION}">`); break;
            default:
                // Structural no-ops (p, nobr, hr) and discarded heavy tags (image,
                // frame, gauge, dest, …): consume the tag, render nothing for it.
                // Any enclosed text still renders since the close handler ignores
                // unmatched closing tags.
                break;
        }
    }

    private openFormat(name: string, mutate: () => void): void {
        const before = this.fmt.toSnapshot();
        this.flushRun();
        mutate();
        this.stack.push({ name, closeFmt: before });
    }

    private openColor(name: string, fore?: string, back?: string): void {
        const before = this.fmt.toSnapshot();
        this.flushRun();
        // Layer this element's colours over the current override (inheriting the
        // parent's where this tag omits one), rather than writing into the ANSI
        // pen — so embedded ANSI SGR can't repaint the span. Always push a
        // matching entry so the close in finalizeTag stays balanced, mirroring
        // Mudlet's pushColor/popColor pairing for every COLOR/FONT tag.
        const top = this.mxpColorStack[this.mxpColorStack.length - 1];
        const fg = (fore ? mxpColor(fore) : null) ?? top?.fg ?? null;
        const bg = (back ? mxpColor(back) : null) ?? top?.bg ?? null;
        this.mxpColorStack.push({ fg, bg });
        this.stack.push({ name, closeFmt: before, colorOverride: true });
    }

    private openLink(name: string, href: string | undefined, hint: string | undefined, isUrl: boolean): void {
        const before = this.fmt.toSnapshot();
        this.flushRun();
        // Visual cue: underline the link text. Colour is left to whatever the
        // server set so server-coloured links keep their colour; the engine adds
        // the pointer cursor + click handler.
        this.fmt.underline = true;
        this.stack.push({ name, closeFmt: before, link: { start: this.plain.length, href, hint, isUrl } });
    }

    private openVar(varName: string): void {
        this.stack.push({ name: "v", closeFmt: this.fmt.toSnapshot(), varName, varStart: this.plain.length });
    }

    private handleCloseTag(name: string): void {
        for (let k = this.stack.length - 1; k >= 0; k--) {
            if (this.stack[k].name === name) {
                this.flushRun();
                // Lenient nesting: finalize this tag and any unclosed tags above it.
                for (let m = this.stack.length - 1; m >= k; m--) this.finalizeTag(this.stack[m]);
                const restore = this.stack[k].closeFmt;
                this.stack.length = k;
                this.fmt = new FormatState(restore);
                return;
            }
        }
        // Stray closing tag with no matching open — ignore.
    }

    private finalizeTag(tag: OpenTag): void {
        if (tag.colorOverride && this.mxpColorStack.length > 0) this.mxpColorStack.pop();
        if (tag.link) {
            const end = this.plain.length;
            const text = this.plain.slice(tag.link.start, end);
            let payload = tag.link.href;
            if (payload === undefined || payload === "") payload = text;
            else payload = payload.replace(/&text;/gi, text);
            if (payload && end > tag.link.start) {
                const cmds = payload.split("|").map(c => c.trim()).filter(c => c.length > 0);
                const hintParts = tag.link.hint !== undefined ? tag.link.hint.split("|") : [];
                if (cmds.length > 1) {
                    this.links.push({
                        start: tag.link.start, end,
                        kind: tag.link.isUrl ? "url" : "command",
                        payload: cmds[0],
                        hint: hintParts[0] ?? text,
                        prompts: { cmds, hints: hintParts.slice(1) },
                    });
                } else {
                    this.links.push({
                        start: tag.link.start, end,
                        kind: tag.link.isUrl ? "url" : "command",
                        payload: cmds[0] ?? text,
                        hint: hintParts[0] ?? tag.link.hint,
                    });
                }
            }
        }
        if (tag.varName !== undefined && tag.varName !== "") {
            this.entities.set(tag.varName, this.plain.slice(tag.varStart ?? this.plain.length, this.plain.length));
        }
    }

    // ---- definitions ----

    private handleDefinition(raw: string): void {
        const body = raw.slice(1); // drop leading '!'
        const km = /^\s*([A-Za-z]+)/.exec(body);
        if (!km) return;
        const keyword = km[1].toUpperCase();
        const rest = body.slice(km[0].length);
        if (keyword === "ELEMENT" || keyword === "EL") this.defineElement(rest);
        else if (keyword === "ENTITY" || keyword === "EN") this.defineEntity(rest);
        // ATTLIST and others are accepted but ignored.
    }

    private defineElement(rest: string): void {
        const toks = tokenizeAttrs(rest);
        if (toks.length === 0) return;
        const name = toks[0].value.toLowerCase();
        if (!name) return;
        let template = "";
        let templateSeen = false;
        const atts: string[] = [];
        const attDefaults: Record<string, string> = {};
        let flag: string | undefined;
        let open = false, empty = false, del = false;
        for (let k = 1; k < toks.length; k++) {
            const t = toks[k];
            if (t.key !== undefined) {
                const key = t.key.toLowerCase();
                if (key === "att") {
                    for (const a of t.value.split(/\s+/).filter(Boolean)) {
                        const eq = a.indexOf("=");
                        if (eq >= 0) {
                            const an = a.slice(0, eq).toLowerCase();
                            atts.push(an);
                            attDefaults[an] = a.slice(eq + 1);
                        } else {
                            atts.push(a.toLowerCase());
                        }
                    }
                } else if (key === "flag") {
                    flag = t.value;
                }
                // tag=, etc. ignored
            } else {
                const up = t.value.toUpperCase();
                if (up === "OPEN") open = true;
                else if (up === "EMPTY") empty = true;
                else if (up === "DELETE") del = true;
                else if (!templateSeen) { template = t.value; templateSeen = true; }
            }
        }
        if (del) { this.elements.delete(name); return; }
        this.elements.set(name, { name, template, atts, attDefaults, flag, open, empty });
    }

    private defineEntity(rest: string): void {
        const toks = tokenizeAttrs(rest);
        if (toks.length === 0) return;
        const name = toks[0].value;
        if (!name) return;
        let del = false;
        let value = "";
        let valueSeen = false;
        for (let k = 1; k < toks.length; k++) {
            const t = toks[k];
            if (t.key !== undefined) continue;
            const up = t.value.toUpperCase();
            if (up === "DELETE") del = true;
            else if (up === "PRIVATE" || up === "PUBLISH" || up === "ADD" || up === "REMOVE") continue;
            else if (!valueSeen) { value = t.value; valueSeen = true; }
        }
        if (del) { this.entities.delete(name); return; }
        this.entities.set(name, value);
    }

    private expandElement(def: ElementDef, attrStr: string, depth: number): void {
        if (depth >= MAX_DEPTH) return;
        const { named, positional } = parseAttrs(attrStr);
        const before = this.fmt.toSnapshot();
        this.flushRun();
        // Push the close marker *below* the tags the template will open, so
        // `</name>` reverts everything the definition introduced.
        if (!def.empty) this.stack.push({ name: def.name, closeFmt: before });
        this.parseFragment(this.substituteTemplate(def, named, positional), depth + 1);
    }

    private substituteTemplate(def: ElementDef, named: Map<string, string>, positional: string[]): string {
        const vals: Record<string, string> = { ...def.attDefaults };
        def.atts.forEach((an, idx) => { if (positional[idx] !== undefined) vals[an] = positional[idx]; });
        for (const [k, v] of named) vals[k.toLowerCase()] = v;
        return def.template.replace(/&(\w+);/g, (m, an: string) => {
            const key = an.toLowerCase();
            return key in vals ? vals[key] : m; // leave real entities (e.g. &lt;) intact
        });
    }

    // ---- entities ----

    private decodeEntity(ent: string): string | null {
        if (ent.length === 0) return null;
        if (ent[0] === "#") {
            const num = ent[1] === "x" || ent[1] === "X"
                ? parseInt(ent.slice(2), 16)
                : parseInt(ent.slice(1), 10);
            if (Number.isFinite(num) && num >= 0 && num <= 0x10ffff) {
                try { return String.fromCodePoint(num); } catch { return null; }
            }
            return null;
        }
        const lc = ent.toLowerCase();
        if (lc in BUILTIN_ENTITIES) return BUILTIN_ENTITIES[lc];
        if (this.entities.has(ent)) return this.entities.get(ent)!;
        if (this.entities.has(lc)) return this.entities.get(lc)!;
        return null;
    }
}

/** Split a parsed MXP line into one entry per *visual* line. MXP `<BR>` tags
 *  become embedded `\n`s in the parser's plain text and segments — Discworld
 *  sends a whole room (description, exits, contents, prompt) as a single network
 *  line delimited by `<BR>` — but a render path that emits one line per result
 *  would collapse them all together. So we split the segments at every `\n`,
 *  re-slicing each segment's text and remapping each link's `plain`-offset range
 *  into the subline it falls on. The `\n` separators are dropped (each subline
 *  renders on its own). The fast path (no embedded newline) returns the result
 *  untouched, sharing the original arrays. */
export function splitMxpResultLines(
    r: MxpLineResult,
): { plain: string; segments: BufferSegment[]; links: MxpLink[] }[] {
    if (r.plain.indexOf("\n") === -1) {
        return [{ plain: r.plain, segments: r.segments, links: r.links }];
    }

    const out: { plain: string; segments: BufferSegment[]; links: MxpLink[] }[] = [];
    // Plain-text range [start, end) each subline occupies in the full r.plain,
    // used to remap link offsets afterwards.
    const ranges: { start: number; end: number }[] = [];
    let segs: BufferSegment[] = [];
    let plain = "";
    let base = 0;

    const closeLine = () => {
        ranges.push({ start: base, end: base + plain.length });
        out.push({ plain, segments: segs, links: [] });
        base += plain.length + 1; // +1 for the dropped '\n' separator
        segs = [];
        plain = "";
    };

    for (const seg of r.segments) {
        const pieces = seg.text.split("\n");
        for (let p = 0; p < pieces.length; p++) {
            if (p > 0) closeLine();
            if (pieces[p].length > 0) {
                segs.push({ text: pieces[p], state: seg.state });
                plain += pieces[p];
            }
        }
    }
    closeLine();

    for (const link of r.links) {
        for (let k = 0; k < ranges.length; k++) {
            const { start, end } = ranges[k];
            if (link.start >= start && link.start < end) {
                const remStart = link.start - start;
                const remEnd = Math.min(link.end, end) - start;
                if (remEnd > remStart) out[k].links.push({ ...link, start: remStart, end: remEnd });
                break;
            }
        }
    }
    return out;
}

// ---- module-local helpers ----

/** Find the `>` that closes the tag starting at `start` (the `<`), skipping any
 *  `>` that sits inside a quoted attribute value. Returns -1 if unterminated.
 *  Essential for definitions like `<!ELEMENT x "<COLOR red>" …>` whose template
 *  contains a literal `>`. */
function findTagEnd(text: string, start: number): number {
    let quote = "";
    for (let j = start + 1; j < text.length; j++) {
        const c = text[j];
        if (quote) {
            if (c === quote) quote = "";
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === ">") {
            return j;
        }
    }
    return -1;
}

function parseSgrParams(s: string): number[] {
    if (s === "") return [0];
    return s.split(";").map(p => {
        const n = parseInt(p, 10);
        return Number.isFinite(n) ? n : 0;
    });
}

function firstWhitespace(s: string): number {
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === " " || c === "\t" || c === "\n" || c === "\r") return i;
    }
    return -1;
}

interface AttrToken { key?: string; value: string; }

/** Read a `"…"` / `'…'` run starting at the opening quote `at`. Returns the
 *  inner text and the index just past the closing quote (or end of string). */
function readQuoted(s: string, at: number): { value: string; next: number } {
    const q = s[at];
    let j = at + 1;
    const vstart = j;
    while (j < s.length && s[j] !== q) j++;
    const value = s.slice(vstart, j);
    return { value, next: j < s.length ? j + 1 : j };
}

/** Tokenize a tag's attribute string into ordered `{key?, value}` tokens.
 *  Handles `key=value`, `key="quoted"`, `key='quoted'`, bare `value`, and
 *  quoted positional `"value"`. No escape processing inside quotes (MXP has none). */
function tokenizeAttrs(s: string): AttrToken[] {
    const out: AttrToken[] = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
        while (i < n && isSpace(s[i])) i++;
        if (i >= n) break;

        if (s[i] === '"' || s[i] === "'") {
            const { value, next } = readQuoted(s, i);
            out.push({ value });
            i = next;
            continue;
        }

        const start = i;
        while (i < n && !isSpace(s[i]) && s[i] !== "=" && s[i] !== '"' && s[i] !== "'") i++;
        const word = s.slice(start, i);

        if (i < n && s[i] === "=") {
            i++; // skip '='
            let value: string;
            if (i < n && (s[i] === '"' || s[i] === "'")) {
                const q = readQuoted(s, i);
                value = q.value;
                i = q.next;
            } else {
                const vstart = i;
                while (i < n && !isSpace(s[i])) i++;
                value = s.slice(vstart, i);
            }
            out.push({ key: word, value });
        } else {
            out.push({ value: word });
        }
    }
    return out;
}

function isSpace(c: string): boolean {
    return c === " " || c === "\t" || c === "\n" || c === "\r";
}

/** Split a tag's attribute string into named and positional values. */
function parseAttrs(attrStr: string): { named: Map<string, string>; positional: string[] } {
    const named = new Map<string, string>();
    const positional: string[] = [];
    for (const t of tokenizeAttrs(attrStr)) {
        if (t.key !== undefined) named.set(t.key.toLowerCase(), t.value);
        else positional.push(t.value);
    }
    return { named, positional };
}
