/* ========== ANGLES MODE FUNCTIONALITY ========== */
let anglesAOILayer = null;
let anglesAOIWasVisible = false;
let anglesAllRoadsWasVisible = true;
let anglesSegmentsWasVisible = true;
let anglesIntersectionsWasVisible = true;

// AbortController for canceling in-flight requests
let anglesAbortController = null;
const anglesAllRoadsLayer = L.geoJSON(null, {
  style: { weight: 1, opacity: 0.5, color: '#888' }
}).addTo(map);

const anglesSegmentsLayer = L.geoJSON(null, {
  style: { weight: 3, color: '#9D2235', opacity: 0.8 }
}).addTo(map);

const anglesIntersectionsLayer = L.geoJSON(null, {
  pointToLayer: (f, latlng) => L.circleMarker(latlng, { 
    radius: 5, 
    weight: 1, 
    color: '#0066CC',
    fillColor: '#0066CC',
    fillOpacity: 0.7
  }),
  onEachFeature: (f, layer) => {
    const angle = f.properties?.angle?.toFixed(1);
    layer.bindPopup(`<div class="popup-title">Intersection Angle</div><div style="font-size:1.2rem;font-weight:700;color:#9D2235;text-align:center;margin-top:.5rem">${angle}°</div>`);
  }
}).addTo(map);

// Clear angles layers when needed
function clearAnglesLayers() {
  anglesAllRoadsLayer.clearLayers();
  anglesSegmentsLayer.clearLayers();
  anglesIntersectionsLayer.clearLayers();
  if (anglesAOILayer) {
    map.removeLayer(anglesAOILayer);
    anglesAOILayer = null;
  }
  anglesAOIWasVisible = false;
}

function detachAnglesMode() {
  // Cancel any in-flight requests
  if (anglesAbortController) {
    anglesAbortController.abort();
    anglesAbortController = null;
  }

  anglesAllRoadsWasVisible = map.hasLayer(anglesAllRoadsLayer);
  anglesSegmentsWasVisible = map.hasLayer(anglesSegmentsLayer);
  anglesIntersectionsWasVisible = map.hasLayer(anglesIntersectionsLayer);

  if (anglesAllRoadsWasVisible) {
    map.removeLayer(anglesAllRoadsLayer);
  }
  if (anglesSegmentsWasVisible) {
    map.removeLayer(anglesSegmentsLayer);
  }
  if (anglesIntersectionsWasVisible) {
    map.removeLayer(anglesIntersectionsLayer);
  }

  anglesAOIWasVisible = !!(anglesAOILayer && map.hasLayer(anglesAOILayer));
  if (anglesAOIWasVisible) {
    map.removeLayer(anglesAOILayer);
  }
}

function restoreAnglesMode() {
  if (anglesAllRoadsWasVisible && !map.hasLayer(anglesAllRoadsLayer)) {
    anglesAllRoadsLayer.addTo(map);
  }
  if (anglesSegmentsWasVisible && !map.hasLayer(anglesSegmentsLayer)) {
    anglesSegmentsLayer.addTo(map);
  }
  if (anglesIntersectionsWasVisible && !map.hasLayer(anglesIntersectionsLayer)) {
    anglesIntersectionsLayer.addTo(map);
  }

  if (anglesAOIWasVisible && anglesAOILayer && !map.hasLayer(anglesAOILayer)) {
    anglesAOILayer.addTo(map);
  }

  anglesAllRoadsWasVisible = map.hasLayer(anglesAllRoadsLayer);
  anglesSegmentsWasVisible = map.hasLayer(anglesSegmentsLayer);
  anglesIntersectionsWasVisible = map.hasLayer(anglesIntersectionsLayer);
  anglesAOIWasVisible = false;
}

// Event handlers (will be registered in init)
const pmCreateHandler = (e => {
  if (mapMode === 'angles') {
    if (anglesAOILayer) map.removeLayer(anglesAOILayer);
    anglesAOILayer = e.layer.addTo(map);
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = 'Area selected - adjust settings and click Fetch';
    }
  }
});

const pmRemoveHandler = (e => {
  // FIX: Check if we're in angles mode to prevent clearing angles data in other modes
  if (mapMode === 'angles' && e.layer === anglesAOILayer) {
    anglesAOILayer = null;
    clearAnglesLayers();
  }
});

