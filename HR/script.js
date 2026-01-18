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
let selectedPoint = null;
let isAnalyzing = false;
const ctx = videoCanvas.getContext('2d', { willReadFrequently: true });

// Constants
const ROI_SIZE = 40;     // Region of Interest size
const TEMPLATE_SIZE = 32; // Template size for tracking (Smaller than TSX for speed)
const SEARCH_SIZE = 16;   // Search window size (+/- this amount)

// Event Listeners
uploadBtn.addEventListener('click', () => videoInput.click());

videoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type.startsWith('video/')) {
        videoFile = file;
        resetState();
        analysisSection.classList.remove('hidden');
        extractFirstFrame(file);
    }
});

videoCanvas.addEventListener('click', (e) => {
    if (!firstFrameImage || isAnalyzing) return;

    const rect = videoCanvas.getBoundingClientRect();
    const scaleX = videoCanvas.width / rect.width;
    const scaleY = videoCanvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    selectedPoint = { x, y };

    // Redraw frame and point
    ctx.drawImage(firstFrameImage, 0, 0);
    drawSelectedPoint(x, y);

    instructionText.textContent = "✓ 已選擇分析位置 Position selected";
    analyzeBtn.disabled = false;
    analyzeBtn.classList.remove('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
    analyzeBtn.classList.add('bg-gradient-to-r', 'from-green-500', 'to-emerald-600', 'text-white', 'hover:from-green-600', 'hover:to-emerald-700');
});

analyzeBtn.addEventListener('click', startAnalysis);

// Functions
function resetState() {
    selectedPoint = null;
    isAnalyzing = false;
    resultsSection.classList.add('hidden');
    progressContainer.classList.add('hidden');
    progressBar.style.width = '0%';
    instructionText.textContent = "點擊影像選擇心臟位置 Click to select heart position";
    analyzeBtn.disabled = true;
    analyzeBtn.classList.add('bg-gray-300', 'text-gray-500', 'cursor-not-allowed');
    analyzeBtn.classList.remove('bg-gradient-to-r', 'from-green-500', 'to-emerald-600', 'text-white', 'hover:from-green-600', 'hover:to-emerald-700');
}

function extractFirstFrame(file) {
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

async function startAnalysis() {
    if (!videoFile || !selectedPoint) return;

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    analyzeBtnText.textContent = "分析中... Analyzing...";

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.preload = 'auto';
    video.muted = true;

    await new Promise(r => video.onloadeddata = r);

    const duration = video.duration;
    // Limit processing FPS to save performance, if original is high
    const targetFPS = 30;
    const totalFrames = Math.floor(duration * targetFPS);
    const intensityData = [];
    const framePositions = [];

    let currentFrame = 0;
    let centerX = selectedPoint.x;
    let centerY = selectedPoint.y;

    // Main Processing Loop with time slicing
    const processChunk = async () => {
        const startTime = performance.now();

        while (currentFrame < totalFrames) {
            // Yield to UI thread every 50ms
            if (performance.now() - startTime > 50) {
                const progress = Math.round((currentFrame / totalFrames) * 100);
                progressBar.style.width = `${progress}%`;
                analyzeBtnText.textContent = `分析中... Analyzing... ${progress}%`;
                // Wait for next animation frame
                await new Promise(requestAnimationFrame);
                // Restart timer for next chunk
                return processChunk();
            }

            const time = currentFrame / targetFPS;
            video.currentTime = time;

            await new Promise(r => video.onseeked = r);

            ctx.drawImage(video, 0, 0);

            // Motion Tracking (skip first frame)
            if (currentFrame > 0) {
                const prevPos = framePositions[currentFrame - 1];
                const bestMatch = findBestMatchSAD(ctx, prevPos.x, prevPos.y);
                centerX = bestMatch.x;
                centerY = bestMatch.y;
            }

            framePositions.push({ x: centerX, y: centerY });

            // Draw tracking rect for visual feedback (optional, maybe too fast to see)
            // ctx.strokeStyle = 'yellow';
            // ctx.strokeRect(centerX - ROI_SIZE/2, centerY - ROI_SIZE/2, ROI_SIZE, ROI_SIZE);

            // Extract Signal
            const avgIntensity = getAverageGreen(ctx, centerX, centerY, ROI_SIZE);
            intensityData.push(avgIntensity);

            currentFrame++;
        }

        // Analysis Complete
        finishAnalysis(intensityData, targetFPS, duration);
        URL.revokeObjectURL(video.src);
    };

    processChunk();
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
async function startAnalysis() {
    if (!videoFile || !selectedPoint) return;

    isAnalyzing = true;
    analyzeBtn.disabled = true;
    progressContainer.classList.remove('hidden');
    analyzeBtnText.textContent = "分析中... Analyzing...";

    const video = document.createElement('video');
    video.src = URL.createObjectURL(videoFile);
    video.preload = 'auto';
    video.muted = true;

    await new Promise(r => video.onloadeddata = r);

    const duration = video.duration;
    const targetFPS = 30;
    const totalFrames = Math.floor(duration * targetFPS);
    const intensityData = [];

    let currentFrame = 0;
    let centerX = selectedPoint.x;
    let centerY = selectedPoint.y;

    // Capture Reference Template from First Frame (already drawn on canvas? No, canvas might be dirty)
    // We should redraw first frame to be sure
    ctx.drawImage(firstFrameImage, 0, 0);
    const templateWidth = TEMPLATE_SIZE;
    const templateHeight = TEMPLATE_SIZE;
    const templateImageData = ctx.getImageData(
        centerX - templateWidth / 2,
        centerY - templateHeight / 2,
        templateWidth,
        templateHeight
    );

    const processChunk = async () => {
        const startTime = performance.now();

        while (currentFrame < totalFrames) {
            if (performance.now() - startTime > 30) { // 30ms budget
                const progress = Math.round((currentFrame / totalFrames) * 100);
                progressBar.style.width = `${progress}%`;
                analyzeBtnText.textContent = `分析中... Analyzing... ${progress}%`;
                await new Promise(requestAnimationFrame);
                if (!isAnalyzing) return; // Exit if cancelled ? (not implemented)
                return processChunk();
            }

            const time = currentFrame / targetFPS;
            video.currentTime = time;

            await new Promise(r => video.onseeked = r);

            ctx.drawImage(video, 0, 0);

            // Motion Tracking using Reference Template
            if (currentFrame > 0) {
                const bestMatch = performTrackingSAD(
                    ctx,
                    centerX,
                    centerY,
                    templateImageData.data,
                    templateWidth,
                    templateHeight
                );
                // Apply some smoothing to the position to avoid jitter
                centerX = centerX * 0.5 + bestMatch.x * 0.5;
                centerY = centerY * 0.5 + bestMatch.y * 0.5;
            }

            // Extract Signal
            const avgIntensity = getAverageGreen(ctx, centerX, centerY, ROI_SIZE);
            intensityData.push(avgIntensity);

            currentFrame++;
        }

        finishAnalysis(intensityData, targetFPS, duration);
        URL.revokeObjectURL(video.src);
    };

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

    // Draw Chart
    const chartCanvas = document.getElementById('chartCanvas');
    const cCtx = chartCanvas.getContext('2d');
    const width = chartCanvas.width;
    const height = chartCanvas.height;

    cCtx.clearRect(0, 0, width, height);

    const min = Math.min(...signal);
    const max = Math.max(...signal);
    const range = max - min || 1;

    // Grid
    cCtx.strokeStyle = '#f0f0f0';
    cCtx.lineWidth = 1;
    cCtx.beginPath();
    for (let i = 0; i < width; i += width / 10) { cCtx.moveTo(i, 0); cCtx.lineTo(i, height); }
    for (let i = 0; i < height; i += height / 4) { cCtx.moveTo(0, i); cCtx.lineTo(width, i); }
    cCtx.stroke();

    // Signal
    cCtx.strokeStyle = '#3b82f6';
    cCtx.lineWidth = 2;
    cCtx.beginPath();

    const getY = (val) => height - ((val - min) / range) * (height * 0.8) - (height * 0.1);

    signal.forEach((val, i) => {
        const x = (i / signal.length) * width;
        const y = getY(val);
        if (i === 0) cCtx.moveTo(x, y);
        else cCtx.lineTo(x, y);
    });
    cCtx.stroke();

    // Peaks
    cCtx.fillStyle = '#ef4444';
    peaks.forEach(idx => {
        const x = (idx / signal.length) * width;
        const y = getY(signal[idx]);
        cCtx.beginPath();
        cCtx.arc(x, y, 4, 0, 2 * Math.PI);
        cCtx.fill();
    });
}
