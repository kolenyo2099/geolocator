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

  function enableGrid() {
    if (!gridEnabled) {
      gridEnabled = true;
      gridLayer.addTo(map);
      updateGrid();
    }
  }

  function disableGrid() {
    if (gridEnabled) {
      gridEnabled = false;
      gridLayer.clearLayers();
      map.removeLayer(gridLayer);
    }
  }

  function toggleGrid(button) {
    if (gridEnabled) {
      disableGrid();
      button.classList.remove('active');
      button.innerText = 'Show Grid';
    } else {
      enableGrid();
      button.classList.add('active');
      button.innerText = 'Hide Grid';
    }
  }

  const GridOverlayControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const container = L.DomUtil.create('div', 'leaflet-control grid-overlay-control');

      const title = L.DomUtil.create('div', 'grid-overlay-title', container);
      title.textContent = 'Map Grid';

      const sizeWrapper = L.DomUtil.create('label', 'grid-overlay-size', container);
      sizeWrapper.textContent = 'Cell size (km)';

      const sizeInput = L.DomUtil.create('input', 'grid-overlay-input', sizeWrapper);
      sizeInput.type = 'number';
      sizeInput.min = GRID_MIN_KM;
      sizeInput.step = '0.1';
      sizeInput.value = formatInputValue(gridSizeKm);

      const toggleBtn = L.DomUtil.create('button', 'grid-overlay-toggle', container);
      toggleBtn.type = 'button';
      toggleBtn.textContent = 'Show Grid';

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      L.DomEvent.on(toggleBtn, 'click', function() {
        toggleGrid(toggleBtn);
      });

      L.DomEvent.on(sizeInput, 'change', function() {
        const newValue = clampGridSize(parseFloat(sizeInput.value));
        gridSizeKm = newValue;
        sizeInput.value = formatInputValue(newValue);
        if (gridEnabled) {
          updateGrid();
        }
      });

      return container;
    }
  });

  map.addControl(new GridOverlayControl());

  map.on('moveend zoomend rotate', updateGrid);
})();
