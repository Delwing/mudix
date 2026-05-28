import type { AnsiAwareBuffer } from './text/FormatState';
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
    'socket.incoming': [data: string];
    'socket.outgoing': [data: string];
    'message': [text?: string | AnsiAwareBuffer, type?: string, timestamp?: number];
    'flushLines': [groups: { text: string; type: string }[]];
    'gmcp': [payload: { path: string; value: unknown }];
    'msdp': [payload: { path: string; value: unknown }];
    'gmcp.core.ping': [value: unknown];
    'telnet.echo': [serverEchoing: boolean];
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
