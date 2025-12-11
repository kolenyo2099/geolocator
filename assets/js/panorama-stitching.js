/* ========== PANORAMA STITCHING ========== */

// Track which images are selected for stitching
let selectedForPanorama = new Set();
let opencvReady = false;
let opencvLoadPromise = null;

// Check if OpenCV is ready with all required features
function isOpenCVFullyLoaded() {
  return typeof cv !== 'undefined'
    && cv.Mat
    && cv.Stitcher
    && typeof cv.Stitcher.create === 'function'
    && cv.Stitcher_PANORAMA !== undefined
    && cv.Stitcher_OK !== undefined
    && cv.MatVector
    && typeof cv.imshow === 'function'
    && typeof cv.matFromImageData === 'function';
}

// Setup OpenCV ready callback using official mechanism
function initOpenCVMonitoring() {
  // If already loaded, resolve immediately
  if (isOpenCVFullyLoaded()) {
    opencvReady = true;
    return Promise.resolve();
  }

  // Create promise if not already created
  if (!opencvLoadPromise) {
    opencvLoadPromise = new Promise((resolve, reject) => {
      // Use OpenCV's official ready callback if available
      if (typeof cv !== 'undefined' && cv.onRuntimeInitialized) {
        const originalCallback = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = function() {
          if (originalCallback) originalCallback();
          opencvReady = true;
          console.log('OpenCV.js fully loaded and ready');
          resolve();
        };
      } else {
        // Fallback: poll for OpenCV availability
        let attempts = 0;
        const maxAttempts = 300; // 30 seconds

        const checkInterval = setInterval(() => {
          attempts++;

          if (isOpenCVFullyLoaded()) {
            clearInterval(checkInterval);
            opencvReady = true;
            console.log('OpenCV.js fully loaded and ready');
            resolve();
          } else if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            reject(new Error('OpenCV.js failed to load completely after 30 seconds. Please refresh the page.'));
          }
        }, 100);
      }
    });
  }

  return opencvLoadPromise;
}

// Wait for OpenCV to be ready
function waitForOpenCV() {
  return initOpenCVMonitoring();
}

