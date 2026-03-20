// ============================================
// SAE Tucumán - Content Script (ISOLATED world)
// ============================================

(() => {
  'use strict';

  // Intercepted data from the SAE app's own API calls
  let interceptedProceeding = null;
  let interceptedStories = null;

  // Captcha token received from MAIN world
  let lastCaptchaToken = null;
  let captchaWaiters = [];

  // Listen for messages from MAIN world
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'SAE_EXT_INTERCEPTED') {
      interceptedProceeding = event.data.proceeding || null;
      interceptedStories = event.data.stories || null;
      // Data intercepted from SAE app
    }
    if (event.data?.type === 'SAE_EXT_CAPTCHA_RESULT') {
      lastCaptchaToken = event.data.token || null;
      // Captcha token received
      // Resolve all waiters
      captchaWaiters.forEach(resolve => resolve(lastCaptchaToken));
      captchaWaiters = [];
    }
  });

  // ---- Message Handler (from popup) ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'GET_CURRENT_CASE':
        if (interceptedProceeding) {
          sendResponse({ caseData: interceptedProceeding, stories: interceptedStories });
        } else {
          setTimeout(() => {
            sendResponse({ caseData: interceptedProceeding, stories: interceptedStories });
          }, 1000);
        }
        return true;

      case 'GET_CAPTCHA_TOKEN':
        // The popup already injected inject-captcha.js into MAIN world before calling this.
        // Wait for the postMessage result.
        waitForCaptcha().then(token => sendResponse({ token }));
        return true;

      case 'SHOW_TOAST':
        showToast(msg.message, msg.toastType);
        return false;
    }
  });

  function waitForCaptcha() {
    return new Promise((resolve) => {
      // If we already have a recent token (within last 500ms from the injection), return it
      if (lastCaptchaToken) {
        const token = lastCaptchaToken;
        lastCaptchaToken = null; // consume it
        resolve(token);
        return;
      }
      // Otherwise wait for it
      captchaWaiters.push((token) => resolve(token));
      // Timeout after 8 seconds
      setTimeout(() => {
        const idx = captchaWaiters.indexOf(resolve);
        if (idx >= 0) captchaWaiters.splice(idx, 1);
        resolve(null);
      }, 8000);
    });
  }

  // ---- Toast ----
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.sae-ext-toast');
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.className = `sae-ext-toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // ---- Monitor URL changes ----
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      interceptedProceeding = null;
      interceptedStories = null;
      chrome.runtime.sendMessage({ type: 'URL_CHANGED', url: lastUrl }).catch(() => {});
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Content script loaded
})();
