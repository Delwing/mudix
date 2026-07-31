import { describe, it, expect } from 'vitest';
import {
    applyMsspVariable,
    emptyMsspTlsFacts,
    isIpAddress,
    shouldOfferTlsUpgrade,
    type TlsOfferState,
} from '../../../src/mud/protocol/msspTls';

/** A state where the offer *should* fire; individual tests spoil one field. */
function baseState(over: Partial<TlsOfferState> = {}): TlsOfferState {
    return {
        facts: { tlsPort: 4443, hostName: '' },
        host: 'mud.example.org',
        port: 23,
        tlsEnabled: false,
        askTlsAvailable: true,
        promptInFlight: false,
        proxyMode: true,
        ...over,
    };
}

describe('MSSP TLS advertisement parsing', () => {
    it('reads a port from TLS and from SSL alike', () => {
        expect(applyMsspVariable(emptyMsspTlsFacts(), 'TLS', '4443').tlsPort).toBe(4443);
        expect(applyMsspVariable(emptyMsspTlsFacts(), 'SSL', '992').tlsPort).toBe(992);
    });

    it('is case-insensitive about the variable name', () => {
        expect(applyMsspVariable(emptyMsspTlsFacts(), 'tls', '4443').tlsPort).toBe(4443);
    });

    it('discards -1 and 1, which are supported/unsupported booleans not ports', () => {
        expect(applyMsspVariable(emptyMsspTlsFacts(), 'TLS', '-1').tlsPort).toBe(0);
        expect(applyMsspVariable(emptyMsspTlsFacts(), 'TLS', '1').tlsPort).toBe(0);
    });

    it('rejects junk and out-of-range ports', () => {
        for (const v of ['', 'yes', '0', '70000', '-5']) {
            expect(applyMsspVariable(emptyMsspTlsFacts(), 'TLS', v).tlsPort).toBe(0);
        }
    });

    it('captures HOSTNAME and ignores unrelated variables', () => {
        let f = emptyMsspTlsFacts();
        f = applyMsspVariable(f, 'HOSTNAME', 'mud.example.org');
        f = applyMsspVariable(f, 'PLAYERS', '42');
        f = applyMsspVariable(f, 'PORT', '23');
        expect(f).toEqual({ tlsPort: 0, hostName: 'mud.example.org' });
    });
});

describe('isIpAddress', () => {
    it('recognises IPv4', () => {
        expect(isIpAddress('192.168.1.10')).toBe(true);
        expect(isIpAddress('255.255.255.255')).toBe(true);
    });
    it('rejects out-of-range octets and hostnames', () => {
        expect(isIpAddress('999.1.1.1')).toBe(false);
        expect(isIpAddress('mud.example.org')).toBe(false);
        expect(isIpAddress('')).toBe(false);
    });
    it('recognises IPv6, bracketed or bare', () => {
        expect(isIpAddress('::1')).toBe(true);
        expect(isIpAddress('[2001:db8::1]')).toBe(true);
    });
});

describe('shouldOfferTlsUpgrade', () => {
    it('offers when a secure port is advertised on a plaintext proxy connection', () => {
        expect(shouldOfferTlsUpgrade(baseState())).toBe(true);
    });

    it('stays silent when no TLS port was advertised', () => {
        expect(shouldOfferTlsUpgrade(baseState({ facts: { tlsPort: 0, hostName: '' } }))).toBe(false);
    });

    it('stays silent when the connection is already encrypted', () => {
        expect(shouldOfferTlsUpgrade(baseState({ tlsEnabled: true }))).toBe(false);
    });

    it('honours a previous decline', () => {
        expect(shouldOfferTlsUpgrade(baseState({ askTlsAvailable: false }))).toBe(false);
    });

    it('does not stack a second prompt while one is open', () => {
        expect(shouldOfferTlsUpgrade(baseState({ promptInFlight: true }))).toBe(false);
    });

    it('stays silent when already connected on the advertised port', () => {
        expect(shouldOfferTlsUpgrade(baseState({ port: 4443 }))).toBe(false);
    });

    it('stays silent for a bare IP, which a certificate will not match', () => {
        expect(shouldOfferTlsUpgrade(baseState({ host: '10.0.0.5' }))).toBe(false);
    });

    it('stays silent when MSSP HOSTNAME names a different host', () => {
        const facts = { tlsPort: 4443, hostName: 'other.example.net' };
        expect(shouldOfferTlsUpgrade(baseState({ facts }))).toBe(false);
    });

    it('accepts a HOSTNAME that matches apart from case', () => {
        const facts = { tlsPort: 4443, hostName: 'MUD.Example.ORG' };
        expect(shouldOfferTlsUpgrade(baseState({ facts }))).toBe(true);
    });

    it('stays silent in websocket mode, where a raw TLS port is unreachable', () => {
        expect(shouldOfferTlsUpgrade(baseState({ proxyMode: false }))).toBe(false);
    });
});
