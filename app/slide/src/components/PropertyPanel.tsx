import { createUniqueId, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { SlideElement } from "../types";
import { useI18n } from "../i18n";

export type ZOrderAction = "front" | "back" | "forward" | "backward";

interface PropertyPanelProps {
  element: SlideElement | null;
  onUpdateElement: (element: SlideElement) => void;
  slideBackground: string;
  onUpdateBackground: (color: string) => void;
  onReorderElement: (action: ZOrderAction) => void;
}

function PropertyRow(props: {
  label: string;
  forId: string;
  compact?: boolean;
  children: JSX.Element;
}) {
  return (
    <div class="flex items-center justify-between gap-2 min-w-0">
      <label
        for={props.forId}
        class={`text-xs text-gray-600 dark:text-gray-300 shrink-0 ${
          props.compact ? "w-5" : "w-20"
        }`}
      >
        {props.label}
      </label>
      <div class="min-w-0 flex-1">{props.children}</div>
    </div>
  );
}

function NumberInput(props: {
  id: string;
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  min?: number;
  step?: number;
}) {
  return (
    <input
      id={props.id}
      type="number"
      class="w-full min-w-0 min-h-11 sm:min-h-7 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 transition-colors"
      aria-label={props.ariaLabel}
      value={props.value}
      min={props.min}
      step={props.step ?? 1}
      onInput={(e) => {
        const v = parseFloat(e.currentTarget.value);
        if (!isNaN(v)) props.onChange(v);
      }}
    />
  );
}

function ColorInput(props: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  ariaLabel: string;
}) {
  return (
    <div class="flex gap-1.5 items-center min-w-0">
      <input
        type="color"
        class="w-11 h-11 sm:w-6 sm:h-6 shrink-0 rounded cursor-pointer border-0 bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label={props.ariaLabel}
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
      <input
        id={props.id}
        type="text"
        class="min-w-0 flex-1 min-h-11 sm:min-h-7 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
        aria-label={`${props.ariaLabel} (hex)`}
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  );
}

