# MM AI Storyboard Generator

MM Storyboard Studio converts a short idea into three creative concepts, a complete scene-by-scene storyboard, and copy-ready Google Flow / Veo prompts. It is designed for LearnTypeMM tutorials, product explainers, Burmese-language educational clips, TikTok, Facebook Reels, YouTube Shorts, and longer YouTube videos.

## What it does

- Generate three genuinely different video concepts from a single brief.
- Build a structured storyboard with scene goals, visual direction, shot size, camera movement, lighting, mood, action, and transition.
- Write English Google Flow prompts, Burmese or bilingual voiceover, and exact captions separately for editing.
- Keep repeated people and places consistent with a visual bible, continuity rules, canonical reference handles, and self-contained prompts.
- Add screenshots or reference images to ground the plan in real product UI.
- Edit and regenerate one scene without rebuilding the whole project.
- Run automated pre-generation checks for first-line text policy, vague cross-scene references, canonical @ReferenceHandles, opening/final frames, text-bleed tokens, punctuation compatibility, audio direction, and clip duration.
- Copy a single prompt or all prompts and export Markdown, JSON, or a plain-text Google Flow prompt pack with voiceover, captions, and editing notes separated.
- Save and reopen projects in the current browser.
- Generate an exact-count storyboard contact-sheet prompt for visual planning.
- Optionally render individual scenes or a full batch through a user-configured ComfyUI API workflow.
- Preview ComfyUI image/video outputs and merge returned video clips in-browser with FFmpeg.wasm.

## Run locally

Requirements: Node.js 22.22.2+, 24.15.0+, or 26+ and a Gemini API key with access to the configured model.

1. Install dependencies with npm install.
2. Start the development server with npm run dev.
3. Open the local address printed by Vite.
4. Open Settings and add your Gemini API key.
5. Enter a topic, choose a visual style, and press Generate 3 concepts.
6. Select a concept and choose Build this storyboard.
7. Use **Copy contact-sheet prompt** to prepare a visual reference sheet, then copy each scene prompt into Google Flow.
8. Export **Flow .txt** for a complete prompt pack, including each scene's voiceover, captions, and editing notes.
9. Optionally expand **Generate images or videos with ComfyUI**, load your own API-format workflow, map its prompt node, and generate one scene or the full batch. Use the merge action when two or more video outputs are available.
10. Edit Burmese captions and any real LearnTypeMM screen recordings into the finished tutorial.

Run `npm test` for the production workflow regression suite. To create a production build, run npm run build. To preview the build, run npm run preview.

## API and privacy

The app calls the Gemini generateContent REST API directly from the browser using the API key entered by the user. The key is stored in this browser's localStorage, not committed to this repository. This is suitable for personal/local use, but localStorage is not a secrets vault. Do not publish a shared deployment with a private server key in the frontend. For a public deployment, add an authenticated backend route with quotas, abuse protection, and server-side secret storage.

Uploaded reference images are sent to Gemini only when generation is requested. Reference image files are stored in browser IndexedDB, keyed by project, and restored with saved projects. Saved projects and the API key remain in the current browser; clearing site data removes them.

## Optional ComfyUI generation

This project can queue a user-supplied ComfyUI API-format workflow for one storyboard scene or every scene in sequence. It can collect image/video outputs from ComfyUI history, preview them, download them, and concatenate compatible video clips in the browser using FFmpeg.wasm.

1. Run ComfyUI with the required image/video model and custom nodes installed.
2. Open the workflow in ComfyUI and export it using **Save (API Format)**. The app cannot use a normal UI workflow JSON directly.
3. Expand **Optional: Generate images or videos with ComfyUI**, set the ComfyUI server URL, upload the workflow JSON, and choose the positive prompt node ID and input key.
4. Optionally map the negative prompt node. Confirm your workflow has a Save Image or Save Video output.
5. Test the connection, then render one scene before using **Generate all scenes**.

