// ============================================
// NotebookLM Bridge - Injected into NotebookLM tab
// Executes API calls using the page's session context
// ============================================

(function() {
  'use strict';

  // Extract session parameters from the page
  function getSessionParams() {
    // The 'at' CSRF token is in a script tag or the WIZ_global_data object
    let at = null;
    let fsid = null;
    let bl = null;

    // Method 1: WIZ_global_data (most reliable)
    if (window.WIZ_global_data) {
      at = window.WIZ_global_data.SNlM0e;
      fsid = window.WIZ_global_data.FdrFJe;
      bl = window.WIZ_global_data.cfb2h;
    }

    // Method 2: Parse from script tags
    if (!at) {
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (!text) continue;

        const atMatch = text.match(/SNlM0e['"]\s*:\s*['"](.*?)['"]/);
        if (atMatch) at = atMatch[1];

        const sidMatch = text.match(/FdrFJe['"]\s*:\s*['"](.*?)['"]/);
        if (sidMatch) fsid = sidMatch[1];

        const blMatch = text.match(/cfb2h['"]\s*:\s*['"](.*?)['"]/);
        if (blMatch) bl = blMatch[1];

        if (at && fsid && bl) break;
      }
    }

    // Method 3: Look in the page HTML directly
    if (!at) {
      const html = document.documentElement.innerHTML;
      const atMatch = html.match(/"SNlM0e":"(.*?)"/);
      if (atMatch) at = atMatch[1];
      const sidMatch = html.match(/"FdrFJe":"(.*?)"/);
      if (sidMatch) fsid = sidMatch[1];
      const blMatch = html.match(/"cfb2h":"(.*?)"/);
      if (blMatch) bl = blMatch[1];
    }

    return { at, fsid, bl };
  }

  // Make a batchexecute RPC call
  async function batchExecute(rpcId, payload, extraHeaders = {}) {
    const params = getSessionParams();
    if (!params.at) throw new Error('No se pudo obtener el token CSRF de NotebookLM');

    const sourcePath = window.location.pathname;
    const url = `/_/LabsTailwindUi/data/batchexecute?rpcids=${rpcId}&source-path=${encodeURIComponent(sourcePath)}&bl=${encodeURIComponent(params.bl)}&f.sid=${encodeURIComponent(params.fsid)}&hl=es&_reqid=${Math.floor(Math.random() * 900000) + 100000}&rt=c`;

    const body = `f.req=${encodeURIComponent(JSON.stringify([[
      [rpcId, JSON.stringify(payload), null, "generic"]
    ]]))}&at=${encodeURIComponent(params.at)}&`;

    const headers = {
      'X-Same-Domain': '1',
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      ...extraHeaders,
    };

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      credentials: 'include',
      body,
    });

    if (!resp.ok) throw new Error(`NotebookLM API error: ${resp.status}`);

    const text = await resp.text();
    // Response starts with )]}' followed by data
    return parseBatchResponse(text);
  }

  // Parse batchexecute response format
  function parseBatchResponse(rawText) {
    // Remove the protection prefix
    let text = rawText.replace(/^\)\]\}'/, '').trim();

    // The format is: length\n[json_array]\nlength\n[json_array]...
    const results = [];
    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      if (/^\d+$/.test(line)) {
        // Next line(s) contain the JSON
        i++;
        let jsonStr = '';
        // Accumulate lines until we have the full JSON
        while (i < lines.length && !/^\d+$/.test(lines[i].trim())) {
          jsonStr += lines[i];
          i++;
        }
        if (jsonStr.trim()) {
          try {
            const parsed = JSON.parse(jsonStr);
            results.push(parsed);
          } catch {}
        }
      } else {
        i++;
      }
    }

    // Extract the actual data from the wrb.fr wrapper
    for (const result of results) {
      if (Array.isArray(result)) {
        for (const item of result) {
          if (Array.isArray(item) && item[0] === 'wrb.fr') {
            try {
              return JSON.parse(item[2]);
            } catch {
              return item[2];
            }
          }
        }
      }
    }

    return results;
  }

  // ---- Public API Functions ----

  // Create a new notebook
  async function createNotebook() {
    // CCqFvf: create notebook RPC
    // Payload: ["", null, null, [2], [1,null,null,null,null,null,null,null,null,null,[1]]]
    const result = await batchExecute('CCqFvf', [
      "", null, null, [2], [1, null, null, null, null, null, null, null, null, null, [1]]
    ]);

    // Result: ["", null, "project-uuid", ...]
    const projectId = result?.[2];
    if (!projectId) throw new Error('No se pudo crear el notebook');
    return projectId;
  }

  // Rename a notebook
  async function renameNotebook(projectId, title) {
    // rLM1Ne with title parameter
    try {
      await batchExecute('rLM1Ne', [projectId, null, [2], null, 0]);
      // We'll set the title through a separate call if needed
      // For now, creating with a source that has the title is enough
    } catch {}
  }

  // Add a text source (Copied Text)
  async function addTextSource(projectId, title, textContent) {
    // izAoDd: add inline text source
    // Payload: [[[null, [title, textContent]], null, projectId, 1]]
    const textLength = new TextEncoder().encode(textContent).length;

    const result = await batchExecute('izAoDd', [
      [[null, [title, textContent]], null, projectId, 1]
    ], {
      'x-goog-ext-353267353-jspb': `[null,null,null,${textLength}]`,
    });

    return result;
  }

  // Upload a PDF file (2-step resumable upload)
  async function uploadPdf(projectId, filename, pdfBytes) {
    const params = getSessionParams();
    if (!params.at) throw new Error('No se pudo obtener token CSRF');

    const size = pdfBytes.byteLength || pdfBytes.length;

    // Step 1: Initiate resumable upload
    const initPayload = `f.req=${encodeURIComponent(JSON.stringify([[
      ["q83me", JSON.stringify([[projectId], null, [[[filename, size]], 1]]), null, "generic"]
    ]]))}&at=${encodeURIComponent(params.at)}&`;

    const initResp = await fetch('/_/LabsTailwindUi/upload', {
      method: 'POST',
      headers: {
        'X-Same-Domain': '1',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Header-Content-Length': String(size),
        'X-Goog-Upload-Header-Content-Type': 'application/pdf',
        'X-Goog-Upload-Command': 'start',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
      },
      credentials: 'include',
      body: initPayload,
    });

    if (!initResp.ok) throw new Error(`Upload init failed: ${initResp.status}`);

    // Get the upload URL from response header
    const uploadUrl = initResp.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error('No upload URL returned');

    // Step 2: Upload the actual bytes
    const uploadResp = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
        'Content-Type': 'application/pdf',
      },
      credentials: 'include',
      body: pdfBytes,
    });

    if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);

    return true;
  }

  // ---- Message Handler ----
  // Listen for messages from the extension popup/background
  window.__SAE_NLM_BRIDGE = {
    getSessionParams,
    createNotebook,
    renameNotebook,
    addTextSource,
    uploadPdf,
    ready: true,
  };

  // Signal that the bridge is ready
  window.dispatchEvent(new CustomEvent('sae-nlm-bridge-ready'));
})();
