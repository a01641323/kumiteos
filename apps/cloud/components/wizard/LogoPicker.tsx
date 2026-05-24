"use client";

// LogoPicker — file → resize → WebP encode → base64 data URL.
// All work is in the browser; the server only ever sees the final
// compressed data URL stored under bundle.logoDataUrl.
//
// - Resize: max 512 on the longest edge, aspect preserved.
// - Encode: WebP @ q=0.85; falls back to PNG if WebP encode unsupported.
// - Hard cap: rejects >200 KB final blobs with a friendly message.

import { useRef, useState } from "react";

const MAX_EDGE = 512;
const HARD_CAP_BYTES = 200 * 1024;
const QUALITY = 0.85;

export interface LogoState {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
  format: "webp" | "png";
}

interface Props {
  value: string | null;
  onChange: (v: string | null) => void;
}

export function LogoPicker({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<LogoState | null>(() => deriveMetaFromDataUrl(value));

  async function handleFile(file: File) {
    setError(null);
    setBusy(true);
    try {
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);

      const { canvas, w, h } = drawFit(img, MAX_EDGE);
      let blob = await canvasToBlob(canvas, "image/webp", QUALITY);
      let format: "webp" | "png" = "webp";
      if (!blob) {
        blob = await canvasToBlob(canvas, "image/png");
        format = "png";
      }
      if (!blob) {
        throw new Error("No se pudo codificar la imagen");
      }
      if (blob.size > HARD_CAP_BYTES) {
        throw new Error(
          `Logo demasiado pesado (${Math.round(blob.size / 1024)} KB). ` +
          `Intenta una imagen más simple o un PNG con fondo plano.`,
        );
      }
      const dataUrl = await blobToDataUrl(blob);
      const next: LogoState = { dataUrl, width: w, height: h, bytes: blob.size, format };
      setMeta(next);
      onChange(dataUrl);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    setMeta(null);
    setError(null);
    onChange(null);
  }

  return (
    <div className="logo-picker">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) handleFile(f);
        }}
      />

      {value ? (
        <div className="logo-preview-row">
          <img
            src={value}
            alt="logo"
            style={{
              width: 96,
              height: 96,
              objectFit: "contain",
              background: "color-mix(in oklab, var(--color-fg) 4%, transparent)",
              border: "1px solid var(--color-line)",
              borderRadius: 4,
            }}
          />
          <div style={{ display: "grid", gap: 4, flex: 1 }}>
            {meta ? (
              <div className="muted mono small">
                {meta.width} × {meta.height} · {Math.round(meta.bytes / 1024)} KB · {meta.format.toUpperCase()}
              </div>
            ) : (
              <div className="muted small">Logo cargado</div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn-row" disabled={busy} onClick={() => inputRef.current?.click()}>
                Reemplazar
              </button>
              <button type="button" className="btn-row" disabled={busy} onClick={remove}>
                Quitar
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? "Procesando…" : "Subir logo"}
        </button>
      )}

      {error && <div className="error-banner" style={{ marginTop: 12 }}>{error}</div>}
      <p className="muted small" style={{ marginTop: 12 }}>
        La imagen se reduce automáticamente a 512 px y se convierte a WebP para no
        inflar el tamaño del bundle. Opcional.
      </p>
    </div>
  );
}

function deriveMetaFromDataUrl(url: string | null): LogoState | null {
  if (!url) return null;
  const match = /^data:(image\/[a-z+]+);/.exec(url);
  const format: "webp" | "png" = match?.[1] === "image/webp" ? "webp" : "png";
  // Approximate bytes from base64 length.
  const i = url.indexOf("base64,");
  const bytes = i >= 0 ? Math.floor((url.length - i - 7) * 0.75) : 0;
  return { dataUrl: url, width: 0, height: 0, bytes, format };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Archivo no es una imagen válida"));
    img.src = src;
  });
}

function drawFit(img: HTMLImageElement, maxEdge: number): { canvas: HTMLCanvasElement; w: number; h: number } {
  const ratio = img.width / img.height;
  let w = img.width, h = img.height;
  if (Math.max(w, h) > maxEdge) {
    if (ratio >= 1) { w = maxEdge; h = Math.round(maxEdge / ratio); }
    else { h = maxEdge; w = Math.round(maxEdge * ratio); }
  }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas no disponible");
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), mime, quality);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(blob);
  });
}
