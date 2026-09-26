// =======================================================
// LIVE CAMERA CAPTURE UTILITY
// =======================================================
// Shared by: member's one-time profile verification (selfie,
// selfie-holding-ID) and a security guarantor's verification.
//
// Deliberately camera-only — no <input type="file"> fallback — so a
// selfie/selfie-with-ID can't be swapped for an old photo or a photo of
// a photo. Gov ID front/back photos are a separate, ordinary file-upload
// flow (a physical ID card isn't "live captured" the same way) and do
// NOT go through this utility.
//
// Builds its own modal DOM on demand and tears it down when done, so it
// doesn't depend on any markup already being in index.html.

export interface CaptureOptions {
  /** Shown as the modal heading, e.g. "Take a selfie" */
  title: string;
  /** Extra instruction line under the title, e.g. "Hold your ID next to your face" */
  instructions?: string;
  /** "user" = front/selfie camera (default), "environment" = back camera */
  facingMode?: "user" | "environment";
  /** File name prefix used for the returned File, e.g. "selfie" -> selfie_169999.jpg */
  fileNamePrefix: string;
}

export class CameraCaptureCancelledError extends Error {
  constructor() {
    super("Camera capture cancelled by user.");
    this.name = "CameraCaptureCancelledError";
  }
}

export class CameraUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CameraUnavailableError";
  }
}

/**
 * Opens a full-screen live-camera modal, lets the person capture and
 * confirm (or retake) a photo, and resolves with the captured photo as
 * a File. Rejects with CameraCaptureCancelledError if they back out, or
 * CameraUnavailableError if the camera can't be reached at all.
 */
export function captureLivePhoto(options: CaptureOptions): Promise<File> {
  return new Promise((resolve, reject) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      reject(
        new CameraUnavailableError(
          "This device/browser doesn't support live camera capture."
        )
      );
      return;
    }

    // ---------- Build modal DOM ----------
    const overlay = document.createElement("div");
    overlay.className = "camera-capture-overlay";
    overlay.innerHTML = `
      <div class="camera-capture-box">
        <h3 class="camera-capture-title"></h3>
        <p class="camera-capture-instructions"></p>
        <div class="camera-capture-frame">
          <video class="camera-capture-video" autoplay playsinline muted></video>
          <canvas class="camera-capture-canvas" style="display:none;"></canvas>
          <img class="camera-capture-preview" style="display:none;" alt="Captured photo preview" />
        </div>
        <p class="camera-capture-error" style="display:none; color:#ff6b6b;"></p>
        <div class="camera-capture-actions">
          <button type="button" class="camera-capture-cancel-btn">Cancel</button>
          <button type="button" class="camera-capture-snap-btn">📸 Capture</button>
          <button type="button" class="camera-capture-retake-btn" style="display:none;">Retake</button>
          <button type="button" class="camera-capture-confirm-btn" style="display:none;">Use Photo</button>
        </div>
      </div>
    `;

    const titleEl = overlay.querySelector(".camera-capture-title") as HTMLElement;
    const instructionsEl = overlay.querySelector(".camera-capture-instructions") as HTMLElement;
    const videoEl = overlay.querySelector(".camera-capture-video") as HTMLVideoElement;
    const canvasEl = overlay.querySelector(".camera-capture-canvas") as HTMLCanvasElement;
    const previewEl = overlay.querySelector(".camera-capture-preview") as HTMLImageElement;
    const errorEl = overlay.querySelector(".camera-capture-error") as HTMLElement;
    const cancelBtn = overlay.querySelector(".camera-capture-cancel-btn") as HTMLButtonElement;
    const snapBtn = overlay.querySelector(".camera-capture-snap-btn") as HTMLButtonElement;
    const retakeBtn = overlay.querySelector(".camera-capture-retake-btn") as HTMLButtonElement;
    const confirmBtn = overlay.querySelector(".camera-capture-confirm-btn") as HTMLButtonElement;

    titleEl.textContent = options.title;
    if (options.instructions) {
      instructionsEl.textContent = options.instructions;
    } else {
      instructionsEl.style.display = "none";
    }

    document.body.appendChild(overlay);

    let stream: MediaStream | null = null;
    let capturedBlob: Blob | null = null;
    let settled = false;

    function stopStream() {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    function cleanup() {
      stopStream();
      overlay.remove();
    }

    function settleResolve(file: File) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    }

    function settleReject(err: Error) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    }

    function showError(message: string) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    }

    cancelBtn.addEventListener("click", () => {
      settleReject(new CameraCaptureCancelledError());
    });

    snapBtn.addEventListener("click", () => {
      if (!videoEl.videoWidth || !videoEl.videoHeight) return;

      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      const ctx = canvasEl.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);

      canvasEl.toBlob(
        (blob) => {
          if (!blob) {
            showError("⚠️ Couldn't capture photo. Please try again.");
            return;
          }
          capturedBlob = blob;
          previewEl.src = URL.createObjectURL(blob);

          videoEl.style.display = "none";
          previewEl.style.display = "block";
          snapBtn.style.display = "none";
          retakeBtn.style.display = "inline-block";
          confirmBtn.style.display = "inline-block";
        },
        "image/jpeg",
        0.92
      );
    });

    retakeBtn.addEventListener("click", () => {
      capturedBlob = null;
      videoEl.style.display = "block";
      previewEl.style.display = "none";
      snapBtn.style.display = "inline-block";
      retakeBtn.style.display = "none";
      confirmBtn.style.display = "none";
    });

    confirmBtn.addEventListener("click", () => {
      if (!capturedBlob) return;
      const fileName = `${options.fileNamePrefix}_${Date.now()}.jpg`;
      const file = new File([capturedBlob], fileName, { type: "image/jpeg" });
      settleResolve(file);
    });

    // ---------- Start the camera ----------
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: options.facingMode ?? "user" },
        audio: false,
      })
      .then((mediaStream) => {
        if (settled) {
          // Modal was cancelled while permission prompt was open.
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = mediaStream;
        videoEl.srcObject = mediaStream;
      })
      .catch((err) => {
        console.error("Camera capture error:", err);
        settleReject(
          new CameraUnavailableError(
            "Couldn't access your camera. Please allow camera permission and try again."
          )
        );
      });
  });
}
