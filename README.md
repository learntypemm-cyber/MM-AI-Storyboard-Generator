# MM AI Storyboard Generator

MM Storyboard Studio converts a short idea into three creative concepts, a complete scene-by-scene storyboard, and copy-ready Google Flow / Veo prompts. It is designed for LearnTypeMM tutorials, product explainers, Burmese-language educational clips, TikTok, Facebook Reels, YouTube Shorts, and longer YouTube videos.

## What it does

- Generate three genuinely different video concepts from a single brief.
- Build a structured storyboard with scene goals, visual direction, shot size, camera movement, lighting, mood, action, and transition.
- Write English Google Flow prompts, Burmese or bilingual voiceover, and exact captions separately for editing.
- Keep repeated people and places consistent with a visual bible, continuity rules, canonical reference handles, and self-contained prompts.
- Add screenshots or reference images to ground the plan in real product UI.
- Edit and regenerate one scene without rebuilding the whole project.
- Run automated pre-generation checks for missing text policy, vague cross-scene references, opening/final frames, prompt labels, audio direction, and clip duration.
- Copy a single prompt or all prompts and export Markdown, JSON, or a plain-text Google Flow prompt pack with voiceover, captions, and editing notes separated.
- Save and reopen projects in the current browser.
- Generate an exact-count storyboard contact-sheet prompt for visual planning.
- Optionally render individual scenes or a full batch through a user-configured ComfyUI API workflow.
- Preview ComfyUI image/video outputs and merge returned video clips in-browser with FFmpeg.wasm.

## Run locally

Requirements: Node.js 20 or later and a Gemini API key with access to the configured model.

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

To create a production build, run npm run build. To preview the build, run npm run preview.

## API and privacy

The app calls the Gemini generateContent REST API directly from the browser using the API key entered by the user. The key is stored in this browser's localStorage, not committed to this repository. This is suitable for personal/local use, but localStorage is not a secrets vault. Do not publish a shared deployment with a private server key in the frontend. For a public deployment, add an authenticated backend route with quotas, abuse protection, and server-side secret storage.

Uploaded reference images are included only in Gemini requests for the current session. The app deliberately omits reference image data from saved projects to avoid filling browser storage. Saved projects and the API key remain in the current browser; clearing site data removes them.

## Optional ComfyUI generation

This project can queue a user-supplied ComfyUI API-format workflow for one storyboard scene or every scene in sequence. It can collect image/video outputs from ComfyUI history, preview them, download them, and concatenate compatible video clips in the browser using FFmpeg.wasm.

1. Run ComfyUI with the required image/video model and custom nodes installed.
2. Open the workflow in ComfyUI and export it using **Save (API Format)**. The app cannot use a normal UI workflow JSON directly.
3. Expand **Optional: Generate images or videos with ComfyUI**, set the ComfyUI server URL, upload the workflow JSON, and choose the positive prompt node ID and input key.
4. Optionally map the negative prompt node. Confirm your workflow has a Save Image or Save Video output.
5. Test the connection, then render one scene before using **Generate all scenes**.

The workflow is user-supplied and must accept a text prompt in the configured node. The same workflow is used for each scene, so workflows that need different start/end images, custom nodes, or special inputs may require extra configuration in ComfyUI. Generation runs on the ComfyUI server, not Google Flow. Video concatenation works best when clips share compatible codecs, resolution, frame rate, and container format.

The browser connects directly to your ComfyUI URL. Local browser security may block requests unless ComfyUI allows your app origin through CORS. Restrict CORS to the local development origin you trust; do not expose an unauthenticated ComfyUI server or allow every website to control it.

## Google Flow limits

The app prepares prompts; it does not call Google Flow, generate video clips, spend Flow credits, or guarantee that a chosen model/mode combination is supported. Flow model availability, credits, duration, modes, and UI can change. The app gives compatibility warnings based on the current model guide, but verify the active model and settings in Flow before generating.

For accurate LearnTypeMM tutorials, upload current screenshots as references and use real screen recordings for exact interactions. AI video prompts request no generated text by default; add Burmese captions and exact UI labels in a video editor.

## Technology

React, TypeScript, Vite, Lucide React, CSS, and the Gemini generateContent REST API.

## Inspiration

This is an independent implementation. It does not copy code from either inspiration repository.

- AI Storyboard Generator: https://github.com/dseditor/AI-storyboard-generator
- Google Flow Scripting Skill: https://github.com/agbelemi/google-flow-scripting-skill

The Flow scripting project is MIT licensed. The storyboard project documents MIT in its README but does not currently expose a LICENSE file on its default branch, so this repository does not copy its source code or workflow JSON assets. The ComfyUI panel, contact-sheet builder, validation rules, and UI are independently implemented, using public workflow ideas and API conventions with attribution.

## License

MIT. See LICENSE.
