"""One-shot local adapters. No additional orchestration server or model downloads."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import time


def confined(value, root):
    root = Path(root).resolve(strict=True)
    target = Path(value).resolve(strict=True)
    if not target.is_relative_to(root) or target.is_symlink():
        raise ValueError("Path outside adapter root")
    return target


def cached_speech_model():
    path = Path(os.environ.get('HANJRA_WHISPER_MODEL_DIR', str(Path.home() / '.cache' / 'huggingface' / 'hub' /
        'models--Systran--faster-whisper-base' / 'snapshots' / 'ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66')))
    # Existing four-file inference cache is sufficient even if hub metadata calls it an incomplete repository snapshot.
    if not all((path / n).is_file() for n in ('model.bin', 'tokenizer.json', 'config.json', 'vocabulary.txt')):
        raise FileNotFoundError('Cached speech model is incomplete')
    return path


def speech_health():
    from faster_whisper.tokenizer import _LANGUAGE_CODES
    path = cached_speech_model()
    return {"backend": "windows-local", "stt": "faster-whisper", "version": importlib.metadata.version("faster-whisper"),
            "model": "Systran/faster-whisper-base", "revision": "ebe41f70d5b6dfa9166e2c581c45c9c0cfc57b66",
            "cached": all((Path(path) / n).is_file() for n in ("model.bin", "tokenizer.json", "config.json")),
            "sttAdvertisedLanguages": [x for x in ("pa", "hi", "en") if x in _LANGUAGE_CODES],
            "languageQualityVerified": {"pa": False, "hi": False, "en": False}, "audioEgress": "none"}


def transcribe(request):
    from faster_whisper import WhisperModel
    audio = confined(request["audio"], request["root"])
    start = time.perf_counter()
    path = cached_speech_model()
    model = WhisperModel(str(path), device="cpu", compute_type="int8", cpu_threads=2)
    loaded = time.perf_counter()
    lock = request.get("language", "auto")
    if lock not in ("auto", "en", "hi", "pa"):
        raise ValueError("Invalid language")
    segments, info = model.transcribe(str(audio), language=None if lock == "auto" else lock, beam_size=3, vad_filter=True)
    if info.duration > 45:
        raise ValueError('Audio duration exceeds 45 seconds')
    parts = list(segments)
    return {"text": " ".join(s.text.strip() for s in parts).strip(), "language": info.language,
            "languageProbability": info.language_probability,
            "lowConfidence": any(s.avg_logprob < -0.7 or s.no_speech_prob > 0.5 for s in parts),
            "modelLoadMs": round((loaded-start)*1000), "transcriptionMs": round((time.perf_counter()-loaded)*1000),
            "totalMs": round((time.perf_counter()-start)*1000), "partial": False,
            "model": "faster-whisper-base/int8", "scope": "local_read"}


def evaluate_speech(request):
    from faster_whisper import WhisperModel
    start = time.perf_counter()
    model = WhisperModel(str(cached_speech_model()), device='cpu', compute_type='int8', cpu_threads=2)
    loaded = time.perf_counter()
    results = []
    for item in request['items'][:10]:
        path = confined(item['audio'], request['root'])
        now = time.perf_counter()
        segments, info = model.transcribe(str(path), language='en', beam_size=3, vad_filter=True)
        text = ' '.join(s.text.strip() for s in segments).strip()
        results.append({'expected': item['expected'], 'transcript': text, 'sttMs': round((time.perf_counter()-now)*1000),
                        'language': info.language, 'scope': 'synthetic_audio_fixture',
                        'audioSha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return {'modelLoadMs': round((loaded-start)*1000), 'results': results,
            'humanListeningVerified': False, 'microphoneTested': False, 'model': 'faster-whisper-base/int8'}


def career(request):
    import yaml
    root = Path(request["careerRoot"]).resolve(strict=True)
    facts_path = root / "profile" / "facts.yaml"
    raw = facts_path.read_bytes()
    facts = yaml.safe_load(raw) or {}
    # Reuse existing pure Career Ops/n8n functions, never their registry-writing CLI entry points.
    automation = Path(request["automationRoot"]).resolve(strict=True)
    sys.path.insert(0, str(automation))
    from agents.ats_optimizer import optimize
    matches = []
    for job in request["jobs"][:25]:
        result = optimize(facts, job)
        units = []
        for unit in result["suggested_evidence_order"]:
            value = facts
            for key in unit["fact_ref"].split("#/")[1].split("/"):
                value = value[int(key)] if isinstance(value, list) else value[key]
            units.append({**unit, "exact_fact": value})
        matches.append({"job": job, "skills": result["ranked_existing_skills"], "units": units,
                        "rankingScore": len(result["ranked_existing_skills"]) * 2 + sum(u["relevance_count"] for u in units),
                        "unsupportedTags": result["unsupported_job_tags_not_to_add"]})
    matches.sort(key=lambda x: (-x["rankingScore"], x["job"]["url"]))
    return {"matches": matches[:5], "profileSha256": hashlib.sha256(raw).hexdigest(),
            "profileSource": str(facts_path), "eligibilityVerified": False,
            "eligibilityBlocker": "Reconfirm current location and work authorization; saved Berlin/EU assumptions are unverified",
            "claimsAdded": 0, "applicationsSubmitted": 0, "trackerWritten": False}


def n8n_audit(request):
    import sqlite3
    path = Path(request["database"]).resolve(strict=True)
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as conn:
        rows = conn.execute("SELECT id,name,active FROM workflow_entity WHERE isArchived=0 ORDER BY name").fetchall()
        return {"database": str(path), "workflows": [{"id": r[0], "name": r[1], "active": bool(r[2])} for r in rows],
                "scope": "live_read", "credentialsRead": False, "databaseWrites": 0}


def main():
    request = json.loads(sys.stdin.read(2_000_001))
    mode = request.get("mode")
    if mode == "speech-health":
        result = speech_health()
    elif mode == "transcribe":
        result = transcribe(request)
    elif mode == "career":
        result = career(request)
    elif mode == 'speech-evaluate':
        result = evaluate_speech(request)
    elif mode == "n8n-audit":
        result = n8n_audit(request)
    else:
        raise ValueError("Unknown adapter mode")
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Private exception values, local credentials, and tracebacks are excluded.
        print(json.dumps({"error": type(error).__name__, "blocker": "local_adapter_failed"}))
        sys.exit(1)
