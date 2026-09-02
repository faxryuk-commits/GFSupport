/**
 * Verto-софтфон: звонки прямо из браузера через WebRTC-шлюз OnlinePBX.
 *
 * OnlinePBX не даёт сторонним клиентам свой WSS для SIP.js, но Verto
 * (JSON-RPC поверх WSS + WebRTC, протокол FreeSWITCH) на шлюзе самой АТС
 * работает: логин по webrtc-кредам из user/get.json проверен на нашем
 * домене. Схема подключения — по контракту pbx-verto-backend-contract:
 * бекэнд выдаёт креды текущему оператору, фронт держит соединение.
 *
 * Реализован минимум телефонии: регистрация, исходящий, входящий,
 * ответ/сброс, отключение микрофона. Без видео, без трансферов.
 */

export interface VertoCreds {
  host: string
  login: string
  user: string
  extension: string
  verto_password: string
}

export type VertoState =
  | 'idle'          // соединения нет
  | 'connecting'    // WSS открывается, логин в пути
  | 'registered'    // залогинен, готов звонить
  | 'ringing_out'   // исходящий: у клиента звонит
  | 'ringing_in'    // входящий: звонит у нас
  | 'active'        // разговор идёт
  | 'error'

export interface VertoEvents {
  onState: (s: VertoState, detail?: string) => void
  /** Входящий: номер звонящего; отвечать через answer(), сбрасывать через hangup(). */
  onIncoming?: (number: string, name?: string) => void
}

const uuid = () => crypto.randomUUID()

export class VertoPhone {
  private ws: WebSocket | null = null
  private pc: RTCPeerConnection | null = null
  private stream: MediaStream | null = null
  private remoteAudio: HTMLAudioElement | null = null
  private reqId = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
  private sessid = uuid()
  private callId: string | null = null
  private incomingSdp: string | null = null
  state: VertoState = 'idle'
  /** Номер текущего разговора — для подписи в звонилке. */
  currentNumber: string | null = null
  private creds: VertoCreds
  private events: VertoEvents

  constructor(creds: VertoCreds, events: VertoEvents) {
    this.creds = creds
    this.events = events
  }

  private setState(s: VertoState, detail?: string) {
    this.state = s
    this.events.onState(s, detail)
  }

  connect() {
    if (this.ws) return
    this.setState('connecting')
    const ws = new WebSocket(this.creds.host)
    this.ws = ws
    ws.onopen = () => {
      this.request('login', {
        login: this.creds.login, passwd: this.creds.verto_password,
        sessid: this.sessid, loginParams: {}, userVariables: {},
      }).then(() => this.setState('registered'))
        .catch(e => this.setState('error', String(e?.message || e)))
    }
    ws.onmessage = ev => this.onMessage(ev)
    ws.onclose = () => {
      this.ws = null
      if (this.state !== 'error') this.setState('idle')
    }
    ws.onerror = () => this.setState('error', 'шлюз недоступен')
  }

  disconnect() {
    this.cleanupCall()
    try { this.ws?.close() } catch { /* уже закрыт */ }
    this.ws = null
    this.setState('idle')
  }

