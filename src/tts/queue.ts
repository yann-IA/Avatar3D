import type { MouthDriver } from '../avatar/lipsync'
import type { Segment } from '../core/emotion'
import type { TTSEngine } from './engines'

export interface QueueHooks {
  onSegmentStart(seg: Segment): void
  onMouth(driver: MouthDriver | null): void
  onError(err: unknown): void
  /** La file est vide et plus rien n'est en cours de lecture. */
  onDrain(): void
}

interface Item {
  seg: Segment
  prepared?: Promise<unknown>
}

const PREFETCH = 2

/** Joue les phrases dans l'ordre, en préparant la ou les suivantes pendant la lecture. */
export class SpeechQueue {
  private items: Item[] = []
  private running = false
  private generation = 0

  constructor(
    private engine: TTSEngine,
    private readonly hooks: QueueHooks,
  ) {}

  setEngine(engine: TTSEngine): void {
    this.stop()
    this.engine = engine
  }

  get busy(): boolean {
    return this.running || this.items.length > 0
  }

  push(seg: Segment): void {
    this.items.push({ seg })
    this.prefetch()
    if (!this.running) void this.run()
  }

  stop(): void {
    this.generation++
    this.items = []
    this.running = false
    this.engine.stop()
  }

  private prefetch(): void {
    for (const item of this.items.slice(0, PREFETCH)) {
      item.prepared ??= this.engine.prepare(item.seg.text).catch((e: unknown) => ({ error: e }))
    }
  }

  private async run(): Promise<void> {
    const gen = this.generation
    this.running = true
    while (this.items.length > 0) {
      const item = this.items.shift()!
      this.prefetch()
      const prepared = await (item.prepared ?? this.engine.prepare(item.seg.text))
      if (gen !== this.generation) return
      if (prepared && typeof prepared === 'object' && 'error' in prepared) {
        this.hooks.onError((prepared as { error: unknown }).error)
        continue
      }
      this.hooks.onSegmentStart(item.seg)
      await this.engine.play(prepared, this.hooks.onMouth)
      if (gen !== this.generation) return
    }
    this.running = false
    this.hooks.onDrain()
  }
}
