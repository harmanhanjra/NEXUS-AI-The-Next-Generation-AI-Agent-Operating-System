"""Read-only diagnostic against an explicitly generated fixture; no microphone or downloads."""
from pathlib import Path
import runpy
import sys
from importlib.metadata import version
adapter = runpy.run_path(str(Path(__file__).with_name('hanjra-local.py')))
from faster_whisper import WhisperModel
for name in ('faster-whisper', 'ctranslate2', 'onnxruntime'):
    try:
        print(name, version(name))
    except Exception:
        print(name, 'unavailable')
try:
    path = adapter['cached_speech_model']()
    print('model files', {p.name: p.stat().st_size for p in path.iterdir() if p.is_file()})
    model = WhisperModel(str(path), device='cpu', compute_type='int8', cpu_threads=2)
    print('model loaded')
    fixture = Path(sys.argv[1]).resolve(strict=True)
    fixtures_root = (Path.cwd() / 'artifacts' / 'hanjra').resolve()
    if not fixture.is_relative_to(fixtures_root):
        raise ValueError('Only generated fixtures may be diagnosed')
    segments, info = model.transcribe(str(fixture), language='en', beam_size=3, vad_filter=True)
    print('fixture transcription', ' '.join(s.text for s in segments))
except Exception as error:
    print(type(error).__name__, str(error).replace(str(Path.home()), '[HOME]'))
    sys.exit(1)
