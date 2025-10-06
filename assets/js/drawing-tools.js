/* ========== DRAWING INFRASTRUCTURE ==========
 * Provides a unified drawing experience across panels by routing toolbar
 * actions to either Leaflet Geoman (for geographic shapes) or Konva (for
 * pixel-based overlays). The module maintains a global undo/redo stack and
 * harmonises styling across backends.
 */

/* global map, Konva, stickyNotes, L */

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
    this.pointerEnabled = false;
    const overlayZIndex = options.zIndex != null ? options.zIndex : 30;
    this.overlay.style.zIndex = String(overlayZIndex);

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
    this.angleMarkers = new Map();

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

  isMapOverlay() {
    return this.key === 'map-overlay';
  }

  shouldTrackGeo() {
    return this.isMapOverlay() && this.router && this.router.map && typeof this.router.map.latLngToContainerPoint === 'function';
  }

  setPointerEnabled(enabled) {
    this.pointerEnabled = !!enabled;
    if (this.forwarding) return;
    this.overlay.style.pointerEvents = this.pointerEnabled ? 'auto' : 'none';
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
      if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.unregisterKonvaShape === 'function') {
        window.drawingLayerRegistry.unregisterKonvaShape(shape, this.key);
      }
      shape.destroy();
    });
    this.shapes.clear();
    this.angleMarkers.forEach(marker => {
      if (marker.arc) marker.arc.destroy();
      if (marker.label) marker.label.destroy();
    });
    this.angleMarkers.clear();
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
      if (this.shouldTrackGeo()) {
        this.captureGeoReference(shape);
      }
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
        this.updateArrowIntersections(shape);
      };
      shape.on('dragmove transform', update);
      shape.on('pointsChange strokeChange strokeWidthChange', update);
      shape.on('destroy', () => {
        this.cleanupArrowLabel(shape, true);
        this.removeAngleMarkersForShape(shape, true);
      });
    }

    shape.on('destroy', () => {
      if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.unregisterKonvaShape === 'function') {
        window.drawingLayerRegistry.unregisterKonvaShape(shape, this.key);
      }
      if (this.router && typeof this.router.handleShapeDestroyed === 'function') {
        this.router.handleShapeDestroyed(shape);
      }
    });

    this.shapes.add(shape);
  }

  addShape(shape) {
    this.registerShape(shape);
    this.layer.add(shape);
    if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.registerKonvaShape === 'function') {
      window.drawingLayerRegistry.registerKonvaShape(shape, this.key);
    }
    if (this.shouldTrackGeo()) {
      this.restoreGeoReference(shape);
      this.captureGeoReference(shape);
    }
    if (shape.getAttr('shapeType') === 'arrow') {
      const label = this.ensureArrowLabel(shape);
      if (label) {
        label.moveToTop();
        this.updateArrowMeasurement(shape);
      }
      this.updateArrowIntersections(shape);
    }
    this.layer.draw();
  }

  removeShape(shape) {
    this.shapes.delete(shape);
    if (this.transformer.nodes().includes(shape)) {
      this.transformer.nodes([]);
    }
    this.cleanupArrowLabel(shape);
    this.removeAngleMarkersForShape(shape, true);
    if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.unregisterKonvaShape === 'function') {
      window.drawingLayerRegistry.unregisterKonvaShape(shape, this.key);
    }
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
    let result;

    switch (type) {
      case 'rect':
        result = { ...common, x: shape.x(), y: shape.y(), width: shape.width(), height: shape.height() };
        break;
      case 'ellipse':
        result = { ...common, x: shape.x(), y: shape.y(), radiusX: shape.radiusX(), radiusY: shape.radiusY() };
        break;
      case 'circle':
        result = { ...common, x: shape.x(), y: shape.y(), radius: shape.radius() };
        break;
      case 'line':
      case 'arrow':
      case 'polygon':
      case 'freehand':
        result = { ...common, points: [...shape.points()] };
        break;
      case 'text':
        result = { ...common, x: shape.x(), y: shape.y(), text: shape.text(), fontSize: shape.fontSize() };
        break;
      default:
        result = null;
    }

    if (!result) return null;

    if (this.shouldTrackGeo()) {
      result = {
        ...result,
        geoPoints: shape.getAttr('geoPoints') || null,
        geoPoint: shape.getAttr('geoPoint') || null
      };
    }

    return result;
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
    if (this.shouldTrackGeo()) {
      if (state.geoPoints) {
        shape.setAttr('geoPoints', state.geoPoints);
      }
      if (state.geoPoint) {
        shape.setAttr('geoPoint', state.geoPoint);
      }
      this.restoreGeoReference(shape);
      this.captureGeoReference(shape);
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

    if (this.shouldTrackGeo()) {
      this.captureGeoReference(shape);
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
    this.overlay.style.pointerEvents = this.pointerEnabled ? 'auto' : 'none';
  }

  cancelForwarding() {
    if (!this.forwarding) return;
    this.forwarding = false;
    this.overlay.style.pointerEvents = this.pointerEnabled ? 'auto' : 'none';
  }

  clearSelection() {
    this.transformer.nodes([]);
    this.activeShape = null;
    this.layer.batchDraw();
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
    if (this.shouldTrackGeo()) {
      this.captureGeoReference(line);
    }
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
    let endX = pos.x;
    let endY = pos.y;
    if (this.router && typeof this.router.isShiftPressed === 'function' && this.router.isShiftPressed()) {
      const startX = points[0];
      const startY = points[1];
      const dx = pos.x - startX;
      const dy = pos.y - startY;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const snappedDeg = Math.round(angleDeg / 45) * 45; // snap to 45° increments
        const snappedRad = (snappedDeg * Math.PI) / 180;
        endX = startX + Math.cos(snappedRad) * length;
        endY = startY + Math.sin(snappedRad) * length;
      } else {
        endX = startX;
        endY = startY;
      }
    }
    points[2] = endX;
    points[3] = endY;
    line.points(points);
    if (line.getAttr('shapeType') === 'arrow') {
      this.ensureArrowLabel(line);
      this.updateArrowMeasurement(line);
      this.updateArrowIntersections(line);
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

  removeAngleMarkersForShape(shape, destroy = false) {
    if (!shape || !this.angleMarkers.size) return;
    const targetId = shape._id;
    const keysToDelete = [];
    this.angleMarkers.forEach((marker, key) => {
      if (!marker || !key) return;
      const [idA, idB] = key.split('|').map(Number);
      if (idA !== targetId && idB !== targetId) return;
      if (destroy) {
        if (marker.arc) marker.arc.destroy();
        if (marker.label) marker.label.destroy();
        keysToDelete.push(key);
      } else {
        if (marker.arc) marker.arc.visible(false);
        if (marker.label) marker.label.visible(false);
      }
    });
    keysToDelete.forEach(key => this.angleMarkers.delete(key));
  }

  updateArrowIntersections(shape) {
    if (!shape || shape.getAttr('shapeType') !== 'arrow') return;
    const otherArrows = [...this.shapes].filter(other => other !== shape && other.getAttr('shapeType') === 'arrow');
    const processed = new Set();

    otherArrows.forEach(other => {
      const key = this.angleMarkerKey(shape, other);
      processed.add(key);
      const geometry = this.computeArrowIntersectionGeometry(shape, other);
      if (geometry) {
        this.renderAngleMarker(key, shape, other, geometry);
      } else {
        this.hideAngleMarker(key);
      }
    });

    this.angleMarkers.forEach((marker, key) => {
      if (processed.has(key)) return;
      const [idA, idB] = key.split('|').map(Number);
      if (idA === shape._id || idB === shape._id) {
        this.hideAngleMarker(key);
      }
    });

    this.layer.batchDraw();
  }

  angleMarkerKey(a, b) {
    const ids = [a._id, b._id].sort((x, y) => x - y);
    return ids.join('|');
  }

  computeArrowIntersectionGeometry(shapeA, shapeB) {
    const segA = this.getArrowSegment(shapeA);
    const segB = this.getArrowSegment(shapeB);
    if (!segA || !segB) return null;

    const intersection = this.findSegmentIntersection(segA, segB);
    if (!intersection) return null;

    const dirA = this.directionFromIntersection(segA, intersection);
    const dirB = this.directionFromIntersection(segB, intersection);
    if (!dirA || !dirB) return null;

    const dot = dirA.x * dirB.x + dirA.y * dirB.y;
    const angleRad = Math.acos(Math.max(-1, Math.min(1, dot)));
    const angleDeg = angleRad * (180 / Math.PI);
    if (!Number.isFinite(angleDeg) || angleDeg < 0.5) {
      return null;
    }

    const angle1 = this.vectorAngle(dirA);
    const angle2 = this.vectorAngle(dirB);
    let delta = angle2 - angle1;
    delta = ((delta % 360) + 360) % 360;
    let sweep;
    let rotation;
    if (delta <= 180) {
      sweep = delta;
      rotation = angle1;
    } else {
      sweep = 360 - delta;
      rotation = angle2;
    }
    rotation = ((rotation % 360) + 360) % 360;
    const midAngle = rotation + sweep / 2;

    return {
      point: intersection,
      angle: angleDeg,
      rotation,
      sweep,
      midAngle
    };
  }

  getArrowSegment(shape) {
    if (!shape || shape.getAttr('shapeType') !== 'arrow') return null;
    const points = shape.points();
    if (!points || points.length < 4) return null;
    const transform = shape.getAbsoluteTransform().copy();
    const start = transform.point({ x: points[0], y: points[1] });
    const end = transform.point({ x: points[points.length - 2], y: points[points.length - 1] });
    return { start, end };
  }

  directionFromIntersection(segment, intersection) {
    if (!segment || !intersection) return null;
    const toEnd = { x: segment.end.x - intersection.x, y: segment.end.y - intersection.y };
    const toStart = { x: segment.start.x - intersection.x, y: segment.start.y - intersection.y };
    const vec = this.pickLongerVector(toEnd, toStart);
    const len = Math.hypot(vec.x, vec.y);
    if (!len) return null;
    return { x: vec.x / len, y: vec.y / len };
  }

  pickLongerVector(v1, v2) {
    const len1 = Math.hypot(v1.x, v1.y);
    const len2 = Math.hypot(v2.x, v2.y);
    return len1 >= len2 ? v1 : v2;
  }

  findSegmentIntersection(segA, segB) {
    const EPS = 1e-6;
    const { start: a1, end: a2 } = segA;
    const { start: b1, end: b2 } = segB;

    const shared = this.findSharedEndpoint(a1, a2, b1, b2, EPS);
    if (shared) return shared;

    const x1 = a1.x;
    const y1 = a1.y;
    const x2 = a2.x;
    const y2 = a2.y;
    const x3 = b1.x;
    const y3 = b1.y;
    const x4 = b2.x;
    const y4 = b2.y;

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < EPS) {
      return null;
    }

    const pre = x1 * y2 - y1 * x2;
    const post = x3 * y4 - y3 * x4;
    const x = (pre * (x3 - x4) - (x1 - x2) * post) / denom;
    const y = (pre * (y3 - y4) - (y1 - y2) * post) / denom;

    if (!this.pointOnSegment({ x, y }, a1, a2, EPS) || !this.pointOnSegment({ x, y }, b1, b2, EPS)) {
      return null;
    }

    return { x, y };
  }

  findSharedEndpoint(a1, a2, b1, b2, tolerance) {
    const pairs = [
      [a1, b1],
      [a1, b2],
      [a2, b1],
      [a2, b2]
    ];
    for (const [p, q] of pairs) {
      if (this.distance(p, q) <= tolerance) {
        return {
          x: (p.x + q.x) / 2,
          y: (p.y + q.y) / 2
        };
      }
    }
    return null;
  }

  pointOnSegment(point, segStart, segEnd, tolerance) {
    const minX = Math.min(segStart.x, segEnd.x) - tolerance;
    const maxX = Math.max(segStart.x, segEnd.x) + tolerance;
    const minY = Math.min(segStart.y, segEnd.y) - tolerance;
    const maxY = Math.max(segStart.y, segEnd.y) + tolerance;
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY) {
      return false;
    }
    const cross = (segEnd.x - segStart.x) * (point.y - segStart.y) - (segEnd.y - segStart.y) * (point.x - segStart.x);
    return Math.abs(cross) <= tolerance * Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y);
  }

  distance(p, q) {
    return Math.hypot(p.x - q.x, p.y - q.y);
  }

  vectorAngle(vec) {
    return (Math.atan2(vec.y, vec.x) * 180) / Math.PI;
  }

  ensureAngleMarker(key, color) {
    let marker = this.angleMarkers.get(key);
    if (!marker) {
      const arc = new Konva.Arc({
        x: 0,
        y: 0,
        innerRadius: 16,
        outerRadius: 22,
        angle: 0,
        rotation: 0,
        stroke: color,
        strokeWidth: 2,
        listening: false,
        fill: 'rgba(0,0,0,0)',
        name: 'arrow-angle-arc'
      });
      const label = new Konva.Text({
        text: '',
        fontSize: 12,
        fontFamily: 'Inter, Arial, sans-serif',
        fill: color,
        align: 'center',
        listening: false,
        name: 'arrow-angle-label',
        visible: false
      });
      this.layer.add(arc);
      this.layer.add(label);
      marker = { arc, label };
      this.angleMarkers.set(key, marker);
    }
    return marker;
  }

  renderAngleMarker(key, shapeA, _shapeB, geometry) {
    const color = shapeA.stroke() || '#FF4444';
    const marker = this.ensureAngleMarker(key, color);
    const arc = marker.arc;
    const label = marker.label;
    if (!arc || !label) return;

    arc.stroke(color);
    arc.position({ x: geometry.point.x, y: geometry.point.y });
    arc.rotation(geometry.rotation);
    arc.angle(geometry.sweep);
    arc.visible(true);

    const labelRadius = arc.outerRadius() + 12;
    const midRad = (geometry.midAngle * Math.PI) / 180;
    const text = this.formatAngleText(geometry.angle);
    const labelPos = {
      x: geometry.point.x + Math.cos(midRad) * labelRadius,
      y: geometry.point.y + Math.sin(midRad) * labelRadius
    };

    label.text(text);
    label.fill(color);
    label.position(labelPos);
    label.offset({ x: label.width() / 2, y: label.height() / 2 });
    label.visible(true);

    arc.moveToTop();
    label.moveToTop();
  }

  hideAngleMarker(key) {
    const marker = this.angleMarkers.get(key);
    if (!marker) return;
    if (marker.arc) marker.arc.visible(false);
    if (marker.label) marker.label.visible(false);
  }

  formatAngleText(angle) {
    if (!Number.isFinite(angle)) return '';
    const rounded = Math.round(angle * 10) / 10;
    return `${rounded % 1 === 0 ? Math.round(rounded) : rounded.toFixed(1)}°`;
  }

  updateArrowMeasurement(shape) {
    if (!shape || shape.getAttr('shapeType') !== 'arrow') return;
    const label = this.ensureArrowLabel(shape);
    if (!label) return;

    const points = shape.points();
    if (!points || points.length < 4) {
      label.visible(false);
      shape.setAttr('pixelLength', null);
      if (this.router && typeof this.router.handleArrowMeasurementUpdate === 'function') {
        this.router.handleArrowMeasurementUpdate(this.key, shape);
      }
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
      shape.setAttr('pixelLength', null);
      if (this.router && typeof this.router.handleArrowMeasurementUpdate === 'function') {
        this.router.handleArrowMeasurementUpdate(this.key, shape);
      }
      return;
    }

    shape.setAttr('pixelLength', length);

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

    if (this.router && typeof this.router.handleArrowMeasurementUpdate === 'function') {
      this.router.handleArrowMeasurementUpdate(this.key, shape);
    }
  }

  captureGeoReference(shape) {
    if (!this.shouldTrackGeo() || !shape) return;
    const map = this.router.map;
    if (!map || !map.containerPointToLatLng || typeof L === 'undefined' || typeof L.point !== 'function') return;

    const type = shape.getAttr('shapeType');

    if (['line', 'arrow', 'polygon', 'freehand'].includes(type)) {
      const points = shape.points();
      if (!points || points.length < 2) return;
      const transform = shape.getAbsoluteTransform().copy();
      const geoPoints = [];
      for (let i = 0; i < points.length; i += 2) {
        const abs = transform.point({ x: points[i], y: points[i + 1] });
        const latLng = map.containerPointToLatLng(L.point(abs.x, abs.y));
        geoPoints.push([latLng.lat, latLng.lng]);
      }
      shape.setAttr('geoPoints', geoPoints);
    } else if (type === 'text') {
      const pos = shape.getAbsolutePosition();
      const latLng = map.containerPointToLatLng(L.point(pos.x, pos.y));
      shape.setAttr('geoPoint', [latLng.lat, latLng.lng]);
    }
  }

  restoreGeoReference(shape) {
    if (!this.shouldTrackGeo() || !shape) return;
    const map = this.router.map;
    if (!map || !map.latLngToContainerPoint || typeof L === 'undefined' || typeof L.point !== 'function') return;

    const type = shape.getAttr('shapeType');
    if (['line', 'arrow', 'polygon', 'freehand'].includes(type)) {
      const geoPoints = shape.getAttr('geoPoints');
      if (!Array.isArray(geoPoints) || geoPoints.length < 1) return;
      const flat = [];
      geoPoints.forEach(([lat, lng]) => {
        const point = map.latLngToContainerPoint([lat, lng]);
        flat.push(point.x, point.y);
      });
      shape.position({ x: 0, y: 0 });
      shape.points(flat);
      if (type === 'arrow') {
        this.ensureArrowLabel(shape);
        this.updateArrowMeasurement(shape);
        this.updateArrowIntersections(shape);
      }
    } else if (type === 'text') {
      const geoPoint = shape.getAttr('geoPoint');
      if (!geoPoint) return;
      const point = map.latLngToContainerPoint(geoPoint);
      shape.position({ x: point.x, y: point.y });
    }
  }

  syncWithMap() {
    if (!this.shouldTrackGeo()) return;
    this.shapes.forEach(shape => {
      this.restoreGeoReference(shape);
    });
    this.layer.batchDraw();
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
      { key: 'map-overlay', selector: '#map', forwardSelector: '#mapCanvas', zIndex: 1600 },
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
      const panel = new KonvaPanel(def.key, container, this.router, {
        forwardTarget,
        zIndex: def.zIndex
      });
      this.panels.set(def.key, panel);

      const focusHandler = () => {
        if (def.key === 'map-overlay') {
          this.router.focusMapPanel();
        } else {
          this.router.setActivePanel(def.key);
        }
      };

      container.addEventListener('pointerdown', focusHandler);
    });

    window.addEventListener('resize', () => {
      this.panels.forEach(panel => panel.resize());
    });
  }

  setActivePanel(key) {
    this.activePanel = key;
    this.panels.forEach((panel, panelKey) => {
      panel.setPointerEnabled(key && panelKey === key);
      panel.clearSelection();
    });
  }

  updatePointerBehavior(tool) {
    this.panels.forEach((panel, panelKey) => {
      let shouldEnable = this.activePanel && panelKey === this.activePanel;
      if (panelKey === 'map-overlay' && this.router && this.router.usesGeoman(tool)) {
        shouldEnable = false;
      }
      panel.setPointerEnabled(shouldEnable);
    });
  }

  cancelForwarding() {
    this.panels.forEach(panel => panel.cancelForwarding());
  }

  clearSelections() {
    this.panels.forEach(panel => panel.clearSelection());
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
    this.modifiers = { shift: false };
    this.sunMeasurement = {
      panelKey: null,
      height: null,
      shadow: null,
      ground: null,
      lastAngle: null,
      lastComputation: null,
      warnings: []
    };
  }

  init() {
    this.konvaManager.init();
    this.attachMapHandlers();
    this.setupKeyboardHandlers();
    this.setActivePanel('map');
    this.updateToolbarUI();
    this.konvaManager.updatePointerBehavior(this.state.tool);
    this.updateSunMeasurementUI();
  }

  attachMapHandlers() {
    if (!this.map || !this.map.pm) return;

    this.map.on('pm:create', (e) => {
      const layer = e.layer;
      this.applyGeomanStyle(layer);
      this.geomanLayers.add(layer);
      if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.registerLeafletLayer === 'function') {
        window.drawingLayerRegistry.registerLeafletLayer(layer);
      }
      this.recordCommand({
        type: 'geoman-add',
        layer,
        undo: () => {
          if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.unregisterLeafletLayer === 'function') {
            window.drawingLayerRegistry.unregisterLeafletLayer(layer);
          }
          this.geomanLayers.delete(layer);
          this.map.removeLayer(layer);
        },
        redo: () => {
          layer.addTo(this.map);
          this.geomanLayers.add(layer);
          if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.registerLeafletLayer === 'function') {
            window.drawingLayerRegistry.registerLeafletLayer(layer);
          }
        }
      });
    });

    const syncOverlay = () => {
      const panel = this.konvaManager.getPanel('map-overlay');
      if (panel) {
        panel.syncWithMap();
      }
    };

    ['move', 'moveend', 'zoom', 'zoomend', 'zoomanim', 'rotate', 'resize'].forEach(evtName => {
      this.map.on(evtName, syncOverlay);
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
    if (panelKey === 'map-overlay' && this.usesGeoman()) {
      panelKey = 'map';
    }

    if (panelKey === this.activePanel) {
      if (panelKey === 'map') {
        this.enableGeomanForCurrentTool();
      }
      this.konvaManager.updatePointerBehavior(this.state.tool);
      return;
    }

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

  usesGeoman(tool = this.state.tool) {
    return ['rect', 'polygon', 'circle', 'line'].includes(tool);
  }

  setupKeyboardHandlers() {
    if (this._keyboardHandlersAttached) return;
    this._keyboardHandlersAttached = true;

    const updateShift = (value) => {
      this.modifiers.shift = value;
    };

    window.addEventListener('keydown', (evt) => {
      if (evt.key === 'Shift') {
        updateShift(true);
      }
    });

    window.addEventListener('keyup', (evt) => {
      if (evt.key === 'Shift') {
        updateShift(false);
      }
    });

    window.addEventListener('blur', () => updateShift(false));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        updateShift(false);
      }
    });
  }

  isShiftPressed() {
    return !!this.modifiers.shift;
  }

  desiredMapPanel(tool = this.state.tool) {
    return this.usesGeoman(tool) ? 'map' : 'map-overlay';
  }

  focusMapPanel() {
    const desired = this.desiredMapPanel();
    if (this.activePanel === desired) return;
    this.setActivePanel(desired);
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
      line: 'Line'
    };

    const geomanTool = toolMap[this.state.tool];
    if (!geomanTool) {
      this.map.pm.disableDraw();
      return;
    }

    if (!this.ensureGeomanDrawHandler(geomanTool)) {
      console.warn(`Geoman draw handler for ${geomanTool} is unavailable.`);
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

  ensureGeomanDrawHandler(tool) {
    if (!this.map || !this.map.pm) return false;
    if (this.map.pm.Draw && this.map.pm.Draw[tool]) return true;
    if (!window.L || !L.PM || !L.PM.Draw || !L.PM.Draw[tool]) {
      return false;
    }
    this.map.pm.Draw = this.map.pm.Draw || {};
    this.map.pm.Draw[tool] = new L.PM.Draw[tool](this.map);
    return !!this.map.pm.Draw[tool];
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
    this.konvaManager.cancelForwarding();
    if (tool !== 'pan') {
      this.konvaManager.clearSelections();
      if (typeof window.deselectImageLayer === 'function') {
        try {
          window.deselectImageLayer();
        } catch (err) {
          console.warn('Failed to deselect image layer', err);
        }
      }
    }
    if (this.activePanel === 'map' || this.activePanel === 'map-overlay') {
      const desiredPanel = this.desiredMapPanel(tool);
      if (desiredPanel !== this.activePanel) {
        this.setActivePanel(desiredPanel);
      } else if (desiredPanel === 'map') {
        this.enableGeomanForCurrentTool();
      }
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

  setSunMeasurementRole(role) {
    if (!['height', 'shadow'].includes(role)) return;
    const panelKey = this.konvaManager.activePanel;
    const panel = panelKey ? this.konvaManager.getPanel(panelKey) : null;
    if (!panel || !panel.activeShape) {
      this.sunMeasurement.warnings = [`Select an arrow and try assigning it as the ${role}.`];
      this.updateSunMeasurementUI();
      return;
    }

    const shape = panel.activeShape;
    if (!shape || shape.getAttr('shapeType') !== 'arrow') {
      this.sunMeasurement.warnings = ['Only arrow measurements can be marked as height or shadow.'];
      this.updateSunMeasurementUI();
      return;
    }

    if (this.sunMeasurement.panelKey && this.sunMeasurement.panelKey !== panelKey) {
      this.clearSunMeasurements({ silent: true });
    }

    this.sunMeasurement.panelKey = panelKey;
    this.assignSunRole(role, shape, panelKey);
    this.sunMeasurement.warnings = [];
    this.calculateSunElevation({ auto: true });
  }

  setSunGroundPlane() {
    const panelKey = this.konvaManager.activePanel;
    const panel = panelKey ? this.konvaManager.getPanel(panelKey) : null;
    if (!panel || !panel.activeShape) {
      this.sunMeasurement.warnings = ['Select a polygon that represents the ground plane before assigning it.'];
      this.updateSunMeasurementUI();
      return;
    }

    const shape = panel.activeShape;
    const type = shape.getAttr('shapeType');
    if (!['polygon', 'freehand', 'line'].includes(type)) {
      this.sunMeasurement.warnings = ['Ground plane correction requires a four-corner polygon.'];
      this.updateSunMeasurementUI();
      return;
    }

    const points = this.extractPolygonPoints(shape);
    if (!points || points.length < 4) {
      this.sunMeasurement.warnings = ['Ground plane polygon needs at least four distinct corners.'];
      this.updateSunMeasurementUI();
      return;
    }

    if (this.sunMeasurement.panelKey && this.sunMeasurement.panelKey !== panelKey) {
      this.clearSunMeasurements({ silent: true });
    }

    this.sunMeasurement.panelKey = panelKey;
    this.assignSunRole('ground', shape, panelKey);
    this.sunMeasurement.warnings = [];
    this.calculateSunElevation({ auto: true });
  }

  assignSunRole(role, shape, panelKey) {
    const existing = this.sunMeasurement[role];
    if (existing && existing.shape && !isShapeDestroyed(existing.shape)) {
      if (existing.destroyHandler) {
        existing.shape.off('destroy', existing.destroyHandler);
      }
      if (Array.isArray(existing.listeners)) {
        existing.listeners.forEach(({ events, handler }) => {
          existing.shape.off(events, handler);
        });
      }
    }

    const entry = { shape, panelKey, listeners: [] };
    const destroyHandler = () => {
      if (this.sunMeasurement[role] && this.sunMeasurement[role].shape === shape) {
        this.clearSunRole(role, { silent: true });
        this.calculateSunElevation({ auto: true });
      }
    };
    shape.on('destroy', destroyHandler);
    entry.destroyHandler = destroyHandler;

    if (role === 'ground') {
      const updateHandler = () => this.calculateSunElevation({ auto: true });
      const events = 'dragmove transform pointsChange';
      shape.on(events, updateHandler);
      entry.listeners.push({ events, handler: updateHandler });
    }

    shape.setAttr('sunAssignmentRole', role);
    this.sunMeasurement[role] = entry;
  }

  clearSunRole(role, options = {}) {
    const { silent = false } = options;
    const entry = this.sunMeasurement[role];
    if (!entry) return;
    const { shape, destroyHandler, listeners } = entry;
    if (shape && destroyHandler) {
      shape.off('destroy', destroyHandler);
    }
    if (shape && Array.isArray(listeners)) {
      listeners.forEach(({ events, handler }) => shape.off(events, handler));
    }
    if (shape && shape.getAttr && shape.getAttr('sunAssignmentRole') === role) {
      shape.setAttr('sunAssignmentRole', null);
    }
    this.sunMeasurement[role] = null;

    if (!this.sunMeasurement.height && !this.sunMeasurement.shadow && !this.sunMeasurement.ground) {
      this.sunMeasurement.panelKey = null;
    }

    if (!silent) {
      this.calculateSunElevation({ auto: true });
    }
  }

  clearSunMeasurements(options = {}) {
    const { silent = false } = options;
    this.clearSunRole('height', { silent: true });
    this.clearSunRole('shadow', { silent: true });
    this.clearSunRole('ground', { silent: true });
    this.sunMeasurement.panelKey = null;
    this.sunMeasurement.lastAngle = null;
    this.sunMeasurement.lastComputation = null;
    this.sunMeasurement.warnings = [];
    if (!silent) {
      this.updateSunMeasurementUI();
    }
  }

  handleArrowMeasurementUpdate(panelKey, shape) {
    const { height, shadow } = this.sunMeasurement;
    const matchesHeight = height && height.shape === shape;
    const matchesShadow = shadow && shadow.shape === shape;
    if (!matchesHeight && !matchesShadow) return;
    if (this.sunMeasurement.panelKey && panelKey && this.sunMeasurement.panelKey !== panelKey) return;
    if (!this.sunMeasurement.panelKey) {
      this.sunMeasurement.panelKey = panelKey;
    }
    this.calculateSunElevation({ auto: true });
  }

  handleShapeDestroyed(shape) {
    if (!shape) return;
    let affected = false;
    ['height', 'shadow', 'ground'].forEach(role => {
      const entry = this.sunMeasurement[role];
      if (entry && entry.shape === shape) {
        this.clearSunRole(role, { silent: true });
        affected = true;
      }
    });
    if (affected) {
      this.sunMeasurement.lastAngle = null;
      this.sunMeasurement.lastComputation = null;
      this.sunMeasurement.warnings = [];
      this.updateSunMeasurementUI();
    }
  }

  calculateSunElevation(options = {}) {
    const { auto = false } = options;
    const heightEntry = this.sunMeasurement.height;
    const shadowEntry = this.sunMeasurement.shadow;
    const warnings = [];

    if (!heightEntry || !heightEntry.shape || isShapeDestroyed(heightEntry.shape)) {
      if (!auto) warnings.push('Assign a height arrow before computing the sun elevation.');
      this.sunMeasurement.lastAngle = null;
      this.sunMeasurement.lastComputation = null;
      this.sunMeasurement.warnings = warnings;
      this.updateSunMeasurementUI();
      return null;
    }

    if (!shadowEntry || !shadowEntry.shape || isShapeDestroyed(shadowEntry.shape)) {
      if (!auto) warnings.push('Assign a shadow arrow before computing the sun elevation.');
      this.sunMeasurement.lastAngle = null;
      this.sunMeasurement.lastComputation = null;
      this.sunMeasurement.warnings = warnings;
      this.updateSunMeasurementUI();
      return null;
    }

    const heightShape = heightEntry.shape;
    const shadowShape = shadowEntry.shape;
    const heightLength = this.getArrowLength(heightShape);
    const shadowLength = this.getArrowLength(shadowShape);

    if (!heightLength || !Number.isFinite(heightLength)) {
      warnings.push('Height arrow has no measurable length. Adjust the arrow points.');
    }
    if (!shadowLength || !Number.isFinite(shadowLength)) {
      warnings.push('Shadow arrow has no measurable length. Adjust the arrow points.');
    }

    if (warnings.length && !auto) {
      this.sunMeasurement.lastAngle = null;
      this.sunMeasurement.lastComputation = null;
      this.sunMeasurement.warnings = warnings;
      this.updateSunMeasurementUI();
      return null;
    }

    let correctedShadow = shadowLength;
    let perspectiveApplied = false;
    let scaleFactor = 1;
    const groundEntry = this.sunMeasurement.ground;
    if (groundEntry && groundEntry.shape && !isShapeDestroyed(groundEntry.shape)) {
      const matrix = this.computeGroundHomography();
      const endpoints = this.getArrowEndpoints(shadowShape);
      if (matrix && endpoints) {
        const startWarped = applyHomography(matrix, endpoints.start);
        const endWarped = applyHomography(matrix, endpoints.end);
        if (startWarped && endWarped) {
          const warpedLength = distanceBetweenPoints(startWarped, endWarped);
          if (warpedLength && Number.isFinite(warpedLength)) {
            correctedShadow = warpedLength;
            perspectiveApplied = true;
            if (shadowLength && Number.isFinite(shadowLength) && shadowLength > 0) {
              scaleFactor = warpedLength / shadowLength;
            }
          } else if (!auto) {
            warnings.push('Perspective correction failed for the selected shadow arrow.');
          }
        } else if (!auto) {
          warnings.push('Ground plane homography produced invalid coordinates.');
        }
      } else if (!auto) {
        warnings.push('Ground plane polygon must contain four distinct corners for perspective correction.');
      }
    }

    const heightInput = document.getElementById('sunActualHeight');
    const overrideHeight = heightInput ? Number.parseFloat(heightInput.value) : NaN;
    let usedHeight = heightLength;
    let heightSource = 'pixel';
    if (Number.isFinite(overrideHeight) && overrideHeight > 0) {
      usedHeight = overrideHeight;
      heightSource = 'actual';
    } else if (perspectiveApplied && Number.isFinite(scaleFactor) && scaleFactor > 0 && heightLength) {
      usedHeight = heightLength * scaleFactor;
      heightSource = 'scaled-pixel';
    }

    if (!usedHeight || !Number.isFinite(usedHeight) || usedHeight <= 0) {
      if (!auto) warnings.push('Unable to determine a valid object height for the calculation.');
      this.sunMeasurement.lastAngle = null;
      this.sunMeasurement.lastComputation = null;
      this.sunMeasurement.warnings = warnings;
      this.updateSunMeasurementUI();
      return null;
    }

    if (!correctedShadow || !Number.isFinite(correctedShadow) || correctedShadow <= 0) {
      if (!auto) warnings.push('Unable to determine a valid shadow length for the calculation.');
      this.sunMeasurement.lastAngle = null;
      this.sunMeasurement.lastComputation = null;
      this.sunMeasurement.warnings = warnings;
      this.updateSunMeasurementUI();
      return null;
    }

    const angle = Math.atan(usedHeight / correctedShadow) * (180 / Math.PI);
    this.sunMeasurement.lastAngle = angle;
    this.sunMeasurement.lastComputation = {
      height: usedHeight,
      heightPixels: heightLength,
      heightSource,
      shadow: correctedShadow,
      shadowPixels: shadowLength,
      perspectiveApplied,
      scaleFactor
    };
    this.sunMeasurement.warnings = warnings;
    this.updateSunMeasurementUI();
    return angle;
  }

  updateSunMeasurementUI() {
    const angleEl = document.getElementById('sunAngleValue');
    if (angleEl) {
      const angle = this.sunMeasurement.lastAngle;
      if (Number.isFinite(angle)) {
        angleEl.textContent = `${Math.round(angle * 10) / 10}°`;
      } else {
        angleEl.textContent = '—';
      }
    }

    const heightEl = document.getElementById('sunHeightAssignment');
    if (heightEl) {
      const entry = this.sunMeasurement.height;
      const computation = this.sunMeasurement.lastComputation;
      if (entry && entry.shape && !isShapeDestroyed(entry.shape)) {
        const length = this.getArrowLength(entry.shape);
        const id = entry.shape._id;
        const detailParts = [];
        const pixelText = formatNumber(length);
        if (pixelText !== '—') {
          detailParts.push(`${pixelText} px`);
        }
        if (computation) {
          if (computation.heightSource === 'actual') {
            const overrideText = formatNumber(computation.height);
            if (overrideText !== '—') {
              detailParts.push(`override ${overrideText}`);
            }
          } else if (computation.heightSource === 'scaled-pixel') {
            const scaledText = formatNumber(computation.height);
            if (scaledText !== '—' && scaledText !== pixelText) {
              detailParts.push(`scaled ${scaledText}`);
            }
          }
        }
        const details = detailParts.length ? detailParts.join(' · ') : '—';
        heightEl.textContent = `Height arrow #${id}: ${details}`;
      } else {
        heightEl.textContent = 'Height arrow: —';
      }
    }

    const shadowEl = document.getElementById('sunShadowAssignment');
    if (shadowEl) {
      const entry = this.sunMeasurement.shadow;
      const computation = this.sunMeasurement.lastComputation;
      if (entry && entry.shape && !isShapeDestroyed(entry.shape)) {
        const length = this.getArrowLength(entry.shape);
        const id = entry.shape._id;
        const detailParts = [];
        const pixelText = formatNumber(length);
        if (pixelText !== '—') {
          detailParts.push(`${pixelText} px`);
        }
        if (computation && Number.isFinite(computation.shadow)) {
          const correctedText = formatNumber(computation.shadow);
          if (computation.perspectiveApplied && correctedText !== '—' && correctedText !== pixelText) {
            detailParts.push(`corrected ${correctedText}`);
          }
        }
        const details = detailParts.length ? detailParts.join(' · ') : '—';
        shadowEl.textContent = `Shadow arrow #${id}: ${details}`;
      } else {
        shadowEl.textContent = 'Shadow arrow: —';
      }
    }

    const perspectiveEl = document.getElementById('sunPerspectiveStatus');
    if (perspectiveEl) {
      const groundEntry = this.sunMeasurement.ground;
      const comp = this.sunMeasurement.lastComputation;
      if (groundEntry && groundEntry.shape && !isShapeDestroyed(groundEntry.shape)) {
        const applied = comp && comp.perspectiveApplied;
        perspectiveEl.textContent = applied ? 'Perspective correction: On' : 'Perspective correction: Assigned (waiting for valid homography)';
      } else {
        perspectiveEl.textContent = 'Perspective correction: Off';
      }
    }

    const warningEl = document.getElementById('sunWarnings');
    if (warningEl) {
      const warnings = this.sunMeasurement.warnings || [];
      if (warnings.length) {
        warningEl.innerHTML = warnings.map(text => `<li>${escapeHtml(text)}</li>`).join('');
        warningEl.parentElement?.classList.add('sun-tools-warnings--visible');
      } else {
        warningEl.innerHTML = '';
        warningEl.parentElement?.classList.remove('sun-tools-warnings--visible');
      }
    }
  }

  getArrowLength(shape) {
    if (!shape || typeof shape.points !== 'function') return null;
    const attrLength = Number(shape.getAttr('pixelLength'));
    if (attrLength && Number.isFinite(attrLength)) {
      return attrLength;
    }
    const endpoints = this.getArrowEndpoints(shape);
    if (!endpoints) return null;
    return distanceBetweenPoints(endpoints.start, endpoints.end);
  }

  getArrowEndpoints(shape) {
    if (!shape || typeof shape.points !== 'function' || typeof shape.getAbsoluteTransform !== 'function') return null;
    const points = shape.points();
    if (!Array.isArray(points) || points.length < 4) return null;
    const transform = shape.getAbsoluteTransform().copy();
    const start = transform.point({ x: points[0], y: points[1] });
    const end = transform.point({ x: points[points.length - 2], y: points[points.length - 1] });
    return { start, end };
  }

  extractPolygonPoints(shape) {
    if (!shape || typeof shape.points !== 'function' || typeof shape.getAbsoluteTransform !== 'function') return null;
    const points = shape.points();
    if (!Array.isArray(points) || points.length < 8) return null;
    const transform = shape.getAbsoluteTransform().copy();
    const absolute = [];
    for (let i = 0; i < points.length; i += 2) {
      const point = transform.point({ x: points[i], y: points[i + 1] });
      if (absolute.length) {
        const prev = absolute[absolute.length - 1];
        if (distanceBetweenPoints(prev, point) < 1e-3) {
          continue;
        }
      }
      if (absolute.length >= 3) {
        const first = absolute[0];
        if (distanceBetweenPoints(first, point) < 1e-3) {
          continue;
        }
      }
      absolute.push(point);
      if (absolute.length === 4) break;
    }
    return absolute.length >= 4 ? absolute.slice(0, 4) : null;
  }

  computeGroundHomography() {
    const groundEntry = this.sunMeasurement.ground;
    if (!groundEntry || !groundEntry.shape || isShapeDestroyed(groundEntry.shape)) return null;
    const points = this.extractPolygonPoints(groundEntry.shape);
    if (!points || points.length < 4) return null;
    const destination = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ];
    return computeHomographyMatrix(points, destination);
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
        if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.unregisterLeafletLayer === 'function') {
          window.drawingLayerRegistry.unregisterLeafletLayer(layer);
        }
      });
      this.geomanLayers.clear();
    }
    if (window.drawingLayerRegistry && typeof window.drawingLayerRegistry.clearAll === 'function') {
      window.drawingLayerRegistry.clearAll();
    }
    this.undoStack = [];
    this.redoStack = [];
  }
}

