/* ========== IMAGE UPLOAD & LAYER MANAGEMENT ========== */
let imageLayers = [];
let selectedLayerId = null;
let isDraggingLayer = false;
let isResizingLayer = false;
let resizeHandle = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartScale = 1;
let resizeStartLayerX = 0;
let resizeStartLayerY = 0;

const drawingLayerRegistry = (() => {
  const entries = new Map();
  const counters = new Map();

  const PANEL_LABELS = {
    image: 'Image Canvas',
    'map-overlay': 'Map Overlay',
    map: 'Map',
    view3d: '3D View',
    peakfinder: 'Peak Finder',
    streetview: 'Street View',
    mapillary: 'Mapillary'
  };

  const SHAPE_LABELS = {
    rect: 'Rectangle',
    rectangle: 'Rectangle',
    ellipse: 'Ellipse',
    circle: 'Circle',
    line: 'Line',
    polyline: 'Polyline',
    polygon: 'Polygon',
    arrow: 'Arrow',
    freehand: 'Freehand',
    marker: 'Marker'
  };

  const SHAPE_ICONS = {
    rect: '▭',
    rectangle: '▭',
    ellipse: '⬭',
    circle: '⭕',
    line: '／',
    polyline: '〰️',
    polygon: '⬡',
    arrow: '➜',
    freehand: '✏️',
    marker: '📍'
  };

  function toTitleCase(value) {
    if (!value) return '';
    return value
      .toString()
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  function describePanel(panelKey) {
    return PANEL_LABELS[panelKey] || toTitleCase(panelKey) || 'Canvas';
  }

  function describeShape(shapeType) {
    if (!shapeType) return 'Drawing';
    const normalized = shapeType.toString().toLowerCase();
    return SHAPE_LABELS[normalized] || toTitleCase(shapeType) || 'Drawing';
  }

  function iconForShape(shapeType, panelKey) {
    const normalized = shapeType ? shapeType.toString().toLowerCase() : '';
    if (SHAPE_ICONS[normalized]) return SHAPE_ICONS[normalized];
    if (panelKey === 'map' || panelKey === 'map-overlay') return '🗺️';
    return '✏️';
  }

  function nextCounter(panelKey, shapeType) {
    const key = `${panelKey}:${shapeType}`;
    const current = counters.get(key) || 0;
    const next = current + 1;
    counters.set(key, next);
    return next;
  }

  function getKonvaKey(shape, panelKey) {
    if (!shape) return null;
    return `konva:${panelKey}:${shape._id}`;
  }

  function ensureKonvaMetadata(shape, panelKey, shapeType) {
    if (!shape || typeof shape.getAttr !== 'function' || typeof shape.setAttr !== 'function') {
      return { createdAt: Date.now(), name: describeShape(shapeType) };
    }

    let createdAt = shape.getAttr('layerCreatedAt');
    if (!createdAt) {
      createdAt = Date.now();
      shape.setAttr('layerCreatedAt', createdAt);
    }

    let name = shape.getAttr('layerLabel');
    if (!name) {
      const counter = nextCounter(panelKey, shapeType);
      name = `${describeShape(shapeType)} · ${describePanel(panelKey)} ${counter}`;
      shape.setAttr('layerLabel', name);
    }

    return { createdAt, name };
  }

  function getLeafletKey(layer) {
    if (!layer) return null;
    if (layer._leaflet_id != null) {
      return `leaflet:${layer._leaflet_id}`;
    }
    if (typeof L !== 'undefined' && typeof L.stamp === 'function') {
      return `leaflet:${L.stamp(layer)}`;
    }
    return `leaflet:${Date.now() + Math.random()}`;
  }

  function ensureLeafletMetadata(layer, shapeType) {
    if (!layer) {
      return { createdAt: Date.now(), name: describeShape(shapeType) };
    }

    let createdAt = layer._layerCreatedAt;
    if (!createdAt) {
      createdAt = Date.now();
      layer._layerCreatedAt = createdAt;
    }

    let name = layer._layerLabel;
    if (!name) {
      const counter = nextCounter('map', shapeType);
      name = `${describeShape(shapeType)} · Map ${counter}`;
      layer._layerLabel = name;
    }

    return { createdAt, name };
  }

  function resolveLeafletShapeType(layer) {
    if (!layer) return 'Drawing';
    if (layer.pm && typeof layer.pm.getShape === 'function') {
      return layer.pm.getShape();
    }
    if (typeof layer.getLatLng === 'function') return 'Marker';
    if (typeof layer.getLatLngs === 'function') return 'Polygon';
    return 'Drawing';
  }

  function registerKonvaShape(shape, panelKey) {
    const key = getKonvaKey(shape, panelKey);
    if (!key) return null;

    const shapeType = (shape && typeof shape.getAttr === 'function' && shape.getAttr('shapeType')) || 'drawing';
    const metadata = ensureKonvaMetadata(shape, panelKey, shapeType);

    let entry = entries.get(key);
    if (!entry) {
      entry = {
        id: key,
        type: 'konva',
        panelKey,
        shapeType,
        shape,
        name: metadata.name,
        origin: describePanel(panelKey),
        icon: iconForShape(shapeType, panelKey),
        createdAt: metadata.createdAt
      };
      entries.set(key, entry);
    } else {
      entry.shape = shape;
      entry.shapeType = shapeType;
      entry.icon = iconForShape(shapeType, panelKey);
      entry.origin = describePanel(panelKey);
      entry.name = metadata.name;
      entry.createdAt = metadata.createdAt;
    }

    updateLayersList();
    return entry;
  }

  function unregisterKonvaShape(shape, panelKey) {
    const key = getKonvaKey(shape, panelKey);
    if (!key) return;
    if (entries.delete(key)) {
      updateLayersList();
    }
  }

  function registerLeafletLayer(layer) {
    const key = getLeafletKey(layer);
    if (!key) return null;
    const shapeType = resolveLeafletShapeType(layer);
    const metadata = ensureLeafletMetadata(layer, shapeType);

    let entry = entries.get(key);
    if (!entry) {
      entry = {
        id: key,
        type: 'leaflet',
        panelKey: 'map',
        shapeType,
        layer,
        name: metadata.name,
        origin: 'Map',
        icon: iconForShape(shapeType, 'map'),
        createdAt: metadata.createdAt
      };
      entries.set(key, entry);
    } else {
      entry.layer = layer;
      entry.shapeType = shapeType;
      entry.icon = iconForShape(shapeType, 'map');
      entry.name = metadata.name;
      entry.createdAt = metadata.createdAt;
    }

    updateLayersList();
    return entry;
  }

  function unregisterLeafletLayer(layer) {
    const key = getLeafletKey(layer);
    if (!key) return;
    if (entries.delete(key)) {
      updateLayersList();
    }
  }

  function focusLayer(id) {
    const entry = entries.get(id);
    if (!entry) return;

    if (entry.type === 'konva' && entry.shape) {
      const router = window.drawingRouter;
      const panel = router && router.konvaManager ? router.konvaManager.getPanel(entry.panelKey) : null;
      if (panel && panel.transformer) {
        try {
          panel.transformer.nodes([entry.shape]);
          if (typeof panel.layer?.batchDraw === 'function') {
            panel.layer.batchDraw();
          }
        } catch (err) {
          console.warn('Failed to focus Konva layer', err);
        }
      }
    } else if (entry.type === 'leaflet' && entry.layer) {
      const router = window.drawingRouter;
      const mapInstance = (router && router.map) || (typeof map !== 'undefined' ? map : null);
      if (!mapInstance) return;
      try {
        if (typeof entry.layer.getBounds === 'function') {
          const bounds = entry.layer.getBounds();
          if (bounds && typeof bounds.isValid === 'function' && bounds.isValid()) {
            mapInstance.fitBounds(bounds.pad ? bounds.pad(0.1) : bounds);
          } else {
            mapInstance.fitBounds(bounds);
          }
        } else if (typeof entry.layer.getLatLng === 'function') {
          mapInstance.panTo(entry.layer.getLatLng());
        } else if (typeof entry.layer.getLatLngs === 'function' && typeof L !== 'undefined' && typeof L.latLngBounds === 'function') {
          const latlngs = entry.layer.getLatLngs();
          const flat = Array.isArray(latlngs) ? latlngs.flat(Infinity) : [];
          const points = flat.filter((pt) => pt && typeof pt.lat === 'number' && typeof pt.lng === 'number');
          if (points.length) {
            const bounds = L.latLngBounds(points);
            if (bounds.isValid()) {
              mapInstance.fitBounds(bounds.pad ? bounds.pad(0.1) : bounds);
            }
          }
        }
      } catch (err) {
        console.warn('Failed to focus Leaflet layer', err);
      }
    }
  }

  function removeLayer(id) {
    const entry = entries.get(id);
    if (!entry) return false;

    if (entry.type === 'konva' && entry.shape) {
      const router = window.drawingRouter;
      const panel = router && router.konvaManager ? router.konvaManager.getPanel(entry.panelKey) : null;
      if (!panel) return false;

      if (router && typeof router.recordCommand === 'function') {
        router.recordCommand({
          type: 'remove',
          panelKey: entry.panelKey,
          shape: entry.shape,
          undo: () => {
            panel.addShape(entry.shape);
          },
          redo: () => {
            panel.removeShape(entry.shape);
          }
        });
      }

      panel.removeShape(entry.shape);
      return true;
    }

    if (entry.type === 'leaflet' && entry.layer) {
      const router = window.drawingRouter;
      const mapInstance = (router && router.map) || (typeof map !== 'undefined' ? map : null);
      if (!mapInstance) return false;

      if (router && router.geomanLayers) {
        router.geomanLayers.delete(entry.layer);
      }

      if (router && typeof router.recordCommand === 'function') {
        router.recordCommand({
          type: 'remove-geoman',
          layer: entry.layer,
          undo: () => {
            entry.layer.addTo(mapInstance);
            if (router && router.geomanLayers) {
              router.geomanLayers.add(entry.layer);
            }
            registerLeafletLayer(entry.layer);
          },
          redo: () => {
            mapInstance.removeLayer(entry.layer);
            unregisterLeafletLayer(entry.layer);
            if (router && router.geomanLayers) {
              router.geomanLayers.delete(entry.layer);
            }
          }
        });
      }

      mapInstance.removeLayer(entry.layer);
      unregisterLeafletLayer(entry.layer);
      return true;
    }

    return false;
  }

  function getLayers() {
    return Array.from(entries.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  function clearAll() {
    if (entries.size === 0) return;
    entries.clear();
    updateLayersList();
  }

  return {
    registerKonvaShape,
    unregisterKonvaShape,
    registerLeafletLayer,
    unregisterLeafletLayer,
    removeLayer,
    focusLayer,
    getLayers,
    clearAll
  };
})();

window.drawingLayerRegistry = drawingLayerRegistry;

const imageUpload = document.getElementById('imageUpload');
const imageViewer = document.getElementById('imageViewer');
const imageCanvas = document.getElementById('imageCanvas');
const ctx = imageCanvas.getContext('2d');

// Centralized tool state accessor - ensures consistency across all modules
function getCurrentTool() {
  return (window.drawingRouter && drawingRouter.state && drawingRouter.state.tool) || 'pan';
}

// Make globally accessible to prevent duplicate implementations
window.getCurrentTool = getCurrentTool;

function getCanvasCoords(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  const px = (event.clientX - rect.left) * scaleX;
  const py = (event.clientY - rect.top) * scaleY;
  return {
    x: (px - imagePanX) / imageZoom,
    y: (py - imagePanY) / imageZoom
  };
}

function worldToLayerCoords(worldX, worldY, layer, options = {}) {
  if (!layer) return null;

  const { allowOutside = false } = options;
  const w = layer.image.width * layer.scale;
  const h = layer.image.height * layer.scale;
  const centerX = layer.x + w / 2;
  const centerY = layer.y + h / 2;
  const angleRad = (layer.rotation || 0) * Math.PI / 180;
  const dx = worldX - centerX;
  const dy = worldY - centerY;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const unrotatedX = dx * cos + dy * sin;
  const unrotatedY = -dx * sin + dy * cos;

  const scaledX = unrotatedX + w / 2;
  const scaledY = unrotatedY + h / 2;

  if (!allowOutside && (scaledX < 0 || scaledX > w || scaledY < 0 || scaledY > h)) {
    return null;
  }

  return {
    x: scaledX / layer.scale,
    y: scaledY / layer.scale
  };
}

function layerCoordsToWorld(point, layer) {
  if (!layer || !point) return null;

  const w = layer.image.width * layer.scale;
  const h = layer.image.height * layer.scale;
  const centerX = layer.x + w / 2;
  const centerY = layer.y + h / 2;
  const scaledX = point.x * layer.scale;
  const scaledY = point.y * layer.scale;
  const offsetX = scaledX - w / 2;
  const offsetY = scaledY - h / 2;
  const angleRad = (layer.rotation || 0) * Math.PI / 180;

  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const rotatedX = offsetX * cos - offsetY * sin;
  const rotatedY = offsetX * sin + offsetY * cos;

  return {
    x: rotatedX + centerX,
    y: rotatedY + centerY
  };
}

function findTopVisibleLayerAt(worldX, worldY) {
  for (let i = imageLayers.length - 1; i >= 0; i--) {
    const layer = imageLayers[i];
    if (!layer.visible) continue;
    const localPoint = worldToLayerCoords(worldX, worldY, layer);
    if (localPoint) {
      return { layer, localPoint };
    }
  }
  return null;
}

function initializeCanvas() {
  const container = document.querySelector('.image-canvas-container');
  imageCanvas.width = container.clientWidth;
  imageCanvas.height = container.clientHeight;
  imageCanvas.style.width = container.clientWidth + 'px';
  imageCanvas.style.height = container.clientHeight + 'px';
  
  // Sync the Konva overlay after canvas resize
  if (typeof syncImageOverlay === 'function') {
    syncImageOverlay();
  }
}

window.addEventListener('resize', () => {
  if (imageLayers.length > 0) {
    initializeCanvas();
    redrawAllLayers();
  }
});

imageUpload.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const layer = {
          id: Date.now() + Math.random(),
          name: file.name,
          image: img,
          x: 50,
          y: 50,
          opacity: 1.0,
          visible: true,
          scale: 1.0,
          rotation: 0
        };
        
        imageLayers.push(layer);
        updateLayersList();
        
        if (imageLayers.length === 1) {
          document.querySelector('.no-image').style.display = 'none';
          document.querySelector('.image-canvas-container').style.display = 'flex';
          imagePanel.classList.remove('hidden');
          initializeCanvas();
        }
        
        redrawAllLayers();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
});

function addProtractorImage() {
  const img = new Image();
  img.onload = () => {
    const layer = {
      id: Date.now() + Math.random(),
      name: 'Protractor',
      image: img,
      x: 50,
      y: 50,
      opacity: 1.0,
      visible: true,
      scale: 1.0,
      rotation: 0
    };
    
    imageLayers.push(layer);
    updateLayersList();
    
    if (imageLayers.length === 1) {
      document.querySelector('.no-image').style.display = 'none';
      document.querySelector('.image-canvas-container').style.display = 'flex';
      imagePanel.classList.remove('hidden');
      initializeCanvas();
    }
    
    redrawAllLayers();
  };
  img.onerror = () => {
    alert('Failed to load protractor image. Please make sure protractor.png exists in the same directory as this file.');
  };
  img.src = 'protractor.png';
}

const imageCanvasContainer = document.querySelector('.image-canvas-container');

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
  document.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
  imageCanvasContainer.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
  imageCanvasContainer.addEventListener(eventName, unhighlight, false);
});

