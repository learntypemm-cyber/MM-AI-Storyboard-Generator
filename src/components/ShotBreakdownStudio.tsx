import { useEffect, useState } from "react";
import { ChevronDown, Clapperboard, Copy, Download, RefreshCw, Save, Scissors } from "lucide-react";
import { generateJson } from "../lib/gemini";
import { shotBreakdownOutputSchema, shotBreakdownRequest, shotPackageText, sceneShotsText, shotPromptText, shotImagePromptText, validateShotPrompt, shotReferences, shotNeedsReview, shotSourceSnapshot, translatedShot, shotTranslationRequest, validateShotTranslation } from "../lib/multiShot";
import { downloadText, fileSlug } from "../lib/export";
import type { ImageAsset, Scene, ShotBreakdown, Storyboard, VideoForm } from "../types";

type Props = {
  board: Storyboard;
  form: VideoForm;
  assets: ImageAsset[];
  apiKey: string;
  model: string;
  busy: boolean;
  requireKey: () => boolean;
  onChange: (board: Storyboard) => void;
  onBusy: (value: string | null) => void;
  onError: (message: string) => void;
  onDownloadZip: () => void;
  onSave: () => void;
};

const makeId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);

export default function ShotBreakdownStudio({ board, form, assets, apiKey, model, busy, requireKey, onChange, onBusy, onError, onDownloadZip, onSave }: Props) {
  const [message, setMessage] = useState("");
  const [requestedCount, setRequestedCount] = useState<number | "auto">("auto");
  const [selectedSceneId, setSelectedSceneId] = useState(() => board.scenes[0]?.id || "");
  useEffect(() => {
    if (!board.scenes.some((scene) => scene.id === selectedSceneId)) setSelectedSceneId(board.scenes[0]?.id || "");
  }, [board.scenes, selectedSceneId]);
  const selectedScene = board.scenes.find((scene) => scene.id === selectedSceneId) || board.scenes[0];
  const shotCount = board.scenes.reduce((sum, scene) => sum + (scene.shots?.length || 0), 0);
  const scenesWithShots = board.scenes.filter((scene) => scene.shots?.length).length;
  const shotsApproved = board.scenes.reduce((sum, scene) => sum + (scene.shots || []).filter((shot) => shot.imageApproved && !shotNeedsReview(shot, scene, board, form, assets)).length, 0);
  const staleCount = board.scenes.reduce((sum, scene) => sum + (scene.shots || []).filter(shot => shotNeedsReview(shot, scene, board, form, assets)).length, 0);
  const plannedClipSeconds = board.scenes.reduce((sum, scene) => sum + (scene.shots?.length ? scene.shots.reduce((shotSum, shot) => shotSum + shot.durationSeconds, 0) : scene.durationSeconds), 0);
  const runtimeDelta = plannedClipSeconds - form.targetDuration;

  const updateShots = (sceneId: string, update: (shots: ShotBreakdown[]) => ShotBreakdown[]) => {
    onChange({
      ...board,
      scenes: board.scenes.map((scene) => scene.id === sceneId
        ? { ...scene, shots: update([...(scene.shots || [])]) }
        : scene),
    });
  };

  const generateForScene = async (scene: Scene) => {
    if (busy || !requireKey()) return;
    onBusy("shot-breakdown-" + scene.id);
    onError("");
    setMessage("");
    try {
      const raw = await generateJson<unknown>(
        apiKey.trim(),
        model.trim(),
        shotBreakdownRequest(scene, board, form, assets, requestedCount),
        form.referenceImages,
      );
      const parsed = shotBreakdownOutputSchema.parse(raw);
      if (requestedCount !== "auto" && parsed.shots.length !== requestedCount) throw new Error("Requested shot count was not returned. Existing shots are preserved; retry generation.");
      const shots: ShotBreakdown[] = parsed.shots.map((shot, index) => ({
        ...shot,
        id: makeId(),
        shotNumber: index + 1,
        imageApproved: false,
        promptLanguage: "my",
        durationSeconds: form.clipDuration,
        referenceAssets: shot.referenceAssets,
      }));
      for (const shot of shots) shot.sourceSnapshot = shotSourceSnapshot(shot, { ...scene, shots }, board, form, assets);
      onChange({
        ...board,
        scenes: board.scenes.map((item) => item.id === scene.id ? { ...item, shots } : item),
      });
      setMessage("Scene " + scene.sceneNumber + " အတွက် shot prompt " + shots.length + " ခု ရပါပြီ။ Prompt များကို ပြင်ပြီး copy / ZIP download လုပ်နိုင်ပါတယ်။");
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Shot breakdown မထုတ်နိုင်ပါ။");
    } finally {
      onBusy(null);
    }
  };

  const translateShot = async (scene: Scene, shot: ShotBreakdown) => {
    if (busy || !requireKey()) return;
    onBusy("translate-shot-" + shot.id); onError("");
    try {
      const raw = await generateJson<unknown>(apiKey.trim(), model.trim(), shotTranslationRequest(shot), []);
      const translated = validateShotTranslation(raw, shot);
      updateShots(scene.id, shots => shots.map(item => item.id === shot.id ? translated : item));
      setMessage("English prompt ပြန်ဆိုပြီးပါပြီ။ မူရင်းမြန်မာမူကြမ်းကို ဆက်သိမ်းထားပါတယ်။");
    } catch (caught) { onError(caught instanceof Error ? caught.message : "Translation failed. Your draft is preserved."); }
    finally { onBusy(null); }
  };

  const updateShot = (sceneId: string, shotId: string, patch: Partial<ShotBreakdown>) => {
    const visualFields: Array<keyof ShotBreakdown> = ["title", "purpose", "shotSize", "cameraMovement", "action", "openingFrame", "finalFrame", "imagePrompt", "flowPrompt", "referenceAssets"];
    const changedVisuals = visualFields.some((field) => field in patch);
    updateShots(sceneId, (shots) => shots.map((shot) => shot.id === shotId
      ? { ...shot, ...patch, ...(changedVisuals && !("imageApproved" in patch) ? { imageApproved: false } : {}) }
      : shot));
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(label + " copied.");
    } catch {
      onError("Clipboard သုံးမရပါ။ Download shot prompts (.txt) ကို အသုံးပြုပါ။");
    }
  };

  return <section className="shot-workspace">
    <div className="shot-workspace-header">
      <div className="shot-title-lockup">
        <span className="shot-title-icon"><Clapperboard size={20} /></span>
        <div>
          <div className="shot-eyebrow">STEP 04 · GOOGLE FLOW PREPARATION</div>
          <h2>Shot-by-shot prompts</h2>
          <p>Screenplay scene တစ်ခုစီကို ရိုက်ကွက်အသေးများခွဲပြီး prompt တစ်ခုချင်းစီကို ပြင်၊ copy လုပ်ပါ။ ပုံနှင့် video ကို Google Flow မှာ ကိုယ်တိုင်ထုတ်ပြီး editing မှာ ကိုယ်တိုင်ပေါင်းပါ။</p>
        </div>
      </div>
      <div className="shot-header-stats"><strong>{scenesWithShots}/{board.scenes.length}</strong><span>scenes planned</span><strong>{shotCount}</strong><span>shot prompts</span><strong>{shotsApproved}/{shotCount}</strong><span>stills approved</span></div>
    </div>
    <div className="shot-progress" aria-label="Shot breakdown progress">
      <span style={{ width: (board.scenes.length ? scenesWithShots / board.scenes.length * 100 : 0) + "%" }} />
    </div>
    <div className="shot-workflow-note">
      <Scissors size={17} />
      <div><strong>အသုံးပြုပုံ</strong><p>Scene တစ်ခုအတွက် ၁–၄ shot ရွေးနိုင်ပါတယ်။ Auto က ရိုးရှင်းတဲ့ action ကို shot တစ်ခုတည်းနဲ့ စတင်စီစဉ်ပေးပါမယ်။ မြန်မာ prompt ကို စစ်ပြီးမှ English ပြောင်းပါ။ Shot တစ်ခုစီဟာ သီးခြား Flow clip အတွက်ဖြစ်ပြီး ရွေးထားတဲ့ clip length ကိုသုံးပါတယ်။ နောက်ဆုံး runtime နဲ့ကိုက်ဖို့ clip များကို video editor မှာ ကိုယ်တိုင် trim / arrange လုပ်ပါ။ Shot prompt ထုတ်ခြင်းက image/video မဖန်တီးပါ။</p><div className={runtimeDelta > 0 ? "shot-runtime-estimate warning" : "shot-runtime-estimate"}><strong>Runtime preview</strong><span>{plannedClipSeconds}s footage if you use every planned clip · {form.targetDuration}s final-video target.</span><small>{runtimeDelta > 0 ? "သုံးမည့် shot အားလုံးကို ထုတ်ပါက " + runtimeDelta + "s ခန့်ကို editing မှာ trim လုပ်ရပါမယ်။ Flow credits သက်သာဖို့ တကယ်သုံးမယ့် shot တွေကိုသာ ထုတ်ပါ။" : runtimeDelta < 0 ? "လက်ရှိ plan မှာ target ထက် " + Math.abs(runtimeDelta) + "s နည်းနေပါတယ်။ နောက်ထပ် shot များထည့်ရန် သို့မဟုတ် edit ထဲမှာပဲ လိုသလိုညှိနိုင်ပါတယ်။" : "လက်ရှိ prompt အရ output duration က target နဲ့ကိုက်ညီနေပါတယ်။"}</small></div></div>
    </div>
    <div className="shot-toolbar">
      <label className="field"><span className="field-label">Shots per scene</span><select className="input" aria-label="Shots per scene" value={requestedCount} disabled={busy} onChange={event => setRequestedCount(event.target.value === "auto" ? "auto" : Number(event.target.value))}><option value="auto">Auto · လိုအပ်သလောက် (၁–၄)</option>{[1, 2, 3, 4].map(count => <option key={count} value={count}>{count} shot{count > 1 ? "s" : ""}</option>)}</select></label>
      <button className="secondary-button" disabled={!shotCount} onClick={() => void copyText(shotPackageText(board, form, assets), "All shot prompts")}><Copy size={15} /> Copy all shot prompts</button>
      <button className="secondary-button" disabled={!shotCount} onClick={() => downloadText(fileSlug(board.projectTitle) + "-shot-prompts.txt", shotPackageText(board, form, assets), "text/plain;charset=utf-8")}><Download size={15} /> Download shot TXT</button>
      <button className="secondary-button" disabled={busy} onClick={onDownloadZip}><Download size={15} /> Complete Flow ZIP</button>
      <button className="primary-button" disabled={busy} onClick={onSave}><Save size={15} /> Save project</button>
    </div>
    {staleCount > 0 && <p className="shot-validation warning" role="status">{staleCount} shot(s) ပြန်စစ်ရန်လိုပါတယ်။ မူလ scene / reference / setting ပြောင်းထားခြင်း သို့မဟုတ် အဟောင်း shot ဖြစ်ခြင်းကြောင့်ပါ။ ပြင်ထားတဲ့ prompt တွေ မပျက်ပါ။</p>}
    <div className="shot-workspace-layout">
      <nav className="shot-scene-nav" aria-label="Choose a scene to prepare">
        <div className="shot-scene-nav-heading"><span>YOUR SCENES</span><strong>{board.scenes.length}</strong></div>
        {board.scenes.map((scene) => <button type="button" key={scene.id} className={scene.id === selectedScene?.id ? "shot-scene-nav-item active" : "shot-scene-nav-item"} onClick={() => setSelectedSceneId(scene.id)}>
          <span className="shot-scene-nav-number">{String(scene.sceneNumber).padStart(2, "0")}</span>
          <span className="shot-scene-nav-copy"><strong>{scene.title}</strong><small>{scene.shots?.length ? scene.shots.length + " prompts ready" : "Needs prompts"}</small></span>
          <span className={scene.shots?.length ? "scene-ready-dot ready" : "scene-ready-dot"} aria-label={scene.shots?.length ? "Prompts ready" : "Prompts missing"} />
        </button>)}
      </nav>
      <div className="shot-scene-list">
      {selectedScene && <article className="shot-scene-card" key={selectedScene.id}>
        <div className="shot-scene-heading">
          <div className="shot-scene-meta"><span>SCENE {String(selectedScene.sceneNumber).padStart(2, "0")}</span><span>{selectedScene.durationSeconds}s story beat</span></div>
          <h3>{selectedScene.title}</h3>
          <p>{selectedScene.objective || selectedScene.action || selectedScene.visualDescription}</p>
        </div>
        <div className="shot-scene-actions">
          <span className={selectedScene.shots?.length ? "shot-state ready" : "shot-state"}>{selectedScene.shots?.length ? selectedScene.shots.length + " prompts ready" : "Not broken into shots"}</span>
          <button className="secondary-button" disabled={busy} onClick={() => void generateForScene(selectedScene)}><RefreshCw size={14} />{selectedScene.shots?.length ? "Regenerate shot list" : "Generate shot list"}</button>
        </div>
        {selectedScene.shots?.length ? <details className="shot-list-details" open>
          <summary><ChevronDown size={15} /> Flow prompts · {selectedScene.shots.length} shots</summary>
          <div className="shot-quick-actions" aria-label="Quick copy prompts">
            {selectedScene.shots.map((shot) => { const exportShot = translatedShot(shot) || shot; return <div className="shot-quick-row" key={shot.id}>
              <span><strong>SHOT {String(shot.shotNumber).padStart(2, "0")}</strong><small>{shot.title}</small></span>
              <div><button type="button" className="quiet-button" onClick={() => void copyText(shotImagePromptText(shot, selectedScene, board, form, assets), "Shot " + shot.shotNumber + " opening still prompt")}><Copy size={13} /> Still prompt</button><button type="button" className="secondary-button" onClick={() => void copyText(exportShot.flowPrompt, "Shot " + shot.shotNumber + (exportShot.promptLanguage === "my" ? " Burmese draft" : " Flow prompt"))}><Copy size={13} /> {exportShot.promptLanguage === "my" ? "Copy Burmese draft" : "Copy Flow prompt"}</button></div>
            </div>; })}
          </div>
          <details className="shot-edit-details">
          <summary>View / edit {selectedScene.shots.length} shot prompts</summary>
          <div className="shot-cards">
            {selectedScene.shots.map((shot) => { const stale = shotNeedsReview(shot, selectedScene, board, form, assets); const english = translatedShot(shot); const exportShot = english || shot; const issues = validateShotPrompt(exportShot, form, board, selectedScene, assets); return <details className="shot-card" key={shot.id}>
              <summary><span className="shot-number">{String(shot.shotNumber).padStart(2, "0")}</span><span className="shot-card-title">{shot.title}</span><span className={stale || issues.length || !shot.imageApproved ? "shot-duration warn" : "shot-duration"}>{stale ? "Source changed" : !shot.imageApproved ? "Review still" : issues.length ? issues.length + " checks" : shot.durationSeconds + "s"}</span></summary>
              <fieldset className="shot-fields" disabled={busy}>
                {stale && <div className="shot-validation warning"><strong>Source changed · ပြန်စစ်ရန်</strong><p>Scene၊ character၊ background၊ အသံနဲ့ setting များကို prompt နဲ့တိုက်စစ်ပါ။ လိုအပ်သလို ပြင်ပြီးမှ အတည်ပြုပါ။</p><button type="button" className="secondary-button" onClick={() => updateShot(selectedScene.id, shot.id, { sourceSnapshot: shotSourceSnapshot(shot, selectedScene, board, form, assets), imageApproved: false })}>လက်ရှိ source နဲ့တိုက်စစ်ပြီးပြီ</button></div>}
                <div className="shot-validation"><strong>Flow မှာ ကိုယ်တိုင်ထည့်ရမည့် references</strong><p>နာမည် / @handle ရေးရုံနဲ့ ပုံမချိတ်ပါ။ သက်ဆိုင်ရာ reference ပုံကို Flow မှာ ကိုယ်တိုင်ထည့်ပါ။</p><ul>{shotReferences(shot, selectedScene, board, assets).map(ref => <li key={ref.id}>{ref.title} · {ref.kind} · {ref.asset ? "ပုံရှိပြီး — Flow မှာထည့်ပါ" : "reference prompt နဲ့ Flow မှာပုံအရင်ထုတ်ပါ"}</li>)}</ul>{!shot.referenceAssets.length && <span>ဒီ shot အတွက် reference မရွေးထားပါ။</span>}</div>
                <label className="field"><span className="field-label">Shot title</span><input className="input" value={shot.title} onChange={(event) => updateShot(selectedScene.id, shot.id, { title: event.target.value })} /></label>
                <label className="field"><span className="field-label">Purpose</span><textarea className="input" rows={2} value={shot.purpose} onChange={(event) => updateShot(selectedScene.id, shot.id, { purpose: event.target.value })} /></label>
                <div className="form-grid three-columns">
                  <label className="field"><span className="field-label">Shot size</span><input className="input" value={shot.shotSize} onChange={(event) => updateShot(selectedScene.id, shot.id, { shotSize: event.target.value })} /></label>
                  <label className="field"><span className="field-label">Camera movement</span><input className="input" value={shot.cameraMovement} onChange={(event) => updateShot(selectedScene.id, shot.id, { cameraMovement: event.target.value })} /></label>
                  <label className="field"><span className="field-label">Duration (seconds)</span><input className="input" type="number" min={1} max={600} value={shot.durationSeconds} onChange={(event) => updateShot(selectedScene.id, shot.id, { durationSeconds: Math.max(1, Math.min(600, Number(event.target.value) || 1)) })} /></label>
                </div>
                <label className="field"><span className="field-label">Action</span><textarea className="input" rows={3} value={shot.action} onChange={(event) => updateShot(selectedScene.id, shot.id, { action: event.target.value })} /></label>
                <label className="field"><span className="field-label">Opening frame</span><textarea className="input" rows={2} value={shot.openingFrame} onChange={(event) => updateShot(selectedScene.id, shot.id, { openingFrame: event.target.value })} /></label>
                <label className="field"><span className="field-label">Final frame</span><textarea className="input" rows={2} value={shot.finalFrame} onChange={(event) => updateShot(selectedScene.id, shot.id, { finalFrame: event.target.value })} /></label>
                <label className="field"><span className="field-label">Opening still / storyboard image prompt</span><textarea className="input prompt-editor" rows={6} value={shotImagePromptText(shot, selectedScene, board, form, assets)} onChange={(event) => updateShot(selectedScene.id, shot.id, { imagePrompt: event.target.value })} /></label>
                <button type="button" className="secondary-button shot-copy-still" onClick={() => void copyText(shotImagePromptText(shot, selectedScene, board, form, assets), "Shot " + shot.shotNumber + " opening still prompt")}><Copy size={14} /> Copy opening still prompt</button>
                <label className="shot-approval"><input type="checkbox" disabled={stale} checked={Boolean(shot.imageApproved && !stale)} onChange={(event) => updateShot(selectedScene.id, shot.id, { imageApproved: event.target.checked })} /><span><strong>{shot.imageApproved && !stale ? "Opening still reviewed" : "Opening still not reviewed"}</strong><small>Flow မှာ still ပုံကို ကိုယ်တိုင်ထုတ်ပြီး frame, character နဲ့ location ကို စစ်ပြီးမှ အမှန်ခြစ်ပါ။ Prompt ပြောင်းလျှင် approval ပြန်ပျက်သွားပါမယ်။</small></span></label>
                <label className="field"><span className="field-label">{shot.promptLanguage === "my" ? "Video prompt · မြန်မာမူကြမ်းအပြည့်အစုံ" : "Google Flow video prompt (English)"}</span><textarea className="input prompt-editor" rows={8} value={shot.flowPrompt} onChange={(event) => updateShot(selectedScene.id, shot.id, { flowPrompt: event.target.value })} /></label>
                {shot.promptLanguage === "my" && <div className="shot-validation"><button type="button" className="secondary-button" disabled={stale} onClick={() => void translateShot(selectedScene, shot)}>{english ? "English ပြန်ဆိုရန်" : "မူကြမ်းအတည်ပြုပြီး English ပြောင်းရန်"}</button>{!english && <p>မြန်မာ prompt ကို အရင်ပြင်ပါ။ English ကို ဒီခလုတ်နှိပ်မှသာ ထုတ်ပေးပါမယ်။</p>}{english && <><label className="field"><span className="field-label">English opening still prompt</span><textarea className="input prompt-editor" readOnly rows={5} value={english.imagePrompt} /></label><button type="button" className="quiet-button" onClick={() => void copyText(english.imagePrompt || "", "English still prompt")}>Copy English still prompt</button><label className="field"><span className="field-label">English video prompt</span><textarea className="input prompt-editor" readOnly rows={8} value={english.flowPrompt} /></label></>}</div>}
                <div className={issues.length ? "shot-validation warning" : "shot-validation valid"}><strong>{issues.length ? issues.length + " pre-generation check(s) to review" : "Pre-generation checks passed"}</strong>{issues.length > 0 && <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div>
                <details className="field shot-extra-fields"><summary>Audio, references & negative prompt</summary>
                  <label className="field"><span className="field-label">Reference names</span><textarea className="input" rows={2} value={shot.referenceAssets.join("\n")} onChange={(event) => updateShot(selectedScene.id, shot.id, { referenceAssets: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} /></label>
                  <label className="field"><span className="field-label">Negative prompt</span><textarea className="input" rows={2} value={shot.negativePrompt} onChange={(event) => updateShot(selectedScene.id, shot.id, { negativePrompt: event.target.value })} /></label>
                  <div className="form-grid three-columns">
                    <label className="field"><span className="field-label">Voiceover</span><textarea className="input" rows={2} value={shot.voiceover} onChange={(event) => updateShot(selectedScene.id, shot.id, { voiceover: event.target.value })} /></label>
                    <label className="field"><span className="field-label">SFX</span><textarea className="input" rows={2} value={shot.sfx} onChange={(event) => updateShot(selectedScene.id, shot.id, { sfx: event.target.value })} /></label>
                    <label className="field"><span className="field-label">Background music</span><textarea className="input" rows={2} value={shot.backgroundMusic} onChange={(event) => updateShot(selectedScene.id, shot.id, { backgroundMusic: event.target.value })} /></label>
                  </div>
                  <label className="field"><span className="field-label">Audio direction</span><textarea className="input" rows={2} value={shot.audioNotes} onChange={(event) => updateShot(selectedScene.id, shot.id, { audioNotes: event.target.value })} /></label>
                </details>
                <div className="shot-card-actions">
                  <button type="button" className="secondary-button" onClick={() => void copyText(shotPromptText(shot, selectedScene, board, form, assets), "Shot " + shot.shotNumber + " prompt")}><Copy size={14} /> Copy full shot prompt</button>
                  <button type="button" className="quiet-button" onClick={() => void copyText(exportShot.flowPrompt, "Shot " + shot.shotNumber + (exportShot.promptLanguage === "my" ? " Burmese draft" : " Flow prompt"))}><Copy size={14} /> {exportShot.promptLanguage === "my" ? "Copy Burmese draft" : "Copy Flow prompt only"}</button>
                </div>
                {(!shot.imageApproved || stale) && <p className="field-hint">Copy လုပ်နိုင်ပါတယ်။ Video မထုတ်မီ opening still နဲ့ reference တွေကို ကိုယ်တိုင်စစ်ပါ။</p>}
              </fieldset>
            </details>; })}
          </div>
          </details>
          <div className="shot-list-actions"><button className="quiet-button" onClick={() => void copyText(sceneShotsText(selectedScene, board, form, assets), "Scene " + selectedScene.sceneNumber + " prompts")}><Copy size={14} /> Copy this scene's shots</button></div>
        </details> : <p className="shot-empty">Shot list မရှိသေးပါ။ Shot အရေအတွက်ရွေးပြီး Generate shot list ကိုနှိပ်ပါ။ မြန်မာမူကြမ်းကို အရင်စစ်နိုင်ပါတယ်။</p>}
      </article>}
      </div>
    </div>
    {message && <p className="shot-status" role="status">{message}</p>}
  </section>;
}
