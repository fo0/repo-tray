<script lang="ts">
  import {
    appliedTheme,
    applyTheme,
    rememberTheme,
    type ThemePreference,
  } from './theme';

  const OPTIONS: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Hell' },
    { value: 'dark', label: 'Dunkel' },
  ];

  // main.ts applied the saved choice before mount; after a choice that could
  // not be saved, the document still shows the one in effect.
  let theme = $state(appliedTheme());
  let unsaved = $state(false);

  /** Applies at once; a storage failure only loses the choice on restart. */
  function choose(value: ThemePreference) {
    theme = value;
    applyTheme(value);
    unsaved = !rememberTheme(value);
  }
</script>

<section class="theme-setting" aria-labelledby="theme-heading">
  <h3 id="theme-heading">Darstellung</h3>
  <div
    class="theme-options"
    role="radiogroup"
    aria-labelledby="theme-heading"
    aria-describedby="theme-help"
  >
    {#each OPTIONS as option (option.value)}
      <label class="theme-option">
        <input
          type="radio"
          name="theme-preference"
          value={option.value}
          checked={theme === option.value}
          onchange={() => choose(option.value)}
        />
        <span>{option.label}</span>
      </label>
    {/each}
  </div>
  <p id="theme-help" class="field-help theme-help">
    „System“ folgt der hellen oder dunklen Einstellung des Betriebssystems.
    {#if unsaved}Die Auswahl gilt bis zum nächsten Start, sie ließ sich nicht
      speichern.{/if}
  </p>
</section>
