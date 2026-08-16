import { createContext, createElement, useContext, useRef, type ReactNode } from "react";
import { createStore, useStore, type Mutate, type StoreApi } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import { nanoid } from "nanoid";
import type {
  Canvas,
  CanvasEdge,
  CanvasNode,
  ContentBlock,
  ErrorCode,
  Message,
  NodeId,
  Provider,
  TextBlock,
  ToolUseBlock,
} from "@shared/types";
import {
  getMessageHistoryForNode,
  messageTextForTitle,
  migrateMessage,
} from "@shared/history";
import { getEdgeHandles } from "@/lib/edgeHandles";
import { FALLBACK_NODE_HEIGHT, NODE_WIDTH, VERTICAL_CHILD_OFFSET } from "@/lib/canvasConstants";
import type { Attachment } from "@shared/ipc";

export type PendingAutoSubmit = { prompt: string; attachments?: Attachment[] };

type HistorySnapshot = {
  nodes: Record<NodeId, CanvasNode>;
  edges: CanvasEdge[];
};
export type HistoryStack = {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
};
const HISTORY_LIMIT = 50;
import { computeAutoLayout } from "@/lib/autoOrganize";

type Dirty = { count: number; lastChangeAt: number };

export type CanvasStoreState = {
  canvasId: string | null;
  name: string;
  cwd: string;
  createdAt: number;
  provider: Provider | undefined;
  nodes: Record<NodeId, CanvasNode>;
  edges: CanvasEdge[];
  loaded: boolean;
  dirty: Dirty;
  saving: boolean;
  error: string | null;
  pendingPrefills: Record<NodeId, string>;
  pendingAutoSubmits: Record<NodeId, PendingAutoSubmit>;
  history: HistoryStack;
  searchHighlights: Map<NodeId, Set<string>>;
  setSearchHighlights: (nodeId: NodeId, textMatches: string[]) => void;
  clearSearchHighlights: () => void;

  /** Merge-mode state. `merging` is true while the user is picking parents for a merge child. */
  merging: boolean;
  /** All nodes selected to become parents of the merge child. First entry is the initiating source. */
  mergeIds: NodeId[];
  startMerge: (sourceId: NodeId) => void;
  toggleMergeNode: (id: NodeId) => void;
  cancelMerge: () => void;
  /** Create a new child node whose parents are `mergeIds`. Returns the new node id, or null if invalid. */
  commitMerge: () => NodeId | null;

  loadCanvas: (id: string) => Promise<void>;
  setName: (name: string) => void;
  setProvider: (provider: Provider) => void;
  addNode: (node: CanvasNode) => void;
  patchNode: (id: NodeId, patch: Partial<CanvasNode["data"]>) => void;
  movePosition: (id: NodeId, pos: { x: number; y: number }) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  removeNode: (id: NodeId) => void;
  connectEdge: (source: NodeId, target: NodeId, opts?: { sourceYOffset?: number }) => void;
  appendMessage: (nodeId: NodeId, msg: Message) => void;
  appendTextDelta: (nodeId: NodeId, messageId: string, text: string) => void;
  appendBlock: (nodeId: NodeId, messageId: string, block: ContentBlock) => void;
  setToolResult: (
    nodeId: NodeId,
    messageId: string,
    toolUseId: string,
    content: string,
    isError: boolean
  ) => void;
  finalizeMessage: (nodeId: NodeId, messageId: string) => void;
  errorMessage: (
    nodeId: NodeId,
    messageId: string,
    error: string,
    opts?: { code?: ErrorCode; provider?: Provider }
  ) => void;
  clearMessages: (nodeId: NodeId) => void;
  getHistoryForNode: (id: NodeId) => Message[];
  
  // Group management
  createGroup: (title: string, color?: string) => NodeId;
  moveNodeToGroup: (nodeId: NodeId, groupId: NodeId) => void;
  removeNodeFromGroup: (nodeId: NodeId, groupId: NodeId) => void;
  toggleGroupCollapse: (groupId: NodeId) => void;
  deleteGroup: (groupId: NodeId, keepChildren?: boolean) => void;
  autoOrganize: (measureHeight: (id: NodeId) => number) => void;
  
  serialize: () => Canvas | null;
  markDirty: () => void;
  save: () => Promise<void>;
  setPrefill: (nodeId: NodeId, text: string) => void;
  consumePrefill: (nodeId: NodeId) => string | undefined;
  setAutoSubmit: (nodeId: NodeId, payload: PendingAutoSubmit) => void;
  consumeAutoSubmit: (nodeId: NodeId) => PendingAutoSubmit | undefined;
  fanOutDesignCandidates: (
    parentId: NodeId,
    count: number,
    basePrompt: string,
    attachments?: Attachment[],
  ) => NodeId[];
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
};

