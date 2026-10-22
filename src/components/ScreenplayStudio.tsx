import { useState } from "react";
import { z } from "zod";
import type { ImageAsset, ScreenplayWorkflow, Storyboard, VideoForm } from "../types";
import { generateJson } from "../lib/gemini";
import { scriptSource, scriptApproved, inventorySource, inventoryCurrent, inventoryApproved, scriptInventorySchema, inventoryRequest, approvedSceneRequest, bindApprovedBoard, pipelineCurrent, requiredScreenplaySceneCount, screenplaySceneCount, screenplayCompletenessIssues } from "../lib/screenplayWorkflow";
import { storyboardSchema } from "../lib/projectArchive";
import { referenceImagePrompt } from "../lib/automaticAssets";
import { putAsset, assetAsReference } from "../lib/assetStore";
import { downloadText, fileSlug } from "../lib/export";

type Props = { value: ScreenplayWorkflow; form: VideoForm; board: Storyboard | null; projectId: string; assets: ImageAsset[]; busy: boolean; apiKey: string; model: string; requireKey: () => boolean; onChange: (v: ScreenplayWorkflow) => void; onBoard: (b: Storyboard) => void; onBusy: (v: string | null) => void; onError: (v: string) => void };
export default function ScreenplayStudio({ value, form, board, projectId, assets, busy, apiKey, model, requireKey, onChange, onBoard, onBusy, onError }: Props) {
  const [message, setMessage] = useState("");
  const selected = value.choices.find(c => c.id === value.selectedId);
  const expectedSceneCount = requiredScreenplaySceneCount(form);
  const selectedSceneCount = selected ? screenplaySceneCount(selected.screenplay) : 0;
  const selectedScriptIssues = selected ? screenplayCompletenessIssues(selected.screenplay, form) : [];
  const current = inventoryCurrent(value, form);
  const approved = inventoryApproved(value, form);
  const run = async (label: string, action: () => Promise<void>) => {
    if (busy || !requireKey()) return;
    onBusy(label); onError(""); setMessage("");
    try { await action(); } catch (e) { onError(e instanceof Error ? e.message : "Could not complete this step."); } finally { onBusy(null); }
  };
  const editChoice = (patch: Partial<NonNullable<typeof selected>>) => { if (!selected) return; onChange({ ...value, choices: value.choices.map(c => c.id === selected.id ? { ...c, ...patch } : c) }); };
  const polish = () => run("polish", async () => {
    if (!selected?.screenplay.trim()) return;
    const raw = await generateJson<unknown>(
      apiKey,
      model,
      "Polish this user-edited Burmese screenplay while preserving its plot, ending, cast, scene count and intended dialogue. Keep exactly " + expectedSceneCount + " numbered clip-scenes for a " + form.targetDuration + "-second video with " + form.clipDuration + "-second source clips. Do not summarize or remove scenes. Improve Burmese prose, filmable action, dialogue and transitions only. Return JSON {screenplay:string}.\n" + selected.screenplay,
    );
    const result = z.object({ screenplay: z.string().trim().min(1).max(100000) }).parse(raw);
    const issues = screenplayCompletenessIssues(result.screenplay, form);
    if (issues.length) throw new Error("ချောရေးမူက မပြည့်စုံသေးပါ။ " + issues.join(" "));
    editChoice({ polishCandidate: result.screenplay, polishFor: selected.screenplay });
  });
  const extract = () => run("inventory", async () => {
    if (!selected?.screenplay.trim() || current) return;
    const screenplayIssues = screenplayCompletenessIssues(selected.screenplay, form);
    if (screenplayIssues.length) {
      throw new Error("ဇာတ်ညွှန်းမပြည့်စုံသေးပါ။ Expected " + expectedSceneCount + " scenes, found " + screenplaySceneCount(selected.screenplay) + ". " + screenplayIssues.join(" "));
    }
    const next = { ...value, approvedScript: scriptSource(value, form) };
    onChange(next);
    const raw = await generateJson<unknown>(apiKey, model, inventoryRequest(next, form), form.referenceImages);
    const parsed = scriptInventorySchema.parse(raw);
    if (parsed.scenes.length !== expectedSceneCount) {
      throw new Error("Scene စာရင်းက " + parsed.scenes.length + " ခုပဲ ရလာပါတယ်။ ဒီ video အတွက် " + expectedSceneCount + " ခုလိုအပ်ပါတယ်။ ပြန်စမ်းကြည့်ပါ။");
    }
    const ids = new Map(parsed.references.map(r => [r.id, crypto.randomUUID()]));
    onChange({ ...next, approvedInventory: undefined, inventory: { source: scriptSource(next, form), references: parsed.references.map(r => ({ id: ids.get(r.id)!, title: r.title, kind: r.kind, description: r.description })), scenes: parsed.scenes.map(s => ({ ...s, id: crypto.randomUUID(), referenceIds: s.referenceIds.map(id => ids.get(id)!) })) } });
  });
  const generate = () => run("storyboard", async () => {
    if (!inventoryApproved(value, form)) return;
    const raw = await generateJson<unknown>(apiKey, model, approvedSceneRequest(value, form), form.referenceImages);
    const parsed = storyboardSchema.parse(raw);
    onBoard(bindApprovedBoard(parsed, value, form));
    setMessage("အတည်ပြုထားသော ဇာတ်ညွှန်းနှင့် reference စာရင်းအတိုင်း မြန်မာ scene prompts ထုတ်ပြီးပါပြီ။");
  });
  const patchRef = (id: string, patch: Partial<NonNullable<ScreenplayWorkflow['inventory']>['references'][number]>) => onChange({ ...value, inventory: { ...value.inventory!, references: value.inventory!.references.map(r => r.id === id ? { ...r, ...patch } : r) } });
  const patchScene = (id: string, patch: Partial<NonNullable<ScreenplayWorkflow['inventory']>['scenes'][number]>) => onChange({ ...value, inventory: { ...value.inventory!, scenes: value.inventory!.scenes.map(s => s.id === id ? { ...s, ...patch } : s) } });
  const referenceSource = (r: NonNullable<ScreenplayWorkflow['inventory']>['references'][number]) => JSON.stringify({ title: r.title, kind: r.kind, description: r.description });
  const translateReference = (id: string) => run("reference-translation", async () => {
    const ref = value.inventory!.references.find(r => r.id === id)!;
    const raw = await generateJson<unknown>(apiKey, model, "Translate this approved reference design into English exactly, preserving identity and all design details. No additions. Return JSON {description:string}.\n" + ref.description);
    const result = z.object({ description: z.string().trim().min(1).max(100000) }).parse(raw);
    patchRef(id, { englishDescription: result.description, englishSource: referenceSource(ref) });
  });
  const upload = async (id: string, file?: File) => {
    if (!file || busy || !current) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 10 * 1024 * 1024) { onError("Choose a PNG, JPEG or WebP image under 10 MB."); return; }
    onBusy("reference-upload"); onError("");
    try {
      const ref = value.inventory!.references.find(r => r.id === id)!;
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = () => reject(new Error("Could not read image")); reader.readAsDataURL(file); });
      const revision = crypto.randomUUID();
      await putAsset({ id: ref.id, projectId, kind: ref.kind, title: ref.title, prompt: ref.description, mimeType: file.type, data, createdAt: new Date().toISOString(), useAsReference: false });
      patchRef(id, { imageRevision: revision });
      setMessage("Reference ပုံသိမ်းပြီးပါပြီ။ အတည်ပြုမှုကို ပြန်စစ်ပါ။");
    } catch (e) { onError(e instanceof Error ? e.message : "Image save failed"); } finally { onBusy(null); }
  };
  return <section className="storyboard-section screenplay-studio">
    <h2>၁။ မြန်မာဇာတ်ညွှန်း ၃ မျိုးထဲမှ ရွေးပါ</h2>
    <p>ဗီဒီယိုမှာ ဖြစ်လာမည့်ဇာတ်လမ်းကို အရင်ဖတ်ပါ။ ရွေးချယ်ခြင်းနှင့် ကိုယ်တိုင် edit လုပ်ခြင်းက API မသုံးပါ။ Target {form.targetDuration}s ÷ {form.clipDuration}s per clip = <strong>{expectedSceneCount} scenes per screenplay</strong> ဖြစ်ရပါမယ်။ Scene တစ်ခုက Flow clip တစ်ခုစီ ဖြစ်ပါတယ်။</p>
    <div className="concept-grid">{value.choices.map((c, i) => <article className="concept-card" key={c.id}><h3>{i + 1}. {c.title}</h3><p>Scene အရေအတွက်: <strong>{screenplaySceneCount(c.screenplay)} / {expectedSceneCount}</strong> {screenplayCompletenessIssues(c.screenplay, form).length ? "· မပြည့်စုံသေး" : "· ပြည့်စုံ"}</p><details><summary>ဇာတ်ညွှန်းအပြည့် ဖတ်ရန်</summary><pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", padding: 16 }}>{c.screenplay}</pre></details><button className="primary-button" disabled={busy} aria-pressed={value.selectedId === c.id} onClick={() => onChange({ ...value, selectedId: c.id })}>ဇာတ်ညွှန်း {i + 1} ရွေးမယ်</button></article>)}</div>
    {selected && <>
      <h3>၂။ ရွေးထားသောဇာတ်ညွှန်းကို ပြင် / ချောရေးပါ</h3>
      <fieldset className="scene-fieldset" disabled={busy}>
        <label className="field">ဇာတ်ညွှန်းခေါင်းစဉ်<input className="input" value={selected.title} onChange={e => editChoice({ title: e.target.value })} /></label>
        <label className="field">မြန်မာဇာတ်ညွှန်း<textarea className="input" rows={22} value={selected.screenplay} onChange={e => editChoice({ screenplay: e.target.value })} /></label>
        <button className="secondary-button" disabled={!selected.screenplay.trim()} onClick={() => void polish()}>ဇာတ်ညွှန်း ချောရေးပေး</button>
        <button className="quiet-button" onClick={() => downloadText(fileSlug(selected.title) + "-screenplay-MM.txt", selected.screenplay, "text/plain;charset=utf-8")}>ဇာတ်ညွှန်း TXT သိမ်းရန်</button>
        {!!selected.versions.length && <button className="secondary-button" onClick={() => editChoice({ screenplay: selected.versions[0], versions: [selected.screenplay, ...selected.versions.slice(1)].slice(0, 20), polishCandidate: undefined })}>အရင်ဇာတ်ညွှန်း ပြန်ယူရန်</button>}
        {selected.polishCandidate && selected.polishFor === selected.screenplay && <div className="field"><strong>ချောရေးထားသော မူသစ် — မူရင်းကို မအစားထိုးရသေးပါ</strong><textarea className="input" readOnly rows={16} value={selected.polishCandidate} /><button className="primary-button" onClick={() => editChoice({ screenplay: selected.polishCandidate!, versions: [selected.screenplay, ...selected.versions].slice(0, 20), polishCandidate: undefined, polishFor: undefined })}>ချောရေးမူကို လက်ခံမယ်</button><button className="secondary-button" onClick={() => editChoice({ polishCandidate: undefined, polishFor: undefined })}>မူရင်းကိုပဲ ဆက်သုံးမယ်</button></div>}
      </fieldset>
      <p role="status">{scriptApproved(value, form) ? "ဇာတ်ညွှန်း အတည်ပြုပြီးပါပြီ။" : "လက်ရှိဇာတ်ညွှန်း အတည်မပြုရသေးပါ။ အောက်ကခလုတ်နှိပ်မှ နောက်အဆင့်ဆက်ပါမယ်။"}</p>
      {selectedScriptIssues.length > 0 && <p role="alert">ဇာတ်ညွှန်းစစ်ဆေးချက်: {selectedSceneCount}/{expectedSceneCount} scenes. {selectedScriptIssues.join(" ")}</p>}
      <button className="primary-button" disabled={busy || !selected.screenplay.trim() || current} onClick={() => void extract()}>ဇာတ်ညွှန်းအတည်ပြုပြီး Character / Background စာရင်းထုတ်မယ်</button>
    </>}
    {value.inventory && !current && <p role="alert">ဇာတ်ညွှန်း သို့မဟုတ် brief ပြောင်းထားပါတယ်။ Reference နှင့် scene prompt အဟောင်းများကို ပြန်အတည်ပြုမပြီးမချင်း အသုံးမပြုနိုင်ပါ။</p>}
    {current && value.inventory && <>
      <h2>၃။ Character / Background / Scene စာရင်း ပြင်ဆင်ပါ</h2>
      <p>ဇာတ်ညွှန်းမှာ မပါသောလူ/နေရာကို ထပ်မထည့်ပါနှင့်။ ပြောင်းချင်လျှင် အပေါ်ကဇာတ်ညွှန်းကို အရင်ပြင်ပါ။ ကြိုက်တဲ့ reference ပုံကို Flow မှာထုတ်ပြီး ဒီမှာတွဲသိမ်းနိုင်ပါတယ်။</p>
      {value.inventory.references.map((ref, i) => {
        const peers = value.inventory!.references.filter(r => r.kind === ref.kind);
        const code = ({ character: 'C', background: 'B', prop: 'P' }[ref.kind]) + String(peers.findIndex(r => r.id === ref.id) + 1).padStart(2, '0');
        const image = assets.find(a => a.id === ref.id);
        const englishReady = ref.englishDescription && ref.englishSource === referenceSource(ref);
        const imagePrompt = englishReady ? referenceImagePrompt({ id: ref.id, kind: ref.kind, title: ref.title, prompt: ref.englishDescription!, sceneIds: [] }, form) : '';
        return <article className="scene-card" key={ref.id}><h3>{code} · {ref.kind}</h3><fieldset className="scene-content scene-fieldset" disabled={busy}>
          <label className="field">Reference {i + 1} နာမည်<input className="input" value={ref.title} onChange={e => patchRef(ref.id, { title: e.target.value })} /></label>
          <label className="field">Reference {i + 1} ဖော်ပြချက်<textarea className="input" rows={7} value={ref.description} onChange={e => patchRef(ref.id, { description: e.target.value })} /></label>
          <p>Scene {value.inventory!.scenes.map((s, n) => s.referenceIds.includes(ref.id) ? n + 1 : null).filter(Boolean).join(', ')} တွင်သုံးမယ်။</p>
          <button className="secondary-button" disabled={!approved || Boolean(englishReady)} onClick={() => void translateReference(ref.id)}>Reference image prompt ကို English ပြောင်းရန်</button>
          {englishReady && <details><summary>Flow reference image prompt</summary><textarea className="input" rows={8} readOnly value={imagePrompt} /><button className="secondary-button" disabled={!approved} onClick={() => { void navigator.clipboard.writeText(imagePrompt).then(() => setMessage('Reference prompt copied.')).catch(() => onError('Copy မရပါ။ TXT download ကိုသုံးပါ။')); }}>Copy reference prompt</button><button className="secondary-button" disabled={!approved} onClick={() => downloadText(code + '.txt', imagePrompt, 'text/plain;charset=utf-8')}>Reference TXT</button></details>}
          <label className="field">Flow မှာထုတ်ထားသော reference ပုံတွဲရန်<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void upload(ref.id, e.target.files?.[0]); e.currentTarget.value = ''; }} /></label>
          {image && <><img style={{ maxWidth: 260, maxHeight: 200, objectFit: 'contain' }} src={assetAsReference(image).previewUrl} alt={ref.title} />{image.prompt !== ref.description && <p role="alert">ဖော်ပြချက်ပြောင်းထားလို့ ပုံအဟောင်းနဲ့ ကိုက်မကိုက် ပြန်စစ်ပါ။</p>}</>}
        </fieldset></article>;
      })}
      {value.inventory.scenes.map((scene, i) => <details className="field" key={scene.id}><summary>Scene {i + 1} · {scene.title} · {scene.durationSeconds}s</summary><fieldset className="scene-fieldset" disabled={busy}>
        {(['title', 'location', 'action', 'dialogue'] as const).map(key => <label className="field" key={key}>{key}<textarea className="input" value={scene[key]} onChange={e => patchScene(scene.id, { [key]: e.target.value })} /></label>)}
        <label className="field">Scene duration<input className="input" type="number" min={1} max={600} value={scene.durationSeconds} onChange={e => patchScene(scene.id, { durationSeconds: Math.max(1, Math.min(600, Number(e.target.value) || 1)) })} /></label>
        {value.inventory!.references.map(ref => <label key={ref.id}><input type="checkbox" checked={scene.referenceIds.includes(ref.id)} onChange={e => { if (e.target.checked && scene.referenceIds.length >= 3) { onError('Scene တစ်ခုမှာ reference ၃ ခုအထိရွေးနိုင်ပါတယ်။'); return; } patchScene(scene.id, { referenceIds: e.target.checked ? [...scene.referenceIds, ref.id] : scene.referenceIds.filter(id => id !== ref.id) }); }} />{ref.title}</label>)}
      </fieldset></details>)}
      <p>Scene စုစုပေါင်းကြာချိန်: {value.inventory.scenes.reduce((sum, s) => sum + s.durationSeconds, 0)}s · Target: {form.targetDuration}s</p>
      <button className="primary-button" disabled={busy || approved} onClick={() => { try { scriptInventorySchema.parse(value.inventory); onChange({ ...value, approvedInventory: inventorySource(value, form) }); } catch { onError('နာမည်၊ ဖော်ပြချက်နှင့် scene စာရင်းကို အပြည့်ဖြည့်ပါ။'); } }}>Character / Background / Scene စာရင်း အတည်ပြုမယ်</button>
      <p role="status">{approved ? 'Reference စာရင်း အတည်ပြုပြီးပါပြီ။ ပုံထုတ်ရန် prompt ယူနိုင်ပြီး scene prompts ဆက်ထုတ်နိုင်ပါပြီ။' : 'ပြင်ထားသော reference နှင့် scene စာရင်းကို အတည်ပြုရန်လိုသည်။'}</p>
      <button className="primary-button" disabled={busy || !approved} onClick={() => void generate()}>အတည်ပြုထားသောစာရင်းဖြင့် Scene prompts ထုတ်မယ်</button>
      {board && !pipelineCurrent(value, form, board) && <p role="alert">Scene prompts အဟောင်းဖြစ်နေပါပြီ။ အတည်ပြုထားသောစာရင်းဖြင့် ပြန်ထုတ်ပါ။</p>}
    </>}
    {message && <p role="status">{message}</p>}
  </section>;
}
