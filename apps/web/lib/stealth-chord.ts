"use client";

// Browser-side superadmin chord.
//
// Sequence:
//   1. Hold Alt + 1 + 2 + 3 simultaneously.
//   2. Release any of them → listening window opens for 5 seconds.
//   3. During the listening window, type KARIAS (case-insensitive).
//   4. On success, /api/local-admin/issue is fetched (loopback-only) and
//      the overlay-open callback fires with { token, serverUrl }.
//
// Pressing Alt+1+2+3 again while the overlay is open requests close.
// A 1-second debounce prevents rapid re-triggering. The chord is
// suppressed when focus is inside an <input>, <textarea>, or
// contentEditable element.

const TARGET = "KARIAS";
const LISTEN_MS = 5000;
const DEBOUNCE_MS = 1000;

type OpenHandler = (payload: { localAdminToken: string; serverUrl: string }) => void;
type Handler = () => void;

const openListeners = new Set<OpenHandler>();
const closeListeners = new Set<Handler>();
const listeningListeners = new Set<Handler>();
let overlayOpen = false;
let attached = false;

export function onOverlayOpen(cb: OpenHandler): () => void {
  openListeners.add(cb);
  return () => openListeners.delete(cb);
}
export function onOverlayClose(cb: Handler): () => void {
  closeListeners.add(cb);
  return () => closeListeners.delete(cb);
}
export function onChordListening(cb: Handler): () => void {
  listeningListeners.add(cb);
  return () => listeningListeners.delete(cb);
}
export function requestOverlayClose(): void {
  if (!overlayOpen) return;
  overlayOpen = false;
  for (const cb of closeListeners) try { cb(); } catch {}
}

function emitOpen(payload: { localAdminToken: string; serverUrl: string }) {
  overlayOpen = true;
  for (const cb of openListeners) try { cb(payload); } catch {}
}
function emitClose() {
  overlayOpen = false;
  for (const cb of closeListeners) try { cb(); } catch {}
}
function emitListening() {
  for (const cb of listeningListeners) try { cb(); } catch {}
}

function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (t.isContentEditable) return true;
  return false;
}

function isChordKey(code: string): boolean {
  return (
    code === "AltLeft" || code === "AltRight" ||
    code === "Digit1" || code === "Digit2" || code === "Digit3" ||
    code === "Numpad1" || code === "Numpad2" || code === "Numpad3"
  );
}

export function attachStealthChord() {
  if (attached || typeof window === "undefined") return;
  attached = true;

  const held = new Set<string>();
  let listening = false;
  let listenTimer: ReturnType<typeof setTimeout> | null = null;
  let typed = "";
  let lastTrigger = 0;

  function isChord(): boolean {
    return held.has("Alt") && held.has("Digit1") && held.has("Digit2") && held.has("Digit3");
  }

  function startListening() {
    if (listening) return;
    if (Date.now() - lastTrigger < DEBOUNCE_MS) return;
    listening = true;
    typed = "";
    emitListening();
    listenTimer = setTimeout(() => {
      listening = false;
      typed = "";
    }, LISTEN_MS);
  }

  async function triggerSuccess() {
    listening = false;
    if (listenTimer) { clearTimeout(listenTimer); listenTimer = null; }
    typed = "";
    lastTrigger = Date.now();
    if (overlayOpen) { emitClose(); return; }
    try {
      const res = await fetch("/api/local-admin/issue", { method: "POST" });
      if (!res.ok) return;
      const { token } = await res.json() as { token: string };
      emitOpen({ localAdminToken: token, serverUrl: window.location.origin });
    } catch { /* network failure — silently drop */ }
  }

  // Use event.code (physical key, layout-independent) for the chord because
  // on macOS pressing Option+1/2/3 yields special characters (¡, ™, £) in
  // event.key — only event.code stays as "Digit1"/"Digit2"/"Digit3".
  function trackKey(e: KeyboardEvent): string | null {
    if (e.code === "AltLeft" || e.code === "AltRight" || e.key === "Alt") return "Alt";
    if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") return e.code;
    if (e.code === "Numpad1") return "Digit1";
    if (e.code === "Numpad2") return "Digit2";
    if (e.code === "Numpad3") return "Digit3";
    return null;
  }

  // We attach in the CAPTURE phase so the chord beats any input/textarea
  // that has focus — Option+1/2/3 are intercepted before macOS inserts
  // ¡/™/£ into the field, and the overlay can be closed while typing
  // inside the superadmin terminal itself.
  window.addEventListener("keydown", (e: KeyboardEvent) => {
    const tracked = trackKey(e);
    if (tracked) held.add(tracked);
    if (e.altKey) held.add("Alt");

    // While Alt is held, the chord keys must never reach the focused
    // input — otherwise an editable field still sees the digit and
    // inserts the special character even after we capture it for the
    // chord state machine.
    if (e.altKey && isChordKey(e.code)) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (isChord()) {
      if (overlayOpen) {
        if (Date.now() - lastTrigger >= DEBOUNCE_MS) {
          lastTrigger = Date.now();
          emitClose();
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      startListening();
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (listening) {
      // Inside the 5s listening window we still respect text inputs —
      // the operator probably isn't actually mid-sentence at this point,
      // but if they are, we don't want to swallow real text input.
      if (isEditableTarget(e.target)) return;
      const ch = e.key.toUpperCase();
      if (ch.length === 1 && /[A-Z]/.test(ch)) {
        typed = (typed + ch).slice(-TARGET.length);
        if (typed === TARGET) {
          void triggerSuccess();
        }
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, { capture: true });

  window.addEventListener("keyup", (e: KeyboardEvent) => {
    const tracked = trackKey(e);
    if (tracked) held.delete(tracked);
    if (!e.altKey) held.delete("Alt");
  }, { capture: true });

  window.addEventListener("blur", () => { held.clear(); });
}
