const els = {
  video: document.querySelector("#video"),
  videoButton: document.querySelector("#videoButton"),
  zoomIndicator: document.querySelector("#zoomIndicator"),
  appShell: document.querySelector(".app-shell"),
  splitter: document.querySelector("#paneSplitter"),
  overlay: document.querySelector("#cameraOverlay"),
  cameraSelect: document.querySelector("#cameraSelect"),
  rotateLeftButton: document.querySelector("#rotateLeftButton"),
  rotateRightButton: document.querySelector("#rotateRightButton"),
  startButton: document.querySelector("#startButton"),
  captureButton: document.querySelector("#captureButton"),
  deleteModeButton: document.querySelector("#deleteModeButton"),
  shutdownButton: document.querySelector("#shutdownButton"),
  deleteActions: document.querySelector("#deleteActions"),
  confirmDeleteButton: document.querySelector("#confirmDeleteButton"),
  cancelDeleteButton: document.querySelector("#cancelDeleteButton"),
  selectedCount: document.querySelector("#selectedCount"),
  gallery: document.querySelector("#gallery"),
  template: document.querySelector("#captureTemplate"),
  statusText: document.querySelector("#statusText"),
  latestText: document.querySelector("#latestText"),
  resolutionText: document.querySelector("#resolutionText"),
  previewDialog: document.querySelector("#previewDialog"),
  previewImage: document.querySelector("#previewImage"),
  editPreviewButton: document.querySelector("#editPreviewButton"),
  downloadPreviewLink: document.querySelector("#downloadPreviewLink"),
  closePreviewButton: document.querySelector("#closePreviewButton"),
  editorDialog: document.querySelector("#editorDialog"),
  editorCanvas: document.querySelector("#editorCanvas"),
  canvasWrap: document.querySelector(".canvas-wrap"),
  closeEditorButton: document.querySelector("#closeEditorButton"),
  saveEditButton: document.querySelector("#saveEditButton"),
  undoButton: document.querySelector("#undoButton"),
  redoButton: document.querySelector("#redoButton"),
  strokeText: document.querySelector("#strokeText"),
  toast: document.querySelector("#toast"),
};

const editorContext = els.editorCanvas.getContext("2d");
const storageKeys = {
  color: "captureDesk.color",
  lineWidth: "captureDesk.lineWidth",
  arrowWidth: "captureDesk.arrowWidth",
  textSize: "captureDesk.textSize",
  cameraRotation: "captureDesk.cameraRotation",
  cameraPaneWidth: "captureDesk.cameraPaneWidth",
  galleryColumns: "captureDesk.galleryColumns",
};

let stream = null;
let captures = [];
let activePreviewCapture = null;
let deleteMode = false;
let selectedIds = new Set();
let toastTimer = 0;
let cameraRotation = Number(localStorage.getItem(storageKeys.cameraRotation) || 0);
let previewZoom = 1;
let previewCenter = { x: 0.5, y: 0.5 };
let previewPan = null;
let cameraSelectionTouched = false;
let cameraMode = "1080";
let splitterDrag = null;
const cameraModes = {
  "1080": { label: "1080p", width: 1920, height: 1080 },
  "2k": { label: "2K", width: 2560, height: 1440 },
  "4k": { label: "4K", width: 3840, height: 2160 },
};
const dragFileObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const capture = captures.find((item) => item.id === entry.target.dataset.id);
    if (capture && !capture.file) captureToFile(capture).catch(console.error);
    dragFileObserver.unobserve(entry.target);
  }
}, { root: els.gallery, rootMargin: "160px" });

let editor = {
  capture: null,
  image: null,
  tool: "crop",
  color: localStorage.getItem(storageKeys.color) || "#e53935",
  lineWidth: Number(localStorage.getItem(storageKeys.lineWidth) || 6),
  arrowWidth: Number(localStorage.getItem(storageKeys.arrowWidth) || 8),
  textSize: Number(localStorage.getItem(storageKeys.textSize) || 42),
  elements: [],
  cropRect: null,
  draft: null,
  gesture: null,
  history: [],
  redo: [],
};

function setStatus(message) {
  els.statusText.textContent = message;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("is-visible");
  }, 1800);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function stopStream() {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
  stream = null;
}

async function apiJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function loadCaptures() {
  try {
    captures = await apiJson("/api/captures");
    renderGallery();
  } catch (error) {
    console.error(error);
    showToast("读取本地图片失败");
  }
}

