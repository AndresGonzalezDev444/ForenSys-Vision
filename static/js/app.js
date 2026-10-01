// =========================================================
// FORENSYS VISION V2 - APP LOGIC
// =========================================================

const API_BASE = '/api';
let token = localStorage.getItem('fs_token') || null;
let currentUser = null;
let deviceLocation = null;

// =========================================================
// INIT & AUTH
// =========================================================
window.addEventListener('DOMContentLoaded', () => {
  if (token) {
    validateToken();
  } else {
    showLogin();
  }
});

async function validateToken() {
  try {
    const res = await fetch(`${API_BASE}/users/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      currentUser = await res.json();
      initApp();
    } else {
      logout();
    }
  } catch (e) {
    console.error("Error validating token", e);
    logout();
  }
}

function showLogin() {
  document.getElementById('view-login').classList.add('active');
  document.getElementById('app-layout').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('username').value;
  const p = document.getElementById('password').value;
  const err = document.getElementById('login-error');
  const btn = document.getElementById('login-submit-btn');

  btn.disabled = true;
  btn.innerHTML = 'Verificando...';

  try {
    const fd = new FormData();
    fd.append('username', u);
    fd.append('password', p);
    const res = await fetch(`${API_BASE}/login`, { method: 'POST', body: fd });
    if (res.ok) {
      const data = await res.json();
      token = data.access_token;
      localStorage.setItem('fs_token', token);
      validateToken();
    } else {
      err.classList.remove('hidden');
      setTimeout(() => err.classList.add('hidden'), 3000);
    }
  } catch (e) {
    console.error(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Acceder al Sistema`;
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('fs_token');
  stopCamera();
  stopPlateCamera();
  stopGeolocation();
  document.getElementById('app-layout').classList.add('hidden');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-login').classList.add('active');
}

function initApp() {
  document.getElementById('view-login').classList.remove('active');
  document.getElementById('app-layout').classList.remove('hidden');
  document.getElementById('sidebar-username').textContent = currentUser.username;
  document.getElementById('sidebar-avatar').textContent = currentUser.username.charAt(0).toUpperCase();

  navigateTo('dashboard');
  loadDashboardStats();
  initGeolocation();
  loadCameraDevices();
  loadPlateCameraDevices();
  fetchSuspectsForReport();
}


// =========================================================
// UI & NAVIGATION
// =========================================================
function navigateTo(viewId) {
  // Ocultar vistas
  document.querySelectorAll('.main-area .view').forEach(v => v.classList.remove('active'));
  document.getElementById(`view-${viewId}`).classList.add('active');

  // Actualizar sidebar nav
  document.querySelectorAll('.sidebar-nav a').forEach(a => a.classList.remove('active'));
  if (document.getElementById(`nav-${viewId}`)) {
    document.getElementById(`nav-${viewId}`).classList.add('active');
  }

  // Cerrar sidebar en mobile
  closeSidebar();

  // Acciones específicas de vista
  if (viewId !== 'facial') stopCamera();
  if (viewId !== 'plates') stopPlateCamera();
  
  if (viewId === 'suspects') loadSuspectsList();
  if (viewId === 'routes') initMap(); // Inicializar mapa cuando sea visible
  if (viewId === 'dashboard') loadDashboardStats();
}

function toggleSidebar() {
  document.getElementById('main-sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('active');
}

function closeSidebar() {
  document.getElementById('main-sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

async function loadDashboardStats() {
  try {
    const res = await fetch(`${API_BASE}/suspects`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const suspects = await res.json();
      document.getElementById('stat-suspects').textContent = suspects.length;
      let totalPhotos = 0;
      suspects.forEach(s => { if (s.face_photos) totalPhotos += s.face_photos.length; });
      document.getElementById('stat-photos').textContent = totalPhotos;
    }
  } catch (e) {
    console.error(e);
  }
}


// =========================================================
// GEOLOCALIZACIÓN PERSISTENTE
// =========================================================
let geoWatchId = null;

function initGeolocation() {
  const statusEl = document.getElementById('geo-status');
  const coordsEl = document.getElementById('geo-coords');
  const accEl = document.getElementById('geo-accuracy');
  const timeEl = document.getElementById('geo-timestamp');

  if (!navigator.geolocation) {
    statusEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> No soportado`;
    statusEl.className = 'geo-status geo-error';
    return;
  }

  geoWatchId = navigator.geolocation.watchPosition(
    (position) => {
      deviceLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        acc: position.coords.accuracy
      };
      
      statusEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> Rastreando`;
      statusEl.className = 'geo-status geo-active';
      
      coordsEl.style.display = 'block';
      coordsEl.textContent = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
      
      accEl.style.display = 'block';
      accEl.textContent = `Precisión: ±${Math.round(position.coords.accuracy)}m`;
      document.getElementById('stat-geo').textContent = Math.round(position.coords.accuracy);

      timeEl.style.display = 'block';
      const d = new Date(position.timestamp);
      timeEl.textContent = `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}:${d.getSeconds().toString().padStart(2,'0')}`;
      
      // Actualizar texto en reporte
      const repGeo = document.getElementById('report-geo-display');
      if(repGeo) repGeo.textContent = `Lat: ${deviceLocation.lat.toFixed(6)} | Lng: ${deviceLocation.lng.toFixed(6)} (±${Math.round(deviceLocation.acc)}m)`;
    },
    (error) => {
      console.error(error);
      statusEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px;height:12px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Permiso denegado`;
      statusEl.className = 'geo-status geo-error';
      coordsEl.style.display = 'none';
      accEl.style.display = 'none';
      timeEl.style.display = 'none';
      document.getElementById('stat-geo').textContent = '—';
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 }
  );
}

function stopGeolocation() {
  if (geoWatchId !== null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
}


// =========================================================
// MÓDULO: RECONOCIMIENTO FACIAL
// =========================================================
async function loadCameraDevices() {
  try {
    // Primero, pedimos permiso al navegador para acceder a los nombres reales
    await navigator.mediaDevices.getUserMedia({ video: true });
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    
    const sel = document.getElementById('camera-device-select');
    sel.innerHTML = '';
    
    if (videoDevices.length > 0) {
      videoDevices.forEach((d, index) => {
        const opt = document.createElement('option');
        opt.value = `${index}|dshow`; // Pasamos el índice al backend
        opt.textContent = d.label || `Cámara ${index + 1}`;
        sel.appendChild(opt);
      });
      document.getElementById('camera-source-status').textContent = 'Cámaras detectadas.';
    } else {
      throw new Error("No hay cámaras");
    }
  } catch (e) {
    console.warn("Fallo el acceso a nombres de cámara del navegador, usando fallback del backend.", e);
    try {
      const res = await fetch(`${API_BASE}/cameras`);
      const data = await res.json();
      const sel = document.getElementById('camera-device-select');
      sel.innerHTML = '';
      data.devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.name;
        sel.appendChild(opt);
      });
      document.getElementById('camera-source-status').textContent = 'Cámaras detectadas (Backend).';
    } catch(err) {
      document.getElementById('camera-source-status').textContent = 'Error detectando cámaras.';
    }
  }
}

function handleCameraSourceTypeChange() {
  const t = document.getElementById('camera-source-type').value;
  if (t === 'local') {
    document.getElementById('local-camera-field').style.display = 'flex';
    document.getElementById('url-camera-field').style.display = 'none';
  } else {
    document.getElementById('local-camera-field').style.display = 'none';
    document.getElementById('url-camera-field').style.display = 'flex';
  }
}

function startCamera() {
  const type = document.getElementById('camera-source-type').value;
  let source = "";
  if (type === 'local') {
    source = document.getElementById('camera-device-select').value;
  } else {
    source = document.getElementById('camera-url-input').value;
    if (!source) return alert("Ingrese una URL válida");
  }

  const url = `${API_BASE}/video_feed?source_type=${type}&source=${encodeURIComponent(source)}&t=${Date.now()}`;
  const feed = document.getElementById('live-camera');
  
  // Limpiar feed previo
  const oldImgs = feed.querySelectorAll('img');
  oldImgs.forEach(img => img.remove());

  const img = document.createElement('img');
  img.src = url;
  
  img.onload = () => {
    document.getElementById('camera-status-msg').style.display = 'none';
    document.getElementById('scan-overlay').style.display = 'block';
    document.getElementById('camera-hud').style.display = 'flex';
    document.getElementById('camera-bottom').style.display = 'block';
    document.getElementById('camera-corners').style.display = 'block';
    document.getElementById('btn-camera-on').style.display = 'none';
    document.getElementById('btn-camera-off').style.display = 'flex';
  };
  
  img.onerror = () => {
    alert("Error al conectar con la cámara. Verifique la fuente.");
    stopCamera();
  };
  
  feed.appendChild(img);
}

function stopCamera() {
  fetch(`${API_BASE}/video_stop`, { method: 'POST' }).catch(console.error);
  const feed = document.getElementById('live-camera');
  const imgs = feed.querySelectorAll('img');
  imgs.forEach(img => img.remove());
  
  document.getElementById('camera-status-msg').style.display = 'flex';
  document.getElementById('scan-overlay').style.display = 'none';
  document.getElementById('camera-hud').style.display = 'none';
  document.getElementById('camera-bottom').style.display = 'none';
  document.getElementById('camera-corners').style.display = 'none';
  document.getElementById('btn-camera-on').style.display = 'flex';
  document.getElementById('btn-camera-off').style.display = 'none';
}


// =========================================================
// MÓDULO: RECONOCIMIENTO DE PLACAS
// =========================================================
let currentPlateEngine = 'ocr'; // ocr | yolo

function setPlateEngine(engine) {
  if (currentPlateEngine === engine) return;
  
  // Apagar la cámara actual antes de cambiar de motor si está encendida
  if (document.getElementById('btn-plate-off').style.display === 'flex') {
    stopPlateCamera();
  }
  
  currentPlateEngine = engine;
  
  // Actualizar botones
  const btnOcr = document.getElementById('btn-engine-ocr');
  const btnYolo = document.getElementById('btn-engine-yolo');
  
  if (engine === 'ocr') {
    btnOcr.classList.add('active');
    btnYolo.classList.remove('active');
    document.getElementById('plate-info-ocr').style.display = 'block';
    document.getElementById('plate-info-yolo').style.display = 'none';
    document.getElementById('plate-hud-title').textContent = 'MÓDULO PLACAS OCR';
    document.getElementById('plate-hud-title').style.color = '#f59e0b';
    document.getElementById('plate-camera-hud').querySelector('svg').style.stroke = '#f59e0b';
    document.getElementById('plate-bottom-tag').textContent = 'FORENSYS VISION • PLACAS CO';
    document.getElementById('plate-tip-text').innerHTML = '<strong style="color:var(--medium);">Tip:</strong> Para mejores resultados con el OCR clásico, asegúrate de que la placa esté bien iluminada y el vehículo no esté en movimiento rápido. El sistema detecta placas colombianas en los formatos ABC-123 y AB-1234.';
  } else {
    btnYolo.classList.add('active');
    btnOcr.classList.remove('active');
    document.getElementById('plate-info-yolo').style.display = 'block';
    document.getElementById('plate-info-ocr').style.display = 'none';
    document.getElementById('plate-hud-title').textContent = 'MÓDULO PLACAS YOLO (IA)';
    document.getElementById('plate-hud-title').style.color = 'rgba(0,150,255,1)';
    document.getElementById('plate-camera-hud').querySelector('svg').style.stroke = 'rgba(0,150,255,1)';
    document.getElementById('plate-bottom-tag').textContent = 'FORENSYS VISION • PLACAS YOLO IA';
    document.getElementById('plate-tip-text').innerHTML = '<strong style="color:var(--medium);">Tip:</strong> YOLOv8 (Roboflow) requiere internet y es mucho más preciso para detectar placas en cualquier ángulo. Identifica la bounding box pero no extrae texto (OCR).';
  }
}

async function loadPlateCameraDevices() {
  try {
    const res = await fetch(`${API_BASE}/cameras`);
    const data = await res.json();
    const sel = document.getElementById('plate-device-select');
    sel.innerHTML = '';
    
    if (data.devices && data.devices.length > 0) {
      data.devices.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.id;
        opt.textContent = d.label || d.name || `Cámara`;
        sel.appendChild(opt);
      });
      document.getElementById('plate-source-status').textContent = 'Cámaras detectadas.';
    } else {
      throw new Error("No devices");
    }
  } catch(err) {
    document.getElementById('plate-source-status').textContent = 'Error detectando cámaras.';
    console.warn("Fallo el acceso a nombres de cámara desde backend.", err);
  }
}

function handlePlateSourceTypeChange() {
  const t = document.getElementById('plate-source-type').value;
  if (t === 'local') {
    document.getElementById('plate-local-field').style.display = 'flex';
    document.getElementById('plate-url-field').style.display = 'none';
  } else {
    document.getElementById('plate-local-field').style.display = 'none';
    document.getElementById('plate-url-field').style.display = 'flex';
  }
}

function startPlateCamera() {
  const type = document.getElementById('plate-source-type').value;
  let source = "";
  if (type === 'local') {
    source = document.getElementById('plate-device-select').value;
  } else {
    source = document.getElementById('plate-url-input').value;
    if (!source) return alert("Ingrese una URL válida");
  }

  const endpoint = currentPlateEngine === 'ocr' ? 'plate_video_feed' : 'plate_roboflow_feed';
  const url = `${API_BASE}/${endpoint}?source_type=${type}&source=${encodeURIComponent(source)}&t=${Date.now()}`;
  
  const feed = document.getElementById('plate-camera-feed');
  const oldImgs = feed.querySelectorAll('img');
  oldImgs.forEach(img => img.remove());

  const img = document.createElement('img');
  img.src = url;
  
  img.onload = () => {
    document.getElementById('plate-status-msg').style.display = 'none';
    document.getElementById('plate-scan-overlay').style.display = 'block';
    document.getElementById('plate-camera-hud').style.display = 'flex';
    document.getElementById('plate-camera-bottom').style.display = 'block';
    document.getElementById('plate-camera-corners').style.display = 'block';
    document.getElementById('btn-plate-on').style.display = 'none';
    document.getElementById('btn-plate-off').style.display = 'flex';
    
    if (currentPlateEngine === 'yolo') {
      const corners = document.getElementById('plate-camera-corners').children;
      for (let i = 0; i < corners.length; i++) corners[i].style.borderColor = 'rgba(0,150,255,0.6)';
    } else {
      const corners = document.getElementById('plate-camera-corners').children;
      for (let i = 0; i < corners.length; i++) corners[i].style.borderColor = 'rgba(245,158,11,0.6)';
    }
  };
  img.onerror = () => {
    alert("Error al conectar con la cámara. Verifique la fuente.");
    stopPlateCamera();
  };
  
  feed.appendChild(img);
}

function stopPlateCamera() {
  const endpoint = currentPlateEngine === 'ocr' ? 'plate_video_stop' : 'plate_roboflow_stop';
  fetch(`${API_BASE}/${endpoint}`, { method: 'POST' }).catch(console.error);
  
  const feed = document.getElementById('plate-camera-feed');
  const imgs = feed.querySelectorAll('img');
  imgs.forEach(img => img.remove());
  
  document.getElementById('plate-status-msg').style.display = 'flex';
  document.getElementById('plate-scan-overlay').style.display = 'none';
  document.getElementById('plate-camera-hud').style.display = 'none';
  document.getElementById('plate-camera-bottom').style.display = 'none';
  document.getElementById('plate-camera-corners').style.display = 'none';
  document.getElementById('btn-plate-on').style.display = 'flex';
  document.getElementById('btn-plate-off').style.display = 'none';
}


// =========================================================
// MÓDULO: TRAZADOR DE RUTAS
// =========================================================
let map = null;
let waypoints = [];
let routeLayers = [];
let markers = [];

function initMap() {
  if (map !== null) {
    map.invalidateSize();
    return;
  }

  // Centrar en Colombia por defecto o en ubicación del dispositivo si existe
  let center = [4.5709, -74.2973];
  let zoom = 5;
  
  if (deviceLocation) {
    center = [deviceLocation.lat, deviceLocation.lng];
    zoom = 13;
  }

  map = L.map('route-map').setView(center, zoom);

  // Tema oscuro de CartoDB
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);

  // Click para añadir punto
  map.on('click', function(e) {
    if(document.getElementById('btn-mode-manual').classList.contains('active')){
      addWaypointMarker(e.latlng.lat, e.latlng.lng);
      updateWaypointsList();
      document.getElementById('map-hint').style.display = 'none';
    }
  });

  // Intentar añadir el primer punto automáticamente si hay GPS
  if (deviceLocation && waypoints.length === 0) {
    addWaypointMarker(deviceLocation.lat, deviceLocation.lng, "Punto Inicial (GPS)");
    updateWaypointsList();
    document.getElementById('map-hint').style.display = 'none';
  }
}

function setRouteMode(mode) {
  document.querySelectorAll('.route-mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-mode-${mode}`).classList.add('active');
  
  document.getElementById('manual-mode-panel').style.display = mode === 'manual' ? 'block' : 'none';
  document.getElementById('file-mode-panel').style.display = mode === 'file' ? 'block' : 'none';
}

function addWaypointMarker(lat, lng, label = "") {
  const idx = waypoints.length;
  const marker = L.circleMarker([lat, lng], {
    radius: 6,
    fillColor: "#8b5cf6",
    color: "#fff",
    weight: 2,
    opacity: 1,
    fillOpacity: 1
  }).addTo(map);
  
  if(label) marker.bindTooltip(label).openTooltip();
  
  waypoints.push({ lat, lng, marker, id: Date.now() });
}

function updateWaypointsList() {
  const list = document.getElementById('waypoints-list');
  list.innerHTML = '';
  
  waypoints.forEach((wp, idx) => {
    const div = document.createElement('div');
    div.className = 'waypoint-item';
    div.innerHTML = `
      <div class="waypoint-marker">${idx + 1}</div>
      <input type="text" class="input-field flex-1" style="font-size:0.75rem;padding:0.4rem 0.5rem;" value="${wp.lat.toFixed(5)}, ${wp.lng.toFixed(5)}" readonly>
      <button class="btn btn-danger" style="padding:0.4rem;" onclick="removeWaypoint(${wp.id})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    `;
    list.appendChild(div);
  });
}

function addWaypointInput() {
  // Simular click en el centro del mapa para añadir
  if(map){
    const center = map.getCenter();
    addWaypointMarker(center.lat, center.lng);
    updateWaypointsList();
    document.getElementById('map-hint').style.display = 'none';
  }
}

function removeWaypoint(id) {
  const idx = waypoints.findIndex(w => w.id === id);
  if (idx > -1) {
    if(waypoints[idx].marker) map.removeLayer(waypoints[idx].marker);
    waypoints.splice(idx, 1);
    updateWaypointsList();
  }
}

function clearRoutes() {
  waypoints.forEach(w => { if(w.marker) map.removeLayer(w.marker); });
  waypoints = [];
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
  updateWaypointsList();
  document.getElementById('route-results-panel').style.display = 'none';
  document.getElementById('map-hint').style.display = 'flex';
}

async function calculateRoutes() {
  if (waypoints.length < 2) {
    return alert("Añade al menos 2 puntos en el mapa para calcular rutas.");
  }

  const btn = document.getElementById('btn-calculate-routes');
  const loader = document.getElementById('map-loading');
  
  btn.disabled = true;
  loader.style.display = 'flex';

  // Limpiar rutas previas
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];

  const coords = waypoints.map(w => [w.lat, w.lng]);
  const alts = document.getElementById('routes-count').value;

  try {
    const res = await fetch(`${API_BASE}/routes/calculate`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        waypoints: coords,
        alternatives: parseInt(alts)
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Error en servidor de rutas');
    }

    const geojson = await res.json();
    renderRoutes(geojson);
    
  } catch (e) {
    console.error(e);
    alert(e.message);
  } finally {
    btn.disabled = false;
    loader.style.display = 'none';
  }
}

function renderRoutes(geojson) {
  const colors = ['#8b5cf6', '#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
  const resultsList = document.getElementById('route-results-list');
  resultsList.innerHTML = '';
  document.getElementById('route-results-panel').style.display = 'block';

  if (!geojson.features || geojson.features.length === 0) {
    resultsList.innerHTML = '<div class="text-muted" style="font-size:0.8rem;">No se encontraron rutas.</div>';
    return;
  }

  let bounds = L.latLngBounds();

  geojson.features.forEach((feature, idx) => {
    const color = colors[idx % colors.length];
    const isPrimary = idx === 0;
    
    // Dibujar en mapa
    const layer = L.geoJSON(feature, {
      style: {
        color: color,
        weight: isPrimary ? 5 : 3,
        opacity: isPrimary ? 0.9 : 0.6,
        dashArray: isPrimary ? '' : '5, 10'
      }
    }).addTo(map);
    
    routeLayers.push(layer);
    
    // Extender bounds
    const coords = feature.geometry.coordinates;
    coords.forEach(c => bounds.extend([c[1], c[0]]));

    // Info en panel
    const props = feature.properties;
    const summary = props.summary || {};
    const distKm = ((summary.distance || 0) / 1000).toFixed(1);
    const timeMin = Math.round((summary.duration || 0) / 60);

    const div = document.createElement('div');
    div.className = 'route-result-item';
    div.innerHTML = `
      <div>
        <div style="font-size:0.8rem;font-weight:600;display:flex;align-items:center;">
          <span class="route-color-dot" style="background:${color};"></span>
          Ruta ${isPrimary ? 'Principal' : 'Alternativa ' + idx}
        </div>
        <div style="font-size:0.7rem;color:var(--muted);margin-top:0.25rem;">
          Distancia: ${distKm} km | Est: ${timeMin} min
        </div>
      </div>
    `;
    resultsList.appendChild(div);
  });

  if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}


// =========================================================
// MÓDULO: REPORTE PERICIAL
// =========================================================
async function fetchSuspectsForReport() {
  try {
    const res = await fetch(`${API_BASE}/suspects`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const suspects = await res.json();
      const container = document.getElementById('suspect-checkboxes');
      container.innerHTML = '';
      if(suspects.length === 0) {
        container.innerHTML = '<p class="text-muted" style="font-size:0.8rem;">No hay sospechosos registrados.</p>';
        return;
      }
      suspects.forEach(s => {
        const div = document.createElement('div');
        div.className = 'report-option';
        div.style.marginBottom = '0.5rem';
        div.innerHTML = `
          <input type="checkbox" id="rep-s-${s.id}" value="${s.id}" class="rep-suspect-cb">
          <label for="rep-s-${s.id}">${s.first_name} ${s.last_name} <span class="mono text-muted" style="font-size:0.7rem;margin-left:0.5rem;">[${s.identification}]</span></label>
        `;
        container.appendChild(div);
      });
    }
  } catch (e) {
    console.error(e);
  }
}

function toggleSuspectSelection(cb) {
  const container = document.getElementById('suspect-selection');
  if(cb.checked) {
    container.style.display = 'none';
  } else {
    container.style.display = 'block';
  }
}

async function generateReport(e) {
  e.preventDefault();
  
  const caseNum = document.getElementById('report-case').value;
  const inv = document.getElementById('report-investigator').value || currentUser.username;
  const obs = document.getElementById('report-observations').value;
  
  let suspectIds = [];
  if (!document.getElementById('report-all-suspects').checked) {
    const cbs = document.querySelectorAll('.rep-suspect-cb:checked');
    cbs.forEach(cb => suspectIds.push(parseInt(cb.value)));
  }

  let locStr = "No disponible";
  if (deviceLocation) {
    locStr = `Lat: ${deviceLocation.lat.toFixed(6)}, Lng: ${deviceLocation.lng.toFixed(6)} (Precisión: ±${Math.round(deviceLocation.acc)}m)`;
  }

  const payload = {
    case_number: caseNum,
    investigator: inv,
    observations: obs,
    location: locStr,
    suspect_ids: suspectIds
  };

  const btn = document.getElementById('btn-generate-report');
  btn.disabled = true;
  btn.innerHTML = 'Generando Reporte...';

  try {
    const res = await fetch(`${API_BASE}/report/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reporte_${caseNum.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      alert("Error al generar el reporte.");
    }
  } catch (err) {
    console.error(err);
    alert("Error de conexión al generar reporte.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> Generar Reporte Pericial`;
  }
}


// =========================================================
// GESTIÓN DE SOSPECHOSOS (CRUD)
// =========================================================
let suspectTargetForPhoto = null; // Para saber a quién le estamos tomando la foto desde modal

async function loadSuspectsList() {
  const lst = document.getElementById('suspects-list');
  lst.innerHTML = 'Cargando...';
  try {
    const res = await fetch(`${API_BASE}/suspects`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      lst.innerHTML = '';
      if (data.length === 0) {
        lst.innerHTML = '<p class="text-muted text-center" style="padding:2rem;">No hay sujetos registrados.</p>';
      } else {
        data.forEach(s => {
          const div = document.createElement('div');
          div.className = 'suspect-item';
          
          let photosHtml = '';
          if (s.face_photos && s.face_photos.length > 0) {
            s.face_photos.forEach(p => {
              const absUrl = p.file_path.startsWith('http') ? p.file_path : `/${p.file_path}`;
              photosHtml += `
                <div class="photo-thumb">
                  <img src="${absUrl}?t=${Date.now()}" alt="Foto">
                  <button class="photo-del" onclick="deletePhoto(${p.id}, ${s.id})" title="Eliminar foto">✕</button>
                </div>
              `;
            });
          }
          // Cambiado: Ahora llama a openWebcamModal pero seteando el suspectTargetForPhoto
          photosHtml += `
            <button class="photo-add-btn" onclick="openPhotoUploader(${s.id})" title="Añadir foto" style="background:transparent; border: 1px dashed var(--border);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:20px;height:20px;"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button class="photo-add-btn" onclick="takePhotoForExisting(${s.id})" title="Tomar foto con cámara" style="background:transparent; border: 1px dashed var(--border);">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px;"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
            </button>
          `;

          div.innerHTML = `
            <div style="flex:1;">
              <div class="suspect-name">${s.first_name} ${s.last_name}</div>
              <div class="suspect-meta mono mb-1">ID: ${s.identification}</div>
              <div class="suspect-behavior">Antecedentes: ${s.behavior_profile || 'N/A'}</div>
              <div class="photo-gallery" style="margin-top:1rem;">${photosHtml}</div>
            </div>
            <div>
              <button class="btn btn-danger" onclick="deleteSuspect(${s.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px;"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Eliminar
              </button>
            </div>
          `;
          lst.appendChild(div);
        });
      }
    }
  } catch (e) {
    console.error(e);
    lst.innerHTML = '<p class="text-center text-muted">Error cargando lista</p>';
  }
}

async function handleAddSuspect(e) {
  e.preventDefault();
  const fn = document.getElementById('s-fname').value;
  const ln = document.getElementById('s-lname').value;
  const idNum = document.getElementById('s-id').value;
  const bp = document.getElementById('s-behavior').value;
  const fileInput = document.getElementById('s-photo');

  try {
    const res = await fetch(`${API_BASE}/suspects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        first_name: fn,
        last_name: ln,
        identification: idNum,
        behavior_profile: bp
      })
    });

    if (res.ok) {
      const s = await res.json();
      
      if (fileInput.files.length > 0) {
        const fd = new FormData();
        fd.append('file', fileInput.files[0]);
        await fetch(`${API_BASE}/suspects/${s.id}/photo`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd
        });
      } 
      else if (currentWebcamPhotoBase64) {
        await fetch(`${API_BASE}/suspects/${s.id}/photo_base64`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            image_base64: currentWebcamPhotoBase64,
            angle: document.getElementById('webcam-angle-select').value || 'front'
          })
        });
      }

      alert("Sujeto registrado con éxito.");
      document.getElementById('suspect-form').reset();
      document.getElementById('s-photo-name').textContent = '';
      currentWebcamPhotoBase64 = null;
      loadSuspectsList();
      fetchSuspectsForReport();
    } else {
      alert("Error al registrar");
    }
  } catch (err) {
    console.error(err);
  }
}

async function deleteSuspect(id) {
  if (!confirm("¿Eliminar este sujeto y todos sus registros biométricos?")) return;
  try {
    const res = await fetch(`${API_BASE}/suspects/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      loadSuspectsList();
      fetchSuspectsForReport();
    } else {
      alert("Error al eliminar");
    }
  } catch (e) {
    console.error(e);
  }
}

function openPhotoUploader(suspectId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async (e) => {
    if (e.target.files.length > 0) {
      const fd = new FormData();
      fd.append('file', e.target.files[0]);
      try {
        const res = await fetch(`${API_BASE}/suspects/${suspectId}/photo`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: fd
        });
        if (res.ok) {
          loadSuspectsList();
        } else {
          alert("Error subiendo foto");
        }
      } catch (err) {
        console.error(err);
      }
    }
  };
  input.click();
}

function takePhotoForExisting(suspectId) {
  suspectTargetForPhoto = suspectId;
  openWebcamModal();
}

async function deletePhoto(photoId, suspectId) {
  if(!confirm("¿Eliminar esta foto biométrica?")) return;
  try {
    const res = await fetch(`${API_BASE}/photos/${photoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if(res.ok) {
      loadSuspectsList();
    }
  } catch(e) {
    console.error(e);
  }
}


// =========================================================
// WEBCAM CAPTURE
// =========================================================
let webcamStream = null;
let currentWebcamPhotoBase64 = null;

async function loadBrowserCameraDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ video: true }); // Pedir permiso inicial
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    const sel = document.getElementById('webcam-device-select');
    sel.innerHTML = '<option value="">Cámara predeterminada</option>';
    videoDevices.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Cámara ${sel.length}`;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error("Error obteniendo dispositivos:", err);
  }
}

async function openWebcamModal() {
  document.getElementById('webcam-modal').classList.add('active');
  document.getElementById('webcam-video').style.display = 'block';
  document.getElementById('webcam-preview').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
  document.getElementById('retake-btn').style.display = 'none';
  currentWebcamPhotoBase64 = null;
  
  if (document.getElementById('webcam-device-select').options.length <= 1) {
    await loadBrowserCameraDevices();
  }
  
  restartWebcamPreview();
}

async function restartWebcamPreview() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
  }
  
  document.getElementById('webcam-video').style.display = 'block';
  document.getElementById('webcam-preview').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
  document.getElementById('retake-btn').style.display = 'none';
  
  const deviceId = document.getElementById('webcam-device-select').value;
  const constraints = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      deviceId: deviceId ? { exact: deviceId } : undefined
    }
  };

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia(constraints);
    document.getElementById('webcam-video').srcObject = webcamStream;
  } catch (err) {
    console.error(err);
    alert("Error accediendo a la cámara del navegador.");
    closeWebcamModal();
  }
}

function takeWebcamPhoto() {
  const video = document.getElementById('webcam-video');
  const canvas = document.getElementById('webcam-canvas');
  
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  currentWebcamPhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);
  
  const preview = document.getElementById('webcam-preview');
  preview.src = currentWebcamPhotoBase64;
  preview.style.display = 'block';
  video.style.display = 'none';
  
  document.getElementById('confirm-btn').style.display = 'flex';
  document.getElementById('retake-btn').style.display = 'block';
}

