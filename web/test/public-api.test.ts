/**
 * Guard: the public surface of the two integration entries.
 *
 * These snapshots are the contract customers build against. If a change here is intended, update
 * the snapshot IN THE SAME COMMIT as docs/integration.md (+ .zh-CN.md) and the CHANGELOG, and apply
 * the versioning rule written there (removing or renaming anything is a breaking change).
 */
import { describe, expect, it } from 'vitest'
import * as appEntry from '../src/embed/app'
import * as editorEntry from '../src/embed/editor'
import {
  ADAPTER_OPTIONAL_KEYS, ADAPTER_REQUIRED_KEYS, APP_EVENT_KEYS, APP_HANDLE_KEYS, APP_OPTION_KEYS,
  EDITOR_EVENT_KEYS, EDITOR_HANDLE_KEYS, EDITOR_OPTION_KEYS, FEATURE_KEYS, PAGE_KEYS,
} from '../src/embed/options'
import { createMemoryAdapter } from '../src/embed/memoryAdapter'
import { readFileSync } from 'node:fs'

describe('public API surface', () => {
  it('loomcanvas-web/app exports', () => {
    expect(Object.keys(appEntry).sort()).toMatchInlineSnapshot(`
      [
        "CANVAS_NODE_TYPES",
        "CANVAS_SCHEMA_VERSION",
        "CanvasDocumentError",
        "VERSION",
        "createEmptyDocument",
        "migrateDocument",
        "mountLoomCanvas",
      ]
    `)
  })

  it('loomcanvas-web/editor exports', () => {
    expect(Object.keys(editorEntry).sort()).toMatchInlineSnapshot(`
      [
        "CANVAS_NODE_TYPES",
        "CANVAS_SCHEMA_VERSION",
        "CanvasDocumentError",
        "LoomCanvasEditor",
        "MEDIA_RUN_NODE_TYPES",
        "TEXT_RUN_NODE_TYPES",
        "TOOL_NODE_TYPES",
        "VERSION",
        "createEmptyDocument",
        "createHttpAdapter",
        "createMemoryAdapter",
        "defineLoomCanvasEditorElement",
        "migrateDocument",
        "mountEditor",
      ]
    `)
  })

  it('mountLoomCanvas options', () => {
    expect([...APP_OPTION_KEYS].sort()).toMatchInlineSnapshot(`
      [
        "apiBase",
        "basePath",
        "brand",
        "features",
        "fileBase",
        "getAuth",
        "getUser",
        "initialPage",
        "locale",
        "messages",
        "nodeLayout",
        "onAuthRequired",
        "onNavigate",
        "pages",
        "routerMode",
        "shell",
        "storagePrefix",
        "theme",
        "user",
        "zIndex",
      ]
    `)
  })

  it('mountEditor options', () => {
    expect([...EDITOR_OPTION_KEYS].sort()).toMatchInlineSnapshot(`
      [
        "adapter",
        "canvasId",
        "changeDebounceMs",
        "document",
        "features",
        "locale",
        "messages",
        "nodeLayout",
        "nodeTypes",
        "onBack",
        "onChange",
        "readOnly",
        "storagePrefix",
        "theme",
        "zIndex",
      ]
    `)
  })

  it('<LoomCanvasEditor> props and events mirror the options and events of mountEditor', () => {
    const props = Object.keys((editorEntry.LoomCanvasEditor as any).props).sort()
    // `onChange` is the `change` event on the component.
    expect(props).toEqual([...EDITOR_OPTION_KEYS].filter((k) => k !== 'onChange').sort())
    expect(Object.keys((editorEntry.LoomCanvasEditor as any).emits).sort()).toEqual([...EDITOR_EVENT_KEYS].sort())
  })

  it('handles', () => {
    expect({ app: [...APP_HANDLE_KEYS], editor: [...EDITOR_HANDLE_KEYS] }).toMatchInlineSnapshot(`
      {
        "app": [
          "unmount",
          "navigate",
          "setTheme",
          "setLocale",
          "on",
        ],
        "editor": [
          "unmount",
          "getDocument",
          "setDocument",
          "setCanvasId",
          "save",
          "fitView",
          "runAll",
          "runNode",
          "addNode",
          "undo",
          "redo",
          "setTheme",
          "setLocale",
          "setNodeLayout",
          "setReadOnly",
          "on",
        ],
      }
    `)
  })

  it('events', () => {
    expect({ app: [...APP_EVENT_KEYS], editor: [...EDITOR_EVENT_KEYS] }).toMatchInlineSnapshot(`
      {
        "app": [
          "ready",
          "route",
          "canvas:saved",
          "run:started",
          "run:finished",
          "run:failed",
          "result",
          "error",
        ],
        "editor": [
          "ready",
          "change",
          "saved",
          "run:started",
          "run:finished",
          "run:failed",
          "result",
          "selection",
          "error",
        ],
      }
    `)
  })

  it('feature flags and pages', () => {
    expect({ features: [...FEATURE_KEYS], pages: [...PAGE_KEYS] }).toMatchInlineSnapshot(`
      {
        "features": [
          "share",
          "templates",
          "brandKit",
          "assetLibrary",
          "batchRun",
          "batchDownload",
          "cost",
          "modelManagement",
          "nodeLayoutSwitch",
          "themeSwitch",
          "localeSwitch",
          "guide",
          "canvasSwitch",
          "immersive",
          "account",
          "externalLinks",
          "palette",
          "queue",
          "minimap",
          "titleBar",
          "backButton",
          "canvasStyle",
          "imageEditor",
          "search",
        ],
        "pages": [
          "home",
          "canvases",
          "canvas",
          "assets",
          "brand-kits",
          "models",
          "history",
          "settings",
          "setup",
          "share",
        ],
      }
    `)
  })

  it('adapter members', () => {
    expect({ required: [...ADAPTER_REQUIRED_KEYS], optional: [...ADAPTER_OPTIONAL_KEYS] }).toMatchInlineSnapshot(`
      {
        "optional": [
          "capabilities",
          "estimate",
          "importRemoteFile",
          "downloadFile",
          "downloadZip",
          "runTool",
          "listCanvases",
          "brandKits",
          "templates",
          "assets",
          "share",
        ],
        "required": [
          "loadCanvas",
          "saveCanvas",
          "listModels",
          "submitRun",
          "getRuns",
          "cancelRun",
          "submitLlm",
          "getLlm",
          "upload",
          "resolveFileUrl",
        ],
      }
    `)
  })

  it('the memory adapter implements exactly the required members plus the ones it documents', () => {
    const own = Object.keys(createMemoryAdapter()).sort()
    expect(own).toEqual([...ADAPTER_REQUIRED_KEYS, 'capabilities', 'estimate', 'canvases', 'runRequests'].sort())
  })

  it('package.json exposes the entries', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    expect(Object.keys(pkg.exports)).toMatchInlineSnapshot(`
      [
        "./app",
        "./editor",
        "./standalone/app",
        "./standalone/editor",
        "./app.css",
        "./editor.css",
        "./fonts.css",
        "./package.json",
      ]
    `)
    expect(pkg.peerDependencies).toEqual({ vue: '^3.4.0' })
    expect(editorEntry.VERSION).toBe(pkg.version)
  })
})