export type CanvasStoreApi = Mutate<
  StoreApi<CanvasStoreState>,
  [["zustand/subscribeWithSelector", never]]
>;

function makeEdgeId(source: NodeId, target: NodeId): string {
  return `e-${source}-${target}`;
}

// Composite actions (fanOut, etc.) raise this so the primitives they call
// (addNode/connectEdge) don't each push their own history snapshot — undo
// then rewinds the whole composite as a single step.
let snapshotBatchDepth = 0;

function canvasFromState(s: CanvasStoreState): Canvas | null {
  if (!s.canvasId) return null;
  return {
    id: s.canvasId,
    name: s.name,
    cwd: s.cwd,
    createdAt: s.createdAt,
    updatedAt: Date.now(),
    nodes: Object.values(s.nodes),
    edges: s.edges,
    provider: s.provider,
  };
}

function updateMessages(
  nodes: Record<NodeId, CanvasNode>,
  nodeId: NodeId,
  updater: (messages: Message[]) => Message[]
): Record<NodeId, CanvasNode> | null {
  const n = nodes[nodeId];
  if (!n) return null;
  const messages = updater(n.data.chat.messages);
  if (messages === n.data.chat.messages) return null;
  return {
    ...nodes,
    [nodeId]: {
      ...n,
      data: { ...n.data, chat: { ...n.data.chat, messages } },
    },
  };
}

function mapMessage(
  messages: Message[],
  messageId: string,
  fn: (m: Message) => Message
): Message[] {
  let changed = false;
  const next = messages.map((m) => {
    if (m.id !== messageId) return m;
    changed = true;
    return fn(m);
  });
  return changed ? next : messages;
}

