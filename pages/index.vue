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
          <th>Item</th>
          <th>Title</th>
          <th>fixVersion</th>
          <th v-for="branch in BRANCHES" :key="branch">{{ branch }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in store.items" :key="item.id">
          <td>{{ item.id }}</td>
          <td>{{ item.title }}</td>
          <td>{{ item.jira?.fixVersions.join(', ') || '—' }}</td>
          <td v-for="branch in BRANCHES" :key="branch">{{ item.presence[branch] }}</td>
        </tr>
      </tbody>
    </v-table>
  </v-container>
</template>
