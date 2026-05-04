import { ContextMenu } from '../components';

interface OutputContextMenuProps {
    x: number;
    y: number;
    showTimestamps: boolean;
    onToggleTimestamps: () => void;
    onClose: () => void;
}

export function OutputContextMenu({
    x,
    y,
    showTimestamps,
    onToggleTimestamps,
    onClose,
}: OutputContextMenuProps) {
    return (
        <ContextMenu x={x} y={y} onClose={onClose}>
            <button
                className="ctx-menu__item"
                type="button"
                onClick={() => { onToggleTimestamps(); onClose(); }}
            >
                <span className="ctx-menu__check">{showTimestamps ? '✓' : ''}</span>
                Show timestamps
            </button>
        </ContextMenu>
    );
}
