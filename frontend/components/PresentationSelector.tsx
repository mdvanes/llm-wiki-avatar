'use client';

import type { Strings } from '@/lib/language';
import { PRESENTATIONS, type Presentation, isPresentation } from '@/lib/presentation';

interface Props {
  value: Presentation;
  onChange: (presentation: Presentation) => void;
  disabled?: boolean;
  strings: Strings;
}

export function presentationLabel(presentation: Presentation, strings: Strings): string {
  switch (presentation) {
    case 'off':
      return strings.presentationOff;
    case 'voice-female':
      return strings.voiceFemale;
    case 'voice-male':
      return strings.voiceMale;
    case 'avatar-female-premium':
      return strings.avatarFemalePremium;
    case 'avatar-female-vrm':
      return strings.avatarFemale2;
    case 'avatar-male':
      return strings.avatarMale;
  }
}

export function PresentationSelector({ value, onChange, disabled, strings }: Props) {
  return (
    <select
      aria-label={strings.presentation}
      title={strings.presentation}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        if (isPresentation(e.target.value)) onChange(e.target.value);
      }}
      className="cursor-pointer rounded-full border border-border bg-panel px-3 py-1 text-xs font-semibold text-fg outline-none transition-colors hover:border-muted focus:border-accent disabled:cursor-default disabled:opacity-50"
    >
      {PRESENTATIONS.map((p) => (
        <option key={p} value={p}>
          {presentationLabel(p, strings)}
        </option>
      ))}
    </select>
  );
}
