import { useEffect, useRef } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { WindowManager } from '../WindowManager';

interface HtmlPanelParams {
    manager: WindowManager;
}

export function HtmlPanel(props: IDockviewPanelProps<HtmlPanelParams>) {
    const { manager } = props.params;
    const id = props.api.id;
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        manager.register(id, ref.current, 'html');
        return () => manager.unregister(id);
    }, [manager, id]);

    return <div ref={ref} className="window-html-panel" />;
}
