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

## Run locally

Requirements: Node.js 20 or later and a Gemini API key with access to the configured model.

1. Install dependencies with npm install.
2. Start the development server with npm run dev.
3. Open the local address printed by Vite.
4. Open Settings and add your Gemini API key.
5. Enter a topic, choose a visual style, and press Generate 3 concepts.
6. Select a concept and choose Build this storyboard.
7. Copy each scene prompt into Google Flow, generate clips there, and edit Burmese captions and any true website screen recording into the final video.

To create a production build, run npm run build. To preview the build, run npm run preview.

## API and privacy

The app calls the Gemini generateContent REST API directly from the browser using the API key entered by the user. The key is stored in this browser's localStorage, not committed to this repository. This is suitable for personal/local use, but localStorage is not a secrets vault. Do not publish a shared deployment with a private server key in the frontend. For a public deployment, add an authenticated backend route with quotas, abuse protection, and server-side secret storage.

Uploaded reference images are included only in Gemini requests for the current session. The app deliberately omits reference image data from saved projects to avoid filling browser storage. Saved projects and the API key remain in the current browser; clearing site data removes them.

## Google Flow limits

The app prepares prompts; it does not call Google Flow, generate video clips, spend Flow credits, or guarantee that a chosen model/mode combination is supported. Flow model availability, credits, duration, modes, and UI can change. The app gives compatibility warnings based on the current model guide, but verify the active model and settings in Flow before generating.

For accurate LearnTypeMM tutorials, upload current screenshots as references and use real screen recordings for exact interactions. AI video prompts request no generated text by default; add Burmese captions and exact UI labels in a video editor.

## Technology

React, TypeScript, Vite, Lucide React, CSS, and the Gemini generateContent REST API.

## Inspiration

This is an independent implementation. It does not copy code from either inspiration repository.

- AI Storyboard Generator: https://github.com/dseditor/AI-storyboard-generator
- Google Flow Scripting Skill: https://github.com/agbelemi/google-flow-scripting-skill

The Flow scripting project is MIT licensed. This repository contains its own implementation and only adopts general workflow ideas such as self-contained scene prompts, explicit production profiles, reference consistency, and pre-generation review.

## License

MIT. See LICENSE.
