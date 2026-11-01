<script lang="ts">
  import Icon from './Icon.svelte';

  let {
    open,
    label = $bindable(),
    quickStart = $bindable(),
    editing,
    saving,
    locked,
    valid,
    onSave,
  }: {
    /** Opened up front when a favorite still needs input. */
    open: boolean;
    label: string;
    quickStart: boolean;
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
    ><Icon name="heart" size={14} />Als Favorit speichern<Icon
      name="down"
      size={13}
    /></summary
  >
  <div class="save-pin-body">
    <label class="field"
      ><span>Name des Favoriten</span><input
        aria-label="Name des Favoriten"
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
        placeholder="z. B. Windows build"
      /></label
    ><label class="quick-opt-in"
      ><input
        type="checkbox"
        bind:checked={quickStart}
        disabled={locked || saving}
      /><span
        >Schnellstart aktivieren<small
          >Startet diesen Favoriten per Klick ohne Bestätigung.</small
        ></span
      ></label
    >
    <p class="field-help">
      Speichert Konto, Repository, Workflow, Branch oder Tag und nicht geheime
      Eingaben lokal.
    </p>
    <button
      type="button"
      class="secondary-button compact"
      onclick={() => onSave(false)}
      disabled={!canSave}
      ><Icon name="heart" size={13} />{saving
        ? 'Speichert …'
        : editing
          ? 'Favorit aktualisieren'
          : 'Favorit speichern'}</button
    >
    {#if editing}<button
        type="button"
        class="text-button copy-template"
        onclick={() => onSave(true)}
        disabled={!canSave}
        >Als neuen Favoriten speichern<Icon name="plus" size={13} /></button
      >{/if}
  </div>
</details>
