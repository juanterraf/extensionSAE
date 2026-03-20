// ============================================
// SAE Tucumán - Background Service Worker
// API proxy + alarm-based case monitoring
// ============================================

const API_BASE = 'https://conexpbe.justucuman.gov.ar/api';
const ALARM_NAME = 'sae-monitor';
const CHECK_INTERVAL_MINUTES = 30;

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'API_GET':
      bgApiGet(msg.endpoint, msg.params)
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'API_POST':
      bgApiPost(msg.endpoint, msg.body)
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'DOWNLOAD_URL':
      bgDownloadUrl(msg.url)
        .then(data => sendResponse({ success: true, data }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'INJECT_CAPTCHA': {
      const tabId = sender.tab?.id;
      if (tabId) {
        chrome.scripting.executeScript({
          target: { tabId },
          files: ['content/inject-captcha.js'],
          world: 'MAIN',
        }).catch(() => {});
      }
      return false;
    }

    case 'UPDATE_MONITOR_ALARM':
      updateAlarm(msg.count || 0);
      return false;

    case 'URL_CHANGED':
      handleUrlChange(msg.url, sender.tab);
      return false;
  }
});

// ---- Alarm-based monitoring ----
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await checkAllFollowedCases();
  }
});

function updateAlarm(followedCount) {
  if (followedCount > 0) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
  } else {
    chrome.alarms.clear(ALARM_NAME);
  }
}

async function checkAllFollowedCases() {
  const data = await chrome.storage.local.get('sae_followed');
  const followed = data.sae_followed || [];
  if (!followed.length) return;

  let totalNew = 0;

  for (const f of followed) {
    try {
      const apiData = await bgApiGet('/proceedings/history', {
        proceeding: f.procid,
        jurisdiction: f.jurisdiction_id,
      });

      const stories = apiData?.stories || (Array.isArray(apiData) ? apiData : []);
      const maxHistid = stories.reduce((max, s) => Math.max(max, s.histid || 0), 0);
      const newCount = stories.filter(s => (s.histid || 0) > (f.last_histid || 0)).length;

      f.last_check = Date.now();
      if (stories.length > 0) {
        f.last_fecha = stories[0].fecha || f.last_fecha;
        f.last_dscr = stories[0].dscr || f.last_dscr;
      }

      if (newCount > 0) {
        f.new_count = (f.new_count || 0) + newCount;
        f.last_histid = maxHistid;
        totalNew += newCount;

        // Notify per case
        chrome.notifications.create(`sae-new-${f.procid}`, {
          type: 'basic',
          iconUrl: '/icons/icon128.png',
          title: `Exp. ${f.nro_expediente} - Nuevo movimiento`,
          message: `${newCount} nuevo(s): ${stories[0].dscr || 'Sin descripcion'} (${stories[0].fecha || ''})`,
          priority: 2,
        });
      }
    } catch (err) {
      // silently ignore check errors
    }

    // Delay between API calls
    await new Promise(r => setTimeout(r, 500));
  }

  // Save updated data
  await chrome.storage.local.set({ sae_followed: followed });

  // Update badge with total new count
  if (totalNew > 0) {
    chrome.action.setBadgeText({ text: String(totalNew) });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  }
}

// Click on notification -> open SAE portal
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('sae-new-')) {
    chrome.tabs.create({ url: 'https://consultaexpedientes.justucuman.gov.ar' });
  }
});

// ---- API GET ----
async function bgApiGet(endpoint, params = {}) {
  const url = new URL(`${API_BASE}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const resp = await fetch(url.toString(), {
    headers: { 'Accept': 'application/json' },
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();

  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    if (!json.success) throw new Error(json.message || 'Error del servidor');
    return json.data;
  }
  return json;
}

// ---- API POST ----
async function bgApiPost(endpoint, body = {}) {
  const url = `${API_BASE}${endpoint}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();

  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    if (!json.success) throw new Error(json.message || 'Error del servidor');
    return json.data;
  }
  return json;
}

// ---- Download URL as base64 ----
async function bgDownloadUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buffer = await resp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), type: resp.headers.get('content-type') || 'application/pdf', size: bytes.length };
}

// ---- URL Change Handler ----
function handleUrlChange(url, tab) {
  const isOnCase = url?.includes('/expediente/') && url?.includes('/historia');
  if (isOnCase) {
    chrome.action.setBadgeText({ text: '●', tabId: tab?.id });
    chrome.action.setBadgeBackgroundColor({ color: '#059669', tabId: tab?.id });
  } else if (url?.includes('consultaexpedientes.justucuman.gov.ar')) {
    chrome.action.setBadgeText({ text: '', tabId: tab?.id });
  }
}

// ---- On Install/Update ----
chrome.runtime.onInstalled.addListener(async (details) => {
  // Extension installed/updated
  // Restore alarm if there are followed cases
  const data = await chrome.storage.local.get('sae_followed');
  const count = (data.sae_followed || []).length;
  if (count > 0) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
    // Restored monitor alarm
  }
});
