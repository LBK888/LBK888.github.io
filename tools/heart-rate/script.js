
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
const resultVideo = document.getElementById('resultVideo');
const durationSelect = document.getElementById('durationSelect');

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
const SEARCH_SIZE = 32;   // Search window size (+/- this amount)

// Event Listeners
uploadBtn.addEventListener('click', () => videoInput.click());

videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    loadingMessage.textContent = "Waiting for video loading...";
    if (file && file.type.startsWith('video/')) {
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
    console.log("extractFirstFrame: Started with file:", file.name, file.type, file.size);
    loadingMessage.classList.remove('hidden');
    loadingMessage.textContent = "1/4 準備讀取 (Initializing)...";

    // Create video element
    const video = document.createElement('video');
    video.preload = 'auto'; // Force auto for better mobile support
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true; // Critical for iOS

    // Fail-safe Timeout (5 seconds)
    // If video loading hangs (common on some Android webviews or restricted iOS contexts),
    // we force a fallback so the user isn't stuck.
    const loadTimeout = setTimeout(() => {
        if (loadingMessage.classList.contains('hidden')) return;

        console.warn("extractFirstFrame: 5s Timeout reached. Forcing fallback display.");
        loadingMessage.textContent = "回應逾時，嘗試強制顯示 (Timeout, forcing display)...";

        // Attempt to just draw whatever state the video is in
        try {
            if (video.videoWidth > 0 && video.videoHeight > 0) {
                videoCanvas.width = video.videoWidth;
                videoCanvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
            } else {
                // Even if dimensions unknown, try standard execution or just fail gracefully
                videoCanvas.width = 640;
                videoCanvas.height = 480;
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, 640, 480);
                ctx.fillStyle = '#fff';
                ctx.fillText("Preview Unavailable", 20, 50);
            }

            firstFrameImage = new Image();
            firstFrameImage.src = videoCanvas.toDataURL();
            loadingMessage.classList.add('hidden');
            URL.revokeObjectURL(video.src);
            instructionText.textContent = "已強制載入 (Force Loaded). " + instructionText.textContent;

        } catch (e) {
            console.error("Fallback failed:", e);
            loadingMessage.textContent = "載入失敗 (Load Failed): Timeout";
        }
    }, 5000);

    video.onloadedmetadata = () => {
        console.log("extractFirstFrame: Metadata loaded.", video.videoWidth, "x", video.videoHeight, "Duration:", video.duration);
        loadingMessage.textContent = "2/4 讀取資訊 (Metadata Loaded)...";

        videoCanvas.width = video.videoWidth;
        videoCanvas.height = video.videoHeight;

        // Mobile Fix: Check aspect ratio
        const aspect = video.videoWidth / video.videoHeight;
        const container = videoCanvas.parentElement;
        if (aspect < 1) { // Vertical video
            container.classList.remove('aspect-video');
            container.style.height = '60vh'; // Constrain height on mobile
            container.classList.add('h-[60vh]', 'w-auto');
            videoCanvas.style.height = '100%';
            videoCanvas.style.width = 'auto';
        } else {
            // Reset for horizontal
            container.classList.add('aspect-video');
            container.style.height = '';
            container.classList.remove('h-[60vh]', 'w-auto');
            videoCanvas.style.width = '100%';
            videoCanvas.style.height = 'auto';
        }

        // Seek to 1st frame explicitly
        video.currentTime = 0.1;
    };

    video.onloadeddata = () => {
        console.log("extractFirstFrame: Data loaded. ReadyState:", video.readyState);
        loadingMessage.textContent = "3/4 緩衝完成 (Data Loaded)...";
    };

    video.onseeked = () => {
        console.log("extractFirstFrame: Seeked. Drawing frame.");
        loadingMessage.textContent = "4/4 擷取畫面 (Capturing Frame)...";

        clearTimeout(loadTimeout);

        videoCanvas.width = video.videoWidth;
        videoCanvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);

        firstFrameImage = new Image();
        firstFrameImage.onload = () => {
            console.log("extractFirstFrame: Image object ready.");
            loadingMessage.classList.add('hidden');
            URL.revokeObjectURL(video.src);
        };
        firstFrameImage.src = videoCanvas.toDataURL();
    };

    video.onerror = (e) => {
        clearTimeout(loadTimeout);
        console.error("extractFirstFrame: Video Error", video.error);
        const errCode = video.error ? video.error.code : 'Unknown';
        const errMsg = video.error ? video.error.message : 'Unknown';
        loadingMessage.textContent = `Error: ${errMsg} (${errCode})`;
        alert(`無法識別影片格式或編碼 (Video Error ${errCode}).\n請確認影片是否為標準 MP4/MOV 格式。`);
    };

    // Trigger load
    video.load();
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


