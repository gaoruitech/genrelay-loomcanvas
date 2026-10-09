# User guide

[简体中文](user-guide.zh-CN.md)

How to use the canvas itself. The same guide is built into the app: click the **?** button in the canvas top bar.

The canvas is a workspace you can pan and extend without limit. You place source material and model steps as blocks (nodes) and wire them together into a small production pipeline: sources on the left, model steps in the middle, finished work on the right.

![Canvas editor](images/11-editor-en.png)

## Before you start

Generation nodes need a model. Connect a provider under **Settings → Providers** first; see [Getting started](getting-started.md). Without one, generation nodes show "No models available yet".

## The interface

| Area | What is there |
| --- | --- |
| Top bar | Canvas name and save status, back to your canvases, the guide, More ⋯, undo / redo, Run all, Create share link, Save. |
| Floating toolbar | Add node, canvas templates, asset library, your share links, switch canvas. Drag it by the handle at its top; it can be vertical or horizontal. |
| Bottom right | Zoom controls. |
| Bottom left | Minimap. Drag or scroll it to jump around. |
| Right-click on empty canvas | Add nodes and canvas actions. "More ⋯" in the top bar opens the same canvas actions. |
| Right-click on a node | Actions for that node. |

Basics:

- **Pan** by dragging the empty canvas with the left mouse button. **Zoom** with the mouse wheel.
- **Box-select** by holding Shift and dragging. Alignment guides appear while you move a node.
- **Drop files**: drag images or videos from your computer onto the canvas, several at once if you like. A node is created at the pointer and the file is uploaded.
- **Paste an image** with Ctrl+V. Pasting text into an input works as usual.

## Node types

Add a node by right-clicking the empty canvas or with the **+** button on the toolbar.

### Sources (free)

| Node | What it does |
| --- | --- |
| Text | A piece of prompt text. You can insert a ready-made snippet from the text templates. |
| Image | Upload from your computer, or pick from My assets or Stock assets. Once it has an image you can crop and rotate it. |
| Video | Upload from your computer, or pick from My assets or Stock assets. |
| Image set | Bundles several images and hands them downstream together: upload, multi-select, or wire in images from upstream. |

### Generation (calls a paid model)

| Node | What it does |
| --- | --- |
| Image generation | Creates images from a prompt, with or without reference images. The prompt can come from an upstream Text node. Typing `@` in the prompt lets you point at a specific reference image. |
| Image edit | One image plus an instruction gives an edited image, for example "replace the background with a beach". |
| Video generation | Text-to-video or image-to-video. Where the model supports it, choose "First & last frame" or "Reference images". |
| Video edit | A source video plus an instruction gives an edited video. |
| Video analysis | Sends a video to a chat model and outputs text you can pass downstream. Only chat models that accept video input are listed. |
| Language model | Writes text from a prompt: analysis, copy, plans. |

The image and video generation and edit nodes share one layout: result frame, reference strip, prompt box, model dropdown, parameters dropdown, brand kit row and Run button. Aspect ratio, resolution, duration and count are all in the parameters dropdown, which shows only what the selected model supports.

Which models a node offers, and what each can do, depends on your providers; see [Providers](providers.md).

### Output

| Node | What it does |
| --- | --- |
| Output | Collects everything connected to it into one grid; click a tile to see it full size. Its "Run this branch" button runs the whole chain upstream of it. It also adds up the cost of everything upstream. |

### Tools (processed on your server, free)

| Node | What it does |
| --- | --- |
| Multi-platform export | Turns one hero image into the sizes each platform needs. Two sets: domestic (Taobao main image 1:1, white background 1:1, Xiaohongshu 3:4, Douyin 9:16) and cross-border (white background 1:1, Amazon 1:1, Shopify 4:5, TikTok 9:16). Download everything at once. |
| Slice | Cuts one image into tiles: a preset, or your own columns × rows (up to 6 × 6). |
| Collage | Combines several images into one: presets up to 4 × 4, cell ratio, spacing, background colour. |
| Watermark | Upload a logo in the node, then set its position, size, opacity and margin. A transparent PNG looks best. |
| Resize | Changes the aspect ratio by padding, never cropping; sets format and quality; can cap the file size. |

Tool nodes never call a model, so they cost nothing.

### Groups

A group is a frame around several nodes that moves as one.

