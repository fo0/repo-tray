<script lang="ts">
  import { fullRepo } from './model';
  import type { Repo, Workflow } from './types';

  let {
    repos,
    workflows,
    repoId,
    workflowId,
    gitRef,
    defaultBranch,
    disabled,
    accountName,
    onRepo,
    onWorkflow,
    onRef,
  }: {
    /** Selected repositories of the active account. */
    repos: Repo[];
    /** Workflows of the chosen repository. */
    workflows: Workflow[];
    repoId: string;
    workflowId: number;
    gitRef: string;
    defaultBranch: string | undefined;
    disabled: boolean;
    accountName: (accountId: string) => string;
    onRepo: (repoId: string) => void;
    onWorkflow: (workflowId: number) => void;
    onRef: (ref: string) => void;
  } = $props();
  const workflow = $derived(workflows.find((item) => item.id === workflowId));
</script>

<label class="field"
  ><span>Repository</span><select
    aria-label="Repository"
    value={repoId}
    onchange={(event) => onRepo(event.currentTarget.value)}
    {disabled}
    >{#if !repos.length}<option value="">Keine Repositories</option
      >{/if}{#each repos as repo (repo.id)}<option value={repo.id}
        >{fullRepo(repo)} · {accountName(repo.accountId)}</option
      >{/each}</select
  ></label
><label class="field"
  ><span>Workflow</span><select
    aria-label="Workflow"
    value={workflowId}
    onchange={(event) => onWorkflow(Number(event.currentTarget.value))}
    {disabled}
    >{#if !workflows.length}<option value={0}>Kein Workflow verfügbar</option
      >{/if}{#each workflows as item (item.id)}<option value={item.id}
        >{item.name}{!item.dispatch ? ' · kein manueller Start' : ''}</option
      >{/each}</select
  ></label
>{#if workflow}<div class="workflow-path">
    {workflow.path}
  </div>{/if}<label class="field"
  ><span>Branch oder Tag<span class="required">*</span></span><select
    aria-label="Branch oder Tag"
    value={gitRef}
    onchange={(event) => onRef(event.currentTarget.value)}
    {disabled}
    >{#each workflow?.refs ?? [] as branch, index (index)}<option value={branch}
        >{branch}{branch === defaultBranch ? ' · Standardbranch' : ''}</option
      >{/each}</select
  ></label
>
