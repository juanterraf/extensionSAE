// ============================================
// SAE Tucumán - Popup Controller
// ============================================

const API_BASE = 'https://conexpbe.justucuman.gov.ar/api';

// State
let state = {
  centers: [],
  jurisdictions: [],
  currentCase: null,
  searchResults: [],
  searchPage: 1,
  history: [],
  tramites: [],
  preloadedStories: null,
  // Monitor
  followed: [],
  monitorReports: [],
  // Import
  importData: [],
  importHeaders: [],
  importResults: [],
  importRunning: false,
  importCancelled: false,
};

// ---- DOM Elements ----
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ---- Init ----
document.addEventListener('DOMContentLoaded', async () => {
  initTabs();
  await loadHistory();
  await loadFollowed();
  await loadCenters();
  checkCurrentPage();
  initEventListeners();
  initMonitorListeners();
  initImportListeners();
  initAIListeners();

  // Footer link opens in new tab
  $$('.status-bar a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: a.href });
    });
  });
});

// ---- Tabs ----
function initTabs() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Make links in info tab open in new window
  $$('#tab-info a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: a.href });
    });
  });
}

// ---- Event Listeners ----
function initEventListeners() {
  $('#sel-center').addEventListener('change', onCenterChange);
  $('#sel-jurisdiction').addEventListener('change', validateSearchForm);
  $('#inp-number').addEventListener('input', validateSearchForm);
  $('#inp-actor').addEventListener('input', validateSearchForm);
  $('#inp-accused').addEventListener('input', validateSearchForm);
  $('#btn-search').addEventListener('click', doSearch);
  $('#btn-follow-case').addEventListener('click', toggleFollowCurrentCase);
  $('#btn-summary-last').addEventListener('click', () => generateSummary('last'));
  $('#btn-summary-full').addEventListener('click', () => generateSummary('full'));
  $('#btn-download-all').addEventListener('click', downloadAll);
  $('#btn-send-notebooklm').addEventListener('click', sendToNotebookLM);
  $('#btn-copy-summary').addEventListener('click', copySummary);
  $('#btn-load-more').addEventListener('click', loadMore);

  // Enter key in search inputs
  $$('#tab-search input').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$('#btn-search').disabled) doSearch();
    });
  });
}

// ---- API Helpers ----
// All API calls go through the background service worker to avoid CORS issues.
// The background SW has host_permissions and isn't subject to page CORS policies.

async function apiGet(endpoint, params = {}) {
  setStatus('Consultando...', 'loading');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'API_GET',
      endpoint,
      params,
    });

    if (!response.success) {
      throw new Error(response.error || 'Error desconocido');
    }

    return response.data;
  } catch (err) {
    // API error
    throw err;
  } finally {
    setStatus('Listo', 'online');
  }
}

// Send message to content script in any SAE tab
async function sendToContentScript(msg) {
  const tab = await findSaeTab();
  if (!tab?.id) {
    throw new Error('No hay pestaña SAE abierta');
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // Content script not loaded - inject it
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/content-script.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['content/content-style.css'],
    });
    await new Promise(r => setTimeout(r, 300));
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

// API POST via background (for download endpoints)
async function apiPost(endpoint, body = {}) {
  const response = await chrome.runtime.sendMessage({
    type: 'API_POST',
    endpoint,
    body,
  });
  if (!response.success) throw new Error(response.error || 'Error desconocido');
  return response.data;
}

// Download a URL via background and return base64 data
async function downloadUrl(url) {
  const response = await chrome.runtime.sendMessage({
    type: 'DOWNLOAD_URL',
    url,
  });
  if (!response.success) throw new Error(response.error || 'Error descargando');
  return response.data; // { base64, type, size }
}

// Get reCAPTCHA token from the page (needed for search)
async function findSaeTab() {
  const allTabs = await chrome.tabs.query({ url: 'https://consultaexpedientes.justucuman.gov.ar/*' });
  if (!allTabs.length) return null;
  // Prefer a tab on a buscador page (has the reCAPTCHA widget)
  const buscadorTab = allTabs.find(t => t.url.includes('/buscador'));
  return buscadorTab || allTabs[0];
}

async function getCaptchaToken() {
  try {
    const tab = await findSaeTab();
    if (!tab?.id) {
      // No SAE tab found
      return null;
    }

    // Ensure content script is loaded (injects if missing)
    await ensureContentScript(tab.id);

    // Tell content script to start waiting for the captcha postMessage
    const tokenPromise = chrome.tabs.sendMessage(tab.id, { type: 'GET_CAPTCHA_TOKEN' });

    // Inject captcha execution into MAIN world (reCAPTCHA v2 Invisible)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: () => {
        try {
          if (typeof grecaptcha === 'undefined' || !grecaptcha.execute) {
            window.postMessage({ type: 'SAE_EXT_CAPTCHA_RESULT', token: null }, '*');
            return;
          }

          var widgetId = null;
          if (window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients) {
            var clientKeys = Object.keys(window.___grecaptcha_cfg.clients);
            if (clientKeys.length > 0) widgetId = parseInt(clientKeys[0]);
          }
          if (widgetId === null) {
            var ta = document.querySelectorAll('textarea[name="g-recaptcha-response"]');
            if (ta.length > 0) widgetId = 0;
          }

          if (widgetId === null) {
            window.postMessage({ type: 'SAE_EXT_CAPTCHA_RESULT', token: null }, '*');
            return;
          }

          try { grecaptcha.reset(widgetId); } catch(e) {}

          var checkInterval = setInterval(function() {
            try {
              var token = grecaptcha.getResponse(widgetId);
              if (token) {
                clearInterval(checkInterval);
                window.postMessage({ type: 'SAE_EXT_CAPTCHA_RESULT', token: token }, '*');
              }
            } catch(e) {
              clearInterval(checkInterval);
              window.postMessage({ type: 'SAE_EXT_CAPTCHA_RESULT', token: null }, '*');
            }
          }, 200);

          setTimeout(function() { clearInterval(checkInterval); }, 10000);
          grecaptcha.execute(widgetId);
        } catch(e) {
          window.postMessage({ type: 'SAE_EXT_CAPTCHA_RESULT', token: null }, '*');
        }
      },
    });

    const response = await tokenPromise;
    // Token obtained or null
    return response?.token || null;
  } catch (err) {
    // Captcha error
    return null;
  }
}

// Ensure content script is injected in the tab
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SHOW_TOAST', message: '', toastType: 'ping' });
  } catch {
    // Content script not loaded - inject it
    // Injecting content script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content-script.js'],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/content-style.css'],
    });
    await new Promise(r => setTimeout(r, 300));
  }
}

