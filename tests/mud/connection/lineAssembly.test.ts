import { describe, it, expect } from 'vitest';
import { MudClient } from '../../../src/mud/connection/MudClient';
import { EventBus } from '../../../src/core/EventBus';
import { TELNET_GA } from '../../../src/mud/protocol/constants';
import type { MudClientEvents } from '../../../src/mud/events';

// Exercise MudClient's partial-line assembly directly via feedTelnet (which
// runs the same processIncomingData path as a real WebSocket frame) and collect
// the rendered lines off the `flushLines` event. No socket is opened.
function makeClient() {
    const bus = new EventBus<MudClientEvents>();
    const client = new MudClient({ url: 'ws://test.invalid' }, bus);
    const lines: string[] = [];
    bus.on('flushLines', (groups) => {
        for (const g of groups) lines.push(g.text);
    });
    // Latch GA-driver mode the way a real Discworld session does: the server
    // ends its first transmission with IAC GA.
    const latchGaDriver = () => client.feedTelnet('\r\n' + TELNET_GA);
    return { client, lines, latchGaDriver };
}

describe('MudClient line assembly', () => {
    it('joins a line split mid-word across two frames in GA-driver mode', () => {
        const { client, lines, latchGaDriver } = makeClient();
        latchGaDriver();
        lines.length = 0; // discard the empty priming flush

        // The frame boundary falls inside the word "Stren" — exactly the
        // Discworld bug report. Neither frame ends in a newline until the second.
        client.feedTelnet('This is the entrance area of the Mended Drum. Str');
        client.feedTelnet('en Withel, Hrun and the splatter are standing here.\r\n');

        expect(lines).toEqual([
            'This is the entrance area of the Mended Drum. Stren Withel, Hrun and the splatter are standing here.\n',
        ]);
    });

    it('joins a split line before GA latches (timeout-fallback path)', () => {
        const { client, lines } = makeClient();

        client.feedTelnet('first half of the ');
        client.feedTelnet('line completed here\r\n');

        expect(lines).toEqual(['first half of the line completed here\n']);
    });

    it('flushes a newline-less prompt as its own line when IAC GA arrives', () => {
        const { client, lines, latchGaDriver } = makeClient();
        latchGaDriver();
        lines.length = 0;

        // A Discworld prompt: text with no trailing newline, terminated by GA.
        client.feedTelnet('HP: 100 > ' + TELNET_GA);

        expect(lines).toEqual(['HP: 100 > ']);
    });

    it('does not split a complete multi-line frame', () => {
        const { client, lines, latchGaDriver } = makeClient();
        latchGaDriver();
        lines.length = 0;

        client.feedTelnet('line one\r\nline two\r\n');

        expect(lines).toEqual(['line one\nline two\n']);
    });
});
