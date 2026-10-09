import type { SavedProject, Storyboard, VideoConcept, VideoForm } from "../types";

const safe = (value: string) => value.trim() || "Not specified";

export function storyboardMarkdown(form: VideoForm | SavedProject["form"], concept: VideoConcept | undefined, storyboard: Storyboard): string {
  const lines = [
    "# " + (storyboard.projectTitle || form.topic), "",
    "**Topic:** " + safe(form.topic) + "  ",
    "**Goal:** " + safe(form.goal) + "  ",
    "**Platform:** " + form.platform + " · **Target:** " + form.targetDuration + "s · **Aspect:** " + form.aspectRatio,
    "**Flow model:** " + form.flowModel + " · **Mode:** " + form.generationMode + " · **Clip length:** " + form.clipDuration + "s",
    "**Language:** " + form.language + " · **Visual style:** " + form.visualStyle, "",
    "## Selected concept", "**" + (concept?.title || "Storyboard") + "**", concept?.summary || "", "",
    "## Logline", storyboard.logline, "", "## Visual bible", storyboard.visualBible, "", "## Continuity rules",
    ...(storyboard.continuityRules.length ? storyboard.continuityRules.map((item) => "- " + item) : ["- Keep the visual identity consistent across all clips."]),
    "", "## Reference notes", safe(form.referenceNotes), "", "## Scene prompts",
  ];
  const fence = String.fromCharCode(96).repeat(3);
  storyboard.scenes.forEach((scene) => {
    lines.push("", "### Scene " + scene.sceneNumber + ": " + scene.title + " (" + scene.durationSeconds + "s)", "",
      "**Objective:** " + scene.objective, "**Visual:** " + scene.visualDescription,
      "**Shot / Camera:** " + scene.shotSize + " · " + scene.cameraMovement,
      "**Lighting / Mood:** " + scene.lighting + " · " + scene.mood, "**Action:** " + scene.action, "",
      "**Google Flow prompt (copy into Flow):**", "", fence + "text", scene.flowPrompt, fence, "",
      "**Voiceover (" + form.language + "):** " + (scene.voiceover || "No voiceover"),
      "**On-screen text (add in editing):** " + (scene.onscreenText || "None"),
      "**Audio direction:** " + scene.audioNotes, "**Transition:** " + scene.transition,
      "**Opening frame:** " + scene.openingFrame, "**Final frame:** " + scene.finalFrame,
      "**Negative prompt:** " + scene.negativePrompt,
      "**Reference assets:** " + (scene.referenceAssets.join(", ") || "None"), "**Handoff:** " + scene.handoff);
  });
  lines.push("", "## Global negative prompt", storyboard.globalNegativePrompt, "", "## Production notes");
  storyboard.productionNotes.forEach((item) => lines.push("- " + item));
  lines.push("", "> Prompts are prepared for manual use in Google Flow. Verify the active model, duration, mode, and credit cost before generating.");
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
}

export function fileSlug(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "mm-storyboard";
}
