/* ============================================================
   FaceLens — App Logic (powered by face-api.js)
   ============================================================ */

const MODEL_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';

const state = {
  stream: null, running: false, mode: 'webcam', detector: 'tiny',
  options: { landmarks: true, expressions: true, ageGender: true, recognition: false },
  knownFaces: [],                 // { name, descriptor, avatar }
  frames: 0, fps: 0, lastFpsTime: 0,
  startTime: null, lastResults: [],
  pendingCapture: false,
};

const $ = (id) => document.getElementById(id);
const video = $('video');
const overlay = $('overlay');
const ctx = overlay.getContext('2d');

/* ---------- TOAST ---------- */
function toast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => $('toast').classList.remove('show'), 2400);
}

/* ---------- LOAD MODELS ---------- */
async function loadModels() {
  const steps = [
    { net: faceapi.nets.tinyFaceDetector, label: 'Loading face detector…' },
    { net: faceapi.nets.faceLandmark68Net, label: 'Loading landmarks…' },
    { net: faceapi.nets.faceExpressionNet, label: 'Loading expressions…' },
    { net: faceapi.nets.ageGenderNet, label: 'Loading age & gender…' },
    { net: faceapi.nets.faceRecognitionNet, label: 'Loading recognition…' },
    { net: faceapi.nets.ssdMobilenetv1, label: 'Loading SSD detector…' },
  ];
  for (let i = 0; i < steps.length; i++) {
    $('loaderStatus').textContent = steps[i].label;
    $('loaderBarFill').style.width = `${((i + 1) / steps.length) * 100}%`;
    await steps[i].net.loadFromUri(MODEL_URL);
  }
  $('loaderStatus').textContent = 'Ready.';
  setTimeout(() => {
    $('loader').classList.add('done');
    $('app').classList.remove('hidden');
  }, 400);
}

/* ---------- CAMERA ---------- */
async function startCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = state.stream;
    await video.play();
    $('stagePlaceholder').classList.add('hidden');
    $('btnStartCamera').classList.add('hidden');
    $('btnStopCamera').classList.remove('hidden');
    $('scanLine').classList.add('active');
    state.running = true;
    if (!state.startTime) state.startTime = Date.now();
    setupCanvas();
    state.lastFpsTime = performance.now();
    detectLoop();
    toast('Camera started');
  } catch (e) {
    console.error(e);
    toast('Camera access denied');
  }
}

function stopCamera() {
  if (state.stream) state.stream.getTracks().forEach(t => t.stop());
  state.stream = null; state.running = false;
  video.srcObject = null;
  $('stagePlaceholder').classList.remove('hidden');
  $('btnStartCamera').classList.remove('hidden');
  $('btnStopCamera').classList.add('hidden');
  $('scanLine').classList.remove('active');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
}

function setupCanvas() {
  overlay.width = video.videoWidth || 640;
  overlay.height = video.videoHeight || 480;
}

/* ---------- DETECTION LOOP ---------- */
function getDetectorOptions() {
  if (state.detector === 'ssd') return new faceapi.SsdMobilenetv1Options({ minConfidence: 0.45 });
  return new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
}

async function detectLoop() {
  if (!state.running) return;

  let task = faceapi.detectAllFaces(video, getDetectorOptions());
  if (state.options.landmarks)    task = task.withFaceLandmarks();
  if (state.options.expressions)  task = task.withFaceExpressions();
  if (state.options.ageGender)    task = task.withAgeAndGender();
  if (state.options.recognition)  task = task.withFaceDescriptors();

  let results = [];
  try { results = await task; } catch (e) { console.warn(e); }

  state.lastResults = results;
  drawOverlay(results);
  renderResults(results);

  // FPS
  state.frames++;
  const now = performance.now();
  if (now - state.lastFpsTime >= 1000) {
    state.fps = Math.round(state.frames * 1000 / (now - state.lastFpsTime));
    state.frames = 0;
    state.lastFpsTime = now;
    $('fpsCounter').textContent = state.fps + ' FPS';
    $('statFaces').textContent = results.length;
    $('statFrames').textContent = (parseInt($('statFrames').textContent) || 0) + 1;
    if (state.startTime) $('statTime').textContent = Math.floor((Date.now() - state.startTime) / 1000) + 's';
  }

  requestAnimationFrame(detectLoop);
}