function isShapeDestroyed(shape) {
  return Boolean(shape && typeof shape.isDestroyed === 'function' && shape.isDestroyed());
}

function distanceBetweenPoints(a, b) {
  if (!a || !b) return null;
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.round(rounded)) : rounded.toFixed(1);
}

function escapeHtml(input) {
  if (input == null) return '';
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function computeHomographyMatrix(srcPoints, dstPoints) {
  if (!Array.isArray(srcPoints) || !Array.isArray(dstPoints) || srcPoints.length < 4 || dstPoints.length < 4) return null;
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i += 1) {
    const src = srcPoints[i];
    const dst = dstPoints[i];
    if (!src || !dst) return null;
    const { x, y } = src;
    const { x: X, y: Y } = dst;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(X) || !Number.isFinite(Y)) return null;
    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    b.push(Y);
  }
  const solution = solveLinearSystem(A, b);
  if (!solution) return null;
  const [h11, h12, h13, h21, h22, h23, h31, h32] = solution;
  return [
    [h11, h12, h13],
    [h21, h22, h23],
    [h31, h32, 1]
  ];
}

function solveLinearSystem(matrix, values) {
  if (!Array.isArray(matrix) || !Array.isArray(values)) return null;
  const n = matrix.length;
  if (!n || values.length !== n) return null;
  const m = matrix[0].length;
  const augmented = matrix.map((row, idx) => {
    if (!Array.isArray(row) || row.length !== m) return null;
    return [...row, values[idx]];
  });
  if (augmented.some(row => row == null)) return null;

  for (let col = 0; col < m; col += 1) {
    let pivot = col;
    let max = Math.abs(augmented[pivot][col]);
    for (let row = col + 1; row < n; row += 1) {
      const val = Math.abs(augmented[row][col]);
      if (val > max) {
        pivot = row;
        max = val;
      }
    }
    if (max < 1e-12) {
      return null;
    }
    if (pivot !== col) {
      [augmented[pivot], augmented[col]] = [augmented[col], augmented[pivot]];
    }
    const pivotVal = augmented[col][col];
    for (let j = col; j <= m; j += 1) {
      augmented[col][j] /= pivotVal;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      if (!factor) continue;
      for (let j = col; j <= m; j += 1) {
        augmented[row][j] -= factor * augmented[col][j];
      }
    }
  }

  const result = [];
  for (let i = 0; i < m; i += 1) {
    result.push(augmented[i][m]);
  }
  return result;
}

