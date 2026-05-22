import { Footer, TopBar } from "@/components/chrome";
import { CopyCommand } from "@/components/copy-command";

export default function DownloadPage() {
  return (
    <div>
      <TopBar />

      <section className="section">
        <div className="section-head">
          <div className="section-num">03</div>
          <div className="section-titles">
            <h2 className="section-title">Instalar</h2>
            <p className="section-sub">
              Una línea, sin instalador, sin Node, sin dependencias.
              El comando detecta tu sistema, descarga el binario, lo
              lanza, y abre el navegador en{" "}
              <code className="inline-code">localhost:4747</code>.
            </p>
          </div>
          <div className="section-meta">v0.1 · OFICIAL</div>
        </div>

        {/* The two install cards: macOS + Linux share one, Windows the other. */}
        <div className="install-grid">
          <div className="card install-card">
            <div className="install-head">
              <div className="install-glyphs">
                <AppleGlyph />
                <LinuxGlyph />
              </div>
              <div>
                <div className="install-title">macOS · Linux</div>
                <div className="install-sub">M1 / M2 / M3 · Intel · x86_64</div>
              </div>
            </div>
            <CopyCommand
              label="Terminal"
              command="curl -fsSL https://kumiteos.vercel.app/install.sh | sh"
            />
          </div>

          <div className="card install-card">
            <div className="install-head">
              <div className="install-glyphs">
                <WindowsGlyph />
              </div>
              <div>
                <div className="install-title">Windows</div>
                <div className="install-sub">Windows 10+ · x86_64</div>
              </div>
            </div>
            <CopyCommand
              label="PowerShell"
              command="iwr -useb https://kumiteos.vercel.app/install.ps1 | iex"
            />
          </div>
        </div>

        {/* The 3-step flow. */}
        <div className="card" style={{ marginTop: 28 }}>
          <div className="card-head">
            <span className="card-eyebrow">CÓMO FUNCIONA</span>
            <span className="card-meta">~30 segundos</span>
          </div>
          <ol className="flow-steps">
            <li>
              <span className="flow-num">1</span>
              <div>
                <div className="flow-title">Pegá el comando en la terminal</div>
                <div className="flow-sub">
                  Detecta tu OS y arquitectura, descarga el binario
                  correspondiente desde GitHub Releases, lo guarda en{" "}
                  <code className="inline-code">~/.kumiteos/app/</code>.
                </div>
              </div>
            </li>
            <li>
              <span className="flow-num">2</span>
              <div>
                <div className="flow-title">El binario arranca solo</div>
                <div className="flow-sub">
                  Express + WebSocket en{" "}
                  <code className="inline-code">localhost:4747</code>.
                  Abre tu navegador automáticamente y muestra la pantalla
                  de activación.
                </div>
              </div>
            </li>
            <li>
              <span className="flow-num">3</span>
              <div>
                <div className="flow-title">Pegá tu código de 6 dígitos</div>
                <div className="flow-sub">
                  Pedí uno en <a href="/request" className="muted-link">/request</a>.
                  El código abre la app por 24 horas. Las máquinas LAN
                  abren <code className="inline-code">http://&lt;tu-ip&gt;:4747</code>{" "}
                  — el operador aprueba la conexión desde la app.
                </div>
              </div>
            </li>
          </ol>
        </div>

        {/* First-launch caveats — only the ones that actually matter. */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <span className="card-eyebrow">PRIMER ARRANQUE</span>
            <span className="card-meta">Si tu OS pregunta</span>
          </div>
          <ul className="first-launch">
            <li>
              <strong>macOS Gatekeeper:</strong> el instalador ya quita
              la cuarentena. Si aún así aparece "no se puede verificar
              el desarrollador", click derecho en el binario →{" "}
              <strong>Abrir</strong> → confirmar.
            </li>
            <li>
              <strong>Windows SmartScreen:</strong> "publisher unknown"
              en el primer arranque → <strong>Más info</strong> →{" "}
              <strong>Ejecutar de todos modos</strong>.
            </li>
            <li>
              <strong>Datos:</strong> el estado del torneo vive en{" "}
              <code className="inline-code">~/.kumiteos/data/</code>{" "}
              (Windows:{" "}
              <code className="inline-code">%LOCALAPPDATA%\kumiteos\data</code>).
              Re-ejecutar el instalador <em>nunca</em> toca esa carpeta.
            </li>
            <li>
              <strong>Logs:</strong>{" "}
              <code className="inline-code">~/.kumiteos/kumiteos.log</code>{" "}
              si algo no levanta.
            </li>
          </ul>
        </div>
      </section>

      <Footer />
    </div>
  );
}

function AppleGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--color-fg)" aria-hidden>
      <path d="M16.5 12.5c0-2.8 2.3-4.1 2.4-4.2-1.3-1.9-3.3-2.2-4-2.2-1.7-.2-3.3 1-4.2 1-.9 0-2.2-1-3.6-1-1.9 0-3.6 1.1-4.6 2.8C.6 12.4 2 17 3.8 19.5c.9 1.2 2 2.6 3.4 2.5 1.4-.1 1.9-.9 3.5-.9s2.1.9 3.5.9c1.5 0 2.4-1.2 3.3-2.4 1-1.4 1.5-2.7 1.5-2.8-.1 0-2.5-1-2.5-3.8zM14 4.5c.8-.9 1.3-2.2 1.1-3.5-1.1 0-2.4.7-3.2 1.6-.7.8-1.4 2.1-1.2 3.4 1.2.1 2.5-.6 3.3-1.5z" />
    </svg>
  );
}

function WindowsGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--color-fg)" aria-hidden>
      <path d="M3 5.5L10.5 4.5V11H3V5.5zM3 12.5H10.5V19L3 18V12.5zM11.5 4.3L21 3V11H11.5V4.3zM11.5 12.5H21V21L11.5 19.7V12.5z" />
    </svg>
  );
}

function LinuxGlyph() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="var(--color-fg)" aria-hidden>
      <path d="M12.04 0c-.71 0-1.27.61-1.27 1.43 0 .82.56 1.43 1.27 1.43.71 0 1.27-.61 1.27-1.43C13.31.61 12.75 0 12.04 0zM9.94 2.43c-.4 0-.69.45-.69 1.04 0 .59.29 1.05.69 1.05.4 0 .69-.46.69-1.05 0-.59-.29-1.04-.69-1.04zm4.18 0c-.4 0-.7.45-.7 1.04 0 .59.3 1.05.7 1.05.4 0 .69-.46.69-1.05 0-.59-.29-1.04-.69-1.04zm-3.95 2.5c-.4-.04-.86.06-1.34.34-.55.32-1.06.85-1.46 1.62-.6 1.18-1.05 1.92-1.32 3.27-.12.74.08 1.65.49 2.41.4.74 1.04 1.34 1.85 1.73.34.16.74.07 1.04-.21.27-.27.35-.7.21-1.05-.36-.92-.45-1.83-.36-2.61.1-.8.4-1.42.79-1.84a3.4 3.4 0 011.85-.96c.31-.04.59-.21.77-.5.16-.27.18-.6.06-.91-.18-.4-.56-.7-1-.83-.18-.07-.4-.13-.58-.16-.18-.04-.27-.04-.4-.04-.21-.04-.4-.04-.6-.07v.01zm6.71 3.5l-.07.07c-.13.21-.27.39-.43.52-.31.32-.71.5-1.11.5-.13 0-.27 0-.4-.03-.59-.13-1.03-.55-1.27-1.18-.18-.45-.18-.92-.07-1.34-.79.16-1.7.66-2.66 1.45-.61.5-1.21 1.13-1.78 1.84-.4.5-.74 1.04-1.06 1.62v.04l-.04.04c-.7 1.21-1.39 3.03-2.18 4.71-.4.92-.74 1.7-1.06 2.43-.18.32-.27.66-.34.99-.27 1.21.13 2.4 1.03 2.83.99.5 2.2.13 2.99-.83.18-.21.34-.4.5-.62.18-.27.34-.55.5-.83.13-.27.27-.55.34-.83.4-1.4 1.39-2.74 1.66-3.06 0 .31-.04.59 0 1 .04.27.13.59.27.88.13.27.27.5.5.79.27.27.6.5 1 .59l.07.04c.27.13.5.27.66.42v.04l.7.55c.59.5 1.4.79 2.32.66 1.91-.27 3.34-1.79 3.27-3.41-.07-1.86-2.19-3.32-3.35-4.42-1.34-1.27-2.21-2.41-1.87-3.49v-.06c.21-.07.34-.27.34-.5 0-.39-.27-.71-.6-.71l-.07.04zm-1.4-.13l-.06.04c.13.27.27.4.4.5.27.13.5.13.71.07.27-.07.43-.21.55-.43.13-.21.13-.4.07-.6-.13-.4-.55-.66-.97-.66-.4 0-.7.27-.7.71v.39z" />
    </svg>
  );
}
