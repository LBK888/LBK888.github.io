// DOM Elements
const videoInput = document.getElementById('videoInput');
const uploadBtn = document.getElementById('uploadBtn');
const analysisSection = document.getElementById('analysisSection');
const videoCanvas = document.getElementById('videoCanvas');
const loadingMessage = document.getElementById('loadingMessage');
const instructionText = document.getElementById('instructionText');
const analyzeBtn = document.getElementById('analyzeBtn');
const analyzeBtnText = document.getElementById('analyzeBtnText');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');
const resultsSection = document.getElementById('resultsSection');

// State
let videoFile = null;
let firstFrameImage = null;
let selectedPoint = null; // Replaced by mask logic, but kept for compatibility references or removed
let isAnalyzing = false;
let isDrawing = false;
let maskCanvas = null; // Offscreen canvas for the mask
let maskCtx = null;
const ctx = videoCanvas.getContext('2d', { willReadFrequently: true });

// Constants
const ROI_SIZE = 40;     // Region of Interest size
const TEMPLATE_SIZE = 32; // Template size for tracking (Smaller than TSX for speed)
const SEARCH_SIZE = 16;   // Search window size (+/- this amount)

// Event Listeners
uploadBtn.addEventListener('click', () => videoInput.click());

videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    loadingMessage.textContent = "Waiting for video loading...";
    if (file && file.type.startsWith('video/')) {
        loadingMessage.textContent = "got a video...";
        videoFile = file;
        resetState();
        analysisSection.classList.remove('hidden');
        extractFirstFrame(file);
    }
});

// Painting Event Listeners
function startDrawing(e) {
    if (!firstFrameImage || isAnalyzing) return;
    isDrawing = true;
    draw(e);
}

function stopDrawing() {
    if (!isDrawing) return;
    isDrawing = false;
    ctx.beginPath(); // Reset path

    // Check if we have drawn anything
    // If we have content in maskCanvas, enable button
    analyzeBtn.disabled = false;
    analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
    analyzeBtn.classList.add('bg-gradient-to-r', 'from-green-500', 'to-emerald-600', 'text-white', 'hover:from-green-600', 'hover:to-emerald-700');
    instructionText.textContent = "✓ 已選擇區域 Region selected";
}

function draw(e) {
    if (!isDrawing) return;

    // Get coordinates
    const rect = videoCanvas.getBoundingClientRect();
    const scaleX = videoCanvas.width / rect.width;
    const scaleY = videoCanvas.height / rect.height;

    let clientX, clientY;
    if (e.touches) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
        e.preventDefault(); // Prevent scrolling on touch
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    // Draw on Main Canvas (Visual feedback)
    ctx.lineWidth = 20; // Brush size
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.5)'; // Red semi-transparent

    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);

    // Draw on Mask Canvas (Logical mask)
    if (!maskCtx) {
        maskCanvas = document.createElement('canvas');
        maskCanvas.width = videoCanvas.width;
        maskCanvas.height = videoCanvas.height;
        maskCtx = maskCanvas.getContext('2d');
    }
    maskCtx.lineWidth = 20;
    maskCtx.lineCap = 'round';
    maskCtx.strokeStyle = '#ffffff'; // White mask
    maskCtx.lineTo(x, y);
    maskCtx.stroke();
    maskCtx.beginPath();
    maskCtx.moveTo(x, y);
}

videoCanvas.addEventListener('mousedown', startDrawing);
videoCanvas.addEventListener('mousemove', draw);
videoCanvas.addEventListener('mouseup', stopDrawing);
videoCanvas.addEventListener('mouseout', stopDrawing);

videoCanvas.addEventListener('touchstart', startDrawing);
videoCanvas.addEventListener('touchmove', draw);
videoCanvas.addEventListener('touchend', stopDrawing);

analyzeBtn.addEventListener('click', startAnalysis);

// Functions
function resetState() {
    selectedPoint = null;
    maskCanvas = null;
    maskCtx = null;
    isAnalyzing = false;
    resultsSection.classList.add('hidden');
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    instructionText.textContent = "塗抹影像選擇心臟區域 Paint to select heart region";
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
    analyzeBtn.classList.remove('bg-gradient-to-r', 'from-green-500', 'to-emerald-600', 'text-white', 'hover:from-green-600', 'hover:to-emerald-700');
}

