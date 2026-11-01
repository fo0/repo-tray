import { tick } from 'svelte';
import { focusRevealedRun, hasDom, landing, usable } from './focus';
import type { Notices } from './notices.svelte';
import type { ActivityFilter } from './runs';

/** A section of the overview, which can be maximized to fill the panel body. */
export type SectionPage = 'runs' | 'favorites' | 'repos';
/** The overview or a maximized section. */
export type Page = 'overview' | SectionPage;
/** Every page with its own header and way back. */
export type SubPage = Exclude<Page, 'overview'>;

/** Titles of the pages; the runs section reads „Läuft gerade“. */
export const PAGE_TITLES: Record<SubPage, string> = {
  runs: 'Verlauf',
  favorites: 'Favoriten',
  repos: 'Repositories',
};

/** The panel state „Im Verlauf anzeigen“ changes: expanded run and notices. */
export interface RunReveal {
  expandedRun: number | null;
  readonly notices: Pick<Notices, 'dismissRun'>;
}

/** The focused element, or null when focus rests on the page itself. */
function focused() {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null;
}
/**
 * The overview is rebuilt when a page closes, so an opener on it comes back
 * as a new element: `data-focus-key` names it across that rebuild.
 */
const focusKey = (opener: HTMLElement | null) =>
  opener?.closest<HTMLElement>('[data-focus-key]')?.dataset.focusKey ?? null;
/** The opener, else its rebuilt twin, else the section's maximize button. */
function focusBack(
  opener: HTMLElement | null,
  key: string | null,
  page: SubPage,
) {
  const twin = key
    ? document.querySelector<HTMLElement>(
        `[data-focus-key="${CSS.escape(key)}"]`,
      )
    : null;
  (
    [opener, twin].find(usable) ??
    document.querySelector<HTMLElement>(`[data-maximize="${page}"]`) ??
    landing()
  )?.focus();
}

/**
 * Which page the panel body shows, the search and the Verlauf filter. A page
 * remembers the element that opened it, so going back returns focus there.
 * The query stays across page switches; only a new account or „Im Verlauf
 * anzeigen“ clears it.
 */
export class PanelView {
  page = $state<Page>('overview');
  /** Where `back()` returns: one level, the overview unless a page opened another. */
  from = $state<Page>('overview');
  filter = $state<ActivityFilter>('all');
  query = $state('');
  /** Element that opened the current page; not reactive, focus only. */
  opener: HTMLElement | null = null;
  #openerKey: string | null = null;
  #panel: RunReveal;

  constructor(panel: RunReveal) {
    this.#panel = panel;
  }

  /** Opens a page and moves focus to its landing: the section's title. */
  open = async (
    page: SubPage,
    {
      from = 'overview',
      opener,
    }: { from?: Page; opener?: HTMLElement | null } = {},
  ) => {
    if (this.page !== page) {
      this.#remember(opener);
      this.from = from === page ? 'overview' : from;
      this.page = page;
    }
    if (!hasDom()) return;
    await tick();
    landing()?.focus();
  };

  /**
   * „+N weitere“ under a capped section: its full page. Under „Läuft gerade“
   * a Verlauf filter that hides open runs („Fehlgeschlagen“, „Abgeschlossen“)
   * gives way to „Aktiv“, so the promised runs are listed.
   */
  showMore = (page: SectionPage) => {
    if (
      page === 'runs' &&
      (this.filter === 'failed' || this.filter === 'recent')
    )
      this.filter = 'active';
    return this.open(page);
  };

  /** Ctrl+1/2/3: opens the page, or returns to the overview when it is open. */
  toggle = (page: SectionPage) => {
    if (this.page === page) this.back();
    else void this.open(page);
  };

  /** Leaves the page; false when there is nothing to go back from (Esc chain). */
  back = () => {
    if (this.page === 'overview') return false;
    const left = this.page;
    const [opener, key] = [this.opener, this.#openerKey];
    this.page = this.from;
    this.from = 'overview';
    this.#remember(null);
    if (hasDom()) void tick().then(() => focusBack(opener, key, left));
    return true;
  };

  /**
   * Straight to the overview without moving focus, e.g. right before a
   * closing dialog returns it.
   */
  home = () => {
    this.page = 'overview';
    this.from = 'overview';
    this.#remember(null);
  };

  /**
   * „Im Verlauf anzeigen“: the full Verlauf, unfiltered, with this run's
   * details open and focused. `opener` gets focus back on `back()`.
   */
  showRun = async (runId: number | null, opener?: HTMLElement | null) => {
    this.#panel.notices.dismissRun(runId);
    this.filter = 'all';
    this.query = '';
    this.#panel.expandedRun = runId;
    if (this.page !== 'runs') {
      this.#remember(opener);
      this.from = 'overview';
      this.page = 'runs';
    }
    if (!hasDom()) return;
    await tick();
    focusRevealedRun();
  };

  /** Stores the opener: the given one, else the focused element. */
  #remember(opener: HTMLElement | null | undefined) {
    const dom = hasDom();
    this.opener = opener !== undefined ? opener : dom ? focused() : null;
    this.#openerKey = dom ? focusKey(this.opener) : null;
  }

  /** A changed account starts with an empty search. */
  reset = () => {
    this.query = '';
  };
}