async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    setStatus("当前浏览器不支持摄像头枚举");
    return;
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const selected = els.cameraSelect.value;
  els.cameraSelect.innerHTML = "";

  for (const [index, camera] of cameras.entries()) {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    els.cameraSelect.append(option);
  }

  const preferredCamera = cameras.find((camera) => camera.label.toLowerCase().includes("decxin"));
  if (!cameraSelectionTouched && preferredCamera) {
    els.cameraSelect.value = preferredCamera.deviceId;
  } else if (selected && cameras.some((camera) => camera.deviceId === selected)) {
    els.cameraSelect.value = selected;
  }
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("当前浏览器不支持摄像头访问");
    return;
  }

  stopStream();
  setStatus("正在连接摄像头");
  els.overlay.classList.remove("is-hidden");

  try {
    await listCameras();
    const selectedDevice = els.cameraSelect.value;
    const deviceConstraint = selectedDevice ? { deviceId: { exact: selectedDevice } } : {};
    const requestedMode = cameraModes[cameraMode];
    const videoModes = [
      {
        width: { exact: requestedMode.width },
        height: { exact: requestedMode.height },
        frameRate: { ideal: 30, max: 30 },
      },
    ];

    let lastError = null;
    for (const videoMode of videoModes) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...videoMode, ...deviceConstraint },
        });
        break;
      } catch (error) {
        lastError = error;
        if (error.name === "NotAllowedError") throw error;
      }
    }
    if (!stream) throw lastError || new Error("No supported camera mode");

    els.video.srcObject = stream;
    await els.video.play();
    const activeDevice = stream.getVideoTracks()[0]?.getSettings().deviceId;
    await listCameras();
    if (!cameraSelectionTouched && els.cameraSelect.value && activeDevice !== els.cameraSelect.value) {
      stopStream();
      return startCamera();
    }
    updateResolution();
    updateVideoRotation();
    els.overlay.classList.add("is-hidden");
    setStatus("摄像头已就绪");
  } catch (error) {
    console.error(error);
    if (error.name === "NotAllowedError") {
      setStatus("摄像头权限被拒绝");
      els.overlay.querySelector("strong").textContent = "需要摄像头权限";
      els.overlay.querySelector("span").textContent = "授权后点击启动重试";
    } else {
      setStatus("摄像头启动失败");
      els.overlay.querySelector("strong").textContent = "摄像头不可用";
      els.overlay.querySelector("span").textContent = "请检查设备占用或连接状态";
    }
  }
}

function updateResolution() {
  const width = els.video.videoWidth;
  const height = els.video.videoHeight;
  els.resolutionText.textContent = width && height ? `${width} x ${height}` : "--";
}

function clampCameraPaneWidth(width) {
  const appWidth = els.appShell.clientWidth || window.innerWidth;
  const isPortrait = cameraRotation === 90 || cameraRotation === 270;
  const min = isPortrait ? 320 : 480;
  const rightMin = isPortrait ? 560 : 420;
  const max = Math.max(min, appWidth - rightMin - 40);
  return Math.round(Math.min(max, Math.max(min, width)));
}

function hasCustomCameraPaneWidth() {
  return Boolean(els.appShell.style.getPropertyValue("--camera-pane-width"));
}

function currentCameraPaneWidth() {
  const custom = Number.parseFloat(els.appShell.style.getPropertyValue("--camera-pane-width"));
  if (Number.isFinite(custom) && custom > 0) return custom;
  return els.videoButton.parentElement.getBoundingClientRect().width;
}

function applyCameraPaneWidth(width, persist = true) {
  const clamped = clampCameraPaneWidth(width);
  els.appShell.style.setProperty("--camera-pane-width", `${clamped}px`);
  if (persist) localStorage.setItem(storageKeys.cameraPaneWidth, String(clamped));
  return clamped;
}

function setCameraPaneWidth(width, persist = true) {
  applyCameraPaneWidth(width, persist);
  window.requestAnimationFrame(updateVideoRotation);
}

function restoreCameraPaneWidth() {
  const saved = Number(localStorage.getItem(storageKeys.cameraPaneWidth) || 0);
  if (saved > 0) {
    setCameraPaneWidth(saved, false);
  }
}

function normalizedRotation(value) {
  return ((value % 360) + 360) % 360;
}

function updateVideoRotation() {
  cameraRotation = normalizedRotation(cameraRotation);
  localStorage.setItem(storageKeys.cameraRotation, String(cameraRotation));

  const isPortrait = cameraRotation === 90 || cameraRotation === 270;
  document.body.classList.toggle("camera-portrait", isPortrait);

  if (hasCustomCameraPaneWidth()) {
    applyCameraPaneWidth(currentCameraPaneWidth());
  }

  if (isPortrait) {
    const paneWidth = Math.max(280, els.videoButton.parentElement.clientWidth);
    const stageTop = els.videoButton.getBoundingClientRect().top;
    const availableHeight = Math.max(360, window.innerHeight - stageTop - 16);
    let stageHeight = availableHeight;
    let stageWidth = stageHeight * (9 / 16);

    if (stageWidth > paneWidth) {
      stageWidth = paneWidth;
      stageHeight = stageWidth * (16 / 9);
    }

    els.videoButton.style.width = `${Math.floor(stageWidth)}px`;
    els.videoButton.style.height = `${Math.floor(stageHeight)}px`;
  } else {
    document.body.classList.remove("camera-portrait");
    els.videoButton.style.width = "";
    els.videoButton.style.height = "";
  }

  const stage = els.videoButton.getBoundingClientRect();
  if (isPortrait) {
    els.video.style.width = `${Math.max(1, stage.height)}px`;
    els.video.style.height = `${Math.max(1, stage.width)}px`;
  } else {
    els.video.style.width = "100%";
    els.video.style.height = "100%";
  }
  const panX = (0.5 - previewCenter.x) * 100;
  const panY = (0.5 - previewCenter.y) * 100;
  els.video.style.transform =
    `translate(-50%, -50%) rotate(${cameraRotation}deg) scale(${previewZoom}) translate(${panX}%, ${panY}%)`;
}

function clampPreviewCenter() {
  const halfVisible = 1 / (2 * previewZoom);
  previewCenter.x = Math.min(1 - halfVisible, Math.max(halfVisible, previewCenter.x));
  previewCenter.y = Math.min(1 - halfVisible, Math.max(halfVisible, previewCenter.y));
}

function adjustPreviewZoom(delta) {
  previewZoom = Math.min(4, Math.max(1, Math.round((previewZoom + delta) * 10) / 10));
  clampPreviewCenter();
  els.zoomIndicator.textContent = `${previewZoom.toFixed(1)}×`;
  els.videoButton.classList.toggle("is-zoomed", previewZoom > 1);
  updateVideoRotation();
}

