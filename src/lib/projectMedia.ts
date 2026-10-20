import type { ReferenceImage } from "../types";

async function mediaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("mm-storyboard-project-media", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("references");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveReferences(projectId: string, references: ReferenceImage[]): Promise<void> {
  const db = await mediaDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("references", "readwrite");
      tx.objectStore("references").put(references, projectId);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Reference storage failed."));
    });
  } finally { db.close(); }
}
export async function loadReferences(projectId: string): Promise<ReferenceImage[]> {
  const db = await mediaDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("references", "readonly").objectStore("references").get(projectId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
