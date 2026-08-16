import { useCallback } from "react";
import { useCanvasStore } from "./useCanvasStore";
import { useSelection } from "./useSelection";

/**
 * Hook for managing node grouping operations
 */
export function useGroupManagement() {
  const createGroup = useCanvasStore((s) => s.createGroup);
  const moveNodeToGroup = useCanvasStore((s) => s.moveNodeToGroup);
  const removeNodeFromGroup = useCanvasStore((s) => s.removeNodeFromGroup);
  const toggleGroupCollapse = useCanvasStore((s) => s.toggleGroupCollapse);
  const deleteGroup = useCanvasStore((s) => s.deleteGroup);

  const createAndMoveToGroup = useCallback(
    (nodeId: string, groupTitle?: string) => {
      const groupId = createGroup(groupTitle || "New Group");
      moveNodeToGroup(nodeId, groupId);
      return groupId;
    },
    [createGroup, moveNodeToGroup]
  );

  const createGroupFromNodes = useCallback(
    (nodeIds: string[], groupTitle?: string) => {
      const groupId = createGroup(groupTitle || "New Group");
      for (const nodeId of nodeIds) {
        moveNodeToGroup(nodeId, groupId);
      }
      return groupId;
    },
    [createGroup, moveNodeToGroup]
  );

  return {
    createGroup,
    moveNodeToGroup,
    removeNodeFromGroup,
    toggleGroupCollapse,
    deleteGroup,
    createAndMoveToGroup,
    createGroupFromNodes,
  };
}
