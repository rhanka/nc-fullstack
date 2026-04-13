import { writable, type Writable } from 'svelte/store';

export type ChatLayoutMode = 'floating' | 'docked';

const CHAT_LAYOUT_MODE_KEY = 'chatLayoutMode';

function readStoredLayoutMode(): ChatLayoutMode | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(CHAT_LAYOUT_MODE_KEY);
  if (raw === '\"docked\"' || raw === 'docked') {
    return 'docked';
  }
  if (raw === '\"floating\"' || raw === 'floating') {
    return 'floating';
  }

  try {
    const parsed = JSON.parse(raw ?? 'null');
    return parsed === 'docked' ? 'docked' : parsed === 'floating' ? 'floating' : null;
  } catch {
    return null;
  }
}

function createChatLayoutModeStore(): Writable<ChatLayoutMode> {
  const initialValue = readStoredLayoutMode() ?? 'floating';
  const store = writable<ChatLayoutMode>(initialValue);

  store.subscribe((value) => {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(CHAT_LAYOUT_MODE_KEY, JSON.stringify(value));
  });

  return store;
}

export const chatLayoutMode = createChatLayoutModeStore();
