/**
 * ExtendScript helper functions emitted as source strings, for inclusion
 * in tool body scripts via `prelude(...)` from compose.ts.
 *
 * Most helpers (the `findX` family) throw a structured object on failure:
 * `{ name: "<kind>", message: string, entity?: string, id?: string }`.
 * wrapExtendScript's inner catch routes structured throws to kind-specific
 * failure envelopes (e.g., `not_found`) when the `name` matches a known
 * ErrorKind.
 *
 * Some helpers (e.g. `resolveSwatch`) are upsert-style: they look up an
 * entity by name and create it on miss, returning unconditionally rather
 * than throwing.
 *
 * `findFrameById` resolves via `.getElements()[0]`, so callers receive the
 * typed subclass (TextFrame, Rectangle, etc.) rather than a generic
 * PageItem wrapper. Consumers can rely on `.constructor.name` for type
 * discrimination.
 */

export const findDocumentById = `
function findDocumentById(id) {
  for (var i = 0; i < app.documents.length; i++) {
    if (String(app.documents[i].id) === id) return app.documents[i];
  }
  throw { name: "not_found", message: "document " + id + " not found", entity: "document", id: id };
}
`.trim();

export const findPageById = `
function findPageById(doc, id) {
  for (var i = 0; i < doc.pages.length; i++) {
    if (String(doc.pages[i].id) === id) return doc.pages[i];
  }
  throw { name: "not_found", message: "page " + id + " not found", entity: "page", id: id };
}
`.trim();

export const findFrameById = `
function findFrameById(doc, id) {
  for (var i = 0; i < doc.pageItems.length; i++) {
    if (String(doc.pageItems[i].id) === id) return doc.pageItems[i].getElements()[0];
  }
  throw { name: "not_found", message: "frame " + id + " not found", entity: "frame", id: id };
}
`.trim();

export const findStyleByName = `
function findStyleByName(doc, name) {
  var s = doc.paragraphStyles.itemByName(name);
  if (!s.isValid) {
    throw { name: "not_found", message: "paragraph style \\"" + name + "\\" not found", entity: "paragraph_style", id: name };
  }
  return s;
}
`.trim();

export const resolveSwatch = `
function resolveSwatch(doc, hex) {
  // hex format: "#RRGGBB" (caller already uppercased)
  var swatchName = "auto-" + hex;
  var s = doc.colors.itemByName(swatchName);
  if (!s.isValid) {
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    s = doc.colors.add({
      name: swatchName,
      model: ColorModel.PROCESS,
      space: ColorSpace.RGB,
      colorValue: [r, g, b]
    });
  }
  return s;
}
`.trim();
