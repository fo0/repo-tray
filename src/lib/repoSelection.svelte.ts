import { tick } from 'svelte';
import type { Bridge } from './demo';
import { UNDO_TIMEOUT } from './favorites.svelte';
import { focusLost, landing } from './focus';
import { accountLabel, errorMessage } from './format';
import { fullRepo } from './model';
import type { Panel } from './panel.svelte';
import type { Repo, Snapshot } from './types';

/** The native service refuses a larger selection (`select_repos`). */
export const MAX_REPOS = 50;
/** Runs the selection sync under the panel's selection busy flag. */
export type SelectionMutation = (
  run: (ticket: number) => Promise<void>,
) => Promise<void | null>;

const UNDO_PREFIX = 'repo:';
const selectedIds = (snapshot: Snapshot | null) =>
  new Set(snapshot?.repos.filter((r) => r.selected).map((r) => r.id));
const same = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((id) => b.has(id));

export const permissionLabel = (repo: Repo) =>
  repo.permission === 'write'
    ? 'Schreibzugriff'
    : repo.permission === 'denied'
      ? 'Kein Zugriff'
      : 'Nur Lesen';

/**
 * „Nicht im Tray“: unselected repositories of the shown accounts whose name
 * matches a non-blank search, by name.
 */
export function notInTray(
  snapshot: Snapshot | null,
  shows: (accountId: string) => boolean,
  query: string,
): Repo[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle || !snapshot) return [];
  return snapshot.repos
    .filter(
      (repo) =>
        !repo.selected &&
        shows(repo.accountId) &&
        fullRepo(repo).toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => fullRepo(a).localeCompare(fullRepo(b)));
}

// Focus moves only where a row that held it left the list; the unit tests
// run without a DOM.
const hasDom = () => typeof document !== 'undefined';
const toggleOf = (id: string | null) =>
  id
    ? document.querySelector<HTMLElement>(
        `[data-repo-id="${CSS.escape(id)}"] .repository-toggle`,
      )
    : null;
/** The rows around a repository's row, nearest first, while it holds focus. */
function around(id: string) {
  const row = document.querySelector(`[data-repo-id="${CSS.escape(id)}"]`);
  if (!row?.contains(document.activeElement)) return [];
  return [row.nextElementSibling, row.previousElementSibling].map(
    (next) => next?.getAttribute('data-repo-id') ?? null,
  );
}
/** Lost focus goes to the repository's row, a neighbour, else the section. */
async function refocus(id: string, neighbours: (string | null)[]) {
  await tick();
  if (!focusLost()) return;
  const target =
    [id, ...neighbours].map(toggleOf).find(Boolean) ??
    document.querySelector<HTMLElement>('[data-maximize="repos"]') ??
    landing();
  target?.focus();
}

/**
 * Which repositories are in the tray. Every change applies at once: rapid
 * changes collect in one wanted set that is sent one call at a time, each
 * confirmed change offers „Rückgängig“, and a failure falls back to the
 * last snapshot. Favorites of a removed repository stay and return with it.
 */
export class RepoSelection {
  /** The selection the user wants while it is sent; null when in sync. */
  #wanted = $state.raw<Set<string> | null>(null);
  /** Repositories changed since the running sync started. */
  #touched = $state.raw(new Set<string>());
  #panel: Panel;
  /** The selection of the current snapshot, computed once per snapshot. */
  #saved = $derived.by(() => selectedIds(this.#panel.snapshot));
  #bridge: Bridge;
  #mutate: SelectionMutation;
  #sending = false;
  #idle: Promise<void> = Promise.resolve();
  /** Undo offers by notice key; `added` is the change they would revert. */
  #offers = new Map<string, { id: string; added: boolean }>();
  /** Repositories whose next confirmed change is an undo: no new offer. */
  #undoing = new Set<string>();

  constructor(panel: Panel, bridge: Bridge, mutate: SelectionMutation) {
    this.#panel = panel;
    this.#bridge = bridge;
    this.#mutate = mutate;
  }

