export const useSnapshotStore = defineStore('snapshot', () => {
  const snapshot = ref<Snapshot | null>(null)
  const error = ref<Error | null>(null)
  const items = computed(() => snapshot.value?.items ?? [])

  async function load() {
    try {
      snapshot.value = await $fetch<Snapshot>('/snapshot.json')
      error.value = null
    }
    catch (e) {
      error.value = e as Error
    }
  }

  return { snapshot, error, items, load }
})
