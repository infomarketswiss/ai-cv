/**
 * Versión markdown de cada página pública, para agentes (encargo de Santiago, 26-oct-2026,
 * despacho de search-ops): /index.md, /en.md y /<slug>.md, más llms.txt con los enlaces a los
 * .md y llms-full.txt con todo el contenido.
 *
 * Corre en el build después de prerender. Convierte el render SSR de React de ese mismo build
 * (el #root de dist/<ruta>/index.html, que sale de los diccionarios i18n), no la web publicada:
 * un .md no puede decir algo distinto de su página, y una página nueva tiene markdown sin
 * escribir nada. Fuera nav, pie, CTAs, botones e iconos.
 *
 * La lista de rutas es el sitemap (solo páginas indexables). La puerta compara esa lista con las
 * rutas del router y las páginas prerenderizadas: una ruta pública sin .md rompe el build, salvo
 * que esté en EXCLUDED con su motivo.
 *
 * Usage: npx tsx --tsconfig tsconfig.app.json scripts/generate-markdown.ts
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument } from 'htmlparser2'
import type { ChildNode, Element } from 'domhandler'
import { articleRegistry } from '../src/articles/registry.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist')
const BASE = 'https://santifer.io'

/** Rutas sin .md a propósito. Cada una con su motivo: la puerta no acepta una ruta muda. */
const EXCLUDED: Record<string, string> = {
  '/ops': 'dashboard privado con contraseña',
  '/privacidad': 'noindex, texto legal',
  '/privacy': 'noindex, texto legal',
}

// ---------------------------------------------------------------------------
// Rutas
// ---------------------------------------------------------------------------

const sitemap = readFileSync(resolve(dist, 'sitemap.xml'), 'utf-8')
const pages = [...sitemap.matchAll(/<url>\s*<loc>([^<]+)<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>/g)]
  .map(([, loc, lastmod]) => ({ path: new URL(loc).pathname, lastmod }))

/** /index.md para la home, /<ruta>.md para el resto */
export function mdPath(path: string): string {
  return path === '/' ? '/index.md' : `${path}.md`
}

function htmlFile(path: string): string {
  return path === '/' ? resolve(dist, 'index.html') : resolve(dist, path.slice(1), 'index.html')
}

// ---------------------------------------------------------------------------
// HTML (render SSR) → markdown
// ---------------------------------------------------------------------------

const DROP_TAGS = new Set(['nav', 'footer', 'button', 'svg', 'canvas', 'script', 'style', 'noscript', 'iframe', 'form', 'input', 'video', 'audio', 'picture'])
const BLOCK_TAGS = new Set(['div', 'section', 'article', 'main', 'aside', 'header', 'p', 'figure', 'figcaption', 'dl', 'dt', 'dd'])

