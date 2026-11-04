<script lang="ts">
  import Icon from './Icon.svelte';
  import { m } from './i18n/index.svelte';

  let {
    open,
    label = $bindable(),
    editing,
    saving,
    locked,
    valid,
    onSave,
  }: {
    /** Opened up front to complete or edit a favorite. */
    open: boolean;
    label: string;
    /** The dialog edits an existing template. */
    editing: boolean;
    /** A template save is running. */
    saving: boolean;
    /** A start for this target is running; the form stays as it was sent. */
    locked: boolean;
    /** The current selection would pass dispatch validation. */
    valid: boolean;
    onSave: (asNew: boolean) => void;
  } = $props();
  const canSave = $derived(!saving && !locked && valid && !!label.trim());
</script>

<details class="save-pin" {open}>
  <summary
    ><Icon name="heart" size={14} />{m().favorites.save.summary}<Icon
      name="down"
      size={13}
    /></summary
  >
  <div class="save-pin-body">
    <label class="field"
      ><span>{m().favorites.save.name}</span><input
        aria-label={m().favorites.save.name}
        bind:value={label}
        onkeydown={(event) => {
          if (event.key !== 'Enter') return;
          // Enter saves the favorite; it never submits a start.
          event.preventDefault();
          event.stopPropagation();
          if (canSave) onSave(false);
        }}
        disabled={locked || saving}
        maxlength="80"
        placeholder={m().favorites.save.placeholder}
      /></label
    >
    <p class="field-help">{m().favorites.save.help}</p>
    <button
      type="button"
      class="secondary-button compact"
      onclick={() => onSave(false)}
      disabled={!canSave}
      ><Icon name="heart" size={13} />{saving
        ? m().favorites.save.saving
        : editing
          ? m().favorites.save.update
          : m().favorites.save.save}</button
    >
    {#if editing}<button
        type="button"
        class="text-button copy-template"
        onclick={() => onSave(true)}
        disabled={!canSave}
        >{m().favorites.save.saveAsNew}<Icon name="plus" size={13} /></button
      >{/if}
  </div>
</details>