['dragenter', 'dragover'].forEach(eventName => {
  imageCanvas.addEventListener(eventName, highlight, false);
});

['dragleave', 'drop'].forEach(eventName => {
  imageCanvas.addEventListener(eventName, unhighlight, false);
});

function highlight(e) {
  imageCanvasContainer.classList.add('drag-over');
}

function unhighlight(e) {
  imageCanvasContainer.classList.remove('drag-over');
}

imageCanvasContainer.addEventListener('drop', handleDrop, false);
imageCanvas.addEventListener('drop', (e) => {
  e.stopPropagation();
  handleDrop(e);
}, false);

function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const dt = e.dataTransfer;
  const files = Array.from(dt.files);
  
  const imageFiles = files.filter(file => file.type.startsWith('image/'));
  
  if (imageFiles.length === 0) {
    alert('Please drop only image files.');
    return;
  }
  
  imageFiles.forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const layer = {
          id: Date.now() + Math.random(),
          name: file.name,
          image: img,
          x: 50,
          y: 50,
          opacity: 1.0,
          visible: true,
          scale: 1.0,
          rotation: 0
        };
        
        imageLayers.push(layer);
        updateLayersList();
        
        if (imageLayers.length === 1) {
          document.querySelector('.no-image').style.display = 'none';
          document.querySelector('.image-canvas-container').style.display = 'flex';
          imagePanel.classList.remove('hidden');
          initializeCanvas();
        }
        
        redrawAllLayers();
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateLayersList() {
  const list = document.getElementById('layersList');
  if (!list) return;

  const drawingLayers = drawingLayerRegistry.getLayers();
  const hasImages = imageLayers.length > 0;
  const hasDrawings = drawingLayers.length > 0;

  if (!hasImages && !hasDrawings) {
    list.innerHTML = '<p class="no-layers">No layers yet</p>';
    return;
  }

  list.innerHTML = '';

  drawingLayers.forEach((layer) => {
    const div = document.createElement('div');
    div.className = 'layer-item drawing-layer';
    div.onclick = () => drawingLayerRegistry.focusLayer(layer.id);

    const preview = document.createElement('div');
    preview.className = 'layer-preview drawing-preview';
    preview.textContent = layer.icon || '✏️';
    div.appendChild(preview);

    const info = document.createElement('div');
    info.className = 'layer-info';

    const name = document.createElement('div');
    name.className = 'layer-name';
    name.textContent = layer.name;
    info.appendChild(name);

    if (layer.origin) {
      const meta = document.createElement('div');
      meta.className = 'layer-meta';
      meta.textContent = layer.origin;
      info.appendChild(meta);
    }

    div.appendChild(info);

    const controls = document.createElement('div');
    controls.className = 'layer-controls';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'layer-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove drawing';
    removeBtn.onclick = (event) => removeDrawingLayer(layer.id, event);
    controls.appendChild(removeBtn);

    div.appendChild(controls);
    list.appendChild(div);
  });

  [...imageLayers].reverse().forEach((layer) => {
    const div = document.createElement('div');
    div.className = `layer-item ${selectedLayerId === layer.id ? 'active' : ''}`;
    div.onclick = () => selectLayer(layer.id);

    const canvas = document.createElement('canvas');
    canvas.width = 40;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');

    const scale = Math.min(40 / layer.image.width, 40 / layer.image.height);
    const w = layer.image.width * scale;
    const h = layer.image.height * scale;
    ctx.drawImage(layer.image, (40 - w) / 2, (40 - h) / 2, w, h);

    const isPanoramaSelected = typeof selectedForPanorama !== 'undefined' && selectedForPanorama.has(layer.id);

    div.innerHTML = `
      <span class="layer-visibility" onclick="toggleLayerVisibility(${layer.id}, event)" title="${layer.visible ? 'Hide' : 'Show'}">
        ${layer.visible ? '👁️' : '🚫'}
      </span>
      <img class="layer-preview" src="${canvas.toDataURL()}" alt="preview"/>
      <div class="layer-info">
        <div class="layer-name" title="${layer.name}">${layer.name}</div>
        <label class="panorama-checkbox" onclick="event.stopPropagation()">
          <input type="checkbox" ${isPanoramaSelected ? 'checked' : ''}
                 onchange="togglePanoramaSelection(${layer.id}, event)"
                 title="Select for panorama stitching"/>
          <span>For Panorama</span>
        </label>
      </div>
      <div class="layer-controls">
        <div class="layer-control-row">
          <span class="control-label">Opacity:</span>
          <input type="range" min="0" max="100" value="${layer.opacity * 100}"
                 onchange="updateLayerOpacity(${layer.id}, this.value)"
                 oninput="updateLayerOpacity(${layer.id}, this.value)"
                 onclick="event.stopPropagation()"
                 title="Opacity: ${Math.round(layer.opacity * 100)}%"/>
        </div>
        <div class="layer-control-row">
          <span class="control-label">Scale:</span>
          <input type="range" min="10" max="300" value="${layer.scale * 100}"
                 onchange="updateLayerScale(${layer.id}, this.value)"
                 oninput="updateLayerScale(${layer.id}, this.value)"
                 onclick="event.stopPropagation()"
                 title="Scale: ${Math.round(layer.scale * 100)}%"/>
        </div>
        <div class="layer-control-row">
          <span class="control-label">Rotation:</span>
          <button class="layer-btn" onclick="rotateLayerLeft(${layer.id}, event)" title="Rotate left 5°">↶</button>
          <button class="layer-btn" onclick="rotateLayerRight(${layer.id}, event)" title="Rotate right 5°">↷</button>
          <button class="layer-btn" onclick="rotateLayerFineLeft(${layer.id}, event)" title="Rotate left 1°">↶</button>
          <button class="layer-btn" onclick="rotateLayerFineRight(${layer.id}, event)" title="Rotate right 1°">↷</button>
          <button class="layer-btn" onclick="resetLayerRotation(${layer.id}, event)" title="Reset rotation">⟲</button>
        </div>
        <div class="layer-control-row">
          <button class="layer-btn" onclick="moveLayerUp(${layer.id}, event)" title="Move up">▲</button>
          <button class="layer-btn" onclick="moveLayerDown(${layer.id}, event)" title="Move down">▼</button>
          <button class="layer-btn" onclick="removeLayer(${layer.id}, event)" title="Remove">×</button>
        </div>
      </div>
    `;

    list.appendChild(div);
  });
}

