import { useEffect, useState } from "react";
import { History, Plus, Redo2, Undo2, X, Zap } from "lucide-react";
import { ReactFlowProvider, useReactFlow, useStore } from "@xyflow/react";
import { Canvas } from "@/components/Canvas/Canvas";
import { RecencyTimeline } from "@/components/Canvas/RecencyTimeline";
import { makeDomHeightMeasurer } from "@/lib/collisionResolution";
import {
  CanvasStoreProvider,
  makeBlankNode,
  useCanvasStore,
} from "@/hooks/useCanvasStore";
import { PaneProvider, useActivePaneStore } from "@/hooks/useActivePane";
import { SearchButton } from "@/components/Canvas/SearchModal";
import { InProgressNodesIndicator } from "@/components/Canvas/InProgressNodesIndicator";
import { CanvasBreadcrumb } from "@/components/CanvasManager/CanvasBreadcrumb";
import { DeleteNodeModal } from "@/components/Canvas/DeleteNodeModal";
import { SearchModalProvider } from "@/providers/SearchModalProvider";
import { CommandPaletteProvider } from "@/providers/CommandPaletteProvider";
import { closePane } from "@/lib/canvasNavigation";

type CanvasPaneProps = {
  /** The canvas to load into this pane. Also serves as the pane's identity. */
  id: string;
  /** True when this pane is one of two panes in a split layout. */
  splitMode: boolean;
  /**
   * Which side of the pane the per-pane controls (search + close) anchor to.
   * Defaults to "right". In split mode the right pane uses "left" so the
   * controls frame the divider instead of crowding the global settings gear.
   */
  controlsSide?: "left" | "right";
};

/**
 * A single canvas pane. Owns its store + its search/palette providers so each
 * pane has independent modal state. Multiple panes can mount side-by-side for
 * split-screen. The pane registers as active on mousedown so global keyboard
 * shortcuts and the delete modal route to the focused pane.
 */
export function CanvasPane({ id, splitMode, controlsSide = "right" }: CanvasPaneProps) {
  return (
    <PaneProvider id={id}>
      <CanvasStoreProvider>
        <SearchModalProvider>
          <CommandPaletteProvider>
            <ReactFlowProvider>
              <CanvasPaneInner
                id={id}
                splitMode={splitMode}
                controlsSide={controlsSide}
              />
            </ReactFlowProvider>
          </CommandPaletteProvider>
        </SearchModalProvider>
      </CanvasStoreProvider>
    </PaneProvider>
  );
}

