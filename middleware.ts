/**
 * Routing Middleware de Vercel: versión markdown de cada página para agentes.
 *
 * - `Accept: text/markdown` (sin text/html) en una página → su .md (scripts/generate-markdown.ts).
 *   Navegadores y `* / *` siguen recibiendo el HTML.
 * - Toda página HTML anuncia llms.txt y su .md en la cabecera Link (RFC 8288).
 * - Los .md llevan canonical a su HTML por cabecera Link.
 * - Vary: Accept en todo lo negociable, para que ninguna caché sirva markdown a un navegador.
 *
 * Es middleware y no un `rewrite` de vercel.json porque esos se aplican después del sistema de
 * ficheros: `/` ya es dist/index.html y la regla nunca llegaría a ejecutarse.
 */
import { next, rewrite } from '@vercel/functions/middleware'

export const config = {
  // Páginas y .md; fuera API, assets y ficheros estáticos
  matcher: ['/((?!api/|assets/|fonts/|_vercel/|.*\\.(?:png|jpe?g|webp|gif|svg|ico|css|js|json|xml|txt|mp3|mp4|webm|woff2?|pdf|html)$).*)'],
}

const BASE = 'https://santifer.io'
/** Rutas sin .md (las mismas que EXCLUDED en scripts/generate-markdown.ts) */
const NO_MARKDOWN = new Set(['/ops', '/privacidad', '/privacy'])

const mdPath = (path: string) => (path === '/' ? '/index.md' : `${path}.md`)
const htmlPath = (md: string) => (md === '/index.md' ? '/' : md.slice(0, -3))

const MD_HEADERS = (canonical: string) => ({
  'Content-Type': 'text/markdown; charset=utf-8',
  'X-Robots-Tag': 'noindex',
  Vary: 'Accept',
  Link: `<${canonical}>; rel="canonical"`,
})

function prefersMarkdown(accept: string): boolean {
  return /text\/markdown/i.test(accept) && !/text\/html/i.test(accept)
}

export default function middleware(request: Request) {
  const url = new URL(request.url)
  const path = url.pathname

  if (path.endsWith('.md')) {
    return next({ headers: MD_HEADERS(`${BASE}${htmlPath(path)}`) })
  }

  if (NO_MARKDOWN.has(path) || path.startsWith('/ops/')) return next()

  if (prefersMarkdown(request.headers.get('accept') ?? '')) {
    return rewrite(new URL(mdPath(path), url), { headers: MD_HEADERS(`${BASE}${path}`) })
  }

  return next({
    headers: {
      Link: `</llms.txt>; rel="alternate"; type="text/plain"; title="llms.txt", </llms-full.txt>; rel="alternate"; type="text/plain"; title="llms-full.txt", <${mdPath(path)}>; rel="alternate"; type="text/markdown"`,
      Vary: 'Accept',
    },
  })
}
