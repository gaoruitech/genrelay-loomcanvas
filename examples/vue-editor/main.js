// A small Vue 3 host. The editor is one component of the host's own app; it talks to a stock
// LoomCanvas server through the ready-made HTTP adapter, with the host's request headers.
import { createApp, ref, shallowRef } from 'vue'
import { LoomCanvasEditor, createHttpAdapter } from 'loomcanvas-web/editor'

const API = new URLSearchParams(location.search).get('api') || 'http://127.0.0.1:3000/api'

createApp({
  components: { LoomCanvasEditor },
  setup() {
    const token = ref('')
    const user = ref('admin')
    const password = ref('')
    const message = ref('')
    const canvases = ref([])
    const canvasId = ref('')
    const theme = ref('dark')
    const locale = ref('en')
    const nodeLayout = ref('a')
    const readOnly = ref(false)
    const narrow = ref(false)
    const lines = ref([])
    const editor = ref(null)
    const adapter = shallowRef(null)
    const log = (line) => { lines.value = [...lines.value.slice(-60), line] }

    // The host's own call to its backend, with the host's own headers.
    const call = async (method, path, body) => {
      const res = await fetch(API + path, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token.value ? { Authorization: `Bearer ${token.value}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      const out = await res.json()
      if (out.result !== 0) throw new Error(out.message || `HTTP ${res.status}`)
      return out.data
    }

    async function signIn() {
      message.value = ''
      try {
        // See examples/host-page/main.js: in a real product your backend does this exchange.
        token.value = (await call('POST', '/auth/login', { account: user.value, password: password.value, remember: false })).token
        // One adapter for the page. `getAuth` is asked before every request.
        adapter.value = createHttpAdapter({
          apiBase: API,
          getAuth: () => ({ Authorization: `Bearer ${token.value}` }),
          onAuthRequired: () => { message.value = 'Session expired'; token.value = '' },
        })
        // Which canvases exist is the host's business: the editor edits one.
        canvases.value = await call('GET', '/workflow/list')
        if (!canvases.value.length) canvases.value = [await call('POST', '/workflow', { name: 'From the Vue host' })]
        canvasId.value = canvases.value[0].id
      } catch (err) {
        message.value = err.message
      }
    }

    async function newCanvas() {
      const created = await call('POST', '/workflow', { name: `Canvas ${canvases.value.length + 1}` })
      canvases.value = [created, ...canvases.value]
      canvasId.value = created.id
    }

    const on = (name) => (payload) => log(`${name} ${JSON.stringify(payload).slice(0, 140)}`)
    // The imperative methods, through the component ref.
    const addText = () => log(`addNode -> ${editor.value.addNode('text', { text: 'Added by the host' })}`)
    const dump = () => { const d = editor.value.getDocument(); log(`getDocument -> v${d.schemaVersion}, ${d.nodes.length} nodes, ${d.edges.length} edges`) }

    return {
      token, user, password, message, canvases, canvasId, theme, locale, nodeLayout, readOnly, narrow, lines, editor, adapter,
      signIn, newCanvas, on, addText, dump,
      // Opt in to features the HTTP adapter can serve; everything else of the product stays out.
      features: { cost: true, templates: true },
    }
  },
  template: `
    <form v-if="!token" class="sign" @submit.prevent="signIn">
      <h2>My Vue product: sign in</h2>
      <p><input v-model="user" id="user" autocomplete="username" /> <input v-model="password" id="pass" type="password" autocomplete="current-password" /> <button id="signin">Sign in</button></p>
      <p style="color:#b3261e">{{ message }}</p>
    </form>
    <template v-else>
      <div class="bar">
        <b>My Vue product</b>
        <select v-model="canvasId" id="canvas"><option v-for="c in canvases" :key="c.id" :value="c.id">{{ c.name }}</option></select>
        <button id="new" @click="newCanvas">New canvas</button>
        <select v-model="theme" id="theme"><option>dark</option><option>light</option></select>
        <select v-model="locale" id="locale"><option>en</option><option>zh-CN</option></select>
        <select v-model="nodeLayout" id="layout"><option>a</option><option>b</option><option>c</option></select>
        <label><input type="checkbox" v-model="readOnly" id="readonly" /> read-only</label>
        <label><input type="checkbox" v-model="narrow" id="narrow" /> narrow</label>
        <button id="add" @click="addText">addNode</button>
        <button id="run" @click="editor.runAll()">runAll</button>
        <button id="undo" @click="editor.undo()">undo</button>
        <button id="redo" @click="editor.redo()">redo</button>
        <button id="fit" @click="editor.fitView()">fitView</button>
        <button id="dump" @click="dump">getDocument</button>
      </div>
      <div class="stage" :class="{ narrow }">
        <!-- The editor fills its parent: the parent decides the size. -->
        <div class="box">
          <LoomCanvasEditor
            ref="editor"
            :adapter="adapter"
            :canvas-id="canvasId"
            :theme="theme"
            :locale="locale"
            :node-layout="nodeLayout"
            :read-only="readOnly"
            :features="features"
            storage-prefix="vue-host-"
            @ready="on('ready')($event)"
            @change="on('change')({ nodes: $event.document.nodes.length })"
            @saved="on('saved')($event)"
            @run:started="on('run:started')($event)"
            @run:finished="on('run:finished')($event)"
            @run:failed="on('run:failed')($event)"
            @result="on('result')($event)"
            @selection="on('selection')($event)"
            @error="on('error')($event)"
          />
        </div>
        <div class="side" id="log">{{ lines.join('\\n') }}</div>
      </div>
    </template>
  `,
}).mount('#app')
