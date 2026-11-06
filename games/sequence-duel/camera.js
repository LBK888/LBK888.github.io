const PACKAGE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const GESTURES = { Closed_Fist: 'R', Open_Palm: 'P', Victory: 'S' };

export class CameraInput {
  constructor(video, onReading, onStatus) {
    this.video = video;
    this.onReading = onReading;
    this.onStatus = onStatus;
    this.running = false;
    this.lastRead = 0;
    this.lastVideoTime = -1;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera needs HTTPS or localhost.');
    this.onStatus('REQUESTING CAMERA');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
      facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24, max: 30 },
    }});
    this.video.srcObject = this.stream;
    await this.video.play();
    this.onStatus('LOADING GESTURE MODEL');
    const { FilesetResolver, GestureRecognizer } = await import(`${PACKAGE}/vision_bundle.mjs`);
    const vision = await FilesetResolver.forVisionTasks(`${PACKAGE}/wasm`);
    try {
      this.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 2,
      });
    } catch {
      this.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2,
      });
    }
    this.running = true;
    this.onStatus('LIVE · ON DEVICE');
    this.loop();
  }

  loop() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime && now - this.lastRead >= 90) {
      this.lastRead = now;
      this.lastVideoTime = this.video.currentTime;
      try {
        const result = this.recognizer.recognizeForVideo(this.video, now);
        const hands = result.gestures?.length ?? 0;
        const gesture = hands === 1 ? result.gestures[0]?.[0] : null;
        this.onReading({
          move: gesture && gesture.score >= 0.7 ? GESTURES[gesture.categoryName] ?? null : null,
          confidence: gesture?.score ?? 0, hands, time: Date.now(),
        });
      } catch (error) {
        this.onStatus('RECOGNITION ERROR');
        this.onReading({ move: null, confidence: 0, hands: 0, time: Date.now() });
      }
    }
    requestAnimationFrame(() => this.loop());
  }

  stop() {
    this.running = false;
    this.recognizer?.close();
    this.recognizer = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
