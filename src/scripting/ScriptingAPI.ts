import type { MudSession } from '../mud/MudSession';

export class ScriptingAPI {
    constructor(private readonly session: MudSession) {}

    connect(url: string): void {
        this.session.connect(url);
    }

    disconnect(): void {
        this.session.disconnect();
    }

    send(text: string): void {
        this.session.send(text);
    }

    print(text: string): void {
        this.session.events.emit('message', text, 'script');
    }
}