const SOCIAL_POST: [RegExp, string][] = [
  [/^https:\/\/(www\.)?reddit\.com\/r\/[^/]+\/comments\//, 'Reddit post'],
  [/^https:\/\/(x|twitter)\.com\/[^/]+\/status\//, 'X post'],
  [/^https:\/\/(www\.)?linkedin\.com\/(posts|feed\/update|pulse)\//, 'LinkedIn post'],
  [/^https:\/\/dev\.to\/[^/]+\/[^/]+/, 'dev.to post'],
]

function isEl(n: ChildNode): n is Element {
  return n.type === 'tag' || n.type === 'script' || n.type === 'style'
}

function dropped(el: Element): boolean {
  const a = el.attribs
  const cls = a.class ?? ''
  return DROP_TAGS.has(el.name)
    || a.id === 'cta-block'
    || a['aria-hidden'] === 'true'
    || 'hidden' in a
    || /(^|\s)sr-only(\s|$)/.test(cls)
}

function textOf(n: ChildNode): string {
  if (n.type === 'text') return n.data
  if (!isEl(n) || dropped(n)) return ''
  return n.children.map(textOf).join('')
}

function absolute(href: string, pageUrl: string): string {
  if (href.startsWith('#')) return `${pageUrl}${href}`
  try {
    const u = new URL(href, BASE + '/')
    // https://santifer.io/ se queda con barra; /story no la lleva (vercel.json quita la final)
    return u.origin === BASE && u.pathname !== '/' ? u.toString().replace(/\/(?=$|[?#])/, '') : u.toString()
  } catch { return href }
}

interface Ctx { pageUrl: string; headingShift: number }

function inline(nodes: ChildNode[], ctx: Ctx): string {
  return nodes.map((n) => inlineNode(n, ctx)).join('')
}

function inlineNode(n: ChildNode, ctx: Ctx): string {
  if (n.type === 'text') return n.data.replace(/\s+/g, ' ')
  if (!isEl(n) || dropped(n)) return ''
  const inner = () => inline(n.children, ctx)
  switch (n.name) {
    case 'br': return '  \n'
    case 'img': return ''
    case 'strong': case 'b': { const t = inner().trim(); return t ? ` **${t}** ` : '' }
    case 'em': case 'i': { const t = inner().trim(); return t ? ` *${t}* ` : '' }
    case 'code': return '`' + textOf(n) + '`'
    case 'a': {
      // Igual en enlaces-píldora («career-ops» «75.3K» «14.0K» en <span> contiguos)
      const t = n.children.map((c) => inlineNode(c, ctx).trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ')
      const href = n.attribs.href
      if (!t) return ''
      // Tarjeta de un post de terceros: en HTML se ve como cita ajena, pero en el .md su titular
      // pasaría por texto de santifer.io (F2 de search-ops, 26-oct: «740+ offers», «516 evaluations,
      // 66 applications»). Queda el enlace con el nombre de la red, sin el titular.
      const social = href && SOCIAL_POST.find(([re]) => re.test(href))
      if (social) return ` [${social[1]}](${href}) `
      if (!href || href.startsWith('javascript:')) return t
      const url = href.startsWith('mailto:') ? href : absolute(href, ctx.pageUrl)
      return t === url ? url : ` [${t}](${url}) `
    }
    default:
      // Un bloque dentro de un contexto inline (p. ej. <div> en un <a> de tarjeta) se separa con espacio
      return BLOCK_TAGS.has(n.name) || /^h[1-6]$/.test(n.name) || n.name === 'li' ? ` ${inner()} ` : inner()
  }
}

function clean(s: string): string {
  return s.replace(/[ \t]+/g, ' ').replace(/ +([.,;:!?)])/g, '$1').replace(/\( +/g, '(').trim()
}

function blocks(nodes: ChildNode[], ctx: Ctx): string {
  let out = ''
  let run: ChildNode[] = []
  const flush = () => {
    const t = clean(inline(run, ctx))
    if (t) out += `\n\n${t}\n\n`
    run = []
  }
  for (const n of nodes) {
    if (isEl(n) && !dropped(n) && isBlock(n)) { flush(); out += block(n, ctx) } else run.push(n)
  }
  flush()
  return out
}

function isBlock(el: Element): boolean {
  return BLOCK_TAGS.has(el.name) || /^h[1-6]$/.test(el.name)
    || ['ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'details', 'summary', 'hr'].includes(el.name)
}

function hasBlockChild(el: Element): boolean {
  return el.children.some((c) => isEl(c) && !dropped(c) && isBlock(c))
}

function block(el: Element, ctx: Ctx): string {
  const h = /^h([1-6])$/.exec(el.name)
  if (h) {
    const level = Math.min(6, Number(h[1]) + ctx.headingShift)
    // AnchorHeading pinta un «#» al final del título
    // Cada hijo por separado: los títulos animados parten la frase en <span> de bloque sin espacios
    const t = el.children.map((c) => clean(textOf(c))).filter(Boolean).join(' ').replace(/\s*#$/, '')
    return t ? `\n\n${'#'.repeat(level)} ${t}\n\n` : ''
  }
  switch (el.name) {
    case 'hr': return '\n\n---\n\n'
    case 'pre': return `\n\n\`\`\`\n${textOf(el).replace(/\n+$/, '')}\n\`\`\`\n\n`
    case 'ul': case 'ol': return `\n\n${list(el, ctx)}\n\n`
    case 'blockquote': {
      const t = blocks(el.children, ctx).trim()
      return t ? `\n\n${t.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n` : ''
    }
    case 'table': return `\n\n${table(el, ctx)}\n\n`
    case 'summary': { const t = clean(inline(el.children, ctx)); return t ? `\n\n**${t}**\n\n` : '' }
    case 'header':
      // Cabecera de artículo: título y entradilla; la firma (avatar, fecha, minutos) ya va arriba
      if (el.children.some((c) => isEl(c) && c.name === 'h1')) {
        return blocks(el.children.filter((c) => isEl(c) && (/^h[1-6]$/.test(c.name) || c.name === 'p')), ctx)
      }
      return blocks(el.children, ctx)
    default:
      // Tarjeta de cifra («740» + «listings evaluated» en dos <p>): una sola línea
      if (hasBlockChild(el) && el.children.every((c) => !isEl(c) || dropped(c) || !hasBlockChild(c)) && clean(textOf(el)).length <= 80) {
        const parts = el.children.map((c) => clean(inline([c], ctx))).filter(Boolean)
        if (parts.length > 1 && parts.length <= 4) return `\n\n${parts.join(' ')}\n\n`
      }
      return hasBlockChild(el) ? blocks(el.children, ctx) : (() => { const t = clean(inline(el.children, ctx)); return t ? `\n\n${t}\n\n` : '' })()
  }
}

function list(el: Element, ctx: Ctx): string {
  const ordered = el.name === 'ol'
  let i = 0
  return el.children
    .filter((c): c is Element => isEl(c) && c.name === 'li' && !dropped(c))
    .map((li) => {
      i++
      // Algunas listas pintan su propia viñeta «•» en un <span>
      const body = blocks(li.children, ctx).trim().replace(/\n{3,}/g, '\n\n').replace(/^[•·▸→✓✔]\s*/, '')
      if (!body) return ''
      const [first, ...rest] = body.split('\n')
      return `${ordered ? `${i}.` : '-'} ${first}${rest.length ? '\n' + rest.map((l) => (l ? `  ${l}` : '')).join('\n') : ''}`
    })
    .filter(Boolean)
    .join('\n')
}

function table(el: Element, ctx: Ctx): string {
  const rows: string[][] = []
  const walk = (n: ChildNode) => {
    if (!isEl(n) || dropped(n)) return
    if (n.name === 'tr') {
      rows.push(n.children.filter((c): c is Element => isEl(c) && (c.name === 'td' || c.name === 'th'))
        .map((c) => clean(inline(c.children, ctx)).replace(/\|/g, '\\|')))
    } else n.children.forEach(walk)
  }
  walk(el)
  if (!rows.length) return ''
  const width = Math.max(...rows.map((r) => r.length))
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, k) => r[k] ?? '').join(' | ')} |`
  return [line(rows[0]), `| ${Array(width).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

function find(n: ChildNode, pred: (e: Element) => boolean): Element | undefined {
  if (isEl(n) && pred(n)) return n
  // El Document no es un Element, pero tiene hijos
  for (const c of ('children' in n ? n.children : [])) { const r = find(c, pred); if (r) return r }
  return undefined
}

function pageToMarkdown(html: string, lastmod: string): { md: string; title: string; description: string; canonical: string; lang: string } {
  const doc = parseDocument(html)
  const docRoot = doc as unknown as ChildNode
  const title = clean(textOf(find(docRoot, (e) => e.name === 'title')! as unknown as ChildNode))
  const description = find(docRoot, (e) => e.name === 'meta' && e.attribs.name === 'description')?.attribs.content ?? ''
  const canonical = find(docRoot, (e) => e.name === 'link' && e.attribs.rel === 'canonical')?.attribs.href ?? ''
  const lang = find(docRoot, (e) => e.name === 'html')?.attribs.lang ?? 'es'
  const appRoot = find(docRoot, (e) => e.attribs.id === 'root')
  const main = appRoot && (find(appRoot as unknown as ChildNode, (e) => e.name === 'main') ?? appRoot)
  if (!main) throw new Error('sin #root')
  const body = blocks(main.children, { pageUrl: canonical, headingShift: 1 })
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const md = `# ${title}\n\n> ${description}\n\nCanonical: ${canonical}\nLast updated: ${lastmod}\nLanguage: ${lang}\n\n---\n\n${body}\n`
  return { md, title, description, canonical, lang }
}

// ---------------------------------------------------------------------------
// Generar
// ---------------------------------------------------------------------------

const generated: { path: string; md: string; title: string; description: string; lang: string }[] = []
const errors: string[] = []

for (const { path, lastmod } of pages) {
  const file = htmlFile(path)
  if (!existsSync(file)) { errors.push(`${path}: en el sitemap pero sin HTML prerenderizado (${file})`); continue }
  const { md, title, description, lang } = pageToMarkdown(readFileSync(file, 'utf-8'), lastmod)
  // Un render SSR vacío daría un .md con solo cabecera: mejor romper que publicar un esqueleto
  if (md.split('---\n\n')[1].trim().length < 400) { errors.push(`${path}: markdown casi vacío (¿falló el SSR?)`); continue }
  writeFileSync(resolve(dist, mdPath(path).slice(1)), md, 'utf-8')
  generated.push({ path, md, title, description, lang })
}

// ---------------------------------------------------------------------------
// Puerta: ninguna ruta pública sin .md
// ---------------------------------------------------------------------------

const routerPaths = new Set<string>(['/'])
const mainTsx = readFileSync(resolve(root, 'src/main.tsx'), 'utf-8')
for (const [, p] of mainTsx.matchAll(/<Route[^>]*\spath="(\/[^"*]*)"/g)) routerPaths.add(p)
for (const a of articleRegistry) { routerPaths.add(`/${a.slugs.es}`); routerPaths.add(`/${a.slugs.en}`) }
for (const d of readdirSync(dist, { withFileTypes: true })) {
  if (d.isDirectory() && existsSync(resolve(dist, d.name, 'index.html'))) routerPaths.add(`/${d.name}`)
}

for (const p of routerPaths) {
  if (p in EXCLUDED) continue
  if (!existsSync(resolve(dist, mdPath(p).slice(1)))) {
    errors.push(`${p}: ruta pública sin ${mdPath(p)}. Si es pública, que entre en el sitemap; si no, añádela a EXCLUDED en scripts/generate-markdown.ts con su motivo`)
  }
}

if (errors.length) {
  for (const e of errors) console.error(`[markdown] FAIL ${e}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// llms.txt (texto a mano de public/llms.txt + rutas generadas) y llms-full.txt
// ---------------------------------------------------------------------------

const MARKER = '\n## Markdown versions of every page'
const baseLlms = readFileSync(resolve(root, 'public/llms.txt'), 'utf-8').split(MARKER)[0].trimEnd()
const byLang = (l: string) => generated.filter((g) => g.lang === l)
const listing = (l: string) => byLang(l).map((g) => `- [${g.title}](${BASE}${mdPath(g.path)}): ${g.description}`).join('\n')
const section = `${MARKER}\n\nEach page of santifer.io has a markdown twin at the same URL plus \`.md\` (\`/index.md\` for the home), also served on \`Accept: text/markdown\`. Full text of all of them: ${BASE}/llms-full.txt\n\n### English\n\n${listing('en')}\n\n### Español\n\n${listing('es')}\n`
const llms = `${baseLlms}\n${section}`
writeFileSync(resolve(dist, 'llms.txt'), llms, 'utf-8')

const full = [llms, ...[...byLang('en'), ...byLang('es')].map((g) => g.md)].join('\n\n---\n\n')
writeFileSync(resolve(dist, 'llms-full.txt'), full, 'utf-8')

console.log(`[markdown] ${generated.length} .md, llms.txt con ${generated.length} rutas, llms-full.txt ${Math.round(full.length / 1024)} KB · puerta: ${routerPaths.size} rutas del router, ${Object.keys(EXCLUDED).length} excluidas con motivo`)
