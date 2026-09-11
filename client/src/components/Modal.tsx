import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Generic popup overlay — the first modal in the app (PLAN.md milestone 18:
 * "create/edit project happens in a modal instead of an inline form that
 * shifts the page layout"). Closes on Escape, backdrop click, or the ×
 * button; a click inside the card itself does not bubble to the backdrop.
 */
export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
