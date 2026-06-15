let currentToken = null;
let cameraActive = false;
let cachedCameraDevices = [];

function navigateTo(viewId) {
  if (viewId !== 'dashboard') {
    stopCamera();
  }

  if (viewId === 'login') {
    document.getElementById('view-login').classList.remove('hidden');
    document.getElementById('app-layout').classList.add('hidden');
    return;
  }

  document.getElementById('view-login').classList.add('hidden');
  document.getElementById('app-layout').classList.remove('hidden');

  document.querySelectorAll('#app-layout .view').forEach(el => {
    el.classList.remove('active');
  });

  const target = document.getElementById(`view-${viewId}`);
  if (target) {
    target.classList.add('active');
  }

  document.querySelectorAll('.sidebar-nav a').forEach(el => el.classList.remove('active'));
  const navLink = document.getElementById(`nav-${viewId}`);
  if (navLink) navLink.classList.add('active');
}

async function handleLogin(e) {
  e.preventDefault();
  const u = document.getElementById('username').value;
  const p = document.getElementById('password').value;

  try {
    const formData = new URLSearchParams();
    formData.append('username', u);
    formData.append('password', p);

    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData
    });

    if (res.ok) {
      const data = await res.json();
      currentToken = data.access_token;
      document.getElementById('login-error').classList.add('hidden');
      const avatar = document.getElementById('sidebar-avatar');
      if (avatar) avatar.textContent = u.charAt(0).toUpperCase();
      const nameEl = document.getElementById('sidebar-username');
      if (nameEl) nameEl.textContent = u;
      navigateTo('dashboard');
      loadSuspects();
    } else {
      document.getElementById('login-error').classList.remove('hidden');
    }
  } catch (err) {
    console.error("Login failed", err);
    document.getElementById('login-error').classList.remove('hidden');
  }
}

function logout() {
  currentToken = null;
  navigateTo('login');
}

async function loadSuspects() {
  if (!currentToken) return;
  try {
    const res = await fetch('/api/suspects', { headers: { 'Authorization': `Bearer ${currentToken}` } });
    if (res.ok) {
      const suspects = await res.json();
      const list = document.getElementById('suspects-list');
      if (suspects.length === 0) {
        list.innerHTML = "<p class='text-muted'>No hay sospechosos registrados.</p>";
        return;
      }
      list.innerHTML = suspects.map(s => {
        const photos = s.face_photos || [];
        const photoCount = photos.length;
        return `
        <div class="suspect-item">
          <div style="flex:1;min-width:0;">
            <div class="suspect-name">${s.first_name} ${s.last_name}</div>
            <div class="suspect-meta">— Céd: ${s.identification}</div>
            <div class="suspect-behavior">Antecedentes: ${s.behavior_profile || 'N/A'}</div>
            <div style="color:${photoCount > 0 ? 'var(--low)' : 'var(--medium)'};font-size:0.75rem;">
              ${photoCount > 0 ? '● ' + photoCount + ' foto(s) facial(es) registrada(s)' : '○ Sin fotos faciales'}
            </div>
            <div class="photo-gallery">
              ${photos.map(p => `
                <div class="photo-thumb">
                  <img src="${p.file_path}" alt="Foto" onerror="this.style.display='none'">
                  <button class="photo-del" onclick="deletePhoto(${p.id}, event)" title="Eliminar foto">✕</button>
                </div>
              `).join('')}
              <button class="photo-add-btn" onclick="openWebcamModal(${s.id})" title="Agregar foto facial">+</button>
            </div>
          </div>
          <div style="display:flex;gap:0.5rem;flex-shrink:0;margin-top:0.5rem;">
            <button onclick="editSuspect(${s.id}, '${(s.behavior_profile||'').replace(/'/g,"\\'")}')"
              class="btn btn-secondary" style="font-size:0.75rem;padding:0.3rem 0.6rem;">
              ✎ Editar
            </button>
            <button onclick="deleteSuspect(${s.id}, '${s.first_name} ${s.last_name}')"
              class="btn btn-danger" style="font-size:0.75rem;padding:0.3rem 0.6rem;">
              ✕ Eliminar
            </button>
          </div>
        </div>
      `}).join('');
    }
  } catch (err) {
    console.error("Error loading suspects", err);
  }
}