export default function PropertyPanel(props: PropertyPanelProps) {
  const { t } = useI18n();
  const bgId = createUniqueId();
  const posXId = createUniqueId();
  const posYId = createUniqueId();
  const sizeWId = createUniqueId();
  const sizeHId = createUniqueId();
  const rotId = createUniqueId();
  const textId = createUniqueId();
  const fontSizeId = createUniqueId();
  const fontColorId = createUniqueId();
  const alignId = createUniqueId();
  const fillId = createUniqueId();
  const strokeId = createUniqueId();
  const strokeWidthId = createUniqueId();
  const imageUrlId = createUniqueId();
  const el = () => props.element;
  const update = (patch: Partial<SlideElement>) => {
    if (!el()) return;
    props.onUpdateElement({ ...el()!, ...patch });
  };

  return (
    <div class="w-64 max-w-full bg-white border-l border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex flex-col h-full overflow-y-auto overflow-x-hidden">
      <div class="p-3 border-b border-gray-200 dark:border-gray-700">
        <span class="text-xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">
          {t("properties")}
        </span>
      </div>

      <div class="p-3 space-y-3">
        {/* Slide background */}
        <div class="space-y-2">
          <label
            for={bgId}
            class="block text-xs font-medium text-gray-700 dark:text-gray-300"
          >
            {t("slideBackground")}
          </label>
          <ColorInput
            id={bgId}
            value={props.slideBackground}
            onChange={props.onUpdateBackground}
            ariaLabel={t("slideBackground")}
          />
        </div>

        <Show when={el()}>
          <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-3">
            {/* Position */}
            <span class="block text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("position")}
            </span>
            <div class="grid grid-cols-2 gap-2">
              <PropertyRow label="X" forId={posXId} compact>
                <NumberInput
                  id={posXId}
                  value={el()!.x}
                  onChange={(v) => update({ x: v })}
                  ariaLabel={`${t("position")} X`}
                />
              </PropertyRow>
              <PropertyRow label="Y" forId={posYId} compact>
                <NumberInput
                  id={posYId}
                  value={el()!.y}
                  onChange={(v) => update({ y: v })}
                  ariaLabel={`${t("position")} Y`}
                />
              </PropertyRow>
            </div>

            {/* Size */}
            <span class="block text-xs font-medium text-gray-700 dark:text-gray-300">{t("size")}</span>
            <div class="grid grid-cols-2 gap-2">
              <PropertyRow label="W" forId={sizeWId} compact>
                <NumberInput
                  id={sizeWId}
                  value={el()!.width}
                  onChange={(v) => update({ width: v })}
                  ariaLabel={`${t("size")} W`}
                  min={10}
                />
              </PropertyRow>
              <PropertyRow label="H" forId={sizeHId} compact>
                <NumberInput
                  id={sizeHId}
                  value={el()!.height}
                  onChange={(v) => update({ height: v })}
                  ariaLabel={`${t("size")} H`}
                  min={10}
                />
              </PropertyRow>
            </div>

            {/* Rotation */}
            <PropertyRow label={t("rotation")} forId={rotId}>
              <NumberInput
                id={rotId}
                value={el()!.rotation}
                onChange={(v) => update({ rotation: v })}
                ariaLabel={t("rotation")}
              />
            </PropertyRow>

            {/* Z-order (stacking) */}
            <div class="space-y-2">
              <span class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("zOrder")}
              </span>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="min-h-11 sm:min-h-7 text-xs px-1.5 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title={t("bringToFront")}
                  aria-label={t("bringToFront")}
                  onClick={() => props.onReorderElement("front")}
                >
                  {t("bringToFront")}
                </button>
                <button
                  type="button"
                  class="min-h-11 sm:min-h-7 text-xs px-1.5 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title={t("sendToBack")}
                  aria-label={t("sendToBack")}
                  onClick={() => props.onReorderElement("back")}
                >
                  {t("sendToBack")}
                </button>
                <button
                  type="button"
                  class="min-h-11 sm:min-h-7 text-xs px-1.5 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title={t("bringForward")}
                  aria-label={t("bringForward")}
                  onClick={() => props.onReorderElement("forward")}
                >
                  {t("bringForward")}
                </button>
                <button
                  type="button"
                  class="min-h-11 sm:min-h-7 text-xs px-1.5 py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  title={t("sendBackward")}
                  aria-label={t("sendBackward")}
                  onClick={() => props.onReorderElement("backward")}
                >
                  {t("sendBackward")}
                </button>
              </div>
            </div>

            {/* Text properties */}
            <Show when={el()!.type === "text"}>
              <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                <label
                  for={textId}
                  class="block text-xs font-medium text-gray-700 dark:text-gray-300"
                >
                  {t("text")}
                </label>
                <textarea
                  id={textId}
                  class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1.5 rounded border outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 resize-none"
                  aria-label={t("text")}
                  rows={3}
                  value={el()!.text ?? ""}
                  onInput={(e) => update({ text: e.currentTarget.value })}
                />
                <PropertyRow label={t("fontSize")} forId={fontSizeId}>
                  <NumberInput
                    id={fontSizeId}
                    value={el()!.fontSize ?? 24}
                    onChange={(v) => update({ fontSize: v })}
                    ariaLabel={t("fontSize")}
                    min={8}
                  />
                </PropertyRow>
                <PropertyRow label={t("color")} forId={fontColorId}>
                  <ColorInput
                    id={fontColorId}
                    value={el()!.fontColor ?? "#333333"}
                    onChange={(v) => update({ fontColor: v })}
                    ariaLabel={t("color")}
                  />
                </PropertyRow>
                <PropertyRow label={t("align")} forId={alignId}>
                  <select
                    id={alignId}
                    class="w-full min-w-0 min-h-11 sm:min-h-7 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={t("align")}
                    value={el()!.textAlign ?? "left"}
                    onChange={(e) =>
                      update({
                        textAlign: e.currentTarget.value as
                          | "left"
                          | "center"
                          | "right",
                      })}
                  >
                    <option value="left">{t("alignLeft")}</option>
                    <option value="center">{t("alignCenter")}</option>
                    <option value="right">{t("alignRight")}</option>
                  </select>
                </PropertyRow>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="flex-1 min-h-11 sm:min-h-7 text-xs py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    classList={{
                      "bg-blue-600 text-white": el()!.bold,
                      "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600":
                        !el()!
                        .bold,
                    }}
                    aria-label={t("bold")}
                    aria-pressed={el()!.bold ? "true" : "false"}
                    onClick={() => update({ bold: !el()!.bold })}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    class="flex-1 min-h-11 sm:min-h-7 text-xs py-1 rounded transition-colors italic focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                    classList={{
                      "bg-blue-600 text-white": el()!.italic,
                      "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600":
                        !el()!
                        .italic,
                    }}
                    aria-label={t("italic")}
                    aria-pressed={el()!.italic ? "true" : "false"}
                    onClick={() => update({ italic: !el()!.italic })}
                  >
                    I
                  </button>
                </div>
              </div>
            </Show>

            {/* Shape properties */}
            <Show when={el()!.type === "shape"}>
              <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                <span class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("shape")}
                </span>
                <PropertyRow label={t("fill")} forId={fillId}>
                  <ColorInput
                    id={fillId}
                    value={el()!.fillColor ?? "#4f87e0"}
                    onChange={(v) => update({ fillColor: v })}
                    ariaLabel={t("fill")}
                  />
                </PropertyRow>
                <PropertyRow label={t("stroke")} forId={strokeId}>
                  <ColorInput
                    id={strokeId}
                    value={el()!.strokeColor ?? "#2563eb"}
                    onChange={(v) => update({ strokeColor: v })}
                    ariaLabel={t("stroke")}
                  />
                </PropertyRow>
                <PropertyRow label={t("strokeWidth")} forId={strokeWidthId}>
                  <NumberInput
                    id={strokeWidthId}
                    value={el()!.strokeWidth ?? 2}
                    onChange={(v) => update({ strokeWidth: v })}
                    ariaLabel={t("strokeWidth")}
                    min={0}
                  />
                </PropertyRow>
              </div>
            </Show>

            {/* Image properties */}
            <Show when={el()!.type === "image"}>
              <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                <span class="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("image")}
                </span>
                <PropertyRow label={t("imageUrl")} forId={imageUrlId}>
                  <input
                    id={imageUrlId}
                    type="text"
                    class="w-full min-w-0 min-h-11 sm:min-h-7 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500"
                    aria-label={t("imageUrl")}
                    value={el()!.imageUrl ?? ""}
                    onInput={(e) => update({ imageUrl: e.currentTarget.value })}
                    placeholder="https://..."
                  />
                </PropertyRow>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={!el()}>
          <div class="text-xs text-gray-600 dark:text-gray-400 text-center py-8">
            {t("selectElementToEdit")}
          </div>
        </Show>
      </div>
    </div>
  );
}