function extractFirstFrame(file) {
    loadingMessage.classList.remove('hidden');
    const video = document.createElement('video');
    video.preload = 'auto'; // 'metadata' might not be enough on mobile
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    // Mobile-friendly loading sequence
    const loadTimeout = setTimeout(() => {
        // Fallback if seeked doesn't fire
        if (loadingMessage.classList.contains('hidden')) return;
        console.log("Forcing load fallback...");
        videoCanvas.width = video.videoWidth || 640;
        videoCanvas.height = video.videoHeight || 480;
        ctx.drawImage(video, 0, 0);
        firstFrameImage = new Image();
        firstFrameImage.src = videoCanvas.toDataURL();
        loadingMessage.classList.add('hidden');
        URL.revokeObjectURL(video.src);
    }, 5000); // 5s timeout

    video.onloadedmetadata = () => {
        // Prepare canvas size immediately
        videoCanvas.width = video.videoWidth;
        videoCanvas.height = video.videoHeight;

        // Try to seek to 1st frame
        video.currentTime = 0.1;
    };

    video.onseeked = () => {
        clearTimeout(loadTimeout);
        videoCanvas.width = video.videoWidth;
        videoCanvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        firstFrameImage = new Image();
        firstFrameImage.src = videoCanvas.toDataURL();

        loadingMessage.classList.add('hidden');
        URL.revokeObjectURL(video.src);
    };

    video.onerror = () => {
        clearTimeout(loadTimeout);
        loadingMessage.textContent = "Error loading video";
        alert("無法讀取影片，格式可能不支援 (Unable to load video)");
    };

    video.load(); // Trigger load
}

function drawSelectedPoint(x, y) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 30, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, 2 * Math.PI);
    ctx.fill();
}

// Mask-based Analysis
async function startAnalysis() {
    if (!videoFile || !maskCanvas) return;

    fillMaskHoles(); // Auto-fill holes before analysis

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    analyzeBtnText.textContent = "分析中... Analyzing...";

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    try {
        await new Promise((resolve, reject) => {
            video.onloadeddata = resolve;
            video.onerror = (e) => reject("Video load failed");
            // Add timeout
            setTimeout(() => {
                if (video.readyState >= 1) resolve();
                else reject("Video load timeout");
            }, 5000);
            video.load();
        });
    } catch (e) {
        alert("影片載入失敗 (Video Load Failed): " + e);
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtnText.textContent = "開始分析 Start Analysis";
        return;
    }

    // Ensure metadata is loaded for valid duration
    if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e101;
        await new Promise(r => {
            video.ondurationchange = () => {
                video.currentTime = 0;
                r();
            };
        });
    }

    const duration = video.duration || 10; // fallback
    const targetFPS = 30;
    const totalFrames = Math.floor(duration * targetFPS);
    const intensityData = [];

    // Calculate Center of Mass of the Mask
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    let sumX = 0, sumY = 0, count = 0;
    const activePixels = []; // relative coordinates {x, y} from CoM

    for (let y = 0; y < maskCanvas.height; y++) {
        for (let x = 0; x < maskCanvas.width; x++) {
            const idx = (y * maskCanvas.width + x) * 4;
            if (maskData.data[idx + 3] > 0) { // Alpha > 0
                sumX += x;
                sumY += y;
                count++;
            }
        }
    }

    if (count === 0) {
        alert("Mask empty!");
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtnText.textContent = "開始分析 Start Analysis";
        return;
    }

    let centerX = sumX / count;
    let centerY = sumY / count;

    // Store relative offsets
    for (let y = 0; y < maskCanvas.height; y++) {
        for (let x = 0; x < maskCanvas.width; x++) {
            const idx = (y * maskCanvas.width + x) * 4;
            if (maskData.data[idx + 3] > 0) {
                activePixels.push({ dx: x - centerX, dy: y - centerY });
            }
        }
    }

    // Prepare for tracking
    // For tracking, we use a region around the CoM
    ctx.drawImage(firstFrameImage, 0, 0);
    const templateSize = 64; // Larger template for stability
    const templateImageData = ctx.getImageData(
        Math.max(0, centerX - templateSize / 2),
        Math.max(0, centerY - templateSize / 2),
        templateSize,
        templateSize
    );

    let currentFrame = 0;

    const processChunk = async () => {
        const startTime = performance.now();

        while (currentFrame < totalFrames) {
            if (performance.now() - startTime > 30) {
                const progress = Math.round((currentFrame / totalFrames) * 100);
                progressBar.style.width = `${progress}%`;
                analyzeBtnText.textContent = `分析中... Analyzing... ${progress}%`;
                await new Promise(requestAnimationFrame);
                return processChunk();
            }

            const time = currentFrame / targetFPS;
            video.currentTime = time;

            // Wait for seek with timeout safety
            try {
                await new Promise((resolve, reject) => {
                    const seekHandler = () => {
                        video.removeEventListener('seeked', seekHandler);
                        resolve();
                    };
                    video.addEventListener('seeked', seekHandler);
                    // Timeout if seek takes too long (skip frame)
                    setTimeout(() => {
                        video.removeEventListener('seeked', seekHandler);
                        resolve(); // Just continue with whatever we have
                    }, 500);
                });
            } catch (e) { console.warn("Frame seek error", e); }


            // Draw video to main canvas to read pixels
            ctx.drawImage(video, 0, 0);

            // Tracking
            if (currentFrame > 0) {
                // Track the CoM
                const bestMatch = performTrackingSAD(
                    ctx,
                    centerX,
                    centerY,
                    templateImageData.data,
                    templateSize,
                    templateSize
                );
                // Smooth update
                if (bestMatch) {
                    centerX = centerX * 0.7 + bestMatch.x * 0.3;
                    centerY = centerY * 0.7 + bestMatch.y * 0.3;
                }
            }

            // Extract Green Signal using Mask
            // We iterate over activePixels and sample at current (centerX + dx, centerY + dy)
            let greenSum = 0;
            let validPixels = 0;
            const width = videoCanvas.width;
            const height = videoCanvas.height;
            const frameData = ctx.getImageData(0, 0, width, height).data;

            // Optimization: If mask is huge, reading independent pixels is slow. 
            // Better to read bounding box.
            // But let's stick to simple implementation first, optimized by reading full frame once (done above)

            // Actually, `frameData` is huge array. access is `(y * w + x) * 4`
            for (let i = 0; i < activePixels.length; i += 4) { // SUBSAMPLE: Skip every 4th pixel for speed
                const px = Math.floor(centerX + activePixels[i].dx);
                const py = Math.floor(centerY + activePixels[i].dy);

                if (px >= 0 && px < width && py >= 0 && py < height) {
                    const idx = (py * width + px) * 4;
                    greenSum += frameData[idx + 1];
                    validPixels++;
                }
            }

            intensityData.push(greenSum / (validPixels || 1));

            currentFrame++;
        }

        finishAnalysis(intensityData, targetFPS, duration);
        URL.revokeObjectURL(video.src);
    };

    processChunk();
}

