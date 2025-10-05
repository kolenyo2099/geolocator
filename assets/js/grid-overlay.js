(function() {
  if (typeof map === 'undefined') {
    console.error('Grid overlay requires the global map instance.');
    return;
  }

  const GRID_MIN_KM = 0.1;
  const DEFAULT_GRID_KM = 1;
  let gridEnabled = false;
  let gridSizeKm = DEFAULT_GRID_KM;
  const gridLayer = L.layerGroup();

  function clampGridSize(value) {
    if (Number.isNaN(value) || !Number.isFinite(value)) {
      return gridSizeKm;
    }
    return Math.max(GRID_MIN_KM, value);
  }

  function formatInputValue(value) {
    return Number.parseFloat(value.toFixed(2));
  }

  function updateGrid() {
    if (!gridEnabled) {
      return;
    }

    const cellSizeMeters = gridSizeKm * 1000;
    if (cellSizeMeters <= 0) {
      return;
    }

    const bounds = map.getBounds().pad(0.5);
    const crs = map.options.crs || L.CRS.EPSG3857;
    const southWest = crs.project(bounds.getSouthWest());
    const northEast = crs.project(bounds.getNorthEast());

    const minX = Math.min(southWest.x, northEast.x);
    const maxX = Math.max(southWest.x, northEast.x);
    const minY = Math.min(southWest.y, northEast.y);
    const maxY = Math.max(southWest.y, northEast.y);

    const startX = Math.floor(minX / cellSizeMeters) * cellSizeMeters;
    const endX = Math.ceil(maxX / cellSizeMeters) * cellSizeMeters;
    const startY = Math.floor(minY / cellSizeMeters) * cellSizeMeters;
    const endY = Math.ceil(maxY / cellSizeMeters) * cellSizeMeters;

    gridLayer.clearLayers();

    for (let x = startX; x <= endX; x += cellSizeMeters) {
      const startPoint = L.point(x, minY);
      const endPoint = L.point(x, maxY);
      const startLatLng = crs.unproject(startPoint);
      const endLatLng = crs.unproject(endPoint);
      const line = L.polyline([startLatLng, endLatLng], {
        color: '#333',
        opacity: 0.35,
        weight: 1,
        interactive: false
      });
      gridLayer.addLayer(line);
    }

    for (let y = startY; y <= endY; y += cellSizeMeters) {
      const startPoint = L.point(minX, y);
      const endPoint = L.point(maxX, y);
      const startLatLng = crs.unproject(startPoint);
      const endLatLng = crs.unproject(endPoint);
      const line = L.polyline([startLatLng, endLatLng], {
        color: '#333',
        opacity: 0.35,
        weight: 1,
        interactive: false
      });
      gridLayer.addLayer(line);
    }
  }

  const toggleBtn = document.getElementById('mapGridToggle');
  const sizeInput = document.getElementById('mapGridSize');

  function syncUI() {
    if (toggleBtn) {
      toggleBtn.textContent = gridEnabled ? 'Hide Grid' : 'Show Grid';
      toggleBtn.classList.toggle('active', gridEnabled);
      toggleBtn.setAttribute('aria-pressed', gridEnabled ? 'true' : 'false');
    }

    if (sizeInput && document.activeElement !== sizeInput) {
      sizeInput.value = formatInputValue(gridSizeKm);
    }
  }

  function enableGrid() {
    if (!gridEnabled) {
      gridEnabled = true;
      gridLayer.addTo(map);
      updateGrid();
      syncUI();
    }
  }

  function disableGrid() {
    if (gridEnabled) {
      gridEnabled = false;
      gridLayer.clearLayers();
      map.removeLayer(gridLayer);
      syncUI();
    }
  }

  function setGridEnabled(nextEnabled) {
    if (nextEnabled) {
      enableGrid();
    } else {
      disableGrid();
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', function() {
      setGridEnabled(!gridEnabled);
    });
  } else {
    console.warn('Map grid toggle button not found in sidebar.');
  }

  if (sizeInput) {
    const initialValue = clampGridSize(parseFloat(sizeInput.value));
    gridSizeKm = initialValue;
    sizeInput.value = formatInputValue(gridSizeKm);

    const commitSize = function() {
      const parsed = parseFloat(sizeInput.value);
      const newValue = clampGridSize(parsed);
      const changed = newValue !== gridSizeKm;
      gridSizeKm = newValue;
      sizeInput.value = formatInputValue(gridSizeKm);
      syncUI();
      if (changed && gridEnabled) {
        updateGrid();
      }
    };

    sizeInput.addEventListener('change', commitSize);
    sizeInput.addEventListener('blur', commitSize);
  } else {
    console.warn('Map grid size input not found in sidebar.');
  }

  map.on('moveend zoomend rotate', updateGrid);
  syncUI();
})();
