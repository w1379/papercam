# PaperCam

PaperCam is a small, dependency-free local web application for capturing paper documents with a camera on Windows. It provides a live camera preview, local image storage, a capture gallery, and basic annotation and cropping tools.

## Features

- Selects an available camera and supports 1080p, 2K, 2592 x 1944, and 3264 x 2448 capture modes
- Starts in 2K mode with a 1.5x preview zoom
- Provides a camera refocus control when supported by the device
- Rotates and zooms the live preview
- Saves captures as numbered PNG files in a local `captures` directory
- Displays, downloads, copies, drags, and deletes saved captures
- Creates edited copies with crop, freehand line, arrow, and text tools
- Runs entirely on localhost with no external services or runtime dependencies

## Requirements

- Windows 11
- Node.js
- A Chromium-based browser with camera access
- A connected camera or document camera

## Run

Double-click:

```text
start-camera-optimized.cmd
```

The launcher starts the local server in the background and opens:

```text
http://127.0.0.1:5173
```

Alternatively, start it from a terminal:

```powershell
npm start
```

The application creates `captures/` automatically. Captured and edited images remain on the local machine and are not tracked by Git.

## Camera Controls

- Use the camera selector to switch devices.
- Click the preview or the capture button to take a photo.
- Press `1`, `2`, `3`, or `4` while the preview is active to request 1080p, 2K, 2592 x 1944, or 3264 x 2448.
- Use the refocus button to restart continuous focus on compatible cameras.
- Use the mouse wheel over the preview to zoom.
- Middle-drag a zoomed preview to reposition it.
- Use the rotate buttons to rotate the camera view.

Available resolutions depend on the camera and its driver.

## Privacy

PaperCam binds only to `127.0.0.1`. Camera frames and captured images are processed locally. The repository excludes captures, generated documents, logs, screenshots, archives, local configuration, and common secret files.

## Repository Notes

This repository contains a clean source snapshot without the history or private working files from the original development repository.
