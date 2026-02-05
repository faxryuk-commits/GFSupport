/**
 * Sound notifications utilities
 * Воспроизведение звуков уведомлений при новых сообщениях и кейсах
 */

// Shared AudioContext for all sounds
let audioContext: AudioContext | null = null

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
    // Resume if suspended (requires user interaction first)
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }
    return audioContext
  } catch (e) {
    console.log('[Sound] AudioContext not supported')
    return null
  }
}

/**
 * Play notification sound for new messages
 * Two quick high-pitched beeps
 */
export function playMessageSound() {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    
    // Two quick beeps at 880Hz (A5)
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.frequency.value = 880
      osc.type = 'sine'
      
      const start = now + i * 0.15
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02)
      gain.gain.linearRampToValueAtTime(0, start + 0.1)
      
      osc.start(start)
      osc.stop(start + 0.12)
    }
  } catch (e) {
    console.log('[Sound] Error playing message sound:', e)
  }
}

/**
 * Play notification sound for new cases
 * Three ascending tones (more urgent)
 */
export function playCaseSound() {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    const frequencies = [660, 880, 1100] // Ascending tones
    
    for (let i = 0; i < frequencies.length; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.frequency.value = frequencies[i]
      osc.type = 'sine'
      
      const start = now + i * 0.12
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.15, start + 0.02)
      gain.gain.linearRampToValueAtTime(0, start + 0.1)
      
      osc.start(start)
      osc.stop(start + 0.12)
    }
  } catch (e) {
    console.log('[Sound] Error playing case sound:', e)
  }
}

/**
 * Play urgent notification sound
 * Rapid beeping for urgent matters
 */
export function playUrgentSound() {
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const now = ctx.currentTime
    
    // Four quick high-pitched beeps
    for (let i = 0; i < 4; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      
      osc.connect(gain)
      gain.connect(ctx.destination)
      
      osc.frequency.value = 1000
      osc.type = 'sine'
      
      const start = now + i * 0.1
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.18, start + 0.015)
      gain.gain.linearRampToValueAtTime(0, start + 0.07)
      
      osc.start(start)
      osc.stop(start + 0.08)
    }
  } catch (e) {
    console.log('[Sound] Error playing urgent sound:', e)
  }
}

/**
 * Check if sound is enabled in settings
 */
export function isSoundEnabled(): boolean {
  try {
    const settings = localStorage.getItem('support_settings')
    if (settings) {
      const parsed = JSON.parse(settings)
      // Default to true if not set
      return parsed.soundEnabled !== false
    }
    return true // Default enabled
  } catch {
    return true
  }
}

/**
 * Play sound only if enabled in settings
 */
export function playMessageSoundIfEnabled() {
  if (isSoundEnabled()) {
    playMessageSound()
  }
}

export function playCaseSoundIfEnabled() {
  if (isSoundEnabled()) {
    playCaseSound()
  }
}

export function playUrgentSoundIfEnabled() {
  if (isSoundEnabled()) {
    playUrgentSound()
  }
}
