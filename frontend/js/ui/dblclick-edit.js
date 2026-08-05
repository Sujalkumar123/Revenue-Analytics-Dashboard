/* Cells marked editable start as plain (non-contenteditable) cells, so a
   single click only selects them — same as any other cell — instead of
   also dropping the user straight into edit mode. Double-click is what
   actually turns a cell into a text-editable field (contenteditable set
   dynamically, all its text pre-selected so typing replaces it); the
   view's own commit logic (blur/Enter/Escape) is expected to call
   stopEditingCell() when it's done, so the cell reverts to plain/
   select-only until double-clicked again. */
"use strict";

export function attachDblClickEdit(container, selector) {
  container.addEventListener("dblclick", function (e) {
    var td = e.target.closest ? e.target.closest(selector) : null;
    if (!td || td.getAttribute("contenteditable") === "true") return;
    td.setAttribute("contenteditable", "true");
    td.classList.add("editing");
    td.focus();
    try {
      var range = document.createRange();
      range.selectNodeContents(td);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (err) {}
  });
}

export function stopEditingCell(td) {
  td.removeAttribute("contenteditable");
  td.classList.remove("editing");
}
