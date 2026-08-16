# Thread/Node Grouping & Auto-Organization Feature

## Overview
This feature enables users to organize conversation threads and nodes on the canvas into collapsible, color-coded groups for better structure and organization. It also includes automatic clustering to suggest organized layouts based on content similarity.

## Features

### 1. Manual Grouping
- Create empty groups from context menu
- Move nodes into groups
- Rename, color, and manage groups

### 2. Automatic Organization ⭐ NEW
- **Auto-Organize Button**: Click the lightning bolt icon (⚡) in the top-right of the canvas
- **Smart Clustering**: Analyzes node titles and message content to group similar threads
- **Spatial Layout**: Automatically positions clusters in a grid pattern for optimal visibility
- **Color-Coded Groups**: Each cluster gets a unique color for visual distinction

## Implementation Details

### Core Files

#### 1. Type System (`src/shared/types.ts`)
- Added `GroupNodeData` type with properties:
  - `title`: Group name
  - `childIds`: Array of node IDs contained in the group
  - `isCollapsed`: Boolean to track collapse state
  - `color`: Color scheme (blue, green, purple, orange, red, pink, yellow, slate)
- Updated `CanvasNodeType` to include `"group"`
- Updated `CanvasNode.data` to include optional `group` property

#### 2. Store Management (`src/renderer/src/hooks/useCanvasStore.ts`)
Added new store methods:
- `createGroup(title, color)` - Create new groups
- `moveNodeToGroup(nodeId, groupId)` - Add nodes to groups
- `removeNodeFromGroup(nodeId, groupId)` - Remove nodes from groups  
- `toggleGroupCollapse(groupId)` - Collapse/expand groups
- `deleteGroup(groupId, keepChildren)` - Delete groups with option to preserve children
- `autoOrganize()` - **NEW**: Automatically cluster and organize all nodes

#### 3. Auto-Organization Algorithm (`src/renderer/src/lib/autoOrganize.ts`)
- `clusterNodesBySimilarity()`: Groups nodes based on content similarity
  - Analyzes titles and message text
  - Uses Jaccard similarity for word matching
  - Configurable threshold (default 0.15)
- `calculateClusterPositions()`: Positions clusters in a grid layout
- `layoutNodesInCluster()`: Arranges nodes in circular pattern around cluster
- `getClusterColor()`: Assigns unique colors to clusters

#### 4. Visual Component (`src/renderer/src/components/Canvas/GroupNode.tsx`)
- Collapsible groups with chevron toggle
- Editable titles (click to rename)
- **Color picker**: Click palette icon to change group color
- Child node preview showing count and titles
- Delete button with safety for child nodes
- Smooth animations and hover effects

#### 5. Canvas Integration (`src/renderer/src/components/Canvas/Canvas.tsx`)
- Registered `GroupNode` in the `nodeTypes` mapping
- Groups appear as native xyflow nodes alongside regular chat nodes

#### 6. Context Menu (`src/renderer/src/components/Canvas/ContextMenu.tsx`)
- **"Create group"**: Available from any context menu
- **"Move to new group"**: Right-click a node to create a group and move it automatically

#### 7. UI Button (`src/renderer/src/components/Canvas/CanvasPane.tsx`)
- **Auto-Organize Button** (⚡): Appears in top-right when 2+ nodes exist
- Triggers automatic clustering and repositioning
- Only visible on hover for clean UI

#### 8. Utility Hook (`src/renderer/src/hooks/useGroupManagement.ts`)
- `useGroupManagement()` hook for programmatic group operations
- Helper functions for batch grouping operations

## Usage

### Manual Organization
1. Right-click on the canvas → **"Create group"**
2. Right-click a node → **"Move to new group"** to add it to a new group
3. Click group title to rename
4. Click palette icon to change color
5. Click chevron to collapse/expand

### Automatic Organization
1. Create multiple conversation nodes on the canvas
2. Click the **lightning bolt icon (⚡)** in the top-right
3. All nodes are automatically:
   - Analyzed for content similarity
   - Grouped into clusters
   - Repositioned spatially for optimal visibility
   - Color-coded for easy identification

## How Auto-Organization Works

1. **Similarity Analysis**: Extracts titles and message text from each node
2. **Clustering**: Groups nodes with similar keywords (Jaccard similarity > 0.15)
3. **Spatial Layout**: Arranges clusters in a grid pattern
4. **Positioning**: Places individual nodes in circular patterns around cluster centers
5. **Coloring**: Assigns unique colors to make clusters visually distinct

## Example Workflow

```
Before: Messy canvas with 8 random nodes scattered around

User clicks ⚡ button

After: 
- Nodes grouped into 3 clusters:
  - "Cluster 1" (blue) - Database-related threads
  - "Cluster 2" (green) - API-related threads  
  - "Cluster 3" (purple) - Frontend-related threads
- Each cluster positioned in its own region
- Nodes within clusters arranged in circles
```

## Files Modified/Created
- `src/shared/types.ts` - Added `GroupNodeData` type
- `src/renderer/src/hooks/useCanvasStore.ts` - Group management & auto-organize
- `src/renderer/src/components/Canvas/GroupNode.tsx` - Visual component
- `src/renderer/src/components/Canvas/Canvas.tsx` - Registered GroupNode type
- `src/renderer/src/components/Canvas/ContextMenu.tsx` - Context menu options
- `src/renderer/src/components/Canvas/CanvasPane.tsx` - Auto-organize button
- `src/renderer/src/hooks/useGroupManagement.ts` - Helper hook
- `src/renderer/src/lib/autoOrganize.ts` - Clustering algorithm (NEW)

## Future Enhancements
- [ ] Drag-and-drop nodes into groups
- [ ] Right-click group to change color
- [ ] Bulk operations on group children
- [ ] Group nesting (groups within groups)
- [ ] Export/import group templates
- [ ] Keyboard shortcut for quick grouping (Cmd+G)
- [ ] Manual threshold adjustment for clustering
- [ ] Force-directed graph layout for clusters
- [ ] AI-powered naming of clusters based on content
- [ ] Undo/redo for auto-organize

## Testing
All TypeScript types verified with `bun run typecheck` ✓