// ---- Load Centers ----
async function loadCenters() {
  try {
    const centers = await apiGet('/centers');
    state.centers = Array.isArray(centers) ? centers : [];
    const sel = $('#sel-center');
    sel.innerHTML = '<option value="">Seleccione un centro</option>';
    state.centers.forEach(c => {
      sel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
  } catch {
    $('#sel-center').innerHTML = '<option value="">Error al cargar centros</option>';
  }
}

// ---- Center Change -> Load Jurisdictions ----
async function onCenterChange() {
  const centerId = $('#sel-center').value;
  const sel = $('#sel-jurisdiction');

  if (!centerId) {
    sel.innerHTML = '<option value="">Seleccione un centro primero</option>';
    validateSearchForm();
    return;
  }

  try {
    sel.innerHTML = '<option value="">Cargando fueros...</option>';
    const jurisdictions = await apiGet('/jurisdictions', { center: centerId });
    state.jurisdictions = Array.isArray(jurisdictions) ? jurisdictions : [];
    sel.innerHTML = '<option value="">Seleccione un fuero</option>';
    state.jurisdictions.forEach(j => {
      // Only show public jurisdictions (is_public === 1)
      if (j.is_public === 0) return;
      sel.innerHTML += `<option value="${j.id}" data-slug="${j.slug}">${j.name}</option>`;
    });
  } catch {
    sel.innerHTML = '<option value="">Error al cargar fueros</option>';
  }
  validateSearchForm();
}

// ---- Form Validation ----
function validateSearchForm() {
  const jurisdiction = $('#sel-jurisdiction').value;
  const number = $('#inp-number').value.trim();
  const actor = $('#inp-actor').value.trim();
  const accused = $('#inp-accused').value.trim();

  const hasSearch = number || actor || accused;
  $('#btn-search').disabled = !(jurisdiction && hasSearch);
}

// ---- Search ----
async function doSearch() {
  const jurisdiction = $('#sel-jurisdiction').value;
  const number = $('#inp-number').value.trim();
  const actor = $('#inp-actor').value.trim();
  const accused = $('#inp-accused').value.trim();

  if (!jurisdiction) return;

  state.searchPage = 1;
  state.searchResults = [];

  const btn = $('#btn-search');
  btn.querySelector('.btn-text').classList.add('hidden');
  btn.querySelector('.btn-loading').classList.remove('hidden');
  btn.disabled = true;

  try {
    const captcha = await getCaptchaToken();
    const data = await apiGet('/proceedings', {
      jurisdiction,
      number,
      actor,
      accused,
      page: 1,
      captcha,
    });

    const results = Array.isArray(data) ? data : [];
    // Inject jurisdiction_id into each result if missing (from the search form)
    const selJurisdiction = $('#sel-jurisdiction').value;
    const selJurisdictionSlug = $('#sel-jurisdiction').selectedOptions[0]?.dataset?.slug || '';
    results.forEach(r => {
      if (!r.jurisdiction_id) r.jurisdiction_id = selJurisdiction;
      if (!r.jurisdiction_slug) r.jurisdiction_slug = selJurisdictionSlug;
    });
    state.searchResults = results;
    renderSearchResults(results);
  } catch (err) {
    showToast('Error en la búsqueda: ' + err.message, 'error');
  } finally {
    btn.querySelector('.btn-text').classList.remove('hidden');
    btn.querySelector('.btn-loading').classList.add('hidden');
    validateSearchForm();
  }
}

async function loadMore() {
  state.searchPage++;
  try {
    const jurisdiction = $('#sel-jurisdiction').value;
    const captcha = await getCaptchaToken();
    const data = await apiGet('/proceedings', {
      jurisdiction,
      number: $('#inp-number').value.trim(),
      actor: $('#inp-actor').value.trim(),
      accused: $('#inp-accused').value.trim(),
      page: state.searchPage,
      captcha,
    });
    const results = Array.isArray(data) ? data : [];
    const selJurisdiction = $('#sel-jurisdiction').value;
    const selJurisdictionSlug = $('#sel-jurisdiction').selectedOptions[0]?.dataset?.slug || '';
    results.forEach(r => {
      if (!r.jurisdiction_id) r.jurisdiction_id = selJurisdiction;
      if (!r.jurisdiction_slug) r.jurisdiction_slug = selJurisdictionSlug;
    });
    state.searchResults.push(...results);
    renderSearchResults(state.searchResults);
  } catch {
    showToast('Error al cargar más resultados', 'error');
  }
}

// ---- Render Search Results ----
function renderSearchResults(results) {
  const container = $('#results-list');
  const emptyEl = $('#search-empty');
  const resultsEl = $('#search-results');

  if (!results.length) {
    resultsEl.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  resultsEl.classList.remove('hidden');

  container.innerHTML = results.map(r => `
    <div class="result-card" data-procid="${r.procid}" data-case='${JSON.stringify(r).replace(/'/g, "&#39;")}'>
      <div class="result-card-header">
        <span class="result-card-number">Exp. ${r.nro_expediente || r.numero || ''}</span>
        <span class="result-card-type">${r.tipo_proceso || ''}</span>
      </div>
      <div class="result-card-title">${r.caratula || ''}</div>
      <div class="result-card-court">${r.juzgado?.dscr || ''}</div>
    </div>
  `).join('');

  // Click handlers
  container.querySelectorAll('.result-card').forEach(card => {
    card.addEventListener('click', () => {
      const caseData = JSON.parse(card.dataset.case);
      openCase(caseData);
    });
  });

  // Show/hide load more
  $('#btn-load-more').classList.toggle('hidden', results.length % 20 !== 0 || results.length === 0);
}

// ---- Open Case ----
async function openCase(caseData, preloadedStories) {
  // Opening case
  state.currentCase = caseData;
  // If stories were passed in (from interception), store them
  if (preloadedStories) {
    state.preloadedStories = preloadedStories;
  }

  // Switch to current tab
  $$('.tab').forEach(t => t.classList.remove('active'));
  $$('.tab-content').forEach(c => c.classList.remove('active'));
  $$('.tab')[1].classList.add('active');
  $('#tab-current').classList.add('active');

  // Show case info
  $('#current-empty').classList.add('hidden');
  $('#current-case').classList.remove('hidden');

  $('#case-title').textContent = caseData.caratula || 'Sin carátula';
  $('#case-number').textContent = `Exp. ${caseData.nro_expediente || caseData.numero || ''}`;
  $('#case-actor').textContent = caseData.actor || caseData.acto || '-';
  $('#case-accused').textContent = caseData.demandado || caseData.dema || '-';
  $('#case-court').textContent = caseData.juzgado?.dscr || '-';
  $('#case-type').textContent = caseData.tipo_proceso || '-';

  // Hide previous sections
  $('#summary-section').classList.add('hidden');
  $('#tramites-section').classList.add('hidden');
  $('#download-progress').classList.add('hidden');

  // Save to history
  saveToHistory(caseData);

  // Update follow button state
  updateFollowButton();

  // Load tramites
  await loadTramites(caseData);
}

// ---- Load Tramites ----
async function loadTramites(caseData) {
  try {
    setStatus('Cargando trámites...', 'loading');

    // Check for preloaded stories (from fetch interception)
    if (state.preloadedStories) {
      // Using preloaded stories
      state.tramites = state.preloadedStories;
      state.preloadedStories = null;
      renderTramites(state.tramites);
      setStatus(`${state.tramites.length} trámites cargados`, 'online');
      return;
    }

    // Resolve jurisdiction_id: from case data, or from the search form selector
    const jurisdictionId = caseData.jurisdiction_id
      || caseData.jurisdictionId
      || $('#sel-jurisdiction')?.value
      || '';

    const proceedingId = caseData.procid || caseData.proceeding || '';

    // Loading tramites

    if (!proceedingId || !jurisdictionId) {
      showToast('Faltan datos del expediente (procid o jurisdicción)', 'error');
      setStatus('Error', 'offline');
      return;
    }

    const data = await apiGet('/proceedings/history', {
      proceeding: proceedingId,
      jurisdiction: jurisdictionId,
    });

    // API returns { proceeding: {...}, stories: [...] } inside the data envelope
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // Update case info with full data from the API
      if (data.proceeding) {
        state.currentCase = { ...state.currentCase, ...data.proceeding };
        updateCaseUI(state.currentCase);
      }
      state.tramites = Array.isArray(data.stories) ? data.stories : [];
    } else {
      state.tramites = Array.isArray(data) ? data : [];
    }

    renderTramites(state.tramites);
    setStatus(`${state.tramites.length} trámites cargados`, 'online');
  } catch (err) {
    // Error loading tramites
    showToast('Error al cargar trámites: ' + err.message, 'error');
    setStatus('Error', 'offline');
  }
}

// Update case UI with fresh data
function updateCaseUI(caseData) {
  $('#case-title').textContent = caseData.caratula || 'Sin carátula';
  $('#case-number').textContent = `Exp. ${caseData.nro_expediente || ''}`;
  $('#case-actor').textContent = caseData.actor || caseData.acto || '-';
  $('#case-accused').textContent = caseData.demandado || caseData.dema || '-';
  $('#case-court').textContent = caseData.juzgado?.dscr || '-';
  $('#case-type').textContent = caseData.tipo_proceso || '-';
}

// ---- Render Tramites ----
function renderTramites(tramites) {
  if (!tramites.length) {
    $('#tramites-section').classList.remove('hidden');
    $('#tramites-list').innerHTML = '<div class="empty-state"><p>No se encontraron trámites</p></div>';
    return;
  }

  $('#tramites-section').classList.remove('hidden');
  const container = $('#tramites-list');

  container.innerHTML = tramites.map((t, i) => {
    // archivos can be null or an array
    const archivos = Array.isArray(t.archivos) ? t.archivos : [];
    const filesHtml = archivos.map(a =>
      `<a class="tramite-file" href="#" data-histid="${t.histid}" data-filename="${a.nombre}.${a.extension}">
        📄 ${a.nombre}.${a.extension}
      </a>`
    ).join('');

    // fecha comes as "DD/MM/YYYY" string directly from the API
    const fechaDisplay = t.fecha || t.fechaFirma || 'S/F';

    return `
      <div class="tramite-card">
        <div class="tramite-header" data-index="${i}">
          <span class="tramite-date">${fechaDisplay}</span>
          <span class="tramite-desc">${escapeHtml(t.dscr || '')}</span>
          <span class="tramite-toggle">▼</span>
        </div>
        <div class="tramite-body" data-index="${i}" data-histid="${t.histid}" data-loaded="${t.texto ? 'true' : 'false'}">
          <div class="tramite-text-content">${t.texto ? `<div class="tramite-text tramite-html">${t.texto}</div>` : '<em style="color:var(--text-muted)">Click para cargar texto...</em>'}</div>
          ${t.firm ? `<div style="margin-top:6px;font-size:11px;color:var(--text-muted)">Firmado: ${t.fechaFirma || 'Si'}</div>` : ''}
          ${filesHtml ? `<div class="tramite-files">${filesHtml}</div>` : ''}
          ${t.vinculos?.length ? `<div style="margin-top:6px;font-size:11px;color:var(--accent)">${t.vinculos.length} vinculo(s)</div>` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Toggle handlers - load text on first expand
  container.querySelectorAll('.tramite-header').forEach(header => {
    header.addEventListener('click', async () => {
      const idx = header.dataset.index;
      const body = container.querySelector(`.tramite-body[data-index="${idx}"]`);
      const toggle = header.querySelector('.tramite-toggle');
      body.classList.toggle('open');
      toggle.classList.toggle('open');

      // Load text on first open if not already loaded
      if (body.classList.contains('open') && body.dataset.loaded !== 'true') {
        const histid = body.dataset.histid;
        const textEl = body.querySelector('.tramite-text-content');
        textEl.innerHTML = '<em style="color:var(--text-muted)">Cargando texto...</em>';

        const html = await getTramiteText(state.currentCase, histid);
        if (html) {
          // Render HTML safely in a sandboxed div
          textEl.innerHTML = `<div class="tramite-text tramite-html">${html}</div>`;
          // Cache in state
          const tramite = state.tramites[parseInt(idx)];
          if (tramite) tramite.texto = html;
        } else {
          textEl.innerHTML = '<em style="color:var(--text-muted)">Sin texto</em>';
        }
        body.dataset.loaded = 'true';
      }
    });
  });

  // File download handlers
  container.querySelectorAll('.tramite-file').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      downloadSingleFile(link.dataset.histid, link.dataset.filename);
    });
  });
}

// ---- Generate Summary ----
async function generateSummary(type) {
  if (!state.currentCase || !state.tramites.length) {
    showToast('No hay trámites para resumir', 'error');
    return;
  }

  const btn = type === 'last' ? $('#btn-summary-last') : $('#btn-summary-full');
  const originalText = btn.textContent;
  btn.textContent = 'Generando resumen...';
  btn.disabled = true;

  try {
    let summary = '';
    let title = '';

    // Fetch texts that haven't been loaded yet
    const toFetch = type === 'last'
      ? [state.tramites[0]].filter(t => !t.texto && t.link)
      : state.tramites.filter(t => !t.texto && t.link);

    if (toFetch.length > 0) {
      btn.textContent = `Cargando textos (0/${toFetch.length})...`;
      for (let i = 0; i < toFetch.length; i++) {
        btn.textContent = `Cargando textos (${i + 1}/${toFetch.length})...`;
        toFetch[i].texto = await getTramiteText(state.currentCase, toFetch[i].histid);
      }
    }

    if (type === 'last') {
      title = 'Resumen - Ultimo Tramite';
      const lastTramite = state.tramites[0];
      summary = buildLastTramiteSummary(lastTramite);
    } else {
      title = 'Informe General de la Causa';
      summary = buildFullCaseSummary(state.currentCase, state.tramites);
    }

    $('#summary-title').textContent = title;
    $('#summary-content').textContent = summary;
    $('#summary-section').classList.remove('hidden');
    $('#summary-section').scrollIntoView({ behavior: 'smooth' });
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

function buildLastTramiteSummary(tramite) {
  const lines = [];
  lines.push(`FECHA: ${tramite.fecha || tramite.fechaFirma || 'N/D'}`);
  lines.push(`TIPO: ${tramite.dscr || 'Sin descripcion'}`);
  if (tramite.firm) {
    lines.push(`FIRMADO: ${tramite.fechaFirma || 'Si'}`);
  }
  lines.push('');

  if (tramite.texto) {
    lines.push('── CONTENIDO ──');
    lines.push(htmlToPlainText(tramite.texto));
    lines.push('');
  }

  const archivos = Array.isArray(tramite.archivos) ? tramite.archivos : [];
  if (archivos.length) {
    lines.push(`ARCHIVOS ADJUNTOS (${archivos.length}):`);
    archivos.forEach(a => {
      lines.push(`   - ${a.nombre}.${a.extension}`);
    });
    lines.push('');
  }

  if (tramite.vinculos?.length) {
    lines.push('EXPEDIENTES VINCULADOS:');
    tramite.vinculos.forEach(v => {
      lines.push(`   - ${v.fuero} - ${v.numero}: ${v.descripcion}`);
    });
  }

  return lines.join('\n');
}

function buildFullCaseSummary(caseData, tramites) {
  const lines = [];

  // Header
  lines.push('═══════════════════════════════════════');
  lines.push('     INFORME GENERAL DE LA CAUSA');
  lines.push('═══════════════════════════════════════');
  lines.push('');
  lines.push(`EXPEDIENTE: ${caseData.nro_expediente || 'N/D'}`);
  lines.push(`CARÁTULA: ${caseData.caratula || 'N/D'}`);
  lines.push(`ACTOR: ${caseData.acto || caseData.actor || 'N/D'}`);
  lines.push(`DEMANDADO: ${caseData.dema || caseData.demandado || 'N/D'}`);
  lines.push(`JUZGADO: ${caseData.juzgado?.dscr || 'N/D'}`);
  lines.push(`TIPO DE PROCESO: ${caseData.tipo_proceso || 'N/D'}`);
  lines.push('');

  // Statistics
  lines.push('── ESTADÍSTICAS ──');
  lines.push(`Total de trámites: ${tramites.length}`);

  if (tramites.length > 0) {
    // fecha comes as "DD/MM/YYYY" - use fech (YYYYMMDD) for sorting
    const sortedByDate = [...tramites].filter(t => t.fech).sort((a, b) => a.fech.localeCompare(b.fech));
    if (sortedByDate.length) {
      lines.push(`Primer trámite: ${sortedByDate[0].fecha}`);
      lines.push(`Último trámite: ${sortedByDate[sortedByDate.length - 1].fecha}`);
    }

    const totalFiles = tramites.reduce((acc, t) => acc + (Array.isArray(t.archivos) ? t.archivos.length : 0), 0);
    lines.push(`Total de archivos adjuntos: ${totalFiles}`);
  }

  lines.push('');
  lines.push('── CRONOLOGÍA DE TRÁMITES ──');
  lines.push('');

  // All tramites - description and date only, no full text
  tramites.forEach((t, i) => {
    const archivos = Array.isArray(t.archivos) ? t.archivos : [];
    const extras = [];
    if (t.firm) extras.push('Firmado');
    if (archivos.length) extras.push(`${archivos.length} archivo(s)`);
    const suffix = extras.length ? ` [${extras.join(', ')}]` : '';
    lines.push(`[${i + 1}] ${t.fecha || 'S/F'} - ${t.dscr || 'Sin descripcion'}${suffix}`);
  });

  // Estado actual (last tramite by date)
  if (tramites.length > 0) {
    const sorted = [...tramites].filter(t => t.fech).sort((a, b) => b.fech.localeCompare(a.fech));
    const last = sorted[0] || tramites[0];
    lines.push('── ESTADO ACTUAL ──');
    lines.push(`Último movimiento: ${last.fecha || 'N/D'}`);
    lines.push(`Tipo: ${last.dscr || 'N/D'}`);
    if (last.texto) {
      lines.push(`Detalle: ${htmlToPlainText(last.texto).substring(0, 500)}`);
    }
  }

  return lines.join('\n');
}

// ---- Get tramite text content ----
// /proceedings/history/text returns { history: { texto: "<html>...", ...}, registry: ... }
// The texto field contains HTML that we need to handle.
async function getTramiteText(caseData, histid) {
  try {
    const data = await apiGet('/proceedings/history/text', {
      jurisdiction: String(caseData.jurisdiction_id),
      proceeding: String(caseData.procid),
      history: String(histid),
    });
    // Response structure: { history: { texto: "...", ... }, registry: ... }
    let html = null;
    if (data?.history?.texto) {
      html = data.history.texto;
    } else if (data?.texto) {
      html = data.texto;
    } else if (typeof data === 'string') {
      html = data;
    }
    if (!html) return null;
    return html; // Return raw HTML, we'll render or strip as needed
  } catch {
    return null;
  }
}

// Convert HTML to plain text (for summaries, TXT export)
function htmlToPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  // Replace <br> and <p> with newlines
  div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  div.querySelectorAll('p').forEach(p => {
    p.insertAdjacentText('afterend', '\n');
  });
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

// ---- Download helpers ----
// Get PDF URL for a tramite's text content
async function getTramitePdfUrl(caseData, histid) {
  const data = await apiPost('/proceedings/history/text/download', {
    jurisdiction: String(caseData.jurisdiction_id),
    proceeding: String(caseData.procid),
    history: String(histid),
  });
  // data is the URL string, or data.url, or nested in data
  if (typeof data === 'string') return data;
  if (data?.url) return data.url;
  if (typeof data?.data === 'string') return data.data;
  return null;
}

// Get URL for an attached file
async function getAttachedFileUrl(caseData, histid, filename) {
  const data = await apiPost('/proceedings/history/file', {
    jurisdiction: String(caseData.jurisdiction_id),
    proceeding: String(caseData.procid),
    history: String(histid),
    file: btoa(filename),
  });
  if (typeof data === 'string') return data;
  if (data?.url) return data.url;
  if (typeof data?.data === 'string') return data.data;
  return null;
}

// Download a URL to base64 bytes (via background worker)
async function downloadToBase64(url) {
  const result = await downloadUrl(url);
  // Convert base64 to Uint8Array for JSZip
  const binary = atob(result.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ---- Download All as ZIP ----
async function downloadAll() {
  if (!state.currentCase || !state.tramites.length) {
    showToast('No hay trámites para descargar', 'error');
    return;
  }

  const btn = $('#btn-download-all');
  btn.disabled = true;
  btn.textContent = 'Preparando...';

  const progressEl = $('#download-progress');
  const progressFill = $('#progress-fill');
  const progressText = $('#progress-text');
  progressEl.classList.remove('hidden');

  try {
    const zip = new JSZip();
    const expNum = (state.currentCase.nro_expediente || 'sin_numero').replace(/\//g, '-');
    const caseFolder = `Expediente_${expNum}`;
    const caseData = state.currentCase;

    // Add summary
    const summary = buildFullCaseSummary(caseData, state.tramites);
    zip.file(`${caseFolder}/INFORME_GENERAL.txt`, summary);

    const total = state.tramites.length;
    let done = 0;
    let errors = 0;

    for (let i = 0; i < state.tramites.length; i++) {
      const t = state.tramites[i];
      const num = String(i + 1).padStart(3, '0');
      const dateStr = t.fech || (t.fecha ? t.fecha.replace(/\//g, '-') : 'sf');
      const desc = sanitizeFilename(t.dscr || 'tramite');
      const prefix = `${caseFolder}/${num}_${dateStr}_${desc}`;

      done++;
      progressText.textContent = `[${done}/${total}] ${t.dscr || 'Trámite'}...`;
      progressFill.style.width = `${Math.round((done / total) * 100)}%`;

      let hasContent = false;

      // 1. Fetch text content if not already cached
      if (!t.texto && t.link) {
        try {
          progressText.textContent = `[${done}/${total}] Obteniendo texto...`;
          t.texto = await getTramiteText(caseData, t.histid);
        } catch {}
      }

      // Save text content (proveidos, resoluciones, etc.)
      if (t.texto && t.texto.trim()) {
        const plainText = htmlToPlainText(t.texto);
        if (plainText) {
          zip.file(`${prefix}.txt`, plainText);
          hasContent = true;
        }
      }

      // 2. Try to download the text as PDF
      try {
        const pdfUrl = await getTramitePdfUrl(caseData, t.histid);
        if (pdfUrl) {
          const pdfBytes = await downloadToBase64(pdfUrl);
          zip.file(`${prefix}.pdf`, pdfBytes);
          hasContent = true;
        }
      } catch (err) {
        // PDF download failed
      }

      // 3. Download attached files
      const archivos = Array.isArray(t.archivos) ? t.archivos : [];
      for (const archivo of archivos) {
        try {
          const fileUrl = await getAttachedFileUrl(caseData, t.histid, archivo.nombre);
          if (fileUrl) {
            const fileBytes = await downloadToBase64(fileUrl);
            zip.file(`${prefix}_${archivo.nombre}.${archivo.extension}`, fileBytes);
            hasContent = true;
          }
        } catch {
          errors++;
        }
      }

      if (!hasContent) errors++;
    }

    // Generate ZIP
    progressText.textContent = 'Generando ZIP...';
    const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
      progressFill.style.width = `${meta.percent}%`;
    });

    const url = URL.createObjectURL(blob);
    chrome.downloads.download({
      url,
      filename: `${caseFolder}.zip`,
      saveAs: true,
    }, () => setTimeout(() => URL.revokeObjectURL(url), 1000));

    const msg = errors > 0
      ? `ZIP generado (${errors} trámites sin archivo descargable)`
      : 'ZIP generado correctamente';
    progressText.textContent = msg;
    showToast(msg, errors > 0 ? 'info' : 'success');

  } catch (err) {
    // Download error
    showToast('Error al generar ZIP: ' + err.message, 'error');
    progressText.textContent = 'Error en la descarga';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Descargar Todo (ZIP)';
    setTimeout(() => progressEl.classList.add('hidden'), 5000);
  }
}

// Download a single tramite file
async function downloadSingleFile(histid, filename) {
  try {
    setStatus('Descargando...', 'loading');
    const caseData = state.currentCase;

    // Try text PDF first
    let fileUrl = null;
    try {
      fileUrl = await getTramitePdfUrl(caseData, histid);
    } catch {}

    // Try as attached file
    if (!fileUrl) {
      try {
        const baseName = filename.replace(/\.[^.]+$/, '');
        fileUrl = await getAttachedFileUrl(caseData, histid, baseName);
      } catch {}
    }

    if (fileUrl) {
      // Open the URL directly - the browser will handle the download
      chrome.tabs.create({ url: fileUrl, active: false });
      showToast('Archivo abierto en nueva pestaña', 'success');
    } else {
      showToast('No se pudo obtener el archivo', 'error');
    }
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    setStatus('Listo', 'online');
  }
}

function updateProgress(current, total, fillEl, textEl) {
  const pct = Math.round((current / total) * 100);
  fillEl.style.width = `${pct}%`;
  textEl.textContent = `Procesando... ${current}/${total} (${pct}%)`;
}

// ---- Copy Summary ----
function copySummary() {
  const text = $('#summary-content').textContent;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Resumen copiado al portapapeles', 'success');
  });
}

// ---- Check Current Page ----
async function checkCurrentPage() {
  try {
    const tab = await findSaeTab();
    if (!tab?.url) return;

    // Only act if on a case history page
    const urlMatch = tab.url.match(/\/([^/]+)\/expediente\/([^/]+)\/historia/);
    if (!urlMatch) return;

    const jurisdictionSlug = urlMatch[1];
    const nroExpediente = decodeURIComponent(urlMatch[2]);
    // Detected case page
    setStatus('Detectando expediente...', 'loading');

    // Get intercepted data from content script
    // The content script patches fetch/XHR to capture the SAE app's own API responses
    let caseData = null;
    let stories = null;
    try {
      const response = await sendToContentScript({ type: 'GET_CURRENT_CASE' });
      caseData = response?.caseData || null;
      stories = response?.stories || null;
      // Intercepted data received
    } catch (err) {
      // Content script not available
    }

    if (caseData?.procid) {
      // We have full data from interception - open directly with stories
      openCase(caseData, stories);
      return;
    }

    // Fallback: the page might have loaded before the interceptor was injected.
    // Reload data via API if we can get the jurisdiction_id
    // No intercepted data, trying API fallback
    try {
      const jData = await apiGet('/jurisdictions/slug', { slug: jurisdictionSlug });
      const jurisdiction = Array.isArray(jData) ? jData[0] : jData;
      if (!jurisdiction?.id) {
        setStatus('Fuero no encontrado', 'offline');
        return;
      }

      // Try search with captcha
      const captcha = await getCaptchaToken();
      if (captcha) {
        const searchResults = await apiGet('/proceedings', {
          jurisdiction: jurisdiction.id,
          number: nroExpediente,
          captcha,
          page: 1,
        });
        const results = Array.isArray(searchResults) ? searchResults : [];
        if (results.length > 0) {
          const found = results[0];
          if (!found.jurisdiction_id) found.jurisdiction_id = jurisdiction.id;
          if (!found.jurisdiction_slug) found.jurisdiction_slug = jurisdictionSlug;
          openCase(found);
          return;
        }
      }

      // Last resort: show message to reload
      setStatus('Recargá la página del SAE y abrí la extensión de nuevo', 'offline');
      showToast('Recargá la página (F5) y volvé a abrir la extensión', 'error');
    } catch (err) {
      // Fallback failed
      setStatus('No se pudo cargar el expediente', 'offline');
    }
  } catch (err) {
    // checkCurrentPage error
  }
}

// ---- History Management ----
async function loadHistory() {
  const data = await chrome.storage.local.get('sae_history');
  state.history = data.sae_history || [];
  renderHistory();
}

function saveToHistory(caseData) {
  // Remove if already exists
  state.history = state.history.filter(h => h.procid !== caseData.procid);
  // Add to front
  state.history.unshift({
    procid: caseData.procid || caseData.proceeding,
    nro_expediente: caseData.nro_expediente || caseData.numero,
    caratula: caseData.caratula,
    jurisdiction_id: caseData.jurisdiction_id || caseData.jurisdictionId || $('#sel-jurisdiction')?.value,
    jurisdiction_slug: caseData.jurisdiction_slug,
    juzgado: caseData.juzgado?.dscr,
    timestamp: Date.now(),
  });
  // Keep only last 50
  state.history = state.history.slice(0, 50);
  chrome.storage.local.set({ sae_history: state.history });
  renderHistory();
}

function renderHistory() {
  const container = $('#history-list');
  const sectionEl = $('#history-section');

  if (!state.history.length) {
    if (sectionEl) sectionEl.classList.add('hidden');
    container.innerHTML = '';
    return;
  }

  if (sectionEl) sectionEl.classList.remove('hidden');
  container.innerHTML = state.history.slice(0, 10).map(h => `
    <div class="history-item" data-procid="${h.procid}" data-case='${JSON.stringify(h).replace(/'/g, "&#39;")}'>
      <div class="history-item-info">
        <div class="history-item-number">Exp. ${h.nro_expediente || ''}</div>
        <div class="history-item-title">${h.caratula || ''}</div>
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <span class="history-item-date">${timeAgo(h.timestamp)}</span>
        <button class="history-item-delete" data-procid="${h.procid}" title="Eliminar">✕</button>
      </div>
    </div>
  `).join('');

  // Click to open
  container.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('history-item-delete')) return;
      const caseData = JSON.parse(item.dataset.case);
      openCase(caseData);
    });
  });

  // Delete
  container.querySelectorAll('.history-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const procid = btn.dataset.procid;
      state.history = state.history.filter(h => String(h.procid) !== String(procid));
      chrome.storage.local.set({ sae_history: state.history });
      renderHistory();
    });
  });
}

// ---- Utilities ----
function setStatus(text, type) {
  $('#status-text').textContent = text;
  const indicator = $('#status-indicator');
  indicator.className = `status-indicator ${type}`;
}

function showToast(message, type = 'info') {
  // Show toast inside the popup
  let toast = document.getElementById('popup-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'popup-toast';
    toast.style.cssText = `
      position: fixed; top: 8px; left: 8px; right: 8px; z-index: 9999;
      padding: 10px 14px; border-radius: 6px; font-size: 12px; font-weight: 500;
      color: white; text-align: center; transition: opacity 0.3s; opacity: 0;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.background = type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#1a56db';
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}

function formatDate(dateStr) {
  if (!dateStr) return 'N/D';
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora';
  if (mins < 60) return `Hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours}h`;
  const days = Math.floor(hours / 24);
  return `Hace ${days}d`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ _-]/g, '').substring(0, 50).trim() || 'tramite';
}

