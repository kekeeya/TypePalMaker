import { IMAGE_EXTENSIONS } from "../model/imageImport";
import { loadPlatform } from "../platform";

/**
 * Asks for images in the formats the Maker takes. The desktop Maker uses the
 * system dialog with those formats only, so nothing else can be picked; the
 * web falls back to the page's own file input (`fallback`), whose `accept`
 * does the same in the browser.
 */
export async function pickImages(options: { multiple: boolean; label: string; fallback: () => void }): Promise<File[] | null> {
  const platform = await loadPlatform();
  if (!platform.pickImages) {
    options.fallback();
    return null;
  }
  return platform.pickImages({ multiple: options.multiple, extensions: IMAGE_EXTENSIONS, label: options.label });
}
