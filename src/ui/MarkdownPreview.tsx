import { useMemo, useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { CodeEditorPreview } from './CodeEditorPreview';
import { renderMarkdown } from './markdown';
import type { ProfileVFS } from '../scripting/vfs/ProfileVFS';

interface Props {
    content: string;
    filename: string;
    path: string;
    vfs: ProfileVFS;
    onDirtyChange?: (dirty: boolean) => void;
    onSaved?: () => void;
    gotoLine?: { line: number; revision: number } | null;
}

type Mode = 'rendered' | 'edit';

export function MarkdownPreview({ content, filename, path, vfs, onDirtyChange, onSaved, gotoLine }: Props) {
    const [mode, setMode] = useState<Mode>('rendered');

    const html = useMemo(
        () => (mode === 'rendered' ? renderMarkdown(content) : ''),
        [content, mode],
    );

    if (mode === 'edit') {
        return (
            <div className="vfs-md vfs-md--edit">
                <CodeEditorPreview
                    content={content}
                    filename={filename}
                    path={path}
                    vfs={vfs}
                    onDirtyChange={onDirtyChange}
                    onSaved={onSaved}
                    gotoLine={gotoLine}
                />
                <button
                    type="button"
                    className="vfs-md__mode-toggle"
                    onClick={() => setMode('rendered')}
                    title="Show rendered preview"
                >
                    <Eye size={12} />
                    <span>Preview</span>
                </button>
            </div>
        );
    }

    return (
        <div className="vfs-md">
            <div className="vfs-editor__toolbar">
                <span className="vfs-editor__filename" title={path}>{filename}</span>
                <div className="vfs-editor__actions">
                    <button
                        type="button"
                        className="vfs-editor__btn"
                        onClick={() => setMode('edit')}
                        title="Edit source"
                    >
                        <Pencil size={12} />
                        <span>Edit</span>
                    </button>
                </div>
            </div>
            <div
                className="vfs-md__body"
                // marked output is sanitized by DOMPurify above.
                dangerouslySetInnerHTML={{ __html: html }}
            />
        </div>
    );
}
