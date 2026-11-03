import type { Bridge } from './demo';
import { REFRESH_DEFAULT, REFRESH_ERROR, validRefresh } from './refresh';

type RefreshPort = Pick<Bridge, 'refreshInterval' | 'setRefreshInterval'>;

/**
 * The refresh interval while the settings dialog is open. The slider and the
 * own-value field only stage a value; „Speichern“ writes it with `apply`.
 */
export class RefreshChoice {
  /** The interval in effect; null until the first read finished. */
  saved = $state<number | null>(null);
  /** The staged value; null while untouched. NaN for an empty field. */
  draft = $state<number | null>(null);
  #port: RefreshPort;

  constructor(port: RefreshPort) {
    this.#port = port;
  }

  /** What the controls show. */
  get value() {
    return this.draft ?? this.saved ?? REFRESH_DEFAULT;
  }
  get invalid() {
    return this.draft !== null && !validRefresh(this.draft);
  }
  get pending() {
    return this.draft !== null && this.draft !== this.saved;
  }

  stage = (seconds: number) => {
    this.draft = seconds === this.saved ? null : seconds;
  };

  /** Reads once; an unreadable or foreign value shows the default. */
  read = async () => {
    if (this.saved !== null) return;
    let seconds = REFRESH_DEFAULT;
    try {
      const value = await this.#port.refreshInterval();
      if (validRefresh(value)) seconds = value;
    } catch {
      /* The default shows; saving still writes the chosen value. */
    }
    this.saved ??= seconds;
    if (this.draft === this.saved) this.draft = null;
  };

  /** Writes the staged value; a refusal rejects with the shell's German message. */
  apply = async () => {
    const seconds = this.draft;
    if (seconds === null) return;
    if (!validRefresh(seconds)) throw new Error(REFRESH_ERROR);
    this.saved = await this.#port.setRefreshInterval(seconds);
    this.draft = null;
  };
}
