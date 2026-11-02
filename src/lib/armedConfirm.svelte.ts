/** How long an armed button waits for the confirming click. */
export const ARM_MS = 4000;

/**
 * Two clicks on the same button for an action that cannot be taken back,
 * such as cancelling a run: the first arms it, the second within `ARM_MS`
 * runs the action. Waiting, another key or leaving the button disarms it.
 */
export class ArmedConfirm<K> {
  armed = $state<K | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  is = (key: K) => this.armed === key;

  press = (key: K, action: () => void) => {
    clearTimeout(this.#timer);
    if (this.armed !== key) {
      this.armed = key;
      this.#timer = setTimeout(this.disarm, ARM_MS);
      return;
    }
    this.armed = null;
    action();
  };

  disarm = () => {
    clearTimeout(this.#timer);
    this.armed = null;
  };
}
