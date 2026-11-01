<script lang="ts">
  import type { InputSpec, InputValue, Workflow } from './types';

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
    <span>EINGABEN</span><span>{inputs.length} Parameter</span>
  </div>{/if}
{#each inputs as input}
  {#if input.type === 'boolean'}<label class="boolean-field"
      ><span
        ><strong>{input.label}</strong><small
          >Workflow-Parameter · boolean</small
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
          >{/if}<small>{input.type}</small></span
      >{#if input.type === 'choice' || input.type === 'environment'}<select
          aria-label={input.label}
          value={text(input)}
          onchange={(event) => onChange(input.name, event.currentTarget.value)}
          {disabled}
          >{#if !input.required}<option value="">Nicht gesetzt</option
            >{/if}{#each input.options as option}<option value={option}
              >{option}</option
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
        />{/if}</label
    >{/if}
{/each}
