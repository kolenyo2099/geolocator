/* ========== IMAGE ZOOM & PAN ========== */
let imageZoom = 1;
let imagePanX = 0;
let imagePanY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

let imageContainer;

function getActiveTool() {
  return (window.drawingRouter && drawingRouter.state && drawingRouter.state.tool) || 'pan';
}

// Event handlers (will be registered in init)
const wheelHandler = ((e) => {
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
});

const mouseDownHandler = ((e) => {
  const leftClick = e.button === 0;
  const midClick = e.button === 1;
  const tool = getActiveTool();
  
  // Don't start panning if using a drawing tool (let Konva handle it)
  if (tool !== 'pan' && tool !== 'note' && leftClick) {
    return;
  }
  
  if ((midClick || (leftClick && tool === 'pan')) && !isDraggingLayer && !isResizingLayer) {
    e.preventDefault();
    isPanning = true;
    panStartX = e.clientX - imagePanX;
    panStartY = e.clientY - imagePanY;
    if (imageContainer) {
      imageContainer.classList.add('panning');
    }
  }
});

const mouseMoveHandler = ((e) => {
  if (isPanning) {
    e.preventDefault();
    e.stopPropagation();
    imagePanX = e.clientX - panStartX;
    imagePanY = e.clientY - panStartY;
    updateImageTransform();
  }
});

const mouseUpHandler = ((e) => {
  if (isPanning) {
    isPanning = false;
    if (imageContainer) {
      imageContainer.classList.remove('panning');
    }
  }
});

const mouseLeaveHandler = (() => {
  if (isPanning) {
    isPanning = false;
    if (imageContainer) {
      imageContainer.classList.remove('panning');
    }
  }
});

const dblClickHandler = ((e) => {
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

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  imageContainer = document.querySelector('.image-canvas-container');
  
  if (imageContainer) {
    // Register event listeners
    imageContainer.addEventListener('wheel', wheelHandler, { passive: false });
    imageContainer.addEventListener('mousedown', mouseDownHandler);
    imageContainer.addEventListener('mousemove', mouseMoveHandler);
    imageContainer.addEventListener('mouseup', mouseUpHandler);
    imageContainer.addEventListener('mouseleave', mouseLeaveHandler);
    imageContainer.addEventListener('dblclick', dblClickHandler);
  }
  
  syncImageOverlay();
});
