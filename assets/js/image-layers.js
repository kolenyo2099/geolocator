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

function getCurrentTool() {
  return (window.drawingRouter && drawingRouter.state && drawingRouter.state.tool) || 'pan';
}

function getCanvasCoords(event, canvas) {
  const rect = canvas.getBoundingClientRect();

  const canvasX = (event.clientX - rect.left);
  const canvasY = (event.clientY - rect.top);

  const worldX = (canvasX - imagePanX) / imageZoom + world.x;
  const worldY = (canvasY - imagePanY) / imageZoom + world.y;

  return { x: worldX, y: worldY };
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

const world = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  padding: 500
};

function getRotatedBoundingBox(layer) {
  const w = layer.image.width * layer.scale;
  const h = layer.image.height * layer.scale;
  const angle = (layer.rotation || 0) * Math.PI / 180;

  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));

  const boundWidth = w * cos + h * sin;
  const boundHeight = w * sin + h * cos;

  return {
    x: layer.x,
    y: layer.y,
    width: boundWidth,
    height: boundHeight,
  };
}

function calculateTotalBoundingBox() {
  if (imageLayers.length === 0) {
    const container = document.querySelector('.image-canvas-container');
    return {
      x: 0,
      y: 0,
      width: container.clientWidth > 0 ? container.clientWidth : 500,
      height: container.clientHeight > 0 ? container.clientHeight : 500,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  imageLayers.forEach(layer => {
    if (layer.visible) {
      const box = getRotatedBoundingBox(layer);
      minX = Math.min(minX, box.x);
      minY = Math.min(minY, box.y);
      maxX = Math.max(maxX, box.x + box.width);
      maxY = Math.max(maxY, box.y + box.height);
    }
  });

  const boundingBox = {
    x: minX - world.padding,
    y: minY - world.padding,
    width: (maxX - minX) + 2 * world.padding,
    height: (maxY - minY) + 2 * world.padding,
  };
  console.log('Calculated Bounding Box:', boundingBox);
  return boundingBox;
}

window.addEventListener('resize', () => {
  if (imageLayers.length > 0) {
    redrawAllLayers();
  }
});

imageUpload.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  e.target.value = ''; // Clear the input immediately

  const container = document.querySelector('.image-canvas-container');

  // 1. Calculate the center of the viewport in WORLD coordinates before adding new images
  const initialWorld = calculateTotalBoundingBox();
  const targetX = (container.clientWidth / 2 - imagePanX) / imageZoom + initialWorld.x;
  const targetY = (container.clientHeight / 2 - imagePanY) / imageZoom + initialWorld.y;

  const newLayers = await Promise.all(files.map((file, index) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          // 2. Add new images at the target position (with a small offset for multiples)
          const layer = {
            id: Date.now() + Math.random(),
            name: file.name,
            image: img,
            x: targetX + (index * 50),
            y: targetY + (index * 50),
            opacity: 1.0,
            visible: true,
            scale: 1.0,
            rotation: 0
          };
          resolve(layer);
        };
        img.onerror = () => resolve(null);
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }));

  const successfullyLoadedLayers = newLayers.filter(l => l !== null);
  if (successfullyLoadedLayers.length === 0) return;

  const firstNewLayer = successfullyLoadedLayers[0];
  imageLayers.push(...successfullyLoadedLayers);

  if (imageLayers.length > 0) {
    document.querySelector('.no-image').style.display = 'none';
    document.querySelector('.image-canvas-container').style.display = 'flex';
    imagePanel.classList.remove('hidden');
  }

  updateLayersList();

  // 3. First redraw calculates the new world bounds
  redrawAllLayers();

  // 4. Calculate where the new image's center ended up on screen
  const finalWorld = world; // world is a global updated by redrawAllLayers
  const newLayerCenterX = firstNewLayer.x + (firstNewLayer.image.width * firstNewLayer.scale / 2);
  const newLayerCenterY = firstNewLayer.y + (firstNewLayer.image.height * firstNewLayer.scale / 2);

  const onScreenX = (newLayerCenterX - finalWorld.x) * imageZoom + imagePanX;
  const onScreenY = (newLayerCenterY - finalWorld.y) * imageZoom + imagePanY;

  // 5. Calculate the difference between the actual center and the desired center
  const viewCenterXPixels = container.clientWidth / 2;
  const viewCenterYPixels = container.clientHeight / 2;

  const deltaX = viewCenterXPixels - onScreenX;
  const deltaY = viewCenterYPixels - onScreenY;

  // 6. Apply this difference to the pan
  imagePanX += deltaX;
  imagePanY += deltaY;

  // 7. Redraw again with the corrected pan
  redrawAllLayers();
});

