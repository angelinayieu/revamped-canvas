import { memo, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, RefreshCw } from "lucide-react";

// HTML shell loaded into the sandboxed iframe. Loads React + Tailwind CDN +
// Babel standalone, then awaits a `preview-code` postMessage carrying the
// candidate's source. We strip imports/exports and find a PascalCase component
// name to mount. This is intentionally lenient about what the model emits.
const RUNTIME_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdn.tailwindcss.com"></script>
<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  #root { min-height: 100vh; }
  .cg-err { position: fixed; inset: 12px; background: #fef2f2; color: #991b1b; padding: 14px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow: auto; border: 1px solid #fecaca; border-radius: 8px; }
  .cg-empty { display: flex; align-items: center; justify-content: center; height: 60vh; color: #9ca3af; font-size: 13px; }
</style>
</head>
<body>
<div id="root"><div class="cg-empty">Waiting for code…</div></div>
<script>
  function escapeHtml(s) { return String(s).replace(/[&<>]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;'})[c]; }); }
  function showError(msg) {
    var existing = document.querySelector('.cg-err');
    if (existing) existing.remove();
    var d = document.createElement('div');
    d.className = 'cg-err';
    d.textContent = msg;
    document.body.appendChild(d);
  }
  window.addEventListener('error', function(e){ showError(e.message || String(e.error)); });
  window.addEventListener('unhandledrejection', function(e){ showError(String(e.reason)); });

  function renderUser(raw) {
    // Strip the most common module syntax we can't honor in a flat eval:
    var src = String(raw)
      .replace(/^\\s*import[^\\n]*\\n/gm, '')
      .replace(/^\\s*export\\s+default\\s+/gm, '')
      .replace(/^\\s*export\\s+/gm, '');
    // Last PascalCase function/const/class declaration is the component to mount.
    var re = /(?:function|const|let|var|class)\\s+([A-Z][A-Za-z0-9_]*)/g;
    var matches = []; var m;
    while ((m = re.exec(src)) !== null) matches.push(m[1]);
    var name = matches.length ? matches[matches.length - 1] : null;
    if (!name) { showError('No component found. Expected a PascalCase function/const, e.g. function App(){...}'); return; }
    var wrapped = src + '\\n;ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(' + name + '));';
    var compiled;
    try {
      compiled = Babel.transform(wrapped, {
        presets: [['react', { runtime: 'classic' }], 'typescript'],
        filename: 'preview.tsx',
      }).code;
    } catch (err) { showError('Compile error: ' + (err && err.message ? err.message : err)); return; }
    var existing = document.querySelector('.cg-err'); if (existing) existing.remove();
    try {
      var rootEl = document.getElementById('root');
      if (rootEl) rootEl.innerHTML = '';
      // eslint-disable-next-line no-new-func
      new Function('React', 'ReactDOM', compiled)(React, ReactDOM);
    } catch (err) { showError('Runtime error: ' + (err && err.message ? err.message : err)); }
  }

  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'preview-code') return;
    if (!window.React || !window.ReactDOM || !window.Babel) {
      // Runtime not loaded yet — wait briefly.
      var tries = 0;
      var iv = setInterval(function() {
        tries++;
        if (window.React && window.ReactDOM && window.Babel) { clearInterval(iv); renderUser(e.data.code); }
        else if (tries > 80) { clearInterval(iv); showError('Preview runtime failed to load (network blocked?).'); }
      }, 50);
      return;
    }
    renderUser(e.data.code);
  });

  // Tell the parent we're ready so it can post the code.
  parent.postMessage({ type: 'preview-ready' }, '*');
</script>
</body>
</html>`;

type Props = {
  code: string;
  defaultOpen?: boolean;
};

export const PreviewBlock = memo(function PreviewBlock({ code, defaultOpen = true }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Listen for the iframe's "ready" handshake.
  useEffect(() => {
    function onMsg(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "preview-ready") setReady(true);
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [reloadKey]);

  // Push new code when ready or when code changes.
  useEffect(() => {
    if (!open || !ready) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: "preview-code", code },
      "*",
    );
  }, [open, ready, code, reloadKey]);

  const reload = () => {
    setReady(false);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="my-2 nodrag nowheel overflow-hidden rounded-[8px] border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-muted/60 px-2.5 py-1">
        <span className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </span>
        <div className="flex items-center gap-1">
          {open && (
            <button
              type="button"
              onClick={reload}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
              title="Reload preview"
            >
              <RefreshCw size={10} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
            title={open ? "Hide preview" : "Show preview"}
          >
            {open ? <EyeOff size={10} /> : <Eye size={10} />}
            <span>{open ? "hide" : "show"}</span>
          </button>
        </div>
      </div>
      {open && (
        <iframe
          key={reloadKey}
          ref={iframeRef}
          sandbox="allow-scripts"
          srcDoc={RUNTIME_HTML}
          title="component preview"
          className="block w-full"
          style={{ height: 480, border: 0, background: "#ffffff" }}
        />
      )}
    </div>
  );
});