- Hold Shift and box-select the nodes, then right-click one and choose to group them, or press Ctrl+G.
- Right-click a group to merge groups, ungroup (the nodes stay), move nodes out, or delete the group with its nodes.

## Wiring

- Every node has small dots on its sides: **right is output, left is input**. Drag from a dot on the right to a dot on the left of another node.
- Ports are typed: image to image, text to text, video to video. Mismatched types will not connect.
- A port that accepts several inputs takes several wires. On a single-input port, a new wire replaces the old one.
- A Video generation node in first-and-last-frame mode has a second image input for the last frame.

If a wire will not connect, the types probably do not match, or the direction is reversed.

## Running

| How | Where | What runs |
| --- | --- | --- |
| One node | The node's **Run** button | That node, plus any upstream nodes that need updating. On a node that already has a result, it runs again, after a confirmation. |
| A branch | **Run this branch** on an Output node | The whole chain upstream of that Output node. |
| Everything | **Run all** in the top bar | The whole canvas in wiring order. Runs queue automatically, and downstream nodes are skipped when an upstream one fails. The canvas needs at least one Output node. |
| Batch | **More ⋯ → Batch run** | Pick an Image node as the variable, supply up to 100 source files, and the chain below it is re-run once per file. Keep the page open while it runs. |

Status badge on the result frame:

| Badge | Meaning |
| --- | --- |
| Queued | Waiting for a free slot. How many run at once is the Concurrency setting. |
| Running | Submitted to the upstream; progress is shown when the upstream reports it. |
| Done | The result is stored on your server. |
| Failed | Open the task details (right-click the node) for the reason. |
| Inputs changed | Something upstream changed since this result was made. Run again to update it. |

**Running again.** Every run submits a new task to the provider and is billed again. So before generation nodes that already have a result are re-run, the canvas asks "Run again?" once for the whole batch of nodes. Tick **Don't ask again this session** to skip the question for the rest of the browser session. A first run is never asked about, and neither is a batch run.

**Canceling.** A node that is running shows a **Cancel run** button. The node then shows **Canceled**.

**Reloading.** If you reload the page while something is running, the canvas keeps waiting for the result. It does not submit the job twice. This also holds for Language model and Video analysis nodes.

A run that takes longer than its timeout is marked failed: 10 minutes for images, 30 for videos and 5 for Language model and Video analysis nodes by default. These limits, and the timeouts for submitting a task and for downloading a result, are under **Settings → Limits**.

## Results and history

- A re-run never overwrites earlier images or videos. They stay in the node's history; click a thumbnail to switch back. Language model and Video analysis nodes have no history: the new text replaces the text in the node.
- Hover a result and click the zoom button to see it full size with the details of that run.
- Right-click a node for: view or download the original, **Save to my assets**, edit image (crop / rotate), task details, **Continue from this version** and **Fork into a new node**.
- Results are files in your own storage. By default they are kept forever; if the operator set a retention period, the files of old runs are removed and their images stop loading.

### Cost

- Next to the Run button, a generation node shows the estimated cost of one run with the current parameters, for example "≈ ¥0.12".
- **Cost unknown** means the model has no price configured. You can still run it.
- After a run, its cost is kept in the node's run details and history. Language model and Video analysis nodes show it at the bottom of the node.
- An Output node totals its upstream chain: recorded cost for nodes that have run, the estimate for those that have not.
- A solid button calls a paid model. An outline button runs locally and is free.

These amounts are calculated from prices entered under **Settings → Models**. They are for reference; the real bill comes from your upstream provider.

**Settings → Usage** lists every run and totals by day or by model. **Clear records older than** deletes the finished records (succeeded, failed, canceled) created before the chosen day (00:00 UTC), after a confirmation; queued and running records, canvases and generated files are kept. It cannot be undone, and the run counts and cost totals for that period go with the records.

## Brand kits

A brand kit saves a creative direction rather than finished work: fixed reference images, a prompt prefix and negative terms. Attach it to generation nodes and every run starts from the same place.

- Choose a kit in the brand kit row of Image generation, Image edit, Video generation and Video edit nodes. **Manage** opens the dialog to create, edit and delete kits.
- A kit has a name, up to 5 fixed reference images, a prompt prefix and negative terms. It can be applied to new nodes automatically. You can keep up to 50 kits.
- Images wired into the node come first. The kit's reference images only fill the slots the model has left.
- Negative terms are appended to the prompt as "Do not include: …". This is prompt text, not an API parameter, so a model may ignore it.
- Deleting a kit sets the nodes that used it back to no brand kit. The canvas is not otherwise affected.

