// -----------------------------------------------------------------------------
// The tiny XML dialect of the Huawei HiLink web API.
//
// The router speaks plain, shallow XML: `<response>` (or `<error>`) holding
// elements that hold either text or other elements, never attributes that
// matter, never mixed content. A full XML library would be the only other
// runtime dependency of the image: these two functions cover the dialect.
// -----------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** Decode the XML entities of a text node (named and numeric). */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Escape a value for a text node. */
export function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Parse a router answer into plain objects.
 *
 * An element holding text becomes a string (empty element: `''`), an element
 * holding elements an object; a name repeated under the same parent becomes an
 * array. The root element is kept: `{ response: {...} }` or `{ error: {...} }`.
 *
 * @param {string} xml
 * @returns {Record<string, unknown>}
 */
export function parseXml(xml) {
  const source = String(xml)
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const root = {};
  const stack = [{ name: null, children: root, text: '', hasChildren: false }];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|<!\[CDATA\[([\s\S]*?)\]\]>/g;
  let last = 0;
  let match;
  while ((match = tag.exec(source)) !== null) {
    const top = stack[stack.length - 1];
    top.text += source.slice(last, match.index);
    last = tag.lastIndex;
    if (match[5] !== undefined) {
      // CDATA: raw text, no entity decoding.
      top.text += match[5];
      top.cdata = (top.cdata ?? '') + match[5];
      continue;
    }
    const [, closing, name, , selfClosing] = match;
    if (closing) {
      if (stack.length === 1 || top.name !== name) {
        throw new Error(`Malformed XML: unexpected </${name}>`);
      }
      stack.pop();
      const value = top.hasChildren
        ? top.children
        : top.cdata !== undefined
          ? top.cdata
          : decodeEntities(top.text.trim());
      addChild(stack[stack.length - 1], name, value);
      continue;
    }
    if (selfClosing) {
      addChild(top, name, '');
      continue;
    }
    stack.push({ name, children: {}, text: '', hasChildren: false });
  }
  if (stack.length !== 1) {
    throw new Error(`Malformed XML: <${stack[stack.length - 1].name}> is never closed`);
  }
  return root;
}

function addChild(parent, name, value) {
  parent.hasChildren = true;
  const siblings = parent.children;
  if (!(name in siblings)) {
    siblings[name] = value;
  } else if (Array.isArray(siblings[name])) {
    siblings[name].push(value);
  } else {
    siblings[name] = [siblings[name], value];
  }
}

/**
 * Build a `<request>` body. Key order matters to some firmwares (the SMS list
 * of a B525 refuses reordered fields): objects are written in insertion order.
 * An array value repeats its element (`{ Phone: ['a', 'b'] }`).
 *
 * @param {Record<string, unknown>} data
 * @returns {string}
 */
export function buildRequest(data) {
  return `<?xml version="1.0" encoding="UTF-8"?><request>${writeChildren(data)}</request>`;
}

function writeChildren(data) {
  return Object.entries(data)
    .map(([name, value]) => writeElement(name, value))
    .join('');
}

function writeElement(name, value) {
  if (Array.isArray(value)) {
    return value.map((item) => writeElement(name, item)).join('');
  }
  if (value === null || value === undefined) {
    return `<${name}></${name}>`;
  }
  if (typeof value === 'object') {
    return `<${name}>${writeChildren(value)}</${name}>`;
  }
  return `<${name}>${escapeXml(value)}</${name}>`;
}

/** The value as an array: `undefined` → `[]`, a single item → `[item]`. */
export function asArray(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