function movePreviewCenter(deltaX, deltaY) {
  const radians = (cameraRotation * Math.PI) / 180;
  const localX = Math.cos(radians) * deltaX + Math.sin(radians) * deltaY;
  const localY = -Math.sin(radians) * deltaX + Math.cos(radians) * deltaY;
  const baseWidth = Math.max(1, els.video.offsetWidth);
  const baseHeight = Math.max(1, els.video.offsetHeight);
  previewCenter.x -= localX / (baseWidth * previewZoom);
  previewCenter.y -= localY / (baseHeight * previewZoom);
  clampPreviewCenter();
  updateVideoRotation();
}

function rotateCamera(delta) {
  cameraRotation = normalizedRotation(cameraRotation + delta);
  updateVideoRotation();
  showToast(`预览已旋转 ${cameraRotation}°`);
}

function updateDeleteControls() {
  els.gallery.classList.toggle("is-delete-mode", deleteMode);
  els.deleteActions.hidden = !deleteMode;
  els.deleteModeButton.hidden = deleteMode;
  els.selectedCount.textContent = `已选 ${selectedIds.size} 张`;
  els.confirmDeleteButton.disabled = selectedIds.size === 0;
}

function renderGallery() {
  dragFileObserver.disconnect();
  els.gallery.innerHTML = "";
  els.latestText.textContent = captures[0] ? captures[0].name : "尚无图片";
  selectedIds = new Set([...selectedIds].filter((id) => captures.some((item) => item.id === id)));

  for (const capture of captures) {
    const fragment = els.template.content.cloneNode(true);
    const card = fragment.querySelector(".capture-card");
    const img = fragment.querySelector("img");
    const name = fragment.querySelector(".capture-name");
    const size = fragment.querySelector(".capture-size");

    card.dataset.id = capture.id;
    card.classList.toggle("is-selected", selectedIds.has(capture.id));
    img.src = capture.url;
    img.dataset.id = capture.id;
    img.draggable = Boolean(capture.file);
    name.textContent = capture.name;
    size.textContent = formatBytes(capture.size);

    els.gallery.append(fragment);
    dragFileObserver.observe(els.gallery.lastElementChild);
  }

  updateDeleteControls();
}

async function captureFrame() {
  if (!stream || !els.video.videoWidth || !els.video.videoHeight) {
    showToast("摄像头还没有准备好");
    return;
  }

  const canvas = document.createElement("canvas");
  const sourceWidth = els.video.videoWidth;
  const sourceHeight = els.video.videoHeight;
  const rotated = cameraRotation === 90 || cameraRotation === 270;
  const cropWidth = sourceWidth / previewZoom;
  const cropHeight = sourceHeight / previewZoom;
  const cropX = previewCenter.x * sourceWidth - cropWidth / 2;
  const cropY = previewCenter.y * sourceHeight - cropHeight / 2;
  canvas.width = Math.round(rotated ? cropHeight : cropWidth);
  canvas.height = Math.round(rotated ? cropWidth : cropHeight);
  const context = canvas.getContext("2d", { alpha: false });
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate((cameraRotation * Math.PI) / 180);
  context.drawImage(
    els.video,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    -cropWidth / 2,
    -cropHeight / 2,
    cropWidth,
    cropHeight,
  );

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    showToast("拍照失败");
    return;
  }

  const response = await fetch("/api/captures", {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });

  if (!response.ok) {
    showToast("保存失败");
    return;
  }

  const saved = await response.json();
  saved.file = new File([blob], saved.name, { type: "image/png", lastModified: Date.now() });
  captures.unshift(saved);
  renderGallery();
  showToast(`已保存 ${saved.name}`);
}