function updateAngleMode() {
  const modeEl = document.querySelector('input[name="angleMode"]:checked');
  const maxAllowed = modeEl && modeEl.value === '180' ? 180 : 90;
  const rangeHint = document.getElementById('rangeHint');
  const minAngle = document.getElementById('minAngle');
  const maxAngle = document.getElementById('maxAngle');
  
  if (rangeHint) {
    rangeHint.textContent = `Allowed: 0—${maxAllowed}°`;
  }
  
  if (minAngle && +minAngle.value > maxAllowed) {
    minAngle.value = maxAllowed;
  }
  if (maxAngle && +maxAngle.value > maxAllowed) {
    maxAngle.value = maxAllowed;
  }
}

function buildAnglesOverpassQL(polygonLatLngs, includedHighways) {
  const ring = polygonLatLngs.map(ll => `${ll.lat} ${ll.lng}`).join(' ');
  const hwyRegex = includedHighways.length ? `~"^(${includedHighways.join('|')})$"` : `~".*"`;
  return `
[out:json][timeout:60];
way(poly:"${ring}")["highway"${includedHighways.length ? hwyRegex : ''}]
  ["highway"!~"footway|path|cycleway|bridleway|steps|corridor|via_ferrata|pedestrian"];
out geom;
`;
}

async function fetchOSMRoads(ql, signal) {
  const resp = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', 
    body: new URLSearchParams({ data: ql }),
    signal: signal
  });
  if (!resp.ok) throw new Error(`Overpass HTTP ${resp.status}`);
  const data = await resp.json();
  const features = (data.elements || [])
    .filter(el => el.type === 'way' && Array.isArray(el.geometry))
    .map(el => ({
      type: 'Feature',
      properties: { id: el.id, tags: el.tags || {} },
      geometry: { type: 'LineString', coordinates: el.geometry.map(g => [g.lon, g.lat]) }
    }));
  return { type: 'FeatureCollection', features };
}

function angleBetween(b1, b2, modeMax) {
  let x = Math.abs(b1 - b2) % 360;
  if (x > 180) x = 360 - x;
  if (modeMax === 90 && x > 90) x = 180 - x;
  return x;
}

function computeMatchesAsPointsAndSegments(fcLines, minDeg, maxDeg, modeMax) {
  const segs = [];
  fcLines.features.forEach(f => {
    const c = f.geometry.coordinates;
    for (let i = 0; i < c.length - 1; i++) segs.push({ a: c[i], b: c[i + 1] });
  });

  const key = (pt) => pt[0].toFixed(7) + "," + pt[1].toFixed(7);
  const nodeToSegIdx = new Map();
  segs.forEach((s, idx) => {
    const ka = key(s.a), kb = key(s.b);
    if (!nodeToSegIdx.has(ka)) nodeToSegIdx.set(ka, []);
    if (!nodeToSegIdx.has(kb)) nodeToSegIdx.set(kb, []);
    nodeToSegIdx.get(ka).push(idx);
    nodeToSegIdx.get(kb).push(idx);
  });

  const segBear = segs.map(s => {
    const bAB = turf.bearing(turf.point(s.a), turf.point(s.b));
    const bBA = (bAB + 180 + 360) % 360;
    return { bAB, bBA };
  });

  const hitPts = [], hitSegIdx = new Set();
  for (const [k, idxs] of nodeToSegIdx.entries()) {
    if (idxs.length < 2) continue;
    const [lon, lat] = k.split(',').map(Number);
    for (let i = 0; i < idxs.length; i++) {
      for (let j = i + 1; j < idxs.length; j++) {
        const si = idxs[i], sj = idxs[j];
        const bi = (key(segs[si].a) === k) ? segBear[si].bAB : segBear[si].bBA;
        const bj = (key(segs[sj].a) === k) ? segBear[sj].bAB : segBear[sj].bBA;
        const ang = angleBetween(bi, bj, modeMax);
        if (ang >= minDeg && ang <= maxDeg) {
          hitPts.push(turf.point([lon, lat], { angle: ang }));
          hitSegIdx.add(si); 
          hitSegIdx.add(sj);
        }
      }
    }
  }

  const segFeatures = Array.from(hitSegIdx).map(idx => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [segs[idx].a, segs[idx].b] }
  }));

  const seen = new Map();
  const mid = (minDeg + maxDeg) / 2;
  for (const p of hitPts) {
    const k2 = key(p.geometry.coordinates);
    const prev = seen.get(k2);
    if (!prev || Math.abs(prev.properties.angle - mid) > Math.abs(p.properties.angle - mid)) {
      seen.set(k2, p);
    }
  }
  
  return {
    points: turf.featureCollection(Array.from(seen.values())),
    segments: turf.featureCollection(segFeatures)
  };
}