function CanvasPaneInner({ id, splitMode, controlsSide = "right" }: CanvasPaneProps) {
  const loadCanvas = useCanvasStore((s) => s.loadCanvas);
  const loaded = useCanvasStore((s) => s.loaded);
  const canvasId = useCanvasStore((s) => s.canvasId);
  const cwd = useCanvasStore((s) => s.cwd);
  const error = useCanvasStore((s) => s.error);
  const saving = useCanvasStore((s) => s.saving);
  const nodeCount = useCanvasStore((s) => Object.keys(s.nodes).length);
  const addNode = useCanvasStore((s) => s.addNode);
  const autoOrganize = useCanvasStore((s) => s.autoOrganize);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const canUndo = useCanvasStore((s) => s.history.past.length > 0);
  const canRedo = useCanvasStore((s) => s.history.future.length > 0);
  const setActive = useActivePaneStore((s) => s.setActive);
  const activePaneId = useActivePaneStore((s) => s.activePaneId);
  const zoom = useStore((s) => s.transform[2]);
  const { fitView } = useReactFlow();
  const [timelineOpen, setTimelineOpen] = useState(false);

  const isActive = activePaneId === id;

  const createFirstNode = () => {
    addNode(makeBlankNode({ x: 0, y: 0 }));
  };

  const handleAutoOrganize = () => {
    autoOrganize(makeDomHeightMeasurer(zoom));
    // Wait for react-flow to commit the new positions, then frame everything.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void fitView({ padding: 0.2, duration: 600 });
      }),
    );
  };

  useEffect(() => {
    if (id && canvasId !== id) void loadCanvas(id);
  }, [id, canvasId, loadCanvas]);

  // Auto-claim active in single-pane mode so keyboard shortcuts have a target
  // before any user interaction.
  useEffect(() => {
    if (!splitMode) setActive(id);
  }, [id, splitMode, setActive]);

  return (
    <div
      className="group relative h-full w-full overflow-hidden"
      onMouseDownCapture={() => setActive(id)}
    >
      {/* Active-pane outline (only meaningful in split mode) */}
      {splitMode && isActive && (
        <div className="pointer-events-none absolute inset-0 z-40 ring-2 ring-inset ring-primary/40" />
      )}

      {/* Top-center breadcrumb */}
      {(cwd || saving) && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 no-drag">
          <CanvasBreadcrumb
            cwd={cwd}
            currentCanvasId={id}
            saving={saving}
            splitMode={splitMode}
          />
        </div>
      )}

      {/* Per-pane controls (search + close-pane in split). Anchored to whichever
          side keeps it away from the global settings gear in the viewport's
          top-right corner. */}
      <div
        className={`absolute top-3 ${controlsSide === "left" ? "left-3" : "right-3"} z-30 no-drag flex items-center gap-1.5`}
      >
        <InProgressNodesIndicator />
        <button
          onClick={undo}
          disabled={!canUndo}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-opacity cursor-pointer ${
            canUndo
              ? "text-foreground/70 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100"
              : "text-foreground/30 opacity-0 group-hover:opacity-40 cursor-not-allowed"
          }`}
          title={canUndo ? "Undo (⌘Z)" : "Nothing to undo"}
        >
          <Undo2 size={14} />
        </button>
        <button
          onClick={redo}
          disabled={!canRedo}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-opacity cursor-pointer ${
            canRedo
              ? "text-foreground/70 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100"
              : "text-foreground/30 opacity-0 group-hover:opacity-40 cursor-not-allowed"
          }`}
          title={canRedo ? "Redo (⌘⇧Z)" : "Nothing to redo"}
        >
          <Redo2 size={14} />
        </button>
        {nodeCount > 1 && (
          <button
            onClick={handleAutoOrganize}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/70 hover:text-foreground hover:bg-muted cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            title="Auto-organize threads"
          >
            <Zap size={14} />
          </button>
        )}
        {nodeCount > 0 && (
          <button
            onClick={() => setTimelineOpen((v) => !v)}
            className={`flex h-7 w-7 items-center justify-center rounded-md cursor-pointer transition-opacity ${
              timelineOpen
                ? "bg-muted text-foreground opacity-100"
                : "text-foreground/70 hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100"
            }`}
            title="Recent cards timeline"
          >
            <History size={14} />
          </button>
        )}
        <SearchButton />
        {splitMode && (
          <button
            onClick={() => closePane(id)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-foreground/70 hover:text-foreground hover:bg-muted cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
            title="close pane"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Canvas */}
      <div className="absolute inset-0">
        {!loaded && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            loading…
          </div>
        )}
        {loaded && error && (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            {error}
          </div>
        )}
        {loaded && !error && (
          <>
            {nodeCount === 0 && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
                <button
                  onClick={createFirstNode}
                  className="pointer-events-auto flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-md hover:opacity-90 cursor-pointer"
                >
                  <Plus size={14} />
                  new node
                </button>
                <div className="pointer-events-none text-xs text-muted-foreground">
                  or double-click anywhere on the canvas
                </div>
              </div>
            )}
            <Canvas />
          </>
        )}
      </div>

      {loaded && !error && (
        <RecencyTimeline
          open={timelineOpen}
          side={controlsSide}
          onClose={() => setTimelineOpen(false)}
        />
      )}

      <DeleteNodeModal />
    </div>
  );
}