async function captureToFile(capture) {
  if (capture.file) return capture.file;
  const response = await fetch(capture.url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const blob = await response.blob();
  capture.file = new File([blob], capture.name, {
    type: blob.type || "image/png",
    lastModified: Date.now(),
  });
  const image = els.gallery.querySelector(`img[data-id="${CSS.escape(capture.id)}"]`);
  if (image) image.draggable = true;
  return capture.file;
}

async function imageFileToPngBlob(file) {
  if (file.type === "image/png") return file;
  const image = new Image();
  const objectUrl = URL.createObjectURL(file);
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(image, 0, 0);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function copyCapture(capture) {
  if (!navigator.clipboard || !window.ClipboardItem) {
    showToast("当前浏览器不支持图片复制");
    return;
  }

  try {
    const file = await captureToFile(capture);
    const pngBlob = await imageFileToPngBlob(file);
    if (!pngBlob) throw new Error("PNG conversion failed");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
    showToast("已复制图片");
  } catch (error) {
    console.error(error);
    showToast("复制失败，请使用拖拽或下载");
  }
}

function openPreview(capture) {
  activePreviewCapture = capture;
  els.previewImage.src = capture.url;
  els.downloadPreviewLink.href = capture.url;
  els.downloadPreviewLink.download = capture.name;
  if (els.previewDialog.showModal) {
    els.previewDialog.showModal();
  } else {
    window.open(capture.url, "_blank", "noopener");
  }
}

function toggleSelect(capture) {
  if (selectedIds.has(capture.id)) {
    selectedIds.delete(capture.id);
  } else {
    selectedIds.add(capture.id);
  }
  renderGallery();
  preloadSelectedCaptures();
}

function setDeleteMode(active) {
  deleteMode = active;
  selectedIds.clear();
  renderGallery();
}

function selectedCapturesInOrder() {
  return captures.filter((capture) => selectedIds.has(capture.id));
}

function preloadSelectedCaptures() {
  const targets = selectedCapturesInOrder().filter((capture) => !capture.file);
  if (!targets.length) return;
  Promise.all(targets.map((capture) => captureToFile(capture))).catch(console.error);
}

function missingDragFiles(targets) {
  return targets.filter((capture) => !capture.file);
}

function setGalleryColumns(columns, persist = true) {
  const safeColumns = ["1", "2", "3", "4"].includes(String(columns)) ? String(columns) : "2";
  els.gallery.classList.remove("columns-1", "columns-2", "columns-3", "columns-4");
  els.gallery.classList.add(`columns-${safeColumns}`);
  document.querySelectorAll("[data-columns]").forEach((item) => {
    item.classList.toggle("is-active", item.dataset.columns === safeColumns);
  });
  if (persist) localStorage.setItem(storageKeys.galleryColumns, safeColumns);
}

async function confirmDeleteSelected() {
  const targets = selectedCapturesInOrder();
  if (!targets.length) return;
  const names = targets.map((capture) => capture.name).join("、");
  if (!window.confirm(`确定删除 ${targets.length} 张图片吗？\n${names}`)) return;

  for (const capture of targets) {
    const response = await fetch(`/api/captures/${encodeURIComponent(capture.name)}`, { method: "DELETE" });
    if (!response.ok) {
      showToast(`删除失败：${capture.name}`);
      return;
    }
  }

  captures = captures.filter((capture) => !selectedIds.has(capture.id));
  setDeleteMode(false);
  showToast("已删除所选图片");
}

async function shutdownServer() {
  els.shutdownButton.disabled = true;
  showToast("正在关闭本地服务");
  stopStream();
  try {
    const response = await fetch("/api/shutdown", { method: "POST" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    setStatus("本地服务已关闭");
    showToast("本地服务已关闭");
  } catch (error) {
    console.error(error);
    els.shutdownButton.disabled = false;
    showToast("关闭失败，请稍后重试");
  }
}

function getCaptureFromEvent(event) {
  const card = event.target.closest(".capture-card");
  if (!card) return null;
  return captures.find((capture) => capture.id === card.dataset.id) || null;
}

function viewportRect() {
  if (editor.cropRect) return editor.cropRect;
  return { x: 0, y: 0, width: editor.image.naturalWidth, height: editor.image.naturalHeight };
}

function screenPointToImage(event) {
  const rect = els.editorCanvas.getBoundingClientRect();
  const view = viewportRect();
  return {
    x: view.x + ((event.clientX - rect.left) / rect.width) * view.width,
    y: view.y + ((event.clientY - rect.top) / rect.height) * view.height,
  };
}

function imagePointToViewport(point) {
  const view = viewportRect();
  return { x: point.x - view.x, y: point.y - view.y };
}

function normalizeRect(a, b) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

function cloneState() {
  return JSON.parse(JSON.stringify({
    elements: editor.elements,
    cropRect: editor.cropRect,
  }));
}

function restoreState(state) {
  editor.elements = JSON.parse(JSON.stringify(state.elements || []));
  editor.cropRect = state.cropRect || null;
  editor.draft = null;
  editor.gesture = null;
  renderEditor();
}

function commitHistory() {
  editor.history.push(cloneState());
  editor.redo = [];
  updateHistoryButtons();
}

function undoEditor() {
  if (editor.history.length <= 1) return;
  editor.redo.push(editor.history.pop());
  restoreState(editor.history[editor.history.length - 1]);
  updateHistoryButtons();
}

function redoEditor() {
  if (!editor.redo.length) return;
  const state = editor.redo.pop();
  editor.history.push(state);
  restoreState(state);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  els.undoButton.disabled = editor.history.length <= 1;
  els.redoButton.disabled = editor.redo.length === 0;
}

function activeSize() {
  if (editor.tool === "line") return editor.lineWidth;
  if (editor.tool === "arrow") return editor.arrowWidth;
  if (editor.tool === "text") return editor.textSize;
  return null;
}

function updateEditorStatus() {
  if (editor.tool === "line") {
    els.strokeText.textContent = `线宽 ${editor.lineWidth}`;
  } else if (editor.tool === "arrow") {
    els.strokeText.textContent = `箭头宽 ${editor.arrowWidth}`;
  } else if (editor.tool === "text") {
    els.strokeText.textContent = `文字 ${editor.textSize}`;
  } else {
    els.strokeText.textContent = editor.cropRect ? "已裁切" : "";
  }
  localStorage.setItem(storageKeys.color, editor.color);
  localStorage.setItem(storageKeys.lineWidth, String(editor.lineWidth));
  localStorage.setItem(storageKeys.arrowWidth, String(editor.arrowWidth));
  localStorage.setItem(storageKeys.textSize, String(editor.textSize));
}

function fitCanvasToScreen() {
  const view = viewportRect();
  const availableWidth = Math.max(100, els.canvasWrap.clientWidth - 4);
  const availableHeight = Math.max(100, els.canvasWrap.clientHeight - 4);
  const scale = Math.min(availableWidth / view.width, availableHeight / view.height);
  els.editorCanvas.style.width = `${Math.floor(view.width * scale)}px`;
  els.editorCanvas.style.height = `${Math.floor(view.height * scale)}px`;
}

function drawArrowHead(context, from, to, width) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const length = Math.max(14, width * 5);
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - length * Math.cos(angle - Math.PI / 6), to.y - length * Math.sin(angle - Math.PI / 6));
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - length * Math.cos(angle + Math.PI / 6), to.y - length * Math.sin(angle + Math.PI / 6));
  context.stroke();
}

function drawPath(context, points) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

function drawTextElement(context, element, offset) {
  const x = element.x - offset.x;
  const y = element.y - offset.y;
  context.font = `${element.size}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  context.textBaseline = "top";
  context.fillStyle = element.color;
  context.fillText(element.text, x, y);
}

function drawElement(context, element, offset) {
  context.save();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.strokeStyle = element.color;
  context.fillStyle = element.color;

  if (element.type === "line") {
    context.lineWidth = element.width;
    drawPath(context, element.points.map((point) => ({ x: point.x - offset.x, y: point.y - offset.y })));
  }

  if (element.type === "arrow") {
    const from = { x: element.from.x - offset.x, y: element.from.y - offset.y };
    const to = { x: element.to.x - offset.x, y: element.to.y - offset.y };
    context.lineWidth = element.width;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    drawArrowHead(context, from, to, element.width);
  }

  if (element.type === "text") {
    drawTextElement(context, element, offset);
  }

  context.restore();
}

function drawCropOverlay(context, rect, offset) {
  const view = viewportRect();
  context.save();
  context.fillStyle = "rgb(0 0 0 / 35%)";
  context.beginPath();
  context.rect(0, 0, view.width, view.height);
  context.rect(rect.x - offset.x, rect.y - offset.y, rect.width, rect.height);
  context.fill("evenodd");
  context.setLineDash([10, 7]);
  context.lineWidth = Math.max(2, view.width / 700);
  context.strokeStyle = "#ffffff";
  context.strokeRect(rect.x - offset.x, rect.y - offset.y, rect.width, rect.height);
  context.restore();
}

function renderEditor() {
  if (!editor.image) return;
  const view = viewportRect();
  els.editorCanvas.width = Math.max(1, Math.round(view.width));
  els.editorCanvas.height = Math.max(1, Math.round(view.height));
  fitCanvasToScreen();

  editorContext.clearRect(0, 0, els.editorCanvas.width, els.editorCanvas.height);
  editorContext.drawImage(
    editor.image,
    view.x,
    view.y,
    view.width,
    view.height,
    0,
    0,
    view.width,
    view.height,
  );

  for (const element of editor.elements) {
    drawElement(editorContext, element, view);
  }

  if (editor.draft) {
    if (editor.draft.type === "crop") {
      drawCropOverlay(editorContext, editor.draft.rect, view);
    } else {
      drawElement(editorContext, editor.draft, view);
    }
  } else if (editor.cropRect) {
    drawCropOverlay(editorContext, editor.cropRect, view);
  }
}

async function loadImage(url) {
  const image = new Image();
  image.decoding = "async";
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = `${url}?v=${Date.now()}`;
  });
  return image;
}

function elementBounds(element) {
  if (element.type === "text") {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    context.font = `${element.size}px "Microsoft YaHei", "Segoe UI", sans-serif`;
    const width = context.measureText(element.text).width;
    return { x: element.x, y: element.y, width, height: element.size * 1.25 };
  }
  if (element.type === "arrow") {
    return normalizeRect(element.from, element.to);
  }
  if (element.type === "line") {
    const xs = element.points.map((point) => point.x);
    const ys = element.points.map((point) => point.y);
    return {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
  }
  return null;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function hitElement(point) {
  for (let index = editor.elements.length - 1; index >= 0; index--) {
    const element = editor.elements[index];
    if (element.type === "text") {
      const bounds = elementBounds(element);
      if (
        point.x >= bounds.x - 8 &&
        point.x <= bounds.x + bounds.width + 8 &&
        point.y >= bounds.y - 8 &&
        point.y <= bounds.y + bounds.height + 8
      ) {
        return { element, index };
      }
    }
    if (element.type === "arrow") {
      const tolerance = Math.max(12, element.width * 1.5);
      if (distanceToSegment(point, element.from, element.to) <= tolerance) return { element, index };
    }
    if (element.type === "line") {
      const tolerance = Math.max(12, element.width * 1.5);
      for (let i = 1; i < element.points.length; i++) {
        if (distanceToSegment(point, element.points[i - 1], element.points[i]) <= tolerance) {
          return { element, index };
        }
      }
    }
  }
  return null;
}

function hitCrop(point) {
  if (!editor.cropRect) return false;
  const rect = editor.cropRect;
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function cropHitMode(point) {
  if (!editor.cropRect) return null;
  const rect = editor.cropRect;
  const tolerance = Math.max(18, Math.min(rect.width, rect.height) * 0.035);
  if (!hitCrop(point)) return null;
  const nearLeft = Math.abs(point.x - rect.x) <= tolerance;
  const nearRight = Math.abs(point.x - (rect.x + rect.width)) <= tolerance;
  const nearTop = Math.abs(point.y - rect.y) <= tolerance;
  const nearBottom = Math.abs(point.y - (rect.y + rect.height)) <= tolerance;

  if (nearLeft || nearRight || nearTop || nearBottom) {
    return {
      type: "resize-crop",
      left: nearLeft,
      right: nearRight,
      top: nearTop,
      bottom: nearBottom,
    };
  }

  return { type: "move-crop" };
}

function moveElement(element, dx, dy) {
  if (element.type === "text") {
    element.x += dx;
    element.y += dy;
  }
  if (element.type === "arrow") {
    element.from.x += dx;
    element.from.y += dy;
    element.to.x += dx;
    element.to.y += dy;
  }
  if (element.type === "line") {
    element.points = element.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  }
}

function setTool(tool) {
  editor.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tool === tool);
  });
  updateEditorStatus();
}

function setColor(color) {
  editor.color = color;
  localStorage.setItem(storageKeys.color, color);
  document.querySelectorAll("[data-color]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.color === color);
  });
}

async function openEditor(capture) {
  if (!capture) return;
  editor.capture = capture;
  editor.image = await loadImage(capture.url);
  editor.elements = [];
  editor.cropRect = null;
  editor.draft = null;
  editor.gesture = null;
  editor.history = [];
  editor.redo = [];
  setColor(editor.color);
  updateEditorStatus();
  if (els.editorDialog.showModal) {
    els.editorDialog.showModal();
  }
  renderEditor();
  commitHistory();
}

function finalRenderCanvas() {
  const view = viewportRect();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(view.width);
  canvas.height = Math.round(view.height);
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(editor.image, view.x, view.y, view.width, view.height, 0, 0, view.width, view.height);
  for (const element of editor.elements) {
    drawElement(context, element, view);
  }
  return canvas;
}

async function saveEdit() {
  if (!editor.capture || !editor.image) return;
  const canvas = finalRenderCanvas();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    showToast("保存编辑失败");
    return;
  }

  const response = await fetch(`/api/edits?source=${encodeURIComponent(editor.capture.name)}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });

  if (!response.ok) {
    showToast("保存编辑失败");
    return;
  }

  const saved = await response.json();
  saved.file = new File([blob], saved.name, { type: "image/png", lastModified: Date.now() });
  await loadCaptures();
  els.editorDialog.close();
  if (els.previewDialog.open) els.previewDialog.close();
  showToast(`已保存 ${saved.name}`);
}

