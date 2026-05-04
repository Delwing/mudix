import { useRef } from 'react';
import { ScriptEditorPanel } from './panels/ScriptEditorPanel';
import { useAppStore } from '../../storage';
import { ResizableModal } from '../ResizableModal';
import type { MudSession } from '../../mud/MudSession';
import type { ScriptNode } from '../../storage/schema';

const MIN_W = 500;
const MIN_H = 320;
const DEFAULT_W = 900;
const DEFAULT_H = 640;

interface Props {
    connectionId: string;
    session: MudSession;
    onScriptSave?: (script: ScriptNode) => void;
    onClose: () => void;
}

export function ScriptEditorModal({ connectionId, session, onScriptSave, onClose }: Props) {
    const savedBounds = useAppStore(s => s.connectionScriptEditorBounds[connectionId]);
    const saveBounds  = useAppStore(s => s.saveScriptEditorBounds);

    const boundsRef = useRef(savedBounds ?? null);

    return (
        <ResizableModal
            title="Scripts"
            className="script-editor-modal"
            onClose={onClose}
            savedBounds={savedBounds}
            onBoundsChange={b => {
                boundsRef.current = { ...boundsRef.current, ...b };
                saveBounds(connectionId, boundsRef.current!);
            }}
            minW={MIN_W}
            minH={MIN_H}
            defaultW={DEFAULT_W}
            defaultH={DEFAULT_H}
        >
            <ScriptEditorPanel
                connectionId={connectionId}
                session={session}
                onScriptSave={onScriptSave}
                initialListWidth={savedBounds?.listWidth}
                initialMetaHeight={savedBounds?.metaHeight}
                onSplitsChange={(listWidth, metaHeight) => {
                    boundsRef.current = { ...boundsRef.current, listWidth, metaHeight: metaHeight ?? undefined };
                    saveBounds(connectionId, boundsRef.current!);
                }}
            />
        </ResizableModal>
    );
}
