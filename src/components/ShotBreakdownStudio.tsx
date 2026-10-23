import { useState } from "react";
import { ChevronDown, Clapperboard, Copy, Download, RefreshCw, Save, Scissors } from "lucide-react";
import { generateJson } from "../lib/gemini";
import { shotBreakdownOutputSchema, shotBreakdownRequest, shotPackageText, sceneShotsText, shotPromptText, shotImagePromptText, validateShotPrompt } from "../lib/multiShot";
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
  const shotCount = board.scenes.reduce((sum, scene) => sum + (scene.shots?.length || 0), 0);
  const scenesWithShots = board.scenes.filter((scene) => scene.shots?.length).length;
  const shotsApproved = board.scenes.reduce((sum, scene) => sum + (scene.shots || []).filter((shot) => shot.imageApproved).length, 0);
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
    if (busy || scene.locked || !requireKey()) return;
    onBusy("shot-breakdown-" + scene.id);
    onError("");
    setMessage("");
    try {
      const raw = await generateJson<unknown>(
        apiKey.trim(),
        model.trim(),
        shotBreakdownRequest(scene, board, form, assets),
        form.referenceImages,
      );
      const parsed = shotBreakdownOutputSchema.parse(raw);
      const shots: ShotBreakdown[] = parsed.shots.map((shot, index) => ({
        ...shot,
        id: makeId(),
        shotNumber: index + 1,
        imageApproved: false,
        durationSeconds: form.clipDuration,
        referenceAssets: shot.referenceAssets.length ? shot.referenceAssets : scene.referenceAssets,
      }));
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
      <div><strong>အသုံးပြုပုံ</strong><p>Scene တစ်ခုအတွက် ၂–၄ shot prompt ထုတ်ပေးပါမယ်။ Shot တစ်ခုစီဟာ သီးခြား Flow clip အတွက်ဖြစ်ပြီး ရွေးထားတဲ့ clip length ကိုသုံးပါတယ်။ နောက်ဆုံး runtime နဲ့ကိုက်ဖို့ clip များကို video editor မှာ ကိုယ်တိုင် trim / arrange လုပ်ပါ။ Shot prompt ထုတ်ခြင်းက image/video မဖန်တီးပါ။</p><div className={runtimeDelta > 0 ? "shot-runtime-estimate warning" : "shot-runtime-estimate"}><strong>Runtime preview</strong><span>{plannedClipSeconds}s footage if you use every planned clip · {form.targetDuration}s final-video target.</span><small>{runtimeDelta > 0 ? "သုံးမည့် shot အားလုံးကို ထုတ်ပါက " + runtimeDelta + "s ခန့်ကို editing မှာ trim လုပ်ရပါမယ်။ Flow credits သက်သာဖို့ တကယ်သုံးမယ့် shot တွေကိုသာ ထုတ်ပါ။" : runtimeDelta < 0 ? "လက်ရှိ plan မှာ target ထက် " + Math.abs(runtimeDelta) + "s နည်းနေပါတယ်။ နောက်ထပ် shot များထည့်ရန် သို့မဟုတ် edit ထဲမှာပဲ လိုသလိုညှိနိုင်ပါတယ်။" : "လက်ရှိ prompt အရ output duration က target နဲ့ကိုက်ညီနေပါတယ်။"}</small></div></div>
    </div>
    <div className="shot-toolbar">
      <button className="secondary-button" disabled={!shotCount} onClick={() => void copyText(shotPackageText(board, form, assets), "All shot prompts")}><Copy size={15} /> Copy all shot prompts</button>
      <button className="secondary-button" disabled={!shotCount} onClick={() => downloadText(fileSlug(board.projectTitle) + "-shot-prompts.txt", shotPackageText(board, form, assets), "text/plain;charset=utf-8")}><Download size={15} /> Download shot TXT</button>
      <button className="secondary-button" disabled={busy} onClick={onDownloadZip}><Download size={15} /> Complete Flow ZIP</button>
      <button className="primary-button" disabled={busy} onClick={onSave}><Save size={15} /> Save project</button>
    </div>
    <div className="shot-scene-list">
      {board.scenes.map((scene) => <article className="shot-scene-card" key={scene.id}>
        <div className="shot-scene-heading">
          <div className="shot-scene-meta"><span>SCENE {String(scene.sceneNumber).padStart(2, "0")}</span><span>{scene.durationSeconds}s story beat</span></div>
          <h3>{scene.title}</h3>
          <p>{scene.objective || scene.action || scene.visualDescription}</p>
        </div>
        <div className="shot-scene-actions">
          <span className={scene.shots?.length ? "shot-state ready" : "shot-state"}>{scene.shots?.length ? scene.shots.length + " prompts ready" : "Not broken into shots"}</span>
          <button className="secondary-button" disabled={busy || scene.locked} onClick={() => void generateForScene(scene)}><RefreshCw size={14} />{scene.shots?.length ? "Regenerate shot list" : "Generate shot list"}</button>
        </div>
        {scene.shots?.length ? <details className="shot-list-details">
          <summary><ChevronDown size={15} /> View / edit {scene.shots.length} shot prompts</summary>
          <div className="shot-cards">
            {scene.shots.map((shot) => { const issues = validateShotPrompt(shot, form, board, scene, assets); return <details className="shot-card" key={shot.id}>
              <summary><span className="shot-number">{String(shot.shotNumber).padStart(2, "0")}</span><span className="shot-card-title">{shot.title}</span><span className={issues.length || !shot.imageApproved ? "shot-duration warn" : "shot-duration"}>{!shot.imageApproved ? "Review still" : issues.length ? issues.length + " checks" : shot.durationSeconds + "s"}</span></summary>
              <fieldset className="shot-fields" disabled={busy}>
                <label className="field"><span className="field-label">Shot title</span><input className="input" value={shot.title} onChange={(event) => updateShot(scene.id, shot.id, { title: event.target.value })} /></label>
                <label className="field"><span className="field-label">Purpose</span><textarea className="input" rows={2} value={shot.purpose} onChange={(event) => updateShot(scene.id, shot.id, { purpose: event.target.value })} /></label>
                <div className="form-grid three-columns">
                  <label className="field"><span className="field-label">Shot size</span><input className="input" value={shot.shotSize} onChange={(event) => updateShot(scene.id, shot.id, { shotSize: event.target.value })} /></label>
                  <label className="field"><span className="field-label">Camera movement</span><input className="input" value={shot.cameraMovement} onChange={(event) => updateShot(scene.id, shot.id, { cameraMovement: event.target.value })} /></label>
                  <label className="field"><span className="field-label">Duration (seconds)</span><input className="input" type="number" min={1} max={600} value={shot.durationSeconds} onChange={(event) => updateShot(scene.id, shot.id, { durationSeconds: Math.max(1, Math.min(600, Number(event.target.value) || 1)) })} /></label>
                </div>
                <label className="field"><span className="field-label">Action</span><textarea className="input" rows={3} value={shot.action} onChange={(event) => updateShot(scene.id, shot.id, { action: event.target.value })} /></label>
                <label className="field"><span className="field-label">Opening frame</span><textarea className="input" rows={2} value={shot.openingFrame} onChange={(event) => updateShot(scene.id, shot.id, { openingFrame: event.target.value })} /></label>
                <label className="field"><span className="field-label">Final frame</span><textarea className="input" rows={2} value={shot.finalFrame} onChange={(event) => updateShot(scene.id, shot.id, { finalFrame: event.target.value })} /></label>
                <label className="field"><span className="field-label">Opening still / storyboard image prompt</span><textarea className="input prompt-editor" rows={6} value={shotImagePromptText(shot, scene, board, form, assets)} onChange={(event) => updateShot(scene.id, shot.id, { imagePrompt: event.target.value })} /></label>
                <button type="button" className="secondary-button shot-copy-still" onClick={() => void copyText(shotImagePromptText(shot, scene, board, form, assets), "Shot " + shot.shotNumber + " opening still prompt")}><Copy size={14} /> Copy opening still prompt</button>
                <label className="shot-approval"><input type="checkbox" checked={Boolean(shot.imageApproved)} onChange={(event) => updateShot(scene.id, shot.id, { imageApproved: event.target.checked })} /><span><strong>{shot.imageApproved ? "Opening still reviewed" : "Opening still not reviewed"}</strong><small>Flow မှာ still ပုံကို ကိုယ်တိုင်ထုတ်ပြီး frame, character နဲ့ location ကို စစ်ပြီးမှ အမှန်ခြစ်ပါ။ Prompt ပြောင်းလျှင် approval ပြန်ပျက်သွားပါမယ်။</small></span></label>
                <label className="field"><span className="field-label">Google Flow video prompt (English)</span><textarea className="input prompt-editor" rows={8} value={shot.flowPrompt} onChange={(event) => updateShot(scene.id, shot.id, { flowPrompt: event.target.value })} /></label>
                <div className={issues.length ? "shot-validation warning" : "shot-validation valid"}><strong>{issues.length ? issues.length + " pre-generation check(s) to review" : "Pre-generation checks passed"}</strong>{issues.length > 0 && <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}</div>
                <details className="field shot-extra-fields"><summary>Audio, references & negative prompt</summary>
                  <label className="field"><span className="field-label">Reference names</span><textarea className="input" rows={2} value={shot.referenceAssets.join("\n")} onChange={(event) => updateShot(scene.id, shot.id, { referenceAssets: event.target.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean) })} /></label>
                  <label className="field"><span className="field-label">Negative prompt</span><textarea className="input" rows={2} value={shot.negativePrompt} onChange={(event) => updateShot(scene.id, shot.id, { negativePrompt: event.target.value })} /></label>
                  <div className="form-grid three-columns">
                    <label className="field"><span className="field-label">Voiceover</span><textarea className="input" rows={2} value={shot.voiceover} onChange={(event) => updateShot(scene.id, shot.id, { voiceover: event.target.value })} /></label>
                    <label className="field"><span className="field-label">SFX</span><textarea className="input" rows={2} value={shot.sfx} onChange={(event) => updateShot(scene.id, shot.id, { sfx: event.target.value })} /></label>
                    <label className="field"><span className="field-label">Background music</span><textarea className="input" rows={2} value={shot.backgroundMusic} onChange={(event) => updateShot(scene.id, shot.id, { backgroundMusic: event.target.value })} /></label>
                  </div>
                  <label className="field"><span className="field-label">Audio direction</span><textarea className="input" rows={2} value={shot.audioNotes} onChange={(event) => updateShot(scene.id, shot.id, { audioNotes: event.target.value })} /></label>
                </details>
                <div className="shot-card-actions">
                  <button type="button" className="secondary-button" disabled={!shot.imageApproved} title={!shot.imageApproved ? "Review and approve the opening still first" : "Copy the complete shot package"} onClick={() => void copyText(shotPromptText(shot, scene, board, form, assets), "Shot " + shot.shotNumber + " prompt")}><Copy size={14} /> Copy full shot prompt</button>
                  <button type="button" className="quiet-button" disabled={!shot.imageApproved} title={!shot.imageApproved ? "Review and approve the opening still first" : "Copy the video prompt"} onClick={() => void copyText(shot.flowPrompt, "Shot " + shot.shotNumber + " Flow prompt")}><Copy size={14} /> Copy Flow prompt only</button>
                </div>
              </fieldset>
            </details>; })}
          </div>
          <div className="shot-list-actions"><button className="quiet-button" onClick={() => void copyText(sceneShotsText(scene, board, form, assets), "Scene " + scene.sceneNumber + " prompts")}><Copy size={14} /> Copy this scene's shots</button></div>
        </details> : <p className="shot-empty">Shot list မရှိသေးပါ။ Generate shot list ကိုနှိပ်ပြီး prompt ၂–၄ ခုထုတ်ပါ။</p>}
      </article>)}
    </div>
    {message && <p className="shot-status" role="status">{message}</p>}
  </section>;
}