async function handleAddSuspect(e) {
  e.preventDefault();
  const fname = document.getElementById('s-fname').value;
  const lname = document.getElementById('s-lname').value;
  const id = document.getElementById('s-id').value;
  const behavior = document.getElementById('s-behavior').value;
  const photoInput = document.getElementById('s-photo');

  try {
    const res = await fetch('/api/suspects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({
        first_name: fname,
        last_name: lname,
        identification: id,
        behavior_profile: behavior
      })
    });

    if (res.ok) {
      const newSuspect = await res.json();

      if (capturedPhotoBase64) {
        await uploadBase64Photo(newSuspect.id, capturedPhotoBase64);
        capturedPhotoBase64 = null;
      } else if (photoInput && photoInput.files && photoInput.files[0]) {
        const photoData = new FormData();
        photoData.append('file', photoInput.files[0]);
        await fetch(`/api/suspects/${newSuspect.id}/photo`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${currentToken}` },
          body: photoData
        });
      }

      document.getElementById('suspect-form').reset();
      if (document.getElementById('s-photo-name')) {
        document.getElementById('s-photo-name').innerText = '';
      }
      loadSuspects();
      alert("Sujeto Registrado Correctamente");
    }
  } catch(err) {
    console.error(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const photoInput = document.getElementById('s-photo');
  if (photoInput) {
    photoInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        document.getElementById('s-photo-name').innerText = 'Foto seleccionada: ' + e.target.files[0].name;
        capturedPhotoBase64 = null;
      }
    });
  }
  loadCameraDevices();
});

async function deleteSuspect(id, name) {
  if (!confirm(`¿Eliminar a "${name}" de la base de datos? Esta acción no se puede deshacer.`)) return;
  try {
    const res = await fetch(`/api/suspects/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      alert(`¡"${name}" eliminado y la IA ha sido actualizada.`);
      loadSuspects();
    } else {
      alert('No se pudo eliminar.');
    }
  } catch(err) { console.error(err); }
}

async function deletePhoto(photoId, event) {
  if (event) event.stopPropagation();
  if (!confirm('¿Eliminar esta foto facial? La IA se reentrenará sin ella.')) return;
  try {
    const res = await fetch(`/api/photos/${photoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      loadSuspects();
    } else {
      alert('No se pudo eliminar la foto.');
    }
  } catch(err) { console.error(err); }
}

async function editSuspect(id, currentBehavior) {
  const newBehavior = prompt('Editar antecedentes / conductas del sujeto:', currentBehavior);
  if (newBehavior === null) return;
  try {
    const res = await fetch(`/api/suspects/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ behavior_profile: newBehavior })
    });
    if (res.ok) {
      loadSuspects();
    } else {
      alert('No se pudo guardar la edición.');
    }
  } catch(err) { console.error(err); }
}

async function loadCameraDevices() {
  const select = document.getElementById('camera-device-select');
  const status = document.getElementById('camera-source-status');
  if (!select) return;
  if (status) status.textContent = 'Detectando camaras locales...';
  try {
    const res = await fetch('/api/cameras');
    const data = await res.json();
    cachedCameraDevices = data.devices || [];
    select.innerHTML = cachedCameraDevices.map(device =>
      `<option value="${device.id}">${device.label}</option>`
    ).join('');
    if (!select.innerHTML) {
      select.innerHTML = '<option value="0|dshow">Camara local 0 (DirectShow)</option>';
    }
    if (status) {
      status.textContent = cachedCameraDevices.length
        ? `${cachedCameraDevices.length} camara(s) local(es) detectada(s).`
        : 'No se detectaron camaras; se usara la camara local 0.';
    }
  } catch (err) {
    console.error(err);
    select.innerHTML = '<option value="0|dshow">Camara local 0 (DirectShow)</option>';
    if (status) status.textContent = 'No se pudo detectar; se usara la camara local 0.';
  }
}