## Templates

- **Canvas templates** drop a whole pipeline onto the canvas in one click. Open them from the toolbar, or start a new canvas from one with **New from template** on the canvas list. Two are built in: *Text to image* and *Image to video*.
- **Text templates** are ready-made prompt snippets, in Chinese and English, that you insert into a Text node.

## Asset library

Click **Asset library** on the toolbar.

| Tab | Contents |
| --- | --- |
| My assets | Images and videos you uploaded or saved, in four categories: product shots, brand assets, references, outputs. |
| Canvas templates | See above. |
| Text templates | See above. |
| My share links | Every share link you created. |
| Stock assets | Shown first, and only when the person running the instance has preloaded shared assets. Empty on a new install. |

To keep a result for reuse, right-click a generation node and choose **Save to my assets**. It appears under My assets → Outputs.

Deleting an asset removes it from the library only. Nodes that already use it keep working.

## Share links

A share link gives read-only access to a snapshot of one canvas.

1. Click **Create share link** in the top bar.
2. Enter a title and optionally a description.
3. Choose when it expires: 1 day, 7 days, 30 days or never.
4. Copy the link.

What to know:

- **It is a snapshot.** Editing or deleting the original canvas later does not change what you shared. Creating a link for the same canvas again updates the snapshot and keeps the same link.
- **Anyone with the link can open it**, without the access password. The images and videos on it are public files too. Do not share canvases that contain things you want to keep private.
- **Expiry**: after the date, the link stops working on its own.
- **Revoke**: in the library under My share links, click **Revoke**. The link stops working immediately. If you share that canvas again later, it gets a new link; the old one never comes back.
- A visitor who also has access to the instance can click **Copy to my canvases** to get an editable copy.

## Canvases

On the **My canvases** page you can create, rename, duplicate and delete canvases, and download all images and videos of a canvas as a zip.

Inside a canvas:

- **Autosave** runs about 1.5 seconds after a change. Ctrl+S saves at once.
- **Batch download** (More ⋯) packs the canvas results into one archive, up to 100 files at a time. Save the canvas first.
- **Load another canvas** (More ⋯) copies all nodes and connections of another canvas into this one.
- **Tidy** (More ⋯ or right-click): "Arrange by data flow" lines nodes up along their wires; "Snap to grid" aligns them to the grid. Both can be undone. With 2 or more nodes selected you can align them; with 3 or more, distribute them evenly.
- **Find nodes** with Ctrl+F: search prompts, text, models or node types.
- **Immersive mode** (top of the More ⋯ menu) hides the navigation so the canvas fills the screen.

A canvas can hold up to 500 nodes and 2000 connections.

## Shortcuts

On macOS use ⌘ instead of Ctrl.

| Keys | Action |
| --- | --- |
| Ctrl+Z | Undo |
| Ctrl+Shift+Z, Ctrl+Y | Redo |
| Ctrl+A | Select all |
| Ctrl+C, Ctrl+V | Copy and paste nodes, with the connections between them |
| Ctrl+D | Duplicate the selection in place |
| Delete, Backspace | Delete the selection |
| Ctrl+S | Save |
| Ctrl+0 | Fit the view |
| Ctrl+F | Find nodes |
| Ctrl+G | Group |
| Ctrl+Shift+G | Ungroup / move out of group |
| Shift + drag | Box-select |
| Esc | Close menus |

## Themes and language

- **Theme**: the sun / moon button in the top bar switches between light and dark.

  ![Dark theme](images/09-editor-dark.png)

- **Language**: the dropdown in the top bar switches between 简体中文 and English. Messages from the server follow the same language.
- Both choices are remembered per browser. Until you choose, the site defaults under **Settings → Appearance** apply.
- **Canvas appearance** (More ⋯ or right-click): background colour, pattern and density of one canvas. It is saved with the canvas and travels with its share links.

## Limits worth knowing

| Limit | Value |
| --- | --- |
| Upload from the canvas, per file | The server's `MAX_UPLOAD_MB` (50 MB by default). The canvas reads the limit from the server and refuses a larger file before uploading it. |
| File types | Images and videos, recognised by content, not by file name |
| Reference images per run | Up to the selected model's limit; extra ones are left out with a notice |

More answers in the [FAQ](faq.md).
