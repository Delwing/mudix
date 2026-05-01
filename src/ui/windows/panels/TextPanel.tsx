import { useEffect, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { WindowManager } from '../WindowManager';

interface TextPanelParams {
    manager: WindowManager;
}

export function TextPanel(props: IDockviewPanelProps<TextPanelParams>) {
    const { manager } = props.params;
    const id = props.api.id;
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        manager.register(id, ref.current, 'text');
        return () => manager.unregister(id);
    }, [manager, id]);

    return <div ref={ref} className="window-text-panel" />;
}
