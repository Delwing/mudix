import { Button } from './components';

interface Props {
    name: string;
    /** Re-request folder access (must run from this click — a user gesture). */
    onGrant: () => void;
    /** Drop the folder link; the profile opens from local storage instead. */
    onUnlink: () => void;
    onBack: () => void;
}

/**
 * Shown when a linked Mudlet profile is opened but the browser hasn't granted
 * access to its folder (typically on a fresh page load via a deep link, where
 * there's no user gesture to prompt with). The user must decide — grant access
 * or unlink — rather than silently falling through to an empty local copy.
 */
export function FolderPermissionScreen({ name, onGrant, onUnlink, onBack }: Props) {
    return (
        <div className="app">
            <div className="profile-busy">
                <div className="profile-busy-title">“{name}” is a linked Mudlet folder</div>
                <p className="profile-busy-msg">
                    The browser needs your permission to read and write this profile’s folder on disk.
                    Grant access to open it linked (the folder stays the source of truth), or unlink to
                    open a local copy instead.
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                    <Button variant="primary" onClick={onGrant}>Grant folder access</Button>
                    <Button variant="secondary" onClick={onUnlink}>Unlink (open local copy)</Button>
                    <Button variant="secondary" onClick={onBack}>Back to profiles</Button>
                </div>
            </div>
        </div>
    );
}
