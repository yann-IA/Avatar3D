import { describe, expect, it } from 'vitest'
import { readSSE } from '../src/llm/sse'

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(c) {
      chunks.forEach((s) => c.enqueue(enc.encode(s)))
      c.close()
    },
  })
}

describe('readSSE', () => {
  it('reconstitue les lignes coupées entre deux paquets', async () => {
    const out: string[] = []
    for await (const d of readSSE(streamOf(['data: {"a":', '1}\r\n\r\n: ping\n', 'data: [DONE]\n']))) out.push(d)
    expect(out).toEqual(['{"a":1}', '[DONE]'])
  })
})
