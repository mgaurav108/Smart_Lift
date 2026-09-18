/* Smart Lift - new_dcs test helper: fake DOM (Spec A56).
 * Implements exactly the DOM contract ui.js relies on:
 *   document { createElement, createTextNode, getElementById, body }
 *   element   { appendChild, addEventListener, setAttribute, getAttribute,
 *               style.<property> (plain object), className,
 *               classList.{add,remove,contains}, textContent,
 *               value, addEventListener }
 *   option    { value, textContent, appendChild(option) }
 * No innerHTML, no querySelector, no dataset.
 * Purposely mirrors ui.js's DOM contract so the view is testable under Node.
 */
(function (global) {
  'use strict';

  function makeElement(tagName) {
    var el = {
      tagName: String(tagName || 'div'),
      children: [],
      style: {},
      attrs: {},
      _text: '',
      _value: '',
      className: '',
      classList: {
        add: function () {},
        remove: function () {},
        contains: function () { return false; }
      },
      appendChild: function (c) {
        el.children.push(c);
        if (c && c.parentNode === undefined) c.parentNode = el;
        return c;
      },
      addEventListener: function () {},
      setAttribute: function (k, v) { el.attrs[k] = String(v); },
      getAttribute: function (k) { return el.attrs[k] === undefined ? null : el.attrs[k]; },
      textContent: '',
      value: ''
    };
    Object.defineProperty(el, 'textContent', {
      get: function () {
        var s = el._text;
        el.children.forEach(function (c) {
          if (c && c.textContent !== undefined) s += c.textContent;
        });
        return s;
      },
      set: function (v) {
        el._text = v == null ? '' : String(v);
        el.children = [];
      },
      configurable: true
    });
    return el;
  }

  function create() {
    var nodes = {};

    function getElementById(id) {
      if (!nodes[id]) nodes[id] = makeElement('div');
      return nodes[id];
    }

    var doc = {
      createElement: makeElement,
      createTextNode: function (t) {
        return { textContent: String(t) };
      },
      getElementById: getElementById,
      body: makeElement('body')
    };
    return doc;
  }

  var API = { create: create };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  }
  global.SmartLift = global.SmartLift || {};
  global.SmartLift.NewDCS = global.SmartLift.NewDCS || {};
  global.SmartLift.NewDCS.FakeDOM = API;
}(typeof window !== 'undefined' ? window : globalThis));
