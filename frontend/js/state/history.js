/* Undo / redo. Every mutation (a cell edit, a matrix override, an added
   client, a bulk reset) is expressed as {apply, revert, label} and run
   through perform(). One shared stack across all mutation stores, so
   Ctrl+Z always undoes whatever actually happened last, regardless of
   which sheet it was on. */
"use strict";

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
  canRedo: function () { return idx + 1 < stack.length; },
  /* Undo/redo isn't admin-gated (see runUndo/runRedo below), so a
     different user signing in on the same browser tab must not inherit —
     or be able to undo — the previous session's history. Called on logout. */
  clearSession: function () { stack = []; idx = -1; }
};

/* Shared by the keyboard shortcuts and the toolbar Undo/Redo buttons, so
   both paths behave identically (re-render, toast). Not gated by canEdit():
   the stack is local to this browser session, and read-only users can only
   ever push filter/sort actions onto it (they're blocked from editing
   anywhere in the UI) — so there's nothing here for a non-admin to undo
   except their own filtering, which they should be able to. */
export function runUndo() {
  if (!HISTORY.canUndo()) return;
  var a = HISTORY.undo();
  render();
  if (a) toast("Undid: " + a.label);
}
export function runRedo() {
  if (!HISTORY.canRedo()) return;
  var a = HISTORY.redo();
  render();
  if (a) toast("Redid: " + a.label);
}
