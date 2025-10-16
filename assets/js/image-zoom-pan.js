/* ========== IMAGE ZOOM & PAN ========== */
let imageZoom = 1;
let imagePanX = 0;
let imagePanY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

const imageContainer = document.querySelector('.image-canvas-container');

// Use centralized tool accessor from image-layers.js
function getActiveTool() {
  return window.getCurrentTool ? window.getCurrentTool() : 
    ((window.drawingRouter && drawingRouter.state && drawingRouter.state.tool) || 'pan');
}

imageContainer.addEventListener('wheel', (e) => {
  if (imageLayers.length === 0) return;
  
  e.preventDefault();
  
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  const newZoom = Math.max(0.1, Math.min(imageZoom * delta, 10));
  
  const rect = imageCanvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  imagePanX = mouseX - (mouseX - imagePanX) * (newZoom / imageZoom);
  imagePanY = mouseY - (mouseY - imagePanY) * (newZoom / imageZoom);
  
  imageZoom = newZoom;
  updateImageTransform();
}, { passive: false });

imageContainer.addEventListener('mousedown', (e) => {
  const tool = getActiveTool();
  const leftClick = e.button === 0;
  const midClick = e.button === 1;
  
  // Check if we're using a drawing tool
  const isDrawingTool = window.drawingRouter && typeof window.drawingRouter.isDrawingTool === 'function' 
    ? window.drawingRouter.isDrawingTool(tool) 
    : false;
  
  // Only pan if: middle click OR (left click AND pan tool AND not drawing tool AND not dragging/resizing)
  if ((midClick || (leftClick && tool === 'pan' && !isDrawingTool)) && !isDraggingLayer && !isResizingLayer) {
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX - imagePanX;
    panStartY = e.clientY - imagePanY;
    imageContainer.classList.add('panning');
  }
});

imageContainer.addEventListener('mousemove', (e) => {
  if (isPanning) {
    e.preventDefault();
    imagePanX = e.clientX - panStartX;
    imagePanY = e.clientY - panStartY;
    updateImageTransform();
  }
});

imageContainer.addEventListener('mouseup', (e) => {
  if (isPanning) {
    isPanning = false;
    imageContainer.classList.remove('panning');
  }
});

imageContainer.addEventListener('mouseleave', () => {
  if (isPanning) {
    isPanning = false;
    imageContainer.classList.remove('panning');
  }
});

imageContainer.addEventListener('dblclick', (e) => {
  if (e.target === imageContainer) {
    imageZoom = 1;
    imagePanX = 0;
    imagePanY = 0;
    updateImageTransform();
  }
});

function updateImageTransform() {
  redrawAllLayers();
  syncImageOverlay();
}

function resetImageZoom() {
  imageZoom = 1;
  imagePanX = 0;
  imagePanY = 0;
  redrawAllLayers();
  syncImageOverlay();
}

function syncImageOverlay() {
  if (!window.drawingRouter || !drawingRouter.konvaManager) return;
  const panel = drawingRouter.konvaManager.getPanel('image');
  if (!panel || typeof panel.applyViewportTransform !== 'function') return;
  panel.applyViewportTransform({
    scaleX: imageZoom,
    scaleY: imageZoom,
    translateX: imagePanX,
    translateY: imagePanY
  });
}

// Sync will be called after drawingRouter is initialized and when images are loaded/transformed