function applyHomography(matrix, point) {
  if (!matrix || !point) return null;
  const [[h11, h12, h13], [h21, h22, h23], [h31, h32, h33]] = matrix;
  const { x, y } = point;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const denom = h31 * x + h32 * y + h33;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-12) return null;
  const X = (h11 * x + h12 * y + h13) / denom;
  const Y = (h21 * x + h22 * y + h23) / denom;
  if (!Number.isFinite(X) || !Number.isFinite(Y)) return null;
  return { x: X, y: Y };
}

const drawingRouter = new DrawingRouter(typeof map !== 'undefined' ? map : null);
window.drawingRouter = drawingRouter;

document.addEventListener('DOMContentLoaded', () => {
  drawingRouter.init();
  selectTool(DRAWING_DEFAULTS.tool);
  selectColor(DRAWING_DEFAULTS.color);
  updateFillOpacity(DRAWING_DEFAULTS.fillOpacity * 100);
  selectLineWidth(DRAWING_DEFAULTS.lineWidth);
  resizeMapCanvas();

  const actualHeightInput = document.getElementById('sunActualHeight');
  if (actualHeightInput) {
    actualHeightInput.addEventListener('input', () => {
      drawingRouter.calculateSunElevation({ auto: true });
    });
  }
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

function toggleSunToolsPanel(forceState) {
  const panel = document.getElementById('sunToolsPanel');
  const toggle = document.getElementById('sunToolsToggle');
  if (!panel) return;
  let open;
  if (typeof forceState === 'boolean') {
    open = forceState;
  } else {
    open = !panel.classList.contains('open');
  }
  panel.classList.toggle('open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  if (open) {
    drawingRouter.updateSunMeasurementUI();
  }
}

function setSunMeasurementRole(role) {
  drawingRouter.setSunMeasurementRole(role);
}

function setSunGroundPlane() {
  drawingRouter.setSunGroundPlane();
}

function clearSunMeasurements() {
  drawingRouter.clearSunMeasurements();
}

function calculateSunElevation() {
  drawingRouter.calculateSunElevation({ auto: false });
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

function resizeMapCanvas() {
  const mapElement = document.getElementById('map');
  const canvas = document.getElementById('mapCanvas');
  if (!mapElement || !canvas) return;

  const width = mapElement.clientWidth;
  const height = mapElement.clientHeight;
  if (!width || !height) return;

  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  if (window.drawingRouter && drawingRouter.konvaManager) {
    const panel = drawingRouter.konvaManager.getPanel('map-overlay');
    if (panel && typeof panel.resize === 'function') {
      panel.resize();
      if (typeof panel.syncWithMap === 'function') {
        panel.syncWithMap();
      }
    }
  }
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
window.resizeMapCanvas = resizeMapCanvas;
window.toggleSunToolsPanel = toggleSunToolsPanel;
window.setSunMeasurementRole = setSunMeasurementRole;
window.setSunGroundPlane = setSunGroundPlane;
window.clearSunMeasurements = clearSunMeasurements;
window.calculateSunElevation = calculateSunElevation;
