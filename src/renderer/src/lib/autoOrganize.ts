import type { CanvasEdge, CanvasNode, NodeId } from "@shared/types";
import { FALLBACK_NODE_HEIGHT, NODE_WIDTH } from "./canvasConstants";

// Horizontal gap between two sibling subtree columns. Each tree column is
// NODE_WIDTH + COLUMN_GAP wide, which is what keeps cards in different branches
// from ever overlapping.
const COLUMN_GAP = 160;
const COLUMN_WIDTH = NODE_WIDTH + COLUMN_GAP;

// Vertical gap below a card before its children start.
const LEVEL_GAP = 140;

// Gaps between whole threads (connected components) when packed into the grid.
const THREAD_GAP_X = 1000;
const THREAD_GAP_Y = 700;

type Pos = { x: number; y: number };

type ThreadLayout = {
  pos: Map<NodeId, Pos>;
  width: number;
  height: number;
  /** Top-left of the thread's nodes in the original canvas — used to keep the
   * packed order roughly matching what the user already had. */
  origin: Pos;
};

/**
 * Compute tidy positions for every chat node on the canvas.
 *
 * Nodes are grouped into threads by their actual links (edges plus
 * parent/child ids), each thread is laid out as a top-down tidy tree (root at
 * the top, the conversation flowing downward, branches fanning out into
 * non-overlapping columns), and the threads are packed into a grid with large
 * gaps so they're easy to tell apart and navigate between.
 *
 * Only `custom` chat nodes are positioned; sticky notes and group boxes are
 * left where they are. `measureHeight` should report each node's rendered
 * height (falling back to a constant when it isn't mounted) so tall cards push
 * their descendants down instead of overlapping them.
 */
export function computeAutoLayout(
  nodesById: Record<NodeId, CanvasNode>,
  edges: CanvasEdge[],
  measureHeight: (id: NodeId) => number,
): Map<NodeId, Pos> {
  const result = new Map<NodeId, Pos>();

  const layoutIds = Object.keys(nodesById).filter(
    (id) => nodesById[id].type === "custom",
  );
  if (layoutIds.length === 0) return result;
  const inLayout = new Set(layoutIds);

  const heightOf = (id: NodeId): number => {
    const h = measureHeight(id);
    return Number.isFinite(h) && h > 0 ? h : FALLBACK_NODE_HEIGHT;
  };

  // Directed child/parent adjacency, built from edges and the chat links so we
  // catch a connection however it was recorded.
  const children = new Map<NodeId, NodeId[]>();
  const parents = new Map<NodeId, NodeId[]>();
  for (const id of layoutIds) {
    children.set(id, []);
    parents.set(id, []);
  }
  const link = (source: NodeId, target: NodeId) => {
    if (source === target) return;
    if (!inLayout.has(source) || !inLayout.has(target)) return;
    const cs = children.get(source)!;
    if (!cs.includes(target)) cs.push(target);
    const ps = parents.get(target)!;
    if (!ps.includes(source)) ps.push(source);
  };
  for (const e of edges) link(e.source, e.target);
  for (const id of layoutIds) {
    for (const childId of nodesById[id].data.chat.childIds) link(id, childId);
    for (const parentId of nodesById[id].data.chat.parentIds) link(parentId, id);
  }

  // Connected components over the undirected version of that graph = threads.
  const componentOf = new Map<NodeId, number>();
  let componentCount = 0;
  for (const start of layoutIds) {
    if (componentOf.has(start)) continue;
    const stack = [start];
    componentOf.set(start, componentCount);
    while (stack.length) {
      const cur = stack.pop()!;
      for (const nb of [...children.get(cur)!, ...parents.get(cur)!]) {
        if (componentOf.has(nb)) continue;
        componentOf.set(nb, componentCount);
        stack.push(nb);
      }
    }
    componentCount += 1;
  }
  const components: NodeId[][] = Array.from({ length: componentCount }, () => []);
  for (const id of layoutIds) components[componentOf.get(id)!].push(id);

  const layouts = components.map((ids) =>
    layoutThread(ids, nodesById, children, parents, heightOf),
  );

  // Keep packing order stable and close to the user's existing arrangement:
  // top-to-bottom, then left-to-right by where each thread already sits.
  const order = layouts
    .map((layout, index) => ({ layout, index }))
    .sort((a, b) => {
      const dy = a.layout.origin.y - b.layout.origin.y;
      if (Math.abs(dy) > 1) return dy;
      return a.layout.origin.x - b.layout.origin.x;
    });

  const maxWidth = layouts.reduce((m, l) => Math.max(m, l.width), 0);
  const totalWidth = layouts.reduce((s, l) => s + l.width + THREAD_GAP_X, 0);
  const targetCols = Math.max(1, Math.round(Math.sqrt(layouts.length)));
  const rowLimit = Math.max(maxWidth, totalWidth / targetCols);

  let cursorX = 0;
  let rowY = 0;
  let rowHeight = 0;
  for (const { layout } of order) {
    if (cursorX > 0 && cursorX + layout.width > rowLimit) {
      cursorX = 0;
      rowY += rowHeight + THREAD_GAP_Y;
      rowHeight = 0;
    }
    for (const [id, p] of layout.pos) {
      result.set(id, { x: cursorX + p.x, y: rowY + p.y });
    }
    cursorX += layout.width + THREAD_GAP_X;
    rowHeight = Math.max(rowHeight, layout.height);
  }

  return result;
}

