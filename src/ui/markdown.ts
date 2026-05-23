import { marked } from 'marked';
import DOMPurify from 'dompurify';

// `gfm + breaks` matches the GitHub-style behavior most note apps render.
marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
    const html = marked.parse(src, { async: false }) as string;
    return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
