<script lang="ts">
  import Icon from './Icon.svelte';
  import { plural } from './format';
  import { fullRepo } from './model';
  import { workflowTarget } from './pins';
  import { statusLabel, type repositoryActivity } from './runs';
  import type { StartGate } from './startReason';
  import type { DispatchTarget, Pin, Workflow } from './types';

  let {
    groups,
    onopen,
    onfavorite,
    favorite,
    gate,
    uncertainRefs,
    expanded,
    onToggle,
  }: {
    groups: ReturnType<typeof repositoryActivity>;
    onopen: (workflow: Workflow) => void;
    onfavorite: (workflow: Workflow) => void;
    favorite: (workflow: Workflow) => Pin | undefined;
    /** What a target's controls may do right now (`Starts.gate`). */
    gate: (target: DispatchTarget) => StartGate;
    /** Refs with a locked start in a repository or one of its workflows. */
    uncertainRefs: (scope: {
      accountId: string;
      repoId: string;
      workflowId?: number;
    }) => string[];
    /** Expanded repository IDs; owned by the panel so they survive view switches. */
    expanded: Set<string>;
    onToggle: (repoId: string) => void;
  } = $props();
</script>

{#snippet warning(label: string)}<span
    class="row-warning"
    role="img"
    aria-label={label}
    title={label}><Icon name="warning" size={12} /></span
  >{/snippet}

<div class="repository-list">
  {#each groups as group (group.repo.id)}
    {@const open = expanded.has(group.repo.id)}
    {@const repoLocked = uncertainRefs({
      accountId: group.repo.accountId,
      repoId: group.repo.id,
    }).length}
    <section
      class="repository-card"
      class:open
      aria-label={fullRepo(group.repo)}
    >
      <button
        class="repository-toggle"
        aria-expanded={open}
        aria-controls={`actions-${group.repo.id}`}
        onclick={() => onToggle(group.repo.id)}
      >
        <span class="repository-symbol"><Icon name="repo" size={16} /></span>
        <span class="repository-copy">
          <strong
            >{fullRepo(group.repo)}{#if repoLocked}{@render warning(
                'Startstatus ungeklärt in diesem Repository',
              )}{/if}</strong
          >
          <small
            >{plural(group.workflows.length, 'Workflow', 'Workflows')}
            <span class="meta-dot">·</span>
            {#if group.activeCount}<span class="repository-live"
                >{group.activeCount} aktiv</span
              >
            {:else if group.latest}{statusLabel(group.latest)}{:else}Noch keine
              Aktivität{/if}
          </small>
        </span>
        <Icon name={open ? 'down' : 'chevron'} size={14} />
      </button>
      <div
        id={`actions-${group.repo.id}`}
        class="repository-actions"
        hidden={!open}
      >
        {#each group.workflows as workflow (workflow.id)}
          {@const pin = favorite(workflow)}
          {@const locked = uncertainRefs({
            accountId: group.repo.accountId,
            repoId: group.repo.id,
            workflowId: workflow.id,
          })}
          {@const can = gate(workflowTarget(group.repo, workflow))}
          {@const unavailable =
            !workflow.dispatch || group.repo.permission !== 'write'}
          {@const detail = !workflow.dispatch
            ? 'Kein manueller Start'
            : group.repo.permission !== 'write'
              ? 'Nur Lesen'
              : group.repo.defaultBranch}
          <div class="repository-action">
            <button
              class="action-copy"
              onclick={() => onopen(workflow)}
              aria-label={`${workflow.name} · ${detail}${locked.length ? ` · Startstatus ungeklärt (${locked.join(', ')})` : ''}`}
              title={can.openReason ?? undefined}
              disabled={!can.canOpen}
            >
              <span class="action-dot"></span>
              <span
                ><strong
                  >{workflow.name}{#if locked.length}{@render warning(
                      `Startstatus ungeklärt · ${locked.join(', ')}`,
                    )}{/if}</strong
                ><small>{detail}</small></span
              >
            </button>
            <button
              class="icon-button favorite-button"
              aria-pressed={!!pin}
              aria-label={`${workflow.name} ${pin ? 'aus Favoriten entfernen' : 'als Favorit speichern'}`}
              title={unavailable
                ? 'Favoriten brauchen einen manuell startbaren Workflow mit Schreibzugriff'
                : (can.openReason ??
                  (pin
                    ? `Favorit „${pin.label}“ entfernen`
                    : 'Mit Standardwerten als Favorit speichern'))}
              disabled={!can.canRemove || unavailable}
              onclick={() => onfavorite(workflow)}
            >
              <Icon name="heart" size={17} />
            </button>
            <button
              class="action-start"
              onclick={() => onopen(workflow)}
              aria-label={`${workflow.name} starten…`}
              title={can.reason ?? 'Branch oder Tag und Eingaben wählen'}
              disabled={!can.canStart}
            >
              <Icon name="play" size={12} />Starten…
            </button>
          </div>
        {:else}<p class="repository-no-actions">
            Keine passenden Workflows.
          </p>{/each}
      </div>
    </section>
  {/each}
</div>
