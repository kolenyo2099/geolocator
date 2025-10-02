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
}

async function showMapillary() {
  if (!streetViewMarker) {
    alert('Please click on the map first to select a location');
    return;
  }
  
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
  
  document.getElementById('status').textContent = 'Searching for Mapillary imagery...';
  
  try {
    const accessToken = 'MLY|4142433049200173|72206abe5035850d6743b23a49c41333';
    
    const offset = 0.001;
    const bbox = `${lng-offset},${lat-offset},${lng+offset},${lat+offset}`;
    
    const apiUrl = `https://graph.mapillary.com/images?access_token=${accessToken}&fields=id,geometry,captured_at&bbox=${bbox}&limit=1`;
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }
    
    const data = await response.json();
    
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
    
    document.getElementById('status').textContent = 'Mapillary loaded successfully';
    
  } catch (error) {
    console.error('Mapillary error:', error);
    alert(`Failed to load Mapillary: ${error.message}. This location may not have coverage. Try Google Street View instead or a different location with better coverage.`);
    document.getElementById('status').textContent = 'Mapillary failed - try Street View';
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
    if (mapMode === 'draw') resizeMapCanvas();
  }, 100);
  
  if (mapillaryViewer) {
    mapillaryViewer.remove();
    mapillaryViewer = null;
  }
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

initFilters();
document.getElementById('streetViewControls').classList.remove('visible');
setTimeout(() => {
  map.invalidateSize();
  resizeMapCanvas();
}, 100);
