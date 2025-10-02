/* ========== RESIZER ========== */
const resizer = document.getElementById('resizer');
const mapPanel = document.querySelector('.map-panel');
const imagePanel = document.getElementById('imagePanel');

let isResizing = false;

function handleResizerMouseDown(e) {
  e.preventDefault();
  e.stopPropagation();
  isResizing = true;
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  document.body.classList.add('resizing');
}

function handleResizerMouseMove(e) {
  if (!isResizing) return;
  
  e.preventDefault();
  e.stopPropagation();
  
  const containerWidth = document.querySelector('.content-container').offsetWidth;
  const newMapWidth = (e.clientX / containerWidth) * 100;
  
  if (newMapWidth > 20 && newMapWidth < 80) {
    mapPanel.style.flex = `0 0 ${newMapWidth}%`;
    imagePanel.style.flex = `0 0 ${100 - newMapWidth}%`;
    
    requestAnimationFrame(() => {
      map.invalidateSize();
      if (mapMode === 'draw') resizeMapCanvas();
    });
  }
}

function handleResizerMouseUp(e) {
  if (isResizing) {
    e.preventDefault();
    e.stopPropagation();
    isResizing = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    document.body.classList.remove('resizing');
  }
}

resizer.addEventListener('mousedown', handleResizerMouseDown, { passive: false });
document.addEventListener('mousemove', handleResizerMouseMove, { passive: false });
document.addEventListener('mouseup', handleResizerMouseUp, { passive: false });

document.addEventListener('mouseleave', () => {
  if (isResizing) {
    isResizing = false;
    document.body.style.cursor = 'default';
    document.body.style.userSelect = 'auto';
    document.body.classList.remove('resizing');
  }
});
