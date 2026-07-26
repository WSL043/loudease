# Audio DSP

This document describes the current `leveler-v3` algorithm in version `0.7.1`.

## Goals

- Reduce sudden loud material before it becomes uncomfortable.
- Move sustained loud and genuinely quiet material toward one common target at full strength.
- Preserve short-scale waveform detail while reducing program-to-program and passage-to-passage level differences.
- Respect mute and player-volume intent.
- Avoid clipping, pumping, abrupt gain jumps, and stereo image movement.

## Non-goals

- Exact broadcast loudness normalization across complete programs.
- Perfect perceived equality across different spectra, voices, devices, and listening environments.
- Speech/source separation or content classification.
- A calibrated acoustic safety limit at the listener's ear.
- Mastering, EQ, denoising, or multiband dynamics processing.

## Processing graph

```text
captured PCM
  -> K-weighted and raw measurement
  -> signal gate
  -> loudness target policy
  -> smoothed linked-channel gain
  -> player-volume boundary
  -> 5 ms look-ahead sample-peak limiter
  -> output
```

The normal graph runs in `offscreen/leveler-worklet.js` on the AudioWorklet render thread. The offscreen main thread sends settings and receives low-rate state messages; it does not drive the normal 20 ms control loop.

## Measurement

The worklet accumulates 20 ms frames and maintains bounded history:

- fast cut window: 5 frames, approximately 100 ms;
- quiet-lift loudness window: 5 frames, approximately 100 ms, using the median frame energy;
- momentary window: 20 frames, approximately 400 ms;
- short-term window: 150 frames, approximately 3 s;
- lift peak window: 10 frames, approximately 200 ms, using the 65th percentile.

An approximate BS.1770-style K-weighting stage uses a high shelf and high pass so sub-bass contributes less than speech-band energy. The control loudness combines momentary and short-term energy; fast-cut energy can override it when a loud event arrives.

This is intentionally not presented as standards-compliant LUFS. The implementation does not yet include the complete BS.1770 gating and channel weighting required for an integrated-loudness meter.

## Signal gate

Upward gain is disabled until both energy and peak evidence indicate a real signal. The gate uses hysteresis:

- open energy: approximately `-62 dB`;
- close energy: approximately `-68 dB`;
- open peak: `0.00035` linear;
- close peak: half the open threshold.

When the player volume is known and below unity, measurement is compensated before gate decisions so a quiet player setting is not mistaken for quiet source mastering.

## Gain policy

Current defaults:

| Parameter | Value |
|---|---:|
| Loud target | `-29 dB` weighted RMS approximation |
| Quiet-lift target | `-29 dB` |
| Maximum upward gain | `+34 dB` |
| Maximum downward gain | `-30 dB` |
| Limiter ceiling | `-3 dBFS` sample peak |
| Peak guard | `-6 dBFS` |
| Peak-compression allowance for lift | up to `15 dB` at full strength |

Downward gain is derived from the loudness excess above the target and the **Reduce loud sounds** strength. Upward gain uses the same target at full strength and is derived from the median energy of the five most recent 20 ms frames. The median prevents one isolated peak from making the whole 100 ms passage look loud. Once that faster window confirms a quiet passage, stale longer-window loudness is prevented from cancelling the recovery gain. Upward gain is then limited by:

- robust peak headroom;
- instantaneous peak headroom;
- the player-volume-aware maximum lift;
- the configured maximum lift;
- a bounded allowance of up to `15 dB` for look-ahead peak compression at full strength;
- signal-gate state.

The first `headroom` portion of lift fits below both robust and instantaneous peak ceilings. At full strength, up to `15 dB` more may be requested so a brief high-crest peak does not keep an otherwise quiet passage inaudible. Lower slider values scale this allowance down. The look-ahead limiter absorbs that bounded excess; gain above this allowance is rejected. This deliberately trades more macro-dynamics at high settings for substantially closer loudness while keeping output below the ceiling.

## Gain stability

The processor uses separate time constants:

| Transition | Time constant |
|---|---:|
| Apply protective cut | `12 ms` |
| Release protective cut | `180 ms` |
| Apply quiet lift | `100 ms` |
| Release quiet lift | `250 ms` |

Additional stability controls:

- target deadband: `0.8 dB`;
- upward target hold: `80 ms`;
- maximum upward gain increase: `3 dB` per 20 ms frame;
- one linked gain value for all channels.

These controls keep changes continuous while allowing a confirmed quiet passage to recover within a few hundred milliseconds. Full strength is intentionally assertive; lower settings retain more original macro-dynamics.

## Look-ahead limiter

The unified worklet delays audio by approximately 5 ms and keeps a rolling future-peak queue. Gain moves toward the required attenuation before the buffered peak reaches the output. Channels share the same envelope so stereo balance is preserved.

The limiter reports:

- input and output sample peak;
- limiter reduction;
- limited sample count;
- hard-clipped sample count;
- maximum overshoot.

Hard clipping remains a final invariant guard. Tests require normal fixtures and clustered peaks to reach the configured ceiling without using that guard.

The current limiter is sample-peak based. It does not yet use 4x or higher oversampling to estimate inter-sample true peaks.

## Player volume

When media state is fresh and conflict-free:

- mute or zero player volume sets output gain to zero;
- the maximum upward gain is reduced with the player volume;
- the limiter ceiling is lowered proportionally;
- DSP never writes to `HTMLMediaElement.volume`.

When player-volume state is unknown or conflicting, upward lift is disabled unless the narrow tab-audible fallback is safe. Downward protection remains available.

## Fallback path

If the unified worklet cannot load, the offscreen document falls back to a render-thread meter or analyser, main-thread gain control, and a dedicated limiter worklet or `DynamicsCompressorNode`. Diagnostics expose the fallback mode. The fallback exists for resilience; it is not the quality reference.

## Verification

Automated coverage includes:

- pure policy tests in `tools/dsp_unit_tests.js`;
- synthetic PCM regression in `tools/offline_audio_tests.js`;
- unified processor tests in `tools/leveler_worklet_tests.js`;
- look-ahead peak and stereo-link tests in `tools/limiter_worklet_tests.js`;
- render-thread metering tests in `tools/meter_worklet_tests.js`;
- OfflineAudioContext graph checks in `tools/offline_audio_graph_tests.js`;
- isolated Chrome E2E for quiet lift, loud cut, bursts, mute, player volume, source switching, persistence, and capture lifecycle.

## Known DSP gaps

- No oversampled true-peak estimation.
- No standards-compliant integrated LUFS meter.
- No speech/music classifier or source separation.
- Synthetic fixtures do not replace licensed real-program material and controlled listening tests.
- Perceptual tuning still needs a larger, legally redistributable evaluation corpus.
- Strong lift can make source noise, codec damage, breaths, or room tone more audible and can invoke peak limiting on high-crest material.
