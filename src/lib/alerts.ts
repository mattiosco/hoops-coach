/**
 * Beeps and buzzes for the bench.
 *
 * Sound is made with Web Audio rather than an audio file, so it works offline and has no
 * load delay. Phones and tablets only let a page make sound after the user has touched
 * it, so `unlockAudio` is called from the Start and Resume buttons — by the time an alert
 * is due, the audio is already allowed.
 *
 * Vibration is a bonus where it exists: Android phones buzz, but iPhones and iPads do not
 * let web apps vibrate at all, so the beep is what has to carry the alert.
 */

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  try {
    ctx = new Ctor()
  } catch {
    return null
  }
  return ctx
}

/** Call from a tap. Wakes the audio so later alerts can sound without one. */
export function unlockAudio(): void {
  // Never let sound get in the way of the button that called this: it is the clock's
  // Start and Resume, and those must always work.
  try {
    const audio = context()
    if (!audio) return
    if (audio.state === 'suspended') void audio.resume()
    // A silent blip: iOS only counts audio as unlocked once something has actually played.
    tone(audio, 0, 0.05, 440, 0)
  } catch {
    // No sound on this device; the alerts simply stay silent.
  }
}

function tone(audio: AudioContext, start: number, length: number, freq: number, volume = 0.35) {
  // A fresh context starts its clock at zero, and scheduling anything before that throws,
  // so every time here is kept strictly after the start of the tone.
  const t0 = audio.currentTime + start + 0.01
  const ramp = Math.min(0.01, length / 4)
  const osc = audio.createOscillator()
  const gain = audio.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  // Short ramps either side so it beeps rather than clicks.
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(volume, t0 + ramp)
  gain.gain.setValueAtTime(volume, t0 + length - ramp)
  gain.gain.linearRampToValueAtTime(0, t0 + length)
  osc.connect(gain).connect(audio.destination)
  osc.start(t0)
  osc.stop(t0 + length + 0.02)
}

function play(beeps: [start: number, length: number, freq: number][]) {
  try {
    const audio = context()
    if (!audio) return
    if (audio.state === 'suspended') void audio.resume()
    for (const [start, length, freq] of beeps) tone(audio, start, length, freq)
  } catch {
    // A failed beep must never stop the game screen; the banner still shows.
  }
}

/** 30 seconds to go: two short, higher beeps — "get ready". */
export function alertSubSoon(): void {
  play([
    [0, 0.12, 1320],
    [0.2, 0.12, 1320],
  ])
  navigator.vibrate?.([150, 80, 150])
}

/** Sub time: three firm beeps — "make the change". */
export function alertSubNow(): void {
  play([
    [0, 0.18, 880],
    [0.28, 0.18, 880],
    [0.56, 0.35, 880],
  ])
  navigator.vibrate?.([250, 100, 250, 100, 400])
}

/** End of a period or full time: one long low tone, like a buzzer. */
export function alertBuzzer(): void {
  play([[0, 0.9, 440]])
  navigator.vibrate?.([300, 120, 300])
}