function extractLeafletRing(layer) {
  const latlngs = layer.getLatLngs();
  const ring = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  const closed = ring.slice();
  if (closed.length && (closed[0].lat !== closed[closed.length - 1].lat || closed[0].lng !== closed[closed.length - 1].lng)) {
    closed.push(closed[0]);
  }
  return closed;
}

async function fetchAnglesData() {
  // Cancel any previous request
  if (anglesAbortController) {
    anglesAbortController.abort();
  }
  
  // Create new AbortController for this request
  anglesAbortController = new AbortController();
  
  try {
    if (!anglesAOILayer || !anglesAOILayer.getLatLngs) {
      alert('Please draw a polygon area first using the drawing tools (top-right)');
      const statusEl = document.getElementById('status');
      if (statusEl) {
        statusEl.textContent = 'Draw a polygon to start';
      }
      return;
    }

    const modeEl = document.querySelector('input[name="angleMode"]:checked');
    const maxAllowed = modeEl && modeEl.value === '180' ? 180 : 90;
    const minAngleEl = document.getElementById('minAngle');
    const maxAngleEl = document.getElementById('maxAngle');
    const minA = minAngleEl ? Number(minAngleEl.value) : 0;
    const maxA = maxAngleEl ? Number(maxAngleEl.value) : maxAllowed;
    
    if ([minA, maxA].some(isNaN) || minA < 0 || maxA > maxAllowed || minA > maxA) {
      alert(`Angle range must be between 0 and ${maxAllowed}°`);
      return;
    }

    const hwys = Array.from(document.querySelectorAll('.hwy:checked')).map(cb => cb.value);
    
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = 'Fetching OSM roads from Overpass...';
    }
    
    // Don't clear the AOI layer, only the results
    anglesAllRoadsLayer.clearLayers();
    anglesSegmentsLayer.clearLayers();
    anglesIntersectionsLayer.clearLayers();

    const ring = extractLeafletRing(anglesAOILayer);
    const ql = buildAnglesOverpassQL(ring, hwys);
    const fc = await fetchOSMRoads(ql, anglesAbortController.signal);

    const showAllRoadsEl = document.getElementById('showAllRoads');
    if (showAllRoadsEl && showAllRoadsEl.checked) {
      anglesAllRoadsLayer.addData(fc);
    }

    if (statusEl) {
      statusEl.textContent = `Fetched ${fc.features.length} ways. Computing...`;
    }
    
    const modeMax = maxAllowed;
    const result = computeMatchesAsPointsAndSegments(fc, minA, maxA, modeMax);

    anglesSegmentsLayer.addData(result.segments);
    anglesIntersectionsLayer.addData(result.points);

    const nPts = result.points.features.length;
    const nSegs = result.segments.features.length;
    if (statusEl) {
      statusEl.textContent = `Found ${nPts} intersections and ${nSegs} segments in ${minA}—${maxA}° range`;
    }
    
    if (nPts || nSegs) {
      const group = L.featureGroup([anglesSegmentsLayer, anglesIntersectionsLayer]);
      map.fitBounds(group.getBounds(), { maxZoom: 18 });
    }
  } catch (err) {
    // Don't show error if request was aborted
    if (err.name === 'AbortError') {
      console.log('Request cancelled');
      return;
    }
    console.error(err);
    const statusEl = document.getElementById('status');
    if (statusEl) {
      statusEl.textContent = 'Error: ' + err.message;
    }
    alert('Overpass error. Try a smaller area or fewer highway types.');
  } finally {
    anglesAbortController = null;
  }
}

function downloadIntersections() {
  const fc = anglesIntersectionsLayer.toGeoJSON();
  if (!fc.features.length) {
    alert('No intersections to download');
    return;
  }
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'intersections.geojson';
  a.click();
}

function downloadSegments() {
  const fc = anglesSegmentsLayer.toGeoJSON();
  if (!fc.features.length) {
    alert('No segments to download');
    return;
  }
  const blob = new Blob([JSON.stringify(fc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'segments.geojson';
  a.click();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Register event listeners
  if (map && typeof map.on === 'function') {
    map.on('pm:create', pmCreateHandler);
    map.on('pm:remove', pmRemoveHandler);
  }
});