function createText(point) {
  const text = window.prompt("输入文本", "");
  if (!text) return;
  editor.elements.push({
    id: crypto.randomUUID(),
    type: "text",
    x: point.x,
    y: point.y,
    text,
    color: editor.color,
    size: editor.textSize,
  });
  commitHistory();
  renderEditor();
}

function editText(element) {
  const text = window.prompt("编辑文本", element.text);
  if (text === null) return;
  element.text = text;
  element.color = editor.color;
  commitHistory();
  renderEditor();
}

function handleEditorDown(event) {
  if (!editor.image) return;
  const point = screenPointToImage(event);
  const hit = hitElement(point);

  if (event.ctrlKey && hit) {
    editor.gesture = { type: "move-element", index: hit.index, last: point };
    els.editorCanvas.setPointerCapture(event.pointerId);
    return;
  }

  const cropMode = event.ctrlKey ? cropHitMode(point) : null;
  if (cropMode?.type === "resize-crop") {
    editor.gesture = { ...cropMode, startRect: { ...editor.cropRect }, last: point };
    els.editorCanvas.setPointerCapture(event.pointerId);
    return;
  }

  if (cropMode?.type === "move-crop") {
    editor.gesture = { type: "move-crop", last: point };
    els.editorCanvas.setPointerCapture(event.pointerId);
    return;
  }

  if (editor.tool === "eraser") {
    if (hit) {
      editor.elements.splice(hit.index, 1);
      commitHistory();
      renderEditor();
    }
    return;
  }

  if (hit?.element.type === "text" && !event.ctrlKey) {
    editText(hit.element);
    return;
  }

  if (editor.tool === "text") {
    createText(point);
    return;
  }

  if (editor.tool === "crop") {
    editor.gesture = { type: "crop", start: point };
  } else if (editor.tool === "line") {
    const element = {
      id: crypto.randomUUID(),
      type: "line",
      points: [point],
      color: editor.color,
      width: editor.lineWidth,
    };
    editor.gesture = { type: "line", element };
    editor.draft = element;
  } else if (editor.tool === "arrow") {
    editor.gesture = { type: "arrow", start: point };
  }
  els.editorCanvas.setPointerCapture(event.pointerId);
}

