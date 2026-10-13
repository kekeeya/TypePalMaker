import { useEditor } from "../store";
import { STRINGS } from "./strings";

/** The strings for the current interface language. */
export function useT() {
  return STRINGS[useEditor((s) => s.lang)];
}
