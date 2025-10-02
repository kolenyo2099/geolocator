/* ========== DRAWING TOOLS ========== */
let currentTool = 'pan';
let currentColor = '#FF4444';
let isDashed = false;
let currentLineWidth = 2;
let isFilled = false;
let fillOpacity = 20;
let imageDrawing = false;
let imageStartLocal = null;
let activeDrawingLayerId = null;
let polygonLayerId = null;
let imagePolygonPoints = [];
let drawingShapes = [];