function fillMaskHoles() {
    if (!maskCtx || !maskCanvas) return;

    const width = maskCanvas.width;
    const height = maskCanvas.height;
    const imageData = maskCtx.getImageData(0, 0, width, height);
    const data = imageData.data;

    // 1. Create a visited array (same size as image)
    const visited = new Uint8Array(width * height);

    // 2. Queue for BFS
    const queue = [];

    // 3. Start BFS from all edges (Background flood fill)
    // Top & Bottom rows
    for (let x = 0; x < width; x++) {
        if (data[(0 * width + x) * 4 + 3] === 0) { // If transparent
            queue.push(x + 0 * width);
            visited[0 * width + x] = 1;
        }
        if (data[((height - 1) * width + x) * 4 + 3] === 0) {
            queue.push(x + (height - 1) * width);
            visited[(height - 1) * width + x] = 1;
        }
    }
    // Left & Right cols
    for (let y = 0; y < height; y++) {
        if (data[(y * width + 0) * 4 + 3] === 0) {
            queue.push(0 + y * width);
            visited[y * width + 0] = 1;
        }
        if (data[(y * width + (width - 1)) * 4 + 3] === 0) {
            queue.push((width - 1) + y * width);
            visited[y * width + (width - 1)] = 1;
        }
    }

    // Process Queue
    let head = 0;
    while (head < queue.length) {
        const idx = queue[head++];
        const cx = idx % width;
        const cy = Math.floor(idx / width);

        // Neighbors (4-connectivity)
        const neighbors = [
            { x: cx + 1, y: cy }, { x: cx - 1, y: cy },
            { x: cx, y: cy + 1 }, { x: cx, y: cy - 1 }
        ];

        for (const n of neighbors) {
            if (n.x >= 0 && n.x < width && n.y >= 0 && n.y < height) {
                const nIdx = n.y * width + n.x;
                if (!visited[nIdx]) {
                    // Check if transparent
                    if (data[nIdx * 4 + 3] === 0) {
                        visited[nIdx] = 1;
                        queue.push(nIdx);
                    }
                }
            }
        }
    }

    // 4. Fill Holes (Any pixel NOT visited and NOT already painted)
    let filledCount = 0;
    for (let i = 0; i < width * height; i++) {
        if (!visited[i] && data[i * 4 + 3] === 0) {
            // This is a hole! Fill it.
            data[i * 4 + 0] = 255; // R
            data[i * 4 + 1] = 255; // G
            data[i * 4 + 2] = 255; // B
            data[i * 4 + 3] = 255; // Alpha
            filledCount++;
        }
    }

    maskCtx.putImageData(imageData, 0, 0);

    // Visual update: also draw to main ctx for user to see
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.restore();
}