function handleEditorMove(event) {
  if (!editor.gesture) return;
  const point = screenPointToImage(event);
  const gesture = editor.gesture;

  if (gesture.type === "move-element") {
    const element = editor.elements[gesture.index];
    if (!element) return;
    moveElement(element, point.x - gesture.last.x, point.y - gesture.last.y);
    gesture.last = point;
    renderEditor();
    return;
  }

  if (gesture.type === "move-crop" && editor.cropRect) {
    editor.cropRect.x += point.x - gesture.last.x;
    editor.cropRect.y += point.y - gesture.last.y;
    gesture.last = point;
    renderEditor();
    return;
  }

  if (gesture.type === "resize-crop" && editor.cropRect) {
    const rect = { ...gesture.startRect };
    const dx = point.x - gesture.last.x;
    const dy = point.y - gesture.last.y;
    if (gesture.left) {
      rect.x += dx;
      rect.width -= dx;
    }
    if (gesture.right) {
      rect.width += dx;
    }
    if (gesture.top) {
      rect.y += dy;
      rect.height -= dy;
    }
    if (gesture.bottom) {
      rect.height += dy;
    }
    if (rect.width >= 20 && rect.height >= 20) {
      editor.cropRect = rect;
    }
    renderEditor();
    return;
  }

  if (gesture.type === "crop") {
    editor.draft = { type: "crop", rect: normalizeRect(gesture.start, point) };
  }

  if (gesture.type === "line") {
    gesture.element.points.push(point);
    editor.draft = gesture.element;
  }

  if (gesture.type === "arrow") {
    editor.draft = {
      id: "draft-arrow",
      type: "arrow",
      from: gesture.start,
      to: point,
      color: editor.color,
      width: editor.arrowWidth,
    };
  }

  renderEditor();
}

