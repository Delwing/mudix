import { ECHO_DO, ECHO_DONT, ECHO_WILL, ECHO_WONT } from "./constants";

export class EchoHandler {
    private _serverEchoing = false;
    private readonly sendRaw: (data: string) => void;
    private readonly onEchoChange: (serverEchoing: boolean) => void;

    constructor(sendRaw: (data: string) => void, onEchoChange: (serverEchoing: boolean) => void) {
        this.sendRaw = sendRaw;
        this.onEchoChange = onEchoChange;
    }

    get serverEchoing(): boolean {
        return this._serverEchoing;
    }

    processData(data: string): void {
        if (data.includes(ECHO_WILL) && !this._serverEchoing) {
            this.sendRaw(ECHO_DO);
            this._serverEchoing = true;
            this.onEchoChange(true);
        }
        if (data.includes(ECHO_WONT) && this._serverEchoing) {
            this.sendRaw(ECHO_DONT);
            this._serverEchoing = false;
            this.onEchoChange(false);
        }
    }

    reset(): void {
        if (this._serverEchoing) {
            this._serverEchoing = false;
            this.onEchoChange(false);
        }
    }
}
