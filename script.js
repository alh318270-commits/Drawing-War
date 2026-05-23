/* ============================================================
   🌍 خريطة العالم التفاعلية - script.js
   ============================================================
   قبل الاستخدام: استبدل قيم FIREBASE_CONFIG أدناه
   بمفاتيح مشروعك من Firebase Console
   ============================================================ */

// ============================================================
// 🔥 FIREBASE CONFIGURATION — ضع مفاتيحك هنا
// ============================================================
const FIREBASE_CONFIG = {
  apiKey:            "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain:        "your-project-id.firebaseapp.com",
  databaseURL:       "https://your-project-id-default-rtdb.firebaseio.com",
  projectId:         "your-project-id",
  storageBucket:     "your-project-id.appspot.com",
  messagingSenderId: "000000000000",
  appId:             "1:000000000000:web:xxxxxxxxxxxxxxxxxxxxxxxx"
};
// ============================================================


// ============================================================
// STATE
// ============================================================
const state = {
  map: null,
  canvas: null,
  ctx: null,
  isDrawing: false,
  drawMode: true,         // true = draw, false = pan
  eraserActive: false,
  currentColor: '#FF3B3B',
  brushSize: 4,
  opacity: 1,
  currentStroke: [],      // points of active stroke
  allStrokes: [],         // all strokes rendered locally
  db: null,
  strokesRef: null,
  usersRef: null,
  myUserId: generateId(),
  firebase: null,
  mapOffset: { x: 0, y: 0 },
  pendingStrokes: [],     // strokes received before map ready
};

