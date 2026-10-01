import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import * as api from '../api/client';
import { wikilinkHref, type LinkRef } from '../lib/wikilinks';
import { StatusIcon } from './TaskStatusButton';

/**
 * "Linked from" — every journal day, note and task whose text links to this
 * one with a `[[wikilink]]` (milestone 32). Renders nothing when there are
 * none, so a page nobody links to stays uncluttered.
 */
export default function Backlinks({ kind, id }: { kind: LinkRef['kind']; id: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({ queryKey: ['backlinks', kind, id], queryFn: () => api.getBacklinks(kind, id) });
  const backlinks = data?.backlinks ?? [];
  if (backlinks.length === 0) return null;

  return (
    <div className="backlinks">
      <div className="linked-title">{t('links.linkedFrom')}</div>
      <ul className="linked-list">
        {backlinks.map((ref) => (
          <li className={`linked-row ${ref.status === 'done' ? 'done' : ''}`} key={`${ref.kind}:${ref.id}`}>
            {ref.kind === 'task' && ref.status ? (
              <span className={`status-btn st-${ref.status} static`} title={t(`taskRow.status.${ref.status}`)}>
                <StatusIcon status={ref.status} />
              </span>
            ) : null}
            <Link
              className="linked-row-title"
              to={wikilinkHref(ref)}
              state={ref.kind === 'task' ? { highlightTaskId: ref.id } : undefined}
            >
              {ref.title}
            </Link>
            <span className="linked-row-project">
              {ref.kind === 'task' && ref.projectName ? (
                <>
                  <span className="project-dot" style={{ background: ref.projectColor }} />
                  {ref.projectName}
                </>
              ) : (
                t(`links.kind.${ref.kind}`)
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
