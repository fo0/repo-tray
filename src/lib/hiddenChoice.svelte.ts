import { hiddenKey } from './hiddenRepos';
import type { HiddenRepo } from './types';

const keyOf = (entry: HiddenRepo) => hiddenKey(entry.accountId, entry.repoId);

/**
 * Hidden repositories marked „Einblenden“ while the settings dialog is open.
 * Marking only stages; „Speichern“ shows them again with `apply`.
 */
export class HiddenChoice {
  staged = $state.raw(new Set<string>());

  has = (entry: HiddenRepo) => this.staged.has(keyOf(entry));

  toggle = (entry: HiddenRepo) => {
    const next = new Set(this.staged);
    if (!next.delete(keyOf(entry))) next.add(keyOf(entry));
    this.staged = next;
  };

  /** Whether a staged row is still hidden, so „Speichern“ has work. */
  pendingIn = (entries: readonly HiddenRepo[]) => entries.some(this.has);

  /**
   * Shows every staged row that is still hidden, in turn. A row that was
   * shown is no longer staged; the first failure rejects and keeps the
   * remaining rows staged.
   */
  apply = async (
    entries: readonly HiddenRepo[],
    unhide: (entry: HiddenRepo) => Promise<unknown>,
  ) => {
    for (const entry of entries.filter(this.has)) {
      await unhide(entry);
      const next = new Set(this.staged);
      next.delete(keyOf(entry));
      this.staged = next;
    }
  };
}