// ============================================
// FEATURE: CASE MONITORING (Seguimiento)
// ============================================

async function loadFollowed() {
  const data = await chrome.storage.local.get('sae_followed');
  state.followed = data.sae_followed || [];
  renderMonitorList();
}

function saveFollowed() {
  chrome.storage.local.set({ sae_followed: state.followed });
  renderMonitorList();
  // Tell background to update alarm
  chrome.runtime.sendMessage({ type: 'UPDATE_MONITOR_ALARM', count: state.followed.length });
}

function toggleFollowCurrentCase() {
  const c = state.currentCase;
  if (!c?.procid) { showToast('No hay expediente cargado', 'error'); return; }

  const idx = state.followed.findIndex(f => String(f.procid) === String(c.procid));
  if (idx >= 0) {
    // Unfollow
    state.followed.splice(idx, 1);
    showToast('Dejaste de seguir el expediente', 'info');
  } else {
    // Follow - get highest histid from current tramites
    const maxHistid = state.tramites.reduce((max, t) => Math.max(max, t.histid || 0), 0);
    const lastTramite = state.tramites[0];
    state.followed.unshift({
      procid: String(c.procid),
      jurisdiction_id: String(c.jurisdiction_id),
      nro_expediente: c.nro_expediente || '',
      caratula: c.caratula || '',
      juzgado: c.juzgado?.dscr || '',
      jurisdiction_slug: c.jurisdiction_slug || '',
      last_histid: maxHistid,
      last_fecha: lastTramite?.fecha || '',
      last_dscr: lastTramite?.dscr || '',
      last_check: Date.now(),
      new_count: 0,
      added_at: Date.now(),
    });
    showToast('Expediente agregado a seguimiento', 'success');
  }
  saveFollowed();
  updateFollowButton();
}