The workflow is user-supplied and must accept a text prompt in the configured node. The same workflow is used for each scene, so workflows that need different start/end images, custom nodes, or special inputs may require extra configuration in ComfyUI. Generation runs on the ComfyUI server, not Google Flow. Video concatenation works best when clips share compatible codecs, resolution, frame rate, and container format.

The browser connects directly to your ComfyUI URL. Local browser security may block requests unless ComfyUI allows your app origin through CORS. Restrict CORS to the local development origin you trust; do not expose an unauthenticated ComfyUI server or allow every website to control it.

## Bundled Google Flow scripting tools\n\nSelected upstream files from the MIT-licensed [Google Flow Scripting Skill](https://github.com/agbelemi/google-flow-scripting-skill) are included under `integrations/google-flow-scripting-skill/`, with the original license and attribution preserved. The bundle includes specialist production guidance, a storyboard contact-sheet prompt generator, and a command-line validator. See [the integration README](integrations/google-flow-scripting-skill/README.md).\n\nRun the validator from the repository root with `python integrations/google-flow-scripting-skill/scripts/validate.py --help`. To generate a contact-sheet prompt from the bundled JSON example, run `python integrations/google-flow-scripting-skill/scripts/generate_storyboard_prompt.py integrations/google-flow-scripting-skill/examples/storyboard-spec.json --output storyboard-package.md`.\n\n## Google Flow limits

The app prepares prompts; it does not call Google Flow, generate video clips, spend Flow credits, or guarantee that a chosen model/mode combination is supported. Flow model availability, credits, duration, modes, and UI can change. The app gives compatibility warnings based on the current model guide, but verify the active model and settings in Flow before generating.

For accurate LearnTypeMM tutorials, upload current screenshots as references and use real screen recordings for exact interactions. AI video prompts request no generated text by default; add Burmese captions and exact UI labels in a video editor.

## AI Asset Studio

The Asset Studio creates reusable visual assets instead of only writing storyboard prompts:

- **Character Studio:** create a new character or refine an uploaded character image while asking Gemini to preserve identity, face, hair, clothing, and proportions. Generate a full-body reference, turnaround sheet, or expression sheet.
- **Background Studio:** generate reusable environment plates without people, readable text, or logos; upload an approved background to create matching variants.
- **Scene Image Generator:** create a separate image for each storyboard scene, with selected character and location images supplied as visual references. Batch generation is sequential and supports pause, resume, stop-after-current, per-scene retries, and generate-missing mode.
- **Asset Library:** images are stored in browser IndexedDB, not embedded into saved storyboard projects. Download images individually and export their prompts for reuse.

Image generation calls Google's Gemini Interactions API using the stable image model ID gemini-nano-banana-2.1. It uses the API key already entered in Settings; image-generation API usage may incur charges. Keep the app for personal/local use unless you add an authenticated backend, quotas, abuse protection, and server-side secret storage before public deployment. Image requests are sent directly from this browser to Google. Reference images are resized in the browser to a maximum 1280px long edge before being sent. Generated images include Google's SynthID watermark where supported by the model.

## Technology

React, TypeScript, Vite, Lucide React, CSS, and the Gemini generateContent REST API.

## Inspiration

The React app and ComfyUI integration are independently implemented. Selected Google Flow Scripting Skill files are bundled separately under their original MIT license and attribution. No source code or workflow JSON from the AI Storyboard Generator repository is copied because its default branch currently has no LICENSE file, despite the README mentioning MIT.

- AI Storyboard Generator: https://github.com/dseditor/AI-storyboard-generator
- Google Flow Scripting Skill: https://github.com/agbelemi/google-flow-scripting-skill

The Flow scripting project is MIT licensed. The storyboard project documents MIT in its README but does not currently expose a LICENSE file on its default branch, so this repository does not copy its source code or workflow JSON assets. The ComfyUI panel, contact-sheet builder, validation rules, and UI are independently implemented, using public workflow ideas and API conventions with attribution.

## License

MIT. See LICENSE.


## Scene revisions, references and portable backups

