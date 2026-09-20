import { closeSearchPanel, findNext, findPrevious, replaceAll, replaceNext, SearchQuery, getSearchQuery, setSearchQuery } from '@codemirror/search';
import { runScopeHandlers, type EditorView, type Panel, type ViewUpdate } from '@codemirror/view';

/**
 * A from-scratch replacement for `@codemirror/search`'s own `SearchPanel` —
 * `search()`'s `createPanel` option (undocumented in its own README, but a
 * real, stable part of its config facet) is the sanctioned way to swap it
 * out. Built instead of just re-skinning the default one because the
 * default panel's DOM is fixed (a flat row of text buttons + labeled
 * checkboxes, replace fields always visible) — matching a VS Code-style
 * layout (icon toggles, a match-count readout, a collapsible replace row
 * behind a chevron) needs different structure, not just different CSS.
 * Reuses every one of `@codemirror/search`'s own commands/query machinery
 * (`SearchQuery`, `setSearchQuery`, `findNext`/`findPrevious`,
 * `replaceNext`/`replaceAll`, `closeSearchPanel`) — only the DOM and the
 * glue around it are new.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_PATHS = {
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  chevronUp: '<path d="M18 15l-6-6-6 6"/>',
  close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  // A single/double arrow dropping onto a baseline — "replace here" vs.
  // "replace everywhere" — deliberately not reusing the nav chevrons above
  // (those point sideways; these point down onto a line) so the two icon
  // groups don't read as the same action at a glance.
  replace: '<path d="M12 3v11"/><path d="M8 10l4 4 4-4"/><path d="M5 20h14"/>',
  replaceAll: '<path d="M7 3v7"/><path d="M4 7l3 3 3-3"/><path d="M17 3v7"/><path d="M14 7l3 3 3-3"/><path d="M3 20h18"/>',
} as const;

function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = paths;
  return svg;
}

function iconButton(className: string, title: string, paths: string, onclick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.appendChild(icon(paths));
  btn.addEventListener('click', onclick);
  return btn;
}

function textToggleButton(label: string, title: string, onclick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'find-toggle-btn';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.setAttribute('aria-pressed', 'false');
  btn.textContent = label;
  btn.addEventListener('click', onclick);
  return btn;
}

function setToggleActive(btn: HTMLButtonElement, active: boolean) {
  btn.classList.toggle('is-active', active);
  btn.setAttribute('aria-pressed', String(active));
}

/** Counts total matches and which one (1-based) the current selection sits
 * on, for the "n of m" readout — there's no built-in way to ask
 * `@codemirror/search` for this, so it's a plain cursor scan, the same cost
 * `selectMatches`/`replaceAll` already pay internally for the same job. */
function countMatches(view: EditorView, query: SearchQuery): { total: number; current: number } {
  if (!query.valid) return { total: 0, current: 0 };
  const sel = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let total = 0;
  let current = 0;
  for (let result = cursor.next(); !result.done; result = cursor.next()) {
    total++;
    if (result.value.from === sel.from && result.value.to === sel.to) current = total;
  }
  return { total, current };
}

export class VscodeSearchPanel implements Panel {
  dom: HTMLElement;

  private view: EditorView;
  private query: SearchQuery;
  private replaceOpen = false;

  private searchField: HTMLInputElement;
  private replaceField: HTMLInputElement;
  private countEl: HTMLSpanElement;
  private replaceRow: HTMLDivElement;
  private toggleReplaceBtn: HTMLButtonElement;
  private caseBtn: HTMLButtonElement;
  private wordBtn: HTMLButtonElement;
  private reBtn: HTMLButtonElement;

