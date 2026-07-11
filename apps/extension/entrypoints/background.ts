export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    console.info('[OmniAgent] background service worker installed');
  });
});
