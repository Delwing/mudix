import { useEffect, useRef } from 'react';
import type { MudSession } from '../mud/MudSession';
import { AliasEngine } from '../mud/aliases/AliasEngine';
import { TriggerEngine } from '../mud/triggers/TriggerEngine';
import { TimerEngine } from '../mud/timers/TimerEngine';
import { KeyEngine } from '../mud/keybindings/KeyEngine';
import { ScriptingEngine } from '../scripting/ScriptingEngine';

/** Creates and tears down all scripting engines tied to a session lifetime. */
export function useEngines(session: MudSession, active: boolean) {
    const aliasEngineRef = useRef<AliasEngine | null>(null);
    const triggerEngineRef = useRef<TriggerEngine | null>(null);
    const timerEngineRef = useRef<TimerEngine | null>(null);
    const keyEngineRef = useRef<KeyEngine | null>(null);
    const engineRef = useRef<ScriptingEngine | null>(null);

    useEffect(() => {
        if (!active) return;
        const alias = new AliasEngine();
        const trigger = new TriggerEngine();
        const timer = new TimerEngine();
        const key = new KeyEngine();
        const engine = new ScriptingEngine(session, alias, trigger, timer, key);
        aliasEngineRef.current = alias;
        triggerEngineRef.current = trigger;
        timerEngineRef.current = timer;
        keyEngineRef.current = key;
        engineRef.current = engine;
        return () => {
            engine.destroy();
            alias.destroy();
            trigger.destroy();
            timer.destroy();
            key.destroy();
            aliasEngineRef.current = null;
            triggerEngineRef.current = null;
            timerEngineRef.current = null;
            keyEngineRef.current = null;
            engineRef.current = null;
        };
    }, [session, active]);

    return { aliasEngineRef, triggerEngineRef, timerEngineRef, keyEngineRef, engineRef };
}