  /** In the tray, or about to be: the wanted state wins while it is sent. */
  has = (id: string) => (this.#wanted ?? this.#saved).has(id);
  /** The change of this repository is not confirmed yet. */
  busy = (id: string) => this.#touched.has(id);
  toggle = (id: string) => this.#change(id, !this.has(id));
  add = (id: string) => this.#change(id, true);
  remove = (id: string) => this.#change(id, false);

  /** Drops every undo offer, e.g. when the active account changes. */
  clearUndo() {
    for (const key of this.#offers.keys()) this.#forget(key);
    this.#undoing.clear();
  }

  /** Resolves once this change and every one queued with it settled. */
  async #change(id: string, add: boolean, undo = false) {
    const panel = this.#panel;
    if (!panel.snapshot || this.has(id) === add) return;
    const next = new Set(this.#wanted ?? this.#saved);
    if (add) next.add(id);
    else next.delete(id);
    if (add && next.size > MAX_REPOS)
      return panel.showNotice(
        `Höchstens ${MAX_REPOS} Repositories passen in den Tray. Entferne zuerst ein anderes.`,
        'warning',
      );
    if (undo) this.#undoing.add(id);
    else this.#undoing.delete(id);
    const neighbours = hasDom() ? around(id) : [];
    this.#wanted = next;
    this.#touched = new Set(this.#touched).add(id);
    await this.#sync();
    if (hasDom()) await refocus(id, neighbours);
  }

  /** Starts the send loop unless it runs; it picks up later changes. */
  #sync() {
    if (this.#sending) return this.#idle;
    this.#sending = true;
    this.#idle = this.#mutate(() => this.#send()).then((ran) => {
      if (ran === null) this.#settle();
    });
    return this.#idle;
  }

  async #send() {
    const panel = this.#panel;
    let confirmed = this.#saved;
    let sent = confirmed;
    try {
      // Never the same set twice: a refused change cannot loop.
      while (this.#wanted && !same(this.#wanted, sent)) {
        sent = new Set(this.#wanted);
        // Like every mutation: the newer ticket drops a running refresh's
        // result, so its spinner stops here or it would never stop.
        const ticket = panel.viewEpoch.next();
        panel.refreshing = false;
        const value = await this.#bridge.selectRepos([...sent]);
        if (panel.viewEpoch.current(ticket)) panel.accept(value);
        // Only the user's own changes report; others came with the snapshot.
        const now = selectedIds(value);
        for (const id of this.#touched)
          if (now.has(id) !== confirmed.has(id))
            this.#report(value, id, now.has(id));
        confirmed = now;
      }
    } catch (cause) {
      panel.showNotice(
        `Repository-Auswahl nicht geändert: ${errorMessage(cause)}`,
        'warning',
      );
    } finally {
      this.#settle();
    }
  }

  /** Back to the snapshot; runs right where the loop ends, so no change slips. */
  #settle() {
    this.#wanted = null;
    this.#touched = new Set();
    this.#sending = false;
  }

  #report(value: Snapshot, id: string, added: boolean) {
    const panel = this.#panel;
    const repo = value.repos.find((item) => item.id === id);
    const name = repo?.name ?? id;
    const key = `${UNDO_PREFIX}${id}`;
    if (this.#undoing.delete(id)) {
      this.#offers.delete(key);
      panel.notices.show({
        key,
        tone: 'subtle',
        text: added
          ? `${name} ist wieder im Tray.`
          : `${name} wieder entfernt.`,
      });
      return;
    }
    // Offers that closed on their own need no clearing any more.
    for (const known of this.#offers.keys())
      if (!panel.notices.get(known)) this.#offers.delete(known);
    this.#offers.set(key, { id, added });
    // Natively only the active account's repositories are shown.
    const elsewhere =
      added && repo && !panel.showsAccount(repo.accountId)
        ? ` Sichtbar, sobald ${accountLabel(value, repo.accountId, panel.native)} aktiv ist.`
        : '';
    panel.notices.show({
      key,
      tone: 'subtle',
      timeout: UNDO_TIMEOUT,
      text: added
        ? `${name} hinzugefügt.${elsewhere}`
        : `${name} aus dem Tray entfernt.`,
      action: { label: 'Rückgängig', run: () => void this.#undo(key) },
    });
  }

  /** Flips only this repository against the current selection. */
  async #undo(key: string) {
    const offer = this.#offers.get(key);
    if (!offer) return;
    this.#forget(key);
    // The notice that held focus is gone: the page's landing takes it.
    if (hasDom()) {
      await tick();
      if (focusLost()) landing()?.focus();
    }
    await this.#change(offer.id, !offer.added, true);
  }

  #forget(key: string) {
    this.#offers.delete(key);
    this.#panel.notices.clear(key);
  }
}
