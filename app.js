/**
 * app.js
 * Main frontend application logic for SafePath.
 * Manages map initialization, geolocation, Leaflet popups, heatmap layers,
 * collapsible sidebar list, modal displays, and developer utilities.
 */

import {
  getReports,
  addReport,
  clearReports,
  importReports,
  checkRateLimit,
  resetRateLimits
} from './data.js';

// --- Application Constants & State ---
const DEFAULT_CENTER = [40.7128, -74.0060]; // New York City
const DEFAULT_ZOOM = 13;
const TILE_LAYER_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

let map = null;
let heatmapLayer = null;
let activePopup = null;
let selectedCategory = '';
let activeFilters = {
  categories: new Set(['Poor lighting', 'Harassment', 'Isolated / no people around', 'Unsafe transit stop', 'Other']),
  timeRange: 'all'
};

// --- DOM Elements ---
const infoBtn = document.getElementById('info-btn');
const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
const sidebar = document.getElementById('sidebar');
const dragHandle = document.getElementById('sidebar-drag-handle');
const reportList = document.getElementById('report-list');
const sidebarReportCount = document.getElementById('sidebar-report-count');
const reportCountBadge = document.getElementById('report-count-badge');
const locateBtn = document.getElementById('locate-btn');

const filterBtn = document.getElementById('filter-btn');
const filterBadge = document.getElementById('filter-badge');
const filterPanel = document.getElementById('filter-panel');
const filterCloseBtn = document.getElementById('filter-close-btn');
const filterResetBtn = document.getElementById('filter-reset-btn');
const filterCategoryInputs = document.querySelectorAll('#filter-categories input[type="checkbox"]');
const filterTimeRangeInputs = document.querySelectorAll('#filter-timerange input[type="radio"]');

const infoModal = document.getElementById('info-modal');
const modalCloseBtn = document.getElementById('modal-close-btn');
const modalFooterCloseBtn = document.getElementById('modal-footer-close-btn');
const devResetBtn = document.getElementById('dev-reset-btn');
const devLoadDemoBtn = document.getElementById('dev-load-demo-btn');
const brandTrigger = document.getElementById('brand-logo-trigger');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  setupEventListeners();
  await updateUI();;

  // Set up relative time auto-refresher every 60s
  setInterval(async () => {
    await updateUI();
  }, 60000);
});

// --- Map Logic ---
function initMap() {
  // Initialize Leaflet map
  map = L.map('map', {
    zoomControl: true,
    minZoom: 2,
    maxZoom: 18
  }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  // Add CartoDB Positron clean map tiles
  L.tileLayer(TILE_LAYER_URL, {
    maxZoom: 19,
    attribution: TILE_ATTRIBUTION
  }).addTo(map);

  // Attempt to locate user via browser Geolocation API
  locateUser(true); // true = initial load zoom behavior

  // Handle map click events to drop a report pin
  map.on('click', handleMapClick);
}

function locateUser(isInitialLoad = false) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'error');
    return;
  }

  showToast('Locating your position...', 'info');

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      const userCoords = [latitude, longitude];

      map.setView(userCoords, isInitialLoad ? 14 : map.getZoom());
      showToast('Centered map on your current location.', 'success');

      // Draw a subtle pulsating circle at the user's actual location
      const userDot = L.circleMarker(userCoords, {
        radius: 8,
        fillColor: '#6366f1',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.8
      }).addTo(map);

      userDot.bindTooltip("You are here", { direction: 'top', offset: [0, -5] });
    },
    (error) => {
      console.warn(`Geolocation error (${error.code}): ${error.message}`);
      if (isInitialLoad) {
        showToast('Location access denied or unavailable. Defaulting center.', 'error');
      } else {
        showToast('Unable to fetch location. Please check browser permissions.', 'error');
      }
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
  );
}

// --- Click to Report Workflow ---
function handleMapClick(e) {
  // Close any previously open report popup before opening a new one
  if (activePopup) {
    map.closePopup(activePopup);
    activePopup = null;
  }

  const { lat, lng } = e.latlng;
  selectedCategory = ''; // Reset selected category

  // Create customized Leaflet popup wrapper
  const popup = L.popup({
    closeButton: true,
    closeOnClick: false,
    autoClose: false,
    className: 'custom-leaflet-popup',
    offset: L.point(0, -5),
    autoPan: true,
    autoPanPadding: L.point(16, 16),
    maxWidth: 260,
    minWidth: 220
  }).setLatLng(e.latlng);

  // Generate popup form structure & wire up button triggers
  const popupContent = createPopupContent(lat, lng, popup);
  popup.setContent(popupContent);
  popup.openOn(map);
  activePopup = popup;
}

