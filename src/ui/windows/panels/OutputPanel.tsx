import type React from 'react';
import type { IDockviewPanelProps } from 'dockview';
import type { MudSession } from '../../../mud/MudSession';
import { OutputArea } from '../../output/OutputArea';

interface OutputPanelParams {
    session: MudSession;
    stickyLines?: number;
    commandInputRef?: React.RefObject<HTMLInputElement>;
}

export function OutputPanel(props: IDockviewPanelProps<OutputPanelParams>) {
    const { session, stickyLines, commandInputRef } = props.params;
    return <OutputArea session={session} stickyLines={stickyLines ?? 5} commandInputRef={commandInputRef} />;
}