function findBestMatchSAD(context, startX, startY) {
    // Get search area (larger)
    const searchAreaSize = TEMPLATE_SIZE + (SEARCH_SIZE * 2);
    const searchX = Math.floor(startX - searchAreaSize / 2);
    const searchY = Math.floor(startY - searchAreaSize / 2);

    // Boundary check
    if (searchX < 0 || searchY < 0 ||
        searchX + searchAreaSize > context.canvas.width ||
        searchY + searchAreaSize > context.canvas.height) {
        return { x: startX, y: startY };
    }

    const searchData = context.getImageData(searchX, searchY, searchAreaSize, searchAreaSize);
    const data = searchData.data;
    const width = searchAreaSize;

    // We actually need the PREVIOUS frame's template to match against CURRENT frame.
    // However, for simplicity and performance in this flow:
    // We assume the object doesn't change appearance drastically. 
    // We simply look for the region in the CURRENT frame that has the highest correlation 
    // with the template we extracted from the PREVIOUS frame.
    // Wait, to do this properly we need to store the template from the previous step.
    // Correct Approach: 
    // 1. Extract template from previous frame (stored). 
    // 2. Search in current frame.
    // 3. Update template.

    // Ideally we should have stored the template.
    // For this implementation, let's use a simpler approach:
    // Just search for the "most distinct" feature? No, that's tracking.
    // Optimization: Since we draw every frame to canvas, we can't easily access the "previous" frame pixel data unless we saved it.
    // Modifying the loop to save the Template Data.

    // Actually, let's simplify. The original code used NCC on the current canvas context vs itself?
    // "const template = ctx.getImageData... (prevPos)" -> This implies it was trying to match against the *current* frame's own content?
    // Wait, the original code logic was:
    // 1. video.currentTime changes.
    // 2. ctx.drawImage(video). -> Now canvas has CURRENT frame.
    // 3. findBestMatch(ctx, prevPos...) 
    //    -> "const template = ctx.getImageData(prevPos...)" -> This grabs pixels from CURRENT frame at PREVIOUS position.
    //    -> Then searches neighbors in CURRENT frame.
    //    -> THIS IS WRONG in the original code. It was matching the current frame against itself slightly shifted. 
    //       It finds the "smoothest" match, not the "motion". 
    //       Actual Motion Tracking needs: Template from Frame N-1, Search in Frame N.

    // Let's FIX this.
    // Since we can't easily get Frame N-1 without double buffering, 
    // and storing full interaction is heavy.
    // We will trust the user held the phone relatively still, but correct for small jitters.
    // Maybe we just skip complex tracking if the original was flawed, 
    // OR we implement it correctly:
    // We need to keep the "Reference Template".
    // Let's use the INTIAL selected point as the reference template and track THAT.
    // This prevents drift.

    // But appearance changes (lighting, blood flow).
    // Let's stick to the center point. 
    // If the original tracking was flawed, maybe we just disable it or fix it properly.
    // Let's try to implement a simple "Center of Mass" or "Brightest Spot" tracking? No.

    // Let's implement Reference-Based Tracking.
    // We grab the template at the Selected Point from the FIRST frame.
    // And we search for it in every subsequent frame.
    // This handles "hand shaking" well.
    return { x: startX, y: startY }; // Placeholder if we want to skip complex tracking for now to ensure we finish. 
    // Wait, the requirement says "Phone video might have shake, do alignment".

    // OK, let's implement proper tracking.
    // I need the First Frame's template data.
    // I will store `referenceTemplateData` globally.
}

// Updating Global for Tracking
let referenceTemplateData = null;

// Override extractFirstFrame to save template
const originalExtract = extractFirstFrame;
extractFirstFrame = (file) => {
    // ... logic same as above ...
    // inside onseeked:
    // ...
    // Note: We can't save template here because we don't have Selected Point yet.
    // We save template in "startAnalysis"
    loadingMessage.classList.remove('hidden');
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    video.onloadeddata = () => {
        video.currentTime = 0.1;
    };

    video.onseeked = () => {
        videoCanvas.width = video.videoWidth;
        videoCanvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        firstFrameImage = new Image();
        firstFrameImage.src = videoCanvas.toDataURL();

        loadingMessage.classList.add('hidden');
        URL.revokeObjectURL(video.src);
    };
};

