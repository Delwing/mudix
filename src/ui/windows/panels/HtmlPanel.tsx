import { useEffect, useRef } from 'react';
import type { WindowManager } from '../WindowManager';

export function HtmlPanel({ id, manager }: { id: string; manager: WindowManager }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        manager.register(id, ref.current, 'html');
        return () => manager.unregister(id);
    }, [manager, id]);

    return <div ref={ref} className="window-html-panel" />;
}
