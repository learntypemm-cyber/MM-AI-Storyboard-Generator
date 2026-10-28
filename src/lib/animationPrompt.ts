import type { Scene, Storyboard } from "../types";

/**
 * Create a filmable one-clip animation prompt from already approved scene facts.
 * Existing time-coded beats are reused; legacy scenes without beats are divided
 * into opening/action/ending states without inventing new actions or dialogue.
 */
const stamp = (second: number) => String(Math.floor(second / 60)).padStart(2, "0") + ":" + String(second % 60).padStart(2, "0");
const shortStamp = (second: number) => Math.floor(second / 60) + ":" + String(second % 60).padStart(2, "0");

type Beat = { start: number; end: number; description: string };
// Accept ranges both at line starts and inline (AI often returns all three beats on one line).
const marker = /\b(\d{1,2}):([0-5]\d)\s*[-–]\s*(\d{1,2}):([0-5]\d)\b/g;

export function existingTimedBeats(prompt: string, duration: number): Beat[] {
  const matches = Array.from(prompt.matchAll(marker));
  if (matches.length < 2) return [];
  const beats = matches.map((match, index) => {
    const start = Number(match[1]) * 60 + Number(match[2]);
    const end = Number(match[3]) * 60 + Number(match[4]);
    const nextStart = index + 1 < matches.length ? matches[index + 1].index! : prompt.length;
    const description = prompt.slice(match.index! + match[0].length, nextStart)
      .replace(/^\s*[):.\]-]?\s*/, "")
      .split(/\n\s*(?=(?:CAMERA|CHARACTER CONTINUITY|AUDIO|DIALOGUE|ENDING FRAME|LIGHTING|VISUAL DESIGN|LOCATION|NO SUBTITLES):)/i)[0].trim();
    return { start, end, description };
  });
  if (beats[0].start !== 0 || beats[beats.length - 1].end !== duration) return [];
  if (beats.some((beat, i) => beat.end <= beat.start || (i > 0 && beat.start !== beats[i - 1].end) || !beat.description)) return [];
  return beats;
}

function safeBeats(scene: Scene): Beat[] {
  const duration = Math.max(1, Math.round(scene.durationSeconds));
  const source = existingTimedBeats(scene.flowPrompt, duration);
  if (source.length) return source;
  if (duration === 1) return [{ start: 0, end: 1, description: scene.action || scene.openingFrame || scene.visualDescription }];
  if (duration === 2) return [
    { start: 0, end: 1, description: scene.openingFrame || scene.visualDescription },
    { start: 1, end: 2, description: scene.action || scene.finalFrame || scene.visualDescription },
  ];
  const firstEnd = Math.max(1, Math.round(duration * .25));
  const secondEnd = Math.min(duration - 1, Math.max(firstEnd + 1, Math.round(duration * .625)));
  return [
    { start: 0, end: firstEnd, description: scene.openingFrame || scene.visualDescription },
    { start: firstEnd, end: secondEnd, description: scene.action || scene.visualDescription },
    { start: secondEnd, end: duration, description: scene.finalFrame || scene.action || scene.visualDescription },
  ];
}

