/**
 * Which places can be gone to in one mounted view, and the `<router-link>` that knows it.
 *
 * A host can leave pages out (`pages`) and switch features off (`features`); a page that belongs to
 * a switched-off feature does not exist either (`PAGE_FEATURE` in options.ts). Everything that leads
 * somewhere asks here, so that no entry point is left pointing at a page that is not there:
 *
 *  - `<router-link>` in templates: replaced by `guardedLink` when embedded (not rendered at all);
 *  - buttons and menu items that navigate in code: `usePageOpen()` in their `v-if`;
 *  - the address itself: the router guard (router/index.ts) uses the same `isPageOpen`.
 *
 * Internal module: not part of the public API.
 */
import { computed, defineComponent, h } from 'vue'
import { RouterLink, useRouter, type RouteLocationRaw, type Router } from 'vue-router'
import { useEmbed, type EmbedContext } from './context'
import { isPageOpen, pageOfRoute } from './options'
import type { LoomCanvasPage } from './types'
import { settingsGroups } from '@/components/settings/sections'

/**
 * Can this location be gone to in this view? Sign-in pages are not "pages": they exist unless the
 * host signs users in. The editor entry is one screen: nothing can be gone to.
 */
export function isRouteOpen(ctx: EmbedContext, router: Router, to: unknown): boolean {
  if (!to || ctx.mode === 'editor') return false
  let name: unknown
  // vue-router throws on a route name it does not know: that location does not exist here.
  try { name = router.resolve(to as RouteLocationRaw).name } catch { return false }
  const page = pageOfRoute(name)
  if (page) return isPageOpen(ctx, page)
  if (!name || name === 'not-found') return !ctx.embedded
  return !ctx.hostAuth
}

/**
 * `<router-link>` for a view mounted in a host page: a link to a place that does not exist in this
 * view is not rendered. Registered only when embedded, so the stand-alone app keeps vue-router's own.
 */
export function guardedLink(ctx: EmbedContext, router: Router) {
  return defineComponent({
    name: 'RouterLink',
    inheritAttrs: false,
    props: { to: { type: [String, Object], required: true } },
    setup(props, { attrs, slots }) {
      const allowed = computed(() => isRouteOpen(ctx, router, props.to))
      return () => (allowed.value ? h(RouterLink as any, { ...attrs, to: props.to }, slots) : null)
    },
  })
}

/**
 * The settings page has something on it for this person. Without the account section (the host signs
 * users in) and with the language, theme and node-layout switches all off, somebody who does not run
 * the site has no section left (`settingsGroups` lists none): then the page does not exist for them.
 */
export function isSettingsOpen(ctx: EmbedContext, isOwner: boolean): boolean {
  return isPageOpen(ctx, 'settings') && settingsGroups(isOwner, ctx.features).length > 0
}

/**
 * For components (call during setup):
 *
 *   const pages = usePageOpen()
 *   <button v-if="pages.has('history')" @click="router.push({ name: 'history' })">
 *   <RouterLink v-if="pages.to(target)" :to="target">
 */
export function usePageOpen() {
  const ctx = useEmbed()
  const router = useRouter()
  return {
    /** This page exists in this view. */
    has: (page: LoomCanvasPage) => isPageOpen(ctx, page),
    /** This location (a path or a named route) can be gone to. */
    to: (to: RouteLocationRaw | null | undefined) => isRouteOpen(ctx, router, to),
    /**
     * A link may open in a new tab only when the address bar carries the route. In memory mode
     * (the default when embedded) an in-app address means nothing to the browser.
     */
    newTab: ctx.routerMode !== 'memory',
  }
}
