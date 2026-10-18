import { useT } from "../i18n/useT";
import { fitRect } from "../model/placement";
import { useEditor } from "../store";
import { PlacementControls } from "./PlacementControls";

/** Placement of the selected frame on the canvas. */
export function Inspector() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const state = useEditor((s) => s.selectedState);
  const index = useEditor((s) => s.selectedIndex);
  const trackId = useEditor((s) => s.selectedTrackId);
  const setPlacement = useEditor((s) => s.setPlacement);
  const spec = project.states[state];
  const frames = spec.tracks?.find((track) => track.id === trackId)?.frames ?? spec.frames;
  const frame = index !== null ? frames[index] : undefined;
  const scale = frame?.scale ?? 1;
  // The picture's size on the canvas, in canvas pixels.
  const asset = frame && project.frames[frame.id];
  const fitted = asset ? fitRect(asset, project.canvas) : null;
  const size = fitted ? `${Math.round(fitted.width * scale)} × ${Math.round(fitted.height * scale)} px` : null;

  return (
    <aside className="panel inspector soft-card">
      <div className="inspector-title">
        <span>{t.frame}</span>
      </div>
      <PlacementControls
        value={{ scale, offsetX: frame?.offsetX ?? 0, offsetY: frame?.offsetY ?? 0, rotation: frame?.rotation ?? 0 }}
        disabled={!frame}
        size={size}
        onChange={(patch) => index !== null && frame && setPlacement(state, index, patch, trackId)}
      />
    </aside>
  );
}
