import { useEffect, useRef, useState, useCallback } from 'react';
import { MudSession, type SessionStatus, type MudSessionOptions } from '../mud/MudSession';

export function useMudSession(options?: MudSessionOptions) {
    const sessionRef = useRef<MudSession | null>(null);
    if (!sessionRef.current) {
        sessionRef.current = new MudSession(options);
    }
    const session = sessionRef.current;

    const [status, setStatus] = useState<SessionStatus>('disconnected');
    const [ping, setPing] = useState<number | null>(null);

    useEffect(() => {
        const offStatus = session.events.on('status', setStatus);
        const offPing = session.events.on('ping', setPing);
        return () => { offStatus(); offPing(); };
    }, [session]);

    const connect = useCallback((url: string) => session.connect(url), [session]);
    const disconnect = useCallback(() => session.disconnect(), [session]);
    const send = useCallback((text: string) => session.send(text), [session]);

    return { session, status, ping, connect, disconnect, send };
}
