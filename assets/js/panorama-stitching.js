/* ========== PANORAMA STITCHING ========== */

// Track which images are selected for stitching
let selectedForPanorama = new Set();
let opencvReady = false;
let opencvReadyResolve = null;
let opencvReadyPromise = new Promise((resolve) => {
  opencvReadyResolve = resolve;
});

// Check if OpenCV is ready with all required features for manual panorama stitching
function isOpenCVFullyLoaded() {
  return typeof cv !== 'undefined'
    && cv.Mat
    && cv.MatVector
    && typeof cv.imshow === 'function'
    && typeof cv.matFromImageData === 'function'
    // Feature detection
    && cv.ORB && typeof cv.ORB.create === 'function'
    // Feature matching
    && cv.BFMatcher && typeof cv.BFMatcher.create === 'function'
    && cv.DMatch
    // Homography and warping
    && typeof cv.findHomography === 'function'
    && typeof cv.warpPerspective === 'function'
    // Required constants
    && cv.NORM_HAMMING !== undefined
    && cv.RANSAC !== undefined
    && cv.BORDER_CONSTANT !== undefined;
}

// Called by Module.onRuntimeInitialized in HTML
window.onOpenCVReady = function() {
  console.log('OpenCV.js is ready for panorama stitching');

  // Debug: Check what's available for manual stitching
  console.log('cv exists:', typeof cv !== 'undefined');
  console.log('cv.Mat exists:', typeof cv !== 'undefined' && !!cv.Mat);
  console.log('cv.ORB exists:', typeof cv !== 'undefined' && !!cv.ORB);
  console.log('cv.ORB.create exists:', typeof cv !== 'undefined' && cv.ORB && typeof cv.ORB.create === 'function');
  console.log('cv.BFMatcher exists:', typeof cv !== 'undefined' && !!cv.BFMatcher);
  console.log('cv.findHomography exists:', typeof cv !== 'undefined' && typeof cv.findHomography === 'function');
  console.log('cv.warpPerspective exists:', typeof cv !== 'undefined' && typeof cv.warpPerspective === 'function');
  console.log('cv.imshow exists:', typeof cv !== 'undefined' && typeof cv.imshow === 'function');
  console.log('cv.matFromImageData exists:', typeof cv !== 'undefined' && typeof cv.matFromImageData === 'function');

  // Verify all required features are available
  if (isOpenCVFullyLoaded()) {
    opencvReady = true;
    opencvReadyResolve();
    updateOpenCVStatusUI('ready', 'Ready');
    updatePanoramaControls();
  } else {
    console.error('OpenCV loaded but missing required features for panorama stitching');
    updateOpenCVStatusUI('error', 'Incomplete - missing required modules');
  }
};

