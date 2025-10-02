/* ========== LINE OF SIGHT FUNCTIONALITY ========== */
let losPointA = null, losPointB = null;
let losMarkerA = null, losMarkerB = null;
let losLine = null;
let mapboxToken = '';
let elevationOverlay = null;
let losMode = 'mapbox';
let peakFinderPanel = null;
let losMarkerAWasVisible = false;
let losMarkerBWasVisible = false;
let losLineWasVisible = false;
let losDetachedView = '2d';

function detachLOSMode() {
  losMarkerAWasVisible = !!(losMarkerA && map.hasLayer(losMarkerA));
  if (losMarkerAWasVisible) {
    map.removeLayer(losMarkerA);
  }

  losMarkerBWasVisible = !!(losMarkerB && map.hasLayer(losMarkerB));
  if (losMarkerBWasVisible) {
    map.removeLayer(losMarkerB);
  }

  losLineWasVisible = !!(losLine && map.hasLayer(losLine));
  if (losLineWasVisible) {
    map.removeLayer(losLine);
  }

  if ((currentView === 'streetview' || currentView === 'mapillary') && typeof backToMap === 'function') {
    backToMap();
  }

  losDetachedView = (currentView === '3d' || currentView === 'peakfinder') ? currentView : '2d';
  if (currentView === '3d' || currentView === 'peakfinder') {
    toggleMapView();
  }
}

function restoreLOSMode() {
  if (losMarkerA && losMarkerAWasVisible && !map.hasLayer(losMarkerA)) {
    losMarkerA.addTo(map);
  }

  if (losMarkerB && losMarkerBWasVisible && !map.hasLayer(losMarkerB)) {
    losMarkerB.addTo(map);
  }

  if (losLine && losLineWasVisible && !map.hasLayer(losLine)) {
    losLine.addTo(map);
  }

  if (losDetachedView === '3d' && losPointA && losPointB) {
    initialize3DView();
  } else if (losDetachedView === 'peakfinder' && losPointA && losPointB) {
    initializePeakFinder();
  }

  updateLOSStatus();
  losDetachedView = '2d';
  losMarkerAWasVisible = false;
  losMarkerBWasVisible = false;
  losLineWasVisible = false;
}

function setLOSMode(mode) {
  losMode = mode;
  
  document.getElementById('mapboxLOSMode').classList.toggle('active', mode === 'mapbox');
  document.getElementById('peakfinderLOSMode').classList.toggle('active', mode === 'peakfinder');
  
  if (losPointA && losPointB) {
    if (mode === 'mapbox') {
      hidePeakFinder();
      initialize3DView();
    } else {
      hide3DView();
      initializePeakFinder();
    }
  }
  
  updateLOSStatus();
}

function ensureMapboxToken() {
  if (!mapboxToken) {
    const input = prompt('Enter your Mapbox access token (stored locally):');
    if (input && input.trim()) {
      mapboxToken = input.trim();
      localStorage.setItem('mapboxToken', mapboxToken);
      const tokenInput = document.getElementById('mapboxToken');
      if (tokenInput) tokenInput.value = mapboxToken;
      updateLOSStatus();
    }
  }
  return !!mapboxToken;
}

