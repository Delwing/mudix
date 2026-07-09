import { useState } from 'react';
import { getLastSessionCredentials, setSessionCredentials } from '../utils/sessionCredentials';
import type { LandingProps } from '../branding';

export interface UseBrandLoginResult {
    account: string;
    setAccount: (value: string) => void;
    password: string;
    setPassword: (value: string) => void;
    /** Find-or-create the profile, stash credentials in memory, and open it.
     *  `connect` dials immediately; false opens offline. */
    enter: (connect: boolean) => void;
}

/**
 * Shared login-form state for custom branded landings. Handles the
 * find-or-create-profile + in-memory-credential-stash + open sequence common
 * to every branded login screen, and prefills from the last credentials
 * entered this page (e.g. after backing out of a profile) — nothing is ever
 * read from or written to storage. Bring your own markup; for a ready-made
 * form see `BrandLoginFields`.
 */
export function useBrandLogin(
    { openProfile, ensureBrandProfile }: Pick<LandingProps, 'openProfile' | 'ensureBrandProfile'>,
): UseBrandLoginResult {
    const saved = getLastSessionCredentials();
    const [account, setAccount] = useState(saved?.account ?? '');
    const [password, setPassword] = useState(saved?.password ?? '');

    const enter = (connect: boolean) => {
        const id = ensureBrandProfile(account);
        setSessionCredentials(id, { account: account.trim(), password });
        openProfile(id, connect);
    };

    return { account, setAccount, password, setPassword, enter };
}
