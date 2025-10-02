/* ========== STICKY NOTES ========== */
let stickyNotes = [];
let draggedNote = null;
let dragOffsetNoteX = 0;
let dragOffsetNoteY = 0;
let noteIdCounter = 0;

function createStickyNote(x, y, container) {
  const noteId = `note-${noteIdCounter++}`;
  
  const noteDiv = document.createElement('div');
  noteDiv.className = 'sticky-note';
  noteDiv.id = noteId;
  noteDiv.style.left = x + 'px';
  noteDiv.style.top = y + 'px';
  
  noteDiv.innerHTML = `
    <div class="sticky-note-header">
      <span class="sticky-note-drag-handle">⠿⠿</span>
      <button class="sticky-note-delete" onclick="deleteStickyNote('${noteId}')" title="Delete note">×</button>
    </div>
    <textarea class="sticky-note-textarea" placeholder="Type your note here..." onclick="event.stopPropagation()"></textarea>
  `;
  
  container.appendChild(noteDiv);
  
  const note = {
    id: noteId,
    element: noteDiv,
    container: container
  };
  
  stickyNotes.push(note);
  
  // Make draggable
  const header = noteDiv.querySelector('.sticky-note-header');
  header.addEventListener('mousedown', (e) => startDragNote(e, note));
  
  // Focus textarea
  setTimeout(() => {
    noteDiv.querySelector('.sticky-note-textarea').focus();
  }, 100);
  
  return note;
}

function startDragNote(e, note) {
  e.preventDefault();
  e.stopPropagation();
  
  draggedNote = note;
  note.element.classList.add('dragging');
  
  const rect = note.element.getBoundingClientRect();
  const containerRect = note.container.getBoundingClientRect();
  
  dragOffsetNoteX = e.clientX - rect.left;
  dragOffsetNoteY = e.clientY - rect.top;
}

document.addEventListener('mousemove', (e) => {
  if (!draggedNote) return;
  
  e.preventDefault();
  const containerRect = draggedNote.container.getBoundingClientRect();
  
  let newX = e.clientX - containerRect.left - dragOffsetNoteX;
  let newY = e.clientY - containerRect.top - dragOffsetNoteY;
  
  // Keep within bounds
  newX = Math.max(0, Math.min(newX, containerRect.width - draggedNote.element.offsetWidth));
  newY = Math.max(0, Math.min(newY, containerRect.height - draggedNote.element.offsetHeight));
  
  draggedNote.element.style.left = newX + 'px';
  draggedNote.element.style.top = newY + 'px';
});

document.addEventListener('mouseup', () => {
  if (draggedNote) {
    draggedNote.element.classList.remove('dragging');
    draggedNote = null;
  }
});

function deleteStickyNote(noteId) {
  const note = stickyNotes.find(n => n.id === noteId);
  if (note) {
    note.element.remove();
    stickyNotes = stickyNotes.filter(n => n.id !== noteId);
  }
}

function selectTool(tool) {
  currentTool = tool;
  document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  imagePolygonPoints = [];
  mapPolygonPoints = [];
  
  if (tool === 'pan') {
    imageCanvas.classList.add('pan-cursor');
  } else if (tool === 'note') {
    imageCanvas.style.cursor = 'crosshair';
    imageCanvas.classList.remove('pan-cursor');
  } else {
    imageCanvas.classList.remove('pan-cursor');
  }
}

selectTool('pan');

function selectColor(color) {
  currentColor = color;
  document.getElementById('colorPicker').value = color;
}

function toggleLineStyle() {
  isDashed = !isDashed;
  const btn = document.getElementById('solidToggle');
  btn.textContent = isDashed ? 'Dashed' : 'Solid';
  btn.classList.toggle('active', !isDashed);
}

function toggleFill() {
  isFilled = !isFilled;
  const btn = document.getElementById('fillToggle');
  btn.classList.toggle('active', isFilled);
}

function updateFillOpacity(value) {
  fillOpacity = parseInt(value);
  document.getElementById('opacityLabel').textContent = fillOpacity + '%';
}

function selectLineWidth(width) {
  currentLineWidth = width;
  document.querySelectorAll('[data-width]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.width == width);
  });
}

function getCanvasCoords(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const worldX = (px - imagePanX) / imageZoom;
  const worldY = (py - imagePanY) / imageZoom;
  return { x: worldX, y: worldY };
}

