<script setup lang="ts">
const store = useSnapshotStore();
await callOnce(store.load);
</script>

<template>
  <v-container>
    <v-alert v-if="store.error" :text="`Couldn't load snapshot.json: ${store.error.message}`" type="error" />
    <v-table v-else density="compact">
      <thead>
        <tr>
          <th rowspan="2">Item</th>
          <th rowspan="2">Title</th>
          <th rowspan="2">fixVersion</th>
          <th v-for="repo in REPOS" :key="repo.id" :colspan="repo.branches.length">{{ repo.name }}</th>
        </tr>
        <tr>
          <template v-for="repo in REPOS" :key="repo.id">
            <th v-for="branch in repo.branches" :key="branch">{{ branch }}</th>
          </template>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in store.items" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.title }}</td>
          <td>{{ item.jira?.fixVersions.join(', ') || '—' }}</td>
          <template v-for="repo in REPOS" :key="repo.id">
            <td v-for="branch in repo.branches" :key="branch">{{ item.presence[repo.id]?.[branch] ?? '—' }}</td>
          </template>
        </tr>
      </tbody>
    </v-table>
  </v-container>
</template>
