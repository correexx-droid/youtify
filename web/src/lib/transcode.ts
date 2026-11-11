import { encodeYtfy, type YtfyContent } from "./ytfy";

/**
 * The audio half of YoutiFy's offline compression: decode whatever YouTube sent (AAC or Opus) to PCM, then
 * re-encode it as Opus at the chosen bitrate with the engine's WebCodecs encoder, and pack the result as YTFY.
 */

const RATE = 48000; // Opus always works at 48 kHz internally.
/** Longer recordings (mixes, live sets) would need too much memory to decode at once: they're kept as they are. */
const MAX_SECONDS = 25 * 60;

export const canTranscode = (): boolean =>
  typeof AudioEncoder !== "undefined" && typeof AudioData !== "undefined" && typeof OfflineAudioContext !== "undefined";

export interface CompressResult {
  file: Uint8Array;
  codec: "opus" | "raw";
  /** Seconds, when the audio was decoded. */
  duration?: number;
}

async function decode(bytes: Uint8Array): Promise<AudioBuffer> {
  // Decoding through a 48 kHz context resamples the song to the rate Opus wants.
  const ctx = new OfflineAudioContext(2, 1, RATE);
  return ctx.decodeAudioData(bytes.slice().buffer);
}

async function encodeOpus(pcm: AudioBuffer, bitrate: number, onProgress?: (f: number) => void) {
  const channels = Math.min(2, pcm.numberOfChannels);
  const config: AudioEncoderConfig = {
    codec: "opus",
    sampleRate: RATE,
    numberOfChannels: channels,
    bitrate,
    // 20 ms frames, tuned for music.
    opus: { frameDuration: 20_000, application: "audio", complexity: 10 },
  } as AudioEncoderConfig;
  const support = await AudioEncoder.isConfigSupported(config);
  if (!support.supported) throw new Error("Opus encoding isn't supported here");

  const packets: Uint8Array[] = [];
  const durations: number[] = [];
  let preSkip = 312; // libopus' look-ahead at 48 kHz, used if the encoder doesn't say.
  let failure: Error | null = null;

  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push(data);
      durations.push(Math.round(((chunk.duration ?? 20_000) * RATE) / 1_000_000));
      const head = meta?.decoderConfig?.description;
      if (head) {
        const h = ArrayBuffer.isView(head) ? new Uint8Array(head.buffer, head.byteOffset, head.byteLength) : new Uint8Array(head as ArrayBuffer);
        // An OpusHead: "OpusHead", version, channels, pre-skip (u16 LE)…
        if (h.length >= 12 && String.fromCharCode(...h.subarray(0, 8)) === "OpusHead") preSkip = h[10]! | (h[11]! << 8);
      }
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure(config);

  const block = RATE; // one second per AudioData
  const total = pcm.length;
  const planes = Array.from({ length: channels }, (_, c) => pcm.getChannelData(c));
  for (let at = 0; at < total; at += block) {
    if (failure) break;
    const frames = Math.min(block, total - at);
    const buf = new Float32Array(frames * channels);
    for (let c = 0; c < channels; c++) buf.set(planes[c]!.subarray(at, at + frames), c * frames);
    const data = new AudioData({
      format: "f32-planar",
      sampleRate: RATE,
      numberOfFrames: frames,
      numberOfChannels: channels,
      timestamp: Math.round((at / RATE) * 1_000_000),
      data: buf,
    });
    encoder.encode(data);
    data.close();
    // Let the encoder catch up so memory doesn't pile up, and report progress.
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    onProgress?.(Math.min(1, (at + frames) / total));
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return { channels, preSkip, packets, durations };
}

/**
 * Compresses a downloaded track into a YTFY file. Falls back to storing the original bytes when the platform
 * can't encode Opus, the song is very long, or re-encoding wouldn't actually make the file smaller.
 */
export async function compressTrack(
  bytes: Uint8Array,
  mime: string,
  bitrate: number,
  onProgress?: (f: number) => void,
): Promise<CompressResult> {
  let duration: number | undefined;
  const raw = (): CompressResult => ({ file: encodeYtfy({ codec: "raw", mime, bytes }), codec: "raw", duration });
  if (!canTranscode()) return raw();
  let pcm: AudioBuffer;
  try {
    pcm = await decode(bytes);
  } catch {
    return raw();
  }
  duration = pcm.duration;
  if (pcm.duration > MAX_SECONDS) return raw();
  const opus = await encodeOpus(pcm, bitrate, onProgress);
  const content: YtfyContent = {
    codec: "opus",
    channels: opus.channels,
    preSkip: opus.preSkip,
    sourceRate: pcm.sampleRate,
    bitrate,
    totalSamples: pcm.length,
    packets: opus.packets,
    durations: opus.durations,
  };
  const file = encodeYtfy(content);
  return file.length < bytes.length ? { file, codec: "opus", duration } : raw();
}