function handleEditorUp(event) {
  if (!editor.gesture) return;
  const point = screenPointToImage(event);
  const gesture = editor.gesture;

  if (gesture.type === "crop") {
    const rect = normalizeRect(gesture.start, point);
    if (rect.width >= 20 && rect.height >= 20) {
      editor.cropRect = rect;
      commitHistory();
    } else {
      showToast("裁切区域太小");
    }
  }

  if (gesture.type === "line") {
    if (gesture.element.points.length > 1) {
      editor.elements.push(gesture.element);
      commitHistory();
    }
  }

  if (gesture.type === "arrow") {
    if (Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 8) {
      editor.elements.push({
        id: crypto.randomUUID(),
        type: "arrow",
        from: gesture.start,
        to: point,
        color: editor.color,
        width: editor.arrowWidth,
      });
      commitHistory();
    }
  }

  if (gesture.type === "move-element" || gesture.type === "move-crop" || gesture.type === "resize-crop") {
    commitHistory();
  }

  editor.gesture = null;
  editor.draft = null;
  renderEditor();
}

function adjustActiveSize(delta) {
  if (editor.tool === "line") {
    editor.lineWidth = Math.min(60, Math.max(1, editor.lineWidth + delta));
  }
  if (editor.tool === "arrow") {
    editor.arrowWidth = Math.min(60, Math.max(1, editor.arrowWidth + delta));
  }
  if (editor.tool === "text") {
    editor.textSize = Math.min(160, Math.max(8, editor.textSize + delta * 2));
  }
  updateEditorStatus();
  renderEditor();
}

function adjustElementSize(element, delta) {
  if (element.type === "line") {
    element.width = Math.min(60, Math.max(1, element.width + delta));
    editor.lineWidth = element.width;
  }
  if (element.type === "arrow") {
    element.width = Math.min(60, Math.max(1, element.width + delta));
    editor.arrowWidth = element.width;
  }
  if (element.type === "text") {
    element.size = Math.min(160, Math.max(8, element.size + delta * 2));
    editor.textSize = element.size;
  }
  updateEditorStatus();
  renderEditor();
}

els.startButton.addEventListener("click", startCamera);
els.captureButton.addEventListener("click", captureFrame);
els.videoButton.addEventListener("click", captureFrame);
els.cameraSelect.addEventListener("change", () => {
  cameraSelectionTouched = true;
  startCamera();
});
els.videoButton.addEventListener("wheel", (event) => {
  event.preventDefault();
  adjustPreviewZoom(event.deltaY < 0 ? 0.1 : -0.1);
}, { passive: false });
window.addEventListener("keydown", (event) => {
  if (!els.videoButton.matches(":hover") || event.ctrlKey || event.altKey || event.metaKey) return;
  const modeByKey = { "1": "1080", "2": "2k", "3": "4k" };
  const nextMode = modeByKey[event.key];
  if (!nextMode) return;
  event.preventDefault();
  cameraMode = nextMode;
  showToast(`正在切换到 ${cameraModes[cameraMode].label}`);
  startCamera();
});
els.videoButton.addEventListener("pointerdown", (event) => {
  if (event.button !== 1 || previewZoom <= 1) return;
  event.preventDefault();
  previewPan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  els.videoButton.classList.add("is-panning");
  els.videoButton.setPointerCapture(event.pointerId);
});
els.videoButton.addEventListener("pointermove", (event) => {
  if (!previewPan || event.pointerId !== previewPan.pointerId) return;
  movePreviewCenter(event.clientX - previewPan.x, event.clientY - previewPan.y);
  previewPan.x = event.clientX;
  previewPan.y = event.clientY;
});
function stopPreviewPan(event) {
  if (!previewPan || (event && event.pointerId !== previewPan.pointerId)) return;
  previewPan = null;
  els.videoButton.classList.remove("is-panning");
}
els.videoButton.addEventListener("pointerup", stopPreviewPan);
els.videoButton.addEventListener("pointercancel", stopPreviewPan);
els.rotateLeftButton.addEventListener("click", () => rotateCamera(-90));
els.rotateRightButton.addEventListener("click", () => rotateCamera(90));
els.deleteModeButton.addEventListener("click", () => setDeleteMode(true));
els.cancelDeleteButton.addEventListener("click", () => setDeleteMode(false));
els.confirmDeleteButton.addEventListener("click", confirmDeleteSelected);
els.shutdownButton.addEventListener("click", shutdownServer);
els.video.addEventListener("loadedmetadata", updateResolution);

els.splitter.addEventListener("pointerdown", (event) => {
  const appRect = els.appShell.getBoundingClientRect();
  const appStyle = window.getComputedStyle(els.appShell);
  splitterDrag = {
    pointerId: event.pointerId,
    appLeft: appRect.left + Number.parseFloat(appStyle.paddingLeft || "0"),
  };
  els.splitter.classList.add("is-dragging");
  els.splitter.setPointerCapture(event.pointerId);
});

function handleSplitterMove(event) {
  if (!splitterDrag) return;
  setCameraPaneWidth(event.clientX - splitterDrag.appLeft);
}

function stopSplitterDrag() {
  if (!splitterDrag) return;
  splitterDrag = null;
  els.splitter.classList.remove("is-dragging");
}

els.splitter.addEventListener("pointermove", handleSplitterMove);
document.addEventListener("pointermove", handleSplitterMove);
els.splitter.addEventListener("pointerup", stopSplitterDrag);
els.splitter.addEventListener("pointercancel", stopSplitterDrag);
document.addEventListener("pointerup", stopSplitterDrag);
document.addEventListener("pointercancel", stopSplitterDrag);

