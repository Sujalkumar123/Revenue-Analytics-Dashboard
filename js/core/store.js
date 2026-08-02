/* localStorage-backed key/value store factory. Used for every mutable slice
   of app state (edits, added rows, matrix overrides, user accounts) so
   undo/redo, snapshotting and persistence all go through the same shape. */
"use strict";

export function store(key) {
  var data = {};
  try { data = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { data = {}; }
  function save() { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {} }
  return {
    all: function () { return data; },
    get: function (k) { return data[k]; },
    set: function (k, v) { data[k] = v; save(); },
    del: function (k) { delete data[k]; save(); },
    clear: function () { data = {}; try { localStorage.removeItem(key); } catch (e) {} },
    /* Whole-object snapshot/restore — undoing a bulk "Reset edits" needs to
       put everything back in one step, not replay N individual sets. */
    snapshot: function () { return JSON.parse(JSON.stringify(data)); },
    restoreAll: function (snap) { data = JSON.parse(JSON.stringify(snap || {})); save(); },
    /* Copy-on-write array ops. The naive get()+push()+set() pattern mutates
       the SAME array the store already holds before set() ever runs, so the
       "old" and "new" values become indistinguishable — fatal for undo,
       since there'd be nothing left to revert to. */
    appendToArray: function (k, item) {
      var arr = (data[k] || []).slice();
      arr.push(item);
      data[k] = arr; save();
      return arr;
    },
    popFromArray: function (k) {
      var arr = (data[k] || []).slice();
      var popped = arr.pop();
      data[k] = arr; save();
      return popped;
    }
  };
}