function handleCameraSourceTypeChange() {
  const sourceType = document.getElementById('camera-source-type')?.value || 'local';
  const localField = document.getElementById('local-camera-field');
  const urlField = document.getElementById('url-camera-field');
  const status = document.getElementById('camera-source-status');
  if (localField) localField.style.display = sourceType === 'local' ? 'block' : 'none';
  if (urlField) urlField.style.display = sourceType === 'url' ? 'block' : 'none';
  if (status) {
    status.textContent = sourceType === 'url'
      ? 'Ingresa la URL RTSP/HTTP de la camara IP.'
      : 'Selecciona una camara local o virtual detectada.';
  }
}

async function loadBrowserCameraDevices() {
  const select = document.getElementById('webcam-device-select');
  if (!select || !navigator.mediaDevices?.enumerateDevices) return;
  try {
    const currentValue = select.value;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    select.innerHTML = '<option value="">Camara predeterminada</option>' + videoDevices.map((device, index) =>
      `<option value="${device.deviceId}">${device.label || `Camara ${index + 1}`}</option>`
    ).join('');
    if (currentValue) select.value = currentValue;
  } catch (err) {
    console.error(err);
  }
}

async function startWebcamPreview() {
  const video = document.getElementById('webcam-video');
  const select = document.getElementById('webcam-device-select');
  const deviceId = select?.value || '';
  const constraints = {
    video: deviceId ? { deviceId: { exact: deviceId } } : true
  };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  webcamStream = stream;
  video.srcObject = stream;
  await loadBrowserCameraDevices();
  if (deviceId && select) select.value = deviceId;
}

async function restartWebcamPreview() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  try {
    await startWebcamPreview();
  } catch (err) {
    alert('No se pudo cambiar la camara: ' + err.message);
  }
}

// ---- WEBCAM MODAL ----
let webcamStream = null;
let capturedPhotoBase64 = null;
let pendingSuspectIdForPhoto = null;

async function openWebcamModal(suspectId = null) {
  pendingSuspectIdForPhoto = suspectId;
  capturedPhotoBase64 = null;
  const modal = document.getElementById('webcam-modal');
  const video = document.getElementById('webcam-video');
  const preview = document.getElementById('webcam-preview');
  if (modal) modal.classList.add('active');
  preview.style.display = 'none';
  video.style.display = 'block';
  document.getElementById('retake-btn').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
  try {
    await startWebcamPreview();
  } catch (err) {
    alert('No se pudo acceder a la camara: ' + err.message);
    closeWebcamModal();
  }
  return;
  navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
      webcamStream = stream;
      video.srcObject = stream;
    })
    .catch(err => {
      alert('No se pudo acceder a la cámara: ' + err.message);
      closeWebcamModal();
    });
}

function takeWebcamPhoto() {
  const video = document.getElementById('webcam-video');
  const canvas = document.getElementById('webcam-canvas');
  const preview = document.getElementById('webcam-preview');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0);
  capturedPhotoBase64 = canvas.toDataURL('image/jpeg');
  preview.src = capturedPhotoBase64;
  preview.style.display = 'block';
  video.style.display = 'none';
  document.getElementById('retake-btn').style.display = 'inline-flex';
  document.getElementById('confirm-btn').style.display = 'inline-flex';
}

function retakeWebcamPhoto() {
  capturedPhotoBase64 = null;
  const video = document.getElementById('webcam-video');
  const preview = document.getElementById('webcam-preview');
  video.style.display = 'block';
  preview.style.display = 'none';
  document.getElementById('retake-btn').style.display = 'none';
  document.getElementById('confirm-btn').style.display = 'none';
}

async function confirmWebcamPhoto() {
  if (!capturedPhotoBase64) return;
  closeWebcamModal();
  if (pendingSuspectIdForPhoto) {
    await uploadBase64Photo(pendingSuspectIdForPhoto, capturedPhotoBase64);
    capturedPhotoBase64 = null;
    pendingSuspectIdForPhoto = null;
    loadSuspects();
  } else {
    document.getElementById('s-photo-name').innerText = '¡Foto capturada con la cámara! Se guardará al registrar.';
  }
}

