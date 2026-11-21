// 設定成 './target.jpg' 即可使用同資料夾中的圖片。空字串會使用內建測試圖。
const TARGET_URL = './test.png';
const MATCH_THRESHOLD = 0.78;
const REQUIRED_FRAMES = 3;
const FRAME_INTERVAL = 300;
const GRID = 48;

const video = document.querySelector('video');
const guide = document.querySelector('.guide');
const stage = document.querySelector('.stage');
const preview = document.querySelector('#reference');
const result = document.querySelector('#result');
const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
const file = document.querySelector('#file');
const fileButton = document.querySelector('#fileButton');
const grid = document.createElement('canvas');
grid.width = grid.height = GRID;
const pixels = grid.getContext('2d', { willReadFrequently: true });
let reference, aspect, stream, interval, crop;
let cameraGeneration = 0;
let matchingFrames = 0;

// To react to a confirmed match, listen for 'image-match' on document.
function report(message, matched = false) {
  const wasMatched = result.dataset.match === 'true';
  if (result.textContent !== message) result.textContent = message;
  result.dataset.match = String(matched);
  if (matched && !wasMatched) document.dispatchEvent(new Event('image-match'));
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = url;
  });
}

function sampleDemo() {
  preview.width = 480;
  preview.height = 320;
  const ctx = preview.getContext('2d');
  ctx.fillStyle = '#102638';
  ctx.fillRect(0, 0, 480, 320);
  ctx.fillStyle = '#e8b354';
  ctx.beginPath();
  ctx.arc(358, 95, 51, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#60d8ba';
  ctx.beginPath();
  ctx.moveTo(0, 265);
  ctx.lineTo(155, 72);
  ctx.lineTo(326, 265);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('SCAN TEST', 252, 275);
}

function signal(source, { x, y, w, h }) {
  pixels.fillStyle = '#fff';
  pixels.fillRect(0, 0, GRID, GRID);
  pixels.drawImage(source, x, y, w, h, 0, 0, GRID, GRID);
  const rgba = pixels.getImageData(0, 0, GRID, GRID).data;
  const gray = new Float32Array(GRID * GRID);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return gray;
}

function correlate(left, right) {
  let sumA = 0, sumB = 0, squareA = 0, squareB = 0, product = 0;
  for (let i = 0; i < left.length; i++) {
    const a = left[i], b = right[i];
    sumA += a;
    sumB += b;
    squareA += a * a;
    squareB += b * b;
    product += a * b;
  }
  const n = left.length;
  const varA = squareA - sumA * sumA / n;
  const varB = squareB - sumB * sumB / n;
  if (varA < n * 9 || varB < n * 9) return 0;
  return (product - sumA * sumB / n) / Math.sqrt(varA * varB);
}

function edges(gray) {
  const gradients = new Float32Array((GRID - 2) ** 2 * 2);
  let index = 0;
  for (let y = 1; y < GRID - 1; y++) {
    for (let x = 1; x < GRID - 1; x++) {
      const i = y * GRID + x;
      gradients[index++] = gray[i + 1] - gray[i - 1];
      gradients[index++] = gray[i + GRID] - gray[i - GRID];
    }
  }
  return gradients;
}

function similarity(source, region) {
  const gray = signal(source, region);
  return 0.55 * correlate(reference.gray, gray) +
    0.45 * correlate(reference.edges, edges(gray));
}

function centered(width, height, fill) {
  const w = Math.min(width, height * aspect) * fill;
  const h = w / aspect;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function positionGuide() {
  const width = video.videoWidth, height = video.videoHeight;
  if (!width || !height || !stream) return;
  crop = centered(width, height, 0.82);
  const scale = Math.min(stage.clientWidth / width, stage.clientHeight / height);
  guide.style.left = ((stage.clientWidth - width * scale) / 2 + crop.x * scale) + 'px';
  guide.style.top = ((stage.clientHeight - height * scale) / 2 + crop.y * scale) + 'px';
  guide.style.width = crop.w * scale + 'px';
  guide.style.height = crop.h * scale + 'px';
  guide.hidden = false;
}

function scan() {
  if (!crop || video.readyState < 2) return;
  const score = Math.max(...[1, 0.95, 1.05].map(scale => similarity(video, {
    x: crop.x + crop.w * (1 - scale) / 2,
    y: crop.y + crop.h * (1 - scale) / 2,
    w: crop.w * scale,
    h: crop.h * scale
  })));
  matchingFrames = score >= MATCH_THRESHOLD ? matchingFrames + 1 : 0;
  if (matchingFrames >= REQUIRED_FRAMES) report('圖片相符', true);
  else if (matchingFrames > 0) report('正在確認，請保持穩定…');
  else report('尚未辨識到相符圖片');
}

function closeCamera() {
  cameraGeneration++;
  clearInterval(interval);
  stream?.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  crop = null;
  matchingFrames = 0;
  guide.hidden = true;
  start.disabled = !reference;
  stop.disabled = true;
}

start.addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    report('請使用 HTTPS 網址開啟此頁，或使用「選圖測試」。');
    return;
  }
  const generation = ++cameraGeneration;
  start.disabled = true;
  stop.disabled = false;
  report('正在開啟相機…');
  try {
    const incoming = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
    });
    if (generation !== cameraGeneration) {
      incoming.getTracks().forEach(track => track.stop());
      return;
    }
    stream = incoming;
    video.srcObject = stream;
    await video.play();
    if (generation !== cameraGeneration) return;
    positionGuide();
    report('請把圖片對準綠框。');
    interval = setInterval(scan, FRAME_INTERVAL);
  } catch (error) {
    if (generation !== cameraGeneration) return;
    closeCamera();
    report(error.name === 'NotAllowedError'
      ? '請在瀏覽器設定允許相機權限，再試一次。'
      : '無法開啟相機。請確認裝置有可用相機，或使用「選圖測試」。');
  }
});

