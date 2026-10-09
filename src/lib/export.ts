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

export function flowPromptPack(form: VideoForm | SavedProject["form"], concept: VideoConcept | undefined, storyboard: Storyboard): string {
  const lines = [
    "GOOGLE FLOW PROMPT PACK",
    "Project: " + safe(storyboard.projectTitle || form.topic),
    "Topic: " + safe(form.topic),
    "Goal: " + safe(form.goal),
    "Platform: " + form.platform + " | Target runtime: " + form.targetDuration + "s | Aspect ratio: " + form.aspectRatio,
    "Flow model: " + form.flowModel + " | Mode: " + form.generationMode + " | Desired clip length: " + form.clipDuration + "s",
    "Language: " + form.language + " | Visual style: " + form.visualStyle,
    "",
    "HOW TO USE THIS FILE",
    "For each scene, paste only the text under PROMPT TO PASTE INTO GOOGLE FLOW into Flow.",
    "Use the voiceover, caption, audio, and editing notes separately in your video editor.",
    "Do not ask the video model to render exact Burmese captions or website UI text.",
    "Verify the active Flow model, mode, supported duration, and credit cost before generating.",
    "",
    "SELECTED CONCEPT",
    concept?.title || "Storyboard",
    concept?.summary || "",
    "",
    "VISUAL BIBLE",
    storyboard.visualBible || "Keep subject, props, palette, and camera language consistent.",
    "",
    "CONTINUITY RULES",
    ...(storyboard.continuityRules.length ? storyboard.continuityRules.map((item) => "- " + item) : ["- Keep visual identity consistent across clips."]),
    "",
    "REFERENCE NOTES",
    safe(form.referenceNotes),
    "",
    "GLOBAL NEGATIVE PROMPT",
    storyboard.globalNegativePrompt || "Avoid flicker, malformed hands, illegible generated text, fake website UI, duplicate objects, and watermarks where relevant."
  ];

  storyboard.scenes.forEach((scene) => {
    lines.push(
      "",
      "================================================================",
      "SCENE " + scene.sceneNumber + ": " + scene.title,
      "CLIP LENGTH: " + scene.durationSeconds + " seconds",
      "OBJECTIVE: " + safe(scene.objective),
      "",
      "PROMPT TO PASTE INTO GOOGLE FLOW",
      "----------------------------------------------------------------",
      scene.flowPrompt.trim() || "[Missing prompt: edit this scene before generating.]",
      "",
      "VOICEOVER (" + form.language + ") — ADD SEPARATELY",
      scene.voiceover.trim() || "(No voiceover)",
      "",
      "ON-SCREEN CAPTION — ADD IN THE EDITOR",
      scene.onscreenText.trim() || "(No caption)",
      "",
      "AUDIO DIRECTION",
      scene.audioNotes.trim() || safe(form.audioPolicy),
      "",
      "EDIT / TRANSITION",
      safe(scene.transition),
      "",
      "OPENING FRAME",
      scene.openingFrame.trim() || "(Not specified)",
      "",
      "FINAL FRAME",
      scene.finalFrame.trim() || "(Not specified)",
      "",
      "NEGATIVE PROMPT",
      scene.negativePrompt.trim() || "(None specified; use only if supported by the active Flow UI.)",
      "",
      "REFERENCE ASSETS",
      scene.referenceAssets.length ? scene.referenceAssets.map((item) => "- " + item).join("\n") : "- None specified",
      "",
      "HANDOFF",
      scene.handoff
    );
  });

  if (storyboard.productionNotes.length) {
    lines.push("", "PRODUCTION NOTES", ...storyboard.productionNotes.map((item) => "- " + item));
  }
  lines.push("", "Generated by MM AI Storyboard Generator. This file contains prompts and production notes; it does not generate videos or connect to Google Flow automatically.");
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