// Real tracker implementation using Mean-Subtracted SAD (MSSAD)
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
    const searchWidth = endX - startX + width;
    const searchHeight = endY - startY + height;

    if (searchWidth <= 0 || searchHeight <= 0) return { x: currentX, y: currentY };

    const sceneData = ctx.getImageData(startX, startY, searchWidth, searchHeight).data;

    // 1. Calculate Mean of Template (RGB Average)
    let sumTemplate = 0;
    let countTemplate = 0;
    for (let i = 0; i < templateData.length; i += 4) {
        // RGB Average
        const intensity = (templateData[i] + templateData[i + 1] + templateData[i + 2]) / 3;
        sumTemplate += intensity;
        countTemplate++;
    }
    const meanTemplate = sumTemplate / countTemplate;

    // Iterate through all possible positions
    for (let y = 0; y <= endY - startY; y += 3) { // Step 3 for speed
        for (let x = 0; x <= endX - startX; x += 3) {

            // 2. Calculate Mean of Current Block (RGB Average)
            let sumBlock = 0;
            let countBlock = 0;
            for (let ty = 0; ty < height; ty += 3) {
                for (let tx = 0; tx < width; tx += 3) {
                    const sceneIdx = ((y + ty) * searchWidth + (x + tx)) * 4;
                    const intensity = (sceneData[sceneIdx] + sceneData[sceneIdx + 1] + sceneData[sceneIdx + 2]) / 3;
                    sumBlock += intensity;
                    countBlock++;
                }
            }
            const meanBlock = sumBlock / countBlock;

            // 3. Calculate MSSAD
            let sad = 0;
            for (let ty = 0; ty < height; ty += 2) { // Subsample template for speed
                for (let tx = 0; tx < width; tx += 2) {
                    const sceneIdx = ((y + ty) * searchWidth + (x + tx)) * 4;
                    const tempIdx = (ty * width + tx) * 4;

                    const valScene = (sceneData[sceneIdx] + sceneData[sceneIdx + 1] + sceneData[sceneIdx + 2]) / 3;
                    const valTemplate = (templateData[tempIdx] + templateData[tempIdx + 1] + templateData[tempIdx + 2]) / 3;

                    // Mean-Subtracted Difference
                    const diff = (valScene - meanBlock) - (valTemplate - meanTemplate);
                    sad += Math.abs(diff);
                }
            }

            if (sad < bestSAD) {
                bestSAD = sad;
                bestX = startX + x; //+ width / 2; // Center
                bestY = startY + y;//+ height / 2;
            }
        }
    }

    return { x: bestX, y: bestY };
}


