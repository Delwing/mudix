import type { IDockviewHeaderActionsProps } from 'dockview';

export function PopoutButton({ group, containerApi, panels }: IDockviewHeaderActionsProps) {
    if (panels.some(p => p.id === 'output') || group.api.location.type === 'popout') {
        return null;
    }

    return (
        <button
            className="dv-popout-btn"
            title="Pop out to window"
            onClick={() => containerApi.addPopoutGroup(group)}
        >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.5 1.5H9.5V4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9.5 1.5L5.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                <path d="M8.5 6.5V8.5C8.5 9.05 8.05 9.5 7.5 9.5H2.5C1.95 9.5 1.5 9.05 1.5 8.5V3.5C1.5 2.95 1.95 2.5 2.5 2.5H4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
        </button>
    );
}