function addProtractorImage() {
  const img = new Image();
  img.onload = () => {
    const container = document.querySelector('.image-canvas-container');
    const initialWorld = calculateTotalBoundingBox();
    const targetX = (container.clientWidth / 2 - imagePanX) / imageZoom + initialWorld.x;
    const targetY = (container.clientHeight / 2 - imagePanY) / imageZoom + initialWorld.y;

    const layer = {
      id: Date.now() + Math.random(),
      name: 'Protractor',
      image: img,
      x: targetX,
      y: targetY,
      opacity: 1.0,
      visible: true,
      scale: 1.0,
      rotation: 0
    };
    
    imageLayers.push(layer);
    
    if (imageLayers.length > 0) {
      document.querySelector('.no-image').style.display = 'none';
      document.querySelector('.image-canvas-container').style.display = 'flex';
      imagePanel.classList.remove('hidden');
    }
    
    updateLayersList();
    redrawAllLayers(); // First redraw

    // Recenter logic
    const finalWorld = world;
    const newLayerCenterX = layer.x + (layer.image.width * layer.scale / 2);
    const newLayerCenterY = layer.y + (layer.image.height * layer.scale / 2);

    const onScreenX = (newLayerCenterX - finalWorld.x) * imageZoom + imagePanX;
    const onScreenY = (newLayerCenterY - finalWorld.y) * imageZoom + imagePanY;

    const viewCenterXPixels = container.clientWidth / 2;
    const viewCenterYPixels = container.clientHeight / 2;

    const deltaX = viewCenterXPixels - onScreenX;
    const deltaY = viewCenterYPixels - onScreenY;

    imagePanX += deltaX;
    imagePanY += deltaY;

    redrawAllLayers(); // Second redraw
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

async function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const dt = e.dataTransfer;
  const files = Array.from(dt.files);
  
  const imageFiles = files.filter(file => file.type.startsWith('image/'));
  
  if (imageFiles.length === 0) {
    alert('Please drop only image files.');
    return;
  }

  // Calculate drop position in world coordinates
  const dropCoords = getCanvasCoords(e, imageCanvas);

  const newLayers = await Promise.all(imageFiles.map((file, index) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const layer = {
            id: Date.now() + Math.random(),
            name: file.name,
            image: img,
            x: dropCoords.x + (index * 50), // Position at drop location
            y: dropCoords.y + (index * 50),
            opacity: 1.0,
            visible: true,
            scale: 1.0,
            rotation: 0
          };
          resolve(layer);
        };
        img.onerror = () => resolve(null);
        img.src = event.target.result;
      };
      reader.readAsDataURL(file);
    });
  }));

  const successfullyLoadedLayers = newLayers.filter(l => l !== null);
  if (successfullyLoadedLayers.length === 0) return;

  imageLayers.push(...successfullyLoadedLayers);

  if (imageLayers.length > 0) {
    document.querySelector('.no-image').style.display = 'none';
    document.querySelector('.image-canvas-container').style.display = 'flex';
    imagePanel.classList.remove('hidden');
  }

  updateLayersList();
  redrawAllLayers();
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

    div.innerHTML = `
      <span class="layer-visibility" onclick="toggleLayerVisibility(${layer.id}, event)" title="${layer.visible ? 'Hide' : 'Show'}">
        ${layer.visible ? '👁️' : '🚫'}
      </span>
      <img class="layer-preview" src="${canvas.toDataURL()}" alt="preview"/>
      <div class="layer-info">
        <div class="layer-name" title="${layer.name}">${layer.name}</div>
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

function fastRedrawAllLayers() {
  const container = document.querySelector('.image-canvas-container');
  const dpr = window.devicePixelRatio || 1;
  const canvasWidth = container.clientWidth;
  const canvasHeight = container.clientHeight;

  imageCanvas.width = canvasWidth * dpr;
  imageCanvas.height = canvasHeight * dpr;
  imageCanvas.style.width = canvasWidth + 'px';
  imageCanvas.style.height = canvasHeight + 'px';

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Pan and zoom transform
  ctx.save();
  ctx.translate(imagePanX, imagePanY);
  ctx.scale(imageZoom, imageZoom);

  // World transform (centers content)
  ctx.translate(-world.x, -world.y);

  imageLayers.forEach(layer => {
    if (layer.visible) {
      ctx.save();
      
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
        
        ctx.translate(centerX, centerY);
        ctx.rotate((layer.rotation || 0) * Math.PI / 180);
        ctx.translate(-centerX, -centerY);
        
        ctx.strokeStyle = '#9D2235';
        ctx.lineWidth = Math.max(1, 2 / imageZoom);
        ctx.setLineDash([10 / imageZoom, 5 / imageZoom]);
        ctx.strokeRect(layer.x, layer.y, w, h);
        ctx.setLineDash([]);
        
        const handleSize = 8 / imageZoom;
        ctx.fillStyle = '#9D2235';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, 1 / imageZoom);
        
        const handles = [
          { x: layer.x, y: layer.y },
          { x: layer.x + w, y: layer.y },
          { x: layer.x, y: layer.y + h },
          { x: layer.x + w, y: layer.y + h },
        ];

        handles.forEach(handle => {
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, handleSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        
        ctx.restore();
      }
    }
  });

  ctx.restore(); // Restore from pan/zoom/world transform
}

function redrawAllLayers() {
  const newWorld = calculateTotalBoundingBox();
  Object.assign(world, newWorld);

  const container = document.querySelector('.image-canvas-container');
  const dpr = window.devicePixelRatio || 1;
  const canvasWidth = container.clientWidth;
  const canvasHeight = container.clientHeight;

  imageCanvas.width = canvasWidth * dpr;
  imageCanvas.height = canvasHeight * dpr;
  imageCanvas.style.width = canvasWidth + 'px';
  imageCanvas.style.height = canvasHeight + 'px';

  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Pan and zoom transform
  ctx.save();
  ctx.translate(imagePanX, imagePanY);
  ctx.scale(imageZoom, imageZoom);

  // World transform (centers content)
  ctx.translate(-world.x, -world.y);

  imageLayers.forEach(layer => {
    if (layer.visible) {
      ctx.save();

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

        ctx.translate(centerX, centerY);
        ctx.rotate((layer.rotation || 0) * Math.PI / 180);
        ctx.translate(-centerX, -centerY);

        ctx.strokeStyle = '#9D2235';
        ctx.lineWidth = Math.max(1, 2 / imageZoom);
        ctx.setLineDash([10 / imageZoom, 5 / imageZoom]);
        ctx.strokeRect(layer.x, layer.y, w, h);
        ctx.setLineDash([]);

        const handleSize = 8 / imageZoom;
        ctx.fillStyle = '#9D2235';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, 1 / imageZoom);

        const handles = [
          { x: layer.x, y: layer.y },
          { x: layer.x + w, y: layer.y },
          { x: layer.x, y: layer.y + h },
          { x: layer.x + w, y: layer.y + h },
        ];

        handles.forEach(handle => {
          ctx.beginPath();
          ctx.arc(handle.x, handle.y, handleSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });

        ctx.restore();
      }
    }
  });

  ctx.restore(); // Restore from pan/zoom/world transform
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
    
    const topLayerResult = findTopVisibleLayerAt(coords.x, coords.y);
    if (topLayerResult) {
      const { layer } = topLayerResult;
      isDraggingLayer = true;
      selectedLayerId = layer.id;
      dragOffsetX = coords.x - layer.x;
      dragOffsetY = coords.y - layer.y;
      updateLayersList();
      redrawAllLayers();
      return;
    }
  }
  
});

imageCanvas.addEventListener('mousemove', (e) => {
  const tool = getCurrentTool();
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
      fastRedrawAllLayers();
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
  if (isDraggingLayer) {
    isDraggingLayer = false;
    redrawAllLayers(); // Final redraw to update world bounds
  } else if (isResizingLayer) {
    isResizingLayer = false;
    resizeHandle = null;
    redrawAllLayers(); // Final redraw to update world bounds
  }

  if (tool === 'pan') {
    imageCanvas.style.cursor = 'grab';
  }
});
