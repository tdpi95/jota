import { useTranslation } from 'react-i18next';

/**
 * Toggle-pin icon button — rendered on `ProjectCard` and `NoteRow`, which
 * are themselves full-row `<Link>`s, so the click has to stop the link
 * navigation as well as any parent drag/expand handler. A thumbtack — head,
 * needle, and the cap line on top — filled when pinned, outline when not,
 * same stroke weight as the rest of the app's icon buttons (see the
 * Dashboard header's search icon).
 */
export default function PinButton({ pinned, onToggle, className = '' }: { pinned: boolean; onToggle: () => void; className?: string }) {
  const { t } = useTranslation();
  const label = pinned ? t('common.unpin') : t('common.pin');
  return (
    <button
      type="button"
      className={`pin-btn ${pinned ? 'is-pinned' : ''} ${className}`}
      title={label}
      aria-label={label}
      aria-pressed={pinned}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 4v6l-2 4v2h10v-2l-2-4v-6" fill={pinned ? 'currentColor' : 'none'} />
        <path d="M12 16v5" />
        <path d="M8 4h8" />
      </svg>
    </button>
  );
}
