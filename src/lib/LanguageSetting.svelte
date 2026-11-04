<script lang="ts">
  import { m, setLocale } from './i18n/index.svelte';
  import {
    detectLocale,
    LANGUAGE_NAMES,
    LOCALES,
    resolveLocale,
    type LanguagePreference,
  } from './i18n/locale';

  // A choice previews at once; the dialog's „Speichern“ keeps it and
  // „Abbrechen“ restores the saved one.
  let { value = $bindable() }: { value: LanguagePreference } = $props();

  const options = $derived<
    { value: LanguagePreference; label: string; title?: string }[]
  >([
    {
      value: 'system',
      label: m().settings.language.system,
      title: m().settings.language.systemDetected(
        LANGUAGE_NAMES[detectLocale()],
      ),
    },
    ...LOCALES.map((locale) => ({
      value: locale,
      label: LANGUAGE_NAMES[locale],
    })),
  ]);

  function choose(next: LanguagePreference) {
    value = next;
    setLocale(resolveLocale(next), next);
  }
</script>

<section class="theme-setting" aria-labelledby="language-heading">
  <h3 id="language-heading">{m().settings.language.heading}</h3>
  <div
    class="theme-options"
    role="radiogroup"
    aria-labelledby="language-heading"
  >
    {#each options as option (option.value)}
      <label class="theme-option" title={option.title}>
        <input
          type="radio"
          name="language-preference"
          value={option.value}
          checked={value === option.value}
          onchange={() => choose(option.value)}
        />
        <span lang={option.value === 'system' ? undefined : option.value}
          >{option.label}</span
        >
      </label>
    {/each}
  </div>
</section>