// Real tracker implementation
function performTrackingSAD(ctx, currentX, currentY, templateData, width, height) {
    if (!templateData) return { x: currentX, y: currentY };

    let bestSAD = Infinity;
    let bestX = currentX;
    let bestY = currentY;

    // Limit search to SEARCH_SIZE
    const startX = Math.max(0, Math.floor(currentX - SEARCH_SIZE));
    const startY = Math.max(0, Math.floor(currentY - SEARCH_SIZE));
    const endX = Math.min(ctx.canvas.width - width, Math.floor(currentX + SEARCH_SIZE));
    const endY = Math.min(ctx.canvas.height - height, Math.floor(currentY + SEARCH_SIZE));

    // We need to access pixel data of the search window efficiently
    // Getting full image data of the search region
    const searchWidth = endX - startX + width;
    const searchHeight = endY - startY + height;

    if (searchWidth <= 0 || searchHeight <= 0) return { x: currentX, y: currentY };

    const sceneData = ctx.getImageData(startX, startY, searchWidth, searchHeight).data;

    // Iterate through all possible positions
    for (let y = 0; y <= endY - startY; y += 2) { // Step 2 for speed
        for (let x = 0; x <= endX - startX; x += 2) {
            let sad = 0;
            // Calculate SAD for this position
            for (let ty = 0; ty < height; ty += 2) { // Subsample template for speed
                for (let tx = 0; tx < width; tx += 2) {
                    const sceneIdx = ((y + ty) * searchWidth + (x + tx)) * 4;
                    const tempIdx = (ty * width + tx) * 4;

                    // Only use Green channel for matching (usually best contrast)
                    const diff = sceneData[sceneIdx + 1] - templateData[tempIdx + 1];
                    sad += Math.abs(diff);
                }
            }

            if (sad < bestSAD) {
                bestSAD = sad;
                bestX = startX + x + width / 2; // Center
                bestY = startY + y + height / 2;
            }
        }
    }

    return { x: bestX, y: bestY };
}


