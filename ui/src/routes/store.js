import { writable } from 'svelte/store';

function createLocalStorageStore(key, initialValue, clean = false) {
  const storedValue = clean ? null : localStorage.getItem(key);
  const store = writable(storedValue ? JSON.parse(storedValue) : initialValue);

  store.subscribe(value => {
    localStorage.setItem(key, JSON.stringify(value));
  });

  return store;
}

let myCreatedItem = null;

let history = {
  '000': [],
  '100': [],
  '200': [],
  '300': [],
  '400': [],
  '500': []
};

function initialCreatedItem() {
  history = {
    '000': [],
    '100': [],
    '200': [],
    '300': [],
    '400': [],
    '500': []
  };
  if (myCreatedItem) {
    ['000', '100', '200', '300', '400', '500'].forEach(task => {
      myCreatedItem.analysis_history[task] = history[task];
    });
  }
  return {
    currentTask: '000',
    ATA_code: "ATA-28",
    part_num: "ATA-281-15553-102",
    nc_event_id: "ATA-28-xxx",
    role: 'Quality Controler',
    name: "Eric Roy",
    nc_event_date: (new Date()).toISOString().replace(/T.*/, ""),
    analysis_history: {
      "000": history['000'],
      "100": history['100'],
      "200": history['200'],
      "300": history['300'],
      "400": history['400'],
      "500": history['500'],
    }
  }
}

export function resetCreatedItem() {
  createdItem.set(
    initialCreatedItem(
    )
  );
  referencesList.set('');
  try {
    myChatElementRef.clearMessages();
  } catch {
    console.log
  }
}
// Crée un store pour stocker les donn�es des �v�nements
export const createdItem = createLocalStorageStore('createdItem', initialCreatedItem());
export const referencesList = createLocalStorageStore('referencesList', '');
export const updateCreatedItem = writable(null);
export const taskLabel = {
  "000": "Non-Conformity Report",
  "100": "Task 100 - Analysis",
  "200": "Task 200 - Analysis Validation",
  "300": "Task 300 - Stress Analysis",
  "400": "Task 400 - Stress Analysis Validation",
  "500": "Task 500 - Final Analysis Validation"
}
export const isUpdating = writable(false);
export const askForHelp = writable(false);
export const accessToken = createLocalStorageStore('accessToken', '');

export const filteredNonConformities = writable([]);

export const chatElementRef = writable(null);
let myChatElementRef;

export const defaultAction = writable("Propose task description");

export const selectDoc = writable(null);
export const selectItem = writable(null);
export const activeTabValue = writable(1);
export const showChatbot = writable(false);

createdItem.subscribe(value => {
  myCreatedItem = value;
  ['000', '100', '200', '300', '400', '500'].forEach(task => {
    history[task] = myCreatedItem.analysis_history[task] || [];
  });
});

chatElementRef.subscribe(value => {
  myChatElementRef = value;
});