function createPopupContent(lat, lng, popupInstance) {
  const container = document.createElement('div');
  container.className = 'report-popup-form';

  container.innerHTML = `
    <h3>Report Safety Concern</h3>
    <p class="form-desc">Fully anonymous. Click below to tag this area. A random 50-100m offset will be applied for security.</p>
    <div class="category-buttons">
      <button type="button" class="btn-cat-select" data-category="Poor lighting">
        <span class="emoji-indicator">💡</span> Poor Lighting
      </button>
      <button type="button" class="btn-cat-select" data-category="Harassment">
        <span class="emoji-indicator">⚠️</span> Harassment
      </button>
      <button type="button" class="btn-cat-select" data-category="Isolated / no people around">
        <span class="emoji-indicator">👥</span> Isolated / Empty
      </button>
      <button type="button" class="btn-cat-select" data-category="Unsafe transit stop">
        <span class="emoji-indicator">🚌</span> Unsafe Transit Stop
      </button>
      <button type="button" class="btn-cat-select" data-category="Other">
        <span class="emoji-indicator">✏️</span> Other...
      </button>
    </div>
    
    <div class="other-note-container" id="textarea-wrap">
      <textarea id="other-note-text" maxlength="100" placeholder="Brief note e.g. dark alley, dark bus stop (max 100 chars)..."></textarea>
      <div class="char-counter" id="note-char-count">0/100</div>
    </div>
    
    <button type="button" id="submit-report-btn" class="btn-submit" disabled>Submit Report</button>
  `;

  const buttons = container.querySelectorAll('.btn-cat-select');
  const textareaWrap = container.querySelector('#textarea-wrap');
  const textarea = container.querySelector('#other-note-text');
  const charCount = container.querySelector('#note-char-count');
  const submitBtn = container.querySelector('#submit-report-btn');

  // Wire category button selection
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all
      buttons.forEach(b => b.classList.remove('active'));
      // Activate clicked
      btn.classList.add('active');
      selectedCategory = btn.getAttribute('data-category');

      if (selectedCategory === 'Other') {
        textareaWrap.classList.add('show');
        textarea.focus();
        validateForm();
      } else {
        textareaWrap.classList.remove('show');
        submitBtn.disabled = false;
      }
    });
  });

  // Handle textarea char counts and validations
  textarea.addEventListener('input', () => {
    const textLength = textarea.value.length;
    charCount.textContent = `${textLength}/100`;
    validateForm();
  });

  function validateForm() {
    if (selectedCategory === 'Other') {
      const val = textarea.value.trim();
      submitBtn.disabled = val.length === 0; // Require notes if other
    } else {
      submitBtn.disabled = false;
    }
  }

  // Handle submit action
  submitBtn.addEventListener('click', async () => {
    // Client-side rate check
    const rateCheck = checkRateLimit();
    if (!rateCheck.allowed) {
      const waitMins = Math.ceil((rateCheck.resetTime - Date.now()) / 60000);
      showToast(`Submission blocked! Rate limit exceeded. Try again in ${waitMins} min(s).`, 'error');
      popupInstance.close();
      return;
    }

    const note = selectedCategory === 'Other' || textarea.value.trim() ? textarea.value.trim() : null;
    const reportData = {
      lat,
      lng,
      category: selectedCategory,
      note
    };

    const result = await addReport(reportData);
    if (result) {
      showToast('Safety concern reported anonymously.', 'success');
      popupInstance.close();
      await updateUI();
    } else {
      showToast('Error storing report. Please try again.', 'error');
    }
  });

  return container;
}

// --- Filtering ---
function applyFilters(reports) {
  const now = Date.now();
  const rangeMs = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };

  return reports.filter(r => {
    if (!activeFilters.categories.has(r.category)) return false;

    if (activeFilters.timeRange !== 'all') {
      const createdAtMs = typeof r.created_at === 'number'
        ? r.created_at
        : new Date(r.created_at).getTime();
      const windowMs = rangeMs[activeFilters.timeRange];
      if (now - createdAtMs > windowMs) return false;
    }

    return true;
  });
}

function updateFilterBadge() {
  const isDefault = activeFilters.categories.size === 5 && activeFilters.timeRange === 'all';
  filterBadge.style.display = isDefault ? 'none' : 'flex';
}

// --- UI Sync (Heatmap & Sidebar) ---
async function updateUI() {
  await renderHeatmap();
  await renderSidebarList();
}

