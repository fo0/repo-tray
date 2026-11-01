<script module lang="ts">
  import type { InputSpec } from './types';

  /** German hint for each GitHub input type; raw type names never reach the UI. */
  const TYPE_LABELS: Record<InputSpec['type'], string> = {
    string: 'Text',
    number: 'Zahl',
    choice: 'Auswahl',
    environment: 'Umgebung',
    boolean: 'Ja/Nein',
  };
</script>

<script lang="ts">
  import { plural } from './format';
  import type { InputValue, Workflow } from './types';

  let {
    workflow,
    values,
    disabled,
    onChange,
  }: {
    workflow: Workflow | undefined;
    values: Record<string, InputValue>;
    disabled: boolean;
    onChange: (name: string, value: InputValue) => void;
  } = $props();
  const inputs = $derived(workflow?.inputs ?? []);

  /** Text shown in a field; numbers keep their digits, unset values stay empty. */
  const text = (input: InputSpec) => String(values[input.name] ?? '');
  /** An empty number field is unset, not zero. */
  const parseNumber = (value: string): InputValue =>
    value === '' ? '' : Number(value);
</script>

{#if inputs.length}<div class="input-heading">
    <span>EINGABEN</span><span
      >{plural(inputs.length, 'Eingabe', 'Eingaben')}</span
    >
  </div>{/if}
{#each inputs as input (input.name)}
  {#if input.type === 'boolean'}<label class="boolean-field"
      ><span
        ><strong>{input.label}</strong><small>{TYPE_LABELS.boolean}</small
        ></span
      ><input
        type="checkbox"
        aria-label={input.label}
        checked={values[input.name] === true}
        onchange={(event) => onChange(input.name, event.currentTarget.checked)}
        {disabled}
      /><span class="switch" aria-hidden="true"></span></label
    >
  {:else}<label class="field"
      ><span
        >{input.label}{#if input.required}<span class="required">*</span
          >{/if}<small>{TYPE_LABELS[input.type]}</small></span
      >{#if input.type === 'choice' || input.type === 'environment'}<select
          aria-label={input.label}
          aria-describedby={input.note ? `input-note-${input.name}` : undefined}
          value={text(input)}
          onchange={(event) => onChange(input.name, event.currentTarget.value)}
          {disabled}
          >{#if !input.required}<option value="">Nicht gesetzt</option
            >{/if}{#each input.options as option, index (index)}<option
              value={option}>{option}</option
            >{/each}</select
        >{:else if input.type === 'number'}<input
          type="number"
          aria-label={input.label}
          value={text(input)}
          oninput={(event) =>
            onChange(input.name, parseNumber(event.currentTarget.value))}
          step="any"
          {disabled}
        />{:else}<input
          type="text"
          aria-label={input.label}
          value={text(input)}
          oninput={(event) => onChange(input.name, event.currentTarget.value)}
          autocomplete="off"
          {disabled}
        />{/if}{#if input.note}<small
          class="field-help"
          id={`input-note-${input.name}`}>{input.note}</small
        >{/if}</label
    >{/if}
{/each}
