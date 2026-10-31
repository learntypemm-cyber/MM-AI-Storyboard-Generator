# Recap Studio (browser pilot)

Story Studio and Recap Studio are separate entries on the home screen. Recap never reads or changes Story projects.

## User flow

1. Open Recap Studio and select an MP4 (up to 10 minutes / 300 MB in this browser pilot).
2. Run browser-side multilingual Whisper with word timestamps or enter the source transcript manually. Word timestamps are grouped into short reviewable narration units. Review and edit source text.
3. Use the existing Gemini API key to build a whole-story memory, translate in batches, and audit each batch for omissions or inconsistent names. Review and edit every Burmese line.
4. Generate Gemini 3.8 Flash TTS WAV clips, preview the combined narration, and download WAV if desired. The same text/voice clip is reused in the current session when other lines change.
5. Export a final MP4 and separate SRT. Fast export copies the video stream and replaces the audio. The optional fit mode proportionally retimes the whole video if Burmese narration is longer, up to 1.5× the original duration.

Source video, Whisper processing, audio composition, and FFmpeg render stay in the browser. Gemini receives source text for translation and Burmese text for TTS. The browser downloads the Whisper model on first use. The FFmpeg WebAssembly core is downloaded on first use. Transcript and translation are autosaved in browser storage; after a refresh the user reselects the same video. Audio clips and an in-progress render are held in memory, so a refresh requires audio generation/render again. Keeping the tab open allows work in other apps, but browser energy saving can slow or pause a background tab.

## Verification and limits

- `npm run typecheck`, `npm run build`, and `npm test` validate code and mocked API behavior.
- A live end-to-end Gemini TTS + Whisper + MP4 run requires a user's API key and a real input video. It has not been verified by automated tests.
- Near-300 MB files can require substantially more than 300 MB of browser memory because FFmpeg loads input and output media into its WebAssembly filesystem. The limit is an acceptance limit, not a performance guarantee.
- SRT is a separate download; captions are not burned into MP4.
- Fit mode adjusts the full video's speed, not individual sentence windows. It is not the original Recap project's Smart Sync algorithm.
- This is an independent implementation inspired by the public workflow of `tharlaimar/recap-en-to-mm`. No source files from that repository are included.
