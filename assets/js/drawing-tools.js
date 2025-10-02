/* ========== DRAWING TOOLS ========== */
let currentTool = 'pan';
let currentColor = '#FF4444';
let isDashed = false;
let currentLineWidth = 2;
let isFilled = false;
let fillOpacity = 20;
let imageDrawing = false;
let imageStartX, imageStartY;
let imagePolygonPoints = [];
let drawingShapes = [];
