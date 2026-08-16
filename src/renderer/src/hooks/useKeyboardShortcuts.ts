import { useEffect, type RefObject } from "react";
import { useCanvasStore, useCanvasStoreApi, makeBlankNode } from "./useCanvasStore";
import { useConfirmDeleteStore } from "./useConfirmDeleteStore";
import { useIsActivePane } from "./useActivePane";

export function useKeyboardShortcuts(
  containerRef?: RefObject<HTMLElement | null>,
) {
  const isActive = useIsActivePane();
  const storeApi = useCanvasStoreApi();
  const addNode = useCanvasStore((s) => s.addNode);
  const connectEdge = useCanvasStore((s) => s.connectEdge);
  const undo = useCanvasStore((s) => s.undo);
  const redo = useCanvasStore((s) => s.redo);
  const requestDelete = useConfirmDeleteStore((s) => s.request);

  useEffect(() => {
    if (!isActive) return;
    const scope = (): ParentNode => containerRef?.current ?? document;

    const getSelectedNodeId = (): string | null => {
      const active = document.activeElement;
      const root = containerRef?.current;
      const focusedIsInScope = !root || (active instanceof Node && root.contains(active));
      if (focusedIsInScope && active && (active as HTMLElement).closest?.(".react-flow__node")) {
        const el = (active as HTMLElement).closest<HTMLElement>(".react-flow__node");
        return el?.getAttribute("data-id") ?? null;
      }
      const selected = scope().querySelector<HTMLElement>(".react-flow__node.selected");
      return selected?.getAttribute("data-id") ?? null;
    };

    const getSelectedNodeIds = (): string[] => {
      const nodes = scope().querySelectorAll<HTMLElement>(".react-flow__node.selected");
      const ids: string[] = [];
      nodes.forEach((el) => {
        const id = el.getAttribute("data-id");
        if (id) ids.push(id);
      });
      return ids;
    };

    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        el.isContentEditable === true
      );
    };

    const onKey = (e: KeyboardEvent) => {
      // ⌘Z / ⌘⇧Z (and ⌃Y on Windows) → undo / redo canvas mutations.
      // Only skip for real INPUT/TEXTAREA (where native undo is the obvious
      // behaviour). A contenteditable like the prompt editor is allowed
      // through so the user can ⌘Z right after a fan-out/branch even though
      // focus auto-lands in the new card's editor.
      const isTextField = (t: EventTarget | null): boolean =>
        t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === "z") {
        if (isTextField(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && key === "y") {
        if (isTextField(e.target)) return;
        e.preventDefault();
        redo();
        return;
      }

      // ⌘+B → branch from currently selected node
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        if (isEditable(e.target)) return;
        const id = getSelectedNodeId();
        if (!id) return;
        e.preventDefault();
        const state = storeApi.getState();
        const parent = state.nodes[id];
        if (!parent) return;
        const offsetY = (parent.data.chat.childIds.length ?? 0) * 40;
        const child = makeBlankNode(
          { x: parent.position.x + 480, y: parent.position.y + offsetY },
          id
        );
        addNode(child);
        connectEdge(id, child.id);
      }

      // Backspace / Delete → open in-app confirmation modal (but NOT when typing)
      if ((e.key === "Backspace" || e.key === "Delete") && !isEditable(e.target)) {
        const ids = getSelectedNodeIds();
        if (ids.length === 0) {
          const id = getSelectedNodeId();
          if (!id) return;
          e.preventDefault();
          requestDelete(id);
          return;
        }
        e.preventDefault();
        requestDelete(ids);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive, containerRef, addNode, connectEdge, undo, redo, requestDelete, storeApi]);
}
