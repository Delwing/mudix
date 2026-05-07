import { useState } from 'react';
import WORKER_CODE from '../../worker/index.js?raw';

interface Props {
    onClose: () => void;
}

export function ProxyInfoModal({ onClose }: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        navigator.clipboard.writeText(WORKER_CODE).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    return (
        <>
            <div className="modal-overlay" onClick={onClose} />
            <div className="modal proxy-info-modal" role="dialog" aria-modal="true" aria-label="Host your own proxy">
                <div className="modal-header">
                    <span className="modal-title">Host your own proxy</span>
                    <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
                </div>
                <div className="modal-body proxy-info-body">
                    <p className="proxy-info-intro">
                        Deploy a free Cloudflare Worker that bridges WebSocket connections to MUD servers
                        and forwards HTTP requests around CORS restrictions.
                        Don't have an account? <a className="proxy-info-link" href="https://dash.cloudflare.com/sign-up" target="_blank" rel="noreferrer">Register at Cloudflare</a> — it's free.
                    </p>
                    <ol className="proxy-info-steps">
                        <li>Go to <a className="proxy-info-link" href="https://dash.cloudflare.com/?to=/:account/workers-and-pages/create/workers/new" target="_blank" rel="noreferrer">Create a Worker</a> in the Cloudflare Dashboard</li>
                        <li>Replace the editor contents with the code below</li>
                        <li>Click <strong>Deploy</strong></li>
                        <li>Copy your worker URL (e.g. <code>wss://your-worker.yourname.workers.dev</code>) and paste it into the Proxy URL field</li>
                    </ol>
                    <div className="proxy-code-block">
                        <div className="proxy-code-header">
                            <span className="proxy-code-label">index.js</span>
                            <button className="proxy-copy-btn" onClick={handleCopy}>
                                {copied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <pre className="proxy-code-pre"><code>{WORKER_CODE}</code></pre>
                    </div>
                </div>
            </div>
        </>
    );
}