// Toggle image selection for panorama stitching
function togglePanoramaSelection(layerId, event) {
  if (event) {
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  if (selectedForPanorama.has(layerId)) {
    selectedForPanorama.delete(layerId);
  } else {
    selectedForPanorama.add(layerId);
  }

  updatePanoramaControls();
  updateLayersList();
}

// Toggle panorama panel
function togglePanoramaPanel(forceState) {
  const panel = document.getElementById('panoramaPanel');
  const button = document.getElementById('panoramaToggle');

  if (!panel) return;

  const shouldOpen = typeof forceState === 'boolean' ? forceState : !panel.classList.contains('open');

  if (shouldOpen) {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    if (button) button.setAttribute('aria-expanded', 'true');
  } else {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    if (button) button.setAttribute('aria-expanded', 'false');
  }
}

// Update panorama controls based on selection
function updatePanoramaControls() {
  const btn = document.getElementById('stitchPanoramaBtn');
  const counter = document.getElementById('panoramaSelectionCount');

  if (!btn || !counter) return;

  const selectedCount = selectedForPanorama.size;

  // Update selection counter
  counter.textContent = selectedCount === 0
    ? 'No images selected'
    : selectedCount === 1
      ? '1 image selected (need 1 more)'
      : `${selectedCount} images selected`;

  // Enable button only if 2 or more images selected AND OpenCV is ready
  if (!opencvReady) {
    btn.disabled = true;
  } else if (selectedCount >= 2) {
    btn.disabled = false;
  } else {
    btn.disabled = true;
  }
}

// Update OpenCV status UI
function updateOpenCVStatusUI(status, message) {
  const dot = document.getElementById('opencvStatusDot');
  const text = document.getElementById('opencvStatusText');
  const loadBtn = document.getElementById('loadOpenCVBtn');
  const progressBar = document.getElementById('opencvProgressBar');

  if (!dot || !text) return;

  // Remove all status classes
  dot.classList.remove('loading', 'ready', 'error');

  if (status === 'loading') {
    dot.classList.add('loading');
    text.textContent = message || 'Loading OpenCV.js...';
    if (progressBar) progressBar.style.display = 'block';
    if (loadBtn) loadBtn.style.display = 'none';
  } else if (status === 'ready') {
    dot.classList.add('ready');
    text.textContent = message || 'Ready';
    if (progressBar) progressBar.style.display = 'none';
    if (loadBtn) loadBtn.style.display = 'none';
  } else if (status === 'error') {
    dot.classList.add('error');
    text.textContent = message || 'Failed to load';
    if (progressBar) progressBar.style.display = 'none';
    if (loadBtn) loadBtn.style.display = 'inline-block';
  } else {
    // idle/initializing
    text.textContent = message || 'Not loaded';
    if (progressBar) progressBar.style.display = 'none';
    if (loadBtn) loadBtn.style.display = 'inline-block';
  }
}

// Manual OpenCV load function
function loadOpenCVManually() {
  updateOpenCVStatusUI('loading', 'Loading OpenCV.js...');

  initOpenCVMonitoring()
    .then(() => {
      updateOpenCVStatusUI('ready', 'Ready');
      updatePanoramaControls();
    })
    .catch((error) => {
      console.error('OpenCV loading error:', error);
      updateOpenCVStatusUI('error', 'Failed to load - Click to retry');
    });
}

// Convert HTML Image to OpenCV Mat
function imageToMat(imgElement) {
  const canvas = document.createElement('canvas');
  canvas.width = imgElement.width;
  canvas.height = imgElement.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imgElement, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const mat = cv.matFromImageData(imageData);
  return mat;
}

// Convert OpenCV Mat to Image
function matToImage(mat) {
  return new Promise((resolve, reject) => {
    try {
      const canvas = document.createElement('canvas');
      cv.imshow(canvas, mat);

      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to create image from result'));
      img.src = canvas.toDataURL('image/jpeg', 0.95);
    } catch (error) {
      reject(error);
    }
  });
}

// Main stitching function
async function stitchPanorama() {
  const progressDiv = document.getElementById('panoramaProcessing');
  const statusText = document.getElementById('panoramaProcessingStatus');
  const btn = document.getElementById('stitchPanoramaBtn');

  if (selectedForPanorama.size < 2) {
    alert('Please select at least 2 images to stitch together.');
    return;
  }

  // Double-check OpenCV isn't ready - this shouldn't happen if button was properly disabled
  if (!opencvReady && !isOpenCVFullyLoaded()) {
    alert('⏳ OpenCV.js is still loading. Please wait a few more seconds and try again.\n\nThe library is large (~8MB) and may take 10-30 seconds to download and initialize on first load.');
    return;
  }

  try {
    // Show progress indicator
    if (progressDiv) progressDiv.style.display = 'flex';
    if (statusText) statusText.textContent = 'Loading OpenCV...';
    btn.disabled = true;

    // Wait for OpenCV to be ready (with timeout)
    await waitForOpenCV();

    if (statusText) statusText.textContent = 'Preparing images...';

    // Get selected image layers in order
    const selectedLayers = imageLayers.filter(layer => selectedForPanorama.has(layer.id));

    if (selectedLayers.length < 2) {
      throw new Error('At least 2 images are required for stitching.');
    }

    if (statusText) statusText.textContent = `Processing ${selectedLayers.length} images...`;

    // Convert images to OpenCV Mats
    const mats = [];
    for (const layer of selectedLayers) {
      const mat = imageToMat(layer.image);
      mats.push(mat);
    }

    if (statusText) statusText.textContent = 'Detecting features and matching...';

    // Final runtime check - verify OpenCV Stitcher is actually available
    if (typeof cv === 'undefined' || !cv.Stitcher || typeof cv.Stitcher.create !== 'function') {
      // Clean up mats before throwing error
      mats.forEach(mat => mat.delete());
      throw new Error('OpenCV Stitcher is not available. The library may still be loading. Please wait a few seconds and try again.');
    }

    // Create a MatVector for the stitcher
    const matVec = new cv.MatVector();
    mats.forEach(mat => matVec.push_back(mat));

    // Create stitcher
    const stitcher = cv.Stitcher.create(cv.Stitcher_PANORAMA);
    const pano = new cv.Mat();

    if (statusText) statusText.textContent = 'Stitching panorama...';

    // Perform stitching
    const status = stitcher.stitch(matVec, pano);

    // Clean up input mats
    mats.forEach(mat => mat.delete());
    matVec.delete();

    if (status !== cv.Stitcher_OK) {
      // Handle different error codes
      let errorMsg = 'Stitching failed. ';
      switch (status) {
        case cv.Stitcher_ERR_NEED_MORE_IMGS:
          errorMsg += 'Need more images or images don\'t overlap enough.';
          break;
        case cv.Stitcher_ERR_HOMOGRAPHY_EST_FAIL:
          errorMsg += 'Failed to estimate homography. Images may be too different or don\'t overlap.';
          break;
        case cv.Stitcher_ERR_CAMERA_PARAMS_ADJUST_FAIL:
          errorMsg += 'Failed to adjust camera parameters. Try images with better overlap.';
          break;
        default:
          errorMsg += 'Unknown error occurred. Please try different images.';
      }
      throw new Error(errorMsg);
    }

    if (statusText) statusText.textContent = 'Creating image layer...';

    // Convert result to image
    const resultImage = await matToImage(pano);
    pano.delete();
    stitcher.delete();

    // Add as new layer
    const newLayer = {
      id: Date.now() + Math.random(),
      name: `Panorama (${selectedLayers.length} images)`,
      image: resultImage,
      x: 50,
      y: 50,
      opacity: 1.0,
      visible: true,
      scale: 1.0,
      rotation: 0
    };

    imageLayers.push(newLayer);

    // Clear selection
    selectedForPanorama.clear();
    updatePanoramaControls();
    updateLayersList();

    // Show the new panorama
    if (imageLayers.length === 1) {
      document.querySelector('.no-image').style.display = 'none';
      document.querySelector('.image-canvas-container').style.display = 'flex';
      imagePanel.classList.remove('hidden');
      if (typeof initializeCanvas === 'function') {
        initializeCanvas();
      }
    }

    if (typeof redrawAllLayers === 'function') {
      redrawAllLayers();
    }

    // Hide progress
    if (progressDiv) progressDiv.style.display = 'none';
    updatePanoramaControls();

    // Show success message
    alert(`✅ Panorama created successfully!\n\nThe stitched panorama has been added as a new image layer.`);

  } catch (error) {
    console.error('Panorama stitching error:', error);

    // Hide progress
    if (progressDiv) progressDiv.style.display = 'none';
    updatePanoramaControls();

    // Show error to user
    alert(`❌ Panorama Stitching Failed\n\n${error.message}\n\nTips:\n• Use images that overlap by 30-70%\n• Ensure images are from the same camera/location\n• Try selecting images in the correct sequence (left to right)\n• Images should have similar lighting and exposure`);
  }
}

// Make functions globally accessible
window.togglePanoramaSelection = togglePanoramaSelection;
window.updatePanoramaControls = updatePanoramaControls;
window.stitchPanorama = stitchPanorama;
window.togglePanoramaPanel = togglePanoramaPanel;
window.loadOpenCVManually = loadOpenCVManually;

// Prevent event propagation from panorama UI to avoid interference with canvas event handlers
function isolatePanoramaEvents() {
  const panoramaPanel = document.getElementById('panoramaPanel');
  if (panoramaPanel) {
    // Stop all events from propagating beyond panorama panel to prevent
    // interference with Konva canvas event forwarding system
    const eventsToStop = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick',
                          'touchstart', 'touchend', 'touchmove', 'wheel'];

    eventsToStop.forEach(eventType => {
      panoramaPanel.addEventListener(eventType, (e) => {
        e.stopPropagation();
      }, true);
    });
  }

  // Also isolate panorama checkboxes in the layers list
  // Use event delegation since layer items are dynamically created
  const layersPanel = document.getElementById('layersPanel');
  if (layersPanel) {
    layersPanel.addEventListener('change', (e) => {
      if (e.target.matches('.panorama-checkbox input[type="checkbox"]')) {
        e.stopPropagation();
      }
    }, true);

    layersPanel.addEventListener('click', (e) => {
      if (e.target.closest('.panorama-checkbox')) {
        e.stopPropagation();
      }
    }, true);
  }
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    // Set initial UI state
    updateOpenCVStatusUI('idle', 'Click "Load OpenCV.js" to begin');
    isolatePanoramaEvents();

    // Start monitoring OpenCV automatically
    initOpenCVMonitoring()
      .then(() => {
        updateOpenCVStatusUI('ready', 'Ready');
        updatePanoramaControls();
      })
      .catch((error) => {
        console.error('OpenCV loading error:', error);
        updateOpenCVStatusUI('error', 'Failed to load - Click to retry');
      });
  });
} else {
  // Set initial UI state
  updateOpenCVStatusUI('idle', 'Click "Load OpenCV.js" to begin');
  isolatePanoramaEvents();

  // Start monitoring OpenCV automatically
  initOpenCVMonitoring()
    .then(() => {
      updateOpenCVStatusUI('ready', 'Ready');
      updatePanoramaControls();
    })
    .catch((error) => {
      console.error('OpenCV loading error:', error);
      updateOpenCVStatusUI('error', 'Failed to load - Click to retry');
    });
}
