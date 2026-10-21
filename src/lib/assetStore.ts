import type { ImageAsset, ReferenceImage, Scene } from "../types";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mm-storyboard-asset-library", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("assets")) request.result.createObjectStore("assets", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readAssets(): Promise<ImageAsset[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("assets", "readonly").objectStore("assets").getAll();
      request.onsuccess = () => resolve((request.result as ImageAsset[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
export async function writeAssets(assets: ImageAsset[], removeId?: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("assets", "readwrite");
      for (const asset of assets) tx.objectStore("assets").put(asset);
      if (removeId) tx.objectStore("assets").delete(removeId);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Asset storage failed."));
    });
    window.dispatchEvent(new Event("assets-changed"));
  } finally { db.close(); }
}
export const putAsset = (asset: ImageAsset) => writeAssets([asset]);
export const removeAsset = (id: string) => writeAssets([], id);
export const assetAsReference = (asset: ImageAsset): ReferenceImage => ({
  name: asset.title, mimeType: asset.mimeType, data: asset.data, previewUrl: `data:${asset.mimeType};base64,${asset.data}`,
});
// Explicit per-scene choices override the project's default cast. [] means no cast.
export function sceneReferences(scene: Scene, assets: ImageAsset[]): ImageAsset[] {
  return assets.filter((asset) => asset.kind !== "scene" && (scene.assetIds ? scene.assetIds.includes(asset.id) : asset.useAsReference));
}
export function assetHandle(asset: ImageAsset): string {
  if (asset.handle) return asset.handle;
  const name = asset.title.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return "@" + (/^[A-Z]/.test(name) ? name : "Reference" + name) + asset.id.replace(/[^a-zA-Z0-9]/g, "");
}
export function promptWithReferences(scene: Scene, assets: ImageAsset[]): string {
  const references = sceneReferences(scene, assets);
  if (!references.length) return scene.flowPrompt;
  return scene.flowPrompt + "\n\nVisual references (upload and bind these assets in Flow):\n" + references.map((asset) =>
    `${assetHandle(asset)}: ${asset.title}. Use the attached ${asset.kind} image as the source of truth; preserve ${asset.kind === "character" ? "identity, face, hair, proportions and wardrobe" : asset.kind === "prop" ? "shape, color, materials and product details" : "layout, materials, props and lighting"}.`
  ).join("\n");
}
