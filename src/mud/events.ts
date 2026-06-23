import type { AnsiAwareBuffer } from './text/FormatState';
import type { MspCommand } from './protocol';
import type { ScriptLogSource } from './MudSession';

export type SessionStatus = 'disconnected' | 'connecting' | 'connected';

export type MudClientEvents = {
    'open': [event: Event];
    'close': [event: CloseEvent];
    'error': [error: unknown];
    'client.connect': void;
    'client.disconnect': void;
    'client.error': [message: string];
    'gmcp.negotiated': void;
    'msdp.negotiated': void;
    'mssp.negotiated': void;
    'msp.negotiated': void;
    /** Fires when MNES / NEW-ENVIRON (telnet option 39) negotiation starts —
     *  the server sent IAC DO NEW-ENVIRON and the client agreed (IAC WILL). The
     *  client then answers the server's SEND request with its CHARSET /
     *  CLIENT_NAME / CLIENT_VERSION / MTTS / TERMINAL_TYPE variables. */
    'mnes.negotiated': void;
    /** Fires when NAWS (telnet option 31) negotiation completes — the client
     *  offered IAC WILL NAWS and the server replied IAC DO NAWS. From then on
     *  the client reports the main output area's character grid (columns × rows)
     *  and re-sends it whenever the window resizes. */
    'naws.negotiated': void;
    /** Fires when MXP (telnet option 91) starts for the session. The scripting
     *  engine flips its `mxpActive` flag on this so in-band MXP markup starts
     *  being parsed, and mirrors Mudlet's `sysProtocolEnabled('MXP')`.
     *  `viaTelnet` is true when started by a real option-91 handshake (server
     *  WILL/DO MXP) and false when inferred from in-band `ESC[<n>z` line modes
     *  on a server that skipped negotiation. Only telnet-negotiated MXP gets the
     *  `<SUPPORTS>`/`<VERSION>` handshake replies — an in-band-only server's
     *  inbound MXP channel isn't confirmed, so replying would spam it with
     *  invalid commands. */
    'mxp.negotiated': [viaTelnet: boolean];
    /** Fired for every `!!SOUND` / `!!MUSIC` tag parsed from the in-band text
     *  stream (or an `IAC SB MSP ... IAC SE` subnegotiation body). The
     *  scripting engine wires this to the SoundManager. */
    'msp': [command: MspCommand];
    /** Fires when a CHARSET (RFC 2066) negotiation completes — either the
     *  server's REQUEST was ACCEPTED or our advertised REQUEST was ACCEPTED.
     *  Argument is the IANA charset name as agreed (the wire spelling, e.g.
     *  "UTF-8"). */
    'charset.negotiated': [encoding: string];
    'socket.incoming': [data: string];
    'socket.outgoing': [data: string];
    'message': [text?: string | AnsiAwareBuffer, type?: string, timestamp?: number, isPrompt?: boolean];
    'flushLines': [groups: { text: string; type: string }[]];
    'gmcp': [payload: { path: string; value: unknown }];
    'msdp': [payload: { path: string; value: unknown }];
    'mssp': [payload: { name: string; value: string }];
    'gmcp.core.ping': [value: unknown];
    /** Fires when the server requests GMCP login (Char.Login.Default). The
     *  argument is the list of supported authentication methods it advertised
     *  (e.g. `["password-credentials"]`). The UI shows a credentials popup and
     *  replies via `sendCharLoginCredentials` — or an empty reply (cancel) to
     *  fall back to the server's text login prompt. */
    'charLogin.request': [methods: string[]];
    /** Fires when the server reports a GMCP login outcome (Char.Login.Result).
     *  `success` is true on a successful authentication; on failure `message`
     *  carries the server's human-readable reason (e.g. "Invalid credentials"). */
    'charLogin.result': [result: { success: boolean; message?: string }];
    /** Fires when the command input should switch in/out of password masking.
     *  True only for a genuine password prompt (server enabled ECHO *after* it
     *  began sending output); a connect-time server-wide ECHO suppresses local
     *  echo without masking, so it does not raise this with `true`. */
    'telnet.echo': [maskInput: boolean];
    /** Mirror of Mudlet's `sysEchoAnomalyDetected`. Fires once per session when
     *  the server toggles `IAC WILL/WONT ECHO` ≥5 times within 5 s; at that
     *  point the client sends `IAC DONT ECHO` and refuses any further ECHO
     *  negotiation for the rest of the connection. */
    'telnet.echo.anomaly': void;
    /** Mudlet `sysTelnetEvent(type, option, message)` — fired for telnet
     *  IAC commands the client doesn't natively recognise (everything other
     *  than the hardcoded GMCP/MSDP/TTYPE/MCCP/ECHO negotiations). */
    'telnet.event': [type: number, option: number, message: string];
} & Record<string, any>;

export type MudEvents = MudClientEvents & {
    'status': [status: SessionStatus];
    'ping': [duration: number | null];
    'script.log': [text: string, level: 'error' | 'info', source?: ScriptLogSource];
    'output.ready': void;
    'script.deleteline': void;
    'script.clearwindow': void;
    'script.appendcmd': [text: string];
    'script.setcmd': [text: string];
    'script.clearcmd': void;
    'script.selectcmd': void;
    'script.cmdlinesuggestions': [items: string[]];
    'script.openvfs': [path: string];
    'prompt': void;
    'script.movecursorup': void;
    'script.movecursordown': void;
};
