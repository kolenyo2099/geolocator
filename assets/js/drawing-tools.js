/* ========== DRAWING INFRASTRUCTURE ==========
 * Provides a unified drawing experience across panels by routing toolbar
 * actions to either Leaflet Geoman (for geographic shapes) or Konva (for
 * pixel-based overlays). The module maintains a global undo/redo stack and
 * harmonises styling across backends.
 */

/* global map, Konva, stickyNotes */

const DRAWING_DEFAULTS = {
  tool: 'pan',
  color: '#FF4444',
  dashed: false,
  lineWidth: 2,
  filled: false,
  fillOpacity: 0.2
};

function hexToRgba(hex, opacity) {
  const stripped = hex.replace('#', '');
  const bigint = parseInt(stripped, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

class KonvaPanel {
  constructor(key, container, router, options = {}) {
    this.key = key;
    this.container = container;
    this.router = router;
    this.forwardTarget = options.forwardTarget || container;
    this.overlay = document.createElement('div');
    this.overlay.className = 'konva-overlay';
    this.overlay.style.position = 'absolute';
    this.overlay.style.top = '0';
    this.overlay.style.left = '0';
    this.overlay.style.width = '100%';
    this.overlay.style.height = '100%';
    this.overlay.style.pointerEvents = 'none';
    this.overlay.style.zIndex = '30';

    // Ensure container can host absolute overlay
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    container.appendChild(this.overlay);

    this.stage = new Konva.Stage({
      container: this.overlay,
      width: container.clientWidth,
      height: container.clientHeight
    });

    this.layer = new Konva.Layer();
    this.stage.add(this.layer);

    this.transformer = new Konva.Transformer({
      rotateEnabled: true,
      rotateAnchorOffset: 30,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center'],
      anchorSize: 8,
      borderStroke: '#1971c2',
      borderStrokeWidth: 1
    });
    this.layer.add(this.transformer);

    this.shapes = new Set();

    this.activeShape = null;
    this.drawingShape = null;
    this.pendingPolygon = null;
    this.forwarding = false;

    this.stage.on('mousedown touchstart', (evt) => this.onPointerDown(evt));
    this.stage.on('mousemove touchmove', (evt) => this.onPointerMove(evt));
    this.stage.on('mouseup touchend', (evt) => this.onPointerUp(evt));
    this.stage.on('click tap', (evt) => this.onClick(evt));
    this.stage.on('dblclick dbltap', (evt) => this.onDoubleClick(evt));
  }

  setPointerEnabled(enabled) {
    if (this.forwarding) return;
    this.overlay.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  resize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.stage.size({ width, height });
    this.stage.draw();
  }

  clear() {
    [...this.shapes].forEach(shape => {
      this.cleanupArrowLabel(shape, true);
      shape.destroy();
    });
    this.shapes.clear();
    this.transformer.nodes([]);
    this.pendingPolygon = null;
    this.drawingShape = null;
    this.layer.draw();
  }

  registerShape(shape) {
    shape.setAttrs({
      draggable: true,
      name: 'drawing-shape'
    });

    shape.on('dragstart transformstart', () => {
      shape._initialState = this.serializeShape(shape);
    });

    shape.on('dragend transformend', () => {
      if (!shape._initialState) return;
      const before = shape._initialState;
      const after = this.serializeShape(shape);
      shape._initialState = null;
      if (before && after && JSON.stringify(before) !== JSON.stringify(after)) {
        this.router.recordUpdate(this.key, shape, before, after);
      }
    });

    shape.on('click tap', (evt) => {
      if (this.router.state.tool !== 'pan') return;
      evt.cancelBubble = true;
      this.transformer.nodes([shape]);
      this.activeShape = shape;
      this.layer.batchDraw();
    });

    if (shape.getAttr('shapeType') === 'arrow') {
      const update = () => {
        this.updateArrowMeasurement(shape);
      };
      shape.on('dragmove transform', update);
      shape.on('pointsChange strokeChange strokeWidthChange', update);
      shape.on('destroy', () => {
        this.cleanupArrowLabel(shape, true);
      });
    }

    this.shapes.add(shape);
  }

  addShape(shape) {
    this.registerShape(shape);
    this.layer.add(shape);
    if (shape.getAttr('shapeType') === 'arrow') {
      const label = this.ensureArrowLabel(shape);
      if (label) {
        label.moveToTop();
        this.updateArrowMeasurement(shape);
      }
    }
    this.layer.draw();
  }

  removeShape(shape) {
    this.shapes.delete(shape);
    if (this.transformer.nodes().includes(shape)) {
      this.transformer.nodes([]);
    }
    this.cleanupArrowLabel(shape);
    shape.remove();
    this.layer.draw();
  }

  serializeShape(shape) {
    const type = shape.getAttr('shapeType');
    const common = {
      type,
      stroke: shape.stroke(),
      strokeWidth: shape.strokeWidth(),
      dash: shape.dash(),
      fill: shape.fill()
    };

    switch (type) {
      case 'rect':
        return { ...common, x: shape.x(), y: shape.y(), width: shape.width(), height: shape.height() };
      case 'ellipse':
        return { ...common, x: shape.x(), y: shape.y(), radiusX: shape.radiusX(), radiusY: shape.radiusY() };
      case 'circle':
        return { ...common, x: shape.x(), y: shape.y(), radius: shape.radius() };
      case 'line':
      case 'arrow':
      case 'polygon':
      case 'freehand':
        return { ...common, points: [...shape.points()] };
      case 'text':
        return { ...common, x: shape.x(), y: shape.y(), text: shape.text(), fontSize: shape.fontSize() };
      default:
        return null;
    }
  }

  applyShapeState(shape, state) {
    if (!state) return;
    shape.stroke(state.stroke);
    shape.strokeWidth(state.strokeWidth);
    shape.dash(state.dash || []);
    shape.fill(state.fill || 'rgba(0,0,0,0)');
    switch (state.type) {
      case 'rect':
        shape.position({ x: state.x, y: state.y });
        shape.width(state.width);
        shape.height(state.height);
        break;
      case 'ellipse':
        shape.position({ x: state.x, y: state.y });
        shape.radiusX(state.radiusX);
        shape.radiusY(state.radiusY);
        break;
      case 'circle':
        shape.position({ x: state.x, y: state.y });
        shape.radius(state.radius);
        break;
      case 'line':
      case 'arrow':
      case 'polygon':
      case 'freehand':
        shape.points(state.points);
        if (state.type === 'arrow') {
          this.ensureArrowLabel(shape);
          this.updateArrowMeasurement(shape);
        }
        break;
      case 'text':
        shape.position({ x: state.x, y: state.y });
        shape.text(state.text);
        shape.fontSize(state.fontSize);
        break;
      default:
        break;
    }
    this.layer.batchDraw();
  }

  getPointerPosition(evt) {
    const stage = evt.target.getStage();
    if (!stage) return null;
    return stage.getPointerPosition();
  }

  styleAttributes() {
    const state = this.router.state;
    const fillOpacity = state.filled ? state.fillOpacity : 0;
    return {
      stroke: state.color,
      strokeWidth: state.lineWidth,
      dash: state.dashed ? [12, 6] : [],
      fill: fillOpacity > 0 ? hexToRgba(state.color, fillOpacity) : 'rgba(0,0,0,0)'
    };
  }

  createShape(tool, startPos) {
    const style = this.styleAttributes();
    switch (tool) {
      case 'rect':
        return new Konva.Rect({
          ...style,
          x: startPos.x,
          y: startPos.y,
          width: 0,
          height: 0,
          shapeType: 'rect'
        });
      case 'ellipse':
        return new Konva.Ellipse({
          ...style,
          x: startPos.x,
          y: startPos.y,
          radiusX: 0,
          radiusY: 0,
          shapeType: 'ellipse'
        });
      case 'circle':
        return new Konva.Circle({
          ...style,
          x: startPos.x,
          y: startPos.y,
          radius: 0,
          shapeType: 'circle'
        });
      case 'line':
        return new Konva.Line({
          ...style,
          points: [startPos.x, startPos.y, startPos.x, startPos.y],
          shapeType: 'line'
        });
      case 'arrow':
        return new Konva.Arrow({
          ...style,
          pointerLength: 14,
          pointerWidth: 14,
          points: [startPos.x, startPos.y, startPos.x, startPos.y],
          shapeType: 'arrow'
        });
      case 'freehand':
        return new Konva.Line({
          ...style,
          points: [startPos.x, startPos.y],
          lineCap: 'round',
          lineJoin: 'round',
          tension: 0,
          shapeType: 'freehand'
        });
      default:
        return null;
    }
  }

  onPointerDown(evt) {
    const tool = this.router.state.tool;

    if (tool === 'pan') {
      if (evt.target === this.stage) {
        this.startForwarding(evt, tool);
      }
      return;
    }

    if (tool === 'note') {
      const pos = this.getPointerPosition(evt);
      if (pos && typeof createStickyNote === 'function') {
        createStickyNote(pos.x, pos.y, this.container);
      }
      return;
    }

    const pos = this.getPointerPosition(evt);
    if (!pos) return;

    if (this.router.state.tool === 'polygon') {
      evt.cancelBubble = true;
      this.startPolygon(pos);
      return;
    }

    if (this.router.state.tool === 'freehand') {
      evt.cancelBubble = true;
      this.startFreehand(pos);
      return;
    }

    this.transformer.nodes([]);
    const shape = this.createShape(this.router.state.tool, pos);
    if (!shape) return;

    this.drawingShape = shape;
    this.addShape(shape);
    evt.cancelBubble = true;
  }

  onPointerMove(evt) {
    if (this.forwarding) {
      this.forwardPointerEvent('mousemove', evt);
      return;
    }

    if (!this.drawingShape) {
      if (this.pendingPolygon && this.pendingPolygon.line) {
        const pos = this.getPointerPosition(evt);
        if (!pos) return;
        const points = [...this.pendingPolygon.points, pos.x, pos.y];
        this.pendingPolygon.line.points(points);
        this.layer.batchDraw();
      }
      return;
    }

    const pos = this.getPointerPosition(evt);
    if (!pos) return;

    const tool = this.router.state.tool;
    if (tool === 'rect') {
      this.updateRect(pos);
    } else if (tool === 'ellipse') {
      this.updateEllipse(pos);
    } else if (tool === 'circle') {
      this.updateCircle(pos);
    } else if (tool === 'line' || tool === 'arrow') {
      this.updateLine(pos);
    } else if (tool === 'freehand') {
      const line = this.drawingShape;
      const newPoints = [...line.points(), pos.x, pos.y];
      line.points(newPoints);
    }
    this.layer.batchDraw();
  }

  onPointerUp(evt) {
    if (this.forwarding) {
      this.stopForwarding(evt);
      return;
    }

    if (!this.drawingShape) return;

    const shape = this.drawingShape;
    this.drawingShape = null;
    evt.cancelBubble = true;

    // Remove zero-sized shapes
    const state = this.serializeShape(shape);
    if (!state) {
      this.removeShape(shape);
      return;
    }

    const isDegenerate = () => {
      if (state.type === 'rect') {
        return Math.abs(state.width) < 3 || Math.abs(state.height) < 3;
      }
      if (state.type === 'ellipse') {
        return Math.abs(state.radiusX) < 3 || Math.abs(state.radiusY) < 3;
      }
      if (state.type === 'circle') {
        return Math.abs(state.radius) < 3;
      }
      if (state.type === 'line' || state.type === 'arrow' || state.type === 'freehand') {
        const pts = state.points;
        if (!pts || pts.length < 4) return true;
        const dx = pts[2] - pts[0];
        const dy = pts[3] - pts[1];
        return Math.sqrt(dx * dx + dy * dy) < 3;
      }
      return false;
    };

    if (isDegenerate()) {
      this.removeShape(shape);
      return;
    }

    this.router.recordAdd(this.key, shape);
  }

  onClick(evt) {
    if (this.router.state.tool !== 'pan') return;
    if (evt.target === this.stage) {
      this.transformer.nodes([]);
      this.layer.draw();
    }
  }

  onDoubleClick(evt) {
    if (this.router.state.tool !== 'polygon') return;
    evt.cancelBubble = true;
    this.finishPolygon();
  }

  startForwarding(evt, tool) {
    if (!this.forwardTarget) return;
    this.forwarding = true;
    this.overlay.style.pointerEvents = 'none';
    this.forwardPointerEvent('mousedown', evt, tool);
  }

  stopForwarding(evt) {
    if (!this.forwarding) return;
    this.forwardPointerEvent('mouseup', evt);
    this.forwarding = false;
    const shouldEnable = this.router.activePanel === this.key && this.router.state.tool !== 'pan' && this.router.state.tool !== 'note';
    this.overlay.style.pointerEvents = shouldEnable ? 'auto' : 'none';
  }

  forwardPointerEvent(type, evt) {
    if (!this.forwardTarget || !evt) return;
    const source = evt.evt;
    if (!source) return;

    let clientX = source.clientX;
    let clientY = source.clientY;
    let screenX = source.screenX;
    let screenY = source.screenY;
    let buttons = source.buttons;

    if (typeof TouchEvent !== 'undefined' && source instanceof TouchEvent) {
      const touch = source.touches[0] || source.changedTouches[0];
      if (touch) {
        clientX = touch.clientX;
        clientY = touch.clientY;
        screenX = touch.screenX;
        screenY = touch.screenY;
        buttons = 1;
      }
    }

    const event = new MouseEvent(type, {
      clientX,
      clientY,
      screenX,
      screenY,
      bubbles: true,
      cancelable: true,
      buttons
    });

    this.forwardTarget.dispatchEvent(event);
  }

  startPolygon(pos) {
    if (!this.pendingPolygon) {
      const style = this.styleAttributes();
      const line = new Konva.Line({
        ...style,
        points: [pos.x, pos.y],
        closed: false,
        shapeType: 'polygon'
      });
      this.pendingPolygon = {
        line,
        points: [pos.x, pos.y]
      };
      this.addShape(line);
    } else {
      const points = this.pendingPolygon.points;
      points.push(pos.x, pos.y);
      this.pendingPolygon.line.points(points);
      this.layer.batchDraw();
    }
  }

  finishPolygon() {
    if (!this.pendingPolygon || this.pendingPolygon.points.length < 6) {
      if (this.pendingPolygon && this.pendingPolygon.line) {
        this.removeShape(this.pendingPolygon.line);
      }
      this.pendingPolygon = null;
      return;
    }

    const line = this.pendingPolygon.line;
    line.closed(true);
    line.points([...this.pendingPolygon.points]);
    this.pendingPolygon = null;
    this.layer.batchDraw();
    this.router.recordAdd(this.key, line);
  }

  startFreehand(pos) {
    const line = this.createShape('freehand', pos);
    if (!line) return;
    this.drawingShape = line;
    this.addShape(line);
  }

  updateRect(pos) {
    const rect = this.drawingShape;
    const startX = rect.x();
    const startY = rect.y();
    rect.width(pos.x - startX);
    rect.height(pos.y - startY);
  }

  updateEllipse(pos) {
    const ellipse = this.drawingShape;
    const startX = ellipse.x();
    const startY = ellipse.y();
    ellipse.radiusX(Math.abs(pos.x - startX));
    ellipse.radiusY(Math.abs(pos.y - startY));
    ellipse.position({
      x: Math.min(startX, pos.x),
      y: Math.min(startY, pos.y)
    });
  }

  updateCircle(pos) {
    const circle = this.drawingShape;
    const startX = circle.x();
    const startY = circle.y();
    const radius = Math.sqrt(Math.pow(pos.x - startX, 2) + Math.pow(pos.y - startY, 2));
    circle.radius(radius);
  }

  updateLine(pos) {
    const line = this.drawingShape;
    const points = line.points();
    points[2] = pos.x;
    points[3] = pos.y;
    line.points(points);
    if (line.getAttr('shapeType') === 'arrow') {
      this.ensureArrowLabel(line);
      this.updateArrowMeasurement(line);
    }
  }

  ensureArrowLabel(shape) {
    if (!shape || shape.getAttr('shapeType') !== 'arrow') return null;
    let label = shape._measurementLabel;
    if (label && typeof label.isDestroyed === 'function' && label.isDestroyed()) {
      label = null;
    }
    if (!label) {
      label = new Konva.Text({
        text: '',
        fontSize: 12,
        fontFamily: 'Inter, Arial, sans-serif',
        fill: shape.stroke() || '#FF4444',
        padding: 2,
        align: 'center',
        listening: false,
        name: 'arrow-measurement-label',
        visible: false
      });
      shape._measurementLabel = label;
    }
    label.fill(shape.stroke() || '#FF4444');
    if (label.getLayer() !== this.layer) {
      this.layer.add(label);
    }
    return label;
  }

  cleanupArrowLabel(shape, destroy = false) {
    if (!shape || shape.getAttr('shapeType') !== 'arrow') return;
    const label = shape._measurementLabel;
    if (!label) return;
    if (destroy) {
      label.destroy();
      shape._measurementLabel = null;
    } else {
      label.remove();
    }
  }

  updateArrowMeasurement(shape) {
    if (!shape || shape.getAttr('shapeType') !== 'arrow') return;
    const label = this.ensureArrowLabel(shape);
    if (!label) return;

    const points = shape.points();
    if (!points || points.length < 4) {
      label.visible(false);
      return;
    }

    const start = { x: points[0], y: points[1] };
    const end = { x: points[points.length - 2], y: points[points.length - 1] };
    const transform = shape.getAbsoluteTransform().copy();
    const startAbs = transform.point(start);
    const endAbs = transform.point(end);

    const dx = endAbs.x - startAbs.x;
    const dy = endAbs.y - startAbs.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (!length || Number.isNaN(length)) {
      label.visible(false);
      return;
    }

    const text = Math.round(length).toString();
    label.text(text);
    label.fill(shape.stroke() || '#FF4444');
    label.visible(true);
    label.moveToTop();

    const midpoint = {
      x: (startAbs.x + endAbs.x) / 2,
      y: (startAbs.y + endAbs.y) / 2
    };

    let perpX = -dy;
    let perpY = dx;
    const perpLength = Math.sqrt(perpX * perpX + perpY * perpY);
    const offsetDistance = 12;
    if (perpLength > 0) {
      perpX = (perpX / perpLength) * offsetDistance;
      perpY = (perpY / perpLength) * offsetDistance;
    } else {
      perpX = 0;
      perpY = -offsetDistance;
    }

    const absolutePosition = {
      x: midpoint.x + perpX,
      y: midpoint.y + perpY
    };

    label.absolutePosition(absolutePosition);
    label.offset({ x: label.width() / 2, y: label.height() / 2 });

    let angle = Math.atan2(dy, dx) * (180 / Math.PI);
    if (angle > 90 || angle < -90) {
      angle += 180;
    }
    label.rotation(angle);

    const layer = label.getLayer();
    if (layer) {
      layer.batchDraw();
    }
  }
}

class KonvaManager {
  constructor(router) {
    this.router = router;
    this.panels = new Map();
    this.activePanel = null;
  }

  panelDefinitions() {
    return [
      { key: 'map-overlay', selector: '#map', forwardSelector: '#mapCanvas' },
      { key: 'image', selector: '.image-canvas-container', forwardSelector: '#imageCanvas' },
      { key: 'view3d', selector: '#view3DContainer', forwardSelector: '#view3DCanvas' },
      { key: 'peakfinder', selector: '#peakFinderContainer', forwardSelector: '#pfcanvas' },
      { key: 'streetview', selector: '#streetViewContainer', forwardSelector: '#streetViewContainer' },
      { key: 'mapillary', selector: '#mapillaryContainer', forwardSelector: '#mapillaryContainer' }
    ];
  }

  init() {
    this.panelDefinitions().forEach(def => {
      const container = document.querySelector(def.selector);
      if (!container) return;
      const forwardTarget = def.forwardSelector ? document.querySelector(def.forwardSelector) : container;
      const panel = new KonvaPanel(def.key, container, this.router, { forwardTarget });
      this.panels.set(def.key, panel);

      container.addEventListener('mousedown', () => {
        if (def.key === 'map-overlay') {
          this.router.setActivePanel('map-overlay');
        } else {
          this.router.setActivePanel(def.key);
        }
      });
    });

    window.addEventListener('resize', () => {
      this.panels.forEach(panel => panel.resize());
    });
  }

  setActivePanel(key) {
    this.activePanel = key;
    this.panels.forEach((panel, panelKey) => {
      panel.setPointerEnabled(key && panelKey === key);
      panel.transformer.nodes([]);
    });
  }

  updatePointerBehavior(tool) {
    this.panels.forEach((panel, panelKey) => {
      const shouldEnable = this.activePanel && panelKey === this.activePanel;
      panel.setPointerEnabled(shouldEnable);
    });
  }

  getPanel(key) {
    return this.panels.get(key);
  }

  recordAdd(panelKey, shape) {
    const panel = this.panels.get(panelKey);
    if (!panel) return;
    this.router.recordAdd(panelKey, shape);
  }

  clearAll() {
    this.panels.forEach(panel => panel.clear());
  }
}

class DrawingRouter {
  constructor(mapInstance) {
    this.map = mapInstance;
    this.state = { ...DRAWING_DEFAULTS };
    this.undoStack = [];
    this.redoStack = [];
    this.konvaManager = new KonvaManager(this);
    this.activePanel = 'map';
    this.geomanLayers = new Set();
  }

  init() {
    this.konvaManager.init();
    this.attachMapHandlers();
    this.setActivePanel('map');
    this.updateToolbarUI();
    this.konvaManager.updatePointerBehavior(this.state.tool);
  }

  attachMapHandlers() {
    if (!this.map || !this.map.pm) return;

    this.map.on('pm:create', (e) => {
      const layer = e.layer;
      this.applyGeomanStyle(layer);
      this.geomanLayers.add(layer);
      this.recordCommand({
        type: 'geoman-add',
        layer,
        undo: () => {
          this.map.removeLayer(layer);
        },
        redo: () => {
          layer.addTo(this.map);
        }
      });
    });
  }

  recordCommand(command) {
    this.undoStack.push(command);
    this.redoStack = [];
  }

  recordAdd(panelKey, shape) {
    const panel = this.konvaManager.getPanel(panelKey);
    if (!panel) return;
    this.recordCommand({
      type: 'add',
      panelKey,
      shape,
      undo: () => {
        panel.removeShape(shape);
      },
      redo: () => {
        panel.addShape(shape);
      }
    });
  }

  recordUpdate(panelKey, shape, before, after) {
    const panel = this.konvaManager.getPanel(panelKey);
    if (!panel) return;
    this.recordCommand({
      type: 'update',
      panelKey,
      shape,
      undo: () => panel.applyShapeState(shape, before),
      redo: () => panel.applyShapeState(shape, after)
    });
  }

  setActivePanel(panelKey) {
    this.activePanel = panelKey;
    if (panelKey === 'map') {
      this.konvaManager.setActivePanel(null);
      this.enableGeomanForCurrentTool();
    } else {
      this.disableGeomanDraw();
      if (panelKey) {
        this.konvaManager.setActivePanel(panelKey);
      }
    }
    this.konvaManager.updatePointerBehavior(this.state.tool);
  }

  enableGeomanForCurrentTool() {
    if (!this.map || !this.map.pm) return;

    if (this.state.tool === 'pan' || this.state.tool === 'note') {
      this.map.pm.disableDraw();
      return;
    }

    const toolMap = {
      rect: 'Rectangle',
      polygon: 'Polygon',
      circle: 'Circle',
      line: 'Line',
      freehand: 'Draw'
    };

    const geomanTool = toolMap[this.state.tool];
    if (!geomanTool) {
      this.map.pm.disableDraw();
      return;
    }

    this.map.pm.disableDraw();
    this.map.pm.setPathOptions(this.geomanOptions());
    this.map.pm.enableDraw(geomanTool, {
      finishOnDoubleClick: geomanTool === 'Polygon',
      snappable: true,
      snapDistance: 20
    });
  }

  applyGeomanStyle(layer) {
    const opts = this.geomanOptions();
    if (layer.setStyle) {
      layer.setStyle({
        color: opts.color,
        weight: opts.weight,
        dashArray: opts.dashArray,
        fillColor: opts.fillColor,
        fillOpacity: opts.fillOpacity
      });
    }
  }

  geomanOptions() {
    const fillOpacity = this.state.filled ? this.state.fillOpacity : 0;
    return {
      color: this.state.color,
      weight: this.state.lineWidth,
      dashArray: this.state.dashed ? [12, 6] : undefined,
      fillColor: this.state.color,
      fillOpacity
    };
  }

  disableGeomanDraw() {
    if (this.map && this.map.pm) {
      this.map.pm.disableDraw();
    }
  }

  selectTool(tool) {
    this.state.tool = tool;
    if (this.activePanel === 'map') {
      this.enableGeomanForCurrentTool();
    }
    this.updateToolbarUI();
    this.konvaManager.updatePointerBehavior(tool);
  }

  selectColor(color) {
    this.state.color = color;
    if (this.activePanel === 'map') {
      this.enableGeomanForCurrentTool();
    }
  }

  toggleDashed() {
    this.state.dashed = !this.state.dashed;
    if (this.activePanel === 'map') {
      this.enableGeomanForCurrentTool();
    }
  }

  toggleFill() {
    this.state.filled = !this.state.filled;
    if (this.activePanel === 'map') {
      this.enableGeomanForCurrentTool();
    }
    this.updateToolbarUI();
  }

  setFillOpacity(value) {
    this.state.fillOpacity = Math.max(0, Math.min(value / 100, 1));
    if (this.activePanel === 'map') {
      this.enableGeomanForCurrentTool();
    }
    const label = document.getElementById('opacityLabel');
    if (label) label.textContent = `${Math.round(this.state.fillOpacity * 100)}%`;
  }

  setLineWidth(width) {
    this.state.lineWidth = width;
    if (this.activePanel === 'map') {
      this.enableGeomanForCurrentTool();
    }
    this.updateToolbarUI();
  }

  updateToolbarUI() {
    const toolButtons = document.querySelectorAll('.tool-btn');
    toolButtons.forEach(btn => {
      if (!btn.dataset.tool) return;
      btn.classList.toggle('active', btn.dataset.tool === this.state.tool);
    });

    const lineButtons = document.querySelectorAll('[data-width]');
    lineButtons.forEach(btn => {
      const width = Number(btn.dataset.width);
      btn.classList.toggle('active', width === this.state.lineWidth);
    });

    const solidToggle = document.getElementById('solidToggle');
    if (solidToggle) {
      solidToggle.textContent = this.state.dashed ? 'Dashed' : 'Solid';
      solidToggle.classList.toggle('active', !this.state.dashed);
    }

    const fillToggle = document.getElementById('fillToggle');
    if (fillToggle) {
      fillToggle.classList.toggle('active', this.state.filled);
    }
  }

  undo() {
    const command = this.undoStack.pop();
    if (!command) return;
    if (typeof command.undo === 'function') {
      command.undo();
    }
    this.redoStack.push(command);
  }

  redo() {
    const command = this.redoStack.pop();
    if (!command) return;
    if (typeof command.redo === 'function') {
      command.redo();
    }
    this.undoStack.push(command);
  }

  clearAllShapes() {
    // Clear Konva overlays
    this.konvaManager.clearAll();
    // Clear map shapes
    if (this.map) {
      [...this.geomanLayers].forEach(layer => {
        this.map.removeLayer(layer);
      });
      this.geomanLayers.clear();
    }
    this.undoStack = [];
    this.redoStack = [];
  }
}

const drawingRouter = new DrawingRouter(typeof map !== 'undefined' ? map : null);
window.drawingRouter = drawingRouter;

document.addEventListener('DOMContentLoaded', () => {
  drawingRouter.init();
  selectTool(DRAWING_DEFAULTS.tool);
  selectColor(DRAWING_DEFAULTS.color);
  updateFillOpacity(DRAWING_DEFAULTS.fillOpacity * 100);
  selectLineWidth(DRAWING_DEFAULTS.lineWidth);
});

/* ========== Toolbar Helpers ========== */

function selectTool(tool) {
  drawingRouter.selectTool(tool);
}

function selectColor(color) {
  drawingRouter.selectColor(color);
  const picker = document.getElementById('colorPicker');
  if (picker) picker.value = color;
}

function toggleLineStyle() {
  drawingRouter.toggleDashed();
  drawingRouter.updateToolbarUI();
}

function toggleFill() {
  drawingRouter.toggleFill();
}

function updateFillOpacity(value) {
  const numeric = Number(value);
  drawingRouter.setFillOpacity(numeric);
  const slider = document.getElementById('opacitySlider');
  if (slider && slider.value !== String(numeric)) {
    slider.value = numeric;
  }
}

function selectLineWidth(width) {
  drawingRouter.setLineWidth(width);
}

function undoLast() {
  if (Array.isArray(stickyNotes) && stickyNotes.length > 0) {
    const lastNote = stickyNotes[stickyNotes.length - 1];
    if (lastNote && typeof deleteStickyNote === 'function') {
      deleteStickyNote(lastNote.id);
      return;
    }
  }
  drawingRouter.undo();
}

function redoLast() {
  drawingRouter.redo();
}

function clearAll() {
  if (Array.isArray(stickyNotes)) {
    const notes = [...stickyNotes];
    notes.forEach(note => {
      if (note && typeof deleteStickyNote === 'function') {
        deleteStickyNote(note.id);
      }
    });
  }
  drawingRouter.clearAllShapes();
}

window.selectTool = selectTool;
window.selectColor = selectColor;
window.toggleLineStyle = toggleLineStyle;
window.toggleFill = toggleFill;
window.updateFillOpacity = updateFillOpacity;
window.selectLineWidth = selectLineWidth;
window.undoLast = undoLast;
window.redoLast = redoLast;
window.clearAll = clearAll;
