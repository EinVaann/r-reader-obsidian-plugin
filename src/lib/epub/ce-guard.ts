// Obsidian re-evaluates the plugin bundle every time the plugin is enabled.
// foliate-js registers custom elements (foliate-view, foliate-paginator, …)
// at module-eval time via customElements.define(), which throws on the second
// load because a name can't be redefined. Make define() idempotent once, so
// repeated registrations are silently skipped instead of crashing onload.
//
// This module must be imported BEFORE foliate-js's view.js.
interface GuardedRegistry extends CustomElementRegistry {
  __rrGuarded?: boolean;
}

const registry = customElements as GuardedRegistry;
if (!registry.__rrGuarded) {
  const original = registry.define.bind(registry);
  registry.define = function (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions): void {
    if (registry.get(name)) return; // already registered — skip
    original(name, ctor, options);
  };
  registry.__rrGuarded = true;
}
