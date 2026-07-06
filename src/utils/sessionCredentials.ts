/**
 * In-memory login credentials, keyed by connection id. Used by branded builds,
 * where credentials are **never persisted**: the login screen deposits them
 * here and the auto-login paths (GMCP Char.Login, text-login prompts) read
 * them with priority over the connection record's stored fields. Lifetime is
 * the page — a reload starts back at the login form.
 */

export interface SessionCredentials {
    account: string;
    password: string;
}

const credentials = new Map<string, SessionCredentials>();
let last: SessionCredentials | undefined;

export function setSessionCredentials(connectionId: string, creds: SessionCredentials | null): void {
    if (creds && creds.account) {
        credentials.set(connectionId, creds);
        last = creds;
    } else {
        credentials.delete(connectionId);
    }
}

export function getSessionCredentials(connectionId: string): SessionCredentials | undefined {
    return credentials.get(connectionId);
}

/** The most recently entered credentials this page, regardless of profile —
 *  prefills the branded login form after closing a profile. */
export function getLastSessionCredentials(): SessionCredentials | undefined {
    return last;
}
