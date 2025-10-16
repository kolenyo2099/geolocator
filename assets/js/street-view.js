/* ========== STREET VIEW & MAPILLARY ========== */
function showStreetView() {
  if (!streetViewMarker) {
    alert('Please click on the map first to select a location');
    return;
  }
  
  currentView = 'streetview';
  
  document.getElementById('map').style.display = 'none';
  document.getElementById('mapCanvas').style.display = 'none';
  document.getElementById('view3DContainer').classList.remove('active');
  document.getElementById('mapillaryContainer').classList.remove('active');
  
  const container = document.getElementById('streetViewContainer');
  container.classList.add('active');
  
  const lat = streetViewMarker.lat;
  const lng = streetViewMarker.lng;
  const iframe = document.getElementById('streetViewPano');
  
  iframe.src = `https://www.google.com/maps/embed/v1/streetview?location=${lat},${lng}&key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&heading=0&pitch=0&fov=90`;

  console.log(`Street View loaded at ${lat}, ${lng}`);
  if (typeof syncDrawingPanel === 'function') syncDrawingPanel();
}

async function showMapillary() {
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

    statusEl.textContent = 'Authenticating with Mapillary...';

    try {
      accessToken = await mapillaryAuth.getAccessToken();
    } catch (authError) {
      console.error('Mapillary auth error:', authError);
      statusEl.textContent = 'Mapillary token missing. Update credentials below.';
      alert('Mapillary now requires a short-lived access token. Save your client ID and secret in the Mapillary settings panel, refresh the token, then try again.');
      return;
    }

    statusEl.textContent = 'Searching for Mapillary imagery...';
    const offset = 0.001;
    const bbox = `${lng-offset},${lat-offset},${lng+offset},${lat+offset}`;

    const apiUrl = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(accessToken)}&fields=id,computed_geometry&bbox=${bbox}&limit=1`;

    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(15000) // 15 second timeout for Mapillary API
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

      throw new Error(errorDetail || `Mapillary API request failed (${response.status})`);
    }

    const data = await response.json();
    
    if (!data) {
      throw new Error('Invalid response from Mapillary API');
    }

    if (!data.data || data.data.length === 0) {
      alert('No Mapillary imagery found at this location. Try a major city (Paris, NYC, Amsterdam), urban/downtown areas, or Google Street View instead (better coverage).');
      document.getElementById('status').textContent = 'No Mapillary imagery found';
      return;
    }
    
    const imageId = data.data[0].id;
    
    currentView = 'mapillary';
    
    document.getElementById('map').style.display = 'none';
    document.getElementById('mapCanvas').style.display = 'none';
    document.getElementById('view3DContainer').classList.remove('active');
    document.getElementById('streetViewContainer').classList.remove('active');
    
    const container = document.getElementById('mapillaryContainer');
    container.classList.add('active');
    
    const viewerDiv = document.getElementById('mapillaryViewer');
    viewerDiv.innerHTML = '';
    
    if (mapillaryViewer) {
      try {
        // Properly cleanup the viewer before creating a new one
        if (typeof mapillaryViewer.remove === 'function') {
          mapillaryViewer.remove();
        }
      } catch (e) {
        console.warn('Error removing old Mapillary viewer:', e);
      }
      mapillaryViewer = null;
    }
    
    const { Viewer } = mapillary;
    
    mapillaryViewer = new Viewer({
      accessToken: accessToken,
      container: 'mapillaryViewer',
      imageId: imageId
    });

    statusEl.textContent = 'Mapillary loaded successfully';

    if (typeof syncDrawingPanel === 'function') syncDrawingPanel();
  } catch (error) {
    console.error('Mapillary error:', error);
    
    let userMessage = error.message;
    if (error.name === 'AbortError') {
      userMessage = 'Request timed out. Please try again or check your internet connection.';
    }
    
    alert(`Failed to load Mapillary: ${userMessage}. This location may not have coverage or the token may be invalid.`);
    statusEl.textContent = 'Mapillary failed - check credentials or coverage';
    backToMap();
  }
}

function backToMap() {
  document.getElementById('streetViewContainer').classList.remove('active');
  document.getElementById('mapillaryContainer').classList.remove('active');
  document.getElementById('view3DContainer').classList.remove('active');
  
  document.getElementById('map').style.display = 'block';
  document.getElementById('mapCanvas').style.display = 'block';
  
  currentView = '2d';
  
  if (mapMode === 'ground' && streetViewMarker) {
    document.getElementById('streetViewControls').classList.add('visible');
  }
  
  setTimeout(() => {
    map.invalidateSize();
  }, 100);

  if (mapillaryViewer) {
    try {
      if (typeof mapillaryViewer.remove === 'function') {
        mapillaryViewer.remove();
      }
    } catch (e) {
      console.warn('Error cleaning up Mapillary viewer:', e);
    }
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