async function renderHeatmap() {
  const allReports = await getReports();
  const reports = applyFilters(allReports);

  // Remove existing markers layer if it exists
  if (heatmapLayer) {
    map.removeLayer(heatmapLayer);
  }

  // Solid, fixed-size red pins instead of a blurred heat gradient —
  // these mark the exact reported spot and stay fully visible/opaque
  // at every zoom level, since their pixel size doesn't scale with zoom.
  heatmapLayer = L.layerGroup();

  reports.forEach(r => {
    const marker = L.circleMarker([r.lat, r.lng], {
      radius: 9,
      color: '#ffffff',
      weight: 2,
      fillColor: '#dc2626',
      fillOpacity: 1,
      opacity: 1
    });
    marker.bindTooltip(r.category, { direction: 'top', offset: [0, -8] });
    heatmapLayer.addLayer(marker);
  });

  heatmapLayer.addTo(map);
}

async function renderSidebarList() {
  const allReports = await getReports();
  const reports = applyFilters(allReports);
  const count = reports.length;

  // Sync count indicators
  sidebarReportCount.textContent = count;
  reportCountBadge.textContent = count;

  if (count > 0) {
    reportCountBadge.style.display = 'flex';
  } else {
    reportCountBadge.style.display = 'none';
  }

  // Clear list
  reportList.innerHTML = '';

  if (count === 0) {
    reportList.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p>No reports in this area yet.<br>Click on the map to add one.</p>
      </div>
    `;
    return;
  }

  // Build report list items
  reports.forEach(report => {
    const card = document.createElement('article');
    card.className = 'report-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    const formattedTime = getRelativeTime(report.created_at);
    const escapedNote = escapeHTML(report.note);
    const categoryLabel = report.category === 'Other' ? 'Other concern' : report.category;

    card.innerHTML = `
      <div class="card-header">
        <span class="badge-cat" data-category="${report.category}">${escapeHTML(categoryLabel)}</span>
        <span class="card-time">${formattedTime}</span>
      </div>
      ${escapedNote ? `<p class="card-note">"${escapedNote}"</p>` : ''}
    `;

    // Interactivity: Center map on click (uses privacy offset coordinate)
    const cardClick = () => {
      // Pan to coordinates with moderate zoom
      map.setView([report.lat, report.lng], 15);

      // Spark a temporary glow/circle indicator at the location to alert the user
      const highlightIndicator = L.circle([report.lat, report.lng], {
        radius: 80,
        color: '#6366f1',
        fillColor: '#818cf8',
        fillOpacity: 0.35,
        weight: 2,
        dashArray: '4, 4'
      }).addTo(map);

      // Fade indicator
      setTimeout(() => {
        map.removeLayer(highlightIndicator);
      }, 2000);

      // On mobile, auto-close the drawer after selection so they can inspect the map
      if (window.innerWidth < 768) {
        closeSidebar();
      }
    };

    card.addEventListener('click', cardClick);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        cardClick();
      }
    });

    reportList.appendChild(card);
  });
}

// --- Event Listeners Configuration ---
function setupEventListeners() {
  // Sidebar actions
  sidebarToggleBtn.addEventListener('click', toggleSidebar);
  sidebarCloseBtn.addEventListener('click', closeSidebar);

  // Sidebar mobile touch drag down to close
  let touchStartY = 0;
  dragHandle.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  dragHandle.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    // If swiped down by more than 60px
    if (touchEndY - touchStartY > 60) {
      closeSidebar();
    }
  }, { passive: true });

  // Locate current position
  locateBtn.addEventListener('click', () => locateUser(false));

  // Filter panel actions
  filterBtn.addEventListener('click', () => {
    filterPanel.classList.toggle('open');
    filterPanel.setAttribute('aria-hidden', filterPanel.classList.contains('open') ? 'false' : 'true');
  });

  filterCloseBtn.addEventListener('click', () => {
    filterPanel.classList.remove('open');
    filterPanel.setAttribute('aria-hidden', 'true');
  });

  filterCategoryInputs.forEach(input => {
    input.addEventListener('change', async () => {
      if (input.checked) {
        activeFilters.categories.add(input.value);
      } else {
        activeFilters.categories.delete(input.value);
      }
      updateFilterBadge();
      await updateUI();
    });
  });

  filterTimeRangeInputs.forEach(input => {
    input.addEventListener('change', async () => {
      if (input.checked) {
        activeFilters.timeRange = input.value;
        updateFilterBadge();
        await updateUI();
      }
    });
  });

  filterResetBtn.addEventListener('click', async () => {
    filterCategoryInputs.forEach(input => { input.checked = true; });
    filterTimeRangeInputs.forEach(input => { input.checked = input.value === 'all'; });
    activeFilters.categories = new Set(['Poor lighting', 'Harassment', 'Isolated / no people around', 'Unsafe transit stop', 'Other']);
    activeFilters.timeRange = 'all';
    updateFilterBadge();
    await updateUI();
    showToast('Filters reset.', 'info');
  });

  // Modals actions
  infoBtn.addEventListener('click', openInfoModal);
  modalCloseBtn.addEventListener('click', closeInfoModal);
  modalFooterCloseBtn.addEventListener('click', closeInfoModal);
  infoModal.addEventListener('click', (e) => {
    if (e.target === infoModal) {
      closeInfoModal();
    }
  });

  // Clicking brand navigates map to center/fit bounds
  brandTrigger.addEventListener('click', () => {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    showToast('Centered map view.', 'info');
  });

  // Developer action buttons
  devResetBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete all reports and reset the demo?')) {
      await clearReports();
      resetRateLimits();
      await updateUI();
      closeInfoModal();
      showToast('Demo reports and limits cleared.', 'success');
    }
  });

  devLoadDemoBtn.addEventListener('click', async () => {
    await loadMockDemoData();
    closeInfoModal();
    showToast('Loaded 8 localized demo safety reports.', 'success');
  });
}

// --- Drawer / Sidebar States ---
function toggleSidebar() {
  const isOpen = sidebar.classList.contains('open');
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function openSidebar() {
  sidebar.classList.add('open');
  sidebar.setAttribute('aria-hidden', 'false');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebar.setAttribute('aria-hidden', 'true');
}

// --- Info Modal States ---
function openInfoModal() {
  infoModal.classList.add('open');
  infoModal.setAttribute('aria-hidden', 'false');
}

function closeInfoModal() {
  infoModal.classList.remove('open');
  infoModal.setAttribute('aria-hidden', 'true');
}

// --- Toast Utilities ---
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span>${escapeHTML(message)}</span>
    <button class="toast-close" aria-label="Dismiss message">&times;</button>
  `;

  // Bind manual dismissal
  toast.querySelector('.toast-close').addEventListener('click', () => {
    dismissToast(toast);
  });

  // Append toast
  container.appendChild(toast);

  // Auto-remove after 4.5s
  setTimeout(() => {
    dismissToast(toast);
  }, 4500);
}

function dismissToast(toastElement) {
  if (toastElement.parentNode) {
    toastElement.classList.add('fade-out');
    toastElement.addEventListener('animationend', () => {
      toastElement.remove();
    });
  }
}

// --- Mock Seeding logic for Demo ---
async function loadMockDemoData() {
  const center = map.getCenter();
  const now = Date.now();

  const presets = [
    { category: 'Poor lighting', note: 'Streetlights are broken on this block. Extremely pitch black after 7 PM.' },
    { category: 'Harassment', note: 'Encountered aggressive catcalling and shadowing near the intersection.' },
    { category: 'Isolated / no people around', note: 'Alley path is highly secluded. Zero cameras or storefronts open.' },
    { category: 'Unsafe transit stop', note: 'Bus stop shelter is completely dark with no safety lights or emergency button.' },
    { category: 'Poor lighting', note: 'Dim pedestrian path under the highway. Needs surveillance.' },
    { category: 'Harassment', note: 'A group loitering outside the subway stairwells blocking and calling at pass-bys.' },
    { category: 'Isolated / no people around', note: 'Industrial zone sidewalks are entirely empty at night.' },
    { category: 'Other', note: 'Illegal dumping and blind-corner fences create an isolated trap path.' }
  ];

  const generated = presets.map((preset, index) => {
    // Spread markers around current viewport center (+/- ~1.2 kilometers)
    const latOffset = (Math.random() - 0.5) * 0.018;
    const lngOffset = (Math.random() - 0.5) * 0.018;

    // Stagger timestamps backwards to create a clean activity log layout (mins/hours/days ago)
    const minutesAgo = (index + 1) * (15 + Math.floor(Math.random() * 45));
    const timestamp = now - (minutesAgo * 60 * 1000);

    return {
      id: `demo-pin-${index}-${Math.random().toString(36).substring(2, 6)}`,
      lat: center.lat + latOffset,
      lng: center.lng + lngOffset,
      category: preset.category,
      note: preset.note,
      created_at: timestamp
    };
  });

  await importReports(generated);
  await updateUI();
}

// --- Helper Functions ---

/**
 * Transforms timestamp differences into readable human relative string.
 * @param {number} timestamp - The millisecond epoch timestamp.
 * @returns {string} Relative age string.
 */
function getRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  if (diffMs < 0 || mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

/**
 * Escapes unsafe user text properties for raw injection defense.
 * @param {string} str - Input text
 * @returns {string} Sanitized string
 */
function escapeHTML(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
