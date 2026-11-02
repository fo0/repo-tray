<script module lang="ts">
  /** Connection paths of the first step; browser sign-in stays paused. */
  export type ConnectMethod = 'local' | 'token';
</script>

<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    value = $bindable(),
    localHint = 'GitHub CLI (gh)',
    localDisabled = false,
  }: {
    value: ConnectMethod;
    /** Second line of the local option; the demo names why it is off. */
    localHint?: string;
    localDisabled?: boolean;
  } = $props();
</script>

<div class="choice-list" role="radiogroup" aria-labelledby="connect-step-title">
  <label class="choice-card">
    <input
      type="radio"
      name="connect-method"
      value="local"
      disabled={localDisabled}
      bind:group={value}
    />
    <Icon name="computer" size={18} />
    <span
      ><strong>Bestehende Anmeldung auf diesem PC verwenden</strong><small
        >{localHint}</small
      ></span
    >
  </label>
  <label class="choice-card">
    <input
      type="radio"
      name="connect-method"
      value="token"
      bind:group={value}
    />
    <Icon name="shield" size={18} />
    <span
      ><strong>Mit Token verbinden</strong><small
        >Fine-grained Personal Access Token</small
      ></span
    >
  </label>
  <!-- Paused by owner decision: shown, never selectable. -->
  <label class="choice-card">
    <input type="radio" name="connect-method" value="browser" disabled />
    <Icon name="github" size={18} />
    <span
      ><strong>Mit GitHub anmelden</strong><small
        >Vorübergehend deaktiviert</small
      ></span
    >
  </label>
</div>