/**
 * Lay out one thread as a tidy top-down tree, normalized so its top-left corner
 * is (0, 0). Y comes from the longest path so a node sits below every parent
 * (handles merges); X comes from a tidy post-order over a spanning tree so
 * sibling branches occupy disjoint columns and never overlap.
 */
function layoutThread(
  ids: NodeId[],
  nodesById: Record<NodeId, CanvasNode>,
  children: Map<NodeId, NodeId[]>,
  parents: Map<NodeId, NodeId[]>,
  heightOf: (id: NodeId) => number,
): ThreadLayout {
  // Topological order (Kahn). Leftover nodes from a cycle are appended so they
  // still get a position.
  const indegree = new Map<NodeId, number>();
  for (const id of ids) indegree.set(id, parents.get(id)!.length);
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const topo: NodeId[] = [];
  const placed = new Set<NodeId>();
  while (queue.length) {
    const cur = queue.shift()!;
    topo.push(cur);
    placed.add(cur);
    for (const c of children.get(cur)!) {
      indegree.set(c, indegree.get(c)! - 1);
      if (indegree.get(c) === 0) queue.push(c);
    }
  }
  for (const id of ids) if (!placed.has(id)) topo.push(id);

  // Y = lowest bottom edge of any parent + gap.
  const y = new Map<NodeId, number>();
  for (const id of topo) {
    let top = 0;
    for (const p of parents.get(id)!) {
      const py = y.get(p);
      if (py === undefined) continue;
      top = Math.max(top, py + heightOf(p) + LEVEL_GAP);
    }
    y.set(id, top);
  }

  // Spanning tree from the in-degree-0 roots (fall back to topo order). Each
  // node is claimed by the first parent that reaches it.
  let roots = ids.filter((id) => parents.get(id)!.length === 0);
  if (roots.length === 0 && topo.length > 0) roots = [topo[0]];
  const treeChildren = new Map<NodeId, NodeId[]>();
  for (const id of ids) treeChildren.set(id, []);
  const visited = new Set<NodeId>();
  const bfs = [...roots];
  for (const r of roots) visited.add(r);
  while (bfs.length) {
    const cur = bfs.shift()!;
    for (const c of children.get(cur)!) {
      if (visited.has(c)) continue;
      visited.add(c);
      treeChildren.get(cur)!.push(c);
      bfs.push(c);
    }
  }
  for (const id of ids) {
    if (visited.has(id)) continue;
    visited.add(id);
    roots.push(id);
  }

  // X via iterative post-order: leaves take the next column, parents center
  // over their children. Iterative to stay safe on very deep threads.
  const x = new Map<NodeId, number>();
  let column = 0;
  for (const root of roots) {
    const stack: { id: NodeId; next: number }[] = [{ id: root, next: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const kids = treeChildren.get(frame.id)!;
      if (frame.next < kids.length) {
        frame.next += 1;
        stack.push({ id: kids[frame.next - 1], next: 0 });
        continue;
      }
      if (kids.length === 0) {
        x.set(frame.id, column * COLUMN_WIDTH);
        column += 1;
      } else {
        const first = x.get(kids[0])!;
        const last = x.get(kids[kids.length - 1])!;
        x.set(frame.id, (first + last) / 2);
      }
      stack.pop();
    }
  }

  // Normalize to (0, 0) and measure the bounding box.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const raw = new Map<NodeId, Pos>();
  for (const id of ids) {
    const px = x.get(id) ?? 0;
    const py = y.get(id) ?? 0;
    raw.set(id, { x: px, y: py });
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px + NODE_WIDTH);
    maxY = Math.max(maxY, py + heightOf(id));
  }

  const pos = new Map<NodeId, Pos>();
  for (const [id, p] of raw) pos.set(id, { x: p.x - minX, y: p.y - minY });

  let originX = Infinity;
  let originY = Infinity;
  for (const id of ids) {
    const n = nodesById[id];
    originX = Math.min(originX, n.position.x);
    originY = Math.min(originY, n.position.y);
  }

  return {
    pos,
    width: maxX - minX,
    height: maxY - minY,
    origin: { x: originX, y: originY },
  };
}