export function createCanvasStoreApi(): CanvasStoreApi {
  return createStore<CanvasStoreState>()(
    subscribeWithSelector((set, get) => ({
      canvasId: null,
      name: "",
      cwd: "",
      createdAt: 0,
      provider: undefined,
      nodes: {},
      edges: [],
      loaded: false,
      dirty: { count: 0, lastChangeAt: 0 },
      saving: false,
      error: null,
      pendingPrefills: {},
      pendingAutoSubmits: {},
      history: { past: [], future: [] },
      searchHighlights: new Map(),
      merging: false,
      mergeIds: [],

      startMerge: (sourceId) => {
        set((s) => {
          if (!s.nodes[sourceId]) return s;
          return { merging: true, mergeIds: [sourceId] };
        });
      },

      toggleMergeNode: (id) => {
        set((s) => {
          if (!s.merging || !s.nodes[id]) return s;
          const idx = s.mergeIds.indexOf(id);
          if (idx === -1) return { mergeIds: [...s.mergeIds, id] };
          // Don't allow removing the source (mergeIds[0]); cancel instead.
          if (idx === 0) return s;
          const next = [...s.mergeIds];
          next.splice(idx, 1);
          return { mergeIds: next };
        });
      },

      cancelMerge: () => {
        set((s) => (s.merging ? { merging: false, mergeIds: [] } : s));
      },

      commitMerge: () => {
        const s = get();
        if (!s.merging || s.mergeIds.length < 2) return null;
        const parents = s.mergeIds
          .map((id) => s.nodes[id])
          .filter((n): n is CanvasNode => Boolean(n));
        if (parents.length < 2) return null;
        get().pushHistory();
        snapshotBatchDepth++;
        const avgX =
          parents.reduce((acc, n) => acc + n.position.x, 0) / parents.length;
        const maxY = parents.reduce((acc, n) => Math.max(acc, n.position.y), 0);
        const position = {
          x: avgX,
          y: maxY + FALLBACK_NODE_HEIGHT + VERTICAL_CHILD_OFFSET,
        };
        const child: CanvasNode = {
          id: nanoid(10),
          type: "custom",
          position,
          createdAt: Date.now(),
          data: {
            chat: {
              messages: [],
              parentIds: [],
              childIds: [],
            },
          },
        };
        // Insert child, then connect each parent → child.
        set((prev) => ({ nodes: { ...prev.nodes, [child.id]: child } }));
        for (const p of parents) {
          get().connectEdge(p.id, child.id);
        }
        set({ merging: false, mergeIds: [] });
        snapshotBatchDepth--;
        get().markDirty();
        return child.id;
      },

      setSearchHighlights: (nodeId, textMatches) => {
        set((s) => {
          const next = new Map(s.searchHighlights);
          next.set(nodeId, new Set(textMatches));
          return { searchHighlights: next };
        });
      },

      clearSearchHighlights: () => {
        set((s) => {
          if (s.searchHighlights.size === 0) return s;
          return { searchHighlights: new Map() };
        });
      },

      loadCanvas: async (id: string) => {
        set({ loaded: false, error: null });
        const canvas = await window.api.canvases.read(id);
        if (!canvas) {
          set({ error: `Failed to load canvas ${id}`, loaded: true });
          return;
        }
        const nodes: Record<NodeId, CanvasNode> = {};
        for (const n of canvas.nodes) {
          const migrated: Message[] = [];
          for (const raw of n.data.chat.messages) {
            const m = migrateMessage(raw);
            if (!m) continue;
            migrated.push(
              m.status === "streaming"
                ? { ...m, status: "error", error: "interrupted" }
                : m
            );
          }
          nodes[n.id] = {
            ...n,
            data: {
              ...n.data,
              chat: { ...n.data.chat, messages: migrated },
            },
          };
        }
        set({
          canvasId: canvas.id,
          name: canvas.name,
          cwd: canvas.cwd,
          createdAt: canvas.createdAt,
          provider: canvas.provider,
          nodes,
          edges: canvas.edges,
          loaded: true,
          dirty: { count: 0, lastChangeAt: 0 },
          history: { past: [], future: [] },
        });
      },

      setName: (name) => {
        set({ name });
        get().markDirty();
      },

      setProvider: (provider) => {
        set({ provider });
        get().markDirty();
      },

      addNode: (node) => {
        get().pushHistory();
        set((s) => ({ nodes: { ...s.nodes, [node.id]: node } }));
        get().markDirty();
      },

      patchNode: (id, patch) => {
        set((s) => {
          const existing = s.nodes[id];
          if (!existing) return s;
          return {
            nodes: {
              ...s.nodes,
              [id]: { ...existing, data: { ...existing.data, ...patch } },
            },
          };
        });
        get().markDirty();
      },

      movePosition: (id, pos) => {
        set((s) => {
          const existing = s.nodes[id];
          if (!existing) return s;
          return {
            nodes: { ...s.nodes, [id]: { ...existing, position: pos } },
          };
        });
        get().markDirty();
      },

      onNodesChange: (changes) => {
        if (!changes.length) return;
        let didChange = false;
        set((s) => {
          const nodesArray = Object.values(s.nodes);
          const next = applyNodeChanges(changes, nodesArray) as CanvasNode[];

          const movedIds = new Set<string>();
          for (const c of changes) {
            if (c.type === "position" && c.position) movedIds.add(c.id);
          }

          const sameNodes =
            next.length === nodesArray.length &&
            next.every((n, i) => n === nodesArray[i]);
          if (sameNodes && movedIds.size === 0) return s;

          const nextById: Record<NodeId, CanvasNode> = {};
          for (const n of next) nextById[n.id] = n;

          let edges = s.edges;
          if (movedIds.size > 0 && s.edges.length > 0) {
            let edgesTouched = false;
            const nextEdges = s.edges.map((e) => {
              if (!movedIds.has(e.source) && !movedIds.has(e.target)) return e;
              const src = nextById[e.source];
              const tgt = nextById[e.target];
              if (!src || !tgt) return e;
              const handles = getEdgeHandles(src.position, tgt.position);
              if (
                e.sourceHandle === handles.sourceHandle &&
                e.targetHandle === handles.targetHandle
              ) {
                return e;
              }
              edgesTouched = true;
              return {
                ...e,
                sourceHandle: handles.sourceHandle,
                targetHandle: handles.targetHandle,
              };
            });
            if (edgesTouched) edges = nextEdges;
          }

          didChange = true;
          return { nodes: nextById, edges };
        });
        if (didChange) get().markDirty();
      },

      removeNode: (id) => {
        get().pushHistory();
        void window.api.chat.cancelForNode(id);
        set((s) => {
          const nodes = { ...s.nodes };
          delete nodes[id];
          for (const nid of Object.keys(nodes)) {
            const n = nodes[nid];
            const parentIds = n.data.chat.parentIds.filter((p) => p !== id);
            const childIds = n.data.chat.childIds.filter((p) => p !== id);
            if (
              parentIds.length !== n.data.chat.parentIds.length ||
              childIds.length !== n.data.chat.childIds.length
            ) {
              nodes[nid] = {
                ...n,
                data: {
                  ...n.data,
                  chat: { ...n.data.chat, parentIds, childIds },
                },
              };
            }
          }
          const edges = s.edges.filter((e) => e.source !== id && e.target !== id);
          return { nodes, edges };
        });
        get().markDirty();
      },

      connectEdge: (source, target, opts) => {
        get().pushHistory();
        set((s) => {
          if (source === target) return s;
          if (!s.nodes[source] || !s.nodes[target]) return s;
          const id = makeEdgeId(source, target);
          if (s.edges.some((e) => e.id === id)) return s;
          const edge: CanvasEdge = { id, source, target };
          if (opts?.sourceYOffset != null) edge.sourceYOffset = opts.sourceYOffset;
          const edges = [...s.edges, edge];
          const nodes = { ...s.nodes };
          const parent = nodes[source];
          nodes[source] = {
            ...parent,
            data: {
              ...parent.data,
              chat: {
                ...parent.data.chat,
                childIds: parent.data.chat.childIds.includes(target)
                  ? parent.data.chat.childIds
                  : [...parent.data.chat.childIds, target],
              },
            },
          };
          const child = nodes[target];
          nodes[target] = {
            ...child,
            data: {
              ...child.data,
              chat: {
                ...child.data.chat,
                parentIds: child.data.chat.parentIds.includes(source)
                  ? child.data.chat.parentIds
                  : [...child.data.chat.parentIds, source],
              },
            },
          };
          return { edges, nodes };
        });
        get().markDirty();
      },

      appendMessage: (nodeId, msg) => {
        set((s) => {
          const n = s.nodes[nodeId];
          if (!n) return s;
          const derivedTitle =
            n.data.title || (msg.role === "user" ? messageTextForTitle(msg).slice(0, 60) : n.data.title);
          return {
            nodes: {
              ...s.nodes,
              [nodeId]: {
                ...n,
                data: {
                  ...n.data,
                  title: derivedTitle,
                  chat: {
                    ...n.data.chat,
                    messages: [...n.data.chat.messages, msg],
                  },
                },
              },
            },
          };
        });
        get().markDirty();
      },

      appendTextDelta: (nodeId, messageId, text) => {
        if (!text) return;
        set((s) => {
          const nodes = updateMessages(s.nodes, nodeId, (messages) =>
            mapMessage(messages, messageId, (m) => {
              const blocks = m.blocks.length > 0 ? [...m.blocks] : [];
              const last = blocks[blocks.length - 1];
              if (last && last.type === "text") {
                blocks[blocks.length - 1] = { ...last, text: last.text + text };
              } else {
                const tb: TextBlock = { type: "text", text };
                blocks.push(tb);
              }
              return { ...m, blocks };
            })
          );
          return nodes ? { nodes } : s;
        });
        get().markDirty();
      },

      appendBlock: (nodeId, messageId, block) => {
        set((s) => {
          const nodes = updateMessages(s.nodes, nodeId, (messages) =>
            mapMessage(messages, messageId, (m) => ({
              ...m,
              blocks: [...m.blocks, block],
            }))
          );
          return nodes ? { nodes } : s;
        });
        get().markDirty();
      },

      setToolResult: (nodeId, messageId, toolUseId, content, isError) => {
        set((s) => {
          const nodes = updateMessages(s.nodes, nodeId, (messages) =>
            mapMessage(messages, messageId, (m) => {
              let touched = false;
              const blocks = m.blocks.map((b) => {
                if (b.type !== "tool_use") return b;
                const tu = b as ToolUseBlock;
                if (tu.id !== toolUseId) return b;
                touched = true;
                return { ...tu, result: { content, isError } } satisfies ToolUseBlock;
              });
              return touched ? { ...m, blocks } : m;
            })
          );
          return nodes ? { nodes } : s;
        });
        get().markDirty();
      },

      finalizeMessage: (nodeId, messageId) => {
        set((s) => {
          const nodes = updateMessages(s.nodes, nodeId, (messages) =>
            mapMessage(messages, messageId, (m) => ({ ...m, status: "complete" }))
          );
          return nodes ? { nodes } : s;
        });
        get().markDirty();
      },

      errorMessage: (nodeId, messageId, error, opts) => {
        set((s) => {
          const nodes = updateMessages(s.nodes, nodeId, (messages) =>
            mapMessage(messages, messageId, (m) => ({
              ...m,
              status: "error",
              error,
              errorCode: opts?.code,
              errorProvider: opts?.provider,
            }))
          );
          return nodes ? { nodes } : s;
        });
        get().markDirty();
      },

      clearMessages: (nodeId) => {
        set((s) => {
          const nodes = updateMessages(s.nodes, nodeId, () => []);
          return nodes ? { nodes } : s;
        });
        get().markDirty();
      },

      getHistoryForNode: (id) => getMessageHistoryForNode(id, get().nodes),

      createGroup: (title, color) => {
        get().pushHistory();
        const groupId = nanoid(10);
        const group: CanvasNode = {
          id: groupId,
          type: "group",
          position: { x: 0, y: 0 },
          data: {
            title: title || "Group",
            chat: {
              messages: [],
              parentIds: [],
              childIds: [],
            },
            group: {
              title: title || "Group",
              childIds: [],
              isCollapsed: false,
              color: (color as any) || "blue",
            },
          },
        };
        set((s) => ({ nodes: { ...s.nodes, [groupId]: group } }));
        get().markDirty();
        return groupId;
      },

      moveNodeToGroup: (nodeId, groupId) => {
        get().pushHistory();
        set((s) => {
          const group = s.nodes[groupId];
          if (!group || group.type !== "group" || !group.data.group) return s;
          const groupData = group.data.group;
          if (groupData.childIds.includes(nodeId)) return s;

          const nodes = { ...s.nodes };
          nodes[groupId] = {
            ...group,
            data: {
              ...group.data,
              group: {
                ...groupData,
                childIds: [...groupData.childIds, nodeId],
              },
            },
          };
          return { nodes };
        });
        get().markDirty();
      },

      removeNodeFromGroup: (nodeId, groupId) => {
        get().pushHistory();
        set((s) => {
          const group = s.nodes[groupId];
          if (!group || group.type !== "group" || !group.data.group) return s;
          const groupData = group.data.group;
          const newChildIds = groupData.childIds.filter((id) => id !== nodeId);
          if (newChildIds.length === groupData.childIds.length) return s;

          const nodes = { ...s.nodes };
          nodes[groupId] = {
            ...group,
            data: {
              ...group.data,
              group: {
                ...groupData,
                childIds: newChildIds,
              },
            },
          };
          return { nodes };
        });
        get().markDirty();
      },

      toggleGroupCollapse: (groupId) => {
        get().pushHistory();
        set((s) => {
          const group = s.nodes[groupId];
          if (!group || group.type !== "group" || !group.data.group) return s;
          const nodes = { ...s.nodes };
          nodes[groupId] = {
            ...group,
            data: {
              ...group.data,
              group: {
                ...group.data.group,
                isCollapsed: !group.data.group.isCollapsed,
              },
            },
          };
          return { nodes };
        });
        get().markDirty();
      },

      deleteGroup: (groupId, keepChildren = true) => {
        get().pushHistory();
        void window.api.chat.cancelForNode(groupId);
        set((s) => {
          const nodes = { ...s.nodes };
          const group = nodes[groupId];
          if (!group || group.type !== "group" || !group.data.group) return s;

          if (keepChildren) {
            // Unparent the group's children
            for (const childId of group.data.group.childIds) {
              const child = nodes[childId];
              if (child) {
                nodes[childId] = {
                  ...child,
                  data: {
                    ...child.data,
                    chat: {
                      ...child.data.chat,
                      parentIds: child.data.chat.parentIds.filter((id) => id !== groupId),
                    },
                  },
                };
              }
            }
          } else {
            // Remove children along with the group
            for (const childId of group.data.group.childIds) {
              delete nodes[childId];
            }
          }

          delete nodes[groupId];
          const edges = s.edges.filter((e) => e.source !== groupId && e.target !== groupId);
          return { nodes, edges };
        });
        get().markDirty();
      },

      autoOrganize: (measureHeight) => {
        get().pushHistory();
        set((s) => {
          const positions = computeAutoLayout(s.nodes, s.edges, measureHeight);
          if (positions.size === 0) return s;

          const nodes = { ...s.nodes };
          for (const [id, pos] of positions) {
            const node = nodes[id];
            if (node) nodes[id] = { ...node, position: pos };
          }

          // Re-route every connector for the new positions and drop the
          // selection-anchored offset, which no longer applies after layout.
          const edges = s.edges.map((e) => {
            const src = nodes[e.source];
            const tgt = nodes[e.target];
            if (!src || !tgt) return e;
            const h = getEdgeHandles(src.position, tgt.position);
            if (
              e.sourceHandle === h.sourceHandle &&
              e.targetHandle === h.targetHandle &&
              e.sourceYOffset === undefined
            ) {
              return e;
            }
            return {
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: h.sourceHandle,
              targetHandle: h.targetHandle,
            } satisfies CanvasEdge;
          });

          return { nodes, edges };
        });
        get().markDirty();
      },

      serialize: () => canvasFromState(get()),

      markDirty: () => {
        set((s) => ({
          dirty: { count: s.dirty.count + 1, lastChangeAt: Date.now() },
        }));
      },

      setPrefill: (nodeId, text) => {
        set((s) => ({ pendingPrefills: { ...s.pendingPrefills, [nodeId]: text } }));
      },

      consumePrefill: (nodeId) => {
        const current = get().pendingPrefills[nodeId];
        if (current === undefined) return undefined;
        set((s) => {
          const next = { ...s.pendingPrefills };
          delete next[nodeId];
          return { pendingPrefills: next };
        });
        return current;
      },

      setAutoSubmit: (nodeId, payload) => {
        set((s) => ({
          pendingAutoSubmits: { ...s.pendingAutoSubmits, [nodeId]: payload },
        }));
      },

      consumeAutoSubmit: (nodeId) => {
        const current = get().pendingAutoSubmits[nodeId];
        if (current === undefined) return undefined;
        set((s) => {
          const next = { ...s.pendingAutoSubmits };
          delete next[nodeId];
          return { pendingAutoSubmits: next };
        });
        return current;
      },

      pushHistory: () => {
        if (snapshotBatchDepth > 0) return;
        set((s) => {
          const last = s.history.past[s.history.past.length - 1];
          if (last && last.nodes === s.nodes && last.edges === s.edges) return s;
          const snapshot: HistorySnapshot = { nodes: s.nodes, edges: s.edges };
          const past = [...s.history.past, snapshot];
          if (past.length > HISTORY_LIMIT) past.shift();
          return { history: { past, future: [] } };
        });
      },

      undo: () => {
        const s = get();
        if (s.history.past.length === 0) return;
        const prev = s.history.past[s.history.past.length - 1];
        const past = s.history.past.slice(0, -1);
        const present: HistorySnapshot = { nodes: s.nodes, edges: s.edges };
        const future = [...s.history.future, present];
        set({
          nodes: prev.nodes,
          edges: prev.edges,
          history: { past, future },
        });
        get().markDirty();
      },

      redo: () => {
        const s = get();
        if (s.history.future.length === 0) return;
        const next = s.history.future[s.history.future.length - 1];
        const future = s.history.future.slice(0, -1);
        const present: HistorySnapshot = { nodes: s.nodes, edges: s.edges };
        const past = [...s.history.past, present];
        set({
          nodes: next.nodes,
          edges: next.edges,
          history: { past, future },
        });
        get().markDirty();
      },

      fanOutDesignCandidates: (parentId, count, basePrompt, attachments) => {
        const parent = get().nodes[parentId];
        if (!parent) return [];
        const n = Math.max(1, Math.min(8, Math.floor(count)));
        const baseY = parent.position.y + FALLBACK_NODE_HEIGHT + VERTICAL_CHILD_OFFSET;
        const colWidth = NODE_WIDTH + 120;
        const startX = parent.position.x - ((n - 1) * colWidth) / 2;
        get().pushHistory();
        snapshotBatchDepth++;
        const childIds: NodeId[] = [];
        try {
          for (let i = 0; i < n; i++) {
            const position = { x: startX + i * colWidth, y: baseY };
            const child = makeBlankNode(position, parentId);
            get().addNode(child);
            get().connectEdge(parentId, child.id);
            const prompt = buildDesignPrompt(basePrompt, i + 1, n);
            get().setAutoSubmit(child.id, { prompt, attachments });
            childIds.push(child.id);
          }
        } finally {
          snapshotBatchDepth--;
        }
        return childIds;
      },

      save: async () => {
        const canvas = canvasFromState(get());
        if (!canvas) return;
        set({ saving: true });
        try {
          await window.api.canvases.write(canvas);
          set({ saving: false, dirty: { count: 0, lastChangeAt: 0 } });
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          set({ saving: false, error: message });
        }
      },
    }))
  );
}

