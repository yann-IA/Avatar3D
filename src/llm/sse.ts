/** Lit un flux Server-Sent Events et renvoie le contenu de chaque ligne « data: ». */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) yield line.slice(5).trimStart()
      }
    }
    if (buffer.startsWith('data:')) yield buffer.slice(5).trimStart()
  } finally {
    reader.releaseLock()
  }
}
