import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import { useI18n } from "../i18n";

interface ShapeToolbarProps {
  onInsertText: () => void;
  onInsertShape: (shape: "rect" | "ellipse" | "triangle" | "arrow") => void;
  onInsertImage: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onPresent: () => void;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  presentationTitle: string;
  onTitleChange: (title: string) => void;
}

function ToolButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger" | "primary";
}) {
  const variant = () => props.variant ?? "default";
  return (
    <button
      type="button"
      class="px-3 py-1.5 text-xs font-medium rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      classList={{
        "bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200":
          variant() === "default",
        "bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-700/60 dark:hover:bg-red-600/80 dark:text-red-200":
          variant() === "danger",
        "bg-blue-600 hover:bg-blue-500 text-white": variant() === "primary",
      }}
      onClick={() => props.onClick()}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

export default function ShapeToolbar(props: ShapeToolbarProps) {
  const { t } = useI18n();

  return (
    <div class="h-12 bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex items-center px-4 gap-2">
      {/* Title */}
      <input
        class="bg-transparent text-sm font-semibold text-gray-900 dark:text-gray-100 border-none outline-none hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-700 dark:focus:bg-gray-700 px-2 py-1 rounded w-48 transition-colors"
        value={props.presentationTitle}
        onInput={(e) => props.onTitleChange(e.currentTarget.value)}
      />

      <div class="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2" />

      {/* Insert tools */}
      <span class="text-xs text-gray-500 dark:text-gray-500 mr-1">{t("insert")}</span>
      <ToolButton label={t("text")} onClick={() => props.onInsertText()} />
      <ToolButton
        label={t("rect")}
        onClick={() => props.onInsertShape("rect")}
      />
      <ToolButton
        label={t("ellipse")}
        onClick={() => props.onInsertShape("ellipse")}
      />
      <ToolButton
        label={t("triangle")}
        onClick={() => props.onInsertShape("triangle")}
      />
      <ToolButton
        label={t("arrow")}
        onClick={() => props.onInsertShape("arrow")}
      />
      <ToolButton label={t("image")} onClick={() => props.onInsertImage()} />

      <div class="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2" />

      {/* Edit tools */}
      <ToolButton
        label={t("undo")}
        onClick={() => props.onUndo()}
        disabled={!props.canUndo}
      />
      <ToolButton
        label={t("redo")}
        onClick={() => props.onRedo()}
        disabled={!props.canRedo}
      />
      <ToolButton
        label={t("delete")}
        onClick={() => props.onDelete()}
        disabled={!props.hasSelection}
        variant="danger"
      />

      <div class="flex-1" />

      {/* Present */}
      <LanguageSwitcher />
      <ThemeToggle />
      <ToolButton
        label={t("present")}
        onClick={() => props.onPresent()}
        variant="primary"
      />
    </div>
  );
}