const CanvasStoreContext = createContext<CanvasStoreApi | null>(null);

export function CanvasStoreProvider({ children }: { children: ReactNode }) {
  const ref = useRef<CanvasStoreApi | null>(null);
  if (!ref.current) ref.current = createCanvasStoreApi();
  return createElement(CanvasStoreContext.Provider, { value: ref.current }, children);
}

export function useCanvasStoreApi(): CanvasStoreApi {
  const api = useContext(CanvasStoreContext);
  if (!api) {
    throw new Error(
      "useCanvasStoreApi must be used within a <CanvasStoreProvider>"
    );
  }
  return api;
}

export function useCanvasStore<T>(selector: (s: CanvasStoreState) => T): T {
  const api = useCanvasStoreApi();
  return useStore(api, selector);
}

export function makeBlankNode(
  position: { x: number; y: number },
  parentId?: NodeId,
  addedContext?: string,
): CanvasNode {
  return {
    id: nanoid(10),
    type: "custom",
    position,
    createdAt: Date.now(),
    data: {
      chat: {
        messages: [],
        parentIds: parentId ? [parentId] : [],
        childIds: [],
        ...(addedContext ? { addedContext } : {}),
      },
    },
  };
}

const DESIGN_VARIATIONS = [
  "Editorial — tight whitespace, clear hierarchy, refined typography, restrained color.",
  "Bold — assertive accent color, expressive type, high contrast, confident layout.",
  "Generous — airy spacing, minimal chrome, calm neutral surfaces, soft borders.",
  "Playful — rounded geometry, friendly micro-details, energetic accents, layered depth.",
  "Editorial-mono — monochrome palette, mono-numerals, ruled grid, dense composition.",
  "Vivid — saturated gradients, glassy surfaces, modern shadows, daring contrast.",
];