async function generateResultVideo(video, trajectory, signal, totalFrames, fps, bboxWidth, bboxHeight) {
    // Reset Video
    video.currentTime = 0;

    // Setup Canvas for recording (Cropped Size)
    // Use Bounding Box size for crop context (with some padding)
    // Ensure min size of 320 for visibility if box is small
    const padding = 50;
    const targetSize = Math.max(320, Math.max(bboxWidth, bboxHeight) + padding * 2);
    const cropSize = Math.floor(targetSize);

    // Start Recorder
    const stream = videoCanvas.captureStream(30);
    const mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' }); // Try VP9 for better quality
    const chunks = [];
    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.start();

    let currentFrame = 0;
    const processGenChunk = async () => {
        const startTime = performance.now();

        while (currentFrame < totalFrames) {
            if (performance.now() - startTime > 30) {
                const progress = Math.round((currentFrame / totalFrames) * 100);
                progressBar.style.width = `${progress}%`;
                analyzeBtnText.textContent = `產生影片中... Generating... ${progress}%`;
                await new Promise(requestAnimationFrame);
                return processGenChunk();
            }

            // Seek
            const time = currentFrame / fps;
            video.currentTime = time;

            // Wait for seek (Fast simple wait)
            await new Promise(r => {
                const h = () => { video.removeEventListener('seeked', h); r(); };
                video.addEventListener('seeked', h);
                // Fallback
                setTimeout(h, 200);
            });

            // Tracking Center
            const track = trajectory[currentFrame] || trajectory[0];
            const cx = track.x;
            const cy = track.y;

            // Draw Cropped Video
            // Source: [cx - cropSize/2, cy - cropSize/2, cropSize, cropSize]
            // Dest: [0, 0, canvas.width, canvas.height] 
            // We want to fill the canvas with the cropped view

            // Clear
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, videoCanvas.width, videoCanvas.height);

            const sx = Math.max(0, cx - cropSize / 2);
            const sy = Math.max(0, cy - cropSize / 2);
            // Ensure we don't go out of bounds
            // Actually drawImage handles out of bounds by clipping, but let's be safe?
            // drawImage(padding) is complex. 
            // Simplified:
            ctx.drawImage(video, sx, sy, cropSize, cropSize, 0, 0, videoCanvas.width, videoCanvas.height);

            // Draw Overlay: Signal
            // Draw a graph at bottom 30%
            const graphHeight = videoCanvas.height * 0.3;
            const graphY = videoCanvas.height - graphHeight;

            // Background for graph
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(0, graphY, videoCanvas.width, graphHeight);

            // Plot Signal
            // Normalize signal to fit graph
            const snippetWidth = 150; // Show window of frames
            const startIdx = Math.max(0, currentFrame - snippetWidth);
            const endIdx = Math.min(signal.length, currentFrame + 50);

            // Find min/max in this window for scaling? Or global? Global is more stable.
            // Let's use global min/max of the signal
            const minVal = Math.min(...signal);
            const maxVal = Math.max(...signal);
            const range = maxVal - minVal || 1;

            ctx.beginPath();
            ctx.strokeStyle = '#00ff00'; // Green line
            ctx.lineWidth = 2;

            for (let i = startIdx; i < endIdx; i++) {
                const val = signal[i];
                // Map X: Based on position in window relative to currentFrame?
                // Let's put currentFrame at center of graph X?
                // Or just scrolling left?
                // Scroll: i maps to x pixel.
                // Map i based on (currentFrame - snippetWidth) -> 0

                const relI = i - (currentFrame - snippetWidth / 2); // Center current frame
                const x = (relI / snippetWidth) * videoCanvas.width;

                const normalizedY = (val - minVal) / range;
                const y = graphY + graphHeight - (normalizedY * graphHeight * 0.8) - (graphHeight * 0.1);

                if (i === startIdx) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();

            // Draw Vertical Line at Current Frame
            const centerX = videoCanvas.width / 2;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(centerX, graphY);
            ctx.lineTo(centerX, videoCanvas.height);
            ctx.stroke();

            // Value Text
            ctx.fillStyle = '#ffffff';
            ctx.font = '16px monospace';
            ctx.fillText(signal[currentFrame]?.toFixed(2) || "...", centerX + 5, graphY + 20);

            currentFrame++;
        }

        mediaRecorder.stop();
        mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            resultVideo.src = URL.createObjectURL(blob);

            // Cleanup & Restore UI
            URL.revokeObjectURL(video.src);

            // Finalize UI State (Now we can call the UI reset parts of finishAnalysis)
            // We modified finishAnalysis to return data, now we need to do the UI updates manually or split finishAnalysis.
            // Let's add a `updateUI` to finishAnalysis or just do it here.

            // Call the UI part of finishAnalysis?
            // Actually, `finishAnalysis` was calling `displayResults`.
            // We need to ensure `displayResults` runs.

            // Let's modify finishAnalysis to separate calculation and UI.
            // For now, assume finishAnalysis did the calculation and displayResults, 
            // but we passed false to it to skip the "Reset Button" part.

            // Manually do the final UI reset
            isAnalyzing = false;
            analyzeBtn.disabled = false;
            analyzeBtnText.textContent = "再次分析 Analyze Again";
            analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            analyzeBtn.classList.add('bg-gradient-to-r', 'from-blue-500', 'to-indigo-600', 'text-white');
            progressBar.style.width = '100%';

            // Clear Mask & Reset for new analysis
            maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
            maskCanvas = null;
            maskCtx = null;

            // Redraw first frame (clears red overlay)
            ctx.drawImage(firstFrameImage, 0, 0);

            // Reset State
            instructionText.textContent = "分析完成。 (Analysis Done)";
            analyzeBtn.disabled = true;
            analyzeBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
            analyzeBtn.classList.remove('bg-gradient-to-r', 'from-blue-500', 'to-indigo-600', 'text-white');
            analyzeBtnText.textContent = "請重新選擇區域 Select Region";
        };
    };

    processGenChunk();
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
    const selectedDuration = durationSelect.value;
    let limitDuration = duration;
    if (selectedDuration !== 'full') {
        limitDuration = Math.min(duration, parseInt(selectedDuration));
    }

    const durationToUse = limitDuration;
    const targetFPS = 30;
    const totalFrames = Math.floor(durationToUse * targetFPS);
    console.log(`Duration: ${duration} (Limit: ${limitDuration}), Total Frames to process: ${totalFrames}`);
    const intensityData = [];

    // Calculate Center of Mass of the Mask
    // Calculate Bounding Box of the Mask
    console.log("Calculating Bounding Box...");
    const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
    let minX = maskCanvas.width, minY = maskCanvas.height, maxX = 0, maxY = 0;
    let hasPixels = false;

    for (let y = 0; y < maskCanvas.height; y++) {
        for (let x = 0; x < maskCanvas.width; x++) {
            const idx = (y * maskCanvas.width + x) * 4;
            if (maskData.data[idx + 3] > 0) { // Alpha > 0
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                hasPixels = true;
            }
        }
    }

    if (!hasPixels) {
        alert("Mask empty!");
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtnText.textContent = "開始分析 Start Analysis";
        return;
    }

    const bboxWidth = maxX - minX;
    const bboxHeight = maxY - minY;
    let centerX = minX + bboxWidth / 2;
    let centerY = minY + bboxHeight / 2;
    console.log(`Bounding Box: ${bboxWidth}x${bboxHeight} at ${centerX}, ${centerY}`);

    // No need to store activePixels anymore, we will use the BBox area directly

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
    const trackingTrajectory = []; // Store {x, y} for Pass 2

    // Pass 1: Analysis & Tracking
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

            // Visual Tracking Feedback (Draw on main canvas for Debug Video)
            if (currentFrame > 0 && maskCanvas) {
                // Draw a rectangle around the tracked center (Bounding Box)
                ctx.strokeStyle = '#00ff00';
                ctx.lineWidth = 2;
                ctx.strokeRect(centerX - bboxWidth / 2, centerY - bboxHeight / 2, bboxWidth, bboxHeight);

                // Optional: Draw the mask overlay lightly
                // ctx.globalAlpha = 0.3;
                // ctx.drawImage(maskCanvas, 0, 0);
                // ctx.globalAlpha = 1.0;
            }

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

            // Store Trajectory for Pass 2
            trackingTrajectory.push({ x: centerX, y: centerY });

            // Extract RGB Average Signal using Bounding Box
            // Read pixels from the Bounding Box area centered at (centerX, centerY)
            const boxX = Math.floor(centerX - bboxWidth / 2);
            const boxY = Math.floor(centerY - bboxHeight / 2);
            const boxW = Math.floor(bboxWidth);
            const boxH = Math.floor(bboxHeight);

            // Boundary checks
            const sx = Math.max(0, boxX);
            const sy = Math.max(0, boxY);
            const ex = Math.min(videoCanvas.width, boxX + boxW);
            const ey = Math.min(videoCanvas.height, boxY + boxH);
            const sw = ex - sx;
            const sh = ey - sy;

            if (sw > 0 && sh > 0) {
                const frameData = ctx.getImageData(sx, sy, sw, sh).data;
                let sumRGB = 0;
                // Sum all pixels in the box
                for (let i = 0; i < frameData.length; i += 4) {
                    sumRGB += (frameData[i] + frameData[i + 1] + frameData[i + 2]) / 3;
                }
                const count = frameData.length / 4;
                intensityData.push(sumRGB / count);
            } else {
                intensityData.push(intensityData.length > 0 ? intensityData[intensityData.length - 1] : 0); // Fill previous or 0
            }

            currentFrame++;
        }

        console.log("Analysis Pass 1 complete.");

        // Finish Analysis (Signal Processing)
        const processedData = finishAnalysis(intensityData, targetFPS, durationToUse, false); // Pass false to not reset UI yet

        // Pass 2: Generate Video
        analyzeBtnText.textContent = "產生影片中... Generating Video...";
        await generateResultVideo(video, trackingTrajectory, processedData.filtered, totalFrames, targetFPS, bboxWidth, bboxHeight);
    };

    console.log("Starting processing loop...");
    processChunk();
}



