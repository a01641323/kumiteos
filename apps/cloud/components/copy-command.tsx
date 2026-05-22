"use client";

import { useState } from "react";

interface Props {
  /** Label shown above the block (e.g. "macOS / Linux"). */
  label: string;
  /** The actual shell command. Rendered verbatim. */
  command: string;
}

export function CopyCommand({ label, command }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback: select + execCommand for non-secure contexts.
    }
  }

  return (
    <div className="cmd-block">
      <div className="cmd-block-head">
        <span className="cmd-block-label">{label}</span>
        <button type="button" onClick={copy} className="cmd-block-copy" aria-label="Copy command">
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="cmd-block-body">
        <code>$ {command}</code>
      </pre>
    </div>
  );
}
