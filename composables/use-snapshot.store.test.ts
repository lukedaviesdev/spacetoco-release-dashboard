import { beforeEach, describe, expect, it } from 'vitest';
import { registerEndpoint } from '@nuxt/test-utils/runtime';
import { createPinia, setActivePinia } from 'pinia';

let response: unknown;

registerEndpoint('/snapshot.json', () => {
  if (response instanceof Error) throw response;
  return response;
});

describe('snapshot store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('loads items from /snapshot.json', async () => {
    response = { items: [{ id: 'DEV-1' }] };
    const store = useSnapshotStore();
    await store.load();
    expect(store.items.map(i => i.id)).toEqual(['DEV-1']);
    expect(store.error).toBeNull();
  });

  it('exposes an error when the snapshot fails to load', async () => {
    response = new Error('boom');
    const store = useSnapshotStore();
    await store.load();
    expect(store.items).toEqual([]);
    expect(store.error).not.toBeNull();
  });
});
