import { get, writable, type Writable } from 'svelte/store';

import { chatElementRef } from '../lib/chat/stores';
import { resetReferenceSources } from '../lib/chat/stores';

export const TASK_IDS = ['000', '100', '200', '300', '400', '500'] as const;

export type TaskId = (typeof TASK_IDS)[number];

export type AnalysisStep = {
  label?: string;
  description?: unknown;
  name?: string;
  role?: string;
  date?: string;
  previous?: unknown;
  next?: unknown;
  validated?: boolean;
  feedback?: string;
  undo?: AnalysisStep;
  redo?: AnalysisStep;
  [key: string]: unknown;
};

export type AnalysisHistory = Record<TaskId, AnalysisStep[]> & Record<string, AnalysisStep[]>;

export type CreatedItem = {
  currentTask: TaskId;
  ATA_code: string;
  part_num: string;
  nc_event_id: string;
  role: string;
  name: string;
  nc_event_date: string;
  analysis_history: AnalysisHistory;
  [key: string]: unknown;
};

export type UpdateCreatedItemPayload = {
  role: TaskId | string;
  label?: string;
  description?: unknown;
} | null;

export type NonConformityRecord = {
  doc?: string;
  nc_event_id?: string;
  ATA_code?: string;
  ATA_category?: string;
  analysis_history?: Record<string, AnalysisStep[]>;
  highlights?: string[];
  [key: string]: unknown;
};

export type SelectedDoc = {
  doc: string;
  [key: string]: unknown;
} | null;

export type SelectedItem = NonConformityRecord | null;

function createLocalStorageStore<T>(key: string, initialValue: T, clean = false): Writable<T> {
  const storedValue =
    typeof localStorage === 'undefined' || clean ? null : localStorage.getItem(key);
  const store = writable<T>(storedValue ? (JSON.parse(storedValue) as T) : initialValue);

  store.subscribe((value) => {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(key, JSON.stringify(value));
  });

  return store;
}

function createEmptyHistory(): AnalysisHistory {
  return {
    '000': [],
    '100': [],
    '200': [],
    '300': [],
    '400': [],
    '500': [],
  };
}

let myCreatedItem: CreatedItem | null = null;
let history: AnalysisHistory = createEmptyHistory();

function initialCreatedItem(): CreatedItem {
  history = createEmptyHistory();

  if (myCreatedItem) {
    for (const task of TASK_IDS) {
      myCreatedItem.analysis_history[task] = history[task];
    }
  }

  return {
    currentTask: '000',
    ATA_code: 'ATA-28',
    part_num: 'ATA-281-15553-102',
    nc_event_id: 'ATA-28-xxx',
    role: 'Quality Controler',
    name: 'Eric Roy',
    nc_event_date: new Date().toISOString().replace(/T.*/, ''),
    analysis_history: {
      '000': history['000'],
      '100': history['100'],
      '200': history['200'],
      '300': history['300'],
      '400': history['400'],
      '500': history['500'],
    },
  };
}

export function resetCreatedItem(): void {
  createdItem.set(initialCreatedItem());
  resetReferenceSources();

  try {
    get(chatElementRef)?.clearMessages?.();
  } catch {
    // Ignore teardown issues while resetting the local draft state.
  }
}

export const createdItem = createLocalStorageStore<CreatedItem>('createdItem', initialCreatedItem());
export const updateCreatedItem = writable<UpdateCreatedItemPayload>(null);
export const taskLabel: Record<TaskId, string> = {
  '000': 'Non-Conformity Report',
  '100': 'Task 100 - Analysis',
  '200': 'Task 200 - Analysis Validation',
  '300': 'Task 300 - Stress Analysis',
  '400': 'Task 400 - Stress Analysis Validation',
  '500': 'Task 500 - Final Analysis Validation',
};
export const accessToken = createLocalStorageStore<string | null>('accessToken', '');

export const filteredNonConformities = writable<NonConformityRecord[]>([]);

export const selectDoc = writable<SelectedDoc>(null);
export const selectItem = writable<SelectedItem>(null);
export const activeTabValue = writable<number>(1);

createdItem.subscribe((value) => {
  myCreatedItem = value;

  for (const task of TASK_IDS) {
    history[task] = value.analysis_history[task] ?? [];
  }
});
