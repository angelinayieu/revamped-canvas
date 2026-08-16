import { useMemo, useState } from "react";
import { History, X } from "lucide-react";
import { useStore } from "@xyflow/react";
import type { CanvasNode } from "@shared/types";
import { messageTextForTitle } from "@shared/history";
import { useCanvasStore } from "@/hooks/useCanvasStore";
import { useCenterOnNode } from "@/hooks/useCenterOnNode";
import { measureNodeHeight } from "@/lib/nodeDom";
import { NODE_WIDTH } from "@/lib/canvasConstants";

/** Most recent moment this card was created or talked to. */
function activityTime(n: CanvasNode): number {
  let t = n.createdAt ?? 0;
  for (const m of n.data.chat.messages) {
    if (m.createdAt > t) t = m.createdAt;
  }
  return t;
}

function cardLabel(n: CanvasNode): string {
  if (n.data.title?.trim()) return n.data.title.trim();
  const msgs = n.data.chat.messages;
  for (const m of msgs) {
    if (m.role === "user") {
      const t = messageTextForTitle(m);
      if (t) return t;
    }
  }
  for (const m of msgs) {
    const t = messageTextForTitle(m);
    if (t) return t;
  }
  return "Empty card";
}

function relativeTime(ts: number, now: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

type Props = {
  open: boolean;
  side: "left" | "right";
  onClose: () => void;
};

export function RecencyTimeline({ open, side, onClose }: Props) {
  const nodes = useCanvasStore((s) => s.nodes);
  const zoom = useStore((s) => s.transform[2]);
  const centerOnNode = useCenterOnNode();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const items = useMemo(() => {
    return Object.values(nodes)
      .filter((n) => n.type === "custom")
      .map((n) => ({ node: n, time: activityTime(n), label: cardLabel(n) }))
      .sort((a, b) => b.time - a.time);
  }, [nodes]);

  if (!open) return null;

  const now = Date.now();

  const jump = (n: CanvasNode) => {
    setSelectedId(n.id);
    const h = measureNodeHeight(n.id, zoom) || 300;
    centerOnNode(n.position.x, n.position.y, NODE_WIDTH, h);
  };

  return (
    <aside
      className={`no-drag absolute top-14 bottom-3 z-20 flex w-72 flex-col overflow-hidden rounded-lg border border-border bg-background/95 shadow-xl backdrop-blur ${
        side === "left" ? "left-3" : "right-3"
      }`}
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <History size={14} />
          Recent cards
        </div>
        <button
          onClick={onClose}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded text-foreground/60 hover:bg-muted hover:text-foreground"
          title="close timeline"
        >
          <X size={13} />
        </button>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-muted-foreground">
          No cards yet.
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {items.map(({ node, time, label }, i) => {
            const active = node.id === selectedId;
            return (
              <button
                key={node.id}
                onClick={() => jump(node)}
                className={`flex w-full cursor-pointer items-stretch gap-2.5 px-3 py-2 text-left transition-colors ${
                  active ? "bg-accent/15" : "hover:bg-muted"
                }`}
              >
                <div className="relative flex w-3 flex-shrink-0 justify-center">
                  <span className="absolute top-0 bottom-0 w-px bg-border" />
                  <span
                    className={`relative mt-1 h-2 w-2 rounded-full ring-2 ring-background ${
                      i === 0 ? "bg-primary" : "bg-muted-foreground/50"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{label}</p>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span>{relativeTime(time, now)}</span>
                    {i === 0 && (
                      <span className="rounded bg-primary/15 px-1 text-primary">
                        most recent
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </aside>
  );
}
