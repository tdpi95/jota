import { Link } from 'react-router-dom';

import type { IndexedNote } from '../types';

/** One note's metadata row on `/notes` — title, tags, and when it was last
 * updated. No body preview: the index never caches note body text (PLAN.md
 * "Notes"), so there's nothing cheap to show here beyond the metadata
 * itself. `updatedLabel` is pre-formatted by the caller (`formatTimestamp`,
 * localized) rather than formatted here, matching `HistoryPanel`'s own
 * split between data and display. */
export default function NoteRow({ note, updatedLabel }: { note: IndexedNote; updatedLabel: string }) {
  return (
    <Link className="note-row" to={`/notes/${note.slug}`}>
      <div className="note-row-main">
        <span className="note-title">{note.title}</span>
        {note.tags.length > 0 && (
          <div className="project-tags">
            {note.tags.map((tag) => (
              <span className="tag-pill" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="note-updated">{updatedLabel}</span>
    </Link>
  );
}