function updateFollowButton() {
  const btn = $('#btn-follow-case');
  if (!btn || !state.currentCase?.procid) return;
  const isFollowing = state.followed.some(f => String(f.procid) === String(state.currentCase.procid));
  btn.textContent = isFollowing ? 'Dejar de Seguir' : 'Seguir Expediente';
  btn.classList.toggle('following', isFollowing);
}

function initMonitorListeners() {
  $('#btn-check-all').addEventListener('click', checkAllFollowed);
  $('#btn-monitor-ai-report').addEventListener('click', generateMonitorAIReport);
  $('#btn-monitor-export-xl').addEventListener('click', exportMonitorExcel);
  $('#chk-select-all-monitor').addEventListener('change', (e) => {
    $$('.monitor-chk').forEach(chk => { chk.checked = e.target.checked; });
    updateMonitorToolbar();
  });
}

function getSelectedMonitorIndices() {
  return [...$$('.monitor-chk:checked')].map(chk => parseInt(chk.dataset.index));
}

function updateMonitorToolbar() {
  const count = getSelectedMonitorIndices().length;
  $('#btn-monitor-ai-report').disabled = count === 0;
  $('#btn-monitor-export-xl').disabled = !state.monitorReports?.length;
  $('#btn-monitor-ai-report').textContent = count > 0 ? `Informe IA (${count})` : 'Informe IA';
}

