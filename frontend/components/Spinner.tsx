/** Centered spinner with a label, laid over the avatar window. */
export function SpinnerOverlay({ label, dim = false }: { label: string; dim?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`absolute inset-0 z-10 grid place-items-center ${dim ? 'bg-panel/70 backdrop-blur-[2px]' : ''}`}
    >
      <div className="flex flex-col items-center gap-3 text-sm text-muted">
        <span className="size-8 animate-spin rounded-full border-[3px] border-accent border-t-transparent" aria-hidden />
        <span>{label}</span>
      </div>
    </div>
  );
}