  constructor(view: EditorView) {
    this.view = view;
    this.query = getSearchQuery(view.state);

    this.commit = this.commit.bind(this);
    this.keydown = this.keydown.bind(this);

    this.searchField = document.createElement('input');
    this.searchField.className = 'find-input';
    this.searchField.value = this.query.search;
    this.searchField.placeholder = 'Find';
    this.searchField.setAttribute('aria-label', 'Find');
    this.searchField.setAttribute('main-field', 'true');
    this.searchField.addEventListener('input', this.commit);

    this.replaceField = document.createElement('input');
    this.replaceField.className = 'find-input';
    this.replaceField.value = this.query.replace;
    this.replaceField.placeholder = 'Replace';
    this.replaceField.setAttribute('aria-label', 'Replace');
    this.replaceField.addEventListener('input', this.commit);

    this.countEl = document.createElement('span');
    this.countEl.className = 'find-count';

    this.caseBtn = textToggleButton('Aa', 'Match Case', () => {
      this.query = new SearchQuery({ ...this.query, caseSensitive: !this.query.caseSensitive });
      this.dispatchQuery();
    });
    this.wordBtn = textToggleButton('ab', 'Match Whole Word', () => {
      this.query = new SearchQuery({ ...this.query, wholeWord: !this.query.wholeWord });
      this.dispatchQuery();
    });
    this.wordBtn.classList.add('find-toggle-underline');
    this.reBtn = textToggleButton('.*', 'Use Regular Expression', () => {
      this.query = new SearchQuery({ ...this.query, regexp: !this.query.regexp });
      this.dispatchQuery();
    });

    this.toggleReplaceBtn = iconButton('find-icon-btn find-toggle-replace', 'Toggle Replace', ICON_PATHS.chevronRight, () => {
      this.setReplaceOpen(!this.replaceOpen);
      if (this.replaceOpen) this.replaceField.focus();
    });

    const findRow = document.createElement('div');
    findRow.className = 'find-row';
    const inputWrap = document.createElement('div');
    inputWrap.className = 'find-input-wrap';
    inputWrap.append(this.searchField, this.countEl);
    findRow.append(
      this.toggleReplaceBtn,
      inputWrap,
      wrapGroup('find-toggle-group', [this.caseBtn, this.wordBtn, this.reBtn]),
      wrapGroup('find-nav-group', [
        iconButton('find-icon-btn', 'Previous Match (Shift+Enter)', ICON_PATHS.chevronUp, () => findPrevious(view)),
        iconButton('find-icon-btn', 'Next Match (Enter)', ICON_PATHS.chevronDown, () => findNext(view)),
      ]),
      iconButton('find-icon-btn find-close', 'Close (Escape)', ICON_PATHS.close, () => closeSearchPanel(view)),
    );

    this.replaceRow = document.createElement('div');
    this.replaceRow.className = 'find-row find-replace-row';
    this.replaceRow.hidden = true;
    const replaceInputWrap = document.createElement('div');
    replaceInputWrap.className = 'find-input-wrap';
    replaceInputWrap.append(this.replaceField);
    const spacer = document.createElement('span');
    spacer.className = 'find-row-spacer';
    this.replaceRow.append(
      spacer,
      replaceInputWrap,
      wrapGroup('find-nav-group', [
        iconButton('find-icon-btn', 'Replace (Enter)', ICON_PATHS.replace, () => replaceNext(view)),
        iconButton('find-icon-btn', 'Replace All', ICON_PATHS.replaceAll, () => replaceAll(view)),
      ]),
    );

    this.dom = document.createElement('div');
    this.dom.className = 'find-panel';
    this.dom.addEventListener('keydown', this.keydown);
    this.dom.append(findRow, this.replaceRow);

    this.syncToggleStates();
    this.updateCount();
  }

  private dispatchQuery() {
    this.view.dispatch({ effects: setSearchQuery.of(this.query) });
    this.syncToggleStates();
  }

  private commit() {
    const query = new SearchQuery({
      search: this.searchField.value,
      caseSensitive: this.query.caseSensitive,
      regexp: this.query.regexp,
      wholeWord: this.query.wholeWord,
      replace: this.replaceField.value,
    });
    if (!query.eq(this.query)) {
      this.query = query;
      this.view.dispatch({ effects: setSearchQuery.of(query) });
    }
  }

  private syncToggleStates() {
    setToggleActive(this.caseBtn, this.query.caseSensitive);
    setToggleActive(this.wordBtn, this.query.wholeWord);
    setToggleActive(this.reBtn, this.query.regexp);
  }

  private setReplaceOpen(open: boolean) {
    this.replaceOpen = open;
    this.replaceRow.hidden = !open;
    this.toggleReplaceBtn.replaceChildren(icon(open ? ICON_PATHS.chevronDown : ICON_PATHS.chevronRight));
  }

  private updateCount() {
    const { total, current } = countMatches(this.view, this.query);
    this.countEl.textContent = !this.query.search ? '' : total === 0 ? 'No results' : `${current || '?'} of ${total}`;
  }

  private keydown(e: KeyboardEvent) {
    if (runScopeHandlers(this.view, e, 'search-panel')) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && e.target === this.searchField) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === 'Enter' && e.target === this.replaceField) {
      e.preventDefault();
      replaceNext(this.view);
    }
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) {
      for (const effect of tr.effects) {
        if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
          this.query = effect.value;
          this.searchField.value = this.query.search;
          this.replaceField.value = this.query.replace;
          this.syncToggleStates();
        }
      }
    }
    if (update.docChanged || update.selectionSet || update.transactions.length) this.updateCount();
  }

  mount() {
    this.searchField.select();
  }

  get pos() {
    return 80;
  }

  get top() {
    // Hardcoded rather than read from the search config facet (which the
    // default panel does, but that facet isn't part of this package's
    // public API) — this panel is only ever constructed from
    // `MarkdownEditor.tsx`'s own `search({ top: true, createPanel: ... })`,
    // so it's always true in practice.
    return true;
  }
}

function wrapGroup(className: string, children: HTMLElement[]): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = className;
  wrap.append(...children);
  return wrap;
}