/* ---------- DRAW OVERLAY ---------- */
function drawOverlay(results) {
  const w = overlay.width, h = overlay.height;
  ctx.clearRect(0, 0, w, h);

  results.forEach((r, idx) => {
    const box = r.detection.box;
    const x = box.x, y = box.y, bw = box.width, bh = box.height;

    // Glow box
    ctx.save();
    ctx.shadowColor = '#6C5CE7';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#00D2FF';
    ctx.lineWidth = 2;
    roundRect(ctx, x, y, bw, bh, 12);
    ctx.stroke();
    ctx.restore();

    // Corner accents
    const c = 18;
    ctx.strokeStyle = '#6C5CE7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
    ctx.moveTo(x + bw - c, y); ctx.lineTo(x + bw, y); ctx.lineTo(x + bw, y + c);
    ctx.moveTo(x + bw, y + bh - c); ctx.lineTo(x + bw, y + bh); ctx.lineTo(x + bw - c, y + bh);
    ctx.moveTo(x + c, y + bh); ctx.lineTo(x, y + bh); ctx.lineTo(x, y + bh - c);
    ctx.stroke();

    // Label
    const label = `Face ${idx + 1} · ${Math.round(r.detection.score * 100)}%`;
    ctx.font = '600 13px Inter, sans-serif';
    const tw = ctx.measureText(label).width + 16;
    ctx.fillStyle = 'rgba(108,92,231,0.9)';
    roundRect(ctx, x, y - 26, tw, 20, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x + 8, y - 12);

    // Landmarks
    if (r.landmarks) {
      const pts = r.landmarks.positions;
      ctx.fillStyle = '#00D2FF';
      ctx.shadowColor = '#00D2FF';
      ctx.shadowBlur = 6;
      pts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.shadowBlur = 0;
    }
  });
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/* ---------- RENDER RESULTS PANEL ---------- */
function renderResults(results) {
  if (!results.length) {
    $('resultEmpty').style.display = '';
    $('resultList').innerHTML = '';
    return;
  }
  $('resultEmpty').style.display = 'none';

  const html = results.map((r, i) => {
    let match = null;
    if (state.options.recognition && r.descriptor && state.knownFaces.length) {
      match = findBestMatch(r.descriptor);
    }
    const badge = match
      ? `<span class="result-badge badge-known">${match.name} · ${Math.round((1 - match.distance) * 100)}%</span>`
      : `<span class="result-badge badge-unknown">Unknown</span>`;

    let rows = '';
    rows += `<div class="result-row"><span class="result-key">Confidence</span><span class="result-val">${Math.round(r.detection.score * 100)}%</span></div>`;
    if (r.age != null) rows += `<div class="result-row"><span class="result-key">Age</span><span class="result-val">~${Math.round(r.age)}</span></div>`;
    if (r.gender) rows += `<div class="result-row"><span class="result-key">Gender</span><span class="result-val">${r.gender} · ${Math.round(r.genderProbability * 100)}%</span></div>`;

    let expressions = '';
    if (r.expressions) {
      const arr = Object.entries(r.expressions).sort((a, b) => b[1] - a[1]).slice(0, 4);
      expressions = `<div class="expressions-bar">` + arr.map(([k, v]) =>
        `<div class="expression-item">
          <span class="expression-name">${k}</span>
          <span class="expression-track"><span class="expression-fill" style="width:${(v * 100).toFixed(0)}%"></span></span>
          <span class="expression-pct">${(v * 100).toFixed(0)}%</span>
        </div>`).join('') + `</div>`;
    }

    return `<div class="result-card">
      <div class="result-card-header"><span class="result-card-title">Face ${i + 1}</span>${badge}</div>
      ${rows}${expressions}
    </div>`;
  }).join('');

  $('resultList').innerHTML = html;
}

function findBestMatch(desc) {
  let best = null, bestDist = Infinity;
  state.knownFaces.forEach(f => {
    const d = faceapi.euclideanDistance(desc, f.descriptor);
    if (d < bestDist) { bestDist = d; best = f; }
  });
  if (best && bestDist < 0.55) return { name: best.name, distance: bestDist };
  return null;
}

/* ---------- REGISTER FACE ---------- */
async function registerFace() {
  const name = $('personName').value.trim();
  if (!name) return toast('Enter a name first');
  if (!state.running) return toast('Start camera first');

  const det = await faceapi
    .detectSingleFace(video, getDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!det) return toast('No face detected — try again');

  const entry = {
    name,
    descriptor: det.descriptor,
    avatar: name.charAt(0).toUpperCase(),
  };
  state.knownFaces.push(entry);
  $('personName').value = '';
  renderKnownList();
  toast(`Registered: ${name}`);
  $('statKnown').textContent = state.knownFaces.length;
}

function renderKnownList() {
  $('knownList').innerHTML = state.knownFaces.map((f, i) =>
    `<div class="known-item">
      <div class="known-avatar">${f.avatar}</div>
      <div class="known-name">${f.name}</div>
      <button class="known-remove" data-i="${i}">×</button>
    </div>`).join('');
  document.querySelectorAll('.known-remove').forEach(btn => {
    btn.onclick = () => {
      state.knownFaces.splice(+btn.dataset.i, 1);
      renderKnownList();
      $('statKnown').textContent = state.knownFaces.length;
    };
  });
}

/* ---------- SNAPSHOT ---------- */
function captureSnapshot() {
  if (!state.running) return toast('Nothing to capture');
  const canvas = document.createElement('canvas');
  canvas.width = overlay.width;
  canvas.height = overlay.height;
  const c = canvas.getContext('2d');
  c.drawImage(video, 0, 0, canvas.width, canvas.height);
  c.drawImage(overlay, 0, 0, canvas.width, canvas.height);
  const a = document.createElement('a');
  a.download = `facelens-${Date.now()}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  toast('Snapshot saved');
}

/* ---------- UPLOAD MODE ---------- */
async function handleUpload(file) {
  const img = await faceapi.bufferToImage(file);
  // draw on hidden canvas → feed to detection
  const off = document.createElement('canvas');
  off.width = img.width; off.height = img.height;
  const oc = off.getContext('2d');
  oc.drawImage(img, 0, 0);

  let task = faceapi.detectAllFaces(off, getDetectorOptions());
  if (state.options.landmarks)   task = task.withFaceLandmarks();
  if (state.options.expressions) task = task.withFaceExpressions();
  if (state.options.ageGender)   task = task.withAgeAndGender();
  if (state.options.recognition) task = task.withFaceDescriptors();

  const results = await task;

  // Show image in the stage
  stopCamera();
  $('stagePlaceholder').classList.add('hidden');
  overlay.width = img.width;
  overlay.height = img.height;
  ctx.drawImage(img, 0, 0, img.width, img.height);
  // Scale overlay visually via CSS on video hidden
  video.style.display = 'none';
  overlay.style.position = 'relative';
  overlay.style.width = '100%';
  overlay.style.height = '100%';

  drawOverlay(results);
  renderResults(results);
  $('statFaces').textContent = results.length;
  toast(`${results.length} face(s) found`);
}

/* ---------- WIRE UP UI ---------- */
function bindUI() {
  // Mode
  $('btnWebcam').onclick = () => {
    state.mode = 'webcam';
    $('btnWebcam').classList.add('active');
    $('btnUpload').classList.remove('active');
    overlay.style.position = ''; overlay.style.width = ''; overlay.style.height = '';
    video.style.display = '';
    toast('Webcam mode');
  };
  $('btnUpload').onclick = () => {
    state.mode = 'upload';
    $('btnUpload').classList.add('active');
    $('btnWebcam').classList.remove('active');
    $('fileInput').click();
  };
  $('fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (f) handleUpload(f);
  };

  // Camera
  $('btnStartCamera').onclick = startCamera;
  $('btnStopCamera').onclick = stopCamera;

  // Toggles
  $('tLandmarks').onchange  = e => state.options.landmarks   = e.target.checked;
  $('tExpressions').onchange= e => state.options.expressions = e.target.checked;
  $('tAgeGender').onchange  = e => state.options.ageGender   = e.target.checked;
  $('tRecognition').onchange = e => {
    state.options.recognition = e.target.checked;
    $('recognitionSection').style.display = e.target.checked ? '' : 'none';
  };

  // Detector
  $('detectorSelect').onchange = e => state.detector = e.target.value;

  // Recognition
  $('btnAddPerson').onclick = registerFace;

  // Snapshot
  $('btnCapture').onclick = captureSnapshot;
}

/* ---------- BOOT ---------- */
window.addEventListener('load', () => {
  bindUI();
  loadModels().catch(err => {
    console.error(err);
    $('loaderStatus').textContent = 'Failed to load models. Check connection.';
  });
});