// Re-implement startAnalysis to use the proper tracker
// Mask-based Analysis
async function startAnalysis() {
    console.log("startAnalysis called");
    if (!videoFile) {
        console.error("No video file selected.");
        return;
    }
    if (!maskCanvas) {
        console.error("No mask canvas or mask not created.");
        alert("Please paint the heart region first.");
        return;
    }

    console.log("Calling fillMaskHoles...");
    try {
        fillMaskHoles(); // Auto-fill holes before analysis
        console.log("fillMaskHoles completed.");
    } catch (e) {
        console.error("Error in fillMaskHoles:", e);
    }

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    analyzeBtnText.textContent = "分析中... Analyzing...";
    console.log("State set to analyzing.");

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;

    try {
        console.log("Loading video for analysis...");
        await new Promise((resolve, reject) => {
            video.onloadeddata = () => {
                console.log("video.onloadeddata fired");
                resolve();
            };
            video.onerror = (e) => {
                console.error("video.onerror fired", e);
                reject("Video load failed");
            };
            // Add timeout
            setTimeout(() => {
                if (video.readyState >= 1) {
                    console.log("Timeout reached but video.readyState is sufficient (" + video.readyState + ")");
                    resolve();
                } else {
                    console.error("Video load timeout. ReadyState: " + video.readyState);
                    reject("Video load timeout");
                }
            }, 5000);
            video.load();
        });
        console.log("Video loaded successfully.");
    } catch (e) {
        console.error("Video load exception:", e);
        alert("影片載入失敗 (Video Load Failed): " + e);
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtnText.textContent = "開始分析 Start Analysis";
        return;
    }

    // Ensure metadata is loaded for valid duration
    console.log("Checking video duration:", video.duration);
    if (!Number.isFinite(video.duration)) {
        console.log("Duration infinite or NaN, trying to resolve...");
        video.currentTime = 1e101;
        await new Promise(r => {
            video.ondurationchange = () => {
                console.log("Duration changed to:", video.duration);
                video.currentTime = 0;
                r();
            };
        });
    }

    const duration = video.duration || 10; // fallback
    const targetFPS = 30;
    const totalFrames = Math.floor(duration * targetFPS);
    console.log(`Duration: ${duration}, Total Frames: ${totalFrames}`);
    const intensityData = [];

    // Calculate Center of Mass of the Mask
    console.log("Calculating Center of Mass...");
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    let sumX = 0, sumY = 0, count = 0;
    const activePixels = []; // relative coordinates {x, y} from CoM

    for (let y = 0; y < maskCanvas.height; y++) {
        for (let x = 0; x < maskCanvas.width; x++) {
            const idx = (y * maskCanvas.width + x) * 4;
            if (maskData.data[idx + 3] > 0) { // Alpha > 0
                sumX += x;
                sumY += y;
                count++;
            }
        }
    }

    console.log("Mask pixel count:", count);
    if (count === 0) {
        alert("Mask empty!");
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtnText.textContent = "開始分析 Start Analysis";
        return;
    }

    let centerX = sumX / count;
    let centerY = sumY / count;
    console.log(`Center of Mass: ${centerX}, ${centerY}`);

    // Store relative offsets
    for (let y = 0; y < maskCanvas.height; y++) {
        for (let x = 0; x < maskCanvas.width; x++) {
            const idx = (y * maskCanvas.width + x) * 4;
            if (maskData.data[idx + 3] > 0) {
                activePixels.push({ dx: x - centerX, dy: y - centerY });
            }
        }
    }

    // Prepare for tracking
    // For tracking, we use a region around the CoM
    ctx.drawImage(firstFrameImage, 0, 0);
    const templateSize = 64; // Larger template for stability
    const templateImageData = ctx.getImageData(
        Math.max(0, centerX - templateSize / 2),
        Math.max(0, centerY - templateSize / 2),
        templateSize,
        templateSize
    );

    let currentFrame = 0;

    const processChunk = async () => {
        // console.log(`Processing chunk starting at frame ${currentFrame}`); 
        // Can be too verbose, removed
        const startTime = performance.now();

        while (currentFrame < totalFrames) {
            if (performance.now() - startTime > 30) {
                const progress = Math.round((currentFrame / totalFrames) * 100);
                progressBar.style.width = `${progress}%`;
                analyzeBtnText.textContent = `分析中... Analyzing... ${progress}%`;
                await new Promise(requestAnimationFrame);
                if (!isAnalyzing) return;
                return processChunk();
            }

            const time = currentFrame / targetFPS;
            video.currentTime = time;

            // Wait for seek with timeout safety
            try {
                await new Promise((resolve, reject) => {
                    const seekHandler = () => {
                        video.removeEventListener('seeked', seekHandler);
                        resolve();
                    };
                    video.addEventListener('seeked', seekHandler);
                    // Timeout if seek takes too long (skip frame)
                    setTimeout(() => {
                        video.removeEventListener('seeked', seekHandler);
                        // console.warn(`Seek timeout at frame ${currentFrame}`);
                        resolve(); // Just continue with whatever we have
                    }, 500);
                });
            } catch (e) { console.warn("Frame seek error", e); }


            // Draw video to main canvas to read pixels
            ctx.drawImage(video, 0, 0);

            // Tracking
            if (currentFrame > 0) {
                // Track the CoM
                const bestMatch = performTrackingSAD(
                    ctx,
                    centerX,
                    centerY,
                    templateImageData.data,
                    templateSize,
                    templateSize
                );
                // Smooth update
                if (bestMatch) {
                    centerX = centerX * 0.7 + bestMatch.x * 0.3;
                    centerY = centerY * 0.7 + bestMatch.y * 0.3;
                }
            }

            // Extract Green Signal using Mask
            // We iterate over activePixels and sample at current (centerX + dx, centerY + dy)
            let greenSum = 0;
            let validPixels = 0;
            const width = videoCanvas.width;
            const height = videoCanvas.height;
            const frameData = ctx.getImageData(0, 0, width, height).data;

            // Optimization: If mask is huge, reading independent pixels is slow. 
            // Better to read bounding box.
            // But let's stick to simple implementation first, optimized by reading full frame once (done above)

            // Actually, `frameData` is huge array. access is `(y * w + x) * 4`
            for (let i = 0; i < activePixels.length; i += 4) { // SUBSAMPLE: Skip every 4th pixel for speed
                const px = Math.floor(centerX + activePixels[i].dx);
                const py = Math.floor(centerY + activePixels[i].dy);

                if (px >= 0 && px < width && py >= 0 && py < height) {
                    const idx = (py * width + px) * 4;
                    greenSum += frameData[idx + 1];
                    validPixels++;
                }
            }

            intensityData.push(greenSum / (validPixels || 1));

            currentFrame++;
        }

        console.log("Analysis complete. Finishing...");
        finishAnalysis(intensityData, targetFPS, duration);
        URL.revokeObjectURL(video.src);
    };

    console.log("Starting processing loop...");
    processChunk();
}