function removeDrawingLayer(layerId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }
  drawingLayerRegistry.removeLayer(layerId);
}

function selectLayer(layerId) {
  selectedLayerId = layerId;
  updateLayersList();
}

function toggleLayerVisibility(layerId, event) {
  event.stopPropagation();
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.visible = !layer.visible;
    updateLayersList();
    redrawAllLayers();
  }
}

function updateLayerOpacity(layerId, value) {
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.opacity = value / 100;
    redrawAllLayers();
  }
}

function updateLayerScale(layerId, value) {
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.scale = value / 100;
    redrawAllLayers();
  }
}

function rotateLayerLeft(layerId, event) {
  event.stopPropagation();
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.rotation = (layer.rotation || 0) - 5;
    if (layer.rotation < 0) layer.rotation += 360;
    redrawAllLayers();
    updateLayersList();
  }
}

function rotateLayerRight(layerId, event) {
  event.stopPropagation();
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.rotation = (layer.rotation || 0) + 5;
    if (layer.rotation >= 360) layer.rotation -= 360;
    redrawAllLayers();
    updateLayersList();
  }
}

function rotateLayerFineLeft(layerId, event) {
  event.stopPropagation();
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.rotation = (layer.rotation || 0) - 1;
    if (layer.rotation < 0) layer.rotation += 360;
    redrawAllLayers();
    updateLayersList();
  }
}

