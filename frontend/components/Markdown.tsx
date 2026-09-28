'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** `[[Page]]` / `[[Page|label]]` wikilinks become bold labels (or links when `onWikiLink` is given). */
function preprocess(markdown: string): string {
  return markdown.replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) => {
    const text = (label ?? target).trim();
    return `[${text}](wiki:${encodeURIComponent(target.trim())})`;
  });
}

interface Props {
  children: string;
  onWikiLink?: (target: string) => void;
  className?: string;
}

export function Markdown({ children, onWikiLink, className }: Props) {
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (url.startsWith('wiki:') ? url : /^(https?:|mailto:|#|\/)/.test(url) ? url : '')}
        components={{
          a: ({ href, children: label }) => {
            if (href?.startsWith('wiki:')) {
              const target = decodeURIComponent(href.slice(5));
              return onWikiLink ? (
                <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onWikiLink(target)}>
                  {label}
                </button>
              ) : (
                <strong>{label}</strong>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            );
          },
        }}
      >
        {preprocess(children)}
      </ReactMarkdown>
    </div>
  );
}
