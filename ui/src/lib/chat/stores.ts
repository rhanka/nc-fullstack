import { writable, type Writable } from 'svelte/store';

import type { ChatController, ChatTaskRole, ReferenceSources } from './contracts';

type PersistedValue = ReferenceSources | string | boolean | null;

function createLocalStorageStore<T extends PersistedValue>(
  key: string,
  initialValue: T,
  clean = false,
): Writable<T> {
  const storedValue =
    typeof localStorage === 'undefined' || clean ? null : localStorage.getItem(key);

  const store = writable<T>(
    storedValue ? (JSON.parse(storedValue) as T) : initialValue,
  );

  store.subscribe((value) => {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(key, JSON.stringify(value));
  });

  return store;
}

export const referencesList = createLocalStorageStore<ReferenceSources>('referencesList', {});

export function resetReferenceSources(): void {
  referencesList.set({});
}

export function clearReferenceSourceGroup(group: keyof ReferenceSources): void {
  referencesList.update((current) => ({
    ...current,
    [group]: undefined,
  }));
}

export const isUpdating = writable<false | ChatTaskRole>(false);
export const askForHelp = writable<false | ChatTaskRole>(false);
export const chatElementRef = writable<ChatController | null>(null);
export const defaultAction = writable('Propose task description');
export const showChatbot = writable(false);