function handleDrawingMouseDown(e) {
  const coords = getCanvasCoords(e, imageCanvas);
  
  if (currentTool === 'polygon') {
    imagePolygonPoints.push(coords);
    redrawAllLayers();
    
    ctx.fillStyle = currentColor;
    ctx.beginPath();
    ctx.arc(coords.x, coords.y, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    return;
  }
  
  imageDrawing = true;
  imageStartX = coords.x;
  imageStartY = coords.y;
}

function handleDrawingMouseMove(e) {
  if (!imageDrawing) return;
  
  const coords = getCanvasCoords(e, imageCanvas);
  
  redrawAllLayers();
  
  const previewShape = {
    type: currentTool,
    color: currentColor,
    dashed: isDashed,
    lineWidth: currentLineWidth,
    filled: isFilled,
    fillOpacity: fillOpacity,
    startX: imageStartX, startY: imageStartY,
    endX: coords.x, endY: coords.y
  };
  
  drawShapeOnContext(ctx, previewShape);
}

function handleDrawingMouseUp(e) {
  if (!imageDrawing) return;
  
  const coords = getCanvasCoords(e, imageCanvas);
  
  const shape = {
    type: currentTool,
    color: currentColor,
    dashed: isDashed,
    lineWidth: currentLineWidth,
    filled: isFilled,
    fillOpacity: fillOpacity,
    startX: imageStartX, startY: imageStartY,
    endX: coords.x, endY: coords.y
  };
  
  drawingShapes.push(shape);
  imageDrawing = false;
  redrawAllLayers();
}

imageCanvas.addEventListener('dblclick', (e) => {
  if (currentTool === 'polygon' && imagePolygonPoints.length > 2) {
    const shape = {
      type: 'polygon',
      color: currentColor,
      dashed: isDashed,
      lineWidth: currentLineWidth,
      filled: isFilled,
      fillOpacity: fillOpacity,
      points: [...imagePolygonPoints]
    };
    drawingShapes.push(shape);
    imagePolygonPoints = [];
    redrawAllLayers();
  }
});

function drawShapeOnContext(context, shape) {
  context.strokeStyle = shape.color;
  context.lineWidth = shape.lineWidth || currentLineWidth;
  context.setLineDash(shape.dashed ? [10, 5] : []);
  
  const opacity = shape.fillOpacity || fillOpacity;
  const opacityHex = Math.round((opacity / 100) * 255).toString(16).padStart(2, '0');
  context.fillStyle = shape.color + opacityHex;
  
  if (shape.type === 'rect') {
    const width = shape.endX - shape.startX;
    const height = shape.endY - shape.startY;
    context.strokeRect(shape.startX, shape.startY, width, height);
    if (shape.filled) {
      context.fillRect(shape.startX, shape.startY, width, height);
    }
  }
  else if (shape.type === 'circle') {
    const radius = Math.sqrt(
      Math.pow(shape.endX - shape.startX, 2) + 
      Math.pow(shape.endY - shape.startY, 2)
    );
    context.beginPath();
    context.arc(shape.startX, shape.startY, radius, 0, 2 * Math.PI);
    if (shape.filled) {
      context.fill();
    }
    context.stroke();
  }
  else if (shape.type === 'ellipse') {
    const radiusX = Math.abs(shape.endX - shape.startX);
    const radiusY = Math.abs(shape.endY - shape.startY);
    const centerX = (shape.startX + shape.endX) / 2;
    const centerY = (shape.startY + shape.endY) / 2;
    context.beginPath();
    context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
    if (shape.filled) {
      context.fill();
    }
    context.stroke();
  }
  else if (shape.type === 'line') {
    context.beginPath();
    context.moveTo(shape.startX, shape.startY);
    context.lineTo(shape.endX, shape.endY);
    context.stroke();
  }
  else if (shape.type === 'arrow') {
    context.beginPath();
    context.moveTo(shape.startX, shape.startY);
    context.lineTo(shape.endX, shape.endY);
    context.stroke();
    
    const angle = Math.atan2(shape.endY - shape.startY, shape.endX - shape.startX);
    const arrowLength = 15;
    context.beginPath();
    context.moveTo(shape.endX, shape.endY);
    context.lineTo(
      shape.endX - arrowLength * Math.cos(angle - Math.PI / 6),
      shape.endY - arrowLength * Math.sin(angle - Math.PI / 6)
    );
    context.moveTo(shape.endX, shape.endY);
    context.lineTo(
      shape.endX - arrowLength * Math.cos(angle + Math.PI / 6),
      shape.endY - arrowLength * Math.sin(angle + Math.PI / 6)
    );
    context.stroke();
  }
  else if (shape.type === 'polygon' && shape.points) {
    context.beginPath();
    context.moveTo(shape.points[0].x, shape.points[0].y);
    shape.points.forEach(p => context.lineTo(p.x, p.y));
    context.closePath();
    if (shape.filled) {
      context.fill();
    }
    context.stroke();
    
    shape.points.forEach(p => {
      context.fillStyle = shape.color;
      context.strokeStyle = '#fff';
      context.lineWidth = 2;
      context.setLineDash([]);
      context.beginPath();
      context.arc(p.x, p.y, 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
  }
  else if (shape.type === 'freehand') {
    context.beginPath();
    context.moveTo(shape.startX, shape.startY);
    context.lineTo(shape.endX, shape.endY);
    context.stroke();
  }
  
  context.setLineDash([]);
}

function undoLast() {
  // Try to delete the most recent sticky note first
  if (stickyNotes.length > 0) {
    const lastNote = stickyNotes[stickyNotes.length - 1];
    deleteStickyNote(lastNote.id);
    return;
  }
  
  // Then try shapes
  if (drawingShapes.length > 0) {
    drawingShapes.pop();
    redrawAllLayers();
  } else if (currentView === '3d' && view3DShapes.length > 0) {
    view3DShapes.pop();
    redraw3DCanvas();
  } else if (mapShapes.length > 0) {
    mapShapes.pop();
    redrawMapCanvas();
  }
}

function clearAll() {
  // Clear all sticky notes
  const notesToDelete = [...stickyNotes];
  notesToDelete.forEach(note => deleteStickyNote(note.id));
  
  // Clear shapes
  drawingShapes = [];
  redrawAllLayers();
  
  if (currentView === '3d') {
    view3DShapes = [];
    redraw3DCanvas();
  }
  mapShapes = [];
  redrawMapCanvas();
}
