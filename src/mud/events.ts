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
    'msp.negotiated': void;
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
    'message': [text?: string | AnsiAwareBuffer, type?: string, timestamp?: number];
    'flushLines': [groups: { text: string; type: string }[]];
    'gmcp': [payload: { path: string; value: unknown }];
    'msdp': [payload: { path: string; value: unknown }];
    'gmcp.core.ping': [value: unknown];
    'telnet.echo': [serverEchoing: boolean];
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
