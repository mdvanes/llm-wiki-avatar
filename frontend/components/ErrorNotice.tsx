'use client';

import { useState } from 'react';
import type { Problem } from '@/lib/diagnostics';
import type { Strings } from '@/lib/language';

interface Props {
  problem: Problem;
  strings: Strings;
  onDismiss?: () => void;
  className?: string;
}

/** A failure with numbered fix steps; commands can be copied. */
export function ErrorNotice({ problem, strings, onDismiss, className = '' }: Props) {
  return (
    <div
      role="alert"
      className={`rounded-xl border border-danger/40 bg-danger/10 p-4 text-left text-sm text-fg ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold text-danger">{problem.title}</h2>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={strings.errDismiss}
            title={strings.errDismiss}
            className="-mr-1 -mt-1 rounded-full px-2 text-lg leading-none text-muted hover:text-fg"
          >
            ×
          </button>
        )}
      </div>
      <p className="mt-1 [overflow-wrap:anywhere]">{problem.message}</p>
      {problem.steps.length > 0 && (
        <>
          <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{strings.errStepsHeading}</h3>
          <ol className="mt-1 list-decimal space-y-1.5 pl-5">
            {problem.steps.map((step, i) => (
              <li key={i} className="[overflow-wrap:anywhere]">
                {step.text}
                {step.command && <Command command={step.command} strings={strings} />}
              </li>
            ))}
          </ol>
        </>
      )}
      {problem.detail && (
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">{strings.errDetail}</summary>
          <pre className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{problem.detail}</pre>
        </details>
      )}
      {problem.settingsLink && (
        <a
          href="/settings#model-connection"
          target="_blank"
          rel="noopener"
          className="mt-3 inline-block text-xs text-accent underline"
        >
          {strings.errModelSettings}
        </a>
      )}
    </div>
  );
}

function Command({ command, strings }: { command: string; strings: Strings }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="min-w-0 rounded bg-panel-2 px-2 py-0.5 font-mono text-xs">{command}</code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-accent"
      >
        {copied ? strings.errCopied : strings.errCopy}
      </button>
    </span>
  );
}
