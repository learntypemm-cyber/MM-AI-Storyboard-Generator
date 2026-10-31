export const RECAP_MAX_FILE_BYTES = 300 * 1024 * 1024;
export const RECAP_MAX_DURATION_SECONDS = 10 * 60;

export function recapFileError(name: string, size: number, duration?: number): string | null {
  if (!/\.mp4$/i.test(name)) return "MP4 video ရွေးပါ။";
  if (size <= 0) return "Video ဖိုင်အလွတ် ဖြစ်နေသည်။";
  if (size > RECAP_MAX_FILE_BYTES) return "စမ်းသပ် version မှာ 300 MB အထိ MP4 video ကို လက်ခံပါသည်။";
  if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) return "Video အချိန်ကို ဖတ်မရပါ။";
  if (duration !== undefined && duration > RECAP_MAX_DURATION_SECONDS) return "စမ်းသပ် version မှာ 10 မိနစ်အထိ video ကို လက်ခံပါသည်။";
  return null;
}
