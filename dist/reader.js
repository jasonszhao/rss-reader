(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
  typeof define === 'function' && define.amd ? define(factory) :
  (global.reader = factory());
}(this, (function () { 'use strict';

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  };

  var PROXY_STATE = typeof Symbol !== "undefined" ? Symbol("immer-proxy-state") : "__$immer_state";

  var RETURNED_AND_MODIFIED_ERROR = "An immer producer returned a new value *and* modified its draft. Either return a new value *or* modify the draft.";

  function verifyMinified() {}

  var inProduction = typeof process !== "undefined" && "development" === "production" || verifyMinified.name !== "verifyMinified";

  var autoFreeze = !inProduction;
  var useProxies = typeof Proxy !== "undefined";

  function getUseProxies() {
      return useProxies;
  }

  function isProxy(value) {
      return !!value && !!value[PROXY_STATE];
  }

  function isProxyable(value) {
      if (!value) return false;
      if ((typeof value === "undefined" ? "undefined" : _typeof(value)) !== "object") return false;
      if (Array.isArray(value)) return true;
      var proto = Object.getPrototypeOf(value);
      return proto === null || proto === Object.prototype;
  }

  function freeze(value) {
      if (autoFreeze) {
          Object.freeze(value);
      }
      return value;
  }

  var assign = Object.assign || function assign(target, value) {
      for (var key in value) {
          if (has(value, key)) {
              target[key] = value[key];
          }
      }
      return target;
  };

  function shallowCopy(value) {
      if (Array.isArray(value)) return value.slice();
      var target = value.__proto__ === undefined ? Object.create(null) : {};
      return assign(target, value);
  }

  function each(value, cb) {
      if (Array.isArray(value)) {
          for (var i = 0; i < value.length; i++) {
              cb(i, value[i]);
          }
      } else {
          for (var key in value) {
              cb(key, value[key]);
          }
      }
  }

  function has(thing, prop) {
      return Object.prototype.hasOwnProperty.call(thing, prop);
  }

  // given a base object, returns it if unmodified, or return the changed cloned if modified
  function finalize(base) {
      if (isProxy(base)) {
          var state = base[PROXY_STATE];
          if (state.modified === true) {
              if (state.finalized === true) return state.copy;
              state.finalized = true;
              return finalizeObject(useProxies ? state.copy : state.copy = shallowCopy(base), state);
          } else {
              return state.base;
          }
      }
      finalizeNonProxiedObject(base);
      return base;
  }

  function finalizeObject(copy, state) {
      var base = state.base;
      each(copy, function (prop, value) {
          if (value !== base[prop]) copy[prop] = finalize(value);
      });
      return freeze(copy);
  }

  function finalizeNonProxiedObject(parent) {
      // If finalize is called on an object that was not a proxy, it means that it is an object that was not there in the original
      // tree and it could contain proxies at arbitrarily places. Let's find and finalize them as well
      if (!isProxyable(parent)) return;
      if (Object.isFrozen(parent)) return;
      each(parent, function (i, child) {
          if (isProxy(child)) {
              parent[i] = finalize(child);
          } else finalizeNonProxiedObject(child);
      });
      // always freeze completely new data
      freeze(parent);
  }



  function is(x, y) {
      // From: https://github.com/facebook/fbjs/blob/c69904a511b900266935168223063dd8772dfc40/packages/fbjs/src/core/shallowEqual.js
      if (x === y) {
          return x !== 0 || 1 / x === 1 / y;
      } else {
          return x !== x && y !== y;
      }
  }

  // @ts-check

  var proxies = null;

  var objectTraps = {
      get: get$1,
      has: function has$$1(target, prop) {
          return prop in source(target);
      },
      ownKeys: function ownKeys(target) {
          return Reflect.ownKeys(source(target));
      },

      set: set$1,
      deleteProperty: deleteProperty,
      getOwnPropertyDescriptor: getOwnPropertyDescriptor,
      defineProperty: defineProperty$1,
      setPrototypeOf: function setPrototypeOf() {
          throw new Error("Immer does not support `setPrototypeOf()`.");
      }
  };

  var arrayTraps = {};
  each(objectTraps, function (key, fn) {
      arrayTraps[key] = function () {
          arguments[0] = arguments[0][0];
          return fn.apply(this, arguments);
      };
  });

  function createState(parent, base) {
      return {
          modified: false,
          finalized: false,
          parent: parent,
          base: base,
          copy: undefined,
          proxies: {}
      };
  }

  function source(state) {
      return state.modified === true ? state.copy : state.base;
  }

  function get$1(state, prop) {
      if (prop === PROXY_STATE) return state;
      if (state.modified) {
          var value = state.copy[prop];
          if (value === state.base[prop] && isProxyable(value))
              // only create proxy if it is not yet a proxy, and not a new object
              // (new objects don't need proxying, they will be processed in finalize anyway)
              return state.copy[prop] = createProxy(state, value);
          return value;
      } else {
          if (has(state.proxies, prop)) return state.proxies[prop];
          var _value = state.base[prop];
          if (!isProxy(_value) && isProxyable(_value)) return state.proxies[prop] = createProxy(state, _value);
          return _value;
      }
  }

  function set$1(state, prop, value) {
      if (!state.modified) {
          if (prop in state.base && is(state.base[prop], value) || has(state.proxies, prop) && state.proxies[prop] === value) return true;
          markChanged(state);
      }
      state.copy[prop] = value;
      return true;
  }

  function deleteProperty(state, prop) {
      markChanged(state);
      delete state.copy[prop];
      return true;
  }

  function getOwnPropertyDescriptor(state, prop) {
      var owner = state.modified ? state.copy : has(state.proxies, prop) ? state.proxies : state.base;
      var descriptor = Reflect.getOwnPropertyDescriptor(owner, prop);
      if (descriptor && !(Array.isArray(owner) && prop === "length")) descriptor.configurable = true;
      return descriptor;
  }

  function defineProperty$1() {
      throw new Error("Immer does not support defining properties on draft objects.");
  }

  function markChanged(state) {
      if (!state.modified) {
          state.modified = true;
          state.copy = shallowCopy(state.base);
          // copy the proxies over the base-copy
          Object.assign(state.copy, state.proxies); // yup that works for arrays as well
          if (state.parent) markChanged(state.parent);
      }
  }

  // creates a proxy for plain objects / arrays
  function createProxy(parentState, base) {
      if (isProxy(base)) throw new Error("Immer bug. Plz report.");
      var state = createState(parentState, base);
      var proxy = Array.isArray(base) ? Proxy.revocable([state], arrayTraps) : Proxy.revocable(state, objectTraps);
      proxies.push(proxy);
      return proxy.proxy;
  }

  function produceProxy(baseState, producer) {
      if (isProxy(baseState)) {
          // See #100, don't nest producers
          var returnValue = producer.call(baseState, baseState);
          return returnValue === undefined ? baseState : returnValue;
      }
      var previousProxies = proxies;
      proxies = [];
      try {
          // create proxy for root
          var rootProxy = createProxy(undefined, baseState);
          // execute the thunk
          var _returnValue = producer.call(rootProxy, rootProxy);
          // and finalize the modified proxy
          var result = void 0;
          // check whether the draft was modified and/or a value was returned
          if (_returnValue !== undefined && _returnValue !== rootProxy) {
              // something was returned, and it wasn't the proxy itself
              if (rootProxy[PROXY_STATE].modified) throw new Error(RETURNED_AND_MODIFIED_ERROR);

              // See #117
              // Should we just throw when returning a proxy which is not the root, but a subset of the original state?
              // Looks like a wrongly modeled reducer
              result = finalize(_returnValue);
          } else {
              result = finalize(rootProxy);
          }
          // revoke all proxies
          each(proxies, function (_, p) {
              return p.revoke();
          });
          return result;
      } finally {
          proxies = previousProxies;
      }
  }

  // @ts-check

  var descriptors = {};
  var states = null;

  function createState$1(parent, proxy, base) {
      return {
          modified: false,
          hasCopy: false,
          parent: parent,
          base: base,
          proxy: proxy,
          copy: undefined,
          finished: false,
          finalizing: false,
          finalized: false
      };
  }

  function source$1(state) {
      return state.hasCopy ? state.copy : state.base;
  }

  function _get(state, prop) {
      assertUnfinished(state);
      var value = source$1(state)[prop];
      if (!state.finalizing && value === state.base[prop] && isProxyable(value)) {
          // only create a proxy if the value is proxyable, and the value was in the base state
          // if it wasn't in the base state, the object is already modified and we will process it in finalize
          prepareCopy(state);
          return state.copy[prop] = createProxy$1(state, value);
      }
      return value;
  }

  function _set(state, prop, value) {
      assertUnfinished(state);
      if (!state.modified) {
          if (is(source$1(state)[prop], value)) return;
          markChanged$1(state);
          prepareCopy(state);
      }
      state.copy[prop] = value;
  }

  function markChanged$1(state) {
      if (!state.modified) {
          state.modified = true;
          if (state.parent) markChanged$1(state.parent);
      }
  }

  function prepareCopy(state) {
      if (state.hasCopy) return;
      state.hasCopy = true;
      state.copy = shallowCopy(state.base);
  }

  // creates a proxy for plain objects / arrays
  function createProxy$1(parent, base) {
      var proxy = shallowCopy(base);
      each(base, function (i) {
          Object.defineProperty(proxy, "" + i, createPropertyProxy("" + i));
      });
      var state = createState$1(parent, proxy, base);
      createHiddenProperty(proxy, PROXY_STATE, state);
      states.push(state);
      return proxy;
  }

  function createPropertyProxy(prop) {
      return descriptors[prop] || (descriptors[prop] = {
          configurable: true,
          enumerable: true,
          get: function get$$1() {
              return _get(this[PROXY_STATE], prop);
          },
          set: function set$$1(value) {
              _set(this[PROXY_STATE], prop, value);
          }
      });
  }

  function assertUnfinished(state) {
      if (state.finished === true) throw new Error("Cannot use a proxy that has been revoked. Did you pass an object from inside an immer function to an async process? " + JSON.stringify(state.copy || state.base));
  }

  // this sounds very expensive, but actually it is not that expensive in practice
  // as it will only visit proxies, and only do key-based change detection for objects for
  // which it is not already know that they are changed (that is, only object for which no known key was changed)
  function markChanges() {
      // intentionally we process the proxies in reverse order;
      // ideally we start by processing leafs in the tree, because if a child has changed, we don't have to check the parent anymore
      // reverse order of proxy creation approximates this
      for (var i = states.length - 1; i >= 0; i--) {
          var state = states[i];
          if (state.modified === false) {
              if (Array.isArray(state.base)) {
                  if (hasArrayChanges(state)) markChanged$1(state);
              } else if (hasObjectChanges(state)) markChanged$1(state);
          }
      }
  }

  function hasObjectChanges(state) {
      var baseKeys = Object.keys(state.base);
      var keys = Object.keys(state.proxy);
      return !shallowEqual(baseKeys, keys);
  }

  function hasArrayChanges(state) {
      var proxy = state.proxy;

      if (proxy.length !== state.base.length) return true;
      // See #116
      // If we first shorten the length, our array interceptors will be removed.
      // If after that new items are added, result in the same original length,
      // those last items will have no intercepting property.
      // So if there is no own descriptor on the last position, we know that items were removed and added
      // N.B.: splice, unshift, etc only shift values around, but not prop descriptors, so we only have to check
      // the last one
      var descriptor = Object.getOwnPropertyDescriptor(proxy, proxy.length - 1);
      // descriptor can be null, but only for newly created sparse arrays, eg. new Array(10)
      if (descriptor && !descriptor.get) return true;
      // For all other cases, we don't have to compare, as they would have been picked up by the index setters
      return false;
  }

  function produceEs5(baseState, producer) {
      if (isProxy(baseState)) {
          // See #100, don't nest producers
          var returnValue = producer.call(baseState, baseState);
          return returnValue === undefined ? baseState : returnValue;
      }
      var prevStates = states;
      states = [];
      try {
          // create proxy for root
          var rootProxy = createProxy$1(undefined, baseState);
          // execute the thunk
          var _returnValue = producer.call(rootProxy, rootProxy);
          // and finalize the modified proxy
          each(states, function (_, state) {
              state.finalizing = true;
          });
          // find and mark all changes (for parts not done yet)
          // TODO: store states by depth, to be able guarantee processing leaves first
          markChanges();
          var result = void 0;
          // check whether the draft was modified and/or a value was returned
          if (_returnValue !== undefined && _returnValue !== rootProxy) {
              // something was returned, and it wasn't the proxy itself
              if (rootProxy[PROXY_STATE].modified) throw new Error(RETURNED_AND_MODIFIED_ERROR);
              result = finalize(_returnValue);
          } else result = finalize(rootProxy);
          // make sure all proxies become unusable
          each(states, function (_, state) {
              state.finished = true;
          });
          return result;
      } finally {
          states = prevStates;
      }
  }

  function shallowEqual(objA, objB) {
      //From: https://github.com/facebook/fbjs/blob/c69904a511b900266935168223063dd8772dfc40/packages/fbjs/src/core/shallowEqual.js
      if (is(objA, objB)) return true;
      if ((typeof objA === "undefined" ? "undefined" : _typeof(objA)) !== "object" || objA === null || (typeof objB === "undefined" ? "undefined" : _typeof(objB)) !== "object" || objB === null) {
          return false;
      }
      var keysA = Object.keys(objA);
      var keysB = Object.keys(objB);
      if (keysA.length !== keysB.length) return false;
      for (var i = 0; i < keysA.length; i++) {
          if (!hasOwnProperty.call(objB, keysA[i]) || !is(objA[keysA[i]], objB[keysA[i]])) {
              return false;
          }
      }
      return true;
  }

  function createHiddenProperty(target, prop, value) {
      Object.defineProperty(target, prop, {
          value: value,
          enumerable: false,
          writable: true
      });
  }

  /**
   * produce takes a state, and runs a function against it.
   * That function can freely mutate the state, as it will create copies-on-write.
   * This means that the original state will stay unchanged, and once the function finishes, the modified state is returned
   *
   * @export
   * @param {any} baseState - the state to start with
   * @param {Function} producer - function that receives a proxy of the base state as first argument and which can be freely modified
   * @returns {any} a new state, or the base state if nothing was modified
   */
  function produce(baseState, producer) {
      // prettier-ignore
      if (arguments.length !== 1 && arguments.length !== 2) throw new Error("produce expects 1 or 2 arguments, got " + arguments.length);

      // curried invocation
      if (typeof baseState === "function") {
          // prettier-ignore
          if (typeof producer === "function") throw new Error("if first argument is a function (curried invocation), the second argument to produce cannot be a function");

          var initialState = producer;
          var recipe = baseState;

          return function () {
              var args = arguments;

              var currentState = args[0] === undefined && initialState !== undefined ? initialState : args[0];

              return produce(currentState, function (draft) {
                  args[0] = draft; // blegh!
                  return recipe.apply(draft, args);
              });
          };
      }

      // prettier-ignore
      {
          if (typeof producer !== "function") throw new Error("if first argument is not a function, the second argument to produce should be a function");
      }

      // if state is a primitive, don't bother proxying at all
      if ((typeof baseState === "undefined" ? "undefined" : _typeof(baseState)) !== "object" || baseState === null) {
          var returnValue = producer(baseState);
          return returnValue === undefined ? baseState : returnValue;
      }

      if (!isProxyable(baseState)) throw new Error("the first argument to an immer producer should be a primitive, plain object or array, got " + (typeof baseState === "undefined" ? "undefined" : _typeof(baseState)) + ": \"" + baseState + "\"");
      return getUseProxies() ? produceProxy(baseState, producer) : produceEs5(baseState, producer);
  }

  var NO_OP = '$NO_OP';
  var ERROR_MSG = 'a runtime error occured! Use Inferno in development environment to find the error.';
  // This should be boolean and not reference to window.document
  var isBrowser = !!(typeof window !== 'undefined' && window.document);
  // this is MUCH faster than .constructor === Array and instanceof Array
  // in Node 7 and the later versions of V8, slower in older versions though
  var isArray = Array.isArray;
  function isStringOrNumber(o) {
      var type = typeof o;
      return type === 'string' || type === 'number';
  }
  function isNullOrUndef(o) {
      return isUndefined(o) || isNull(o);
  }
  function isInvalid(o) {
      return isNull(o) || o === false || isTrue(o) || isUndefined(o);
  }
  function isFunction(o) {
      return typeof o === 'function';
  }
  function isString(o) {
      return typeof o === 'string';
  }
  function isNumber(o) {
      return typeof o === 'number';
  }
  function isNull(o) {
      return o === null;
  }
  function isTrue(o) {
      return o === true;
  }
  function isUndefined(o) {
      return o === void 0;
  }
  function isObject(o) {
      return typeof o === 'object';
  }
  function throwError(message) {
      if (!message) {
          message = ERROR_MSG;
      }
      throw new Error(("Inferno Error: " + message));
  }
  function combineFrom(first, second) {
      var out = {};
      if (first) {
          for (var key in first) {
              out[key] = first[key];
          }
      }
      if (second) {
          for (var key$1 in second) {
              out[key$1] = second[key$1];
          }
      }
      return out;
  }

  var keyPrefix = '$';
  function getVNode(childFlags, children, className, flags, key, props, ref, type) {
      return {
          childFlags: childFlags,
          children: children,
          className: className,
          dom: null,
          flags: flags,
          key: key === void 0 ? null : key,
          parentVNode: null,
          props: props === void 0 ? null : props,
          ref: ref === void 0 ? null : ref,
          type: type
      };
  }
  function createVNode(flags, type, className, children, childFlags, props, key, ref) {
      var childFlag = childFlags === void 0 ? 1 /* HasInvalidChildren */ : childFlags;
      var vNode = getVNode(childFlag, children, className, flags, key, props, ref, type);
      if (childFlag === 0 /* UnknownChildren */) {
          normalizeChildren(vNode, vNode.children);
      }
      return vNode;
  }
  function createComponentVNode(flags, type, props, key, ref) {
      if ((flags & 2 /* ComponentUnknown */) > 0) {
          flags = type.prototype && isFunction(type.prototype.render) ? 4 /* ComponentClass */ : 8 /* ComponentFunction */;
      }
      // set default props
      var defaultProps = type.defaultProps;
      if (!isNullOrUndef(defaultProps)) {
          if (!props) {
              props = {}; // Props can be referenced and modified at application level so always create new object
          }
          for (var prop in defaultProps) {
              if (isUndefined(props[prop])) {
                  props[prop] = defaultProps[prop];
              }
          }
      }
      if ((flags & 8 /* ComponentFunction */) > 0) {
          var defaultHooks = type.defaultHooks;
          if (!isNullOrUndef(defaultHooks)) {
              if (!ref) {
                  // As ref cannot be referenced from application level, we can use the same refs object
                  ref = defaultHooks;
              }
              else {
                  for (var prop$1 in defaultHooks) {
                      if (isUndefined(ref[prop$1])) {
                          ref[prop$1] = defaultHooks[prop$1];
                      }
                  }
              }
          }
      }
      var vNode = getVNode(1 /* HasInvalidChildren */, null, null, flags, key, props, ref, type);
      var optsVNode = options.createVNode;
      if (isFunction(optsVNode)) {
          optsVNode(vNode);
      }
      return vNode;
  }
  function createTextVNode(text, key) {
      return getVNode(1 /* HasInvalidChildren */, isNullOrUndef(text) ? '' : text, null, 16 /* Text */, key, null, null, null);
  }
  function directClone(vNodeToClone) {
      var newVNode;
      var flags = vNodeToClone.flags;
      if (flags & 14 /* Component */) {
          var props;
          var propsToClone = vNodeToClone.props;
          if (!isNull(propsToClone)) {
              props = {};
              for (var key in propsToClone) {
                  props[key] = propsToClone[key];
              }
          }
          newVNode = createComponentVNode(flags, vNodeToClone.type, props, vNodeToClone.key, vNodeToClone.ref);
      }
      else if (flags & 481 /* Element */) {
          var children = vNodeToClone.children;
          newVNode = createVNode(flags, vNodeToClone.type, vNodeToClone.className, children, vNodeToClone.childFlags, vNodeToClone.props, vNodeToClone.key, vNodeToClone.ref);
      }
      else if (flags & 16 /* Text */) {
          newVNode = createTextVNode(vNodeToClone.children, vNodeToClone.key);
      }
      else if (flags & 1024 /* Portal */) {
          newVNode = vNodeToClone;
      }
      return newVNode;
  }
  function createVoidVNode() {
      return createTextVNode('', null);
  }
  function _normalizeVNodes(nodes, result, index, currentKey) {
      for (var len = nodes.length; index < len; index++) {
          var n = nodes[index];
          if (!isInvalid(n)) {
              var newKey = currentKey + keyPrefix + index;
              if (isArray(n)) {
                  _normalizeVNodes(n, result, 0, newKey);
              }
              else {
                  if (isStringOrNumber(n)) {
                      n = createTextVNode(n, newKey);
                  }
                  else {
                      var oldKey = n.key;
                      var isPrefixedKey = isString(oldKey) && oldKey[0] === keyPrefix;
                      if (!isNull(n.dom) || isPrefixedKey) {
                          n = directClone(n);
                      }
                      if (isNull(oldKey) || isPrefixedKey) {
                          n.key = newKey;
                      }
                      else {
                          n.key = currentKey + oldKey;
                      }
                  }
                  result.push(n);
              }
          }
      }
  }
  function normalizeChildren(vNode, children) {
      var newChildren;
      var newChildFlags = 1 /* HasInvalidChildren */;
      // Don't change children to match strict equal (===) true in patching
      if (isInvalid(children)) {
          newChildren = children;
      }
      else if (isString(children)) {
          newChildFlags = 2 /* HasVNodeChildren */;
          newChildren = createTextVNode(children);
      }
      else if (isNumber(children)) {
          newChildFlags = 2 /* HasVNodeChildren */;
          newChildren = createTextVNode(children + '');
      }
      else if (isArray(children)) {
          var len = children.length;
          if (len === 0) {
              newChildren = null;
              newChildFlags = 1 /* HasInvalidChildren */;
          }
          else {
              // we assign $ which basically means we've flagged this array for future note
              // if it comes back again, we need to clone it, as people are using it
              // in an immutable way
              // tslint:disable-next-line
              if (Object.isFrozen(children) || children['$'] === true) {
                  children = children.slice();
              }
              newChildFlags = 8 /* HasKeyedChildren */;
              for (var i = 0; i < len; i++) {
                  var n = children[i];
                  if (isInvalid(n) || isArray(n)) {
                      newChildren = newChildren || children.slice(0, i);
                      _normalizeVNodes(children, newChildren, i, '');
                      break;
                  }
                  else if (isStringOrNumber(n)) {
                      newChildren = newChildren || children.slice(0, i);
                      newChildren.push(createTextVNode(n, keyPrefix + i));
                  }
                  else {
                      var key = n.key;
                      var isNullDom = isNull(n.dom);
                      var isNullKey = isNull(key);
                      var isPrefixed = !isNullKey && key[0] === keyPrefix;
                      if (!isNullDom || isNullKey || isPrefixed) {
                          newChildren = newChildren || children.slice(0, i);
                          if (!isNullDom || isPrefixed) {
                              n = directClone(n);
                          }
                          if (isNullKey || isPrefixed) {
                              n.key = keyPrefix + i;
                          }
                          newChildren.push(n);
                      }
                      else if (newChildren) {
                          newChildren.push(n);
                      }
                  }
              }
              newChildren = newChildren || children;
              newChildren.$ = true;
          }
      }
      else {
          newChildren = children;
          if (!isNull(children.dom)) {
              newChildren = directClone(children);
          }
          newChildFlags = 2 /* HasVNodeChildren */;
      }
      vNode.children = newChildren;
      vNode.childFlags = newChildFlags;
      return vNode;
  }
  var options = {
      afterMount: null,
      afterRender: null,
      afterUpdate: null,
      beforeRender: null,
      beforeUnmount: null,
      createVNode: null,
      roots: []
  };

  var xlinkNS = 'http://www.w3.org/1999/xlink';
  var xmlNS = 'http://www.w3.org/XML/1998/namespace';
  var svgNS = 'http://www.w3.org/2000/svg';
  var namespaces = {
      'xlink:actuate': xlinkNS,
      'xlink:arcrole': xlinkNS,
      'xlink:href': xlinkNS,
      'xlink:role': xlinkNS,
      'xlink:show': xlinkNS,
      'xlink:title': xlinkNS,
      'xlink:type': xlinkNS,
      'xml:base': xmlNS,
      'xml:lang': xmlNS,
      'xml:space': xmlNS
  };

  // We need EMPTY_OBJ defined in one place.
  // Its used for comparison so we cant inline it into shared
  var EMPTY_OBJ = {};
  var LIFECYCLE = [];
  function appendChild(parentDom, dom) {
      parentDom.appendChild(dom);
  }
  function insertOrAppend(parentDom, newNode, nextNode) {
      if (isNullOrUndef(nextNode)) {
          appendChild(parentDom, newNode);
      }
      else {
          parentDom.insertBefore(newNode, nextNode);
      }
  }
  function documentCreateElement(tag, isSVG) {
      if (isSVG === true) {
          return document.createElementNS(svgNS, tag);
      }
      return document.createElement(tag);
  }
  function replaceChild(parentDom, newDom, lastDom) {
      parentDom.replaceChild(newDom, lastDom);
  }
  function removeChild(parentDom, dom) {
      parentDom.removeChild(dom);
  }
  function callAll(arrayFn) {
      var listener;
      while ((listener = arrayFn.shift()) !== undefined) {
          listener();
      }
  }

  var attachedEventCounts = {};
  var attachedEvents = {};
  function handleEvent(name, nextEvent, dom) {
      var eventsLeft = attachedEventCounts[name];
      var eventsObject = dom.$EV;
      if (nextEvent) {
          if (!eventsLeft) {
              attachedEvents[name] = attachEventToDocument(name);
              attachedEventCounts[name] = 0;
          }
          if (!eventsObject) {
              eventsObject = dom.$EV = {};
          }
          if (!eventsObject[name]) {
              attachedEventCounts[name]++;
          }
          eventsObject[name] = nextEvent;
      }
      else if (eventsObject && eventsObject[name]) {
          attachedEventCounts[name]--;
          if (eventsLeft === 1) {
              document.removeEventListener(normalizeEventName(name), attachedEvents[name]);
              attachedEvents[name] = null;
          }
          eventsObject[name] = nextEvent;
      }
  }
  function dispatchEvents(event, target, isClick, name, eventData) {
      var dom = target;
      while (!isNull(dom)) {
          // Html Nodes can be nested fe: span inside button in that scenario browser does not handle disabled attribute on parent,
          // because the event listener is on document.body
          // Don't process clicks on disabled elements
          if (isClick && dom.disabled) {
              return;
          }
          var eventsObject = dom.$EV;
          if (eventsObject) {
              var currentEvent = eventsObject[name];
              if (currentEvent) {
                  // linkEvent object
                  eventData.dom = dom;
                  if (currentEvent.event) {
                      currentEvent.event(currentEvent.data, event);
                  }
                  else {
                      currentEvent(event);
                  }
                  if (event.cancelBubble) {
                      return;
                  }
              }
          }
          dom = dom.parentNode;
      }
  }
  function normalizeEventName(name) {
      return name.substr(2).toLowerCase();
  }
  function stopPropagation() {
      this.cancelBubble = true;
      if (!this.immediatePropagationStopped) {
          this.stopImmediatePropagation();
      }
  }
  function attachEventToDocument(name) {
      var docEvent = function (event) {
          var type = event.type;
          var isClick = type === 'click' || type === 'dblclick';
          if (isClick && event.button !== 0) {
              // Firefox incorrectly triggers click event for mid/right mouse buttons.
              // This bug has been active for 12 years.
              // https://bugzilla.mozilla.org/show_bug.cgi?id=184051
              event.preventDefault();
              event.stopPropagation();
              return false;
          }
          event.stopPropagation = stopPropagation;
          // Event data needs to be object to save reference to currentTarget getter
          var eventData = {
              dom: document
          };
          Object.defineProperty(event, 'currentTarget', {
              configurable: true,
              get: function get() {
                  return eventData.dom;
              }
          });
          dispatchEvents(event, event.target, isClick, name, eventData);
          return;
      };
      document.addEventListener(normalizeEventName(name), docEvent);
      return docEvent;
  }

  function isSameInnerHTML(dom, innerHTML) {
      var tempdom = document.createElement('i');
      tempdom.innerHTML = innerHTML;
      return tempdom.innerHTML === dom.innerHTML;
  }
  function isSamePropsInnerHTML(dom, props) {
      return Boolean(props && props.dangerouslySetInnerHTML && props.dangerouslySetInnerHTML.__html && isSameInnerHTML(dom, props.dangerouslySetInnerHTML.__html));
  }

  function triggerEventListener(props, methodName, e) {
      if (props[methodName]) {
          var listener = props[methodName];
          if (listener.event) {
              listener.event(listener.data, e);
          }
          else {
              listener(e);
          }
      }
      else {
          var nativeListenerName = methodName.toLowerCase();
          if (props[nativeListenerName]) {
              props[nativeListenerName](e);
          }
      }
  }
  function createWrappedFunction(methodName, applyValue) {
      var fnMethod = function (e) {
          e.stopPropagation();
          var vNode = this.$V;
          // If vNode is gone by the time event fires, no-op
          if (!vNode) {
              return;
          }
          var props = vNode.props || EMPTY_OBJ;
          var dom = vNode.dom;
          if (isString(methodName)) {
              triggerEventListener(props, methodName, e);
          }
          else {
              for (var i = 0; i < methodName.length; i++) {
                  triggerEventListener(props, methodName[i], e);
              }
          }
          if (isFunction(applyValue)) {
              var newVNode = this.$V;
              var newProps = newVNode.props || EMPTY_OBJ;
              applyValue(newProps, dom, false, newVNode);
          }
      };
      Object.defineProperty(fnMethod, 'wrapped', {
          configurable: false,
          enumerable: false,
          value: true,
          writable: false
      });
      return fnMethod;
  }

  function isCheckedType(type) {
      return type === 'checkbox' || type === 'radio';
  }
  var onTextInputChange = createWrappedFunction('onInput', applyValueInput);
  var wrappedOnChange = createWrappedFunction(['onClick', 'onChange'], applyValueInput);
  /* tslint:disable-next-line:no-empty */
  function emptywrapper(event) {
      event.stopPropagation();
  }
  emptywrapper.wrapped = true;
  function inputEvents(dom, nextPropsOrEmpty) {
      if (isCheckedType(nextPropsOrEmpty.type)) {
          dom.onchange = wrappedOnChange;
          dom.onclick = emptywrapper;
      }
      else {
          dom.oninput = onTextInputChange;
      }
  }
  function applyValueInput(nextPropsOrEmpty, dom) {
      var type = nextPropsOrEmpty.type;
      var value = nextPropsOrEmpty.value;
      var checked = nextPropsOrEmpty.checked;
      var multiple = nextPropsOrEmpty.multiple;
      var defaultValue = nextPropsOrEmpty.defaultValue;
      var hasValue = !isNullOrUndef(value);
      if (type && type !== dom.type) {
          dom.setAttribute('type', type);
      }
      if (!isNullOrUndef(multiple) && multiple !== dom.multiple) {
          dom.multiple = multiple;
      }
      if (!isNullOrUndef(defaultValue) && !hasValue) {
          dom.defaultValue = defaultValue + '';
      }
      if (isCheckedType(type)) {
          if (hasValue) {
              dom.value = value;
          }
          if (!isNullOrUndef(checked)) {
              dom.checked = checked;
          }
      }
      else {
          if (hasValue && dom.value !== value) {
              dom.defaultValue = value;
              dom.value = value;
          }
          else if (!isNullOrUndef(checked)) {
              dom.checked = checked;
          }
      }
  }

  function updateChildOptionGroup(vNode, value) {
      var type = vNode.type;
      if (type === 'optgroup') {
          var children = vNode.children;
          var childFlags = vNode.childFlags;
          if (childFlags & 12 /* MultipleChildren */) {
              for (var i = 0, len = children.length; i < len; i++) {
                  updateChildOption(children[i], value);
              }
          }
          else if (childFlags === 2 /* HasVNodeChildren */) {
              updateChildOption(children, value);
          }
      }
      else {
          updateChildOption(vNode, value);
      }
  }
  function updateChildOption(vNode, value) {
      var props = vNode.props || EMPTY_OBJ;
      var dom = vNode.dom;
      // we do this as multiple may have changed
      dom.value = props.value;
      if ((isArray(value) && value.indexOf(props.value) !== -1) || props.value === value) {
          dom.selected = true;
      }
      else if (!isNullOrUndef(value) || !isNullOrUndef(props.selected)) {
          dom.selected = props.selected || false;
      }
  }
  var onSelectChange = createWrappedFunction('onChange', applyValueSelect);
  function selectEvents(dom) {
      dom.onchange = onSelectChange;
  }
  function applyValueSelect(nextPropsOrEmpty, dom, mounting, vNode) {
      var multiplePropInBoolean = Boolean(nextPropsOrEmpty.multiple);
      if (!isNullOrUndef(nextPropsOrEmpty.multiple) && multiplePropInBoolean !== dom.multiple) {
          dom.multiple = multiplePropInBoolean;
      }
      var childFlags = vNode.childFlags;
      if ((childFlags & 1 /* HasInvalidChildren */) === 0) {
          var children = vNode.children;
          var value = nextPropsOrEmpty.value;
          if (mounting && isNullOrUndef(value)) {
              value = nextPropsOrEmpty.defaultValue;
          }
          if (childFlags & 12 /* MultipleChildren */) {
              for (var i = 0, len = children.length; i < len; i++) {
                  updateChildOptionGroup(children[i], value);
              }
          }
          else if (childFlags === 2 /* HasVNodeChildren */) {
              updateChildOptionGroup(children, value);
          }
      }
  }

  var onTextareaInputChange = createWrappedFunction('onInput', applyValueTextArea);
  var wrappedOnChange$1 = createWrappedFunction('onChange');
  function textAreaEvents(dom, nextPropsOrEmpty) {
      dom.oninput = onTextareaInputChange;
      if (nextPropsOrEmpty.onChange) {
          dom.onchange = wrappedOnChange$1;
      }
  }
  function applyValueTextArea(nextPropsOrEmpty, dom, mounting) {
      var value = nextPropsOrEmpty.value;
      var domValue = dom.value;
      if (isNullOrUndef(value)) {
          if (mounting) {
              var defaultValue = nextPropsOrEmpty.defaultValue;
              if (!isNullOrUndef(defaultValue) && defaultValue !== domValue) {
                  dom.defaultValue = defaultValue;
                  dom.value = defaultValue;
              }
          }
      }
      else if (domValue !== value) {
          /* There is value so keep it controlled */
          dom.defaultValue = value;
          dom.value = value;
      }
  }

  /**
   * There is currently no support for switching same input between controlled and nonControlled
   * If that ever becomes a real issue, then re design controlled elements
   * Currently user must choose either controlled or non-controlled and stick with that
   */
  function processElement(flags, vNode, dom, nextPropsOrEmpty, mounting, isControlled) {
      if (flags & 64 /* InputElement */) {
          applyValueInput(nextPropsOrEmpty, dom);
      }
      else if (flags & 256 /* SelectElement */) {
          applyValueSelect(nextPropsOrEmpty, dom, mounting, vNode);
      }
      else if (flags & 128 /* TextareaElement */) {
          applyValueTextArea(nextPropsOrEmpty, dom, mounting);
      }
      if (isControlled) {
          dom.$V = vNode;
      }
  }
  function addFormElementEventHandlers(flags, dom, nextPropsOrEmpty) {
      if (flags & 64 /* InputElement */) {
          inputEvents(dom, nextPropsOrEmpty);
      }
      else if (flags & 256 /* SelectElement */) {
          selectEvents(dom);
      }
      else if (flags & 128 /* TextareaElement */) {
          textAreaEvents(dom, nextPropsOrEmpty);
      }
  }
  function isControlledFormElement(nextPropsOrEmpty) {
      return nextPropsOrEmpty.type && isCheckedType(nextPropsOrEmpty.type) ? !isNullOrUndef(nextPropsOrEmpty.checked) : !isNullOrUndef(nextPropsOrEmpty.value);
  }

  function remove(vNode, parentDom) {
      unmount(vNode);
      if (!isNull(parentDom)) {
          removeChild(parentDom, vNode.dom);
          // Let carbage collector free memory
          vNode.dom = null;
      }
  }
  function unmount(vNode) {
      var flags = vNode.flags;
      if (flags & 481 /* Element */) {
          var ref = vNode.ref;
          var props = vNode.props;
          if (isFunction(ref)) {
              ref(null);
          }
          var children = vNode.children;
          var childFlags = vNode.childFlags;
          if (childFlags & 12 /* MultipleChildren */) {
              unmountAllChildren(children);
          }
          else if (childFlags === 2 /* HasVNodeChildren */) {
              unmount(children);
          }
          if (!isNull(props)) {
              for (var name in props) {
                  switch (name) {
                      case 'onClick':
                      case 'onDblClick':
                      case 'onFocusIn':
                      case 'onFocusOut':
                      case 'onKeyDown':
                      case 'onKeyPress':
                      case 'onKeyUp':
                      case 'onMouseDown':
                      case 'onMouseMove':
                      case 'onMouseUp':
                      case 'onSubmit':
                      case 'onTouchEnd':
                      case 'onTouchMove':
                      case 'onTouchStart':
                          handleEvent(name, null, vNode.dom);
                          break;
                      default:
                          break;
                  }
              }
          }
      }
      else if (flags & 14 /* Component */) {
          var instance = vNode.children;
          var ref$1 = vNode.ref;
          if (flags & 4 /* ComponentClass */) {
              if (isFunction(options.beforeUnmount)) {
                  options.beforeUnmount(vNode);
              }
              if (isFunction(instance.componentWillUnmount)) {
                  instance.componentWillUnmount();
              }
              if (isFunction(ref$1)) {
                  ref$1(null);
              }
              instance.$UN = true;
              unmount(instance.$LI);
          }
          else {
              if (!isNullOrUndef(ref$1) && isFunction(ref$1.onComponentWillUnmount)) {
                  ref$1.onComponentWillUnmount(vNode.dom, vNode.props || EMPTY_OBJ);
              }
              unmount(instance);
          }
      }
      else if (flags & 1024 /* Portal */) {
          var children$1 = vNode.children;
          if (!isNull(children$1) && isObject(children$1)) {
              remove(children$1, vNode.type);
          }
      }
  }
  function unmountAllChildren(children) {
      for (var i = 0, len = children.length; i < len; i++) {
          unmount(children[i]);
      }
  }
  function removeAllChildren(dom, children) {
      unmountAllChildren(children);
      dom.textContent = '';
  }

  function createLinkEvent(linkEvent, nextValue) {
      return function (e) {
          linkEvent(nextValue.data, e);
      };
  }
  function patchEvent(name, lastValue, nextValue, dom) {
      var nameLowerCase = name.toLowerCase();
      if (!isFunction(nextValue) && !isNullOrUndef(nextValue)) {
          var linkEvent = nextValue.event;
          if (linkEvent && isFunction(linkEvent)) {
              dom[nameLowerCase] = createLinkEvent(linkEvent, nextValue);
          }
      }
      else {
          var domEvent = dom[nameLowerCase];
          // if the function is wrapped, that means it's been controlled by a wrapper
          if (!domEvent || !domEvent.wrapped) {
              dom[nameLowerCase] = nextValue;
          }
      }
  }
  function getNumberStyleValue(style, value) {
      switch (style) {
          case 'animationIterationCount':
          case 'borderImageOutset':
          case 'borderImageSlice':
          case 'borderImageWidth':
          case 'boxFlex':
          case 'boxFlexGroup':
          case 'boxOrdinalGroup':
          case 'columnCount':
          case 'fillOpacity':
          case 'flex':
          case 'flexGrow':
          case 'flexNegative':
          case 'flexOrder':
          case 'flexPositive':
          case 'flexShrink':
          case 'floodOpacity':
          case 'fontWeight':
          case 'gridColumn':
          case 'gridRow':
          case 'lineClamp':
          case 'lineHeight':
          case 'opacity':
          case 'order':
          case 'orphans':
          case 'stopOpacity':
          case 'strokeDasharray':
          case 'strokeDashoffset':
          case 'strokeMiterlimit':
          case 'strokeOpacity':
          case 'strokeWidth':
          case 'tabSize':
          case 'widows':
          case 'zIndex':
          case 'zoom':
              return value;
          default:
              return value + 'px';
      }
  }
  // We are assuming here that we come from patchProp routine
  // -nextAttrValue cannot be null or undefined
  function patchStyle(lastAttrValue, nextAttrValue, dom) {
      var domStyle = dom.style;
      var style;
      var value;
      if (isString(nextAttrValue)) {
          domStyle.cssText = nextAttrValue;
          return;
      }
      if (!isNullOrUndef(lastAttrValue) && !isString(lastAttrValue)) {
          for (style in nextAttrValue) {
              // do not add a hasOwnProperty check here, it affects performance
              value = nextAttrValue[style];
              if (value !== lastAttrValue[style]) {
                  domStyle[style] = isNumber(value) ? getNumberStyleValue(style, value) : value;
              }
          }
          for (style in lastAttrValue) {
              if (isNullOrUndef(nextAttrValue[style])) {
                  domStyle[style] = '';
              }
          }
      }
      else {
          for (style in nextAttrValue) {
              value = nextAttrValue[style];
              domStyle[style] = isNumber(value) ? getNumberStyleValue(style, value) : value;
          }
      }
  }
  function patchProp(prop, lastValue, nextValue, dom, isSVG, hasControlledValue, lastVNode) {
      switch (prop) {
          case 'onClick':
          case 'onDblClick':
          case 'onFocusIn':
          case 'onFocusOut':
          case 'onKeyDown':
          case 'onKeyPress':
          case 'onKeyUp':
          case 'onMouseDown':
          case 'onMouseMove':
          case 'onMouseUp':
          case 'onSubmit':
          case 'onTouchEnd':
          case 'onTouchMove':
          case 'onTouchStart':
              handleEvent(prop, nextValue, dom);
              break;
          case 'children':
          case 'childrenType':
          case 'className':
          case 'defaultValue':
          case 'key':
          case 'multiple':
          case 'ref':
              return;
          case 'allowfullscreen':
          case 'autoFocus':
          case 'autoplay':
          case 'capture':
          case 'checked':
          case 'controls':
          case 'default':
          case 'disabled':
          case 'hidden':
          case 'indeterminate':
          case 'loop':
          case 'muted':
          case 'novalidate':
          case 'open':
          case 'readOnly':
          case 'required':
          case 'reversed':
          case 'scoped':
          case 'seamless':
          case 'selected':
              prop = prop === 'autoFocus' ? prop.toLowerCase() : prop;
              dom[prop] = !!nextValue;
              break;
          case 'defaultChecked':
          case 'value':
          case 'volume':
              if (hasControlledValue && prop === 'value') {
                  return;
              }
              var value = isNullOrUndef(nextValue) ? '' : nextValue;
              if (dom[prop] !== value) {
                  dom[prop] = value;
              }
              break;
          case 'dangerouslySetInnerHTML':
              var lastHtml = (lastValue && lastValue.__html) || '';
              var nextHtml = (nextValue && nextValue.__html) || '';
              if (lastHtml !== nextHtml) {
                  if (!isNullOrUndef(nextHtml) && !isSameInnerHTML(dom, nextHtml)) {
                      if (!isNull(lastVNode)) {
                          if (lastVNode.childFlags & 12 /* MultipleChildren */) {
                              unmountAllChildren(lastVNode.children);
                          }
                          else if (lastVNode.childFlags === 2 /* HasVNodeChildren */) {
                              unmount(lastVNode.children);
                          }
                          lastVNode.children = null;
                          lastVNode.childFlags = 1 /* HasInvalidChildren */;
                      }
                      dom.innerHTML = nextHtml;
                  }
              }
              break;
          default:
              if (prop[0] === 'o' && prop[1] === 'n') {
                  patchEvent(prop, lastValue, nextValue, dom);
              }
              else if (isNullOrUndef(nextValue)) {
                  dom.removeAttribute(prop);
              }
              else if (prop === 'style') {
                  patchStyle(lastValue, nextValue, dom);
              }
              else if (isSVG && namespaces[prop]) {
                  // We optimize for NS being boolean. Its 99.9% time false
                  // If we end up in this path we can read property again
                  dom.setAttributeNS(namespaces[prop], prop, nextValue);
              }
              else {
                  dom.setAttribute(prop, nextValue);
              }
              break;
      }
  }
  function mountProps(vNode, flags, props, dom, isSVG) {
      var hasControlledValue = false;
      var isFormElement = (flags & 448 /* FormElement */) > 0;
      if (isFormElement) {
          hasControlledValue = isControlledFormElement(props);
          if (hasControlledValue) {
              addFormElementEventHandlers(flags, dom, props);
          }
      }
      for (var prop in props) {
          // do not add a hasOwnProperty check here, it affects performance
          patchProp(prop, null, props[prop], dom, isSVG, hasControlledValue, null);
      }
      if (isFormElement) {
          processElement(flags, vNode, dom, props, true, hasControlledValue);
      }
  }

  function createClassComponentInstance(vNode, Component, props, context) {
      var instance = new Component(props, context);
      vNode.children = instance;
      instance.$V = vNode;
      instance.$BS = false;
      instance.context = context;
      if (instance.props === EMPTY_OBJ) {
          instance.props = props;
      }
      instance.$UN = false;
      if (isFunction(instance.componentWillMount)) {
          instance.$BR = true;
          instance.componentWillMount();
          if (instance.$PSS) {
              var state = instance.state;
              var pending = instance.$PS;
              if (isNull(state)) {
                  instance.state = pending;
              }
              else {
                  for (var key in pending) {
                      state[key] = pending[key];
                  }
              }
              instance.$PSS = false;
              instance.$PS = null;
          }
          instance.$BR = false;
      }
      if (isFunction(options.beforeRender)) {
          options.beforeRender(instance);
      }
      var input = handleComponentInput(instance.render(props, instance.state, context), vNode);
      var childContext;
      if (isFunction(instance.getChildContext)) {
          childContext = instance.getChildContext();
      }
      if (isNullOrUndef(childContext)) {
          instance.$CX = context;
      }
      else {
          instance.$CX = combineFrom(context, childContext);
      }
      if (isFunction(options.afterRender)) {
          options.afterRender(instance);
      }
      instance.$LI = input;
      return instance;
  }
  function handleComponentInput(input, componentVNode) {
      if (isInvalid(input)) {
          input = createVoidVNode();
      }
      else if (isStringOrNumber(input)) {
          input = createTextVNode(input, null);
      }
      else {
          if (input.dom) {
              input = directClone(input);
          }
          if (input.flags & 14 /* Component */) {
              // if we have an input that is also a component, we run into a tricky situation
              // where the root vNode needs to always have the correct DOM entry
              // we can optimise this in the future, but this gets us out of a lot of issues
              input.parentVNode = componentVNode;
          }
      }
      return input;
  }

  function mount(vNode, parentDom, lifecycle, context, isSVG) {
      var flags = vNode.flags;
      if (flags & 481 /* Element */) {
          return mountElement(vNode, parentDom, lifecycle, context, isSVG);
      }
      if (flags & 14 /* Component */) {
          return mountComponent(vNode, parentDom, lifecycle, context, isSVG, (flags & 4 /* ComponentClass */) > 0);
      }
      if (flags & 512 /* Void */ || flags & 16 /* Text */) {
          return mountText(vNode, parentDom);
      }
      if (flags & 1024 /* Portal */) {
          mount(vNode.children, vNode.type, lifecycle, context, false);
          return (vNode.dom = mountText(createVoidVNode(), parentDom));
      }
  }
  function mountText(vNode, parentDom) {
      var dom = (vNode.dom = document.createTextNode(vNode.children));
      if (!isNull(parentDom)) {
          appendChild(parentDom, dom);
      }
      return dom;
  }
  function mountElement(vNode, parentDom, lifecycle, context, isSVG) {
      var flags = vNode.flags;
      var children = vNode.children;
      var props = vNode.props;
      var className = vNode.className;
      var ref = vNode.ref;
      var childFlags = vNode.childFlags;
      isSVG = isSVG || (flags & 32 /* SvgElement */) > 0;
      var dom = documentCreateElement(vNode.type, isSVG);
      vNode.dom = dom;
      if (!isNullOrUndef(className) && className !== '') {
          if (isSVG) {
              dom.setAttribute('class', className);
          }
          else {
              dom.className = className;
          }
      }
      if (!isNull(parentDom)) {
          appendChild(parentDom, dom);
      }
      if ((childFlags & 1 /* HasInvalidChildren */) === 0) {
          var childrenIsSVG = isSVG === true && vNode.type !== 'foreignObject';
          if (childFlags === 2 /* HasVNodeChildren */) {
              mount(children, dom, lifecycle, context, childrenIsSVG);
          }
          else if (childFlags & 12 /* MultipleChildren */) {
              mountArrayChildren(children, dom, lifecycle, context, childrenIsSVG);
          }
      }
      if (!isNull(props)) {
          mountProps(vNode, flags, props, dom, isSVG);
      }
      if (isFunction(ref)) {
          mountRef(dom, ref, lifecycle);
      }
      return dom;
  }
  function mountArrayChildren(children, dom, lifecycle, context, isSVG) {
      for (var i = 0, len = children.length; i < len; i++) {
          var child = children[i];
          if (!isNull(child.dom)) {
              children[i] = child = directClone(child);
          }
          mount(child, dom, lifecycle, context, isSVG);
      }
  }
  function mountComponent(vNode, parentDom, lifecycle, context, isSVG, isClass) {
      var dom;
      var type = vNode.type;
      var props = vNode.props || EMPTY_OBJ;
      var ref = vNode.ref;
      if (isClass) {
          var instance = createClassComponentInstance(vNode, type, props, context);
          vNode.dom = dom = mount(instance.$LI, null, lifecycle, instance.$CX, isSVG);
          mountClassComponentCallbacks(vNode, ref, instance, lifecycle);
          instance.$UPD = false;
      }
      else {
          var input = handleComponentInput(type(props, context), vNode);
          vNode.children = input;
          vNode.dom = dom = mount(input, null, lifecycle, context, isSVG);
          mountFunctionalComponentCallbacks(props, ref, dom, lifecycle);
      }
      if (!isNull(parentDom)) {
          appendChild(parentDom, dom);
      }
      return dom;
  }
  function createClassMountCallback(instance, hasAfterMount, afterMount, vNode, hasDidMount) {
      return function () {
          instance.$UPD = true;
          if (hasAfterMount) {
              afterMount(vNode);
          }
          if (hasDidMount) {
              instance.componentDidMount();
          }
          instance.$UPD = false;
      };
  }
  function mountClassComponentCallbacks(vNode, ref, instance, lifecycle) {
      if (isFunction(ref)) {
          ref(instance);
      }
      var hasDidMount = isFunction(instance.componentDidMount);
      var afterMount = options.afterMount;
      var hasAfterMount = isFunction(afterMount);
      if (hasDidMount || hasAfterMount) {
          lifecycle.push(createClassMountCallback(instance, hasAfterMount, afterMount, vNode, hasDidMount));
      }
  }
  // Create did mount callback lazily to avoid creating function context if not needed
  function createOnMountCallback(ref, dom, props) {
      return function () { return ref.onComponentDidMount(dom, props); };
  }
  function mountFunctionalComponentCallbacks(props, ref, dom, lifecycle) {
      if (!isNullOrUndef(ref)) {
          if (isFunction(ref.onComponentWillMount)) {
              ref.onComponentWillMount(props);
          }
          if (isFunction(ref.onComponentDidMount)) {
              lifecycle.push(createOnMountCallback(ref, dom, props));
          }
      }
  }
  function mountRef(dom, value, lifecycle) {
      lifecycle.push(function () { return value(dom); });
  }

  function hydrateComponent(vNode, dom, lifecycle, context, isSVG, isClass) {
      var type = vNode.type;
      var ref = vNode.ref;
      var props = vNode.props || EMPTY_OBJ;
      if (isClass) {
          var instance = createClassComponentInstance(vNode, type, props, context);
          var input = instance.$LI;
          hydrateVNode(input, dom, lifecycle, instance.$CX, isSVG);
          vNode.dom = input.dom;
          mountClassComponentCallbacks(vNode, ref, instance, lifecycle);
          instance.$UPD = false; // Mount finished allow going sync
      }
      else {
          var input$1 = handleComponentInput(type(props, context), vNode);
          hydrateVNode(input$1, dom, lifecycle, context, isSVG);
          vNode.children = input$1;
          vNode.dom = input$1.dom;
          mountFunctionalComponentCallbacks(props, ref, dom, lifecycle);
      }
  }
  function hydrateElement(vNode, dom, lifecycle, context, isSVG) {
      var children = vNode.children;
      var props = vNode.props;
      var className = vNode.className;
      var flags = vNode.flags;
      var ref = vNode.ref;
      isSVG = isSVG || (flags & 32 /* SvgElement */) > 0;
      if (dom.nodeType !== 1 || dom.tagName.toLowerCase() !== vNode.type) {
          var newDom = mountElement(vNode, null, lifecycle, context, isSVG);
          vNode.dom = newDom;
          replaceChild(dom.parentNode, newDom, dom);
      }
      else {
          vNode.dom = dom;
          var childNode = dom.firstChild;
          var childFlags = vNode.childFlags;
          if ((childFlags & 1 /* HasInvalidChildren */) === 0) {
              var nextSibling = null;
              while (childNode) {
                  nextSibling = childNode.nextSibling;
                  if (childNode.nodeType === 8) {
                      if (childNode.data === '!') {
                          dom.replaceChild(document.createTextNode(''), childNode);
                      }
                      else {
                          dom.removeChild(childNode);
                      }
                  }
                  childNode = nextSibling;
              }
              childNode = dom.firstChild;
              if (childFlags === 2 /* HasVNodeChildren */) {
                  if (isNull(childNode)) {
                      mount(children, dom, lifecycle, context, isSVG);
                  }
                  else {
                      nextSibling = childNode.nextSibling;
                      hydrateVNode(children, childNode, lifecycle, context, isSVG);
                      childNode = nextSibling;
                  }
              }
              else if (childFlags & 12 /* MultipleChildren */) {
                  for (var i = 0, len = children.length; i < len; i++) {
                      var child = children[i];
                      if (isNull(childNode)) {
                          mount(child, dom, lifecycle, context, isSVG);
                      }
                      else {
                          nextSibling = childNode.nextSibling;
                          hydrateVNode(child, childNode, lifecycle, context, isSVG);
                          childNode = nextSibling;
                      }
                  }
              }
              // clear any other DOM nodes, there should be only a single entry for the root
              while (childNode) {
                  nextSibling = childNode.nextSibling;
                  dom.removeChild(childNode);
                  childNode = nextSibling;
              }
          }
          else if (!isNull(dom.firstChild) && !isSamePropsInnerHTML(dom, props)) {
              dom.textContent = ''; // dom has content, but VNode has no children remove everything from DOM
              if (flags & 448 /* FormElement */) {
                  // If element is form element, we need to clear defaultValue also
                  dom.defaultValue = '';
              }
          }
          if (!isNull(props)) {
              mountProps(vNode, flags, props, dom, isSVG);
          }
          if (isNullOrUndef(className)) {
              if (dom.className !== '') {
                  dom.removeAttribute('class');
              }
          }
          else if (isSVG) {
              dom.setAttribute('class', className);
          }
          else {
              dom.className = className;
          }
          if (isFunction(ref)) {
              mountRef(dom, ref, lifecycle);
          }
      }
  }
  function hydrateText(vNode, dom) {
      if (dom.nodeType !== 3) {
          var newDom = mountText(vNode, null);
          vNode.dom = newDom;
          replaceChild(dom.parentNode, newDom, dom);
      }
      else {
          var text = vNode.children;
          if (dom.nodeValue !== text) {
              dom.nodeValue = text;
          }
          vNode.dom = dom;
      }
  }
  function hydrateVNode(vNode, dom, lifecycle, context, isSVG) {
      var flags = vNode.flags;
      if (flags & 14 /* Component */) {
          hydrateComponent(vNode, dom, lifecycle, context, isSVG, (flags & 4 /* ComponentClass */) > 0);
      }
      else if (flags & 481 /* Element */) {
          hydrateElement(vNode, dom, lifecycle, context, isSVG);
      }
      else if (flags & 16 /* Text */) {
          hydrateText(vNode, dom);
      }
      else if (flags & 512 /* Void */) {
          vNode.dom = dom;
      }
      else {
          throwError();
      }
  }
  function hydrate(input, parentDom, callback) {
      var dom = parentDom.firstChild;
      if (!isNull(dom)) {
          if (!isInvalid(input)) {
              hydrateVNode(input, dom, LIFECYCLE, EMPTY_OBJ, false);
          }
          dom = parentDom.firstChild;
          // clear any other DOM nodes, there should be only a single entry for the root
          while ((dom = dom.nextSibling)) {
              parentDom.removeChild(dom);
          }
      }
      if (LIFECYCLE.length > 0) {
          callAll(LIFECYCLE);
      }
      if (!parentDom.$V) {
          options.roots.push(parentDom);
      }
      parentDom.$V = input;
      if (isFunction(callback)) {
          callback();
      }
  }

  function replaceWithNewNode(lastNode, nextNode, parentDom, lifecycle, context, isSVG) {
      unmount(lastNode);
      replaceChild(parentDom, mount(nextNode, null, lifecycle, context, isSVG), lastNode.dom);
  }
  function patch(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG) {
      if (lastVNode !== nextVNode) {
          var nextFlags = nextVNode.flags | 0;
          if (lastVNode.flags !== nextFlags || nextFlags & 2048 /* ReCreate */) {
              replaceWithNewNode(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG);
          }
          else if (nextFlags & 481 /* Element */) {
              patchElement(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG);
          }
          else if (nextFlags & 14 /* Component */) {
              patchComponent(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG, (nextFlags & 4 /* ComponentClass */) > 0);
          }
          else if (nextFlags & 16 /* Text */) {
              patchText(lastVNode, nextVNode, parentDom);
          }
          else if (nextFlags & 512 /* Void */) {
              nextVNode.dom = lastVNode.dom;
          }
          else {
              // Portal
              patchPortal(lastVNode, nextVNode, lifecycle, context);
          }
      }
  }
  function patchPortal(lastVNode, nextVNode, lifecycle, context) {
      var lastContainer = lastVNode.type;
      var nextContainer = nextVNode.type;
      var nextChildren = nextVNode.children;
      patchChildren(lastVNode.childFlags, nextVNode.childFlags, lastVNode.children, nextChildren, lastContainer, lifecycle, context, false);
      nextVNode.dom = lastVNode.dom;
      if (lastContainer !== nextContainer && !isInvalid(nextChildren)) {
          var node = nextChildren.dom;
          lastContainer.removeChild(node);
          nextContainer.appendChild(node);
      }
  }
  function patchElement(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG) {
      var nextTag = nextVNode.type;
      if (lastVNode.type !== nextTag) {
          replaceWithNewNode(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG);
      }
      else {
          var dom = lastVNode.dom;
          var nextFlags = nextVNode.flags;
          var lastProps = lastVNode.props;
          var nextProps = nextVNode.props;
          var isFormElement = false;
          var hasControlledValue = false;
          var nextPropsOrEmpty;
          nextVNode.dom = dom;
          isSVG = isSVG || (nextFlags & 32 /* SvgElement */) > 0;
          // inlined patchProps  -- starts --
          if (lastProps !== nextProps) {
              var lastPropsOrEmpty = lastProps || EMPTY_OBJ;
              nextPropsOrEmpty = nextProps || EMPTY_OBJ;
              if (nextPropsOrEmpty !== EMPTY_OBJ) {
                  isFormElement = (nextFlags & 448 /* FormElement */) > 0;
                  if (isFormElement) {
                      hasControlledValue = isControlledFormElement(nextPropsOrEmpty);
                  }
                  for (var prop in nextPropsOrEmpty) {
                      var lastValue = lastPropsOrEmpty[prop];
                      var nextValue = nextPropsOrEmpty[prop];
                      if (lastValue !== nextValue) {
                          patchProp(prop, lastValue, nextValue, dom, isSVG, hasControlledValue, lastVNode);
                      }
                  }
              }
              if (lastPropsOrEmpty !== EMPTY_OBJ) {
                  for (var prop$1 in lastPropsOrEmpty) {
                      // do not add a hasOwnProperty check here, it affects performance
                      if (!nextPropsOrEmpty.hasOwnProperty(prop$1) && !isNullOrUndef(lastPropsOrEmpty[prop$1])) {
                          patchProp(prop$1, lastPropsOrEmpty[prop$1], null, dom, isSVG, hasControlledValue, lastVNode);
                      }
                  }
              }
          }
          var lastChildren = lastVNode.children;
          var nextChildren = nextVNode.children;
          var nextRef = nextVNode.ref;
          var lastClassName = lastVNode.className;
          var nextClassName = nextVNode.className;
          if (lastChildren !== nextChildren) {
              patchChildren(lastVNode.childFlags, nextVNode.childFlags, lastChildren, nextChildren, dom, lifecycle, context, isSVG && nextTag !== 'foreignObject');
          }
          if (isFormElement) {
              processElement(nextFlags, nextVNode, dom, nextPropsOrEmpty, false, hasControlledValue);
          }
          // inlined patchProps  -- ends --
          if (lastClassName !== nextClassName) {
              if (isNullOrUndef(nextClassName)) {
                  dom.removeAttribute('class');
              }
              else if (isSVG) {
                  dom.setAttribute('class', nextClassName);
              }
              else {
                  dom.className = nextClassName;
              }
          }
          if (isFunction(nextRef) && lastVNode.ref !== nextRef) {
              mountRef(dom, nextRef, lifecycle);
          }
      }
  }
  function patchChildren(lastChildFlags, nextChildFlags, lastChildren, nextChildren, parentDOM, lifecycle, context, isSVG) {
      switch (lastChildFlags) {
          case 2 /* HasVNodeChildren */:
              switch (nextChildFlags) {
                  case 2 /* HasVNodeChildren */:
                      patch(lastChildren, nextChildren, parentDOM, lifecycle, context, isSVG);
                      break;
                  case 1 /* HasInvalidChildren */:
                      remove(lastChildren, parentDOM);
                      break;
                  default:
                      remove(lastChildren, parentDOM);
                      mountArrayChildren(nextChildren, parentDOM, lifecycle, context, isSVG);
                      break;
              }
              break;
          case 1 /* HasInvalidChildren */:
              switch (nextChildFlags) {
                  case 2 /* HasVNodeChildren */:
                      mount(nextChildren, parentDOM, lifecycle, context, isSVG);
                      break;
                  case 1 /* HasInvalidChildren */:
                      break;
                  default:
                      mountArrayChildren(nextChildren, parentDOM, lifecycle, context, isSVG);
                      break;
              }
              break;
          default:
              if (nextChildFlags & 12 /* MultipleChildren */) {
                  var lastLength = lastChildren.length;
                  var nextLength = nextChildren.length;
                  // Fast path's for both algorithms
                  if (lastLength === 0) {
                      if (nextLength > 0) {
                          mountArrayChildren(nextChildren, parentDOM, lifecycle, context, isSVG);
                      }
                  }
                  else if (nextLength === 0) {
                      removeAllChildren(parentDOM, lastChildren);
                  }
                  else if (nextChildFlags === 8 /* HasKeyedChildren */ && lastChildFlags === 8 /* HasKeyedChildren */) {
                      patchKeyedChildren(lastChildren, nextChildren, parentDOM, lifecycle, context, isSVG, lastLength, nextLength);
                  }
                  else {
                      patchNonKeyedChildren(lastChildren, nextChildren, parentDOM, lifecycle, context, isSVG, lastLength, nextLength);
                  }
              }
              else if (nextChildFlags === 1 /* HasInvalidChildren */) {
                  removeAllChildren(parentDOM, lastChildren);
              }
              else {
                  removeAllChildren(parentDOM, lastChildren);
                  mount(nextChildren, parentDOM, lifecycle, context, isSVG);
              }
              break;
      }
  }
  function updateClassComponent(instance, nextState, nextVNode, nextProps, parentDom, lifecycle, context, isSVG, force, fromSetState) {
      var lastState = instance.state;
      var lastProps = instance.props;
      nextVNode.children = instance;
      var renderOutput;
      if (instance.$UN) {
          return;
      }
      if (lastProps !== nextProps || nextProps === EMPTY_OBJ) {
          if (!fromSetState && isFunction(instance.componentWillReceiveProps)) {
              instance.$BR = true;
              instance.componentWillReceiveProps(nextProps, context);
              // If instance component was removed during its own update do nothing...
              if (instance.$UN) {
                  return;
              }
              instance.$BR = false;
          }
          if (instance.$PSS) {
              nextState = combineFrom(nextState, instance.$PS);
              instance.$PSS = false;
              instance.$PS = null;
          }
      }
      /* Update if scu is not defined, or it returns truthy value or force */
      var hasSCU = isFunction(instance.shouldComponentUpdate);
      if (force || !hasSCU || (hasSCU && instance.shouldComponentUpdate(nextProps, nextState, context))) {
          if (isFunction(instance.componentWillUpdate)) {
              instance.$BS = true;
              instance.componentWillUpdate(nextProps, nextState, context);
              instance.$BS = false;
          }
          instance.props = nextProps;
          instance.state = nextState;
          instance.context = context;
          if (isFunction(options.beforeRender)) {
              options.beforeRender(instance);
          }
          renderOutput = instance.render(nextProps, nextState, context);
          if (isFunction(options.afterRender)) {
              options.afterRender(instance);
          }
          var didUpdate = renderOutput !== NO_OP;
          var childContext;
          if (isFunction(instance.getChildContext)) {
              childContext = instance.getChildContext();
          }
          if (isNullOrUndef(childContext)) {
              childContext = context;
          }
          else {
              childContext = combineFrom(context, childContext);
          }
          instance.$CX = childContext;
          if (didUpdate) {
              var lastInput = instance.$LI;
              var nextInput = (instance.$LI = handleComponentInput(renderOutput, nextVNode));
              patch(lastInput, nextInput, parentDom, lifecycle, childContext, isSVG);
              if (isFunction(instance.componentDidUpdate)) {
                  instance.componentDidUpdate(lastProps, lastState);
              }
              if (isFunction(options.afterUpdate)) {
                  options.afterUpdate(nextVNode);
              }
          }
      }
      else {
          instance.props = nextProps;
          instance.state = nextState;
          instance.context = context;
      }
      nextVNode.dom = instance.$LI.dom;
  }
  function patchComponent(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG, isClass) {
      var nextType = nextVNode.type;
      var lastKey = lastVNode.key;
      var nextKey = nextVNode.key;
      if (lastVNode.type !== nextType || lastKey !== nextKey) {
          replaceWithNewNode(lastVNode, nextVNode, parentDom, lifecycle, context, isSVG);
      }
      else {
          var nextProps = nextVNode.props || EMPTY_OBJ;
          if (isClass) {
              var instance = lastVNode.children;
              instance.$UPD = true;
              updateClassComponent(instance, instance.state, nextVNode, nextProps, parentDom, lifecycle, context, isSVG, false, false);
              instance.$V = nextVNode;
              instance.$UPD = false;
          }
          else {
              var shouldUpdate = true;
              var lastProps = lastVNode.props;
              var nextHooks = nextVNode.ref;
              var nextHooksDefined = !isNullOrUndef(nextHooks);
              var lastInput = lastVNode.children;
              nextVNode.dom = lastVNode.dom;
              nextVNode.children = lastInput;
              if (nextHooksDefined && isFunction(nextHooks.onComponentShouldUpdate)) {
                  shouldUpdate = nextHooks.onComponentShouldUpdate(lastProps, nextProps);
              }
              if (shouldUpdate !== false) {
                  if (nextHooksDefined && isFunction(nextHooks.onComponentWillUpdate)) {
                      nextHooks.onComponentWillUpdate(lastProps, nextProps);
                  }
                  var nextInput = nextType(nextProps, context);
                  if (nextInput !== NO_OP) {
                      nextInput = handleComponentInput(nextInput, nextVNode);
                      patch(lastInput, nextInput, parentDom, lifecycle, context, isSVG);
                      nextVNode.children = nextInput;
                      nextVNode.dom = nextInput.dom;
                      if (nextHooksDefined && isFunction(nextHooks.onComponentDidUpdate)) {
                          nextHooks.onComponentDidUpdate(lastProps, nextProps);
                      }
                  }
              }
              else if (lastInput.flags & 14 /* Component */) {
                  lastInput.parentVNode = nextVNode;
              }
          }
      }
  }
  function patchText(lastVNode, nextVNode, parentDom) {
      var nextText = nextVNode.children;
      var textNode = parentDom.firstChild;
      var dom;
      // Guard against external change on DOM node.
      if (isNull(textNode)) {
          parentDom.textContent = nextText;
          dom = parentDom.firstChild;
      }
      else {
          dom = lastVNode.dom;
          if (nextText !== lastVNode.children) {
              dom.nodeValue = nextText;
          }
      }
      nextVNode.dom = dom;
  }
  function patchNonKeyedChildren(lastChildren, nextChildren, dom, lifecycle, context, isSVG, lastChildrenLength, nextChildrenLength) {
      var commonLength = lastChildrenLength > nextChildrenLength ? nextChildrenLength : lastChildrenLength;
      var i = 0;
      var nextChild;
      for (; i < commonLength; i++) {
          nextChild = nextChildren[i];
          if (nextChild.dom) {
              nextChild = nextChildren[i] = directClone(nextChild);
          }
          patch(lastChildren[i], nextChild, dom, lifecycle, context, isSVG);
      }
      if (lastChildrenLength < nextChildrenLength) {
          for (i = commonLength; i < nextChildrenLength; i++) {
              nextChild = nextChildren[i];
              if (nextChild.dom) {
                  nextChild = nextChildren[i] = directClone(nextChild);
              }
              mount(nextChild, dom, lifecycle, context, isSVG);
          }
      }
      else if (lastChildrenLength > nextChildrenLength) {
          for (i = commonLength; i < lastChildrenLength; i++) {
              remove(lastChildren[i], dom);
          }
      }
  }
  function patchKeyedChildren(a, b, dom, lifecycle, context, isSVG, aLength, bLength) {
      var aEnd = aLength - 1;
      var bEnd = bLength - 1;
      var aStart = 0;
      var bStart = 0;
      var i;
      var j;
      var aNode = a[aStart];
      var bNode = b[bStart];
      var nextNode;
      var nextPos;
      // Step 1
      // tslint:disable-next-line
      outer: {
          // Sync nodes with the same key at the beginning.
          while (aNode.key === bNode.key) {
              if (bNode.dom) {
                  b[bStart] = bNode = directClone(bNode);
              }
              patch(aNode, bNode, dom, lifecycle, context, isSVG);
              aStart++;
              bStart++;
              if (aStart > aEnd || bStart > bEnd) {
                  break outer;
              }
              aNode = a[aStart];
              bNode = b[bStart];
          }
          aNode = a[aEnd];
          bNode = b[bEnd];
          // Sync nodes with the same key at the end.
          while (aNode.key === bNode.key) {
              if (bNode.dom) {
                  b[bEnd] = bNode = directClone(bNode);
              }
              patch(aNode, bNode, dom, lifecycle, context, isSVG);
              aEnd--;
              bEnd--;
              if (aStart > aEnd || bStart > bEnd) {
                  break outer;
              }
              aNode = a[aEnd];
              bNode = b[bEnd];
          }
      }
      if (aStart > aEnd) {
          if (bStart <= bEnd) {
              nextPos = bEnd + 1;
              nextNode = nextPos < bLength ? b[nextPos].dom : null;
              while (bStart <= bEnd) {
                  bNode = b[bStart];
                  if (bNode.dom) {
                      b[bStart] = bNode = directClone(bNode);
                  }
                  bStart++;
                  insertOrAppend(dom, mount(bNode, null, lifecycle, context, isSVG), nextNode);
              }
          }
      }
      else if (bStart > bEnd) {
          while (aStart <= aEnd) {
              remove(a[aStart++], dom);
          }
      }
      else {
          var aLeft = aEnd - aStart + 1;
          var bLeft = bEnd - bStart + 1;
          var sources = [];
          for (i = 0; i < bLeft; i++) {
              sources.push(0);
          }
          // Keep track if its possible to remove whole DOM using textContent = '';
          var canRemoveWholeContent = aLeft === aLength;
          var moved = false;
          var pos = 0;
          var patched = 0;
          // When sizes are small, just loop them through
          if (bLength < 4 || (aLeft | bLeft) < 32) {
              for (i = aStart; i <= aEnd; i++) {
                  aNode = a[i];
                  if (patched < bLeft) {
                      for (j = bStart; j <= bEnd; j++) {
                          bNode = b[j];
                          if (aNode.key === bNode.key) {
                              sources[j - bStart] = i + 1;
                              if (canRemoveWholeContent) {
                                  canRemoveWholeContent = false;
                                  while (i > aStart) {
                                      remove(a[aStart++], dom);
                                  }
                              }
                              if (pos > j) {
                                  moved = true;
                              }
                              else {
                                  pos = j;
                              }
                              if (bNode.dom) {
                                  b[j] = bNode = directClone(bNode);
                              }
                              patch(aNode, bNode, dom, lifecycle, context, isSVG);
                              patched++;
                              break;
                          }
                      }
                      if (!canRemoveWholeContent && j > bEnd) {
                          remove(aNode, dom);
                      }
                  }
                  else if (!canRemoveWholeContent) {
                      remove(aNode, dom);
                  }
              }
          }
          else {
              var keyIndex = {};
              // Map keys by their index
              for (i = bStart; i <= bEnd; i++) {
                  keyIndex[b[i].key] = i;
              }
              // Try to patch same keys
              for (i = aStart; i <= aEnd; i++) {
                  aNode = a[i];
                  if (patched < bLeft) {
                      j = keyIndex[aNode.key];
                      if (j !== void 0) {
                          if (canRemoveWholeContent) {
                              canRemoveWholeContent = false;
                              while (i > aStart) {
                                  remove(a[aStart++], dom);
                              }
                          }
                          bNode = b[j];
                          sources[j - bStart] = i + 1;
                          if (pos > j) {
                              moved = true;
                          }
                          else {
                              pos = j;
                          }
                          if (bNode.dom) {
                              b[j] = bNode = directClone(bNode);
                          }
                          patch(aNode, bNode, dom, lifecycle, context, isSVG);
                          patched++;
                      }
                      else if (!canRemoveWholeContent) {
                          remove(aNode, dom);
                      }
                  }
                  else if (!canRemoveWholeContent) {
                      remove(aNode, dom);
                  }
              }
          }
          // fast-path: if nothing patched remove all old and add all new
          if (canRemoveWholeContent) {
              removeAllChildren(dom, a);
              mountArrayChildren(b, dom, lifecycle, context, isSVG);
          }
          else {
              if (moved) {
                  var seq = lis_algorithm(sources);
                  j = seq.length - 1;
                  for (i = bLeft - 1; i >= 0; i--) {
                      if (sources[i] === 0) {
                          pos = i + bStart;
                          bNode = b[pos];
                          if (bNode.dom) {
                              b[pos] = bNode = directClone(bNode);
                          }
                          nextPos = pos + 1;
                          insertOrAppend(dom, mount(bNode, null, lifecycle, context, isSVG), nextPos < bLength ? b[nextPos].dom : null);
                      }
                      else if (j < 0 || i !== seq[j]) {
                          pos = i + bStart;
                          bNode = b[pos];
                          nextPos = pos + 1;
                          insertOrAppend(dom, bNode.dom, nextPos < bLength ? b[nextPos].dom : null);
                      }
                      else {
                          j--;
                      }
                  }
              }
              else if (patched !== bLeft) {
                  // when patched count doesn't match b length we need to insert those new ones
                  // loop backwards so we can use insertBefore
                  for (i = bLeft - 1; i >= 0; i--) {
                      if (sources[i] === 0) {
                          pos = i + bStart;
                          bNode = b[pos];
                          if (bNode.dom) {
                              b[pos] = bNode = directClone(bNode);
                          }
                          nextPos = pos + 1;
                          insertOrAppend(dom, mount(bNode, null, lifecycle, context, isSVG), nextPos < bLength ? b[nextPos].dom : null);
                      }
                  }
              }
          }
      }
  }
  // https://en.wikipedia.org/wiki/Longest_increasing_subsequence
  function lis_algorithm(arr) {
      var p = arr.slice();
      var result = [0];
      var i;
      var j;
      var u;
      var v;
      var c;
      var len = arr.length;
      for (i = 0; i < len; i++) {
          var arrI = arr[i];
          if (arrI !== 0) {
              j = result[result.length - 1];
              if (arr[j] < arrI) {
                  p[i] = j;
                  result.push(i);
                  continue;
              }
              u = 0;
              v = result.length - 1;
              while (u < v) {
                  c = ((u + v) / 2) | 0;
                  if (arr[result[c]] < arrI) {
                      u = c + 1;
                  }
                  else {
                      v = c;
                  }
              }
              if (arrI < arr[result[u]]) {
                  if (u > 0) {
                      p[i] = result[u - 1];
                  }
                  result[u] = i;
              }
          }
      }
      u = result.length;
      v = result[u - 1];
      while (u-- > 0) {
          result[u] = v;
          v = p[v];
      }
      return result;
  }

  var roots = options.roots;
  var documentBody = isBrowser ? document.body : null;
  function render(input, parentDom, callback) {
      if (input === NO_OP) {
          return;
      }
      var rootLen = roots.length;
      var rootInput;
      var index;
      for (index = 0; index < rootLen; index++) {
          if (roots[index] === parentDom) {
              rootInput = parentDom.$V;
              break;
          }
      }
      if (isUndefined(rootInput)) {
          if (!isInvalid(input)) {
              if (input.dom) {
                  input = directClone(input);
              }
              if (isNull(parentDom.firstChild)) {
                  mount(input, parentDom, LIFECYCLE, EMPTY_OBJ, false);
                  parentDom.$V = input;
                  roots.push(parentDom);
              }
              else {
                  hydrate(input, parentDom);
              }
              rootInput = input;
          }
      }
      else {
          if (isNullOrUndef(input)) {
              remove(rootInput, parentDom);
              roots.splice(index, 1);
          }
          else {
              if (input.dom) {
                  input = directClone(input);
              }
              patch(rootInput, input, parentDom, LIFECYCLE, EMPTY_OBJ, false);
              rootInput = parentDom.$V = input;
          }
      }
      if (LIFECYCLE.length > 0) {
          callAll(LIFECYCLE);
      }
      if (isFunction(callback)) {
          callback();
      }
      if (rootInput && rootInput.flags & 14 /* Component */) {
          return rootInput.children;
      }
  }
  // raf.bind(window) is needed to work around bug in IE10-IE11 strict mode (TypeError: Invalid calling object)
  var fallbackMethod = typeof requestAnimationFrame === 'undefined' ? setTimeout : requestAnimationFrame.bind(window);



  var JSX = /*#__PURE__*/Object.freeze({

  });

  {
    console.warn('You are running production build of Inferno in development mode. Use dev:module entry point.');
  }

  function _arity(n, fn) {
    /* eslint-disable no-unused-vars */
    switch (n) {
      case 0:
        return function () {
          return fn.apply(this, arguments);
        };
      case 1:
        return function (a0) {
          return fn.apply(this, arguments);
        };
      case 2:
        return function (a0, a1) {
          return fn.apply(this, arguments);
        };
      case 3:
        return function (a0, a1, a2) {
          return fn.apply(this, arguments);
        };
      case 4:
        return function (a0, a1, a2, a3) {
          return fn.apply(this, arguments);
        };
      case 5:
        return function (a0, a1, a2, a3, a4) {
          return fn.apply(this, arguments);
        };
      case 6:
        return function (a0, a1, a2, a3, a4, a5) {
          return fn.apply(this, arguments);
        };
      case 7:
        return function (a0, a1, a2, a3, a4, a5, a6) {
          return fn.apply(this, arguments);
        };
      case 8:
        return function (a0, a1, a2, a3, a4, a5, a6, a7) {
          return fn.apply(this, arguments);
        };
      case 9:
        return function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
          return fn.apply(this, arguments);
        };
      case 10:
        return function (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
          return fn.apply(this, arguments);
        };
      default:
        throw new Error('First argument to _arity must be a non-negative integer no greater than ten');
    }
  }
  var _arity_1 = _arity;

  function _isPlaceholder(a) {
         return a != null && typeof a === 'object' && a['@@functional/placeholder'] === true;
  }
  var _isPlaceholder_1 = _isPlaceholder;

  /**
   * Optimized internal one-arity curry function.
   *
   * @private
   * @category Function
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */


  function _curry1(fn) {
    return function f1(a) {
      if (arguments.length === 0 || _isPlaceholder_1(a)) {
        return f1;
      } else {
        return fn.apply(this, arguments);
      }
    };
  }
  var _curry1_1 = _curry1;

  /**
   * Optimized internal two-arity curry function.
   *
   * @private
   * @category Function
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */


  function _curry2(fn) {
    return function f2(a, b) {
      switch (arguments.length) {
        case 0:
          return f2;
        case 1:
          return _isPlaceholder_1(a) ? f2 : _curry1_1(function (_b) {
            return fn(a, _b);
          });
        default:
          return _isPlaceholder_1(a) && _isPlaceholder_1(b) ? f2 : _isPlaceholder_1(a) ? _curry1_1(function (_a) {
            return fn(_a, b);
          }) : _isPlaceholder_1(b) ? _curry1_1(function (_b) {
            return fn(a, _b);
          }) : fn(a, b);
      }
    };
  }
  var _curry2_1 = _curry2;

  /**
   * Internal curryN function.
   *
   * @private
   * @category Function
   * @param {Number} length The arity of the curried function.
   * @param {Array} received An array of arguments received thus far.
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */


  function _curryN(length, received, fn) {
    return function () {
      var combined = [];
      var argsIdx = 0;
      var left = length;
      var combinedIdx = 0;
      while (combinedIdx < received.length || argsIdx < arguments.length) {
        var result;
        if (combinedIdx < received.length && (!_isPlaceholder_1(received[combinedIdx]) || argsIdx >= arguments.length)) {
          result = received[combinedIdx];
        } else {
          result = arguments[argsIdx];
          argsIdx += 1;
        }
        combined[combinedIdx] = result;
        if (!_isPlaceholder_1(result)) {
          left -= 1;
        }
        combinedIdx += 1;
      }
      return left <= 0 ? fn.apply(this, combined) : _arity_1(left, _curryN(length, combined, fn));
    };
  }
  var _curryN_1 = _curryN;

  /**
   * Returns a curried equivalent of the provided function, with the specified
   * arity. The curried function has two unusual capabilities. First, its
   * arguments needn't be provided one at a time. If `g` is `R.curryN(3, f)`, the
   * following are equivalent:
   *
   *   - `g(1)(2)(3)`
   *   - `g(1)(2, 3)`
   *   - `g(1, 2)(3)`
   *   - `g(1, 2, 3)`
   *
   * Secondly, the special placeholder value [`R.__`](#__) may be used to specify
   * "gaps", allowing partial application of any combination of arguments,
   * regardless of their positions. If `g` is as above and `_` is [`R.__`](#__),
   * the following are equivalent:
   *
   *   - `g(1, 2, 3)`
   *   - `g(_, 2, 3)(1)`
   *   - `g(_, _, 3)(1)(2)`
   *   - `g(_, _, 3)(1, 2)`
   *   - `g(_, 2)(1)(3)`
   *   - `g(_, 2)(1, 3)`
   *   - `g(_, 2)(_, 3)(1)`
   *
   * @func
   * @memberOf R
   * @since v0.5.0
   * @category Function
   * @sig Number -> (* -> a) -> (* -> a)
   * @param {Number} length The arity for the returned function.
   * @param {Function} fn The function to curry.
   * @return {Function} A new, curried function.
   * @see R.curry
   * @example
   *
   *      var sumArgs = (...args) => R.sum(args);
   *
   *      var curriedAddFourNumbers = R.curryN(4, sumArgs);
   *      var f = curriedAddFourNumbers(1, 2);
   *      var g = f(3);
   *      g(4); //=> 10
   */


  var curryN = /*#__PURE__*/_curry2_1(function curryN(length, fn) {
    if (length === 1) {
      return _curry1_1(fn);
    }
    return _arity_1(length, _curryN_1(length, [], fn));
  });
  var curryN_1 = curryN;

  // Utility
  function isFunction$1(obj) {
    return !!(obj && obj.constructor && obj.call && obj.apply);
  }
  function trueFn() { return true; }

  // Globals
  var toUpdate = [];
  var inStream;
  var order = [];
  var orderNextIdx = -1;
  var flushingUpdateQueue = false;
  var flushingStreamValue = false;

  function flushing() {
    return flushingUpdateQueue || flushingStreamValue;
  }


  /** @namespace */
  var flyd = {};

  // /////////////////////////// API ///////////////////////////////// //

  /**
   * Creates a new stream
   *
   * __Signature__: `a -> Stream a`
   *
   * @name flyd.stream
   * @param {*} initialValue - (Optional) the initial value of the stream
   * @return {stream} the stream
   *
   * @example
   * var n = flyd.stream(1); // Stream with initial value `1`
   * var s = flyd.stream(); // Stream with no initial value
   */
  flyd.stream = function(initialValue) {
    var endStream = createDependentStream([], trueFn);
    var s = createStream();
    s.end = endStream;
    s.fnArgs = [];
    endStream.listeners.push(s);
    if (arguments.length > 0) s(initialValue);
    return s;
  };
  // fantasy-land Applicative
  flyd.stream['fantasy-land/of'] = flyd.stream.of = flyd.stream;


  /**
   * Create a new dependent stream
   *
   * __Signature__: `(...Stream * -> Stream b -> b) -> [Stream *] -> Stream b`
   *
   * @name flyd.combine
   * @param {Function} fn - the function used to combine the streams
   * @param {Array<stream>} dependencies - the streams that this one depends on
   * @return {stream} the dependent stream
   *
   * @example
   * var n1 = flyd.stream(0);
   * var n2 = flyd.stream(0);
   * var max = flyd.combine(function(n1, n2, self, changed) {
   *   return n1() > n2() ? n1() : n2();
   * }, [n1, n2]);
   */
  flyd.combine = curryN_1(2, combine);
  function combine(fn, streams) {
    var i, s, deps, depEndStreams;
    var endStream = createDependentStream([], trueFn);
    deps = []; depEndStreams = [];
    for (i = 0; i < streams.length; ++i) {
      if (streams[i] !== undefined) {
        deps.push(streams[i]);
        if (streams[i].end !== undefined) depEndStreams.push(streams[i].end);
      }
    }
    s = createDependentStream(deps, fn);
    s.depsChanged = [];
    s.fnArgs = s.deps.concat([s, s.depsChanged]);
    s.end = endStream;
    endStream.listeners.push(s);
    addListeners(depEndStreams, endStream);
    endStream.deps = depEndStreams;
    updateStream(s);
    return s;
  }

  /**
   * Returns `true` if the supplied argument is a Flyd stream and `false` otherwise.
   *
   * __Signature__: `* -> Boolean`
   *
   * @name flyd.isStream
   * @param {*} value - the value to test
   * @return {Boolean} `true` if is a Flyd streamn, `false` otherwise
   *
   * @example
   * var s = flyd.stream(1);
   * var n = 1;
   * flyd.isStream(s); //=> true
   * flyd.isStream(n); //=> false
   */
  flyd.isStream = function(stream) {
    return isFunction$1(stream) && 'hasVal' in stream;
  };

  /**
   * Invokes the body (the function to calculate the value) of a dependent stream
   *
   * By default the body of a dependent stream is only called when all the streams
   * upon which it depends has a value. `immediate` can circumvent this behaviour.
   * It immediately invokes the body of a dependent stream.
   *
   * __Signature__: `Stream a -> Stream a`
   *
   * @name flyd.immediate
   * @param {stream} stream - the dependent stream
   * @return {stream} the same stream
   *
   * @example
   * var s = flyd.stream();
   * var hasItems = flyd.immediate(flyd.combine(function(s) {
   *   return s() !== undefined && s().length > 0;
   * }, [s]);
   * console.log(hasItems()); // logs `false`. Had `immediate` not been
   *                          // used `hasItems()` would've returned `undefined`
   * s([1]);
   * console.log(hasItems()); // logs `true`.
   * s([]);
   * console.log(hasItems()); // logs `false`.
   */
  flyd.immediate = function(s) {
    if (s.depsMet === false) {
      s.depsMet = true;
      updateStream(s);
    }
    return s;
  };

  /**
   * Changes which `endsStream` should trigger the ending of `s`.
   *
   * __Signature__: `Stream a -> Stream b -> Stream b`
   *
   * @name flyd.endsOn
   * @param {stream} endStream - the stream to trigger the ending
   * @param {stream} stream - the stream to be ended by the endStream
   * @param {stream} the stream modified to be ended by endStream
   *
   * @example
   * var n = flyd.stream(1);
   * var killer = flyd.stream();
   * // `double` ends when `n` ends or when `killer` emits any value
   * var double = flyd.endsOn(flyd.merge(n.end, killer), flyd.combine(function(n) {
   *   return 2 * n();
   * }, [n]);
  */
  flyd.endsOn = function(endS, s) {
    detachDeps(s.end);
    endS.listeners.push(s.end);
    s.end.deps.push(endS);
    return s;
  };

  /**
   * Map a stream
   *
   * Returns a new stream consisting of every value from `s` passed through
   * `fn`. I.e. `map` creates a new stream that listens to `s` and
   * applies `fn` to every new value.
   * __Signature__: `(a -> result) -> Stream a -> Stream result`
   *
   * @name flyd.map
   * @param {Function} fn - the function that produces the elements of the new stream
   * @param {stream} stream - the stream to map
   * @return {stream} a new stream with the mapped values
   *
   * @example
   * var numbers = flyd.stream(0);
   * var squaredNumbers = flyd.map(function(n) { return n*n; }, numbers);
   */
  // Library functions use self callback to accept (null, undefined) update triggers.
  function map(f, s) {
    return combine(function(s, self) { self(f(s.val)); }, [s]);
  }
  flyd.map = curryN_1(2, map);

  /**
   * Chain a stream
   *
   * also known as flatMap
   *
   * Where `fn` returns a stream this function will flatten the resulting streams.
   * Every time `fn` is called the context of the returned stream will "switch" to that stream.
   *
   * __Signature__: `(a -> Stream b) -> Stream a -> Stream b`
   *
   * @name flyd.chain
   * @param {Function} fn - the function that produces the streams to be flattened
   * @param {stream} stream - the stream to map
   * @return {stream} a new stream with the mapped values
   *
   * @example
   * var filter = flyd.stream('who');
   * var items = flyd.chain(function(filter){
   *   return flyd.stream(findUsers(filter));
   * }, filter);
   */
  flyd.chain = curryN_1(2, chain);

  /**
   * Apply a stream
   *
   * Applies the value in `s2` to the function in `s1`.
   *
   * __Signature__: `Stream (a -> b) -> Stream a -> Stream b`
   *
   * @name flyd.ap
   * @param {stream} s1 - The value to be applied
   * @param {stream} s2 - The function expecting the value
   * @return {stream} a new stream with the mapped values
   *
   * @example
   * var add = stream(a => b => a + b)
   * var n1 = stream(1)
   * var n2 = stream(2)
   *
   * var added = flyd.ap(n2, flyd.ap(n1, add)) // stream(3)
   * // can also be written using pipe
   * var added_pipe = add
   *   .pipe(ap(n1))
   *   .pipe(ap(n2));
   * added_pipe() // 3
   */
  flyd.ap = curryN_1(2, ap);

  /**
   * Listen to stream events
   *
   * Similar to `map` except that the returned stream is empty. Use `on` for doing
   * side effects in reaction to stream changes. Use the returned stream only if you
   * need to manually end it.
   *
   * __Signature__: `(a -> result) -> Stream a -> Stream undefined`
   *
   * @name flyd.on
   * @param {Function} cb - the callback
   * @param {stream} stream - the stream
   * @return {stream} an empty stream (can be ended)
   */
  flyd.on = curryN_1(2, function(f, s) {
    return combine(function(s) { f(s.val); }, [s]);
  });

  /**
   * Creates a new stream with the results of calling the function on every incoming
   * stream with and accumulator and the incoming value.
   *
   * __Signature__: `(a -> b -> a) -> a -> Stream b -> Stream a`
   *
   * @name flyd.scan
   * @param {Function} fn - the function to call
   * @param {*} val - the initial value of the accumulator
   * @param {stream} stream - the stream source
   * @return {stream} the new stream
   *
   * @example
   * var numbers = flyd.stream();
   * var sum = flyd.scan(function(sum, n) { return sum+n; }, 0, numbers);
   * numbers(2)(3)(5);
   * sum(); // 10
   */
  flyd.scan = curryN_1(3, function(f, acc, s) {
    var ns = combine(function(s, self) {
      self(acc = f(acc, s.val));
    }, [s]);
    if (!ns.hasVal) ns(acc);
    return ns;
  });

  /**
   * Creates a new stream down which all values from both `stream1` and `stream2`
   * will be sent.
   *
   * __Signature__: `Stream a -> Stream a -> Stream a`
   *
   * @name flyd.merge
   * @param {stream} source1 - one stream to be merged
   * @param {stream} source2 - the other stream to be merged
   * @return {stream} a stream with the values from both sources
   *
   * @example
   * var btn1Clicks = flyd.stream();
   * button1Elm.addEventListener(btn1Clicks);
   * var btn2Clicks = flyd.stream();
   * button2Elm.addEventListener(btn2Clicks);
   * var allClicks = flyd.merge(btn1Clicks, btn2Clicks);
   */
  flyd.merge = curryN_1(2, function(s1, s2) {
    var s = flyd.immediate(combine(function(s1, s2, self, changed) {
      if (changed[0]) {
        self(changed[0]());
      } else if (s1.hasVal) {
        self(s1.val);
      } else if (s2.hasVal) {
        self(s2.val);
      }
    }, [s1, s2]));
    flyd.endsOn(combine(function() {
      return true;
    }, [s1.end, s2.end]), s);
    return s;
  });

  /**
   * Creates a new stream resulting from applying `transducer` to `stream`.
   *
   * __Signature__: `Transducer -> Stream a -> Stream b`
   *
   * @name flyd.transduce
   * @param {Transducer} xform - the transducer transformation
   * @param {stream} source - the stream source
   * @return {stream} the new stream
   *
   * @example
   * var t = require('transducers.js');
   *
   * var results = [];
   * var s1 = flyd.stream();
   * var tx = t.compose(t.map(function(x) { return x * 2; }), t.dedupe());
   * var s2 = flyd.transduce(tx, s1);
   * flyd.combine(function(s2) { results.push(s2()); }, [s2]);
   * s1(1)(1)(2)(3)(3)(3)(4);
   * results; // => [2, 4, 6, 8]
   */
  flyd.transduce = curryN_1(2, function(xform, source) {
    xform = xform(new StreamTransformer());
    return combine(function(source, self) {
      var res = xform['@@transducer/step'](undefined, source.val);
      if (res && res['@@transducer/reduced'] === true) {
        self.end(true);
        return res['@@transducer/value'];
      } else {
        return res;
      }
    }, [source]);
  });

  /**
   * Returns `fn` curried to `n`. Use this function to curry functions exposed by
   * modules for Flyd.
   *
   * @name flyd.curryN
   * @function
   * @param {Integer} arity - the function arity
   * @param {Function} fn - the function to curry
   * @return {Function} the curried function
   *
   * @example
   * function add(x, y) { return x + y; };
   * var a = flyd.curryN(2, add);
   * a(2)(4) // => 6
   */
  flyd.curryN = curryN_1;

  /**
   * Returns a new stream identical to the original except every
   * value will be passed through `f`.
   *
   * _Note:_ This function is included in order to support the fantasy land
   * specification.
   *
   * __Signature__: Called bound to `Stream a`: `(a -> b) -> Stream b`
   *
   * @name stream.map
   * @param {Function} function - the function to apply
   * @return {stream} a new stream with the values mapped
   *
   * @example
   * var numbers = flyd.stream(0);
   * var squaredNumbers = numbers.map(function(n) { return n*n; });
   */
  function boundMap(f) { return map(f, this); }

  /**
   * Returns the result of applying function `fn` to this stream
   *
   * __Signature__: Called bound to `Stream a`: `(a -> Stream b) -> Stream b`
   *
   * @name stream.pipe
   * @param {Function} fn - the function to apply
   * @return {stream} A new stream
   *
   * @example
   * var numbers = flyd.stream(0);
   * var squaredNumbers = numbers.pipe(flyd.map(function(n){ return n*n; }));
   */
  function operator_pipe(f) { return f(this) }

  function boundChain(f) {
    return chain(f, this);
  }

  function chain(f, s) {
    // Internal state to end flat map stream
    var flatEnd = flyd.stream(1);
    var internalEnded = flyd.on(function() {
      var alive = flatEnd() - 1;
      flatEnd(alive);
      if (alive <= 0) {
        flatEnd.end(true);
      }
    });

    internalEnded(s.end);
    var last = flyd.stream();
    var flatStream = flyd.combine(function(s, own) {
      last.end(true);
      // Our fn stream makes streams
      var newS = f(s());
      flatEnd(flatEnd() + 1);
      internalEnded(newS.end);

      // Update self on call -- newS is never handed out so deps don't matter
      last = map(own, newS);
    }, [s]);

    flyd.endsOn(flatEnd.end, flatStream);

    return flatStream;
  }

  flyd.fromPromise = function fromPromise(p) {
    var s = flyd.stream();
    p.then(function(val) {
      s(val);
      s.end(true);
    });
    return s;
  };

  flyd.flattenPromise = function flattenPromise(s) {
    return combine(function(s, self) {
      s().then(self);
    }, [s])
  };


  /**
   * Returns a new stream which is the result of applying the
   * functions from `this` stream to the values in `stream` parameter.
   *
   * `this` stream must be a stream of functions.
   *
   * _Note:_ This function is included in order to support the fantasy land
   * specification.
   *
   * __Signature__: Called bound to `Stream (a -> b)`: `a -> Stream b`
   *
   * @name stream.ap
   * @param {stream} stream - the values stream
   * @return {stream} a new stream with the functions applied to values
   *
   * @example
   * var add = flyd.curryN(2, function(x, y) { return x + y; });
   * var numbers1 = flyd.stream();
   * var numbers2 = flyd.stream();
   * var addToNumbers1 = flyd.map(add, numbers1);
   * var added = addToNumbers1.ap(numbers2);
   */
  function ap(s2, s1) {
    return combine(function(s1, s2, self) { self(s1.val(s2.val)); }, [s1, s2]);
  }

  function boundAp(s2) {
    return ap(s2, this);
  }

  /**
   * @private
   */
  function fantasy_land_ap(s1) {
    return ap(this, s1);
  }

  /**
   * Get a human readable view of a stream
   * @name stream.toString
   * @return {String} the stream string representation
   */
  function streamToString() {
    return 'stream(' + this.val + ')';
  }

  /**
   * @name stream.end
   * @memberof stream
   * A stream that emits `true` when the stream ends. If `true` is pushed down the
   * stream the parent stream ends.
   */

  /**
   * @name stream.of
   * @function
   * @memberof stream
   * Returns a new stream with `value` as its initial value. It is identical to
   * calling `flyd.stream` with one argument.
   *
   * __Signature__: Called bound to `Stream (a)`: `b -> Stream b`
   *
   * @param {*} value - the initial value
   * @return {stream} the new stream
   *
   * @example
   * var n = flyd.stream(1);
   * var m = n.of(1);
   */

  // /////////////////////////// PRIVATE ///////////////////////////////// //
  /**
   * @private
   * Create a stream with no dependencies and no value
   * @return {Function} a flyd stream
   */
  function createStream() {
    function s(n) {
      if (arguments.length === 0) return s.val
      updateStreamValue(n, s);
      return s
    }
    s.hasVal = false;
    s.val = undefined;
    s.updaters = [];
    s.listeners = [];
    s.queued = false;
    s.end = undefined;

    // fantasy-land compatibility
    s.ap = boundAp;
    s['fantasy-land/map'] = s.map = boundMap;
    s['fantasy-land/ap'] = fantasy_land_ap;
    s['fantasy-land/of'] = s.of = flyd.stream;
    s['fantasy-land/chain'] = s.chain = boundChain;

    s.pipe = operator_pipe;

    // According to the fantasy-land Applicative specification
    // Given a value f, one can access its type representative via the constructor property:
    // `f.constructor.of`
    s.constructor = flyd.stream;

    s.toJSON = function() {
      return s.val;
    };
    s.toString = streamToString;
    return s;
  }

  /**
   * @private
   * Create a dependent stream
   * @param {Array<stream>} dependencies - an array of the streams
   * @param {Function} fn - the function used to calculate the new stream value
   * from the dependencies
   * @return {stream} the created stream
   */
  function createDependentStream(deps, fn) {
    var s = createStream();
    s.fn = fn;
    s.deps = deps;
    s.depsMet = false;
    s.depsChanged = deps.length > 0 ? [] : undefined;
    s.shouldUpdate = false;
    addListeners(deps, s);
    return s;
  }

  /**
   * @private
   * Check if all the dependencies have values
   * @param {stream} stream - the stream to check depencencies from
   * @return {Boolean} `true` if all dependencies have vales, `false` otherwise
   */
  function initialDependenciesMet(stream) {
    stream.depsMet = stream.deps.every(function(s) {
      return s.hasVal;
    });
    return stream.depsMet;
  }

  function dependenciesAreMet(stream) {
    return stream.depsMet === true || initialDependenciesMet(stream);
  }

  function isEnded(stream) {
    return stream.end && stream.end.val === true;
  }

  function listenersNeedUpdating(s) {
    return s.listeners.some(function(s) { return s.shouldUpdate; });
  }

  /**
   * @private
   * Update a dependent stream using its dependencies in an atomic way
   * @param {stream} stream - the stream to update
   */
  function updateStream(s) {
    if (isEnded(s) || !dependenciesAreMet(s)) return;
    if (inStream !== undefined) {
      updateLaterUsing(updateStream, s);
      return;
    }
    inStream = s;
    if (s.depsChanged) s.fnArgs[s.fnArgs.length - 1] = s.depsChanged;
    var returnVal = s.fn.apply(s.fn, s.fnArgs);
    if (returnVal !== undefined) {
      s(returnVal);
    }
    inStream = undefined;
    if (s.depsChanged !== undefined) s.depsChanged = [];
    s.shouldUpdate = false;
    if (flushing() === false) flushUpdate();
    if (listenersNeedUpdating(s)) {
      if (!flushingStreamValue) s(s.val);
      else {
        s.listeners.forEach(function(listener) {
          if (listener.shouldUpdate) updateLaterUsing(updateStream, listener);
        });
      }
    }
  }

  /**
   * @private
   * Update the dependencies of a stream
   * @param {stream} stream
   */
  function updateListeners(s) {
    var i, o, list;
    var listeners = s.listeners;
    for (i = 0; i < listeners.length; ++i) {
      list = listeners[i];
      if (list.end === s) {
        endStream(list);
      } else {
        if (list.depsChanged !== undefined) list.depsChanged.push(s);
        list.shouldUpdate = true;
        findDeps(list);
      }
    }
    for (; orderNextIdx >= 0; --orderNextIdx) {
      o = order[orderNextIdx];
      if (o.shouldUpdate === true) updateStream(o);
      o.queued = false;
    }
  }

  /**
   * @private
   * Add stream dependencies to the global `order` queue.
   * @param {stream} stream
   * @see updateDeps
   */
  function findDeps(s) {
    var i;
    var listeners = s.listeners;
    if (s.queued === false) {
      s.queued = true;
      for (i = 0; i < listeners.length; ++i) {
        findDeps(listeners[i]);
      }
      order[++orderNextIdx] = s;
    }
  }

  function updateLaterUsing(updater, stream) {
    toUpdate.push(stream);
    stream.updaters.push(updater);
    stream.shouldUpdate = true;
  }

  /**
   * @private
   */
  function flushUpdate() {
    flushingUpdateQueue = true;
    while (toUpdate.length > 0) {
      var stream = toUpdate.shift();
      var nextUpdateFn = stream.updaters.shift();
      if (nextUpdateFn && stream.shouldUpdate) nextUpdateFn(stream);
    }
    flushingUpdateQueue = false;
  }

  /**
   * @private
   * Push down a value into a stream
   * @param {stream} stream
   * @param {*} value
   */
  function updateStreamValue(n, s) {
    s.val = n;
    s.hasVal = true;
    if (inStream === undefined) {
      flushingStreamValue = true;
      updateListeners(s);
      if (toUpdate.length > 0) flushUpdate();
      flushingStreamValue = false;
    } else if (inStream === s) {
      markListeners(s, s.listeners);
    } else {
      updateLaterUsing(function(s) { updateStreamValue(n, s); }, s);
    }
  }

  /**
   * @private
   */
  function markListeners(s, lists) {
    var i, list;
    for (i = 0; i < lists.length; ++i) {
      list = lists[i];
      if (list.end !== s) {
        if (list.depsChanged !== undefined) {
          list.depsChanged.push(s);
        }
        list.shouldUpdate = true;
      } else {
        endStream(list);
      }
    }
  }

  /**
   * @private
   * Add dependencies to a stream
   * @param {Array<stream>} dependencies
   * @param {stream} stream
   */
  function addListeners(deps, s) {
    for (var i = 0; i < deps.length; ++i) {
      deps[i].listeners.push(s);
    }
  }

  /**
   * @private
   * Removes an stream from a dependency array
   * @param {stream} stream
   * @param {Array<stream>} dependencies
   */
  function removeListener(s, listeners) {
    var idx = listeners.indexOf(s);
    listeners[idx] = listeners[listeners.length - 1];
    listeners.length--;
  }

  /**
   * @private
   * Detach a stream from its dependencies
   * @param {stream} stream
   */
  function detachDeps(s) {
    for (var i = 0; i < s.deps.length; ++i) {
      removeListener(s, s.deps[i].listeners);
    }
    s.deps.length = 0;
  }

  /**
   * @private
   * Ends a stream
   */
  function endStream(s) {
    if (s.deps !== undefined) detachDeps(s);
    if (s.end !== undefined) detachDeps(s.end);
  }

  /**
   * @private
   */
  /**
   * @private
   * transducer stream transformer
   */
  function StreamTransformer() { }
  StreamTransformer.prototype['@@transducer/init'] = function() { };
  StreamTransformer.prototype['@@transducer/result'] = function() { };
  StreamTransformer.prototype['@@transducer/step'] = function(s, v) { return v; };

  var lib = flyd;

  function _isPlaceholder$1(a) {
         return a != null && typeof a === 'object' && a['@@functional/placeholder'] === true;
  }

  /**
   * Optimized internal one-arity curry function.
   *
   * @private
   * @category Function
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */
  function _curry1$1(fn) {
    return function f1(a) {
      if (arguments.length === 0 || _isPlaceholder$1(a)) {
        return f1;
      } else {
        return fn.apply(this, arguments);
      }
    };
  }

  /**
   * Returns a function that always returns the given value. Note that for
   * non-primitives the value returned is a reference to the original value.
   *
   * This function is known as `const`, `constant`, or `K` (for K combinator) in
   * other languages and libraries.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig a -> (* -> a)
   * @param {*} val The value to wrap in a function
   * @return {Function} A Function :: * -> val.
   * @example
   *
   *      var t = R.always('Tee');
   *      t(); //=> 'Tee'
   */
  var always = /*#__PURE__*/_curry1$1(function always(val) {
    return function () {
      return val;
    };
  });

  /**
   * A function that always returns `false`. Any passed in parameters are ignored.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category Function
   * @sig * -> Boolean
   * @param {*}
   * @return {Boolean}
   * @see R.always, R.T
   * @example
   *
   *      R.F(); //=> false
   */
  var F = /*#__PURE__*/always(false);

  /**
   * A function that always returns `true`. Any passed in parameters are ignored.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category Function
   * @sig * -> Boolean
   * @param {*}
   * @return {Boolean}
   * @see R.always, R.F
   * @example
   *
   *      R.T(); //=> true
   */
  var T = /*#__PURE__*/always(true);

  /**
   * A special placeholder value used to specify "gaps" within curried functions,
   * allowing partial application of any combination of arguments, regardless of
   * their positions.
   *
   * If `g` is a curried ternary function and `_` is `R.__`, the following are
   * equivalent:
   *
   *   - `g(1, 2, 3)`
   *   - `g(_, 2, 3)(1)`
   *   - `g(_, _, 3)(1)(2)`
   *   - `g(_, _, 3)(1, 2)`
   *   - `g(_, 2, _)(1, 3)`
   *   - `g(_, 2)(1)(3)`
   *   - `g(_, 2)(1, 3)`
   *   - `g(_, 2)(_, 3)(1)`
   *
   * @constant
   * @memberOf R
   * @since v0.6.0
   * @category Function
   * @example
   *
   *      var greet = R.replace('{name}', R.__, 'Hello, {name}!');
   *      greet('Alice'); //=> 'Hello, Alice!'
   */

  /**
   * Optimized internal two-arity curry function.
   *
   * @private
   * @category Function
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */
  function _curry2$1(fn) {
    return function f2(a, b) {
      switch (arguments.length) {
        case 0:
          return f2;
        case 1:
          return _isPlaceholder$1(a) ? f2 : _curry1$1(function (_b) {
            return fn(a, _b);
          });
        default:
          return _isPlaceholder$1(a) && _isPlaceholder$1(b) ? f2 : _isPlaceholder$1(a) ? _curry1$1(function (_a) {
            return fn(_a, b);
          }) : _isPlaceholder$1(b) ? _curry1$1(function (_b) {
            return fn(a, _b);
          }) : fn(a, b);
      }
    };
  }

  /**
   * Adds two values.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Math
   * @sig Number -> Number -> Number
   * @param {Number} a
   * @param {Number} b
   * @return {Number}
   * @see R.subtract
   * @example
   *
   *      R.add(2, 3);       //=>  5
   *      R.add(7)(10);      //=> 17
   */
  var add = /*#__PURE__*/_curry2$1(function add(a, b) {
    return Number(a) + Number(b);
  });

  /**
   * Private `concat` function to merge two array-like objects.
   *
   * @private
   * @param {Array|Arguments} [set1=[]] An array-like object.
   * @param {Array|Arguments} [set2=[]] An array-like object.
   * @return {Array} A new, merged array.
   * @example
   *
   *      _concat([4, 5, 6], [1, 2, 3]); //=> [4, 5, 6, 1, 2, 3]
   */
  function _concat(set1, set2) {
    set1 = set1 || [];
    set2 = set2 || [];
    var idx;
    var len1 = set1.length;
    var len2 = set2.length;
    var result = [];

    idx = 0;
    while (idx < len1) {
      result[result.length] = set1[idx];
      idx += 1;
    }
    idx = 0;
    while (idx < len2) {
      result[result.length] = set2[idx];
      idx += 1;
    }
    return result;
  }

  function _arity$1(n, fn) {
    /* eslint-disable no-unused-vars */
    switch (n) {
      case 0:
        return function () {
          return fn.apply(this, arguments);
        };
      case 1:
        return function (a0) {
          return fn.apply(this, arguments);
        };
      case 2:
        return function (a0, a1) {
          return fn.apply(this, arguments);
        };
      case 3:
        return function (a0, a1, a2) {
          return fn.apply(this, arguments);
        };
      case 4:
        return function (a0, a1, a2, a3) {
          return fn.apply(this, arguments);
        };
      case 5:
        return function (a0, a1, a2, a3, a4) {
          return fn.apply(this, arguments);
        };
      case 6:
        return function (a0, a1, a2, a3, a4, a5) {
          return fn.apply(this, arguments);
        };
      case 7:
        return function (a0, a1, a2, a3, a4, a5, a6) {
          return fn.apply(this, arguments);
        };
      case 8:
        return function (a0, a1, a2, a3, a4, a5, a6, a7) {
          return fn.apply(this, arguments);
        };
      case 9:
        return function (a0, a1, a2, a3, a4, a5, a6, a7, a8) {
          return fn.apply(this, arguments);
        };
      case 10:
        return function (a0, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
          return fn.apply(this, arguments);
        };
      default:
        throw new Error('First argument to _arity must be a non-negative integer no greater than ten');
    }
  }

  /**
   * Internal curryN function.
   *
   * @private
   * @category Function
   * @param {Number} length The arity of the curried function.
   * @param {Array} received An array of arguments received thus far.
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */
  function _curryN$1(length, received, fn) {
    return function () {
      var combined = [];
      var argsIdx = 0;
      var left = length;
      var combinedIdx = 0;
      while (combinedIdx < received.length || argsIdx < arguments.length) {
        var result;
        if (combinedIdx < received.length && (!_isPlaceholder$1(received[combinedIdx]) || argsIdx >= arguments.length)) {
          result = received[combinedIdx];
        } else {
          result = arguments[argsIdx];
          argsIdx += 1;
        }
        combined[combinedIdx] = result;
        if (!_isPlaceholder$1(result)) {
          left -= 1;
        }
        combinedIdx += 1;
      }
      return left <= 0 ? fn.apply(this, combined) : _arity$1(left, _curryN$1(length, combined, fn));
    };
  }

  /**
   * Returns a curried equivalent of the provided function, with the specified
   * arity. The curried function has two unusual capabilities. First, its
   * arguments needn't be provided one at a time. If `g` is `R.curryN(3, f)`, the
   * following are equivalent:
   *
   *   - `g(1)(2)(3)`
   *   - `g(1)(2, 3)`
   *   - `g(1, 2)(3)`
   *   - `g(1, 2, 3)`
   *
   * Secondly, the special placeholder value [`R.__`](#__) may be used to specify
   * "gaps", allowing partial application of any combination of arguments,
   * regardless of their positions. If `g` is as above and `_` is [`R.__`](#__),
   * the following are equivalent:
   *
   *   - `g(1, 2, 3)`
   *   - `g(_, 2, 3)(1)`
   *   - `g(_, _, 3)(1)(2)`
   *   - `g(_, _, 3)(1, 2)`
   *   - `g(_, 2)(1)(3)`
   *   - `g(_, 2)(1, 3)`
   *   - `g(_, 2)(_, 3)(1)`
   *
   * @func
   * @memberOf R
   * @since v0.5.0
   * @category Function
   * @sig Number -> (* -> a) -> (* -> a)
   * @param {Number} length The arity for the returned function.
   * @param {Function} fn The function to curry.
   * @return {Function} A new, curried function.
   * @see R.curry
   * @example
   *
   *      var sumArgs = (...args) => R.sum(args);
   *
   *      var curriedAddFourNumbers = R.curryN(4, sumArgs);
   *      var f = curriedAddFourNumbers(1, 2);
   *      var g = f(3);
   *      g(4); //=> 10
   */
  var curryN$1 = /*#__PURE__*/_curry2$1(function curryN(length, fn) {
    if (length === 1) {
      return _curry1$1(fn);
    }
    return _arity$1(length, _curryN$1(length, [], fn));
  });

  /**
   * Optimized internal three-arity curry function.
   *
   * @private
   * @category Function
   * @param {Function} fn The function to curry.
   * @return {Function} The curried function.
   */
  function _curry3(fn) {
    return function f3(a, b, c) {
      switch (arguments.length) {
        case 0:
          return f3;
        case 1:
          return _isPlaceholder$1(a) ? f3 : _curry2$1(function (_b, _c) {
            return fn(a, _b, _c);
          });
        case 2:
          return _isPlaceholder$1(a) && _isPlaceholder$1(b) ? f3 : _isPlaceholder$1(a) ? _curry2$1(function (_a, _c) {
            return fn(_a, b, _c);
          }) : _isPlaceholder$1(b) ? _curry2$1(function (_b, _c) {
            return fn(a, _b, _c);
          }) : _curry1$1(function (_c) {
            return fn(a, b, _c);
          });
        default:
          return _isPlaceholder$1(a) && _isPlaceholder$1(b) && _isPlaceholder$1(c) ? f3 : _isPlaceholder$1(a) && _isPlaceholder$1(b) ? _curry2$1(function (_a, _b) {
            return fn(_a, _b, c);
          }) : _isPlaceholder$1(a) && _isPlaceholder$1(c) ? _curry2$1(function (_a, _c) {
            return fn(_a, b, _c);
          }) : _isPlaceholder$1(b) && _isPlaceholder$1(c) ? _curry2$1(function (_b, _c) {
            return fn(a, _b, _c);
          }) : _isPlaceholder$1(a) ? _curry1$1(function (_a) {
            return fn(_a, b, c);
          }) : _isPlaceholder$1(b) ? _curry1$1(function (_b) {
            return fn(a, _b, c);
          }) : _isPlaceholder$1(c) ? _curry1$1(function (_c) {
            return fn(a, b, _c);
          }) : fn(a, b, c);
      }
    };
  }

  /**
   * Tests whether or not an object is an array.
   *
   * @private
   * @param {*} val The object to test.
   * @return {Boolean} `true` if `val` is an array, `false` otherwise.
   * @example
   *
   *      _isArray([]); //=> true
   *      _isArray(null); //=> false
   *      _isArray({}); //=> false
   */
  var _isArray = Array.isArray || function _isArray(val) {
    return val != null && val.length >= 0 && Object.prototype.toString.call(val) === '[object Array]';
  };

  function _isTransformer(obj) {
    return typeof obj['@@transducer/step'] === 'function';
  }

  /**
   * Returns a function that dispatches with different strategies based on the
   * object in list position (last argument). If it is an array, executes [fn].
   * Otherwise, if it has a function with one of the given method names, it will
   * execute that function (functor case). Otherwise, if it is a transformer,
   * uses transducer [xf] to return a new transformer (transducer case).
   * Otherwise, it will default to executing [fn].
   *
   * @private
   * @param {Array} methodNames properties to check for a custom implementation
   * @param {Function} xf transducer to initialize if object is transformer
   * @param {Function} fn default ramda implementation
   * @return {Function} A function that dispatches on object in list position
   */
  function _dispatchable(methodNames, xf, fn) {
    return function () {
      if (arguments.length === 0) {
        return fn();
      }
      var args = Array.prototype.slice.call(arguments, 0);
      var obj = args.pop();
      if (!_isArray(obj)) {
        var idx = 0;
        while (idx < methodNames.length) {
          if (typeof obj[methodNames[idx]] === 'function') {
            return obj[methodNames[idx]].apply(obj, args);
          }
          idx += 1;
        }
        if (_isTransformer(obj)) {
          var transducer = xf.apply(null, args);
          return transducer(obj);
        }
      }
      return fn.apply(this, arguments);
    };
  }

  var _xfBase = {
    init: function () {
      return this.xf['@@transducer/init']();
    },
    result: function (result) {
      return this.xf['@@transducer/result'](result);
    }
  };

  /**
   * Returns the larger of its two arguments.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Relation
   * @sig Ord a => a -> a -> a
   * @param {*} a
   * @param {*} b
   * @return {*}
   * @see R.maxBy, R.min
   * @example
   *
   *      R.max(789, 123); //=> 789
   *      R.max('a', 'b'); //=> 'b'
   */
  var max = /*#__PURE__*/_curry2$1(function max(a, b) {
    return b > a ? b : a;
  });

  function _map(fn, functor) {
    var idx = 0;
    var len = functor.length;
    var result = Array(len);
    while (idx < len) {
      result[idx] = fn(functor[idx]);
      idx += 1;
    }
    return result;
  }

  function _isString(x) {
    return Object.prototype.toString.call(x) === '[object String]';
  }

  /**
   * Tests whether or not an object is similar to an array.
   *
   * @private
   * @category Type
   * @category List
   * @sig * -> Boolean
   * @param {*} x The object to test.
   * @return {Boolean} `true` if `x` has a numeric length property and extreme indices defined; `false` otherwise.
   * @example
   *
   *      _isArrayLike([]); //=> true
   *      _isArrayLike(true); //=> false
   *      _isArrayLike({}); //=> false
   *      _isArrayLike({length: 10}); //=> false
   *      _isArrayLike({0: 'zero', 9: 'nine', length: 10}); //=> true
   */
  var _isArrayLike = /*#__PURE__*/_curry1$1(function isArrayLike(x) {
    if (_isArray(x)) {
      return true;
    }
    if (!x) {
      return false;
    }
    if (typeof x !== 'object') {
      return false;
    }
    if (_isString(x)) {
      return false;
    }
    if (x.nodeType === 1) {
      return !!x.length;
    }
    if (x.length === 0) {
      return true;
    }
    if (x.length > 0) {
      return x.hasOwnProperty(0) && x.hasOwnProperty(x.length - 1);
    }
    return false;
  });

  var XWrap = /*#__PURE__*/function () {
    function XWrap(fn) {
      this.f = fn;
    }
    XWrap.prototype['@@transducer/init'] = function () {
      throw new Error('init not implemented on XWrap');
    };
    XWrap.prototype['@@transducer/result'] = function (acc) {
      return acc;
    };
    XWrap.prototype['@@transducer/step'] = function (acc, x) {
      return this.f(acc, x);
    };

    return XWrap;
  }();

  function _xwrap(fn) {
    return new XWrap(fn);
  }

  /**
   * Creates a function that is bound to a context.
   * Note: `R.bind` does not provide the additional argument-binding capabilities of
   * [Function.prototype.bind](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Function/bind).
   *
   * @func
   * @memberOf R
   * @since v0.6.0
   * @category Function
   * @category Object
   * @sig (* -> *) -> {*} -> (* -> *)
   * @param {Function} fn The function to bind to context
   * @param {Object} thisObj The context to bind `fn` to
   * @return {Function} A function that will execute in the context of `thisObj`.
   * @see R.partial
   * @example
   *
   *      var log = R.bind(console.log, console);
   *      R.pipe(R.assoc('a', 2), R.tap(log), R.assoc('a', 3))({a: 1}); //=> {a: 3}
   *      // logs {a: 2}
   * @symb R.bind(f, o)(a, b) = f.call(o, a, b)
   */
  var bind = /*#__PURE__*/_curry2$1(function bind(fn, thisObj) {
    return _arity$1(fn.length, function () {
      return fn.apply(thisObj, arguments);
    });
  });

  function _arrayReduce(xf, acc, list) {
    var idx = 0;
    var len = list.length;
    while (idx < len) {
      acc = xf['@@transducer/step'](acc, list[idx]);
      if (acc && acc['@@transducer/reduced']) {
        acc = acc['@@transducer/value'];
        break;
      }
      idx += 1;
    }
    return xf['@@transducer/result'](acc);
  }

  function _iterableReduce(xf, acc, iter) {
    var step = iter.next();
    while (!step.done) {
      acc = xf['@@transducer/step'](acc, step.value);
      if (acc && acc['@@transducer/reduced']) {
        acc = acc['@@transducer/value'];
        break;
      }
      step = iter.next();
    }
    return xf['@@transducer/result'](acc);
  }

  function _methodReduce(xf, acc, obj, methodName) {
    return xf['@@transducer/result'](obj[methodName](bind(xf['@@transducer/step'], xf), acc));
  }

  var symIterator = typeof Symbol !== 'undefined' ? Symbol.iterator : '@@iterator';

  function _reduce(fn, acc, list) {
    if (typeof fn === 'function') {
      fn = _xwrap(fn);
    }
    if (_isArrayLike(list)) {
      return _arrayReduce(fn, acc, list);
    }
    if (typeof list['fantasy-land/reduce'] === 'function') {
      return _methodReduce(fn, acc, list, 'fantasy-land/reduce');
    }
    if (list[symIterator] != null) {
      return _iterableReduce(fn, acc, list[symIterator]());
    }
    if (typeof list.next === 'function') {
      return _iterableReduce(fn, acc, list);
    }
    if (typeof list.reduce === 'function') {
      return _methodReduce(fn, acc, list, 'reduce');
    }

    throw new TypeError('reduce: list must be array or iterable');
  }

  var XMap = /*#__PURE__*/function () {
    function XMap(f, xf) {
      this.xf = xf;
      this.f = f;
    }
    XMap.prototype['@@transducer/init'] = _xfBase.init;
    XMap.prototype['@@transducer/result'] = _xfBase.result;
    XMap.prototype['@@transducer/step'] = function (result, input) {
      return this.xf['@@transducer/step'](result, this.f(input));
    };

    return XMap;
  }();

  var _xmap = /*#__PURE__*/_curry2$1(function _xmap(f, xf) {
    return new XMap(f, xf);
  });

  function _has(prop, obj) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  }

  var toString = Object.prototype.toString;
  var _isArguments = function () {
    return toString.call(arguments) === '[object Arguments]' ? function _isArguments(x) {
      return toString.call(x) === '[object Arguments]';
    } : function _isArguments(x) {
      return _has('callee', x);
    };
  };

  // cover IE < 9 keys issues
  var hasEnumBug = ! /*#__PURE__*/{ toString: null }.propertyIsEnumerable('toString');
  var nonEnumerableProps = ['constructor', 'valueOf', 'isPrototypeOf', 'toString', 'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];
  // Safari bug
  var hasArgsEnumBug = /*#__PURE__*/function () {

    return arguments.propertyIsEnumerable('length');
  }();

  var contains = function contains(list, item) {
    var idx = 0;
    while (idx < list.length) {
      if (list[idx] === item) {
        return true;
      }
      idx += 1;
    }
    return false;
  };

  /**
   * Returns a list containing the names of all the enumerable own properties of
   * the supplied object.
   * Note that the order of the output array is not guaranteed to be consistent
   * across different JS platforms.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Object
   * @sig {k: v} -> [k]
   * @param {Object} obj The object to extract properties from
   * @return {Array} An array of the object's own properties.
   * @see R.keysIn, R.values
   * @example
   *
   *      R.keys({a: 1, b: 2, c: 3}); //=> ['a', 'b', 'c']
   */
  var _keys = typeof Object.keys === 'function' && !hasArgsEnumBug ? function keys(obj) {
    return Object(obj) !== obj ? [] : Object.keys(obj);
  } : function keys(obj) {
    if (Object(obj) !== obj) {
      return [];
    }
    var prop, nIdx;
    var ks = [];
    var checkArgsLength = hasArgsEnumBug && _isArguments(obj);
    for (prop in obj) {
      if (_has(prop, obj) && (!checkArgsLength || prop !== 'length')) {
        ks[ks.length] = prop;
      }
    }
    if (hasEnumBug) {
      nIdx = nonEnumerableProps.length - 1;
      while (nIdx >= 0) {
        prop = nonEnumerableProps[nIdx];
        if (_has(prop, obj) && !contains(ks, prop)) {
          ks[ks.length] = prop;
        }
        nIdx -= 1;
      }
    }
    return ks;
  };
  var keys = /*#__PURE__*/_curry1$1(_keys);

  /**
   * Takes a function and
   * a [functor](https://github.com/fantasyland/fantasy-land#functor),
   * applies the function to each of the functor's values, and returns
   * a functor of the same shape.
   *
   * Ramda provides suitable `map` implementations for `Array` and `Object`,
   * so this function may be applied to `[1, 2, 3]` or `{x: 1, y: 2, z: 3}`.
   *
   * Dispatches to the `map` method of the second argument, if present.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * Also treats functions as functors and will compose them together.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig Functor f => (a -> b) -> f a -> f b
   * @param {Function} fn The function to be called on every element of the input `list`.
   * @param {Array} list The list to be iterated over.
   * @return {Array} The new list.
   * @see R.transduce, R.addIndex
   * @example
   *
   *      var double = x => x * 2;
   *
   *      R.map(double, [1, 2, 3]); //=> [2, 4, 6]
   *
   *      R.map(double, {x: 1, y: 2, z: 3}); //=> {x: 2, y: 4, z: 6}
   * @symb R.map(f, [a, b]) = [f(a), f(b)]
   * @symb R.map(f, { x: a, y: b }) = { x: f(a), y: f(b) }
   * @symb R.map(f, functor_o) = functor_o.map(f)
   */
  var map$1 = /*#__PURE__*/_curry2$1( /*#__PURE__*/_dispatchable(['fantasy-land/map', 'map'], _xmap, function map(fn, functor) {
    switch (Object.prototype.toString.call(functor)) {
      case '[object Function]':
        return curryN$1(functor.length, function () {
          return fn.call(this, functor.apply(this, arguments));
        });
      case '[object Object]':
        return _reduce(function (acc, key) {
          acc[key] = fn(functor[key]);
          return acc;
        }, {}, keys(functor));
      default:
        return _map(fn, functor);
    }
  }));

  /**
   * Retrieve the value at a given path.
   *
   * @func
   * @memberOf R
   * @since v0.2.0
   * @category Object
   * @typedefn Idx = String | Int
   * @sig [Idx] -> {a} -> a | Undefined
   * @param {Array} path The path to use.
   * @param {Object} obj The object to retrieve the nested property from.
   * @return {*} The data at `path`.
   * @see R.prop
   * @example
   *
   *      R.path(['a', 'b'], {a: {b: 2}}); //=> 2
   *      R.path(['a', 'b'], {c: {b: 2}}); //=> undefined
   */
  var path = /*#__PURE__*/_curry2$1(function path(paths, obj) {
    var val = obj;
    var idx = 0;
    while (idx < paths.length) {
      if (val == null) {
        return;
      }
      val = val[paths[idx]];
      idx += 1;
    }
    return val;
  });

  /**
   * Returns a function that when supplied an object returns the indicated
   * property of that object, if it exists.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Object
   * @sig s -> {s: a} -> a | Undefined
   * @param {String} p The property name
   * @param {Object} obj The object to query
   * @return {*} The value at `obj.p`.
   * @see R.path
   * @example
   *
   *      R.prop('x', {x: 100}); //=> 100
   *      R.prop('x', {}); //=> undefined
   */

  var prop = /*#__PURE__*/_curry2$1(function prop(p, obj) {
    return path([p], obj);
  });

  /**
   * Returns a new list by plucking the same named property off all objects in
   * the list supplied.
   *
   * `pluck` will work on
   * any [functor](https://github.com/fantasyland/fantasy-land#functor) in
   * addition to arrays, as it is equivalent to `R.map(R.prop(k), f)`.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig Functor f => k -> f {k: v} -> f v
   * @param {Number|String} key The key name to pluck off of each object.
   * @param {Array} f The array or functor to consider.
   * @return {Array} The list of values for the given key.
   * @see R.props
   * @example
   *
   *      R.pluck('a')([{a: 1}, {a: 2}]); //=> [1, 2]
   *      R.pluck(0)([[1, 2], [3, 4]]);   //=> [1, 3]
   *      R.pluck('val', {a: {val: 3}, b: {val: 5}}); //=> {a: 3, b: 5}
   * @symb R.pluck('x', [{x: 1, y: 2}, {x: 3, y: 4}, {x: 5, y: 6}]) = [1, 3, 5]
   * @symb R.pluck(0, [[1, 2], [3, 4], [5, 6]]) = [1, 3, 5]
   */
  var pluck = /*#__PURE__*/_curry2$1(function pluck(p, list) {
    return map$1(prop(p), list);
  });

  /**
   * Returns a single item by iterating through the list, successively calling
   * the iterator function and passing it an accumulator value and the current
   * value from the array, and then passing the result to the next call.
   *
   * The iterator function receives two values: *(acc, value)*. It may use
   * [`R.reduced`](#reduced) to shortcut the iteration.
   *
   * The arguments' order of [`reduceRight`](#reduceRight)'s iterator function
   * is *(value, acc)*.
   *
   * Note: `R.reduce` does not skip deleted or unassigned indices (sparse
   * arrays), unlike the native `Array.prototype.reduce` method. For more details
   * on this behavior, see:
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/reduce#Description
   *
   * Dispatches to the `reduce` method of the third argument, if present. When
   * doing so, it is up to the user to handle the [`R.reduced`](#reduced)
   * shortcuting, as this is not implemented by `reduce`.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig ((a, b) -> a) -> a -> [b] -> a
   * @param {Function} fn The iterator function. Receives two values, the accumulator and the
   *        current element from the array.
   * @param {*} acc The accumulator value.
   * @param {Array} list The list to iterate over.
   * @return {*} The final, accumulated value.
   * @see R.reduced, R.addIndex, R.reduceRight
   * @example
   *
   *      R.reduce(R.subtract, 0, [1, 2, 3, 4]) // => ((((0 - 1) - 2) - 3) - 4) = -10
   *      //          -               -10
   *      //         / \              / \
   *      //        -   4           -6   4
   *      //       / \              / \
   *      //      -   3   ==>     -3   3
   *      //     / \              / \
   *      //    -   2           -1   2
   *      //   / \              / \
   *      //  0   1            0   1
   *
   * @symb R.reduce(f, a, [b, c, d]) = f(f(f(a, b), c), d)
   */
  var reduce = /*#__PURE__*/_curry3(_reduce);

  /**
   * ap applies a list of functions to a list of values.
   *
   * Dispatches to the `ap` method of the second argument, if present. Also
   * treats curried functions as applicatives.
   *
   * @func
   * @memberOf R
   * @since v0.3.0
   * @category Function
   * @sig [a -> b] -> [a] -> [b]
   * @sig Apply f => f (a -> b) -> f a -> f b
   * @sig (a -> b -> c) -> (a -> b) -> (a -> c)
   * @param {*} applyF
   * @param {*} applyX
   * @return {*}
   * @example
   *
   *      R.ap([R.multiply(2), R.add(3)], [1,2,3]); //=> [2, 4, 6, 4, 5, 6]
   *      R.ap([R.concat('tasty '), R.toUpper], ['pizza', 'salad']); //=> ["tasty pizza", "tasty salad", "PIZZA", "SALAD"]
   *
   *      // R.ap can also be used as S combinator
   *      // when only two functions are passed
   *      R.ap(R.concat, R.toUpper)('Ramda') //=> 'RamdaRAMDA'
   * @symb R.ap([f, g], [a, b]) = [f(a), f(b), g(a), g(b)]
   */
  var ap$1 = /*#__PURE__*/_curry2$1(function ap(applyF, applyX) {
    return typeof applyX['fantasy-land/ap'] === 'function' ? applyX['fantasy-land/ap'](applyF) : typeof applyF.ap === 'function' ? applyF.ap(applyX) : typeof applyF === 'function' ? function (x) {
      return applyF(x)(applyX(x));
    } :
    // else
    _reduce(function (acc, f) {
      return _concat(acc, map$1(f, applyX));
    }, [], applyF);
  });

  /**
   * Determine if the passed argument is an integer.
   *
   * @private
   * @param {*} n
   * @category Type
   * @return {Boolean}
   */

  function _isFunction(x) {
    return Object.prototype.toString.call(x) === '[object Function]';
  }

  /**
   * "lifts" a function to be the specified arity, so that it may "map over" that
   * many lists, Functions or other objects that satisfy the [FantasyLand Apply spec](https://github.com/fantasyland/fantasy-land#apply).
   *
   * @func
   * @memberOf R
   * @since v0.7.0
   * @category Function
   * @sig Number -> (*... -> *) -> ([*]... -> [*])
   * @param {Function} fn The function to lift into higher context
   * @return {Function} The lifted function.
   * @see R.lift, R.ap
   * @example
   *
   *      var madd3 = R.liftN(3, (...args) => R.sum(args));
   *      madd3([1,2,3], [1,2,3], [1]); //=> [3, 4, 5, 4, 5, 6, 5, 6, 7]
   */
  var liftN = /*#__PURE__*/_curry2$1(function liftN(arity, fn) {
    var lifted = curryN$1(arity, fn);
    return curryN$1(arity, function () {
      return _reduce(ap$1, map$1(lifted, arguments[0]), Array.prototype.slice.call(arguments, 1));
    });
  });

  /**
   * "lifts" a function of arity > 1 so that it may "map over" a list, Function or other
   * object that satisfies the [FantasyLand Apply spec](https://github.com/fantasyland/fantasy-land#apply).
   *
   * @func
   * @memberOf R
   * @since v0.7.0
   * @category Function
   * @sig (*... -> *) -> ([*]... -> [*])
   * @param {Function} fn The function to lift into higher context
   * @return {Function} The lifted function.
   * @see R.liftN
   * @example
   *
   *      var madd3 = R.lift((a, b, c) => a + b + c);
   *
   *      madd3([1,2,3], [1,2,3], [1]); //=> [3, 4, 5, 4, 5, 6, 5, 6, 7]
   *
   *      var madd5 = R.lift((a, b, c, d, e) => a + b + c + d + e);
   *
   *      madd5([1,2], [3], [4, 5], [6], [7, 8]); //=> [21, 22, 22, 23, 22, 23, 23, 24]
   */
  var lift = /*#__PURE__*/_curry1$1(function lift(fn) {
    return liftN(fn.length, fn);
  });

  /**
   * Returns a curried equivalent of the provided function. The curried function
   * has two unusual capabilities. First, its arguments needn't be provided one
   * at a time. If `f` is a ternary function and `g` is `R.curry(f)`, the
   * following are equivalent:
   *
   *   - `g(1)(2)(3)`
   *   - `g(1)(2, 3)`
   *   - `g(1, 2)(3)`
   *   - `g(1, 2, 3)`
   *
   * Secondly, the special placeholder value [`R.__`](#__) may be used to specify
   * "gaps", allowing partial application of any combination of arguments,
   * regardless of their positions. If `g` is as above and `_` is [`R.__`](#__),
   * the following are equivalent:
   *
   *   - `g(1, 2, 3)`
   *   - `g(_, 2, 3)(1)`
   *   - `g(_, _, 3)(1)(2)`
   *   - `g(_, _, 3)(1, 2)`
   *   - `g(_, 2)(1)(3)`
   *   - `g(_, 2)(1, 3)`
   *   - `g(_, 2)(_, 3)(1)`
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig (* -> a) -> (* -> a)
   * @param {Function} fn The function to curry.
   * @return {Function} A new, curried function.
   * @see R.curryN
   * @example
   *
   *      var addFourNumbers = (a, b, c, d) => a + b + c + d;
   *
   *      var curriedAddFourNumbers = R.curry(addFourNumbers);
   *      var f = curriedAddFourNumbers(1, 2);
   *      var g = f(3);
   *      g(4); //=> 10
   */
  var curry = /*#__PURE__*/_curry1$1(function curry(fn) {
    return curryN$1(fn.length, fn);
  });

  /**
   * Returns the result of calling its first argument with the remaining
   * arguments. This is occasionally useful as a converging function for
   * [`R.converge`](#converge): the first branch can produce a function while the
   * remaining branches produce values to be passed to that function as its
   * arguments.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category Function
   * @sig (*... -> a),*... -> a
   * @param {Function} fn The function to apply to the remaining arguments.
   * @param {...*} args Any number of positional arguments.
   * @return {*}
   * @see R.apply
   * @example
   *
   *      R.call(R.add, 1, 2); //=> 3
   *
   *      var indentN = R.pipe(R.repeat(' '),
   *                           R.join(''),
   *                           R.replace(/^(?!$)/gm));
   *
   *      var format = R.converge(R.call, [
   *                                  R.pipe(R.prop('indent'), indentN),
   *                                  R.prop('value')
   *                              ]);
   *
   *      format({indent: 2, value: 'foo\nbar\nbaz\n'}); //=> '  foo\n  bar\n  baz\n'
   * @symb R.call(f, a, b) = f(a, b)
   */
  var call = /*#__PURE__*/curry(function call(fn) {
    return fn.apply(this, Array.prototype.slice.call(arguments, 1));
  });

  /**
   * `_makeFlat` is a helper function that returns a one-level or fully recursive
   * function based on the flag passed in.
   *
   * @private
   */
  function _makeFlat(recursive) {
    return function flatt(list) {
      var value, jlen, j;
      var result = [];
      var idx = 0;
      var ilen = list.length;

      while (idx < ilen) {
        if (_isArrayLike(list[idx])) {
          value = recursive ? flatt(list[idx]) : list[idx];
          j = 0;
          jlen = value.length;
          while (j < jlen) {
            result[result.length] = value[j];
            j += 1;
          }
        } else {
          result[result.length] = list[idx];
        }
        idx += 1;
      }
      return result;
    };
  }

  function _forceReduced(x) {
    return {
      '@@transducer/value': x,
      '@@transducer/reduced': true
    };
  }

  var preservingReduced = function (xf) {
    return {
      '@@transducer/init': _xfBase.init,
      '@@transducer/result': function (result) {
        return xf['@@transducer/result'](result);
      },
      '@@transducer/step': function (result, input) {
        var ret = xf['@@transducer/step'](result, input);
        return ret['@@transducer/reduced'] ? _forceReduced(ret) : ret;
      }
    };
  };

  var _flatCat = function _xcat(xf) {
    var rxf = preservingReduced(xf);
    return {
      '@@transducer/init': _xfBase.init,
      '@@transducer/result': function (result) {
        return rxf['@@transducer/result'](result);
      },
      '@@transducer/step': function (result, input) {
        return !_isArrayLike(input) ? _reduce(rxf, result, [input]) : _reduce(rxf, result, input);
      }
    };
  };

  var _xchain = /*#__PURE__*/_curry2$1(function _xchain(f, xf) {
    return map$1(f, _flatCat(xf));
  });

  /**
   * `chain` maps a function over a list and concatenates the results. `chain`
   * is also known as `flatMap` in some libraries
   *
   * Dispatches to the `chain` method of the second argument, if present,
   * according to the [FantasyLand Chain spec](https://github.com/fantasyland/fantasy-land#chain).
   *
   * @func
   * @memberOf R
   * @since v0.3.0
   * @category List
   * @sig Chain m => (a -> m b) -> m a -> m b
   * @param {Function} fn The function to map with
   * @param {Array} list The list to map over
   * @return {Array} The result of flat-mapping `list` with `fn`
   * @example
   *
   *      var duplicate = n => [n, n];
   *      R.chain(duplicate, [1, 2, 3]); //=> [1, 1, 2, 2, 3, 3]
   *
   *      R.chain(R.append, R.head)([1, 2, 3]); //=> [1, 2, 3, 1]
   */
  var chain$1 = /*#__PURE__*/_curry2$1( /*#__PURE__*/_dispatchable(['fantasy-land/chain', 'chain'], _xchain, function chain(fn, monad) {
    if (typeof monad === 'function') {
      return function (x) {
        return fn(monad(x))(x);
      };
    }
    return _makeFlat(false)(map$1(fn, monad));
  }));

  /**
   * Gives a single-word string description of the (native) type of a value,
   * returning such answers as 'Object', 'Number', 'Array', or 'Null'. Does not
   * attempt to distinguish user Object types any further, reporting them all as
   * 'Object'.
   *
   * @func
   * @memberOf R
   * @since v0.8.0
   * @category Type
   * @sig (* -> {*}) -> String
   * @param {*} val The value to test
   * @return {String}
   * @example
   *
   *      R.type({}); //=> "Object"
   *      R.type(1); //=> "Number"
   *      R.type(false); //=> "Boolean"
   *      R.type('s'); //=> "String"
   *      R.type(null); //=> "Null"
   *      R.type([]); //=> "Array"
   *      R.type(/[A-z]/); //=> "RegExp"
   *      R.type(() => {}); //=> "Function"
   *      R.type(undefined); //=> "Undefined"
   */
  var type = /*#__PURE__*/_curry1$1(function type(val) {
    return val === null ? 'Null' : val === undefined ? 'Undefined' : Object.prototype.toString.call(val).slice(8, -1);
  });

  /**
   * A function that returns the `!` of its argument. It will return `true` when
   * passed false-y value, and `false` when passed a truth-y one.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Logic
   * @sig * -> Boolean
   * @param {*} a any value
   * @return {Boolean} the logical inverse of passed argument.
   * @see R.complement
   * @example
   *
   *      R.not(true); //=> false
   *      R.not(false); //=> true
   *      R.not(0); //=> true
   *      R.not(1); //=> false
   */
  var not = /*#__PURE__*/_curry1$1(function not(a) {
    return !a;
  });

  /**
   * Takes a function `f` and returns a function `g` such that if called with the same arguments
   * when `f` returns a "truthy" value, `g` returns `false` and when `f` returns a "falsy" value `g` returns `true`.
   *
   * `R.complement` may be applied to any functor
   *
   * @func
   * @memberOf R
   * @since v0.12.0
   * @category Logic
   * @sig (*... -> *) -> (*... -> Boolean)
   * @param {Function} f
   * @return {Function}
   * @see R.not
   * @example
   *
   *      var isNotNil = R.complement(R.isNil);
   *      isNil(null); //=> true
   *      isNotNil(null); //=> false
   *      isNil(7); //=> false
   *      isNotNil(7); //=> true
   */
  var complement = /*#__PURE__*/lift(not);

  function _pipe(f, g) {
    return function () {
      return g.call(this, f.apply(this, arguments));
    };
  }

  /**
   * This checks whether a function has a [methodname] function. If it isn't an
   * array it will execute that function otherwise it will default to the ramda
   * implementation.
   *
   * @private
   * @param {Function} fn ramda implemtation
   * @param {String} methodname property to check for a custom implementation
   * @return {Object} Whatever the return value of the method is.
   */
  function _checkForMethod(methodname, fn) {
    return function () {
      var length = arguments.length;
      if (length === 0) {
        return fn();
      }
      var obj = arguments[length - 1];
      return _isArray(obj) || typeof obj[methodname] !== 'function' ? fn.apply(this, arguments) : obj[methodname].apply(obj, Array.prototype.slice.call(arguments, 0, length - 1));
    };
  }

  /**
   * Returns the elements of the given list or string (or object with a `slice`
   * method) from `fromIndex` (inclusive) to `toIndex` (exclusive).
   *
   * Dispatches to the `slice` method of the third argument, if present.
   *
   * @func
   * @memberOf R
   * @since v0.1.4
   * @category List
   * @sig Number -> Number -> [a] -> [a]
   * @sig Number -> Number -> String -> String
   * @param {Number} fromIndex The start index (inclusive).
   * @param {Number} toIndex The end index (exclusive).
   * @param {*} list
   * @return {*}
   * @example
   *
   *      R.slice(1, 3, ['a', 'b', 'c', 'd']);        //=> ['b', 'c']
   *      R.slice(1, Infinity, ['a', 'b', 'c', 'd']); //=> ['b', 'c', 'd']
   *      R.slice(0, -1, ['a', 'b', 'c', 'd']);       //=> ['a', 'b', 'c']
   *      R.slice(-3, -1, ['a', 'b', 'c', 'd']);      //=> ['b', 'c']
   *      R.slice(0, 3, 'ramda');                     //=> 'ram'
   */
  var slice = /*#__PURE__*/_curry3( /*#__PURE__*/_checkForMethod('slice', function slice(fromIndex, toIndex, list) {
    return Array.prototype.slice.call(list, fromIndex, toIndex);
  }));

  /**
   * Returns all but the first element of the given list or string (or object
   * with a `tail` method).
   *
   * Dispatches to the `slice` method of the first argument, if present.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig [a] -> [a]
   * @sig String -> String
   * @param {*} list
   * @return {*}
   * @see R.head, R.init, R.last
   * @example
   *
   *      R.tail([1, 2, 3]);  //=> [2, 3]
   *      R.tail([1, 2]);     //=> [2]
   *      R.tail([1]);        //=> []
   *      R.tail([]);         //=> []
   *
   *      R.tail('abc');  //=> 'bc'
   *      R.tail('ab');   //=> 'b'
   *      R.tail('a');    //=> ''
   *      R.tail('');     //=> ''
   */
  var tail = /*#__PURE__*/_curry1$1( /*#__PURE__*/_checkForMethod('tail', /*#__PURE__*/slice(1, Infinity)));

  /**
   * Performs left-to-right function composition. The leftmost function may have
   * any arity; the remaining functions must be unary.
   *
   * In some libraries this function is named `sequence`.
   *
   * **Note:** The result of pipe is not automatically curried.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig (((a, b, ..., n) -> o), (o -> p), ..., (x -> y), (y -> z)) -> ((a, b, ..., n) -> z)
   * @param {...Function} functions
   * @return {Function}
   * @see R.compose
   * @example
   *
   *      var f = R.pipe(Math.pow, R.negate, R.inc);
   *
   *      f(3, 4); // -(3^4) + 1
   * @symb R.pipe(f, g, h)(a, b) = h(g(f(a, b)))
   */
  function pipe() {
    if (arguments.length === 0) {
      throw new Error('pipe requires at least one argument');
    }
    return _arity$1(arguments[0].length, reduce(_pipe, arguments[0], tail(arguments)));
  }

  /**
   * Returns a new list or string with the elements or characters in reverse
   * order.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig [a] -> [a]
   * @sig String -> String
   * @param {Array|String} list
   * @return {Array|String}
   * @example
   *
   *      R.reverse([1, 2, 3]);  //=> [3, 2, 1]
   *      R.reverse([1, 2]);     //=> [2, 1]
   *      R.reverse([1]);        //=> [1]
   *      R.reverse([]);         //=> []
   *
   *      R.reverse('abc');      //=> 'cba'
   *      R.reverse('ab');       //=> 'ba'
   *      R.reverse('a');        //=> 'a'
   *      R.reverse('');         //=> ''
   */
  var reverse = /*#__PURE__*/_curry1$1(function reverse(list) {
    return _isString(list) ? list.split('').reverse().join('') : Array.prototype.slice.call(list, 0).reverse();
  });

  /**
   * Performs right-to-left function composition. The rightmost function may have
   * any arity; the remaining functions must be unary.
   *
   * **Note:** The result of compose is not automatically curried.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig ((y -> z), (x -> y), ..., (o -> p), ((a, b, ..., n) -> o)) -> ((a, b, ..., n) -> z)
   * @param {...Function} ...functions The functions to compose
   * @return {Function}
   * @see R.pipe
   * @example
   *
   *      var classyGreeting = (firstName, lastName) => "The name's " + lastName + ", " + firstName + " " + lastName
   *      var yellGreeting = R.compose(R.toUpper, classyGreeting);
   *      yellGreeting('James', 'Bond'); //=> "THE NAME'S BOND, JAMES BOND"
   *
   *      R.compose(Math.abs, R.add(1), R.multiply(2))(-4) //=> 7
   *
   * @symb R.compose(f, g, h)(a, b) = f(g(h(a, b)))
   */
  function compose() {
    if (arguments.length === 0) {
      throw new Error('compose requires at least one argument');
    }
    return pipe.apply(this, reverse(arguments));
  }

  function _arrayFromIterator(iter) {
    var list = [];
    var next;
    while (!(next = iter.next()).done) {
      list.push(next.value);
    }
    return list;
  }

  function _containsWith(pred, x, list) {
    var idx = 0;
    var len = list.length;

    while (idx < len) {
      if (pred(x, list[idx])) {
        return true;
      }
      idx += 1;
    }
    return false;
  }

  function _functionName(f) {
    // String(x => x) evaluates to "x => x", so the pattern may not match.
    var match = String(f).match(/^function (\w*)/);
    return match == null ? '' : match[1];
  }

  /**
   * Returns true if its arguments are identical, false otherwise. Values are
   * identical if they reference the same memory. `NaN` is identical to `NaN`;
   * `0` and `-0` are not identical.
   *
   * @func
   * @memberOf R
   * @since v0.15.0
   * @category Relation
   * @sig a -> a -> Boolean
   * @param {*} a
   * @param {*} b
   * @return {Boolean}
   * @example
   *
   *      var o = {};
   *      R.identical(o, o); //=> true
   *      R.identical(1, 1); //=> true
   *      R.identical(1, '1'); //=> false
   *      R.identical([], []); //=> false
   *      R.identical(0, -0); //=> false
   *      R.identical(NaN, NaN); //=> true
   */
  var identical = /*#__PURE__*/_curry2$1(function identical(a, b) {
    // SameValue algorithm
    if (a === b) {
      // Steps 1-5, 7-10
      // Steps 6.b-6.e: +0 != -0
      return a !== 0 || 1 / a === 1 / b;
    } else {
      // Step 6.a: NaN == NaN
      return a !== a && b !== b;
    }
  });

  /**
   * private _uniqContentEquals function.
   * That function is checking equality of 2 iterator contents with 2 assumptions
   * - iterators lengths are the same
   * - iterators values are unique
   *
   * false-positive result will be returned for comparision of, e.g.
   * - [1,2,3] and [1,2,3,4]
   * - [1,1,1] and [1,2,3]
   * */

  function _uniqContentEquals(aIterator, bIterator, stackA, stackB) {
    var a = _arrayFromIterator(aIterator);
    var b = _arrayFromIterator(bIterator);

    function eq(_a, _b) {
      return _equals(_a, _b, stackA.slice(), stackB.slice());
    }

    // if *a* array contains any element that is not included in *b*
    return !_containsWith(function (b, aItem) {
      return !_containsWith(eq, aItem, b);
    }, b, a);
  }

  function _equals(a, b, stackA, stackB) {
    if (identical(a, b)) {
      return true;
    }

    var typeA = type(a);

    if (typeA !== type(b)) {
      return false;
    }

    if (a == null || b == null) {
      return false;
    }

    if (typeof a['fantasy-land/equals'] === 'function' || typeof b['fantasy-land/equals'] === 'function') {
      return typeof a['fantasy-land/equals'] === 'function' && a['fantasy-land/equals'](b) && typeof b['fantasy-land/equals'] === 'function' && b['fantasy-land/equals'](a);
    }

    if (typeof a.equals === 'function' || typeof b.equals === 'function') {
      return typeof a.equals === 'function' && a.equals(b) && typeof b.equals === 'function' && b.equals(a);
    }

    switch (typeA) {
      case 'Arguments':
      case 'Array':
      case 'Object':
        if (typeof a.constructor === 'function' && _functionName(a.constructor) === 'Promise') {
          return a === b;
        }
        break;
      case 'Boolean':
      case 'Number':
      case 'String':
        if (!(typeof a === typeof b && identical(a.valueOf(), b.valueOf()))) {
          return false;
        }
        break;
      case 'Date':
        if (!identical(a.valueOf(), b.valueOf())) {
          return false;
        }
        break;
      case 'Error':
        return a.name === b.name && a.message === b.message;
      case 'RegExp':
        if (!(a.source === b.source && a.global === b.global && a.ignoreCase === b.ignoreCase && a.multiline === b.multiline && a.sticky === b.sticky && a.unicode === b.unicode)) {
          return false;
        }
        break;
    }

    var idx = stackA.length - 1;
    while (idx >= 0) {
      if (stackA[idx] === a) {
        return stackB[idx] === b;
      }
      idx -= 1;
    }

    switch (typeA) {
      case 'Map':
        if (a.size !== b.size) {
          return false;
        }

        return _uniqContentEquals(a.entries(), b.entries(), stackA.concat([a]), stackB.concat([b]));
      case 'Set':
        if (a.size !== b.size) {
          return false;
        }

        return _uniqContentEquals(a.values(), b.values(), stackA.concat([a]), stackB.concat([b]));
      case 'Arguments':
      case 'Array':
      case 'Object':
      case 'Boolean':
      case 'Number':
      case 'String':
      case 'Date':
      case 'Error':
      case 'RegExp':
      case 'Int8Array':
      case 'Uint8Array':
      case 'Uint8ClampedArray':
      case 'Int16Array':
      case 'Uint16Array':
      case 'Int32Array':
      case 'Uint32Array':
      case 'Float32Array':
      case 'Float64Array':
      case 'ArrayBuffer':
        break;
      default:
        // Values of other types are only equal if identical.
        return false;
    }

    var keysA = keys(a);
    if (keysA.length !== keys(b).length) {
      return false;
    }

    var extendedStackA = stackA.concat([a]);
    var extendedStackB = stackB.concat([b]);

    idx = keysA.length - 1;
    while (idx >= 0) {
      var key = keysA[idx];
      if (!(_has(key, b) && _equals(b[key], a[key], extendedStackA, extendedStackB))) {
        return false;
      }
      idx -= 1;
    }
    return true;
  }

  /**
   * Returns `true` if its arguments are equivalent, `false` otherwise. Handles
   * cyclical data structures.
   *
   * Dispatches symmetrically to the `equals` methods of both arguments, if
   * present.
   *
   * @func
   * @memberOf R
   * @since v0.15.0
   * @category Relation
   * @sig a -> b -> Boolean
   * @param {*} a
   * @param {*} b
   * @return {Boolean}
   * @example
   *
   *      R.equals(1, 1); //=> true
   *      R.equals(1, '1'); //=> false
   *      R.equals([1, 2, 3], [1, 2, 3]); //=> true
   *
   *      var a = {}; a.v = a;
   *      var b = {}; b.v = b;
   *      R.equals(a, b); //=> true
   */
  var equals = /*#__PURE__*/_curry2$1(function equals(a, b) {
    return _equals(a, b, [], []);
  });

  function _indexOf(list, a, idx) {
    var inf, item;
    // Array.prototype.indexOf doesn't exist below IE9
    if (typeof list.indexOf === 'function') {
      switch (typeof a) {
        case 'number':
          if (a === 0) {
            // manually crawl the list to distinguish between +0 and -0
            inf = 1 / a;
            while (idx < list.length) {
              item = list[idx];
              if (item === 0 && 1 / item === inf) {
                return idx;
              }
              idx += 1;
            }
            return -1;
          } else if (a !== a) {
            // NaN
            while (idx < list.length) {
              item = list[idx];
              if (typeof item === 'number' && item !== item) {
                return idx;
              }
              idx += 1;
            }
            return -1;
          }
          // non-zero numbers can utilise Set
          return list.indexOf(a, idx);

        // all these types can utilise Set
        case 'string':
        case 'boolean':
        case 'function':
        case 'undefined':
          return list.indexOf(a, idx);

        case 'object':
          if (a === null) {
            // null can utilise Set
            return list.indexOf(a, idx);
          }
      }
    }
    // anything else not covered above, defer to R.equals
    while (idx < list.length) {
      if (equals(list[idx], a)) {
        return idx;
      }
      idx += 1;
    }
    return -1;
  }

  function _contains(a, list) {
    return _indexOf(list, a, 0) >= 0;
  }

  function _quote(s) {
    var escaped = s.replace(/\\/g, '\\\\').replace(/[\b]/g, '\\b') // \b matches word boundary; [\b] matches backspace
    .replace(/\f/g, '\\f').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\v/g, '\\v').replace(/\0/g, '\\0');

    return '"' + escaped.replace(/"/g, '\\"') + '"';
  }

  /**
   * Polyfill from <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toISOString>.
   */
  var pad = function pad(n) {
    return (n < 10 ? '0' : '') + n;
  };

  var _toISOString = typeof Date.prototype.toISOString === 'function' ? function _toISOString(d) {
    return d.toISOString();
  } : function _toISOString(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '.' + (d.getUTCMilliseconds() / 1000).toFixed(3).slice(2, 5) + 'Z';
  };

  function _complement(f) {
    return function () {
      return !f.apply(this, arguments);
    };
  }

  function _filter(fn, list) {
    var idx = 0;
    var len = list.length;
    var result = [];

    while (idx < len) {
      if (fn(list[idx])) {
        result[result.length] = list[idx];
      }
      idx += 1;
    }
    return result;
  }

  function _isObject(x) {
    return Object.prototype.toString.call(x) === '[object Object]';
  }

  var XFilter = /*#__PURE__*/function () {
    function XFilter(f, xf) {
      this.xf = xf;
      this.f = f;
    }
    XFilter.prototype['@@transducer/init'] = _xfBase.init;
    XFilter.prototype['@@transducer/result'] = _xfBase.result;
    XFilter.prototype['@@transducer/step'] = function (result, input) {
      return this.f(input) ? this.xf['@@transducer/step'](result, input) : result;
    };

    return XFilter;
  }();

  var _xfilter = /*#__PURE__*/_curry2$1(function _xfilter(f, xf) {
    return new XFilter(f, xf);
  });

  /**
   * Takes a predicate and a `Filterable`, and returns a new filterable of the
   * same type containing the members of the given filterable which satisfy the
   * given predicate. Filterable objects include plain objects or any object
   * that has a filter method such as `Array`.
   *
   * Dispatches to the `filter` method of the second argument, if present.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig Filterable f => (a -> Boolean) -> f a -> f a
   * @param {Function} pred
   * @param {Array} filterable
   * @return {Array} Filterable
   * @see R.reject, R.transduce, R.addIndex
   * @example
   *
   *      var isEven = n => n % 2 === 0;
   *
   *      R.filter(isEven, [1, 2, 3, 4]); //=> [2, 4]
   *
   *      R.filter(isEven, {a: 1, b: 2, c: 3, d: 4}); //=> {b: 2, d: 4}
   */
  var filter = /*#__PURE__*/_curry2$1( /*#__PURE__*/_dispatchable(['filter'], _xfilter, function (pred, filterable) {
    return _isObject(filterable) ? _reduce(function (acc, key) {
      if (pred(filterable[key])) {
        acc[key] = filterable[key];
      }
      return acc;
    }, {}, keys(filterable)) :
    // else
    _filter(pred, filterable);
  }));

  /**
   * The complement of [`filter`](#filter).
   *
   * Acts as a transducer if a transformer is given in list position. Filterable
   * objects include plain objects or any object that has a filter method such
   * as `Array`.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig Filterable f => (a -> Boolean) -> f a -> f a
   * @param {Function} pred
   * @param {Array} filterable
   * @return {Array}
   * @see R.filter, R.transduce, R.addIndex
   * @example
   *
   *      var isOdd = (n) => n % 2 === 1;
   *
   *      R.reject(isOdd, [1, 2, 3, 4]); //=> [2, 4]
   *
   *      R.reject(isOdd, {a: 1, b: 2, c: 3, d: 4}); //=> {b: 2, d: 4}
   */
  var reject = /*#__PURE__*/_curry2$1(function reject(pred, filterable) {
    return filter(_complement(pred), filterable);
  });

  function _toString(x, seen) {
    var recur = function recur(y) {
      var xs = seen.concat([x]);
      return _contains(y, xs) ? '<Circular>' : _toString(y, xs);
    };

    //  mapPairs :: (Object, [String]) -> [String]
    var mapPairs = function (obj, keys$$1) {
      return _map(function (k) {
        return _quote(k) + ': ' + recur(obj[k]);
      }, keys$$1.slice().sort());
    };

    switch (Object.prototype.toString.call(x)) {
      case '[object Arguments]':
        return '(function() { return arguments; }(' + _map(recur, x).join(', ') + '))';
      case '[object Array]':
        return '[' + _map(recur, x).concat(mapPairs(x, reject(function (k) {
          return (/^\d+$/.test(k)
          );
        }, keys(x)))).join(', ') + ']';
      case '[object Boolean]':
        return typeof x === 'object' ? 'new Boolean(' + recur(x.valueOf()) + ')' : x.toString();
      case '[object Date]':
        return 'new Date(' + (isNaN(x.valueOf()) ? recur(NaN) : _quote(_toISOString(x))) + ')';
      case '[object Null]':
        return 'null';
      case '[object Number]':
        return typeof x === 'object' ? 'new Number(' + recur(x.valueOf()) + ')' : 1 / x === -Infinity ? '-0' : x.toString(10);
      case '[object String]':
        return typeof x === 'object' ? 'new String(' + recur(x.valueOf()) + ')' : _quote(x);
      case '[object Undefined]':
        return 'undefined';
      default:
        if (typeof x.toString === 'function') {
          var repr = x.toString();
          if (repr !== '[object Object]') {
            return repr;
          }
        }
        return '{' + mapPairs(x, keys(x)).join(', ') + '}';
    }
  }

  /**
   * Returns the string representation of the given value. `eval`'ing the output
   * should result in a value equivalent to the input value. Many of the built-in
   * `toString` methods do not satisfy this requirement.
   *
   * If the given value is an `[object Object]` with a `toString` method other
   * than `Object.prototype.toString`, this method is invoked with no arguments
   * to produce the return value. This means user-defined constructor functions
   * can provide a suitable `toString` method. For example:
   *
   *     function Point(x, y) {
   *       this.x = x;
   *       this.y = y;
   *     }
   *
   *     Point.prototype.toString = function() {
   *       return 'new Point(' + this.x + ', ' + this.y + ')';
   *     };
   *
   *     R.toString(new Point(1, 2)); //=> 'new Point(1, 2)'
   *
   * @func
   * @memberOf R
   * @since v0.14.0
   * @category String
   * @sig * -> String
   * @param {*} val
   * @return {String}
   * @example
   *
   *      R.toString(42); //=> '42'
   *      R.toString('abc'); //=> '"abc"'
   *      R.toString([1, 2, 3]); //=> '[1, 2, 3]'
   *      R.toString({foo: 1, bar: 2, baz: 3}); //=> '{"bar": 2, "baz": 3, "foo": 1}'
   *      R.toString(new Date('2001-02-03T04:05:06Z')); //=> 'new Date("2001-02-03T04:05:06.000Z")'
   */
  var toString$1 = /*#__PURE__*/_curry1$1(function toString(val) {
    return _toString(val, []);
  });

  /**
   * Accepts a converging function and a list of branching functions and returns
   * a new function. When invoked, this new function is applied to some
   * arguments, each branching function is applied to those same arguments. The
   * results of each branching function are passed as arguments to the converging
   * function to produce the return value.
   *
   * @func
   * @memberOf R
   * @since v0.4.2
   * @category Function
   * @sig ((x1, x2, ...) -> z) -> [((a, b, ...) -> x1), ((a, b, ...) -> x2), ...] -> (a -> b -> ... -> z)
   * @param {Function} after A function. `after` will be invoked with the return values of
   *        `fn1` and `fn2` as its arguments.
   * @param {Array} functions A list of functions.
   * @return {Function} A new function.
   * @see R.useWith
   * @example
   *
   *      var average = R.converge(R.divide, [R.sum, R.length])
   *      average([1, 2, 3, 4, 5, 6, 7]) //=> 4
   *
   *      var strangeConcat = R.converge(R.concat, [R.toUpper, R.toLower])
   *      strangeConcat("Yodel") //=> "YODELyodel"
   *
   * @symb R.converge(f, [g, h])(a, b) = f(g(a, b), h(a, b))
   */
  var converge = /*#__PURE__*/_curry2$1(function converge(after, fns) {
    return curryN$1(reduce(max, 0, pluck('length', fns)), function () {
      var args = arguments;
      var context = this;
      return after.apply(context, _map(function (fn) {
        return fn.apply(context, args);
      }, fns));
    });
  });

  var XReduceBy = /*#__PURE__*/function () {
    function XReduceBy(valueFn, valueAcc, keyFn, xf) {
      this.valueFn = valueFn;
      this.valueAcc = valueAcc;
      this.keyFn = keyFn;
      this.xf = xf;
      this.inputs = {};
    }
    XReduceBy.prototype['@@transducer/init'] = _xfBase.init;
    XReduceBy.prototype['@@transducer/result'] = function (result) {
      var key;
      for (key in this.inputs) {
        if (_has(key, this.inputs)) {
          result = this.xf['@@transducer/step'](result, this.inputs[key]);
          if (result['@@transducer/reduced']) {
            result = result['@@transducer/value'];
            break;
          }
        }
      }
      this.inputs = null;
      return this.xf['@@transducer/result'](result);
    };
    XReduceBy.prototype['@@transducer/step'] = function (result, input) {
      var key = this.keyFn(input);
      this.inputs[key] = this.inputs[key] || [key, this.valueAcc];
      this.inputs[key][1] = this.valueFn(this.inputs[key][1], input);
      return result;
    };

    return XReduceBy;
  }();

  var _xreduceBy = /*#__PURE__*/_curryN$1(4, [], function _xreduceBy(valueFn, valueAcc, keyFn, xf) {
    return new XReduceBy(valueFn, valueAcc, keyFn, xf);
  });

  /**
   * Groups the elements of the list according to the result of calling
   * the String-returning function `keyFn` on each element and reduces the elements
   * of each group to a single value via the reducer function `valueFn`.
   *
   * This function is basically a more general [`groupBy`](#groupBy) function.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.20.0
   * @category List
   * @sig ((a, b) -> a) -> a -> (b -> String) -> [b] -> {String: a}
   * @param {Function} valueFn The function that reduces the elements of each group to a single
   *        value. Receives two values, accumulator for a particular group and the current element.
   * @param {*} acc The (initial) accumulator value for each group.
   * @param {Function} keyFn The function that maps the list's element into a key.
   * @param {Array} list The array to group.
   * @return {Object} An object with the output of `keyFn` for keys, mapped to the output of
   *         `valueFn` for elements which produced that key when passed to `keyFn`.
   * @see R.groupBy, R.reduce
   * @example
   *
   *      var reduceToNamesBy = R.reduceBy((acc, student) => acc.concat(student.name), []);
   *      var namesByGrade = reduceToNamesBy(function(student) {
   *        var score = student.score;
   *        return score < 65 ? 'F' :
   *               score < 70 ? 'D' :
   *               score < 80 ? 'C' :
   *               score < 90 ? 'B' : 'A';
   *      });
   *      var students = [{name: 'Lucy', score: 92},
   *                      {name: 'Drew', score: 85},
   *                      // ...
   *                      {name: 'Bart', score: 62}];
   *      namesByGrade(students);
   *      // {
   *      //   'A': ['Lucy'],
   *      //   'B': ['Drew']
   *      //   // ...,
   *      //   'F': ['Bart']
   *      // }
   */
  var reduceBy = /*#__PURE__*/_curryN$1(4, [], /*#__PURE__*/_dispatchable([], _xreduceBy, function reduceBy(valueFn, valueAcc, keyFn, list) {
    return _reduce(function (acc, elt) {
      var key = keyFn(elt);
      acc[key] = valueFn(_has(key, acc) ? acc[key] : valueAcc, elt);
      return acc;
    }, {}, list);
  }));

  /**
   * Counts the elements of a list according to how many match each value of a
   * key generated by the supplied function. Returns an object mapping the keys
   * produced by `fn` to the number of occurrences in the list. Note that all
   * keys are coerced to strings because of how JavaScript objects work.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Relation
   * @sig (a -> String) -> [a] -> {*}
   * @param {Function} fn The function used to map values to keys.
   * @param {Array} list The list to count elements from.
   * @return {Object} An object mapping keys to number of occurrences in the list.
   * @example
   *
   *      var numbers = [1.0, 1.1, 1.2, 2.0, 3.0, 2.2];
   *      R.countBy(Math.floor)(numbers);    //=> {'1': 3, '2': 2, '3': 1}
   *
   *      var letters = ['a', 'b', 'A', 'a', 'B', 'c'];
   *      R.countBy(R.toLower)(letters);   //=> {'a': 3, 'b': 2, 'c': 1}
   */
  var countBy = /*#__PURE__*/reduceBy(function (acc, elem) {
    return acc + 1;
  }, 0);

  /**
   * Decrements its argument.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category Math
   * @sig Number -> Number
   * @param {Number} n
   * @return {Number} n - 1
   * @see R.inc
   * @example
   *
   *      R.dec(42); //=> 41
   */
  var dec = /*#__PURE__*/add(-1);

  var XDropRepeatsWith = /*#__PURE__*/function () {
    function XDropRepeatsWith(pred, xf) {
      this.xf = xf;
      this.pred = pred;
      this.lastValue = undefined;
      this.seenFirstValue = false;
    }

    XDropRepeatsWith.prototype['@@transducer/init'] = _xfBase.init;
    XDropRepeatsWith.prototype['@@transducer/result'] = _xfBase.result;
    XDropRepeatsWith.prototype['@@transducer/step'] = function (result, input) {
      var sameAsLast = false;
      if (!this.seenFirstValue) {
        this.seenFirstValue = true;
      } else if (this.pred(this.lastValue, input)) {
        sameAsLast = true;
      }
      this.lastValue = input;
      return sameAsLast ? result : this.xf['@@transducer/step'](result, input);
    };

    return XDropRepeatsWith;
  }();

  var _xdropRepeatsWith = /*#__PURE__*/_curry2$1(function _xdropRepeatsWith(pred, xf) {
    return new XDropRepeatsWith(pred, xf);
  });

  /**
   * Returns the nth element of the given list or string. If n is negative the
   * element at index length + n is returned.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig Number -> [a] -> a | Undefined
   * @sig Number -> String -> String
   * @param {Number} offset
   * @param {*} list
   * @return {*}
   * @example
   *
   *      var list = ['foo', 'bar', 'baz', 'quux'];
   *      R.nth(1, list); //=> 'bar'
   *      R.nth(-1, list); //=> 'quux'
   *      R.nth(-99, list); //=> undefined
   *
   *      R.nth(2, 'abc'); //=> 'c'
   *      R.nth(3, 'abc'); //=> ''
   * @symb R.nth(-1, [a, b, c]) = c
   * @symb R.nth(0, [a, b, c]) = a
   * @symb R.nth(1, [a, b, c]) = b
   */
  var nth = /*#__PURE__*/_curry2$1(function nth(offset, list) {
    var idx = offset < 0 ? list.length + offset : offset;
    return _isString(list) ? list.charAt(idx) : list[idx];
  });

  /**
   * Returns the last element of the given list or string.
   *
   * @func
   * @memberOf R
   * @since v0.1.4
   * @category List
   * @sig [a] -> a | Undefined
   * @sig String -> String
   * @param {*} list
   * @return {*}
   * @see R.init, R.head, R.tail
   * @example
   *
   *      R.last(['fi', 'fo', 'fum']); //=> 'fum'
   *      R.last([]); //=> undefined
   *
   *      R.last('abc'); //=> 'c'
   *      R.last(''); //=> ''
   */
  var last = /*#__PURE__*/nth(-1);

  /**
   * Returns a new list without any consecutively repeating elements. Equality is
   * determined by applying the supplied predicate to each pair of consecutive elements. The
   * first element in a series of equal elements will be preserved.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.14.0
   * @category List
   * @sig ((a, a) -> Boolean) -> [a] -> [a]
   * @param {Function} pred A predicate used to test whether two items are equal.
   * @param {Array} list The array to consider.
   * @return {Array} `list` without repeating elements.
   * @see R.transduce
   * @example
   *
   *      var l = [1, -1, 1, 3, 4, -4, -4, -5, 5, 3, 3];
   *      R.dropRepeatsWith(R.eqBy(Math.abs), l); //=> [1, 3, 4, -5, 3]
   */
  var dropRepeatsWith = /*#__PURE__*/_curry2$1( /*#__PURE__*/_dispatchable([], _xdropRepeatsWith, function dropRepeatsWith(pred, list) {
    var result = [];
    var idx = 1;
    var len = list.length;
    if (len !== 0) {
      result[0] = list[0];
      while (idx < len) {
        if (!pred(last(result), list[idx])) {
          result[result.length] = list[idx];
        }
        idx += 1;
      }
    }
    return result;
  }));

  /**
   * Returns a new list without any consecutively repeating elements.
   * [`R.equals`](#equals) is used to determine equality.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.14.0
   * @category List
   * @sig [a] -> [a]
   * @param {Array} list The array to consider.
   * @return {Array} `list` without repeating elements.
   * @see R.transduce
   * @example
   *
   *     R.dropRepeats([1, 1, 1, 2, 3, 4, 4, 2, 2]); //=> [1, 2, 3, 4, 2]
   */
  var dropRepeats = /*#__PURE__*/_curry1$1( /*#__PURE__*/_dispatchable([], /*#__PURE__*/_xdropRepeatsWith(equals), /*#__PURE__*/dropRepeatsWith(equals)));

  /**
   * Returns a new function much like the supplied one, except that the first two
   * arguments' order is reversed.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig ((a, b, c, ...) -> z) -> (b -> a -> c -> ... -> z)
   * @param {Function} fn The function to invoke with its first two parameters reversed.
   * @return {*} The result of invoking `fn` with its first two parameters' order reversed.
   * @example
   *
   *      var mergeThree = (a, b, c) => [].concat(a, b, c);
   *
   *      mergeThree(1, 2, 3); //=> [1, 2, 3]
   *
   *      R.flip(mergeThree)(1, 2, 3); //=> [2, 1, 3]
   * @symb R.flip(f)(a, b, c) = f(b, a, c)
   */
  var flip = /*#__PURE__*/_curry1$1(function flip(fn) {
    return curryN$1(fn.length, function (a, b) {
      var args = Array.prototype.slice.call(arguments, 0);
      args[0] = b;
      args[1] = a;
      return fn.apply(this, args);
    });
  });

  /**
   * Splits a list into sub-lists stored in an object, based on the result of
   * calling a String-returning function on each element, and grouping the
   * results according to values returned.
   *
   * Dispatches to the `groupBy` method of the second argument, if present.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig (a -> String) -> [a] -> {String: [a]}
   * @param {Function} fn Function :: a -> String
   * @param {Array} list The array to group
   * @return {Object} An object with the output of `fn` for keys, mapped to arrays of elements
   *         that produced that key when passed to `fn`.
   * @see R.transduce
   * @example
   *
   *      var byGrade = R.groupBy(function(student) {
   *        var score = student.score;
   *        return score < 65 ? 'F' :
   *               score < 70 ? 'D' :
   *               score < 80 ? 'C' :
   *               score < 90 ? 'B' : 'A';
   *      });
   *      var students = [{name: 'Abby', score: 84},
   *                      {name: 'Eddy', score: 58},
   *                      // ...
   *                      {name: 'Jack', score: 69}];
   *      byGrade(students);
   *      // {
   *      //   'A': [{name: 'Dianne', score: 99}],
   *      //   'B': [{name: 'Abby', score: 84}]
   *      //   // ...,
   *      //   'F': [{name: 'Eddy', score: 58}]
   *      // }
   */
  var groupBy = /*#__PURE__*/_curry2$1( /*#__PURE__*/_checkForMethod('groupBy', /*#__PURE__*/reduceBy(function (acc, item) {
    if (acc == null) {
      acc = [];
    }
    acc.push(item);
    return acc;
  }, null)));

  /**
   * Returns the first element of the given list or string. In some libraries
   * this function is named `first`.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig [a] -> a | Undefined
   * @sig String -> String
   * @param {Array|String} list
   * @return {*}
   * @see R.tail, R.init, R.last
   * @example
   *
   *      R.head(['fi', 'fo', 'fum']); //=> 'fi'
   *      R.head([]); //=> undefined
   *
   *      R.head('abc'); //=> 'a'
   *      R.head(''); //=> ''
   */
  var head = /*#__PURE__*/nth(0);

  function _identity(x) {
    return x;
  }

  /**
   * A function that does nothing but return the parameter supplied to it. Good
   * as a default or placeholder function.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig a -> a
   * @param {*} x The value to return.
   * @return {*} The input value, `x`.
   * @example
   *
   *      R.identity(1); //=> 1
   *
   *      var obj = {};
   *      R.identity(obj) === obj; //=> true
   * @symb R.identity(a) = a
   */
  var identity = /*#__PURE__*/_curry1$1(_identity);

  /**
   * Increments its argument.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category Math
   * @sig Number -> Number
   * @param {Number} n
   * @return {Number} n + 1
   * @see R.dec
   * @example
   *
   *      R.inc(42); //=> 43
   */
  var inc = /*#__PURE__*/add(1);

  /**
   * Given a function that generates a key, turns a list of objects into an
   * object indexing the objects by the given key. Note that if multiple
   * objects generate the same value for the indexing key only the last value
   * will be included in the generated object.
   *
   * Acts as a transducer if a transformer is given in list position.
   *
   * @func
   * @memberOf R
   * @since v0.19.0
   * @category List
   * @sig (a -> String) -> [{k: v}] -> {k: {k: v}}
   * @param {Function} fn Function :: a -> String
   * @param {Array} array The array of objects to index
   * @return {Object} An object indexing each array element by the given property.
   * @example
   *
   *      var list = [{id: 'xyz', title: 'A'}, {id: 'abc', title: 'B'}];
   *      R.indexBy(R.prop('id'), list);
   *      //=> {abc: {id: 'abc', title: 'B'}, xyz: {id: 'xyz', title: 'A'}}
   */
  var indexBy = /*#__PURE__*/reduceBy(function (acc, elem) {
    return elem;
  }, null);

  /**
   * Returns all but the last element of the given list or string.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category List
   * @sig [a] -> [a]
   * @sig String -> String
   * @param {*} list
   * @return {*}
   * @see R.last, R.head, R.tail
   * @example
   *
   *      R.init([1, 2, 3]);  //=> [1, 2]
   *      R.init([1, 2]);     //=> [1]
   *      R.init([1]);        //=> []
   *      R.init([]);         //=> []
   *
   *      R.init('abc');  //=> 'ab'
   *      R.init('ab');   //=> 'a'
   *      R.init('a');    //=> ''
   *      R.init('');     //=> ''
   */
  var init = /*#__PURE__*/slice(0, -1);

  var _Set = /*#__PURE__*/function () {
    function _Set() {
      /* globals Set */
      this._nativeSet = typeof Set === 'function' ? new Set() : null;
      this._items = {};
    }

    // until we figure out why jsdoc chokes on this
    // @param item The item to add to the Set
    // @returns {boolean} true if the item did not exist prior, otherwise false
    //
    _Set.prototype.add = function (item) {
      return !hasOrAdd(item, true, this);
    };

    //
    // @param item The item to check for existence in the Set
    // @returns {boolean} true if the item exists in the Set, otherwise false
    //
    _Set.prototype.has = function (item) {
      return hasOrAdd(item, false, this);
    };

    //
    // Combines the logic for checking whether an item is a member of the set and
    // for adding a new item to the set.
    //
    // @param item       The item to check or add to the Set instance.
    // @param shouldAdd  If true, the item will be added to the set if it doesn't
    //                   already exist.
    // @param set        The set instance to check or add to.
    // @return {boolean} true if the item already existed, otherwise false.
    //
    return _Set;
  }();

  function hasOrAdd(item, shouldAdd, set) {
    var type = typeof item;
    var prevSize, newSize;
    switch (type) {
      case 'string':
      case 'number':
        // distinguish between +0 and -0
        if (item === 0 && 1 / item === -Infinity) {
          if (set._items['-0']) {
            return true;
          } else {
            if (shouldAdd) {
              set._items['-0'] = true;
            }
            return false;
          }
        }
        // these types can all utilise the native Set
        if (set._nativeSet !== null) {
          if (shouldAdd) {
            prevSize = set._nativeSet.size;
            set._nativeSet.add(item);
            newSize = set._nativeSet.size;
            return newSize === prevSize;
          } else {
            return set._nativeSet.has(item);
          }
        } else {
          if (!(type in set._items)) {
            if (shouldAdd) {
              set._items[type] = {};
              set._items[type][item] = true;
            }
            return false;
          } else if (item in set._items[type]) {
            return true;
          } else {
            if (shouldAdd) {
              set._items[type][item] = true;
            }
            return false;
          }
        }

      case 'boolean':
        // set._items['boolean'] holds a two element array
        // representing [ falseExists, trueExists ]
        if (type in set._items) {
          var bIdx = item ? 1 : 0;
          if (set._items[type][bIdx]) {
            return true;
          } else {
            if (shouldAdd) {
              set._items[type][bIdx] = true;
            }
            return false;
          }
        } else {
          if (shouldAdd) {
            set._items[type] = item ? [false, true] : [true, false];
          }
          return false;
        }

      case 'function':
        // compare functions for reference equality
        if (set._nativeSet !== null) {
          if (shouldAdd) {
            prevSize = set._nativeSet.size;
            set._nativeSet.add(item);
            newSize = set._nativeSet.size;
            return newSize === prevSize;
          } else {
            return set._nativeSet.has(item);
          }
        } else {
          if (!(type in set._items)) {
            if (shouldAdd) {
              set._items[type] = [item];
            }
            return false;
          }
          if (!_contains(item, set._items[type])) {
            if (shouldAdd) {
              set._items[type].push(item);
            }
            return false;
          }
          return true;
        }

      case 'undefined':
        if (set._items[type]) {
          return true;
        } else {
          if (shouldAdd) {
            set._items[type] = true;
          }
          return false;
        }

      case 'object':
        if (item === null) {
          if (!set._items['null']) {
            if (shouldAdd) {
              set._items['null'] = true;
            }
            return false;
          }
          return true;
        }
      /* falls through */
      default:
        // reduce the search size of heterogeneous sets by creating buckets
        // for each type.
        type = Object.prototype.toString.call(item);
        if (!(type in set._items)) {
          if (shouldAdd) {
            set._items[type] = [item];
          }
          return false;
        }
        // scan through all previously applied items
        if (!_contains(item, set._items[type])) {
          if (shouldAdd) {
            set._items[type].push(item);
          }
          return false;
        }
        return true;
    }
  }

  /**
   * Returns a new list containing only one copy of each element in the original
   * list, based upon the value returned by applying the supplied function to
   * each list element. Prefers the first item if the supplied function produces
   * the same value on two items. [`R.equals`](#equals) is used for comparison.
   *
   * @func
   * @memberOf R
   * @since v0.16.0
   * @category List
   * @sig (a -> b) -> [a] -> [a]
   * @param {Function} fn A function used to produce a value to use during comparisons.
   * @param {Array} list The array to consider.
   * @return {Array} The list of unique items.
   * @example
   *
   *      R.uniqBy(Math.abs, [-1, -5, 2, 10, 1, 2]); //=> [-1, -5, 2, 10]
   */
  var uniqBy = /*#__PURE__*/_curry2$1(function uniqBy(fn, list) {
    var set = new _Set();
    var result = [];
    var idx = 0;
    var appliedItem, item;

    while (idx < list.length) {
      item = list[idx];
      appliedItem = fn(item);
      if (set.add(appliedItem)) {
        result.push(item);
      }
      idx += 1;
    }
    return result;
  });

  /**
   * Returns a new list containing only one copy of each element in the original
   * list. [`R.equals`](#equals) is used to determine equality.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig [a] -> [a]
   * @param {Array} list The array to consider.
   * @return {Array} The list of unique items.
   * @example
   *
   *      R.uniq([1, 1, 2, 1]); //=> [1, 2]
   *      R.uniq([1, '1']);     //=> [1, '1']
   *      R.uniq([[42], [42]]); //=> [[42]]
   */
  var uniq = /*#__PURE__*/uniqBy(identity);

  /**
   * Turns a named method with a specified arity into a function that can be
   * called directly supplied with arguments and a target object.
   *
   * The returned function is curried and accepts `arity + 1` parameters where
   * the final parameter is the target object.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig Number -> String -> (a -> b -> ... -> n -> Object -> *)
   * @param {Number} arity Number of arguments the returned function should take
   *        before the target object.
   * @param {String} method Name of the method to call.
   * @return {Function} A new curried function.
   * @see R.construct
   * @example
   *
   *      var sliceFrom = R.invoker(1, 'slice');
   *      sliceFrom(6, 'abcdefghijklm'); //=> 'ghijklm'
   *      var sliceFrom6 = R.invoker(2, 'slice')(6);
   *      sliceFrom6(8, 'abcdefghijklm'); //=> 'gh'
   * @symb R.invoker(0, 'method')(o) = o['method']()
   * @symb R.invoker(1, 'method')(a, o) = o['method'](a)
   * @symb R.invoker(2, 'method')(a, b, o) = o['method'](a, b)
   */
  var invoker = /*#__PURE__*/_curry2$1(function invoker(arity, method) {
    return curryN$1(arity + 1, function () {
      var target = arguments[arity];
      if (target != null && _isFunction(target[method])) {
        return target[method].apply(target, Array.prototype.slice.call(arguments, 0, arity));
      }
      throw new TypeError(toString$1(target) + ' does not have a method named "' + method + '"');
    });
  });

  /**
   * Returns a string made by inserting the `separator` between each element and
   * concatenating all the elements into a single string.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig String -> [a] -> String
   * @param {Number|String} separator The string used to separate the elements.
   * @param {Array} xs The elements to join into a string.
   * @return {String} str The string made by concatenating `xs` with `separator`.
   * @see R.split
   * @example
   *
   *      var spacer = R.join(' ');
   *      spacer(['a', 2, 3.4]);   //=> 'a 2 3.4'
   *      R.join('|', [1, 2, 3]);    //=> '1|2|3'
   */
  var join = /*#__PURE__*/invoker(1, 'join');

  /**
   * juxt applies a list of functions to a list of values.
   *
   * @func
   * @memberOf R
   * @since v0.19.0
   * @category Function
   * @sig [(a, b, ..., m) -> n] -> ((a, b, ..., m) -> [n])
   * @param {Array} fns An array of functions
   * @return {Function} A function that returns a list of values after applying each of the original `fns` to its parameters.
   * @see R.applySpec
   * @example
   *
   *      var getRange = R.juxt([Math.min, Math.max]);
   *      getRange(3, 4, 9, -3); //=> [-3, 9]
   * @symb R.juxt([f, g, h])(a, b) = [f(a, b), g(a, b), h(a, b)]
   */
  var juxt = /*#__PURE__*/_curry1$1(function juxt(fns) {
    return converge(function () {
      return Array.prototype.slice.call(arguments, 0);
    }, fns);
  });

  /**
   * Adds together all the elements of a list.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Math
   * @sig [Number] -> Number
   * @param {Array} list An array of numbers
   * @return {Number} The sum of all the numbers in the list.
   * @see R.reduce
   * @example
   *
   *      R.sum([2,4,6,8,100,1]); //=> 121
   */
  var sum = /*#__PURE__*/reduce(add, 0);

  /**
   * A customisable version of [`R.memoize`](#memoize). `memoizeWith` takes an
   * additional function that will be applied to a given argument set and used to
   * create the cache key under which the results of the function to be memoized
   * will be stored. Care must be taken when implementing key generation to avoid
   * clashes that may overwrite previous entries erroneously.
   *
   *
   * @func
   * @memberOf R
   * @since v0.24.0
   * @category Function
   * @sig (*... -> String) -> (*... -> a) -> (*... -> a)
   * @param {Function} fn The function to generate the cache key.
   * @param {Function} fn The function to memoize.
   * @return {Function} Memoized version of `fn`.
   * @see R.memoize
   * @example
   *
   *      let count = 0;
   *      const factorial = R.memoizeWith(R.identity, n => {
   *        count += 1;
   *        return R.product(R.range(1, n + 1));
   *      });
   *      factorial(5); //=> 120
   *      factorial(5); //=> 120
   *      factorial(5); //=> 120
   *      count; //=> 1
   */
  var memoizeWith = /*#__PURE__*/_curry2$1(function memoizeWith(mFn, fn) {
    var cache = {};
    return _arity$1(fn.length, function () {
      var key = mFn.apply(this, arguments);
      if (!_has(key, cache)) {
        cache[key] = fn.apply(this, arguments);
      }
      return cache[key];
    });
  });

  /**
   * Creates a new function that, when invoked, caches the result of calling `fn`
   * for a given argument set and returns the result. Subsequent calls to the
   * memoized `fn` with the same argument set will not result in an additional
   * call to `fn`; instead, the cached result for that set of arguments will be
   * returned.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig (*... -> a) -> (*... -> a)
   * @param {Function} fn The function to memoize.
   * @return {Function} Memoized version of `fn`.
   * @see R.memoizeWith
   * @deprecated since v0.25.0
   * @example
   *
   *      let count = 0;
   *      const factorial = R.memoize(n => {
   *        count += 1;
   *        return R.product(R.range(1, n + 1));
   *      });
   *      factorial(5); //=> 120
   *      factorial(5); //=> 120
   *      factorial(5); //=> 120
   *      count; //=> 1
   */
  var memoize = /*#__PURE__*/memoizeWith(function () {
    return toString$1(arguments);
  });

  /**
   * Multiplies two numbers. Equivalent to `a * b` but curried.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Math
   * @sig Number -> Number -> Number
   * @param {Number} a The first value.
   * @param {Number} b The second value.
   * @return {Number} The result of `a * b`.
   * @see R.divide
   * @example
   *
   *      var double = R.multiply(2);
   *      var triple = R.multiply(3);
   *      double(3);       //=>  6
   *      triple(4);       //=> 12
   *      R.multiply(2, 5);  //=> 10
   */
  var multiply = /*#__PURE__*/_curry2$1(function multiply(a, b) {
    return a * b;
  });

  function _createPartialApplicator(concat) {
    return _curry2$1(function (fn, args) {
      return _arity$1(Math.max(0, fn.length - args.length), function () {
        return fn.apply(this, concat(args, arguments));
      });
    });
  }

  /**
   * Takes a function `f` and a list of arguments, and returns a function `g`.
   * When applied, `g` returns the result of applying `f` to the arguments
   * provided to `g` followed by the arguments provided initially.
   *
   * @func
   * @memberOf R
   * @since v0.10.0
   * @category Function
   * @sig ((a, b, c, ..., n) -> x) -> [d, e, f, ..., n] -> ((a, b, c, ...) -> x)
   * @param {Function} f
   * @param {Array} args
   * @return {Function}
   * @see R.partial
   * @example
   *
   *      var greet = (salutation, title, firstName, lastName) =>
   *        salutation + ', ' + title + ' ' + firstName + ' ' + lastName + '!';
   *
   *      var greetMsJaneJones = R.partialRight(greet, ['Ms.', 'Jane', 'Jones']);
   *
   *      greetMsJaneJones('Hello'); //=> 'Hello, Ms. Jane Jones!'
   * @symb R.partialRight(f, [a, b])(c, d) = f(c, d, a, b)
   */
  var partialRight = /*#__PURE__*/_createPartialApplicator( /*#__PURE__*/flip(_concat));

  /**
   * Takes a predicate and a list or other `Filterable` object and returns the
   * pair of filterable objects of the same type of elements which do and do not
   * satisfy, the predicate, respectively. Filterable objects include plain objects or any object
   * that has a filter method such as `Array`.
   *
   * @func
   * @memberOf R
   * @since v0.1.4
   * @category List
   * @sig Filterable f => (a -> Boolean) -> f a -> [f a, f a]
   * @param {Function} pred A predicate to determine which side the element belongs to.
   * @param {Array} filterable the list (or other filterable) to partition.
   * @return {Array} An array, containing first the subset of elements that satisfy the
   *         predicate, and second the subset of elements that do not satisfy.
   * @see R.filter, R.reject
   * @example
   *
   *      R.partition(R.contains('s'), ['sss', 'ttt', 'foo', 'bars']);
   *      // => [ [ 'sss', 'bars' ],  [ 'ttt', 'foo' ] ]
   *
   *      R.partition(R.contains('s'), { a: 'sss', b: 'ttt', foo: 'bars' });
   *      // => [ { a: 'sss', foo: 'bars' }, { b: 'ttt' }  ]
   */
  var partition = /*#__PURE__*/juxt([filter, reject]);

  /**
   * Similar to `pick` except that this one includes a `key: undefined` pair for
   * properties that don't exist.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Object
   * @sig [k] -> {k: v} -> {k: v}
   * @param {Array} names an array of String property names to copy onto a new object
   * @param {Object} obj The object to copy from
   * @return {Object} A new object with only properties from `names` on it.
   * @see R.pick
   * @example
   *
   *      R.pickAll(['a', 'd'], {a: 1, b: 2, c: 3, d: 4}); //=> {a: 1, d: 4}
   *      R.pickAll(['a', 'e', 'f'], {a: 1, b: 2, c: 3, d: 4}); //=> {a: 1, e: undefined, f: undefined}
   */
  var pickAll = /*#__PURE__*/_curry2$1(function pickAll(names, obj) {
    var result = {};
    var idx = 0;
    var len = names.length;
    while (idx < len) {
      var name = names[idx];
      result[name] = obj[name];
      idx += 1;
    }
    return result;
  });

  /**
   * Multiplies together all the elements of a list.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Math
   * @sig [Number] -> Number
   * @param {Array} list An array of numbers
   * @return {Number} The product of all the numbers in the list.
   * @see R.reduce
   * @example
   *
   *      R.product([2,4,6,8,100,1]); //=> 38400
   */
  var product = /*#__PURE__*/reduce(multiply, 1);

  /**
   * Accepts a function `fn` and a list of transformer functions and returns a
   * new curried function. When the new function is invoked, it calls the
   * function `fn` with parameters consisting of the result of calling each
   * supplied handler on successive arguments to the new function.
   *
   * If more arguments are passed to the returned function than transformer
   * functions, those arguments are passed directly to `fn` as additional
   * parameters. If you expect additional arguments that don't need to be
   * transformed, although you can ignore them, it's best to pass an identity
   * function so that the new function reports the correct arity.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Function
   * @sig ((x1, x2, ...) -> z) -> [(a -> x1), (b -> x2), ...] -> (a -> b -> ... -> z)
   * @param {Function} fn The function to wrap.
   * @param {Array} transformers A list of transformer functions
   * @return {Function} The wrapped function.
   * @see R.converge
   * @example
   *
   *      R.useWith(Math.pow, [R.identity, R.identity])(3, 4); //=> 81
   *      R.useWith(Math.pow, [R.identity, R.identity])(3)(4); //=> 81
   *      R.useWith(Math.pow, [R.dec, R.inc])(3, 4); //=> 32
   *      R.useWith(Math.pow, [R.dec, R.inc])(3)(4); //=> 32
   * @symb R.useWith(f, [g, h])(a, b) = f(g(a), h(b))
   */
  var useWith = /*#__PURE__*/_curry2$1(function useWith(fn, transformers) {
    return curryN$1(transformers.length, function () {
      var args = [];
      var idx = 0;
      while (idx < transformers.length) {
        args.push(transformers[idx].call(this, arguments[idx]));
        idx += 1;
      }
      return fn.apply(this, args.concat(Array.prototype.slice.call(arguments, transformers.length)));
    });
  });

  /**
   * Reasonable analog to SQL `select` statement.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Object
   * @category Relation
   * @sig [k] -> [{k: v}] -> [{k: v}]
   * @param {Array} props The property names to project
   * @param {Array} objs The objects to query
   * @return {Array} An array of objects with just the `props` properties.
   * @example
   *
   *      var abby = {name: 'Abby', age: 7, hair: 'blond', grade: 2};
   *      var fred = {name: 'Fred', age: 12, hair: 'brown', grade: 7};
   *      var kids = [abby, fred];
   *      R.project(['name', 'grade'], kids); //=> [{name: 'Abby', grade: 2}, {name: 'Fred', grade: 7}]
   */
  var project = /*#__PURE__*/useWith(_map, [pickAll, identity]); // passing `identity` gives correct arity

  /**
   * Returns a copy of the list, sorted according to the comparator function,
   * which should accept two values at a time and return a negative number if the
   * first value is smaller, a positive number if it's larger, and zero if they
   * are equal. Please note that this is a **copy** of the list. It does not
   * modify the original.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category List
   * @sig ((a, a) -> Number) -> [a] -> [a]
   * @param {Function} comparator A sorting function :: a -> b -> Int
   * @param {Array} list The list to sort
   * @return {Array} a new array with its elements sorted by the comparator function.
   * @example
   *
   *      var diff = function(a, b) { return a - b; };
   *      R.sort(diff, [4,2,7,5]); //=> [2, 4, 5, 7]
   */
  var sort = /*#__PURE__*/_curry2$1(function sort(comparator, list) {
    return Array.prototype.slice.call(list, 0).sort(comparator);
  });

  /**
   * Splits a string into an array of strings based on the given
   * separator.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category String
   * @sig (String | RegExp) -> String -> [String]
   * @param {String|RegExp} sep The pattern.
   * @param {String} str The string to separate into an array.
   * @return {Array} The array of strings from `str` separated by `str`.
   * @see R.join
   * @example
   *
   *      var pathComponents = R.split('/');
   *      R.tail(pathComponents('/usr/local/bin/node')); //=> ['usr', 'local', 'bin', 'node']
   *
   *      R.split('.', 'a.b.c.xyz.d'); //=> ['a', 'b', 'c', 'xyz', 'd']
   */
  var split = /*#__PURE__*/invoker(1, 'split');

  /**
   * The lower case version of a string.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category String
   * @sig String -> String
   * @param {String} str The string to lower case.
   * @return {String} The lower case version of `str`.
   * @see R.toUpper
   * @example
   *
   *      R.toLower('XYZ'); //=> 'xyz'
   */
  var toLower = /*#__PURE__*/invoker(0, 'toLowerCase');

  /**
   * The upper case version of a string.
   *
   * @func
   * @memberOf R
   * @since v0.9.0
   * @category String
   * @sig String -> String
   * @param {String} str The string to upper case.
   * @return {String} The upper case version of `str`.
   * @see R.toLower
   * @example
   *
   *      R.toUpper('abc'); //=> 'ABC'
   */
  var toUpper = /*#__PURE__*/invoker(0, 'toUpperCase');

  /**
   * Initializes a transducer using supplied iterator function. Returns a single
   * item by iterating through the list, successively calling the transformed
   * iterator function and passing it an accumulator value and the current value
   * from the array, and then passing the result to the next call.
   *
   * The iterator function receives two values: *(acc, value)*. It will be
   * wrapped as a transformer to initialize the transducer. A transformer can be
   * passed directly in place of an iterator function. In both cases, iteration
   * may be stopped early with the [`R.reduced`](#reduced) function.
   *
   * A transducer is a function that accepts a transformer and returns a
   * transformer and can be composed directly.
   *
   * A transformer is an an object that provides a 2-arity reducing iterator
   * function, step, 0-arity initial value function, init, and 1-arity result
   * extraction function, result. The step function is used as the iterator
   * function in reduce. The result function is used to convert the final
   * accumulator into the return type and in most cases is
   * [`R.identity`](#identity). The init function can be used to provide an
   * initial accumulator, but is ignored by transduce.
   *
   * The iteration is performed with [`R.reduce`](#reduce) after initializing the transducer.
   *
   * @func
   * @memberOf R
   * @since v0.12.0
   * @category List
   * @sig (c -> c) -> ((a, b) -> a) -> a -> [b] -> a
   * @param {Function} xf The transducer function. Receives a transformer and returns a transformer.
   * @param {Function} fn The iterator function. Receives two values, the accumulator and the
   *        current element from the array. Wrapped as transformer, if necessary, and used to
   *        initialize the transducer
   * @param {*} acc The initial accumulator value.
   * @param {Array} list The list to iterate over.
   * @return {*} The final, accumulated value.
   * @see R.reduce, R.reduced, R.into
   * @example
   *
   *      var numbers = [1, 2, 3, 4];
   *      var transducer = R.compose(R.map(R.add(1)), R.take(2));
   *      R.transduce(transducer, R.flip(R.append), [], numbers); //=> [2, 3]
   *
   *      var isOdd = (x) => x % 2 === 1;
   *      var firstOddTransducer = R.compose(R.filter(isOdd), R.take(1));
   *      R.transduce(firstOddTransducer, R.flip(R.append), [], R.range(0, 100)); //=> [1]
   */
  var transduce = /*#__PURE__*/curryN$1(4, function transduce(xf, fn, acc, list) {
    return _reduce(xf(typeof fn === 'function' ? _xwrap(fn) : fn), acc, list);
  });

  var ws = '\x09\x0A\x0B\x0C\x0D\x20\xA0\u1680\u180E\u2000\u2001\u2002\u2003' + '\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000\u2028' + '\u2029\uFEFF';
  var zeroWidth = '\u200b';
  var hasProtoTrim = typeof String.prototype.trim === 'function';
  /**
   * Removes (strips) whitespace from both ends of the string.
   *
   * @func
   * @memberOf R
   * @since v0.6.0
   * @category String
   * @sig String -> String
   * @param {String} str The string to trim.
   * @return {String} Trimmed version of `str`.
   * @example
   *
   *      R.trim('   xyz  '); //=> 'xyz'
   *      R.map(R.trim, R.split(',', 'x, y, z')); //=> ['x', 'y', 'z']
   */
  var _trim = !hasProtoTrim || /*#__PURE__*/ws.trim() || ! /*#__PURE__*/zeroWidth.trim() ? function trim(str) {
    var beginRx = new RegExp('^[' + ws + '][' + ws + ']*');
    var endRx = new RegExp('[' + ws + '][' + ws + ']*$');
    return str.replace(beginRx, '').replace(endRx, '');
  } : function trim(str) {
    return str.trim();
  };

  /**
   * Combines two lists into a set (i.e. no duplicates) composed of the elements
   * of each list.
   *
   * @func
   * @memberOf R
   * @since v0.1.0
   * @category Relation
   * @sig [*] -> [*] -> [*]
   * @param {Array} as The first list.
   * @param {Array} bs The second list.
   * @return {Array} The first and second lists concatenated, with
   *         duplicates removed.
   * @example
   *
   *      R.union([1, 2, 3], [2, 3, 4]); //=> [1, 2, 3, 4]
   */
  var union = /*#__PURE__*/_curry2$1( /*#__PURE__*/compose(uniq, _concat));

  /**
   * Shorthand for `R.chain(R.identity)`, which removes one level of nesting from
   * any [Chain](https://github.com/fantasyland/fantasy-land#chain).
   *
   * @func
   * @memberOf R
   * @since v0.3.0
   * @category List
   * @sig Chain c => c (c a) -> c a
   * @param {*} list
   * @return {*}
   * @see R.flatten, R.chain
   * @example
   *
   *      R.unnest([1, [2], [[3]]]); //=> [1, 2, [3]]
   *      R.unnest([[1, 2], [3, 4], [5, 6]]); //=> [1, 2, 3, 4, 5, 6]
   */
  var unnest = /*#__PURE__*/chain$1(_identity);

  var bind$1 = function bind(fn, thisArg) {
    return function wrap() {
      var args = new Array(arguments.length);
      for (var i = 0; i < args.length; i++) {
        args[i] = arguments[i];
      }
      return fn.apply(thisArg, args);
    };
  };

  /*!
   * Determine if an object is a Buffer
   *
   * @author   Feross Aboukhadijeh <https://feross.org>
   * @license  MIT
   */

  // The _isBuffer check is for Safari 5-7 support, because it's missing
  // Object.prototype.constructor. Remove this eventually
  var isBuffer_1 = function (obj) {
    return obj != null && (isBuffer(obj) || isSlowBuffer(obj) || !!obj._isBuffer)
  };

  function isBuffer (obj) {
    return !!obj.constructor && typeof obj.constructor.isBuffer === 'function' && obj.constructor.isBuffer(obj)
  }

  // For Node v0.10 support. Remove this eventually.
  function isSlowBuffer (obj) {
    return typeof obj.readFloatLE === 'function' && typeof obj.slice === 'function' && isBuffer(obj.slice(0, 0))
  }

  /*global toString:true*/

  // utils is a library of generic helper functions non-specific to axios

  var toString$2 = Object.prototype.toString;

  /**
   * Determine if a value is an Array
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is an Array, otherwise false
   */
  function isArray$1(val) {
    return toString$2.call(val) === '[object Array]';
  }

  /**
   * Determine if a value is an ArrayBuffer
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is an ArrayBuffer, otherwise false
   */
  function isArrayBuffer(val) {
    return toString$2.call(val) === '[object ArrayBuffer]';
  }

  /**
   * Determine if a value is a FormData
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is an FormData, otherwise false
   */
  function isFormData(val) {
    return (typeof FormData !== 'undefined') && (val instanceof FormData);
  }

  /**
   * Determine if a value is a view on an ArrayBuffer
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a view on an ArrayBuffer, otherwise false
   */
  function isArrayBufferView(val) {
    var result;
    if ((typeof ArrayBuffer !== 'undefined') && (ArrayBuffer.isView)) {
      result = ArrayBuffer.isView(val);
    } else {
      result = (val) && (val.buffer) && (val.buffer instanceof ArrayBuffer);
    }
    return result;
  }

  /**
   * Determine if a value is a String
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a String, otherwise false
   */
  function isString$1(val) {
    return typeof val === 'string';
  }

  /**
   * Determine if a value is a Number
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a Number, otherwise false
   */
  function isNumber$1(val) {
    return typeof val === 'number';
  }

  /**
   * Determine if a value is undefined
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if the value is undefined, otherwise false
   */
  function isUndefined$1(val) {
    return typeof val === 'undefined';
  }

  /**
   * Determine if a value is an Object
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is an Object, otherwise false
   */
  function isObject$1(val) {
    return val !== null && typeof val === 'object';
  }

  /**
   * Determine if a value is a Date
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a Date, otherwise false
   */
  function isDate(val) {
    return toString$2.call(val) === '[object Date]';
  }

  /**
   * Determine if a value is a File
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a File, otherwise false
   */
  function isFile(val) {
    return toString$2.call(val) === '[object File]';
  }

  /**
   * Determine if a value is a Blob
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a Blob, otherwise false
   */
  function isBlob(val) {
    return toString$2.call(val) === '[object Blob]';
  }

  /**
   * Determine if a value is a Function
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a Function, otherwise false
   */
  function isFunction$2(val) {
    return toString$2.call(val) === '[object Function]';
  }

  /**
   * Determine if a value is a Stream
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a Stream, otherwise false
   */
  function isStream(val) {
    return isObject$1(val) && isFunction$2(val.pipe);
  }

  /**
   * Determine if a value is a URLSearchParams object
   *
   * @param {Object} val The value to test
   * @returns {boolean} True if value is a URLSearchParams object, otherwise false
   */
  function isURLSearchParams(val) {
    return typeof URLSearchParams !== 'undefined' && val instanceof URLSearchParams;
  }

  /**
   * Trim excess whitespace off the beginning and end of a string
   *
   * @param {String} str The String to trim
   * @returns {String} The String freed of excess whitespace
   */
  function trim$1(str) {
    return str.replace(/^\s*/, '').replace(/\s*$/, '');
  }

  /**
   * Determine if we're running in a standard browser environment
   *
   * This allows axios to run in a web worker, and react-native.
   * Both environments support XMLHttpRequest, but not fully standard globals.
   *
   * web workers:
   *  typeof window -> undefined
   *  typeof document -> undefined
   *
   * react-native:
   *  navigator.product -> 'ReactNative'
   */
  function isStandardBrowserEnv() {
    if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
      return false;
    }
    return (
      typeof window !== 'undefined' &&
      typeof document !== 'undefined'
    );
  }

  /**
   * Iterate over an Array or an Object invoking a function for each item.
   *
   * If `obj` is an Array callback will be called passing
   * the value, index, and complete array for each item.
   *
   * If 'obj' is an Object callback will be called passing
   * the value, key, and complete object for each property.
   *
   * @param {Object|Array} obj The object to iterate
   * @param {Function} fn The callback to invoke for each item
   */
  function forEach$1(obj, fn) {
    // Don't bother if no value provided
    if (obj === null || typeof obj === 'undefined') {
      return;
    }

    // Force an array if not already something iterable
    if (typeof obj !== 'object') {
      /*eslint no-param-reassign:0*/
      obj = [obj];
    }

    if (isArray$1(obj)) {
      // Iterate over array values
      for (var i = 0, l = obj.length; i < l; i++) {
        fn.call(null, obj[i], i, obj);
      }
    } else {
      // Iterate over object keys
      for (var key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          fn.call(null, obj[key], key, obj);
        }
      }
    }
  }

  /**
   * Accepts varargs expecting each argument to be an object, then
   * immutably merges the properties of each object and returns result.
   *
   * When multiple objects contain the same key the later object in
   * the arguments list will take precedence.
   *
   * Example:
   *
   * ```js
   * var result = merge({foo: 123}, {foo: 456});
   * console.log(result.foo); // outputs 456
   * ```
   *
   * @param {Object} obj1 Object to merge
   * @returns {Object} Result of all merge properties
   */
  function merge$1(/* obj1, obj2, obj3, ... */) {
    var result = {};
    function assignValue(val, key) {
      if (typeof result[key] === 'object' && typeof val === 'object') {
        result[key] = merge$1(result[key], val);
      } else {
        result[key] = val;
      }
    }

    for (var i = 0, l = arguments.length; i < l; i++) {
      forEach$1(arguments[i], assignValue);
    }
    return result;
  }

  /**
   * Extends object a by mutably adding to it the properties of object b.
   *
   * @param {Object} a The object to be extended
   * @param {Object} b The object to copy properties from
   * @param {Object} thisArg The object to bind function to
   * @return {Object} The resulting value of object a
   */
  function extend(a, b, thisArg) {
    forEach$1(b, function assignValue(val, key) {
      if (thisArg && typeof val === 'function') {
        a[key] = bind$1(val, thisArg);
      } else {
        a[key] = val;
      }
    });
    return a;
  }

  var utils = {
    isArray: isArray$1,
    isArrayBuffer: isArrayBuffer,
    isBuffer: isBuffer_1,
    isFormData: isFormData,
    isArrayBufferView: isArrayBufferView,
    isString: isString$1,
    isNumber: isNumber$1,
    isObject: isObject$1,
    isUndefined: isUndefined$1,
    isDate: isDate,
    isFile: isFile,
    isBlob: isBlob,
    isFunction: isFunction$2,
    isStream: isStream,
    isURLSearchParams: isURLSearchParams,
    isStandardBrowserEnv: isStandardBrowserEnv,
    forEach: forEach$1,
    merge: merge$1,
    extend: extend,
    trim: trim$1
  };

  var normalizeHeaderName = function normalizeHeaderName(headers, normalizedName) {
    utils.forEach(headers, function processHeader(value, name) {
      if (name !== normalizedName && name.toUpperCase() === normalizedName.toUpperCase()) {
        headers[normalizedName] = value;
        delete headers[name];
      }
    });
  };

  /**
   * Update an Error with the specified config, error code, and response.
   *
   * @param {Error} error The error to update.
   * @param {Object} config The config.
   * @param {string} [code] The error code (for example, 'ECONNABORTED').
   * @param {Object} [request] The request.
   * @param {Object} [response] The response.
   * @returns {Error} The error.
   */
  var enhanceError = function enhanceError(error, config, code, request, response) {
    error.config = config;
    if (code) {
      error.code = code;
    }
    error.request = request;
    error.response = response;
    return error;
  };

  /**
   * Create an Error with the specified message, config, error code, request and response.
   *
   * @param {string} message The error message.
   * @param {Object} config The config.
   * @param {string} [code] The error code (for example, 'ECONNABORTED').
   * @param {Object} [request] The request.
   * @param {Object} [response] The response.
   * @returns {Error} The created error.
   */
  var createError = function createError(message, config, code, request, response) {
    var error = new Error(message);
    return enhanceError(error, config, code, request, response);
  };

  /**
   * Resolve or reject a Promise based on response status.
   *
   * @param {Function} resolve A function that resolves the promise.
   * @param {Function} reject A function that rejects the promise.
   * @param {object} response The response.
   */
  var settle = function settle(resolve, reject, response) {
    var validateStatus = response.config.validateStatus;
    // Note: status is not exposed by XDomainRequest
    if (!response.status || !validateStatus || validateStatus(response.status)) {
      resolve(response);
    } else {
      reject(createError(
        'Request failed with status code ' + response.status,
        response.config,
        null,
        response.request,
        response
      ));
    }
  };

  function encode(val) {
    return encodeURIComponent(val).
      replace(/%40/gi, '@').
      replace(/%3A/gi, ':').
      replace(/%24/g, '$').
      replace(/%2C/gi, ',').
      replace(/%20/g, '+').
      replace(/%5B/gi, '[').
      replace(/%5D/gi, ']');
  }

  /**
   * Build a URL by appending params to the end
   *
   * @param {string} url The base of the url (e.g., http://www.google.com)
   * @param {object} [params] The params to be appended
   * @returns {string} The formatted url
   */
  var buildURL = function buildURL(url, params, paramsSerializer) {
    /*eslint no-param-reassign:0*/
    if (!params) {
      return url;
    }

    var serializedParams;
    if (paramsSerializer) {
      serializedParams = paramsSerializer(params);
    } else if (utils.isURLSearchParams(params)) {
      serializedParams = params.toString();
    } else {
      var parts = [];

      utils.forEach(params, function serialize(val, key) {
        if (val === null || typeof val === 'undefined') {
          return;
        }

        if (utils.isArray(val)) {
          key = key + '[]';
        } else {
          val = [val];
        }

        utils.forEach(val, function parseValue(v) {
          if (utils.isDate(v)) {
            v = v.toISOString();
          } else if (utils.isObject(v)) {
            v = JSON.stringify(v);
          }
          parts.push(encode(key) + '=' + encode(v));
        });
      });

      serializedParams = parts.join('&');
    }

    if (serializedParams) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + serializedParams;
    }

    return url;
  };

  // Headers whose duplicates are ignored by node
  // c.f. https://nodejs.org/api/http.html#http_message_headers
  var ignoreDuplicateOf = [
    'age', 'authorization', 'content-length', 'content-type', 'etag',
    'expires', 'from', 'host', 'if-modified-since', 'if-unmodified-since',
    'last-modified', 'location', 'max-forwards', 'proxy-authorization',
    'referer', 'retry-after', 'user-agent'
  ];

  /**
   * Parse headers into an object
   *
   * ```
   * Date: Wed, 27 Aug 2014 08:58:49 GMT
   * Content-Type: application/json
   * Connection: keep-alive
   * Transfer-Encoding: chunked
   * ```
   *
   * @param {String} headers Headers needing to be parsed
   * @returns {Object} Headers parsed into an object
   */
  var parseHeaders = function parseHeaders(headers) {
    var parsed = {};
    var key;
    var val;
    var i;

    if (!headers) { return parsed; }

    utils.forEach(headers.split('\n'), function parser(line) {
      i = line.indexOf(':');
      key = utils.trim(line.substr(0, i)).toLowerCase();
      val = utils.trim(line.substr(i + 1));

      if (key) {
        if (parsed[key] && ignoreDuplicateOf.indexOf(key) >= 0) {
          return;
        }
        if (key === 'set-cookie') {
          parsed[key] = (parsed[key] ? parsed[key] : []).concat([val]);
        } else {
          parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
        }
      }
    });

    return parsed;
  };

  var isURLSameOrigin = (
    utils.isStandardBrowserEnv() ?

    // Standard browser envs have full support of the APIs needed to test
    // whether the request URL is of the same origin as current location.
    (function standardBrowserEnv() {
      var msie = /(msie|trident)/i.test(navigator.userAgent);
      var urlParsingNode = document.createElement('a');
      var originURL;

      /**
      * Parse a URL to discover it's components
      *
      * @param {String} url The URL to be parsed
      * @returns {Object}
      */
      function resolveURL(url) {
        var href = url;

        if (msie) {
          // IE needs attribute set twice to normalize properties
          urlParsingNode.setAttribute('href', href);
          href = urlParsingNode.href;
        }

        urlParsingNode.setAttribute('href', href);

        // urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
        return {
          href: urlParsingNode.href,
          protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
          host: urlParsingNode.host,
          search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
          hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
          hostname: urlParsingNode.hostname,
          port: urlParsingNode.port,
          pathname: (urlParsingNode.pathname.charAt(0) === '/') ?
                    urlParsingNode.pathname :
                    '/' + urlParsingNode.pathname
        };
      }

      originURL = resolveURL(window.location.href);

      /**
      * Determine if a URL shares the same origin as the current location
      *
      * @param {String} requestURL The URL to test
      * @returns {boolean} True if URL shares the same origin, otherwise false
      */
      return function isURLSameOrigin(requestURL) {
        var parsed = (utils.isString(requestURL)) ? resolveURL(requestURL) : requestURL;
        return (parsed.protocol === originURL.protocol &&
              parsed.host === originURL.host);
      };
    })() :

    // Non standard browser envs (web workers, react-native) lack needed support.
    (function nonStandardBrowserEnv() {
      return function isURLSameOrigin() {
        return true;
      };
    })()
  );

  // btoa polyfill for IE<10 courtesy https://github.com/davidchambers/Base64.js

  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  function E() {
    this.message = 'String contains an invalid character';
  }
  E.prototype = new Error;
  E.prototype.code = 5;
  E.prototype.name = 'InvalidCharacterError';

  function btoa(input) {
    var str = String(input);
    var output = '';
    for (
      // initialize result and counter
      var block, charCode, idx = 0, map = chars;
      // if the next str index does not exist:
      //   change the mapping table to "="
      //   check if d has no fractional digits
      str.charAt(idx | 0) || (map = '=', idx % 1);
      // "8 - idx % 1 * 8" generates the sequence 2, 4, 6, 8
      output += map.charAt(63 & block >> 8 - idx % 1 * 8)
    ) {
      charCode = str.charCodeAt(idx += 3 / 4);
      if (charCode > 0xFF) {
        throw new E();
      }
      block = block << 8 | charCode;
    }
    return output;
  }

  var btoa_1 = btoa;

  var cookies = (
    utils.isStandardBrowserEnv() ?

    // Standard browser envs support document.cookie
    (function standardBrowserEnv() {
      return {
        write: function write(name, value, expires, path, domain, secure) {
          var cookie = [];
          cookie.push(name + '=' + encodeURIComponent(value));

          if (utils.isNumber(expires)) {
            cookie.push('expires=' + new Date(expires).toGMTString());
          }

          if (utils.isString(path)) {
            cookie.push('path=' + path);
          }

          if (utils.isString(domain)) {
            cookie.push('domain=' + domain);
          }

          if (secure === true) {
            cookie.push('secure');
          }

          document.cookie = cookie.join('; ');
        },

        read: function read(name) {
          var match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
          return (match ? decodeURIComponent(match[3]) : null);
        },

        remove: function remove(name) {
          this.write(name, '', Date.now() - 86400000);
        }
      };
    })() :

    // Non standard browser env (web workers, react-native) lack needed support.
    (function nonStandardBrowserEnv() {
      return {
        write: function write() {},
        read: function read() { return null; },
        remove: function remove() {}
      };
    })()
  );

  var btoa$1 = (typeof window !== 'undefined' && window.btoa && window.btoa.bind(window)) || btoa_1;

  var xhr = function xhrAdapter(config) {
    return new Promise(function dispatchXhrRequest(resolve, reject) {
      var requestData = config.data;
      var requestHeaders = config.headers;

      if (utils.isFormData(requestData)) {
        delete requestHeaders['Content-Type']; // Let the browser set it
      }

      var request = new XMLHttpRequest();
      var loadEvent = 'onreadystatechange';
      var xDomain = false;

      // For IE 8/9 CORS support
      // Only supports POST and GET calls and doesn't returns the response headers.
      // DON'T do this for testing b/c XMLHttpRequest is mocked, not XDomainRequest.
      if (typeof window !== 'undefined' &&
          window.XDomainRequest && !('withCredentials' in request) &&
          !isURLSameOrigin(config.url)) {
        request = new window.XDomainRequest();
        loadEvent = 'onload';
        xDomain = true;
        request.onprogress = function handleProgress() {};
        request.ontimeout = function handleTimeout() {};
      }

      // HTTP basic authentication
      if (config.auth) {
        var username = config.auth.username || '';
        var password = config.auth.password || '';
        requestHeaders.Authorization = 'Basic ' + btoa$1(username + ':' + password);
      }

      request.open(config.method.toUpperCase(), buildURL(config.url, config.params, config.paramsSerializer), true);

      // Set the request timeout in MS
      request.timeout = config.timeout;

      // Listen for ready state
      request[loadEvent] = function handleLoad() {
        if (!request || (request.readyState !== 4 && !xDomain)) {
          return;
        }

        // The request errored out and we didn't get a response, this will be
        // handled by onerror instead
        // With one exception: request that using file: protocol, most browsers
        // will return status as 0 even though it's a successful request
        if (request.status === 0 && !(request.responseURL && request.responseURL.indexOf('file:') === 0)) {
          return;
        }

        // Prepare the response
        var responseHeaders = 'getAllResponseHeaders' in request ? parseHeaders(request.getAllResponseHeaders()) : null;
        var responseData = !config.responseType || config.responseType === 'text' ? request.responseText : request.response;
        var response = {
          data: responseData,
          // IE sends 1223 instead of 204 (https://github.com/axios/axios/issues/201)
          status: request.status === 1223 ? 204 : request.status,
          statusText: request.status === 1223 ? 'No Content' : request.statusText,
          headers: responseHeaders,
          config: config,
          request: request
        };

        settle(resolve, reject, response);

        // Clean up request
        request = null;
      };

      // Handle low level network errors
      request.onerror = function handleError() {
        // Real errors are hidden from us by the browser
        // onerror should only fire if it's a network error
        reject(createError('Network Error', config, null, request));

        // Clean up request
        request = null;
      };

      // Handle timeout
      request.ontimeout = function handleTimeout() {
        reject(createError('timeout of ' + config.timeout + 'ms exceeded', config, 'ECONNABORTED',
          request));

        // Clean up request
        request = null;
      };

      // Add xsrf header
      // This is only done if running in a standard browser environment.
      // Specifically not if we're in a web worker, or react-native.
      if (utils.isStandardBrowserEnv()) {
        var cookies$$1 = cookies;

        // Add xsrf header
        var xsrfValue = (config.withCredentials || isURLSameOrigin(config.url)) && config.xsrfCookieName ?
            cookies$$1.read(config.xsrfCookieName) :
            undefined;

        if (xsrfValue) {
          requestHeaders[config.xsrfHeaderName] = xsrfValue;
        }
      }

      // Add headers to the request
      if ('setRequestHeader' in request) {
        utils.forEach(requestHeaders, function setRequestHeader(val, key) {
          if (typeof requestData === 'undefined' && key.toLowerCase() === 'content-type') {
            // Remove Content-Type if data is undefined
            delete requestHeaders[key];
          } else {
            // Otherwise add header to the request
            request.setRequestHeader(key, val);
          }
        });
      }

      // Add withCredentials to request if needed
      if (config.withCredentials) {
        request.withCredentials = true;
      }

      // Add responseType to request if needed
      if (config.responseType) {
        try {
          request.responseType = config.responseType;
        } catch (e) {
          // Expected DOMException thrown by browsers not compatible XMLHttpRequest Level 2.
          // But, this can be suppressed for 'json' type as it can be parsed by default 'transformResponse' function.
          if (config.responseType !== 'json') {
            throw e;
          }
        }
      }

      // Handle progress if needed
      if (typeof config.onDownloadProgress === 'function') {
        request.addEventListener('progress', config.onDownloadProgress);
      }

      // Not all browsers support upload events
      if (typeof config.onUploadProgress === 'function' && request.upload) {
        request.upload.addEventListener('progress', config.onUploadProgress);
      }

      if (config.cancelToken) {
        // Handle cancellation
        config.cancelToken.promise.then(function onCanceled(cancel) {
          if (!request) {
            return;
          }

          request.abort();
          reject(cancel);
          // Clean up request
          request = null;
        });
      }

      if (requestData === undefined) {
        requestData = null;
      }

      // Send the request
      request.send(requestData);
    });
  };

  var DEFAULT_CONTENT_TYPE = {
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  function setContentTypeIfUnset(headers, value) {
    if (!utils.isUndefined(headers) && utils.isUndefined(headers['Content-Type'])) {
      headers['Content-Type'] = value;
    }
  }

  function getDefaultAdapter() {
    var adapter;
    if (typeof XMLHttpRequest !== 'undefined') {
      // For browsers use XHR adapter
      adapter = xhr;
    } else if (typeof process !== 'undefined') {
      // For node use HTTP adapter
      adapter = xhr;
    }
    return adapter;
  }

  var defaults = {
    adapter: getDefaultAdapter(),

    transformRequest: [function transformRequest(data, headers) {
      normalizeHeaderName(headers, 'Content-Type');
      if (utils.isFormData(data) ||
        utils.isArrayBuffer(data) ||
        utils.isBuffer(data) ||
        utils.isStream(data) ||
        utils.isFile(data) ||
        utils.isBlob(data)
      ) {
        return data;
      }
      if (utils.isArrayBufferView(data)) {
        return data.buffer;
      }
      if (utils.isURLSearchParams(data)) {
        setContentTypeIfUnset(headers, 'application/x-www-form-urlencoded;charset=utf-8');
        return data.toString();
      }
      if (utils.isObject(data)) {
        setContentTypeIfUnset(headers, 'application/json;charset=utf-8');
        return JSON.stringify(data);
      }
      return data;
    }],

    transformResponse: [function transformResponse(data) {
      /*eslint no-param-reassign:0*/
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch (e) { /* Ignore */ }
      }
      return data;
    }],

    /**
     * A timeout in milliseconds to abort a request. If set to 0 (default) a
     * timeout is not created.
     */
    timeout: 0,

    xsrfCookieName: 'XSRF-TOKEN',
    xsrfHeaderName: 'X-XSRF-TOKEN',

    maxContentLength: -1,

    validateStatus: function validateStatus(status) {
      return status >= 200 && status < 300;
    }
  };

  defaults.headers = {
    common: {
      'Accept': 'application/json, text/plain, */*'
    }
  };

  utils.forEach(['delete', 'get', 'head'], function forEachMethodNoData(method) {
    defaults.headers[method] = {};
  });

  utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
    defaults.headers[method] = utils.merge(DEFAULT_CONTENT_TYPE);
  });

  var defaults_1 = defaults;

  function InterceptorManager() {
    this.handlers = [];
  }

  /**
   * Add a new interceptor to the stack
   *
   * @param {Function} fulfilled The function to handle `then` for a `Promise`
   * @param {Function} rejected The function to handle `reject` for a `Promise`
   *
   * @return {Number} An ID used to remove interceptor later
   */
  InterceptorManager.prototype.use = function use(fulfilled, rejected) {
    this.handlers.push({
      fulfilled: fulfilled,
      rejected: rejected
    });
    return this.handlers.length - 1;
  };

  /**
   * Remove an interceptor from the stack
   *
   * @param {Number} id The ID that was returned by `use`
   */
  InterceptorManager.prototype.eject = function eject(id) {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  };

  /**
   * Iterate over all the registered interceptors
   *
   * This method is particularly useful for skipping over any
   * interceptors that may have become `null` calling `eject`.
   *
   * @param {Function} fn The function to call for each interceptor
   */
  InterceptorManager.prototype.forEach = function forEach(fn) {
    utils.forEach(this.handlers, function forEachHandler(h) {
      if (h !== null) {
        fn(h);
      }
    });
  };

  var InterceptorManager_1 = InterceptorManager;

  /**
   * Transform the data for a request or a response
   *
   * @param {Object|String} data The data to be transformed
   * @param {Array} headers The headers for the request or response
   * @param {Array|Function} fns A single function or Array of functions
   * @returns {*} The resulting transformed data
   */
  var transformData = function transformData(data, headers, fns) {
    /*eslint no-param-reassign:0*/
    utils.forEach(fns, function transform(fn) {
      data = fn(data, headers);
    });

    return data;
  };

  var isCancel = function isCancel(value) {
    return !!(value && value.__CANCEL__);
  };

  /**
   * Determines whether the specified URL is absolute
   *
   * @param {string} url The URL to test
   * @returns {boolean} True if the specified URL is absolute, otherwise false
   */
  var isAbsoluteURL = function isAbsoluteURL(url) {
    // A URL is considered absolute if it begins with "<scheme>://" or "//" (protocol-relative URL).
    // RFC 3986 defines scheme name as a sequence of characters beginning with a letter and followed
    // by any combination of letters, digits, plus, period, or hyphen.
    return /^([a-z][a-z\d\+\-\.]*:)?\/\//i.test(url);
  };

  /**
   * Creates a new URL by combining the specified URLs
   *
   * @param {string} baseURL The base URL
   * @param {string} relativeURL The relative URL
   * @returns {string} The combined URL
   */
  var combineURLs = function combineURLs(baseURL, relativeURL) {
    return relativeURL
      ? baseURL.replace(/\/+$/, '') + '/' + relativeURL.replace(/^\/+/, '')
      : baseURL;
  };

  /**
   * Throws a `Cancel` if cancellation has been requested.
   */
  function throwIfCancellationRequested(config) {
    if (config.cancelToken) {
      config.cancelToken.throwIfRequested();
    }
  }

  /**
   * Dispatch a request to the server using the configured adapter.
   *
   * @param {object} config The config that is to be used for the request
   * @returns {Promise} The Promise to be fulfilled
   */
  var dispatchRequest = function dispatchRequest(config) {
    throwIfCancellationRequested(config);

    // Support baseURL config
    if (config.baseURL && !isAbsoluteURL(config.url)) {
      config.url = combineURLs(config.baseURL, config.url);
    }

    // Ensure headers exist
    config.headers = config.headers || {};

    // Transform request data
    config.data = transformData(
      config.data,
      config.headers,
      config.transformRequest
    );

    // Flatten headers
    config.headers = utils.merge(
      config.headers.common || {},
      config.headers[config.method] || {},
      config.headers || {}
    );

    utils.forEach(
      ['delete', 'get', 'head', 'post', 'put', 'patch', 'common'],
      function cleanHeaderConfig(method) {
        delete config.headers[method];
      }
    );

    var adapter = config.adapter || defaults_1.adapter;

    return adapter(config).then(function onAdapterResolution(response) {
      throwIfCancellationRequested(config);

      // Transform response data
      response.data = transformData(
        response.data,
        response.headers,
        config.transformResponse
      );

      return response;
    }, function onAdapterRejection(reason) {
      if (!isCancel(reason)) {
        throwIfCancellationRequested(config);

        // Transform response data
        if (reason && reason.response) {
          reason.response.data = transformData(
            reason.response.data,
            reason.response.headers,
            config.transformResponse
          );
        }
      }

      return Promise.reject(reason);
    });
  };

  /**
   * Create a new instance of Axios
   *
   * @param {Object} instanceConfig The default config for the instance
   */
  function Axios(instanceConfig) {
    this.defaults = instanceConfig;
    this.interceptors = {
      request: new InterceptorManager_1(),
      response: new InterceptorManager_1()
    };
  }

  /**
   * Dispatch a request
   *
   * @param {Object} config The config specific for this request (merged with this.defaults)
   */
  Axios.prototype.request = function request(config) {
    /*eslint no-param-reassign:0*/
    // Allow for axios('example/url'[, config]) a la fetch API
    if (typeof config === 'string') {
      config = utils.merge({
        url: arguments[0]
      }, arguments[1]);
    }

    config = utils.merge(defaults_1, {method: 'get'}, this.defaults, config);
    config.method = config.method.toLowerCase();

    // Hook up interceptors middleware
    var chain = [dispatchRequest, undefined];
    var promise = Promise.resolve(config);

    this.interceptors.request.forEach(function unshiftRequestInterceptors(interceptor) {
      chain.unshift(interceptor.fulfilled, interceptor.rejected);
    });

    this.interceptors.response.forEach(function pushResponseInterceptors(interceptor) {
      chain.push(interceptor.fulfilled, interceptor.rejected);
    });

    while (chain.length) {
      promise = promise.then(chain.shift(), chain.shift());
    }

    return promise;
  };

  // Provide aliases for supported request methods
  utils.forEach(['delete', 'get', 'head', 'options'], function forEachMethodNoData(method) {
    /*eslint func-names:0*/
    Axios.prototype[method] = function(url, config) {
      return this.request(utils.merge(config || {}, {
        method: method,
        url: url
      }));
    };
  });

  utils.forEach(['post', 'put', 'patch'], function forEachMethodWithData(method) {
    /*eslint func-names:0*/
    Axios.prototype[method] = function(url, data, config) {
      return this.request(utils.merge(config || {}, {
        method: method,
        url: url,
        data: data
      }));
    };
  });

  var Axios_1 = Axios;

  /**
   * A `Cancel` is an object that is thrown when an operation is canceled.
   *
   * @class
   * @param {string=} message The message.
   */
  function Cancel(message) {
    this.message = message;
  }

  Cancel.prototype.toString = function toString() {
    return 'Cancel' + (this.message ? ': ' + this.message : '');
  };

  Cancel.prototype.__CANCEL__ = true;

  var Cancel_1 = Cancel;

  /**
   * A `CancelToken` is an object that can be used to request cancellation of an operation.
   *
   * @class
   * @param {Function} executor The executor function.
   */
  function CancelToken(executor) {
    if (typeof executor !== 'function') {
      throw new TypeError('executor must be a function.');
    }

    var resolvePromise;
    this.promise = new Promise(function promiseExecutor(resolve) {
      resolvePromise = resolve;
    });

    var token = this;
    executor(function cancel(message) {
      if (token.reason) {
        // Cancellation has already been requested
        return;
      }

      token.reason = new Cancel_1(message);
      resolvePromise(token.reason);
    });
  }

  /**
   * Throws a `Cancel` if cancellation has been requested.
   */
  CancelToken.prototype.throwIfRequested = function throwIfRequested() {
    if (this.reason) {
      throw this.reason;
    }
  };

  /**
   * Returns an object that contains a new `CancelToken` and a function that, when called,
   * cancels the `CancelToken`.
   */
  CancelToken.source = function source() {
    var cancel;
    var token = new CancelToken(function executor(c) {
      cancel = c;
    });
    return {
      token: token,
      cancel: cancel
    };
  };

  var CancelToken_1 = CancelToken;

  /**
   * Syntactic sugar for invoking a function and expanding an array for arguments.
   *
   * Common use case would be to use `Function.prototype.apply`.
   *
   *  ```js
   *  function f(x, y, z) {}
   *  var args = [1, 2, 3];
   *  f.apply(null, args);
   *  ```
   *
   * With `spread` this example can be re-written.
   *
   *  ```js
   *  spread(function(x, y, z) {})([1, 2, 3]);
   *  ```
   *
   * @param {Function} callback
   * @returns {Function}
   */
  var spread = function spread(callback) {
    return function wrap(arr) {
      return callback.apply(null, arr);
    };
  };

  /**
   * Create an instance of Axios
   *
   * @param {Object} defaultConfig The default config for the instance
   * @return {Axios} A new instance of Axios
   */
  function createInstance(defaultConfig) {
    var context = new Axios_1(defaultConfig);
    var instance = bind$1(Axios_1.prototype.request, context);

    // Copy axios.prototype to instance
    utils.extend(instance, Axios_1.prototype, context);

    // Copy context to instance
    utils.extend(instance, context);

    return instance;
  }

  // Create the default instance to be exported
  var axios = createInstance(defaults_1);

  // Expose Axios class to allow class inheritance
  axios.Axios = Axios_1;

  // Factory for creating new instances
  axios.create = function create(instanceConfig) {
    return createInstance(utils.merge(defaults_1, instanceConfig));
  };

  // Expose Cancel & CancelToken
  axios.Cancel = Cancel_1;
  axios.CancelToken = CancelToken_1;
  axios.isCancel = isCancel;

  // Expose all/spread
  axios.all = function all(promises) {
    return Promise.all(promises);
  };
  axios.spread = spread;

  var axios_1 = axios;

  // Allow use of default import syntax in TypeScript
  var default_1 = axios;
  axios_1.default = default_1;

  var axios$1 = axios_1;

  var commonjsGlobal = typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

  function unwrapExports (x) {
  	return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
  }

  function createCommonjsModule(fn, module) {
  	return module = { exports: {} }, fn(module, module.exports), module.exports;
  }

  var purify = createCommonjsModule(function (module, exports) {
  (function (global, factory) {
  	module.exports = factory();
  }(commonjsGlobal, (function () {
  var html = ['a', 'abbr', 'acronym', 'address', 'area', 'article', 'aside', 'audio', 'b', 'bdi', 'bdo', 'big', 'blink', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite', 'code', 'col', 'colgroup', 'content', 'data', 'datalist', 'dd', 'decorator', 'del', 'details', 'dfn', 'dir', 'div', 'dl', 'dt', 'element', 'em', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'main', 'map', 'mark', 'marquee', 'menu', 'menuitem', 'meter', 'nav', 'nobr', 'ol', 'optgroup', 'option', 'output', 'p', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'section', 'select', 'shadow', 'small', 'source', 'spacer', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'track', 'tt', 'u', 'ul', 'var', 'video', 'wbr'];

  // SVG
  var svg = ['svg', 'a', 'altglyph', 'altglyphdef', 'altglyphitem', 'animatecolor', 'animatemotion', 'animatetransform', 'audio', 'canvas', 'circle', 'clippath', 'defs', 'desc', 'ellipse', 'filter', 'font', 'g', 'glyph', 'glyphref', 'hkern', 'image', 'line', 'lineargradient', 'marker', 'mask', 'metadata', 'mpath', 'path', 'pattern', 'polygon', 'polyline', 'radialgradient', 'rect', 'stop', 'style', 'switch', 'symbol', 'text', 'textpath', 'title', 'tref', 'tspan', 'video', 'view', 'vkern'];

  var svgFilters = ['feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix', 'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feFlood', 'feFuncA', 'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology', 'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence'];

  var mathMl = ['math', 'menclose', 'merror', 'mfenced', 'mfrac', 'mglyph', 'mi', 'mlabeledtr', 'mmuliscripts', 'mn', 'mo', 'mover', 'mpadded', 'mphantom', 'mroot', 'mrow', 'ms', 'mpspace', 'msqrt', 'mystyle', 'msub', 'msup', 'msubsup', 'mtable', 'mtd', 'mtext', 'mtr', 'munder', 'munderover'];

  var text = ['#text'];

  var html$1 = ['accept', 'action', 'align', 'alt', 'autocomplete', 'background', 'bgcolor', 'border', 'cellpadding', 'cellspacing', 'checked', 'cite', 'class', 'clear', 'color', 'cols', 'colspan', 'coords', 'crossorigin', 'datetime', 'default', 'dir', 'disabled', 'download', 'enctype', 'face', 'for', 'headers', 'height', 'hidden', 'high', 'href', 'hreflang', 'id', 'integrity', 'ismap', 'label', 'lang', 'list', 'loop', 'low', 'max', 'maxlength', 'media', 'method', 'min', 'multiple', 'name', 'noshade', 'novalidate', 'nowrap', 'open', 'optimum', 'pattern', 'placeholder', 'poster', 'preload', 'pubdate', 'radiogroup', 'readonly', 'rel', 'required', 'rev', 'reversed', 'role', 'rows', 'rowspan', 'spellcheck', 'scope', 'selected', 'shape', 'size', 'sizes', 'span', 'srclang', 'start', 'src', 'srcset', 'step', 'style', 'summary', 'tabindex', 'title', 'type', 'usemap', 'valign', 'value', 'width', 'xmlns'];

  var svg$1 = ['accent-height', 'accumulate', 'additivive', 'alignment-baseline', 'ascent', 'attributename', 'attributetype', 'azimuth', 'basefrequency', 'baseline-shift', 'begin', 'bias', 'by', 'class', 'clip', 'clip-path', 'clip-rule', 'color', 'color-interpolation', 'color-interpolation-filters', 'color-profile', 'color-rendering', 'cx', 'cy', 'd', 'dx', 'dy', 'diffuseconstant', 'direction', 'display', 'divisor', 'dur', 'edgemode', 'elevation', 'end', 'fill', 'fill-opacity', 'fill-rule', 'filter', 'flood-color', 'flood-opacity', 'font-family', 'font-size', 'font-size-adjust', 'font-stretch', 'font-style', 'font-variant', 'font-weight', 'fx', 'fy', 'g1', 'g2', 'glyph-name', 'glyphref', 'gradientunits', 'gradienttransform', 'height', 'href', 'id', 'image-rendering', 'in', 'in2', 'k', 'k1', 'k2', 'k3', 'k4', 'kerning', 'keypoints', 'keysplines', 'keytimes', 'lang', 'lengthadjust', 'letter-spacing', 'kernelmatrix', 'kernelunitlength', 'lighting-color', 'local', 'marker-end', 'marker-mid', 'marker-start', 'markerheight', 'markerunits', 'markerwidth', 'maskcontentunits', 'maskunits', 'max', 'mask', 'media', 'method', 'mode', 'min', 'name', 'numoctaves', 'offset', 'operator', 'opacity', 'order', 'orient', 'orientation', 'origin', 'overflow', 'paint-order', 'path', 'pathlength', 'patterncontentunits', 'patterntransform', 'patternunits', 'points', 'preservealpha', 'preserveaspectratio', 'r', 'rx', 'ry', 'radius', 'refx', 'refy', 'repeatcount', 'repeatdur', 'restart', 'result', 'rotate', 'scale', 'seed', 'shape-rendering', 'specularconstant', 'specularexponent', 'spreadmethod', 'stddeviation', 'stitchtiles', 'stop-color', 'stop-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-opacity', 'stroke', 'stroke-width', 'style', 'surfacescale', 'tabindex', 'targetx', 'targety', 'transform', 'text-anchor', 'text-decoration', 'text-rendering', 'textlength', 'type', 'u1', 'u2', 'unicode', 'values', 'viewbox', 'visibility', 'vert-adv-y', 'vert-origin-x', 'vert-origin-y', 'width', 'word-spacing', 'wrap', 'writing-mode', 'xchannelselector', 'ychannelselector', 'x', 'x1', 'x2', 'xmlns', 'y', 'y1', 'y2', 'z', 'zoomandpan'];

  var mathMl$1 = ['accent', 'accentunder', 'align', 'bevelled', 'close', 'columnsalign', 'columnlines', 'columnspan', 'denomalign', 'depth', 'dir', 'display', 'displaystyle', 'fence', 'frame', 'height', 'href', 'id', 'largeop', 'length', 'linethickness', 'lspace', 'lquote', 'mathbackground', 'mathcolor', 'mathsize', 'mathvariant', 'maxsize', 'minsize', 'movablelimits', 'notation', 'numalign', 'open', 'rowalign', 'rowlines', 'rowspacing', 'rowspan', 'rspace', 'rquote', 'scriptlevel', 'scriptminsize', 'scriptsizemultiplier', 'selection', 'separator', 'separators', 'stretchy', 'subscriptshift', 'supscriptshift', 'symmetric', 'voffset', 'width', 'xmlns'];

  var xml = ['xlink:href', 'xml:id', 'xlink:title', 'xml:space', 'xmlns:xlink'];

  /* Add properties to a lookup table */
  function addToSet(set, array) {
    var l = array.length;
    while (l--) {
      if (typeof array[l] === 'string') {
        array[l] = array[l].toLowerCase();
      }
      set[array[l]] = true;
    }
    return set;
  }

  /* Shallow clone an object */
  function clone(object) {
    var newObject = {};
    var property = void 0;
    for (property in object) {
      if (Object.prototype.hasOwnProperty.call(object, property)) {
        newObject[property] = object[property];
      }
    }
    return newObject;
  }

  var MUSTACHE_EXPR = /\{\{[\s\S]*|[\s\S]*\}\}/gm; // Specify template detection regex for SAFE_FOR_TEMPLATES mode
  var ERB_EXPR = /<%[\s\S]*|[\s\S]*%>/gm;
  var DATA_ATTR = /^data-[\-\w.\u00B7-\uFFFF]/; // eslint-disable-line no-useless-escape
  var ARIA_ATTR = /^aria-[\-\w]+$/; // eslint-disable-line no-useless-escape
  var IS_ALLOWED_URI = /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i; // eslint-disable-line no-useless-escape
  var IS_SCRIPT_OR_DATA = /^(?:\w+script|data):/i;
  var ATTR_WHITESPACE = /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205f\u3000]/g; // This needs to be extensive thanks to Webkit/Blink's behavior

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

  function _toConsumableArray(arr) { if (Array.isArray(arr)) { for (var i = 0, arr2 = Array(arr.length); i < arr.length; i++) { arr2[i] = arr[i]; } return arr2; } else { return Array.from(arr); } }

  var getGlobal = function getGlobal() {
    return typeof window === 'undefined' ? null : window;
  };

  function createDOMPurify() {
    var window = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : getGlobal();

    var DOMPurify = function DOMPurify(root) {
      return createDOMPurify(root);
    };

    /**
     * Version label, exposed for easier checks
     * if DOMPurify is up to date or not
     */
    DOMPurify.version = '1.0.4';

    /**
     * Array of elements that DOMPurify removed during sanitation.
     * Empty if nothing was removed.
     */
    DOMPurify.removed = [];

    if (!window || !window.document || window.document.nodeType !== 9) {
      // Not running in a browser, provide a factory function
      // so that you can pass your own Window
      DOMPurify.isSupported = false;

      return DOMPurify;
    }

    var originalDocument = window.document;
    var useDOMParser = false; // See comment below
    var useXHR = false;

    var document = window.document;
    var DocumentFragment = window.DocumentFragment,
        HTMLTemplateElement = window.HTMLTemplateElement,
        Node = window.Node,
        NodeFilter = window.NodeFilter,
        _window$NamedNodeMap = window.NamedNodeMap,
        NamedNodeMap = _window$NamedNodeMap === undefined ? window.NamedNodeMap || window.MozNamedAttrMap : _window$NamedNodeMap,
        Text = window.Text,
        Comment = window.Comment,
        DOMParser = window.DOMParser,
        _window$XMLHttpReques = window.XMLHttpRequest,
        XMLHttpRequest = _window$XMLHttpReques === undefined ? window.XMLHttpRequest : _window$XMLHttpReques,
        _window$encodeURI = window.encodeURI,
        encodeURI = _window$encodeURI === undefined ? window.encodeURI : _window$encodeURI;

    // As per issue #47, the web-components registry is inherited by a
    // new document created via createHTMLDocument. As per the spec
    // (http://w3c.github.io/webcomponents/spec/custom/#creating-and-passing-registries)
    // a new empty registry is used when creating a template contents owner
    // document, so we use that as our parent document to ensure nothing
    // is inherited.

    if (typeof HTMLTemplateElement === 'function') {
      var template = document.createElement('template');
      if (template.content && template.content.ownerDocument) {
        document = template.content.ownerDocument;
      }
    }

    var _document = document,
        implementation = _document.implementation,
        createNodeIterator = _document.createNodeIterator,
        getElementsByTagName = _document.getElementsByTagName,
        createDocumentFragment = _document.createDocumentFragment;

    var importNode = originalDocument.importNode;

    var hooks = {};

    /**
     * Expose whether this browser supports running the full DOMPurify.
     */
    DOMPurify.isSupported = implementation && typeof implementation.createHTMLDocument !== 'undefined' && document.documentMode !== 9;

    var MUSTACHE_EXPR$$1 = MUSTACHE_EXPR,
        ERB_EXPR$$1 = ERB_EXPR,
        DATA_ATTR$$1 = DATA_ATTR,
        ARIA_ATTR$$1 = ARIA_ATTR,
        IS_SCRIPT_OR_DATA$$1 = IS_SCRIPT_OR_DATA,
        ATTR_WHITESPACE$$1 = ATTR_WHITESPACE;


    var IS_ALLOWED_URI$$1 = IS_ALLOWED_URI;
    /**
     * We consider the elements and attributes below to be safe. Ideally
     * don't add any new ones but feel free to remove unwanted ones.
     */

    /* allowed element names */
    var ALLOWED_TAGS = null;
    var DEFAULT_ALLOWED_TAGS = addToSet({}, [].concat(_toConsumableArray(html), _toConsumableArray(svg), _toConsumableArray(svgFilters), _toConsumableArray(mathMl), _toConsumableArray(text)));

    /* Allowed attribute names */
    var ALLOWED_ATTR = null;
    var DEFAULT_ALLOWED_ATTR = addToSet({}, [].concat(_toConsumableArray(html$1), _toConsumableArray(svg$1), _toConsumableArray(mathMl$1), _toConsumableArray(xml)));

    /* Explicitly forbidden tags (overrides ALLOWED_TAGS/ADD_TAGS) */
    var FORBID_TAGS = null;

    /* Explicitly forbidden attributes (overrides ALLOWED_ATTR/ADD_ATTR) */
    var FORBID_ATTR = null;

    /* Decide if ARIA attributes are okay */
    var ALLOW_ARIA_ATTR = true;

    /* Decide if custom data attributes are okay */
    var ALLOW_DATA_ATTR = true;

    /* Decide if unknown protocols are okay */
    var ALLOW_UNKNOWN_PROTOCOLS = false;

    /* Output should be safe for jQuery's $() factory? */
    var SAFE_FOR_JQUERY = false;

    /* Output should be safe for common template engines.
     * This means, DOMPurify removes data attributes, mustaches and ERB
     */
    var SAFE_FOR_TEMPLATES = false;

    /* Decide if document with <html>... should be returned */
    var WHOLE_DOCUMENT = false;

    /* Track whether config is already set on this instance of DOMPurify. */
    var SET_CONFIG = false;

    /* Decide if all elements (e.g. style, script) must be children of
     * document.body. By default, browsers might move them to document.head */
    var FORCE_BODY = false;

    /* Decide if a DOM `HTMLBodyElement` should be returned, instead of a html string.
     * If `WHOLE_DOCUMENT` is enabled a `HTMLHtmlElement` will be returned instead
     */
    var RETURN_DOM = false;

    /* Decide if a DOM `DocumentFragment` should be returned, instead of a html string */
    var RETURN_DOM_FRAGMENT = false;

    /* If `RETURN_DOM` or `RETURN_DOM_FRAGMENT` is enabled, decide if the returned DOM
     * `Node` is imported into the current `Document`. If this flag is not enabled the
     * `Node` will belong (its ownerDocument) to a fresh `HTMLDocument`, created by
     * DOMPurify. */
    var RETURN_DOM_IMPORT = false;

    /* Output should be free from DOM clobbering attacks? */
    var SANITIZE_DOM = true;

    /* Keep element content when removing element? */
    var KEEP_CONTENT = true;

    /* Allow usage of profiles like html, svg and mathMl */
    var USE_PROFILES = {};

    /* Tags to ignore content of when KEEP_CONTENT is true */
    var FORBID_CONTENTS = addToSet({}, ['audio', 'head', 'math', 'script', 'style', 'template', 'svg', 'video']);

    /* Tags that are safe for data: URIs */
    var DATA_URI_TAGS = addToSet({}, ['audio', 'video', 'img', 'source', 'image']);

    /* Attributes safe for values like "javascript:" */
    var URI_SAFE_ATTRIBUTES = addToSet({}, ['alt', 'class', 'for', 'id', 'label', 'name', 'pattern', 'placeholder', 'summary', 'title', 'value', 'style', 'xmlns']);

    /* Keep a reference to config to pass to hooks */
    var CONFIG = null;

    /* Ideally, do not touch anything below this line */
    /* ______________________________________________ */

    var formElement = document.createElement('form');

    /**
     * _parseConfig
     *
     * @param  optional config literal
     */
    // eslint-disable-next-line complexity
    var _parseConfig = function _parseConfig(cfg) {
      /* Shield configuration object from tampering */
      if ((typeof cfg === 'undefined' ? 'undefined' : _typeof(cfg)) !== 'object') {
        cfg = {};
      }
      /* Set configuration parameters */
      ALLOWED_TAGS = 'ALLOWED_TAGS' in cfg ? addToSet({}, cfg.ALLOWED_TAGS) : DEFAULT_ALLOWED_TAGS;
      ALLOWED_ATTR = 'ALLOWED_ATTR' in cfg ? addToSet({}, cfg.ALLOWED_ATTR) : DEFAULT_ALLOWED_ATTR;
      FORBID_TAGS = 'FORBID_TAGS' in cfg ? addToSet({}, cfg.FORBID_TAGS) : {};
      FORBID_ATTR = 'FORBID_ATTR' in cfg ? addToSet({}, cfg.FORBID_ATTR) : {};
      USE_PROFILES = 'USE_PROFILES' in cfg ? cfg.USE_PROFILES : false;
      ALLOW_ARIA_ATTR = cfg.ALLOW_ARIA_ATTR !== false; // Default true
      ALLOW_DATA_ATTR = cfg.ALLOW_DATA_ATTR !== false; // Default true
      ALLOW_UNKNOWN_PROTOCOLS = cfg.ALLOW_UNKNOWN_PROTOCOLS || false; // Default false
      SAFE_FOR_JQUERY = cfg.SAFE_FOR_JQUERY || false; // Default false
      SAFE_FOR_TEMPLATES = cfg.SAFE_FOR_TEMPLATES || false; // Default false
      WHOLE_DOCUMENT = cfg.WHOLE_DOCUMENT || false; // Default false
      RETURN_DOM = cfg.RETURN_DOM || false; // Default false
      RETURN_DOM_FRAGMENT = cfg.RETURN_DOM_FRAGMENT || false; // Default false
      RETURN_DOM_IMPORT = cfg.RETURN_DOM_IMPORT || false; // Default false
      FORCE_BODY = cfg.FORCE_BODY || false; // Default false
      SANITIZE_DOM = cfg.SANITIZE_DOM !== false; // Default true
      KEEP_CONTENT = cfg.KEEP_CONTENT !== false; // Default true

      IS_ALLOWED_URI$$1 = cfg.ALLOWED_URI_REGEXP || IS_ALLOWED_URI$$1;

      if (SAFE_FOR_TEMPLATES) {
        ALLOW_DATA_ATTR = false;
      }

      if (RETURN_DOM_FRAGMENT) {
        RETURN_DOM = true;
      }

      /* Parse profile info */
      if (USE_PROFILES) {
        ALLOWED_TAGS = addToSet({}, [].concat(_toConsumableArray(text)));
        ALLOWED_ATTR = [];
        if (USE_PROFILES.html === true) {
          addToSet(ALLOWED_TAGS, html);
          addToSet(ALLOWED_ATTR, html$1);
        }
        if (USE_PROFILES.svg === true) {
          addToSet(ALLOWED_TAGS, svg);
          addToSet(ALLOWED_ATTR, svg$1);
          addToSet(ALLOWED_ATTR, xml);
        }
        if (USE_PROFILES.svgFilters === true) {
          addToSet(ALLOWED_TAGS, svgFilters);
          addToSet(ALLOWED_ATTR, svg$1);
          addToSet(ALLOWED_ATTR, xml);
        }
        if (USE_PROFILES.mathMl === true) {
          addToSet(ALLOWED_TAGS, mathMl);
          addToSet(ALLOWED_ATTR, mathMl$1);
          addToSet(ALLOWED_ATTR, xml);
        }
      }

      /* Merge configuration parameters */
      if (cfg.ADD_TAGS) {
        if (ALLOWED_TAGS === DEFAULT_ALLOWED_TAGS) {
          ALLOWED_TAGS = clone(ALLOWED_TAGS);
        }
        addToSet(ALLOWED_TAGS, cfg.ADD_TAGS);
      }
      if (cfg.ADD_ATTR) {
        if (ALLOWED_ATTR === DEFAULT_ALLOWED_ATTR) {
          ALLOWED_ATTR = clone(ALLOWED_ATTR);
        }
        addToSet(ALLOWED_ATTR, cfg.ADD_ATTR);
      }
      if (cfg.ADD_URI_SAFE_ATTR) {
        addToSet(URI_SAFE_ATTRIBUTES, cfg.ADD_URI_SAFE_ATTR);
      }

      /* Add #text in case KEEP_CONTENT is set to true */
      if (KEEP_CONTENT) {
        ALLOWED_TAGS['#text'] = true;
      }

      // Prevent further manipulation of configuration.
      // Not available in IE8, Safari 5, etc.
      if (Object && 'freeze' in Object) {
        Object.freeze(cfg);
      }

      CONFIG = cfg;
    };

    /**
     * _forceRemove
     *
     * @param  a DOM node
     */
    var _forceRemove = function _forceRemove(node) {
      DOMPurify.removed.push({ element: node });
      try {
        node.parentNode.removeChild(node);
      } catch (err) {
        node.outerHTML = '';
      }
    };

    /**
     * _removeAttribute
     *
     * @param  an Attribute name
     * @param  a DOM node
     */
    var _removeAttribute = function _removeAttribute(name, node) {
      try {
        DOMPurify.removed.push({
          attribute: node.getAttributeNode(name),
          from: node
        });
      } catch (err) {
        DOMPurify.removed.push({
          attribute: null,
          from: node
        });
      }
      node.removeAttribute(name);
    };

    /**
     * _initDocument
     *
     * @param  a string of dirty markup
     * @return a DOM, filled with the dirty markup
     */
    var _initDocument = function _initDocument(dirty) {
      /* Create a HTML document */
      var doc = void 0;
      var body = void 0;

      if (FORCE_BODY) {
        dirty = '<remove></remove>' + dirty;
      }

      /* Use XHR if necessary because Safari 10.1 and newer are buggy */
      if (useXHR) {
        try {
          dirty = encodeURI(dirty);
        } catch (err) {}
        var xhr = new XMLHttpRequest();
        xhr.responseType = 'document';
        xhr.open('GET', 'data:text/html;charset=utf-8,' + dirty, false);
        xhr.send(null);
        doc = xhr.response;
      }

      /* Use DOMParser to workaround Firefox bug (see comment below) */
      if (useDOMParser) {
        try {
          doc = new DOMParser().parseFromString(dirty, 'text/html');
        } catch (err) {}
      }

      /* Otherwise use createHTMLDocument, because DOMParser is unsafe in
      Safari (see comment below) */
      if (!doc || !doc.documentElement) {
        doc = implementation.createHTMLDocument('');
        body = doc.body;
        body.parentNode.removeChild(body.parentNode.firstElementChild);
        body.outerHTML = dirty;
      }

      /* Work on whole document or just its body */
      return getElementsByTagName.call(doc, WHOLE_DOCUMENT ? 'html' : 'body')[0];
    };

    // Safari 10.1+ (unfixed as of time of writing) has a catastrophic bug in
    // its implementation of DOMParser such that the following executes the
    // JavaScript:
    //
    // new DOMParser()
    //   .parseFromString('<svg onload=alert(document.domain)>', 'text/html');
    //
    // Later, it was also noticed that even more assumed benign and inert ways
    // of creating a document are now insecure thanks to Safari. So we work
    // around that with a feature test and use XHR to create the document in
    // case we really have to. That one seems safe for now.
    //
    // However, Firefox uses a different parser for innerHTML rather than
    // DOMParser (see https://bugzilla.mozilla.org/show_bug.cgi?id=1205631)
    // which means that you *must* use DOMParser, otherwise the output may
    // not be safe if used in a document.write context later.
    //
    // So we feature detect the Firefox bug and use the DOMParser if necessary.
    if (DOMPurify.isSupported) {
      (function () {
        var doc = _initDocument('<svg><g onload="this.parentNode.remove()"></g></svg>');
        if (!doc.querySelector('svg')) {
          useXHR = true;
        }
        try {
          doc = _initDocument('<svg><p><style><img src="</style><img src=x onerror=alert(1)//">');
          if (doc.querySelector('svg img')) {
            useDOMParser = true;
          }
        } catch (err) {}
      })();
    }

    /**
     * _createIterator
     *
     * @param  document/fragment to create iterator for
     * @return iterator instance
     */
    var _createIterator = function _createIterator(root) {
      return createNodeIterator.call(root.ownerDocument || root, root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT, function () {
        return NodeFilter.FILTER_ACCEPT;
      }, false);
    };

    /**
     * _isClobbered
     *
     * @param  element to check for clobbering attacks
     * @return true if clobbered, false if safe
     */
    var _isClobbered = function _isClobbered(elm) {
      if (elm instanceof Text || elm instanceof Comment) {
        return false;
      }
      if (typeof elm.nodeName !== 'string' || typeof elm.textContent !== 'string' || typeof elm.removeChild !== 'function' || !(elm.attributes instanceof NamedNodeMap) || typeof elm.removeAttribute !== 'function' || typeof elm.setAttribute !== 'function') {
        return true;
      }
      return false;
    };

    /**
     * _isNode
     *
     * @param object to check whether it's a DOM node
     * @return true is object is a DOM node
     */
    var _isNode = function _isNode(obj) {
      return (typeof Node === 'undefined' ? 'undefined' : _typeof(Node)) === 'object' ? obj instanceof Node : obj && (typeof obj === 'undefined' ? 'undefined' : _typeof(obj)) === 'object' && typeof obj.nodeType === 'number' && typeof obj.nodeName === 'string';
    };

    /**
     * _executeHook
     * Execute user configurable hooks
     *
     * @param  {String} entryPoint  Name of the hook's entry point
     * @param  {Node} currentNode
     */
    var _executeHook = function _executeHook(entryPoint, currentNode, data) {
      if (!hooks[entryPoint]) {
        return;
      }

      hooks[entryPoint].forEach(function (hook) {
        hook.call(DOMPurify, currentNode, data, CONFIG);
      });
    };

    /**
     * _sanitizeElements
     *
     * @protect nodeName
     * @protect textContent
     * @protect removeChild
     *
     * @param   node to check for permission to exist
     * @return  true if node was killed, false if left alive
     */
    var _sanitizeElements = function _sanitizeElements(currentNode) {
      var content = void 0;

      /* Execute a hook if present */
      _executeHook('beforeSanitizeElements', currentNode, null);

      /* Check if element is clobbered or can clobber */
      if (_isClobbered(currentNode)) {
        _forceRemove(currentNode);
        return true;
      }

      /* Now let's check the element's type and name */
      var tagName = currentNode.nodeName.toLowerCase();

      /* Execute a hook if present */
      _executeHook('uponSanitizeElement', currentNode, {
        tagName: tagName,
        allowedTags: ALLOWED_TAGS
      });

      /* Remove element if anything forbids its presence */
      if (!ALLOWED_TAGS[tagName] || FORBID_TAGS[tagName]) {
        /* Keep content except for black-listed elements */
        if (KEEP_CONTENT && !FORBID_CONTENTS[tagName] && typeof currentNode.insertAdjacentHTML === 'function') {
          try {
            currentNode.insertAdjacentHTML('AfterEnd', currentNode.innerHTML);
          } catch (err) {}
        }
        _forceRemove(currentNode);
        return true;
      }

      /* Convert markup to cover jQuery behavior */
      if (SAFE_FOR_JQUERY && !currentNode.firstElementChild && (!currentNode.content || !currentNode.content.firstElementChild) && /</g.test(currentNode.textContent)) {
        DOMPurify.removed.push({ element: currentNode.cloneNode() });
        currentNode.innerHTML = currentNode.textContent.replace(/</g, '&lt;');
      }

      /* Sanitize element content to be template-safe */
      if (SAFE_FOR_TEMPLATES && currentNode.nodeType === 3) {
        /* Get the element's text content */
        content = currentNode.textContent;
        content = content.replace(MUSTACHE_EXPR$$1, ' ');
        content = content.replace(ERB_EXPR$$1, ' ');
        if (currentNode.textContent !== content) {
          DOMPurify.removed.push({ element: currentNode.cloneNode() });
          currentNode.textContent = content;
        }
      }

      /* Execute a hook if present */
      _executeHook('afterSanitizeElements', currentNode, null);

      return false;
    };

    /**
     * _sanitizeAttributes
     *
     * @protect attributes
     * @protect nodeName
     * @protect removeAttribute
     * @protect setAttribute
     *
     * @param   node to sanitize
     * @return  void
     */
    // eslint-disable-next-line complexity
    var _sanitizeAttributes = function _sanitizeAttributes(currentNode) {
      var attr = void 0;
      var name = void 0;
      var value = void 0;
      var lcName = void 0;
      var idAttr = void 0;
      var attributes = void 0;
      var l = void 0;
      /* Execute a hook if present */
      _executeHook('beforeSanitizeAttributes', currentNode, null);

      attributes = currentNode.attributes;

      /* Check if we have attributes; if not we might have a text node */
      if (!attributes) {
        return;
      }

      var hookEvent = {
        attrName: '',
        attrValue: '',
        keepAttr: true,
        allowedAttributes: ALLOWED_ATTR
      };
      l = attributes.length;

      /* Go backwards over all attributes; safely remove bad ones */
      while (l--) {
        attr = attributes[l];
        name = attr.name;
        value = attr.value.trim();
        lcName = name.toLowerCase();

        /* Execute a hook if present */
        hookEvent.attrName = lcName;
        hookEvent.attrValue = value;
        hookEvent.keepAttr = true;
        _executeHook('uponSanitizeAttribute', currentNode, hookEvent);
        value = hookEvent.attrValue;

        /* Remove attribute */
        // Safari (iOS + Mac), last tested v8.0.5, crashes if you try to
        // remove a "name" attribute from an <img> tag that has an "id"
        // attribute at the time.
        if (lcName === 'name' && currentNode.nodeName === 'IMG' && attributes.id) {
          idAttr = attributes.id;
          attributes = Array.prototype.slice.apply(attributes);
          _removeAttribute('id', currentNode);
          _removeAttribute(name, currentNode);
          if (attributes.indexOf(idAttr) > l) {
            currentNode.setAttribute('id', idAttr.value);
          }
        } else if (
        // This works around a bug in Safari, where input[type=file]
        // cannot be dynamically set after type has been removed
        currentNode.nodeName === 'INPUT' && lcName === 'type' && value === 'file' && (ALLOWED_ATTR[lcName] || !FORBID_ATTR[lcName])) {
          continue;
        } else {
          // This avoids a crash in Safari v9.0 with double-ids.
          // The trick is to first set the id to be empty and then to
          // remove the attribute
          if (name === 'id') {
            currentNode.setAttribute(name, '');
          }
          _removeAttribute(name, currentNode);
        }

        /* Did the hooks approve of the attribute? */
        if (!hookEvent.keepAttr) {
          continue;
        }

        /* Make sure attribute cannot clobber */
        if (SANITIZE_DOM && (lcName === 'id' || lcName === 'name') && (value in document || value in formElement)) {
          continue;
        }

        /* Sanitize attribute content to be template-safe */
        if (SAFE_FOR_TEMPLATES) {
          value = value.replace(MUSTACHE_EXPR$$1, ' ');
          value = value.replace(ERB_EXPR$$1, ' ');
        }

        /* Allow valid data-* attributes: At least one character after "-"
           (https://html.spec.whatwg.org/multipage/dom.html#embedding-custom-non-visible-data-with-the-data-*-attributes)
           XML-compatible (https://html.spec.whatwg.org/multipage/infrastructure.html#xml-compatible and http://www.w3.org/TR/xml/#d0e804)
           We don't need to check the value; it's always URI safe. */
        if (ALLOW_DATA_ATTR && DATA_ATTR$$1.test(lcName)) ; else if (ALLOW_ARIA_ATTR && ARIA_ATTR$$1.test(lcName)) ; else if (!ALLOWED_ATTR[lcName] || FORBID_ATTR[lcName]) {
          continue;

          /* Check value is safe. First, is attr inert? If so, is safe */
        } else if (URI_SAFE_ATTRIBUTES[lcName]) ; else if (IS_ALLOWED_URI$$1.test(value.replace(ATTR_WHITESPACE$$1, ''))) ; else if ((lcName === 'src' || lcName === 'xlink:href') && value.indexOf('data:') === 0 && DATA_URI_TAGS[currentNode.nodeName.toLowerCase()]) ; else if (ALLOW_UNKNOWN_PROTOCOLS && !IS_SCRIPT_OR_DATA$$1.test(value.replace(ATTR_WHITESPACE$$1, ''))) ; else if (!value) ; else {
          continue;
        }

        /* Handle invalid data-* attribute set by try-catching it */
        try {
          currentNode.setAttribute(name, value);
          DOMPurify.removed.pop();
        } catch (err) {}
      }

      /* Execute a hook if present */
      _executeHook('afterSanitizeAttributes', currentNode, null);
    };

    /**
     * _sanitizeShadowDOM
     *
     * @param  fragment to iterate over recursively
     * @return void
     */
    var _sanitizeShadowDOM = function _sanitizeShadowDOM(fragment) {
      var shadowNode = void 0;
      var shadowIterator = _createIterator(fragment);

      /* Execute a hook if present */
      _executeHook('beforeSanitizeShadowDOM', fragment, null);

      while (shadowNode = shadowIterator.nextNode()) {
        /* Execute a hook if present */
        _executeHook('uponSanitizeShadowNode', shadowNode, null);

        /* Sanitize tags and elements */
        if (_sanitizeElements(shadowNode)) {
          continue;
        }

        /* Deep shadow DOM detected */
        if (shadowNode.content instanceof DocumentFragment) {
          _sanitizeShadowDOM(shadowNode.content);
        }

        /* Check attributes, sanitize if necessary */
        _sanitizeAttributes(shadowNode);
      }

      /* Execute a hook if present */
      _executeHook('afterSanitizeShadowDOM', fragment, null);
    };

    /**
     * Sanitize
     * Public method providing core sanitation functionality
     *
     * @param {String|Node} dirty string or DOM node
     * @param {Object} configuration object
     */
    // eslint-disable-next-line complexity
    DOMPurify.sanitize = function (dirty, cfg) {
      var body = void 0;
      var importedNode = void 0;
      var currentNode = void 0;
      var oldNode = void 0;
      var returnNode = void 0;
      /* Make sure we have a string to sanitize.
        DO NOT return early, as this will return the wrong type if
        the user has requested a DOM object rather than a string */
      if (!dirty) {
        dirty = '<!-->';
      }

      /* Stringify, in case dirty is an object */
      if (typeof dirty !== 'string' && !_isNode(dirty)) {
        // eslint-disable-next-line no-negated-condition
        if (typeof dirty.toString !== 'function') {
          throw new TypeError('toString is not a function');
        } else {
          dirty = dirty.toString();
          if (typeof dirty !== 'string') {
            throw new TypeError('dirty is not a string, aborting');
          }
        }
      }

      /* Check we can run. Otherwise fall back or ignore */
      if (!DOMPurify.isSupported) {
        if (_typeof(window.toStaticHTML) === 'object' || typeof window.toStaticHTML === 'function') {
          if (typeof dirty === 'string') {
            return window.toStaticHTML(dirty);
          } else if (_isNode(dirty)) {
            return window.toStaticHTML(dirty.outerHTML);
          }
        }
        return dirty;
      }

      /* Assign config vars */
      if (!SET_CONFIG) {
        _parseConfig(cfg);
      }

      /* Clean up removed elements */
      DOMPurify.removed = [];

      if (dirty instanceof Node) {
        /* If dirty is a DOM element, append to an empty document to avoid
           elements being stripped by the parser */
        body = _initDocument('<!-->');
        importedNode = body.ownerDocument.importNode(dirty, true);
        if (importedNode.nodeType === 1 && importedNode.nodeName === 'BODY') {
          /* Node is already a body, use as is */
          body = importedNode;
        } else {
          body.appendChild(importedNode);
        }
      } else {
        /* Exit directly if we have nothing to do */
        if (!RETURN_DOM && !WHOLE_DOCUMENT && dirty.indexOf('<') === -1) {
          return dirty;
        }

        /* Initialize the document to work on */
        body = _initDocument(dirty);

        /* Check we have a DOM node from the data */
        if (!body) {
          return RETURN_DOM ? null : '';
        }
      }

      /* Remove first element node (ours) if FORCE_BODY is set */
      if (FORCE_BODY) {
        _forceRemove(body.firstChild);
      }

      /* Get node iterator */
      var nodeIterator = _createIterator(body);

      /* Now start iterating over the created document */
      while (currentNode = nodeIterator.nextNode()) {
        /* Fix IE's strange behavior with manipulated textNodes #89 */
        if (currentNode.nodeType === 3 && currentNode === oldNode) {
          continue;
        }

        /* Sanitize tags and elements */
        if (_sanitizeElements(currentNode)) {
          continue;
        }

        /* Shadow DOM detected, sanitize it */
        if (currentNode.content instanceof DocumentFragment) {
          _sanitizeShadowDOM(currentNode.content);
        }

        /* Check attributes, sanitize if necessary */
        _sanitizeAttributes(currentNode);

        oldNode = currentNode;
      }

      /* Return sanitized string or DOM */
      if (RETURN_DOM) {
        if (RETURN_DOM_FRAGMENT) {
          returnNode = createDocumentFragment.call(body.ownerDocument);

          while (body.firstChild) {
            returnNode.appendChild(body.firstChild);
          }
        } else {
          returnNode = body;
        }

        if (RETURN_DOM_IMPORT) {
          /* AdoptNode() is not used because internal state is not reset
                 (e.g. the past names map of a HTMLFormElement), this is safe
                 in theory but we would rather not risk another attack vector.
                 The state that is cloned by importNode() is explicitly defined
                 by the specs. */
          returnNode = importNode.call(originalDocument, returnNode, true);
        }

        return returnNode;
      }

      return WHOLE_DOCUMENT ? body.outerHTML : body.innerHTML;
    };

    /**
     * Public method to set the configuration once
     * setConfig
     *
     * @param {Object} configuration object
     * @return void
     */
    DOMPurify.setConfig = function (cfg) {
      _parseConfig(cfg);
      SET_CONFIG = true;
    };

    /**
     * Public method to remove the configuration
     * clearConfig
     *
     * @return void
     */
    DOMPurify.clearConfig = function () {
      CONFIG = null;
      SET_CONFIG = false;
    };

    /**
     * AddHook
     * Public method to add DOMPurify hooks
     *
     * @param {String} entryPoint
     * @param {Function} hookFunction
     */
    DOMPurify.addHook = function (entryPoint, hookFunction) {
      if (typeof hookFunction !== 'function') {
        return;
      }
      hooks[entryPoint] = hooks[entryPoint] || [];
      hooks[entryPoint].push(hookFunction);
    };

    /**
     * RemoveHook
     * Public method to remove a DOMPurify hook at a given entryPoint
     * (pops it from the stack of hooks if more are present)
     *
     * @param {String} entryPoint
     * @return void
     */
    DOMPurify.removeHook = function (entryPoint) {
      if (hooks[entryPoint]) {
        hooks[entryPoint].pop();
      }
    };

    /**
     * RemoveHooks
     * Public method to remove all DOMPurify hooks at a given entryPoint
     *
     * @param  {String} entryPoint
     * @return void
     */
    DOMPurify.removeHooks = function (entryPoint) {
      if (hooks[entryPoint]) {
        hooks[entryPoint] = [];
      }
    };

    /**
     * RemoveAllHooks
     * Public method to remove all DOMPurify hooks
     *
     * @return void
     */
    DOMPurify.removeAllHooks = function () {
      hooks = {};
    };

    return DOMPurify;
  }

  var purify = createDOMPurify();

  return purify;

  })));

  });

  var luxon = createCommonjsModule(function (module, exports) {

  Object.defineProperty(exports, '__esModule', { value: true });

  /*
    This is just a junk drawer, containing anything used across multiple classes.
    Because Luxon is small(ish), this should stay small and we won't worry about splitting
    it up into, say, parsingUtil.js and basicUtil.js and so on. But they are divided up by feature area.
  */

  /**
   * @private
   */

  // TYPES

  function isUndefined(o) {
    return typeof o === 'undefined';
  }

  function isNumber(o) {
    return typeof o === 'number';
  }

  function isString(o) {
    return typeof o === 'string';
  }

  function isDate(o) {
    return Object.prototype.toString.call(o) === '[object Date]';
  }

  // CAPABILITIES

  function hasIntl() {
    return typeof Intl !== 'undefined' && Intl.DateTimeFormat;
  }

  function hasFormatToParts() {
    return !isUndefined(Intl.DateTimeFormat.prototype.formatToParts);
  }

  // OBJECTS AND ARRAYS

  function maybeArray(thing) {
    return Array.isArray(thing) ? thing : [thing];
  }

  function bestBy(arr, by, compare) {
    if (arr.length === 0) {
      return undefined;
    }
    return arr.reduce(function (best, next) {
      var pair = [by(next), next];
      if (!best) {
        return pair;
      } else if (compare.apply(null, [best[0], pair[0]]) === best[0]) {
        return best;
      } else {
        return pair;
      }
    }, null)[1];
  }

  function pick(obj, keys) {
    return keys.reduce(function (a, k) {
      a[k] = obj[k];
      return a;
    }, {});
  }

  // NUMBERS AND STRINGS

  function numberBetween(thing, bottom, top) {
    return isNumber(thing) && thing >= bottom && thing <= top;
  }

  // x % n but takes the sign of n instead of x
  function floorMod(x, n) {
    return x - n * Math.floor(x / n);
  }

  function padStart(input) {
    var n = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 2;

    if (input.toString().length < n) {
      return ('0'.repeat(n) + input).slice(-n);
    } else {
      return input.toString();
    }
  }

  function parseMillis(fraction) {
    if (isUndefined(fraction)) {
      return NaN;
    } else {
      var f = parseFloat('0.' + fraction) * 1000;
      return Math.floor(f);
    }
  }

  function roundTo(number, digits) {
    var factor = Math.pow(10, digits);
    return Math.round(number * factor) / factor;
  }

  // DATE BASICS

  function isLeapYear(year) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  function daysInYear(year) {
    return isLeapYear(year) ? 366 : 365;
  }

  function daysInMonth(year, month) {
    var modMonth = floorMod(month - 1, 12) + 1,
        modYear = year + (month - modMonth) / 12;

    if (modMonth === 2) {
      return isLeapYear(modYear) ? 29 : 28;
    } else {
      return [31, null, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][modMonth - 1];
    }
  }

  function weeksInWeekYear(weekYear) {
    var p1 = (weekYear + Math.floor(weekYear / 4) - Math.floor(weekYear / 100) + Math.floor(weekYear / 400)) % 7,
        last = weekYear - 1,
        p2 = (last + Math.floor(last / 4) - Math.floor(last / 100) + Math.floor(last / 400)) % 7;
    return p1 === 4 || p2 === 3 ? 53 : 52;
  }

  function untruncateYear(year) {
    if (year > 99) {
      return year;
    } else return year > 60 ? 1900 + year : 2000 + year;
  }

  // PARSING

  function parseZoneInfo(ts, offsetFormat, locale) {
    var timeZone = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : null;

    var date = new Date(ts),
        intlOpts = {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    };

    if (timeZone) {
      intlOpts.timeZone = timeZone;
    }

    var modified = Object.assign({ timeZoneName: offsetFormat }, intlOpts),
        intl = hasIntl();

    if (intl && hasFormatToParts()) {
      var parsed = new Intl.DateTimeFormat(locale, modified).formatToParts(date).find(function (m) {
        return m.type.toLowerCase() === 'timezonename';
      });
      return parsed ? parsed.value : null;
    } else if (intl) {
      // this probably doesn't work for all locales
      var without = new Intl.DateTimeFormat(locale, intlOpts).format(date),
          included = new Intl.DateTimeFormat(locale, modified).format(date),
          diffed = included.substring(without.length),
          trimmed = diffed.replace(/^[, ]+/, '');
      return trimmed;
    } else {
      return null;
    }
  }

  // signedOffset('-5', '30') -> -330
  function signedOffset(offHourStr, offMinuteStr) {
    var offHour = parseInt(offHourStr, 10) || 0,
        offMin = parseInt(offMinuteStr, 10) || 0,
        offMinSigned = offHour < 0 ? -offMin : offMin;
    return offHour * 60 + offMinSigned;
  }

  // COERCION

  function normalizeObject(obj, normalizer) {
    var ignoreUnknown = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

    var normalized = {};
    for (var u in obj) {
      if (obj.hasOwnProperty(u)) {
        var v = obj[u];
        if (v !== null && !isUndefined(v) && !Number.isNaN(v)) {
          var mapped = normalizer(u, ignoreUnknown);
          if (mapped) {
            normalized[mapped] = v;
          }
        }
      }
    }
    return normalized;
  }

  function timeObject(obj) {
    return pick(obj, ['hour', 'minute', 'second', 'millisecond']);
  }

  /**
   * @private
   */

  var n = 'numeric',
      s = 'short',
      l = 'long',
      d2 = '2-digit';

  var DATE_SHORT = {
    year: n,
    month: n,
    day: n
  };

  var DATE_MED = {
    year: n,
    month: s,
    day: n
  };

  var DATE_FULL = {
    year: n,
    month: l,
    day: n
  };

  var DATE_HUGE = {
    year: n,
    month: l,
    day: n,
    weekday: l
  };

  var TIME_SIMPLE = {
    hour: n,
    minute: d2
  };

  var TIME_WITH_SECONDS = {
    hour: n,
    minute: d2,
    second: d2
  };

  var TIME_WITH_SHORT_OFFSET = {
    hour: n,
    minute: d2,
    second: d2,
    timeZoneName: s
  };

  var TIME_WITH_LONG_OFFSET = {
    hour: n,
    minute: d2,
    second: d2,
    timeZoneName: l
  };

  var TIME_24_SIMPLE = {
    hour: n,
    minute: d2,
    hour12: false
  };

  /**
   * {@link toLocaleString}; format like '09:30:23', always 24-hour.
   */
  var TIME_24_WITH_SECONDS = {
    hour: n,
    minute: d2,
    second: d2,
    hour12: false
  };

  /**
   * {@link toLocaleString}; format like '09:30:23 EDT', always 24-hour.
   */
  var TIME_24_WITH_SHORT_OFFSET = {
    hour: n,
    minute: d2,
    second: d2,
    hour12: false,
    timeZoneName: s
  };

  /**
   * {@link toLocaleString}; format like '09:30:23 Eastern Daylight Time', always 24-hour.
   */
  var TIME_24_WITH_LONG_OFFSET = {
    hour: n,
    minute: d2,
    second: d2,
    hour12: false,
    timeZoneName: l
  };

  /**
   * {@link toLocaleString}; format like '10/14/1983, 9:30 AM'. Only 12-hour if the locale is.
   */
  var DATETIME_SHORT = {
    year: n,
    month: n,
    day: n,
    hour: n,
    minute: d2
  };

  /**
   * {@link toLocaleString}; format like '10/14/1983, 9:30:33 AM'. Only 12-hour if the locale is.
   */
  var DATETIME_SHORT_WITH_SECONDS = {
    year: n,
    month: n,
    day: n,
    hour: n,
    minute: d2,
    second: d2
  };

  var DATETIME_MED = {
    year: n,
    month: s,
    day: n,
    hour: n,
    minute: d2
  };

  var DATETIME_MED_WITH_SECONDS = {
    year: n,
    month: s,
    day: n,
    hour: n,
    minute: d2,
    second: d2
  };

  var DATETIME_FULL = {
    year: n,
    month: l,
    day: n,
    hour: n,
    minute: d2,
    timeZoneName: s
  };

  var DATETIME_FULL_WITH_SECONDS = {
    year: n,
    month: l,
    day: n,
    hour: n,
    minute: d2,
    second: d2,
    timeZoneName: s
  };

  var DATETIME_HUGE = {
    year: n,
    month: l,
    day: n,
    weekday: l,
    hour: n,
    minute: d2,
    timeZoneName: l
  };

  var DATETIME_HUGE_WITH_SECONDS = {
    year: n,
    month: l,
    day: n,
    weekday: l,
    hour: n,
    minute: d2,
    second: d2,
    timeZoneName: l
  };

  function stringify(obj) {
    return JSON.stringify(obj, Object.keys(obj).sort());
  }

  /**
   * @private
   */

  var monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  var monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var monthsNarrow = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  function months(length) {
    switch (length) {
      case 'narrow':
        return monthsNarrow;
      case 'short':
        return monthsShort;
      case 'long':
        return monthsLong;
      case 'numeric':
        return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
      case '2-digit':
        return ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
      default:
        return null;
    }
  }

  var weekdaysLong = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  var weekdaysShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var weekdaysNarrow = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

  function weekdays(length) {
    switch (length) {
      case 'narrow':
        return weekdaysNarrow;
      case 'short':
        return weekdaysShort;
      case 'long':
        return weekdaysLong;
      case 'numeric':
        return ['1', '2', '3', '4', '5', '6', '7'];
      default:
        return null;
    }
  }

  var meridiems = ['AM', 'PM'];

  var erasLong = ['Before Christ', 'Anno Domini'];

  var erasShort = ['BC', 'AD'];

  var erasNarrow = ['B', 'A'];

  function eras(length) {
    switch (length) {
      case 'narrow':
        return erasNarrow;
      case 'short':
        return erasShort;
      case 'long':
        return erasLong;
      default:
        return null;
    }
  }

  function meridiemForDateTime(dt) {
    return meridiems[dt.hour < 12 ? 0 : 1];
  }

  function weekdayForDateTime(dt, length) {
    return weekdays(length)[dt.weekday - 1];
  }

  function monthForDateTime(dt, length) {
    return months(length)[dt.month - 1];
  }

  function eraForDateTime(dt, length) {
    return eras(length)[dt.year < 0 ? 0 : 1];
  }

  function formatString(knownFormat) {
    // these all have the offsets removed because we don't have access to them
    // without all the intl stuff this is backfilling
    var filtered = pick(knownFormat, ['weekday', 'era', 'year', 'month', 'day', 'hour', 'minute', 'second', 'timeZoneName', 'hour12']),
        key = stringify(filtered),
        dateTimeHuge = 'EEEE, LLLL d, yyyy, h:mm a';
    switch (key) {
      case stringify(DATE_SHORT):
        return 'M/d/yyyy';
      case stringify(DATE_MED):
        return 'LLL d, yyyy';
      case stringify(DATE_FULL):
        return 'LLLL d, yyyy';
      case stringify(DATE_HUGE):
        return 'EEEE, LLLL d, yyyy';
      case stringify(TIME_SIMPLE):
        return 'h:mm a';
      case stringify(TIME_WITH_SECONDS):
        return 'h:mm:ss a';
      case stringify(TIME_WITH_SHORT_OFFSET):
        return 'h:mm a';
      case stringify(TIME_WITH_LONG_OFFSET):
        return 'h:mm a';
      case stringify(TIME_24_SIMPLE):
        return 'HH:mm';
      case stringify(TIME_24_WITH_SECONDS):
        return 'HH:mm:ss';
      case stringify(TIME_24_WITH_SHORT_OFFSET):
        return 'HH:mm';
      case stringify(TIME_24_WITH_LONG_OFFSET):
        return 'HH:mm';
      case stringify(DATETIME_SHORT):
        return 'M/d/yyyy, h:mm a';
      case stringify(DATETIME_MED):
        return 'LLL d, yyyy, h:mm a';
      case stringify(DATETIME_FULL):
        return 'LLLL d, yyyy, h:mm a';
      case stringify(DATETIME_HUGE):
        return dateTimeHuge;
      case stringify(DATETIME_SHORT_WITH_SECONDS):
        return 'M/d/yyyy, h:mm:ss a';
      case stringify(DATETIME_MED_WITH_SECONDS):
        return 'LLL d, yyyy, h:mm:ss a';
      case stringify(DATETIME_FULL_WITH_SECONDS):
        return 'LLLL d, yyyy, h:mm:ss a';
      case stringify(DATETIME_HUGE_WITH_SECONDS):
        return 'EEEE, LLLL d, yyyy, h:mm:ss a';
      default:
        return dateTimeHuge;
    }
  }

  var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) {
    return typeof obj;
  } : function (obj) {
    return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj;
  };

  var classCallCheck = function (instance, Constructor) {
    if (!(instance instanceof Constructor)) {
      throw new TypeError("Cannot call a class as a function");
    }
  };

  var createClass = function () {
    function defineProperties(target, props) {
      for (var i = 0; i < props.length; i++) {
        var descriptor = props[i];
        descriptor.enumerable = descriptor.enumerable || false;
        descriptor.configurable = true;
        if ("value" in descriptor) descriptor.writable = true;
        Object.defineProperty(target, descriptor.key, descriptor);
      }
    }

    return function (Constructor, protoProps, staticProps) {
      if (protoProps) defineProperties(Constructor.prototype, protoProps);
      if (staticProps) defineProperties(Constructor, staticProps);
      return Constructor;
    };
  }();

  var inherits = function (subClass, superClass) {
    if (typeof superClass !== "function" && superClass !== null) {
      throw new TypeError("Super expression must either be null or a function, not " + typeof superClass);
    }

    subClass.prototype = Object.create(superClass && superClass.prototype, {
      constructor: {
        value: subClass,
        enumerable: false,
        writable: true,
        configurable: true
      }
    });
    if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass;
  };

  var possibleConstructorReturn = function (self, call) {
    if (!self) {
      throw new ReferenceError("this hasn't been initialised - super() hasn't been called");
    }

    return call && (typeof call === "object" || typeof call === "function") ? call : self;
  };

  // these aren't really private, but nor are they really useful to document

  /**
   * @private
   */
  var LuxonError = function (_Error) {
    inherits(LuxonError, _Error);

    function LuxonError() {
      classCallCheck(this, LuxonError);
      return possibleConstructorReturn(this, _Error.apply(this, arguments));
    }

    return LuxonError;
  }(Error);

  /**
   * @private
   */


  var InvalidDateTimeError = function (_LuxonError) {
    inherits(InvalidDateTimeError, _LuxonError);

    function InvalidDateTimeError(reason) {
      classCallCheck(this, InvalidDateTimeError);
      return possibleConstructorReturn(this, _LuxonError.call(this, 'Invalid DateTime: ' + reason));
    }

    return InvalidDateTimeError;
  }(LuxonError);

  /**
   * @private
   */
  var InvalidIntervalError = function (_LuxonError2) {
    inherits(InvalidIntervalError, _LuxonError2);

    function InvalidIntervalError(reason) {
      classCallCheck(this, InvalidIntervalError);
      return possibleConstructorReturn(this, _LuxonError2.call(this, 'Invalid Interval: ' + reason));
    }

    return InvalidIntervalError;
  }(LuxonError);

  /**
   * @private
   */
  var InvalidDurationError = function (_LuxonError3) {
    inherits(InvalidDurationError, _LuxonError3);

    function InvalidDurationError(reason) {
      classCallCheck(this, InvalidDurationError);
      return possibleConstructorReturn(this, _LuxonError3.call(this, 'Invalid Duration: ' + reason));
    }

    return InvalidDurationError;
  }(LuxonError);

  /**
   * @private
   */
  var ConflictingSpecificationError = function (_LuxonError4) {
    inherits(ConflictingSpecificationError, _LuxonError4);

    function ConflictingSpecificationError() {
      classCallCheck(this, ConflictingSpecificationError);
      return possibleConstructorReturn(this, _LuxonError4.apply(this, arguments));
    }

    return ConflictingSpecificationError;
  }(LuxonError);

  /**
   * @private
   */
  var InvalidUnitError = function (_LuxonError5) {
    inherits(InvalidUnitError, _LuxonError5);

    function InvalidUnitError(unit) {
      classCallCheck(this, InvalidUnitError);
      return possibleConstructorReturn(this, _LuxonError5.call(this, 'Invalid unit ' + unit));
    }

    return InvalidUnitError;
  }(LuxonError);

  /**
   * @private
   */
  var InvalidArgumentError = function (_LuxonError6) {
    inherits(InvalidArgumentError, _LuxonError6);

    function InvalidArgumentError() {
      classCallCheck(this, InvalidArgumentError);
      return possibleConstructorReturn(this, _LuxonError6.apply(this, arguments));
    }

    return InvalidArgumentError;
  }(LuxonError);

  /**
   * @private
   */
  var ZoneIsAbstractError = function (_LuxonError7) {
    inherits(ZoneIsAbstractError, _LuxonError7);

    function ZoneIsAbstractError() {
      classCallCheck(this, ZoneIsAbstractError);
      return possibleConstructorReturn(this, _LuxonError7.call(this, 'Zone is an abstract class'));
    }

    return ZoneIsAbstractError;
  }(LuxonError);

  /* eslint no-unused-vars: "off" */

  /**
   * @interface
  */

  var Zone = function () {
    function Zone() {
      classCallCheck(this, Zone);
    }

    /**
     * Returns the offset's common name (such as EST) at the specified timestamp
     * @abstract
     * @param {number} ts - Epoch milliseconds for which to get the name
     * @param {Object} opts - Options to affect the format
     * @param {string} opts.format - What style of offset to return. Accepts 'long' or 'short'.
     * @param {string} opts.locale - What locale to return the offset name in.
     * @return {string}
     */
    Zone.prototype.offsetName = function offsetName(ts, opts) {
      throw new ZoneIsAbstractError();
    };

    /**
     * Return the offset in minutes for this zone at the specified timestamp.
     * @abstract
     * @param {number} ts - Epoch milliseconds for which to compute the offset
     * @return {number}
     */


    Zone.prototype.offset = function offset(ts) {
      throw new ZoneIsAbstractError();
    };

    /**
     * Return whether this Zone is equal to another zoner
     * @abstract
     * @param {Zone} otherZone - the zone to compare
     * @return {boolean}
     */


    Zone.prototype.equals = function equals(otherZone) {
      throw new ZoneIsAbstractError();
    };

    /**
     * Return whether this Zone is valid.
     * @abstract
     * @type {boolean}
     */


    createClass(Zone, [{
      key: 'type',

      /**
       * The type of zone
       * @abstract
       * @type {string}
       */
      get: function get$$1() {
        throw new ZoneIsAbstractError();
      }

      /**
       * The name of this zone.
       * @abstract
       * @type {string}
       */

    }, {
      key: 'name',
      get: function get$$1() {
        throw new ZoneIsAbstractError();
      }

      /**
       * Returns whether the offset is known to be fixed for the whole year.
       * @abstract
       * @type {boolean}
       */

    }, {
      key: 'universal',
      get: function get$$1() {
        throw new ZoneIsAbstractError();
      }
    }, {
      key: 'isValid',
      get: function get$$1() {
        throw new ZoneIsAbstractError();
      }
    }]);
    return Zone;
  }();

  var singleton = null;

  var LocalZone = function (_Zone) {
    inherits(LocalZone, _Zone);

    function LocalZone() {
      classCallCheck(this, LocalZone);
      return possibleConstructorReturn(this, _Zone.apply(this, arguments));
    }

    LocalZone.prototype.offsetName = function offsetName(ts, _ref) {
      var format = _ref.format,
          locale = _ref.locale;

      return parseZoneInfo(ts, format, locale);
    };

    LocalZone.prototype.offset = function offset(ts) {
      return -new Date(ts).getTimezoneOffset();
    };

    LocalZone.prototype.equals = function equals(otherZone) {
      return otherZone.type === 'local';
    };

    createClass(LocalZone, [{
      key: 'type',
      get: function get$$1() {
        return 'local';
      }
    }, {
      key: 'name',
      get: function get$$1() {
        if (hasIntl()) {
          return new Intl.DateTimeFormat().resolvedOptions().timeZone;
        } else return 'local';
      }
    }, {
      key: 'universal',
      get: function get$$1() {
        return false;
      }
    }, {
      key: 'isValid',
      get: function get$$1() {
        return true;
      }
    }], [{
      key: 'instance',
      get: function get$$1() {
        if (singleton === null) {
          singleton = new LocalZone();
        }
        return singleton;
      }
    }]);
    return LocalZone;
  }(Zone);

  var dtfCache = {};
  function makeDTF(zone) {
    if (!dtfCache[zone]) {
      dtfCache[zone] = new Intl.DateTimeFormat('en-US', {
        hour12: false,
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
    return dtfCache[zone];
  }

  var typeToPos = {
    year: 0,
    month: 1,
    day: 2,
    hour: 3,
    minute: 4,
    second: 5
  };

  function hackyOffset(dtf, date) {
    var formatted = dtf.format(date).replace(/\u200E/g, ''),
        parsed = /(\d+)\/(\d+)\/(\d+),? (\d+):(\d+):(\d+)/.exec(formatted),
        fMonth = parsed[1],
        fDay = parsed[2],
        fYear = parsed[3],
        fHour = parsed[4],
        fMinute = parsed[5],
        fSecond = parsed[6];

    return [fYear, fMonth, fDay, fHour, fMinute, fSecond];
  }

  function partsOffset(dtf, date) {
    var formatted = dtf.formatToParts(date),
        filled = [];
    for (var i = 0; i < formatted.length; i++) {
      var _formatted$i = formatted[i],
          type = _formatted$i.type,
          value = _formatted$i.value,
          pos = typeToPos[type];


      if (!isUndefined(pos)) {
        filled[pos] = parseInt(value, 10);
      }
    }
    return filled;
  }

  var IANAZone = function (_Zone) {
    inherits(IANAZone, _Zone);

    IANAZone.isValidSpecifier = function isValidSpecifier(s) {
      return s && s.match(/^[a-z_+-]{1,256}\/[a-z_+-]{1,256}(\/[a-z_+-]{1,256})?$/i);
    };

    IANAZone.isValidZone = function isValidZone(zone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone }).format();
        return true;
      } catch (e) {
        return false;
      }
    };

    // Etc/GMT+8 -> 480


    IANAZone.parseGMTOffset = function parseGMTOffset(specifier) {
      if (specifier) {
        var match = specifier.match(/^Etc\/GMT([+-]\d{1,2})$/i);
        if (match) {
          return 60 * parseInt(match[1]);
        }
      }
      return null;
    };

    function IANAZone(name) {
      classCallCheck(this, IANAZone);

      var _this = possibleConstructorReturn(this, _Zone.call(this));

      _this.zoneName = name;
      _this.valid = IANAZone.isValidZone(name);
      return _this;
    }

    IANAZone.prototype.offsetName = function offsetName(ts, _ref) {
      var format = _ref.format,
          locale = _ref.locale;

      return parseZoneInfo(ts, format, locale, this.zoneName);
    };

    IANAZone.prototype.offset = function offset(ts) {
      var date = new Date(ts),
          dtf = makeDTF(this.zoneName),
          _ref2 = dtf.formatToParts ? partsOffset(dtf, date) : hackyOffset(dtf, date),
          fYear = _ref2[0],
          fMonth = _ref2[1],
          fDay = _ref2[2],
          fHour = _ref2[3],
          fMinute = _ref2[4],
          fSecond = _ref2[5],
          asUTC = Date.UTC(fYear, fMonth - 1, fDay, fHour, fMinute, fSecond);

      var asTS = date.valueOf();
      asTS -= asTS % 1000;
      return (asUTC - asTS) / (60 * 1000);
    };

    IANAZone.prototype.equals = function equals(otherZone) {
      return otherZone.type === 'iana' && otherZone.zoneName === this.zoneName;
    };

    createClass(IANAZone, [{
      key: 'type',
      get: function get$$1() {
        return 'iana';
      }
    }, {
      key: 'name',
      get: function get$$1() {
        return this.zoneName;
      }
    }, {
      key: 'universal',
      get: function get$$1() {
        return false;
      }
    }, {
      key: 'isValid',
      get: function get$$1() {
        return this.valid;
      }
    }]);
    return IANAZone;
  }(Zone);

  var singleton$1 = null;

  function hoursMinutesOffset(z) {
    var hours = Math.trunc(z.fixed / 60),
        minutes = Math.abs(z.fixed % 60),
        sign = hours > 0 ? '+' : '-',
        base = sign + Math.abs(hours);
    return minutes > 0 ? base + ':' + padStart(minutes, 2) : base;
  }

  var FixedOffsetZone = function (_Zone) {
    inherits(FixedOffsetZone, _Zone);

    FixedOffsetZone.instance = function instance(offset) {
      return offset === 0 ? FixedOffsetZone.utcInstance : new FixedOffsetZone(offset);
    };

    FixedOffsetZone.parseSpecifier = function parseSpecifier(s) {
      if (s) {
        var r = s.match(/^utc(?:([+-]\d{1,2})(?::(\d{2}))?)?$/i);
        if (r) {
          return new FixedOffsetZone(signedOffset(r[1], r[2]));
        }
      }
      return null;
    };

    createClass(FixedOffsetZone, null, [{
      key: 'utcInstance',
      get: function get$$1() {
        if (singleton$1 === null) {
          singleton$1 = new FixedOffsetZone(0);
        }
        return singleton$1;
      }
    }]);

    function FixedOffsetZone(offset) {
      classCallCheck(this, FixedOffsetZone);

      var _this = possibleConstructorReturn(this, _Zone.call(this));

      _this.fixed = offset;
      return _this;
    }

    FixedOffsetZone.prototype.offsetName = function offsetName() {
      return this.name;
    };

    FixedOffsetZone.prototype.offset = function offset() {
      return this.fixed;
    };

    FixedOffsetZone.prototype.equals = function equals(otherZone) {
      return otherZone.type === 'fixed' && otherZone.fixed === this.fixed;
    };

    createClass(FixedOffsetZone, [{
      key: 'type',
      get: function get$$1() {
        return 'fixed';
      }
    }, {
      key: 'name',
      get: function get$$1() {
        return this.fixed === 0 ? 'UTC' : 'UTC' + hoursMinutesOffset(this);
      }
    }, {
      key: 'universal',
      get: function get$$1() {
        return true;
      }
    }, {
      key: 'isValid',
      get: function get$$1() {
        return true;
      }
    }]);
    return FixedOffsetZone;
  }(Zone);

  var singleton$2 = null;

  var InvalidZone = function (_Zone) {
    inherits(InvalidZone, _Zone);

    function InvalidZone() {
      classCallCheck(this, InvalidZone);
      return possibleConstructorReturn(this, _Zone.apply(this, arguments));
    }

    InvalidZone.prototype.offsetName = function offsetName() {
      return null;
    };

    InvalidZone.prototype.offset = function offset() {
      return NaN;
    };

    InvalidZone.prototype.equals = function equals() {
      return false;
    };

    createClass(InvalidZone, [{
      key: 'type',
      get: function get$$1() {
        return 'invalid';
      }
    }, {
      key: 'name',
      get: function get$$1() {
        return null;
      }
    }, {
      key: 'universal',
      get: function get$$1() {
        return false;
      }
    }, {
      key: 'isValid',
      get: function get$$1() {
        return false;
      }
    }], [{
      key: 'instance',
      get: function get$$1() {
        if (singleton$2 === null) {
          singleton$2 = new InvalidZone();
        }
        return singleton$2;
      }
    }]);
    return InvalidZone;
  }(Zone);

  /**
   * @private
   */

  function normalizeZone(input, defaultZone) {
    var offset = void 0;
    if (isUndefined(input) || input === null) {
      return defaultZone;
    } else if (input instanceof Zone) {
      return input;
    } else if (isString(input)) {
      var lowered = input.toLowerCase();
      if (lowered === 'local') return LocalZone.instance;else if (lowered === 'utc' || lowered === 'gmt') return FixedOffsetZone.utcInstance;else if ((offset = IANAZone.parseGMTOffset(input)) != null) {
        // handle Etc/GMT-4, which V8 chokes on
        return FixedOffsetZone.instance(offset);
      } else if (IANAZone.isValidSpecifier(lowered)) return new IANAZone(input);else return FixedOffsetZone.parseSpecifier(lowered) || InvalidZone.instance;
    } else if (isNumber(input)) {
      return FixedOffsetZone.instance(input);
    } else if ((typeof input === 'undefined' ? 'undefined' : _typeof(input)) === 'object' && input.offset) {
      // This is dumb, but the instanceof check above doesn't seem to really work
      // so we're duck checking it
      return input;
    } else {
      return InvalidZone.instance;
    }
  }

  var now = function now() {
    return new Date().valueOf();
  },
      defaultZone = null,
      // not setting this directly to LocalZone.instance bc loading order issues
  defaultLocale = null,
      defaultNumberingSystem = null,
      defaultOutputCalendar = null,
      throwOnInvalid = false;

  /**
   * Settings contains static getters and setters that control Luxon's overall behavior. Luxon is a simple library with few options, but the ones it does have live here.
   */

  var Settings = function () {
    function Settings() {
      classCallCheck(this, Settings);
    }

    /**
     * Reset Luxon's global caches. Should only be necessary in testing scenarios.
     * @return {void}
     */
    Settings.resetCaches = function resetCaches() {
      Locale.resetCache();
    };

    createClass(Settings, null, [{
      key: 'now',

      /**
       * Get the callback for returning the current timestamp.
       * @type {function}
       */
      get: function get$$1() {
        return now;
      }

      /**
       * Set the callback for returning the current timestamp.
       * @type {function}
       */
      ,
      set: function set$$1(n) {
        now = n;
      }

      /**
       * Get the default time zone to create DateTimes in.
       * @type {string}
       */

    }, {
      key: 'defaultZoneName',
      get: function get$$1() {
        return (defaultZone || LocalZone.instance).name;
      }

      /**
       * Set the default time zone to create DateTimes in. Does not affect existing instances.
       * @type {string}
       */
      ,
      set: function set$$1(z) {
        if (!z) {
          defaultZone = null;
        } else {
          defaultZone = normalizeZone(z);
        }
      }

      /**
       * Get the default time zone object to create DateTimes in. Does not affect existing instances.
       * @type {Zone}
       */

    }, {
      key: 'defaultZone',
      get: function get$$1() {
        return defaultZone || LocalZone.instance;
      }

      /**
       * Get the default locale to create DateTimes with. Does not affect existing instances.
       * @type {string}
       */

    }, {
      key: 'defaultLocale',
      get: function get$$1() {
        return defaultLocale;
      }

      /**
       * Set the default locale to create DateTimes with. Does not affect existing instances.
       * @type {string}
       */
      ,
      set: function set$$1(locale) {
        defaultLocale = locale;
      }

      /**
       * Get the default numbering system to create DateTimes with. Does not affect existing instances.
       * @type {string}
       */

    }, {
      key: 'defaultNumberingSystem',
      get: function get$$1() {
        return defaultNumberingSystem;
      }

      /**
       * Set the default numbering system to create DateTimes with. Does not affect existing instances.
       * @type {string}
       */
      ,
      set: function set$$1(numberingSystem) {
        defaultNumberingSystem = numberingSystem;
      }

      /**
       * Get the default output calendar to create DateTimes with. Does not affect existing instances.
       * @type {string}
       */

    }, {
      key: 'defaultOutputCalendar',
      get: function get$$1() {
        return defaultOutputCalendar;
      }

      /**
       * Set the default output calendar to create DateTimes with. Does not affect existing instances.
       * @type {string}
       */
      ,
      set: function set$$1(outputCalendar) {
        defaultOutputCalendar = outputCalendar;
      }

      /**
       * Get whether Luxon will throw when it encounters invalid DateTimes, Durations, or Intervals
       * @type {boolean}
       */

    }, {
      key: 'throwOnInvalid',
      get: function get$$1() {
        return throwOnInvalid;
      }

      /**
       * Set whether Luxon will throw when it encounters invalid DateTimes, Durations, or Intervals
       * @type {boolean}
       */
      ,
      set: function set$$1(t) {
        throwOnInvalid = t;
      }
    }]);
    return Settings;
  }();

  function stringifyTokens(splits, tokenToString) {
    var s = '';
    for (var _iterator = splits, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
      var _ref;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref = _i.value;
      }

      var token = _ref;

      if (token.literal) {
        s += token.val;
      } else {
        s += tokenToString(token.val);
      }
    }
    return s;
  }

  var tokenToObject = {
    D: DATE_SHORT,
    DD: DATE_MED,
    DDD: DATE_FULL,
    DDDD: DATE_HUGE,
    t: TIME_SIMPLE,
    tt: TIME_WITH_SECONDS,
    ttt: TIME_WITH_SHORT_OFFSET,
    tttt: TIME_WITH_LONG_OFFSET,
    T: TIME_24_SIMPLE,
    TT: TIME_24_WITH_SECONDS,
    TTT: TIME_24_WITH_SHORT_OFFSET,
    TTTT: TIME_24_WITH_LONG_OFFSET,
    f: DATETIME_SHORT,
    ff: DATETIME_MED,
    fff: DATETIME_FULL,
    ffff: DATETIME_HUGE,
    F: DATETIME_SHORT_WITH_SECONDS,
    FF: DATETIME_MED_WITH_SECONDS,
    FFF: DATETIME_FULL_WITH_SECONDS,
    FFFF: DATETIME_HUGE_WITH_SECONDS
  };

  /**
   * @private
   */

  var Formatter = function () {
    Formatter.create = function create(locale) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var formatOpts = Object.assign({}, { round: true }, opts);
      return new Formatter(locale, formatOpts);
    };

    Formatter.parseFormat = function parseFormat(fmt) {
      var current = null,
          currentFull = '',
          bracketed = false;
      var splits = [];
      for (var i = 0; i < fmt.length; i++) {
        var c = fmt.charAt(i);
        if (c === "'") {
          if (currentFull.length > 0) {
            splits.push({ literal: bracketed, val: currentFull });
          }
          current = null;
          currentFull = '';
          bracketed = !bracketed;
        } else if (bracketed) {
          currentFull += c;
        } else if (c === current) {
          currentFull += c;
        } else {
          if (currentFull.length > 0) {
            splits.push({ literal: false, val: currentFull });
          }
          currentFull = c;
          current = c;
        }
      }

      if (currentFull.length > 0) {
        splits.push({ literal: bracketed, val: currentFull });
      }

      return splits;
    };

    function Formatter(locale, formatOpts) {
      classCallCheck(this, Formatter);

      this.opts = formatOpts;
      this.loc = locale;
      this.systemLoc = null;
    }

    Formatter.prototype.formatWithSystemDefault = function formatWithSystemDefault(dt, opts) {
      if (this.systemLoc === null) {
        this.systemLoc = this.loc.redefaultToSystem();
      }
      var df = this.systemLoc.dtFormatter(dt, Object.assign({}, this.opts, opts));
      return df.format();
    };

    Formatter.prototype.formatDateTime = function formatDateTime(dt) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var df = this.loc.dtFormatter(dt, Object.assign({}, this.opts, opts));
      return df.format();
    };

    Formatter.prototype.formatDateTimeParts = function formatDateTimeParts(dt) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var df = this.loc.dtFormatter(dt, Object.assign({}, this.opts, opts));
      return df.formatToParts();
    };

    Formatter.prototype.resolvedOptions = function resolvedOptions(dt) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var df = this.loc.dtFormatter(dt, Object.assign({}, this.opts, opts));
      return df.resolvedOptions();
    };

    Formatter.prototype.num = function num(n) {
      var p = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 0;

      // we get some perf out of doing this here, annoyingly
      if (this.opts.forceSimple) {
        return padStart(n, p);
      }

      var opts = Object.assign({}, this.opts);

      if (p > 0) {
        opts.padTo = p;
      }

      return this.loc.numberFormatter(opts).format(n);
    };

    Formatter.prototype.formatDateTimeFromString = function formatDateTimeFromString(dt, fmt) {
      var _this = this;

      var knownEnglish = this.loc.listingMode() === 'en';
      var string = function string(opts, extract) {
        return _this.loc.extract(dt, opts, extract);
      },
          formatOffset = function formatOffset(opts) {
        if (dt.isOffsetFixed && dt.offset === 0 && opts.allowZ) {
          return 'Z';
        }

        var hours = Math.trunc(dt.offset / 60),
            minutes = Math.abs(dt.offset % 60),
            sign = hours >= 0 ? '+' : '-',
            base = '' + sign + Math.abs(hours);

        switch (opts.format) {
          case 'short':
            return '' + sign + _this.num(Math.abs(hours), 2) + ':' + _this.num(minutes, 2);
          case 'narrow':
            return minutes > 0 ? base + ':' + minutes : base;
          case 'techie':
            return '' + sign + _this.num(Math.abs(hours), 2) + _this.num(minutes, 2);
          default:
            throw new RangeError('Value format ' + opts.format + ' is out of range for property format');
        }
      },
          meridiem = function meridiem() {
        return knownEnglish ? meridiemForDateTime(dt) : string({ hour: 'numeric', hour12: true }, 'dayperiod');
      },
          month = function month(length, standalone) {
        return knownEnglish ? monthForDateTime(dt, length) : string(standalone ? { month: length } : { month: length, day: 'numeric' }, 'month');
      },
          weekday = function weekday(length, standalone) {
        return knownEnglish ? weekdayForDateTime(dt, length) : string(standalone ? { weekday: length } : { weekday: length, month: 'long', day: 'numeric' }, 'weekday');
      },
          maybeMacro = function maybeMacro(token) {
        var macro = tokenToObject[token];
        if (macro) {
          return _this.formatWithSystemDefault(dt, macro);
        } else {
          return token;
        }
      },
          era = function era(length) {
        return knownEnglish ? eraForDateTime(dt, length) : string({ era: length }, 'era');
      },
          tokenToString = function tokenToString(token) {
        var outputCal = _this.loc.outputCalendar;

        // Where possible: http://cldr.unicode.org/translation/date-time#TOC-Stand-Alone-vs.-Format-Styles
        switch (token) {
          // ms
          case 'S':
            return _this.num(dt.millisecond);
          case 'u':
          // falls through
          case 'SSS':
            return _this.num(dt.millisecond, 3);
          // seconds
          case 's':
            return _this.num(dt.second);
          case 'ss':
            return _this.num(dt.second, 2);
          // minutes
          case 'm':
            return _this.num(dt.minute);
          case 'mm':
            return _this.num(dt.minute, 2);
          // hours
          case 'h':
            return _this.num(dt.hour % 12 === 0 ? 12 : dt.hour % 12);
          case 'hh':
            return _this.num(dt.hour % 12 === 0 ? 12 : dt.hour % 12, 2);
          case 'H':
            return _this.num(dt.hour);
          case 'HH':
            return _this.num(dt.hour, 2);
          // offset
          case 'Z':
            // like +6
            return formatOffset({ format: 'narrow', allowZ: _this.opts.allowZ });
          case 'ZZ':
            // like +06:00
            return formatOffset({ format: 'short', allowZ: _this.opts.allowZ });
          case 'ZZZ':
            // like +0600
            return formatOffset({ format: 'techie', allowZ: false });
          case 'ZZZZ':
            // like EST
            return dt.offsetNameShort;
          case 'ZZZZZ':
            // like Eastern Standard Time
            return dt.offsetNameLong;
          // zone
          case 'z':
            // like America/New_York
            return dt.zoneName;
          // meridiems
          case 'a':
            return meridiem();
          // dates
          case 'd':
            return outputCal ? string({ day: 'numeric' }, 'day') : _this.num(dt.day);
          case 'dd':
            return outputCal ? string({ day: '2-digit' }, 'day') : _this.num(dt.day, 2);
          // weekdays - standalone
          case 'c':
            // like 1
            return _this.num(dt.weekday);
          case 'ccc':
            // like 'Tues'
            return weekday('short', true);
          case 'cccc':
            // like 'Tuesday'
            return weekday('long', true);
          case 'ccccc':
            // like 'T'
            return weekday('narrow', true);
          // weekdays - format
          case 'E':
            // like 1
            return _this.num(dt.weekday);
          case 'EEE':
            // like 'Tues'
            return weekday('short', false);
          case 'EEEE':
            // like 'Tuesday'
            return weekday('long', false);
          case 'EEEEE':
            // like 'T'
            return weekday('narrow', false);
          // months - standalone
          case 'L':
            // like 1
            return outputCal ? string({ month: 'numeric', day: 'numeric' }, 'month') : _this.num(dt.month);
          case 'LL':
            // like 01, doesn't seem to work
            return outputCal ? string({ month: '2-digit', day: 'numeric' }, 'month') : _this.num(dt.month, 2);
          case 'LLL':
            // like Jan
            return month('short', true);
          case 'LLLL':
            // like January
            return month('long', true);
          case 'LLLLL':
            // like J
            return month('narrow', true);
          // months - format
          case 'M':
            // like 1
            return outputCal ? string({ month: 'numeric' }, 'month') : _this.num(dt.month);
          case 'MM':
            // like 01
            return outputCal ? string({ month: '2-digit' }, 'month') : _this.num(dt.month, 2);
          case 'MMM':
            // like Jan
            return month('short', false);
          case 'MMMM':
            // like January
            return month('long', false);
          case 'MMMMM':
            // like J
            return month('narrow', false);
          // years
          case 'y':
            // like 2014
            return outputCal ? string({ year: 'numeric' }, 'year') : _this.num(dt.year);
          case 'yy':
            // like 14
            return outputCal ? string({ year: '2-digit' }, 'year') : _this.num(dt.year.toString().slice(-2), 2);
          case 'yyyy':
            // like 0012
            return outputCal ? string({ year: 'numeric' }, 'year') : _this.num(dt.year, 4);
          case 'yyyyyy':
            // like 000012
            return outputCal ? string({ year: 'numeric' }, 'year') : _this.num(dt.year, 6);
          // eras
          case 'G':
            // like AD
            return era('short');
          case 'GG':
            // like Anno Domini
            return era('long');
          case 'GGGGG':
            return era('narrow');
          case 'kk':
            return _this.num(dt.weekYear.toString().slice(-2), 2);
          case 'kkkk':
            return _this.num(dt.weekYear, 4);
          case 'W':
            return _this.num(dt.weekNumber);
          case 'WW':
            return _this.num(dt.weekNumber, 2);
          case 'o':
            return _this.num(dt.ordinal);
          case 'ooo':
            return _this.num(dt.ordinal, 3);
          case 'q':
            // like 1
            return _this.num(dt.quarter);
          case 'qq':
            // like 01
            return _this.num(dt.quarter, 2);
          default:
            return maybeMacro(token);
        }
      };

      return stringifyTokens(Formatter.parseFormat(fmt), tokenToString);
    };

    Formatter.prototype.formatDurationFromString = function formatDurationFromString(dur, fmt) {
      var _this2 = this;

      var tokenToField = function tokenToField(token) {
        switch (token[0]) {
          case 'S':
            return 'millisecond';
          case 's':
            return 'second';
          case 'm':
            return 'minute';
          case 'h':
            return 'hour';
          case 'd':
            return 'day';
          case 'M':
            return 'month';
          case 'y':
            return 'year';
          default:
            return null;
        }
      },
          tokenToString = function tokenToString(lildur) {
        return function (token) {
          var mapped = tokenToField(token);
          if (mapped) {
            return _this2.num(lildur.get(mapped), token.length);
          } else {
            return token;
          }
        };
      },
          tokens = Formatter.parseFormat(fmt),
          realTokens = tokens.reduce(function (found, _ref2) {
        var literal = _ref2.literal,
            val = _ref2.val;
        return literal ? found : found.concat(val);
      }, []),
          collapsed = dur.shiftTo.apply(dur, realTokens.map(tokenToField).filter(function (t) {
        return t;
      }));
      return stringifyTokens(tokens, tokenToString(collapsed));
    };

    return Formatter;
  }();

  var sysLocaleCache = null;
  function systemLocale() {
    if (sysLocaleCache) {
      return sysLocaleCache;
    } else if (hasIntl()) {
      var computedSys = new Intl.DateTimeFormat().resolvedOptions().locale;
      // node sometimes defaults to "und". Override that because that is dumb
      sysLocaleCache = computedSys === 'und' ? 'en-US' : computedSys;
      return sysLocaleCache;
    } else {
      sysLocaleCache = 'en-US';
      return sysLocaleCache;
    }
  }

  function intlConfigString(locale, numberingSystem, outputCalendar) {
    if (hasIntl()) {
      locale = Array.isArray(locale) ? locale : [locale];

      if (outputCalendar || numberingSystem) {
        locale = locale.map(function (l) {
          l += '-u';

          if (outputCalendar) {
            l += '-ca-' + outputCalendar;
          }

          if (numberingSystem) {
            l += '-nu-' + numberingSystem;
          }
          return l;
        });
      }
      return locale;
    } else {
      return [];
    }
  }

  function mapMonths(f) {
    var ms = [];
    for (var i = 1; i <= 12; i++) {
      var dt = DateTime.utc(2016, i, 1);
      ms.push(f(dt));
    }
    return ms;
  }

  function mapWeekdays(f) {
    var ms = [];
    for (var i = 1; i <= 7; i++) {
      var dt = DateTime.utc(2016, 11, 13 + i);
      ms.push(f(dt));
    }
    return ms;
  }

  function listStuff(loc, length, defaultOK, englishFn, intlFn) {
    var mode = loc.listingMode(defaultOK);

    if (mode === 'error') {
      return null;
    } else if (mode === 'en') {
      return englishFn(length);
    } else {
      return intlFn(length);
    }
  }

  function supportsFastNumbers(loc) {
    if (loc.numberingSystem && loc.numberingSystem !== 'latn') {
      return false;
    } else {
      return loc.numberingSystem === 'latn' || !loc.locale || loc.locale.startsWith('en') || hasIntl() && Intl.DateTimeFormat(loc.intl).resolvedOptions().numberingSystem === 'latn';
    }
  }

  /**
   * @private
   */

  var SimpleNumberFormatter = function () {
    function SimpleNumberFormatter(opts) {
      classCallCheck(this, SimpleNumberFormatter);

      this.padTo = opts.padTo || 0;
      this.round = opts.round || false;
    }

    SimpleNumberFormatter.prototype.format = function format(i) {
      // to match the browser's numberformatter defaults
      var digits = this.round ? 0 : 3,
          rounded = roundTo(i, digits);
      return padStart(rounded, this.padTo);
    };

    return SimpleNumberFormatter;
  }();

  /**
   * @private
   */

  var PolyDateFormatter = function () {
    function PolyDateFormatter(dt, intl, opts) {
      classCallCheck(this, PolyDateFormatter);

      this.opts = opts;
      this.hasIntl = hasIntl();

      var z = void 0;
      if (dt.zone.universal && this.hasIntl) {
        // Chromium doesn't support fixed-offset zones like Etc/GMT+8 in its formatter,
        // See https://bugs.chromium.org/p/chromium/issues/detail?id=364374.
        // So we have to make do. Two cases:
        // 1. The format options tell us to show the zone. We can't do that, so the best
        // we can do is format the date in UTC.
        // 2. The format options don't tell us to show the zone. Then we can adjust them
        // the time and tell the formatter to show it to us in UTC, so that the time is right
        // and the bad zone doesn't show up.
        // We can clean all this up when Chrome fixes this.
        z = 'UTC';
        if (opts.timeZoneName) {
          this.dt = dt;
        } else {
          this.dt = dt.offset === 0 ? dt : DateTime.fromMillis(dt.ts + dt.offset * 60 * 1000);
        }
      } else if (dt.zone.type === 'local') {
        this.dt = dt;
      } else {
        this.dt = dt;
        z = dt.zone.name;
      }

      if (this.hasIntl) {
        var realIntlOpts = Object.assign({}, this.opts);
        if (z) {
          realIntlOpts.timeZone = z;
        }
        this.dtf = new Intl.DateTimeFormat(intl, realIntlOpts);
      }
    }

    PolyDateFormatter.prototype.format = function format() {
      if (this.hasIntl) {
        return this.dtf.format(this.dt.toJSDate());
      } else {
        var tokenFormat = formatString(this.opts),
            loc = Locale.create('en-US');
        return Formatter.create(loc).formatDateTimeFromString(this.dt, tokenFormat);
      }
    };

    PolyDateFormatter.prototype.formatToParts = function formatToParts() {
      if (this.hasIntl && hasFormatToParts()) {
        return this.dtf.formatToParts(this.dt.toJSDate());
      } else {
        // This is kind of a cop out. We actually could do this for English. However, we couldn't do it for intl strings
        // and IMO it's too weird to have an uncanny valley like that
        return [];
      }
    };

    PolyDateFormatter.prototype.resolvedOptions = function resolvedOptions() {
      if (this.hasIntl) {
        return this.dtf.resolvedOptions();
      } else {
        return {
          locale: 'en-US',
          numberingSystem: 'latn',
          outputCalendar: 'gregory'
        };
      }
    };

    return PolyDateFormatter;
  }();

  /**
   * @private
   */

  var Locale = function () {
    Locale.fromOpts = function fromOpts(opts) {
      return Locale.create(opts.locale, opts.numberingSystem, opts.outputCalendar, opts.defaultToEN);
    };

    Locale.create = function create(locale, numberingSystem, outputCalendar) {
      var defaultToEN = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : false;

      var specifiedLocale = locale || Settings.defaultLocale,

      // the system locale is useful for human readable strings but annoying for parsing/formatting known formats
      localeR = specifiedLocale || (defaultToEN ? 'en-US' : systemLocale()),
          numberingSystemR = numberingSystem || Settings.defaultNumberingSystem,
          outputCalendarR = outputCalendar || Settings.defaultOutputCalendar;
      return new Locale(localeR, numberingSystemR, outputCalendarR, specifiedLocale);
    };

    Locale.resetCache = function resetCache() {
      sysLocaleCache = null;
    };

    Locale.fromObject = function fromObject() {
      var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          locale = _ref.locale,
          numberingSystem = _ref.numberingSystem,
          outputCalendar = _ref.outputCalendar;

      return Locale.create(locale, numberingSystem, outputCalendar);
    };

    function Locale(locale, numbering, outputCalendar, specifiedLocale) {
      classCallCheck(this, Locale);

      this.locale = locale;
      this.numberingSystem = numbering;
      this.outputCalendar = outputCalendar;
      this.intl = intlConfigString(this.locale, this.numberingSystem, this.outputCalendar);

      this.weekdaysCache = { format: {}, standalone: {} };
      this.monthsCache = { format: {}, standalone: {} };
      this.meridiemCache = null;
      this.eraCache = {};

      this.specifiedLocale = specifiedLocale;
      this.fastNumbersCached = null;
    }

    // todo: cache me
    Locale.prototype.listingMode = function listingMode() {
      var defaultOK = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

      var intl = hasIntl(),
          hasFTP = intl && hasFormatToParts(),
          isActuallyEn = this.locale === 'en' || this.locale.toLowerCase() === 'en-us' || intl && Intl.DateTimeFormat(this.intl).resolvedOptions().locale.startsWith('en-us'),
          hasNoWeirdness = (this.numberingSystem === null || this.numberingSystem === 'latn') && (this.outputCalendar === null || this.outputCalendar === 'gregory');

      if (!hasFTP && !(isActuallyEn && hasNoWeirdness) && !defaultOK) {
        return 'error';
      } else if (!hasFTP || isActuallyEn && hasNoWeirdness) {
        return 'en';
      } else {
        return 'intl';
      }
    };

    Locale.prototype.clone = function clone(alts) {
      if (!alts || Object.getOwnPropertyNames(alts).length === 0) {
        return this;
      } else {
        return Locale.create(alts.locale || this.specifiedLocale, alts.numberingSystem || this.numberingSystem, alts.outputCalendar || this.outputCalendar, alts.defaultToEN || false);
      }
    };

    Locale.prototype.redefaultToEN = function redefaultToEN() {
      var alts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      return this.clone(Object.assign({}, alts, { defaultToEN: true }));
    };

    Locale.prototype.redefaultToSystem = function redefaultToSystem() {
      var alts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      return this.clone(Object.assign({}, alts, { defaultToEN: false }));
    };

    Locale.prototype.months = function months$$1(length) {
      var _this = this;

      var format = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
      var defaultOK = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

      return listStuff(this, length, defaultOK, months, function () {
        var intl = format ? { month: length, day: 'numeric' } : { month: length },
            formatStr = format ? 'format' : 'standalone';
        if (!_this.monthsCache[formatStr][length]) {
          _this.monthsCache[formatStr][length] = mapMonths(function (dt) {
            return _this.extract(dt, intl, 'month');
          });
        }
        return _this.monthsCache[formatStr][length];
      });
    };

    Locale.prototype.weekdays = function weekdays$$1(length) {
      var _this2 = this;

      var format = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;
      var defaultOK = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : true;

      return listStuff(this, length, defaultOK, weekdays, function () {
        var intl = format ? { weekday: length, year: 'numeric', month: 'long', day: 'numeric' } : { weekday: length },
            formatStr = format ? 'format' : 'standalone';
        if (!_this2.weekdaysCache[formatStr][length]) {
          _this2.weekdaysCache[formatStr][length] = mapWeekdays(function (dt) {
            return _this2.extract(dt, intl, 'weekday');
          });
        }
        return _this2.weekdaysCache[formatStr][length];
      });
    };

    Locale.prototype.meridiems = function meridiems$$1() {
      var _this3 = this;

      var defaultOK = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : true;

      return listStuff(this, undefined, defaultOK, function () {
        return meridiems;
      }, function () {
        // In theory there could be aribitrary day periods. We're gonna assume there are exactly two
        // for AM and PM. This is probably wrong, but it's makes parsing way easier.
        if (!_this3.meridiemCache) {
          var intl = { hour: 'numeric', hour12: true };
          _this3.meridiemCache = [DateTime.utc(2016, 11, 13, 9), DateTime.utc(2016, 11, 13, 19)].map(function (dt) {
            return _this3.extract(dt, intl, 'dayperiod');
          });
        }

        return _this3.meridiemCache;
      });
    };

    Locale.prototype.eras = function eras$$1(length) {
      var _this4 = this;

      var defaultOK = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : true;

      return listStuff(this, length, defaultOK, eras, function () {
        var intl = { era: length };

        // This is utter bullshit. Different calendars are going to define eras totally differently. What I need is the minimum set of dates
        // to definitely enumerate them.
        if (!_this4.eraCache[length]) {
          _this4.eraCache[length] = [DateTime.utc(-40, 1, 1), DateTime.utc(2017, 1, 1)].map(function (dt) {
            return _this4.extract(dt, intl, 'era');
          });
        }

        return _this4.eraCache[length];
      });
    };

    Locale.prototype.extract = function extract(dt, intlOpts, field) {
      var df = this.dtFormatter(dt, intlOpts),
          results = df.formatToParts(),
          matching = results.find(function (m) {
        return m.type.toLowerCase() === field;
      });

      return matching ? matching.value : null;
    };

    Locale.prototype.numberFormatter = function numberFormatter() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      // this option is never used (the only caller short-circuits on it, but it seems safer to leave)
      // (in contrast, the || is used heavily)
      if (opts.forceSimple || this.fastNumbers) {
        return new SimpleNumberFormatter(opts);
      } else if (hasIntl()) {
        var intlOpts = { useGrouping: false };

        if (opts.padTo > 0) {
          intlOpts.minimumIntegerDigits = opts.padTo;
        }

        if (opts.round) {
          intlOpts.maximumFractionDigits = 0;
        }

        return new Intl.NumberFormat(this.intl, intlOpts);
      } else {
        return new SimpleNumberFormatter(opts);
      }
    };

    Locale.prototype.dtFormatter = function dtFormatter(dt) {
      var intlOpts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return new PolyDateFormatter(dt, this.intl, intlOpts);
    };

    Locale.prototype.equals = function equals(other) {
      return this.locale === other.locale && this.numberingSystem === other.numberingSystem && this.outputCalendar === other.outputCalendar;
    };

    createClass(Locale, [{
      key: 'fastNumbers',
      get: function get$$1() {
        if (this.fastNumbersCached !== null) {
          this.fastNumbersCached = supportsFastNumbers(this);
        }

        return this.fastNumbersCached;
      }
    }]);
    return Locale;
  }();

  /*
   * This file handles parsing for well-specified formats. Here's how it works:
   * Two things go into parsing: a regex to match with and an extractor to take apart the groups in the match.
   * An extractor is just a function that takes a regex match array and returns a { year: ..., month: ... } object
   * parse() does the work of executing the regex and applying the extractor. It takes multiple regex/extractor pairs to try in sequence.
   * Extractors can take a "cursor" representing the offset in the match to look at. This makes it easy to combine extractors.
   * combineExtractors() does the work of combining them, keeping track of the cursor through multiple extractions.
   * Some extractions are super dumb and simpleParse and fromStrings help DRY them.
   */

  function combineRegexes() {
    for (var _len = arguments.length, regexes = Array(_len), _key = 0; _key < _len; _key++) {
      regexes[_key] = arguments[_key];
    }

    var full = regexes.reduce(function (f, r) {
      return f + r.source;
    }, '');
    return RegExp('^' + full + '$');
  }

  function combineExtractors() {
    for (var _len2 = arguments.length, extractors = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
      extractors[_key2] = arguments[_key2];
    }

    return function (m) {
      return extractors.reduce(function (_ref, ex) {
        var mergedVals = _ref[0],
            mergedZone = _ref[1],
            cursor = _ref[2];

        var _ex = ex(m, cursor),
            val = _ex[0],
            zone = _ex[1],
            next = _ex[2];

        return [Object.assign(mergedVals, val), mergedZone || zone, next];
      }, [{}, null, 1]).slice(0, 2);
    };
  }

  function parse(s) {
    if (s == null) {
      return [null, null];
    }

    for (var _len3 = arguments.length, patterns = Array(_len3 > 1 ? _len3 - 1 : 0), _key3 = 1; _key3 < _len3; _key3++) {
      patterns[_key3 - 1] = arguments[_key3];
    }

    for (var _iterator = patterns, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
      var _ref3;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref3 = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref3 = _i.value;
      }

      var _ref2 = _ref3;
      var regex = _ref2[0];
      var extractor = _ref2[1];

      var m = regex.exec(s);
      if (m) {
        return extractor(m);
      }
    }
    return [null, null];
  }

  function simpleParse() {
    for (var _len4 = arguments.length, keys = Array(_len4), _key4 = 0; _key4 < _len4; _key4++) {
      keys[_key4] = arguments[_key4];
    }

    return function (match, cursor) {
      var ret = {};
      var i = void 0;

      for (i = 0; i < keys.length; i++) {
        ret[keys[i]] = parseInt(match[cursor + i]);
      }
      return [ret, null, cursor + i];
    };
  }

  // ISO and SQL parsing
  var offsetRegex = /(?:(Z)|([+-]\d\d)(?::?(\d\d))?)/,
      isoTimeBaseRegex = /(\d\d)(?::?(\d\d)(?::?(\d\d)(?:[.,](\d{1,9}))?)?)?/,
      isoTimeRegex = RegExp('' + isoTimeBaseRegex.source + offsetRegex.source + '?'),
      isoTimeExtensionRegex = RegExp('(?:T' + isoTimeRegex.source + ')?'),
      isoYmdRegex = /([+-]\d{6}|\d{4})(?:-?(\d\d)(?:-?(\d\d))?)?/,
      isoWeekRegex = /(\d{4})-?W(\d\d)-?(\d)/,
      isoOrdinalRegex = /(\d{4})-?(\d{3})/,
      extractISOWeekData = simpleParse('weekYear', 'weekNumber', 'weekDay'),
      extractISOOrdinalData = simpleParse('year', 'ordinal'),
      sqlYmdRegex = /(\d{4})-(\d\d)-(\d\d)/,
      // dumbed-down version of the ISO one
  sqlTimeRegex = RegExp(isoTimeBaseRegex.source + ' ?(?:' + offsetRegex.source + '|([a-zA-Z_]{1,256}/[a-zA-Z_]{1,256}))?'),
      sqlTimeExtensionRegex = RegExp('(?: ' + sqlTimeRegex.source + ')?');

  function extractISOYmd(match, cursor) {
    var item = {
      year: parseInt(match[cursor]),
      month: parseInt(match[cursor + 1]) || 1,
      day: parseInt(match[cursor + 2]) || 1
    };

    return [item, null, cursor + 3];
  }

  function extractISOTime(match, cursor) {
    var item = {
      hour: parseInt(match[cursor]) || 0,
      minute: parseInt(match[cursor + 1]) || 0,
      second: parseInt(match[cursor + 2]) || 0,
      millisecond: parseMillis(match[cursor + 3])
    };

    return [item, null, cursor + 4];
  }

  function extractISOOffset(match, cursor) {
    var local = !match[cursor] && !match[cursor + 1],
        fullOffset = signedOffset(match[cursor + 1], match[cursor + 2]),
        zone = local ? null : FixedOffsetZone.instance(fullOffset);
    return [{}, zone, cursor + 3];
  }

  function extractIANAZone(match, cursor) {
    var zone = match[cursor] ? new IANAZone(match[cursor]) : null;
    return [{}, zone, cursor + 1];
  }

  // ISO duration parsing

  var isoDuration = /^P(?:(?:(\d{1,9})Y)?(?:(\d{1,9})M)?(?:(\d{1,9})D)?(?:T(?:(\d{1,9})H)?(?:(\d{1,9})M)?(?:(\d{1,9})(?:[.,](\d{1,9}))?S)?)?|(\d{1,9})W)$/;

  function extractISODuration(match) {
    var yearStr = match[1],
        monthStr = match[2],
        dayStr = match[3],
        hourStr = match[4],
        minuteStr = match[5],
        secondStr = match[6],
        millisecondsStr = match[7],
        weekStr = match[8];


    return [{
      years: parseInt(yearStr),
      months: parseInt(monthStr),
      weeks: parseInt(weekStr),
      days: parseInt(dayStr),
      hours: parseInt(hourStr),
      minutes: parseInt(minuteStr),
      seconds: parseInt(secondStr),
      milliseconds: parseMillis(millisecondsStr)
    }];
  }

  // These are a little braindead. EDT *should* tell us that we're in, say, America/New_York
  // and not just that we're in -240 *right now*. But since I don't think these are used that often
  // I'm just going to ignore that
  var obsOffsets = {
    GMT: 0,
    EDT: -4 * 60,
    EST: -5 * 60,
    CDT: -5 * 60,
    CST: -6 * 60,
    MDT: -6 * 60,
    MST: -7 * 60,
    PDT: -7 * 60,
    PST: -8 * 60
  };

  function fromStrings(weekdayStr, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr) {
    var result = {
      year: yearStr.length === 2 ? untruncateYear(parseInt(yearStr)) : parseInt(yearStr),
      month: monthStr.length === 2 ? parseInt(monthStr, 10) : monthsShort.indexOf(monthStr) + 1,
      day: parseInt(dayStr),
      hour: parseInt(hourStr),
      minute: parseInt(minuteStr)
    };

    if (secondStr) result.second = parseInt(secondStr);
    if (weekdayStr) {
      result.weekday = weekdayStr.length > 3 ? weekdaysLong.indexOf(weekdayStr) + 1 : weekdaysShort.indexOf(weekdayStr) + 1;
    }

    return result;
  }

  // RFC 2822/5322
  var rfc2822 = /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|(?:([+-]\d\d)(\d\d)))$/;

  function extractRFC2822(match) {
    var weekdayStr = match[1],
        dayStr = match[2],
        monthStr = match[3],
        yearStr = match[4],
        hourStr = match[5],
        minuteStr = match[6],
        secondStr = match[7],
        obsOffset = match[8],
        milOffset = match[9],
        offHourStr = match[10],
        offMinuteStr = match[11],
        result = fromStrings(weekdayStr, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr);


    var offset = void 0;
    if (obsOffset) {
      offset = obsOffsets[obsOffset];
    } else if (milOffset) {
      offset = 0;
    } else {
      offset = signedOffset(offHourStr, offMinuteStr);
    }

    return [result, new FixedOffsetZone(offset)];
  }

  function preprocessRFC2822(s) {
    // Remove comments and folding whitespace and replace multiple-spaces with a single space
    return s.replace(/\([^)]*\)|[\n\t]/g, ' ').replace(/(\s\s+)/g, ' ').trim();
  }

  // http date

  var rfc1123 = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d\d) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d\d):(\d\d):(\d\d) GMT$/,
      rfc850 = /^(Monday|Tuesday|Wedsday|Thursday|Friday|Saturday|Sunday), (\d\d)-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d\d) (\d\d):(\d\d):(\d\d) GMT$/,
      ascii = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ( \d|\d\d) (\d\d):(\d\d):(\d\d) (\d{4})$/;

  function extractRFC1123Or850(match) {
    var weekdayStr = match[1],
        dayStr = match[2],
        monthStr = match[3],
        yearStr = match[4],
        hourStr = match[5],
        minuteStr = match[6],
        secondStr = match[7],
        result = fromStrings(weekdayStr, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr);

    return [result, FixedOffsetZone.utcInstance];
  }

  function extractASCII(match) {
    var weekdayStr = match[1],
        monthStr = match[2],
        dayStr = match[3],
        hourStr = match[4],
        minuteStr = match[5],
        secondStr = match[6],
        yearStr = match[7],
        result = fromStrings(weekdayStr, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr);

    return [result, FixedOffsetZone.utcInstance];
  }

  /**
   * @private
   */

  function parseISODate(s) {
    return parse(s, [combineRegexes(isoYmdRegex, isoTimeExtensionRegex), combineExtractors(extractISOYmd, extractISOTime, extractISOOffset)], [combineRegexes(isoWeekRegex, isoTimeExtensionRegex), combineExtractors(extractISOWeekData, extractISOTime, extractISOOffset)], [combineRegexes(isoOrdinalRegex, isoTimeExtensionRegex), combineExtractors(extractISOOrdinalData, extractISOTime)], [combineRegexes(isoTimeRegex), combineExtractors(extractISOTime, extractISOOffset)]);
  }

  function parseRFC2822Date(s) {
    return parse(preprocessRFC2822(s), [rfc2822, extractRFC2822]);
  }

  function parseHTTPDate(s) {
    return parse(s, [rfc1123, extractRFC1123Or850], [rfc850, extractRFC1123Or850], [ascii, extractASCII]);
  }

  function parseISODuration(s) {
    return parse(s, [isoDuration, extractISODuration]);
  }

  function parseSQL(s) {
    return parse(s, [combineRegexes(sqlYmdRegex, sqlTimeExtensionRegex), combineExtractors(extractISOYmd, extractISOTime, extractISOOffset, extractIANAZone)], [combineRegexes(sqlTimeRegex), combineExtractors(extractISOTime, extractISOOffset, extractIANAZone)]);
  }

  var INVALID = 'Invalid Duration',
      UNPARSABLE = 'unparsable';

  // unit conversion constants
  var lowOrderMatrix = {
    weeks: {
      days: 7,
      hours: 7 * 24,
      minutes: 7 * 24 * 60,
      seconds: 7 * 24 * 60 * 60,
      milliseconds: 7 * 24 * 60 * 60 * 1000
    },
    days: {
      hours: 24,
      minutes: 24 * 60,
      seconds: 24 * 60 * 60,
      milliseconds: 24 * 60 * 60 * 1000
    },
    hours: { minutes: 60, seconds: 60 * 60, milliseconds: 60 * 60 * 1000 },
    minutes: { seconds: 60, milliseconds: 60 * 1000 },
    seconds: { milliseconds: 1000 }
  },
      casualMatrix = Object.assign({
    years: {
      months: 12,
      weeks: 52,
      days: 365,
      hours: 365 * 24,
      minutes: 365 * 24 * 60,
      seconds: 365 * 24 * 60 * 60,
      milliseconds: 365 * 24 * 60 * 60 * 1000
    },
    quarters: {
      months: 3,
      weeks: 13,
      days: 91,
      hours: 91 * 24,
      minutes: 91 * 24 * 60,
      milliseconds: 91 * 24 * 60 * 60 * 1000
    },
    months: {
      weeks: 4,
      days: 30,
      hours: 30 * 24,
      minutes: 30 * 24 * 60,
      seconds: 30 * 24 * 60 * 60,
      milliseconds: 30 * 24 * 60 * 60 * 1000
    }
  }, lowOrderMatrix),
      daysInYearAccurate = 146097.0 / 400,
      daysInMonthAccurate = 146097.0 / 4800,
      accurateMatrix = Object.assign({
    years: {
      months: 12,
      weeks: daysInYearAccurate / 7,
      days: daysInYearAccurate,
      hours: daysInYearAccurate * 24,
      minutes: daysInYearAccurate * 24 * 60,
      seconds: daysInYearAccurate * 24 * 60 * 60,
      milliseconds: daysInYearAccurate * 24 * 60 * 60 * 1000
    },
    quarters: {
      months: 3,
      weeks: daysInYearAccurate / 28,
      days: daysInYearAccurate / 4,
      hours: daysInYearAccurate * 24 / 4,
      minutes: daysInYearAccurate * 24 * 60 / 4,
      seconds: daysInYearAccurate * 24 * 60 * 60 / 4,
      milliseconds: daysInYearAccurate * 24 * 60 * 60 * 1000 / 4
    },
    months: {
      weeks: daysInMonthAccurate / 7,
      days: daysInMonthAccurate,
      hours: daysInMonthAccurate * 24,
      minutes: daysInMonthAccurate * 24 * 60,
      seconds: daysInMonthAccurate * 24 * 60 * 60,
      milliseconds: daysInMonthAccurate * 24 * 60 * 60 * 1000
    }
  }, lowOrderMatrix);

  // units ordered by size
  var orderedUnits = ['years', 'quarters', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'];

  var reverseUnits = orderedUnits.slice(0).reverse();

  // clone really means "create another instance just like this one, but with these changes"
  function clone(dur, alts) {
    var clear = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;

    // deep merge for vals
    var conf = {
      values: clear ? alts.values : Object.assign({}, dur.values, alts.values || {}),
      loc: dur.loc.clone(alts.loc),
      conversionAccuracy: alts.conversionAccuracy || dur.conversionAccuracy
    };
    return new Duration(conf);
  }

  // some functions really care about the absolute value of a duration, so combined with
  // normalize() this tells us whether this duration is positive or negative
  function isHighOrderNegative(obj) {
    // only rule is that the highest-order part must be non-negative
    for (var _iterator = orderedUnits, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
      var _ref;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref = _i.value;
      }

      var k = _ref;

      if (obj[k]) return obj[k] < 0;
    }
    return false;
  }

  // NB: mutates parameters
  function convert(matrix, fromMap, fromUnit, toMap, toUnit) {
    var conv = matrix[toUnit][fromUnit],
        added = Math.floor(fromMap[fromUnit] / conv);
    toMap[toUnit] += added;
    fromMap[fromUnit] -= added * conv;
  }

  // NB: mutates parameters
  function normalizeValues(matrix, vals) {
    reverseUnits.reduce(function (previous, current) {
      if (!isUndefined(vals[current])) {
        if (previous) {
          convert(matrix, vals, previous, vals, current);
        }
        return current;
      } else {
        return previous;
      }
    }, null);
  }

  /**
   * @private
   */
  function friendlyDuration(duration) {
    if (isNumber(duration)) {
      return Duration.fromMillis(duration);
    } else if (duration instanceof Duration) {
      return duration;
    } else if (duration instanceof Object) {
      return Duration.fromObject(duration);
    } else {
      throw new InvalidArgumentError('Unknown duration argument');
    }
  }

  /**
   * A Duration object represents a period of time, like "2 months" or "1 day, 1 hour". Conceptually, it's just a map of units to their quantities, accompanied by some additional configuration and methods for creating, parsing, interrogating, transforming, and formatting them. They can be used on their own or in conjunction with other Luxon types; for example, you can use {@link DateTime.plus} to add a Duration object to a DateTime, producing another DateTime.
   *
   * Here is a brief overview of commonly used methods and getters in Duration:
   *
   * * **Creation** To create a Duration, use {@link Duration.fromMillis}, {@link Duration.fromObject}, or {@link Duration.fromISO}.
   * * **Unit values** See the {@link years}, {@link months}, {@link weeks}, {@link days}, {@link hours}, {@link minutes}, {@link seconds}, {@link milliseconds} accessors.
   * * **Configuration** See  {@link locale} and {@link numberingSystem} accessors.
   * * **Transformation** To create new Durations out of old ones use {@link plus}, {@link minus}, {@link normalize}, {@link set}, {@link reconfigure}, {@link shiftTo}, and {@link negate}.
   * * **Output** To convert the Duration into other representations, see {@link as}, {@link toISO}, {@link toFormat}, and {@link toJSON}
   *
   * There's are more methods documented below. In addition, for more information on subtler topics like internationalization and validity, see the external documentation.
   */

  var Duration = function () {
    /**
     * @private
     */
    function Duration(config) {
      classCallCheck(this, Duration);

      var accurate = config.conversionAccuracy === 'longterm' || false;
      /**
       * @access private
       */
      this.values = config.values;
      /**
       * @access private
       */
      this.loc = config.loc || Locale.create();
      /**
       * @access private
       */
      this.conversionAccuracy = accurate ? 'longterm' : 'casual';
      /**
       * @access private
       */
      this.invalid = config.invalidReason || null;
      /**
       * @access private
       */
      this.matrix = accurate ? accurateMatrix : casualMatrix;
    }

    /**
     * Create Duration from a number of milliseconds.
     * @param {number} count of milliseconds
     * @param {Object} opts - options for parsing
     * @param {string} [opts.locale='en-US'] - the locale to use
     * @param {string} opts.numberingSystem - the numbering system to use
     * @param {string} [opts.conversionAccuracy='casual'] - the conversion system to use
     * @return {Duration}
     */


    Duration.fromMillis = function fromMillis(count, opts) {
      return Duration.fromObject(Object.assign({ milliseconds: count }, opts));
    };

    /**
     * Create an Duration from a Javascript object with keys like 'years' and 'hours'.
     * @param {Object} obj - the object to create the DateTime from
     * @param {number} obj.years
     * @param {number} obj.quarters
     * @param {number} obj.months
     * @param {number} obj.weeks
     * @param {number} obj.days
     * @param {number} obj.hours
     * @param {number} obj.minutes
     * @param {number} obj.seconds
     * @param {number} obj.milliseconds
     * @param {string} [obj.locale='en-US'] - the locale to use
     * @param {string} obj.numberingSystem - the numbering system to use
     * @param {string} [obj.conversionAccuracy='casual'] - the conversion system to use
     * @return {Duration}
     */


    Duration.fromObject = function fromObject(obj) {
      return new Duration({
        values: normalizeObject(obj, Duration.normalizeUnit, true),
        loc: Locale.fromObject(obj),
        conversionAccuracy: obj.conversionAccuracy
      });
    };

    /**
     * Create a Duration from an ISO 8601 duration string.
     * @param {string} text - text to parse
     * @param {Object} opts - options for parsing
     * @param {string} [opts.locale='en-US'] - the locale to use
     * @param {string} opts.numberingSystem - the numbering system to use
     * @param {string} [opts.conversionAccuracy='casual'] - the conversion system to use
     * @see https://en.wikipedia.org/wiki/ISO_8601#Durations
     * @example Duration.fromISO('P3Y6M4DT12H30M5S').toObject() //=> { years: 3, months: 6, day: 4, hours: 12, minutes: 30, seconds: 5 }
     * @example Duration.fromISO('PT23H').toObject() //=> { hours: 23 }
     * @example Duration.fromISO('P5Y3M').toObject() //=> { years: 5, months: 3 }
     * @return {Duration}
     */


    Duration.fromISO = function fromISO(text, opts) {
      var _parseISODuration = parseISODuration(text),
          parsed = _parseISODuration[0];

      if (parsed) {
        var obj = Object.assign(parsed, opts);
        return Duration.fromObject(obj);
      } else {
        return Duration.invalid(UNPARSABLE);
      }
    };

    /**
     * Create an invalid Duration.
     * @param {string} reason - reason this is invalid
     * @return {Duration}
     */


    Duration.invalid = function invalid(reason) {
      if (!reason) {
        throw new InvalidArgumentError('need to specify a reason the Duration is invalid');
      }
      if (Settings.throwOnInvalid) {
        throw new InvalidDurationError(reason);
      } else {
        return new Duration({ invalidReason: reason });
      }
    };

    /**
     * @private
     */


    Duration.normalizeUnit = function normalizeUnit(unit) {
      var ignoreUnknown = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

      var normalized = {
        year: 'years',
        years: 'years',
        quarter: 'quarters',
        quarters: 'quarters',
        month: 'months',
        months: 'months',
        week: 'weeks',
        weeks: 'weeks',
        day: 'days',
        days: 'days',
        hour: 'hours',
        hours: 'hours',
        minute: 'minutes',
        minutes: 'minutes',
        second: 'seconds',
        seconds: 'seconds',
        millisecond: 'milliseconds',
        milliseconds: 'milliseconds'
      }[unit ? unit.toLowerCase() : unit];

      if (!ignoreUnknown && !normalized) throw new InvalidUnitError(unit);

      return normalized;
    };

    /**
     * Get  the locale of a Duration, such 'en-GB'
     * @type {string}
     */


    /**
     * Returns a string representation of this Duration formatted according to the specified format string.
     * @param {string} fmt - the format string
     * @param {Object} opts - options
     * @param {boolean} opts.round - round numerical values
     * @return {string}
     */
    Duration.prototype.toFormat = function toFormat(fmt) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return this.isValid ? Formatter.create(this.loc, opts).formatDurationFromString(this, fmt) : INVALID;
    };

    /**
     * Returns a Javascript object with this Duration's values.
     * @param opts - options for generating the object
     * @param {boolean} [opts.includeConfig=false] - include configuration attributes in the output
     * @example Duration.fromObject({ years: 1, days: 6, seconds: 2 }).toObject() //=> { years: 1, days: 6, seconds: 2 }
     * @return {Object}
     */


    Duration.prototype.toObject = function toObject() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (!this.isValid) return {};

      var base = Object.assign({}, this.values);

      if (opts.includeConfig) {
        base.conversionAccuracy = this.conversionAccuracy;
        base.numberingSystem = this.loc.numberingSystem;
        base.locale = this.loc.locale;
      }
      return base;
    };

    /**
     * Returns an ISO 8601-compliant string representation of this Duration.
     * @see https://en.wikipedia.org/wiki/ISO_8601#Durations
     * @example Duration.fromObject({ years: 3, seconds: 45 }).toISO() //=> 'P3YT45S'
     * @example Duration.fromObject({ months: 4, seconds: 45 }).toISO() //=> 'P4MT45S'
     * @example Duration.fromObject({ months: 5 }).toISO() //=> 'P5M'
     * @example Duration.fromObject({ minutes: 5 }).toISO() //=> 'PT5M'
     * @return {string}
     */


    Duration.prototype.toISO = function toISO() {
      // we could use the formatter, but this is an easier way to get the minimum string
      if (!this.isValid) return null;

      var s = 'P',
          norm = this.normalize();

      // ISO durations are always positive, so take the absolute value
      norm = isHighOrderNegative(norm.values) ? norm.negate() : norm;

      if (norm.years > 0) s += norm.years + 'Y';
      if (norm.months > 0 || norm.quarters > 0) s += norm.months + norm.quarters * 3 + 'M';
      if (norm.days > 0 || norm.weeks > 0) s += norm.days + norm.weeks * 7 + 'D';
      if (norm.hours > 0 || norm.minutes > 0 || norm.seconds > 0 || norm.milliseconds > 0) s += 'T';
      if (norm.hours > 0) s += norm.hours + 'H';
      if (norm.minutes > 0) s += norm.minutes + 'M';
      if (norm.seconds > 0) s += norm.seconds + 'S';
      return s;
    };

    /**
     * Returns an ISO 8601 representation of this Duration appropriate for use in JSON.
     * @return {string}
     */


    Duration.prototype.toJSON = function toJSON() {
      return this.toISO();
    };

    /**
     * Returns an ISO 8601 representation of this Duration appropriate for use in debugging.
     * @return {string}
     */


    Duration.prototype.toString = function toString() {
      return this.toISO();
    };

    /**
     * Returns a string representation of this Duration appropriate for the REPL.
     * @return {string}
     */


    Duration.prototype.inspect = function inspect() {
      if (this.isValid) {
        var valsInspect = JSON.stringify(this.toObject());
        return 'Duration {\n  values: ' + valsInspect + ',\n  locale: ' + this.locale + ',\n  conversionAccuracy: ' + this.conversionAccuracy + ' }';
      } else {
        return 'Duration { Invalid, reason: ' + this.invalidReason + ' }';
      }
    };

    /**
     * Make this Duration longer by the specified amount. Return a newly-constructed Duration.
     * @param {Duration|Object|number} duration - The amount to add. Either a Luxon Duration, a number of milliseconds, the object argument to Duration.fromObject()
     * @return {Duration}
     */


    Duration.prototype.plus = function plus(duration) {
      if (!this.isValid) return this;

      var dur = friendlyDuration(duration),
          result = {};

      for (var _iterator2 = orderedUnits, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
        var _ref2;

        if (_isArray2) {
          if (_i2 >= _iterator2.length) break;
          _ref2 = _iterator2[_i2++];
        } else {
          _i2 = _iterator2.next();
          if (_i2.done) break;
          _ref2 = _i2.value;
        }

        var k = _ref2;

        var val = dur.get(k) + this.get(k);
        if (val !== 0) {
          result[k] = val;
        }
      }

      return clone(this, { values: result }, true);
    };

    /**
     * Make this Duration shorter by the specified amount. Return a newly-constructed Duration.
     * @param {Duration|Object|number} duration - The amount to subtract. Either a Luxon Duration, a number of milliseconds, the object argument to Duration.fromObject()
     * @return {Duration}
     */


    Duration.prototype.minus = function minus(duration) {
      if (!this.isValid) return this;

      var dur = friendlyDuration(duration);
      return this.plus(dur.negate());
    };

    /**
     * Get the value of unit.
     * @param {string} unit - a unit such as 'minute' or 'day'
     * @example Duration.fromObject({years: 2, days: 3}).years //=> 2
     * @example Duration.fromObject({years: 2, days: 3}).months //=> 0
     * @example Duration.fromObject({years: 2, days: 3}).days //=> 3
     * @return {number}
     */


    Duration.prototype.get = function get$$1(unit) {
      return this[Duration.normalizeUnit(unit)];
    };

    /**
     * "Set" the values of specified units. Return a newly-constructed Duration.
     * @param {Object} values - a mapping of units to numbers
     * @example dur.set({ years: 2017 })
     * @example dur.set({ hours: 8, minutes: 30 })
     * @return {Duration}
     */


    Duration.prototype.set = function set$$1(values) {
      var mixed = Object.assign(this.values, normalizeObject(values, Duration.normalizeUnit));
      return clone(this, { values: mixed });
    };

    /**
     * "Set" the locale and/or numberingSystem.  Returns a newly-constructed Duration.
     * @example dur.reconfigure({ locale: 'en-GB' })
     * @return {Duration}
     */


    Duration.prototype.reconfigure = function reconfigure() {
      var _ref3 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          locale = _ref3.locale,
          numberingSystem = _ref3.numberingSystem,
          conversionAccuracy = _ref3.conversionAccuracy;

      var loc = this.loc.clone({ locale: locale, numberingSystem: numberingSystem }),
          opts = { loc: loc };

      if (conversionAccuracy) {
        opts.conversionAccuracy = conversionAccuracy;
      }

      return clone(this, opts);
    };

    /**
     * Return the length of the duration in the specified unit.
     * @param {string} unit - a unit such as 'minutes' or 'days'
     * @example Duration.fromObject({years: 1}).as('days') //=> 365
     * @example Duration.fromObject({years: 1}).as('months') //=> 12
     * @example Duration.fromObject({hours: 60}).as('days') //=> 2.5
     * @return {number}
     */


    Duration.prototype.as = function as(unit) {
      return this.isValid ? this.shiftTo(unit).get(unit) : NaN;
    };

    /**
     * Reduce this Duration to its canonical representation in its current units.
     * @example Duration.fromObject({ years: 2, days: 5000 }).normalize().toObject() //=> { years: 15, days: 255 }
     * @example Duration.fromObject({ hours: 12, minutes: -45 }).normalize().toObject() //=> { hours: 11, minutes: 15 }
     * @return {Duration}
     */


    Duration.prototype.normalize = function normalize() {
      if (!this.isValid) return this;

      var neg = isHighOrderNegative(this.values),
          vals = (neg ? this.negate() : this).toObject();
      normalizeValues(this.matrix, vals);
      var dur = Duration.fromObject(vals);
      return neg ? dur.negate() : dur;
    };

    /**
     * Convert this Duration into its representation in a different set of units.
     * @example Duration.fromObject({ hours: 1, seconds: 30 }).shiftTo('minutes', 'milliseconds').toObject() //=> { minutes: 60, milliseconds: 30000 }
     * @return {Duration}
     */


    Duration.prototype.shiftTo = function shiftTo() {
      for (var _len = arguments.length, units = Array(_len), _key = 0; _key < _len; _key++) {
        units[_key] = arguments[_key];
      }

      if (!this.isValid) return this;

      if (units.length === 0) {
        return this;
      }

      units = units.map(function (u) {
        return Duration.normalizeUnit(u);
      });

      var built = {},
          accumulated = {},
          vals = this.toObject();
      var lastUnit = void 0;

      normalizeValues(this.matrix, vals);

      for (var _iterator3 = orderedUnits, _isArray3 = Array.isArray(_iterator3), _i3 = 0, _iterator3 = _isArray3 ? _iterator3 : _iterator3[Symbol.iterator]();;) {
        var _ref4;

        if (_isArray3) {
          if (_i3 >= _iterator3.length) break;
          _ref4 = _iterator3[_i3++];
        } else {
          _i3 = _iterator3.next();
          if (_i3.done) break;
          _ref4 = _i3.value;
        }

        var k = _ref4;

        if (units.indexOf(k) >= 0) {
          lastUnit = k;

          var own = 0;

          // anything we haven't boiled down yet should get boiled to this unit
          for (var ak in accumulated) {
            if (accumulated.hasOwnProperty(ak)) {
              own += this.matrix[ak][k] * accumulated[ak];
              accumulated[ak] = 0;
            }
          }

          // plus anything that's already in this unit
          if (isNumber(vals[k])) {
            own += vals[k];
          }

          var i = Math.trunc(own);
          built[k] = i;
          accumulated[k] = own - i;

          // plus anything further down the chain that should be rolled up in to this
          for (var down in vals) {
            if (orderedUnits.indexOf(down) > orderedUnits.indexOf(k)) {
              convert(this.matrix, vals, down, built, k);
            }
          }
          // otherwise, keep it in the wings to boil it later
        } else if (isNumber(vals[k])) {
          accumulated[k] = vals[k];
        }
      }

      // anything leftover becomes the decimal for the last unit
      if (lastUnit) {
        for (var key in accumulated) {
          if (accumulated.hasOwnProperty(key)) {
            if (accumulated[key] > 0) {
              built[lastUnit] += key === lastUnit ? accumulated[key] : accumulated[key] / this.matrix[lastUnit][key];
            }
          }
        }
      }
      return clone(this, { values: built }, true);
    };

    /**
     * Return the negative of this Duration.
     * @example Duration.fromObject({ hours: 1, seconds: 30 }).negate().toObject() //=> { hours: -1, seconds: -30 }
     * @return {Duration}
     */


    Duration.prototype.negate = function negate() {
      if (!this.isValid) return this;
      var negated = {};
      for (var _iterator4 = Object.keys(this.values), _isArray4 = Array.isArray(_iterator4), _i4 = 0, _iterator4 = _isArray4 ? _iterator4 : _iterator4[Symbol.iterator]();;) {
        var _ref5;

        if (_isArray4) {
          if (_i4 >= _iterator4.length) break;
          _ref5 = _iterator4[_i4++];
        } else {
          _i4 = _iterator4.next();
          if (_i4.done) break;
          _ref5 = _i4.value;
        }

        var k = _ref5;

        negated[k] = -this.values[k];
      }
      return clone(this, { values: negated }, true);
    };

    /**
     * Get the years.
     * @type {number}
     */


    /**
     * Equality check
     * Two Durations are equal iff they have the same units and the same values for each unit.
     * @param {Duration} other
     * @return {boolean}
     */
    Duration.prototype.equals = function equals(other) {
      if (!this.isValid || !other.isValid) {
        return false;
      }

      if (!this.loc.equals(other.loc)) {
        return false;
      }

      for (var _iterator5 = orderedUnits, _isArray5 = Array.isArray(_iterator5), _i5 = 0, _iterator5 = _isArray5 ? _iterator5 : _iterator5[Symbol.iterator]();;) {
        var _ref6;

        if (_isArray5) {
          if (_i5 >= _iterator5.length) break;
          _ref6 = _iterator5[_i5++];
        } else {
          _i5 = _iterator5.next();
          if (_i5.done) break;
          _ref6 = _i5.value;
        }

        var u = _ref6;

        if (this.values[u] !== other.values[u]) {
          return false;
        }
      }
      return true;
    };

    createClass(Duration, [{
      key: 'locale',
      get: function get$$1() {
        return this.isValid ? this.loc.locale : null;
      }

      /**
       * Get the numbering system of a Duration, such 'beng'. The numbering system is used when formatting the Duration
       *
       * @type {string}
       */

    }, {
      key: 'numberingSystem',
      get: function get$$1() {
        return this.isValid ? this.loc.numberingSystem : null;
      }
    }, {
      key: 'years',
      get: function get$$1() {
        return this.isValid ? this.values.years || 0 : NaN;
      }

      /**
       * Get the quarters.
       * @type {number}
       */

    }, {
      key: 'quarters',
      get: function get$$1() {
        return this.isValid ? this.values.quarters || 0 : NaN;
      }

      /**
       * Get the months.
       * @type {number}
       */

    }, {
      key: 'months',
      get: function get$$1() {
        return this.isValid ? this.values.months || 0 : NaN;
      }

      /**
       * Get the weeks
       * @type {number}
       */

    }, {
      key: 'weeks',
      get: function get$$1() {
        return this.isValid ? this.values.weeks || 0 : NaN;
      }

      /**
       * Get the days.
       * @type {number}
       */

    }, {
      key: 'days',
      get: function get$$1() {
        return this.isValid ? this.values.days || 0 : NaN;
      }

      /**
       * Get the hours.
       * @type {number}
       */

    }, {
      key: 'hours',
      get: function get$$1() {
        return this.isValid ? this.values.hours || 0 : NaN;
      }

      /**
       * Get the minutes.
       * @type {number}
       */

    }, {
      key: 'minutes',
      get: function get$$1() {
        return this.isValid ? this.values.minutes || 0 : NaN;
      }

      /**
       * Get the seconds.
       * @return {number}
       */

    }, {
      key: 'seconds',
      get: function get$$1() {
        return this.isValid ? this.values.seconds || 0 : NaN;
      }

      /**
       * Get the milliseconds.
       * @return {number}
       */

    }, {
      key: 'milliseconds',
      get: function get$$1() {
        return this.isValid ? this.values.milliseconds || 0 : NaN;
      }

      /**
       * Returns whether the Duration is invalid. Invalid durations are returned by diff operations
       * on invalid DateTimes or Intervals.
       * @return {boolean}
       */

    }, {
      key: 'isValid',
      get: function get$$1() {
        return this.invalidReason === null;
      }

      /**
       * Returns an explanation of why this Duration became invalid, or null if the Duration is valid
       * @return {string}
       */

    }, {
      key: 'invalidReason',
      get: function get$$1() {
        return this.invalid;
      }
    }]);
    return Duration;
  }();

  var INVALID$1 = 'Invalid Interval';

  // checks if the start is equal to or before the end
  function validateStartEnd(start, end) {
    return !!start && !!end && start.isValid && end.isValid && start <= end;
  }

  /**
   * An Interval object represents a half-open interval of time, where each endpoint is a {@link DateTime}. Conceptually, it's a container for those two endpoints, accompanied by methods for creating, parsing, interrogating, comparing, transforming, and formatting them.
   *
   * Here is a brief overview of the most commonly used methods and getters in Interval:
   *
   * * **Creation** To create an Interval, use {@link fromDateTimes}, {@link after}, {@link before}, or {@link fromISO}.
   * * **Accessors** Use {@link start} and {@link end} to get the start and end.
   * * **Interrogation** To analyze the Interval, use {@link count}, {@link length}, {@link hasSame}, {@link contains}, {@link isAfter}, or {@link isBefore}.
   * * **Transformation** To create other Intervals out of this one, use {@link set}, {@link splitAt}, {@link splitBy}, {@link divideEqually}, {@link merge}, {@link xor}, {@link union}, {@link intersection}, or {@link difference}.
   * * **Comparison** To compare this Interval to another one, use {@link equals}, {@link overlaps}, {@link abutsStart}, {@link abutsEnd}, {@link engulfs}
   * * **Output*** To convert the Interval into other representations, see {@link toString}, {@link toISO}, {@link toFormat}, and {@link toDuration}.
   */

  var Interval = function () {
    /**
     * @private
     */
    function Interval(config) {
      classCallCheck(this, Interval);

      /**
       * @access private
       */
      this.s = config.start;
      /**
       * @access private
       */
      this.e = config.end;
      /**
       * @access private
       */
      this.invalid = config.invalidReason || null;
    }

    /**
     * Create an invalid Interval.
     * @return {Interval}
     */


    Interval.invalid = function invalid(reason) {
      if (!reason) {
        throw new InvalidArgumentError('need to specify a reason the DateTime is invalid');
      }
      if (Settings.throwOnInvalid) {
        throw new InvalidIntervalError(reason);
      } else {
        return new Interval({ invalidReason: reason });
      }
    };

    /**
     * Create an Interval from a start DateTime and an end DateTime. Inclusive of the start but not the end.
     * @param {DateTime|Date|Object} start
     * @param {DateTime|Date|Object} end
     * @return {Interval}
     */


    Interval.fromDateTimes = function fromDateTimes(start, end) {
      var builtStart = friendlyDateTime(start),
          builtEnd = friendlyDateTime(end);

      return new Interval({
        start: builtStart,
        end: builtEnd,
        invalidReason: validateStartEnd(builtStart, builtEnd) ? null : 'invalid endpoints'
      });
    };

    /**
     * Create an Interval from a start DateTime and a Duration to extend to.
     * @param {DateTime|Date|Object} start
     * @param {Duration|Object|number} duration - the length of the Interval.
     * @return {Interval}
     */


    Interval.after = function after(start, duration) {
      var dur = friendlyDuration(duration),
          dt = friendlyDateTime(start);
      return Interval.fromDateTimes(dt, dt.plus(dur));
    };

    /**
     * Create an Interval from an end DateTime and a Duration to extend backwards to.
     * @param {DateTime|Date|Object} end
     * @param {Duration|Object|number} duration - the length of the Interval.
     * @return {Interval}
     */


    Interval.before = function before(end, duration) {
      var dur = friendlyDuration(duration),
          dt = friendlyDateTime(end);
      return Interval.fromDateTimes(dt.minus(dur), dt);
    };

    /**
     * Create an Interval from an ISO 8601 string
     * @param {string} string - the ISO string to parse
     * @param {Object} opts - options to pass {@see DateTime.fromISO}
     * @return {Interval}
     */


    Interval.fromISO = function fromISO(string, opts) {
      if (string) {
        var _string$split = string.split(/\//),
            s = _string$split[0],
            e = _string$split[1];

        if (s && e) {
          return Interval.fromDateTimes(DateTime.fromISO(s, opts), DateTime.fromISO(e, opts));
        }
      }
      return Interval.invalid('invalid ISO format');
    };

    /**
     * Returns the start of the Interval
     * @type {DateTime}
     */


    /**
     * Returns the length of the Interval in the specified unit.
     * @param {string} unit - the unit (such as 'hours' or 'days') to return the length in.
     * @return {number}
     */
    Interval.prototype.length = function length() {
      var unit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'milliseconds';

      return this.isValid ? this.toDuration.apply(this, [unit]).get(unit) : NaN;
    };

    /**
     * Returns the count of minutes, hours, days, months, or years included in the Interval, even in part.
     * Unlike {@link length} this counts sections of the calendar, not periods of time, e.g. specifying 'day'
     * asks 'what dates are included in this interval?', not 'how many days long is this interval?'
     * @param {string} [unit='milliseconds'] - the unit of time to count.
     * @return {number}
     */


    Interval.prototype.count = function count() {
      var unit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'milliseconds';

      if (!this.isValid) return NaN;
      var start = this.start.startOf(unit),
          end = this.end.startOf(unit);
      return Math.floor(end.diff(start, unit).get(unit)) + 1;
    };

    /**
     * Returns whether this Interval's start and end are both in the same unit of time
     * @param {string} unit - the unit of time to check sameness on
     * @return {boolean}
     */


    Interval.prototype.hasSame = function hasSame(unit) {
      return this.isValid ? this.e.minus(1).hasSame(this.s, unit) : false;
    };

    /**
     * Return whether this Interval has the same start and end DateTimes.
     * @return {boolean}
     */


    Interval.prototype.isEmpty = function isEmpty() {
      return this.s.valueOf() === this.e.valueOf();
    };

    /**
     * Return whether this Interval's start is after the specified DateTime.
     * @param {DateTime} dateTime
     * @return {boolean}
     */


    Interval.prototype.isAfter = function isAfter(dateTime) {
      if (!this.isValid) return false;
      return this.s > dateTime;
    };

    /**
     * Return whether this Interval's end is before the specified DateTime.
     * @param {DateTime} dateTime
     * @return {boolean}
     */


    Interval.prototype.isBefore = function isBefore(dateTime) {
      if (!this.isValid) return false;
      return this.e <= dateTime;
    };

    /**
     * Return whether this Interval contains the specified DateTime.
     * @param {DateTime} dateTime
     * @return {boolean}
     */


    Interval.prototype.contains = function contains(dateTime) {
      if (!this.isValid) return false;
      return this.s <= dateTime && this.e > dateTime;
    };

    /**
     * "Sets" the start and/or end dates. Returns a newly-constructed Interval.
     * @param {Object} values - the values to set
     * @param {DateTime} values.start - the starting DateTime
     * @param {DateTime} values.end - the ending DateTime
     * @return {Interval}
     */


    Interval.prototype.set = function set$$1() {
      var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          start = _ref.start,
          end = _ref.end;

      if (!this.isValid) return this;
      return Interval.fromDateTimes(start || this.s, end || this.e);
    };

    /**
     * Split this Interval at each of the specified DateTimes
     * @param {...[DateTime]} dateTimes - the unit of time to count.
     * @return {[Interval]}
     */


    Interval.prototype.splitAt = function splitAt() {
      if (!this.isValid) return [];

      for (var _len = arguments.length, dateTimes = Array(_len), _key = 0; _key < _len; _key++) {
        dateTimes[_key] = arguments[_key];
      }

      var sorted = dateTimes.map(friendlyDateTime).sort(),
          results = [];
      var s = this.s,
          i = 0;


      while (s < this.e) {
        var added = sorted[i] || this.e,
            next = +added > +this.e ? this.e : added;
        results.push(Interval.fromDateTimes(s, next));
        s = next;
        i += 1;
      }

      return results;
    };

    /**
     * Split this Interval into smaller Intervals, each of the specified length.
     * Left over time is grouped into a smaller interval
     * @param {Duration|Object|number} duration - The length of each resulting interval.
     * @return {[Interval]}
     */


    Interval.prototype.splitBy = function splitBy(duration) {
      if (!this.isValid) return [];
      var dur = friendlyDuration(duration),
          results = [];
      var s = this.s,
          added = void 0,
          next = void 0;


      while (s < this.e) {
        added = s.plus(dur);
        next = +added > +this.e ? this.e : added;
        results.push(Interval.fromDateTimes(s, next));
        s = next;
      }

      return results;
    };

    /**
     * Split this Interval into the specified number of smaller intervals.
     * @param {number} numberOfParts - The number of Intervals to divide the Interval into.
     * @return {[Interval]}
     */


    Interval.prototype.divideEqually = function divideEqually(numberOfParts) {
      if (!this.isValid) return [];
      return this.splitBy(this.length() / numberOfParts).slice(0, numberOfParts);
    };

    /**
     * Return whether this Interval overlaps with the specified Interval
     * @param {Interval} other
     * @return {boolean}
     */


    Interval.prototype.overlaps = function overlaps(other) {
      return this.e > other.s && this.s < other.e;
    };

    /**
     * Return whether this Interval's end is adjacent to the specified Interval's start.
     * @param {Interval} other
     * @return {boolean}
     */


    Interval.prototype.abutsStart = function abutsStart(other) {
      if (!this.isValid) return false;
      return +this.e === +other.s;
    };

    /**
     * Return whether this Interval's start is adjacent to the specified Interval's end.
     * @param {Interval} other
     * @return {boolean}
     */


    Interval.prototype.abutsEnd = function abutsEnd(other) {
      if (!this.isValid) return false;
      return +other.e === +this.s;
    };

    /**
     * Return whether this Interval engulfs the start and end of the specified Interval.
     * @param {Interval} other
     * @return {boolean}
     */


    Interval.prototype.engulfs = function engulfs(other) {
      if (!this.isValid) return false;
      return this.s <= other.s && this.e >= other.e;
    };

    /**
     * Return whether this Interval has the same start and end as the specified Interval.
     * @param {Interval} other
     * @return {boolean}
     */


    Interval.prototype.equals = function equals(other) {
      return this.s.equals(other.s) && this.e.equals(other.e);
    };

    /**
     * Return an Interval representing the intersection of this Interval and the specified Interval.
     * Specifically, the resulting Interval has the maximum start time and the minimum end time of the two Intervals.
     * Returns null if the intersection is empty, i.e., the intervals don't intersect.
     * @param {Interval} other
     * @return {Interval}
     */


    Interval.prototype.intersection = function intersection(other) {
      if (!this.isValid) return this;
      var s = this.s > other.s ? this.s : other.s,
          e = this.e < other.e ? this.e : other.e;

      if (s > e) {
        return null;
      } else {
        return Interval.fromDateTimes(s, e);
      }
    };

    /**
     * Return an Interval representing the union of this Interval and the specified Interval.
     * Specifically, the resulting Interval has the minimum start time and the maximum end time of the two Intervals.
     * @param {Interval} other
     * @return {Interval}
     */


    Interval.prototype.union = function union(other) {
      if (!this.isValid) return this;
      var s = this.s < other.s ? this.s : other.s,
          e = this.e > other.e ? this.e : other.e;
      return Interval.fromDateTimes(s, e);
    };

    /**
     * Merge an array of Intervals into a equivalent minimal set of Intervals.
     * Combines overlapping and adjacent Intervals.
     * @param {[Interval]} intervals
     * @return {[Interval]}
     */


    Interval.merge = function merge(intervals) {
      var _intervals$sort$reduc = intervals.sort(function (a, b) {
        return a.s - b.s;
      }).reduce(function (_ref2, item) {
        var sofar = _ref2[0],
            current = _ref2[1];

        if (!current) {
          return [sofar, item];
        } else if (current.overlaps(item) || current.abutsStart(item)) {
          return [sofar, current.union(item)];
        } else {
          return [sofar.concat([current]), item];
        }
      }, [[], null]),
          found = _intervals$sort$reduc[0],
          final = _intervals$sort$reduc[1];

      if (final) {
        found.push(final);
      }
      return found;
    };

    /**
     * Return an array of Intervals representing the spans of time that only appear in one of the specified Intervals.
     * @param {[Interval]} intervals
     * @return {[Interval]}
     */


    Interval.xor = function xor(intervals) {
      var _Array$prototype;

      var start = null,
          currentCount = 0;
      var results = [],
          ends = intervals.map(function (i) {
        return [{ time: i.s, type: 's' }, { time: i.e, type: 'e' }];
      }),
          flattened = (_Array$prototype = Array.prototype).concat.apply(_Array$prototype, ends),
          arr = flattened.sort(function (a, b) {
        return a.time - b.time;
      });

      for (var _iterator = arr, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
        var _ref3;

        if (_isArray) {
          if (_i >= _iterator.length) break;
          _ref3 = _iterator[_i++];
        } else {
          _i = _iterator.next();
          if (_i.done) break;
          _ref3 = _i.value;
        }

        var i = _ref3;

        currentCount += i.type === 's' ? 1 : -1;

        if (currentCount === 1) {
          start = i.time;
        } else {
          if (start && +start !== +i.time) {
            results.push(Interval.fromDateTimes(start, i.time));
          }

          start = null;
        }
      }

      return Interval.merge(results);
    };

    /**
     * Return an Interval representing the span of time in this Interval that doesn't overlap with any of the specified Intervals.
     * @param {...Interval} intervals
     * @return {[Interval]}
     */


    Interval.prototype.difference = function difference() {
      var _this = this;

      for (var _len2 = arguments.length, intervals = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        intervals[_key2] = arguments[_key2];
      }

      return Interval.xor([this].concat(intervals)).map(function (i) {
        return _this.intersection(i);
      }).filter(function (i) {
        return i && !i.isEmpty();
      });
    };

    /**
     * Returns a string representation of this Interval appropriate for debugging.
     * @return {string}
     */


    Interval.prototype.toString = function toString() {
      if (!this.isValid) return INVALID$1;
      return '[' + this.s.toISO() + ' \u2013 ' + this.e.toISO() + ')';
    };

    /**
     * Returns a string representation of this Interval appropriate for the REPL.
     * @return {string}
     */


    Interval.prototype.inspect = function inspect() {
      if (this.isValid) {
        return 'Interval {\n  start: ' + this.start.toISO() + ',\n  end: ' + this.end.toISO() + ',\n  zone:   ' + this.start.zone.name + ',\n  locale:   ' + this.start.locale + ' }';
      } else {
        return 'Interval { Invalid, reason: ' + this.invalidReason + ' }';
      }
    };

    /**
     * Returns an ISO 8601-compliant string representation of this Interval.
     * @see https://en.wikipedia.org/wiki/ISO_8601#Time_intervals
     * @param {Object} opts - The same options as {@link DateTime.toISO}
     * @return {string}
     */


    Interval.prototype.toISO = function toISO(opts) {
      if (!this.isValid) return INVALID$1;
      return this.s.toISO(opts) + '/' + this.e.toISO(opts);
    };

    /**
     * Returns a string representation of this Interval formatted according to the specified format string.
     * @param {string} dateFormat - the format string. This string formats the start and end time. See {@link DateTime.toFormat} for details.
     * @param {Object} opts - options
     * @param {string} [opts.separator =  ' – '] - a separator to place between the start and end representations
     * @return {string}
     */


    Interval.prototype.toFormat = function toFormat(dateFormat) {
      var _ref4 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref4$separator = _ref4.separator,
          separator = _ref4$separator === undefined ? ' – ' : _ref4$separator;

      if (!this.isValid) return INVALID$1;
      return '' + this.s.toFormat(dateFormat) + separator + this.e.toFormat(dateFormat);
    };

    /**
     * Return a Duration representing the time spanned by this interval.
     * @param {string|string[]} [unit=['milliseconds']] - the unit or units (such as 'hours' or 'days') to include in the duration.
     * @param {Object} opts - options that affect the creation of the Duration
     * @param {string} [opts.conversionAccuracy='casual'] - the conversion system to use
     * @example Interval.fromDateTimes(dt1, dt2).toDuration().toObject() //=> { milliseconds: 88489257 }
     * @example Interval.fromDateTimes(dt1, dt2).toDuration('days').toObject() //=> { days: 1.0241812152777778 }
     * @example Interval.fromDateTimes(dt1, dt2).toDuration(['hours', 'minutes']).toObject() //=> { hours: 24, minutes: 34.82095 }
     * @example Interval.fromDateTimes(dt1, dt2).toDuration(['hours', 'minutes', 'seconds']).toObject() //=> { hours: 24, minutes: 34, seconds: 49.257 }
     * @example Interval.fromDateTimes(dt1, dt2).toDuration('seconds').toObject() //=> { seconds: 88489.257 }
     * @return {Duration}
     */


    Interval.prototype.toDuration = function toDuration(unit, opts) {
      if (!this.isValid) {
        return Duration.invalid(this.invalidReason);
      }
      return this.e.diff(this.s, unit, opts);
    };

    createClass(Interval, [{
      key: 'start',
      get: function get$$1() {
        return this.isValid ? this.s : null;
      }

      /**
       * Returns the end of the Interval
       * @type {DateTime}
       */

    }, {
      key: 'end',
      get: function get$$1() {
        return this.isValid ? this.e : null;
      }

      /**
       * Returns whether this Interval's end is at least its start, i.e. that the Interval isn't 'backwards'.
       * @type {boolean}
       */

    }, {
      key: 'isValid',
      get: function get$$1() {
        return this.invalidReason === null;
      }

      /**
       * Returns an explanation of why this Interval became invalid, or null if the Interval is valid
       * @type {string}
       */

    }, {
      key: 'invalidReason',
      get: function get$$1() {
        return this.invalid;
      }
    }]);
    return Interval;
  }();

  /**
   * The Info class contains static methods for retrieving general time and date related data. For example, it has methods for finding out if a time zone has a DST, for listing the months in any supported locale, and for discovering which of Luxon features are available in the current environment.
   */

  var Info = function () {
    function Info() {
      classCallCheck(this, Info);
    }

    /**
     * Return whether the specified zone contains a DST.
     * @param {string|Zone} [zone='local'] - Zone to check. Defaults to the environment's local zone.
     * @return {boolean}
     */
    Info.hasDST = function hasDST() {
      var zone = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : Settings.defaultZone;

      var proto = DateTime.local().setZone(zone).set({ month: 12 });

      return !zone.universal && proto.offset !== proto.set({ month: 6 }).offset;
    };

    /**
     * Return whether the specified zone is a valid IANA specifier.
     * @param {string} zone - Zone to check
     * @return {boolean}
     */


    Info.isValidIANAZone = function isValidIANAZone(zone) {
      return !!IANAZone.isValidSpecifier(zone) && IANAZone.isValidZone(zone);
    };

    /**
     * Return an array of standalone month names.
     * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DateTimeFormat
     * @param {string} [length='long'] - the length of the month representation, such as "numeric", "2-digit", "narrow", "short", "long"
     * @param {Object} opts - options
     * @param {string} [opts.locale] - the locale code
     * @param {string} [opts.numberingSystem=null] - the numbering system
     * @param {string} [opts.outputCalendar='gregory'] - the calendar
     * @example Info.months()[0] //=> 'January'
     * @example Info.months('short')[0] //=> 'Jan'
     * @example Info.months('numeric')[0] //=> '1'
     * @example Info.months('short', { locale: 'fr-CA' } )[0] //=> 'janv.'
     * @example Info.months('numeric', { locale: 'ar' })[0] //=> '١'
     * @example Info.months('long', { outputCalendar: 'islamic' })[0] //=> 'Rabiʻ I'
     * @return {[string]}
     */


    Info.months = function months() {
      var length = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'long';

      var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref$locale = _ref.locale,
          locale = _ref$locale === undefined ? null : _ref$locale,
          _ref$numberingSystem = _ref.numberingSystem,
          numberingSystem = _ref$numberingSystem === undefined ? null : _ref$numberingSystem,
          _ref$outputCalendar = _ref.outputCalendar,
          outputCalendar = _ref$outputCalendar === undefined ? 'gregory' : _ref$outputCalendar;

      return Locale.create(locale, numberingSystem, outputCalendar).months(length);
    };

    /**
     * Return an array of format month names.
     * Format months differ from standalone months in that they're meant to appear next to the day of the month. In some languages, that
     * changes the string.
     * See {@link months}
     * @param {string} [length='long'] - the length of the month representation, such as "numeric", "2-digit", "narrow", "short", "long"
     * @param {Object} opts - options
     * @param {string} [opts.locale] - the locale code
     * @param {string} [opts.numberingSystem=null] - the numbering system
     * @param {string} [opts.outputCalendar='gregory'] - the calendar
     * @return {[string]}
     */


    Info.monthsFormat = function monthsFormat() {
      var length = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'long';

      var _ref2 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref2$locale = _ref2.locale,
          locale = _ref2$locale === undefined ? null : _ref2$locale,
          _ref2$numberingSystem = _ref2.numberingSystem,
          numberingSystem = _ref2$numberingSystem === undefined ? null : _ref2$numberingSystem,
          _ref2$outputCalendar = _ref2.outputCalendar,
          outputCalendar = _ref2$outputCalendar === undefined ? 'gregory' : _ref2$outputCalendar;

      return Locale.create(locale, numberingSystem, outputCalendar).months(length, true);
    };

    /**
     * Return an array of standalone week names.
     * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DateTimeFormat
     * @param {string} [length='long'] - the length of the month representation, such as "narrow", "short", "long".
     * @param {Object} opts - options
     * @param {string} [opts.locale] - the locale code
     * @param {string} [opts.numberingSystem=null] - the numbering system
     * @example Info.weekdays()[0] //=> 'Monday'
     * @example Info.weekdays('short')[0] //=> 'Mon'
     * @example Info.weekdays('short', { locale: 'fr-CA' })[0] //=> 'lun.'
     * @example Info.weekdays('short', { locale: 'ar' })[0] //=> 'الاثنين'
     * @return {[string]}
     */


    Info.weekdays = function weekdays() {
      var length = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'long';

      var _ref3 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref3$locale = _ref3.locale,
          locale = _ref3$locale === undefined ? null : _ref3$locale,
          _ref3$numberingSystem = _ref3.numberingSystem,
          numberingSystem = _ref3$numberingSystem === undefined ? null : _ref3$numberingSystem;

      return Locale.create(locale, numberingSystem, null).weekdays(length);
    };

    /**
     * Return an array of format week names.
     * Format weekdays differ from standalone weekdays in that they're meant to appear next to more date information. In some languages, that
     * changes the string.
     * See {@link weekdays}
     * @param {string} [length='long'] - the length of the month representation, such as "narrow", "short", "long".
     * @param {Object} opts - options
     * @param {string} [opts.locale=null] - the locale code
     * @param {string} [opts.numberingSystem=null] - the numbering system
     * @return {[string]}
     */


    Info.weekdaysFormat = function weekdaysFormat() {
      var length = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'long';

      var _ref4 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref4$locale = _ref4.locale,
          locale = _ref4$locale === undefined ? null : _ref4$locale,
          _ref4$numberingSystem = _ref4.numberingSystem,
          numberingSystem = _ref4$numberingSystem === undefined ? null : _ref4$numberingSystem;

      return Locale.create(locale, numberingSystem, null).weekdays(length, true);
    };

    /**
     * Return an array of meridiems.
     * @param {Object} opts - options
     * @param {string} [opts.locale] - the locale code
     * @example Info.meridiems() //=> [ 'AM', 'PM' ]
     * @example Info.meridiems({ locale: 'de' }) //=> [ 'vorm.', 'nachm.' ]
     * @return {[string]}
     */


    Info.meridiems = function meridiems() {
      var _ref5 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          _ref5$locale = _ref5.locale,
          locale = _ref5$locale === undefined ? null : _ref5$locale;

      return Locale.create(locale).meridiems();
    };

    /**
     * Return an array of eras, such as ['BC', 'AD']. The locale can be specified, but the calendar system is always Gregorian.
     * @param {string} [length='short'] - the length of the era representation, such as "short" or "long".
     * @param {Object} opts - options
     * @param {string} [opts.locale] - the locale code
     * @example Info.eras() //=> [ 'BC', 'AD' ]
     * @example Info.eras('long') //=> [ 'Before Christ', 'Anno Domini' ]
     * @example Info.eras('long', { locale: 'fr' }) //=> [ 'avant Jésus-Christ', 'après Jésus-Christ' ]
     * @return {[string]}
     */


    Info.eras = function eras() {
      var length = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'short';

      var _ref6 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref6$locale = _ref6.locale,
          locale = _ref6$locale === undefined ? null : _ref6$locale;

      return Locale.create(locale, null, 'gregory').eras(length);
    };

    /**
     * Return the set of available features in this environment.
     * Some features of Luxon are not available in all environments. For example, on older browsers, timezone support is not available. Use this function to figure out if that's the case.
     * Keys:
     * * `zones`: whether this environment supports IANA timezones
     * * `intlTokens`: whether this environment supports internationalized token-based formatting/parsing
     * * `intl`: whether this environment supports general internationalization
     * @example Info.features() //=> { intl: true, intlTokens: false, zones: true }
     * @return {Object}
     */


    Info.features = function features() {
      var intl = false,
          intlTokens = false,
          zones = false;

      if (hasIntl()) {
        intl = true;
        intlTokens = hasFormatToParts();

        try {
          zones = new Intl.DateTimeFormat('en', { timeZone: 'America/New_York' }).resolvedOptions().timeZone === 'America/New_York';
        } catch (e) {
          zones = false;
        }
      }

      return { intl: intl, intlTokens: intlTokens, zones: zones };
    };

    return Info;
  }();

  function dayDiff(earlier, later) {
    var utcDayStart = function utcDayStart(dt) {
      return dt.toUTC(0, { keepLocalTime: true }).startOf('day').valueOf();
    },
        ms = utcDayStart(later) - utcDayStart(earlier);
    return Math.floor(Duration.fromMillis(ms).as('days'));
  }

  function highOrderDiffs(cursor, later, units) {
    var differs = [['years', function (a, b) {
      return b.year - a.year;
    }], ['months', function (a, b) {
      return b.month - a.month + (b.year - a.year) * 12;
    }], ['weeks', function (a, b) {
      var days = dayDiff(a, b);
      return (days - days % 7) / 7;
    }], ['days', dayDiff]];

    var results = {};
    var lowestOrder = void 0,
        highWater = void 0;

    for (var _iterator = differs, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
      var _ref2;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref2 = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref2 = _i.value;
      }

      var _ref = _ref2;
      var unit = _ref[0];
      var differ = _ref[1];

      if (units.indexOf(unit) >= 0) {
        var _cursor$plus;

        lowestOrder = unit;

        var delta = differ(cursor, later);

        highWater = cursor.plus((_cursor$plus = {}, _cursor$plus[unit] = delta, _cursor$plus));

        if (highWater > later) {
          var _highWater$minus;

          cursor = highWater.minus((_highWater$minus = {}, _highWater$minus[unit] = 1, _highWater$minus));
          delta -= 1;
        } else {
          cursor = highWater;
        }

        if (delta > 0) {
          results[unit] = delta;
        }
      }
    }

    return [cursor, results, highWater, lowestOrder];
  }

  function _diff (earlier, later, units, opts) {
    var _highOrderDiffs = highOrderDiffs(earlier, later, units),
        cursor = _highOrderDiffs[0],
        results = _highOrderDiffs[1],
        highWater = _highOrderDiffs[2],
        lowestOrder = _highOrderDiffs[3];

    var remainingMillis = later - cursor;

    var lowerOrderUnits = units.filter(function (u) {
      return ['hours', 'minutes', 'seconds', 'milliseconds'].indexOf(u) >= 0;
    });

    if (lowerOrderUnits.length === 0) {
      if (highWater < later) {
        var _cursor$plus2;

        highWater = cursor.plus((_cursor$plus2 = {}, _cursor$plus2[lowestOrder] = 1, _cursor$plus2));
      }

      if (highWater !== cursor) {
        results[lowestOrder] = (results[lowestOrder] || 0) + remainingMillis / (highWater - cursor);
      }
    }

    var duration = Duration.fromObject(Object.assign(results, opts));

    if (lowerOrderUnits.length > 0) {
      var _Duration$fromMillis;

      return (_Duration$fromMillis = Duration.fromMillis(remainingMillis, opts)).shiftTo.apply(_Duration$fromMillis, lowerOrderUnits).plus(duration);
    } else {
      return duration;
    }
  }

  var MISSING_FTP = 'missing Intl.DateTimeFormat.formatToParts support';

  function intUnit(regex) {
    var post = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : function (i) {
      return i;
    };

    return { regex: regex, deser: function deser(_ref) {
        var s = _ref[0];
        return post(parseInt(s));
      } };
  }

  function fixListRegex(s) {
    // make dots optional and also make them literal
    return s.replace(/\./, '\\.?');
  }

  function stripInsensitivities(s) {
    return s.replace(/\./, '').toLowerCase();
  }

  function oneOf(strings, startIndex) {
    if (strings === null) {
      return null;
    } else {
      return {
        regex: RegExp(strings.map(fixListRegex).join('|')),
        deser: function deser(_ref2) {
          var s = _ref2[0];
          return strings.findIndex(function (i) {
            return stripInsensitivities(s) === stripInsensitivities(i);
          }) + startIndex;
        }
      };
    }
  }

  function offset(regex, groups) {
    return { regex: regex, deser: function deser(_ref3) {
        var h = _ref3[1],
            m = _ref3[2];
        return signedOffset(h, m);
      }, groups: groups };
  }

  function simple(regex) {
    return { regex: regex, deser: function deser(_ref4) {
        var s = _ref4[0];
        return s;
      } };
  }

  function unitForToken(token, loc) {
    var one = /\d/,
        two = /\d{2}/,
        three = /\d{3}/,
        four = /\d{4}/,
        oneOrTwo = /\d{1,2}/,
        oneToThree = /\d{1,3}/,
        twoToFour = /\d{2,4}/,
        literal = function literal(t) {
      return { regex: RegExp(t.val), deser: function deser(_ref5) {
          var s = _ref5[0];
          return s;
        }, literal: true };
    },
        unitate = function unitate(t) {
      if (token.literal) {
        return literal(t);
      }
      switch (t.val) {
        // era
        case 'G':
          return oneOf(loc.eras('short', false), 0);
        case 'GG':
          return oneOf(loc.eras('long', false), 0);
        // years
        case 'y':
          return intUnit(/\d{1,6}/);
        case 'yy':
          return intUnit(twoToFour, untruncateYear);
        case 'yyyy':
          return intUnit(four);
        case 'yyyyy':
          return intUnit(/\d{4,6}/);
        case 'yyyyyy':
          return intUnit(/\d{6}/);
        // months
        case 'M':
          return intUnit(oneOrTwo);
        case 'MM':
          return intUnit(two);
        case 'MMM':
          return oneOf(loc.months('short', false, false), 1);
        case 'MMMM':
          return oneOf(loc.months('long', false, false), 1);
        case 'L':
          return intUnit(oneOrTwo);
        case 'LL':
          return intUnit(two);
        case 'LLL':
          return oneOf(loc.months('short', true, false), 1);
        case 'LLLL':
          return oneOf(loc.months('long', true, false), 1);
        // dates
        case 'd':
          return intUnit(oneOrTwo);
        case 'dd':
          return intUnit(two);
        // ordinals
        case 'o':
          return intUnit(oneToThree);
        case 'ooo':
          return intUnit(three);
        // time
        case 'HH':
          return intUnit(two);
        case 'H':
          return intUnit(oneOrTwo);
        case 'hh':
          return intUnit(two);
        case 'h':
          return intUnit(oneOrTwo);
        case 'mm':
          return intUnit(two);
        case 'm':
          return intUnit(oneOrTwo);
        case 's':
          return intUnit(oneOrTwo);
        case 'ss':
          return intUnit(two);
        case 'S':
          return intUnit(oneToThree);
        case 'SSS':
          return intUnit(three);
        case 'u':
          return simple(/\d{1,9}/);
        // meridiem
        case 'a':
          return oneOf(loc.meridiems(), 0);
        // weekYear (k)
        case 'kkkk':
          return intUnit(four);
        case 'kk':
          return intUnit(twoToFour, untruncateYear);
        // weekNumber (W)
        case 'W':
          return intUnit(oneOrTwo);
        case 'WW':
          return intUnit(two);
        // weekdays
        case 'E':
        case 'c':
          return intUnit(one);
        case 'EEE':
          return oneOf(loc.weekdays('short', false, false), 1);
        case 'EEEE':
          return oneOf(loc.weekdays('long', false, false), 1);
        case 'ccc':
          return oneOf(loc.weekdays('short', true, false), 1);
        case 'cccc':
          return oneOf(loc.weekdays('long', true, false), 1);
        // offset/zone
        case 'Z':
        case 'ZZ':
          return offset(/([+-]\d{1,2})(?::(\d{2}))?/, 2);
        case 'ZZZ':
          return offset(/([+-]\d{1,2})(\d{2})?/, 2);
        // we don't support ZZZZ (PST) or ZZZZZ (Pacific Standard Time) in parsing
        // because we don't have any way to figure out what they are
        case 'z':
          return simple(/[A-Za-z_]{1,256}\/[A-Za-z_]{1,256}/);
        default:
          return literal(t);
      }
    };

    var unit = unitate(token) || {
      invalidReason: MISSING_FTP
    };

    unit.token = token;

    return unit;
  }

  function buildRegex(units) {
    var re = units.map(function (u) {
      return u.regex;
    }).reduce(function (f, r) {
      return f + '(' + r.source + ')';
    }, '');
    return ['^' + re + '$', units];
  }

  function match(input, regex, handlers) {
    var matches = input.match(regex);

    if (matches) {
      var all = {};
      var matchIndex = 1;
      for (var i in handlers) {
        if (handlers.hasOwnProperty(i)) {
          var h = handlers[i],
              groups = h.groups ? h.groups + 1 : 1;
          if (!h.literal && h.token) {
            all[h.token.val[0]] = h.deser(matches.slice(matchIndex, matchIndex + groups));
          }
          matchIndex += groups;
        }
      }
      return [matches, all];
    } else {
      return [matches, {}];
    }
  }

  function dateTimeFromMatches(matches) {
    var toField = function toField(token) {
      switch (token) {
        case 'S':
          return 'millisecond';
        case 's':
          return 'second';
        case 'm':
          return 'minute';
        case 'h':
        case 'H':
          return 'hour';
        case 'd':
          return 'day';
        case 'o':
          return 'ordinal';
        case 'L':
        case 'M':
          return 'month';
        case 'y':
          return 'year';
        case 'E':
        case 'c':
          return 'weekday';
        case 'W':
          return 'weekNumber';
        case 'k':
          return 'weekYear';
        default:
          return null;
      }
    };

    var zone = void 0;
    if (!isUndefined(matches.Z)) {
      zone = new FixedOffsetZone(matches.Z);
    } else if (!isUndefined(matches.z)) {
      zone = new IANAZone(matches.z);
    } else {
      zone = null;
    }

    if (!isUndefined(matches.h)) {
      if (matches.h < 12 && matches.a === 1) {
        matches.h += 12;
      } else if (matches.h === 12 && matches.a === 0) {
        matches.h = 0;
      }
    }

    if (matches.G === 0 && matches.y) {
      matches.y = -matches.y;
    }

    if (!isUndefined(matches.u)) {
      matches.S = parseMillis(matches.u);
    }

    var vals = Object.keys(matches).reduce(function (r, k) {
      var f = toField(k);
      if (f) {
        r[f] = matches[k];
      }

      return r;
    }, {});

    return [vals, zone];
  }

  /**
   * @private
   */

  function explainFromTokens(locale, input, format) {
    var tokens = Formatter.parseFormat(format),
        units = tokens.map(function (t) {
      return unitForToken(t, locale);
    }),
        disqualifyingUnit = units.find(function (t) {
      return t.invalidReason;
    });

    if (disqualifyingUnit) {
      return { input: input, tokens: tokens, invalidReason: disqualifyingUnit.invalidReason };
    } else {
      var _buildRegex = buildRegex(units),
          regexString = _buildRegex[0],
          handlers = _buildRegex[1],
          regex = RegExp(regexString, 'i'),
          _match = match(input, regex, handlers),
          rawMatches = _match[0],
          matches = _match[1],
          _ref6 = matches ? dateTimeFromMatches(matches) : [null, null],
          result = _ref6[0],
          zone = _ref6[1];

      return { input: input, tokens: tokens, regex: regex, rawMatches: rawMatches, matches: matches, result: result, zone: zone };
    }
  }

  function parseFromTokens(locale, input, format) {
    var _explainFromTokens = explainFromTokens(locale, input, format),
        result = _explainFromTokens.result,
        zone = _explainFromTokens.zone,
        invalidReason = _explainFromTokens.invalidReason;

    return [result, zone, invalidReason];
  }

  var nonLeapLadder = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334],
      leapLadder = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335];

  function dayOfWeek(year, month, day) {
    var js = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return js === 0 ? 7 : js;
  }

  function computeOrdinal(year, month, day) {
    return day + (isLeapYear(year) ? leapLadder : nonLeapLadder)[month - 1];
  }

  function uncomputeOrdinal(year, ordinal) {
    var table = isLeapYear(year) ? leapLadder : nonLeapLadder,
        month0 = table.findIndex(function (i) {
      return i < ordinal;
    }),
        day = ordinal - table[month0];
    return { month: month0 + 1, day: day };
  }

  /**
   * @private
   */

  function gregorianToWeek(gregObj) {
    var year = gregObj.year,
        month = gregObj.month,
        day = gregObj.day,
        ordinal = computeOrdinal(year, month, day),
        weekday = dayOfWeek(year, month, day);


    var weekNumber = Math.floor((ordinal - weekday + 10) / 7),
        weekYear = void 0;

    if (weekNumber < 1) {
      weekYear = year - 1;
      weekNumber = weeksInWeekYear(weekYear);
    } else if (weekNumber > weeksInWeekYear(year)) {
      weekYear = year + 1;
      weekNumber = 1;
    } else {
      weekYear = year;
    }

    return Object.assign({ weekYear: weekYear, weekNumber: weekNumber, weekday: weekday }, timeObject(gregObj));
  }

  function weekToGregorian(weekData) {
    var weekYear = weekData.weekYear,
        weekNumber = weekData.weekNumber,
        weekday = weekData.weekday,
        weekdayOfJan4 = dayOfWeek(weekYear, 1, 4),
        yearInDays = daysInYear(weekYear);

    var ordinal = weekNumber * 7 + weekday - weekdayOfJan4 - 3,
        year = void 0;

    if (ordinal < 1) {
      year = weekYear - 1;
      ordinal += daysInYear(year);
    } else if (ordinal > yearInDays) {
      year = weekYear + 1;
      ordinal -= daysInYear(year);
    } else {
      year = weekYear;
    }

    var _uncomputeOrdinal = uncomputeOrdinal(year, ordinal),
        month = _uncomputeOrdinal.month,
        day = _uncomputeOrdinal.day;

    return Object.assign({ year: year, month: month, day: day }, timeObject(weekData));
  }

  function gregorianToOrdinal(gregData) {
    var year = gregData.year,
        month = gregData.month,
        day = gregData.day,
        ordinal = computeOrdinal(year, month, day);


    return Object.assign({ year: year, ordinal: ordinal }, timeObject(gregData));
  }

  function ordinalToGregorian(ordinalData) {
    var year = ordinalData.year,
        ordinal = ordinalData.ordinal,
        _uncomputeOrdinal2 = uncomputeOrdinal(year, ordinal),
        month = _uncomputeOrdinal2.month,
        day = _uncomputeOrdinal2.day;

    return Object.assign({ year: year, month: month, day: day }, timeObject(ordinalData));
  }

  function hasInvalidWeekData(obj) {
    var validYear = isNumber(obj.weekYear),
        validWeek = numberBetween(obj.weekNumber, 1, weeksInWeekYear(obj.weekYear)),
        validWeekday = numberBetween(obj.weekday, 1, 7);

    if (!validYear) {
      return 'weekYear out of range';
    } else if (!validWeek) {
      return 'week out of range';
    } else if (!validWeekday) {
      return 'weekday out of range';
    } else return false;
  }

  function hasInvalidOrdinalData(obj) {
    var validYear = isNumber(obj.year),
        validOrdinal = numberBetween(obj.ordinal, 1, daysInYear(obj.year));

    if (!validYear) {
      return 'year out of range';
    } else if (!validOrdinal) {
      return 'ordinal out of range';
    } else return false;
  }

  function hasInvalidGregorianData(obj) {
    var validYear = isNumber(obj.year),
        validMonth = numberBetween(obj.month, 1, 12),
        validDay = numberBetween(obj.day, 1, daysInMonth(obj.year, obj.month));

    if (!validYear) {
      return 'year out of range';
    } else if (!validMonth) {
      return 'month out of range';
    } else if (!validDay) {
      return 'day out of range';
    } else return false;
  }

  function hasInvalidTimeData(obj) {
    var validHour = numberBetween(obj.hour, 0, 23),
        validMinute = numberBetween(obj.minute, 0, 59),
        validSecond = numberBetween(obj.second, 0, 59),
        validMillisecond = numberBetween(obj.millisecond, 0, 999);

    if (!validHour) {
      return 'hour out of range';
    } else if (!validMinute) {
      return 'minute out of range';
    } else if (!validSecond) {
      return 'second out of range';
    } else if (!validMillisecond) {
      return 'millisecond out of range';
    } else return false;
  }

  var INVALID$2 = 'Invalid DateTime',
      INVALID_INPUT = 'invalid input',
      UNSUPPORTED_ZONE = 'unsupported zone',
      UNPARSABLE$1 = 'unparsable';

  // we cache week data on the DT object and this intermediates the cache
  function possiblyCachedWeekData(dt) {
    if (dt.weekData === null) {
      dt.weekData = gregorianToWeek(dt.c);
    }
    return dt.weekData;
  }

  // clone really means, "make a new object with these modifications". all "setters" really use this
  // to create a new object while only changing some of the properties
  function clone$1(inst, alts) {
    var current = {
      ts: inst.ts,
      zone: inst.zone,
      c: inst.c,
      o: inst.o,
      loc: inst.loc,
      invalidReason: inst.invalidReason
    };
    return new DateTime(Object.assign({}, current, alts, { old: current }));
  }

  // find the right offset a given local time. The o input is our guess, which determines which
  // offset we'll pick in ambiguous cases (e.g. there are two 3 AMs b/c Fallback DST)
  function fixOffset(localTS, o, tz) {
    // Our UTC time is just a guess because our offset is just a guess
    var utcGuess = localTS - o * 60 * 1000;

    // Test whether the zone matches the offset for this ts
    var o2 = tz.offset(utcGuess);

    // If so, offset didn't change and we're done
    if (o === o2) {
      return [utcGuess, o];
    }

    // If not, change the ts by the difference in the offset
    utcGuess -= (o2 - o) * 60 * 1000;

    // If that gives us the local time we want, we're done
    var o3 = tz.offset(utcGuess);
    if (o2 === o3) {
      return [utcGuess, o2];
    }

    // If it's different, we're in a hole time. The offset has changed, but the we don't adjust the time
    return [localTS - Math.min(o2, o3) * 60 * 1000, Math.max(o2, o3)];
  }

  // convert an epoch timestamp into a calendar object with the given offset
  function tsToObj(ts, offset) {
    ts += offset * 60 * 1000;

    var d = new Date(ts);

    return {
      year: d.getUTCFullYear(),
      month: d.getUTCMonth() + 1,
      day: d.getUTCDate(),
      hour: d.getUTCHours(),
      minute: d.getUTCMinutes(),
      second: d.getUTCSeconds(),
      millisecond: d.getUTCMilliseconds()
    };
  }

  // covert a calendar object to a local timestamp (epoch, but with the offset baked in)
  function objToLocalTS(obj) {
    var d = Date.UTC(obj.year, obj.month - 1, obj.day, obj.hour, obj.minute, obj.second, obj.millisecond);

    // javascript is stupid and i hate it
    if (obj.year < 100 && obj.year >= 0) {
      d = new Date(d);
      d.setUTCFullYear(obj.year);
    }
    return +d;
  }

  // convert a calendar object to a epoch timestamp
  function objToTS(obj, offset, zone) {
    return fixOffset(objToLocalTS(obj), offset, zone);
  }

  // create a new DT instance by adding a duration, adjusting for DSTs
  function adjustTime(inst, dur) {
    var oPre = inst.o,
        year = inst.c.year + dur.years,
        month = inst.c.month + dur.months + dur.quarters * 3,
        c = Object.assign({}, inst.c, {
      year: year,
      month: month,
      day: Math.min(inst.c.day, daysInMonth(year, month)) + dur.days + dur.weeks * 7
    }),
        millisToAdd = Duration.fromObject({
      hours: dur.hours,
      minutes: dur.minutes,
      seconds: dur.seconds,
      milliseconds: dur.milliseconds
    }).as('milliseconds'),
        localTS = objToLocalTS(c);

    var _fixOffset = fixOffset(localTS, oPre, inst.zone),
        ts = _fixOffset[0],
        o = _fixOffset[1];

    if (millisToAdd !== 0) {
      ts += millisToAdd;
      // that could have changed the offset by going over a DST, but we want to keep the ts the same
      o = inst.zone.offset(ts);
    }

    return { ts: ts, o: o };
  }

  // helper useful in turning the results of parsing into real dates
  // by handling the zone options
  function parseDataToDateTime(parsed, parsedZone, opts) {
    var setZone = opts.setZone,
        zone = opts.zone;

    if (parsed && Object.keys(parsed).length !== 0) {
      var interpretationZone = parsedZone || zone,
          inst = DateTime.fromObject(Object.assign(parsed, opts, {
        zone: interpretationZone
      }));
      return setZone ? inst : inst.setZone(zone);
    } else {
      return DateTime.invalid(UNPARSABLE$1);
    }
  }

  // if you want to output a technical format (e.g. RFC 2822), this helper
  // helps handle the details
  function toTechFormat(dt, format) {
    return dt.isValid ? Formatter.create(Locale.create('en-US'), {
      allowZ: true,
      forceSimple: true
    }).formatDateTimeFromString(dt, format) : null;
  }

  // technical time formats (e.g. the time part of ISO 8601), take some options
  // and this commonizes their handling
  function toTechTimeFormat(dt, _ref) {
    var _ref$suppressSeconds = _ref.suppressSeconds,
        suppressSeconds = _ref$suppressSeconds === undefined ? false : _ref$suppressSeconds,
        _ref$suppressMillisec = _ref.suppressMilliseconds,
        suppressMilliseconds = _ref$suppressMillisec === undefined ? false : _ref$suppressMillisec,
        _ref$includeOffset = _ref.includeOffset,
        includeOffset = _ref$includeOffset === undefined ? true : _ref$includeOffset,
        _ref$includeZone = _ref.includeZone,
        includeZone = _ref$includeZone === undefined ? false : _ref$includeZone,
        _ref$spaceZone = _ref.spaceZone,
        spaceZone = _ref$spaceZone === undefined ? false : _ref$spaceZone;

    var fmt = 'HH:mm';

    if (!suppressSeconds || dt.second !== 0 || dt.millisecond !== 0) {
      fmt += ':ss';
      if (!suppressMilliseconds || dt.millisecond !== 0) {
        fmt += '.SSS';
      }
    }

    if ((includeZone || includeOffset) && spaceZone) {
      fmt += ' ';
    }

    if (includeZone) {
      fmt += 'z';
    } else if (includeOffset) {
      fmt += 'ZZ';
    }

    return toTechFormat(dt, fmt);
  }

  // defaults for unspecified units in the supported calendars
  var defaultUnitValues = {
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  },
      defaultWeekUnitValues = {
    weekNumber: 1,
    weekday: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  },
      defaultOrdinalUnitValues = {
    ordinal: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0
  };

  // Units in the supported calendars, sorted by bigness
  var orderedUnits$1 = ['year', 'month', 'day', 'hour', 'minute', 'second', 'millisecond'],
      orderedWeekUnits = ['weekYear', 'weekNumber', 'weekday', 'hour', 'minute', 'second', 'millisecond'],
      orderedOrdinalUnits = ['year', 'ordinal', 'hour', 'minute', 'second', 'millisecond'];

  // standardize case and plurality in units
  function normalizeUnit(unit) {
    var ignoreUnknown = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

    var normalized = {
      year: 'year',
      years: 'year',
      month: 'month',
      months: 'month',
      day: 'day',
      days: 'day',
      hour: 'hour',
      hours: 'hour',
      minute: 'minute',
      minutes: 'minute',
      second: 'second',
      seconds: 'second',
      millisecond: 'millisecond',
      milliseconds: 'millisecond',
      weekday: 'weekday',
      weekdays: 'weekday',
      weeknumber: 'weekNumber',
      weeksnumber: 'weekNumber',
      weeknumbers: 'weekNumber',
      weekyear: 'weekYear',
      weekyears: 'weekYear',
      ordinal: 'ordinal'
    }[unit ? unit.toLowerCase() : unit];

    if (!ignoreUnknown && !normalized) throw new InvalidUnitError(unit);

    return normalized;
  }

  // this is a dumbed down version of fromObject() that runs about 60% faster
  // but doesn't do any validation, makes a bunch of assumptions about what units
  // are present, and so on.
  function quickDT(obj, zone) {
    // assume we have the higher-order units
    for (var _iterator = orderedUnits$1, _isArray = Array.isArray(_iterator), _i = 0, _iterator = _isArray ? _iterator : _iterator[Symbol.iterator]();;) {
      var _ref2;

      if (_isArray) {
        if (_i >= _iterator.length) break;
        _ref2 = _iterator[_i++];
      } else {
        _i = _iterator.next();
        if (_i.done) break;
        _ref2 = _i.value;
      }

      var u = _ref2;

      if (isUndefined(obj[u])) {
        obj[u] = defaultUnitValues[u];
      }
    }

    var invalidReason = hasInvalidGregorianData(obj) || hasInvalidTimeData(obj);
    if (invalidReason) {
      return DateTime.invalid(invalidReason);
    }

    var tsNow = Settings.now(),
        offsetProvis = zone.offset(tsNow),
        _objToTS = objToTS(obj, offsetProvis, zone),
        ts = _objToTS[0],
        o = _objToTS[1];


    return new DateTime({
      ts: ts,
      zone: zone,
      o: o
    });
  }

  /**
   * A DateTime is an immutable data structure representing a specific date and time and accompanying methods. It contains class and instance methods for creating, parsing, interrogating, transforming, and formatting them.
   *
   * A DateTime comprises of:
   * * A timestamp. Each DateTime instance refers to a specific millisecond of the Unix epoch.
   * * A time zone. Each instance is considered in the context of a specific zone (by default the local system's zone).
   * * Configuration properties that effect how output strings are formatted, such as `locale`, `numberingSystem`, and `outputCalendar`.
   *
   * Here is a brief overview of the most commonly used functionality it provides:
   *
   * * **Creation**: To create a DateTime from its components, use one of its factory class methods: {@link local}, {@link utc}, and (most flexibly) {@link fromObject}. To create one from a standard string format, use {@link fromISO}, {@link fromHTTP}, and {@link fromRFC2822}. To create one from a custom string format, use {@link fromFormat}. To create one from a native JS date, use {@link fromJSDate}.
   * * **Gregorian calendar and time**: To examine the Gregorian properties of a DateTime individually (i.e as opposed to collectively through {@link toObject}), use the {@link year}, {@link month},
   * {@link day}, {@link hour}, {@link minute}, {@link second}, {@link millisecond} accessors.
   * * **Week calendar**: For ISO week calendar attributes, see the {@link weekYear}, {@link weekNumber}, and {@link weekday} accessors.
   * * **Configuration** See the {@link locale} and {@link numberingSystem} accessors.
   * * **Transformation**: To transform the DateTime into other DateTimes, use {@link set}, {@link reconfigure}, {@link setZone}, {@link setLocale}, {@link plus}, {@link minus}, {@link endOf}, {@link startOf}, {@link toUTC}, and {@link toLocal}.
   * * **Output**: To convert the DateTime to other representations, use the {@link toJSON}, {@link toISO}, {@link toHTTP}, {@link toObject}, {@link toRFC2822}, {@link toString}, {@link toLocaleString}, {@link toFormat}, {@link valueOf} and {@link toJSDate}.
   *
   * There's plenty others documented below. In addition, for more information on subtler topics like internationalization, time zones, alternative calendars, validity, and so on, see the external documentation.
   */

  var DateTime = function () {
    /**
     * @access private
     */
    function DateTime(config) {
      classCallCheck(this, DateTime);

      var zone = config.zone || Settings.defaultZone,
          invalidReason = config.invalidReason || (Number.isNaN(config.ts) ? INVALID_INPUT : null) || (!zone.isValid ? UNSUPPORTED_ZONE : null);
      /**
       * @access private
       */
      this.ts = isUndefined(config.ts) ? Settings.now() : config.ts;

      var c = null,
          o = null;
      if (!invalidReason) {
        var unchanged = config.old && config.old.ts === this.ts && config.old.zone.equals(zone);
        c = unchanged ? config.old.c : tsToObj(this.ts, zone.offset(this.ts));
        o = unchanged ? config.old.o : zone.offset(this.ts);
      }

      /**
       * @access private
       */
      this.zone = zone;
      /**
       * @access private
       */
      this.loc = config.loc || Locale.create();
      /**
       * @access private
       */
      this.invalid = invalidReason;
      /**
       * @access private
       */
      this.weekData = null;
      /**
       * @access private
       */
      this.c = c;
      /**
       * @access private
       */
      this.o = o;
    }

    // CONSTRUCT

    /**
     * Create a local DateTime
     * @param {number} year - The calendar year. If omitted (as in, call `local()` with no arguments), the current time will be used
     * @param {number} [month=1] - The month, 1-indexed
     * @param {number} [day=1] - The day of the month
     * @param {number} [hour=0] - The hour of the day, in 24-hour time
     * @param {number} [minute=0] - The minute of the hour, i.e. a number between 0 and 59
     * @param {number} [second=0] - The second of the minute, i.e. a number between 0 and 59
     * @param {number} [millisecond=0] - The millisecond of the second, i.e. a number between 0 and 999
     * @example DateTime.local()                            //~> now
     * @example DateTime.local(2017)                        //~> 2017-01-01T00:00:00
     * @example DateTime.local(2017, 3)                     //~> 2017-03-01T00:00:00
     * @example DateTime.local(2017, 3, 12)                 //~> 2017-03-12T00:00:00
     * @example DateTime.local(2017, 3, 12, 5)              //~> 2017-03-12T05:00:00
     * @example DateTime.local(2017, 3, 12, 5, 45)          //~> 2017-03-12T05:45:00
     * @example DateTime.local(2017, 3, 12, 5, 45, 10)      //~> 2017-03-12T05:45:10
     * @example DateTime.local(2017, 3, 12, 5, 45, 10, 765) //~> 2017-03-12T05:45:10.765
     * @return {DateTime}
     */


    DateTime.local = function local(year, month, day, hour, minute, second, millisecond) {
      if (isUndefined(year)) {
        return new DateTime({ ts: Settings.now() });
      } else {
        return quickDT({
          year: year,
          month: month,
          day: day,
          hour: hour,
          minute: minute,
          second: second,
          millisecond: millisecond
        }, Settings.defaultZone);
      }
    };

    /**
     * Create a DateTime in UTC
     * @param {number} year - The calendar year. If omitted (as in, call `utc()` with no arguments), the current time will be used
     * @param {number} [month=1] - The month, 1-indexed
     * @param {number} [day=1] - The day of the month
     * @param {number} [hour=0] - The hour of the day, in 24-hour time
     * @param {number} [minute=0] - The minute of the hour, i.e. a number between 0 and 59
     * @param {number} [second=0] - The second of the minute, i.e. a number between 0 and 59
     * @param {number} [millisecond=0] - The millisecond of the second, i.e. a number between 0 and 999
     * @example DateTime.utc()                            //~> now
     * @example DateTime.utc(2017)                        //~> 2017-01-01T00:00:00Z
     * @example DateTime.utc(2017, 3)                     //~> 2017-03-01T00:00:00Z
     * @example DateTime.utc(2017, 3, 12)                 //~> 2017-03-12T00:00:00Z
     * @example DateTime.utc(2017, 3, 12, 5)              //~> 2017-03-12T05:00:00Z
     * @example DateTime.utc(2017, 3, 12, 5, 45)          //~> 2017-03-12T05:45:00Z
     * @example DateTime.utc(2017, 3, 12, 5, 45, 10)      //~> 2017-03-12T05:45:10Z
     * @example DateTime.utc(2017, 3, 12, 5, 45, 10, 765) //~> 2017-03-12T05:45:10.765Z
     * @return {DateTime}
     */


    DateTime.utc = function utc(year, month, day, hour, minute, second, millisecond) {
      if (isUndefined(year)) {
        return new DateTime({
          ts: Settings.now(),
          zone: FixedOffsetZone.utcInstance
        });
      } else {
        return quickDT({
          year: year,
          month: month,
          day: day,
          hour: hour,
          minute: minute,
          second: second,
          millisecond: millisecond
        }, FixedOffsetZone.utcInstance);
      }
    };

    /**
     * Create an DateTime from a Javascript Date object. Uses the default zone.
     * @param {Date} date - a Javascript Date object
     * @param {Object} options - configuration options for the DateTime
     * @param {string|Zone} [options.zone='local'] - the zone to place the DateTime into
     * @return {DateTime}
     */


    DateTime.fromJSDate = function fromJSDate(date) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return new DateTime({
        ts: isDate(date) ? date.valueOf() : NaN,
        zone: normalizeZone(options.zone, Settings.defaultZone),
        loc: Locale.fromObject(options)
      });
    };

    /**
     * Create an DateTime from a count of epoch milliseconds. Uses the default zone.
     * @param {number} milliseconds - a number of milliseconds since 1970 UTC
     * @param {Object} options - configuration options for the DateTime
     * @param {string|Zone} [options.zone='local'] - the zone to place the DateTime into
     * @param {string} [options.locale] - a locale to set on the resulting DateTime instance
     * @param {string} options.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @param {string} options.numberingSystem - the numbering system to set on the resulting DateTime instance
     * @return {DateTime}
     */


    DateTime.fromMillis = function fromMillis(milliseconds) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return new DateTime({
        ts: milliseconds,
        zone: normalizeZone(options.zone, Settings.defaultZone),
        loc: Locale.fromObject(options)
      });
    };

    /**
     * Create an DateTime from a Javascript object with keys like 'year' and 'hour' with reasonable defaults.
     * @param {Object} obj - the object to create the DateTime from
     * @param {number} obj.year - a year, such as 1987
     * @param {number} obj.month - a month, 1-12
     * @param {number} obj.day - a day of the month, 1-31, depending on the month
     * @param {number} obj.ordinal - day of the year, 1-365 or 366
     * @param {number} obj.weekYear - an ISO week year
     * @param {number} obj.weekNumber - an ISO week number, between 1 and 52 or 53, depending on the year
     * @param {number} obj.weekday - an ISO weekday, 1-7, where 1 is Monday and 7 is Sunday
     * @param {number} obj.hour - hour of the day, 0-23
     * @param {number} obj.minute - minute of the hour, 0-59
     * @param {number} obj.second - second of the minute, 0-59
     * @param {number} obj.millisecond - millisecond of the second, 0-999
     * @param {string|Zone} [obj.zone='local'] - interpret the numbers in the context of a particular zone. Can take any value taken as the first argument to setZone()
     * @param {string} [obj.locale='en-US'] - a locale to set on the resulting DateTime instance
     * @param {string} obj.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @param {string} obj.numberingSystem - the numbering system to set on the resulting DateTime instance
     * @example DateTime.fromObject({ year: 1982, month: 5, day: 25}).toISODate() //=> '1982-05-25'
     * @example DateTime.fromObject({ year: 1982 }).toISODate() //=> '1982-01-01T00'
     * @example DateTime.fromObject({ hour: 10, minute: 26, second: 6 }) //~> today at 10:26:06
     * @example DateTime.fromObject({ hour: 10, minute: 26, second: 6, zone: 'utc' }),
     * @example DateTime.fromObject({ hour: 10, minute: 26, second: 6, zone: 'local' })
     * @example DateTime.fromObject({ hour: 10, minute: 26, second: 6, zone: 'America/New_York' })
     * @example DateTime.fromObject({ weekYear: 2016, weekNumber: 2, weekday: 3 }).toISODate() //=> '2016-01-13'
     * @return {DateTime}
     */


    DateTime.fromObject = function fromObject(obj) {
      var zoneToUse = normalizeZone(obj.zone, Settings.defaultZone);
      if (!zoneToUse.isValid) {
        return DateTime.invalid(UNSUPPORTED_ZONE);
      }

      var tsNow = Settings.now(),
          offsetProvis = zoneToUse.offset(tsNow),
          normalized = normalizeObject(obj, normalizeUnit, true),
          containsOrdinal = !isUndefined(normalized.ordinal),
          containsGregorYear = !isUndefined(normalized.year),
          containsGregorMD = !isUndefined(normalized.month) || !isUndefined(normalized.day),
          containsGregor = containsGregorYear || containsGregorMD,
          definiteWeekDef = normalized.weekYear || normalized.weekNumber,
          loc = Locale.fromObject(obj);

      // cases:
      // just a weekday -> this week's instance of that weekday, no worries
      // (gregorian data or ordinal) + (weekYear or weekNumber) -> error
      // (gregorian month or day) + ordinal -> error
      // otherwise just use weeks or ordinals or gregorian, depending on what's specified

      if ((containsGregor || containsOrdinal) && definiteWeekDef) {
        throw new ConflictingSpecificationError("Can't mix weekYear/weekNumber units with year/month/day or ordinals");
      }

      if (containsGregorMD && containsOrdinal) {
        throw new ConflictingSpecificationError("Can't mix ordinal dates with month/day");
      }

      var useWeekData = definiteWeekDef || normalized.weekday && !containsGregor;

      // configure ourselves to deal with gregorian dates or week stuff
      var units = void 0,
          defaultValues = void 0,
          objNow = tsToObj(tsNow, offsetProvis);
      if (useWeekData) {
        units = orderedWeekUnits;
        defaultValues = defaultWeekUnitValues;
        objNow = gregorianToWeek(objNow);
      } else if (containsOrdinal) {
        units = orderedOrdinalUnits;
        defaultValues = defaultOrdinalUnitValues;
        objNow = gregorianToOrdinal(objNow);
      } else {
        units = orderedUnits$1;
        defaultValues = defaultUnitValues;
      }

      // set default values for missing stuff
      var foundFirst = false;
      for (var _iterator2 = units, _isArray2 = Array.isArray(_iterator2), _i2 = 0, _iterator2 = _isArray2 ? _iterator2 : _iterator2[Symbol.iterator]();;) {
        var _ref3;

        if (_isArray2) {
          if (_i2 >= _iterator2.length) break;
          _ref3 = _iterator2[_i2++];
        } else {
          _i2 = _iterator2.next();
          if (_i2.done) break;
          _ref3 = _i2.value;
        }

        var u = _ref3;

        var v = normalized[u];
        if (!isUndefined(v)) {
          foundFirst = true;
        } else if (foundFirst) {
          normalized[u] = defaultValues[u];
        } else {
          normalized[u] = objNow[u];
        }
      }

      // make sure the values we have are in range
      var higherOrderInvalid = useWeekData ? hasInvalidWeekData(normalized) : containsOrdinal ? hasInvalidOrdinalData(normalized) : hasInvalidGregorianData(normalized),
          invalidReason = higherOrderInvalid || hasInvalidTimeData(normalized);

      if (invalidReason) {
        return DateTime.invalid(invalidReason);
      }

      // compute the actual time
      var gregorian = useWeekData ? weekToGregorian(normalized) : containsOrdinal ? ordinalToGregorian(normalized) : normalized,
          _objToTS2 = objToTS(gregorian, offsetProvis, zoneToUse),
          tsFinal = _objToTS2[0],
          offsetFinal = _objToTS2[1],
          inst = new DateTime({
        ts: tsFinal,
        zone: zoneToUse,
        o: offsetFinal,
        loc: loc
      });

      // gregorian data + weekday serves only to validate
      if (normalized.weekday && containsGregor && obj.weekday !== inst.weekday) {
        return DateTime.invalid('mismatched weekday');
      }

      return inst;
    };

    /**
     * Create a DateTime from an ISO 8601 string
     * @param {string} text - the ISO string
     * @param {Object} opts - options to affect the creation
     * @param {string|Zone} [opts.zone='local'] - use this zone if no offset is specified in the input string itself. Will also convert the time to this zone
     * @param {boolean} [opts.setZone=false] - override the zone with a fixed-offset zone specified in the string itself, if it specifies one
     * @param {string} [opts.locale='en-US'] - a locale to set on the resulting DateTime instance
     * @param {string} opts.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @param {string} opts.numberingSystem - the numbering system to set on the resulting DateTime instance
     * @example DateTime.fromISO('2016-05-25T09:08:34.123')
     * @example DateTime.fromISO('2016-05-25T09:08:34.123+06:00')
     * @example DateTime.fromISO('2016-05-25T09:08:34.123+06:00', {setZone: true})
     * @example DateTime.fromISO('2016-05-25T09:08:34.123', {zone: 'utc'})
     * @example DateTime.fromISO('2016-W05-4')
     * @return {DateTime}
     */


    DateTime.fromISO = function fromISO(text) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var _parseISODate = parseISODate(text),
          vals = _parseISODate[0],
          parsedZone = _parseISODate[1];

      return parseDataToDateTime(vals, parsedZone, opts);
    };

    /**
     * Create a DateTime from an RFC 2822 string
     * @param {string} text - the RFC 2822 string
     * @param {Object} opts - options to affect the creation
     * @param {string|Zone} [opts.zone='local'] - convert the time to this zone. Since the offset is always specified in the string itself, this has no effect on the interpretation of string, merely the zone the resulting DateTime is expressed in.
     * @param {boolean} [opts.setZone=false] - override the zone with a fixed-offset zone specified in the string itself, if it specifies one
     * @param {string} [opts.locale='en-US'] - a locale to set on the resulting DateTime instance
     * @param {string} opts.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @param {string} opts.numberingSystem - the numbering system to set on the resulting DateTime instance
     * @example DateTime.fromRFC2822('25 Nov 2016 13:23:12 GMT')
     * @example DateTime.fromRFC2822('Tue, 25 Nov 2016 13:23:12 +0600')
     * @example DateTime.fromRFC2822('25 Nov 2016 13:23 Z')
     * @return {DateTime}
     */


    DateTime.fromRFC2822 = function fromRFC2822(text) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var _parseRFC2822Date = parseRFC2822Date(text),
          vals = _parseRFC2822Date[0],
          parsedZone = _parseRFC2822Date[1];

      return parseDataToDateTime(vals, parsedZone, opts);
    };

    /**
     * Create a DateTime from an HTTP header date
     * @see https://www.w3.org/Protocols/rfc2616/rfc2616-sec3.html#sec3.3.1
     * @param {string} text - the HTTP header date
     * @param {Object} options - options to affect the creation
     * @param {string|Zone} [options.zone='local'] - convert the time to this zone. Since HTTP dates are always in UTC, this has no effect on the interpretation of string, merely the zone the resulting DateTime is expressed in.
     * @param {boolean} [options.setZone=false] - override the zone with the fixed-offset zone specified in the string. For HTTP dates, this is always UTC, so this option is equivalent to setting the `zone` option to 'utc', but this option is included for consistency with similar methods.
     * @param {string} [options.locale='en-US'] - a locale to set on the resulting DateTime instance
     * @param {string} options.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @param {string} options.numberingSystem - the numbering system to set on the resulting DateTime instance
     * @example DateTime.fromHTTP('Sun, 06 Nov 1994 08:49:37 GMT')
     * @example DateTime.fromHTTP('Sunday, 06-Nov-94 08:49:37 GMT')
     * @example DateTime.fromHTTP('Sun Nov  6 08:49:37 1994')
     * @return {DateTime}
     */


    DateTime.fromHTTP = function fromHTTP(text) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var _parseHTTPDate = parseHTTPDate(text),
          vals = _parseHTTPDate[0],
          parsedZone = _parseHTTPDate[1];

      return parseDataToDateTime(vals, parsedZone, options);
    };

    /**
     * Create a DateTime from an input string and format string
     * Defaults to en-US if no locale has been specified, regardless of the system's locale
     * @param {string} text - the string to parse
     * @param {string} fmt - the format the string is expected to be in (see description)
     * @param {Object} options - options to affect the creation
     * @param {string|Zone} [options.zone='local'] - use this zone if no offset is specified in the input string itself. Will also convert the DateTime to this zone
     * @param {boolean} [options.setZone=false] - override the zone with a zone specified in the string itself, if it specifies one
     * @param {string} [options.locale='en-US'] - a locale string to use when parsing. Will also set the DateTime to this locale
     * @param {string} options.numberingSystem - the numbering system to use when parsing. Will also set the resulting DateTime to this numbering system
     * @param {string} options.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @return {DateTime}
     */


    DateTime.fromFormat = function fromFormat(text, fmt) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      if (isUndefined(text) || isUndefined(fmt)) {
        throw new InvalidArgumentError('fromFormat requires an input string and a format');
      }

      var _options$locale = options.locale,
          locale = _options$locale === undefined ? null : _options$locale,
          _options$numberingSys = options.numberingSystem,
          numberingSystem = _options$numberingSys === undefined ? null : _options$numberingSys,
          localeToUse = Locale.fromOpts({ locale: locale, numberingSystem: numberingSystem, defaultToEN: true }),
          _parseFromTokens = parseFromTokens(localeToUse, text, fmt),
          vals = _parseFromTokens[0],
          parsedZone = _parseFromTokens[1],
          invalidReason = _parseFromTokens[2];

      if (invalidReason) {
        return DateTime.invalid(invalidReason);
      } else {
        return parseDataToDateTime(vals, parsedZone, options);
      }
    };

    /**
     * @deprecated use fromFormat instead
     */


    DateTime.fromString = function fromString(text, fmt) {
      var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      return DateTime.fromFormat(text, fmt, opts);
    };

    /**
     * Create a DateTime from a SQL date, time, or datetime
     * Defaults to en-US if no locale has been specified, regardless of the system's locale
     * @param {string} text - the string to parse
     * @param {Object} options - options to affect the creation
     * @param {string|Zone} [options.zone='local'] - use this zone if no offset is specified in the input string itself. Will also convert the DateTime to this zone
     * @param {boolean} [options.setZone=false] - override the zone with a zone specified in the string itself, if it specifies one
     * @param {string} [options.locale='en-US'] - a locale string to use when parsing. Will also set the DateTime to this locale
     * @param {string} options.numberingSystem - the numbering system to use when parsing. Will also set the resulting DateTime to this numbering system
     * @param {string} options.outputCalendar - the output calendar to set on the resulting DateTime instance
     * @example DateTime.fromSQL('2017-05-15')
     * @example DateTime.fromSQL('2017-05-15 09:12:34')
     * @example DateTime.fromSQL('2017-05-15 09:12:34.342')
     * @example DateTime.fromSQL('2017-05-15 09:12:34.342+06:00')
     * @example DateTime.fromSQL('2017-05-15 09:12:34.342 America/Los_Angeles')
     * @example DateTime.fromSQL('2017-05-15 09:12:34.342 America/Los_Angeles', { setZone: true })
     * @example DateTime.fromSQL('2017-05-15 09:12:34.342', { zone: 'America/Los_Angeles' })
     * @example DateTime.fromSQL('09:12:34.342')
     * @return {DateTime}
     */


    DateTime.fromSQL = function fromSQL(text) {
      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      var _parseSQL = parseSQL(text),
          vals = _parseSQL[0],
          parsedZone = _parseSQL[1];

      return parseDataToDateTime(vals, parsedZone, options);
    };

    /**
     * Create an invalid DateTime.
     * @return {DateTime}
     */


    DateTime.invalid = function invalid(reason) {
      if (!reason) {
        throw new InvalidArgumentError('need to specify a reason the DateTime is invalid');
      }
      if (Settings.throwOnInvalid) {
        throw new InvalidDateTimeError(reason);
      } else {
        return new DateTime({ invalidReason: reason });
      }
    };

    // INFO

    /**
     * Get the value of unit.
     * @param {string} unit - a unit such as 'minute' or 'day'
     * @example DateTime.local(2017, 7, 4).get('month'); //=> 7
     * @example DateTime.local(2017, 7, 4).get('day'); //=> 4
     * @return {number}
     */


    DateTime.prototype.get = function get$$1(unit) {
      return this[unit];
    };

    /**
     * Returns whether the DateTime is valid. Invalid DateTimes occur when:
     * * The DateTime was created from invalid calendar information, such as the 13th month or February 30
     * * The DateTime was created by an operation on another invalid date
     * @type {boolean}
     */


    /**
     * Returns the resolved Intl options for this DateTime.
     * This is useful in understanding the behavior of formatting methods
     * @param {Object} opts - the same options as toLocaleString
     * @return {Object}
     */
    DateTime.prototype.resolvedLocaleOpts = function resolvedLocaleOpts() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      var _Formatter$create$res = Formatter.create(this.loc.clone(opts), opts).resolvedOptions(this),
          locale = _Formatter$create$res.locale,
          numberingSystem = _Formatter$create$res.numberingSystem,
          calendar = _Formatter$create$res.calendar;

      return { locale: locale, numberingSystem: numberingSystem, outputCalendar: calendar };
    };

    // TRANSFORM

    /**
     * "Set" the DateTime's zone to UTC. Returns a newly-constructed DateTime.
     *
     * Equivalent to {@link setZone}('utc')
     * @param {number} [offset=0] - optionally, an offset from UTC in minutes
     * @param {Object} [opts={}] - options to pass to `setZone()`
     * @return {DateTime}
     */


    DateTime.prototype.toUTC = function toUTC() {
      var offset = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 0;
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return this.setZone(FixedOffsetZone.instance(offset), opts);
    };

    /**
     * "Set" the DateTime's zone to the host's local zone. Returns a newly-constructed DateTime.
     *
     * Equivalent to `setZone('local')`
     * @return {DateTime}
     */


    DateTime.prototype.toLocal = function toLocal() {
      return this.setZone(new LocalZone());
    };

    /**
     * "Set" the DateTime's zone to specified zone. Returns a newly-constructed DateTime.
     *
     * By default, the setter keeps the underlying time the same (as in, the same UTC timestamp), but the new instance will report different local times and consider DSTs when making computations, as with {@link plus}. You may wish to use {@link toLocal} and {@link toUTC} which provide simple convenience wrappers for commonly used zones.
     * @param {string|Zone} [zone='local'] - a zone identifier. As a string, that can be any IANA zone supported by the host environment, or a fixed-offset name of the form 'utc+3', or the strings 'local' or 'utc'. You may also supply an instance of a {@link Zone} class.
     * @param {Object} opts - options
     * @param {boolean} [opts.keepLocalTime=false] - If true, adjust the underlying time so that the local time stays the same, but in the target zone. You should rarely need this.
     * @return {DateTime}
     */


    DateTime.prototype.setZone = function setZone(zone) {
      var _ref4 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
          _ref4$keepLocalTime = _ref4.keepLocalTime,
          keepLocalTime = _ref4$keepLocalTime === undefined ? false : _ref4$keepLocalTime,
          _ref4$keepCalendarTim = _ref4.keepCalendarTime,
          keepCalendarTime = _ref4$keepCalendarTim === undefined ? false : _ref4$keepCalendarTim;

      zone = normalizeZone(zone, Settings.defaultZone);
      if (zone.equals(this.zone)) {
        return this;
      } else if (!zone.isValid) {
        return DateTime.invalid(UNSUPPORTED_ZONE);
      } else {
        var newTS = keepLocalTime || keepCalendarTime // keepCalendarTime is the deprecated name for keepLocalTime
        ? this.ts + (this.o - zone.offset(this.ts)) * 60 * 1000 : this.ts;
        return clone$1(this, { ts: newTS, zone: zone });
      }
    };

    /**
     * "Set" the locale, numberingSystem, or outputCalendar. Returns a newly-constructed DateTime.
     * @param {Object} properties - the properties to set
     * @example DateTime.local(2017, 5, 25).reconfigure({ locale: 'en-GB' })
     * @return {DateTime}
     */


    DateTime.prototype.reconfigure = function reconfigure() {
      var _ref5 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          locale = _ref5.locale,
          numberingSystem = _ref5.numberingSystem,
          outputCalendar = _ref5.outputCalendar;

      var loc = this.loc.clone({ locale: locale, numberingSystem: numberingSystem, outputCalendar: outputCalendar });
      return clone$1(this, { loc: loc });
    };

    /**
     * "Set" the locale. Returns a newly-constructed DateTime.
     * Just a convenient alias for reconfigure({ locale })
     * @example DateTime.local(2017, 5, 25).setLocale('en-GB')
     * @return {DateTime}
     */


    DateTime.prototype.setLocale = function setLocale(locale) {
      return this.reconfigure({ locale: locale });
    };

    /**
     * "Set" the values of specified units. Returns a newly-constructed DateTime.
     * You can only set units with this method; for "setting" metadata, see {@link reconfigure} and {@link setZone}.
     * @param {Object} values - a mapping of units to numbers
     * @example dt.set({ year: 2017 })
     * @example dt.set({ hour: 8, minute: 30 })
     * @example dt.set({ weekday: 5 })
     * @example dt.set({ year: 2005, ordinal: 234 })
     * @return {DateTime}
     */


    DateTime.prototype.set = function set$$1(values) {
      if (!this.isValid) return this;

      var normalized = normalizeObject(values, normalizeUnit),
          settingWeekStuff = !isUndefined(normalized.weekYear) || !isUndefined(normalized.weekNumber) || !isUndefined(normalized.weekday);

      var mixed = void 0;
      if (settingWeekStuff) {
        mixed = weekToGregorian(Object.assign(gregorianToWeek(this.c), normalized));
      } else if (!isUndefined(normalized.ordinal)) {
        mixed = ordinalToGregorian(Object.assign(gregorianToOrdinal(this.c), normalized));
      } else {
        mixed = Object.assign(this.toObject(), normalized);

        // if we didn't set the day but we ended up on an overflow date,
        // use the last day of the right month
        if (isUndefined(normalized.day)) {
          mixed.day = Math.min(daysInMonth(mixed.year, mixed.month), mixed.day);
        }
      }

      var _objToTS3 = objToTS(mixed, this.o, this.zone),
          ts = _objToTS3[0],
          o = _objToTS3[1];

      return clone$1(this, { ts: ts, o: o });
    };

    /**
     * Add a period of time to this DateTime and return the resulting DateTime
     *
     * Adding hours, minutes, seconds, or milliseconds increases the timestamp by the right number of milliseconds. Adding days, months, or years shifts the calendar, accounting for DSTs and leap years along the way. Thus, `dt.plus({ hours: 24 })` may result in a different time than `dt.plus({ days: 1 })` if there's a DST shift in between.
     * @param {Duration|Object|number} duration - The amount to add. Either a Luxon Duration, a number of milliseconds, the object argument to Duration.fromObject()
     * @example DateTime.local().plus(123) //~> in 123 milliseconds
     * @example DateTime.local().plus({ minutes: 15 }) //~> in 15 minutes
     * @example DateTime.local().plus({ days: 1 }) //~> this time tomorrow
     * @example DateTime.local().plus({ days: -1 }) //~> this time yesterday
     * @example DateTime.local().plus({ hours: 3, minutes: 13 }) //~> in 1 hr, 13 min
     * @example DateTime.local().plus(Duration.fromObject({ hours: 3, minutes: 13 })) //~> in 1 hr, 13 min
     * @return {DateTime}
     */


    DateTime.prototype.plus = function plus(duration) {
      if (!this.isValid) return this;
      var dur = friendlyDuration(duration);
      return clone$1(this, adjustTime(this, dur));
    };

    /**
     * Subtract a period of time to this DateTime and return the resulting DateTime
     * See {@link plus}
     * @param {Duration|Object|number} duration - The amount to subtract. Either a Luxon Duration, a number of milliseconds, the object argument to Duration.fromObject()
     @return {DateTime}
    */


    DateTime.prototype.minus = function minus(duration) {
      if (!this.isValid) return this;
      var dur = friendlyDuration(duration).negate();
      return clone$1(this, adjustTime(this, dur));
    };

    /**
     * "Set" this DateTime to the beginning of a unit of time.
     * @param {string} unit - The unit to go to the beginning of. Can be 'year', 'month', 'day', 'hour', 'minute', 'second', or 'millisecond'.
     * @example DateTime.local(2014, 3, 3).startOf('month').toISODate(); //=> '2014-03-01'
     * @example DateTime.local(2014, 3, 3).startOf('year').toISODate(); //=> '2014-01-01'
     * @example DateTime.local(2014, 3, 3, 5, 30).startOf('day').toISOTime(); //=> '00:00.000-05:00'
     * @example DateTime.local(2014, 3, 3, 5, 30).startOf('hour').toISOTime(); //=> '05:00:00.000-05:00'
     * @return {DateTime}
     */


    DateTime.prototype.startOf = function startOf(unit) {
      if (!this.isValid) return this;
      var o = {},
          normalizedUnit = Duration.normalizeUnit(unit);
      switch (normalizedUnit) {
        case 'years':
          o.month = 1;
        // falls through
        case 'quarters':
        case 'months':
          o.day = 1;
        // falls through
        case 'weeks':
        case 'days':
          o.hour = 0;
        // falls through
        case 'hours':
          o.minute = 0;
        // falls through
        case 'minutes':
          o.second = 0;
        // falls through
        case 'seconds':
          o.millisecond = 0;
          break;
        case 'milliseconds':
          break;
        default:
          throw new InvalidUnitError(unit);
      }

      if (normalizedUnit === 'weeks') {
        o.weekday = 1;
      }

      if (normalizedUnit === 'quarters') {
        var q = Math.ceil(this.month / 3);
        o.month = (q - 1) * 3 + 1;
      }

      return this.set(o);
    };

    /**
     * "Set" this DateTime to the end (i.e. the last millisecond) of a unit of time
     * @param {string} unit - The unit to go to the end of. Can be 'year', 'month', 'day', 'hour', 'minute', 'second', or 'millisecond'.
     * @example DateTime.local(2014, 3, 3).endOf('month').toISO(); //=> '2014-03-31T23:59:59.999-05:00'
     * @example DateTime.local(2014, 3, 3).endOf('year').toISO(); //=> '2014-12-31T23:59:59.999-05:00'
     * @example DateTime.local(2014, 3, 3, 5, 30).endOf('day').toISO(); //=> '2014-03-03T23:59:59.999-05:00'
     * @example DateTime.local(2014, 3, 3, 5, 30).endOf('hour').toISO(); //=> '2014-03-03T05:59:59.999-05:00'
     * @return {DateTime}
     */


    DateTime.prototype.endOf = function endOf(unit) {
      var _startOf$plus;

      return this.isValid ? this.startOf(unit).plus((_startOf$plus = {}, _startOf$plus[unit] = 1, _startOf$plus)).minus(1) : this;
    };

    // OUTPUT

    /**
     * Returns a string representation of this DateTime formatted according to the specified format string.
     * **You may not want this.** See {@link toLocaleString} for a more flexible formatting tool. See the documentation for the specific format tokens supported.
     * Defaults to en-US if no locale has been specified, regardless of the system's locale
     * @param {string} fmt - the format string
     * @param {Object} opts - options
     * @param {boolean} opts.round - round numerical values
     * @example DateTime.local().toFormat('yyyy LLL dd') //=> '2017 Apr 22'
     * @example DateTime.local().setLocale('fr').toFormat('yyyy LLL dd') //=> '2017 avr. 22'
     * @example DateTime.local().toFormat("HH 'hours and' mm 'minutes'") //=> '20 hours and 55 minutes'
     * @return {string}
     */


    DateTime.prototype.toFormat = function toFormat(fmt) {
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return this.isValid ? Formatter.create(this.loc.redefaultToEN(), opts).formatDateTimeFromString(this, fmt) : INVALID$2;
    };

    /**
     * Returns a localized string representing this date. Accepts the same options as the Intl.DateTimeFormat constructor and any presets defined by Luxon, such as `DateTime.DATE_FULL` or `DateTime.TIME_SIMPLE`.
     * The exact behavior of this method is browser-specific, but in general it will return an appropriate representation.
     * of the DateTime in the assigned locale.
     * Defaults to the system's locale if no locale has been specified
     * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DateTimeFormat
     * @param opts {Object} - Intl.DateTimeFormat constructor options
     * @example DateTime.local().toLocaleString(); //=> 4/20/2017
     * @example DateTime.local().setLocale('en-gb').toLocaleString(); //=> '20/04/2017'
     * @example DateTime.local().toLocaleString(DateTime.DATE_FULL); //=> 'April 20, 2017'
     * @example DateTime.local().toLocaleString(DateTime.TIME_SIMPLE); //=> '11:32 AM'
     * @example DateTime.local().toLocaleString(DateTime.DATETIME_SHORT); //=> '4/20/2017, 11:32 AM'
     * @example DateTime.local().toLocaleString({weekday: 'long', month: 'long', day: '2-digit'}); //=> 'Thu, Apr 20'
     * @example DateTime.local().toLocaleString({weekday: 'long', month: 'long', day: '2-digit', hour: '2-digit', minute: '2-digit'}); //=> 'Thu, Apr 20, 11:27'
     * @example DateTime.local().toLocaleString({hour: '2-digit', minute: '2-digit'}); //=> '11:32'
     * @return {string}
     */


    DateTime.prototype.toLocaleString = function toLocaleString() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : DATE_SHORT;

      return this.isValid ? Formatter.create(this.loc.clone(opts), opts).formatDateTime(this) : INVALID$2;
    };

    /**
     * Returns an array of format "parts", i.e. individual tokens along with metadata. This is allows callers to post-process individual sections of the formatted output.
     * Defaults to the system's locale if no locale has been specified
     * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/DateTimeFormat/formatToParts
     * @param opts {Object} - Intl.DateTimeFormat constructor options, same as `toLocaleString`.
     * @example DateTime.local().toLocaleString(); //=> [
     *                                    //=>   { type: 'day', value: '25' },
     *                                    //=>   { type: 'literal', value: '/' },
     *                                    //=>   { type: 'month', value: '05' },
     *                                    //=>   { type: 'literal', value: '/' },
     *                                    //=>   { type: 'year', value: '1982' }
     *                                    //=> ]
     */


    DateTime.prototype.toLocaleParts = function toLocaleParts() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      return this.isValid ? Formatter.create(this.loc.clone(opts), opts).formatDateTimeParts(this) : [];
    };

    /**
     * Returns an ISO 8601-compliant string representation of this DateTime
     * @param {Object} opts - options
     * @param {boolean} [opts.suppressMilliseconds=false] - exclude milliseconds from the format if they're 0
     * @param {boolean} [opts.suppressSeconds=false] - exclude seconds from the format if they're 0
     * @param {boolean} [opts.includeOffset=true] - include the offset, such as 'Z' or '-04:00'
     * @example DateTime.utc(1982, 5, 25).toISO() //=> '1982-05-25T00:00:00.000Z'
     * @example DateTime.local().toISO() //=> '2017-04-22T20:47:05.335-04:00'
     * @example DateTime.local().toISO({ includeOffset: false }) //=> '2017-04-22T20:47:05.335'
     * @return {string}
     */


    DateTime.prototype.toISO = function toISO() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (!this.isValid) {
        return null;
      }

      return this.toISODate() + 'T' + this.toISOTime(opts);
    };

    /**
     * Returns an ISO 8601-compliant string representation of this DateTime's date component
     * @example DateTime.utc(1982, 5, 25).toISODate() //=> '1982-05-25'
     * @return {string}
     */


    DateTime.prototype.toISODate = function toISODate() {
      return toTechFormat(this, 'yyyy-MM-dd');
    };

    /**
     * Returns an ISO 8601-compliant string representation of this DateTime's week date
     * @example DateTime.utc(1982, 5, 25).toISOWeekDate() //=> '1982-W21-2'
     * @return {string}
     */


    DateTime.prototype.toISOWeekDate = function toISOWeekDate() {
      return toTechFormat(this, "kkkk-'W'WW-c");
    };

    /**
     * Returns an ISO 8601-compliant string representation of this DateTime's time component
     * @param {Object} opts - options
     * @param {boolean} [opts.suppressMilliseconds=false] - exclude milliseconds from the format if they're 0
     * @param {boolean} [opts.suppressSeconds=false] - exclude seconds from the format if they're 0
     * @param {boolean} [opts.includeOffset=true] - include the offset, such as 'Z' or '-04:00'
     * @example DateTime.utc().hour(7).minute(34).toISOTime() //=> '07:34:19.361Z'
     * @example DateTime.utc().hour(7).minute(34).toISOTime({ suppressSeconds: true }) //=> '07:34Z'
     * @return {string}
     */


    DateTime.prototype.toISOTime = function toISOTime() {
      var _ref6 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          _ref6$suppressMillise = _ref6.suppressMilliseconds,
          suppressMilliseconds = _ref6$suppressMillise === undefined ? false : _ref6$suppressMillise,
          _ref6$suppressSeconds = _ref6.suppressSeconds,
          suppressSeconds = _ref6$suppressSeconds === undefined ? false : _ref6$suppressSeconds,
          _ref6$includeOffset = _ref6.includeOffset,
          includeOffset = _ref6$includeOffset === undefined ? true : _ref6$includeOffset;

      return toTechTimeFormat(this, { suppressSeconds: suppressSeconds, suppressMilliseconds: suppressMilliseconds, includeOffset: includeOffset });
    };

    /**
     * Returns an RFC 2822-compatible string representation of this DateTime, always in UTC
     * @example DateTime.utc(2014, 7, 13).toRFC2822() //=> 'Sun, 13 Jul 2014 00:00:00 +0000'
     * @example DateTime.local(2014, 7, 13).toRFC2822() //=> 'Sun, 13 Jul 2014 00:00:00 -0400'
     * @return {string}
     */


    DateTime.prototype.toRFC2822 = function toRFC2822() {
      return toTechFormat(this, 'EEE, dd LLL yyyy hh:mm:ss ZZZ');
    };

    /**
     * Returns a string representation of this DateTime appropriate for use in HTTP headers.
     * Specifically, the string conforms to RFC 1123.
     * @see https://www.w3.org/Protocols/rfc2616/rfc2616-sec3.html#sec3.3.1
     * @example DateTime.utc(2014, 7, 13).toHTTP() //=> 'Sun, 13 Jul 2014 00:00:00 GMT'
     * @example DateTime.utc(2014, 7, 13, 19).toHTTP() //=> 'Sun, 13 Jul 2014 19:00:00 GMT'
     * @return {string}
     */


    DateTime.prototype.toHTTP = function toHTTP() {
      return toTechFormat(this.toUTC(), "EEE, dd LLL yyyy HH:mm:ss 'GMT'");
    };

    /**
     * Returns a string representation of this DateTime appropriate for use in SQL Date
     * @example DateTime.utc(2014, 7, 13).toSQLDate() //=> '2014-07-13'
     * @return {string}
     */


    DateTime.prototype.toSQLDate = function toSQLDate() {
      return toTechFormat(this, 'yyyy-MM-dd');
    };

    /**
     * Returns a string representation of this DateTime appropriate for use in SQL Time
     * @param {Object} opts - options
     * @param {boolean} [opts.includeZone=false] - include the zone, such as 'America/New_York'. Overides includeOffset.
     * @param {boolean} [opts.includeOffset=true] - include the offset, such as 'Z' or '-04:00'
     * @example DateTime.utc().toSQL() //=> '05:15:16.345'
     * @example DateTime.local().toSQL() //=> '05:15:16.345 -04:00'
     * @example DateTime.local().toSQL({ includeOffset: false }) //=> '05:15:16.345'
     * @example DateTime.local().toSQL({ includeZone: false }) //=> '05:15:16.345 America/New_York'
     * @return {string}
     */


    DateTime.prototype.toSQLTime = function toSQLTime() {
      var _ref7 = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
          _ref7$includeOffset = _ref7.includeOffset,
          includeOffset = _ref7$includeOffset === undefined ? true : _ref7$includeOffset,
          _ref7$includeZone = _ref7.includeZone,
          includeZone = _ref7$includeZone === undefined ? false : _ref7$includeZone;

      return toTechTimeFormat(this, { includeOffset: includeOffset, includeZone: includeZone, spaceZone: true });
    };

    /**
     * Returns a string representation of this DateTime appropriate for use in SQL DateTime
     * @param {Object} opts - options
     * @param {boolean} [opts.includeZone=false] - include the zone, such as 'America/New_York'. Overrides includeOffset.
     * @param {boolean} [opts.includeOffset=true] - include the offset, such as 'Z' or '-04:00'
     * @example DateTime.utc(2014, 7, 13).toSQL() //=> '2014-07-13 00:00:00.000 Z'
     * @example DateTime.local(2014, 7, 13).toSQL() //=> '2014-07-13 00:00:00.000 -04:00'
     * @example DateTime.local(2014, 7, 13).toSQL({ includeOffset: false }) //=> '2014-07-13 00:00:00.000'
     * @example DateTime.local(2014, 7, 13).toSQL({ includeZone: false }) //=> '2014-07-13 00:00:00.000 America/New_York'
     * @return {string}
     */


    DateTime.prototype.toSQL = function toSQL() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (!this.isValid) {
        return null;
      }

      return this.toSQLDate() + ' ' + this.toSQLTime(opts);
    };

    /**
     * Returns a string representation of this DateTime appropriate for debugging
     * @return {string}
     */


    DateTime.prototype.toString = function toString() {
      return this.isValid ? this.toISO() : INVALID$2;
    };

    /**
     * Returns a string representation of this DateTime appropriate for the REPL.
     * @return {string}
     */


    DateTime.prototype.inspect = function inspect() {
      if (this.isValid) {
        return 'DateTime {\n  ts: ' + this.toISO() + ',\n  zone: ' + this.zone.name + ',\n  locale: ' + this.locale + ' }';
      } else {
        return 'DateTime { Invalid, reason: ' + this.invalidReason + ' }';
      }
    };

    /**
     * Returns the epoch milliseconds of this DateTime
     * @return {number}
     */


    DateTime.prototype.valueOf = function valueOf() {
      return this.isValid ? this.ts : NaN;
    };

    /**
     * Returns the epoch milliseconds of this DateTime. Alias of {@link valueOf}
     * @return {number}
     */


    DateTime.prototype.toMillis = function toMillis() {
      return this.valueOf();
    };

    /**
     * Returns an ISO 8601 representation of this DateTime appropriate for use in JSON.
     * @return {string}
     */


    DateTime.prototype.toJSON = function toJSON() {
      return this.toISO();
    };

    /**
     * Returns a Javascript object with this DateTime's year, month, day, and so on.
     * @param opts - options for generating the object
     * @param {boolean} [opts.includeConfig=false] - include configuration attributes in the output
     * @example DateTime.local().toObject() //=> { year: 2017, month: 4, day: 22, hour: 20, minute: 49, second: 42, millisecond: 268 }
     * @return {Object}
     */


    DateTime.prototype.toObject = function toObject() {
      var opts = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

      if (!this.isValid) return {};

      var base = Object.assign({}, this.c);

      if (opts.includeConfig) {
        base.outputCalendar = this.outputCalendar;
        base.numberingSystem = this.loc.numberingSystem;
        base.locale = this.loc.locale;
      }
      return base;
    };

    /**
     * Returns a Javascript Date equivalent to this DateTime.
     * @return {Date}
     */


    DateTime.prototype.toJSDate = function toJSDate() {
      return new Date(this.isValid ? this.ts : NaN);
    };

    // COMPARE

    /**
     * Return the difference between two DateTimes as a Duration.
     * @param {DateTime} otherDateTime - the DateTime to compare this one to
     * @param {string|string[]} [unit=['milliseconds']] - the unit or array of units (such as 'hours' or 'days') to include in the duration.
     * @param {Object} opts - options that affect the creation of the Duration
     * @param {string} [opts.conversionAccuracy='casual'] - the conversion system to use
     * @example
     * var i1 = DateTime.fromISO('1982-05-25T09:45'),
     *     i2 = DateTime.fromISO('1983-10-14T10:30');
     * i2.diff(i1).toObject() //=> { milliseconds: 43807500000 }
     * i2.diff(i1, 'hours').toObject() //=> { hours: 12168.75 }
     * i2.diff(i1, ['months', 'days']).toObject() //=> { months: 16, days: 19.03125 }
     * i2.diff(i1, ['months', 'days', 'hours']).toObject() //=> { months: 16, days: 19, hours: 0.75 }
     * @return {Duration}
     */


    DateTime.prototype.diff = function diff(otherDateTime) {
      var unit = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 'milliseconds';
      var opts = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      if (!this.isValid || !otherDateTime.isValid) return Duration.invalid(this.invalidReason || otherDateTime.invalidReason);

      var units = maybeArray(unit).map(Duration.normalizeUnit),
          otherIsLater = otherDateTime.valueOf() > this.valueOf(),
          earlier = otherIsLater ? this : otherDateTime,
          later = otherIsLater ? otherDateTime : this,
          diffed = _diff(earlier, later, units, opts);

      return otherIsLater ? diffed.negate() : diffed;
    };

    /**
     * Return the difference between this DateTime and right now.
     * See {@link diff}
     * @param {string|string[]} [unit=['milliseconds']] - the unit or units units (such as 'hours' or 'days') to include in the duration
     * @param {Object} opts - options that affect the creation of the Duration
     * @param {string} [opts.conversionAccuracy='casual'] - the conversion system to use
     * @return {Duration}
     */


    DateTime.prototype.diffNow = function diffNow() {
      var unit = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 'milliseconds';
      var opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

      return this.diff(DateTime.local(), unit, opts);
    };

    /**
     * Return an Interval spanning between this DateTime and another DateTime
     * @param {DateTime} otherDateTime - the other end point of the Interval
     * @return {Interval}
     */


    DateTime.prototype.until = function until(otherDateTime) {
      return this.isValid ? Interval.fromDateTimes(this, otherDateTime) : this;
    };

    /**
     * Return whether this DateTime is in the same unit of time as another DateTime
     * @param {DateTime} otherDateTime - the other DateTime
     * @param {string} unit - the unit of time to check sameness on
     * @example DateTime.local().hasSame(otherDT, 'day'); //~> true if both the same calendar day
     * @return {boolean}
     */


    DateTime.prototype.hasSame = function hasSame(otherDateTime, unit) {
      if (!this.isValid) return false;
      if (unit === 'millisecond') {
        return this.valueOf() === otherDateTime.valueOf();
      } else {
        var inputMs = otherDateTime.valueOf();
        return this.startOf(unit) <= inputMs && inputMs <= this.endOf(unit);
      }
    };

    /**
     * Equality check
     * Two DateTimes are equal iff they represent the same millisecond
     * @param {DateTime} other - the other DateTime
     * @return {boolean}
     */


    DateTime.prototype.equals = function equals(other) {
      return this.isValid && other.isValid ? this.valueOf() === other.valueOf() && this.zone.equals(other.zone) && this.loc.equals(other.loc) : false;
    };

    /**
     * Return the min of several date times
     * @param {...DateTime} dateTimes - the DateTimes from which to choose the minimum
     * @return {DateTime} the min DateTime, or undefined if called with no argument
     */


    DateTime.min = function min() {
      for (var _len = arguments.length, dateTimes = Array(_len), _key = 0; _key < _len; _key++) {
        dateTimes[_key] = arguments[_key];
      }

      return bestBy(dateTimes, function (i) {
        return i.valueOf();
      }, Math.min);
    };

    /**
     * Return the max of several date times
     * @param {...DateTime} dateTimes - the DateTimes from which to choose the maximum
     * @return {DateTime} the max DateTime, or undefined if called with no argument
     */


    DateTime.max = function max() {
      for (var _len2 = arguments.length, dateTimes = Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        dateTimes[_key2] = arguments[_key2];
      }

      return bestBy(dateTimes, function (i) {
        return i.valueOf();
      }, Math.max);
    };

    // MISC

    /**
     * Explain how a string would be parsed by fromFormat()
     * @param {string} text - the string to parse
     * @param {string} fmt - the format the string is expected to be in (see description)
     * @param {Object} options - options taken by fromFormat()
     * @return {Object}
     */


    DateTime.fromFormatExplain = function fromFormatExplain(text, fmt) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
      var _options$locale2 = options.locale,
          locale = _options$locale2 === undefined ? null : _options$locale2,
          _options$numberingSys2 = options.numberingSystem,
          numberingSystem = _options$numberingSys2 === undefined ? null : _options$numberingSys2,
          localeToUse = Locale.fromOpts({ locale: locale, numberingSystem: numberingSystem, defaultToEN: true });

      return explainFromTokens(localeToUse, text, fmt);
    };

    /**
     * @deprecated use fromFormatExplain instead
     */


    DateTime.fromStringExplain = function fromStringExplain(text, fmt) {
      var options = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

      return DateTime.fromFormatExplain(text, fmt, options);
    };

    // FORMAT PRESETS

    /**
     * {@link toLocaleString} format like 10/14/1983
     * @type {Object}
     */


    createClass(DateTime, [{
      key: 'isValid',
      get: function get$$1() {
        return this.invalidReason === null;
      }

      /**
       * Returns an explanation of why this DateTime became invalid, or null if the DateTime is valid
       * @type {string}
       */

    }, {
      key: 'invalidReason',
      get: function get$$1() {
        return this.invalid;
      }

      /**
       * Get the locale of a DateTime, such 'en-GB'. The locale is used when formatting the DateTime
       *
       * @type {string}
       */

    }, {
      key: 'locale',
      get: function get$$1() {
        return this.isValid ? this.loc.locale : null;
      }

      /**
       * Get the numbering system of a DateTime, such 'beng'. The numbering system is used when formatting the DateTime
       *
       * @type {string}
       */

    }, {
      key: 'numberingSystem',
      get: function get$$1() {
        return this.isValid ? this.loc.numberingSystem : null;
      }

      /**
       * Get the output calendar of a DateTime, such 'islamic'. The output calendar is used when formatting the DateTime
       *
       * @type {string}
       */

    }, {
      key: 'outputCalendar',
      get: function get$$1() {
        return this.isValid ? this.loc.outputCalendar : null;
      }

      /**
       * Get the name of the time zone.
       * @type {string}
       */

    }, {
      key: 'zoneName',
      get: function get$$1() {
        return this.isValid ? this.zone.name : null;
      }

      /**
       * Get the year
       * @example DateTime.local(2017, 5, 25).year //=> 2017
       * @type {number}
       */

    }, {
      key: 'year',
      get: function get$$1() {
        return this.isValid ? this.c.year : NaN;
      }

      /**
       * Get the quarter
       * @example DateTime.local(2017, 5, 25).quarter //=> 2
       * @type {number}
       */

    }, {
      key: 'quarter',
      get: function get$$1() {
        return this.isValid ? Math.ceil(this.c.month / 3) : NaN;
      }
      /**
       * Get the month (1-12).
       * @example DateTime.local(2017, 5, 25).month //=> 5
       * @type {number}
       */

    }, {
      key: 'month',
      get: function get$$1() {
        return this.isValid ? this.c.month : NaN;
      }

      /**
       * Get the day of the month (1-30ish).
       * @example DateTime.local(2017, 5, 25).day //=> 25
       * @type {number}
       */

    }, {
      key: 'day',
      get: function get$$1() {
        return this.isValid ? this.c.day : NaN;
      }

      /**
       * Get the hour of the day (0-23).
       * @example DateTime.local(2017, 5, 25, 9).hour //=> 9
       * @type {number}
       */

    }, {
      key: 'hour',
      get: function get$$1() {
        return this.isValid ? this.c.hour : NaN;
      }

      /**
       * Get the minute of the hour (0-59).
       * @example DateTime.local(2017, 5, 25, 9, 30).minute //=> 30
       * @type {number}
       */

    }, {
      key: 'minute',
      get: function get$$1() {
        return this.isValid ? this.c.minute : NaN;
      }

      /**
       * Get the second of the minute (0-59).
       * @example DateTime.local(2017, 5, 25, 9, 30, 52).second //=> 52
       * @type {number}
       */

    }, {
      key: 'second',
      get: function get$$1() {
        return this.isValid ? this.c.second : NaN;
      }

      /**
       * Get the millisecond of the second (0-999).
       * @example DateTime.local(2017, 5, 25, 9, 30, 52, 654).millisecond //=> 654
       * @type {number}
       */

    }, {
      key: 'millisecond',
      get: function get$$1() {
        return this.isValid ? this.c.millisecond : NaN;
      }

      /**
       * Get the week year
       * @see https://en.wikipedia.org/wiki/ISO_week_date
       * @example DateTime.local(2014, 11, 31).weekYear //=> 2015
       * @type {number}
       */

    }, {
      key: 'weekYear',
      get: function get$$1() {
        return this.isValid ? possiblyCachedWeekData(this).weekYear : NaN;
      }

      /**
       * Get the week number of the week year (1-52ish).
       * @see https://en.wikipedia.org/wiki/ISO_week_date
       * @example DateTime.local(2017, 5, 25).weekNumber //=> 21
       * @type {number}
       */

    }, {
      key: 'weekNumber',
      get: function get$$1() {
        return this.isValid ? possiblyCachedWeekData(this).weekNumber : NaN;
      }

      /**
       * Get the day of the week.
       * 1 is Monday and 7 is Sunday
       * @see https://en.wikipedia.org/wiki/ISO_week_date
       * @example DateTime.local(2014, 11, 31).weekday //=> 4
       * @type {number}
       */

    }, {
      key: 'weekday',
      get: function get$$1() {
        return this.isValid ? possiblyCachedWeekData(this).weekday : NaN;
      }

      /**
       * Get the ordinal (i.e. the day of the year)
       * @example DateTime.local(2017, 5, 25).ordinal //=> 145
       * @type {number|DateTime}
       */

    }, {
      key: 'ordinal',
      get: function get$$1() {
        return this.isValid ? gregorianToOrdinal(this.c).ordinal : NaN;
      }

      /**
       * Get the human readable short month name, such as 'Oct'.
       * Defaults to the system's locale if no locale has been specified
       * @example DateTime.local(2017, 10, 30).monthShort //=> Oct
       * @type {string}
       */

    }, {
      key: 'monthShort',
      get: function get$$1() {
        return this.isValid ? Info.months('short', { locale: this.locale })[this.month - 1] : null;
      }

      /**
       * Get the human readable long month name, such as 'October'.
       * Defaults to the system's locale if no locale has been specified
       * @example DateTime.local(2017, 10, 30).monthLong //=> October
       * @type {string}
       */

    }, {
      key: 'monthLong',
      get: function get$$1() {
        return this.isValid ? Info.months('long', { locale: this.locale })[this.month - 1] : null;
      }

      /**
       * Get the human readable short weekday, such as 'Mon'.
       * Defaults to the system's locale if no locale has been specified
       * @example DateTime.local(2017, 10, 30).weekdayShort //=> Mon
       * @type {string}
       */

    }, {
      key: 'weekdayShort',
      get: function get$$1() {
        return this.isValid ? Info.weekdays('short', { locale: this.locale })[this.weekday - 1] : null;
      }

      /**
       * Get the human readable long weekday, such as 'Monday'.
       * Defaults to the system's locale if no locale has been specified
       * @example DateTime.local(2017, 10, 30).weekdayLong //=> Monday
       * @type {string}
       */

    }, {
      key: 'weekdayLong',
      get: function get$$1() {
        return this.isValid ? Info.weekdays('long', { locale: this.locale })[this.weekday - 1] : null;
      }

      /**
       * Get the UTC offset of this DateTime in minutes
       * @example DateTime.local().offset //=> -240
       * @example DateTime.utc().offset //=> 0
       * @type {number}
       */

    }, {
      key: 'offset',
      get: function get$$1() {
        return this.isValid ? this.zone.offset(this.ts) : NaN;
      }

      /**
       * Get the short human name for the zone's current offset, for example "EST" or "EDT".
       * Defaults to the system's locale if no locale has been specified
       * @type {string}
       */

    }, {
      key: 'offsetNameShort',
      get: function get$$1() {
        if (this.isValid) {
          return this.zone.offsetName(this.ts, {
            format: 'short',
            locale: this.locale
          });
        } else {
          return null;
        }
      }

      /**
       * Get the long human name for the zone's current offset, for example "Eastern Standard Time" or "Eastern Daylight Time".
       * Defaults to the system's locale if no locale has been specified
       * @type {string}
       */

    }, {
      key: 'offsetNameLong',
      get: function get$$1() {
        if (this.isValid) {
          return this.zone.offsetName(this.ts, {
            format: 'long',
            locale: this.locale
          });
        } else {
          return null;
        }
      }

      /**
       * Get whether this zone's offset ever changes, as in a DST.
       * @type {boolean}
       */

    }, {
      key: 'isOffsetFixed',
      get: function get$$1() {
        return this.isValid ? this.zone.universal : null;
      }

      /**
       * Get whether the DateTime is in a DST.
       * @type {boolean}
       */

    }, {
      key: 'isInDST',
      get: function get$$1() {
        if (this.isOffsetFixed) {
          return false;
        } else {
          return this.offset > this.set({ month: 1 }).offset || this.offset > this.set({ month: 5 }).offset;
        }
      }

      /**
       * Returns true if this DateTime is in a leap year, false otherwise
       * @example DateTime.local(2016).isInLeapYear //=> true
       * @example DateTime.local(2013).isInLeapYear //=> false
       * @type {boolean}
       */

    }, {
      key: 'isInLeapYear',
      get: function get$$1() {
        return isLeapYear(this.year);
      }

      /**
       * Returns the number of days in this DateTime's month
       * @example DateTime.local(2016, 2).daysInMonth //=> 29
       * @example DateTime.local(2016, 3).daysInMonth //=> 31
       * @type {number}
       */

    }, {
      key: 'daysInMonth',
      get: function get$$1() {
        return daysInMonth(this.year, this.month);
      }

      /**
       * Returns the number of days in this DateTime's year
       * @example DateTime.local(2016).daysInYear //=> 366
       * @example DateTime.local(2013).daysInYear //=> 365
       * @type {number}
       */

    }, {
      key: 'daysInYear',
      get: function get$$1() {
        return this.isValid ? daysInYear(this.year) : NaN;
      }

      /**
       * Returns the number of weeks in this DateTime's year
       * @see https://en.wikipedia.org/wiki/ISO_week_date
       * @example DateTime.local(2004).weeksInWeekYear //=> 53
       * @example DateTime.local(2013).weeksInWeekYear //=> 52
       * @type {number}
       */

    }, {
      key: 'weeksInWeekYear',
      get: function get$$1() {
        return this.isValid ? weeksInWeekYear(this.weekYear) : NaN;
      }
    }], [{
      key: 'DATE_SHORT',
      get: function get$$1() {
        return DATE_SHORT;
      }

      /**
       * {@link toLocaleString} format like 'Oct 14, 1983'
       * @type {Object}
       */

    }, {
      key: 'DATE_MED',
      get: function get$$1() {
        return DATE_MED;
      }

      /**
       * {@link toLocaleString} format like 'October 14, 1983'
       * @type {Object}
       */

    }, {
      key: 'DATE_FULL',
      get: function get$$1() {
        return DATE_FULL;
      }

      /**
       * {@link toLocaleString} format like 'Tuesday, October 14, 1983'
       * @type {Object}
       */

    }, {
      key: 'DATE_HUGE',
      get: function get$$1() {
        return DATE_HUGE;
      }

      /**
       * {@link toLocaleString} format like '09:30 AM'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'TIME_SIMPLE',
      get: function get$$1() {
        return TIME_SIMPLE;
      }

      /**
       * {@link toLocaleString} format like '09:30:23 AM'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'TIME_WITH_SECONDS',
      get: function get$$1() {
        return TIME_WITH_SECONDS;
      }

      /**
       * {@link toLocaleString} format like '09:30:23 AM EDT'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'TIME_WITH_SHORT_OFFSET',
      get: function get$$1() {
        return TIME_WITH_SHORT_OFFSET;
      }

      /**
       * {@link toLocaleString} format like '09:30:23 AM Eastern Daylight Time'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'TIME_WITH_LONG_OFFSET',
      get: function get$$1() {
        return TIME_WITH_LONG_OFFSET;
      }

      /**
       * {@link toLocaleString} format like '09:30', always 24-hour.
       * @type {Object}
       */

    }, {
      key: 'TIME_24_SIMPLE',
      get: function get$$1() {
        return TIME_24_SIMPLE;
      }

      /**
       * {@link toLocaleString} format like '09:30:23', always 24-hour.
       * @type {Object}
       */

    }, {
      key: 'TIME_24_WITH_SECONDS',
      get: function get$$1() {
        return TIME_24_WITH_SECONDS;
      }

      /**
       * {@link toLocaleString} format like '09:30:23 EDT', always 24-hour.
       * @type {Object}
       */

    }, {
      key: 'TIME_24_WITH_SHORT_OFFSET',
      get: function get$$1() {
        return TIME_24_WITH_SHORT_OFFSET;
      }

      /**
       * {@link toLocaleString} format like '09:30:23 Eastern Daylight Time', always 24-hour.
       * @type {Object}
       */

    }, {
      key: 'TIME_24_WITH_LONG_OFFSET',
      get: function get$$1() {
        return TIME_24_WITH_LONG_OFFSET;
      }

      /**
       * {@link toLocaleString} format like '10/14/1983, 9:30 AM'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_SHORT',
      get: function get$$1() {
        return DATETIME_SHORT;
      }

      /**
       * {@link toLocaleString} format like '10/14/1983, 9:30:33 AM'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_SHORT_WITH_SECONDS',
      get: function get$$1() {
        return DATETIME_SHORT_WITH_SECONDS;
      }

      /**
       * {@link toLocaleString} format like 'Oct 14, 1983, 9:30 AM'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_MED',
      get: function get$$1() {
        return DATETIME_MED;
      }

      /**
       * {@link toLocaleString} format like 'Oct 14, 1983, 9:30:33 AM'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_MED_WITH_SECONDS',
      get: function get$$1() {
        return DATETIME_MED_WITH_SECONDS;
      }

      /**
       * {@link toLocaleString} format like 'October 14, 1983, 9:30 AM EDT'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_FULL',
      get: function get$$1() {
        return DATETIME_FULL;
      }

      /**
       * {@link toLocaleString} format like 'October 14, 1983, 9:303 AM EDT'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_FULL_WITH_SECONDS',
      get: function get$$1() {
        return DATETIME_FULL_WITH_SECONDS;
      }

      /**
       * {@link toLocaleString} format like 'Friday, October 14, 1983, 9:30 AM Eastern Daylight Time'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_HUGE',
      get: function get$$1() {
        return DATETIME_HUGE;
      }

      /**
       * {@link toLocaleString} format like 'Friday, October 14, 1983, 9:30:33 AM Eastern Daylight Time'. Only 12-hour if the locale is.
       * @type {Object}
       */

    }, {
      key: 'DATETIME_HUGE_WITH_SECONDS',
      get: function get$$1() {
        return DATETIME_HUGE_WITH_SECONDS;
      }
    }]);
    return DateTime;
  }();
  function friendlyDateTime(dateTimeish) {
    if (dateTimeish instanceof DateTime) {
      return dateTimeish;
    } else if (dateTimeish.valueOf && isNumber(dateTimeish.valueOf())) {
      return DateTime.fromJSDate(dateTimeish);
    } else if (dateTimeish instanceof Object) {
      return DateTime.fromObject(dateTimeish);
    } else {
      throw new InvalidArgumentError('Unknown datetime argument');
    }
  }

  exports.DateTime = DateTime;
  exports.Duration = Duration;
  exports.Interval = Interval;
  exports.Info = Info;
  exports.Zone = Zone;
  exports.FixedOffsetZone = FixedOffsetZone;
  exports.IANAZone = IANAZone;
  exports.LocalZone = LocalZone;
  exports.Settings = Settings;

  });

  var luxon$1 = unwrapExports(luxon);
  var luxon_1 = luxon.DateTime;
  var luxon_2 = luxon.Duration;
  var luxon_3 = luxon.Interval;
  var luxon_4 = luxon.Info;
  var luxon_5 = luxon.Zone;
  var luxon_6 = luxon.FixedOffsetZone;
  var luxon_7 = luxon.IANAZone;
  var luxon_8 = luxon.LocalZone;
  var luxon_9 = luxon.Settings;

  var punycode = createCommonjsModule(function (module, exports) {
  (function(root) {

  	/** Detect free variables */
  	var freeExports = exports &&
  		!exports.nodeType && exports;
  	var freeModule = module &&
  		!module.nodeType && module;
  	var freeGlobal = typeof commonjsGlobal == 'object' && commonjsGlobal;
  	if (
  		freeGlobal.global === freeGlobal ||
  		freeGlobal.window === freeGlobal ||
  		freeGlobal.self === freeGlobal
  	) {
  		root = freeGlobal;
  	}

  	/**
  	 * The `punycode` object.
  	 * @name punycode
  	 * @type Object
  	 */
  	var punycode,

  	/** Highest positive signed 32-bit float value */
  	maxInt = 2147483647, // aka. 0x7FFFFFFF or 2^31-1

  	/** Bootstring parameters */
  	base = 36,
  	tMin = 1,
  	tMax = 26,
  	skew = 38,
  	damp = 700,
  	initialBias = 72,
  	initialN = 128, // 0x80
  	delimiter = '-', // '\x2D'

  	/** Regular expressions */
  	regexPunycode = /^xn--/,
  	regexNonASCII = /[^\x20-\x7E]/, // unprintable ASCII chars + non-ASCII chars
  	regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g, // RFC 3490 separators

  	/** Error messages */
  	errors = {
  		'overflow': 'Overflow: input needs wider integers to process',
  		'not-basic': 'Illegal input >= 0x80 (not a basic code point)',
  		'invalid-input': 'Invalid input'
  	},

  	/** Convenience shortcuts */
  	baseMinusTMin = base - tMin,
  	floor = Math.floor,
  	stringFromCharCode = String.fromCharCode,

  	/** Temporary variable */
  	key;

  	/*--------------------------------------------------------------------------*/

  	/**
  	 * A generic error utility function.
  	 * @private
  	 * @param {String} type The error type.
  	 * @returns {Error} Throws a `RangeError` with the applicable error message.
  	 */
  	function error(type) {
  		throw new RangeError(errors[type]);
  	}

  	/**
  	 * A generic `Array#map` utility function.
  	 * @private
  	 * @param {Array} array The array to iterate over.
  	 * @param {Function} callback The function that gets called for every array
  	 * item.
  	 * @returns {Array} A new array of values returned by the callback function.
  	 */
  	function map(array, fn) {
  		var length = array.length;
  		var result = [];
  		while (length--) {
  			result[length] = fn(array[length]);
  		}
  		return result;
  	}

  	/**
  	 * A simple `Array#map`-like wrapper to work with domain name strings or email
  	 * addresses.
  	 * @private
  	 * @param {String} domain The domain name or email address.
  	 * @param {Function} callback The function that gets called for every
  	 * character.
  	 * @returns {Array} A new string of characters returned by the callback
  	 * function.
  	 */
  	function mapDomain(string, fn) {
  		var parts = string.split('@');
  		var result = '';
  		if (parts.length > 1) {
  			// In email addresses, only the domain name should be punycoded. Leave
  			// the local part (i.e. everything up to `@`) intact.
  			result = parts[0] + '@';
  			string = parts[1];
  		}
  		// Avoid `split(regex)` for IE8 compatibility. See #17.
  		string = string.replace(regexSeparators, '\x2E');
  		var labels = string.split('.');
  		var encoded = map(labels, fn).join('.');
  		return result + encoded;
  	}

  	/**
  	 * Creates an array containing the numeric code points of each Unicode
  	 * character in the string. While JavaScript uses UCS-2 internally,
  	 * this function will convert a pair of surrogate halves (each of which
  	 * UCS-2 exposes as separate characters) into a single code point,
  	 * matching UTF-16.
  	 * @see `punycode.ucs2.encode`
  	 * @see <https://mathiasbynens.be/notes/javascript-encoding>
  	 * @memberOf punycode.ucs2
  	 * @name decode
  	 * @param {String} string The Unicode input string (UCS-2).
  	 * @returns {Array} The new array of code points.
  	 */
  	function ucs2decode(string) {
  		var output = [],
  		    counter = 0,
  		    length = string.length,
  		    value,
  		    extra;
  		while (counter < length) {
  			value = string.charCodeAt(counter++);
  			if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
  				// high surrogate, and there is a next character
  				extra = string.charCodeAt(counter++);
  				if ((extra & 0xFC00) == 0xDC00) { // low surrogate
  					output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
  				} else {
  					// unmatched surrogate; only append this code unit, in case the next
  					// code unit is the high surrogate of a surrogate pair
  					output.push(value);
  					counter--;
  				}
  			} else {
  				output.push(value);
  			}
  		}
  		return output;
  	}

  	/**
  	 * Creates a string based on an array of numeric code points.
  	 * @see `punycode.ucs2.decode`
  	 * @memberOf punycode.ucs2
  	 * @name encode
  	 * @param {Array} codePoints The array of numeric code points.
  	 * @returns {String} The new Unicode string (UCS-2).
  	 */
  	function ucs2encode(array) {
  		return map(array, function(value) {
  			var output = '';
  			if (value > 0xFFFF) {
  				value -= 0x10000;
  				output += stringFromCharCode(value >>> 10 & 0x3FF | 0xD800);
  				value = 0xDC00 | value & 0x3FF;
  			}
  			output += stringFromCharCode(value);
  			return output;
  		}).join('');
  	}

  	/**
  	 * Converts a basic code point into a digit/integer.
  	 * @see `digitToBasic()`
  	 * @private
  	 * @param {Number} codePoint The basic numeric code point value.
  	 * @returns {Number} The numeric value of a basic code point (for use in
  	 * representing integers) in the range `0` to `base - 1`, or `base` if
  	 * the code point does not represent a value.
  	 */
  	function basicToDigit(codePoint) {
  		if (codePoint - 48 < 10) {
  			return codePoint - 22;
  		}
  		if (codePoint - 65 < 26) {
  			return codePoint - 65;
  		}
  		if (codePoint - 97 < 26) {
  			return codePoint - 97;
  		}
  		return base;
  	}

  	/**
  	 * Converts a digit/integer into a basic code point.
  	 * @see `basicToDigit()`
  	 * @private
  	 * @param {Number} digit The numeric value of a basic code point.
  	 * @returns {Number} The basic code point whose value (when used for
  	 * representing integers) is `digit`, which needs to be in the range
  	 * `0` to `base - 1`. If `flag` is non-zero, the uppercase form is
  	 * used; else, the lowercase form is used. The behavior is undefined
  	 * if `flag` is non-zero and `digit` has no uppercase form.
  	 */
  	function digitToBasic(digit, flag) {
  		//  0..25 map to ASCII a..z or A..Z
  		// 26..35 map to ASCII 0..9
  		return digit + 22 + 75 * (digit < 26) - ((flag != 0) << 5);
  	}

  	/**
  	 * Bias adaptation function as per section 3.4 of RFC 3492.
  	 * https://tools.ietf.org/html/rfc3492#section-3.4
  	 * @private
  	 */
  	function adapt(delta, numPoints, firstTime) {
  		var k = 0;
  		delta = firstTime ? floor(delta / damp) : delta >> 1;
  		delta += floor(delta / numPoints);
  		for (/* no initialization */; delta > baseMinusTMin * tMax >> 1; k += base) {
  			delta = floor(delta / baseMinusTMin);
  		}
  		return floor(k + (baseMinusTMin + 1) * delta / (delta + skew));
  	}

  	/**
  	 * Converts a Punycode string of ASCII-only symbols to a string of Unicode
  	 * symbols.
  	 * @memberOf punycode
  	 * @param {String} input The Punycode string of ASCII-only symbols.
  	 * @returns {String} The resulting string of Unicode symbols.
  	 */
  	function decode(input) {
  		// Don't use UCS-2
  		var output = [],
  		    inputLength = input.length,
  		    out,
  		    i = 0,
  		    n = initialN,
  		    bias = initialBias,
  		    basic,
  		    j,
  		    index,
  		    oldi,
  		    w,
  		    k,
  		    digit,
  		    t,
  		    /** Cached calculation results */
  		    baseMinusT;

  		// Handle the basic code points: let `basic` be the number of input code
  		// points before the last delimiter, or `0` if there is none, then copy
  		// the first basic code points to the output.

  		basic = input.lastIndexOf(delimiter);
  		if (basic < 0) {
  			basic = 0;
  		}

  		for (j = 0; j < basic; ++j) {
  			// if it's not a basic code point
  			if (input.charCodeAt(j) >= 0x80) {
  				error('not-basic');
  			}
  			output.push(input.charCodeAt(j));
  		}

  		// Main decoding loop: start just after the last delimiter if any basic code
  		// points were copied; start at the beginning otherwise.

  		for (index = basic > 0 ? basic + 1 : 0; index < inputLength; /* no final expression */) {

  			// `index` is the index of the next character to be consumed.
  			// Decode a generalized variable-length integer into `delta`,
  			// which gets added to `i`. The overflow checking is easier
  			// if we increase `i` as we go, then subtract off its starting
  			// value at the end to obtain `delta`.
  			for (oldi = i, w = 1, k = base; /* no condition */; k += base) {

  				if (index >= inputLength) {
  					error('invalid-input');
  				}

  				digit = basicToDigit(input.charCodeAt(index++));

  				if (digit >= base || digit > floor((maxInt - i) / w)) {
  					error('overflow');
  				}

  				i += digit * w;
  				t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);

  				if (digit < t) {
  					break;
  				}

  				baseMinusT = base - t;
  				if (w > floor(maxInt / baseMinusT)) {
  					error('overflow');
  				}

  				w *= baseMinusT;

  			}

  			out = output.length + 1;
  			bias = adapt(i - oldi, out, oldi == 0);

  			// `i` was supposed to wrap around from `out` to `0`,
  			// incrementing `n` each time, so we'll fix that now:
  			if (floor(i / out) > maxInt - n) {
  				error('overflow');
  			}

  			n += floor(i / out);
  			i %= out;

  			// Insert `n` at position `i` of the output
  			output.splice(i++, 0, n);

  		}

  		return ucs2encode(output);
  	}

  	/**
  	 * Converts a string of Unicode symbols (e.g. a domain name label) to a
  	 * Punycode string of ASCII-only symbols.
  	 * @memberOf punycode
  	 * @param {String} input The string of Unicode symbols.
  	 * @returns {String} The resulting Punycode string of ASCII-only symbols.
  	 */
  	function encode(input) {
  		var n,
  		    delta,
  		    handledCPCount,
  		    basicLength,
  		    bias,
  		    j,
  		    m,
  		    q,
  		    k,
  		    t,
  		    currentValue,
  		    output = [],
  		    /** `inputLength` will hold the number of code points in `input`. */
  		    inputLength,
  		    /** Cached calculation results */
  		    handledCPCountPlusOne,
  		    baseMinusT,
  		    qMinusT;

  		// Convert the input in UCS-2 to Unicode
  		input = ucs2decode(input);

  		// Cache the length
  		inputLength = input.length;

  		// Initialize the state
  		n = initialN;
  		delta = 0;
  		bias = initialBias;

  		// Handle the basic code points
  		for (j = 0; j < inputLength; ++j) {
  			currentValue = input[j];
  			if (currentValue < 0x80) {
  				output.push(stringFromCharCode(currentValue));
  			}
  		}

  		handledCPCount = basicLength = output.length;

  		// `handledCPCount` is the number of code points that have been handled;
  		// `basicLength` is the number of basic code points.

  		// Finish the basic string - if it is not empty - with a delimiter
  		if (basicLength) {
  			output.push(delimiter);
  		}

  		// Main encoding loop:
  		while (handledCPCount < inputLength) {

  			// All non-basic code points < n have been handled already. Find the next
  			// larger one:
  			for (m = maxInt, j = 0; j < inputLength; ++j) {
  				currentValue = input[j];
  				if (currentValue >= n && currentValue < m) {
  					m = currentValue;
  				}
  			}

  			// Increase `delta` enough to advance the decoder's <n,i> state to <m,0>,
  			// but guard against overflow
  			handledCPCountPlusOne = handledCPCount + 1;
  			if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
  				error('overflow');
  			}

  			delta += (m - n) * handledCPCountPlusOne;
  			n = m;

  			for (j = 0; j < inputLength; ++j) {
  				currentValue = input[j];

  				if (currentValue < n && ++delta > maxInt) {
  					error('overflow');
  				}

  				if (currentValue == n) {
  					// Represent delta as a generalized variable-length integer
  					for (q = delta, k = base; /* no condition */; k += base) {
  						t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
  						if (q < t) {
  							break;
  						}
  						qMinusT = q - t;
  						baseMinusT = base - t;
  						output.push(
  							stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0))
  						);
  						q = floor(qMinusT / baseMinusT);
  					}

  					output.push(stringFromCharCode(digitToBasic(q, 0)));
  					bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
  					delta = 0;
  					++handledCPCount;
  				}
  			}

  			++delta;
  			++n;

  		}
  		return output.join('');
  	}

  	/**
  	 * Converts a Punycode string representing a domain name or an email address
  	 * to Unicode. Only the Punycoded parts of the input will be converted, i.e.
  	 * it doesn't matter if you call it on a string that has already been
  	 * converted to Unicode.
  	 * @memberOf punycode
  	 * @param {String} input The Punycoded domain name or email address to
  	 * convert to Unicode.
  	 * @returns {String} The Unicode representation of the given Punycode
  	 * string.
  	 */
  	function toUnicode(input) {
  		return mapDomain(input, function(string) {
  			return regexPunycode.test(string)
  				? decode(string.slice(4).toLowerCase())
  				: string;
  		});
  	}

  	/**
  	 * Converts a Unicode string representing a domain name or an email address to
  	 * Punycode. Only the non-ASCII parts of the domain name will be converted,
  	 * i.e. it doesn't matter if you call it with a domain that's already in
  	 * ASCII.
  	 * @memberOf punycode
  	 * @param {String} input The domain name or email address to convert, as a
  	 * Unicode string.
  	 * @returns {String} The Punycode representation of the given domain name or
  	 * email address.
  	 */
  	function toASCII(input) {
  		return mapDomain(input, function(string) {
  			return regexNonASCII.test(string)
  				? 'xn--' + encode(string)
  				: string;
  		});
  	}

  	/*--------------------------------------------------------------------------*/

  	/** Define the public API */
  	punycode = {
  		/**
  		 * A string representing the current Punycode.js version number.
  		 * @memberOf punycode
  		 * @type String
  		 */
  		'version': '1.3.2',
  		/**
  		 * An object of methods to convert from JavaScript's internal character
  		 * representation (UCS-2) to Unicode code points, and back.
  		 * @see <https://mathiasbynens.be/notes/javascript-encoding>
  		 * @memberOf punycode
  		 * @type Object
  		 */
  		'ucs2': {
  			'decode': ucs2decode,
  			'encode': ucs2encode
  		},
  		'decode': decode,
  		'encode': encode,
  		'toASCII': toASCII,
  		'toUnicode': toUnicode
  	};

  	/** Expose `punycode` */
  	// Some AMD build optimizers, like r.js, check for specific condition patterns
  	// like the following:
  	if (freeExports && freeModule) {
  		if (module.exports == freeExports) {
  			// in Node.js, io.js, or RingoJS v0.8.0+
  			freeModule.exports = punycode;
  		} else {
  			// in Narwhal or RingoJS v0.7.0-
  			for (key in punycode) {
  				punycode.hasOwnProperty(key) && (freeExports[key] = punycode[key]);
  			}
  		}
  	} else {
  		// in Rhino or a web browser
  		root.punycode = punycode;
  	}

  }(commonjsGlobal));
  });

  var IPv6 = createCommonjsModule(function (module) {
  /*!
   * URI.js - Mutating URLs
   * IPv6 Support
   *
   * Version: 1.19.1
   *
   * Author: Rodney Rehm
   * Web: http://medialize.github.io/URI.js/
   *
   * Licensed under
   *   MIT License http://www.opensource.org/licenses/mit-license
   *
   */

  (function (root, factory) {
    // https://github.com/umdjs/umd/blob/master/returnExports.js
    if (module.exports) {
      // Node
      module.exports = factory();
    } else {
      // Browser globals (root is window)
      root.IPv6 = factory(root);
    }
  }(commonjsGlobal, function (root) {

    /*
    var _in = "fe80:0000:0000:0000:0204:61ff:fe9d:f156";
    var _out = IPv6.best(_in);
    var _expected = "fe80::204:61ff:fe9d:f156";

    console.log(_in, _out, _expected, _out === _expected);
    */

    // save current IPv6 variable, if any
    var _IPv6 = root && root.IPv6;

    function bestPresentation(address) {
      // based on:
      // Javascript to test an IPv6 address for proper format, and to
      // present the "best text representation" according to IETF Draft RFC at
      // http://tools.ietf.org/html/draft-ietf-6man-text-addr-representation-04
      // 8 Feb 2010 Rich Brown, Dartware, LLC
      // Please feel free to use this code as long as you provide a link to
      // http://www.intermapper.com
      // http://intermapper.com/support/tools/IPV6-Validator.aspx
      // http://download.dartware.com/thirdparty/ipv6validator.js

      var _address = address.toLowerCase();
      var segments = _address.split(':');
      var length = segments.length;
      var total = 8;

      // trim colons (:: or ::a:b:c… or …a:b:c::)
      if (segments[0] === '' && segments[1] === '' && segments[2] === '') {
        // must have been ::
        // remove first two items
        segments.shift();
        segments.shift();
      } else if (segments[0] === '' && segments[1] === '') {
        // must have been ::xxxx
        // remove the first item
        segments.shift();
      } else if (segments[length - 1] === '' && segments[length - 2] === '') {
        // must have been xxxx::
        segments.pop();
      }

      length = segments.length;

      // adjust total segments for IPv4 trailer
      if (segments[length - 1].indexOf('.') !== -1) {
        // found a "." which means IPv4
        total = 7;
      }

      // fill empty segments them with "0000"
      var pos;
      for (pos = 0; pos < length; pos++) {
        if (segments[pos] === '') {
          break;
        }
      }

      if (pos < total) {
        segments.splice(pos, 1, '0000');
        while (segments.length < total) {
          segments.splice(pos, 0, '0000');
        }
      }

      // strip leading zeros
      var _segments;
      for (var i = 0; i < total; i++) {
        _segments = segments[i].split('');
        for (var j = 0; j < 3 ; j++) {
          if (_segments[0] === '0' && _segments.length > 1) {
            _segments.splice(0,1);
          } else {
            break;
          }
        }

        segments[i] = _segments.join('');
      }

      // find longest sequence of zeroes and coalesce them into one segment
      var best = -1;
      var _best = 0;
      var _current = 0;
      var current = -1;
      var inzeroes = false;
      // i; already declared

      for (i = 0; i < total; i++) {
        if (inzeroes) {
          if (segments[i] === '0') {
            _current += 1;
          } else {
            inzeroes = false;
            if (_current > _best) {
              best = current;
              _best = _current;
            }
          }
        } else {
          if (segments[i] === '0') {
            inzeroes = true;
            current = i;
            _current = 1;
          }
        }
      }

      if (_current > _best) {
        best = current;
        _best = _current;
      }

      if (_best > 1) {
        segments.splice(best, _best, '');
      }

      length = segments.length;

      // assemble remaining segments
      var result = '';
      if (segments[0] === '')  {
        result = ':';
      }

      for (i = 0; i < length; i++) {
        result += segments[i];
        if (i === length - 1) {
          break;
        }

        result += ':';
      }

      if (segments[length - 1] === '') {
        result += ':';
      }

      return result;
    }

    function noConflict() {
      /*jshint validthis: true */
      if (root.IPv6 === this) {
        root.IPv6 = _IPv6;
      }

      return this;
    }

    return {
      best: bestPresentation,
      noConflict: noConflict
    };
  }));
  });

  var SecondLevelDomains = createCommonjsModule(function (module) {
  /*!
   * URI.js - Mutating URLs
   * Second Level Domain (SLD) Support
   *
   * Version: 1.19.1
   *
   * Author: Rodney Rehm
   * Web: http://medialize.github.io/URI.js/
   *
   * Licensed under
   *   MIT License http://www.opensource.org/licenses/mit-license
   *
   */

  (function (root, factory) {
    // https://github.com/umdjs/umd/blob/master/returnExports.js
    if (module.exports) {
      // Node
      module.exports = factory();
    } else {
      // Browser globals (root is window)
      root.SecondLevelDomains = factory(root);
    }
  }(commonjsGlobal, function (root) {

    // save current SecondLevelDomains variable, if any
    var _SecondLevelDomains = root && root.SecondLevelDomains;

    var SLD = {
      // list of known Second Level Domains
      // converted list of SLDs from https://github.com/gavingmiller/second-level-domains
      // ----
      // publicsuffix.org is more current and actually used by a couple of browsers internally.
      // downside is it also contains domains like "dyndns.org" - which is fine for the security
      // issues browser have to deal with (SOP for cookies, etc) - but is way overboard for URI.js
      // ----
      list: {
        'ac':' com gov mil net org ',
        'ae':' ac co gov mil name net org pro sch ',
        'af':' com edu gov net org ',
        'al':' com edu gov mil net org ',
        'ao':' co ed gv it og pb ',
        'ar':' com edu gob gov int mil net org tur ',
        'at':' ac co gv or ',
        'au':' asn com csiro edu gov id net org ',
        'ba':' co com edu gov mil net org rs unbi unmo unsa untz unze ',
        'bb':' biz co com edu gov info net org store tv ',
        'bh':' biz cc com edu gov info net org ',
        'bn':' com edu gov net org ',
        'bo':' com edu gob gov int mil net org tv ',
        'br':' adm adv agr am arq art ato b bio blog bmd cim cng cnt com coop ecn edu eng esp etc eti far flog fm fnd fot fst g12 ggf gov imb ind inf jor jus lel mat med mil mus net nom not ntr odo org ppg pro psc psi qsl rec slg srv tmp trd tur tv vet vlog wiki zlg ',
        'bs':' com edu gov net org ',
        'bz':' du et om ov rg ',
        'ca':' ab bc mb nb nf nl ns nt nu on pe qc sk yk ',
        'ck':' biz co edu gen gov info net org ',
        'cn':' ac ah bj com cq edu fj gd gov gs gx gz ha hb he hi hl hn jl js jx ln mil net nm nx org qh sc sd sh sn sx tj tw xj xz yn zj ',
        'co':' com edu gov mil net nom org ',
        'cr':' ac c co ed fi go or sa ',
        'cy':' ac biz com ekloges gov ltd name net org parliament press pro tm ',
        'do':' art com edu gob gov mil net org sld web ',
        'dz':' art asso com edu gov net org pol ',
        'ec':' com edu fin gov info med mil net org pro ',
        'eg':' com edu eun gov mil name net org sci ',
        'er':' com edu gov ind mil net org rochest w ',
        'es':' com edu gob nom org ',
        'et':' biz com edu gov info name net org ',
        'fj':' ac biz com info mil name net org pro ',
        'fk':' ac co gov net nom org ',
        'fr':' asso com f gouv nom prd presse tm ',
        'gg':' co net org ',
        'gh':' com edu gov mil org ',
        'gn':' ac com gov net org ',
        'gr':' com edu gov mil net org ',
        'gt':' com edu gob ind mil net org ',
        'gu':' com edu gov net org ',
        'hk':' com edu gov idv net org ',
        'hu':' 2000 agrar bolt casino city co erotica erotika film forum games hotel info ingatlan jogasz konyvelo lakas media news org priv reklam sex shop sport suli szex tm tozsde utazas video ',
        'id':' ac co go mil net or sch web ',
        'il':' ac co gov idf k12 muni net org ',
        'in':' ac co edu ernet firm gen gov i ind mil net nic org res ',
        'iq':' com edu gov i mil net org ',
        'ir':' ac co dnssec gov i id net org sch ',
        'it':' edu gov ',
        'je':' co net org ',
        'jo':' com edu gov mil name net org sch ',
        'jp':' ac ad co ed go gr lg ne or ',
        'ke':' ac co go info me mobi ne or sc ',
        'kh':' com edu gov mil net org per ',
        'ki':' biz com de edu gov info mob net org tel ',
        'km':' asso com coop edu gouv k medecin mil nom notaires pharmaciens presse tm veterinaire ',
        'kn':' edu gov net org ',
        'kr':' ac busan chungbuk chungnam co daegu daejeon es gangwon go gwangju gyeongbuk gyeonggi gyeongnam hs incheon jeju jeonbuk jeonnam k kg mil ms ne or pe re sc seoul ulsan ',
        'kw':' com edu gov net org ',
        'ky':' com edu gov net org ',
        'kz':' com edu gov mil net org ',
        'lb':' com edu gov net org ',
        'lk':' assn com edu gov grp hotel int ltd net ngo org sch soc web ',
        'lr':' com edu gov net org ',
        'lv':' asn com conf edu gov id mil net org ',
        'ly':' com edu gov id med net org plc sch ',
        'ma':' ac co gov m net org press ',
        'mc':' asso tm ',
        'me':' ac co edu gov its net org priv ',
        'mg':' com edu gov mil nom org prd tm ',
        'mk':' com edu gov inf name net org pro ',
        'ml':' com edu gov net org presse ',
        'mn':' edu gov org ',
        'mo':' com edu gov net org ',
        'mt':' com edu gov net org ',
        'mv':' aero biz com coop edu gov info int mil museum name net org pro ',
        'mw':' ac co com coop edu gov int museum net org ',
        'mx':' com edu gob net org ',
        'my':' com edu gov mil name net org sch ',
        'nf':' arts com firm info net other per rec store web ',
        'ng':' biz com edu gov mil mobi name net org sch ',
        'ni':' ac co com edu gob mil net nom org ',
        'np':' com edu gov mil net org ',
        'nr':' biz com edu gov info net org ',
        'om':' ac biz co com edu gov med mil museum net org pro sch ',
        'pe':' com edu gob mil net nom org sld ',
        'ph':' com edu gov i mil net ngo org ',
        'pk':' biz com edu fam gob gok gon gop gos gov net org web ',
        'pl':' art bialystok biz com edu gda gdansk gorzow gov info katowice krakow lodz lublin mil net ngo olsztyn org poznan pwr radom slupsk szczecin torun warszawa waw wroc wroclaw zgora ',
        'pr':' ac biz com edu est gov info isla name net org pro prof ',
        'ps':' com edu gov net org plo sec ',
        'pw':' belau co ed go ne or ',
        'ro':' arts com firm info nom nt org rec store tm www ',
        'rs':' ac co edu gov in org ',
        'sb':' com edu gov net org ',
        'sc':' com edu gov net org ',
        'sh':' co com edu gov net nom org ',
        'sl':' com edu gov net org ',
        'st':' co com consulado edu embaixada gov mil net org principe saotome store ',
        'sv':' com edu gob org red ',
        'sz':' ac co org ',
        'tr':' av bbs bel biz com dr edu gen gov info k12 name net org pol tel tsk tv web ',
        'tt':' aero biz cat co com coop edu gov info int jobs mil mobi museum name net org pro tel travel ',
        'tw':' club com ebiz edu game gov idv mil net org ',
        'mu':' ac co com gov net or org ',
        'mz':' ac co edu gov org ',
        'na':' co com ',
        'nz':' ac co cri geek gen govt health iwi maori mil net org parliament school ',
        'pa':' abo ac com edu gob ing med net nom org sld ',
        'pt':' com edu gov int net nome org publ ',
        'py':' com edu gov mil net org ',
        'qa':' com edu gov mil net org ',
        're':' asso com nom ',
        'ru':' ac adygeya altai amur arkhangelsk astrakhan bashkiria belgorod bir bryansk buryatia cbg chel chelyabinsk chita chukotka chuvashia com dagestan e-burg edu gov grozny int irkutsk ivanovo izhevsk jar joshkar-ola kalmykia kaluga kamchatka karelia kazan kchr kemerovo khabarovsk khakassia khv kirov koenig komi kostroma kranoyarsk kuban kurgan kursk lipetsk magadan mari mari-el marine mil mordovia mosreg msk murmansk nalchik net nnov nov novosibirsk nsk omsk orenburg org oryol penza perm pp pskov ptz rnd ryazan sakhalin samara saratov simbirsk smolensk spb stavropol stv surgut tambov tatarstan tom tomsk tsaritsyn tsk tula tuva tver tyumen udm udmurtia ulan-ude vladikavkaz vladimir vladivostok volgograd vologda voronezh vrn vyatka yakutia yamal yekaterinburg yuzhno-sakhalinsk ',
        'rw':' ac co com edu gouv gov int mil net ',
        'sa':' com edu gov med net org pub sch ',
        'sd':' com edu gov info med net org tv ',
        'se':' a ac b bd c d e f g h i k l m n o org p parti pp press r s t tm u w x y z ',
        'sg':' com edu gov idn net org per ',
        'sn':' art com edu gouv org perso univ ',
        'sy':' com edu gov mil net news org ',
        'th':' ac co go in mi net or ',
        'tj':' ac biz co com edu go gov info int mil name net nic org test web ',
        'tn':' agrinet com defense edunet ens fin gov ind info intl mincom nat net org perso rnrt rns rnu tourism ',
        'tz':' ac co go ne or ',
        'ua':' biz cherkassy chernigov chernovtsy ck cn co com crimea cv dn dnepropetrovsk donetsk dp edu gov if in ivano-frankivsk kh kharkov kherson khmelnitskiy kiev kirovograd km kr ks kv lg lugansk lutsk lviv me mk net nikolaev od odessa org pl poltava pp rovno rv sebastopol sumy te ternopil uzhgorod vinnica vn zaporizhzhe zhitomir zp zt ',
        'ug':' ac co go ne or org sc ',
        'uk':' ac bl british-library co cym gov govt icnet jet lea ltd me mil mod national-library-scotland nel net nhs nic nls org orgn parliament plc police sch scot soc ',
        'us':' dni fed isa kids nsn ',
        'uy':' com edu gub mil net org ',
        've':' co com edu gob info mil net org web ',
        'vi':' co com k12 net org ',
        'vn':' ac biz com edu gov health info int name net org pro ',
        'ye':' co com gov ltd me net org plc ',
        'yu':' ac co edu gov org ',
        'za':' ac agric alt bourse city co cybernet db edu gov grondar iaccess imt inca landesign law mil net ngo nis nom olivetti org pix school tm web ',
        'zm':' ac co com edu gov net org sch ',
        // https://en.wikipedia.org/wiki/CentralNic#Second-level_domains
        'com': 'ar br cn de eu gb gr hu jpn kr no qc ru sa se uk us uy za ',
        'net': 'gb jp se uk ',
        'org': 'ae',
        'de': 'com '
      },
      // gorhill 2013-10-25: Using indexOf() instead Regexp(). Significant boost
      // in both performance and memory footprint. No initialization required.
      // http://jsperf.com/uri-js-sld-regex-vs-binary-search/4
      // Following methods use lastIndexOf() rather than array.split() in order
      // to avoid any memory allocations.
      has: function(domain) {
        var tldOffset = domain.lastIndexOf('.');
        if (tldOffset <= 0 || tldOffset >= (domain.length-1)) {
          return false;
        }
        var sldOffset = domain.lastIndexOf('.', tldOffset-1);
        if (sldOffset <= 0 || sldOffset >= (tldOffset-1)) {
          return false;
        }
        var sldList = SLD.list[domain.slice(tldOffset+1)];
        if (!sldList) {
          return false;
        }
        return sldList.indexOf(' ' + domain.slice(sldOffset+1, tldOffset) + ' ') >= 0;
      },
      is: function(domain) {
        var tldOffset = domain.lastIndexOf('.');
        if (tldOffset <= 0 || tldOffset >= (domain.length-1)) {
          return false;
        }
        var sldOffset = domain.lastIndexOf('.', tldOffset-1);
        if (sldOffset >= 0) {
          return false;
        }
        var sldList = SLD.list[domain.slice(tldOffset+1)];
        if (!sldList) {
          return false;
        }
        return sldList.indexOf(' ' + domain.slice(0, tldOffset) + ' ') >= 0;
      },
      get: function(domain) {
        var tldOffset = domain.lastIndexOf('.');
        if (tldOffset <= 0 || tldOffset >= (domain.length-1)) {
          return null;
        }
        var sldOffset = domain.lastIndexOf('.', tldOffset-1);
        if (sldOffset <= 0 || sldOffset >= (tldOffset-1)) {
          return null;
        }
        var sldList = SLD.list[domain.slice(tldOffset+1)];
        if (!sldList) {
          return null;
        }
        if (sldList.indexOf(' ' + domain.slice(sldOffset+1, tldOffset) + ' ') < 0) {
          return null;
        }
        return domain.slice(sldOffset+1);
      },
      noConflict: function(){
        if (root.SecondLevelDomains === this) {
          root.SecondLevelDomains = _SecondLevelDomains;
        }
        return this;
      }
    };

    return SLD;
  }));
  });

  var URI = createCommonjsModule(function (module) {
  /*!
   * URI.js - Mutating URLs
   *
   * Version: 1.19.1
   *
   * Author: Rodney Rehm
   * Web: http://medialize.github.io/URI.js/
   *
   * Licensed under
   *   MIT License http://www.opensource.org/licenses/mit-license
   *
   */
  (function (root, factory) {
    // https://github.com/umdjs/umd/blob/master/returnExports.js
    if (module.exports) {
      // Node
      module.exports = factory(punycode, IPv6, SecondLevelDomains);
    } else {
      // Browser globals (root is window)
      root.URI = factory(root.punycode, root.IPv6, root.SecondLevelDomains, root);
    }
  }(commonjsGlobal, function (punycode$$1, IPv6$$1, SLD, root) {
    /*global location, escape, unescape */
    // FIXME: v2.0.0 renamce non-camelCase properties to uppercase
    /*jshint camelcase: false */

    // save current URI variable, if any
    var _URI = root && root.URI;

    function URI(url, base) {
      var _urlSupplied = arguments.length >= 1;
      var _baseSupplied = arguments.length >= 2;

      // Allow instantiation without the 'new' keyword
      if (!(this instanceof URI)) {
        if (_urlSupplied) {
          if (_baseSupplied) {
            return new URI(url, base);
          }

          return new URI(url);
        }

        return new URI();
      }

      if (url === undefined) {
        if (_urlSupplied) {
          throw new TypeError('undefined is not a valid argument for URI');
        }

        if (typeof location !== 'undefined') {
          url = location.href + '';
        } else {
          url = '';
        }
      }

      if (url === null) {
        if (_urlSupplied) {
          throw new TypeError('null is not a valid argument for URI');
        }
      }

      this.href(url);

      // resolve to base according to http://dvcs.w3.org/hg/url/raw-file/tip/Overview.html#constructor
      if (base !== undefined) {
        return this.absoluteTo(base);
      }

      return this;
    }

    function isInteger(value) {
      return /^[0-9]+$/.test(value);
    }

    URI.version = '1.19.1';

    var p = URI.prototype;
    var hasOwn = Object.prototype.hasOwnProperty;

    function escapeRegEx(string) {
      // https://github.com/medialize/URI.js/commit/85ac21783c11f8ccab06106dba9735a31a86924d#commitcomment-821963
      return string.replace(/([.*+?^=!:${}()|[\]\/\\])/g, '\\$1');
    }

    function getType(value) {
      // IE8 doesn't return [Object Undefined] but [Object Object] for undefined value
      if (value === undefined) {
        return 'Undefined';
      }

      return String(Object.prototype.toString.call(value)).slice(8, -1);
    }

    function isArray(obj) {
      return getType(obj) === 'Array';
    }

    function filterArrayValues(data, value) {
      var lookup = {};
      var i, length;

      if (getType(value) === 'RegExp') {
        lookup = null;
      } else if (isArray(value)) {
        for (i = 0, length = value.length; i < length; i++) {
          lookup[value[i]] = true;
        }
      } else {
        lookup[value] = true;
      }

      for (i = 0, length = data.length; i < length; i++) {
        /*jshint laxbreak: true */
        var _match = lookup && lookup[data[i]] !== undefined
          || !lookup && value.test(data[i]);
        /*jshint laxbreak: false */
        if (_match) {
          data.splice(i, 1);
          length--;
          i--;
        }
      }

      return data;
    }

    function arrayContains(list, value) {
      var i, length;

      // value may be string, number, array, regexp
      if (isArray(value)) {
        // Note: this can be optimized to O(n) (instead of current O(m * n))
        for (i = 0, length = value.length; i < length; i++) {
          if (!arrayContains(list, value[i])) {
            return false;
          }
        }

        return true;
      }

      var _type = getType(value);
      for (i = 0, length = list.length; i < length; i++) {
        if (_type === 'RegExp') {
          if (typeof list[i] === 'string' && list[i].match(value)) {
            return true;
          }
        } else if (list[i] === value) {
          return true;
        }
      }

      return false;
    }

    function arraysEqual(one, two) {
      if (!isArray(one) || !isArray(two)) {
        return false;
      }

      // arrays can't be equal if they have different amount of content
      if (one.length !== two.length) {
        return false;
      }

      one.sort();
      two.sort();

      for (var i = 0, l = one.length; i < l; i++) {
        if (one[i] !== two[i]) {
          return false;
        }
      }

      return true;
    }

    function trimSlashes(text) {
      var trim_expression = /^\/+|\/+$/g;
      return text.replace(trim_expression, '');
    }

    URI._parts = function() {
      return {
        protocol: null,
        username: null,
        password: null,
        hostname: null,
        urn: null,
        port: null,
        path: null,
        query: null,
        fragment: null,
        // state
        preventInvalidHostname: URI.preventInvalidHostname,
        duplicateQueryParameters: URI.duplicateQueryParameters,
        escapeQuerySpace: URI.escapeQuerySpace
      };
    };
    // state: throw on invalid hostname
    // see https://github.com/medialize/URI.js/pull/345
    // and https://github.com/medialize/URI.js/issues/354
    URI.preventInvalidHostname = false;
    // state: allow duplicate query parameters (a=1&a=1)
    URI.duplicateQueryParameters = false;
    // state: replaces + with %20 (space in query strings)
    URI.escapeQuerySpace = true;
    // static properties
    URI.protocol_expression = /^[a-z][a-z0-9.+-]*$/i;
    URI.idn_expression = /[^a-z0-9\._-]/i;
    URI.punycode_expression = /(xn--)/i;
    // well, 333.444.555.666 matches, but it sure ain't no IPv4 - do we care?
    URI.ip4_expression = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    // credits to Rich Brown
    // source: http://forums.intermapper.com/viewtopic.php?p=1096#1096
    // specification: http://www.ietf.org/rfc/rfc4291.txt
    URI.ip6_expression = /^\s*((([0-9A-Fa-f]{1,4}:){7}([0-9A-Fa-f]{1,4}|:))|(([0-9A-Fa-f]{1,4}:){6}(:[0-9A-Fa-f]{1,4}|((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){5}(((:[0-9A-Fa-f]{1,4}){1,2})|:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})|:))|(([0-9A-Fa-f]{1,4}:){4}(((:[0-9A-Fa-f]{1,4}){1,3})|((:[0-9A-Fa-f]{1,4})?:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){3}(((:[0-9A-Fa-f]{1,4}){1,4})|((:[0-9A-Fa-f]{1,4}){0,2}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){2}(((:[0-9A-Fa-f]{1,4}){1,5})|((:[0-9A-Fa-f]{1,4}){0,3}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(([0-9A-Fa-f]{1,4}:){1}(((:[0-9A-Fa-f]{1,4}){1,6})|((:[0-9A-Fa-f]{1,4}){0,4}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:))|(:(((:[0-9A-Fa-f]{1,4}){1,7})|((:[0-9A-Fa-f]{1,4}){0,5}:((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}))|:)))(%.+)?\s*$/;
    // expression used is "gruber revised" (@gruber v2) determined to be the
    // best solution in a regex-golf we did a couple of ages ago at
    // * http://mathiasbynens.be/demo/url-regex
    // * http://rodneyrehm.de/t/url-regex.html
    URI.find_uri_expression = /\b((?:[a-z][\w-]+:(?:\/{1,3}|[a-z0-9%])|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,4}\/)(?:[^\s()<>]+|\(([^\s()<>]+|(\([^\s()<>]+\)))*\))+(?:\(([^\s()<>]+|(\([^\s()<>]+\)))*\)|[^\s`!()\[\]{};:'".,<>?«»“”‘’]))/ig;
    URI.findUri = {
      // valid "scheme://" or "www."
      start: /\b(?:([a-z][a-z0-9.+-]*:\/\/)|www\.)/gi,
      // everything up to the next whitespace
      end: /[\s\r\n]|$/,
      // trim trailing punctuation captured by end RegExp
      trim: /[`!()\[\]{};:'".,<>?«»“”„‘’]+$/,
      // balanced parens inclusion (), [], {}, <>
      parens: /(\([^\)]*\)|\[[^\]]*\]|\{[^}]*\}|<[^>]*>)/g,
    };
    // http://www.iana.org/assignments/uri-schemes.html
    // http://en.wikipedia.org/wiki/List_of_TCP_and_UDP_port_numbers#Well-known_ports
    URI.defaultPorts = {
      http: '80',
      https: '443',
      ftp: '21',
      gopher: '70',
      ws: '80',
      wss: '443'
    };
    // list of protocols which always require a hostname
    URI.hostProtocols = [
      'http',
      'https'
    ];

    // allowed hostname characters according to RFC 3986
    // ALPHA DIGIT "-" "." "_" "~" "!" "$" "&" "'" "(" ")" "*" "+" "," ";" "=" %encoded
    // I've never seen a (non-IDN) hostname other than: ALPHA DIGIT . - _
    URI.invalid_hostname_characters = /[^a-zA-Z0-9\.\-:_]/;
    // map DOM Elements to their URI attribute
    URI.domAttributes = {
      'a': 'href',
      'blockquote': 'cite',
      'link': 'href',
      'base': 'href',
      'script': 'src',
      'form': 'action',
      'img': 'src',
      'area': 'href',
      'iframe': 'src',
      'embed': 'src',
      'source': 'src',
      'track': 'src',
      'input': 'src', // but only if type="image"
      'audio': 'src',
      'video': 'src'
    };
    URI.getDomAttribute = function(node) {
      if (!node || !node.nodeName) {
        return undefined;
      }

      var nodeName = node.nodeName.toLowerCase();
      // <input> should only expose src for type="image"
      if (nodeName === 'input' && node.type !== 'image') {
        return undefined;
      }

      return URI.domAttributes[nodeName];
    };

    function escapeForDumbFirefox36(value) {
      // https://github.com/medialize/URI.js/issues/91
      return escape(value);
    }

    // encoding / decoding according to RFC3986
    function strictEncodeURIComponent(string) {
      // see https://developer.mozilla.org/en-US/docs/JavaScript/Reference/Global_Objects/encodeURIComponent
      return encodeURIComponent(string)
        .replace(/[!'()*]/g, escapeForDumbFirefox36)
        .replace(/\*/g, '%2A');
    }
    URI.encode = strictEncodeURIComponent;
    URI.decode = decodeURIComponent;
    URI.iso8859 = function() {
      URI.encode = escape;
      URI.decode = unescape;
    };
    URI.unicode = function() {
      URI.encode = strictEncodeURIComponent;
      URI.decode = decodeURIComponent;
    };
    URI.characters = {
      pathname: {
        encode: {
          // RFC3986 2.1: For consistency, URI producers and normalizers should
          // use uppercase hexadecimal digits for all percent-encodings.
          expression: /%(24|26|2B|2C|3B|3D|3A|40)/ig,
          map: {
            // -._~!'()*
            '%24': '$',
            '%26': '&',
            '%2B': '+',
            '%2C': ',',
            '%3B': ';',
            '%3D': '=',
            '%3A': ':',
            '%40': '@'
          }
        },
        decode: {
          expression: /[\/\?#]/g,
          map: {
            '/': '%2F',
            '?': '%3F',
            '#': '%23'
          }
        }
      },
      reserved: {
        encode: {
          // RFC3986 2.1: For consistency, URI producers and normalizers should
          // use uppercase hexadecimal digits for all percent-encodings.
          expression: /%(21|23|24|26|27|28|29|2A|2B|2C|2F|3A|3B|3D|3F|40|5B|5D)/ig,
          map: {
            // gen-delims
            '%3A': ':',
            '%2F': '/',
            '%3F': '?',
            '%23': '#',
            '%5B': '[',
            '%5D': ']',
            '%40': '@',
            // sub-delims
            '%21': '!',
            '%24': '$',
            '%26': '&',
            '%27': '\'',
            '%28': '(',
            '%29': ')',
            '%2A': '*',
            '%2B': '+',
            '%2C': ',',
            '%3B': ';',
            '%3D': '='
          }
        }
      },
      urnpath: {
        // The characters under `encode` are the characters called out by RFC 2141 as being acceptable
        // for usage in a URN. RFC2141 also calls out "-", ".", and "_" as acceptable characters, but
        // these aren't encoded by encodeURIComponent, so we don't have to call them out here. Also
        // note that the colon character is not featured in the encoding map; this is because URI.js
        // gives the colons in URNs semantic meaning as the delimiters of path segements, and so it
        // should not appear unencoded in a segment itself.
        // See also the note above about RFC3986 and capitalalized hex digits.
        encode: {
          expression: /%(21|24|27|28|29|2A|2B|2C|3B|3D|40)/ig,
          map: {
            '%21': '!',
            '%24': '$',
            '%27': '\'',
            '%28': '(',
            '%29': ')',
            '%2A': '*',
            '%2B': '+',
            '%2C': ',',
            '%3B': ';',
            '%3D': '=',
            '%40': '@'
          }
        },
        // These characters are the characters called out by RFC2141 as "reserved" characters that
        // should never appear in a URN, plus the colon character (see note above).
        decode: {
          expression: /[\/\?#:]/g,
          map: {
            '/': '%2F',
            '?': '%3F',
            '#': '%23',
            ':': '%3A'
          }
        }
      }
    };
    URI.encodeQuery = function(string, escapeQuerySpace) {
      var escaped = URI.encode(string + '');
      if (escapeQuerySpace === undefined) {
        escapeQuerySpace = URI.escapeQuerySpace;
      }

      return escapeQuerySpace ? escaped.replace(/%20/g, '+') : escaped;
    };
    URI.decodeQuery = function(string, escapeQuerySpace) {
      string += '';
      if (escapeQuerySpace === undefined) {
        escapeQuerySpace = URI.escapeQuerySpace;
      }

      try {
        return URI.decode(escapeQuerySpace ? string.replace(/\+/g, '%20') : string);
      } catch(e) {
        // we're not going to mess with weird encodings,
        // give up and return the undecoded original string
        // see https://github.com/medialize/URI.js/issues/87
        // see https://github.com/medialize/URI.js/issues/92
        return string;
      }
    };
    // generate encode/decode path functions
    var _parts = {'encode':'encode', 'decode':'decode'};
    var _part;
    var generateAccessor = function(_group, _part) {
      return function(string) {
        try {
          return URI[_part](string + '').replace(URI.characters[_group][_part].expression, function(c) {
            return URI.characters[_group][_part].map[c];
          });
        } catch (e) {
          // we're not going to mess with weird encodings,
          // give up and return the undecoded original string
          // see https://github.com/medialize/URI.js/issues/87
          // see https://github.com/medialize/URI.js/issues/92
          return string;
        }
      };
    };

    for (_part in _parts) {
      URI[_part + 'PathSegment'] = generateAccessor('pathname', _parts[_part]);
      URI[_part + 'UrnPathSegment'] = generateAccessor('urnpath', _parts[_part]);
    }

    var generateSegmentedPathFunction = function(_sep, _codingFuncName, _innerCodingFuncName) {
      return function(string) {
        // Why pass in names of functions, rather than the function objects themselves? The
        // definitions of some functions (but in particular, URI.decode) will occasionally change due
        // to URI.js having ISO8859 and Unicode modes. Passing in the name and getting it will ensure
        // that the functions we use here are "fresh".
        var actualCodingFunc;
        if (!_innerCodingFuncName) {
          actualCodingFunc = URI[_codingFuncName];
        } else {
          actualCodingFunc = function(string) {
            return URI[_codingFuncName](URI[_innerCodingFuncName](string));
          };
        }

        var segments = (string + '').split(_sep);

        for (var i = 0, length = segments.length; i < length; i++) {
          segments[i] = actualCodingFunc(segments[i]);
        }

        return segments.join(_sep);
      };
    };

    // This takes place outside the above loop because we don't want, e.g., encodeUrnPath functions.
    URI.decodePath = generateSegmentedPathFunction('/', 'decodePathSegment');
    URI.decodeUrnPath = generateSegmentedPathFunction(':', 'decodeUrnPathSegment');
    URI.recodePath = generateSegmentedPathFunction('/', 'encodePathSegment', 'decode');
    URI.recodeUrnPath = generateSegmentedPathFunction(':', 'encodeUrnPathSegment', 'decode');

    URI.encodeReserved = generateAccessor('reserved', 'encode');

    URI.parse = function(string, parts) {
      var pos;
      if (!parts) {
        parts = {
          preventInvalidHostname: URI.preventInvalidHostname
        };
      }
      // [protocol"://"[username[":"password]"@"]hostname[":"port]"/"?][path]["?"querystring]["#"fragment]

      // extract fragment
      pos = string.indexOf('#');
      if (pos > -1) {
        // escaping?
        parts.fragment = string.substring(pos + 1) || null;
        string = string.substring(0, pos);
      }

      // extract query
      pos = string.indexOf('?');
      if (pos > -1) {
        // escaping?
        parts.query = string.substring(pos + 1) || null;
        string = string.substring(0, pos);
      }

      // extract protocol
      if (string.substring(0, 2) === '//') {
        // relative-scheme
        parts.protocol = null;
        string = string.substring(2);
        // extract "user:pass@host:port"
        string = URI.parseAuthority(string, parts);
      } else {
        pos = string.indexOf(':');
        if (pos > -1) {
          parts.protocol = string.substring(0, pos) || null;
          if (parts.protocol && !parts.protocol.match(URI.protocol_expression)) {
            // : may be within the path
            parts.protocol = undefined;
          } else if (string.substring(pos + 1, pos + 3) === '//') {
            string = string.substring(pos + 3);

            // extract "user:pass@host:port"
            string = URI.parseAuthority(string, parts);
          } else {
            string = string.substring(pos + 1);
            parts.urn = true;
          }
        }
      }

      // what's left must be the path
      parts.path = string;

      // and we're done
      return parts;
    };
    URI.parseHost = function(string, parts) {
      if (!string) {
        string = '';
      }

      // Copy chrome, IE, opera backslash-handling behavior.
      // Back slashes before the query string get converted to forward slashes
      // See: https://github.com/joyent/node/blob/386fd24f49b0e9d1a8a076592a404168faeecc34/lib/url.js#L115-L124
      // See: https://code.google.com/p/chromium/issues/detail?id=25916
      // https://github.com/medialize/URI.js/pull/233
      string = string.replace(/\\/g, '/');

      // extract host:port
      var pos = string.indexOf('/');
      var bracketPos;
      var t;

      if (pos === -1) {
        pos = string.length;
      }

      if (string.charAt(0) === '[') {
        // IPv6 host - http://tools.ietf.org/html/draft-ietf-6man-text-addr-representation-04#section-6
        // I claim most client software breaks on IPv6 anyways. To simplify things, URI only accepts
        // IPv6+port in the format [2001:db8::1]:80 (for the time being)
        bracketPos = string.indexOf(']');
        parts.hostname = string.substring(1, bracketPos) || null;
        parts.port = string.substring(bracketPos + 2, pos) || null;
        if (parts.port === '/') {
          parts.port = null;
        }
      } else {
        var firstColon = string.indexOf(':');
        var firstSlash = string.indexOf('/');
        var nextColon = string.indexOf(':', firstColon + 1);
        if (nextColon !== -1 && (firstSlash === -1 || nextColon < firstSlash)) {
          // IPv6 host contains multiple colons - but no port
          // this notation is actually not allowed by RFC 3986, but we're a liberal parser
          parts.hostname = string.substring(0, pos) || null;
          parts.port = null;
        } else {
          t = string.substring(0, pos).split(':');
          parts.hostname = t[0] || null;
          parts.port = t[1] || null;
        }
      }

      if (parts.hostname && string.substring(pos).charAt(0) !== '/') {
        pos++;
        string = '/' + string;
      }

      if (parts.preventInvalidHostname) {
        URI.ensureValidHostname(parts.hostname, parts.protocol);
      }

      if (parts.port) {
        URI.ensureValidPort(parts.port);
      }

      return string.substring(pos) || '/';
    };
    URI.parseAuthority = function(string, parts) {
      string = URI.parseUserinfo(string, parts);
      return URI.parseHost(string, parts);
    };
    URI.parseUserinfo = function(string, parts) {
      // extract username:password
      var firstSlash = string.indexOf('/');
      var pos = string.lastIndexOf('@', firstSlash > -1 ? firstSlash : string.length - 1);
      var t;

      // authority@ must come before /path
      if (pos > -1 && (firstSlash === -1 || pos < firstSlash)) {
        t = string.substring(0, pos).split(':');
        parts.username = t[0] ? URI.decode(t[0]) : null;
        t.shift();
        parts.password = t[0] ? URI.decode(t.join(':')) : null;
        string = string.substring(pos + 1);
      } else {
        parts.username = null;
        parts.password = null;
      }

      return string;
    };
    URI.parseQuery = function(string, escapeQuerySpace) {
      if (!string) {
        return {};
      }

      // throw out the funky business - "?"[name"="value"&"]+
      string = string.replace(/&+/g, '&').replace(/^\?*&*|&+$/g, '');

      if (!string) {
        return {};
      }

      var items = {};
      var splits = string.split('&');
      var length = splits.length;
      var v, name, value;

      for (var i = 0; i < length; i++) {
        v = splits[i].split('=');
        name = URI.decodeQuery(v.shift(), escapeQuerySpace);
        // no "=" is null according to http://dvcs.w3.org/hg/url/raw-file/tip/Overview.html#collect-url-parameters
        value = v.length ? URI.decodeQuery(v.join('='), escapeQuerySpace) : null;

        if (hasOwn.call(items, name)) {
          if (typeof items[name] === 'string' || items[name] === null) {
            items[name] = [items[name]];
          }

          items[name].push(value);
        } else {
          items[name] = value;
        }
      }

      return items;
    };

    URI.build = function(parts) {
      var t = '';

      if (parts.protocol) {
        t += parts.protocol + ':';
      }

      if (!parts.urn && (t || parts.hostname)) {
        t += '//';
      }

      t += (URI.buildAuthority(parts) || '');

      if (typeof parts.path === 'string') {
        if (parts.path.charAt(0) !== '/' && typeof parts.hostname === 'string') {
          t += '/';
        }

        t += parts.path;
      }

      if (typeof parts.query === 'string' && parts.query) {
        t += '?' + parts.query;
      }

      if (typeof parts.fragment === 'string' && parts.fragment) {
        t += '#' + parts.fragment;
      }
      return t;
    };
    URI.buildHost = function(parts) {
      var t = '';

      if (!parts.hostname) {
        return '';
      } else if (URI.ip6_expression.test(parts.hostname)) {
        t += '[' + parts.hostname + ']';
      } else {
        t += parts.hostname;
      }

      if (parts.port) {
        t += ':' + parts.port;
      }

      return t;
    };
    URI.buildAuthority = function(parts) {
      return URI.buildUserinfo(parts) + URI.buildHost(parts);
    };
    URI.buildUserinfo = function(parts) {
      var t = '';

      if (parts.username) {
        t += URI.encode(parts.username);
      }

      if (parts.password) {
        t += ':' + URI.encode(parts.password);
      }

      if (t) {
        t += '@';
      }

      return t;
    };
    URI.buildQuery = function(data, duplicateQueryParameters, escapeQuerySpace) {
      // according to http://tools.ietf.org/html/rfc3986 or http://labs.apache.org/webarch/uri/rfc/rfc3986.html
      // being »-._~!$&'()*+,;=:@/?« %HEX and alnum are allowed
      // the RFC explicitly states ?/foo being a valid use case, no mention of parameter syntax!
      // URI.js treats the query string as being application/x-www-form-urlencoded
      // see http://www.w3.org/TR/REC-html40/interact/forms.html#form-content-type

      var t = '';
      var unique, key, i, length;
      for (key in data) {
        if (hasOwn.call(data, key) && key) {
          if (isArray(data[key])) {
            unique = {};
            for (i = 0, length = data[key].length; i < length; i++) {
              if (data[key][i] !== undefined && unique[data[key][i] + ''] === undefined) {
                t += '&' + URI.buildQueryParameter(key, data[key][i], escapeQuerySpace);
                if (duplicateQueryParameters !== true) {
                  unique[data[key][i] + ''] = true;
                }
              }
            }
          } else if (data[key] !== undefined) {
            t += '&' + URI.buildQueryParameter(key, data[key], escapeQuerySpace);
          }
        }
      }

      return t.substring(1);
    };
    URI.buildQueryParameter = function(name, value, escapeQuerySpace) {
      // http://www.w3.org/TR/REC-html40/interact/forms.html#form-content-type -- application/x-www-form-urlencoded
      // don't append "=" for null values, according to http://dvcs.w3.org/hg/url/raw-file/tip/Overview.html#url-parameter-serialization
      return URI.encodeQuery(name, escapeQuerySpace) + (value !== null ? '=' + URI.encodeQuery(value, escapeQuerySpace) : '');
    };

    URI.addQuery = function(data, name, value) {
      if (typeof name === 'object') {
        for (var key in name) {
          if (hasOwn.call(name, key)) {
            URI.addQuery(data, key, name[key]);
          }
        }
      } else if (typeof name === 'string') {
        if (data[name] === undefined) {
          data[name] = value;
          return;
        } else if (typeof data[name] === 'string') {
          data[name] = [data[name]];
        }

        if (!isArray(value)) {
          value = [value];
        }

        data[name] = (data[name] || []).concat(value);
      } else {
        throw new TypeError('URI.addQuery() accepts an object, string as the name parameter');
      }
    };

    URI.setQuery = function(data, name, value) {
      if (typeof name === 'object') {
        for (var key in name) {
          if (hasOwn.call(name, key)) {
            URI.setQuery(data, key, name[key]);
          }
        }
      } else if (typeof name === 'string') {
        data[name] = value === undefined ? null : value;
      } else {
        throw new TypeError('URI.setQuery() accepts an object, string as the name parameter');
      }
    };

    URI.removeQuery = function(data, name, value) {
      var i, length, key;

      if (isArray(name)) {
        for (i = 0, length = name.length; i < length; i++) {
          data[name[i]] = undefined;
        }
      } else if (getType(name) === 'RegExp') {
        for (key in data) {
          if (name.test(key)) {
            data[key] = undefined;
          }
        }
      } else if (typeof name === 'object') {
        for (key in name) {
          if (hasOwn.call(name, key)) {
            URI.removeQuery(data, key, name[key]);
          }
        }
      } else if (typeof name === 'string') {
        if (value !== undefined) {
          if (getType(value) === 'RegExp') {
            if (!isArray(data[name]) && value.test(data[name])) {
              data[name] = undefined;
            } else {
              data[name] = filterArrayValues(data[name], value);
            }
          } else if (data[name] === String(value) && (!isArray(value) || value.length === 1)) {
            data[name] = undefined;
          } else if (isArray(data[name])) {
            data[name] = filterArrayValues(data[name], value);
          }
        } else {
          data[name] = undefined;
        }
      } else {
        throw new TypeError('URI.removeQuery() accepts an object, string, RegExp as the first parameter');
      }
    };
    URI.hasQuery = function(data, name, value, withinArray) {
      switch (getType(name)) {
        case 'String':
          // Nothing to do here
          break;

        case 'RegExp':
          for (var key in data) {
            if (hasOwn.call(data, key)) {
              if (name.test(key) && (value === undefined || URI.hasQuery(data, key, value))) {
                return true;
              }
            }
          }

          return false;

        case 'Object':
          for (var _key in name) {
            if (hasOwn.call(name, _key)) {
              if (!URI.hasQuery(data, _key, name[_key])) {
                return false;
              }
            }
          }

          return true;

        default:
          throw new TypeError('URI.hasQuery() accepts a string, regular expression or object as the name parameter');
      }

      switch (getType(value)) {
        case 'Undefined':
          // true if exists (but may be empty)
          return name in data; // data[name] !== undefined;

        case 'Boolean':
          // true if exists and non-empty
          var _booly = Boolean(isArray(data[name]) ? data[name].length : data[name]);
          return value === _booly;

        case 'Function':
          // allow complex comparison
          return !!value(data[name], name, data);

        case 'Array':
          if (!isArray(data[name])) {
            return false;
          }

          var op = withinArray ? arrayContains : arraysEqual;
          return op(data[name], value);

        case 'RegExp':
          if (!isArray(data[name])) {
            return Boolean(data[name] && data[name].match(value));
          }

          if (!withinArray) {
            return false;
          }

          return arrayContains(data[name], value);

        case 'Number':
          value = String(value);
          /* falls through */
        case 'String':
          if (!isArray(data[name])) {
            return data[name] === value;
          }

          if (!withinArray) {
            return false;
          }

          return arrayContains(data[name], value);

        default:
          throw new TypeError('URI.hasQuery() accepts undefined, boolean, string, number, RegExp, Function as the value parameter');
      }
    };


    URI.joinPaths = function() {
      var input = [];
      var segments = [];
      var nonEmptySegments = 0;

      for (var i = 0; i < arguments.length; i++) {
        var url = new URI(arguments[i]);
        input.push(url);
        var _segments = url.segment();
        for (var s = 0; s < _segments.length; s++) {
          if (typeof _segments[s] === 'string') {
            segments.push(_segments[s]);
          }

          if (_segments[s]) {
            nonEmptySegments++;
          }
        }
      }

      if (!segments.length || !nonEmptySegments) {
        return new URI('');
      }

      var uri = new URI('').segment(segments);

      if (input[0].path() === '' || input[0].path().slice(0, 1) === '/') {
        uri.path('/' + uri.path());
      }

      return uri.normalize();
    };

    URI.commonPath = function(one, two) {
      var length = Math.min(one.length, two.length);
      var pos;

      // find first non-matching character
      for (pos = 0; pos < length; pos++) {
        if (one.charAt(pos) !== two.charAt(pos)) {
          pos--;
          break;
        }
      }

      if (pos < 1) {
        return one.charAt(0) === two.charAt(0) && one.charAt(0) === '/' ? '/' : '';
      }

      // revert to last /
      if (one.charAt(pos) !== '/' || two.charAt(pos) !== '/') {
        pos = one.substring(0, pos).lastIndexOf('/');
      }

      return one.substring(0, pos + 1);
    };

    URI.withinString = function(string, callback, options) {
      options || (options = {});
      var _start = options.start || URI.findUri.start;
      var _end = options.end || URI.findUri.end;
      var _trim = options.trim || URI.findUri.trim;
      var _parens = options.parens || URI.findUri.parens;
      var _attributeOpen = /[a-z0-9-]=["']?$/i;

      _start.lastIndex = 0;
      while (true) {
        var match = _start.exec(string);
        if (!match) {
          break;
        }

        var start = match.index;
        if (options.ignoreHtml) {
          // attribut(e=["']?$)
          var attributeOpen = string.slice(Math.max(start - 3, 0), start);
          if (attributeOpen && _attributeOpen.test(attributeOpen)) {
            continue;
          }
        }

        var end = start + string.slice(start).search(_end);
        var slice = string.slice(start, end);
        // make sure we include well balanced parens
        var parensEnd = -1;
        while (true) {
          var parensMatch = _parens.exec(slice);
          if (!parensMatch) {
            break;
          }

          var parensMatchEnd = parensMatch.index + parensMatch[0].length;
          parensEnd = Math.max(parensEnd, parensMatchEnd);
        }

        if (parensEnd > -1) {
          slice = slice.slice(0, parensEnd) + slice.slice(parensEnd).replace(_trim, '');
        } else {
          slice = slice.replace(_trim, '');
        }

        if (slice.length <= match[0].length) {
          // the extract only contains the starting marker of a URI,
          // e.g. "www" or "http://"
          continue;
        }

        if (options.ignore && options.ignore.test(slice)) {
          continue;
        }

        end = start + slice.length;
        var result = callback(slice, start, end, string);
        if (result === undefined) {
          _start.lastIndex = end;
          continue;
        }

        result = String(result);
        string = string.slice(0, start) + result + string.slice(end);
        _start.lastIndex = start + result.length;
      }

      _start.lastIndex = 0;
      return string;
    };

    URI.ensureValidHostname = function(v, protocol) {
      // Theoretically URIs allow percent-encoding in Hostnames (according to RFC 3986)
      // they are not part of DNS and therefore ignored by URI.js

      var hasHostname = !!v; // not null and not an empty string
      var hasProtocol = !!protocol;
      var rejectEmptyHostname = false;

      if (hasProtocol) {
        rejectEmptyHostname = arrayContains(URI.hostProtocols, protocol);
      }

      if (rejectEmptyHostname && !hasHostname) {
        throw new TypeError('Hostname cannot be empty, if protocol is ' + protocol);
      } else if (v && v.match(URI.invalid_hostname_characters)) {
        // test punycode
        if (!punycode$$1) {
          throw new TypeError('Hostname "' + v + '" contains characters other than [A-Z0-9.-:_] and Punycode.js is not available');
        }
        if (punycode$$1.toASCII(v).match(URI.invalid_hostname_characters)) {
          throw new TypeError('Hostname "' + v + '" contains characters other than [A-Z0-9.-:_]');
        }
      }
    };

    URI.ensureValidPort = function (v) {
      if (!v) {
        return;
      }

      var port = Number(v);
      if (isInteger(port) && (port > 0) && (port < 65536)) {
        return;
      }

      throw new TypeError('Port "' + v + '" is not a valid port');
    };

    // noConflict
    URI.noConflict = function(removeAll) {
      if (removeAll) {
        var unconflicted = {
          URI: this.noConflict()
        };

        if (root.URITemplate && typeof root.URITemplate.noConflict === 'function') {
          unconflicted.URITemplate = root.URITemplate.noConflict();
        }

        if (root.IPv6 && typeof root.IPv6.noConflict === 'function') {
          unconflicted.IPv6 = root.IPv6.noConflict();
        }

        if (root.SecondLevelDomains && typeof root.SecondLevelDomains.noConflict === 'function') {
          unconflicted.SecondLevelDomains = root.SecondLevelDomains.noConflict();
        }

        return unconflicted;
      } else if (root.URI === this) {
        root.URI = _URI;
      }

      return this;
    };

    p.build = function(deferBuild) {
      if (deferBuild === true) {
        this._deferred_build = true;
      } else if (deferBuild === undefined || this._deferred_build) {
        this._string = URI.build(this._parts);
        this._deferred_build = false;
      }

      return this;
    };

    p.clone = function() {
      return new URI(this);
    };

    p.valueOf = p.toString = function() {
      return this.build(false)._string;
    };


    function generateSimpleAccessor(_part){
      return function(v, build) {
        if (v === undefined) {
          return this._parts[_part] || '';
        } else {
          this._parts[_part] = v || null;
          this.build(!build);
          return this;
        }
      };
    }

    function generatePrefixAccessor(_part, _key){
      return function(v, build) {
        if (v === undefined) {
          return this._parts[_part] || '';
        } else {
          if (v !== null) {
            v = v + '';
            if (v.charAt(0) === _key) {
              v = v.substring(1);
            }
          }

          this._parts[_part] = v;
          this.build(!build);
          return this;
        }
      };
    }

    p.protocol = generateSimpleAccessor('protocol');
    p.username = generateSimpleAccessor('username');
    p.password = generateSimpleAccessor('password');
    p.hostname = generateSimpleAccessor('hostname');
    p.port = generateSimpleAccessor('port');
    p.query = generatePrefixAccessor('query', '?');
    p.fragment = generatePrefixAccessor('fragment', '#');

    p.search = function(v, build) {
      var t = this.query(v, build);
      return typeof t === 'string' && t.length ? ('?' + t) : t;
    };
    p.hash = function(v, build) {
      var t = this.fragment(v, build);
      return typeof t === 'string' && t.length ? ('#' + t) : t;
    };

    p.pathname = function(v, build) {
      if (v === undefined || v === true) {
        var res = this._parts.path || (this._parts.hostname ? '/' : '');
        return v ? (this._parts.urn ? URI.decodeUrnPath : URI.decodePath)(res) : res;
      } else {
        if (this._parts.urn) {
          this._parts.path = v ? URI.recodeUrnPath(v) : '';
        } else {
          this._parts.path = v ? URI.recodePath(v) : '/';
        }
        this.build(!build);
        return this;
      }
    };
    p.path = p.pathname;
    p.href = function(href, build) {
      var key;

      if (href === undefined) {
        return this.toString();
      }

      this._string = '';
      this._parts = URI._parts();

      var _URI = href instanceof URI;
      var _object = typeof href === 'object' && (href.hostname || href.path || href.pathname);
      if (href.nodeName) {
        var attribute = URI.getDomAttribute(href);
        href = href[attribute] || '';
        _object = false;
      }

      // window.location is reported to be an object, but it's not the sort
      // of object we're looking for:
      // * location.protocol ends with a colon
      // * location.query != object.search
      // * location.hash != object.fragment
      // simply serializing the unknown object should do the trick
      // (for location, not for everything...)
      if (!_URI && _object && href.pathname !== undefined) {
        href = href.toString();
      }

      if (typeof href === 'string' || href instanceof String) {
        this._parts = URI.parse(String(href), this._parts);
      } else if (_URI || _object) {
        var src = _URI ? href._parts : href;
        for (key in src) {
          if (key === 'query') { continue; }
          if (hasOwn.call(this._parts, key)) {
            this._parts[key] = src[key];
          }
        }
        if (src.query) {
          this.query(src.query, false);
        }
      } else {
        throw new TypeError('invalid input');
      }

      this.build(!build);
      return this;
    };

    // identification accessors
    p.is = function(what) {
      var ip = false;
      var ip4 = false;
      var ip6 = false;
      var name = false;
      var sld = false;
      var idn = false;
      var punycode$$1 = false;
      var relative = !this._parts.urn;

      if (this._parts.hostname) {
        relative = false;
        ip4 = URI.ip4_expression.test(this._parts.hostname);
        ip6 = URI.ip6_expression.test(this._parts.hostname);
        ip = ip4 || ip6;
        name = !ip;
        sld = name && SLD && SLD.has(this._parts.hostname);
        idn = name && URI.idn_expression.test(this._parts.hostname);
        punycode$$1 = name && URI.punycode_expression.test(this._parts.hostname);
      }

      switch (what.toLowerCase()) {
        case 'relative':
          return relative;

        case 'absolute':
          return !relative;

        // hostname identification
        case 'domain':
        case 'name':
          return name;

        case 'sld':
          return sld;

        case 'ip':
          return ip;

        case 'ip4':
        case 'ipv4':
        case 'inet4':
          return ip4;

        case 'ip6':
        case 'ipv6':
        case 'inet6':
          return ip6;

        case 'idn':
          return idn;

        case 'url':
          return !this._parts.urn;

        case 'urn':
          return !!this._parts.urn;

        case 'punycode':
          return punycode$$1;
      }

      return null;
    };

    // component specific input validation
    var _protocol = p.protocol;
    var _port = p.port;
    var _hostname = p.hostname;

    p.protocol = function(v, build) {
      if (v) {
        // accept trailing ://
        v = v.replace(/:(\/\/)?$/, '');

        if (!v.match(URI.protocol_expression)) {
          throw new TypeError('Protocol "' + v + '" contains characters other than [A-Z0-9.+-] or doesn\'t start with [A-Z]');
        }
      }

      return _protocol.call(this, v, build);
    };
    p.scheme = p.protocol;
    p.port = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v !== undefined) {
        if (v === 0) {
          v = null;
        }

        if (v) {
          v += '';
          if (v.charAt(0) === ':') {
            v = v.substring(1);
          }

          URI.ensureValidPort(v);
        }
      }
      return _port.call(this, v, build);
    };
    p.hostname = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v !== undefined) {
        var x = { preventInvalidHostname: this._parts.preventInvalidHostname };
        var res = URI.parseHost(v, x);
        if (res !== '/') {
          throw new TypeError('Hostname "' + v + '" contains characters other than [A-Z0-9.-]');
        }

        v = x.hostname;
        if (this._parts.preventInvalidHostname) {
          URI.ensureValidHostname(v, this._parts.protocol);
        }
      }

      return _hostname.call(this, v, build);
    };

    // compound accessors
    p.origin = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v === undefined) {
        var protocol = this.protocol();
        var authority = this.authority();
        if (!authority) {
          return '';
        }

        return (protocol ? protocol + '://' : '') + this.authority();
      } else {
        var origin = URI(v);
        this
          .protocol(origin.protocol())
          .authority(origin.authority())
          .build(!build);
        return this;
      }
    };
    p.host = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v === undefined) {
        return this._parts.hostname ? URI.buildHost(this._parts) : '';
      } else {
        var res = URI.parseHost(v, this._parts);
        if (res !== '/') {
          throw new TypeError('Hostname "' + v + '" contains characters other than [A-Z0-9.-]');
        }

        this.build(!build);
        return this;
      }
    };
    p.authority = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v === undefined) {
        return this._parts.hostname ? URI.buildAuthority(this._parts) : '';
      } else {
        var res = URI.parseAuthority(v, this._parts);
        if (res !== '/') {
          throw new TypeError('Hostname "' + v + '" contains characters other than [A-Z0-9.-]');
        }

        this.build(!build);
        return this;
      }
    };
    p.userinfo = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v === undefined) {
        var t = URI.buildUserinfo(this._parts);
        return t ? t.substring(0, t.length -1) : t;
      } else {
        if (v[v.length-1] !== '@') {
          v += '@';
        }

        URI.parseUserinfo(v, this._parts);
        this.build(!build);
        return this;
      }
    };
    p.resource = function(v, build) {
      var parts;

      if (v === undefined) {
        return this.path() + this.search() + this.hash();
      }

      parts = URI.parse(v);
      this._parts.path = parts.path;
      this._parts.query = parts.query;
      this._parts.fragment = parts.fragment;
      this.build(!build);
      return this;
    };

    // fraction accessors
    p.subdomain = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      // convenience, return "www" from "www.example.org"
      if (v === undefined) {
        if (!this._parts.hostname || this.is('IP')) {
          return '';
        }

        // grab domain and add another segment
        var end = this._parts.hostname.length - this.domain().length - 1;
        return this._parts.hostname.substring(0, end) || '';
      } else {
        var e = this._parts.hostname.length - this.domain().length;
        var sub = this._parts.hostname.substring(0, e);
        var replace = new RegExp('^' + escapeRegEx(sub));

        if (v && v.charAt(v.length - 1) !== '.') {
          v += '.';
        }

        if (v.indexOf(':') !== -1) {
          throw new TypeError('Domains cannot contain colons');
        }

        if (v) {
          URI.ensureValidHostname(v, this._parts.protocol);
        }

        this._parts.hostname = this._parts.hostname.replace(replace, v);
        this.build(!build);
        return this;
      }
    };
    p.domain = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (typeof v === 'boolean') {
        build = v;
        v = undefined;
      }

      // convenience, return "example.org" from "www.example.org"
      if (v === undefined) {
        if (!this._parts.hostname || this.is('IP')) {
          return '';
        }

        // if hostname consists of 1 or 2 segments, it must be the domain
        var t = this._parts.hostname.match(/\./g);
        if (t && t.length < 2) {
          return this._parts.hostname;
        }

        // grab tld and add another segment
        var end = this._parts.hostname.length - this.tld(build).length - 1;
        end = this._parts.hostname.lastIndexOf('.', end -1) + 1;
        return this._parts.hostname.substring(end) || '';
      } else {
        if (!v) {
          throw new TypeError('cannot set domain empty');
        }

        if (v.indexOf(':') !== -1) {
          throw new TypeError('Domains cannot contain colons');
        }

        URI.ensureValidHostname(v, this._parts.protocol);

        if (!this._parts.hostname || this.is('IP')) {
          this._parts.hostname = v;
        } else {
          var replace = new RegExp(escapeRegEx(this.domain()) + '$');
          this._parts.hostname = this._parts.hostname.replace(replace, v);
        }

        this.build(!build);
        return this;
      }
    };
    p.tld = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (typeof v === 'boolean') {
        build = v;
        v = undefined;
      }

      // return "org" from "www.example.org"
      if (v === undefined) {
        if (!this._parts.hostname || this.is('IP')) {
          return '';
        }

        var pos = this._parts.hostname.lastIndexOf('.');
        var tld = this._parts.hostname.substring(pos + 1);

        if (build !== true && SLD && SLD.list[tld.toLowerCase()]) {
          return SLD.get(this._parts.hostname) || tld;
        }

        return tld;
      } else {
        var replace;

        if (!v) {
          throw new TypeError('cannot set TLD empty');
        } else if (v.match(/[^a-zA-Z0-9-]/)) {
          if (SLD && SLD.is(v)) {
            replace = new RegExp(escapeRegEx(this.tld()) + '$');
            this._parts.hostname = this._parts.hostname.replace(replace, v);
          } else {
            throw new TypeError('TLD "' + v + '" contains characters other than [A-Z0-9]');
          }
        } else if (!this._parts.hostname || this.is('IP')) {
          throw new ReferenceError('cannot set TLD on non-domain host');
        } else {
          replace = new RegExp(escapeRegEx(this.tld()) + '$');
          this._parts.hostname = this._parts.hostname.replace(replace, v);
        }

        this.build(!build);
        return this;
      }
    };
    p.directory = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v === undefined || v === true) {
        if (!this._parts.path && !this._parts.hostname) {
          return '';
        }

        if (this._parts.path === '/') {
          return '/';
        }

        var end = this._parts.path.length - this.filename().length - 1;
        var res = this._parts.path.substring(0, end) || (this._parts.hostname ? '/' : '');

        return v ? URI.decodePath(res) : res;

      } else {
        var e = this._parts.path.length - this.filename().length;
        var directory = this._parts.path.substring(0, e);
        var replace = new RegExp('^' + escapeRegEx(directory));

        // fully qualifier directories begin with a slash
        if (!this.is('relative')) {
          if (!v) {
            v = '/';
          }

          if (v.charAt(0) !== '/') {
            v = '/' + v;
          }
        }

        // directories always end with a slash
        if (v && v.charAt(v.length - 1) !== '/') {
          v += '/';
        }

        v = URI.recodePath(v);
        this._parts.path = this._parts.path.replace(replace, v);
        this.build(!build);
        return this;
      }
    };
    p.filename = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (typeof v !== 'string') {
        if (!this._parts.path || this._parts.path === '/') {
          return '';
        }

        var pos = this._parts.path.lastIndexOf('/');
        var res = this._parts.path.substring(pos+1);

        return v ? URI.decodePathSegment(res) : res;
      } else {
        var mutatedDirectory = false;

        if (v.charAt(0) === '/') {
          v = v.substring(1);
        }

        if (v.match(/\.?\//)) {
          mutatedDirectory = true;
        }

        var replace = new RegExp(escapeRegEx(this.filename()) + '$');
        v = URI.recodePath(v);
        this._parts.path = this._parts.path.replace(replace, v);

        if (mutatedDirectory) {
          this.normalizePath(build);
        } else {
          this.build(!build);
        }

        return this;
      }
    };
    p.suffix = function(v, build) {
      if (this._parts.urn) {
        return v === undefined ? '' : this;
      }

      if (v === undefined || v === true) {
        if (!this._parts.path || this._parts.path === '/') {
          return '';
        }

        var filename = this.filename();
        var pos = filename.lastIndexOf('.');
        var s, res;

        if (pos === -1) {
          return '';
        }

        // suffix may only contain alnum characters (yup, I made this up.)
        s = filename.substring(pos+1);
        res = (/^[a-z0-9%]+$/i).test(s) ? s : '';
        return v ? URI.decodePathSegment(res) : res;
      } else {
        if (v.charAt(0) === '.') {
          v = v.substring(1);
        }

        var suffix = this.suffix();
        var replace;

        if (!suffix) {
          if (!v) {
            return this;
          }

          this._parts.path += '.' + URI.recodePath(v);
        } else if (!v) {
          replace = new RegExp(escapeRegEx('.' + suffix) + '$');
        } else {
          replace = new RegExp(escapeRegEx(suffix) + '$');
        }

        if (replace) {
          v = URI.recodePath(v);
          this._parts.path = this._parts.path.replace(replace, v);
        }

        this.build(!build);
        return this;
      }
    };
    p.segment = function(segment, v, build) {
      var separator = this._parts.urn ? ':' : '/';
      var path = this.path();
      var absolute = path.substring(0, 1) === '/';
      var segments = path.split(separator);

      if (segment !== undefined && typeof segment !== 'number') {
        build = v;
        v = segment;
        segment = undefined;
      }

      if (segment !== undefined && typeof segment !== 'number') {
        throw new Error('Bad segment "' + segment + '", must be 0-based integer');
      }

      if (absolute) {
        segments.shift();
      }

      if (segment < 0) {
        // allow negative indexes to address from the end
        segment = Math.max(segments.length + segment, 0);
      }

      if (v === undefined) {
        /*jshint laxbreak: true */
        return segment === undefined
          ? segments
          : segments[segment];
        /*jshint laxbreak: false */
      } else if (segment === null || segments[segment] === undefined) {
        if (isArray(v)) {
          segments = [];
          // collapse empty elements within array
          for (var i=0, l=v.length; i < l; i++) {
            if (!v[i].length && (!segments.length || !segments[segments.length -1].length)) {
              continue;
            }

            if (segments.length && !segments[segments.length -1].length) {
              segments.pop();
            }

            segments.push(trimSlashes(v[i]));
          }
        } else if (v || typeof v === 'string') {
          v = trimSlashes(v);
          if (segments[segments.length -1] === '') {
            // empty trailing elements have to be overwritten
            // to prevent results such as /foo//bar
            segments[segments.length -1] = v;
          } else {
            segments.push(v);
          }
        }
      } else {
        if (v) {
          segments[segment] = trimSlashes(v);
        } else {
          segments.splice(segment, 1);
        }
      }

      if (absolute) {
        segments.unshift('');
      }

      return this.path(segments.join(separator), build);
    };
    p.segmentCoded = function(segment, v, build) {
      var segments, i, l;

      if (typeof segment !== 'number') {
        build = v;
        v = segment;
        segment = undefined;
      }

      if (v === undefined) {
        segments = this.segment(segment, v, build);
        if (!isArray(segments)) {
          segments = segments !== undefined ? URI.decode(segments) : undefined;
        } else {
          for (i = 0, l = segments.length; i < l; i++) {
            segments[i] = URI.decode(segments[i]);
          }
        }

        return segments;
      }

      if (!isArray(v)) {
        v = (typeof v === 'string' || v instanceof String) ? URI.encode(v) : v;
      } else {
        for (i = 0, l = v.length; i < l; i++) {
          v[i] = URI.encode(v[i]);
        }
      }

      return this.segment(segment, v, build);
    };

    // mutating query string
    var q = p.query;
    p.query = function(v, build) {
      if (v === true) {
        return URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace);
      } else if (typeof v === 'function') {
        var data = URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace);
        var result = v.call(this, data);
        this._parts.query = URI.buildQuery(result || data, this._parts.duplicateQueryParameters, this._parts.escapeQuerySpace);
        this.build(!build);
        return this;
      } else if (v !== undefined && typeof v !== 'string') {
        this._parts.query = URI.buildQuery(v, this._parts.duplicateQueryParameters, this._parts.escapeQuerySpace);
        this.build(!build);
        return this;
      } else {
        return q.call(this, v, build);
      }
    };
    p.setQuery = function(name, value, build) {
      var data = URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace);

      if (typeof name === 'string' || name instanceof String) {
        data[name] = value !== undefined ? value : null;
      } else if (typeof name === 'object') {
        for (var key in name) {
          if (hasOwn.call(name, key)) {
            data[key] = name[key];
          }
        }
      } else {
        throw new TypeError('URI.addQuery() accepts an object, string as the name parameter');
      }

      this._parts.query = URI.buildQuery(data, this._parts.duplicateQueryParameters, this._parts.escapeQuerySpace);
      if (typeof name !== 'string') {
        build = value;
      }

      this.build(!build);
      return this;
    };
    p.addQuery = function(name, value, build) {
      var data = URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace);
      URI.addQuery(data, name, value === undefined ? null : value);
      this._parts.query = URI.buildQuery(data, this._parts.duplicateQueryParameters, this._parts.escapeQuerySpace);
      if (typeof name !== 'string') {
        build = value;
      }

      this.build(!build);
      return this;
    };
    p.removeQuery = function(name, value, build) {
      var data = URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace);
      URI.removeQuery(data, name, value);
      this._parts.query = URI.buildQuery(data, this._parts.duplicateQueryParameters, this._parts.escapeQuerySpace);
      if (typeof name !== 'string') {
        build = value;
      }

      this.build(!build);
      return this;
    };
    p.hasQuery = function(name, value, withinArray) {
      var data = URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace);
      return URI.hasQuery(data, name, value, withinArray);
    };
    p.setSearch = p.setQuery;
    p.addSearch = p.addQuery;
    p.removeSearch = p.removeQuery;
    p.hasSearch = p.hasQuery;

    // sanitizing URLs
    p.normalize = function() {
      if (this._parts.urn) {
        return this
          .normalizeProtocol(false)
          .normalizePath(false)
          .normalizeQuery(false)
          .normalizeFragment(false)
          .build();
      }

      return this
        .normalizeProtocol(false)
        .normalizeHostname(false)
        .normalizePort(false)
        .normalizePath(false)
        .normalizeQuery(false)
        .normalizeFragment(false)
        .build();
    };
    p.normalizeProtocol = function(build) {
      if (typeof this._parts.protocol === 'string') {
        this._parts.protocol = this._parts.protocol.toLowerCase();
        this.build(!build);
      }

      return this;
    };
    p.normalizeHostname = function(build) {
      if (this._parts.hostname) {
        if (this.is('IDN') && punycode$$1) {
          this._parts.hostname = punycode$$1.toASCII(this._parts.hostname);
        } else if (this.is('IPv6') && IPv6$$1) {
          this._parts.hostname = IPv6$$1.best(this._parts.hostname);
        }

        this._parts.hostname = this._parts.hostname.toLowerCase();
        this.build(!build);
      }

      return this;
    };
    p.normalizePort = function(build) {
      // remove port of it's the protocol's default
      if (typeof this._parts.protocol === 'string' && this._parts.port === URI.defaultPorts[this._parts.protocol]) {
        this._parts.port = null;
        this.build(!build);
      }

      return this;
    };
    p.normalizePath = function(build) {
      var _path = this._parts.path;
      if (!_path) {
        return this;
      }

      if (this._parts.urn) {
        this._parts.path = URI.recodeUrnPath(this._parts.path);
        this.build(!build);
        return this;
      }

      if (this._parts.path === '/') {
        return this;
      }

      _path = URI.recodePath(_path);

      var _was_relative;
      var _leadingParents = '';
      var _parent, _pos;

      // handle relative paths
      if (_path.charAt(0) !== '/') {
        _was_relative = true;
        _path = '/' + _path;
      }

      // handle relative files (as opposed to directories)
      if (_path.slice(-3) === '/..' || _path.slice(-2) === '/.') {
        _path += '/';
      }

      // resolve simples
      _path = _path
        .replace(/(\/(\.\/)+)|(\/\.$)/g, '/')
        .replace(/\/{2,}/g, '/');

      // remember leading parents
      if (_was_relative) {
        _leadingParents = _path.substring(1).match(/^(\.\.\/)+/) || '';
        if (_leadingParents) {
          _leadingParents = _leadingParents[0];
        }
      }

      // resolve parents
      while (true) {
        _parent = _path.search(/\/\.\.(\/|$)/);
        if (_parent === -1) {
          // no more ../ to resolve
          break;
        } else if (_parent === 0) {
          // top level cannot be relative, skip it
          _path = _path.substring(3);
          continue;
        }

        _pos = _path.substring(0, _parent).lastIndexOf('/');
        if (_pos === -1) {
          _pos = _parent;
        }
        _path = _path.substring(0, _pos) + _path.substring(_parent + 3);
      }

      // revert to relative
      if (_was_relative && this.is('relative')) {
        _path = _leadingParents + _path.substring(1);
      }

      this._parts.path = _path;
      this.build(!build);
      return this;
    };
    p.normalizePathname = p.normalizePath;
    p.normalizeQuery = function(build) {
      if (typeof this._parts.query === 'string') {
        if (!this._parts.query.length) {
          this._parts.query = null;
        } else {
          this.query(URI.parseQuery(this._parts.query, this._parts.escapeQuerySpace));
        }

        this.build(!build);
      }

      return this;
    };
    p.normalizeFragment = function(build) {
      if (!this._parts.fragment) {
        this._parts.fragment = null;
        this.build(!build);
      }

      return this;
    };
    p.normalizeSearch = p.normalizeQuery;
    p.normalizeHash = p.normalizeFragment;

    p.iso8859 = function() {
      // expect unicode input, iso8859 output
      var e = URI.encode;
      var d = URI.decode;

      URI.encode = escape;
      URI.decode = decodeURIComponent;
      try {
        this.normalize();
      } finally {
        URI.encode = e;
        URI.decode = d;
      }
      return this;
    };

    p.unicode = function() {
      // expect iso8859 input, unicode output
      var e = URI.encode;
      var d = URI.decode;

      URI.encode = strictEncodeURIComponent;
      URI.decode = unescape;
      try {
        this.normalize();
      } finally {
        URI.encode = e;
        URI.decode = d;
      }
      return this;
    };

    p.readable = function() {
      var uri = this.clone();
      // removing username, password, because they shouldn't be displayed according to RFC 3986
      uri.username('').password('').normalize();
      var t = '';
      if (uri._parts.protocol) {
        t += uri._parts.protocol + '://';
      }

      if (uri._parts.hostname) {
        if (uri.is('punycode') && punycode$$1) {
          t += punycode$$1.toUnicode(uri._parts.hostname);
          if (uri._parts.port) {
            t += ':' + uri._parts.port;
          }
        } else {
          t += uri.host();
        }
      }

      if (uri._parts.hostname && uri._parts.path && uri._parts.path.charAt(0) !== '/') {
        t += '/';
      }

      t += uri.path(true);
      if (uri._parts.query) {
        var q = '';
        for (var i = 0, qp = uri._parts.query.split('&'), l = qp.length; i < l; i++) {
          var kv = (qp[i] || '').split('=');
          q += '&' + URI.decodeQuery(kv[0], this._parts.escapeQuerySpace)
            .replace(/&/g, '%26');

          if (kv[1] !== undefined) {
            q += '=' + URI.decodeQuery(kv[1], this._parts.escapeQuerySpace)
              .replace(/&/g, '%26');
          }
        }
        t += '?' + q.substring(1);
      }

      t += URI.decodeQuery(uri.hash(), true);
      return t;
    };

    // resolving relative and absolute URLs
    p.absoluteTo = function(base) {
      var resolved = this.clone();
      var properties = ['protocol', 'username', 'password', 'hostname', 'port'];
      var basedir, i, p;

      if (this._parts.urn) {
        throw new Error('URNs do not have any generally defined hierarchical components');
      }

      if (!(base instanceof URI)) {
        base = new URI(base);
      }

      if (resolved._parts.protocol) {
        // Directly returns even if this._parts.hostname is empty.
        return resolved;
      } else {
        resolved._parts.protocol = base._parts.protocol;
      }

      if (this._parts.hostname) {
        return resolved;
      }

      for (i = 0; (p = properties[i]); i++) {
        resolved._parts[p] = base._parts[p];
      }

      if (!resolved._parts.path) {
        resolved._parts.path = base._parts.path;
        if (!resolved._parts.query) {
          resolved._parts.query = base._parts.query;
        }
      } else {
        if (resolved._parts.path.substring(-2) === '..') {
          resolved._parts.path += '/';
        }

        if (resolved.path().charAt(0) !== '/') {
          basedir = base.directory();
          basedir = basedir ? basedir : base.path().indexOf('/') === 0 ? '/' : '';
          resolved._parts.path = (basedir ? (basedir + '/') : '') + resolved._parts.path;
          resolved.normalizePath();
        }
      }

      resolved.build();
      return resolved;
    };
    p.relativeTo = function(base) {
      var relative = this.clone().normalize();
      var relativeParts, baseParts, common, relativePath, basePath;

      if (relative._parts.urn) {
        throw new Error('URNs do not have any generally defined hierarchical components');
      }

      base = new URI(base).normalize();
      relativeParts = relative._parts;
      baseParts = base._parts;
      relativePath = relative.path();
      basePath = base.path();

      if (relativePath.charAt(0) !== '/') {
        throw new Error('URI is already relative');
      }

      if (basePath.charAt(0) !== '/') {
        throw new Error('Cannot calculate a URI relative to another relative URI');
      }

      if (relativeParts.protocol === baseParts.protocol) {
        relativeParts.protocol = null;
      }

      if (relativeParts.username !== baseParts.username || relativeParts.password !== baseParts.password) {
        return relative.build();
      }

      if (relativeParts.protocol !== null || relativeParts.username !== null || relativeParts.password !== null) {
        return relative.build();
      }

      if (relativeParts.hostname === baseParts.hostname && relativeParts.port === baseParts.port) {
        relativeParts.hostname = null;
        relativeParts.port = null;
      } else {
        return relative.build();
      }

      if (relativePath === basePath) {
        relativeParts.path = '';
        return relative.build();
      }

      // determine common sub path
      common = URI.commonPath(relativePath, basePath);

      // If the paths have nothing in common, return a relative URL with the absolute path.
      if (!common) {
        return relative.build();
      }

      var parents = baseParts.path
        .substring(common.length)
        .replace(/[^\/]*$/, '')
        .replace(/.*?\//g, '../');

      relativeParts.path = (parents + relativeParts.path.substring(common.length)) || './';

      return relative.build();
    };

    // comparing URIs
    p.equals = function(uri) {
      var one = this.clone();
      var two = new URI(uri);
      var one_map = {};
      var two_map = {};
      var one_query, two_query, key;

      one.normalize();
      two.normalize();

      // exact match
      if (one.toString() === two.toString()) {
        return true;
      }

      // extract query string
      one_query = one.query();
      two_query = two.query();
      one.query('');
      two.query('');

      // definitely not equal if not even non-query parts match
      if (one.toString() !== two.toString()) {
        return false;
      }

      // query parameters have the same length, even if they're permuted
      if (one_query.length !== two_query.length) {
        return false;
      }

      one_map = URI.parseQuery(one_query, this._parts.escapeQuerySpace);
      two_map = URI.parseQuery(two_query, this._parts.escapeQuerySpace);

      for (key in one_map) {
        if (hasOwn.call(one_map, key)) {
          if (!isArray(one_map[key])) {
            if (one_map[key] !== two_map[key]) {
              return false;
            }
          } else if (!arraysEqual(one_map[key], two_map[key])) {
            return false;
          }
        }
      }

      for (key in two_map) {
        if (hasOwn.call(two_map, key)) {
          {
            // two contains a parameter not present in one
            return false;
          }
        }
      }

      return true;
    };

    // state
    p.preventInvalidHostname = function(v) {
      this._parts.preventInvalidHostname = !!v;
      return this;
    };

    p.duplicateQueryParameters = function(v) {
      this._parts.duplicateQueryParameters = !!v;
      return this;
    };

    p.escapeQuerySpace = function(v) {
      this._parts.escapeQuerySpace = !!v;
      return this;
    };

    return URI;
  }));
  });

  // copy-pasted from 
  // https://github.com/paldepind/flyd/blob/master/module/forwardto/index.js
  var forwardTo = lib.curryN(2, function (targ, fn) {
    var s = lib.stream();
    lib.map(function (v) {
      targ(fn(v));
    }, s);
    return s;
  });

  // copy-pasted from
  // https://github.com/paldepind/flyd/blob/master/module/filter/index.js
  var filter$1 = lib.curryN(2, function (fn, s) {
    return lib.combine(function (s, self) {
      if (fn(s())) self(s.val);
    }, [s]);
  });

  var _extends = Object.assign || function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var source = arguments[i];

      for (var key in source) {
        if (Object.prototype.hasOwnProperty.call(source, key)) {
          target[key] = source[key];
        }
      }
    }

    return target;
  };

  var slicedToArray = function () {
    function sliceIterator(arr, i) {
      var _arr = [];
      var _n = true;
      var _d = false;
      var _e = undefined;

      try {
        for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) {
          _arr.push(_s.value);

          if (i && _arr.length === i) break;
        }
      } catch (err) {
        _d = true;
        _e = err;
      } finally {
        try {
          if (!_n && _i["return"]) _i["return"]();
        } finally {
          if (_d) throw _e;
        }
      }

      return _arr;
    }

    return function (arr, i) {
      if (Array.isArray(arr)) {
        return arr;
      } else if (Symbol.iterator in Object(arr)) {
        return sliceIterator(arr, i);
      } else {
        throw new TypeError("Invalid attempt to destructure non-iterable instance");
      }
    };
  }();

  var STORAGE_DB = 'state-rss';
  var STORAGE_CHANNEL = 'channel-rss';

  /***** Some "functional" utilities ****/
  //const produce = immer.default.bind(immer)

  //console.logs args and returns the last one
  //This can be a bottleneck if we're logging ~1000 items at once. 
  //How do I know? I've tested this function with and without side effects
  //With log: lag with a few seconds. Without console.log: instantaneous
  var log = function log() {
      for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
          args[_key] = arguments[_key];
      }

      return console.log.apply(console, args), args[args.length - 1];
  };

  var uuid = function uuid() {
      return (Math.random() + 1).toString(36).slice(2);
  };

  /***********
   * Model
   *********/
  var init$1 = function init$$1() {
      return {
          source_categories: [{
              name: "Business",
              id: '3224lkjjf3'
          }, {
              name: "Science",
              id: '2kl34jsllksf'
          }, {
              name: "Uncategorized",
              id: '32l342lkj'
          }],
          sources: [{
              url: 'http://nautil.us/rss/all',
              category_id: '2kl34jsllksf',
              id: 'm4nfqca9oz'
          }, {
              url: 'https://www.theatlantic.com/feed/channel/business/',
              category_id: '3224lkjjf3',
              id: 'gtieivvssvl'
          }],
          cached_sources: {},
          cached_articles: []
      };
  };

  /**********************
   * Actions 
   **********************/

  var initial_actions = function initial_actions(model) {
      return model.sources.map(function (source) {
          return request_feed(source.url);
      });
  };

  // Actions
  var REQUEST_FEED = 'request_feed';
  var REQUEST_FEED_RETURN = 'update_feed_cache';

  var ADD_FEED_SOURCE = 'add_feed_source';
  var REMOVE_FEED_SOURCE = 'remove_feed_source';
  var UPDATE_FEED_SOURCE = 'update_feed_source';
  var REORDER_FEED_SOURCE = 'reorder_feed_source';

  // having unique identifiers not only helps with debugging, but is also
  // necessary for the `storage` event to register repeated actions.
  //
  // "The storage event is fired on the window object whenever setItem(),
  // removeItem(), or clear() is called and *actually changes something*. For
  // example, if you set an item to its existing value or call clear() when there
  // are no named keys, the storage event will not fire, because nothing actually
  // changed in the storage area."
  //
  // From http://diveintohtml5.info/storage.html 
  // (Accessed April 21, 2018)
  var base_action = function base_action() {
      return {
          timestamp: new Date().toString(),
          uuid: uuid()
      };
  };

  var request_feed = function request_feed(url) {
      return _extends({}, base_action(), {
          type: REQUEST_FEED,
          url: url,
          replicate: false
      });
  };
  var request_feed_return = function request_feed_return(url, status, data) {
      return _extends({}, base_action(), {
          type: REQUEST_FEED_RETURN,
          url: url,
          status: status,
          data: data,
          replicate: false
      });
  };

  var reorder_feed_source = function reorder_feed_source(source_id, place) {
      return _extends({}, base_action(), {
          type: REORDER_FEED_SOURCE,
          source_id: source_id,
          place: place,
          replicate: true
      });
  };

  /* External actions */

  var server_parsed = function server_parsed(url) {
      return axios$1.post('/api/rssparser', { url: url }).then(function (res) {
          return res.data;
      });
  };

  /* END external actions */

  function update$1(action, model) {
      switch (action.type) {
          case REQUEST_FEED:
              server_parsed(action.url).then(function (data) {
                  return actions(request_feed_return(action.url, 200, data));
              });
              return model;

          case REQUEST_FEED_RETURN:
              if (action.status === 200) return produce(model, function (d) {
                  d.cached_sources[uuid()] = action.data;
              });else return model;

          case ADD_FEED_SOURCE:
              return produce(model, function (d) {
                  d.sources.append({
                      url: action.url,
                      category_id: action.category_id,
                      id: action.source_id
                  });
              });
          case REMOVE_FEED_SOURCE:
              return _extends({}, model, {
                  sources: reject(function (source) {
                      return action.source_id === source.id;
                  }, model.sources)
              });
          case UPDATE_FEED_SOURCE:
              return _extends({}, model, {
                  sources: model.sources.map(function (source) {
                      return source.id === action.source_id ? _extends({}, source, {
                          url: action.url || source.url,
                          category_id: action.category_id || source.category_id
                      }) : source;
                  })
              });
          case REORDER_FEED_SOURCE:
              //reorder a feed source within its category

              return produce(model, function (d) {

                  var original_index = d.sources.findIndex(function (s) {
                      return s.id === action.source_id;
                  });

                  //remove the item from the sources list

                  var _d$sources$splice = d.sources.splice(original_index, 1),
                      _d$sources$splice2 = slicedToArray(_d$sources$splice, 1),
                      source = _d$sources$splice2[0];

                  //iterate through the remaining list until we find the target_place


                  var target_place = 0;
                  for (var i = 0; i < d.sources.length; i++) {
                      if (d.sources[i].category_id === source.category_id) target_place++;

                      if (target_place === action.place) {
                          d.sources.splice(i, 0, source);
                          return;
                      }
                  }
                  //if the target place doesn't exist, put the source at the end 
                  // of the sources list
                  d.sources.push(source);
              });

          default:
              console.log('BAAD! action not matched!');
              console.log('action: ', action);
              console.log('model: ', model);
              return model;
      }
  }

  var restoreState = function restoreState() {
      try {
          var restored = JSON.parse(localStorage.getItem(STORAGE_DB));
          return restored === null ? init$1() : restored;
      } catch (e) {
          return init$1();
      }
  };
  var saveState = function saveState(model) {
      console.log('saving model: ', model);
      localStorage.setItem(STORAGE_DB, JSON.stringify(model));
  };

  /***** View *******/

  var createVNode$1 = createVNode,
      createTextVNode$1 = createTextVNode;
  var ViewArticle = function ViewArticle(model, source, article) {
      return createVNode$1(1, 'article', null, [createVNode$1(1, 'h1', null, article.title, 0), createVNode$1(1, 'div', null, [source.meta.title, createTextVNode$1(' ('), createVNode$1(1, 'a', null, new URI(article.permalink || article.link).hostname(), 0, {
          'href': article.permalink || article.link
      }), createTextVNode$1(') '), luxon$1.DateTime.fromISO(article.date).toLocaleString({
          month: "short", year: "numeric", day: 'numeric'
      })], 0), createVNode$1(1, 'div', null, createTextVNode$1('Summary'), 2), createVNode$1(1, 'div', 'summary', null, 1, {
          'dangerouslySetInnerHTML': { __html: purify.sanitize(article.summary) }
      })], 4, null, article.id);
  };

  var ViewMain = function ViewMain(model) {
      return createVNode$1(1, 'main', null, [pipe(chain$1(function (source) {
          return source.articles.map(function (a) {
              return {
                  view: ViewArticle(model, source, a),
                  data: a
              };
          });
      }), sort(function (a, b) {
          return new Date(a.data.date) < new Date(b.data.date) ? 1 : -1;
      }), map$1(prop("view")))(Object.values(model.cached_sources)), createVNode$1(1, 'p', 'footer', createTextVNode$1('That\'s it for now. Take a deep breath and enjoy some fresh air outside.'), 2)], 0);
  };

  function render$1(model) {
      render(ViewMain(model), document.querySelector('main'));
  }

  // Streams
  var actions = lib.stream();
  var saved_models = lib.stream();

  var model = lib.scan(flip(update$1), restoreState(), actions);

  actions.map(curryN$1(2, log)('action: '));

  initial_actions(model()).forEach(function (a) {
      return actions(a);
  });

  model.map(curryN$1(2, log)('rendering with model: ')).map(function (model) {
      return window.requestAnimationFrame(curryN$1(2, render$1)(model));
  });

  lib.on(function (model) {
      return actions() && actions().replicate ? saved_models(model) : null;
  }, model);

  lib.on(saveState, saved_models);
  //if (and only if) `actions` volume gets too high, should we throttle saveState


  var incomingExternalActions$ = forwardTo(actions, function (action) {
      return log('incomingExternalActions$: ', _extends({}, action, { replicate: false }));
  });

  var outgoingExternalActions$ = filter$1(prop('replicate'), actions);

  ///// External listeners
  window.addEventListener('storage', function (e) {
      if (e.key !== STORAGE_CHANNEL) return;
      try {
          var contents = JSON.parse(e.newValue);
          console.log('event from channel: ', contents);

          // "The StorageEvent is fired whenever a change is made to the Storage
          // object (note that this event is not fired for sessionStorage changes).
          // This won't work on the same page that is making the changes — it is
          // really a way for other pages on the domain using the storage to sync any
          // changes that are made."
          //
          // From https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
          // (Accessed April 14, 2018)

          contents.replicate = false;
          incomingExternalActions$(contents);
      } catch (e) {
          console.error(e);
      }
  });

  // localstorage IS thread-safe. Therefore, writing to it at the same time 
  // won't clash and produce gibberish. I'm pretty sure this means that for each 
  // write, there will also be a 'storage' event emitted for the other tabs. 
  // This post cites the W3C.
  //
  // See https://stackoverflow.com/questions/22001112/is-localstorage-thread-safe
  // (Accessed April 14, 2018)
  //
  //
  // The WHATWG seems to directly contradicts this. 
  //
  // This specification does not define the interaction with other browsing
  // contexts in a multiprocess user agent, and authors are encouraged to assume
  // that there is no locking mechanism. A site could, for instance, try to read the
  // value of a key, increment its value, then write it back out, using the new
  // value as a unique identifier for the session; if the site does this twice in
  // two different browser windows at the same time, it might end up using the same
  // "unique" identifier for both sessions, with potentially disastrous effects.
  //
  // From https://html.spec.whatwg.org/multipage/webstorage.html#localStorageEvent
  // (Accessed April 21, 2018)

  lib.on(function (a) {
      return localStorage.setItem(STORAGE_CHANNEL, log('sending action: ', JSON.stringify(a)));
  }, outgoingExternalActions$);

  var reader = { init: init$1, initial_actions: initial_actions, model: model, update: update$1, render: render$1, reorder_feed_source: reorder_feed_source };

  return reader;

})));
//# sourceMappingURL=reader.js.map