stop.addEventListener('click', () => {
  closeCamera();
  report('相機已關閉。');
});
window.addEventListener('pagehide', closeCamera);
window.addEventListener('resize', positionGuide);
video.addEventListener('resize', positionGuide);

fileButton.addEventListener('click', () => file.click());
file.addEventListener('change', async () => {
  const selected = file.files[0];
  file.value = '';
  if (!selected) return;
  closeCamera();
  const generation = cameraGeneration;
  const url = URL.createObjectURL(selected);
  try {
    const image = await loadImage(url);
    if (generation !== cameraGeneration) return;
    const score = similarity(image, centered(image.naturalWidth, image.naturalHeight, 1));
    const matched = score >= MATCH_THRESHOLD;
    report(matched ? '圖片相符' : '圖片未達相符門檻', matched);
  } catch {
    if (generation === cameraGeneration) report('無法讀取這張圖片，請改用 JPG 或 PNG。');
  } finally {
    URL.revokeObjectURL(url);
  }
});

async function initialize() {
  try {
    if (TARGET_URL) {
      const image = await loadImage(TARGET_URL);
      const scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
      preview.width = Math.max(1, Math.round(scale * image.naturalWidth));
      preview.height = Math.max(1, Math.round(scale * image.naturalHeight));
      preview.getContext('2d').drawImage(image, 0, 0, preview.width, preview.height);
    } else {
      sampleDemo();
    }
    aspect = preview.width / preview.height;
    const gray = signal(preview, { x: 0, y: 0, w: preview.width, h: preview.height });
    reference = { gray, edges: edges(gray) };
    start.disabled = fileButton.disabled = false;
    report('開啟相機開始掃描，或選擇一張已裁切的圖片測試。');
  } catch {
    report('參考圖片載入失敗，請檢查檔名和路徑後重新整理。');
  }
}

initialize();
