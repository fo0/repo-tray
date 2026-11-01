<script lang="ts">
  import Icon from './Icon.svelte';
  import { fullRepo } from './model';
  import type { Repo, Workflow } from './types';

  let {
    repos,
    workflowsFor,
    uncertainRefs,
    onOpen,
  }: {
    repos: Repo[];
    /** Workflows of one repository that match the current search. */
    workflowsFor: (repoId: string) => Workflow[];
    /** Refs of a workflow with a locked start, for the row's warning marker. */
    uncertainRefs: (scope: {
      accountId: string;
      repoId: string;
      workflowId: number;
    }) => string[];
    onOpen: (workflow: Workflow) => void;
  } = $props();
</script>

<div class="workflow-list">
  {#each repos as repo (repo.id)}<div class="repo-group">
      <div class="repo-heading">
        <Icon name="repo" size={13} /><span>{fullRepo(repo)}</span
        >{#if repo.permission !== 'write'}<span class="read-badge"
            >Nur Lesen</span
          >{/if}
      </div>
      {#each workflowsFor(repo.id) as workflow (workflow.id)}{@const locked =
          uncertainRefs({
            accountId: repo.accountId,
            repoId: repo.id,
            workflowId: workflow.id,
          })}<button class="workflow-item" onclick={() => onOpen(workflow)}
          ><span class="workflow-copy"
            ><strong
              >{workflow.name}{#if locked.length}<span
                  class="row-warning"
                  role="img"
                  aria-label={`Startstatus ungeklärt · ${locked.join(', ')}`}
                  title={`Startstatus ungeklärt · ${locked.join(', ')}`}
                  ><Icon name="warning" size={12} /></span
                >{/if}</strong
            ><small
              >{workflow.dispatch
                ? `Manueller Start · ${repo.defaultBranch}`
                : 'Kein manueller Start'}</small
            ></span
          ><Icon
            name={workflow.dispatch && repo.permission === 'write'
              ? 'chevron'
              : 'shield'}
            size={15}
          /></button
        >{/each}
    </div>{/each}
</div>
