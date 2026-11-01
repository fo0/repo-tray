import type { NoticeTone } from './StatusBanners.svelte';

/** Key of the one general panel notice (refresh, settings, links). */
export const PANEL_NOTICE = 'panel';
/** Subtle success notices close on their own after this many milliseconds. */
export const SUCCESS_TIMEOUT = 6000;
const LIMIT = 4;

export interface Notice {
  id: number;
  /**
   * One notice per key: `PANEL_NOTICE` for general messages, a target key
   * per start result, so concurrent starts never overwrite each other.
   */
  key: string;
  text: string;
  tone: NoticeTone;
  /** An accepted start the banner can show in the activity list. */
  runId?: number;
  /** Account of that run; the activity action only fits while it is shown. */
  accountId?: string;
  /** One follow-up action, e.g. „Rückgängig“. */
  action?: { label: string; run: () => void };
  /**
   * Closes after this many milliseconds while neither hovered nor focused;
   * subtle notices default to `SUCCESS_TIMEOUT`. Warnings and errors stay.
   */
  timeout?: number;
}

/** Banner notices of the panel, oldest first; successes are bounded. */
export class Notices {
  items = $state.raw<Notice[]>([]);
  #next = 0;

  /** Replaces the notice with the same key. */
  show(notice: Omit<Notice, 'id'>) {
    const entry: Notice = {
      ...notice,
      id: ++this.#next,
      timeout:
        notice.tone === 'subtle'
          ? (notice.timeout ?? SUCCESS_TIMEOUT)
          : undefined,
    };
    const items = [
      ...this.items.filter((item) => item.key !== notice.key),
      entry,
    ];
    // Over the limit, the oldest earlier success goes first; warnings and
    // errors stay until they are closed.
    while (items.length > LIMIT) {
      const oldest = items.findIndex(
        (item) => item.tone === 'subtle' && item !== entry,
      );
      if (oldest < 0) break;
      items.splice(oldest, 1);
    }
    this.items = items;
    return entry.id;
  }
  dismiss(id: number) {
    this.items = this.items.filter((item) => item.id !== id);
  }
  clear(key: string) {
    if (this.items.some((item) => item.key === key))
      this.items = this.items.filter((item) => item.key !== key);
  }
  /** Drops the start result that offered to show this run. */
  dismissRun(runId: number | null) {
    this.items = this.items.filter(
      (item) => !item.runId || item.runId !== runId,
    );
  }
  get(key: string) {
    return this.items.find((item) => item.key === key);
  }
}