/** The full custom prompt is never overwritten; callers decide when to opt in. */
export function cinematicAnimationPrompt(scene: Scene, board: Storyboard, options: { language: "en" | "my"; background: string; startFromPrevious?: string; references: string; imageMode: boolean }): string {
  const my = options.language === "my";
  const duration = Math.max(1, Math.round(scene.durationSeconds));
  const previous = options.startFromPrevious?.trim();
  const sceneStart = previous ? (my
    ? "ယခင် clip ၏ တကယ့်နောက်ဆုံး frame ကို စတင်ပုံအဖြစ် သုံးပါ။ အခြား opening still ကို အစားထိုးမသုံးပါနှင့်။"
    : "Use the actual final frame of the preceding clip as the start frame, not a different opening still.")
    : options.imageMode ? (my ? "ပေးထားသော opening frame ကို အသက်သွင်းပါ။" : "Animate the supplied opening frame")
    : (my ? "ဖော်ပြချက်အတိုင်း video ကို တိုက်ရိုက်ဖန်တီးပါ။" : "Generate the scene directly from the description");
  const intro = my
    ? sceneStart + " " + duration + " စက္ကန့်ကြာ ရုပ်ရှင်ဆန်သော video တစ်ခုတည်း ဖန်တီးပါ။"
    : sceneStart + " into a " + duration + "-second cinematic animation. One continuous clip; the time ranges are action beats, not separate edits.";
  const authoredBeats = existingTimedBeats(scene.flowPrompt, duration);
  const beats = (authoredBeats.length ? authoredBeats : safeBeats(scene))
    .map(beat => shortStamp(beat.start) + "–" + shortStamp(beat.end) + "\n" + beat.description).join("\n\n");
  // A malformed legacy timeline must not introduce a second, contradictory set of timings.
  const untimedDirection = authoredBeats.length ? "" : scene.flowPrompt
    .replace(marker, " ").replace(/\s+/g, " ").trim();
  const camera = scene.cameraMovement?.trim() || (my ? "ကင်မရာကို မတုန်မလှုပ် ထားပါ။" : "Keep the camera steady.");
  const continuity = [
    my ? "ဇာတ်ကောင်အမည်၊ မျက်နှာ၊ ကိုယ်ခန္ဓာ၊ ဝတ်စုံနှင့် accessories များကို ပေးထားသော reference နှင့် အတိအကျတူစေပါ။" : "Keep character identity, anatomy, costumes and accessories identical to the attached reference images.",
    ...board.continuityRules,
  ].join(" ");
  const audio = [scene.audioNotes, "SFX: " + (scene.sfx?.trim() || (my ? "သီးခြား SFX မသတ်မှတ်ထားပါ။" : "No additional effects specified.")), "Music: " + (scene.backgroundMusic?.trim() || (my ? "သီးခြားတေးဂီတမသတ်မှတ်ထားပါ။" : "No additional music specified."))].filter(Boolean).join("\n");
  const dialogue = scene.voiceover?.trim() || (my ? "မပါ။" : "None.");
  const ending = scene.finalFrame?.trim() || scene.action?.trim() || (my ? "ဇာတ်ဝင်ခန်းအဆုံးအနေအထားကို ထိန်းပါ။" : "Hold the described final state.");
  return [
    intro,
    "DURATION: " + duration + " seconds",
    scene.openingFrame?.trim() ? "OPENING FRAME:\n" + scene.openingFrame : "",
    beats,
    untimedDirection ? "ADDITIONAL SCENE DETAIL:\n" + untimedDirection : "",
    "CAMERA:\n" + camera + ". " + (my ? "ရိုက်ကွက်: " : "Shot size: ") + scene.shotSize + ". " + (my ? "အဆက်မပြတ် ကင်မရာလှုပ်ရှားမှုတစ်ခုသာ၊ မလိုအပ်သော cut မပါစေရ။" : "Keep one continuous camera move without sudden cuts."),
    "CHARACTER CONTINUITY:\n" + continuity + "\n" + (my ? "Reference များ:" : "References:") + "\n" + options.references,
    (my ? "LOCATION & LOOK:" : "LOCATION & LOOK:") + "\n" + scene.visualDescription + "\n" + options.background + "\n" + board.visualBible + "\n" + (my ? "အလင်း: " : "Lighting: ") + scene.lighting + ". " + (my ? "ခံစားချက်: " : "Mood: ") + scene.mood,
    previous ? (my ? "ယခင် clip ၏ အဆုံးအနေအထား: " : "Incoming state from previous clip: ") + previous : "",
    "AUDIO:\n" + audio,
    "DIALOGUE:\n" + dialogue,
    "ENDING FRAME:\n" + ending,
    scene.onscreenText?.trim() ? (my ? "သတ်မှတ်ထားသော မျက်နှာပြင်စာသားသာ အသုံးပြုပါ: " : "Only render the explicitly requested on-screen text: ") + scene.onscreenText : (my ? "စာတန်းထိုး၊ မျက်နှာပြင်စာသားနှင့် watermark မထည့်ပါနှင့်။" : "No subtitles, on-screen text or watermarks."),
    my ? "ဇာတ်ကောင်အသစ်၊ ပစ္စည်းအသစ်၊ နေရာအသစ် သို့မဟုတ် dialog အသစ် မတီထွင်ပါနှင့်။" : "Do not invent character identities, actions, props, locations or dialogue.",
    [board.globalNegativePrompt, scene.negativePrompt].filter(Boolean).length ? "AVOID: " + [board.globalNegativePrompt, scene.negativePrompt].filter(Boolean).join("; ") : "",
    my ? "အဖွင့်အချိန်မှ အဆုံးအချိန်အထိ လှုပ်ရှားမှုဆက်စပ်မှုရှိပါစေ။" : "Preserve continuous action and the exact starting and ending states.",
  ].filter(Boolean).join("\n\n");
}

export const animationPromptTime = (scene: Scene) => stamp(Math.max(1, Math.round(scene.durationSeconds)));