function toggleElevationOverlay() {
  if (!elevationOverlay) {
    if (!ensureMapboxToken()) {
      alert('A Mapbox token is required to enable the elevation overlay.');
      return;
    }
    const opacitySlider = document.getElementById('elevationOpacity');
    const opacity = opacitySlider ? (parseInt(opacitySlider.value, 10) / 100) : 0.6;
    elevationOverlay = L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles/{z}/{x}/{y}?access_token=${mapboxToken}`,
      {
        tileSize: 512,
        zoomOffset: -1,
        opacity
      }
    );
    elevationOverlay.addTo(map);
    setTimeout(() => applyElevationOverlayStyles(), 0);
    const ctl = document.getElementById('elevationOpacityControl');
    if (ctl) ctl.style.display = 'block';
    document.getElementById('elevationToggle').classList.add('active');
  } else {
    map.removeLayer(elevationOverlay);
    elevationOverlay = null;
    const ctl = document.getElementById('elevationOpacityControl');
    if (ctl) ctl.style.display = 'none';
    document.getElementById('elevationToggle').classList.remove('active');
  }
}

function setElevationOpacity(value) {
  if (!elevationOverlay) return;
  const opacity = Math.max(0, Math.min(1, parseInt(value, 10) / 100));
  elevationOverlay.setOpacity(opacity);
  applyElevationOverlayStyles();
}

function setElevationEnhance(value) {
  const contrast = Math.max(100, Math.min(220, parseInt(value, 10)));
  applyElevationOverlayStyles(contrast);
}

function applyElevationOverlayStyles(contrastOverride) {
  if (!elevationOverlay || !map) return;
  const tiles = document.querySelectorAll('.leaflet-layer img, .leaflet-tile-container img');
  const desiredOpacity = typeof elevationOverlay.options.opacity === 'number' ? elevationOverlay.options.opacity : 0.6;
  const enhanceInput = document.getElementById('elevationEnhance');
  const enhanceRaw = contrastOverride || (enhanceInput ? parseInt(enhanceInput.value, 10) : 135);
  const blendSelect = document.getElementById('elevationBlend');
  let blend = blendSelect ? blendSelect.value : 'multiply';
  if (blendSelect && !blendSelect.dataset.userSet) {
    if (currentLayer === 'google' || currentLayer === 'satellite') {
      blend = 'screen';
      blendSelect.value = 'screen';
    } else {
      blend = 'multiply';
      blendSelect.value = 'multiply';
    }
  }
  const intensity = Math.max(0, Math.min(1, (enhanceRaw - 100) / 120));
  let contrastPct = 110 + Math.round(50 * intensity);
  let brightnessPct = 100 - Math.round(40 * intensity);
  let saturatePct = 110 - Math.round(20 * intensity);
  if (blend === 'screen') {
    brightnessPct = Math.max(40, brightnessPct - 10);
  }
  tiles.forEach(img => {
    if (img.src && img.src.includes('api.mapbox.com/styles/v1/mapbox/outdoors-v12/tiles')) {
      img.style.mixBlendMode = blend;
      img.style.opacity = String(desiredOpacity);
      img.style.filter = `contrast(${contrastPct}%) brightness(${brightnessPct}%) saturate(${saturatePct}%)`;
      img.style.willChange = 'filter, opacity';
      img.decoding = 'async';
      img.loading = 'lazy';
    }
  });
}

function setElevationBlend(mode) {
  const blendSelect = document.getElementById('elevationBlend');
  if (blendSelect) blendSelect.dataset.userSet = '1';
  applyElevationOverlayStyles();
}

function saveMapboxToken() {
  const token = document.getElementById('mapboxToken').value.trim();
  if (token) {
    localStorage.setItem('mapboxToken', token);
    mapboxToken = token;
    updateLOSStatus();
  }
}

function loadMapboxToken() {
  const saved = localStorage.getItem('mapboxToken');
  if (saved) {
    document.getElementById('mapboxToken').value = saved;
    mapboxToken = saved;
  }
}

function updateLOSStatus() {
  const statusEl = document.getElementById('losStatus');
  
  if (losMode === 'mapbox' && !mapboxToken) {
    statusEl.textContent = 'Enter Mapbox token for 3D mode';
    statusEl.style.background = '#fff3cd';
  } else if (!losPointA) {
    statusEl.textContent = 'Click point A (observer)';
    statusEl.style.background = '#f0f4ff';
  } else if (!losPointB) {
    statusEl.textContent = 'Click point B (target)';
    statusEl.style.background = '#f0f4ff';
  } else {
    if (losMode === 'peakfinder') {
      statusEl.textContent = 'Loading PeakFinder panorama...';
    } else {
      statusEl.textContent = 'Loading 3D terrain...';
    }
    statusEl.style.background = '#d1ecf1';
  }
}

function handleLOSClick(latlng) {
  if (losMode === 'mapbox' && !mapboxToken) {
    alert('Please enter your Mapbox access token first for 3D terrain mode.');
    return;
  }
  
  if (!losPointA) {
    losPointA = latlng;
    losMarkerA = L.marker(latlng, {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    }).addTo(map).bindPopup('Point A (Observer)').openPopup();
    updateLOSStatus();
  } else if (!losPointB) {
    losPointB = latlng;
    losMarkerB = L.marker(latlng, {
      icon: L.icon({
        iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
        shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34],
        shadowSize: [41, 41]
      })
    }).addTo(map).bindPopup('Point B (Target)').openPopup();
    
    losLine = L.polyline([losPointA, losPointB], {
      color: '#9D2235',
      weight: 3,
      opacity: 0.7,
      dashArray: '10, 10'
    }).addTo(map);
    
    updateLOSStatus();
    
    if (losMode === 'peakfinder') {
      initializePeakFinder();
    } else {
      initialize3DView();
    }
  } else {
    clearLineOfSight();
    handleLOSClick(latlng);
  }
}

function clearLineOfSight() {
  losPointA = null;
  losPointB = null;
  
  if (losMarkerA) {
    map.removeLayer(losMarkerA);
    losMarkerA = null;
  }
  if (losMarkerB) {
    map.removeLayer(losMarkerB);
    losMarkerB = null;
  }
  if (losLine) {
    map.removeLayer(losLine);
    losLine = null;
  }
  
  if (currentView === '3d' || currentView === 'peakfinder') {
    toggleMapView();
  }
  
  if (window.map3D) {
    window.map3D.remove();
    window.map3D = null;
  }

  if (peakFinderPanel) {
    peakFinderPanel = null;
  }
  
  const progress = document.getElementById('pfcanvasprogress');
  if (progress) progress.style.display = 'block';

  updateLOSStatus();
  losMarkerAWasVisible = false;
  losMarkerBWasVisible = false;
  losLineWasVisible = false;
}

async function initializePeakFinder() {
  if (!losPointA || !losPointB) return;
  
  if (typeof PeakFinder === 'undefined' || !PeakFinder.utils) {
    alert('PeakFinder library is still loading. Please wait a moment and try again.');
    return;
  }
  
  if (!PeakFinder.utils.caniuse()) {
    alert('Your browser does not support the required technologies for PeakFinder. Please try using a modern browser or switching to Mapbox 3D mode instead.');
    return;
  }
  
  const distance = L.latLng(losPointA.lat, losPointA.lng).distanceTo(L.latLng(losPointB.lat, losPointB.lng));
  const bearing = calculateBearing(losPointA, losPointB);
  
  document.getElementById('view3DDistance').textContent = `${(distance / 1000).toFixed(2)} km`;
  document.getElementById('view3DBearing').textContent = `${Math.round(bearing)}°`;
  
  if (currentView === '2d') {
    currentView = 'peakfinder';
    document.getElementById('map').style.display = 'none';
    document.getElementById('mapCanvas').style.display = 'none';
    document.getElementById('view3DContainer').classList.remove('active');
    document.getElementById('peakFinderContainer').classList.add('active');
    
    document.getElementById('viewToggleBtn').style.display = 'flex';
    document.getElementById('viewInfoBar').classList.add('visible');
    document.getElementById('viewToggleIcon').textContent = '🗺️';
    document.getElementById('viewToggleText').textContent = 'Back to 2D Map';
  }
  
  if (peakFinderPanel) {
    try {
      peakFinderPanel = null;
    } catch (e) {
      console.log('Error cleaning up PeakFinder:', e);
    }
  }
  
  try {
    peakFinderPanel = new PeakFinder.PanoramaPanel({
      canvasid: 'pfcanvas',
      locale: 'en',
      theme: 'light'
    });
    
    await peakFinderPanel.asyncinit();
    
    const progress = document.getElementById('pfcanvasprogress');
    if (progress) progress.style.display = 'none';
    
    peakFinderPanel.loadViewpoint(
      losPointA.lat,
      losPointA.lng,
      'Observer Position'
    );
    
    peakFinderPanel.addEventListener('viewpointjourney finished', async function() {
      await peakFinderPanel.azimut(bearing, 2.0);
      await peakFinderPanel.fieldofview(60.0, 1.5);
      peakFinderPanel.telescope.show();
      
      console.log(`PeakFinder initialized: viewing from A to B at ${bearing.toFixed(0)}°`);
    });
    
    try {
      peakFinderPanel.settings.distanceUnit(0);
    } catch (e) {
      console.log('PeakFinder settings configuration:', e);
    }
    
  } catch (error) {
    console.error('PeakFinder initialization error:', error);
    alert(`Failed to initialize PeakFinder: ${error.message}. Try switching to Mapbox 3D mode instead.`);
    
    const progress = document.getElementById('pfcanvasprogress');
    if (progress) progress.style.display = 'block';
  }
}

function hidePeakFinder() {
  document.getElementById('peakFinderContainer').classList.remove('active');
  if (currentView === 'peakfinder') {
    currentView = '2d';
  }
}

function hide3DView() {
  document.getElementById('view3DContainer').classList.remove('active');
}

async function initialize3DView() {
  if (!losPointA || !losPointB || !mapboxToken) return;
  
  const distance = L.latLng(losPointA.lat, losPointA.lng).distanceTo(L.latLng(losPointB.lat, losPointB.lng));
  const bearing = calculateBearing(losPointA, losPointB);
  
  document.getElementById('view3DDistance').textContent = `${(distance / 1000).toFixed(2)} km`;
  document.getElementById('view3DBearing').textContent = `${Math.round(bearing)}°`;
  
  if (currentView === '2d') {
    toggleMapView();
  }
  
  if (window.map3D) {
    window.map3D.remove();
  }
  
  mapboxgl.accessToken = mapboxToken;
  
  window.map3D = new mapboxgl.Map({
    container: 'mapbox3DContainer',
    style: 'mapbox://styles/mapbox/satellite-streets-v12',
    center: [losPointA.lng, losPointA.lat],
    zoom: 12,
    pitch: 60,
    bearing: bearing,
    antialias: true
  });
  
  window.map3D.on('load', () => {
    window.map3D.addSource('mapbox-dem', {
      'type': 'raster-dem',
      'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
      'tileSize': 512,
      'maxzoom': 14
    });
    
    window.map3D.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
    
    window.map3D.addLayer({
      'id': 'sky',
      'type': 'sky',
      'paint': {
        'sky-type': 'atmosphere',
        'sky-atmosphere-sun': [0.0, 90.0],
        'sky-atmosphere-sun-intensity': 15
      }
    });
    
    new mapboxgl.Marker({ color: '#2ecc71' })
      .setLngLat([losPointA.lng, losPointA.lat])
      .setPopup(new mapboxgl.Popup().setHTML('Point A (Observer)'))
      .addTo(window.map3D);
    
    new mapboxgl.Marker({ color: '#e74c3c' })
      .setLngLat([losPointB.lng, losPointB.lat])
      .setPopup(new mapboxgl.Popup().setHTML('Point B (Target)'))
      .addTo(window.map3D);
    
    window.map3D.addSource('route', {
      'type': 'geojson',
      'data': {
        'type': 'Feature',
        'properties': {},
        'geometry': {
          'type': 'LineString',
          'coordinates': [
            [losPointA.lng, losPointA.lat],
            [losPointB.lng, losPointB.lat]
          ]
        }
      }
    });
    
    window.map3D.addLayer({
      'id': 'route',
      'type': 'line',
      'source': 'route',
      'layout': {
        'line-join': 'round',
        'line-cap': 'round'
      },
      'paint': {
        'line-color': '#9D2235',
        'line-width': 3,
        'line-opacity': 0.8
      }
    });
    
    console.log(`3D view initialized: ${(distance/1000).toFixed(2)}km at ${bearing.toFixed(0)}°`);
    setup3DViewCanvas();
  });
  
  window.map3D.addControl(new mapboxgl.NavigationControl());
}

const view3DCanvas = document.getElementById('view3DCanvas');
const view3DCanvasCtx = view3DCanvas.getContext('2d');
let view3DShapes = [];
let view3DDrawing = false;
let view3DStartX, view3DStartY;
let view3DPolygonPoints = [];

function setup3DViewCanvas() {
  const container = document.getElementById('view3DContainer');
  view3DCanvas.width = container.offsetWidth;
  view3DCanvas.height = container.offsetHeight;
  redraw3DCanvas();
}

function redraw3DCanvas() {
  view3DCanvasCtx.clearRect(0, 0, view3DCanvas.width, view3DCanvas.height);
  view3DShapes.forEach(shape => {
    drawShapeOnContext(view3DCanvasCtx, shape);
  });
}

view3DCanvas.addEventListener('mousedown', (e) => {
  if (currentView !== '3d' || mapMode !== 'draw') return;
  
  // Handle sticky note placement
  if (currentTool === 'note') {
    const rect = view3DCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    createStickyNote(x, y, document.getElementById('view3DContainer'));
    return;
  }
  
  const rect = view3DCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  if (currentTool === 'polygon') {
    view3DPolygonPoints.push({ x, y });
    redraw3DCanvas();
    
    view3DCanvasCtx.fillStyle = currentColor;
    view3DCanvasCtx.beginPath();
    view3DCanvasCtx.arc(x, y, 4, 0, 2 * Math.PI);
    view3DCanvasCtx.fill();
    
    return;
  }
  
  view3DDrawing = true;
  view3DStartX = x;
  view3DStartY = y;
});

view3DCanvas.addEventListener('mousemove', (e) => {
  if (!view3DDrawing || currentView !== '3d') return;
  
  const rect = view3DCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  redraw3DCanvas();
  
  const previewShape = {
    type: currentTool,
    color: currentColor,
    dashed: isDashed,
    lineWidth: currentLineWidth,
    filled: isFilled,
    fillOpacity: fillOpacity,
    startX: view3DStartX, startY: view3DStartY,
    endX: x, endY: y
  };
  
  drawShapeOnContext(view3DCanvasCtx, previewShape);
});

view3DCanvas.addEventListener('mouseup', (e) => {
  if (!view3DDrawing || currentView !== '3d') return;
  
  const rect = view3DCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  
  const shape = {
    type: currentTool,
    color: currentColor,
    dashed: isDashed,
    lineWidth: currentLineWidth,
    filled: isFilled,
    fillOpacity: fillOpacity,
    startX: view3DStartX, startY: view3DStartY,
    endX: x, endY: y
  };
  
  view3DShapes.push(shape);
  view3DDrawing = false;
  redraw3DCanvas();
});

view3DCanvas.addEventListener('dblclick', (e) => {
  if (currentTool === 'polygon' && view3DPolygonPoints.length > 2 && currentView === '3d') {
    const shape = {
      type: 'polygon',
      color: currentColor,
      dashed: isDashed,
      lineWidth: currentLineWidth,
      filled: isFilled,
      fillOpacity: fillOpacity,
      points: [...view3DPolygonPoints]
    };
    view3DShapes.push(shape);
    view3DPolygonPoints = [];
    redraw3DCanvas();
  }
});

function calculateBearing(from, to) {
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  
  return (bearing + 360) % 360;
}
