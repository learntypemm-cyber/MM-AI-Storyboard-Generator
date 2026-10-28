import { referencePromptMM, referencePromptSource, sceneImagePromptMM, sceneVideoPromptMM, scenePromptSource, fullPromptsReady } from "../lib/fullPrompts";
import { useState } from "react";
import type { Scene, Storyboard, VideoForm } from "../types";
import { translatedBoard } from "../lib/draftTranslation";
import { completePromptText, completePromptTextMyanmar, completePromptTextBilingual, promptPackageZip } from "../lib/promptPackage";
import { downloadText, fileSlug } from "../lib/export";

type Props = { referencesLocked?: boolean; board: Storyboard; form: VideoForm; busy: boolean; onChange: (board: Storyboard) => void; onTranslate: () => void; onSave: () => void; onRetryReferences: () => void };
const sceneFields: Array<[keyof Scene, string]> = [["title", "Scene ခေါင်းစဉ်"], ["objective", "ရည်ရွယ်ချက်"], ["visualDescription", "နေရာနှင့် မြင်ကွင်း"], ["action", "ဇာတ်ကောင် လှုပ်ရှားမှု"], ["shotSize", "ရိုက်ကွက် အရွယ်အစား"], ["cameraMovement", "Camera လှုပ်ရှားမှု"], ["lighting", "အလင်း"], ["mood", "ခံစားချက်"], ["flowPrompt", "မြန်မာ video prompt"], ["openingFrame", "အစပုံ"], ["finalFrame", "အဆုံးပုံ"], ["sfx", "အသံအကျိုးသက်ရောက်မှု"], ["backgroundMusic", "နောက်ခံတေးဂီတ"], ["audioNotes", "အသံညွှန်ကြားချက်"], ["voiceover", "ပြောစကား / Voiceover"], ["onscreenText", "Caption"], ["negativePrompt", "မပါစေလိုသည့်အရာများ"]];
export default function BurmeseDraftEditor({ referencesLocked = false, board, form, busy, onChange, onTranslate, onSave, onRetryReferences }: Props) {
  const [message, setMessage] = useState("");
  const [workspace, setWorkspace] = useState<"scenes" | "assets" | "project" | "export">("scenes");
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"story" | "visual" | "sound" | "prompts">("story");
  const [referenceId, setReferenceId] = useState<string | null>(null);
  const activeScene = board.scenes.find(s => s.id === sceneId) || board.scenes[0];
  const activeReference = board.referencePlan?.find(r => r.id === referenceId) || board.referencePlan?.[0];
  const english = translatedBoard(board, form);
  const ready = fullPromptsReady(board, form);
  const updateScene = (id: string, patch: Partial<Scene>) => onChange({ ...board, scenes: board.scenes.map(scene => scene.id === id ? { ...scene, ...patch } : scene) });
  const copy = async () => { if (!english) return; try { await navigator.clipboard.writeText(completePromptText(english, form)); setMessage("English prompts copied."); } catch { setMessage("Copy မရပါ။ TXT download ကိုသုံးပါ။"); } };
  const downloadBilingual = () => {
    if (!english) return;
    const content = completePromptTextBilingual(board, form, english);
    downloadText(fileSlug(board.projectTitle) + "-burmese-english-prompts.txt", content, "text/plain;charset=utf-8");
    setMessage("မြန်မာနှင့် English prompt နှစ်မျိုးစလုံးကို သိမ်းပြီးပါပြီ။");
  };
  const zip = async () => {
    if (!english) return;
    try { const blob = await promptPackageZip(english, form); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileSlug(board.projectTitle) + "-english-prompts.zip"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setMessage("ZIP download မအောင်မြင်ပါ။ ပြန်ကြိုးစားပါ။"); }
  };
  return <section className="storyboard-section">
    <h2>၁။ မြန်မာမူကြမ်း စစ်ပြီးပြင်ပါ</h2>
    <p>ဇာတ်ကောင်၊ နေရာ၊ လှုပ်ရှားမှုနှင့် camera ကို ပြင်ပြီးမှ English ပြောင်းပါ။ Edit လုပ်ရုံနဲ့ API မခေါ်ပါ။</p>
    <div className="workflow-toolbar"><button className="primary-button" disabled={busy} onClick={onSave}>Save project</button><button className="secondary-button" disabled={busy || referencesLocked} onClick={onRetryReferences}>ပျောက်နေသော reference မူကြမ်းများ ဖြည့်ရန်</button></div>
    <nav className="v2-tabs" aria-label="Draft editor workspace">
      {([["scenes","Scenes"],["assets","Reference library"],["project","Project bible"],["export","Translate & export"]] as const).map(([id,label]) =>
        <button key={id} type="button" className={workspace === id ? "active" : ""} onClick={()=>setWorkspace(id)}>{label}</button>)}
    </nav>
    {workspace === "project" && <fieldset className="scene-fieldset" disabled={busy}>
      {([['projectTitle', 'Project နာမည်'], ['logline', 'ဇာတ်လမ်းအကျဉ်း'], ['visualBible', 'ပုံစံနှင့်အရောင်'], ['globalNegativePrompt', 'တစ်ခုလုံးတွင် မပါစေလိုသည့်အရာများ']] as const).map(([key, label]) => <label className="field" key={key}>{label}<textarea className="input" value={board[key]} onChange={e => onChange({ ...board, [key]: e.target.value })} /></label>)}
      <label className="field">ဆက်စပ်မှုစည်းမျဉ်းများ (တစ်ကြောင်းတစ်ခု)<textarea className="input" value={board.continuityRules.join("\n")} onChange={e => onChange({ ...board, continuityRules: e.target.value.split("\n") })} /></label>
    </fieldset>}
    {workspace === "assets" && <div className="v2-assets-workspace">
      <h3>Character / Background / Prop မူကြမ်းများ</h3>{referencesLocked && <p>Reference ပြင်ရန် အပေါ်က Character / Background အဆင့်ကို ပြန်သွားပြီး အတည်ပြုပါ။</p>}
    {!board.referencePlan?.length && <p>Reference မူကြမ်း မရှိသေးပါ။ လိုအပ်လျှင် အပေါ်က ဖြည့်ရန်ခလုတ်ကိုသုံးပါ။</p>}
    <nav className="v2-assets-list" aria-label="Choose reference">{board.referencePlan?.map(ref =>
       <button key={ref.id} type="button" className={activeReference?.id === ref.id ? "active" : ""} onClick={()=>setReferenceId(ref.id)}><strong>{ref.title}</strong><small>{ref.kind}</small></button>)}</nav>
    {activeReference && [activeReference].map(ref => <fieldset className="scene-fieldset v2-asset-editor" key={ref.id} disabled={busy || referencesLocked || board.scenes.some(s => s.locked && ref.sceneIds.includes(s.id))}>
      <label className="field">{ref.kind} နာမည်<input className="input" value={ref.title} onChange={e => onChange({ ...board, referencePlan: board.referencePlan!.map(r => r.id === ref.id ? { ...r, title: e.target.value } : r) })} /></label>
      <label className="field">{ref.title} ပုံထုတ်ရန် မြန်မာမူကြမ်း<textarea className="input" aria-label={"Reference image prompt: " + ref.title} rows={6} value={ref.prompt} onChange={e => onChange({ ...board, referencePlan: board.referencePlan!.map(r => r.id === ref.id ? { ...r, prompt: e.target.value } : r) })} /></label>
      <label className="field">Reference prompt အပြည့်အစုံ<textarea className="input" rows={12} value={ref.fullPrompt ?? referencePromptMM(ref, form)} onChange={e => onChange({ ...board, referencePlan: board.referencePlan!.map(r => r.id === ref.id ? { ...r, fullPrompt: e.target.value, fullPromptSource: r.fullPromptSource ?? referencePromptSource(r, form) } : r) })} /></label>
      {ref.fullPrompt !== undefined && ref.fullPromptSource !== referencePromptSource(ref, form) && <p role="alert">ဖော်ပြချက်ပြောင်းထားပါတယ်။ အောက်က prompt ကို ပြန်စစ်ပါ။</p>}
      <button className="secondary-button" onClick={() => onChange({ ...board, referencePlan: board.referencePlan!.map(r => r.id === ref.id ? { ...r, fullPromptSource: referencePromptSource(r, form) } : r) })}>Reference prompt စစ်ပြီးပြီ</button>
      <button className="secondary-button" onClick={() => onChange({ ...board, referencePlan: board.referencePlan!.map(r => r.id === ref.id ? { ...r, fullPrompt: undefined, fullPromptSource: undefined } : r) })}>Reference prompt ကို ဖော်ပြချက်မှ ပြန်စီမယ်</button>
      <p>သုံးမည့် Scene: {board.scenes.filter(s => ref.sceneIds.includes(s.id)).map(s => s.sceneNumber).join(", ")}</p>
    </fieldset>)}</div>}
    {workspace === "scenes" && activeScene && <div className="v2-focused-scene">
      <nav className="v2-scene-list" aria-label="Choose scene">
      {board.scenes.map(scene => <button type="button" key={scene.id} className={activeScene.id === scene.id ? "active" : ""} onClick={() => setSceneId(scene.id)}><small>SCENE {String(scene.sceneNumber).padStart(2,"0")}</small><strong>{scene.title}</strong><span>{scene.durationSeconds}s</span></button>)}
      </nav>
      {[activeScene].map(scene => <article className="scene-card v2-scene-editor" key={scene.id}>
      <h3>Scene {scene.sceneNumber} · {scene.title}</h3>
      <button className="secondary-button" disabled={busy} onClick={() => updateScene(scene.id, { locked: !scene.locked })}>{scene.locked ? "Unlock scene" : "Lock scene"}</button>
      <nav className="v2-tabs v2-detail-tabs" aria-label="Scene fields">
      {([["story","Story"],["visual","Visual & camera"],["sound","Sound"],["prompts","Full prompts"]] as const).map(([id,label]) =>
        <button type="button" key={id} className={detailTab === id ? "active" : ""} onClick={()=>setDetailTab(id)}>{label}</button>)}
      </nav>
      <fieldset className="scene-content scene-fieldset" disabled={busy || scene.locked}>
        {sceneFields.filter(([key]) => detailTab === "story" ? ["title","objective","visualDescription","action","flowPrompt"].includes(key) :
          detailTab === "visual" ? ["shotSize","cameraMovement","lighting","mood","openingFrame","finalFrame","negativePrompt"].includes(key) :
          detailTab === "sound" ? ["sfx","backgroundMusic","audioNotes","voiceover","onscreenText"].includes(key) : false).map(([key, label]) => <label className="field" key={key}>{label}<textarea className="input" aria-label={key === "title" ? "Scene title" : undefined} rows={key === "flowPrompt" ? 8 : 3} value={String(scene[key] ?? "")} onChange={e => updateScene(scene.id, { [key]: e.target.value })} /></label>)}
        {detailTab === "prompts" && <><p>အောက်က prompt အပြည့်အစုံကိုသာ English ပြောင်းပြီး Flow အတွက်သုံးပါမယ်။ အပေါ်ကအသေးစိတ်ကို ပြောင်းလျှင် စစ်ပြီးပြီနှိပ်ပါ သို့မဟုတ် ပြန်စီပါ။</p>
        {([['fullImagePrompt', 'Scene image prompt အပြည့်အစုံ'], ['fullVideoPrompt', 'Video prompt အပြည့်အစုံ']] as const).map(([key, label]) => <label className="field" key={key}>{label}<textarea className="input" rows={14} value={scene[key] ?? (key === 'fullImagePrompt' ? sceneImagePromptMM(scene, board, form) : sceneVideoPromptMM(scene, board, form))} onChange={e => updateScene(scene.id, { fullImagePrompt: scene.fullImagePrompt ?? sceneImagePromptMM(scene, board, form), fullVideoPrompt: scene.fullVideoPrompt ?? sceneVideoPromptMM(scene, board, form), fullPromptSource: scene.fullPromptSource ?? scenePromptSource(scene, board, form), [key]: e.target.value })} /></label>)}
        {(scene.fullImagePrompt !== undefined || scene.fullVideoPrompt !== undefined) && scene.fullPromptSource !== scenePromptSource(scene, board, form) && <p role="alert">Scene အသေးစိတ်ပြောင်းထားပါတယ်။ ပြင်ထားသော prompt များကို ပြန်စစ်ပါ။</p>}
        <button className="secondary-button" onClick={() => updateScene(scene.id, { fullPromptSource: scenePromptSource(scene, board, form) })}>Scene prompt စစ်ပြီးပြီ</button>
        <button className="secondary-button" onClick={() => updateScene(scene.id, { fullImagePrompt: undefined, fullVideoPrompt: undefined, fullPromptSource: undefined })}>Scene prompts ကို အသေးစိတ်မှ ပြန်စီမယ်</button>
        </>}
        <label className="field">Duration (seconds)<input className="input" type="number" min={1} max={600} value={scene.durationSeconds} onChange={e => updateScene(scene.id, { durationSeconds: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })} /></label>
        <label className="field">Background မြင်ကွင်း<select className="input" value={scene.backgroundAngle || "A"} onChange={e => updateScene(scene.id, { backgroundAngle: e.target.value as Scene["backgroundAngle"] })}>{['A', 'B', 'C', 'D'].map(a => <option key={a}>{a}</option>)}</select></label>
        <label className="field">နောက် Scene နှင့်ဆက်ရန်<select className="input" value={scene.handoff} onChange={e => updateScene(scene.id, { handoff: e.target.value as Scene["handoff"] })}><option value="CUT">Cut</option><option value="CONTINUATION">Continue from final frame</option></select></label>
      </fieldset>
    </article>)}</div>}
    {workspace === "export" && <div className="v2-export-workspace">
    <h2>၂။ စိတ်ကြိုက်ဖြစ်မှ English ပြောင်းပါ</h2>
    {!ready && <p role="alert">ပြင်ထားသော prompt အပြည့်အစုံကို ပြန်စစ်ပြီး အတည်ပြုပါ။ စာသားအလွတ် မဖြစ်ရပါ။</p>}
    <p role="status">{english ? "English prompt အသင့်ဖြစ်ပါပြီ။" : board.englishJson ? "မူကြမ်းပြင်ထားပါတယ်။ English ပြန်ပြောင်းရန်လိုသည်။" : "English မပြောင်းရသေးပါ။"}</p>
    <button className="primary-button" disabled={busy || Boolean(english) || !ready} onClick={onTranslate}>{busy ? "လုပ်ဆောင်နေပါတယ်…" : "English prompt ပြောင်းမယ်"}</button>
    <div className="workflow-toolbar">
      <button className="secondary-button" disabled={busy || !english} onClick={() => void copy()}>Copy English prompts</button>
      <button className="secondary-button" disabled={busy || !english} onClick={() => english && downloadText(fileSlug(board.projectTitle) + "-english-prompts.txt", completePromptText(english, form), "text/plain;charset=utf-8")}>Download English TXT</button>
      <button className="secondary-button" disabled={busy || !english} onClick={() => void zip()}>Download English ZIP</button><button className="secondary-button" disabled={busy || !english} onClick={downloadBilingual}>Download Burmese + English TXT</button>
    </div>
    {message && <p role="status">{message}</p>}
    {english && <><details className="field"><summary>မြန်မာ prompt အပြည့်အစုံကြည့်ရန်</summary><textarea className="input" readOnly rows={18} value={completePromptTextMyanmar(board, form)} /></details><details className="field"><summary>English prompt အပြည့်အစုံကြည့်ရန်</summary><textarea className="input" readOnly rows={18} value={completePromptText(english, form)} /></details></>}</div>}
  </section>;
}