function renderMonitorList() {
  const emptyEl = $('#monitor-empty');
  const contentEl = $('#monitor-content');
  const container = $('#monitor-list');

  if (!state.followed.length) {
    emptyEl.classList.remove('hidden');
    contentEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  contentEl.classList.remove('hidden');
  $('#monitor-count').textContent = `${state.followed.length} causa${state.followed.length > 1 ? 's' : ''}`;

  // Sort: cases with new movements first
  const sortedIndices = state.followed.map((f, i) => i);
  sortedIndices.sort((a, b) => {
    const aNew = state.followed[a].new_count || 0;
    const bNew = state.followed[b].new_count || 0;
    if (bNew !== aNew) return bNew - aNew;
    return (state.followed[b].last_check || 0) - (state.followed[a].last_check || 0);
  });

  container.innerHTML = sortedIndices.map(i => {
    const f = state.followed[i];
    const hasNew = f.new_count > 0;
    const badgeClass = hasNew ? 'badge-new' : 'badge-ok';
    const badgeText = hasNew ? `${f.new_count} nuevo${f.new_count > 1 ? 's' : ''}` : 'Al dia';
    const cardClass = hasNew ? 'monitor-card has-new' : 'monitor-card';
    const statusText = f.last_fecha
      ? `${f.last_fecha} — ${(f.last_dscr || '').substring(0, 40)}`
      : 'Sin verificar';

    return `
      <div class="${cardClass}" data-index="${i}">
        <div class="monitor-card-top">
          <input type="checkbox" class="monitor-chk" data-index="${i}">
          <div class="monitor-card-info">
            <div class="monitor-card-number">Exp. ${escapeHtml(f.nro_expediente)}</div>
            <div class="monitor-card-title">${escapeHtml(f.caratula)}</div>
          </div>
          <span class="badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="monitor-card-bottom">
          <span class="monitor-card-status">${statusText}</span>
          <div class="monitor-card-actions">
            <button class="btn-sm btn-primary monitor-check" data-index="${i}">Verificar</button>
            <button class="btn-sm btn-danger monitor-unfollow" data-index="${i}">Quitar</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Event handlers
  container.querySelectorAll('.monitor-check').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      checkSingleFollowed(parseInt(btn.dataset.index));
    });
  });
  container.querySelectorAll('.monitor-unfollow').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.followed.splice(parseInt(btn.dataset.index), 1);
      saveFollowed();
    });
  });
  // Checkbox click - stop propagation and update toolbar
  container.querySelectorAll('.monitor-chk').forEach(chk => {
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => updateMonitorToolbar());
  });
  // Click card to open case
  container.querySelectorAll('.monitor-card').forEach(card => {
    card.addEventListener('click', () => {
      const f = state.followed[parseInt(card.dataset.index)];
      if (f) {
        f.new_count = 0; // Mark as seen
        saveFollowed();
        openCase(f);
      }
    });
  });
}

async function checkSingleFollowed(index) {
  const f = state.followed[index];
  if (!f) return;

  const btn = $$(`.monitor-check[data-index="${index}"]`)[0];
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  try {
    const data = await apiGet('/proceedings/history', {
      proceeding: f.procid,
      jurisdiction: f.jurisdiction_id,
    });

    const stories = data?.stories || (Array.isArray(data) ? data : []);
    const maxHistid = stories.reduce((max, s) => Math.max(max, s.histid || 0), 0);
    const newCount = stories.filter(s => (s.histid || 0) > f.last_histid).length;

    f.last_check = Date.now();
    if (stories.length > 0) {
      const newest = stories[0]; // Sorted newest first
      f.last_fecha = newest.fecha || f.last_fecha;
      f.last_dscr = newest.dscr || f.last_dscr;
    }
    if (newCount > 0) {
      f.new_count = newCount;
      f.last_histid = maxHistid;
    }

    saveFollowed();
  } catch (err) {
    showToast(`Error verificando ${f.nro_expediente}: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.textContent = 'Verificar'; btn.disabled = false; }
  }
}

async function checkAllFollowed() {
  const btn = $('#btn-check-all');
  btn.textContent = 'Verificando...';
  btn.disabled = true;

  for (let i = 0; i < state.followed.length; i++) {
    await checkSingleFollowed(i);
    // Small delay between checks
    if (i < state.followed.length - 1) await new Promise(r => setTimeout(r, 500));
  }

  btn.textContent = 'Verificar todos';
  btn.disabled = false;
  showToast('Verificacion completada', 'success');
}

// ============================================
// FEATURE: BULK IMPORT (Importar)
// ============================================

function initImportListeners() {
  const dropZone = $('#drop-zone');
  const fileInput = $('#inp-file');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) handleFileUpload(file);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFileUpload(fileInput.files[0]);
  });

  $('#btn-import-clear').addEventListener('click', resetImport);
  $('#btn-new-import').addEventListener('click', resetImport);
  $('#btn-start-import').addEventListener('click', startImport);
  $('#btn-cancel-import').addEventListener('click', () => { state.importCancelled = true; });
  $('#btn-export-results').addEventListener('click', exportResults);
  $('#btn-follow-all').addEventListener('click', followAllImported);
  $('#sel-import-center').addEventListener('change', onImportCenterChange);
  $('#sel-import-jurisdiction').addEventListener('change', validateImportForm);

  // Restore last import results if popup was closed during import
  restoreLastImport();
  $('#sel-col-filter').addEventListener('change', () => {
    const hasFilter = $('#sel-col-filter').value;
    $('#filter-value-section').classList.toggle('hidden', !hasFilter);
  });
}

async function restoreLastImport() {
  const data = await chrome.storage.local.get('sae_last_import');
  const results = data.sae_last_import;
  if (!results || !results.length) return;

  state.importResults = results;
  // Show results view
  $('#import-upload').classList.add('hidden');
  $('#import-config').classList.add('hidden');
  $('#import-progress').classList.remove('hidden');
  $('#btn-cancel-import').classList.add('hidden');
  $('#btn-new-import').classList.remove('hidden');
  $('#btn-export-results').classList.remove('hidden');

  // Hide warning banner in restored view
  const warning = $('#import-progress .warning-banner');
  if (warning) warning.classList.add('hidden');

  const okCount = results.filter(r => r.status === 'ok').length;
  const errCount = results.filter(r => r.status === 'error').length;
  let summary = `${okCount} OK`;
  if (errCount) summary += `, ${errCount} errores`;
  $('#import-progress-text').textContent = `Ultima importacion: ${summary} de ${results.length}`;
  $('#import-progress-fill').style.width = '100%';

  if (okCount > 0) {
    $('#btn-follow-all').classList.remove('hidden');
    $('#btn-follow-all').textContent = `Seguir ${okCount} expedientes`;
  }

  // Render results table
  let tableHtml = '<table><thead><tr><th></th><th>Exp.</th><th>Fuero</th><th>Ultimo Tramite</th><th>Fecha</th></tr></thead><tbody>';
  results.forEach((r, i) => {
    const cls = r.status === 'ok' ? 'import-row-ok' : r.status === 'skip' ? 'import-row-skip' : 'import-row-err';
    const label = r.status === 'ok' ? 'OK' : r.status === 'skip' ? '---' : 'ERR';
    tableHtml += `<tr class="${cls}"><td>${label}</td><td>${escapeHtml(r.number)}</td><td>${escapeHtml(r.fuero || '')}</td><td>${escapeHtml(r.tramite || '')}</td><td>${r.fecha || ''}</td></tr>`;
  });
  tableHtml += '</tbody></table>';
  $('#import-results').innerHTML = tableHtml;
}