async function uploadBase64Photo(suspectId, base64Data) {
  try {
    const res = await fetch(`/api/suspects/${suspectId}/photo_base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ image_base64: base64Data })
    });
    return res.ok;
  } catch(err) { console.error(err); return false; }
}

function closeWebcamModal() {
  if (webcamStream) {
    webcamStream.getTracks().forEach(t => t.stop());
    webcamStream = null;
  }
  const modal = document.getElementById('webcam-modal');
  if (modal) modal.classList.remove('active');
}

function startCamera() {
  if (cameraActive) return;
  const sourceType = document.getElementById('camera-source-type')?.value || 'local';
  const localSource = document.getElementById('camera-device-select')?.value || '0|dshow';
  const urlSource = document.getElementById('camera-url-input')?.value.trim() || '';
  const source = sourceType === 'url' ? urlSource : localSource;
  const sourceStatus = document.getElementById('camera-source-status');

  if (sourceType === 'url' && !source) {
    alert('Ingresa una URL RTSP/HTTP para la camara IP.');
    return;
  }
  if (sourceType === 'url' && !/^https?:\/\/|^rtsp:\/\//i.test(source)) {
    alert('La URL debe iniciar con rtsp://, http:// o https://');
    return;
  }

  cameraActive = true;
  const camFeed = document.getElementById('live-camera');
  const statusMsg = document.getElementById('camera-status-msg');
  if (statusMsg) statusMsg.style.display = 'none';
  document.getElementById('scan-overlay').style.display = 'block';
  document.getElementById('camera-hud').style.display = 'flex';
  document.getElementById('camera-bottom').style.display = 'block';
  document.getElementById('camera-corners').style.display = 'block';

  const oldImg = document.getElementById('video-stream');
  if (oldImg) oldImg.remove();
  const img = document.createElement('img');
  img.id = 'video-stream';
  const params = new URLSearchParams({ source_type: sourceType, source });
  img.src = `/api/video_feed?${params.toString()}`;
  img.style.cssText = 'width:100%; height:100%; object-fit:cover; position:absolute; top:0; left:0;';
  img.onerror = () => {
    if (sourceStatus) sourceStatus.textContent = 'No se pudo abrir la fuente de video seleccionada.';
  };
  camFeed.appendChild(img);
  if (sourceStatus) {
    sourceStatus.textContent = sourceType === 'url'
      ? 'Transmitiendo camara IP/RTSP.'
      : `Transmitiendo camara local ${source}.`;
  }
  document.getElementById('btn-camera-on').style.display = 'none';
  document.getElementById('btn-camera-off').style.display = 'flex';
}

function stopCamera() {
  if (!cameraActive) return;
  cameraActive = false;
  const img = document.getElementById('video-stream');
  if (img) {
    img.src = '';
    img.remove();
  }
  fetch('/api/video_stop', { method: 'POST' }).catch(() => {});
  const sourceStatus = document.getElementById('camera-source-status');
  if (sourceStatus) sourceStatus.textContent = 'Camara detenida.';
  const statusMsg = document.getElementById('camera-status-msg');
  if (statusMsg) statusMsg.style.display = 'flex';
  document.getElementById('scan-overlay').style.display = 'none';
  document.getElementById('camera-hud').style.display = 'none';
  document.getElementById('camera-bottom').style.display = 'none';
  document.getElementById('camera-corners').style.display = 'none';
  const btnOn = document.getElementById('btn-camera-on');
  const btnOff = document.getElementById('btn-camera-off');
  if (btnOn) btnOn.style.display = 'flex';
  if (btnOff) btnOff.style.display = 'none';
}

function startCameraSimulation() { startCamera(); }

async function exportDB() {
  if (!currentToken) return;
  try {
    const res = await fetch('/api/database/export', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ciberforense.db';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } else {
      alert("Error al exportar la base de datos.");
    }
  } catch (err) {
    console.error(err);
  }
}

async function importDB(event) {
  if (!currentToken) return;
  const file = event.target.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/database/import', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${currentToken}` },
      body: formData
    });
    if (res.ok) {
      alert("Base de datos importada exitosamente. Recargando...");
      window.location.reload();
    } else {
      alert("Error al importar la base de datos.");
    }
  } catch (err) {
    console.error(err);
  }
  event.target.value = '';
}
