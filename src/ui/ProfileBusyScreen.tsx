import { Button } from './components';

interface Props {
    name: string;
    /** true = another tab owns the profile and we're queued behind it;
     *  false = we're just acquiring a free lock (a brief, usually invisible moment). */
    waiting: boolean;
    onBack: () => void;
}

/** Shown while a profile can't yet be mounted because another browser tab holds
 *  its single-owner lock. Auto-dismisses (the parent swaps in the session) the
 *  moment the other tab releases it. */
export function ProfileBusyScreen({ name, waiting, onBack }: Props) {
    return (
        <div className="app">
            <div className="profile-busy">
                <div className="profile-busy-spinner" aria-hidden />
                {waiting ? (
                    <>
                        <div className="profile-busy-title">“{name}” is open in another tab</div>
                        <p className="profile-busy-msg">
                            A profile can only be open in one tab at a time, so its scripts and saved data
                            don’t get corrupted. This will open automatically when the other tab closes it.
                        </p>
                        <Button variant="secondary" onClick={onBack}>Back to profiles</Button>
                    </>
                ) : (
                    <div className="profile-busy-title">Opening “{name}”…</div>
                )}
            </div>
        </div>
    );
}
