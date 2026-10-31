<script lang="ts">
  import Icon from './Icon.svelte';
  import { fullRepo, statusLabel, type repositoryActivity } from './model';
  import type { Pin, Workflow } from './types';

  let {
    groups,
    onopen,
    onfavorite,
    favorite,
    busy,
    dispatching,
    blocked,
  }: {
    groups: ReturnType<typeof repositoryActivity>;
    onopen: (workflow: Workflow) => void;
    onfavorite: (workflow: Workflow) => void;
    favorite: (workflow: Workflow) => Pin | undefined;
    busy: boolean;
    dispatching: boolean;
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
            >{group.workflows.length}
            {group.workflows.length === 1 ? 'Action' : 'Actions'}
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
          {@const unavailable =
            !workflow.dispatch || group.repo.permission !== 'write'}
          <div class="repository-action">
            <button
              class="action-copy"
              onclick={() => onopen(workflow)}
              aria-label={`${workflow.name} konfigurieren`}
              disabled={dispatching}
            >
              <span class="action-dot"></span>
              <span
                ><strong>{workflow.name}</strong><small
                  >{!workflow.dispatch
                    ? 'Kein manueller Start'
                    : group.repo.permission !== 'write'
                      ? 'Nur Lesen'
                      : group.repo.defaultBranch}</small
                ></span
              >
            </button>
            <button
              class="icon-button favorite-button"
              aria-pressed={!!pin}
              aria-label={`${workflow.name} ${pin ? 'aus Favoriten entfernen' : 'als Favorit speichern'}`}
              title={unavailable
                ? 'Favoriten benötigen einen manuell startbaren Workflow mit Schreibrecht'
                : pin
                  ? 'Favorit entfernen'
                  : 'Mit Standardwerten als Favorit speichern'}
              disabled={busy || dispatching || unavailable}
              onclick={() => onfavorite(workflow)}
            >
              <Icon name="heart" size={17} />
            </button>
            <button
              class="action-start"
              onclick={() => onopen(workflow)}
              aria-label={`${workflow.name} starten`}
              title={unavailable
                ? 'Dieser Workflow kann nicht manuell gestartet werden'
                : 'Branch und Parameter wählen'}
              disabled={unavailable || blocked || dispatching}
            >
              <Icon name="play" size={12} />Starten
            </button>
          </div>
        {:else}<p class="repository-no-actions">
            Keine passenden Actions vorhanden.
          </p>{/each}
      </div>
    </section>
  {/each}
</div>
