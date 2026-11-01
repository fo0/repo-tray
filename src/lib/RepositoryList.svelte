<script lang="ts">
  import Icon from './Icon.svelte';
  import { plural } from './format';
  import { fullRepo, statusLabel, type repositoryActivity } from './model';
  import { workflowTarget } from './pins';
  import type { DispatchTarget, Pin, Workflow } from './types';

  let {
    groups,
    onopen,
    onfavorite,
    favorite,
    busy,
    isStarting,
    blocked,
  }: {
    groups: ReturnType<typeof repositoryActivity>;
    onopen: (workflow: Workflow) => void;
    onfavorite: (workflow: Workflow) => void;
    favorite: (workflow: Workflow) => Pin | undefined;
    busy: boolean;
    /** A start for this target is running; only that target is locked. */
    isStarting: (target: DispatchTarget) => boolean;
    blocked: boolean;
  } = $props();
  let expanded = $state<Set<string>>(new Set());
  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expanded = next;
  }
</script>

<div class="repository-list">
  {#each groups as group (group.repo.id)}
    {@const open = expanded.has(group.repo.id)}
    <section
      class="repository-card"
      class:open
      aria-label={fullRepo(group.repo)}
    >
      <button
        class="repository-toggle"
        aria-expanded={open}
        aria-controls={`actions-${group.repo.id}`}
        onclick={() => toggle(group.repo.id)}
      >
        <span class="repository-symbol"><Icon name="repo" size={16} /></span>
        <span class="repository-copy">
          <strong>{fullRepo(group.repo)}</strong>
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
          {@const starting = isStarting(workflowTarget(group.repo, workflow))}
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
              aria-label={`${workflow.name} · ${detail}`}
              disabled={starting}
            >
              <span class="action-dot"></span>
              <span
                ><strong>{workflow.name}</strong><small>{detail}</small></span
              >
            </button>
            <button
              class="icon-button favorite-button"
              aria-pressed={!!pin}
              aria-label={`${workflow.name} ${pin ? 'aus Favoriten entfernen' : 'als Favorit speichern'}`}
              title={unavailable
                ? 'Favoriten brauchen einen manuell startbaren Workflow mit Schreibzugriff'
                : pin
                  ? `Favorit „${pin.label}“ entfernen`
                  : 'Mit Standardwerten als Favorit speichern'}
              disabled={busy || starting || unavailable}
              onclick={() => onfavorite(workflow)}
            >
              <Icon name="heart" size={17} />
            </button>
            <button
              class="action-start"
              onclick={() => onopen(workflow)}
              aria-label={`${workflow.name} starten…`}
              title={unavailable
                ? 'Dieser Workflow kann nicht manuell gestartet werden'
                : 'Branch oder Tag und Eingaben wählen'}
              disabled={unavailable || blocked || starting}
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
