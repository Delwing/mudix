import { ECHO_DO, ECHO_DONT } from "./constants";

const IAC = 0xFF, SB = 0xFA, SE = 0xF0;
const WILL = 0xFB, WONT = 0xFC, DO = 0xFD, DONT = 0xFE;
const ECHO_OPT = 0x01;

/** How long the raw ECHO state must hold before we ack it on the wire and
 *  treat it as a real password transition. Servers like Legend of Kallisti
 *  bracket every line with `IAC WILL ECHO … IAC WONT ECHO` for server-side
 *  line editing, and crucially they bounce on our acks — replying to a `DO`
 *  with another `WILL`, to a `DONT` with another `WONT` — which produces
 *  a self-sustaining negotiation loop several times per second. Real
 *  password prompts sit in `WILL ECHO` for the entire time the user is
 *  typing, so half a second of debounce is invisible to the legitimate case
 *  but long enough to absorb the Kallisti bracket (~250 ms per flip). */
const STABLE_MS = 500;

/** Mudlet-parity anomaly detection (cTelnet::checkEchoAnomalyPattern):
 *  if the raw ECHO state toggles ≥ ANOMALY_THRESHOLD times within
 *  ANOMALY_WINDOW_MS we conclude the server is misusing ECHO for
 *  per-line edit signalling and definitively refuse the option for the rest
 *  of the session by sending `IAC DONT ECHO` and ignoring further flips. */
const ANOMALY_THRESHOLD = 5;
const ANOMALY_WINDOW_MS = 5000;

/** Mudlet-parity safety net for servers that send `IAC WILL ECHO` for the
 *  password prompt but never follow up with `IAC WONT ECHO` after the user
 *  authenticates (network drop / server bug). We arm a one-shot timeout
 *  when password mode commits, but only during the first LOGIN_PHASE_MS of
 *  the connection so legitimate later password prompts (e.g. an admin
 *  command) aren't disturbed. The timer is cancelled when WONT arrives. */
const LOGIN_PHASE_MS = 5 * 60 * 1000;
const PASSWORD_TIMEOUT_MS = 60 * 1000;

export class EchoHandler {
    /** Committed (debounced) state exposed to UI / send-echo logic. True
     *  whenever the server is echoing for us, which means we must suppress our
     *  own local command echo to avoid showing every line twice. This is *not*
     *  the same as password masking — see `_passwordStyle` / `passwordMode`. */
    private _serverEchoing = false;
    /** Latest raw on-the-wire state. Used to gate ack dedup and decide whether
     *  to schedule a commit. */
    private _rawEchoing = false;
    /** Whether the *current* ECHO engagement should mask the input line. A
     *  server that enables ECHO during the opening negotiation burst — before
     *  it has printed any output — is doing session-wide remote echo (it will
     *  echo your name, commands, everything), not requesting a password. The
     *  classic Diku/ROM password pattern instead toggles `IAC WILL ECHO` on
     *  *after* the name prompt, right before "Password:". So we only treat an
     *  ECHO that engages after the server has already sent output as a password
     *  prompt. Captured at each OFF→ON transition. Mudlet masks on every ECHO;
     *  doing so here would hide the name on full-server-echo MUDs, which is the
     *  bug this distinction fixes. */
    private _passwordStyle = false;
    /** Set once the server has emitted any non-telnet output. Distinguishes a
     *  connect-time (server-wide) ECHO from a later (password) ECHO. */
    private sawAppData = false;
    private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
    private passwordSafetyTimer: ReturnType<typeof setTimeout> | null = null;
    private connectionStartAt = 0;
    private toggleCount = 0;
    private lastToggleAt = 0;
    private _anomalyDetected = false;
    private readonly sendRaw: (data: string) => void;
    private readonly onEchoChange: (maskInput: boolean) => void;
    private readonly onAnomalyDetected: (() => void) | undefined;

    constructor(
        sendRaw: (data: string) => void,
        onEchoChange: (maskInput: boolean) => void,
        onAnomalyDetected?: () => void,
    ) {
        this.sendRaw = sendRaw;
        this.onEchoChange = onEchoChange;
        this.onAnomalyDetected = onAnomalyDetected;
    }

    get serverEchoing(): boolean {
        return this._serverEchoing;
    }

