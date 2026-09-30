export async function openMicrophone(constraints: MediaStreamConstraints): Promise<MediaStream> {
  let expired = false;
  const request = navigator.mediaDevices.getUserMedia(constraints).then(stream => {
    if (expired) { stream.getTracks().forEach(track => track.stop()); throw new Error('Microphone request expired'); }
    return stream;
  });
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([request, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error('Microphone permission is waiting. Allow microphone access for this page. If the in-app browser does not show a permission prompt, open this address in Edge or Chrome.')); }, 15000);
    })]);
  } finally { clearTimeout(timer!); }
}

// A lightweight end-of-turn hint, not speech recognition or an authentication signal.
export function stopAfterSilence(stream: MediaStream, finish: () => void): () => void {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream); const analyser = context.createAnalyser();
  analyser.fftSize = 1024; source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let voicedMs = 0; let lastVoice = performance.now(); let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; clearInterval(timer); source.disconnect(); void context.close(); };
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
    if (rms > .018) { voicedMs += 100; lastVoice = performance.now(); }
    if (voicedMs >= 300 && performance.now() - lastVoice > 1800) { stop(); finish(); }
  }, 100);
  void context.resume().catch(stop);
  return stop;
}
