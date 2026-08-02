/* Tiny indirection so modules that are defined "earlier" in the dependency
   graph (history, the two grid views, the add-client modal, the auth
   screens) can trigger a re-render / re-entry into the app without a
   circular import. main.js registers the real implementations once, at
   boot; everyone else only ever calls the exported functions below. */
"use strict";

export let render = function () {};
export let startApp = function () {};

export function setRender(fn) { render = fn; }
export function setStartApp(fn) { startApp = fn; }
