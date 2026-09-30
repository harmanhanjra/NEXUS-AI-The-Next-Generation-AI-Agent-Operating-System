$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($request.mode -eq 'health') {
        $voices = @($speaker.GetInstalledVoices() | ForEach-Object {
            @{ name = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name; enabled = $_.Enabled }
        })
        @{ voices = $voices; audioEgress = 'none' } | ConvertTo-Json -Depth 4 -Compress
        exit 0
    }
    if ($request.mode -ne 'synthesize') { throw 'Unknown mode' }
    if ($request.text.Length -gt 1200) { throw 'Text too long' }
    $root = [IO.Path]::GetFullPath($request.root).TrimEnd('\') + '\'
    $output = [IO.Path]::GetFullPath($request.output)
    if (-not $output.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw 'Path outside adapter root' }
    $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -eq $request.voice } | Select-Object -First 1
    if (-not $voice) { throw 'Voice unavailable' }
    if (-not $voice.VoiceInfo.Culture.Name.StartsWith($request.language + '-')) { throw 'Language voice unavailable' }
    $speaker.SelectVoice($request.voice)
    $speaker.Rate = 0
    $speaker.SetOutputToWaveFile($output)
    $speaker.Speak($request.text)
    @{ output = $output; voice = $request.voice; language = $request.language; playback = $false } | ConvertTo-Json -Compress
} finally {
    $speaker.Dispose()
}
