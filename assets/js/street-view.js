/* ========== STREET VIEW & MAPILLARY ========== */

// AbortController for canceling in-flight Mapillary requests
let mapillaryAbortController = null;

function showStreetView() {
  // Cancel any pending Mapillary requests
  if (mapillaryAbortController) {
    mapillaryAbortController.abort();
    mapillaryAbortController = null;
  }
  
  if (!streetViewMarker) {
    alert('Please click on the map first to select a location');
    return;
  }
  
  currentView = 'streetview';
  
  const mapEl = document.getElementById('map');
  const mapCanvasEl = document.getElementById('mapCanvas');
  const view3D = document.getElementById('view3DContainer');
  const mapillaryEl = document.getElementById('mapillaryContainer');
  
  if (mapEl) mapEl.style.display = 'none';
  if (mapCanvasEl) mapCanvasEl.style.display = 'none';
  if (view3D) view3D.classList.remove('active');
  if (mapillaryEl) mapillaryEl.classList.remove('active');
  
  const container = document.getElementById('streetViewContainer');
  if (!container) {
    console.error('Street View container not found');
    return;
  }
  container.classList.add('active');
  
  const lat = streetViewMarker.lat;
  const lng = streetViewMarker.lng;
  const iframe = document.getElementById('streetViewPano');
  
  if (iframe) {
    iframe.src = `https://www.google.com/maps/embed/v1/streetview?location=${lat},${lng}&key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&heading=0&pitch=0&fov=90`;
  }

  console.log(`Street View loaded at ${lat}, ${lng}`);
  if (typeof syncDrawingPanel === 'function') syncDrawingPanel();
}

