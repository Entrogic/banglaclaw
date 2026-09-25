/** Audio to transcribe (a voice note downloaded from a channel). */
export interface AudioInput {
  data: Uint8Array;
  /** e.g. audio/ogg, audio/mp4 */
  mimeType: string;
  /** File name with an extension the speech-to-text API recognises (voice.ogg, voice.m4a…). */
  filename: string;
}

/** Speech to text (voice notes, docs/11). Implementations live in @banglaclaw/providers. */
export interface Transcriber {
  readonly id: string;
  transcribe(audio: AudioInput, options?: { language?: string; signal?: AbortSignal }): Promise<string>;
}

const AUDIO_EXTENSIONS: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "m4a",
  "video/mp4": "mp4",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
  "audio/amr": "amr",
};

/** A file name for an audio MIME type, so speech-to-text APIs detect the format. */
export function audioFilename(mimeType: string): string {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  return `voice.${AUDIO_EXTENSIONS[base] ?? "ogg"}`;
}
