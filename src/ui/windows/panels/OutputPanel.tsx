import type React from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { MudSession } from '../../../mud/MudSession';
import { OutputArea } from '../../output/OutputArea';
import { DEFAULT_STICKY_LINES } from '../../../hooks/useOutput';

interface OutputPanelParams {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function OutputPanel(props: IDockviewPanelProps<OutputPanelParams>) {
    const { session, stickyLines, commandInputRef } = props.params;
    return <OutputArea session={session} stickyLines={stickyLines ?? DEFAULT_STICKY_LINES} commandInputRef={commandInputRef} />;
}
