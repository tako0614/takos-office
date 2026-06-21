import { Show } from "solid-js";
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

function PropertyRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-2">
      <label class="text-xs text-gray-500 dark:text-gray-400 shrink-0 w-20">{props.label}</label>
      <div class="flex-1">{props.children}</div>
    </div>
  );
}

function NumberInput(props: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500 transition-colors"
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

function ColorInput(props: { value: string; onChange: (v: string) => void }) {
  return (
    <div class="flex gap-1 items-center">
      <input
        type="color"
        class="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
      <input
        type="text"
        class="flex-1 bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500"
        value={props.value}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
    </div>
  );
}

export default function PropertyPanel(props: PropertyPanelProps) {
  const { t } = useI18n();
  const el = () => props.element;
  const update = (patch: Partial<SlideElement>) => {
    if (!el()) return;
    props.onUpdateElement({ ...el()!, ...patch });
  };

  return (
    <div class="w-60 bg-white border-l border-gray-200 dark:bg-gray-800 dark:border-gray-700 flex flex-col h-full overflow-y-auto">
      <div class="p-3 border-b border-gray-200 dark:border-gray-700">
        <span class="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {t("properties")}
        </span>
      </div>

      <div class="p-3 space-y-3">
        {/* Slide background */}
        <div class="space-y-2">
          <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
            {t("slideBackground")}
          </span>
          <ColorInput
            value={props.slideBackground}
            onChange={props.onUpdateBackground}
          />
        </div>

        <Show when={el()}>
          <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-3">
            {/* Position */}
            <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("position")}
            </span>
            <div class="grid grid-cols-2 gap-2">
              <PropertyRow label="X">
                <NumberInput
                  value={el()!.x}
                  onChange={(v) => update({ x: v })}
                />
              </PropertyRow>
              <PropertyRow label="Y">
                <NumberInput
                  value={el()!.y}
                  onChange={(v) => update({ y: v })}
                />
              </PropertyRow>
            </div>

            {/* Size */}
            <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{t("size")}</span>
            <div class="grid grid-cols-2 gap-2">
              <PropertyRow label="W">
                <NumberInput
                  value={el()!.width}
                  onChange={(v) => update({ width: v })}
                  min={10}
                />
              </PropertyRow>
              <PropertyRow label="H">
                <NumberInput
                  value={el()!.height}
                  onChange={(v) => update({ height: v })}
                  min={10}
                />
              </PropertyRow>
            </div>

            {/* Rotation */}
            <PropertyRow label={t("rotation")}>
              <NumberInput
                value={el()!.rotation}
                onChange={(v) => update({ rotation: v })}
              />
            </PropertyRow>

            {/* Z-order (stacking) */}
            <div class="space-y-2">
              <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                {t("zOrder")}
              </span>
              <div class="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  class="text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                  title={t("bringToFront")}
                  onClick={() => props.onReorderElement("front")}
                >
                  {t("bringToFront")}
                </button>
                <button
                  type="button"
                  class="text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                  title={t("sendToBack")}
                  onClick={() => props.onReorderElement("back")}
                >
                  {t("sendToBack")}
                </button>
                <button
                  type="button"
                  class="text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                  title={t("bringForward")}
                  onClick={() => props.onReorderElement("forward")}
                >
                  {t("bringForward")}
                </button>
                <button
                  type="button"
                  class="text-xs py-1 rounded bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 transition-colors"
                  title={t("sendBackward")}
                  onClick={() => props.onReorderElement("backward")}
                >
                  {t("sendBackward")}
                </button>
              </div>
            </div>

            {/* Text properties */}
            <Show when={el()!.type === "text"}>
              <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("text")}
                </span>
                <textarea
                  class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1.5 rounded border outline-none focus:border-blue-500 resize-none"
                  rows={3}
                  value={el()!.text ?? ""}
                  onInput={(e) => update({ text: e.currentTarget.value })}
                />
                <PropertyRow label={t("fontSize")}>
                  <NumberInput
                    value={el()!.fontSize ?? 24}
                    onChange={(v) => update({ fontSize: v })}
                    min={8}
                  />
                </PropertyRow>
                <PropertyRow label={t("color")}>
                  <ColorInput
                    value={el()!.fontColor ?? "#333333"}
                    onChange={(v) => update({ fontColor: v })}
                  />
                </PropertyRow>
                <PropertyRow label={t("align")}>
                  <select
                    class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none"
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
                    class="flex-1 text-xs py-1 rounded transition-colors"
                    classList={{
                      "bg-blue-600 text-white": el()!.bold,
                      "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600":
                        !el()!
                        .bold,
                    }}
                    onClick={() => update({ bold: !el()!.bold })}
                  >
                    B
                  </button>
                  <button
                    type="button"
                    class="flex-1 text-xs py-1 rounded transition-colors italic"
                    classList={{
                      "bg-blue-600 text-white": el()!.italic,
                      "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600":
                        !el()!
                        .italic,
                    }}
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
                <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("shape")}
                </span>
                <PropertyRow label={t("fill")}>
                  <ColorInput
                    value={el()!.fillColor ?? "#4f87e0"}
                    onChange={(v) => update({ fillColor: v })}
                  />
                </PropertyRow>
                <PropertyRow label={t("stroke")}>
                  <ColorInput
                    value={el()!.strokeColor ?? "#2563eb"}
                    onChange={(v) => update({ strokeColor: v })}
                  />
                </PropertyRow>
                <PropertyRow label={t("strokeWidth")}>
                  <NumberInput
                    value={el()!.strokeWidth ?? 2}
                    onChange={(v) => update({ strokeWidth: v })}
                    min={0}
                  />
                </PropertyRow>
              </div>
            </Show>

            {/* Image properties */}
            <Show when={el()!.type === "image"}>
              <div class="border-t border-gray-200 dark:border-gray-700 pt-3 space-y-2">
                <span class="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t("image")}
                </span>
                <PropertyRow label={t("imageUrl")}>
                  <input
                    type="text"
                    class="w-full bg-gray-50 text-gray-900 border-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600 text-xs px-2 py-1 rounded border outline-none focus:border-blue-500"
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
          <div class="text-xs text-gray-500 text-center py-8">
            {t("selectElementToEdit")}
          </div>
        </Show>
      </div>
    </div>
  );
}
