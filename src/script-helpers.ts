/**
 * ExtendScript helper functions emitted as source strings, for inclusion
 * in tool body scripts via `prelude(...)` from compose.ts.
 *
 * Each helper throws a structured object on failure: `{ name: "<kind>",
 * message: string, entity?: string, id?: string }`. The wrapExtendScript
 * outer catch currently flattens these to script_error — that's the next
 * Plan B1.5 task (#36).
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
    if (String(doc.pageItems[i].id) === id) return doc.pageItems[i];
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
