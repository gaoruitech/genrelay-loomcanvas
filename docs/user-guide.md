# User guide

[简体中文](user-guide.zh-CN.md)

How to use the app, and above all the canvas. A guide to the canvas is also built into the app: in the editor, open **More ⋯** on the toolbar and choose **Guide**.

The canvas is a workspace you can pan and extend without limit. You place source material and model steps as blocks (nodes) and wire them together into a small production pipeline: sources on the left, model steps in the middle, finished work on the right.

![Canvas editor](images/11-editor-en.png)

## Before you start

Generation nodes need a model. Add a provider on the **Models** page first; see [Getting started](getting-started.md). Without one, generation nodes show "No models available yet", and the editor shows a notice with a link to the Models page.

## Finding your way around

After signing in, every page has the same frame: a top bar with the logo and the site name (the logo alone when the super admin switched off **Show the site name next to the logo** under **Settings → Appearance**), the space switcher, the language dropdown, the theme switch and your account menu (**Account & security**, **Docs**, **Sign out**), and a sidebar on the left. In a window narrower than 760px the language dropdown moves into the account menu, where **Language** is the first entry.

The space switcher sits to the right of the logo and shows which space you are in: your own **Personal space**, or one of the teams you joined. The table below describes the personal space; what is different in a team space is in [Teams](#teams).

| Sidebar entry | What is there |
| --- | --- |
| **Workbench** | The start page: your recent canvases, the canvas templates, recent generations, this month's usage, the queue and your providers. |
| **Canvases** | All your canvases: create, rename, duplicate, download, delete, and the **Trash**. Opening one takes you to the editor. |
| **Assets** | Your uploaded and saved images and videos, and, on a second tab, your [brand kits](#brand-kits). |
| **Models** | Providers, their models and the prices you enter. See [Providers](providers.md). |
| **History** | Every run, with totals, filters and CSV export. See [History](#history). |
| **Settings** | Interface language, your account and your sign-in sessions. The super admin also sees Storage, Run limits, the site's name, logo and default language, Site (registration), Users and Teams. See [Configuration](configuration.md#admin-settings). |

![Workbench](images/14-workbench.png)

On the workbench, **New canvas** asks for a name and creates an empty canvas, a card under **Start from a template** creates one from that template, and **Usage** shows this month's runs, success rate and estimated cost with a bar per day for the last 14 days. "Today" and "this month" follow the time zone of your browser.

In the editor the sidebar shrinks to icons, to leave the width to the canvas. On a phone the sidebar becomes a row along the bottom of the screen with the same entries; its first entry, the start page, is labelled **Home** there. That row is hidden in the editor, where the logo in the top bar leads back to the start page.

## The editor

| Area | What is there |
| --- | --- |
| Top left | Back to your canvases, the canvas name (click it to rename; Enter or clicking elsewhere saves the name, Esc gives it up), the save status (click it to save at once) and the [brand kit](#brand-kits) this canvas uses. In a team space also the visibility of the canvas (**Only me**, **Team can view**, **Team can edit**); click it to open the **Share** dialog. |
| Toolbar | Vertical on the left by default. **+** lists every node. The buttons below it are one per category: text, image, video, chat / analysis, output and tools. The folder button opens the asset library, the canvas templates and your share links. The last two are the share button (its tooltip reads **Create share link**, and **Sharing and access** on a team canvas) and **More ⋯**. The toolbar can be moved: drag it by the handle at its start (or by its empty background) to anywhere on the canvas, with the mouse, a finger or a pen; it snaps when it gets close to an edge or to its default spot. The switch next to the handle flips it between horizontal and vertical. If you drop it on the title block, the bottom toolbar, the minimap or the queue button, it moves aside. Click the handle and choose **Reset**, or double-click the handle with the mouse, to send it back to the left. Position and orientation are remembered in the browser. When the editor is too short for the whole toolbar (a low window, or an editor built into another page), the buttons get smaller first; if that is not enough, buttons move into **More tools**: output and tools and chat / analysis first, then the folder button and the share button, then video, image and text. **+** and **More ⋯** always stay, and **More tools** lists everything that was moved. Every button says what it is on hover, on keyboard focus and, on a touch screen, when you touch and hold it. On a phone the toolbar is a fixed row under the title block and cannot be moved. |
| Bottom toolbar | Zoom out / in, reset to 100%, fit to screen, undo / redo, **Tidy up**, **Run all**. In a team space where you have a monthly limit, a small counter next to **Run all** shows how much of it you have used this month. |
| Bottom left | Minimap. Drag or scroll it to jump around. Its frame follows the canvas background, not the theme: on a dark background it is dark in the light theme too. It makes way when space is short: it is hidden while the editor is less than about 370px high, and in the compact layout while the inspector is open in a window too narrow for both (see [Generation](#generation-calls-a-paid-model)); it comes back by itself. |
| Queue button | A round floating button, in the bottom-right corner by default. It stays there when nothing runs; its tooltip then reads "Queue · Idle". While something runs it shows a progress ring and the number of unfinished nodes. The ring is the progress of the whole batch (a finished run counts as done, a queued one as nothing yet), so it only moves forward. A badge counts what has finished since you last looked, in red when something failed or could not start. Click the button for the list: the nodes of this canvas that are running or queued, the ones that could not start (with the reason), and the ones finished since you opened the canvas. Click a row to jump to its node. In a team space the list also shows **My limit this month** (the owner also sees **Team limit this month**), below the running rows. Drag the button anywhere on the canvas, with the mouse, a finger or a pen: it snaps to the left or right edge, keeps clear of the toolbar and the other floating panels, and the browser remembers the spot. To send it back, open the list and choose **Reset** in its header (shown once the button has been moved), or drag it back into the corner; a double-click only opens and closes the list. On a phone the button sits above the bottom toolbar and the list is a sheet at the bottom of the screen: close it with ×, by swiping it down, by tapping outside it, or with Esc. |
| Right-click on empty canvas | Add nodes and canvas actions. **More ⋯** opens the same canvas actions. |
| Right-click on a node | Actions for that node. |

Basics:

- **Pan** by dragging the empty canvas with the left mouse button. **Zoom** with the mouse wheel.
- **On a touch screen**: drag the empty canvas with one finger to pan, and pinch with two fingers to zoom. The pinch works wherever the fingers land, on nodes too. Dragging a node with one finger moves it; on a read-only canvas nodes do not move, so that drag pans. Tap a node to select it, tap the empty canvas to clear the selection, and double-tap the empty canvas to zoom in one step. To connect two nodes, drag from one port to the other; zoom in first if the ports are too small to grab. Press and hold a node for its menu, or the empty canvas for the add-node menu. To select several nodes, turn on **Multi-select** in the palette (the button is there on touch screens only): each tap then adds a node to the selection or takes it out instead of opening its panel, the selection toolbar appears once two are selected, and **Done**, Esc or a tap on the empty canvas ends it.
- **Select several nodes** by holding Shift and dragging a box around them, by Ctrl-clicking them one after another, or with Ctrl+A. Alignment guides appear while you move a node.
- **Drop files**: drag images or videos from your computer onto the canvas, several at once if you like. A node is created at the pointer and the file is uploaded.
- **Paste an image** with Ctrl+V. Pasting text into an input works as usual.

**Several nodes at once.** With two or more nodes selected, a small toolbar appears next to the selection, above it when there is room. It is the same in all three node layouts; the composer and the inspector are for a single node and stay away meanwhile. On a phone the toolbar is a fixed row under the node toolbar.

| On the toolbar | What it does |
| --- | --- |
| "3 nodes selected" | How many nodes are selected. |
| **Align** | Opens a row of icons: **Align left**, **Center horizontally**, **Align right**, **Align top**, **Center vertically**, **Align bottom**, **Distribute horizontally** and **Distribute vertically**. The last two need at least three nodes. |
| **Group** | Puts the selected nodes in a [group](#groups) (Ctrl+G). When the selection already contains a group, the button reads **Merge into one group**. |
| **Ungroup**, **Remove from group** | Shown only when there is something to take apart: **Ungroup** when a group is selected (its nodes stay where they are), **Remove from group** when selected nodes sit in a group (Ctrl+Shift+G). |
| **Run selected** | Runs every selected node that can run: generation nodes, tool nodes and Output nodes. Where selected nodes feed each other, the upstream one runs first and the downstream one uses its new result. "Run again?" is asked once for the whole selection. The button is greyed out, with the reason in its tooltip, when none of the selected nodes can run or a monthly limit of the team is used up. |
| Trash icon | Deletes the selection (Delete). It can be undone. |

Every alignment, grouping and deletion is one step for Ctrl+Z. With the keyboard, Tab reaches the toolbar right after the nodes, ← and → move between its buttons, and Esc closes the row of alignment icons.

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

These six nodes come in three layouts. Choose one under **Settings → Appearance → Node layout**, or switch from **More ⋯** on a canvas; the choice is kept with your account, so it follows you to any device:

| Layout | What a node looks like | Where you edit prompt, model and parameters |
| --- | --- | --- |
| Result first (default) | The node is the result: header, picture, and one line of "model · parameters · cost". Before the first run it is a dashed placeholder with the first line of the prompt and a **Run** chip. | Select one node and a composer appears next to it, under it by default: the prompt (type `@` to point at a reference image), model, parameters, estimated cost and Run. Just start typing to write the prompt, Ctrl / ⌘ + Enter runs, Esc collapses it. Hovering the result of an unselected node also offers **Re-run**. |
| Compact + side panel | Header, thumbnail, a one-line summary and a small Run button, so the most nodes fit on screen. | Select one node and the inspector at the right edge of the canvas shows all of its settings and its versions. With nothing or several nodes selected the inspector is closed. |
| Everything on the node | Result on top, one prompt field that grows as you type, and model, parameters, cost and Run in a single row. | On the node itself. |

All three do the same things and send the same request to the model; only where things sit differs. Aspect ratio, resolution, duration and count are in the parameters, which show only what the selected model supports. When the prompt comes from a connected text node, that text is shown read-only and the node's own text becomes the **fallback**: the connected text is used whenever it has content, and the node's own only when it is empty.

Switching layouts changes the size of the nodes but never moves what you arranged. If nodes overlap afterwards (or when you open a canvas that was arranged under another layout), a one-line notice at the bottom offers **Tidy up**; nothing moves until you click it, and it can be undone. On a phone the composer and the inspector are bottom sheets. A canvas opened from a share link is always shown in the result-first layout, read-only.

What the three have in common: the Run button of an image or video node reads **Run** before the first result and **Re-run** afterwards (on a Language model node it is **Generate**, on a Video analysis node **Analyze**); a star in the node's header shows that a [brand kit](#brand-kits) applies; and with a node selected you can simply start typing, the text goes into its prompt. That also works with an input method (Chinese, Japanese, Korean…): composing starts right away, and while it lasts Enter, Esc and the arrow keys belong to the input method, so Enter confirms the text and does not run, and Esc cancels the composition and closes nothing.

- **The composer** (Result first) floats above the canvas, so opening it never moves or resizes a node. When there is no room under the node, or the composer would cover the toolbar, the queue button, the minimap, the title block or the bottom toolbar, it slides along the node's edge, then goes above the node, then to its right or left. It may lie over other nodes, never over the ports of the node it edits. If no side has room, the canvas pans a little to make room; if the editor is too small for the node and the composer together, the composer docks at the bottom of the editor as a sheet. Esc or × closes it and leaves the node selected; the next character you type opens it again and is kept.
- **The inspector** (Compact + side panel) is 320px wide and stays at the right edge of the canvas; the queue button and the bottom toolbar move over. In a window of about 1000 to 1100px it would cover the right-hand column of nodes: when the node you select lies under it, the canvas pans sideways just far enough to show the node, and the minimap is hidden for as long as the inspector is open. Esc or × closes the inspector and leaves the node selected. Panning for the composer or the inspector changes the view only; it is not a step for undo.
- **On the node** (Everything on the node): the prompt field shows its character count, the `@` hint, **Expand** and **Clear** only while the cursor is in it. Model, parameters, cost and Run always share one row: with long names the spacing tightens first, then the parameters shorten to the first one and "+N" (hover for all of them), and only then is the model name cut short.
- **Text results.** A Language model or Video analysis node shows its output in a box labelled **Result**, which you can edit by hand and which is what the node passes downstream. In "Everything on the node" it sits above the prompt and looks different from it: the result has no fill, the prompt box has one. In the compact layout the editable **Result** is in the inspector.

Which models a node offers, and what each can do, depends on the providers you added and on the custom models you added to them; see [Providers](providers.md).

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

- Hold Shift and box-select the nodes, then click **Group** on the toolbar that appears next to them, right-click one and choose to group them, or press Ctrl+G.
- Right-click a group to merge groups, ungroup (the nodes stay), move nodes out, or delete the group with its nodes. With a group selected together with other nodes, the same toolbar offers **Merge into one group** and **Ungroup**.

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
| Several nodes | **Run selected** on the toolbar of a multiple selection | The selected nodes that can run, upstream ones first; see [The editor](#the-editor). |
| A branch | **Run this branch** on an Output node | The whole chain upstream of that Output node. |
| Everything | **Run all** in the bottom toolbar | The whole canvas in wiring order. Runs queue automatically, and downstream nodes are skipped when an upstream one fails. The canvas needs at least one Output node. |
| Batch | **More ⋯ → Batch run** | Pick an Image node as the variable, supply up to 100 source files, and the chain below it is re-run once per file. Keep the page open while it runs. |

Status badge on the result frame:

| Badge | Meaning |
| --- | --- |
| Queued | Waiting for a free slot. How many run at once, for the whole instance, for one account and for one team, is set by the super admin under **Settings → Run limits**. |
| Running | Submitted to the upstream; progress is shown when the upstream reports it. |
| Done | The result is stored on your server. |
| Failed | Open the task details (right-click the node) for the reason. |
| Inputs changed | Something upstream changed since this result was made. Run again to update it. |

**Running again.** Every run submits a new task to the provider and is billed again. So before generation nodes that already have a result are re-run, the canvas asks "Run again?" once for the whole batch of nodes. Tick **Don't ask again this session** to skip the question for the rest of the browser session. A first run is never asked about, and neither is a batch run.

**Canceling.** While a node runs, its Run button turns into a progress bar with **Cancel run** (in the Result-first layout the node itself also shows **Cancel**). The queue list has a stop button on every running row and **Cancel all** in its header. The node then shows **Canceled**.

**Reloading.** If you reload the page while something is running, the canvas keeps waiting for the result. It does not submit the job twice. This also holds for Language model and Video analysis nodes.

A run that takes longer than its timeout is marked failed: 10 minutes for images, 30 for videos and 5 for Language model and Video analysis nodes by default. These limits, and the timeouts for submitting a task and for downloading a result, are set by the super admin under **Settings → Run limits**.

## Results and history

- A re-run never overwrites earlier images or videos. They stay in the node's history; click a thumbnail to switch back. Language model and Video analysis nodes have no history: the new text replaces the text in the node.
- Hover a result and click the zoom button to see it full size with the details of that run.
- Right-click a node for: view or download the original, **Save to my assets**, edit image (crop / rotate), task details, **Continue from this version** and **Fork into a new node**.
- Results are files in your own storage. By default they are kept forever; if the operator set a retention period, the files of old runs are removed and their images stop loading.

### Cost

- Next to the Run button, a generation node shows the estimated cost of one run with the current parameters, for example "≈ ¥0.12".
- **Cost unknown** means the model has no price configured. You can still run it, except in a team that has an amount limit; see [Monthly limits and usage](#monthly-limits-and-usage).
- After a run, its cost is kept in the node's run details and history. Language model and Video analysis nodes show it at the bottom of the node.
- An Output node totals its upstream chain: recorded cost for nodes that have run, the estimate for those that have not.
- A solid button calls a paid model. An outline button runs locally and is free.

These amounts are calculated from the prices you entered on the **Models** page (in a team space, the prices its owner and admins entered). They are for reference; the real bill comes from your upstream provider.

### History

The **History** page lists every run of yours in the current space: a preview, the prompt and the canvas it belongs to, the model, type, status, duration, time and cost. A duration is written the same way wherever it appears (on a node, in the queue list, in the run details and here): 42s, 1m 05s, 1h 02m, and "<1s" for less than a second.

![History](images/15-history.png)

- The four tiles at the top total the selected period and follow the filters: **Records** (every record, by type), **Succeeded** (with the success rate of the finished runs and, in a team, how many count toward the monthly limit: succeeded + in progress), **Not succeeded** (failed and canceled) and **Estimated cost**.
- **What counts as cost.** Estimated cost is the sum over succeeded runs that had a price, plus what runs still in progress are holding. Failed and canceled runs are not charged: their row says **No charge** instead of the estimate made when they were submitted. A run that succeeded on a model without a price says **Cost unknown** and is counted separately, never as 0. A run still in progress shows its estimate with **≈**.
- Pick a period with the two dates or with **Last 7 days**, **Last 30 days** or **This month**, and narrow it by type, status and model. The search box looks through the prompt, the model and the canvas name of every record of the period, not only the page that is shown; the totals above follow it like any other filter.
- The actions of a row are **View details**, **Open on canvas**, **Download result**, **Copy prompt** (the whole prompt, however long) and, while it is still running, **Cancel run**. A run that was canceled while it waited in the queue says why (the person left the team, the account was disabled, the team was closed).
- **View details** shows one run in full. For a chat run: the whole reply and the whole prompt (each with **Copy**), the system prompt, tokens in and out, cost, time in the queue and duration. For an image or video run: the result files (click to enlarge, download one, or **Download all (ZIP)**), what was sent with the prompt and the parameters. A failed run shows the reason and its error code. If the retention period has removed the files of a run, the record stays and says so.
- **Several results as one ZIP.** Tick the records you want (the box in the header ticks everything downloadable on the page; ticks are kept across pages) and press **Download ZIP**: one archive with the files of the image and video runs and the reply of each chat run as a `.txt`, named `<nn>-<model>-<date>-<time>` in the order you ticked them. Up to 100 records and 100 files per archive; the bar says how many files are selected. A file that has gone missing is replaced by a `…-failed.txt` note. If the download breaks off, start it again; nothing half-finished is saved.
- **Export CSV** downloads every record that matches the current filters (not just the page shown; up to the latest 5000), one row each: time (your time zone, named in the header), member and username (in a team), model and model ID, type, status, seconds in the queue, duration in seconds, cost, currency and a cost note (no charge / unknown / estimate), input and output tokens, canvas, the whole prompt, system prompt and reply, number of result files, error code and reason, run ID. The file opens directly in Excel, WPS and Numbers; text that starts with `=`, `+`, `-` or `@` is prefixed with `'` so that a spreadsheet does not run it as a formula, and a reply longer than a spreadsheet cell can hold is cut and marked.
- **Clean up** deletes the finished records (succeeded, failed, canceled) created before the day you pick, after a confirmation. Queued and running records, canvases and generated files are kept. It cannot be undone, and the run counts and cost totals for that period go with the records.

Days are the calendar days of your browser's time zone: "today" is your local day, on this page, in the clean-up dialog and on the workbench.

**In a team space** the page lists the team's runs. The owner sees everybody's records, with a **Member** filter and a **Member** column; everybody else sees only their own records in this team (admins see all of them once the owner turns on **Admins can see everybody's records and usage** in the team settings). People who have left the team or whose account was deleted keep their names on their records, marked **Left the team** or **Account deleted**, in the table, the filter, the details and the CSV. **Clean up** is for the owner only, deletes the finished records of the whole team, and never those of the current month: the monthly limits are counted from them.

## Brand kits

A brand kit is a fixed set of generation settings: up to 5 reference images, a piece of text that always goes in front of the prompt (the prompt prefix), and a list of things to leave out. You choose one **per canvas**, and every Image generation, Image edit, Video generation and Video edit node on that canvas adds it on each run. Other nodes (language model, video analysis, tools) ignore it.

**What a run adds**

- The prompt prefix goes in front of the node's prompt, on a line of its own.
- The list of things to leave out is added at the end of the prompt as "Do not include: …". This is a sentence in the prompt, not an API parameter, so a model may ignore it.
- The kit's reference images are sent after the node's own. Images wired into the node always come first and are never pushed out; the kit's images only fill the slots the model has left.

**What it does not do**

- It does not change the model, aspect ratio, resolution, duration or count, and the estimated cost stays the same.
- A video node in first/last-frame mode gets the text only, because that mode sends exactly the two frames. A model that takes no reference images also gets the text only.
- A kit has no logo or colour fields. Put a logo in the reference images, and colours or style in the prompt prefix.
- A kit is looked up when a node runs. Edit a kit and every later run uses the new content; results you already have do not change.

**Choosing a kit for a canvas**

The brand kit button sits at the top left of the canvas, next to the canvas name and the save status. It shows the kit this canvas uses, or "No brand kit". Click it for a short explanation, the list of your kits (each with its reference images and a summary of what it holds) and **None**. The choice applies to the whole canvas and is saved with it; choosing or changing it is one step for Ctrl+Z. **Manage brand kits** goes to Assets › Brand kits; **New brand kit** and the pencil next to a kit open the editor in a dialog, so you stay on the canvas.

**Seeing what will be sent**

Select a generation node. Where you edit its prompt (the composer or the inspector; in "Everything on the node" it is behind the star in the node's header, see below) a line says "Brand kit applied: &lt;name&gt;". Click it to see exactly what the next run adds: the text in front of the prompt, the line at the end, and the reference images that will be sent, together with any that will not be sent and why (the model's limit, first/last-frame mode, or a model without reference images). After a run, the task details show the prompt that was actually sent.

**An exception for one node**

Right-click a generation node (the choices are under **Brand kit** in the menu), use "This node" at the right of that line, or click the star in the node's header, and choose **Follow canvas** (the default), **No kit for this node**, or another kit for this node only. Ctrl+Z takes it back.

**The star on a node**

In all three layouts an image or video node that a brand kit applies to carries a small star in its header, next to the title; so does a node with an exception. Hover the star to read which kit it is and whether its reference images will be sent; click it for **Brand kit for this node**, which shows what the next run adds and offers the three choices above. Nothing is added to the node's body, so a node keeps its height. "Everything on the node" has no composer or inspector for the line described above, so there the star is also the way in on a node without a kit: it shows, dimmed, when you hover or select the node, as long as you have at least one kit.

**Managing kits**

Assets › Brand kits (`/assets/brand-kits`) is the second tab of the **Assets** page. Its subtitle says whose kits these are ("Your brand kits live here…", or the team's name in a team space), and the box **What a brand kit is** sums up the rules of this chapter. The kits are listed as cards with their reference images, a summary, the prefix and the "do not include" list, and in how many canvases each is in use. From there you create, edit, duplicate and delete kits, and **Make default for new canvases** picks the one that canvases you create afterwards start with; existing canvases are not affected. You can keep up to 50 kits.

Deleting a kit does not change your canvases: canvases and nodes that used it simply run without a kit from then on, and the results you already have stay.

In a team space the brand kits are one shared set: every member can choose them on a canvas, only the owner and admins can create, edit and delete them, and a member gets **View** on this page. Kits of your personal space are not visible in a team.

**Copies, share links and templates**

- Duplicating one of your canvases keeps its kit and the exceptions on its nodes. Copying a canvas to another space does not carry the kit over; see [Copying between spaces](#copying-between-spaces).
- A share link carries no brand kit. Viewers see the prompt that was actually sent (in the task details), not the kit; a copy made from a share link starts without a kit.
- Templates carry no kit: nodes added from a template follow the canvas they are added to.
- Loading another of your canvases into the current one keeps what each loaded node used: if the two canvases have different kits, the loaded nodes get an exception.

**Canvases from an earlier version**

Earlier versions chose the kit on every node. Such canvases are converted automatically: when every generation node used the same kit it becomes the canvas's kit; otherwise the canvas has no kit and each node that had one keeps it as an exception. Either way each node runs with the kit it ran with before.

## Templates

- **Canvas templates** drop a whole pipeline onto the canvas in one click. Open them from the folder button of the toolbar, or start a new canvas from one: a card under **Start from a template** on the workbench, or **New from template** on the Canvases page. Two are built in: *Text to image* and *Image to video*.

  ![The built-in Image to video template in the editor](images/09-editor-dark.png)

- **Text templates** are ready-made prompt snippets, in Chinese and English, that you insert into a Text node.

Besides the built-in ones you can save your own:

- In the **Canvas templates** dialog of the editor, **Save this canvas as a template** saves the nodes of the current canvas and the connections between them, together with the prompts, images and results the nodes hold. Group frames are not saved.
- In the text template dialog, **New snippet** saves a piece of prompt you use often.

What you save in your personal space is visible to you only. What is saved in a team space is there for the whole team: anybody can save, you can delete your own, and the owner and admins can delete any. Built-in ones cannot be deleted. A space keeps up to 200 saved templates and 200 saved snippets.

## Asset library

In the editor, click the folder button of the toolbar and choose **Asset library**. The dialog has these tabs:

| Tab | Contents |
| --- | --- |
| My assets | Images and videos you uploaded or saved, in four categories: product shots, brand assets, references, outputs. |
| Canvas templates | See above. |
| Text templates | See above. |
| My share links | Every share link you created. |
| Stock assets | Shown first, and only when the person running the instance has preloaded shared assets. Empty on a new install. |

To keep a result for reuse, right-click a generation node and choose **Save to my assets**. It appears under My assets → Outputs.

Deleting an asset removes it from the library only. Nodes that already use it keep working.

In a team space the **My assets** tab is called **Team assets** and is the library the whole team shares: every member can see, use and add assets; you can edit and delete the ones you added, and the owner and admins can manage all of them. Assets of your personal space are not visible in a team. To use one there, copy it over first: on the **Assets** page of your personal space, select it and choose **Copy to…**.

The **Assets** page in the sidebar shows the same My assets outside the editor. There you upload by dragging files in, filter by category, type and folder, search by name, and select assets to download, move to a folder, rename, copy a link or delete.

**Folders** sort assets into groups. The **Folders** button on the filter bar (**New folder** while there is none) opens the list of folders:

- Create one by naming it; it may stay empty for now. Typing a new name when you move assets creates the folder as well.
- Each folder shows how many assets it holds (all categories together); an empty one says **Empty**.
- **A folder stays when it is emptied.** It does not go away by itself; delete the ones you no longer use with **Delete folder**. Only an empty folder can be deleted.
- Deleting a folder that still holds assets is refused, and you are told how many are in it. From there you can **Show these assets** to move or delete them, or choose **Dissolve folder, keep assets**: the folder goes away and its assets stay, in no folder.
- In a team space a member may only delete an empty folder they created; dissolving a folder, or deleting one somebody else created, takes the owner or an admin.

## Share links

A share link gives read-only access to a snapshot of one canvas.

1. Click the share button on the editor toolbar (**Create share link**; on a team canvas it reads **Sharing and access**, and the link is on the **Public link** tab).
2. Enter a title and optionally a description.
3. Choose when it expires: 1 day, 7 days, 30 days or never.
4. Copy the link.

What to know:

- **It is a snapshot.** Editing or deleting the original canvas later does not change what you shared. Creating a link for the same canvas again updates the snapshot and keeps the same link.
- **Anyone with the link can open it**, without signing in. The images and videos on it are public files too. Do not share canvases that contain things you want to keep private.
- **Expiry**: after the date, the link stops working on its own.
- **Revoke**: in the asset library under My share links, click **Revoke**. The link stops working immediately. If you share that canvas again later, it gets a new link; the old one never comes back.
- A visitor who has an account on the instance can click **Copy to my canvases** to get an editable copy.

In a team space the **Share** dialog has two tabs. **In the team** decides who in the team can see and edit the canvas (see [Canvases in a team](#canvases-in-a-team)); **Public link** is the share link described above. Whoever can edit the canvas can create a public link, unless the owner changed that to **Owner and admins only** in the team settings. A canvas has one link, and publishing again refreshes it, whoever does it. Members see and revoke only the links they created; the owner and admins can revoke any. A public link is no more private because the canvas is in a team: anyone who has it can view it without signing in.

## Canvases

On the **Canvases** page (its heading is "My canvases") you can create, rename, duplicate and delete canvases, and download all images and videos of a canvas as a zip. The workbench shows the most recent ones.

- **Trash**: a deleted canvas goes to the **Trash** (a button at the top of the Canvases page) and can be restored for 30 days. After that it is removed for good.
- **Copy to a team…** on a card copies the canvas to one of the teams you are in; see [Copying between spaces](#copying-between-spaces).

Inside a canvas:

- **Autosave** runs about 1.5 seconds after a change. Ctrl+S saves at once.
- **Save conflicts**: every save says which version it started from. If the canvas was saved from somewhere else in the meantime (for example, you have it open in a second browser tab), the save is not written and a dialog says "Somebody else changed this canvas" and lets you choose: **Save my version as a copy** (recommended), **Load the latest version**, or **Overwrite with my version**. Until now the later save silently replaced the earlier one. For teams see [Taking turns](#taking-turns).
- **Batch download** (More ⋯) packs the canvas results into one archive, up to 100 files at a time. Save the canvas first.
- **Load another canvas** (More ⋯) copies all nodes and connections of another canvas into this one.
- **Tidy** (More ⋯ or right-click): "Arrange by data flow" lines nodes up along their wires; "Snap to grid" aligns them to the grid. Both can be undone. **Tidy up** in the bottom toolbar is the same "Arrange by data flow". With 2 or more nodes selected you can align them; with 3 or more, distribute them evenly: both are under **Align** on the toolbar of the selection.
- **Find nodes** with Ctrl+F: search prompts, text, models or node types.
- **Immersive mode** (top of the More ⋯ menu) hides the top bar and the sidebar so the canvas fills the screen.

A canvas can hold up to 500 nodes and 2000 connections.

**Canvases from an earlier version.** Generation nodes are much taller than they used to be. The two built-in templates were re-spaced for the new sizes. A canvas that was last saved by a version from before the redesign is arranged once, the first time you open it in the editor, and only if its nodes actually overlap at the new sizes. It uses the same arrangement as **Tidy up**, a notice tells you it happened, and Ctrl+Z puts the nodes back where they were. It never happens again for that canvas, and a canvas saved by the current version is never touched.

## Teams

A team is one space that several accounts share: canvases, assets, brand kits, templates, providers and keys, and run history are kept together. It is not real-time collaboration: one person edits a canvas at a time, and everybody else sees it read-only. This chapter is about the interface; the exact wording of every rule is in the API reference under [Spaces and teams](api.md#spaces-and-teams).

### Personal space and team spaces

Every account has a **personal space**: what you have been using all along, visible to you only. A **team space** is the second kind of space, and it belongs to the team, not to any one person in it: canvases you create in a team, assets you upload and results you produce are the team's, and they stay when you leave. One account can be in several teams.

The two kinds of space do not mix. Canvases, assets, brand kits and keys of your personal space cannot be seen or used in a team, and the other way round; to take something across, [copy](#copying-between-spaces) it.

![The space switcher](images/16-space-switcher.png)

**Switch spaces** with the space switcher to the right of the logo in the top bar. It shows the current space and your role in it, and opens:

- **Personal space**;
- **Teams**: every team you are in, with your role and its number of members. A dissolved or suspended team is listed for its owner only;
- **Create a team** or **Ask to create a team**, see [Creating a team](#creating-a-team);
- **Join with an invite**, see [Invites and joining](#invites-and-joining).

On a phone the switcher is the avatar square in the top bar, and its menu also holds the entry to the **Team** page.

**Addresses.** Pages of a team space start with `/t-<team id>/` (for example `/t-<team id>/canvases`); pages of the personal space have no such prefix. So a link to a team page can be sent to a teammate as it is. A link into a team you are not in explains that and leaves you in your personal space. A canvas link without the prefix, when the canvas is not in the current space, is looked up in your other spaces and switches to the one that has it.

**The sidebar in a team space** is **Team home**, **Canvases**, **Assets**, **Models**, **History**, **Team** and **Settings**.

![Team home](images/17-team-home.png)

**Team home** shows your role and the number of members; three tiles (runs this month, estimated amount this month, queued and running) and, below them, the monthly limit in full: a bar for runs and one for the estimated amount with what is left, what "used" is made of ("24 runs used = 22 succeeded + 2 in progress"), the failed and canceled runs listed apart as not counting, runs of unknown cost, and the moment the count starts again in the team's time zone. All of these are one set of numbers: a run counts once it succeeded or while it is in progress, here and everywhere else; three steps for a new team (set up a provider, invite members, create a canvas); the recent team canvases; what is running now; and the team's providers. People who may see the whole team's usage get the team's numbers and the team's limit; everybody else gets their own.

### Roles

A team has three roles. They are unrelated to the site's "super admin / user".

| Role | Who | In short |
| --- | --- | --- |
| **Owner** | One per team: the creator by default, and it can be transferred | Can do everything. Only the owner decides about money (monthly limits), about who sees what (team settings) and about the team itself (transfer, dissolve). The owner sees every canvas of the team, "Only me" ones included. |
| **Admin** | Named by the owner | On top of what a member does: manages members and invite links, providers and keys, and brand kits; sees the activity; restores deleted canvases; changes the team's name and avatar. |
| **Member** | Whoever joined with an invite link | Does the work: creates canvases, runs with the team's assets and models, saves templates, uploads assets. |

The owner names an admin with **Make admin** in the ⋯ menu of that person's row on **Team → Members**, and takes the role back with **Remove admin role**. The same menu has **Change display name**: the name a person is shown under in this team (your own, or anybody's for the owner and admins); without one the username is shown.

What exactly each role may do is one table, the same one the server decides by: see [The permission matrix](api.md#the-permission-matrix). The interface hides what you cannot do instead of failing after you click.

### What a member sees and does not see

A team has its own providers, keys, models and prices, on the **Models** page of the team space. The owner and admins manage them exactly as in a personal space.

![The Models page as a member sees it](images/28-models-member.png)

Each provider card names who it is **Maintained by**: the person who last changed it (name, address, key, switch, custom models) and when - whom to ask when something is wrong. When that person has left the team or their account has been deleted, the name stays and is followed by **Left the team** or **Account deleted**.

The owner and admins also see the connection state: **Connected**, **Last test failed** (the reason is under the card) or **Not tested**, and when the last test ran. **Test connection** updates the state at once; after the key or the Base URL changes the previous result no longer counts and the state is **Not tested** again. Provider cards in a personal space work the same way.

For a member that page is read-only: the name of each provider, its state (**Available** or **Unavailable**), **Set up by the team**, who maintains it, and the models and prices. **A member never sees a key, its last characters, the address it is sent to or the result of a connection test**, and has no **Test connection** or **Edit**. Members can use the team's key; they cannot get hold of it.

- In a team space only the team's key is used; your own keys are used in your personal space only. To run with your own key, switch back to your personal space.
- Other people's "Only me" canvases are invisible to members and admins.
- The whole team's history and usage are for the owner only (who can open them to admins); everybody else sees their own.
- The team's activity is for the owner and admins.

### Creating a team

Creating a team needs the super admin's authorisation. What the space switcher offers depends on your account:

- **Authorised**: **Create a team**. The dialog says how many more you can create and how many members each may have; enter a team name, the avatar is optional. The team's time zone is taken from your browser; monthly limits follow calendar months in it, and it can be changed later in the team settings.
- **Not authorised**: **Ask to create a team**. You can add a note for the super admin and send the request. It is then shown as **Pending** and can be withdrawn; you can have one pending request at a time. A declined request shows the reason, and you can ask again.
- Authorised but at the limit: the dialog says so. Teams you created or own all count, dissolved ones too until they are deleted for good.

Joining somebody else's team needs no authorisation, only an invite link.

### Invites and joining

An invite link is the only way into a team; no email is sent. Under **Invite links** on **Team → Members**, the owner and admins can:

- create a **New link**: choose how long it is valid (1, 7 or 30 days; 7 by default) and how often it can be used (1, 10 or without limit; 10 by default). The link looks like `<site address>/join/<code>`;
- **Copy** an existing link;
- **Revoke** one: it stops working at once, and people who already joined are not affected.

![The Members tab with the invite links](images/18-team-members.png)

Until the link expires, is used up or is revoked, **anybody who has it** can join as a member, with nobody approving. Send it to the person directly.

![The join page](images/26-join.png)

Whoever opens the link sees the join page: which team, who invites, how many members it has, when the link expires and, for a link with a limited number of uses, how many uses are left (an unlimited link says nothing about that). The page needs no sign-in and shows nothing of what is inside the team; joining needs an account. Or choose **Join with an invite** in the space switcher and paste the whole link or its last part.

- When the site has registration closed, the join page says so and offers no way to register: an invite link is not a way around closed registration.
- An expired link, one that is used up or revoked, a full team and a closed team each show their own reason.

### Canvases in a team

Every canvas in a team has a visibility:

| Visibility | Who can see it | Who can edit it |
| --- | --- | --- |
| **Only me** | The creator and the owner | The creator and the owner |
| **Team can view** | Every member: open it, see the results, make a copy | The creator and the owner |
| **Team can edit** | Every member | Every member, one at a time |

Whatever is chosen, the owner can always see the canvas. A new canvas gets the team's default ("Team can view" at first; the owner can change it in the team settings); the creator, the owner and admins who can see the canvas can change it per canvas.

![The canvas list of a team](images/22-team-canvases.png)

In a team the **Canvases** page gains:

- filters: **All**, **Created by me**, **Team can edit**, **Only me**, and a filter by creator;
- on each card, the creator, the visibility and, while somebody is working on it, "… is editing";
- the card menu: **Rename**, **Duplicate**, **Copy to my personal space** (**Copy to another space…** when you are in other teams as well), **Team access**, **Download**, **Delete**. **Duplicate** gives you a copy that is yours and starts as "Only me";
- the **Trash**, see [Trash](#trash).

The list, and the recent canvases on Team home, keep themselves current while the page is open: who is editing, a new name, and canvases that teammates create, save, delete or restore show up within about 10 seconds, without a reload.

![The "In the team" tab of the Share dialog](images/23-canvas-access.png)

In the editor the title block shows the visibility of the canvas. Click it to open the **Share** dialog: the **In the team** tab holds the three levels above, and the **Public link** tab is the [share link](#share-links).

### Taking turns

One person edits a team canvas at a time. There is no simultaneous editing and no merging.

**The edit lock.** Whoever first opens a canvas they may edit holds the edit lock. The lock belongs to that open editor - that browser tab - not to the account: if you open the same canvas in a second tab (or on another device), the second one is read-only too, and its bar says "You have this canvas open in another tab (or on another device)", with **Edit here** to move the editing over. The editor renews the lock every 12 seconds and gives it back the moment you leave the editor, close the tab or go to another site, so the next person does not wait. Only a tab that died without a word (a crash, a lost connection) keeps the others waiting, for 36 seconds at most.

**A tab in the background.** When you switch to another tab, the editor first saves what is unsaved. A tab that stays hidden for more than about five minutes stops holding the canvas (browsers slow hidden tabs down), so that it does not block the people who are looking. When you come back and nobody took the canvas, you simply carry on. When somebody started editing meanwhile, the bar says "This tab was in the background for too long (or went offline) and … has started editing".

![Read-only, with Take over](images/24-editor-readonly.png)

**Read-only.** When you open a canvas somebody else holds, a bar at the top says "… is editing. You are in read-only mode", next to **Make a copy** and **Take over**. In read-only mode nothing is saved and nothing can be run, and what the other person saves appears on your side within a few seconds. After they leave, the bar changes within about 5 seconds to "… has left. Nobody is editing now" and offers **Start editing** - no reload needed. Somebody else's "Team can view" canvas you can only view and copy; there is no taking over.

The toolbar turns into a read-only one, with an amber outline and an eye mark in place of the node buttons. What is left is what looks and takes away: the **asset library** (browse and download; no upload, no delete, no "add to canvas"), **Sharing and access (read-only)** (the team access, which you can change if you could before; an existing public link to view and copy, but not to create or revoke) and **More** (search, batch download, the guide, the node layout, switching canvases). The nodes can be looked at properly: open an image or a video large, play a video, scroll through a long text and select and copy it (prompts too), look through a node's earlier versions, and download a result. Selecting a generation node still opens its composer or inspector, in a read-only form that shows the prompt, the model, the parameters and the estimated cost. Everything that would change the canvas is absent: no Run, nothing to type into, no ports to wire, nothing to drag or delete. Clicking the eye mark on the toolbar says the same in one sentence.

**Renaming is not editing.** Whoever may edit a canvas can rename it at any time - from the card menu in the list, from the workbench, or by clicking the name in the editor - also while somebody else is editing it, and also from an editor that is read-only for that reason. Nobody is interrupted: the other person's title changes within a few seconds, with a short notice, and their next save goes through as usual. Everybody else's canvas list and workbench show the new name within about 10 seconds, without a reload. Somebody who may only view a canvas cannot rename it; hovering over the name says so.

**Taking over.** **Take over** needs the right to edit the canvas and one confirmation. The person you take over from is not told at once: they turn read-only at their next save or renewal (within 12 seconds). What they saved is kept; changes they had not saved stay on their page and can be kept with **Save my changes as a copy**. Taking over from somebody else is recorded in the team activity; moving your own editing from one tab to another is not.

![The save conflict dialog](images/25-save-conflict.png)

**Save conflicts.** The lock cannot cover everything (it expired, it was taken over, one account has two tabs open), so every save also checks the version. When the version you started from is no longer the latest, the save is not written, and "Somebody else changed this canvas" says who saved and when and lets you choose:

- **Save my version as a copy** (recommended): both versions are kept, to be sorted out side by side later;
- **Load the latest version**: drop your changes;
- **Overwrite with my version**: the other person's changes are lost. Only the creator of the canvas, admins who may edit it and the owner can do this, and it is recorded in the team activity.

Canvases in a personal space get the same dialog now: with one canvas open in two tabs, the later save no longer silently replaces the earlier one.

### Monthly limits and usage

The owner can limit usage per month, in two units: **runs** and **estimated amount**. Each can be set for the whole team and for members: one default for everybody, plus a value of their own for single members. The team's and the default are under **Team → Team settings → Limits**; one person's are under **Change limits** in the ⋯ menu of their row on **Team → Members**. Empty means no limit.

- **What counts.** One rule, everywhere a number appears: **used = succeeded + in progress**. A run holds its place from the moment it is accepted (queued, running, or saving its result) and keeps it when it succeeds. **Failed and canceled runs do not count**: a run that fails gives its place and its money back. One run record counts once, however many images it makes. Team home, **Team → Usage**, the member list and a member's limit dialog all show the same numbers, with failed and canceled runs listed apart and labelled as not counting.
- **The month** is the calendar month in the team's time zone, which is under **Team settings → Basics**.
- **At a limit** new runs are refused; runs already queued or running are not affected. Whichever limit is reached first counts, and it all starts again next month. The refusal is explained where you pressed **Run** - in the composer, the inspector or on the node, in the batch dialog and in the queue list - and it stays there until you have read it: **which limit** (yours or the team's, runs or amount), **the numbers** (used, the limit, and what this run needed), **when the count starts again** (date and time in the team's time zone), and **who to ask** (the owner by name; for a missing price the owner and the admins). If you are the owner, it links to the settings instead. When a limit is already used up, the same explanation is shown before you run, and the counter next to **Run all** turns red. Limits apply to everybody in the team, the owner included, and never to anybody's personal space.
- **Where to look.** The small counter next to **Run all** in the editor, **My limit this month** in the queue list, Team home, and **Team → Usage**. From 80% of a limit on it says "Near the limit". **Team → Usage** always shows the limit of the *current* month at the top; the table below follows the month you choose, and says so when that is another month.
- **Models without a price.** An amount can only be counted for models that have a price. With an amount limit set and **Block models without a price** on (the default), a model without a price, or with a price in another currency than the team's, cannot run in the team; **Team settings → Limits** lists which ones. With the switch off, such runs count as runs only. In the editor such a model is marked **Cannot run** in the model list, and selecting it explains why and names the owner and admins who can enter its price.
- **An estimate is not a bill.** Amounts are estimates from the prices the team entered under **Models**; the real bill is the provider's. A run without a price shows **Cost unknown** and is counted separately ("plus N of unknown cost"), never as 0. **Chat models priced per token** are known only when they finish, so a chat run first **holds a reserve**: the price of what you send plus the price of the longest answer assumed (8192 output tokens unless the model states its own maximum; the administrator of the server can change the number). When the run is done the reserve is replaced by the real cost, which is usually much smaller; a run that fails or is canceled gives all of it back. This is why an amount limit is never silently passed by chat runs - and why a chat run can be refused although its real cost would have fitted: the message then says how much was to be held and how much is left.

The full rules are under [Monthly limits](api.md#monthly-limits).

![Team usage](images/19-team-usage.png)

**Team → Usage** has the limit of the current month at the top (the same block as on Team home). Below it, for the month you choose: runs that count (succeeded + in progress), runs that do not (failed, canceled, with the success rate), the estimated amount (saying how much of it is held by runs in progress) and runs of unknown cost; the table puts "counted" and "not counted" into two groups of columns and, for the current month, ends with each member's limit. The owner can group **By member**, **By model** or **By day** and **Export CSV**; everybody else sees only their own records here.

### Activity

![Team activity](images/20-team-activity.png)

**Team → Activity** is the record of the team's management actions, for the owner and admins: members joining, leaving, being removed, changing role or display name; invite links; changes to providers, keys and prices; limits; canvases deleted, restored, changed in visibility, taken over or overwritten; share links; the team's name, avatar and settings; dissolving and restoring. It can be filtered by period, category and member, and a deleted canvas can be **Restore**d right from its entry.

Each entry says who did what, and where a value changed it shows before and after, for example "Role: Member → Admin", "Monthly run limit of the team: 1,000 runs → 1,200 runs", "Visibility: Only me → Team can view" or "Price: CN¥0.90/image → CN¥0.60–CN¥1.60/image (by resolution, 3 tiers)". An invite link's entry gives its number of uses and expiry date; a member's departure says how many of their canvases went to the owner.

People appear under the name they have in the team **now**. Somebody who has left keeps their name, followed by **Left the team**; somebody whose account was deleted is marked **Account deleted**. What the super admin does from outside the team (suspending it, naming a new owner, deleting a member's account) is listed under **Super admin**.

Only management actions are logged, not everyday work (saving a canvas or running a model is not in it), and never prompts, the content of keys or addresses. Nobody can change or delete an entry; how long entries are kept is set by the super admin (365 days by default).

### Team settings

![Team settings](images/21-team-settings.png)

**Team → Team settings** is shown to the owner and admins. Admins can change the team's name and avatar only; the rest is the owner's.

| Card | What is there |
| --- | --- |
| **Basics** | Team name, avatar, time zone (monthly limits follow calendar months in it). |
| **Default permissions** | **Default visibility of new canvases**; **Who can create public share links** (members who can edit the canvas, or owner and admins only); **Admins can see everybody's records and usage**; **Members may copy team canvases and assets to their personal space**. |
| **Limits** | **Monthly limit of the team** and **Default monthly limit per member**, each in runs and in estimated amount; **Currency**; **Block models without a price**. |
| **Danger zone** | **Transfer ownership**, **Dissolve the team**. |

### Leaving, removing, transferring and dissolving

**Leaving.** On **Team → Members**, open the ⋯ menu at the end of your own row and choose **Leave the team**. **Removing** somebody else is **Remove** in the same menu of their row: the owner can remove anybody, an admin only members. The outcome is the same either way:

- the person loses access to the team space at once;
- canvases, assets and results they made stay with the team;
- their "Only me" canvases pass to the owner, or nobody could open them;
- their queued runs are canceled, and runs that already started finish;
- the invite links they created stop working;
- coming back needs a new invite link.

When the person removed is an admin who entered provider keys, the interface lists the providers concerned: this person knows those keys, so replace them at the provider and update them under **Models**. A member never saw a key, so nothing has to be replaced.

**The owner cannot simply leave.** A team always has an owner: **Transfer ownership** first, or **Dissolve the team**. Both are under **Team settings → Danger zone**, and both ask you to type the exact team name.

- **Transfer ownership**: pick a member to take over; you become an admin. You cannot undo this yourself.
- **Dissolve the team**: nobody can get in from that moment, queued runs are canceled, and invite links and share links stop working. Nothing is deleted yet: **for 7 days** the owner can restore the team from the space switcher, and so can the super admin. After 7 days the team's canvases, assets, keys, records and files are deleted for good.

**Removed, dissolved or suspended while you are using the team**: your next action takes you back to your personal space, with a dialog that says which of the three happened.

### Copying between spaces

Canvases and assets can be copied to another space you are in:

- the **Canvases** page of your personal space: **Copy to a team…** on a card;
- the **Canvases** page of a team: **Copy to my personal space** or **Copy to another space…** in the card menu;
- the **Assets** page: select one asset and choose **Copy to…**.

The rules:

- **Files are copied too.** Every file the canvas refers to is stored again in the target space; afterwards the two are independent. At most 300 files and 2 GiB at a time.
- A canvas copied into a team is yours and starts as "Only me"; you can change that afterwards. An asset copied into a team goes into the team's library, for everybody.
- **The brand kit is not carried over.** Nodes ask for a model again when the target space does not have theirs.
- The owner can turn off **Members may copy team canvases and assets to their personal space** in the team settings. Members and admins then cannot copy team content to their personal space; the owner always can, and copying to another team you are in is not affected.
- The **Copy to…** dialog lists **every** space you are in. The ones that cannot take the copy are listed too, greyed out, each with the reason: the owner turned off copying to the personal space, that team is suspended or dissolved, that space already holds the maximum number of assets of this kind, or it is the space you are in.

### Trash

A deleted canvas goes to the trash and can be restored for 30 days; then it is removed for good. Open it with **Trash** at the top of the **Canvases** page.

- Personal space: you restore it yourself.
- Team space: only the owner and admins see the **Trash** and can restore; a member who deleted a canvas of their own asks one of them.

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
| Ctrl + click | Add a node to the selection, or take it out |
| Ctrl+Enter | With the cursor in a prompt: run that node |
| Esc | Close menus; collapse the composer or the inspector (the node stays selected) |

## Language and appearance

- **Language**: the dropdown in the top bar (in a window narrower than 760px: **Language** in the account menu), or **Interface language** under **Settings → Appearance**, switches between 简体中文 and English. Messages from the server follow the same language. The choice is remembered per browser; until you choose, the **Default language** the super admin set under **Settings → Appearance** applies.
- **Node layout**: one of three under **Settings → Appearance**; it decides how generation nodes look on the canvas, see [Generation](#generation-calls-a-paid-model). It is stored with your account, not in the browser.
- **Theme**: Dark (the default), Light, or System, which follows your device and switches with it. Pick one of the three preview cards; it applies at once, without a reload. The choice is kept with your account, so it is the same wherever you sign in, and this browser remembers it for the sign-in page and shared canvases. The icon next to the language menu in the top bar switches it too; the landing, sign-in and registration pages, a shared canvas, "Page not found" and "Can't reach the server" have the same icon, and what you pick there is remembered by the browser and saved to your account when you sign in. When you picked nothing there and the browser shows another theme than your account's (a new browser, say), signing in does not flash: the sign-in page keeps its look, and the app opens in your account's theme from its first frame.
- **Canvas appearance** (More ⋯ or right-click): background colour, pattern and density of one canvas. It is saved with the canvas and travels with its share links. On the default background a canvas follows the theme of whoever looks at it; a colour you picked stays the same in both themes, and wires, group outlines, the pattern and the minimap take their colours from its brightness.

The light theme, on a team's home page and on the landing page:

![Team home in the light theme](images/17-team-home-light.png)

![The landing page in the light theme](images/12-landing-light.png)

## Limits worth knowing

| Limit | Value |
| --- | --- |
| Upload from the canvas, per file | The server's `MAX_UPLOAD_MB` (50 MB by default). The canvas reads the limit from the server and refuses a larger file before uploading it. |
| File types | Images and videos, recognised by content, not by file name |
| Reference images per run | Up to the selected model's limit; extra ones are left out with a notice |
| Restoring a deleted canvas | Within 30 days |
| Restoring a dissolved team | Within 7 days |
| Edit lock of a team canvas | One per open editor (tab). Expires 36 seconds after its last renewal; the editor renews every 12 seconds and gives it back at once when the tab is closed. A read-only editor looks every 5 seconds whether the canvas became free; a canvas list and the workbench refresh "who is editing" and the canvas names every 10 seconds |
| Files copied along between spaces | 300 files, 2 GiB |
| Saved templates, saved prompt snippets | 200 each per space |

How many members a team may have and how many teams one person may create are set by the super admin; the other limits are in [Configuration](configuration.md#fixed-limits).

More answers in the [FAQ](faq.md).
