# Google Flow workflow guide

MM Storyboard Studio prepares a plan; clip generation and final assembly still happen in Google Flow and a video editor.

## Suggested workflow

1. Write the learning goal and audience, not only the topic.
2. Pick a platform and aspect ratio. Use 9:16 for short-form social video and 16:9 for landscape YouTube content.
3. Add actual screenshots, brand references, or screen recordings as image references where available.
4. Generate three concepts, then choose the approach that best serves the audience.
5. Generate the storyboard. Read the production notes and fix runtime mismatches before spending credits.
6. Run the pre-generation audit. Fix warnings about missing text policy, vague continuity references, opening/final frames, audio, and duration.
7. Copy one scene prompt at a time into Google Flow. Match the selected model, generation mode, and clip length to the Flow UI.
8. Use generated clips for cinematic intro shots, hand/keyboard b-roll, and transitions. Use a real screen recording for exact clicks, lesson pages, keyboard states, and typing statistics.
9. Add Burmese voiceover and captions in post. Do not rely on an AI video model to render accurate Burmese Unicode, button labels, or web application UI.
10. Assemble clips, voiceover, subtitles, and music in a video editor. Check spelling, timing, and visual continuity before publishing.

## Current model-profile guide

The Flow model guide can change; these entries are a reminder, not a guarantee. Always confirm the active Flow UI and credit cost immediately before generation.

- Veo 3.1 Fast and Veo 3.1 Lite: ordinary text-to-video and frame-to-video clips are listed at 4, 6, or 8 seconds. Ingredients/references are listed at 8 seconds.
- Veo 3.1 Quality: text-to-video and frame-to-video are listed at 4, 6, or 8 seconds. References, video editing, and extension are not listed as supported.
- Gemini Omni Flash 1.1: text, frames, references, and video edit support are listed for 4, 6, 8, or 10 second clips, depending on mode.
- Extension and other advanced controls are model-specific. If Flow reports that a mode is unsupported, select a supported profile instead of forcing the prompt.

The currently selected model does not change which model powers the app's text generation. Gemini API model selection is configured separately in Settings.

## Prompt quality checklist

- State NO TEXT IN THE IMAGE when text should be added in post.
- Write each clip as a self-contained prompt. Do not write "same as before" or assume Flow remembers a prior generation.
- Give every recurring character or location one canonical @PascalCase handle and preserve appearance, clothes, props, and setting descriptions.
- Use one clear primary action and physically plausible camera movement.
- State opening and final frames to help plan transitions.
- Provide sound design and voiceover separately.
- Do not invent real website features. Use provided screenshots or real screen recordings for product UI.
- Review each generated clip manually; an automated text audit is only a pre-check, not proof that the visual is correct.
