<script lang="ts">
  import Icon from './Icon.svelte';
  import type { HiddenChoice } from './hiddenChoice.svelte';
  import { hiddenKey } from './hiddenRepos';
  import type { Snapshot } from './types';

  // „Einblenden“ only stages a row; the dialog's „Speichern“ shows it again.
  let {
    snapshot,
    choice,
  }: { snapshot: Snapshot | null; choice: HiddenChoice } = $props();
  const entries = $derived(snapshot?.hiddenRepos ?? []);
  const login = (accountId: string) =>
    snapshot?.accounts.find((account) => account.id === accountId)?.login ??
    accountId;
</script>

<section class="hidden-setting" aria-labelledby="hidden-heading">
  <h3 id="hidden-heading">Ausgeblendete Repositories</h3>
  {#if entries.length}<ul class="hidden-list">
      {#each entries as entry (hiddenKey(entry.accountId, entry.repoId))}
        {@const staged = choice.has(entry)}
        <li class="hidden-row" class:staged>
          <span
            class="hidden-name"
            title={`${entry.owner}/${entry.name} · ${login(entry.accountId)}`}
            >{entry.name}</span
          ><button
            type="button"
            class="secondary-button compact"
            aria-pressed={staged}
            aria-label={`${entry.owner}/${entry.name} einblenden`}
            title={`${entry.owner}/${entry.name}`}
            onclick={() => choice.toggle(entry)}
            >{#if staged}<Icon name="check" size={12} />{/if}Einblenden</button
          >
        </li>
      {/each}
    </ul>{:else}<p class="hidden-empty">Keine</p>{/if}
</section>