function rotateLayerFineRight(layerId, event) {
  event.stopPropagation();
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.rotation = (layer.rotation || 0) + 1;
    if (layer.rotation >= 360) layer.rotation -= 360;
    redrawAllLayers();
    updateLayersList();
  }
}

function resetLayerRotation(layerId, event) {
  event.stopPropagation();
  const layer = imageLayers.find(l => l.id === layerId);
  if (layer) {
    layer.rotation = 0;
    redrawAllLayers();
    updateLayersList();
  }
}

function moveLayerUp(layerId, event) {
  event.stopPropagation();
  const index = imageLayers.findIndex(l => l.id === layerId);
  if (index < imageLayers.length - 1) {
    [imageLayers[index], imageLayers[index + 1]] = [imageLayers[index + 1], imageLayers[index]];
    updateLayersList();
    redrawAllLayers();
  }
}

function moveLayerDown(layerId, event) {
  event.stopPropagation();
  const index = imageLayers.findIndex(l => l.id === layerId);
  if (index > 0) {
    [imageLayers[index], imageLayers[index - 1]] = [imageLayers[index - 1], imageLayers[index]];
    updateLayersList();
    redrawAllLayers();
  }
}

function removeLayer(layerId, event) {
  event.stopPropagation();
  imageLayers = imageLayers.filter(l => l.id !== layerId);
  if (selectedLayerId === layerId) selectedLayerId = null;
  updateLayersList();

  if (imageLayers.length === 0) {
    document.querySelector('.no-image').style.display = 'flex';
    document.querySelector('.image-canvas-container').style.display = 'none';
  } else {
    redrawAllLayers();
  }
}

