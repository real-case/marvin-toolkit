# Building the flow map (FLW-01…FLW-08)

The flow map is the shared picture every check uses: screens (nodes), the actions that move
between them (transitions) and the user goals that string them together (journeys). The
`marvin-hunt-cartographer` builds it from code; later checks add what they observe at runtime.
Its shape is [schemas/flows.schema.json](schemas/flows.schema.json).

## From code

1. **Find the router.** Read the routing source of truth for the stack:

   | Stack | Where routes live |
   | --- | --- |
   | Next.js | `app/**/page.*` and `pages/**` (file-system routes; `[param]` segments), `middleware.*` for guards |
   | React Router / TanStack Router | the route objects or `<Route>` elements, loaders and `errorElement` |
   | Vue / Nuxt | `router/index.*` or `pages/**` |
   | SvelteKit / Astro / Remix | `src/routes/**` or `src/pages/**` |
   | Angular | `*-routing.module.ts` and `canActivate` guards |
   | Express / Fastify / Hono | `app.get/post/...`, route plugins, auth middleware |
   | Django / Flask / FastAPI | `urls.py`, `@app.route`, `@router.get` and their decorators |
   | Rails | `config/routes.rb` and `before_action` filters |

   No router found → say so in `anomalies` and map the entry points you can see.

2. **One node per screen or endpoint group.** `id` is a stable kebab-case name (`checkout`,
   `settings-billing`), `route` the path pattern, `params` its parameters, `guards` the checks
   that gate it (auth, role, feature flag), `data` what it loads, `states` the screen states the
   code renders (loading, empty, error, unauthorized, not-found…). `entry: true` for screens a
   user can land on directly.
3. **One transition per user action** that changes screen or state: link, form submit,
   redirect after a mutation, back. `handler` points at the code that runs. `expected` lists the
   machine-checkable outcomes where the code makes them obvious (`url`, `request`, `toast`).
4. **Journeys** are the goals a user comes for — sign up, buy, invite a teammate — as ordered
   node or transition ids. `priority: core` for the few journeys the product exists for.
5. **Anomalies** (CODE-F09): a route no link reaches, a link to a route that does not exist, a
   handler nothing calls, a guard that one route of a group lacks.

Every entry carries `provenance: "code"`, a `confidence`, and `sources` with the files and
lines it came from.

## Regeneration and pins (FLW-07, FLW-08)

The tool merges a regenerated map over the previous one: an entry a person marked
`pinned: true` survives even when the new map omits or changes it, and the answer lists what
appeared and disappeared. A map that references a node or transition it does not define is
refused, so a half-built map never overwrites a good one.

## Keep it small

Map what a user can do, not every component. A map with more than about 60 nodes is usually
listing components; group them under the screen they belong to.
