/* Map: Cloudflare Worker in front of the static site.
 * Shared links like /?q=Hawa%20Mahal&ll=26.92,75.82 get page titles and link previews
 * (WhatsApp, X, Discord, Google) that name the place or route. Everything else is served as-is.
 */
const SITE = 'Map';

function describe(url) {
  const q = url.searchParams.get('q')?.slice(0, 120);
  const ll = url.searchParams.get('ll');
  const route = url.searchParams.get('route');
  if (q) {
    const where = ll ? ` (${ll.split(',').map((n) => (+n).toFixed(4)).join(', ')})` : '';
    return {
      title: `${q} · ${SITE}`,
      description: `See ${q}${where} on ${SITE}: photos, directions, Street View, weather and what's nearby. Free and open source.`,
    };
  }
  if (route) {
    const stops = route.split(';').length;
    const mode = { car: 'Driving', bike: 'Cycling', foot: 'Walking' }[url.searchParams.get('mode')] || 'Driving';
    return {
      title: `${mode} directions · ${SITE}`,
      description: `${mode} directions with ${stops} point${stops === 1 ? '' : 's'}: route, travel time and turn-by-turn navigation on ${SITE}.`,
    };
  }
  return null;
}

/** Set the content attribute of a <meta>/<link> element. */
class SetAttr {
  constructor(attr, value) { this.attr = attr; this.value = value; }
  element(el) { el.setAttribute(this.attr, this.value); }
}

export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    const url = new URL(request.url);
    const info = describe(url);
    if (!info || !(res.headers.get('content-type') || '').includes('text/html')) return res;
    return new HTMLRewriter()
      .on('title', { element(el) { el.setInnerContent(info.title); } })
      .on('meta[name="description"]', new SetAttr('content', info.description))
      .on('meta[property="og:title"], meta[name="twitter:title"]', new SetAttr('content', info.title))
      .on('meta[property="og:description"], meta[name="twitter:description"]', new SetAttr('content', info.description))
      .on('meta[property="og:url"]', new SetAttr('content', url.toString()))
      .transform(res);
  },
};