function buildDesignPrompt(basePrompt: string, index: number, total: number): string {
  const trimmed = basePrompt.trim();
  const userIntent = trimmed
    ? `User intent: ${trimmed}`
    : "User intent: build a UI that matches the reference image as closely as possible.";
  const variation = DESIGN_VARIATIONS[(index - 1) % DESIGN_VARIATIONS.length];
  return [
    `You are generating candidate ${index} of ${total} for a design-fidelity pass.`,
    userIntent,
    `Variation directive — ${variation}`,
    "",
    "CONTRACT — do not break, the response is rendered as a live preview:",
    "- Reply with EXACTLY one ```tsx fenced code block — no prose before or after.",
    "- The code is a single file with NO imports and NO exports.",
    "- Define one top-level PascalCase component named `App` that returns the full UI.",
    "- Use ONLY Tailwind utility classes for styling (the preview loads Tailwind CDN).",
    "- Do NOT import from shadcn, lucide, or any package. For icons, use inline SVG or Unicode glyphs.",
    "- Real, plausible content — no `Lorem ipsum`. Copy realistic strings from the reference image.",
    "- Wrap the whole UI in a root `<div>` that sets the page background (`min-h-screen`).",
    "- Keep it self-contained: no external images (use solid colors or inline SVG placeholders).",
  ].join("\n");
}