// Wait for OpenCV to be ready
function waitForOpenCV() {
  if (opencvReady) {
    return Promise.resolve();
  }
  return opencvReadyPromise;
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

  // Update selection counter (currently supports exactly 2 images)
  counter.textContent = selectedCount === 0
    ? 'No images selected'
    : selectedCount === 1
      ? '1 image selected (need 1 more)'
      : selectedCount === 2
        ? '2 images selected (ready to stitch)'
        : `${selectedCount} images selected (please select only 2)`;

  // Enable button only if exactly 2 images selected AND OpenCV is ready
  if (!opencvReady) {
    btn.disabled = true;
  } else if (selectedCount === 2) {
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

// Manual OpenCV load function (not needed with Module pattern, but kept for UI consistency)
function loadOpenCVManually() {
  // OpenCV loads automatically via Module pattern
  // This just updates the UI to show it's loading
  updateOpenCVStatusUI('loading', 'OpenCV.js is loading...');

  // Wait for the promise
  waitForOpenCV()
    .then(() => {
      updateOpenCVStatusUI('ready', 'Ready');
      updatePanoramaControls();
    })
    .catch((error) => {
      console.error('OpenCV loading error:', error);
      updateOpenCVStatusUI('error', 'Failed to load - Refresh page to retry');
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

/* ========== MODULAR PANORAMA STITCHING PIPELINE ========== */

/**
 * Module 1: Feature Detection
 * Detects ORB keypoints and computes descriptors for an image
 * @param {cv.Mat} mat - Input image matrix
 * @returns {{keypoints: cv.KeyPointVector, descriptors: cv.Mat}} Detected features
 */
function detectAndComputeFeatures(mat) {
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();

  // Create ORB detector with reasonable parameters
  const orb = new cv.ORB(
    1000,  // nfeatures - detect up to 1000 keypoints
    1.2,   // scaleFactor - pyramid decimation ratio
    8,     // nlevels - number of pyramid levels
    31,    // edgeThreshold - size of border where features are not detected
    0,     // firstLevel - level of pyramid to put source image to
    2,     // WTA_K - number of points that produce each element of the oriented BRIEF descriptor
    cv.ORB_HARRIS_SCORE,  // scoreType - use Harris corner detector
    31,    // patchSize - size of patch used by oriented BRIEF descriptor
    20     // fastThreshold - threshold on difference between intensity of the central pixel and pixels of a circle
  );

  orb.detectAndCompute(mat, new cv.Mat(), keypoints, descriptors);
  orb.delete();

  console.log(`Detected ${keypoints.size()} keypoints`);
  return { keypoints, descriptors };
}

/**
 * Module 2: Feature Matching
 * Matches descriptors between two images using BFMatcher
 * @param {cv.Mat} descriptors1 - Descriptors from first image
 * @param {cv.Mat} descriptors2 - Descriptors from second image
 * @returns {cv.DMatchVector} Good matches after ratio test
 */
function matchFeatures(descriptors1, descriptors2) {
  // Create BFMatcher with Hamming distance (appropriate for ORB descriptors)
  const bf = new cv.BFMatcher(cv.NORM_HAMMING, false);

  // Find k=2 best matches for each descriptor (for ratio test)
  const matches = new cv.DMatchVectorVector();
  bf.knnMatch(descriptors1, descriptors2, matches, 2);

  // Apply Lowe's ratio test to filter good matches
  const goodMatches = new cv.DMatchVector();
  const ratioThreshold = 0.75;  // Standard ratio test threshold

  for (let i = 0; i < matches.size(); i++) {
    const match = matches.get(i);
    if (match.size() >= 2) {
      const m = match.get(0);
      const n = match.get(1);
      // Keep match if best match is significantly better than second best
      if (m.distance < ratioThreshold * n.distance) {
        goodMatches.push_back(m);
      }
    }
  }

  bf.delete();
  matches.delete();

  console.log(`Found ${goodMatches.size()} good matches out of ${descriptors1.rows} keypoints`);
  return goodMatches;
}

/**
 * Module 3: Homography Estimation
 * Computes homography matrix from matched keypoints using RANSAC
 * @param {cv.KeyPointVector} keypoints1 - Keypoints from first image
 * @param {cv.KeyPointVector} keypoints2 - Keypoints from second image
 * @param {cv.DMatchVector} goodMatches - Filtered matches
 * @returns {cv.Mat|null} Homography matrix (3x3) or null if estimation fails
 */
function estimateHomography(keypoints1, keypoints2, goodMatches) {
  if (goodMatches.size() < 4) {
    throw new Error(`Not enough matches to compute homography. Found ${goodMatches.size()}, need at least 4.`);
  }

  // Extract matched point coordinates
  const srcPoints = [];
  const dstPoints = [];

  for (let i = 0; i < goodMatches.size(); i++) {
    const match = goodMatches.get(i);
    const kp1 = keypoints1.get(match.queryIdx);
    const kp2 = keypoints2.get(match.trainIdx);
    srcPoints.push(kp1.pt.x, kp1.pt.y);
    dstPoints.push(kp2.pt.x, kp2.pt.y);
  }

  // Convert to cv.Mat format
  const srcMat = cv.matFromArray(goodMatches.size(), 1, cv.CV_32FC2, srcPoints);
  const dstMat = cv.matFromArray(goodMatches.size(), 1, cv.CV_32FC2, dstPoints);

  // Find homography using RANSAC
  const H = cv.findHomography(srcMat, dstMat, cv.RANSAC, 5.0);

  srcMat.delete();
  dstMat.delete();

  if (H.empty()) {
    return null;
  }

  console.log('Homography matrix computed successfully');
  return H;
}

/**
 * Module 4: Image Warping and Stitching
 * Warps the first image onto the second image's plane and blends them
 * @param {cv.Mat} img1 - First image (will be warped)
 * @param {cv.Mat} img2 - Second image (reference)
 * @param {cv.Mat} H - Homography matrix
 * @returns {cv.Mat} Stitched panorama
 */
function warpAndStitch(img1, img2, H) {
  // Calculate output canvas size
  // Get corners of img1 after transformation
  const corners1 = new cv.Mat(4, 1, cv.CV_32FC2);
  corners1.data32F[0] = 0;
  corners1.data32F[1] = 0;
  corners1.data32F[2] = img1.cols;
  corners1.data32F[3] = 0;
  corners1.data32F[4] = img1.cols;
  corners1.data32F[5] = img1.rows;
  corners1.data32F[6] = 0;
  corners1.data32F[7] = img1.rows;

  const cornersTransformed = new cv.Mat();
  cv.perspectiveTransform(corners1, cornersTransformed, H);

  // Find bounding box
  let minX = 0, minY = 0, maxX = img2.cols, maxY = img2.rows;

  for (let i = 0; i < 4; i++) {
    const x = cornersTransformed.data32F[i * 2];
    const y = cornersTransformed.data32F[i * 2 + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  const outputWidth = Math.ceil(maxX - minX);
  const outputHeight = Math.ceil(maxY - minY);

  console.log(`Output panorama size: ${outputWidth}x${outputHeight}`);

  // Create translation matrix to shift if needed
  const translationMat = cv.Mat.eye(3, 3, cv.CV_64F);
  translationMat.data64F[2] = -minX;
  translationMat.data64F[5] = -minY;

  // Combine homography with translation
  const adjustedH = new cv.Mat();
  cv.gemm(translationMat, H, 1, new cv.Mat(), 0, adjustedH);

  // Warp img1 to output canvas
  const warped = new cv.Mat();
  cv.warpPerspective(
    img1,
    warped,
    adjustedH,
    new cv.Size(outputWidth, outputHeight),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(0, 0, 0, 0)
  );

  // Create output mat and copy img2 into it at the correct position
  const result = warped.clone();

  // Calculate where img2 should be placed
  const offsetX = Math.max(0, -minX);
  const offsetY = Math.max(0, -minY);

  // Simple blending: copy img2 over warped img1 where img2 exists
  // This is a basic approach; more sophisticated blending would use alpha blending
  const roi = result.roi(new cv.Rect(offsetX, offsetY, img2.cols, img2.rows));
  img2.copyTo(roi);

  // Cleanup
  corners1.delete();
  cornersTransformed.delete();
  translationMat.delete();
  adjustedH.delete();
  warped.delete();
  roi.delete();

  console.log('Images stitched successfully');
  return result;
}

/* ========== MAIN STITCHING FUNCTION ========== */

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

    // NOTE: Currently supports stitching 2 images at a time
    // Multi-image stitching would require iteratively stitching pairs
    if (selectedLayers.length !== 2) {
      throw new Error('Please select exactly 2 images. Multi-image stitching will be supported in a future update.');
    }

    // Convert images to OpenCV Mats
    if (statusText) statusText.textContent = 'Converting images...';
    const mat1 = imageToMat(selectedLayers[0].image);
    const mat2 = imageToMat(selectedLayers[1].image);

    let features1, features2, matches, H, pano;

    try {
      // Step 1: Detect features in both images
      if (statusText) statusText.textContent = 'Detecting features in image 1...';
      features1 = detectAndComputeFeatures(mat1);

      if (statusText) statusText.textContent = 'Detecting features in image 2...';
      features2 = detectAndComputeFeatures(mat2);

      // Step 2: Match features between images
      if (statusText) statusText.textContent = 'Matching features between images...';
      matches = matchFeatures(features1.descriptors, features2.descriptors);

      if (matches.size() < 10) {
        throw new Error(`Not enough good matches found (${matches.size()}). Images may not overlap or be too different.\n\nTips:\n• Ensure images overlap by 30-70%\n• Use images from the same scene/location\n• Try images with distinct features (textures, corners, edges)`);
      }

      // Step 3: Estimate homography transformation
      if (statusText) statusText.textContent = 'Computing image alignment...';
      H = estimateHomography(features1.keypoints, features2.keypoints, matches);

      if (!H || H.empty()) {
        throw new Error('Failed to compute homography. Images may not have sufficient overlap or matching features.');
      }

      // Step 4: Warp and stitch images
      if (statusText) statusText.textContent = 'Stitching images together...';
      pano = warpAndStitch(mat1, mat2, H);

      if (statusText) statusText.textContent = 'Creating image layer...';

      // Convert result to image
      const resultImage = await matToImage(pano);

      // Cleanup OpenCV resources
      mat1.delete();
      mat2.delete();
      features1.keypoints.delete();
      features1.descriptors.delete();
      features2.keypoints.delete();
      features2.descriptors.delete();
      matches.delete();
      H.delete();
      pano.delete();

    } catch (innerError) {
      // Cleanup any resources that were created before the error
      if (mat1) mat1.delete();
      if (mat2) mat2.delete();
      if (features1) {
        if (features1.keypoints) features1.keypoints.delete();
        if (features1.descriptors) features1.descriptors.delete();
      }
      if (features2) {
        if (features2.keypoints) features2.keypoints.delete();
        if (features2.descriptors) features2.descriptors.delete();
      }
      if (matches) matches.delete();
      if (H) H.delete();
      if (pano) pano.delete();

      throw innerError;  // Re-throw to outer catch
    }

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
    alert(`❌ Panorama Stitching Failed\n\n${error.message}`);
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
    // Set initial UI state - show loading since OpenCV.js is loading in background
    updateOpenCVStatusUI('loading', 'Loading OpenCV.js...');
    isolatePanoramaEvents();

    // Check if OpenCV already loaded (unlikely but possible)
    if (opencvReady) {
      updateOpenCVStatusUI('ready', 'Ready');
      updatePanoramaControls();
    }
    // Otherwise, onOpenCVReady callback will update UI when ready
  });
} else {
  // Set initial UI state - show loading since OpenCV.js is loading in background
  updateOpenCVStatusUI('loading', 'Loading OpenCV.js...');
  isolatePanoramaEvents();

  // Check if OpenCV already loaded (unlikely but possible)
  if (opencvReady) {
    updateOpenCVStatusUI('ready', 'Ready');
    updatePanoramaControls();
  }
  // Otherwise, onOpenCVReady callback will update UI when ready
}