function getAverageGreen(ctx, x, y, size) {
    const startX = Math.floor(x - size / 2);
    const startY = Math.floor(y - size / 2);
    const imageData = ctx.getImageData(startX, startY, size, size);
    const data = imageData.data;

    let sum = 0;
    // data struct: r, g, b, a
    for (let i = 0; i < data.length; i += 4) {
        sum += data[i + 1]; // Green channel
    }
    return sum / (data.length / 4);
}

function finishAnalysis(rawSignal, fps, duration) {
    // 1. Detrend
    const detrended = detrendSignal(rawSignal);

    // 2. Filter (Bandpass + Smoothing)
    const filtered = processSignal(detrended, fps);

    // 3. Peak Detection
    const peaks = findPeaks(filtered, fps);

    // 4. Metrics
    const metrics = calculateMetrics(peaks, fps);

    // 5. Display
    displayResults(metrics, filtered, peaks, duration);

    isAnalyzing = false;
    analyzeBtn.disabled = false;
    analyzeBtnText.textContent = "再次分析 Analyze Again";
    analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
    analyzeBtn.classList.add('bg-gradient-to-r', 'from-blue-500', 'to-indigo-600', 'text-white');
    progressBar.style.width = '100%';
}

function detrendSignal(signal) {
    const n = signal.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += signal[i];
        sumXY += i * signal[i];
        sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return signal.map((y, i) => y - (slope * i + intercept));
}

function processSignal(signal, fps) {
    // Simple bandpass implementation
    // Low cut: 0.7 Hz (42 BPM) -> Use Moving Average Subtraction
    // High cut: 3.5 Hz (210 BPM) -> Use Smoothing

    const output = [];
    const windowSizeLow = Math.floor(fps / 0.7);
    const windowSizeHigh = Math.floor(fps / 4.0); // A bit aggressive smoothing

    for (let i = 0; i < signal.length; i++) {
        // High-pass (Removing baseline)
        let sumLow = 0;
        let countLow = 0;
        for (let j = Math.max(0, i - windowSizeLow / 2); j < Math.min(signal.length, i + windowSizeLow / 2); j++) {
            sumLow += signal[j];
            countLow++;
        }
        const baseline = sumLow / countLow;
        let val = signal[i] - baseline;

        // Low-pass (Smoothing high freq noise)
        // We can do this in a second pass or here implies local smoothing
        output.push(val);
    }

    // Second pass: Smoothing
    const smoothed = [];
    for (let i = 0; i < output.length; i++) {
        let sumHigh = 0;
        let countHigh = 0;
        for (let j = Math.max(0, i - 2); j <= Math.min(output.length - 1, i + 2); j++) { // 5-point moving average
            sumHigh += output[j];
            countHigh++;
        }
        smoothed.push(sumHigh / countHigh);
    }

    return smoothed;
}

function findPeaks(signal, fps) {
    const peaks = [];
    const minDistance = Math.floor(fps * 0.5); // min 0.5s between beats (max 120 BPM allowed for raw detection? No, min is for refractory period)
    // 0.5s = 30 frames * 0.5 = 15 frames. 
    // If HR is 180, period is 0.33s. 0.5s is too strict.
    // Let's use 0.3s (200 BPM)
    const minRefractory = Math.floor(fps * 0.33);

    // Dynamic thresholding
    // Calculate local max to adapt to amplitude changes
    const maxVal = Math.max(...signal);
    const minVal = Math.min(...signal);
    const threshold = maxVal * 0.3; // Simple relative threshold

    for (let i = 1; i < signal.length - 1; i++) {
        // Local maxima check
        if (signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
            if (signal[i] > threshold) {
                // Check distance
                if (peaks.length === 0 || (i - peaks[peaks.length - 1]) > minRefractory) {
                    peaks.push(i);
                } else {
                    // If too close, keep the higher one
                    const prev = peaks[peaks.length - 1];
                    if (signal[i] > signal[prev]) {
                        peaks[peaks.length - 1] = i;
                    }
                }
            }
        }
    }
    return peaks;
}

