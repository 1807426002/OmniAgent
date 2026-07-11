export default defineContentScript({
  matches: ['<all_urls>'],
  main() {
    // Site-specific behavior will be supplied by site adapters in a later phase.
    console.debug('[OmniAgent] content script ready', window.location.hostname);
  },
});
