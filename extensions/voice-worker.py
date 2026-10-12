"""Live Italian transcription for extensions/voice.ts.

stdin: raw 16 kHz mono s16le PCM from ffmpeg, until EOF (the user stopped).
stdout: one JSON object per line:
  {"ready": true}             model loaded
  {"partial": "…"}            the latest audio (at most WINDOW seconds), every ~STEP seconds while recording
  {"final": "…"}              the whole recording, once, after EOF; then the process exits
The model stays in memory only while this process lives (one dictation).
"""
import json
import sys
import threading
import time

import numpy as np

try:
    import mlx_whisper  # macOS, Apple Silicon
except ImportError:
    mlx_whisper = None
    from faster_whisper import WhisperModel  # Linux / WSL, CPU

MODEL = sys.argv[1] if len(sys.argv) > 1 else ("mlx-community/whisper-small-mlx" if mlx_whisper else "small")
faster = WhisperModel(MODEL, device="cpu", compute_type="int8") if mlx_whisper is None else None
RATE = 16_000
STEP = float(sys.argv[2]) if len(sys.argv) > 2 else 1.5      # seconds of new audio before the next partial
WINDOW = 30     # partials look at the last WINDOW seconds only, so they stay fast on long dictations
MIN_SECONDS = 0.4
SILENCE_RMS = 0.002  # ~-54 dBFS: a quiet room is ~-62, speech is far louder; Whisper invents subtitles on silence

chunks = []
lock = threading.Lock()
done = threading.Event()


def read_stdin():
    while True:
        data = sys.stdin.buffer.read1(8192)
        if not data:
            break
        with lock:
            chunks.append(data)
    done.set()


def audio(last_seconds=None):
    with lock:
        raw = b"".join(chunks)
    raw = raw[: len(raw) // 2 * 2]
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if last_seconds is not None:
        samples = samples[-int(last_seconds * RATE):]
    return samples


def transcribe(samples, temperature):
    if len(samples) < MIN_SECONDS * RATE or float(np.sqrt(np.mean(samples ** 2))) < SILENCE_RMS:
        return ""
    if faster is not None:
        segments, _ = faster.transcribe(
            samples, language="it", task="transcribe", condition_on_previous_text=False,
            temperature=temperature, beam_size=1,
        )
        return " ".join(segment.text.strip() for segment in segments).strip()
    result = mlx_whisper.transcribe(
        samples, path_or_hf_repo=MODEL, language="it", task="transcribe",
        condition_on_previous_text=False, temperature=temperature, verbose=None,
    )
    return result.get("text", "").strip()


def emit(**message):
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    threading.Thread(target=read_stdin, daemon=True).start()
    transcribe(np.zeros(RATE, dtype=np.float32), 0.0)  # load the model while the user starts talking
    emit(ready=True)
    transcribed = 0
    while not done.wait(0.25):
        with lock:
            seconds = sum(len(c) for c in chunks) / 2 / RATE
        if seconds - transcribed >= STEP:
            transcribed = seconds
            emit(partial=transcribe(audio(WINDOW), 0.0))
    emit(final=transcribe(audio(), (0.0, 0.4)))


if __name__ == "__main__":
    main()