- Lock a scene to protect its text, references and generated images from edits, deletion and regeneration. Approving a scene also locks it. Unlock it before making further revisions.
- Keep feedback in each scene's review notes and mark it Draft, Needs review or Approved. These are local review states; there is no shared account, real-time collaboration or external approval service.
- Versions are captured before scene edits, regeneration, reorder, deletion and storyboard replacement. Save version creates an explicit checkpoint. Restore version keeps the replaced board in history; unlock all scenes first. The original concept and brief settings are restored with each version. The most recent 30 versions are retained.
- Add scenes, move them up/down or delete unlocked scenes. Scene images use stable scene IDs, so moving a scene does not attach another scene's image to it.
- Create character/background assets in Asset Studio. New assets join the current project's reference set up to four images. Select an asset from another project to create an independent reusable copy. Each scene can use the project reference set, a custom selection, or an explicitly empty reference set. Locks freeze that scene's asset selection.
- Copy/exported Flow prompts include a registry of the scene's linked character/location references. Download and upload those images in Flow and bind the matching handles; text handles alone do not attach files. Reference images help guide consistency but do not guarantee identical generated characters.
- Generate selected or missing prompts in the storyboard. Asset Studio supports selected/missing image generation, pause/resume and per-scene retry. ComfyUI supports selected and missing/failed outputs for the current session. Batch actions skip locked scenes.
- Save production presets and apply them to new topics. A preset contains goal, audience and production settings, excluding topic, images and credentials.
- Backup ZIP includes the current storyboard, concepts, brief references, image assets, version history, review states, locks and presets. Import ZIP validates the archive and restores an independent copy with new project/asset IDs, preserving other projects. Reference handles stay stable across restoration. API keys and ComfyUI connection settings are excluded. ComfyUI video outputs remain remote/session media and must be downloaded separately; they are not included in ZIP backups.
- The ZIP stores portable image data in `project.json`; use Import ZIP to restore it. Downloads and local browser storage are the persistence mechanisms. Clearing browser site data removes projects and images, so keep a ZIP backup when moving browsers.

### Draft protection

Starting a new project or opening another project saves the current draft and its reference images to My projects first. If browser storage fails, the current editor remains open. Opening the currently active saved project keeps its latest edits. Projects are not silently removed when the library exceeds 30 entries. Unlocking an approved scene returns it to Needs review. New briefs start with an empty topic and generic video settings.

### Choose a Gemini model

In Settings, paste your Gemini API key. The app loads Google’s model list and lets you select a Gemini text model from a dropdown; no model ID typing is needed. Refresh models retries discovery. Image, audio, live, and other specialized models are excluded from this storyboard selector. Listing does not guarantee generation quota or structured-output support. Selection is applied only with Save settings. API reference: https://ai.google.dev/api/models

### Automatic concept selection

Use **Auto: topic to storyboard** to generate concepts, ask Gemini to recommend the strongest one for the brief, then build that storyboard without another click. The manual concept-selection path remains available. If the recommendation is invalid or storyboard generation fails, generated concepts remain available for manual retry. Locked scenes cannot be replaced. This feature does not submit videos to Google Flow; browser automation remains unimplemented pending access to a working Flow session.

### Automatic character and background references

Auto: topic to storyboard now continues with a reusable reference plan and image generation using the existing Gemini Nano Banana 2.1 image API integration. It creates character portraits where needed and backgrounds, reuses each asset across its assigned scenes, and binds generated images by stable scene ID. The image API can incur usage charges; Google Flow video generation remains manual.

Existing boards can use Create / retry character & background images. Completed images and the plan are saved incrementally; retry skips completed images, and Stop after current image avoids scheduling more requests. Locked scenes and existing manual reference assignments are preserved. Reference plans survive project ZIP backups and restores. Plans are bounded to twelve assets and three generated references per scene.

Download Flow scene ZIP produces one folder per scene with prompt.txt, voiceover.txt and the linked image files. Incomplete planned images block this export so missing references are not silently omitted. Videos are not generated or included. Image-generation API docs: https://ai.google.dev/gemini-api/docs/image-generation