document.querySelectorAll("[data-columns]").forEach((button) => {
  button.addEventListener("click", () => {
    setGalleryColumns(button.dataset.columns);
  });
});

document.querySelectorAll("[data-tool]").forEach((button) => {
  button.addEventListener("click", () => setTool(button.dataset.tool));
});

document.querySelectorAll("[data-color]").forEach((button) => {
  button.addEventListener("click", () => setColor(button.dataset.color));
});

els.gallery.addEventListener("click", (event) => {
  const capture = getCaptureFromEvent(event);
  if (!capture) return;
  if (event.ctrlKey) {
    if (!deleteMode) {
      deleteMode = true;
      selectedIds.clear();
      selectedIds.add(capture.id);
      renderGallery();
      preloadSelectedCaptures();
      return;
    }
    toggleSelect(capture);
    return;
  }
  if (deleteMode) {
    toggleSelect(capture);
    return;
  }
  openPreview(capture);
});

els.gallery.addEventListener("contextmenu", async (event) => {
  const capture = getCaptureFromEvent(event);
  if (!capture) return;
  if (deleteMode) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  await copyCapture(capture);
});

els.gallery.addEventListener("pointerenter", (event) => {
  const capture = getCaptureFromEvent(event);
  if (!capture || capture.file) return;
  captureToFile(capture).catch(console.error);
}, true);

els.gallery.addEventListener("dragstart", (event) => {
  const capture = captures.find((item) => item.id === event.target.dataset.id);
  if (!capture) return;
  const targets = deleteMode && selectedIds.has(capture.id) ? selectedCapturesInOrder() : [capture];
  const missing = missingDragFiles(targets);
  if (missing.length) {
    event.preventDefault();
    Promise.all(missing.map((item) => captureToFile(item)))
      .then(() => showToast(targets.length > 1
        ? `已准备 ${targets.length} 张图片，请再拖一次`
        : "图片已准备好，请再拖一次"))
      .catch((error) => {
        console.error(error);
        showToast("拖拽文件准备失败");
      });
    showToast(targets.length > 1 ? "正在准备多图拖拽文件" : "正在准备图片");
    return;
  }

  event.dataTransfer.effectAllowed = "copy";
  if (targets.length === 1) {
    event.dataTransfer.setData("DownloadURL", `image/png:${targets[0].name}:${location.origin}${targets[0].url}`);
  }
  event.dataTransfer.setData(
    "text/uri-list",
    targets.map((item) => `${location.origin}${item.url}`).join("\n"),
  );
  event.dataTransfer.setData("text/plain", targets.map((item) => item.name).join("\n"));
  for (const item of targets) {
    if (item.file) event.dataTransfer.items.add(item.file);
  }
  if (targets.length > 1) showToast(`正在拖拽 ${targets.length} 张图片`);
});

els.closePreviewButton.addEventListener("click", () => els.previewDialog.close());
els.previewDialog.addEventListener("click", (event) => {
  if (event.target === els.previewDialog) els.previewDialog.close();
});
els.editPreviewButton.addEventListener("click", async () => openEditor(activePreviewCapture));
els.closeEditorButton.addEventListener("click", () => els.editorDialog.close());
els.saveEditButton.addEventListener("click", saveEdit);
els.undoButton.addEventListener("click", undoEditor);
els.redoButton.addEventListener("click", redoEditor);

els.editorCanvas.addEventListener("pointerdown", handleEditorDown);
els.editorCanvas.addEventListener("pointermove", handleEditorMove);
els.editorCanvas.addEventListener("pointerup", handleEditorUp);
els.editorCanvas.addEventListener("pointercancel", () => {
  editor.gesture = null;
  editor.draft = null;
  renderEditor();
});

els.editorDialog.addEventListener("wheel", (event) => {
  if (event.ctrlKey) {
    const point = screenPointToImage(event);
    const hit = hitElement(point);
    event.preventDefault();
    if (hit) {
      adjustElementSize(hit.element, event.deltaY < 0 ? 1 : -1);
      commitHistory();
    }
    return;
  }

  if (!["line", "arrow", "text"].includes(editor.tool)) return;
  event.preventDefault();
  adjustActiveSize(event.deltaY < 0 ? 1 : -1);
}, { passive: false });

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && deleteMode && !els.editorDialog.open && !els.previewDialog.open) {
    event.preventDefault();
    setDeleteMode(false);
    return;
  }

  if (!els.editorDialog.open || !event.ctrlKey) return;
  const key = event.key.toLowerCase();
  if (key === "z") {
    event.preventDefault();
    undoEditor();
  }
  if (key === "y") {
    event.preventDefault();
    redoEditor();
  }
});

window.addEventListener("resize", () => {
  const saved = Number(localStorage.getItem(storageKeys.cameraPaneWidth) || 0);
  if (saved > 0) setCameraPaneWidth(saved, false);
  updateVideoRotation();
  if (els.editorDialog.open) renderEditor();
});
window.addEventListener("beforeunload", stopStream);

restoreCameraPaneWidth();
setGalleryColumns(localStorage.getItem(storageKeys.galleryColumns) || "2", false);
updateVideoRotation();
setColor(editor.color);
setTool(editor.tool);
updateEditorStatus();
loadCaptures();
listCameras()
  .then(startCamera)
  .catch((error) => {
    console.error(error);
    setStatus("摄像头初始化失败");
  });