async function showMapillary() {
  // Cancel any previous request
  if (mapillaryAbortController) {
    mapillaryAbortController.abort();
  }
  
  // Create new AbortController for this request
  mapillaryAbortController = new AbortController();
  
  if (!streetViewMarker) {
    alert('Please click on the map first to select a location');
    return;
  }
  
  const statusEl = document.getElementById('status');
  const lat = streetViewMarker.lat;
  const lng = streetViewMarker.lng;

  if (typeof mapillary === 'undefined') {
    alert('Mapillary library failed to load from CDN. This could be due to network/firewall blocking unpkg.com, ad blocker interference, or browser compatibility. Please use Google Street View instead.');
    return;
  }

  if (!mapillary.Viewer) {
    alert('Mapillary library loaded but Viewer class not found. Please use Google Street View instead.');
    return;
  }

  try {
    let accessToken;
    if (typeof mapillaryAuth === 'undefined') {
      throw new Error('Mapillary helper not available. Refresh the page.');
    }

    if (statusEl) {
      statusEl.textContent = 'Authenticating with Mapillary...';
    }

    try {
      accessToken = await mapillaryAuth.getAccessToken();
    } catch (authError) {
      console.error('Mapillary auth error:', authError);
      if (statusEl) {
        statusEl.textContent = 'Mapillary token missing. Update credentials below.';
      }
      alert('Mapillary now requires a short-lived access token. Save your client ID and secret in the Mapillary settings panel, refresh the token, then try again.');
      return;
    }

    if (statusEl) {
      statusEl.textContent = 'Searching for Mapillary imagery...';
    }
    const offset = 0.001;
    const bbox = `${lng-offset},${lat-offset},${lng+offset},${lat+offset}`;

    const apiUrl = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(accessToken)}&fields=id,computed_geometry&bbox=${bbox}&limit=1`;

    const response = await fetch(apiUrl, {
      signal: mapillaryAbortController.signal
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        if (typeof mapillaryAuth !== 'undefined') {
          mapillaryAuth.clearAccessToken();
        }
        throw new Error('Mapillary token expired or is invalid. Refresh it in the settings panel and try again.');
      }

      let errorDetail = '';
      try {
        const errorPayload = await response.json();
        errorDetail = errorPayload?.error?.message || '';
      } catch (e) {
        // ignore parse error
      }

      throw new Error(errorDetail || `API request failed (${response.status})`);
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
      alert('No Mapillary imagery found at this location. Try a major city (Paris, NYC, Amsterdam), urban/downtown areas, or Google Street View instead (better coverage).');
      if (statusEl) {
        statusEl.textContent = 'No Mapillary imagery found';
      }
      return;
    }
    
    const imageId = data.data[0].id;
    
    currentView = 'mapillary';
    
    const mapEl = document.getElementById('map');
    const mapCanvasEl = document.getElementById('mapCanvas');
    const view3DEl = document.getElementById('view3DContainer');
    const streetViewEl = document.getElementById('streetViewContainer');
    
    if (mapEl) mapEl.style.display = 'none';
    if (mapCanvasEl) mapCanvasEl.style.display = 'none';
    if (view3DEl) view3DEl.classList.remove('active');
    if (streetViewEl) streetViewEl.classList.remove('active');
    
    const container = document.getElementById('mapillaryContainer');
    if (!container) {
      console.error('Mapillary container not found');
      return;
    }
    container.classList.add('active');
    
    const viewerDiv = document.getElementById('mapillaryViewer');
    if (viewerDiv) {
      viewerDiv.innerHTML = '';
    }
    
    if (mapillaryViewer) {
      try {
        mapillaryViewer.remove();
      } catch (e) {
        console.log('Error removing old viewer:', e);
      }
      mapillaryViewer = null;
    }
    
    const { Viewer } = mapillary;
    
    mapillaryViewer = new Viewer({
      accessToken: accessToken,
      container: 'mapillaryViewer',
      imageId: imageId
    });

    if (statusEl) {
      statusEl.textContent = 'Mapillary loaded successfully';
    }

    if (typeof syncDrawingPanel === 'function') syncDrawingPanel();
  } catch (error) {
    // Don't show error if request was aborted
    if (error.name === 'AbortError') {
      console.log('Mapillary request cancelled');
      return;
    }
    console.error('Mapillary error:', error);
    alert(`Failed to load Mapillary: ${error.message}. This location may not have coverage or the token may be invalid.`);
    if (statusEl) {
      statusEl.textContent = 'Mapillary failed - check credentials or coverage';
    }
    backToMap();
  } finally {
    mapillaryAbortController = null;
  }
}

function backToMap() {
  // Cancel any pending Mapillary requests
  if (mapillaryAbortController) {
    mapillaryAbortController.abort();
    mapillaryAbortController = null;
  }
  
  const streetViewEl = document.getElementById('streetViewContainer');
  const mapillaryEl = document.getElementById('mapillaryContainer');
  const view3DEl = document.getElementById('view3DContainer');
  const mapEl = document.getElementById('map');
  const mapCanvasEl = document.getElementById('mapCanvas');
  
  if (streetViewEl) streetViewEl.classList.remove('active');
  if (mapillaryEl) mapillaryEl.classList.remove('active');
  if (view3DEl) view3DEl.classList.remove('active');
  
  if (mapEl) mapEl.style.display = 'block';
  if (mapCanvasEl) mapCanvasEl.style.display = 'block';
  
  currentView = '2d';
  
  if (mapMode === 'ground' && streetViewMarker) {
    document.getElementById('streetViewControls').classList.add('visible');
  }
  
  setTimeout(() => {
    map.invalidateSize();
  }, 100);

  if (mapillaryViewer) {
    mapillaryViewer.remove();
    mapillaryViewer = null;
  }

  if (typeof syncDrawingPanel === 'function') syncDrawingPanel();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  const collapseBtn = sidebar.querySelector('.collapse-btn');
  
  sidebar.classList.toggle('collapsed');
  const isCollapsed = sidebar.classList.contains('collapsed');
  
  toggle.classList.toggle('visible', isCollapsed);
  collapseBtn.textContent = isCollapsed ? '▶' : '◀';
}

function toggleSummary() {
  const summary = document.getElementById('summaryPanel');
  const toggle = document.getElementById('summaryToggle');
  const collapseBtn = summary.querySelector('.collapse-btn');
  
  summary.classList.toggle('collapsed');
  const isCollapsed = summary.classList.contains('collapsed');
  
  toggle.classList.toggle('visible', isCollapsed);
  collapseBtn.textContent = isCollapsed ? '◀' : '▶';
}

function showHelp() {
  document.getElementById('helpOverlay').classList.add('visible');
}

function hideHelp() {
  document.getElementById('helpOverlay').classList.remove('visible');
}

document.getElementById('helpOverlay').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) {
    hideHelp();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.getElementById('helpOverlay').classList.contains('visible')) {
    hideHelp();
  }
});

function updateMapillaryLaunchState(status) {
  const button = document.getElementById('mapillaryLaunchButton');
  if (!button) return;
  const state = status || (typeof mapillaryAuth !== 'undefined' ? mapillaryAuth.getStatus() : null);
  if (!state) {
    button.disabled = false;
    button.title = 'Open Mapillary imagery for the selected location';
    return;
  }
  button.disabled = !state.hasToken;
  button.title = state.hasToken
    ? 'Open Mapillary imagery for the selected location'
    : 'Save credentials and refresh the Mapillary token first.';
}

if (typeof mapillaryAuth !== 'undefined') {
  updateMapillaryLaunchState(mapillaryAuth.getStatus());
  document.addEventListener('mapillary-auth-updated', (event) => {
    updateMapillaryLaunchState(event.detail);
  });
} else {
  console.warn('mapillaryAuth helper unavailable; Mapillary button state will not auto-update.');
}

initFilters();
document.getElementById('streetViewControls').classList.remove('visible');
setTimeout(() => {
  map.invalidateSize();
  resizeMapCanvas();
}, 100);
