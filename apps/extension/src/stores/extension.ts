import { defineStore } from 'pinia';

export const useExtensionStore = defineStore('extension', {
  state: () => ({ ready: true }),
});