function retakeWebcamPhoto() {
  currentWebcamPhotoBase64 = null;
  document.getElementById('webcam-video').style.display = 'block';
  document.getElementById('webcam-preview').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
  document.getElementById('retake-btn').style.display = 'none';
}

async function confirmWebcamPhoto() {
  // Si venimos de "Añadir foto" a alguien existente
  if (suspectTargetForPhoto) {
    try {
      const res = await fetch(`${API_BASE}/suspects/${suspectTargetForPhoto}/photo_base64`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          image_base64: currentWebcamPhotoBase64,
          angle: document.getElementById('webcam-angle-select').value || 'front'
        })
      });
      if (res.ok) {
        loadSuspectsList();
      } else {
        alert("Error guardando foto");
      }
    } catch(err) {
      console.error(err);
    }
    suspectTargetForPhoto = null; // Reiniciar
  } else {
    // Si venimos del formulario de nuevo registro
    document.getElementById('s-photo-name').textContent = "✅ Foto capturada desde cámara";
    document.getElementById('s-photo').value = "";
  }
  closeWebcamModal();
}

function closeWebcamModal() {
  document.getElementById('webcam-modal').classList.remove('active');
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  suspectTargetForPhoto = null;
}


// =========================================================
// EXPORT/IMPORT DB
// =========================================================
async function exportDB() {
  try {
    const res = await fetch(`${API_BASE}/database/export`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ciberforense_export_${new Date().getTime()}.db`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  } catch (err) {
    console.error(err);
  }
}

async function importDB(e) {
  if (e.target.files.length > 0) {
    if (!confirm("Esto sobrescribirá la base de datos actual. ¿Continuar?")) return;
    const fd = new FormData();
    fd.append('file', e.target.files[0]);
    try {
      const res = await fetch(`${API_BASE}/database/import`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd
      });
      if (res.ok) {
        alert("Base de datos importada. Recargando...");
        window.location.reload();
      }
    } catch (err) {
      console.error(err);
    }
  }
}

// Input de archivo local en registro
document.getElementById('s-photo').addEventListener('change', function(e) {
  if (this.files.length > 0) {
    document.getElementById('s-photo-name').textContent = `✅ Archivo seleccionado: ${this.files[0].name}`;
    currentWebcamPhotoBase64 = null; // Priorizar archivo
  }
});
