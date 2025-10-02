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

const imageUpload = document.getElementById('imageUpload');
const imageViewer = document.getElementById('imageViewer');
const imageCanvas = document.getElementById('imageCanvas');
const ctx = imageCanvas.getContext('2d');

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

function convertImageShapeToWorld(shape, layer) {
  if (!shape) return null;

  if (!shape.layerId) {
    return shape;
  }

  if (!layer) return null;

  const base = {
    type: shape.type,
    color: shape.color,
    dashed: shape.dashed,
    lineWidth: shape.lineWidth,
    filled: shape.filled,
    fillOpacity: shape.fillOpacity
  };

  if (shape.type === 'polygon' && Array.isArray(shape.points)) {
    const points = shape.points
      .map(pt => layerCoordsToWorld(pt, layer))
      .filter(Boolean)
      .map(pt => ({ x: pt.x, y: pt.y }));

    if (points.length === 0) return null;

    return {
      ...base,
      points
    };
  }

  if (shape.start && shape.end) {
    const start = layerCoordsToWorld(shape.start, layer);
    const end = layerCoordsToWorld(shape.end, layer);
    if (!start || !end) return null;

    return {
      ...base,
      startX: start.x,
      startY: start.y,
      endX: end.x,
      endY: end.y
    };
  }

  if (typeof shape.startX === 'number' && typeof shape.startY === 'number') {
    return shape;
  }

  return null;
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
  
  if (imageLayers.length === 0) {
    list.innerHTML = '<p class="no-layers">No images uploaded</p>';
    return;
  }
  
  list.innerHTML = '';
  
  [...imageLayers].reverse().forEach((layer, index) => {
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
  drawingShapes = drawingShapes.filter(shape => shape.layerId !== layerId);
  if (polygonLayerId === layerId) {
    polygonLayerId = null;
    imagePolygonPoints = [];
  }

  updateLayersList();

  if (imageLayers.length === 0) {
    document.querySelector('.no-image').style.display = 'flex';
    document.querySelector('.image-canvas-container').style.display = 'none';
  } else {
    redrawAllLayers();
  }
}

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
  
  drawingShapes.forEach(shape => {
    if (shape.layerId) {
      const layer = imageLayers.find(l => l.id === shape.layerId && l.visible);
      if (!layer) return;
      const worldShape = convertImageShapeToWorld(shape, layer);
      if (worldShape) drawShapeOnContext(ctx, worldShape);
    } else {
      drawShapeOnContext(ctx, shape);
    }
  });

  if (currentTool === 'polygon' && imagePolygonPoints.length > 0 && polygonLayerId) {
    const layer = imageLayers.find(l => l.id === polygonLayerId && l.visible);
    if (layer) {
      const previewPoints = imagePolygonPoints
        .map(pt => layerCoordsToWorld(pt, layer))
        .filter(Boolean);

      if (previewPoints.length > 0) {
        ctx.save();
        ctx.fillStyle = currentColor;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = Math.max(1, 2 / imageZoom);
        previewPoints.forEach(pt => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 4 / imageZoom, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
      }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
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
  // Handle sticky note placement
  if (currentTool === 'note') {
    const rect = imageCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    createStickyNote(x, y, document.querySelector('.image-canvas-container'));
    return;
  }
  
  if (currentTool === 'pan') {
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
  
  if (!isDraggingLayer && !isResizingLayer && currentTool !== 'pan' && currentTool !== 'note') {
    handleDrawingMouseDown(e);
  }
});

imageCanvas.addEventListener('mousemove', (e) => {
  const coords = getCanvasCoords(e, imageCanvas);
  
  if (currentTool === 'pan' && selectedLayerId && !isDraggingLayer && !isResizingLayer) {
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
  } else if (imageDrawing) {
    handleDrawingMouseMove(e);
  }
});

imageCanvas.addEventListener('mouseup', (e) => {
  if (isDraggingLayer) {
    isDraggingLayer = false;
  } else if (isResizingLayer) {
    isResizingLayer = false;
    resizeHandle = null;
  } else if (imageDrawing) {
    handleDrawingMouseUp(e);
  }
  
  if (currentTool === 'pan') {
    imageCanvas.style.cursor = 'grab';
  }
});
