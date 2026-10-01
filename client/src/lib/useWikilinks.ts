import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import * as api from '../api/client';
import type { WikilinkPreviewState } from './renderMarkdown';
import { extractWikilinks } from './wikilinks';

/**
 * Everything a rendered-markdown view needs to show `[[wikilinks]]` in
 * `text` (milestone 32): the resolved-target state to hand to
 * `renderMarkdownToHtml`, and a click handler that opens a clicked link
 * inside the app. `handleClick` returns whether it handled the click, so a
 * caller can fall through to its other click handling (attachments, ...).
 */
export function useWikilinkPreview(text: string) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const targets = useMemo(() => extractWikilinks(text), [text]);
  const { data } = useQuery({
    queryKey: ['wikilinks', targets],
    queryFn: () => api.resolveLinks(targets),
    enabled: targets.length > 0,
    placeholderData: keepPreviousData,
  });

  const preview = useMemo<WikilinkPreviewState>(
    () => ({ resolved: new Map((data?.links ?? []).map((link) => [link.target, link])), labels: { missing: t('links.missing') } }),
    [data, t],
  );

  const handleClick = useCallback(
    (event: MouseEvent<HTMLElement>): boolean => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-wikilink]');
      if (!anchor) return false;
      event.preventDefault();
      const taskId = anchor.dataset.taskId;
      navigate(anchor.getAttribute('href') ?? '/', taskId ? { state: { highlightTaskId: taskId } } : undefined);
      return true;
    },
    [navigate],
  );

  return { preview, handleClick };
}
