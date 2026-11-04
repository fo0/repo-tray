<script lang="ts">
  import { m } from './i18n/index.svelte';
  import { applyTheme, type ThemePreference } from './theme';

  const options = $derived<{ value: ThemePreference; label: string }[]>([
    { value: 'system', label: m().settings.theme.system },
    { value: 'light', label: m().settings.theme.light },
    { value: 'dark', label: m().settings.theme.dark },
  ]);

  // A choice previews at once; the dialog's „Speichern“ keeps it and
  // „Abbrechen“ restores the saved one.
  let { value = $bindable() }: { value: ThemePreference } = $props();

  function choose(next: ThemePreference) {
    value = next;
    applyTheme(next);
  }
</script>

<section class="theme-setting" aria-labelledby="theme-heading">
  <h3 id="theme-heading">{m().settings.theme.heading}</h3>
  <div class="theme-options" role="radiogroup" aria-labelledby="theme-heading">
    {#each options as option (option.value)}
      <label class="theme-option">
        <input
          type="radio"
          name="theme-preference"
          value={option.value}
          checked={value === option.value}
          onchange={() => choose(option.value)}
        />
        <span>{option.label}</span>
      </label>
    {/each}
  </div>
</section>
