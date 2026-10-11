import { ResourceCache } from "@/lib/resource-cache";
import { recolorHeightPixels } from "@/domain/map/height-palette";
interface Raster {
  image: HTMLImageElement | HTMLCanvasElement;
  width: number;
  height: number;
  changed: number;
}
const rasters = new ResourceCache<Raster>({
  entries: 8,
  bytes: 48 * 1024 * 1024,
  sizeOf: (raster) => raster.width * raster.height * 4,
});
/** URL contains the checked map revision; the palette has an independent implementation version. */
export function loadMapRaster(url: string, heightPalette?: string) {
  return rasters.get(
    JSON.stringify([url, heightPalette]),
    () =>
      new Promise<Raster>((resolve, reject) => {
        const image = new Image();
        const timeout = setTimeout(
          () => reject(new Error("Map raster timed out")),
          20_000,
        );
        image.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Map raster failed"));
        };
        image.onload = () => {
          clearTimeout(timeout);
          try {
            let rendered: Raster["image"] = image,
              changed = 0;
            if (heightPalette) {
              const tile = document.createElement("canvas");
              tile.width = image.naturalWidth;
              tile.height = image.naturalHeight;
              const context = tile.getContext("2d");
              if (context) {
                context.drawImage(image, 0, 0);
                const pixels = context.getImageData(
                  0,
                  0,
                  tile.width,
                  tile.height,
                );
                changed = recolorHeightPixels(pixels.data);
                context.putImageData(pixels, 0, 0);
                rendered = tile;
              }
            }
            resolve({
              image: rendered,
              width: image.naturalWidth,
              height: image.naturalHeight,
              changed,
            });
          } catch (error) {
            reject(error);
          }
        };
        image.src = url;
      }),
  );
}