function calculateMetrics(peaks, fps) {
    if (peaks.length < 2) return { hr: 0, sdnn: 0, rmssd: 0 };

    const rrIntervals = []; // in ms
    for (let i = 1; i < peaks.length; i++) {
        const interval = ((peaks[i] - peaks[i - 1]) / fps) * 1000;
        rrIntervals.push(interval);
    }

    // Filter outlier R-R (simple artifact removal)
    const validRR = rrIntervals.filter(rr => rr > 300 && rr < 1500); // 40-200 BPM range

    if (validRR.length === 0) return { hr: 0, sdnn: 0, rmssd: 0 };

    const avgRR = validRR.reduce((a, b) => a + b, 0) / validRR.length;
    const hr = Math.round(60000 / avgRR);

    // SDNN
    const variance = validRR.reduce((sum, val) => sum + Math.pow(val - avgRR, 2), 0) / validRR.length;
    const sdnn = Math.round(Math.sqrt(variance));

    // RMSSD
    let sumSqDiff = 0;
    for (let i = 1; i < validRR.length; i++) {
        sumSqDiff += Math.pow(validRR[i] - validRR[i - 1], 2);
    }
    const rmssd = Math.round(Math.sqrt(sumSqDiff / (validRR.length - 1)));

    return { hr, sdnn, rmssd };
}

function displayResults(metrics, signal, peaks, duration) {
    resultsSection.classList.remove('hidden');

    // Update Text
    document.getElementById('resultHR').textContent = metrics.hr;
    document.getElementById('resultSDNN').textContent = metrics.sdnn;
    document.getElementById('resultRMSSD').textContent = metrics.rmssd;
    document.getElementById('resultDuration').textContent = duration.toFixed(1);

    // Verify FPS logic for user
    const effectiveFPS = signal.length / duration;
    console.log(`Chart Verification: Signal Length=${signal.length}, Duration=${duration.toFixed(2)}s, Effective FPS=${effectiveFPS.toFixed(2)}`);

    // Draw Chart
    const chartCanvas = document.getElementById('chartCanvas');
    const cCtx = chartCanvas.getContext('2d');
    const width = chartCanvas.width;
    const height = chartCanvas.height;

    // Layout constants
    const paddingBottom = 30;
    const paddingLeft = 40;
    const chartWidth = width - paddingLeft;
    const chartHeight = height - paddingBottom;

    cCtx.clearRect(0, 0, width, height);

    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const range = max - min || 1;

    // Helper to map Y
    const getY = (val) => chartHeight - ((val - min) / range) * (chartHeight * 0.8) - (chartHeight * 0.1);

    // Draw Grid & Labels
    cCtx.textAlign = 'center';
    cCtx.textBaseline = 'top';
    cCtx.fillStyle = '#6b7280'; // Gray-500
    cCtx.font = '12px Inter';
    cCtx.strokeStyle = '#e5e7eb'; // Gray-200
    cCtx.lineWidth = 1;

    // X-Axis (Time)
    cCtx.beginPath();
    const timeStep = duration <= 10 ? 1 : (duration <= 30 ? 5 : 10);
    for (let t = 0; t <= Math.floor(duration); t += timeStep) {
        const x = paddingLeft + (t / duration) * chartWidth;

        // Grid line
        cCtx.moveTo(x, 0);
        cCtx.lineTo(x, chartHeight);

        // Label
        cCtx.fillText(t + 's', x, chartHeight + 8);
    }

    // Y-Axis (Approximate Intensity)
    cCtx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
        const y = chartHeight * 0.1 + (chartHeight * 0.8) * (i / 4);
        cCtx.moveTo(paddingLeft, y);
        cCtx.lineTo(width, y);
        // cCtx.fillText((max - (range*(i/4))).toFixed(1), paddingLeft - 5, y - 6);
    }
    cCtx.stroke();

    // Border Lines
    cCtx.strokeStyle = '#9ca3af'; // Gray-400
    cCtx.beginPath();
    cCtx.moveTo(paddingLeft, 0);
    cCtx.lineTo(paddingLeft, chartHeight);
    cCtx.lineTo(width, chartHeight);
    cCtx.stroke();

    // Draw Signal
    cCtx.strokeStyle = '#3b82f6'; // Blue-500
    cCtx.lineWidth = 2;
    cCtx.beginPath();

    signal.forEach((val, i) => {
        const x = paddingLeft + (i / signal.length) * chartWidth;
        const y = getY(val);
        if (i === 0) cCtx.moveTo(x, y);
        else cCtx.lineTo(x, y);
    });
    cCtx.stroke();

    // Draw Peaks
    cCtx.fillStyle = '#ef4444'; // Red-500
    peaks.forEach(idx => {
        const x = paddingLeft + (idx / signal.length) * chartWidth;
        const y = getY(signal[idx]);
        cCtx.beginPath();
        cCtx.arc(x, y, 4, 0, 2 * Math.PI);
        cCtx.fill();
    });
}
