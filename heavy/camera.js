/* Speechform Heavy: the camera.
 *
 * The feed itself, where the person is (a silhouette cut out on the device by MediaPipe's
 * selfie segmenter), and where they are moving (frame differencing on a small grid, the way
 * the EyeToy saw its players). Nothing from the camera leaves the device; the segmenter's
 * code and model are downloaded once from public CDNs and run in the page.
 */
const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const GW = 48, GH = 36;                         // the motion grid

export class Camera {
  constructor() {
    this.video = document.createElement('video');
    this.video.muted = true; this.video.playsInline = true;
    this.on = false; this.segmenter = null; this.maskReady = false;
    this.cut = document.createElement('canvas'); this.cut.width = 240; this.cut.height = 180;   // the person, cut out
    this.small = document.createElement('canvas'); this.small.width = GW; this.small.height = GH;
    this.prev = null; this.motion = new Float32Array(GW * GH);
    this.cues = { person: false, motion: 0, side: 'centre', head: null };
  }
  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.stream = stream; this.video.srcObject = stream; await this.video.play(); this.on = true;
    this.loadSegmenter();
  }
  stop() {
    this.on = false;
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    this.stream = null; this.cues = { person: false, motion: 0, side: 'centre', head: null };
  }
  async loadSegmenter() {
    if (this.segmenter) return;
    try {
      const { FilesetResolver, ImageSegmenter } = await import(MP + '/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(MP + '/wasm');
      this.segmenter = await ImageSegmenter.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' }, runningMode: 'VIDEO',
        outputCategoryMask: false, outputConfidenceMasks: true });
    } catch (e) { this.segmenter = null; console.warn('the silhouette is off:', e); }
  }
  /* called each frame: motion always, the silhouette a few times a second */
  update(t) {
    if (!this.on || this.video.readyState < 2) return;
    this.sense();
    if (this.segmenter && (!this._segAt || t - this._segAt > 90)) {
      this._segAt = t;
      try { this.segmenter.segmentForVideo(this.video, performance.now(), r => this.silhouette(r)); } catch (e) {}
    }
  }
  sense() {
    const c = this.small.getContext('2d', { willReadFrequently: true });
    c.save(); c.scale(-1, 1); c.drawImage(this.video, -GW, 0, GW, GH); c.restore();     // mirrored, as a mirror is
    const d = c.getImageData(0, 0, GW, GH).data, g = new Float32Array(GW * GH);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * .3 + d[i * 4 + 1] * .59 + d[i * 4 + 2] * .11) / 255;
    let sum = 0, sx = 0;
    if (this.prev) for (let i = 0; i < g.length; i++) {
      const m = Math.max(0, Math.abs(g[i] - this.prev[i]) - .06);
      this.motion[i] = this.motion[i] * .6 + m * 4 * .4; sum += this.motion[i]; sx += this.motion[i] * (i % GW);
    }
    this.prev = g;
    this.cues.motion = Math.min(1, sum / (GW * GH) * 6);
    const cx = sum ? sx / sum / GW : .5;
    this.cues.side = cx < .38 ? 'left' : cx > .62 ? 'right' : 'centre';
  }
  silhouette(result) {
    const m = result.confidenceMasks && result.confidenceMasks[0]; if (!m) return;
    const W = m.width, H = m.height, a = m.getAsFloat32Array();
    const c = this.cut.getContext('2d'), cw = this.cut.width, ch = this.cut.height;
    c.save(); c.scale(-1, 1); c.drawImage(this.video, -cw, 0, cw, ch); c.restore();
    const img = c.getImageData(0, 0, cw, ch); let on = 0, top = ch, sumX = 0, n = 0;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const mx = W - 1 - Math.floor(x / cw * W), my = Math.floor(y / ch * H);
      const v = a[my * W + mx], i = (y * cw + x) * 4;
      img.data[i + 3] = Math.max(0, Math.min(255, (v - .35) * 400));
      if (v > .5) { on++; if (y < top) top = y; if (y < ch * .5) { sumX += x; n++; } }
    }
    c.putImageData(img, 0, 0);
    m.close && m.close();
    this.maskReady = true;
    this.cues.person = on > cw * ch * .04;
    this.cues.head = this.cues.person && n ? { x: sumX / n / cw, y: top / ch } : null;
  }
  /* the grid cells that moved, as points in the square from 0 to 1 */
  hotspots(limit = 40) {
    const out = [];
    for (let i = 0; i < this.motion.length; i++) if (this.motion[i] > .35) out.push([(i % GW + .5) / GW, (Math.floor(i / GW) + .5) / GH, this.motion[i]]);
    return out.sort((a, b) => b[2] - a[2]).slice(0, limit);
  }
}
