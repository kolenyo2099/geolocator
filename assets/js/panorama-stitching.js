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

// Update panorama controls based on selection
function updatePanoramaControls() {
  const section = document.getElementById('panoramaSection');
  const btn = document.getElementById('stitchPanoramaBtn');
  const hint = document.getElementById('panoramaHint');

  if (!section || !btn || !hint) return;

  const selectedCount = selectedForPanorama.size;

  // Show section if there are any uploaded images
  if (typeof imageLayers !== 'undefined' && imageLayers.length > 0) {
    section.style.display = 'block';
  } else {
    section.style.display = 'none';
    selectedForPanorama.clear();
    return;
  }

  // Enable button only if 2 or more images selected AND OpenCV is ready
  if (!opencvReady) {
    btn.disabled = true;
    hint.textContent = 'Loading OpenCV.js...';
    hint.style.color = '#ff9800';
  } else if (selectedCount >= 2) {
    btn.disabled = false;
    hint.textContent = `${selectedCount} images selected - Ready to stitch`;
    hint.style.color = '#28a745';
  } else {
    btn.disabled = true;
    hint.textContent = 'Select 2+ images below';
    hint.style.color = '#666';
  }
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
  const progressDiv = document.getElementById('panoramaProgress');
  const statusText = document.getElementById('panoramaStatus');
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
    progressDiv.style.display = 'flex';
    statusText.textContent = 'Loading OpenCV...';
    btn.disabled = true;

    // Wait for OpenCV to be ready (with timeout)
    await waitForOpenCV();

    statusText.textContent = 'Preparing images...';

    // Get selected image layers in order
    const selectedLayers = imageLayers.filter(layer => selectedForPanorama.has(layer.id));

    if (selectedLayers.length < 2) {
      throw new Error('At least 2 images are required for stitching.');
    }

    statusText.textContent = `Processing ${selectedLayers.length} images...`;

    // Convert images to OpenCV Mats
    const mats = [];
    for (const layer of selectedLayers) {
      const mat = imageToMat(layer.image);
      mats.push(mat);
    }

    statusText.textContent = 'Detecting features and matching...';

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

    statusText.textContent = 'Stitching panorama...';

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

    statusText.textContent = 'Creating image layer...';

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
    progressDiv.style.display = 'none';
    btn.disabled = false;

    // Show success message
    alert(`✅ Panorama created successfully!\n\nThe stitched panorama has been added as a new image layer.`);

  } catch (error) {
    console.error('Panorama stitching error:', error);

    // Hide progress
    progressDiv.style.display = 'none';
    btn.disabled = false;

    // Show error to user
    alert(`❌ Panorama Stitching Failed\n\n${error.message}\n\nTips:\n• Use images that overlap by 30-70%\n• Ensure images are from the same camera/location\n• Try selecting images in the correct sequence (left to right)\n• Images should have similar lighting and exposure`);

    // Update controls
    updatePanoramaControls();
  }
}

// Make functions globally accessible
window.togglePanoramaSelection = togglePanoramaSelection;
window.updatePanoramaControls = updatePanoramaControls;
window.stitchPanorama = stitchPanorama;

// Prevent event propagation from panorama UI to avoid interference with canvas event handlers
function isolatePanoramaEvents() {
  const panoramaSection = document.getElementById('panoramaSection');
  if (!panoramaSection) return;

  // Stop all events from propagating beyond panorama section to prevent
  // interference with Konva canvas event forwarding system
  const eventsToStop = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick',
                        'touchstart', 'touchend', 'touchmove', 'wheel'];

  eventsToStop.forEach(eventType => {
    panoramaSection.addEventListener(eventType, (e) => {
      e.stopPropagation();
    }, true);
  });

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

// Update UI based on OpenCV loading state
function updateOpenCVStatus() {
  const hint = document.getElementById('panoramaHint');
  if (!hint) return;

  if (opencvReady) {
    // OpenCV is ready, show normal hints
    updatePanoramaControls();
  } else {
    // OpenCV is still loading
    hint.textContent = 'Loading OpenCV.js...';
    hint.style.color = '#ff9800';
  }
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    updateOpenCVStatus();
    isolatePanoramaEvents();

    // Start monitoring OpenCV and update UI when ready
    initOpenCVMonitoring()
      .then(() => {
        updatePanoramaControls();
      })
      .catch((error) => {
        console.error('OpenCV loading error:', error);
        const hint = document.getElementById('panoramaHint');
        if (hint) {
          hint.textContent = 'OpenCV.js failed to load';
          hint.style.color = '#d32f2f';
        }
      });
  });
} else {
  updateOpenCVStatus();
  isolatePanoramaEvents();

  // Start monitoring OpenCV and update UI when ready
  initOpenCVMonitoring()
    .then(() => {
      updatePanoramaControls();
    })
    .catch((error) => {
      console.error('OpenCV loading error:', error);
      const hint = document.getElementById('panoramaHint');
      if (hint) {
        hint.textContent = 'OpenCV.js failed to load';
        hint.style.color = '#d32f2f';
      }
    });
}
