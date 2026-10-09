# MM AI Storyboard Generator

An open-source React + TypeScript studio for turning a topic into video concepts, scene-by-scene storyboards, and ready-to-copy Google Flow / Veo prompts.

## Features

- Generate three distinct video concepts from one topic.
- Generate a detailed storyboard with scene timing, English video prompts, Burmese voiceover, captions, camera direction, audio notes, and continuity guidance.
- Edit and regenerate individual scenes.
- Copy individual prompts or export Markdown, text, and JSON.
- Save projects locally in the current browser.
- Add a Gemini API key in Settings. Keys are stored only in this browser's local storage.
- No direct Google Flow integration is claimed; prompts are prepared for you to paste into Flow.

## Quick start

Requirements: Node.js 20 or later and a Google Gemini API key.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, click Settings, add your Gemini API key, and generate a concept.

Build for production:

```bash
npm run build
npm run preview
```

## Important notes

- This app calls the Gemini API directly from your browser with the API key you provide. Use a personal development key, do not publish your key, and remember that browser storage is not a secrets vault.
- For production or shared deployment, put Gemini calls behind a server-side API route and apply authentication, quotas, and rate limiting.
- Google Flow models, generation modes, durations, and availability can change. Verify the options in your current Flow interface before generating.
- Upload reference screenshots of LearnTypeMM when you need accurate website UI. The generated video prompts explicitly avoid asking video models to draw exact Burmese captions or imitate unseen UI.

## Inspiration and acknowledgements

This project is an independent implementation inspired by common storyboard-generation workflows and Google Flow prompt-engineering practices. It does not copy code from the repositories below.

- [AI Storyboard Generator](https://github.com/dseditor/AI-storyboard-generator) - storyboard and scene workflow inspiration.
- [Google Flow Scripting Skill](https://github.com/agbelemi/google-flow-scripting-skill) - reference-asset continuity, self-contained scene prompts, storyboard approval, and pre-generation audit ideas. That project is MIT licensed; its source code and complete skill are not bundled here.

## License

MIT. See [LICENSE](LICENSE).