    /** Whether the command input should be masked (password mode). Only true
     *  for an ECHO engagement that began after the server started sending
     *  output — a genuine password prompt — never for connect-time server-wide
     *  echo. */
    get passwordMode(): boolean {
        return this._serverEchoing && this._passwordStyle;
    }

    get anomalyDetected(): boolean {
        return this._anomalyDetected;
    }

    /** Scan the post-MCCP byte stream for true `IAC WILL/WONT ECHO`. Substring
     *  matching on the raw buffer is unsafe — GMCP/MSDP subnegotiation payloads
     *  can contain the same byte sequence (e.g. an unescaped IAC followed by
     *  MSDP_VAR=\x01), which would spuriously flip password mode every prompt
     *  on data-heavy servers like Legend of Kallisti. Walk the stream as
     *  telnet: skip SB…SE blocks entirely, honor IAC IAC escapes, and only act
     *  on top-level IAC WILL/WONT ECHO. */
    processData(data: string): void {
        let i = 0;
        while (i < data.length) {
            // Any byte outside a telnet command is server output. Seeing it
            // before an ECHO request is what tells a connect-time server-wide
            // echo apart from a mid-session password prompt.
            if (data.charCodeAt(i) !== IAC) { this.sawAppData = true; i++; continue; }
            const cmd = data.charCodeAt(i + 1);
            if (cmd === IAC) { i += 2; continue; }
            if (cmd === SB) {
                const end = findSubnegEnd(data, i + 2);
                i = end < 0 ? data.length : end + 2;
                continue;
            }
            if (cmd === WILL || cmd === WONT || cmd === DO || cmd === DONT) {
                if (data.charCodeAt(i + 2) === ECHO_OPT) {
                    if (cmd === WILL) this.setEchoing(true);
                    else if (cmd === WONT) this.setEchoing(false);
                }
                i += 3;
                continue;
            }
            i += 2;
        }
    }

    private setEchoing(on: boolean): void {
        // Anomaly is sticky for the session — once we've refused ECHO we don't
        // re-engage no matter what the server sends.
        if (this._anomalyDetected) return;
        if (on === this._rawEchoing) return;
        this._rawEchoing = on;
        // Latch whether this engagement masks: a password prompt only if the
        // server had already printed output by the time it asked us to echo.
        if (on) this._passwordStyle = this.sawAppData;
        if (this.trackToggleAndDetectAnomaly()) return;
        // Raw state matches committed state again. Two cases collapse here:
        //   (a) committed=OFF, raw was briefly ON, now OFF — transient flap
        //       during initial connect; just cancel the pending ON commit.
        //   (b) committed=ON, raw was briefly OFF (pending OFF commit), now
        //       ON again — Kallisti-style line-edit pattern: server sent WONT
        //       (release echo) then immediately WILL (re-assert) within the
        //       debounce window. Treat as ECHO abuse and trip anomaly to
        //       refuse further engagement for the rest of the session,
        //       otherwise we'd silently swallow every "exit password mode"
        //       signal the server gives us.
        if (this._rawEchoing === this._serverEchoing) {
            if (this._serverEchoing && this.stabilityTimer) {
                this.tripAnomaly();
                return;
            }
            if (this.stabilityTimer) {
                clearTimeout(this.stabilityTimer);
                this.stabilityTimer = null;
            }
            return;
        }
        // Raw differs from committed. (Re)start the stability timer; only when
        // it fires without another flip do we ack the wire negotiation and
        // expose the change to the UI. Acking on every raw flip would drive
        // a bounce loop with servers that re-emit WILL/WONT in response to
        // our DO/DONT (see STABLE_MS comment).
        if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
        this.stabilityTimer = setTimeout(() => {
            this.stabilityTimer = null;
            if (this._rawEchoing === this._serverEchoing) return;
            this._serverEchoing = this._rawEchoing;
            this.sendRaw(this._serverEchoing ? ECHO_DO : ECHO_DONT);
            this.onEchoChange(this.passwordMode);
            this.updatePasswordSafetyTimer();
            if (debugEchoEnabled()) {
                const mode = !this._serverEchoing ? 'OFF (normal)'
                    : this.passwordMode ? 'ON (password mode)'
                    : 'ON (server-wide echo, input not masked)';
                console.debug(`[mudix.echo] committed → ${mode}`);
            }
        }, STABLE_MS);
    }

