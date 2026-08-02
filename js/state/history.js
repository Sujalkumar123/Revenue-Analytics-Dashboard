/* Undo / redo. Every mutation (a cell edit, a matrix override, an added
   client, a bulk reset) is expressed as {apply, revert, label} and run
   through perform(). One shared stack across all mutation stores, so
   Ctrl+Z always undoes whatever actually happened last, regardless of
   which sheet it was on. */
"use strict";

import { canEdit } from "./auth.js";
import { render } from "../core/bus.js";
import { toast } from "../ui/toast.js";

var stack = [], idx = -1, MAX = 100;

function perform(action) {
  stack = stack.slice(0, idx + 1);   // drop any redo branch
  action.apply();
  stack.push(action);
  if (stack.length > MAX) stack.shift(); else idx++;
  idx = stack.length - 1;
}
function undo() {
  if (idx < 0) return null;
  var a = stack[idx]; a.revert(); idx--;
  return a;
}
function redo() {
  if (idx + 1 >= stack.length) return null;
  idx++; var a = stack[idx]; a.apply();
  return a;
}

export var HISTORY = {
  perform: perform, undo: undo, redo: redo,
  canUndo: function () { return idx >= 0; },
  canRedo: function () { return idx + 1 < stack.length; }
};

/* Shared by the keyboard shortcuts and the toolbar Undo/Redo buttons, so
   both paths behave identically (re-render, toast, respect canEdit()). */
export function runUndo() {
  if (!canEdit() || !HISTORY.canUndo()) return;
  var a = HISTORY.undo();
  render();
  if (a) toast("Undid: " + a.label);
}
export function runRedo() {
  if (!canEdit() || !HISTORY.canRedo()) return;
  var a = HISTORY.redo();
  render();
  if (a) toast("Redid: " + a.label);
}