function finishAnalysis(rawSignal, fps, duration, resetUI = true) {
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

    if (resetUI) {
        isAnalyzing = false;
        analyzeBtn.disabled = false;
        analyzeBtnText.textContent = "再次分析 Analyze Again";
        analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
        analyzeBtn.classList.add('bg-gradient-to-r', 'from-blue-500', 'to-indigo-600', 'text-white');
        progressBar.style.width = '100%';

        // Clear Mask & Reset for new analysis
        maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
        maskCanvas = null;
        maskCtx = null;

        // Redraw first frame (clears red overlay)
        ctx.drawImage(firstFrameImage, 0, 0);

        // Reset State
        instructionText.textContent = "分析完成。 (Analysis Done)";
        analyzeBtn.disabled = true; // Disable until new drawing
        analyzeBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
        analyzeBtn.classList.remove('bg-gradient-to-r', 'from-blue-500', 'to-indigo-600', 'text-white');
        analyzeBtnText.textContent = "請重新選擇區域 Select Region";
    }

    return { filtered, metrics };
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
    const minRefractory = Math.floor(fps * 0.1);
    const windowSize = minRefractory * 30;

    for (let i = 1; i < signal.length - 1; i++) {
        // Calculate Local Max in the window
        const start = Math.max(0, i - Math.floor(windowSize / 2));
        const end = Math.min(signal.length, i + Math.floor(windowSize / 2));

        let localMax = -Infinity;
        for (let j = start; j < end; j++) {
            if (signal[j] > localMax) localMax = signal[j];
        }

        // Dynamic threshold (50% of local max amplitude)
        // Ensure we are looking at positive peaks relative to baseline (0)
        // If signal is very low, localMax might be noise.
        const threshold = localMax * 0.15;

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
    const validRR = rrIntervals.filter(rr => rr > 200 && rr < 1500); // 40-300 BPM range

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
