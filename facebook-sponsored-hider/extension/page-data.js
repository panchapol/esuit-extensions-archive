(() => {
  "use strict";

  // Facebook-private APIs are optional. DOM detection remains the fallback.
  // Only this script runs in MAIN; it has no extension APIs or network access.
  const DATA_ATTRIBUTE = "data-fb-sponsored-hider-data";
  const stores = new Set();
  const wrapped = new WeakSet();
  const registrations = new WeakMap();
  let hookState = "waiting";
  const publishState = () => document.documentElement?.setAttribute('data-fb-sponsored-hider-hook', hookState);
  document.addEventListener('DOMContentLoaded', publishState, { once: true });

  function sponsorship(record, source) {
    if (!record || !Object.hasOwn(record, "sponsored_data")) return "unknown";
    let data = record.sponsored_data;
    if (data === null) return "ordinary";
    if (data?.__ref && source) data = source.get(data.__ref);
    return data?.ad_id ? "ad" : "unknown";
  }

  function classify(unit, currentStore) {
    const direct = sponsorship(unit);
    if (direct !== "unknown") return direct;
    const id = unit?.__id || unit?.id;
    if (!id) return "unknown";
    if (currentStore) {
      const source = currentStore.getSource();
      const state = sponsorship(source.get(id), source);
      if (state !== "unknown") return state;
    }
    for (const store of stores) {
      const source = store.getSource();
      const state = sponsorship(source.get(id), source);
      if (state !== "unknown") return state;
    }
    return "unknown";
  }

  function wrapQueue(Queue) {
    const original = Queue?.prototype?.run;
    if (typeof original !== "function" || wrapped.has(original)) return;
    const replacement = function (...args) {
      // Capture before notify(), which may synchronously render subscribed posts.
      try {
        if (typeof this._store?.getSource === "function") stores.add(this._store);
      } catch {
        // Optional introspection must never prevent the original queue call.
      }
      return Reflect.apply(original, this, args);
    };
    wrapped.add(replacement);
    Queue.prototype.run = replacement;
  }

  function wrapFeed(original, requireModule) {
    if (typeof original !== "function" || wrapped.has(original)) return original;
    // Resolve this hook once for the component's lifetime. It must be called
    // consistently on every render, rather than conditionally when an ad appears.
    let useEnvironment;
    try { useEnvironment = requireModule("CometRelay")?.useRelayEnvironment; } catch {}
    hookState = typeof useEnvironment === 'function' ? 'relay-context' : 'feed';
    publishState();
    const replacement = function (...args) {
      let currentStore;
      if (typeof useEnvironment === "function") {
        try { currentStore = useEnvironment()?.getStore(); } catch {}
      }
      // Always invoke the original component: its hooks and pagination effects
      // must still run even when the returned DOM is concealed.
      const rendered = Reflect.apply(original, this, args);
      try {
        const state = classify(args[0]?.feedUnit, currentStore);
        if (state === "unknown") return rendered;
        const react = requireModule("react");
        const props = { [DATA_ATTRIBUTE]: state, children: rendered };
        if (typeof react.jsx === "function") return react.jsx("div", props);
        if (typeof react.createElement === "function") return react.createElement("div", props, rendered);
      } catch {
        // A changed internal contract must not break Facebook's rendering.
      }
      return rendered;
    };
    wrapped.add(replacement);
    return replacement;
  }

  function registration(original) {
    if (typeof original !== "function" || wrapped.has(original)) return original;
    if (registrations.has(original)) return registrations.get(original);
    const replacement = new Proxy(original, {
      apply(target, receiver, args) {
        const [name, , factory] = args;
        if ((name === "CometFeedUnitErrorBoundary.react" ||
             name === "relay-runtime/store/RelayPublishQueue") && typeof factory === "function") {
          args = [...args];
          args[2] = function (...factoryArgs) {
            const result = Reflect.apply(factory, this, factoryArgs);
            try {
              // Facebook modules use either module.exports or the seventh
              // argument's default export. Support both without source rewriting.
              const module = factoryArgs[4];
              const exports = factoryArgs[6];
              if (name === "relay-runtime/store/RelayPublishQueue") {
                wrapQueue(exports?.default || module?.exports?.default || module?.exports);
              } else {
                const requireModule = factoryArgs[3] || factoryArgs[2];
                if (typeof requireModule === "function") {
                  if (typeof exports?.default === "function") exports.default = wrapFeed(exports.default, requireModule);
                  else if (typeof module?.exports?.default === "function") module.exports.default = wrapFeed(module.exports.default, requireModule);
                  else if (typeof module?.exports === "function") module.exports = wrapFeed(module.exports, requireModule);
                }
              }
            } catch {
              // Preserve the original module result if its shape has changed.
            }
            return result;
          };
        }
        return Reflect.apply(target, receiver, args);
      }
    });
    wrapped.add(replacement);
    registrations.set(original, replacement);
    return replacement;
  }

  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, "__d");
    if (descriptor && (!descriptor.configurable || descriptor.writable === false)) {
      hookState = 'unavailable';
      publishState();
      return;
    }
    let defineModule = registration(window.__d);
    Object.defineProperty(window, "__d", {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => descriptor?.get ? registration(Reflect.apply(descriptor.get, window, [])) : defineModule,
      set: descriptor?.get && !descriptor.set ? undefined : (value) => {
        defineModule = registration(value);
        if (descriptor?.set) Reflect.apply(descriptor.set, window, [defineModule]);
      }
    });
  } catch {
    hookState = 'unavailable';
    publishState();
    // The CSS/DOM fallback works even when the page prevents this optional hook.
  }
})();