function handleFileUpload(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const workbook = XLSX.read(e.target.result, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!json.length) { showToast('El archivo esta vacio', 'error'); return; }

      state.importData = json;
      state.importHeaders = Object.keys(json[0]);

      // Show config
      $('#import-upload').classList.add('hidden');
      $('#import-config').classList.remove('hidden');
      $('#import-filename').textContent = file.name + ` (${json.length} filas)`;

      // Populate column selector
      const sel = $('#sel-col-number');
      sel.innerHTML = '<option value="">Seleccionar columna</option>';
      state.importHeaders.forEach(h => {
        const selected = /exp|nro|numero|causa/i.test(h) ? 'selected' : '';
        sel.innerHTML += `<option value="${h}" ${selected}>${h}</option>`;
      });

      // Populate filter column selector
      const filterSel = $('#sel-col-filter');
      filterSel.innerHTML = '<option value="">Sin filtro - buscar todos</option>';
      state.importHeaders.forEach(h => {
        const selected = /nomin|centro|fuero|jurisd|tribunal|juzg/i.test(h) ? 'selected' : '';
        filterSel.innerHTML += `<option value="${h}" ${selected}>${h}</option>`;
      });
      // Show filter value section if auto-selected
      if (filterSel.value) {
        $('#filter-value-section').classList.remove('hidden');
      }

      // Populate center selector (reuse loaded centers)
      const centerSel = $('#sel-import-center');
      centerSel.innerHTML = '<option value="">Centro Judicial</option>';
      state.centers.forEach(c => {
        centerSel.innerHTML += `<option value="${c.id}">${c.name}</option>`;
      });

      // Preview
      renderImportPreview(json.slice(0, 5));
      validateImportForm();
    } catch (err) {
      showToast('Error al leer el archivo: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

async function onImportCenterChange() {
  const centerId = $('#sel-import-center').value;
  const sel = $('#sel-import-jurisdiction');
  if (!centerId) { sel.innerHTML = '<option value="">Seleccione centro</option>'; return; }

  try {
    const jurisdictions = await apiGet('/jurisdictions', { center: centerId });
    const jurs = Array.isArray(jurisdictions) ? jurisdictions : [];
    sel.innerHTML = '<option value="">Fuero</option>';
    jurs.forEach(j => {
      if (j.is_public === 0) return;
      sel.innerHTML += `<option value="${j.id}">${j.name}</option>`;
    });
  } catch {
    sel.innerHTML = '<option value="">Error</option>';
  }
  validateImportForm();
}

function validateImportForm() {
  const col = $('#sel-col-number').value;
  const jur = $('#sel-import-jurisdiction').value;
  $('#btn-start-import').disabled = !(col && jur);
}

function renderImportPreview(rows) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  let html = '<table><thead><tr>';
  headers.forEach(h => { html += `<th>${escapeHtml(h)}</th>`; });
  html += '</tr></thead><tbody>';
  rows.forEach(r => {
    html += '<tr>';
    headers.forEach(h => { html += `<td>${escapeHtml(String(r[h] || ''))}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';
  $('#import-preview').innerHTML = html;
}

function resetImport() {
  state.importData = [];
  state.importHeaders = [];
  state.importResults = [];
  chrome.storage.local.remove('sae_last_import');
  $('#import-upload').classList.remove('hidden');
  $('#import-config').classList.add('hidden');
  $('#import-progress').classList.add('hidden');
  $('#btn-new-import').classList.add('hidden');
  $('#btn-follow-all').classList.add('hidden');
  $('#btn-export-results').classList.add('hidden');
  $('#inp-file').value = '';
}

// Convert "1051-2023" or "1051/2023" to "1051/23"
function normalizeExpNumber(raw) {
  const str = String(raw).trim();
  const parts = str.replace('-', '/').split('/');
  if (parts.length === 2) {
    const num = parts[0].trim();
    const year = parts[1].trim();
    return `${parseInt(num)}/${year.length > 2 ? year.slice(-2) : year}`;
  }
  return str;
}

async function startImport() {
  const colName = $('#sel-col-number').value;
  const jurisdictionId = $('#sel-import-jurisdiction').value;
  const centerId = $('#sel-import-center').value;

  if (!colName || !jurisdictionId) return;

  // Filter column config
  const filterCol = $('#sel-col-filter').value;
  const filterValue = $('#inp-filter-value')?.value?.trim().toUpperCase() || '';

  // Extract case numbers with filter info
  const cases = state.importData.map(row => {
    const number = normalizeExpNumber(row[colName]);
    if (!number) return null;

    // Check if this row should be skipped based on filter
    let skip = false;
    let filterCellValue = '';
    if (filterCol && filterValue) {
      filterCellValue = String(row[filterCol] || '').toUpperCase();
      skip = !filterCellValue.includes(filterValue);
    }

    return { raw: row[colName], number, row, skip, filterCellValue };
  }).filter(Boolean);

  if (!cases.length) { showToast('No se encontraron numeros de expediente', 'error'); return; }

  const activeCount = cases.filter(c => !c.skip).length;
  const skipCount = cases.filter(c => c.skip).length;
  if (skipCount > 0) {
    // Import: activeCount to query, skipCount filtered
  }

  // Load all public jurisdictions for this center (for multi-fuero fallback)
  let allJurisdictions = [];
  try {
    const jurs = await apiGet('/jurisdictions', { center: centerId });
    allJurisdictions = (Array.isArray(jurs) ? jurs : []).filter(j => j.is_public !== 0);
  } catch {}

  // Put selected jurisdiction first in the list
  const orderedJurisdictions = [
    allJurisdictions.find(j => String(j.id) === String(jurisdictionId)),
    ...allJurisdictions.filter(j => String(j.id) !== String(jurisdictionId)),
  ].filter(Boolean);

  if (cases.length > 50) {
    if (!confirm(`Se van a consultar ${cases.length} expedientes. Puede tardar varios minutos. Continuar?`)) return;
  }

  state.importRunning = true;
  state.importCancelled = false;
  state.importResults = [];

  $('#import-config').classList.add('hidden');
  $('#import-progress').classList.remove('hidden');
  $('#btn-cancel-import').classList.remove('hidden');
  $('#btn-export-results').classList.add('hidden');

  // Init results table
  let tableHtml = '<table><thead><tr><th></th><th>Exp.</th><th>Fuero</th><th>Ultimo Tramite</th><th>Fecha</th></tr></thead><tbody>';
  cases.forEach((c, i) => {
    tableHtml += `<tr id="import-row-${i}" class="import-row-pending"><td>...</td><td>${escapeHtml(c.number)}</td><td></td><td></td><td></td></tr>`;
  });
  tableHtml += '</tbody></table>';
  $('#import-results').innerHTML = tableHtml;

  const progressFill = $('#import-progress-fill');
  const progressText = $('#import-progress-text');

  // First, verify captcha is working with a test
  progressText.textContent = 'Verificando captcha...';
  const saeTab = await findSaeTab();
  if (!saeTab) {
    progressText.textContent = 'Error: Abri consultaexpedientes.justucuman.gov.ar en otra pestaña.';
    state.importRunning = false;
    $('#btn-cancel-import').classList.add('hidden');
    return;
  }
  if (!saeTab.url.includes('/buscador')) {
    progressText.textContent = 'Error: Navega al buscador del SAE (selecciona un fuero). El captcha solo se carga ahi.';
    state.importRunning = false;
    $('#btn-cancel-import').classList.add('hidden');
    return;
  }
  const testCaptcha = await getCaptchaToken();
  if (!testCaptcha) {
    progressText.textContent = 'Error: Captcha no disponible. Recarga la pagina del SAE (F5) y volve a intentar.';
    state.importRunning = false;
    $('#btn-cancel-import').classList.add('hidden');
    return;
  }
  // Captcha test passed, starting import

  for (let i = 0; i < cases.length; i++) {
    if (state.importCancelled) {
      progressText.textContent = 'Cancelado';
      break;
    }

    const c = cases[i];
    const pct = Math.round(((i + 1) / cases.length) * 100);
    progressFill.style.width = `${pct}%`;

    const row = $(`#import-row-${i}`);
    let result = { number: c.number, status: 'error', tramite: '', fecha: '', caratula: '', fuero: '', procid: null, jurisdiction_id: null };

    // Skip filtered rows
    if (c.skip) {
      result.status = 'skip';
      result.tramite = `Omitido (${c.filterCellValue || 'no coincide'})`;
      updateImportRow(row, 'skip', '', result.tramite, '');
      state.importResults.push(result);
      continue;
    }

    progressText.textContent = `[${i + 1}/${cases.length}] Buscando ${c.number}...`;

    try {
      // Try each jurisdiction (selected one first, then others)
      let found = null;
      let foundJurisdiction = null;

      for (const jur of orderedJurisdictions) {
        if (state.importCancelled) break;

        // Get fresh captcha for each search attempt
        const captcha = await getCaptchaToken();
        if (!captcha) {
          // No captcha available
          result.tramite = 'Sin captcha';
          break;
        }

        try {
          // Searching in jurisdiction
          const searchData = await apiGet('/proceedings', {
            jurisdiction: jur.id,
            number: c.number,
            captcha,
            page: 1,
          });

          const results = Array.isArray(searchData) ? searchData : [];
          if (results.length > 0) {
            found = results[0];
            foundJurisdiction = jur;
            // Found case
            break;
          }
        } catch (searchErr) {
          // Search error in jurisdiction
          // If HTTP 404, captcha was likely invalid; don't try other jurisdictions with same token
          if (searchErr.message.includes('404')) {
            result.tramite = 'Captcha rechazado (404)';
            break;
          }
        }

        // Small delay between jurisdiction attempts
        await new Promise(r => setTimeout(r, 800));
      }

      if (!found) {
        if (!result.tramite) result.tramite = 'No encontrado en ningun fuero';
        updateImportRow(row, 'err', '', result.tramite, '');
        state.importResults.push(result);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      result.caratula = found.caratula || '';
      result.fuero = foundJurisdiction?.name || '';
      result.procid = String(found.procid);
      result.jurisdiction_id = String(foundJurisdiction.id);
      result.juzgado = found.juzgado?.dscr || '';
      result.jurisdiction_slug = foundJurisdiction.slug || '';

      // Get history (no captcha needed)
      progressText.textContent = `[${i + 1}/${cases.length}] Cargando historia ${c.number}...`;
      const histData = await apiGet('/proceedings/history', {
        proceeding: found.procid,
        jurisdiction: foundJurisdiction.id,
      });

      const stories = histData?.stories || (Array.isArray(histData) ? histData : []);
      result.last_histid = stories.reduce((max, s) => Math.max(max, s.histid || 0), 0);
      if (stories.length > 0) {
        const last = stories[0];
        result.status = 'ok';
        result.tramite = last.dscr || '';
        result.fecha = last.fecha || '';
        result.last_dscr = last.dscr || '';
        updateImportRow(row, 'ok', result.fuero, last.dscr || 'Sin descripcion', last.fecha || '');
      } else {
        result.status = 'ok';
        result.tramite = 'Sin tramites';
        updateImportRow(row, 'ok', result.fuero, 'Sin tramites', '');
      }
    } catch (err) {
      // Import error for case
      result.tramite = err.message;
      updateImportRow(row, 'err', '', err.message, '');
    }

    state.importResults.push(result);
    // Delay between cases
    if (i < cases.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  state.importRunning = false;
  const okCount = state.importResults.filter(r => r.status === 'ok').length;
  const errCount = state.importResults.filter(r => r.status === 'error').length;
  const skippedCount = state.importResults.filter(r => r.status === 'skip').length;
  let summary = `${okCount} OK`;
  if (errCount) summary += `, ${errCount} errores`;
  if (skippedCount) summary += `, ${skippedCount} omitidos`;
  progressText.textContent = state.importCancelled
    ? `Cancelado (${state.importResults.length}/${cases.length})`
    : `Completado: ${summary} de ${cases.length}`;
  $('#btn-cancel-import').classList.add('hidden');
  $('#btn-new-import').classList.remove('hidden');
  $('#btn-export-results').classList.remove('hidden');
  if (okCount > 0) {
    $('#btn-follow-all').classList.remove('hidden');
    $('#btn-follow-all').textContent = `Seguir ${okCount} expedientes`;
  }

  // Save results to storage so they survive popup close
  chrome.storage.local.set({ sae_last_import: state.importResults });
}

function updateImportRow(row, status, fuero, tramite, fecha) {
  if (!row) return;
  const classMap = { ok: 'import-row-ok', err: 'import-row-err', skip: 'import-row-skip' };
  const labelMap = { ok: 'OK', err: 'ERR', skip: '---' };
  row.className = classMap[status] || 'import-row-err';
  const cells = row.querySelectorAll('td');
  cells[0].textContent = labelMap[status] || 'ERR';
  cells[2].textContent = fuero;
  cells[3].textContent = tramite;
  cells[4].textContent = fecha;
}

function followAllImported() {
  const okResults = state.importResults.filter(r => r.status === 'ok' && r.procid);
  if (!okResults.length) { showToast('No hay expedientes para seguir', 'error'); return; }

  let added = 0;
  for (const r of okResults) {
    // Skip if already followed
    if (state.followed.some(f => String(f.procid) === String(r.procid))) continue;

    state.followed.push({
      procid: r.procid,
      jurisdiction_id: r.jurisdiction_id,
      nro_expediente: r.number,
      caratula: r.caratula,
      juzgado: r.juzgado || '',
      jurisdiction_slug: r.jurisdiction_slug || '',
      last_histid: r.last_histid || 0,
      last_fecha: r.fecha || '',
      last_dscr: r.last_dscr || '',
      last_check: Date.now(),
      new_count: 0,
      added_at: Date.now(),
    });
    added++;
  }

  saveFollowed();
  showToast(`${added} expedientes agregados a seguimiento`, 'success');
  $('#btn-follow-all').textContent = `${added} agregados`;
  $('#btn-follow-all').disabled = true;
}

function exportResults() {
  if (!state.importResults.length) return;

  const data = state.importResults.map(r => ({
    'Expediente': r.number,
    'Fuero': r.fuero,
    'Caratula': r.caratula,
    'Estado': r.status === 'ok' ? 'OK' : r.status === 'skip' ? 'OMITIDO' : 'ERROR',
    'Ultimo Tramite': r.tramite,
    'Fecha': r.fecha,
  }));

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Resultados');

  // Auto-size columns
  const colWidths = Object.keys(data[0]).map(key => ({
    wch: Math.max(key.length, ...data.map(r => String(r[key]).length)) + 2,
  }));
  ws['!cols'] = colWidths;

  XLSX.writeFile(wb, `SAE_Consulta_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast('Excel exportado', 'success');
}

// ============================================
// FEATURE: GEMINI AI REPORTS
// ============================================

// ============================================
// Monitor AI Reports (batch)
// ============================================

async function generateMonitorAIReport() {
  const selectedIndices = getSelectedMonitorIndices();
  if (!selectedIndices.length) {
    showToast('Selecciona al menos un expediente', 'error');
    return;
  }

  const apiKey = await getGeminiKey();
  if (!apiKey) {
    showToast('Configura tu API Key de Gemini en la pestaña Info', 'error');
    return;
  }

  const btn = $('#btn-monitor-ai-report');
  const progressEl = $('#monitor-ai-progress');
  const statusEl = $('#monitor-ai-status');
  const fillEl = $('#monitor-ai-fill');
  btn.disabled = true;
  progressEl.classList.remove('hidden');
  state.monitorReports = [];

  const cases = selectedIndices.map(i => state.followed[i]).filter(Boolean);
  let completed = 0;

  for (const caseData of cases) {
    completed++;
    const pct = Math.round((completed / cases.length) * 100);
    statusEl.textContent = `Analizando ${completed}/${cases.length}: Exp. ${caseData.nro_expediente}...`;
    fillEl.style.width = `${pct}%`;

    try {
      // Fetch tramites for this case
      statusEl.textContent = `Obteniendo tramites de ${caseData.nro_expediente}...`;
      const data = await apiGet('/proceedings/history', {
        proceeding: caseData.procid,
        jurisdiction: caseData.jurisdiction_id,
      });

      let tramites = [];
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        tramites = Array.isArray(data.stories) ? data.stories : [];
      } else {
        tramites = Array.isArray(data) ? data : [];
      }

      // Fetch texts for tramites that need it
      const toFetch = tramites.filter(t => !t.texto && t.link);
      for (let i = 0; i < Math.min(toFetch.length, 10); i++) {
        statusEl.textContent = `Textos ${caseData.nro_expediente} (${i + 1}/${Math.min(toFetch.length, 10)})...`;
        try {
          toFetch[i].texto = await getTramiteText(caseData, toFetch[i].histid);
        } catch { /* skip */ }
      }

      // Build AI prompt
      statusEl.textContent = `IA analizando ${caseData.nro_expediente}...`;
      const tramitesText = tramites.slice(0, 20).map((t, i) => {
        const texto = t.texto ? htmlToPlainText(t.texto) : '';
        const content = texto.length > 800 ? texto.substring(0, 800) + '...' : texto;
        return `[${i + 1}] ${t.fecha || 'S/F'} | ${t.dscr || ''}\n${content}`;
      }).join('\n---\n');

      const prompt = `Sos un abogado procesalista argentino. Genera un informe BREVE del estado de este expediente.

EXPEDIENTE: ${caseData.nro_expediente || 'N/D'}
CARATULA: ${caseData.caratula || 'N/D'}
ACTOR: ${caseData.acto || caseData.actor || 'N/D'}
DEMANDADO: ${caseData.dema || caseData.demandado || 'N/D'}
JUZGADO: ${caseData.juzgado?.dscr || caseData.juzgado || 'N/D'}
TIPO: ${caseData.tipo_proceso || 'N/D'}
TOTAL TRAMITES: ${tramites.length}

ULTIMOS TRAMITES:
${tramitesText}

Genera un informe conciso con:
1. ESTADO ACTUAL (2-3 oraciones)
2. ULTIMO MOVIMIENTO RELEVANTE (que paso y cuando)
3. PROXIMOS PASOS PROBABLES
4. ALERTAS (si hay plazos urgentes o situaciones que requieran atencion)

Maximo 300 palabras. Lenguaje juridico argentino. No inventes datos.`;

      const report = await callGemini(apiKey, prompt);

      state.monitorReports.push({
        nro_expediente: caseData.nro_expediente,
        caratula: caseData.caratula,
        actor: caseData.acto || caseData.actor || '',
        demandado: caseData.dema || caseData.demandado || '',
        juzgado: caseData.juzgado?.dscr || caseData.juzgado || '',
        tipo: caseData.tipo_proceso || '',
        total_tramites: tramites.length,
        ultimo_movimiento: tramites[0]?.fecha || '',
        ultimo_tipo: tramites[0]?.dscr || '',
        informe_ia: report,
        fecha_informe: new Date().toLocaleDateString('es-AR'),
      });

    } catch (err) {
      console.error(`Error report ${caseData.nro_expediente}:`, err);
      state.monitorReports.push({
        nro_expediente: caseData.nro_expediente,
        caratula: caseData.caratula || '',
        actor: '', demandado: '', juzgado: '', tipo: '',
        total_tramites: 0, ultimo_movimiento: '', ultimo_tipo: '',
        informe_ia: `ERROR: ${err.message}`,
        fecha_informe: new Date().toLocaleDateString('es-AR'),
      });
    }
  }

  statusEl.textContent = `Completado: ${state.monitorReports.length} informes generados. Descargando Excel...`;
  fillEl.style.width = '100%';
  btn.disabled = false;
  btn.textContent = 'Informe IA';
  updateMonitorToolbar();

  // Auto-download Excel
  exportMonitorExcel();

  setTimeout(() => {
    statusEl.textContent = `${state.monitorReports.length} informes listos. Podes volver a descargar con el boton verde.`;
  }, 2000);
}

function exportMonitorExcel() {
  if (!state.monitorReports?.length) {
    showToast('Genera informes primero', 'error');
    return;
  }

  const headers = [
    'Expediente', 'Caratula', 'Actor', 'Demandado', 'Juzgado',
    'Tipo', 'Total Tramites', 'Ultimo Movimiento', 'Ultimo Tipo',
    'Informe IA', 'Fecha Informe'
  ];

  const rows = state.monitorReports.map(r => [
    r.nro_expediente, r.caratula, r.actor, r.demandado, r.juzgado,
    r.tipo, r.total_tramites, r.ultimo_movimiento, r.ultimo_tipo,
    r.informe_ia, r.fecha_informe,
  ]);

  // Build Excel using SheetJS
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  // Auto-width columns
  ws['!cols'] = headers.map((h, i) => {
    const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] || '').substring(0, 50).length));
    return { wch: Math.min(maxLen + 2, 60) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Informes IA');

  const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);

  const fecha = new Date().toISOString().split('T')[0];
  chrome.downloads.download({
    url,
    filename: `Informes_Seguimiento_${fecha}.xlsx`,
    saveAs: true,
  }, () => setTimeout(() => URL.revokeObjectURL(url), 1000));
}

// Init AI listeners
function initAIListeners() {
  $('#btn-save-key').addEventListener('click', saveGeminiKey);
  $('#btn-ai-report').addEventListener('click', generateAIReport);

  // Load saved key
  chrome.storage.local.get('sae_gemini_key', (data) => {
    if (data.sae_gemini_key) {
      $('#inp-gemini-key').value = data.sae_gemini_key;
    }
  });
}

function saveGeminiKey() {
  const key = $('#inp-gemini-key').value.trim();
  if (!key) {
    showToast('Ingresa una API key', 'error');
    return;
  }
  chrome.storage.local.set({ sae_gemini_key: key });
  showToast('API Key guardada', 'success');
}

async function getGeminiKey() {
  const data = await chrome.storage.local.get('sae_gemini_key');
  return data.sae_gemini_key || null;
}

async function generateAIReport() {
  if (!state.currentCase || !state.tramites.length) {
    showToast('No hay expediente cargado', 'error');
    return;
  }

  const apiKey = await getGeminiKey();
  if (!apiKey) {
    showToast('Configura tu API Key de Gemini en la pestaña Info', 'error');
    // Switch to info tab
    $$('.tab').forEach(t => t.classList.remove('active'));
    $$('.tab-content').forEach(c => c.classList.remove('active'));
    $$('.tab')[4].classList.add('active');
    $('#tab-info').classList.add('active');
    $('#inp-gemini-key').focus();
    return;
  }

  const btn = $('#btn-ai-report');
  btn.textContent = 'Cargando textos...';
  btn.disabled = true;

  try {
    // Fetch texts for all tramites that don't have them yet
    const toFetch = state.tramites.filter(t => !t.texto && t.link);
    for (let i = 0; i < toFetch.length; i++) {
      btn.textContent = `Textos (${i + 1}/${toFetch.length})...`;
      toFetch[i].texto = await getTramiteText(state.currentCase, toFetch[i].histid);
    }

    btn.textContent = 'Analizando con IA...';

    // Build context for the AI
    const caseData = state.currentCase;
    const tramitesText = state.tramites.map((t, i) => {
      const texto = t.texto ? htmlToPlainText(t.texto) : '';
      // Include full text for important tramites, summary for routine ones
      const maxLen = 1500;
      const content = texto.length > maxLen ? texto.substring(0, maxLen) + '...' : texto;
      return `[${i + 1}] ${t.fecha || 'S/F'} | ${t.dscr || 'Sin desc.'}\n${content}`;
    }).join('\n---\n');

    const prompt = `Sos un abogado procesalista argentino. Analiza este expediente judicial y genera un informe profesional completo.

DATOS DEL EXPEDIENTE:
- Expediente: ${caseData.nro_expediente || 'N/D'}
- Caratula: ${caseData.caratula || 'N/D'}
- Actor: ${caseData.acto || caseData.actor || 'N/D'}
- Demandado: ${caseData.dema || caseData.demandado || 'N/D'}
- Juzgado: ${caseData.juzgado?.dscr || 'N/D'}
- Tipo: ${caseData.tipo_proceso || 'N/D'}
- Total de tramites: ${state.tramites.length}

TRAMITES (del mas reciente al mas antiguo):
${tramitesText}

INSTRUCCIONES:
Genera un informe con estas secciones. Se completo pero conciso:

1. RESUMEN EJECUTIVO
Descripcion clara del estado actual de la causa en 3-4 oraciones.

2. OBJETO DE LA CAUSA
Que se reclama o disputa. Tipo de proceso y pretension.

3. PARTES
Actor, demandado y otros intervinientes que surjan de los tramites.

4. CRONOLOGIA PROCESAL RELEVANTE
Solo los hitos procesales importantes (demanda, contestacion, prueba, sentencia, recursos, etc). No listar cada proveido de mero tramite.

5. ESTADO ACTUAL
Cual es la situacion procesal hoy. Que se espera como proximo paso.

6. OBSERVACIONES
Plazos, irregularidades, puntos de atencion o riesgos que surjan del expediente.

IMPORTANTE: No inventes datos. Si algo no surge de los tramites, indicalo. Usa lenguaje juridico argentino.`;

    const response = await callGemini(apiKey, prompt);

    $('#summary-title').textContent = 'Informe IA';
    $('#summary-content').textContent = response;
    $('#summary-section').classList.remove('hidden');
    $('#summary-section').scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    if (err.message.includes('API_KEY_INVALID') || err.message.includes('401')) {
      showToast('API Key invalida. Verifica en la pestaña Info.', 'error');
    } else {
      showToast('Error IA: ' + err.message, 'error');
    }
  } finally {
    btn.textContent = 'Informe IA';
    btn.disabled = false;
  }
}

// ============================================
// NotebookLM Integration
// ============================================

async function sendToNotebookLM() {
  if (!state.currentCase || !state.tramites.length) {
    showToast('No hay trámites para enviar', 'error');
    return;
  }

  const btn = $('#btn-send-notebooklm');
  btn.disabled = true;
  btn.textContent = 'Preparando...';

  const progressEl = $('#download-progress');
  const progressFill = $('#progress-fill');
  const progressText = $('#progress-text');
  progressEl.classList.remove('hidden');
  progressText.textContent = 'Abriendo NotebookLM...';
  progressFill.style.width = '0%';

  try {
    const caseData = state.currentCase;
    const expNum = caseData.nro_expediente || 'sin_numero';
    const caratula = caseData.caratula || 'Expediente';
    const notebookTitle = `${caratula} - Exp. ${expNum}`;

    // Step 1: Find or open NotebookLM tab
    progressText.textContent = 'Buscando pestaña de NotebookLM...';
    let nlmTab = await findNotebookLMTab();

    if (!nlmTab) {
      // Open NotebookLM
      nlmTab = await chrome.tabs.create({ url: 'https://notebooklm.google.com/', active: false });
      progressText.textContent = 'Esperando que cargue NotebookLM...';
      await waitForTabLoad(nlmTab.id, 15000);
      // Give it extra time to initialize JS
      await sleep(3000);
    }

    // Step 2: Inject bridge script
    progressText.textContent = 'Conectando con NotebookLM...';
    progressFill.style.width = '10%';

    await chrome.scripting.executeScript({
      target: { tabId: nlmTab.id },
      files: ['content/notebooklm-bridge.js'],
      world: 'MAIN',
    });
    await sleep(1000);

    // Step 3: Create notebook via bridge
    progressText.textContent = 'Creando notebook...';
    progressFill.style.width = '15%';

    const createResult = await chrome.scripting.executeScript({
      target: { tabId: nlmTab.id },
      world: 'MAIN',
      func: async () => {
        try {
          const bridge = window.__SAE_NLM_BRIDGE;
          if (!bridge?.ready) throw new Error('Bridge no disponible');
          const projectId = await bridge.createNotebook();
          return { success: true, projectId };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
    });

    const createData = createResult?.[0]?.result;
    if (!createData?.success) {
      throw new Error(createData?.error || 'No se pudo crear el notebook');
    }
    const projectId = createData.projectId;

    // Step 4: Navigate to the new notebook
    await chrome.tabs.update(nlmTab.id, {
      url: `https://notebooklm.google.com/notebook/${projectId}`,
    });
    await waitForTabLoad(nlmTab.id, 10000);
    await sleep(2000);

    // Re-inject bridge (new page navigation) with retries
    let bridgeReady = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(2000);
      try {
        await chrome.scripting.executeScript({
          target: { tabId: nlmTab.id },
          files: ['content/notebooklm-bridge.js'],
          world: 'MAIN',
        });
        await sleep(1000);

        // Verify bridge has session params
        const check = await chrome.scripting.executeScript({
          target: { tabId: nlmTab.id },
          world: 'MAIN',
          func: () => {
            const b = window.__SAE_NLM_BRIDGE;
            if (!b?.ready) return { ready: false, reason: 'bridge not found' };
            const p = b.getSessionParams();
            return { ready: !!p.at, at: p.at ? 'ok' : 'missing', fsid: p.fsid ? 'ok' : 'missing', bl: p.bl ? 'ok' : 'missing' };
          },
        });
        const status = check?.[0]?.result;
        console.log('[SAE] Bridge check attempt', attempt + 1, status);
        if (status?.ready) {
          bridgeReady = true;
          break;
        }
      } catch (err) {
        console.log('[SAE] Bridge inject attempt', attempt + 1, 'failed:', err.message);
      }
      progressText.textContent = `Esperando que cargue NotebookLM (intento ${attempt + 2}/5)...`;
    }

    if (!bridgeReady) {
      throw new Error('No se pudo conectar con NotebookLM despues de 5 intentos. Recarga la pagina de NotebookLM y volve a intentar.');
    }

    // Step 5: Fetch text for all tramites and upload as individual sources
    progressText.textContent = 'Preparando tramites...';
    progressFill.style.width = '20%';

    // NLM limit: 50 sources per notebook
    const MAX_SOURCES = 50;
    const tramites = state.tramites;
    let successCount = 0;
    let failCount = 0;
    let skipped = 0;

    // First: upload a summary source with case metadata
    const summaryText = [
      `EXPEDIENTE: ${expNum}`,
      `CARATULA: ${caratula}`,
      `ACTOR: ${caseData.acto || caseData.actor || 'N/D'}`,
      `DEMANDADO: ${caseData.dema || caseData.demandado || 'N/D'}`,
      `JUZGADO: ${caseData.juzgado?.dscr || 'N/D'}`,
      `TIPO: ${caseData.tipo_proceso || 'N/D'}`,
      `TOTAL TRAMITES: ${tramites.length}`,
      '',
      'INDICE DE TRAMITES:',
      ...tramites.map((t, i) => `${i + 1}. ${t.fecha || 'S/F'} - ${t.dscr || 'Sin descripcion'}${t.firm ? ' [Firmado]' : ''}`),
    ].join('\n');

    progressText.textContent = 'Subiendo resumen del expediente...';
    const summaryResult = await nlmAddSource(nlmTab.id, projectId, `Expediente ${expNum} - Resumen`, summaryText);
    if (summaryResult) successCount++; else failCount++;
    await sleep(1000);

    // Get Gemini API key for PDF extraction
    const geminiKeyData = await chrome.storage.local.get('sae_gemini_key');
    const geminiKey = geminiKeyData.sae_gemini_key || null;

    // Then: upload each tramite as individual source
    const maxTramites = Math.min(tramites.length, MAX_SOURCES - 1); // -1 for summary

    for (let i = 0; i < maxTramites; i++) {
      const t = tramites[i];
      const pct = 20 + Math.round((i / maxTramites) * 75);
      progressFill.style.width = `${pct}%`;

      const num = String(i + 1).padStart(3, '0');
      const sourceTitle = `${num} - ${t.fecha || 'S/F'} - ${t.dscr || 'Tramite'}`;
      progressText.textContent = `[${i + 1}/${maxTramites}] ${t.dscr || 'Tramite'}...`;

      // 1. Get text content from API
      if (!t.texto && t.link) {
        try {
          t.texto = await getTramiteText(caseData, t.histid);
        } catch {}
      }
      let plainText = t.texto ? htmlToPlainText(t.texto) : '';

      // 2. Try to get PDF content (main document or attachments)
      let pdfText = '';
      const hasPdf = t.link || (Array.isArray(t.archivos) && t.archivos.length > 0);

      if (hasPdf && geminiKey) {
        try {
          progressText.textContent = `[${i + 1}/${maxTramites}] Extrayendo PDF: ${t.dscr || ''}...`;

          // Try main document PDF
          let pdfBase64 = null;
          try {
            const pdfUrl = await getTramitePdfUrl(caseData, t.histid);
            if (pdfUrl) {
              const pdfData = await downloadUrl(pdfUrl);
              if (pdfData?.base64) pdfBase64 = pdfData.base64;
            }
          } catch {}

          // If no main PDF, try first attachment
          if (!pdfBase64 && Array.isArray(t.archivos) && t.archivos.length > 0) {
            try {
              const archivo = t.archivos[0];
              const fileUrl = await getAttachedFileUrl(caseData, t.histid, archivo.nombre);
              if (fileUrl) {
                const fileData = await downloadUrl(fileUrl);
                if (fileData?.base64) pdfBase64 = fileData.base64;
              }
            } catch {}
          }

          // Extract text from PDF using Gemini
          if (pdfBase64) {
            pdfText = await extractPdfTextWithGemini(geminiKey, pdfBase64);
          }
        } catch (err) {
          console.warn(`[SAE NLM] PDF extraction failed for ${sourceTitle}:`, err.message);
        }
      }

      // 3. Build final source content
      const contentParts = [
        `FECHA: ${t.fecha || 'N/D'}`,
        `TIPO: ${t.dscr || 'N/D'}`,
        t.firm ? `FIRMADO: ${t.fechaFirma || 'Si'}` : null,
        '',
      ].filter(Boolean);

      if (plainText && plainText.length >= 10) {
        contentParts.push('--- TEXTO DEL TRAMITE ---', plainText);
      }
      if (pdfText && pdfText.length >= 10) {
        if (plainText && plainText.length >= 10) {
          contentParts.push('', '--- CONTENIDO DEL DOCUMENTO PDF ---');
        }
        contentParts.push(pdfText);
      }

      const sourceContent = contentParts.join('\n');

      // Skip only if we have NO content at all
      if (sourceContent.length < 50) {
        skipped++;
        continue;
      }

      const result = await nlmAddSource(nlmTab.id, projectId, sourceTitle, sourceContent);
      if (result) successCount++; else failCount++;

      // Rate limiting
      if (i < maxTramites - 1) await sleep(1500);
    }

    if (tramites.length > MAX_SOURCES - 1) {
      skipped += tramites.length - maxTramites;
    }

    // Done!
    progressFill.style.width = '100%';
    const parts = [`${successCount} fuente(s) subidas`];
    if (failCount > 0) parts.push(`${failCount} fallaron`);
    if (skipped > 0) parts.push(`${skipped} sin texto`);
    const msg = `NotebookLM: ${parts.join(', ')}`;
    progressText.textContent = msg;
    showToast(msg, failCount > 0 ? 'error' : 'success');

    // Focus the NotebookLM tab
    chrome.tabs.update(nlmTab.id, { active: true });

  } catch (err) {
    console.error('NotebookLM error:', err);
    showToast('Error NotebookLM: ' + err.message, 'error');
    progressText.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar a NotebookLM';
    setTimeout(() => progressEl.classList.add('hidden'), 5000);
  }
}

// Helper: add a text source to NotebookLM via bridge
async function nlmAddSource(tabId, projectId, title, content) {
  try {
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (pid, t, c) => {
        try {
          const b = window.__SAE_NLM_BRIDGE;
          if (!b?.ready) return { success: false, error: 'Bridge no disponible' };
          await b.addTextSource(pid, t, c);
          return { success: true };
        } catch (err) {
          return { success: false, error: err.message };
        }
      },
      args: [projectId, title, content],
    });
    return result?.[0]?.result?.success || false;
  } catch (err) {
    console.warn('[SAE NLM] Source error:', title, err.message);
    return false;
  }
}

// Helper: find existing NotebookLM tab
async function findNotebookLMTab() {
  const tabs = await chrome.tabs.query({ url: 'https://notebooklm.google.com/*' });
  return tabs[0] || null;
}

// Helper: wait for tab to finish loading
function waitForTabLoad(tabId, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // Resolve anyway, don't block
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Helper: sleep
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Extract text from a PDF using Gemini's vision/multimodal API
async function extractPdfTextWithGemini(apiKey, base64Pdf) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: 'application/pdf',
              data: base64Pdf,
            },
          },
          {
            text: 'Extraé todo el texto de este documento PDF. Devolvé SOLO el texto completo, sin comentarios ni explicaciones. Mantene el formato original lo mejor posible.',
          },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 8000,
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Gemini PDF: ${resp.status} ${err.substring(0, 100)}`);
  }

  const json = await resp.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini no devolvio texto del PDF');
  return text;
}

async function callGemini(apiKey, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8000,
      },
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(err.substring(0, 200));
  }

  const json = await resp.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Respuesta vacia de Gemini');
  return text;
}