// ============================================================
// UTILITIES
// ============================================================
function generateId() {
  return Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function setStatus(state, text) {
  const dot  = document.getElementById('statusDot');
  const span = document.getElementById('statusText');
  dot.className  = 'status-dot ' + state;
  span.textContent = text;
}

// ============================================================
// ONBOARDING
// ============================================================
document.getElementById('startBtn').addEventListener('click', () => {
  const el = document.getElementById('onboarding');
  el.classList.add('hidden');
  setTimeout(() => el.remove(), 400);
});

document.getElementById('helpBtn').addEventListener('click', () => {
  const existing = document.getElementById('onboarding');
  if (existing) return;
  const overlay = document.createElement('div');
  overlay.className = 'onboarding-overlay';
  overlay.id = 'onboarding';
  overlay.innerHTML = `
    <div class="onboarding-card">
      <div class="onboarding-globe">💡</div>
      <h1 class="onboarding-title">كيفية الاستخدام</h1>
      <div class="onboarding-features" style="grid-template-columns:1fr;text-align:right">
        <div class="feature-item"><span class="feature-icon">✏️</span><span>اختر "رسم" ثم اسحب على الخريطة للرسم</span></div>
        <div class="feature-item"><span class="feature-icon">🖐️</span><span>اختر "تنقل" للتحريك والتكبير</span></div>
        <div class="feature-item"><span class="feature-icon">🎨</span><span>اختر اللون والحجم من شريط الأدوات</span></div>
        <div class="feature-item"><span class="feature-icon">🧹</span><span>"مسح" يمحو ما رسمته، "مسح الكل" يمسح كل الرسومات</span></div>
        <div class="feature-item"><span class="feature-icon">⚡</span><span>رسوماتك تظهر فوراً لجميع المستخدمين</span></div>
      </div>
      <button class="onboarding-btn" id="closeHelp">حسناً، فهمت!</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('closeHelp').addEventListener('click', () => {
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 400);
  });
});

// ============================================================
// LEAFLET MAP SETUP
// ============================================================
function initMap() {
  state.map = L.map('map', {
    center: [25, 15],
    zoom: 3,
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);

  state.map.on('moveend zoomend', () => {
    resizeCanvas();
    redrawAll();
  });
  state.map.on('move zoom', () => {
    resizeCanvas();
    redrawAll();
  });

  // Prevent map interaction when drawing
  state.map.on('mousedown', (e) => {
    if (state.drawMode) {
      e.originalEvent.stopPropagation();
    }
  });
}

// ============================================================
// CANVAS SETUP
// ============================================================
function initCanvas() {
  state.canvas = document.getElementById('drawing-canvas');
  state.ctx    = state.canvas.getContext('2d');
  resizeCanvas();
  window.addEventListener('resize', () => {
    resizeCanvas();
    redrawAll();
  });
}

function resizeCanvas() {
  const container = document.getElementById('map-container');
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (state.canvas.width !== w || state.canvas.height !== h) {
    state.canvas.width  = w;
    state.canvas.height = h;
  }
}

// ============================================================
// COORDINATE CONVERSION
// ============================================================
// Convert LatLng → canvas pixel
function latLngToCanvas(latlng) {
  const pt = state.map.latLngToContainerPoint(latlng);
  return { x: pt.x, y: pt.y };
}

// Convert canvas pixel → LatLng
function canvasToLatLng(x, y) {
  const pt = L.point(x, y);
  return state.map.containerPointToLatLng(pt);
}

// ============================================================
// DRAWING EVENTS
// ============================================================
function getCanvasPos(e) {
  const rect = state.canvas.getBoundingClientRect();
  if (e.touches) {
    const touch = e.touches[0] || e.changedTouches[0];
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function startDraw(e) {
  if (!state.drawMode) return;
  e.preventDefault();
  state.isDrawing = true;
  const { x, y } = getCanvasPos(e);
  const latlng = canvasToLatLng(x, y);
  state.currentStroke = [{ lat: latlng.lat, lng: latlng.lng }];
  drawPoint(x, y);
}

function continueDraw(e) {
  if (!state.isDrawing || !state.drawMode) return;
  e.preventDefault();
  const { x, y } = getCanvasPos(e);
  const latlng = canvasToLatLng(x, y);
  state.currentStroke.push({ lat: latlng.lat, lng: latlng.lng });
  // Redraw whole frame
  redrawAll();
  // Draw current stroke preview
  drawStrokeOnCanvas(state.currentStroke, state.currentColor, state.brushSize, state.opacity, state.eraserActive);
}

function endDraw(e) {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  if (state.currentStroke.length < 1) return;

  const strokeData = {
    id:       generateId(),
    userId:   state.myUserId,
    points:   state.currentStroke,
    color:    state.eraserActive ? null : state.currentColor,
    size:     state.brushSize,
    opacity:  state.opacity,
    eraser:   state.eraserActive,
    ts:       Date.now()
  };

  // Add locally immediately
  state.allStrokes.push(strokeData);
  redrawAll();
  state.currentStroke = [];

  // Push to Firebase
  if (state.db) {
    pushStroke(strokeData);
  }
}

// ============================================================
// CANVAS RENDERING
// ============================================================
function drawPoint(x, y) {
  const ctx = state.ctx;
  ctx.beginPath();
  ctx.arc(x, y, state.brushSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(state.currentColor, state.opacity);
  ctx.fill();
}

function drawStrokeOnCanvas(points, color, size, opacity, eraser) {
  if (points.length === 0) return;
  const ctx = state.ctx;

  if (eraser) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = hexToRgba(color, opacity);
  }

  ctx.lineWidth     = size;
  ctx.lineCap       = 'round';
  ctx.lineJoin      = 'round';

  const canvasPoints = points.map(p => latLngToCanvas(p));

  if (canvasPoints.length === 1) {
    ctx.beginPath();
    ctx.arc(canvasPoints[0].x, canvasPoints[0].y, size / 2, 0, Math.PI * 2);
    if (eraser) ctx.fill();
    else { ctx.fillStyle = hexToRgba(color, opacity); ctx.fill(); }
    ctx.globalCompositeOperation = 'source-over';
    return;
  }

  ctx.beginPath();
  ctx.moveTo(canvasPoints[0].x, canvasPoints[0].y);

  for (let i = 1; i < canvasPoints.length - 1; i++) {
    const mx = (canvasPoints[i].x + canvasPoints[i + 1].x) / 2;
    const my = (canvasPoints[i].y + canvasPoints[i + 1].y) / 2;
    ctx.quadraticCurveTo(canvasPoints[i].x, canvasPoints[i].y, mx, my);
  }

  const last = canvasPoints[canvasPoints.length - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

function redrawAll() {
  const ctx = state.ctx;
  ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  for (const stroke of state.allStrokes) {
    drawStrokeOnCanvas(stroke.points, stroke.color, stroke.size, stroke.opacity, stroke.eraser);
  }
}

function hexToRgba(hex, opacity) {
  if (!hex) return `rgba(0,0,0,${opacity})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

// ============================================================
// CANVAS EVENT LISTENERS
// ============================================================
function bindCanvasEvents() {
  const canvas = state.canvas;
  canvas.addEventListener('mousedown',  startDraw,    { passive: false });
  canvas.addEventListener('mousemove',  continueDraw, { passive: false });
  canvas.addEventListener('mouseup',    endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('touchstart', startDraw,    { passive: false });
  canvas.addEventListener('touchmove',  continueDraw, { passive: false });
  canvas.addEventListener('touchend',   endDraw);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

// ============================================================
// TOOLBAR
// ============================================================
function initToolbar() {
  // Draw / Pan mode
  document.getElementById('drawModeBtn').addEventListener('click', () => setDrawMode(true));
  document.getElementById('panModeBtn').addEventListener('click',  () => setDrawMode(false));

  // Color swatches
  document.querySelectorAll('.swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      state.currentColor = sw.dataset.color;
      state.eraserActive = false;
      updateEraserBtn();
    });
  });

  // Custom color picker
  const cc = document.getElementById('customColor');
  cc.addEventListener('input', () => {
    state.currentColor = cc.value;
    document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
    state.eraserActive = false;
    updateEraserBtn();
  });

  // Brush size
  const sizeSlider = document.getElementById('brushSize');
  sizeSlider.addEventListener('input', () => {
    state.brushSize = parseInt(sizeSlider.value);
    document.getElementById('sizeValue').textContent = state.brushSize;
  });

  // Opacity
  const opSlider = document.getElementById('brushOpacity');
  opSlider.addEventListener('input', () => {
    state.opacity = parseInt(opSlider.value) / 100;
    document.getElementById('opacityValue').textContent = opSlider.value;
  });

  // Eraser
  document.getElementById('eraserBtn').addEventListener('click', () => {
    state.eraserActive = !state.eraserActive;
    updateEraserBtn();
  });

  // Clear All
  document.getElementById('clearAllBtn').addEventListener('click', confirmClearAll);
}

function setDrawMode(draw) {
  state.drawMode = draw;
  const drawBtn = document.getElementById('drawModeBtn');
  const panBtn  = document.getElementById('panModeBtn');
  const canvas  = document.getElementById('drawing-canvas');

  if (draw) {
    drawBtn.classList.add('active');
    panBtn.classList.remove('active');
    canvas.classList.add('draw-mode');
    canvas.classList.remove('eraser-mode');
    state.map.dragging.disable();
    state.map.doubleClickZoom.disable();
    state.map.scrollWheelZoom.enable();
  } else {
    panBtn.classList.add('active');
    drawBtn.classList.remove('active');
    canvas.classList.remove('draw-mode', 'eraser-mode');
    state.map.dragging.enable();
    state.map.doubleClickZoom.enable();
    state.map.scrollWheelZoom.enable();
  }
}

function updateEraserBtn() {
  const btn = document.getElementById('eraserBtn');
  const canvas = document.getElementById('drawing-canvas');
  if (state.eraserActive) {
    btn.classList.add('active');
    canvas.classList.add('eraser-mode');
  } else {
    btn.classList.remove('active');
    canvas.classList.remove('eraser-mode');
  }
}

function confirmClearAll() {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-box">
      <h3>⚠️ مسح الكل؟</h3>
      <p>سيتم حذف جميع الرسومات من الخريطة لجميع المستخدمين. هذا الإجراء لا يمكن التراجع عنه.</p>
      <div class="confirm-actions">
        <button class="btn-cancel" id="cancelClear">إلغاء</button>
        <button class="btn-confirm" id="confirmClear">مسح الكل</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('cancelClear').addEventListener('click', () => overlay.remove());
  document.getElementById('confirmClear').addEventListener('click', () => {
    clearAllStrokes();
    overlay.remove();
  });
}

function clearAllStrokes() {
  state.allStrokes = [];
  redrawAll();
  if (state.db) {
    const { remove } = window.__firebaseModules;
    remove(state.strokesRef);
    showToast('🗑️ تم مسح جميع الرسومات');
  }
}

// ============================================================
// FIREBASE INTEGRATION
// ============================================================
function initFirebase() {
  // Check if config has been filled in
  if (FIREBASE_CONFIG.apiKey === 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX') {
    setStatus('error', 'Firebase غير متصل');
    showToast('⚠️ الرجاء إضافة مفاتيح Firebase في script.js', 5000);
    console.warn('⚠️ Firebase Config not set. Strokes will only be local.');
    return;
  }

  try {
    const { initializeApp, getDatabase, ref, push, onChildAdded, onValue, set, remove, serverTimestamp }
      = window.__firebaseModules;

    const app = initializeApp(FIREBASE_CONFIG);
    state.db  = getDatabase(app);

    state.strokesRef = ref(state.db, 'strokes');
    state.usersRef   = ref(state.db, `users/${state.myUserId}`);

    // Register presence
    set(state.usersRef, { active: true, ts: Date.now() });

    // Count active users
    const allUsersRef = ref(state.db, 'users');
    onValue(allUsersRef, snap => {
      const count = snap.exists() ? Object.keys(snap.val()).length : 1;
      document.getElementById('usersCount').textContent = count;
    });

    // Load existing strokes
    setStatus('', 'جارٍ تحميل الرسومات...');
    onChildAdded(state.strokesRef, snap => {
      const stroke = snap.val();
      if (!stroke || !stroke.points) return;
      // Don't double-add our own strokes (we add them locally immediately)
      const alreadyHave = state.allStrokes.find(s => s.id === stroke.id);
      if (!alreadyHave) {
        state.allStrokes.push(stroke);
        redrawAll();
      }
    });

    setStatus('connected', 'متصل');
    showToast('🔥 متصل بقاعدة البيانات!');

    // Remove user on unload
    window.addEventListener('beforeunload', () => {
      remove(state.usersRef);
    });

  } catch (err) {
    console.error('Firebase init error:', err);
    setStatus('error', 'خطأ في الاتصال');
    showToast('❌ خطأ في الاتصال بـ Firebase: ' + err.message, 5000);
  }
}

function pushStroke(strokeData) {
  try {
    const { push } = window.__firebaseModules;
    push(state.strokesRef, strokeData);
  } catch (err) {
    console.error('Error pushing stroke:', err);
  }
}

// ============================================================
// CURSOR DOT (visual indicator of brush size)
// ============================================================
function initCursorDot() {
  const dot = document.createElement('div');
  dot.id = 'cursor-dot';
  document.body.appendChild(dot);

  document.addEventListener('mousemove', (e) => {
    if (!state.drawMode) {
      dot.style.display = 'none';
      return;
    }
    const rect = state.canvas.getBoundingClientRect();
    const inCanvas = e.clientX >= rect.left && e.clientX <= rect.right &&
                     e.clientY >= rect.top  && e.clientY <= rect.bottom;
    if (inCanvas) {
      const size = state.brushSize + 4;
      dot.style.display  = 'block';
      dot.style.left     = e.clientX + 'px';
      dot.style.top      = e.clientY + 'px';
      dot.style.width    = size + 'px';
      dot.style.height   = size + 'px';
      if (state.eraserActive) {
        dot.style.background = 'rgba(255,255,255,0.2)';
        dot.style.border     = '2px solid rgba(255,255,255,0.7)';
      } else {
        dot.style.background = hexToRgba(state.currentColor, 0.4);
        dot.style.border     = `2px solid ${state.currentColor}`;
      }
    } else {
      dot.style.display = 'none';
    }
  });
}

// ============================================================
// SCROLL WHEEL ZOOM (always allow scroll zoom)
// ============================================================
function fixScrollZoom() {
  // Allow pinch-to-zoom on mobile via map even in draw mode
  state.canvas.addEventListener('wheel', (e) => {
    if (!state.isDrawing) {
      // Forward wheel events to map for zooming
      const mapContainer = document.getElementById('map');
      const cloned = new WheelEvent('wheel', e);
      mapContainer.dispatchEvent(cloned);
    }
  }, { passive: true });
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('load', () => {
  initMap();
  initCanvas();
  bindCanvasEvents();
  initToolbar();
  initCursorDot();
  fixScrollZoom();

  // Wait for Firebase modules to load
  const waitForFirebase = setInterval(() => {
    if (window.__firebaseModules) {
      clearInterval(waitForFirebase);
      initFirebase();
    }
  }, 100);

  // Start in draw mode
  setDrawMode(true);

  // Default status
  setStatus('', 'جارٍ الاتصال...');

  console.log(`
  🌍 خريطة العالم التفاعلية
  ===========================
  معرّف المستخدم: ${state.myUserId}
  
  للتفعيل الكامل:
  1. اذهب إلى Firebase Console
  2. أنشئ مشروعاً جديداً
  3. فعّل Realtime Database
  4. انسخ إعدادات التطبيق
  5. استبدل FIREBASE_CONFIG في script.js
  `);
});
