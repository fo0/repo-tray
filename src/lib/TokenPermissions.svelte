<script lang="ts">
  import { m } from './i18n/index.svelte';
</script>

<!-- The token permissions RepoWatch needs, in one line; mirrors docs/GITHUB_SETUP.md.
     GitHub's permission names stay English. -->
<div class="token-permissions" id="token-permissions">
  <span id="token-permissions-heading">{m().accounts.permissions.heading}</span>
  <ul aria-labelledby="token-permissions-heading">
    <li><strong>Actions</strong> {m().accounts.permissions.readWrite}</li>
    <li><strong>Contents</strong> {m().accounts.permissions.read}</li>
    <li><strong>Metadata</strong> {m().accounts.permissions.read}</li>
  </ul>
</div>
