import type { Storyboard, VideoForm } from "../types";

/**
 * Build a reference-image contact sheet prompt from an approved storyboard.
 * This follows the production principle that the image model must be told to
 * generate the storyboard image immediately and must not invent extra beats.
 */
export function buildContactSheetPrompt(form: Pick<VideoForm, "topic" | "platform" | "aspectRatio" | "visualStyle">, storyboard: Storyboard): string {
  const scenes = storyboard.scenes;
  const count = scenes.length;
  const columns = count <= 2 ? count : Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / Math.max(columns, 1));
  const panels = scenes.map((scene, index) => [
    "PANEL " + (index + 1),
    "Scene purpose: " + scene.objective,
    "Visual action: " + scene.visualDescription,
    "Framing and camera: " + scene.shotSize + "; " + scene.cameraMovement,
    "Lighting and mood: " + scene.lighting + "; " + scene.mood,
    "Main action: " + scene.action,
    "Reference assets: " + (scene.referenceAssets.join(", ") || "Use only the defined visual bible and the supplied reference images.")
  ].join("\n")).join("\n\n");

  return [
    "GENERATE THE STORYBOARD IMAGE NOW.",
    "Create exactly " + count + " distinct storyboard panels in one clean contact sheet, arranged in a " + rows + " row by " + columns + " column grid. Do not respond with a written plan.",
    "",
    "PROJECT",
    storyboard.projectTitle || form.topic,
    "Story logline: " + storyboard.logline,
    "Target platform and frame shape: " + form.platform + ", " + form.aspectRatio,
    "Visual style: " + form.visualStyle,
    "",
    "VISUAL BIBLE",
    storyboard.visualBible,
    "",
    "CONTINUITY RULES",
    ...(storyboard.continuityRules.length ? storyboard.continuityRules.map((rule) => "- " + rule) : ["- Preserve the same recurring character appearance, wardrobe, props, environment, and lighting logic across panels."]),
    "",
    "PANEL CONTENT, IN EXACT ORDER",
    panels,
    "",
    "LAYOUT AND STORY RULES",
    "- Output exactly " + count + " panels. Use clear, even gutters and a consistent panel size. Read panels from left to right and top to bottom.",
    "- Every panel must depict only the action and story state specified for its corresponding scene. Do not add unrequested scenes, characters, props, actions, or filler beats.",
    "- Preserve recurring subjects using consistent face, age, hair, wardrobe, body proportions, prop design, and environment. If a reference image is supplied, treat it as the visual source of truth.",
    "- Give each panel a clear focal point and distinct readable composition. Keep panels visually separate; do not merge them into one continuous panoramic scene.",
    "- No visible text, captions, subtitles, watermarks, panel numbers, labels, logos, interface text, or decorative lettering inside the image. Add exact text later in editing.",
    "- Do not include timestamps, camera instructions, or production notes as visible graphic elements.",
    "- Keep hands, fingers, keyboards, screens, and physical interactions plausible. Do not invent LearnTypeMM website UI; use authentic screenshots for accurate product interfaces.",
    "",
    "NEGATIVE GUIDANCE",
    storyboard.globalNegativePrompt || "Avoid inconsistent faces or wardrobe, duplicate people, malformed hands, extra fingers, broken keyboards, illegible text, fake website interfaces, fused panels, missing gutters, watermarks, flicker-like artifacts, and unrequested story events.",
    "",
    "This contact sheet is a visual reference for planning separately generated clips. It is not the finished video."
  ].join("\n");
}