  private request(method: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return reject(new Error('нет соединения'))
      const id = ++this.reqId
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', method, id, params }))
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method}: нет ответа`)) }
      }, 10000)
    })
  }

  private onMessage(ev: MessageEvent) {
    let msg: any
    try { msg = JSON.parse(ev.data) } catch { return }

    // Ответ на наш запрос
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) p.reject(new Error(msg.error.message || 'ошибка АТС'))
      else p.resolve(msg.result)
      return
    }

    // Запрос от сервера — подтверждаем всегда, иначе шлюз повторяет и рвёт сессию
    const method = String(msg.method || '')
    const params = msg.params || {}
    if (msg.id && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { method } }))
    }

    if (method === 'verto.invite') {
      // Входящий: SDP-оффер придёт здесь или в verto.media — сохраняем
      this.callId = String(params.callID || '')
      this.incomingSdp = params.sdp ? String(params.sdp) : null
      this.currentNumber = String(params.caller_id_number || params.caller_id_name || '')
      this.setState('ringing_in')
      this.events.onIncoming?.(this.currentNumber, params.caller_id_name)
    } else if (method === 'verto.media' || method === 'verto.answer') {
      // Исходящий: клиент ответил (или пошла ранняя медиа) — принимаем SDP
      if (params.sdp && this.pc) {
        this.pc.setRemoteDescription({ type: 'answer', sdp: String(params.sdp) })
          .then(() => { if (method === 'verto.answer') this.setState('active') })
          .catch(e => this.endWithError('SDP не принят: ' + e?.message))
      } else if (method === 'verto.answer') {
        this.setState('active')
      }
    } else if (method === 'verto.bye') {
      this.cleanupCall()
      this.setState('registered', params.cause ? String(params.cause) : undefined)
    } else if (method === 'verto.punt') {
      // Шлюз выгнал (второй логин тем же добавочным) — не переподключаемся
      this.disconnect()
      this.setState('error', 'добавочный занят другим устройством')
    }
  }

  private async newPeer(): Promise<RTCPeerConnection> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream!))
    pc.ontrack = e => {
      if (!this.remoteAudio) {
        this.remoteAudio = new Audio()
        this.remoteAudio.autoplay = true
      }
      this.remoteAudio.srcObject = e.streams[0]
    }
    this.pc = pc
    return pc
  }

  /** Verto шлёт полный SDP без trickle: ждём конца сбора ICE-кандидатов. */
  private waitIce(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve()
    return new Promise(resolve => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve() }
      const check = () => { if (pc.iceGatheringState === 'complete') done() }
      pc.addEventListener('icegatheringstatechange', check)
      setTimeout(done, 2500)
    })
  }

  async call(destination: string) {
    if (this.state !== 'registered') throw new Error('софтфон не готов')
    const pc = await this.newPeer()
    const offer = await pc.createOffer({ offerToReceiveAudio: true })
    await pc.setLocalDescription(offer)
    await this.waitIce(pc)
    this.callId = uuid()
    this.currentNumber = destination
    this.setState('ringing_out')
    try {
      await this.request('verto.invite', {
        sdp: pc.localDescription?.sdp,
        dialogParams: {
          callID: this.callId,
          destination_number: destination,
          caller_id_name: this.creds.extension,
          caller_id_number: this.creds.extension,
          useStereo: false, useMic: true, useSpeak: true,
          tag: 'gfsupport-dialer',
        },
      })
    } catch (e: any) {
      this.endWithError(String(e?.message || e))
      throw e
    }
  }

  async answer() {
    if (!this.callId || !this.incomingSdp) throw new Error('нет входящего')
    const pc = await this.newPeer()
    await pc.setRemoteDescription({ type: 'offer', sdp: this.incomingSdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    await this.waitIce(pc)
    await this.request('verto.answer', {
      sdp: pc.localDescription?.sdp,
      dialogParams: { callID: this.callId },
    })
    this.setState('active')
  }

  async hangup() {
    const id = this.callId
    this.cleanupCall()
    if (id) {
      await this.request('verto.bye', { dialogParams: { callID: id } }).catch(() => { /* уже завершён */ })
    }
    this.setState('registered')
  }

  toggleMute(): boolean {
    const track = this.stream?.getAudioTracks()[0]
    if (!track) return false
    track.enabled = !track.enabled
    return !track.enabled
  }

  private endWithError(detail: string) {
    this.cleanupCall()
    this.setState('registered', detail)
  }

  private cleanupCall() {
    this.callId = null
    this.incomingSdp = null
    this.currentNumber = null
    try { this.pc?.close() } catch { /* уже закрыт */ }
    this.pc = null
    this.stream?.getTracks().forEach(t => t.stop())
    this.stream = null
    if (this.remoteAudio) { this.remoteAudio.srcObject = null }
  }
}

/** Пользовательский флаг: ПК-режим звонилки можно выключить в самой звонилке. */
export function webrtcEnabled(): boolean {
  return localStorage.getItem('dialer_webrtc') !== '0'
}
export function setWebrtcEnabled(on: boolean) {
  localStorage.setItem('dialer_webrtc', on ? '1' : '0')
}
