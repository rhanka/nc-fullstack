import { writable } from 'svelte/store';

// Cr�e un store pour stocker les donn�es des �v�nements
export const createdItem = writable(null);
export const updateCreatedItem = writable(null);