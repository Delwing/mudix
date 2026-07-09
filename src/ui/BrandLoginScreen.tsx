import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button, Input, FormField } from './components';
import { AboutModal } from './AboutModal';
import { getBrand, type LandingProps } from '../branding';
import { useBrandLogin } from './useBrandLogin';

/**
 * Built-in landing for branded builds: no profile creation or selection —
 * just a login form for the brand's MUD. Used when the brand doesn't supply
 * its own `Landing` component. Credentials are held in memory only (never
 * persisted): they feed the same auto-login path as the connection editor
 * (GMCP Char.Login, or typed at text-login prompts) for this page's lifetime,
 * so a reload starts back at an empty form. See `useBrandLogin`/
 * `BrandLoginFields` to reuse this behavior in a custom `Landing`.
 */
export function BrandLoginScreen({ openProfile, ensureBrandProfile, openSettings }: LandingProps) {
    const brand = getBrand();
    const { account, setAccount, password, setPassword, enter } = useBrandLogin({ openProfile, ensureBrandProfile });
    const [aboutOpen, setAboutOpen] = useState(false);

    const handleConnect = (e: React.FormEvent) => {
        e.preventDefault();
        enter(true);
    };

    return (
        <>
        <div className="connection-screen">
            <div className="connection-panel">
                <div className="connection-panel-tools">
                    <button className="connection-settings-btn" onClick={openSettings} type="button" aria-label="Settings">
                        ⚙
                    </button>
                    <button className="connection-about-btn" onClick={() => setAboutOpen(true)} type="button" aria-label={`About ${brand.appName}`}>
                        <Info size={16} />
                    </button>
                </div>
                <div className="connection-brand">{brand.appName}</div>
                {brand.tagline && (
                    <p style={{ textAlign: 'center', opacity: 0.7, marginTop: 4 }}>{brand.tagline}</p>
                )}

                <form
                    className="connection-form"
                    onSubmit={handleConnect}
                    style={{ maxWidth: 320, margin: '24px auto 0', display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                    <FormField label="Account" htmlFor="brand-login-account">
                        <Input
                            id="brand-login-account"
                            name="username"
                            autoComplete="username"
                            value={account}
                            onChange={e => setAccount(e.target.value)}
                            placeholder="account name"
                            spellCheck={false}
                            autoFocus
                        />
                    </FormField>
                    <FormField label="Password" htmlFor="brand-login-password">
                        <Input
                            id="brand-login-password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="password"
                        />
                    </FormField>
                    <Button type="submit" variant="primary">Connect</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => enter(false)}
                        title="Open the profile without connecting — scripts and settings stay available">
                        Open offline
                    </Button>
                </form>
            </div>
        </div>
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
        </>
    );
}
