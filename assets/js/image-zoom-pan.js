/* ========== IMAGE ZOOM & PAN ========== */
let imageZoom = 1;
let imagePanX = 0;
let imagePanY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;

const imageContainer = document.querySelector('.image-canvas-container');

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
  const leftClick = e.button === 0;
  const midClick = e.button === 1;
  if ((midClick || (leftClick && currentTool === 'pan')) && !isDraggingLayer && !isResizingLayer) {
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
}

function resetImageZoom() {
  imageZoom = 1;
  imagePanX = 0;
  imagePanY = 0;
  redrawAllLayers();
}