### Create reference images in Flow

Reference preparation defaults to **Flow: prepare image prompts only**. Auto prepares the storyboard and reusable character/background prompts without image-generation API requests. Expand each reference card to copy its standalone prompt and see its scene assignments, or Download reference prompts as a text pack. Generate the images in Flow and reuse them in the listed video scenes. Gemini API image generation remains an optional selection. Text planning still uses the configured Gemini text API.

### Complete prompt-only Flow workflow

The primary automatic workflow prepares prompts only. User supplies a topic; the app selects a concept, writes the storyboard, plans only needed recurring characters/backgrounds/products, and composes opening-image and video prompts with consistent reference descriptions. Generate all images and videos manually in Flow. Legacy Asset Studio remains an optional tool, separate from this workflow.

References use C01/B01/P01 labels. Scene cards list their required references, opening-image prompt, video prompt and ordered instructions. Scenes with planned references default to opening-image then video; scenes without references default to direct text-to-video. The route can be changed per scene. Reference labels organize the package; users must attach the actual images in Flow.

Download complete prompt ZIP works without any generated images and contains the complete text package, reference prompts, and each scene’s instructions, opening-image prompt, video prompt and voiceover. Flow .txt also exports the complete package. No image-generation API is called by the primary workflow; Gemini text planning still uses API access.


### Manual Flow prompt package

The primary workflow produces prompts, not media. Generate character sheets (four body views and four expressions), background sheets (A front / B right / C reverse / D left), and a single opening image for each scene before animating in Flow. Reference sheets are 16:9; scene images retain the project's aspect ratio. Select 3D animation for the Pixar/Disney-inspired template, or retain another project style.

Each scene has an opening background angle, separate SFX/music directions and an outgoing Cut/Continue choice. Continue instructs the following scene to reuse the actual final frame of the previous clip. Review continuity after reordering scenes. New AI storyboard prompts request timed camera/action/background beats; older untimed prompts receive one full-duration action interval when exported. Review generated timing and supported settings in Flow.

Download complete prompt ZIP includes START-HERE-MM.txt, reusable reference prompts, scene instructions in Burmese, opening-image/video prompts, audio, voiceover and captions. No generated images or videos are included. Existing reference descriptions automatically use the new sheet layout when copied or exported; use Prepare / recheck for missing characters or locations.


### Burmese-first review

New concepts, storyboard descriptions and reference design drafts are requested in Burmese. Edit the draft without API calls, then explicitly select the English translation action. English output is stored separately; editing the draft or its settings disables English copy/download until translated again. Exact spoken dialogue/voiceover and captions remain in their original language. Save/Backup ZIP retains both versions. Existing English projects offer a Burmese-draft conversion action. Initial Burmese drafting does not automatically run the English completeness-repair loop. Translation is one API request and preserves structural IDs, timing, references and locks; failed translation leaves the draft intact.


### Screenplay-first approvals

The primary entry point now requests exactly three complete original Burmese screenplays. Selecting or editing a screenplay does not call an API. Polish creates a proposal; users explicitly accept it or retain the current draft, and can restore the preceding version. Approving the script extracts a character/background/important-prop registry and ordered scene list, without generating scene prompts yet.

Users edit reference designs, scene associations, actions, dialogue and durations, then explicitly approve the inventory. They may translate individual approved reference designs for Flow image generation and attach PNG/JPEG/WebP results (up to 10 MB each) to the corresponding reference. Uploaded pictures are stored locally with the project and included in Backup ZIP. Changing a reference design displays a mismatch warning for an older attached image.

Only approved inventories can generate scene prompts. The app binds the exact approved scene IDs/order, durations, actions, dialogue and reference IDs/designs to the output; unknown or missing scenes are rejected. Script/brief or inventory changes invalidate downstream access until approved/regenerated. English prompt export remains a separate explicit step. All screenplay choices, edit history, approvals and references persist in autosave, My projects and project backups. New projects no longer use automatic concept selection; the legacy editor remains for older projects. Actual model fidelity and generated visuals still require user review.
