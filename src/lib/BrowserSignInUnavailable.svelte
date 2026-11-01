<script lang="ts">
  import Icon from './Icon.svelte';
  let { demo = false }: { demo?: boolean } = $props();
</script>

<div class="browser-sign-in-paused">
  <button
    type="button"
    class="secondary-button full-width"
    disabled
    aria-describedby="browser-sign-in-paused-hint"
  >
    <Icon name="github" size={16} />Mit GitHub anmelden
    <span>Vorübergehend deaktiviert</span>
  </button>
  <p id="browser-sign-in-paused-hint" class="field-help">
    {demo
      ? 'Die Browser-Anmeldung / GitHub App ist vorübergehend deaktiviert. In dieser Vorschau kannst du den Beispiel-Token verwenden.'
      : 'Die Browser-Anmeldung / GitHub App ist vorübergehend deaktiviert. Verbinde eine vorhandene gh-Anmeldung oder hinterlege einen Token.'}
  </p>
</div>

<style>
  .browser-sign-in-paused {
    margin: 16px 0;
  }
  button {
    flex-wrap: wrap;
    white-space: normal;
  }
  button span {
    flex-basis: 100%;
    font-size: var(--font-size-meta);
  }
  p {
    margin-top: 8px;
    line-height: 1.6;
  }
</style>
