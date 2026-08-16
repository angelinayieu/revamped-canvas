import { memo, useMemo, useRef, useState } from "react";
import { NodeResizer, type NodeProps, Handle, Position } from "@xyflow/react";
import { motion } from "framer-motion";
import { ChevronDown, Trash2, Palette } from "lucide-react";
import clsx from "clsx";
import type { CanvasNode } from "@shared/types";
import { useCanvasStore } from "@/hooks/useCanvasStore";

type GroupNodeData = CanvasNode["data"];

const colors = ["blue", "green", "purple", "orange", "red", "pink", "yellow", "slate"] as const;

const colorMap: Record<string, { bg: string; border: string; ring: string; text: string }> = {
  blue: { bg: "bg-blue-50", border: "border-blue-200", ring: "ring-blue-500", text: "text-blue-700" },
  green: { bg: "bg-green-50", border: "border-green-200", ring: "ring-green-500", text: "text-green-700" },
  purple: { bg: "bg-purple-50", border: "border-purple-200", ring: "ring-purple-500", text: "text-purple-700" },
  orange: { bg: "bg-orange-50", border: "border-orange-200", ring: "ring-orange-500", text: "text-orange-700" },
  red: { bg: "bg-red-50", border: "border-red-200", ring: "ring-red-500", text: "text-red-700" },
  pink: { bg: "bg-pink-50", border: "border-pink-200", ring: "ring-pink-500", text: "text-pink-700" },
  yellow: { bg: "bg-yellow-50", border: "border-yellow-200", ring: "ring-yellow-500", text: "text-yellow-700" },
  slate: { bg: "bg-slate-50", border: "border-slate-200", ring: "ring-slate-500", text: "text-slate-700" },
};

function GroupNodeImpl(props: NodeProps) {
  const { id, selected, data } = props;
  const nodeData = data as GroupNodeData;
  const groupData = nodeData.group;

  if (!groupData) {
    return <div>Invalid group node</div>;
  }

  const nodes = useCanvasStore((s) => s.nodes);
  const toggleGroupCollapse = useCanvasStore((s) => s.toggleGroupCollapse);
  const deleteGroup = useCanvasStore((s) => s.deleteGroup);
  const patchNode = useCanvasStore((s) => s.patchNode);

  const [isEditing, setIsEditing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [editTitle, setEditTitle] = useState(groupData.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const color = colorMap[groupData.color || "blue"] || colorMap.blue;
  const childNodes = useMemo(
    () => groupData.childIds.map((id) => nodes[id]).filter(Boolean),
    [groupData.childIds, nodes]
  );

  const handleSaveTitle = () => {
    if (editTitle.trim()) {
      patchNode(id, {
        title: editTitle.trim(),
        group: { ...groupData, title: editTitle.trim() },
      });
    }
    setIsEditing(false);
  };

  const handleColorChange = (newColor: string) => {
    patchNode(id, {
      group: { ...groupData, color: newColor as any },
    });
    setShowColorPicker(false);
  };

  return (
    <motion.div
      className="relative"
      style={{ minWidth: 220, minHeight: 120 }}
      initial={{ scale: 0.96, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
    >
      <Handle type="target" position={Position.Top} />
      <Handle type="source" position={Position.Bottom} />

      <NodeResizer
        isVisible={selected}
        minWidth={220}
        minHeight={120}
        lineClassName="!border-transparent"
        handleClassName="!h-3 !w-3 !border-0 !bg-transparent !shadow-none"
      />

      <div
        className={clsx(
          "relative border-2 rounded-[10px] transition-all duration-200 p-4 shadow-sm",
          color.bg,
          color.border,
          selected && `ring-2 ${color.ring} ring-offset-2 ring-offset-background`
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <button
            onClick={() => toggleGroupCollapse(id)}
            className="flex-shrink-0 p-1 hover:bg-black/5 rounded transition-colors"
            title={groupData.isCollapsed ? "Expand" : "Collapse"}
          >
            <ChevronDown
              size={18}
              className={clsx(
                "transition-transform",
                groupData.isCollapsed && "rotate-180"
              )}
            />
          </button>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveTitle();
                  if (e.key === "Escape") {
                    setEditTitle(groupData.title);
                    setIsEditing(false);
                  }
                }}
                autoFocus
                className="w-full px-2 py-1 text-sm font-semibold bg-white border border-gray-300 rounded outline-none text-foreground placeholder:text-muted-foreground"
              />
            ) : (
              <h3
                onClick={() => setIsEditing(true)}
                className={clsx(
                  "text-sm font-semibold truncate cursor-text hover:opacity-70 transition-opacity",
                  color.text
                )}
              >
                {groupData.title}
              </h3>
            )}
          </div>

          <div className="flex items-center gap-1">
            <div className="relative">
              <button
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="flex-shrink-0 p-1 hover:bg-black/5 rounded transition-colors"
                title="Change color"
              >
                <Palette size={16} className={color.text} />
              </button>
              {showColorPicker && (
                <div className="absolute right-0 top-8 bg-white border border-gray-300 rounded-lg shadow-lg p-2 z-10 grid grid-cols-4 gap-2">
                  {colors.map((c) => (
                    <button
                      key={c}
                      onClick={() => handleColorChange(c)}
                      className={clsx(
                        "w-6 h-6 rounded transition-all",
                        colorMap[c].bg,
                        colorMap[c].border,
                        "border-2",
                        groupData.color === c && "ring-2 ring-offset-1"
                      )}
                      title={c}
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={() => deleteGroup(id, true)}
              className="flex-shrink-0 p-1 hover:bg-red-100 rounded transition-colors"
              title="Delete group"
            >
              <Trash2 size={16} className="text-red-600" />
            </button>
          </div>
        </div>

        {/* Content */}
        {!groupData.isCollapsed && (
          <div className="space-y-1 text-xs text-muted-foreground">
            {childNodes.length > 0 ? (
              <div>
                <div className="font-medium mb-1">
                  {childNodes.length} node{childNodes.length !== 1 ? "s" : ""}
                </div>
                <div className="space-y-1 pl-2 border-l border-gray-300">
                  {childNodes.map((node) => (
                    <div
                      key={node.id}
                      className="truncate text-xs text-foreground/70"
                      title={node.data.title || "Untitled"}
                    >
                      {node.type === "group"
                        ? `📁 ${node.data.group?.title || "Group"}`
                        : node.data.title || "Untitled"}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-gray-400 py-2 text-center italic">
                No nodes in group
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

export const GroupNode = memo(GroupNodeImpl);
