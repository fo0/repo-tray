<script lang="ts">
  import Icon from './Icon.svelte';
  import RunStrip from './RunStrip.svelte';
  import { plural } from './format';
  import { fullRepo } from './model';
  import { workflowTarget } from './pins';
  import { TONE_ICON, type repositoryActivity } from './runs';
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
    {@const status = group.status}
    <section
      class="repository-card"
      class:open
      aria-label={fullRepo(group.repo)}
      data-repo-id={group.repo.id}
    >
      <!-- The strip sits inside the toggle, so its summary is part of what
           the row reads when it takes focus. -->
      <button
        class="repository-toggle"
        aria-expanded={open}
        aria-controls={`actions-${group.repo.id}`}
        onclick={() => onToggle(group.repo.id)}
      >
        <span class="repository-copy">
          <span class="repository-title"
            ><strong class="repository-name" title={fullRepo(group.repo)}
              ><span class="repository-owner">{group.repo.owner}</span><span
                class="repository-slash">/</span
              ><span class="repository-short">{group.repo.name}</span></strong
            >{#if repoLocked}{@render warning(
                'Startstatus ungeklärt in diesem Repository',
              )}{/if}</span
          >
          <small class="repository-meta"
            ><span class="repository-count"
              >{plural(group.workflows.length, 'Workflow', 'Workflows')}</span
            ><span class="meta-dot" aria-hidden="true">·</span>{#if status}<span
                class="repository-status"
                data-tone={status.tone}
                ><Icon name={TONE_ICON[status.tone]} size={12} /><span
                  >{status.label}</span
                ></span
              >{:else}<span class="repository-status"
                ><span>Noch keine Runs</span></span
              >{/if}{#if group.repo.permission !== 'write'}<span
                class="repository-tag"
                >{group.repo.permission === 'read'
                  ? 'Nur Lesen'
                  : 'Kein Zugriff'}</span
              >{/if}</small
          >
        </span>
        <RunStrip cells={group.recent} />
        <Icon name="chevron" size={15} class="repository-chevron" />
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