    /** Arm / disarm the Mudlet-style "password mode never ended" safety
     *  timeout. Called right after a committed state change. */
    private updatePasswordSafetyTimer(): void {
        if (this.passwordSafetyTimer) {
            clearTimeout(this.passwordSafetyTimer);
            this.passwordSafetyTimer = null;
        }
        // Only password masking needs the "server never sent WONT" safety net.
        // Session-wide echo legitimately stays on for the whole connection, so
        // forcing it off after a timeout would re-enable local echo and double
        // every line.
        if (!this.passwordMode) return;
        if (this.connectionStartAt === 0) return;
        if (Date.now() - this.connectionStartAt >= LOGIN_PHASE_MS) return;
        this.passwordSafetyTimer = setTimeout(() => {
            this.passwordSafetyTimer = null;
            if (!this._serverEchoing) return;
            this._serverEchoing = false;
            this._rawEchoing = false;
            this.sendRaw(ECHO_DONT);
            this.onEchoChange(false);
            if (debugEchoEnabled()) {
                console.warn(`[mudix.echo] password-mode safety timeout (${PASSWORD_TIMEOUT_MS}ms) — server never sent WONT ECHO, forcing OFF`);
            }
        }, PASSWORD_TIMEOUT_MS);
    }

    /** Mirror cTelnet::checkEchoAnomalyPattern. Increments a sliding-window
     *  toggle counter on every raw flip and, when the threshold is crossed,
     *  trips sticky anomaly state. Returns true when anomaly was tripped on
     *  this call (the caller should bail out). */
    private trackToggleAndDetectAnomaly(): boolean {
        const now = Date.now();
        if (this.lastToggleAt > 0 && now - this.lastToggleAt < ANOMALY_WINDOW_MS) {
            this.toggleCount++;
        } else {
            this.toggleCount = 1;
        }
        this.lastToggleAt = now;
        if (this.toggleCount < ANOMALY_THRESHOLD) return false;
        this.tripAnomaly();
        return true;
    }

    /** Refuse ECHO for the rest of the session: send `IAC DONT ECHO`, drop any
     *  pending commit / safety timers, force the UI back to normal, and notify
     *  the engine so a `sysEchoAnomalyDetected` Lua event can fire. */
    private tripAnomaly(): void {
        this._anomalyDetected = true;
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
        }
        if (this.passwordSafetyTimer) {
            clearTimeout(this.passwordSafetyTimer);
            this.passwordSafetyTimer = null;
        }
        this.sendRaw(ECHO_DONT);
        if (this._serverEchoing) {
            this._serverEchoing = false;
            this.onEchoChange(false);
        }
        this.onAnomalyDetected?.();
        if (debugEchoEnabled()) {
            console.warn(`[mudix.echo] anomaly detected — refusing ECHO for the session`);
        }
    }

    reset(): void {
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
        }
        if (this.passwordSafetyTimer) {
            clearTimeout(this.passwordSafetyTimer);
            this.passwordSafetyTimer = null;
        }
        this._rawEchoing = false;
        this._passwordStyle = false;
        this.sawAppData = false;
        this.toggleCount = 0;
        this.lastToggleAt = 0;
        this._anomalyDetected = false;
        this.connectionStartAt = Date.now();
        if (this._serverEchoing) {
            this._serverEchoing = false;
            this.onEchoChange(false);
        }
    }
}

function debugEchoEnabled(): boolean {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('mudix.debugEcho') === '1';
    } catch {
        return false;
    }
}

/** Find the offset of `IAC SE` (the end-of-subneg) at-or-after `from`. Skips
 *  embedded `IAC IAC` (escaped data IAC). Returns the index of the `IAC` byte
 *  of the closing pair, or -1 if the subneg is incomplete in this chunk. */
function findSubnegEnd(data: string, from: number): number {
    for (let i = from; i < data.length - 1; i++) {
        if (data.charCodeAt(i) !== IAC) continue;
        const next = data.charCodeAt(i + 1);
        if (next === IAC) { i++; continue; }
        if (next === SE) return i;
    }
    return -1;
}