function deselectImageLayer() {
  if (selectedLayerId == null) return;
  selectedLayerId = null;
  updateLayersList();
  redrawAllLayers();
}

window.deselectImageLayer = deselectImageLayer;

function redrawAllLayers() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  ctx.setTransform(imageZoom, 0, 0, imageZoom, imagePanX, imagePanY);
  
  imageLayers.forEach(layer => {
    if (layer.visible) {
      ctx.save();
      
      // Apply rotation around the center of the image
      const w = layer.image.width * layer.scale;
      const h = layer.image.height * layer.scale;
      const centerX = layer.x + w / 2;
      const centerY = layer.y + h / 2;
      
      ctx.translate(centerX, centerY);
      ctx.rotate((layer.rotation || 0) * Math.PI / 180);
      ctx.translate(-centerX, -centerY);
      
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layer.image, layer.x, layer.y, w, h);
      
      ctx.restore();
      
      if (layer.id === selectedLayerId) {
        ctx.save();
        ctx.globalAlpha = 1.0;
        
        // Draw bounding box with rotation
        ctx.translate(centerX, centerY);
        ctx.rotate((layer.rotation || 0) * Math.PI / 180);
        ctx.translate(-centerX, -centerY);
        
        ctx.strokeStyle = '#9D2235';
        ctx.lineWidth = Math.max(1, 2 / imageZoom);
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(layer.x, layer.y, w, h);
        ctx.setLineDash([]);
        
        const handleSize = 8 / imageZoom;
        ctx.fillStyle = '#9D2235';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, 2 / imageZoom);
        
        // Corner resize handles
        ctx.beginPath();
        ctx.arc(layer.x, layer.y, handleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(layer.x + w, layer.y, handleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(layer.x, layer.y + h, handleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(layer.x + w, layer.y + h, handleSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore();
      }
    }
  });
  
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  
  // Sync the Konva overlay to match image transform (AFTER canvas is drawn)
  if (typeof syncImageOverlay === 'function') {
    syncImageOverlay();
  }
}

function getResizeHandle(x, y, layer) {
  const handleSize = 8;
  const w = layer.image.width * layer.scale;
  const h = layer.image.height * layer.scale;
  
  // Transform point to account for rotation
  const centerX = layer.x + w / 2;
  const centerY = layer.y + h / 2;
  const angle = -(layer.rotation || 0) * Math.PI / 180;
  
  const dx = x - centerX;
  const dy = y - centerY;
  const rotatedX = dx * Math.cos(angle) - dy * Math.sin(angle) + centerX;
  const rotatedY = dx * Math.sin(angle) + dy * Math.cos(angle) + centerY;
  
  if (Math.sqrt(Math.pow(rotatedX - layer.x, 2) + Math.pow(rotatedY - layer.y, 2)) <= handleSize) {
    return 'tl';
  }
  if (Math.sqrt(Math.pow(rotatedX - (layer.x + w), 2) + Math.pow(rotatedY - layer.y, 2)) <= handleSize) {
    return 'tr';
  }
  if (Math.sqrt(Math.pow(rotatedX - layer.x, 2) + Math.pow(rotatedY - (layer.y + h), 2)) <= handleSize) {
    return 'bl';
  }
  if (Math.sqrt(Math.pow(rotatedX - (layer.x + w), 2) + Math.pow(rotatedY - (layer.y + h), 2)) <= handleSize) {
    return 'br';
  }
  
  return null;
}

function getRotateHandle(x, y, layer) {
  // Function removed - rotation now handled by buttons
  return false;
}

imageCanvas.addEventListener('mousedown', (e) => {
  const tool = getCurrentTool();

  if (tool === 'note') {
    const rect = imageCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    createStickyNote(x, y, document.querySelector('.image-canvas-container'));
    return;
  }

  // For drawing tools other than pan and note, let the Konva overlay handle it
  // This prevents conflicts between canvas handlers and Konva drawing handlers
  const isDrawingTool = window.drawingRouter && typeof window.drawingRouter.isDrawingTool === 'function' 
    ? window.drawingRouter.isDrawingTool(tool) 
    : false;
  
  if (isDrawingTool && tool !== 'pan') {
    // Let the event propagate to the Konva overlay for drawing tools
    return;
  }

  if (tool === 'pan') {
    const coords = getCanvasCoords(e, imageCanvas);
    
    if (selectedLayerId) {
      const selectedLayer = imageLayers.find(l => l.id === selectedLayerId);
      if (selectedLayer && selectedLayer.visible) {
        const handle = getResizeHandle(coords.x, coords.y, selectedLayer);
        if (handle) {
          isResizingLayer = true;
          resizeHandle = handle;
          resizeStartX = coords.x;
          resizeStartY = coords.y;
          resizeStartScale = selectedLayer.scale;
          resizeStartLayerX = selectedLayer.x;
          resizeStartLayerY = selectedLayer.y;
          return;
        }
      }
    }
    
    for (let i = imageLayers.length - 1; i >= 0; i--) {
      const layer = imageLayers[i];
      if (!layer.visible) continue;
      
      const right = layer.x + layer.image.width * layer.scale;
      const bottom = layer.y + layer.image.height * layer.scale;
      
      if (coords.x >= layer.x && coords.x <= right &&
          coords.y >= layer.y && coords.y <= bottom) {
        isDraggingLayer = true;
        selectedLayerId = layer.id;
        dragOffsetX = coords.x - layer.x;
        dragOffsetY = coords.y - layer.y;
        updateLayersList();
        return;
      }
    }
  }
  
});

imageCanvas.addEventListener('mousemove', (e) => {
  const tool = getCurrentTool();
  
  // Let drawing tools handle their own mouse movement
  const isDrawingTool = window.drawingRouter && typeof window.drawingRouter.isDrawingTool === 'function' 
    ? window.drawingRouter.isDrawingTool(tool) 
    : false;
  
  if (isDrawingTool && tool !== 'pan') {
    return;
  }
  
  const coords = getCanvasCoords(e, imageCanvas);

  if (tool === 'pan' && selectedLayerId && !isDraggingLayer && !isResizingLayer) {
    const selectedLayer = imageLayers.find(l => l.id === selectedLayerId);
    if (selectedLayer && selectedLayer.visible) {
      const handle = getResizeHandle(coords.x, coords.y, selectedLayer);
      if (handle === 'tl' || handle === 'br') {
        imageCanvas.style.cursor = 'nwse-resize';
      } else if (handle === 'tr' || handle === 'bl') {
        imageCanvas.style.cursor = 'nesw-resize';
      } else {
        imageCanvas.style.cursor = 'grab';
      }
    }
  }
  
  if (isDraggingLayer && selectedLayerId) {
    const layer = imageLayers.find(l => l.id === selectedLayerId);
    if (layer) {
      layer.x = coords.x - dragOffsetX;
      layer.y = coords.y - dragOffsetY;
      redrawAllLayers();
    }
  } else if (isResizingLayer && selectedLayerId) {
    const layer = imageLayers.find(l => l.id === selectedLayerId);
    if (layer) {
      const dx = coords.x - resizeStartX;
      const dy = coords.y - resizeStartY;
      
      let scaleChange = 0;
      
      if (resizeHandle === 'br') {
        scaleChange = (dx + dy) / (layer.image.width + layer.image.height);
      } else if (resizeHandle === 'tl') {
        scaleChange = (-dx - dy) / (layer.image.width + layer.image.height);
        const newScale = Math.max(0.1, resizeStartScale + scaleChange);
        layer.x = resizeStartLayerX - (newScale - resizeStartScale) * layer.image.width;
        layer.y = resizeStartLayerY - (newScale - resizeStartScale) * layer.image.height;
      } else if (resizeHandle === 'tr') {
        scaleChange = (dx - dy) / (layer.image.width + layer.image.height);
        const newScale = Math.max(0.1, resizeStartScale + scaleChange);
        layer.y = resizeStartLayerY - (newScale - resizeStartScale) * layer.image.height;
      } else if (resizeHandle === 'bl') {
        scaleChange = (-dx + dy) / (layer.image.width + layer.image.height);
        const newScale = Math.max(0.1, resizeStartScale + scaleChange);
        layer.x = resizeStartLayerX - (newScale - resizeStartScale) * layer.image.width;
      }
      
      layer.scale = Math.max(0.1, Math.min(3, resizeStartScale + scaleChange));
      redrawAllLayers();
      updateLayersList();
    }
  }
});

imageCanvas.addEventListener('mouseup', (e) => {
  const tool = getCurrentTool();
  
  // Let drawing tools handle their own mouseup
  const isDrawingTool = window.drawingRouter && typeof window.drawingRouter.isDrawingTool === 'function' 
    ? window.drawingRouter.isDrawingTool(tool) 
    : false;
  
  if (isDraggingLayer) {
    isDraggingLayer = false;
  } else if (isResizingLayer) {
    isResizingLayer = false;
    resizeHandle = null;
  }

  if (tool === 'pan') {
    imageCanvas.style.cursor = 'grab';
  } else if (isDrawingTool) {
    imageCanvas.style.cursor = 'crosshair';
  }
});
