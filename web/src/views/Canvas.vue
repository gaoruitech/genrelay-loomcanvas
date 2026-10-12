<template>
  <div ref="edRef" class="ed" :class="{ 'sheet-open': !!fly, 'insp-open': inspectorInset > 0, 'has-hint': noModels, 'read-only': readOnly, 'no-title': !feat.titleBar }" :data-node-layout="nodeLayout">
    <!-- 素材库 / 我的分享 / 模板 / 教程 -->
    <LibraryDialog v-if="libraryMenuItems.length" v-model="libraryOpen" :initial-tab="libraryInitialTab" @add-asset="onAddAsset" @apply-template="applyTemplate" @add-text="onAddText" />
    <CanvasTemplateDialog v-if="feat.templates" v-model="templateDialogOpen" @apply="applyTemplate" />
    <CanvasGuide v-if="feat.guide" v-model="guideOpen" :section="guideSection" :empty="!loading && nodes.length === 0" @open-templates="openTemplates" />

    <!-- 创建分享链接弹窗：先填表，创建成功后同一个弹窗里换成链接 + 复制 -->
    <div v-if="shareOpen" class="lc-mask" @click.self="closeShareDialog">
      <div class="lc-dialog share-dialog" role="dialog" aria-modal="true" :aria-label="t('canvas.share.title')">
        <div class="lc-dialog-head">
          <span>{{ t('canvas.share.title') }}</span>
          <button class="lc-x" :aria-label="t('common.close')" @click="closeShareDialog">×</button>
        </div>
        <template v-if="!shareResult">
          <div class="lc-dialog-body">
            <p class="lc-help share-tip">{{ t('canvas.share.tip') }}</p>
            <div class="lc-field">
              <label :for="uid + '-share-title'">{{ t('canvas.share.titleLabel') }}</label>
              <input :id="uid + '-share-title'" v-model="shareForm.title" class="lc-input" maxlength="80" :placeholder="t('canvas.share.titlePlaceholder')" />
            </div>
            <div class="lc-field">
              <label :for="uid + '-share-desc'">{{ t('canvas.share.descLabel') }}</label>
              <textarea :id="uid + '-share-desc'" v-model="shareForm.description" class="lc-textarea" maxlength="500" rows="3" :placeholder="t('canvas.share.descPlaceholder')"></textarea>
            </div>
            <div class="lc-field share-last">
              <span class="lc-label">{{ t('canvas.share.expiryLabel') }}</span>
              <div class="lc-seg share-expiry">
                <button
                  v-for="opt in shareExpiryOptions"
                  :key="opt.value"
                  type="button"
                  :class="{ on: shareForm.expiresInDays === opt.value }"
                  @click="shareForm.expiresInDays = opt.value"
                >{{ opt.label }}</button>
              </div>
            </div>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" :disabled="publishing" @click="closeShareDialog">{{ t('common.cancel') }}</button>
            <button class="lc-btn primary quiet" :disabled="publishing" @click="handlePublish">
              {{ publishing ? t('canvas.share.creating') : t('canvas.share.create') }}
            </button>
          </div>
        </template>
        <template v-else>
          <div class="lc-dialog-body">
            <div class="lc-field share-last">
              <label :for="uid + '-share-link'">{{ t('canvas.share.linkLabel') }}</label>
              <div class="share-link-row">
                <input :id="uid + '-share-link'" class="lc-input lc-mono" readonly :value="shareResult.link" @focus="selectAllText" />
                <button class="lc-btn primary quiet" @click="copyShareLink"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
              </div>
              <p class="lc-help">
                {{ shareResult.expiresAt ? t('canvas.share.expiresAt', { time: formatTime(shareResult.expiresAt) }) : t('canvas.share.neverExpires') }}
                · {{ t('canvas.share.manageHint') }}
              </p>
            </div>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" @click="closeShareDialog">{{ t('canvas.share.done') }}</button>
          </div>
        </template>
      </div>
    </div>

    <!-- 加载其他画布到当前 -->
    <Teleport :to="$lcPortal">
      <div v-if="importPickerOpen" class="lc-mask" @click.self="importPickerOpen = false">
        <div class="lc-dialog proj-dialog" role="dialog" aria-modal="true" :aria-label="t('canvas.project.importTitle')">
          <div class="lc-dialog-head">
            <span>{{ t('canvas.project.importTitle') }}</span>
            <button class="lc-x" :aria-label="t('common.close')" @click="importPickerOpen = false">×</button>
          </div>
          <div class="lc-dialog-body">
            <p class="lc-help proj-note">{{ t('canvas.project.importNote') }}</p>
            <div v-if="projLoading" class="lc-empty">{{ t('common.loading') }}</div>
            <template v-else>
              <button v-for="w in otherCanvases" :key="w.id" class="proj-item" @click="importCanvas(w)">
                <span class="proj-thumb lc-thumb">
                  <img v-if="w.thumbnailType === 'image' && w.thumbnail" :src="canvasImageThumb(ensureHttps(w.thumbnail))" alt="" loading="lazy" />
                  <LcIcon v-else name="canvas" />
                </span>
                <span class="proj-info">
                  <span class="proj-item-name">{{ w.name }}</span>
                  <span class="proj-item-time">{{ formatTime(w.updatedAt || w.createdAt) }}</span>
                </span>
              </button>
              <div v-if="!otherCanvases.length" class="lc-empty">{{ t('canvas.project.importEmpty') }}</div>
            </template>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Vue Flow 画布：铺满整个编辑区，其余控件都是浮在上面的玻璃块 -->
    <div
      class="vf-wrap"
      :class="{ auto: bgIsAuto, 'drag-over': dragActive, 'box-selecting': boxSelecting }"
      :style="flowStyle"
      :data-ground="groundTone"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onCanvasDrop"
    >
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        :node-types="nodeTypes"
        :edge-types="edgeTypes"
        :default-edge-options="{ type: 'glow' }"
        :is-valid-connection="isValidConnection"
        :only-render-visible-elements="true"
        :min-zoom="MIN_ZOOM"
        :max-zoom="MAX_ZOOM"
        :delete-key-code="null"
        :nodes-draggable="!readOnly"
        :nodes-connectable="!readOnly"
        :elements-selectable="!readOnly"
        :selection-mode="SelectionMode.Partial"
        :default-viewport="{ x: 0, y: 0, zoom: 1 }"
        @connect="onConnect"
        @viewport-change="onViewportChange"
        @node-drag-start="onNodeDragStart"
        @node-drag="onNodeDragMove"
        @node-drag-stop="onNodeDragStop"
        @node-context-menu="onNodeContextMenu"
        @pane-context-menu="onPaneContextMenu"
        @pane-click="closeMenus"
        @move-start="closeMenus"
      >
        <!-- 图案：dots / lines 用 vue-flow 自带的；cross 借它的 pattern 插槽自己画，
             这样平移缩放跟着视口走 —— 拿 CSS 背景铺在外层是不跟随的，一拖就穿帮 -->
        <Background
          v-if="bgSettings.pattern !== 'none'"
          :variant="bgVariant"
          :pattern-color="flowPatternColor"
          :gap="bgSettings.gap"
          :size="bgSettings.pattern === 'dots' ? 1.6 : undefined"
        >
          <template v-if="bgSettings.pattern === 'cross'" #pattern>
            <path :d="crossPath" :stroke="flowPatternColor" stroke-width="1" fill="none" />
          </template>
        </Background>
        <MiniMap
          v-if="feat.minimap"
          position="bottom-left"
          pannable
          zoomable
          :width="168"
          :height="104"
          :node-color="miniNodeColor"
          :node-border-radius="3"
          :mask-color="miniMaskColor"
          :mask-stroke-color="miniStrokeColor"
          :mask-stroke-width="1.5"
          :mask-border-radius="6"
          :aria-label="t('canvas.tools.minimap')"
        />
      </VueFlow>

      <!-- 拖动节点时的智能对齐参考线。
           DOM 常驻、靠 .on 控制淡入淡出：v-if 直接切会 0ms 现 0ms 灭，快拖时像闪频。
           线不是纯色，而是走 userSpaceOnUse 的渐变，两端各 GUIDE_PAD 渐隐到透明，
           所以看到的是「浮现的一段」而不是戳出画面的一根硬线。 -->
      <svg class="vf-align-guides" :class="{ on: guidesOn }" aria-hidden="true">
        <defs>
          <linearGradient
            v-for="(g, i) in alignGuides"
            :key="'vf-guide-grad-' + i"
            :id="uid + '-guide-' + i"
            gradientUnits="userSpaceOnUse"
            :x1="g.type === 'v' ? g.pos : g.a"
            :y1="g.type === 'v' ? g.a : g.pos"
            :x2="g.type === 'v' ? g.pos : g.b"
            :y2="g.type === 'v' ? g.b : g.pos"
          >
            <stop offset="0" stop-opacity="0" />
            <stop offset="0.14" stop-opacity="1" />
            <stop offset="0.86" stop-opacity="1" />
            <stop offset="1" stop-opacity="0" />
          </linearGradient>
        </defs>
        <template v-for="(g, i) in alignGuides" :key="i">
          <line
            :x1="g.type === 'v' ? g.pos : g.a"
            :y1="g.type === 'v' ? g.a : g.pos"
            :x2="g.type === 'v' ? g.pos : g.b"
            :y2="g.type === 'v' ? g.b : g.pos"
            :stroke="`url(#${uid}-guide-${i})`"
            :stroke-dasharray="g.center ? '5 5' : undefined"
            :opacity="g.opacity"
          />
          <!-- 命中（真吸上了）时才在两端点一下，标出对齐到的是哪条边 -->
          <template v-if="g.opacity > 0.9">
            <circle
              :cx="g.type === 'v' ? g.pos : g.ca"
              :cy="g.type === 'v' ? g.ca : g.pos"
              r="2.2"
            />
            <circle
              :cx="g.type === 'v' ? g.pos : g.cb"
              :cy="g.type === 'v' ? g.cb : g.pos"
              r="2.2"
            />
          </template>
        </template>
      </svg>

      <div v-if="loading" class="vf-loading"><span class="lc-ring spin sm" aria-hidden="true" />{{ t('common.loading') }}</div>

      <!-- 拖入文件时的高亮提示 -->
      <div v-if="dragActive" class="vf-drop-hint">
        <LcIcon name="upload" size="xl" />
        <span>{{ t('canvas.dropHint') }}</span>
      </div>
    </div>

    <!-- ============ 悬浮玻璃块 ============ -->

    <!-- 左上：返回 + 画布名（就地改名）+ 保存状态 -->
    <div v-if="feat.titleBar" class="fl ed-title">
      <button v-if="canGoBack" class="lc-tb" :title="t('canvas.topbar.backToList')" :aria-label="t('canvas.topbar.backToList')" @click="goToList">
        <LcIcon name="chev" class="flip" />
      </button>
      <label class="ed-name" :title="t('canvas.topbar.rename')">
        <span class="ed-name-mirror" aria-hidden="true">{{ workflowName || t('canvas.untitled') }}</span>
        <input
          v-model="workflowName"
          :readonly="readOnly"
          maxlength="80"
          :placeholder="t('canvas.untitled')"
          :aria-label="t('canvas.topbar.rename')"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
      </label>
      <button v-if="!readOnly" class="ed-save lc-st" :class="saveState.cls" :disabled="saving" :title="t('canvas.save.saveNow')" @click="handleSave">
        <span>{{ saveState.text }}</span>
      </button>
      <!-- 这张画布套用的品牌包：整张画布一处选，所有生成节点跟着用 -->
      <CanvasBrandKitChip
        v-if="!loading && feat.brandKit && !readOnly"
        v-model="canvasKitId"
        :kits="brandKits.kits.value"
        :loaded="brandKits.loaded.value"
        :exceptions="kitExceptionCount"
        @edit="openKitEditor"
        @create="openKitEditor(null)"
      />
    </div>

    <!-- 工具面板：加节点（+ 是全部节点，下面按类别分）、素材库、分享、更多画布操作。
         默认竖排在左边；抓着把手（或面板空白处）可以拖到任何地方，把手旁边的开关切横排 / 竖排。
         手机上是标题块下面固定的一横条，不能拖。 -->
    <div
      v-if="feat.palette && !readOnly"
      ref="palRef"
      class="fl ed-pal"
      :class="[palOrient, { phone: palPhone, ready: palReady, drag: palDragging }]"
      :style="palPhone ? undefined : { transform: `translate3d(${palXY.x}px, ${palXY.y}px, 0)` }"
      role="toolbar"
      :aria-label="t('canvas.pal.label')"
      :aria-orientation="palOrient === 'h' ? 'horizontal' : 'vertical'"
      data-testid="palette"
      @pointerdown="palDown"
      @pointermove="palMove"
      @pointerup="palUp($event, true)"
      @pointercancel="palUp($event, false)"
      @mousedown="onPalMouseDown"
      @keydown="onPalKeydown"
      @focusin="onPalFocusIn"
    >
      <template v-if="!palPhone">
        <button
          type="button"
          class="pal-grip"
          :class="{ on: palMenu.open }"
          :title="t('canvas.pal.grip')"
          :aria-label="t('canvas.pal.grip')"
          aria-haspopup="menu"
          :aria-expanded="palMenu.open"
          data-pal="grip"
          @click="onGripClick"
        ><LcIcon name="grip" size="s" /></button>
        <button
          type="button"
          class="lc-tb pal-turn"
          :title="turnLabel"
          :aria-label="turnLabel"
          data-pal="turn"
          @click="turnPalette"
        ><LcIcon :name="palOrient === 'v' ? 'turnh' : 'turnv'" size="s" /></button>
        <hr />
      </template>
      <button
        class="lc-tb"
        :class="{ on: fly === 'all' }"
        :title="t('canvas.rail.addNode')"
        :aria-label="t('canvas.rail.addNode')"
        :aria-expanded="fly === 'all'"
        data-pal="all"
        @click="toggleFly('all')"
      ><LcIcon name="plus" /></button>
      <hr />
      <button
        v-for="c in palCats"
        :key="c.key"
        class="lc-tb"
        :class="{ on: fly === c.key }"
        :title="c.title"
        :aria-label="c.title"
        :data-pal="c.key"
        @click="onPalClick(c)"
      ><LcIcon :name="c.icon" /></button>
      <hr v-if="libraryMenuItems.length" />
      <button
        v-if="libraryMenuItems.length"
        class="lc-tb"
        :class="{ on: fly === 'lib' }"
        :title="t('canvas.pal.library')"
        :aria-label="t('canvas.pal.library')"
        :aria-expanded="fly === 'lib'"
        data-pal="lib"
        @click="toggleFly('lib')"
      ><LcIcon name="folder" /></button>
      <hr />
      <!-- 分享 + 更多：原来在右上角，现在跟着面板走 -->
      <button
        v-if="feat.share"
        class="lc-tb"
        :disabled="saving || publishing"
        :title="t('canvas.topbar.share')"
        :aria-label="t('canvas.topbar.share')"
        data-pal="share"
        @click="openShareFromPal"
      ><LcIcon name="share" /></button>
      <button
        class="lc-tb"
        :class="{ on: moreMenu.open }"
        :title="t('canvas.topbar.more')"
        :aria-label="t('canvas.topbar.more')"
        aria-haspopup="menu"
        :aria-expanded="moreMenu.open"
        data-pal="more"
        @click="toggleMoreMenu"
      ><LcIcon name="more" /></button>
      <!-- 沉浸式里没有外壳导航：留一颗看得见的退出钮 -->
      <button
        v-if="appStore.immersive && feat.immersive"
        class="lc-tb"
        :title="t('canvas.menu.exitImmersive')"
        :aria-label="t('canvas.menu.exitImmersive')"
        data-pal="exit"
        @click="appStore.setImmersive(false)"
      ><svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.exitFull" /></button>
    </div>

    <!-- 把手的小菜单：换方向、复位 -->
    <div v-if="palMenu.open" ref="palMenuRef" class="ed-palmenu lc-menu" role="menu" :style="palMenu.style" @click.stop>
      <button class="lc-menu-item" role="menuitem" data-key="turn" @click="turnPalette">
        <LcIcon :name="palOrient === 'v' ? 'turnh' : 'turnv'" size="s" />{{ turnLabel }}
      </button>
      <button class="lc-menu-item" role="menuitem" data-key="reset" :disabled="palIsDefault" @click="resetPalette">
        <LcIcon name="refresh" size="s" />{{ t('canvas.pal.reset') }}
      </button>
    </div>

    <!-- 面板按钮的展开层：桌面上朝面板旁边有地方的那一侧开，手机是底部抽屉 -->
    <div v-if="fly" ref="flyRef" class="fl ed-fly" :class="{ wide: fly === 'all' }" :style="flyStyle">
      <div class="ed-fly-h">
        <span>{{ flyTitle }}</span>
        <button class="lc-tb sm" :title="t('common.close')" :aria-label="t('common.close')" @click="fly = ''"><LcIcon name="x" size="s" /></button>
      </div>
      <div class="ed-fly-b">
        <template v-for="(g, gi) in flyGroups" :key="'fg-' + gi">
          <div v-if="g.title" class="ed-sub">{{ g.title }}</div>
          <div class="ed-grid" :class="{ one: fly !== 'all' }">
            <button
              v-for="item in g.items"
              :key="item.key"
              class="ed-item"
              :disabled="item.disabled"
              :title="item.label"
              :data-key="item.key"
              @click="runFlyItem(item)"
            >
              <LcIcon v-if="item.lc" :name="item.lc" />
              <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </template>
        <div v-if="fly === 'all'" class="ed-legend">
          <span><i class="dot d-text" />{{ t('nodes.title.text') }}</span>
          <span><i class="dot d-image" />{{ t('nodes.title.image') }}</span>
          <span><i class="dot d-video" />{{ t('nodes.title.video') }}</span>
          <span><i class="dot d-last" />{{ t('canvas.addPanel.legendLastFrame') }}</span>
        </div>
      </div>
    </div>

    <!-- 切换项目：贴在标题块下面 -->
    <div v-if="projMenuOpen" class="fl ed-proj">
      <div class="ed-fly-h"><span>{{ t('canvas.rail.switchProject') }}</span><span class="lc-chip">{{ projList.length }}</span></div>
      <div v-if="projLoading" class="lc-empty">{{ t('common.loading') }}</div>
      <div v-else class="ed-proj-list">
        <button v-for="w in projList" :key="w.id" class="proj-item" :class="{ cur: w.id === currentId }" @click="switchToCanvas(w.id)">
          <span class="proj-thumb lc-thumb">
            <img v-if="w.thumbnailType === 'image' && w.thumbnail" :src="canvasImageThumb(ensureHttps(w.thumbnail))" alt="" loading="lazy" />
            <LcIcon v-else name="canvas" />
          </span>
          <span class="proj-info">
            <span class="proj-item-name">{{ w.name }}</span>
            <span class="proj-item-time">{{ formatTime(w.updatedAt || w.createdAt) }}</span>
          </span>
          <span v-if="w.id === currentId" class="lc-chip">{{ t('canvas.project.current') }}</span>
        </button>
        <div v-if="!projList.length" class="lc-empty">{{ t('canvas.project.empty') }}</div>
      </div>
      <div class="ed-proj-foot">
        <button class="lc-btn sm block" @click="openImportPicker"><LcIcon name="download" size="s" />{{ t('canvas.project.importTitle') }}</button>
      </div>
    </div>

    <!-- 一个可用的图片 / 视频模型都没有：提示去模型页连接 -->
    <div v-if="noModels" class="ed-hint lc-alert warn">
      <LcIcon name="warn" size="s" />
      <span><b>{{ t('models.none') }}</b> {{ t('canvas.hint.noModels') }}</span>
      <router-link v-if="feat.modelManagement && !host" to="/models">{{ t('canvas.hint.goModels') }}</router-link>
    </div>

    <!-- 底部中间：缩放 / 撤销重做 / 自动整理 / 运行全部 -->
    <div class="fl ed-tools" role="toolbar" :aria-label="t('canvas.tools.label')">
      <button class="lc-tb" :disabled="zoomPct <= MIN_ZOOM * 100" :title="t('canvas.tools.zoomOut')" :aria-label="t('canvas.tools.zoomOut')" @click="zoomOut()"><LcIcon name="zout" /></button>
      <button class="ed-zoom" :title="t('canvas.tools.zoomReset')" @click="zoomTo(1, { duration: 200 })">{{ zoomPct }}%</button>
      <button class="lc-tb" :disabled="zoomPct >= MAX_ZOOM * 100" :title="t('canvas.tools.zoomIn')" :aria-label="t('canvas.tools.zoomIn')" @click="zoomIn()"><LcIcon name="zin" /></button>
      <button class="lc-tb" :title="t('canvas.tools.fit')" :aria-label="t('canvas.tools.fit')" @click="fitFree({ duration: 200 })"><LcIcon name="fit" /></button>
      <template v-if="!readOnly">
      <hr />
      <!-- 撤销 / 重做：快捷键之外还是要给可见入口，不然只有知道 Ctrl+Z 的人能用 -->
      <button class="lc-tb" :disabled="!hist.canUndo.value" :title="t('canvas.topbar.undoTip')" :aria-label="t('canvas.topbar.undo')" @click="doUndo"><LcIcon name="undo" /></button>
      <button class="lc-tb" :disabled="!hist.canRedo.value" :title="t('canvas.topbar.redoTip')" :aria-label="t('canvas.topbar.redo')" @click="doRedo"><LcIcon name="redo" /></button>
      <hr />
      <button class="lc-btn sm ed-arrange" :disabled="layout.running.value || nodes.length < 2" :title="t('canvas.menu.arrange')" @click="runArrange">
        <LcIcon name="layout" size="s" /><span>{{ t('canvas.tools.arrange') }}</span>
      </button>
      <hr />
      <button
        class="lc-btn primary sm ed-run"
        :disabled="executor.running.value"
        :title="executor.running.value ? t('canvas.topbar.running') : t('canvas.tools.runAllTip')"
        @click="executor.runAll()"
      >
        <LcIcon name="play" size="s" /><span>{{ executor.running.value ? t('canvas.topbar.running') : t('canvas.topbar.runAll') }}</span>
      </button>
      </template>
    </div>

    <!-- 整理后的反悔入口：整理是一次性重排全部位置，没有撤销就不敢点 -->
    <div v-if="layoutUndo.visible" class="fl ed-undo">
      <span>{{ layoutUndo.text }}</span>
      <button class="lc-btn text sm" @click="undoLayout">{{ t('canvas.layout.undo') }}</button>
    </div>

    <!-- 换了节点布局（或这张画布是在另一种布局下排的）之后节点互相压住：只提示，点了才整理 -->
    <div v-if="layoutNote.visible && !layoutUndo.visible" class="fl ed-undo ed-note" role="status" data-testid="layout-note">
      <span>{{ layoutNote.text }}</span>
      <button class="lc-btn text sm" data-testid="layout-note-arrange" @click="arrangeFromNote">{{ t('canvas.tools.arrange') }}</button>
      <button class="lc-tb sm" :title="t('common.close')" :aria-label="t('common.close')" @click="dismissLayoutNote"><LcIcon name="x" size="s" /></button>
    </div>

    <!-- 生成节点的编辑面板，整张画布只有一个实例：布局 a 是跟着选中节点的输入条，布局 b 是右缘的属性面板。
         布局 c 没有面板，全在节点上。按节点 id 加 key：换一个节点就整个重建。 -->
    <GenComposer
      v-if="nodeLayout === 'a' && panelNode"
      :key="'gc-' + panelNode.id"
      ref="genPanelRef"
      :node-id="panelNode.id"
      :kind="panelNode.kind"
      @close="closeGenPanel"
    />
    <GenInspector
      v-else-if="nodeLayout === 'b' && panelNode"
      :key="'gi-' + panelNode.id"
      ref="genPanelRef"
      :node-id="panelNode.id"
      :kind="panelNode.kind"
      @close="closeGenPanel"
    />

    <!-- 生成队列：一颗悬浮圆钮，默认在右下角，可以拖走；点开是贴着它的清单卡片 -->
    <QueuePanel
      v-if="feat.queue"
      :nodes="nodes"
      :right-inset="inspectorInset"
      :avoid="palAvoid"
      :workflow-id="currentId"
      :title-of="nodeTypeLabel"
      :cancel-node="executor.cancelNode"
      @focus="gotoNode"
    />
    <!-- 手机上节点面板抽屉后面的遮罩 -->
    <div class="ed-scrim" @click="fly = ''" />

    <!-- 节点右键菜单 -->
    <div
      v-if="contextMenu.open"
      class="ctx-menu lc-menu"
      role="menu"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
    >
      <template v-if="contextNodeInfo">
        <button class="lc-menu-item" role="menuitem" @click="viewOriginalFromContext">
          <LcIcon name="eye" size="s" />
          {{ contextNodeInfo.mediaType === 'video' ? t('canvas.ctx.viewVideo') : t('canvas.ctx.viewImage') }}
        </button>
        <button class="lc-menu-item" role="menuitem" @click="downloadFromContext">
          <LcIcon name="download" size="s" />
          {{ contextNodeInfo.mediaType === 'video' ? t('canvas.ctx.downloadVideo') : t('canvas.ctx.downloadImage') }}
        </button>
        <button v-if="feat.assetLibrary" class="lc-menu-item" role="menuitem" @click="saveToAssetsFromContext">
          <LcIcon name="folder" size="s" />
          {{ t('canvas.ctx.saveToAssets') }}
        </button>
        <button v-if="contextImageUrl && feat.imageEditor" class="lc-menu-item" role="menuitem" @click="editImageFromContext">
          <LcIcon name="edit" size="s" />
          {{ t('canvas.ctx.editImage') }}
        </button>
        <button class="lc-menu-item" role="menuitem" @click="detailFromContext">
          <LcIcon name="info" size="s" />
          {{ t('canvas.ctx.taskDetail') }}
        </button>
        <button v-if="contextCanFork" class="lc-menu-item" role="menuitem" @click="continueFromContext">
          <LcIcon name="refresh" size="s" />
          {{ t('canvas.ctx.continue') }}
        </button>
        <button v-if="contextCanFork" class="lc-menu-item" role="menuitem" @click="forkFromContext">
          <LcIcon name="branch" size="s" />
          {{ t('canvas.ctx.fork') }}
        </button>
        <hr />
      </template>
      <!-- 生成节点：让这一个节点不跟随画布的品牌包 -->
      <template v-if="contextKitOptions">
        <div class="ed-sub">{{ t('brandKit.node.menuTitle') }}</div>
        <button
          v-for="o in contextKitOptions" :key="o.value" class="lc-menu-item ctx-kit" :class="{ active: o.on }"
          role="menuitemradio" :aria-checked="o.on" :data-kit="o.value" @click="setKitFromContext(o.value)"
        >
          <LcIcon v-if="o.on" name="check" size="s" /><span v-else class="ctx-kit-gap" />
          <span class="ctx-kit-l">{{ o.label }}</span>
        </button>
        <hr />
      </template>
      <!-- 多选普通节点后右键：把它们圈成一组 -->
      <template v-if="!contextIsFrame && selectedLoose >= 2">
        <button class="lc-menu-item" role="menuitem" @click="groupFromContext">
          <svg class="lc-ic s" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.frame" />
          {{ t('canvas.ctx.group', { n: selectedLoose }) }}
        </button>
        <button v-if="canMergeSelected" class="lc-menu-item" role="menuitem" @click="mergeFromContext">
          <svg class="lc-ic s" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.merge" />
          {{ t('canvas.ctx.merge') }}
        </button>
        <button v-if="selectedInGroup >= 1" class="lc-menu-item" role="menuitem" @click="releaseFromContext">
          <svg class="lc-ic s" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.release" />
          {{ t('canvas.ctx.release', { n: selectedInGroup }) }}
        </button>
        <hr />
      </template>
      <!-- 右键一个组：只出跟「组」有关的动作，复制 / 删除节点对组没意义 -->
      <template v-if="contextIsFrame">
        <button v-if="canMergeSelected" class="lc-menu-item" role="menuitem" @click="mergeFromContext">
          <svg class="lc-ic s" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.merge" />
          {{ t('canvas.ctx.merge') }}
        </button>
        <button class="lc-menu-item" role="menuitem" @click="ungroupFromContext">
          <svg class="lc-ic s" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.ungroup" />
          {{ t('canvas.ctx.ungroup') }}
        </button>
        <button v-if="selectedInGroup >= 1" class="lc-menu-item" role="menuitem" @click="releaseFromContext">
          <svg class="lc-ic s" viewBox="0 0 24 24" aria-hidden="true" v-html="MENU_ICONS.release" />
          {{ t('canvas.ctx.release', { n: selectedInGroup }) }}
        </button>
        <button class="lc-menu-item danger" role="menuitem" @click="deleteGroupFromContext">
          <LcIcon name="trash" size="s" />
          {{ t('canvas.ctx.deleteGroup') }}
        </button>
      </template>
      <button v-if="!contextNodeInfo && contextImageUrl && feat.imageEditor" class="lc-menu-item" role="menuitem" @click="editImageFromContext">
        <LcIcon name="edit" size="s" />
        {{ t('canvas.ctx.editImage') }}
      </button>
      <button v-if="!contextIsFrame" class="lc-menu-item" role="menuitem" @click="duplicateFromContext">
        <LcIcon name="copy" size="s" />
        {{ t('canvas.ctx.duplicate') }}
      </button>
      <button v-if="!contextIsFrame" class="lc-menu-item danger" role="menuitem" @click="deleteFromContext">
        <LcIcon name="trash" size="s" />
        {{ t('canvas.ctx.deleteNode') }}
      </button>
    </div>

    <!-- 画布空白处右键：添加节点菜单（在光标位置弹出） -->
    <div
      v-if="addMenu.open"
      class="ed-menu lc-menu"
      role="menu"
      :style="{ left: addMenu.x + 'px', top: addMenu.y + 'px', maxHeight: `calc(calc(100 * var(--lc-vh)) - ${addMenu.y}px - 16px)` }"
      @click.stop
    >
      <!-- 导航（沉浸式 / 我的画布 / 使用教程）永远置顶 -->
      <template v-if="navMenuGroup">
        <div class="ed-grid">
          <button v-for="item in navMenuGroup.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :title="item.label" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
            <LcIcon v-if="item.lc" :name="item.lc" />
            <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
        <hr />
      </template>
      <!-- 有选中节点：把「针对选中」的操作摆在添加节点上面 -->
      <template v-if="hasSelectionForMenu">
        <template v-for="(grp, gi) in otherMenuGroups" :key="'sel-' + gi">
          <hr v-if="gi > 0" />
          <div v-if="grp.title" class="ed-sub">{{ grp.title }}</div>
          <div class="ed-grid">
            <button v-for="item in grp.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :title="item.label" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
              <LcIcon v-if="item.lc" :name="item.lc" />
              <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </template>
        <hr />
      </template>
      <div class="ed-menu-title">{{ t('canvas.addPanel.title') }}</div>
      <template v-for="(group, gi) in nodeMenuGroups" :key="gi">
        <hr v-if="gi > 0" />
        <div class="ed-sub">{{ group.title }}</div>
        <div class="ed-grid">
          <button v-for="item in group.items" :key="item.kind" class="ed-item" role="menuitem" :title="item.label" :data-key="item.kind" @click="addNodeFromMenu(item.kind)">
            <svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </template>
      <template v-if="!hasSelectionForMenu">
        <template v-for="(grp, gi) in otherMenuGroups" :key="'cg-' + gi">
          <hr />
          <div v-if="grp.title" class="ed-sub">{{ grp.title }}</div>
          <div class="ed-grid">
            <button v-for="item in grp.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :title="item.label" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
              <LcIcon v-if="item.lc" :name="item.lc" />
              <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
              <span>{{ item.label }}</span>
            </button>
          </div>
        </template>
      </template>
    </div>

    <!-- 面板上「更多」的菜单：内容与右键菜单的「画布操作」部分完全同源 -->
    <div
      v-if="moreMenu.open"
      ref="moreRef"
      class="ed-menu ed-more lc-menu"
      role="menu"
      :style="{ left: moreMenu.x + 'px', top: moreMenu.y + 'px', maxHeight: moreMenu.maxH + 'px' }"
      @click.stop
    >
      <template v-for="(grp, gi) in canvasMenuGroups" :key="'mg-' + gi">
        <hr v-if="gi > 0" />
        <div v-if="grp.title" class="ed-sub">{{ grp.title }}</div>
        <div class="ed-grid">
          <button v-for="item in grp.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :title="item.label" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
            <LcIcon v-if="item.lc" :name="item.lc" />
            <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
            <span>{{ item.label }}</span>
          </button>
        </div>
      </template>
    </div>

    <!-- 画布外观面板（贴着菜单弹出） -->
    <CanvasStylePanel
      v-if="feat.canvasStyle"
      :open="stylePanelOpen"
      :bg="bgSettings"
      :x="stylePanelPos.x"
      :y="stylePanelPos.y"
      @update:bg="onBgChange"
      @close="stylePanelOpen = false"
    />

    <!-- 批量下载 -->
    <BatchDownloadDialog
      v-if="feat.batchDownload"
      :open="batchOpen"
      :nodes="nodes"
      :edges="edges"
      :workflow-id="currentId || ''"
      :workflow-name="workflowName"
      @close="batchOpen = false"
    />

    <!-- 单图编辑器（裁剪 / 旋转） -->
    <ImageEditorModal
      v-if="feat.imageEditor"
      :open="editorState.open"
      :url="editorState.url"
      @close="closeEditor(null)"
      @done="onEditorDone"
    />

    <!-- 节点搜索：Ctrl+F -->
    <div v-if="searchOpen" class="fl nsearch" @click.stop @mousedown.stop>
      <label class="lc-inp sm nsearch-bar">
        <LcIcon name="search" size="s" />
        <input
          ref="searchInputRef"
          v-model="searchKw"
          :placeholder="t('canvas.search.placeholder')"
          @keydown.escape="searchOpen = false"
        />
        <button class="lc-inp-btn" :title="t('common.close')" :aria-label="t('common.close')" @click="searchOpen = false"><LcIcon name="x" size="s" /></button>
      </label>
      <div v-if="searchKw && !searchResults.length" class="nsearch-empty">{{ t('canvas.search.empty') }}</div>
      <div v-else-if="searchResults.length" class="nsearch-list">
        <button v-for="r in searchResults" :key="r.id" class="nsearch-item" @click="gotoNode(r.id)">
          <span class="lc-chip">{{ r.type }}</span>
          <span class="nsearch-b">{{ r.brief || t('canvas.search.noContent') }}</span>
        </button>
      </div>
    </div>

    <!-- 在画布里新建 / 编辑品牌包：和素材库「品牌包」页是同一个表单，不用离开画布 -->
    <BrandKitEditorDialog
      v-if="feat.brandKit"
      :open="kitEditor.open"
      :kit="kitEditor.kit"
      @close="kitEditor.open = false"
      @saved="onKitSaved"
      @removed="onKitRemoved"
    />

    <BatchRunDialog v-if="feat.batchRun" :batch="batch" />

    <!-- 素材选择器（挂在根，inject 调用） -->
    <AssetPicker v-if="feat.assetLibrary" ref="pickerRef" />

    <!-- 全局 hover 大图预览（节点里的图片共用这一份，teleport 到 body） -->
    <ImageHoverPreview />

    <!-- 右键菜单触发的「查看原图/原视频」与「任务详情」（挂在根，全画布共用一份） -->
    <MediaLightbox :open="lightbox.open" :url="lightbox.url" :type="lightbox.type" @close="lightbox.open = false" />
    <TaskDetailModal :open="detailModal.open" :type="detailModal.type" :data="detailModal.data" @close="detailModal.open = false" />
  </div>
</template>

<script setup lang="ts">
import { lcLocal } from '@/utils/storage'
import { ref, computed, onMounted, onBeforeUnmount, provide, watch, markRaw, type Ref, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'
// SelectionMode.Partial：框选判定放宽成「碰到就算」。vue-flow 默认的 Full 要求
// 节点被完整框住，压到一半不算选中 —— 用户会以为框选坏了。同类画布工具普遍用 Partial。
import { VueFlow, useVueFlow, SelectionMode, type Node, type Edge, type Connection, addEdge } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { MiniMap } from '@vue-flow/minimap'
import { MessagePlugin, DialogPlugin } from '@/utils/feedback'

import TextNode from '@/components/canvas/TextNode.vue'
import ImageNode from '@/components/canvas/ImageNode.vue'
import VideoNode from '@/components/canvas/VideoNode.vue'
import ImageCollectionNode from '@/components/canvas/ImageCollectionNode.vue'
import GenNode from '@/components/canvas/gen/GenNode.vue'
import GenComposer from '@/components/canvas/gen/GenComposer.vue'
import GenInspector from '@/components/canvas/gen/GenInspector.vue'
import '@/components/canvas/gen/gen.css'
import {
  CANVAS_NODE_UI_KEY, GEN_NODE_SIZE, INSPECTOR_GAP, INSPECTOR_WIDTH, NODE_LAYOUTS, genNodeSize, isGenNodeKind, normalizeNodeLayout,
  type GenNodeKind, type NodeLayout,
} from '@/composables/nodeLayout'
import OutputNode from '@/components/canvas/OutputNode.vue'
import GlowEdge from '@/components/canvas/GlowEdge.vue'
import QueuePanel from '@/components/canvas/QueuePanel.vue'
import LcIcon from '@/components/LcIcon.vue'
import AssetPicker from '@/components/canvas/AssetPicker.vue'
import ImageHoverPreview from '@/components/canvas/ImageHoverPreview.vue'
import LibraryDialog from '@/components/canvas/LibraryDialog.vue'
import CanvasTemplateDialog from '@/components/canvas/CanvasTemplateDialog.vue'
import MediaLightbox from '@/components/canvas/MediaLightbox.vue'
import TaskDetailModal from '@/components/canvas/TaskDetailModal.vue'
import CanvasStylePanel from '@/components/canvas/CanvasStylePanel.vue'
import BatchDownloadDialog from '@/components/canvas/BatchDownloadDialog.vue'
import BatchRunDialog from '@/components/canvas/BatchRunDialog.vue'
import ImageEditorModal from '@/components/canvas/ImageEditorModal.vue'

import { workflowApi, canvasShareApi, userAssetApi, apiErrorMessage } from '@/utils/canvasBackend'
import { uploadCanvasImage, uploadCanvasVideo } from '@/utils/canvasUpload'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { useAppStore } from '@/stores/app'
import { useEmbed } from '@/embed/context'
import { isPageAllowed, resolveNodeTypes } from '@/embed/options'
import { CANVAS_SCHEMA_VERSION, type CanvasDocument } from '@/embed/document'
import { backend, shareLinkFor } from '@/utils/canvasBackend'
import { frameOf, ownsKeyEvent } from '@/utils/frame'
import { useCanvasExecutor } from '@/composables/useCanvasExecutor'
import { confirmRerun } from '@/composables/useRerunConfirm'
import { CANVAS_EXECUTOR_KEY } from '@/composables/canvasExecutorKey'
import { CANVAS_PICKER_KEY, type PickerOptions, type PickerItem } from '@/composables/canvasPickerKey'
import { useTokenColor } from '@/utils/tokenColor'
import { resolvedTheme } from '@/composables/useTheme'
import {
  isFramesModeData, listAdapters, modelsLoaded, isModelSupported, defaultModelId, defaultVideoEditModelId,
} from '@/utils/canvasModels'
import { useAutoLayout, estimateNodeSize, LAYOUT_CONFIRM_THRESHOLD, type AlignMode, type DistributeAxis } from '@/composables/useAutoLayout'
import { useCanvasHistory } from '@/composables/useCanvasHistory'
import { usePaletteDock } from '@/composables/usePaletteDock'
import { clampNum, type Rect } from '@/utils/floatSpot'
import { useCanvasBatch } from '@/composables/useCanvasBatch'
import { migrateDocument } from '@/embed/document'
import { useBrandKits, resolveNodeKit, KIT_NONE, BRAND_KIT_NODE_TYPES, type BrandKit } from '@/composables/useBrandKits'
import { CANVAS_BRAND_KIT_KEY } from '@/composables/canvasBrandKitKey'
import CanvasBrandKitChip from '@/components/canvas/CanvasBrandKitChip.vue'
import BrandKitEditorDialog from '@/components/brandkit/BrandKitEditorDialog.vue'
import PlatformExportNode from '@/components/canvas/PlatformExportNode.vue'
import SliceNode from '@/components/canvas/SliceNode.vue'
import CollageNode from '@/components/canvas/CollageNode.vue'
import WatermarkNode from '@/components/canvas/WatermarkNode.vue'
import FitSizeNode from '@/components/canvas/FitSizeNode.vue'
import FrameNode from '@/components/canvas/FrameNode.vue'
import CanvasGuide from '@/components/canvas/CanvasGuide.vue'
import {
  planFrame, releaseFrame, planMerge, planRelease, frameNodeFrom, matchNode,
} from '@/composables/useCanvasFrame'
import {
  DEFAULT_CANVAS_BG, normalizeCanvasBg, patternColorFor, hexToRgba,
  miniNodeColorFor, miniStrokeColorFor, groundToneFor,
  type CanvasBgSettings,
} from '@/utils/canvasBg'
import { CANVAS_IMAGE_EDITOR_KEY, type ImageEditorResult } from '@/composables/canvasImageEditorKey'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@/styles/vue-flow-theme.css'

/**
 * vue-flow 的 Background / MiniMap 把颜色当 SVG attribute 传，attribute 不解析
 * var()，所以这里读 token 的计算值，而不是直接写 var(--flow-dot)。
 */
const vfPattern = useTokenColor('--flow-dot')
const vfMiniMask = useTokenColor('--mini-mask')
const vfMiniStroke = useTokenColor('--mini-stroke')
const vfMiniNode = useTokenColor('--mini-node')

type NodeKind = 'text' | 'image' | 'video' | 'image-collection' | 'image-gen' | 'image-edit' | 'video-gen' | 'video-edit' | 'video-analysis' | 'llm' | 'output' | 'platform-export' | 'slice' | 'collage' | 'watermark' | 'fit-size' | 'frame'
type DataType = 'text' | 'image' | 'video'

interface Viewport { x: number; y: number; zoom: number }

const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const { t, locale } = useI18n()

/* ==================== 这张画布是怎么挂上来的 ==================== */
/**
 * 三种挂法（embed/context.ts）：独立应用、整站嵌入、只嵌编辑器。
 * 只嵌编辑器（host 不为空）时没有列表页、没有路由里的画布 id：开哪张画布、能不能改、用哪种布局都是宿主给的。
 * feat 是这一次挂载开着的功能；关掉的功能，它的按钮、菜单项、弹窗在下面统一不出。
 */
const embed = useEmbed()
const host = embed.editor
const feat = embed.features
const readOnly = computed(() => !!host?.readOnly.value)
/** 同一页上可能有不止一个编辑器：DOM id、SVG 渐变 id 都带上它 */
const uid = 'lc' + Math.random().toString(36).slice(2, 8)
/** 现在该显示哪张画布：路由里的 id，或者宿主给的 */
const wantedCanvasId = computed(() => (host ? host.canvasId.value : (typeof route.params.id === 'string' ? route.params.id : '')))
/** 有没有「返回」可去：只嵌编辑器看宿主给没给 onBack；否则看画布列表页开没开放 */
const canGoBack = computed(() => (host ? feat.backButton && !!host.onBack : isPageAllowed(embed.pages, 'canvases')))
/** 能加哪些节点：宿主点名的那些，再去掉当前后端跑不了的（没有图片工具接口就没有工具节点） */
const offeredKinds = computed(() => new Set<string>(host ? host.nodeTypes.value : resolveNodeTypes(undefined, embed.embedded ? backend() : null)))
/** fixed 浮层的「画框」：独立应用里是视口，嵌入时是本产品的根元素（utils/frame.ts） */
const frame = () => frameOf(edRef.value)

// 模型清单拉回来之后，一个可用的图片 / 视频模型都没有 → 顶栏下方挂一条提示。
// 没拉完之前不显示，免得每次进画布都闪一下。
const noModels = computed(() => modelsLoaded() && listAdapters().length === 0)

const nodeTypes = {
  'text': markRaw(TextNode),
  'image': markRaw(ImageNode),
  'video': markRaw(VideoNode),
  'image-collection': markRaw(ImageCollectionNode),
  // 六种生成节点是同一个组件：状态共用一份（useGenNode），按账号选的布局换外壳
  'image-gen': markRaw(GenNode),
  'image-edit': markRaw(GenNode),
  'video-gen': markRaw(GenNode),
  'video-edit': markRaw(GenNode),
  'video-analysis': markRaw(GenNode),
  'llm': markRaw(GenNode),
  'output': markRaw(OutputNode),
  'platform-export': markRaw(PlatformExportNode),
  'slice': markRaw(SliceNode),
  'collage': markRaw(CollageNode),
  'watermark': markRaw(WatermarkNode),
  'fit-size': markRaw(FitSizeNode),
  'frame': markRaw(FrameNode),
} as any

const edgeTypes = {
  'glow': markRaw(GlowEdge),
} as any

const MULTI_IMAGE_IN_NODE_TYPES = new Set([
  'image-collection',
  'image-gen',
  'image-edit',
  'video-gen',
  'video-edit',
  'video-analysis', // 视频分析参考图 image-in 允许接多个（最多 5 张）
  'llm', // 大语言模型参考图 image-in 允许接多个（最多 5 张）
  'output', // 成品节点 image-in 允许接多个
  'platform-export', // 只用第一张，但允许接多条免得连错线就报错
  'collage', // 拼图就是要收多张
])

// 写成 `ref([]) as Ref<T[]>` 而不是 `ref<T[]>([])`：vue-flow 的 Node/Edge 与 GraphNode
// 互相引用，走 ref 的 UnwrapRef 展开会递归到「Type instantiation is excessively deep」
// (TS2589)。cast 掉展开这一步，类型结果一致，运行时不变。
const nodes = ref([]) as Ref<Node[]>
const edges = ref([]) as Ref<Edge[]>
const viewport = ref<Viewport>({ x: 0, y: 0, zoom: 1 })
const MIN_ZOOM = 0.2
const MAX_ZOOM = 4
const zoomPct = computed(() => Math.round((viewport.value.zoom || 1) * 100))

const {
  updateNodeData, updateNode, removeNodes, setViewport, screenToFlowCoordinate, getNodes,
  onNodesInitialized, zoomIn, zoomOut, zoomTo, findNode,
  // 快捷键要用：Delete 删所选、Ctrl+A 全选
  getSelectedNodes, getSelectedEdges, addSelectedNodes, removeSelectedNodes,
  onNodeClick,
} = useVueFlow()

/* ==================== 生成节点的布局 ==================== */
/**
 * 三种布局选哪种是账号的偏好（设置 → 外观，或「更多」菜单里直接切），存在服务端，换浏览器也跟着走。
 * 这里只读它；节点、输入条、属性面板都从 CANVAS_NODE_UI_KEY 拿。
 */
const nodeLayout = computed<NodeLayout>(() => normalizeNodeLayout(appStore.nodeLayout))

/** 只选中了一个节点、而且是生成节点：它就是面板要编辑的那一个。多选、没选都不出面板 */
const soleGenNode = computed<{ id: string; kind: GenNodeKind } | null>(() => {
  const sel = getSelectedNodes.value
  if (sel.length !== 1 || !isGenNodeKind(sel[0].type)) return null
  return { id: sel[0].id, kind: sel[0].type }
})
/** 用户按 Esc / 点关闭收起了哪个节点的面板；选中别的节点、或再点一下这个节点就恢复 */
const panelDismissedId = ref('')
const panelNode = computed(() => {
  const n = soleGenNode.value
  return n && n.id !== panelDismissedId.value && nodeLayout.value !== 'c' ? n : null
})
watch(() => soleGenNode.value?.id || '', (id) => { if (id !== panelDismissedId.value) panelDismissedId.value = '' })
onNodeClick(({ node }) => { if (node.id === panelDismissedId.value) panelDismissedId.value = '' })
function closeGenPanel() {
  if (soleGenNode.value) panelDismissedId.value = soleGenNode.value.id
}
const genPanelRef = ref<{ focusPrompt: () => boolean; run: () => void } | null>(null)
/** 属性面板开着时占掉的右侧宽度；「适应屏幕」、新节点落点、队列圆钮都要让出来。手机上面板是底部抽屉，不占宽度 */
const paneWidth = ref(1200)
const inspectorInset = computed(() => (nodeLayout.value === 'b' && panelNode.value && paneWidth.value > 640 ? INSPECTOR_WIDTH + INSPECTOR_GAP : 0))

// 布局 c：节点把「聚焦自己的提示词框」登记上来
const promptFocusers = new Map<string, () => void>()
provide(CANVAS_NODE_UI_KEY, {
  layout: nodeLayout,
  registerPromptFocus: (id, fn) => { if (fn) promptFocusers.set(id, fn); else promptFocusers.delete(id) },
})
/** 画布上选中一个生成节点后直接打字：焦点落进它的提示词框（a 输入条 / b 属性面板 / c 节点里） */
function focusGenPrompt(): boolean {
  const n = soleGenNode.value
  if (!n) return false
  if (nodeLayout.value === 'c') {
    const fn = promptFocusers.get(n.id)
    if (!fn) return false
    fn()
    return true
  }
  if (!panelNode.value) {
    // 面板被收起了：先打开，这一键只负责唤出它
    panelDismissedId.value = ''
    void nextTick(() => genPanelRef.value?.focusPrompt())
    return false
  }
  return genPanelRef.value?.focusPrompt() || false
}

/**
 * 某个节点的实测宽高。生成节点量到的宽度和当前布局对不上，说明那是在另一种布局下量的
 * （节点在视野外没重画，或尺寸是跟着画布存下来的）—— 当作没量过，交给按布局估的那张表。
 */
function measuredSize(id: string): { width: number; height: number } | null {
  const n = findNode(id)
  const d = n?.dimensions
  if (!n || !d?.width || !d?.height) return null
  if (isGenNodeKind(n.type) && Math.abs(d.width - GEN_NODE_SIZE[nodeLayout.value].media.w) > 2) return null
  return d
}

/* ==================== 品牌包 ==================== */
// 品牌包按画布选：canvasKitId 跟着画布文档存（顶栏那颗 chip 改的就是它），这张画布上的
// 生成节点都用它；节点只在例外时自己存一个 brandKitOverride。列表在画布挂载时拉一次放内存，
// 存的都是 id，运行时查回来 —— 查不到（被删了）就当没有，见 resolveNodeKit。
const brandKits = useBrandKits()
const canvasKitId = ref('')
const resolveKit = (nodeData: any) => resolveNodeKit(brandKits.kits.value, canvasKitId.value, nodeData)
/** 改一个节点的例外：'' = 跟随画布（把字段删掉，而不是存一个空串） */
function setNodeKitOverride(nodeId: string, value: string) {
  const n = nodes.value.find((x) => x.id === nodeId)
  if (!n || (n.data?.brandKitOverride || '') === value) return
  hist.record()
  const { brandKitOverride: _drop, ...rest } = n.data || {}
  updateNode(nodeId, { data: value ? { ...rest, brandKitOverride: value } : rest })
}
provide(CANVAS_BRAND_KIT_KEY, {
  list: brandKits.kits,
  canvasKitId,
  resolve: resolveKit,
  setNodeOverride: setNodeKitOverride,
})
/** 有几个生成节点没跟随画布 */
const kitExceptionCount = computed(() =>
  nodes.value.filter((n) => BRAND_KIT_NODE_TYPES.includes(n.type as string) && n.data?.brandKitOverride).length)

// 新建 / 编辑品牌包的弹窗（kit 为 null = 新建）
const kitEditor = ref<{ open: boolean; kit: BrandKit | null }>({ open: false, kit: null })
function openKitEditor(kit: BrandKit | null) {
  kitEditor.value = { open: true, kit }
}
async function onKitSaved(kit: BrandKit, created: boolean) {
  kitEditor.value.open = false
  await brandKits.load(true)
  // 在这张画布里新建的，多半就是要给这张画布用
  if (created) canvasKitId.value = kit.id
}
function onKitRemoved() {
  kitEditor.value.open = false
  void brandKits.load(true)
}

/**
 * 执行器改节点状态都经过这里：状态一变就告诉宿主（run:started / run:finished / run:failed / result）。
 * 独立应用里 embed.emit 是个空函数。
 */
function updateNodeDataTracked(id: string, patch: Record<string, any>) {
  const before = findNode(id)?.data?.status
  updateNodeData(id, patch)
  const status = patch?.status
  if (!status || status === before) return
  const node = findNode(id)
  const d: any = node?.data || {}
  const base = {
    canvasId: currentId.value || '',
    nodeId: id,
    nodeType: String(node?.type || ''),
    runIds: [...new Set([d.taskId, ...(Array.isArray(d.taskIds) ? d.taskIds : [])].filter((x) => typeof x === 'string' && x))] as string[],
  }
  if (status === 'running') embed.emit('run:started', base)
  else if (status === 'error') embed.emit('run:failed', { ...base, error: String(d.errorMsg || '') })
  else if (status === 'done') {
    embed.emit('run:finished', base)
    const outputs: { type: 'image' | 'video'; url: string }[] = []
    const imgs: string[] = Array.isArray(d.imageUrls) && d.imageUrls.length ? d.imageUrls : (d.imageUrl ? [d.imageUrl] : [])
    for (const url of imgs) if (typeof url === 'string' && url) outputs.push({ type: 'image', url })
    if (typeof d.videoUrl === 'string' && d.videoUrl) outputs.push({ type: 'video', url: d.videoUrl })
    const text = TEXT_TASK_TYPES.includes(base.nodeType) && typeof d.text === 'string' ? d.text : undefined
    embed.emit('result', { canvasId: base.canvasId, nodeId: id, nodeType: base.nodeType, outputs, ...(text !== undefined ? { text } : {}) })
  }
}

const executor = useCanvasExecutor({
  nodes, edges, updateNodeData: updateNodeDataTracked,
  getNodeBrandKit: (nodeData) => resolveKit(nodeData).kit,
  getWorkflowId: () => currentId.value,
  persist: () => doSave(true),
  confirmRerun,
})
provide(CANVAS_EXECUTOR_KEY, executor)
// 切换界面语言：后端给出的运行失败原因跟着换
watch(locale, () => { void executor.refreshRunErrors() })

/* ==================== 撤销 / 重做 ==================== */
// 约定：每个会改变画布结构的操作，动手之前先调一次 hist.record()。
// 为什么不挂 watch 自动记录，见 useCanvasHistory 顶部注释。
const hist = useCanvasHistory({ nodes, edges })

/* ==================== 批量运行 ==================== */
// 编排在 useCanvasBatch 里，这里只负责持有它 —— 与 executor 同一个模式：
// 画布持有、子组件消费，免得弹窗自己再 useVueFlow 一次拿到另一个 store。
const batch = useCanvasBatch({
  nodes,
  edges,
  updateNodeData,
  executor,
  // 整批开跑前记一笔：撤销能把变量位换回原来那张图
  beforeStart: () => hist.record(),
})

function openBatchRun() {
  batch.reset()
  // 上次选的节点可能已经被删了，兜底落到第一个「图片」节点
  if (!batch.varNodeId.value || !nodes.value.some((n) => n.id === batch.varNodeId.value)) {
    batch.varNodeId.value = batch.varCandidates.value[0]?.id || ''
  }
  batch.open.value = true
}

const pickerRef = ref<{ show: (opts: PickerOptions) => Promise<PickerItem[]> } | null>(null)
// 选择器是组件内部管开关的，外面拿不到状态；在这层包一下自己记，
// 键盘快捷键要靠它避让（选择器开着时按 Delete 不该删到后面画布上的节点）
const pickerBusy = ref(false)
provide(CANVAS_PICKER_KEY, {
  open: (opts) => {
    const p = pickerRef.value?.show(opts) || Promise.resolve([])
    pickerBusy.value = true
    return p.finally(() => { pickerBusy.value = false })
  },
})

/* ==================== 画布外观（底色 / 图案 / 密度） ==================== */
// 存在画布里（Workflow.settings.bg），跟着分享一起走；'auto' = 编辑器的默认底 + 点阵（跟主题）
const bgSettings = ref<CanvasBgSettings>({ ...DEFAULT_CANVAS_BG })
const stylePanelOpen = ref(false)
const stylePanelPos = ref({ x: 0, y: 0 })

const bgIsAuto = computed(() => bgSettings.value.color === 'auto')
// 空对象让 CSS 里 .vf-wrap.auto 的默认底继续生效，不要写成 'transparent'
const flowStyle = computed(() => (bgIsAuto.value ? {} : { background: bgSettings.value.color }))
const bgVariant = computed(() => (bgSettings.value.pattern === 'dots' ? 'dots' : 'lines'))
// 自定义底色时图案色跟着底色走（亮底加黑、暗底加白），而不是跟着主题走
const flowPatternColor = computed(() => (bgIsAuto.value ? vfPattern.value : patternColorFor(bgSettings.value.color)))
// 小地图：默认底下是设计稿那一套（令牌 --mini-*，跟主题）；自选底色时跟着底色的明暗走
const miniMaskColor = computed(() => (bgIsAuto.value ? vfMiniMask.value : hexToRgba(bgSettings.value.color, 0.7)))
const miniStrokeColor = computed(() => (bgIsAuto.value ? vfMiniStroke.value : miniStrokeColorFor(bgSettings.value.color)))
const miniNodeColor = computed(() => (bgIsAuto.value ? vfMiniNode.value : miniNodeColorFor(bgSettings.value.color)))
// 自选底色的明暗和主题相反时：直接画在底上的连线 / 组框 / 框选矩形按底色取值（见 design-tokens.css 的「画布底」）
const groundTone = computed(() => groundToneFor(bgSettings.value, resolvedTheme.value))
// 十字图案：画在 pattern 瓦片中心，瓦片边长 = gap × zoom
const crossPath = computed(() => {
  const g = Math.max(1, bgSettings.value.gap * (viewport.value.zoom || 1))
  const arm = Math.max(2, Math.min(6, g * 0.18))
  const c = g / 2
  return `M${c - arm} ${c} h${arm * 2} M${c} ${c - arm} v${arm * 2}`
})

/** 外观面板从菜单里开：贴着菜单弹出，并夹在视口内，别开到屏幕外面去 */
function openStylePanel() {
  const PANEL_W = 272
  const PANEL_H = 430
  stylePanelPos.value = {
    x: Math.max(12, Math.min(lastMenuPos.value.x, frame().w - PANEL_W - 12)),
    y: Math.max(12, Math.min(lastMenuPos.value.y, frame().h - PANEL_H - 12)),
  }
  stylePanelOpen.value = true
}
function onBgChange(v: CanvasBgSettings) {
  bgSettings.value = normalizeCanvasBg(v)
}

/* ==================== 自动整理 ==================== */
const layout = useAutoLayout({
  nodes, edges, getNodes, updateNode, fitView: fitFree,
  measure: measuredSize,
  nodeLayout: () => nodeLayout.value,
})
const layoutUndo = ref({ visible: false, text: '' })
let layoutUndoTimer: number | null = null

/** 整理后给 10 秒的反悔窗口 */
function showLayoutUndo(text: string) {
  layoutUndo.value = { visible: true, text }
  if (layoutUndoTimer) clearTimeout(layoutUndoTimer)
  layoutUndoTimer = window.setTimeout(() => {
    layoutUndo.value = { visible: false, text: '' }
    layoutUndoTimer = null
  }, 10000)
}
function hideLayoutUndo() {
  if (layoutUndoTimer) { clearTimeout(layoutUndoTimer); layoutUndoTimer = null }
  layoutUndo.value = { visible: false, text: '' }
}
async function undoLayout() {
  hideLayoutUndo()
  const ok = await layout.undo()
  if (!ok) return
  // 整理自带的位置撤销有动画，走它；但画布已经回到 hist.record() 时的样子了，
  // 栈顶那条就成了原地踏步的一格 —— 丢掉，否则第一次 Ctrl+Z 看着像没反应
  hist.drop()
  MessagePlugin.success(t('canvas.layout.restored'))
}

/** 大画布先确认：一次动几百个节点的位置，误点的代价太大 */
function confirmBigLayout(count: number): Promise<boolean> {
  return new Promise((resolve) => {
    const dlg = DialogPlugin.confirm({
      header: t('canvas.layout.bigTitle'),
      body: t('canvas.layout.bigBody', { n: count }),
      confirmBtn: t('canvas.layout.bigConfirm'),
      cancelBtn: t('common.cancel'),
      onConfirm: () => { dlg.destroy(); resolve(true) },
      onCancel: () => { dlg.destroy(); resolve(false) },
    })
  })
}

// 这几个都是「先记一笔，没真动就把那笔丢掉」——
// layout.* 返回 false 表示条件不满足什么也没做，留着空历史格会让 Ctrl+Z 空按一次
async function runArrange() {
  if (nodes.value.length < 2) { MessagePlugin.info(t('canvas.layout.needTwo')); return }
  if (nodes.value.length > LAYOUT_CONFIRM_THRESHOLD && !(await confirmBigLayout(nodes.value.length))) return
  hist.record()
  layoutNote.value = { visible: false, text: '' }
  arrangedLayout.value = nodeLayout.value
  if (await layout.arrange()) showLayoutUndo(t('canvas.layout.arranged'))
  else hist.drop()
}
async function runSnapToGrid() {
  hist.record()
  if (await layout.snapToGrid()) showLayoutUndo(t('canvas.layout.snapped'))
  else { hist.drop(); MessagePlugin.info(t('canvas.layout.alreadySnapped')) }
}
async function runAlign(mode: AlignMode) {
  hist.record()
  if (await layout.alignSelected(mode)) showLayoutUndo(t('canvas.layout.aligned'))
  else { hist.drop(); MessagePlugin.info(t('canvas.layout.alignNeedTwo')) }
}
async function runDistribute(axis: DistributeAxis) {
  hist.record()
  if (await layout.distributeSelected(axis)) showLayoutUndo(t('canvas.layout.distributed'))
  else { hist.drop(); MessagePlugin.info(t('canvas.layout.distributeNeedThree')) }
}

/* ==================== 换节点布局 ==================== */
const LAYOUT_ICONS: Record<NodeLayout, string> = {
  a: '<rect x="5" y="3" width="14" height="12" rx="2"/><rect x="3" y="18" width="18" height="3.5" rx="1.75"/>',
  b: '<rect x="3" y="7" width="9" height="10" rx="2"/><rect x="15" y="3" width="6" height="18" rx="2"/>',
  c: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M5 11h14M8 15h8M8 18h4"/>',
}
async function pickNodeLayout(v: NodeLayout) {
  if (v === nodeLayout.value) return
  try {
    await appStore.setNodeLayout(v)
  } catch (err) {
    MessagePlugin.error(apiErrorMessage(err, t('settings.appearance.nodeLayoutFailed')))
  }
}

/**
 * 这张画布上的节点是在哪种布局下排的（跟着画布存在 settings.nodeLayout 里；老画布没有，是空串）。
 * 换布局会改变节点的大小，但位置是用户排的、跟着画布存的 —— 绝不因为换了偏好就悄悄挪节点。
 * 只在真的有节点互相压住时出一条提示，点「自动整理」才动（和工具条上那个是同一个，可以撤销）。
 */
const arrangedLayout = ref<NodeLayout | ''>('')
const layoutNote = ref({ visible: false, text: '' })
function dismissLayoutNote() {
  layoutNote.value = { visible: false, text: '' }
  // 看过了：这张画布就算是在当前布局下排的，下次打开不再提（跟着画布存下去）
  arrangedLayout.value = nodeLayout.value
  scheduleAutoSave()
}
async function arrangeFromNote() {
  dismissLayoutNote()
  await runArrange()
}
/** 等视野里的生成节点按新布局重新量完（宽度对上了就算），最多等 timeout 毫秒 */
function waitForRelayout(timeout = 800): Promise<void> {
  const started = Date.now()
  const want = () => GEN_NODE_SIZE[nodeLayout.value].media.w
  return new Promise((resolve) => {
    const tick = () => {
      const pending = getNodes.value.some((n: any) => isGenNodeKind(n.type) && Math.abs((n.dimensions?.width || 0) - want()) > 2)
      if (!pending || Date.now() - started > timeout) resolve()
      else window.setTimeout(tick, 50)
    }
    window.setTimeout(tick, 50)
  })
}
let layoutCheckSeq = 0
/** kind: switch = 刚换了布局；open = 打开了一张在别的布局下排的画布 */
async function checkLayoutFit(kind: 'switch' | 'open') {
  const id = currentId.value
  const seq = ++layoutCheckSeq
  layoutNote.value = { visible: false, text: '' }
  if (!id) return
  if (kind === 'open' && arrangedLayout.value === nodeLayout.value) return
  if (nodes.value.length < 2) { arrangedLayout.value = nodeLayout.value; return }
  if (kind === 'open') await waitForMeasured()
  else { await nextTick(); await waitForRelayout() }
  if (seq !== layoutCheckSeq || currentId.value !== id) return
  if (layout.hasOverlap()) {
    layoutNote.value = { visible: true, text: t(kind === 'switch' ? 'canvas.nodeLayout.overlapSwitched' : 'canvas.nodeLayout.overlapOpened') }
  } else {
    arrangedLayout.value = nodeLayout.value
    if (kind === 'switch') MessagePlugin.success(t('canvas.nodeLayout.switched', { name: t(`canvas.nodeLayout.${nodeLayout.value}`) }))
  }
}
watch(nodeLayout, () => {
  panelDismissedId.value = ''
  if (!loading.value) void checkLayoutFit('switch')
})

/* ==================== 画布操作菜单（右键菜单 与 顶栏「更多」共用一份） ==================== */
// 图标只存 <svg> 内部的那段，跟 nodeMenuGroups 一样走 v-html 渲染
const MENU_ICONS = {
  arrange:  '<path d="M4 6h5M4 12h5M4 18h5"/><path d="M13 12h7"/><path d="M17 9l3 3-3 3"/>',
  grid:     '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
  alignL:   '<path d="M4 3v18"/><rect x="8" y="6" width="9" height="4" rx="1"/><rect x="8" y="14" width="13" height="4" rx="1"/>',
  alignC:   '<path d="M12 3v18"/><rect x="6" y="6" width="12" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/>',
  alignT:   '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="9" rx="1"/><rect x="14" y="8" width="4" height="13" rx="1"/>',
  distH:    '<path d="M4 3v18M20 3v18"/><rect x="10" y="8" width="4" height="8" rx="1"/>',
  distV:    '<path d="M3 4h18M3 20h18"/><rect x="8" y="10" width="8" height="4" rx="1"/>',
  style:    '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  enterFull:'<polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>',
  exitFull: '<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>',
  back:     '<polyline points="15 18 9 12 15 6"/>',
  switchp:  '<path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  loadp:    '<line x1="12" y1="3" x2="12" y2="15"/><polyline points="7 10 12 15 17 10"/><path d="M4 20h16"/>',
  guide:    '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4"/><line x1="12" y1="17" x2="12" y2="17.01"/>',
  batch:    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M17.5 14v7M14 17.5h7"/>',
  frame:    '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M3 9h18"/>',
  merge:    '<rect x="3" y="4" width="7" height="7" rx="1.5"/><rect x="3" y="13" width="7" height="7" rx="1.5"/><path d="M10 7.5h5a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-5"/><polyline points="18 10 21 12 18 14"/>',
  ungroup:  '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>',
  release:  '<rect x="3" y="5" width="12" height="14" rx="2"/><polyline points="17 9 21 12 17 15"/><line x1="12" y1="12" x2="21" y2="12"/>',
  search:   '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
}

interface CanvasMenuItem {
  key: string
  label: string
  /** <svg> 内部的那段（v-html 渲染）；和 lc 二选一 */
  icon?: string
  /** LcIcon 的图标名 */
  lc?: string
  disabled?: boolean
  /** 单选项里当前选中的那一个（节点布局） */
  active?: boolean
  run: () => void
}

// 右上「更多」和空白处右键弹的是同一份数据，改一处两处都变
/** 「圈成一组」：右键菜单、「更多」和左侧面板的工具类里是同一项 */
const frameMenuItem = computed<CanvasMenuItem>(() => {
  const sel = layout.selectedCount.value
  return {
    key: 'frame',
    label: sel >= 1 ? t('canvas.menu.frame') : t('canvas.menu.frameHint'),
    icon: MENU_ICONS.frame,
    disabled: layout.running.value || sel < 1,
    run: groupIntoFrame,
  }
})

/** 素材库那一组入口：工具面板上那颗素材按钮、「更多」菜单共用 */
const libraryMenuItems = computed<CanvasMenuItem[]>(() => ([
  { key: 'library', label: t('canvas.rail.library'), lc: 'folder', run: openLibrary },
  { key: 'templates', label: t('canvas.rail.templates'), lc: 'layout', run: openTemplates },
  { key: 'my-shares', label: t('canvas.rail.myShares'), lc: 'share', run: goToMyShares },
] as CanvasMenuItem[]).filter((i) => (i.key === 'library' ? feat.assetLibrary : i.key === 'templates' ? feat.templates : feat.share)))

/** 菜单项对应哪个功能开关；关掉的功能整项不出（没列在这里的项不受开关管） */
const MENU_ITEM_FEATURE: Record<string, () => boolean> = {
  immersive: () => feat.immersive,
  list: () => canGoBack.value,
  'switch-proj': () => feat.canvasSwitch && !host,
  'load-proj': () => feat.canvasSwitch,
  guide: () => feat.guide,
  shortcuts: () => feat.guide,
  'batch-run': () => feat.batchRun,
  style: () => feat.canvasStyle,
  download: () => feat.batchDownload,
  search: () => feat.search,
}
function offeredMenu(groups: { title: string; items: CanvasMenuItem[] }[]) {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => (MENU_ITEM_FEATURE[i.key] ? MENU_ITEM_FEATURE[i.key]() : !i.key.startsWith('node-layout-') || feat.nodeLayoutSwitch)) }))
    .filter((g) => g.items.length)
}

const canvasMenuGroups = computed<{ title: string; items: CanvasMenuItem[] }[]>(() => {
  const sel = layout.selectedCount.value
  const busy = layout.running.value
  const groups: { title: string; items: CanvasMenuItem[] }[] = []

  // 导航：退出沉浸式 / 我的画布 —— 放菜单最前面，最常用
  groups.push({
    title: '',
    items: [
      {
        key: 'immersive',
        label: appStore.immersive ? t('canvas.menu.exitImmersive') : t('canvas.menu.enterImmersive'),
        icon: appStore.immersive ? MENU_ICONS.exitFull : MENU_ICONS.enterFull,
        run: () => appStore.toggleImmersive(),
      },
      { key: 'list', label: t('canvas.menu.myCanvases'), icon: MENU_ICONS.back, run: goToList },
      { key: 'switch-proj', label: t('canvas.rail.switchProject'), icon: MENU_ICONS.switchp, run: () => { closeContextMenu(); toggleProjMenu() } },
      { key: 'load-proj', label: t('canvas.menu.loadOther'), icon: MENU_ICONS.loadp, run: () => { closeContextMenu(); openImportPicker() } },
      { key: 'guide', label: t('canvas.topbar.guide'), lc: 'book', run: () => openGuide('') },
      { key: 'shortcuts', label: t('canvas.menu.shortcuts'), lc: 'key', run: () => openGuide('keys') },
    ],
  })

  groups.push({
    title: t('canvas.menu.groupArrange'),
    items: [
      { key: 'arrange', label: t('canvas.menu.arrange'), icon: MENU_ICONS.arrange, disabled: busy || nodes.value.length < 2, run: runArrange },
      { key: 'grid', label: t('canvas.menu.snapGrid'), icon: MENU_ICONS.grid, disabled: busy || nodes.value.length < 1, run: runSnapToGrid },
    ],
  })

  // 对齐 / 分布只在真的选中了东西时才出现 —— 常驻一排灰按钮只会挤长菜单
  /**
   * 「圈成画框」常显，没选中时置灰并把操作方式写进标签。
   * 之前是没选中就整条不显示 —— 用户根本不知道有这个功能，
   * 更不会知道要按 Shift 才能框选。右键看一眼就学会，比藏起来强。
   */
  {
    const items: CanvasMenuItem[] = [frameMenuItem.value]
    // 「合并」只在选中的东西里已经有组时才有意义；全是散节点用「圈成一组」就够了
    if (sel >= 2 && selectedGrouped.value >= 1) {
      items.push({
        key: 'merge', label: t('canvas.ctx.merge'), icon: MENU_ICONS.merge,
        disabled: busy, run: mergeIntoGroup,
      })
    }
    if (selectedFrames.value >= 1) {
      items.push({
        key: 'ungroup', label: t('canvas.menu.ungroupN', { n: selectedFrames.value }), icon: MENU_ICONS.ungroup,
        disabled: busy, run: ungroupSelected,
      })
    }
    if (selectedInGroup.value >= 1) {
      items.push({
        key: 'release', label: t('canvas.ctx.release', { n: selectedInGroup.value }), icon: MENU_ICONS.release,
        disabled: busy, run: releaseSelected,
      })
    }
    groups.push({ title: sel >= 1 ? t('canvas.menu.selectedN', { n: sel }) : '', items })
  }

  if (sel >= 2) {
    const items: CanvasMenuItem[] = [
      { key: 'align-left', label: t('canvas.menu.alignLeft'), icon: MENU_ICONS.alignL, disabled: busy, run: () => runAlign('left') },
      { key: 'align-hcenter', label: t('canvas.menu.alignHCenter'), icon: MENU_ICONS.alignC, disabled: busy, run: () => runAlign('hcenter') },
      { key: 'align-top', label: t('canvas.menu.alignTop'), icon: MENU_ICONS.alignT, disabled: busy, run: () => runAlign('top') },
    ]
    if (sel >= 3) {
      items.push(
        { key: 'dist-h', label: t('canvas.menu.distH'), icon: MENU_ICONS.distH, disabled: busy, run: () => runDistribute('h') },
        { key: 'dist-v', label: t('canvas.menu.distV'), icon: MENU_ICONS.distV, disabled: busy, run: () => runDistribute('v') },
      )
    }
    groups.push({ title: t('canvas.menu.alignTitle', { n: sel }), items })
  }

  groups.push({
    title: t('canvas.menu.groupCanvas'),
    items: [
      { key: 'batch-run', label: t('canvas.menu.batchRun'), icon: MENU_ICONS.batch, disabled: batch.running.value, run: openBatchRun },
      { key: 'style', label: t('canvas.menu.style'), icon: MENU_ICONS.style, run: openStylePanel },
      { key: 'download', label: t('canvas.menu.batchDownload'), icon: MENU_ICONS.download, run: openBatchDownload },
      { key: 'search', label: t('canvas.menu.search'), icon: MENU_ICONS.search, run: openSearch },
      { key: 'save', label: t('canvas.menu.saveNow'), lc: 'disk', disabled: saving.value, run: () => { void handleSave() } },
    ],
  })

  // 节点布局：和「设置 → 外观」里的是同一个偏好，这里是顺手切换的入口
  groups.push({
    title: t('canvas.nodeLayout.title'),
    items: NODE_LAYOUTS.map((v) => ({
      key: `node-layout-${v}`, label: t(`canvas.nodeLayout.${v}`), icon: LAYOUT_ICONS[v],
      active: nodeLayout.value === v, run: () => { void pickNodeLayout(v) },
    })),
  })

  groups.push({ title: t('canvas.pal.library'), items: libraryMenuItems.value })

  return offeredMenu(groups)
})

// 导航组（退出沉浸式 / 我的画布 / 使用教程）单独拎出来，右键菜单里永远置顶；其余画布操作按选中态排布
const NAV_MENU_KEYS = new Set(['immersive', 'list', 'switch-proj', 'load-proj', 'guide', 'shortcuts'])
const navMenuGroup = computed(() => canvasMenuGroups.value.find(g => g.items.some(i => NAV_MENU_KEYS.has(i.key))) || null)
const otherMenuGroups = computed(() => canvasMenuGroups.value.filter(g => g.items.every(i => !NAV_MENU_KEYS.has(i.key))))

// 工具面板上的「更多」菜单（坐标是视口的：菜单是 position: fixed）
const moreMenu = ref({ open: false, x: -9999, y: 0, maxH: 600 })
const moreRef = ref<HTMLElement | null>(null)
// 右键菜单 /「更多」菜单的宽度，夹进视口时用。与样式里 .ed-menu 的 width 是同一个数
const ADD_MENU_W = 344

// 菜单弹出的位置，外观面板要贴着它开
const lastMenuPos = ref({ x: 0, y: 0 })

function toggleMoreMenu() {
  const wasOpen = moreMenu.value.open
  closeMenus()
  if (wasOpen) return
  moreMenu.value = { open: true, x: -9999, y: 0, maxH: 600 }
  void nextTick(placeMore)
}
/** 「更多」菜单贴着面板开：朝有地方的那一侧，整个留在编辑区里 */
function placeMore() {
  const el = moreRef.value, host = edRef.value
  if (!moreMenu.value.open || !el || !host) return
  const at = popNear('more', Math.min(ADD_MENU_W, host.clientWidth - 16), el.scrollHeight + 2)
  if (!at) return
  const o = host.getBoundingClientRect()
  const fr = frame()
  moreMenu.value = { open: true, x: Math.round(o.left - fr.x + at.x), y: Math.round(o.top - fr.y + at.y), maxH: at.maxH }
  lastMenuPos.value = { x: moreMenu.value.x, y: moreMenu.value.y }
}
function closeMoreMenu() {
  if (moreMenu.value.open) moreMenu.value.open = false
}

function runCanvasMenuItem(item: CanvasMenuItem) {
  if (item.disabled) return
  closeMoreMenu()
  closeAddMenu()
  item.run()
}

/* ==================== 批量下载 ==================== */
const batchOpen = ref(false)
async function openBatchDownload() {
  if (!currentId.value) { MessagePlugin.warning(t('download.unsaved')); return }
  // 先落库：打包的候选集是后端从画布文档里现取的，没保存的新产物不会在里面
  if (dirty.value) await doSave(true)
  batchOpen.value = true
}

/* ==================== 单图编辑器（裁剪 / 旋转） ==================== */
const editorState = ref<{ open: boolean; url: string; nodeId: string }>({ open: false, url: '', nodeId: '' })
let editorResolve: ((v: ImageEditorResult | null) => void) | null = null

function openImageEditor(url: string, nodeId: string): Promise<ImageEditorResult | null> {
  editorState.value = { open: true, url, nodeId }
  return new Promise((resolve) => { editorResolve = resolve })
}
provide(CANVAS_IMAGE_EDITOR_KEY, { open: (opts) => openImageEditor(opts.url, opts.nodeId) })

function closeEditor(result: ImageEditorResult | null) {
  editorState.value = { ...editorState.value, open: false }
  const resolve = editorResolve
  editorResolve = null
  resolve?.(result)
}

/**
 * 替换当前节点。原图进 editHistory（只存 URL，最多 5 条）。
 * 注意 editHistory 绝不能加进 RUNTIME_FIELDS —— 那份名单里的字段保存时会被剥掉。
 */
function applyEditReplace(nodeId: string, url: string) {
  const n = nodes.value.find((x) => x.id === nodeId)
  if (!n) return
  // 裁剪/旋转也要能撤。注意对生成节点这一记是白记的 —— 那种节点的 imageUrl
  // 是产物，撤销时刻意保留现场（见 useCanvasHistory 顶部），回退得靠下面
  // 这份 editHistory。输入类图片节点才是这一记真正管用的地方，也是常见情形。
  hist.record()
  const d = (n.data || {}) as any
  const prev: string[] = Array.isArray(d.editHistory) ? d.editHistory : []
  const old = typeof d.imageUrl === 'string' ? d.imageUrl : ''
  updateNodeData(nodeId, {
    imageUrl: url,
    editHistory: old ? [old, ...prev].slice(0, 5) : prev,
  })
}

/** 生成新的图片节点，摆在原节点右侧。图片节点没有输入口，所以只摆位置不连线 */
function applyEditAsNewNode(nodeId: string, url: string) {
  const src = nodes.value.find((x) => x.id === nodeId)
  const measured = getNodes.value.find((n: any) => n.id === nodeId)
  const w = measured?.dimensions?.width || 260
  const pos = src
    ? { x: (src.position?.x || 0) + w + 60, y: src.position?.y || 0 }
    : undefined
  addNode('image', { imageUrl: url }, pos)
}

function onEditorDone(payload: ImageEditorResult) {
  const nodeId = editorState.value.nodeId
  if (payload.mode === 'replace') applyEditReplace(nodeId, payload.url)
  else applyEditAsNewNode(nodeId, payload.url)
  closeEditor(payload)
  MessagePlugin.success(payload.mode === 'replace' ? t('canvas.editor.replaced') : t('canvas.editor.newNode'))
}

/* ==================== 工具面板 ==================== */
// 「+」是全部节点；下面按类别各一颗按钮，点开是这一类的节点；再往后是素材库那组入口、分享和「更多」。
// 只有一种节点的类别（文本）点一下直接加。手机上展开层变成底部抽屉。
type FlyKey = '' | 'all' | 'lib' | 'text' | 'image' | 'video' | 'chat' | 'tools'
const PAL_CATS: { key: Exclude<FlyKey, '' | 'all' | 'lib'>; icon: string; kinds: NodeKind[] }[] = [
  { key: 'text', icon: 'text', kinds: ['text'] },
  { key: 'image', icon: 'image', kinds: ['image', 'image-collection', 'image-gen', 'image-edit'] },
  { key: 'video', icon: 'video', kinds: ['video', 'video-gen', 'video-edit'] },
  { key: 'chat', icon: 'chat', kinds: ['llm', 'video-analysis'] },
  { key: 'tools', icon: 'tool', kinds: ['output', 'platform-export', 'slice', 'collage', 'watermark', 'fit-size'] },
]
const PAL_TITLE_KEYS = {
  text: 'canvas.pal.text', image: 'canvas.pal.image', video: 'canvas.pal.video', chat: 'canvas.pal.chat', tools: 'canvas.pal.tools',
} as const
const palCats = computed(() => PAL_CATS
  .map((c) => ({ ...c, kinds: c.kinds.filter((k) => offeredKinds.value.has(k)), title: t(PAL_TITLE_KEYS[c.key]) }))
  .filter((c) => c.kinds.length))

const fly = ref<FlyKey>('')
const flyRef = ref<HTMLElement | null>(null)
const flyStyle = ref<Record<string, string>>({})
function toggleFly(key: FlyKey) {
  const next = fly.value === key ? '' : key
  closeMenus()
  fly.value = next
  if (next) void nextTick(placeFly)
}
/** 展开层贴着面板开：朝有地方的那一侧，对齐被点的那颗按钮。手机上是底部抽屉，位置由样式定 */
function placeFly() {
  const el = flyRef.value, host = edRef.value
  if (!fly.value || !el || !host) return
  if (palPhone.value) { flyStyle.value = {}; return }
  const w = Math.min(fly.value === 'all' ? 340 : 220, host.clientWidth - 16)
  const head = el.querySelector<HTMLElement>('.ed-fly-h'), body = el.querySelector<HTMLElement>('.ed-fly-b')
  const at = popNear(fly.value, w, (head?.offsetHeight || 0) + (body?.scrollHeight || 0) + 2)
  if (at) flyStyle.value = { left: at.x + 'px', top: at.y + 'px', width: w + 'px', maxHeight: at.maxH + 'px' }
}
function onPalClick(c: { key: FlyKey; kinds: NodeKind[] }) {
  if (c.kinds.length === 1) { closeMenus(); addNode(c.kinds[0]); return }
  toggleFly(c.key)
}
/** 分享弹窗是模态的：开之前把面板的展开层收掉 */
function openShareFromPal() {
  closeMenus()
  openShareDialog()
}

/* ---- 面板的位置 / 方向 ---- */
const edRef = ref<HTMLElement | null>(null)
const palRef = ref<HTMLElement | null>(null)
const palMenuRef = ref<HTMLElement | null>(null)
const palMenu = ref<{ open: boolean; style: Record<string, string> }>({ open: false, style: {} })
let gripTapAt = 0
const {
  xy: palXY, rect: palRect, orient: palOrient, phone: palPhone, ready: palReady, dragging: palDragging, isDefault: palIsDefault,
  layout: layoutPal, onDown: palDown, onMove: palMove, onUp: palUp, nudge: nudgePal, toggleOrient, reset: resetPal,
} = usePaletteDock({
  host: edRef,
  el: palRef,
  // 属性面板有入场动画，从 DOM 量会偏：按它的固定尺寸算（右 12、上下 12、宽 INSPECTOR_WIDTH）
  extraObstacles: () => {
    const host = edRef.value
    if (!host || inspectorInset.value <= 0) return []
    const W = host.clientWidth
    return [{ l: W - 12 - INSPECTOR_WIDTH, t: 12, r: W - 12, b: host.clientHeight - 12 }]
  },
  onDragStart: () => closeMenus(),
  // 把手上点一下开小菜单；紧接着再点一下（双击）= 复位
  onGripTap: () => {
    const now = Date.now()
    if (now - gripTapAt < 350) { gripTapAt = 0; resetPalette(); return }
    gripTapAt = now
    togglePalMenu()
  },
})
const turnLabel = computed(() => (palOrient.value === 'v' ? t('canvas.pal.toHorizontal') : t('canvas.pal.toVertical')))
function turnPalette() {
  closeMenus()
  toggleOrient()
}
function resetPalette() {
  closeMenus()
  resetPal()
}
function togglePalMenu() {
  const wasOpen = palMenu.value.open
  closeMenus()
  if (wasOpen) return
  palMenu.value = { open: true, style: { visibility: 'hidden' } }
  void nextTick(placePalMenu)
}
function placePalMenu() {
  const el = palMenuRef.value
  if (!palMenu.value.open || !el) return
  const at = popNear('grip', el.offsetWidth, el.offsetHeight)
  if (at) palMenu.value = { open: true, style: { left: at.x + 'px', top: at.y + 'px' } }
}
/** 键盘 / 读屏触发的 click 没有指针按下（detail 是 0）；指针点的已经在面板的 pointerup 里处理过了 */
function onGripClick(e: MouseEvent) {
  if (e.detail === 0) togglePalMenu()
}
/** 把手和面板空白处：拦掉 mousedown 的默认行为，免得拖的时候选中文字、或把底下节点里的图当成拖拽源 */
function onPalMouseDown(e: MouseEvent) {
  const el = e.target as HTMLElement
  if (el.closest('.pal-grip') || !el.closest('button')) e.preventDefault()
}
/**
 * 面板旁边的弹出层放哪（坐标相对编辑区）。
 *   竖排：开在面板左 / 右，右边放得下就右边，否则哪边宽开哪边；顶边对齐那颗按钮。
 *   横排：开在面板上 / 下，下面放得下就下面，否则哪边高开哪边；左边对齐那颗按钮。
 * 最后整个夹回编辑区里，放不下的高度交给弹出层自己滚动。
 */
function popNear(key: string, w: number, h: number): { x: number; y: number; maxH: number } | null {
  const host = edRef.value, pal = palRef.value
  const btn = pal?.querySelector<HTMLElement>(`[data-pal="${key}"]`)
  if (!host || !pal || !btn) return null
  const W = host.clientWidth, H = host.clientHeight
  const GAP = 8, EDGE = 8
  const pr = pal.getBoundingClientRect(), br = btn.getBoundingClientRect()
  // 面板可能正滑向新位置：用它要去的位置，按钮按它在面板里的偏移算
  const o = host.getBoundingClientRect()
  const P: Rect = palPhone.value || !palRect.value
    ? { l: pr.left - o.left, t: pr.top - o.top, r: pr.right - o.left, b: pr.bottom - o.top }
    : palRect.value
  const bx = P.l + (br.left - pr.left), by = P.t + (br.top - pr.top)
  if (palOrient.value === 'v') {
    const roomR = W - P.r - GAP - EDGE, roomL = P.l - GAP - EDGE
    const right = roomR >= w || roomR >= roomL
    const maxH = H - EDGE * 2
    return {
      x: clampNum(right ? P.r + GAP : P.l - GAP - w, EDGE, W - w - EDGE),
      y: clampNum(by - 6, EDGE, H - EDGE - Math.min(h, maxH)),
      maxH,
    }
  }
  const roomB = H - P.b - GAP - EDGE, roomT = P.t - GAP - EDGE
  const below = roomB >= h || roomB >= roomT
  const maxH = Math.max(120, below ? roomB : roomT)
  return {
    x: clampNum(bx - 6, EDGE, W - w - EDGE),
    y: below ? P.b + GAP : Math.max(EDGE, P.t - GAP - Math.min(h, maxH)),
    maxH,
  }
}
// 面板挪了 / 换了方向 / 窗口变了：开着的弹出层跟过去
watch([palRect, palOrient, palPhone], () => { void nextTick(() => { placeFly(); placeMore(); placePalMenu() }) })
// 属性面板开合、提示条出现 / 消失：面板重新找位置（它们不改编辑区的尺寸，ResizeObserver 不会报）
watch([inspectorInset, () => noModels.value], () => { void nextTick(layoutPal) }, { flush: 'post' })
/** 生成队列圆钮要绕开的矩形 */
const palAvoid = computed<Rect[]>(() => (palRect.value ? [palRect.value] : []))

/* ---- 面板的键盘：方向键在按钮之间走（竖排上下、横排左右），Tab 只停一次 ---- */
const palButtons = () => Array.from(palRef.value?.querySelectorAll<HTMLButtonElement>('button') || [])
function syncPalTabStops(cur?: HTMLElement | null) {
  const list = palButtons()
  const keep = cur && list.includes(cur as HTMLButtonElement) ? cur : list.find((b) => b.tabIndex === 0 && !b.disabled) || list.find((b) => !b.disabled)
  for (const b of list) b.tabIndex = b === keep ? 0 : -1
}
function onPalFocusIn(e: FocusEvent) {
  syncPalTabStops(e.target as HTMLElement)
}
function onPalKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const vertical = palOrient.value === 'v'
  // 把手上 Shift + 方向键：挪面板
  if (e.shiftKey && target.closest('.pal-grip') && e.key.startsWith('Arrow')) {
    e.preventDefault()
    const STEP = 24
    nudgePal(e.key === 'ArrowLeft' ? -STEP : e.key === 'ArrowRight' ? STEP : 0, e.key === 'ArrowUp' ? -STEP : e.key === 'ArrowDown' ? STEP : 0)
    return
  }
  const prev = vertical ? 'ArrowUp' : 'ArrowLeft', next = vertical ? 'ArrowDown' : 'ArrowRight'
  if (e.key !== prev && e.key !== next && e.key !== 'Home' && e.key !== 'End') return
  const list = palButtons().filter((b) => !b.disabled)
  if (!list.length) return
  e.preventDefault()
  const i = list.indexOf(target as HTMLButtonElement)
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === next ? 1 : -1) + list.length) % list.length
  list[to].focus()
  list[to].scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
// 按钮的数量会变（手机上没有把手、沉浸式多一颗退出钮）：重新定 Tab 停在哪
watch([palPhone, () => appStore.immersive, palOrient], () => { void nextTick(() => syncPalTabStops()) }, { flush: 'post' })
onMounted(() => syncPalTabStops())

/**
 * 四边各被悬浮块占掉多少：「适应屏幕」和新节点的落点都按这个让。
 * 面板想放哪放哪，所以只在它贴边的时候让：竖排贴左 / 右边让出那一条宽度，横排在顶上 / 底下那一带
 * 让出那一条高度；漂在画布中间时不让 —— 那是用户自己挑的位置，和别的小控件一样允许节点从底下过。
 */
function chromeInsets(W: number, H: number): { l: number; t: number; r: number; b: number } {
  layoutPal()
  const p = palRect.value
  // 手机：顶上是标题块 + 面板那一横条；底边除了工具条，还有它上面右角的生成队列圆钮
  if (palPhone.value) return { l: 12, t: Math.max(60, (p ? p.b : 102) + 6), r: 12, b: 126 }
  // 顶上让给标题块；底边多让一截：左下角的小地图比工具条高（右下角的圆钮也在这一条里）；
  // 右边：属性面板开着时把它的宽度让出来
  const ins = { l: 24, t: 76, r: 24 + inspectorInset.value, b: 140 }
  if (!p) return ins
  if (palOrient.value === 'v') {
    if (p.l <= 18) ins.l = p.r + 24
    else if (p.r >= W - inspectorInset.value - 18) ins.r = W - p.l + 24
  } else if (p.t <= 78) {
    ins.t = Math.max(ins.t, p.b + 16)
  } else if (p.b >= H - 142) {
    ins.b = Math.max(ins.b, H - p.t + 16)
  }
  return ins
}
const nodeMenuItem = (kind: NodeKind): CanvasMenuItem => ({
  key: kind, label: nodeTypeLabel(kind), icon: NODE_MENU_ICONS[kind] || '', run: () => { addNode(kind) },
})
const flyTitle = computed(() => {
  if (fly.value === 'all') return t('canvas.addPanel.title')
  if (fly.value === 'lib') return t('canvas.pal.library')
  return fly.value ? t(PAL_TITLE_KEYS[fly.value]) : ''
})
const flyGroups = computed<{ title: string; items: CanvasMenuItem[] }[]>(() => {
  if (fly.value === 'all') {
    return [
      ...NODE_MENU_LAYOUT.map((g) => ({ title: t(g.titleKey), items: g.kinds.filter((k) => offeredKinds.value.has(k)).map(nodeMenuItem) })),
      { title: t('canvas.menu.groupTitle'), items: [frameMenuItem.value] },
      { title: t('canvas.pal.library'), items: libraryMenuItems.value },
    ].filter((g) => g.items.length)
  }
  if (fly.value === 'lib') return [{ title: '', items: libraryMenuItems.value }]
  const cat = palCats.value.find((c) => c.key === fly.value)
  if (!cat) return []
  const items = cat.kinds.map(nodeMenuItem)
  // 「组」不是往画布上加一个节点，而是把选中的节点圈起来 —— 归在工具里
  if (cat.key === 'tools') items.push(frameMenuItem.value)
  return [{ title: '', items }]
})
function runFlyItem(item: CanvasMenuItem) {
  if (item.disabled) return
  fly.value = ''
  item.run()
}

// 右键菜单
const contextMenu = ref({ open: false, x: 0, y: 0, nodeId: '' })

/**
 * 右键一个生成节点时的「品牌包」几项：跟随画布 / 此节点不套用 / 单独用某一个。
 * 一个品牌包都没有、节点也没有例外时不出这一组。
 */
const contextKitOptions = computed<{ value: string; label: string; on: boolean }[] | null>(() => {
  const n = nodes.value.find((x) => x.id === contextMenu.value.nodeId)
  if (!n || !BRAND_KIT_NODE_TYPES.includes(n.type as string)) return null
  const kits = brandKits.kits.value
  const own = (n.data?.brandKitOverride as string) || ''
  if (!kits.length && !own) return null
  const canvasKit = kits.find((k) => k.id === canvasKitId.value)
  return [
    { value: '', label: canvasKit ? t('brandKit.node.followWith', { name: canvasKit.name }) : t('brandKit.node.followNone') },
    { value: KIT_NONE, label: t('brandKit.node.off') },
    ...kits.map((k) => ({ value: k.id, label: t('brandKit.node.useKit', { name: k.name }) })),
  ].map((o) => ({ ...o, on: o.value === own }))
})
function setKitFromContext(value: string) {
  const id = contextMenu.value.nodeId
  closeContextMenu()
  if (id) setNodeKitOverride(id, value)
}

// 画布空白处右键：添加节点菜单（与左侧「添加节点」浮层同一份数据）
const addMenu = ref({ open: false, x: 0, y: 0, flowX: 0, flowY: 0 })

// 添加节点菜单分组数据（图标为内联 SVG，v-html 渲染），右键菜单与左侧浮层共用
type NodeMenuItem = { kind: NodeKind; label: string; icon: string }

// 节点类型 → 文案 key。菜单、节点搜索共用这一份；存 key 不存译文，切语言时跟着变
const NODE_TITLE_KEYS: Record<NodeKind, string> = {
  'text': 'nodes.title.text',
  'image': 'nodes.title.image',
  'video': 'nodes.title.video',
  'image-collection': 'nodes.title.imageCollection',
  'image-gen': 'nodes.title.imageGen',
  'image-edit': 'nodes.title.imageEdit',
  'video-gen': 'nodes.title.videoGen',
  'video-edit': 'nodes.title.videoEdit',
  'video-analysis': 'nodes.title.videoAnalysis',
  'llm': 'nodes.title.llm',
  'output': 'nodes.title.output',
  'platform-export': 'nodes.title.platformExport',
  'slice': 'nodes.title.slice',
  'collage': 'nodes.title.collage',
  'watermark': 'nodes.title.watermark',
  'fit-size': 'nodes.title.fitSize',
  'frame': 'nodes.title.frame',
}
function nodeTypeLabel(type: string): string {
  const key = NODE_TITLE_KEYS[type as NodeKind]
  return key ? t(key) : type
}

const NODE_MENU_ICONS: Partial<Record<NodeKind, string>> = {
  'text': '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="14" y2="18"/>',
  'image': '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  'video': '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  'image-collection': '<rect x="2" y="6" width="16" height="14" rx="2"/><path d="M6 2h14a2 2 0 0 1 2 2v14"/>',
  'image-gen': '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  'image-edit': '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  'video-gen': '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  'video-edit': '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/><path d="M8 10l2 2-2 2"/>',
  'video-analysis': '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/><path d="M5 9.5h5M5 12.5h4"/>',
  'llm': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12.5h5"/>',
  'output': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'platform-export': '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
  'slice': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/>',
  'collage': '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  'watermark': '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="13" y="13" width="6" height="5" rx="1"/><path d="M7 8h6"/>',
  'fit-size': '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10v4M17 10v4"/><path d="M10 12h4"/><polyline points="12 10 14 12 12 14"/>',
}

// 每组带标题：两列排布之后光靠分隔线已经分不清哪块是哪块了。
// 「工具」那组全是本机像素处理，不调模型也没有成本。
const NODE_MENU_LAYOUT: { titleKey: string; kinds: NodeKind[] }[] = [
  { titleKey: 'canvas.addPanel.groupSource', kinds: ['text', 'image', 'video', 'image-collection'] },
  { titleKey: 'canvas.addPanel.groupGen', kinds: ['image-gen', 'image-edit', 'video-gen', 'video-edit', 'video-analysis', 'llm'] },
  { titleKey: 'canvas.addPanel.groupOutput', kinds: ['output'] },
  { titleKey: 'canvas.addPanel.groupTools', kinds: ['platform-export', 'slice', 'collage', 'watermark', 'fit-size'] },
]
const nodeMenuGroups = computed<{ title: string; items: NodeMenuItem[] }[]>(() =>
  NODE_MENU_LAYOUT.map((g) => ({
    title: t(g.titleKey),
    items: g.kinds.filter((k) => offeredKinds.value.has(k)).map((kind) => ({ kind, label: nodeTypeLabel(kind), icon: NODE_MENU_ICONS[kind] || '' })),
  })).filter((g) => g.items.length))

function onNodeContextMenu({ event, node }: { event: any; node: Node }) {
  event.preventDefault?.()
  closeAddMenu()
  // 右键一个还没选中的组，先把它选上：「合并为一组」「移出组」都是按选中集合
  // 干活的，不选上这几项就永远是灰的。已经在选中集里就别动，免得把用户
  // 辛苦框好的一片给清了。
  if (node.type === 'frame') {
    const g = getNodes.value.find((n: any) => n.id === node.id)
    // removeSelectedNodes 要显式传要取消的那批，没有无参重载
    if (g && !g.selected) { removeSelectedNodes(getSelectedNodes.value); addSelectedNodes([g]) }
  }
  // 夹进视口：在屏幕右边 / 底边右键时菜单别开到外面去
  if (readOnly.value) return
  const fr = frame()
  const x = Math.max(8, Math.min((event.clientX ?? event.touches?.[0]?.clientX ?? 0) - fr.x, fr.w - 288))
  const y = Math.max(8, Math.min((event.clientY ?? event.touches?.[0]?.clientY ?? 0) - fr.y, fr.h - 380))
  contextMenu.value = {
    open: true,
    x,
    y,
    nodeId: node.id,
  }
}

// ===== 右键菜单里的「查看原图 / 下载原图 / 任务详情」（仅对有产物的生成节点显示）=====
const GEN_MEDIA_TYPES = ['image-gen', 'image-edit', 'video-gen', 'video-edit']
/** 输出文字的任务节点：没有媒体产物，但同样有任务号和失败原因 */
const TEXT_TASK_TYPES = ['llm', 'video-analysis']
// 右键目标若是带产物的生成节点，解析出媒体信息；否则返回 null（不显示这几项）
const contextNodeInfo = computed(() => {
  const n = nodes.value.find((x) => x.id === contextMenu.value.nodeId)
  if (!n || !GEN_MEDIA_TYPES.includes(n.type as string)) return null
  const isVideo = n.type === 'video-gen' || n.type === 'video-edit'
  const url = isVideo ? (n.data?.videoUrl || '') : (n.data?.imageUrl || '')
  if (!url) return null
  return {
    mediaType: (isVideo ? 'video' : 'image') as 'image' | 'video',
    url: url as string,
    // 详情弹窗类型与各节点自身用法保持一致（视频编辑也按 video-gen 展示）
    detailType: (n.type === 'video-edit' ? 'video-gen' : n.type) as NodeKind,
    data: n.data,
  }
})

// 右键目标节点上可编辑的图片地址（图片 / 成品 / 出图类节点的主显图）
const contextImageUrl = computed(() => {
  const n = nodes.value.find((x) => x.id === contextMenu.value.nodeId)
  const u = (n?.data as any)?.imageUrl
  // 本站存储的文件是站内相对地址（/files/...），同样能编辑
  return typeof u === 'string' && (/^https?:\/\//i.test(u) || u.startsWith('/files/')) ? u : ''
})

// 查看原图 / 原视频（大图预览）
const lightbox = ref<{ open: boolean; url: string; type: 'image' | 'video' }>({ open: false, url: '', type: 'image' })
// 任务详情弹窗
// type 用 any：TaskDetailModal 内部有自己的 NodeKind 声明，避免同名类型不兼容报错
const detailModal = ref<{ open: boolean; type: any; data: any }>({ open: false, type: 'image-gen', data: null })

function viewOriginalFromContext() {
  const info = contextNodeInfo.value
  if (info) lightbox.value = { open: true, url: info.url, type: info.mediaType }
  closeContextMenu()
}
function downloadFromContext() {
  const info = contextNodeInfo.value
  if (info) downloadCanvasAsset(info.url, `${contextMenu.value.nodeId}_${Date.now()}`, info.mediaType)
  closeContextMenu()
}
async function saveToAssetsFromContext() {
  const info = contextNodeInfo.value
  closeContextMenu()
  if (!info) return
  try {
    await userAssetApi.registerOutput({
      mediaUrl: info.url,
      nodeType: info.mediaType === 'video' ? 'VIDEO' : 'IMAGE',
      name: t('canvas.asset.outputName'),
      fromFlowId: currentId.value || ''
    })
    MessagePlugin.success(t('canvas.asset.saved'))
  } catch (e: any) {
    MessagePlugin.error(apiErrorMessage(e, t('canvas.asset.saveFailed')))
  }
}
function editImageFromContext() {
  const url = contextImageUrl.value
  const nodeId = contextMenu.value.nodeId
  closeContextMenu()
  if (url) openImageEditor(url, nodeId)
}
function detailFromContext() {
  const info = contextNodeInfo.value
  if (info) detailModal.value = { open: true, type: info.detailType, data: info.data }
  closeContextMenu()
}

// 画布空白处右键：在光标位置弹出添加节点菜单
function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault?.()
  closeContextMenu()
  if (readOnly.value) return
  /**
   * 新节点落在鼠标点下的位置，用的是**没夹过**的原始坐标；
   * 菜单自己的位置才夹进视口 —— 两者混用的话，在屏幕边上右键加出来的节点
   * 会跑到离鼠标老远的地方。
   */
  const flow = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const fr = frame()
  const x = Math.max(8, Math.min(event.clientX - fr.x, fr.w - ADD_MENU_W - 8))
  const y = Math.max(8, Math.min(event.clientY - fr.y, fr.h - 360))
  addMenu.value = { open: true, x, y, flowX: flow.x, flowY: flow.y }
  lastMenuPos.value = { x, y }
}

function closeContextMenu() {
  if (contextMenu.value.open) contextMenu.value.open = false
}

function closeAddMenu() {
  if (addMenu.value.open) addMenu.value.open = false
}

function closeMenus() {
  closeContextMenu()
  closeAddMenu()
  closeMoreMenu()
  projMenuOpen.value = false
  fly.value = ''
  if (palMenu.value.open) palMenu.value = { open: false, style: {} }
}

// 从右键菜单添加节点：落在光标对应的画布坐标处
function addNodeFromMenu(kind: NodeKind) {
  addNode(kind, undefined, { x: addMenu.value.flowX, y: addMenu.value.flowY })
  closeAddMenu()
}

// 右键菜单和 Delete / Ctrl+D 走同一份实现 —— 分两份迟早只有一边记了历史
function deleteNodesById(ids: string[]) {
  if (!ids.length) return
  hist.record()
  /**
   * 删画框之前先把框里的节点放出来。
   * vue-flow 的 removeNodes 会连带删掉子节点 —— 用户删的是那个框，
   * 不是框里辛苦搭的一整条链路，连坐是最容易让人骂街的行为。
   */
  for (const id of ids) {
    const n = nodes.value.find((x) => x.id === id)
    if (n?.type === 'frame') releaseFrameChildren(id)
  }
  removeNodes(ids)
}

/** 把某个画框的子节点解除父子关系，并把相对坐标换算回绝对坐标 */
function releaseFrameChildren(frameId: string) {
  const moves = releaseFrame(nodes.value as any, frameId)
  if (!moves.length) return
  const byId = new Map(moves.map((m) => [m.id, m.position]))
  nodes.value = nodes.value.map((n: any) => {
    const pos = byId.get(n.id)
    if (!pos) return n
    // parentNode / extent 一起去掉，位置同一次赋值里换算好，避免中间帧跳一下
    const { parentNode: _p, extent: _e, ...rest } = n
    return { ...rest, position: pos }
  })
}

/** 把选中的节点圈成一个画框 */
function groupIntoFrame() {
  const ids = getSelectedNodes.value.map((n: any) => n.id)
  if (ids.length < 1) { MessagePlugin.info(t('canvas.group.needSelect')); return }
  const plan = planFrame(getNodes.value as any, ids)
  if (!plan) { MessagePlugin.info(t('canvas.group.alreadyGrouped')); return }

  hist.record()
  const frameId = genId()
  const childPos = new Map(plan.children.map((c) => [c.id, c.position]))
  const frame = frameNodeFrom(plan, frameId) as unknown as Node

  /**
   * 画框必须排在子节点前面 —— vue-flow 要求父节点先于子节点出现在数组里，
   * 顺带也让框渲染在底下，不会盖住框里的节点。
   */
  nodes.value = [
    frame,
    ...nodes.value.map((n: any) => {
      const pos = childPos.get(n.id)
      if (!pos) return n
      return { ...n, position: pos, parentNode: frameId, extent: 'parent', selected: false }
    }),
  ]
  MessagePlugin.success(t('canvas.group.grouped', { n: plan.children.length }))
}

/** 选中的、还没进任何组的普通节点个数 —— 决定右键组时「圈成一组」出不出现 */
const selectedLoose = computed(
  () => getSelectedNodes.value.filter((n: any) => !n.parentNode && n.type !== 'frame').length
)
/** 有没有选中任何节点 —— 决定空白处右键是否先摆出「针对选中」的操作（圈成一组等） */
const hasSelectionForMenu = computed(() => layout.selectedCount.value >= 1)
/** 选中的组的个数 */
const selectedFrames = computed(
  () => getSelectedNodes.value.filter((n: any) => n.type === 'frame').length
)
/** 选中的节点里有几个正待在某个组里 —— 决定「移出组」出不出现 */
const selectedInGroup = computed(
  () => getSelectedNodes.value.filter((n: any) => n.parentNode && n.type !== 'frame').length
)
/** 选中的东西里跟组沾边的个数 —— 决定「合并为一组」出不出现 */
const selectedGrouped = computed(() => selectedFrames.value + selectedInGroup.value)

/**
 * 合并为一组：把选中的东西并成一个新组。
 *
 * 选中集合里混着什么都能处理 ——
 *   组             它的全部子节点进新组，组本身删掉
 *   散节点         直接进新组
 *   别的组里的节点  从原组移出、进新组（顺带就当「把节点挪到另一个组」用了）
 */
function mergeIntoGroup() {
  const sel = getSelectedNodes.value
  if (sel.length < 2) { MessagePlugin.info(t('canvas.group.mergeNeedTwo')); return }
  const plan = planMerge(getNodes.value as any, sel.map((n: any) => n.id))
  if (!plan) { MessagePlugin.info(t('canvas.group.mergeEmpty')); return }

  hist.record()
  const frameId = genId()
  const childPos = new Map(plan.children.map((c) => [c.id, c.position]))
  const gone = new Set(plan.removedFrameIds)
  const frame = frameNodeFrom(plan, frameId, plan.label) as unknown as Node

  // 跟 groupIntoFrame 一样：新组必须排在子节点前面，vue-flow 要求父先于子
  nodes.value = [
    frame,
    ...nodes.value
      .filter((n: any) => !gone.has(n.id))
      .map((n: any) => {
        const pos = childPos.get(n.id)
        if (!pos) return n
        return { ...n, position: pos, parentNode: frameId, extent: 'parent', selected: false }
      }),
  ]
  MessagePlugin.success(t('canvas.group.merged', { n: plan.children.length }))
}

/**
 * 解散选中的组。一个组都没选中时退化成「把选中的节点移出组」——
 * 用户按 Ctrl+Shift+G 想的多半就是「让它别在组里了」，两种情况都照做。
 */
function ungroupSelected() {
  const frames = getSelectedNodes.value.filter((n: any) => n.type === 'frame')
  if (!frames.length) { releaseSelected(); return }
  hist.record()
  for (const f of frames) releaseFrameChildren(f.id)
  const gone = new Set(frames.map((f: any) => f.id))
  nodes.value = nodes.value.filter((n: any) => !gone.has(n.id))
  MessagePlugin.success(t('canvas.group.ungroupedN', { n: frames.length }))
}

/** 选中的东西够不够谈「合并」：两个以上、且里面已经有组 */
const canMergeSelected = computed(
  () => getSelectedNodes.value.length >= 2 && selectedGrouped.value >= 1
)

// 右键组时菜单里的入口，都是先关菜单再干活
function groupFromContext() { closeContextMenu(); groupIntoFrame() }
function mergeFromContext() { closeContextMenu(); mergeIntoGroup() }
function releaseFromContext() { closeContextMenu(); releaseSelected() }

/** 把选中的节点从各自的组里移出来（组还在，只是少了这几个成员） */
function releaseSelected() {
  const ids = getSelectedNodes.value.map((n: any) => n.id)
  const moves = planRelease(getNodes.value as any, ids)
  if (!moves.length) { MessagePlugin.info(t('canvas.group.notInGroup')); return }

  hist.record()
  const byId = new Map(moves.map((m) => [m.id, m.position]))
  nodes.value = nodes.value.map((n: any) => {
    const pos = byId.get(n.id)
    if (!pos) return n
    // 跟 releaseFrameChildren 一样：去父节点和换坐标必须在同一次赋值里
    const { parentNode: _p, extent: _e, ...rest } = n
    return { ...rest, position: pos }
  })
  MessagePlugin.success(t('canvas.group.released', { n: moves.length }))
}

/** 解散当前右键的画框（只去掉框，节点留下） */
function ungroupFromContext() {
  const id = contextMenu.value.nodeId
  closeContextMenu()
  const n = nodes.value.find((x) => x.id === id)
  if (!n || n.type !== 'frame') return
  hist.record()
  releaseFrameChildren(id)
  nodes.value = nodes.value.filter((x) => x.id !== id)
  MessagePlugin.success(t('canvas.group.ungroupedOne'))
}

/** 删除当前右键的组，连同组里的节点一起删 */
function deleteGroupFromContext() {
  const id = contextMenu.value.nodeId
  closeContextMenu()
  const n = nodes.value.find((x) => x.id === id)
  if (!n || n.type !== 'frame') return
  const childIds = nodes.value.filter((x) => (x as any).parentNode === id).map((x) => x.id)
  hist.record()
  removeNodes([id, ...childIds])
  MessagePlugin.success(childIds.length ? t('canvas.group.deletedWith', { n: childIds.length }) : t('canvas.group.deleted'))
}

// 复制节点：复制节点本身（含内容，剥离运行时状态），位置稍作偏移；不复制连线
function duplicateNodesById(ids: string[]) {
  const srcList = ids
    .map((id) => nodes.value.find((n) => n.id === id))
    .filter(Boolean) as Node[]
  if (!srcList.length) return
  hist.record()
  for (const src of srcList) {
    nodes.value.push({
      id: genId(),
      type: src.type,
      position: {
        x: (src.position?.x || 0) + 40,
        y: (src.position?.y || 0) + 40,
      },
      data: dupData(src.data),
    } as Node)
  }
}

/* ==================== 节点剪贴板（Ctrl+C / Ctrl+V） ==================== */
// 只在本页内存里：复制的是节点本身和它们之间的连线，不进系统剪贴板 ——
// 系统剪贴板留给文字和图片（粘贴图片见 onCanvasPaste）。
let nodeClipboard: { nodes: { id: string; type: string; position: { x: number; y: number }; data: any }[]; edges: any[] } | null = null
let pasteRound = 0

/** 把选中的节点记进剪贴板；没选中任何普通节点返回 0 */
function copySelection(): number {
  // 组本身不复制（复制出来是个空框）；组里的节点按绝对坐标记，粘出来是散节点
  const sel = getSelectedNodes.value.filter((n: any) => n.type !== 'frame')
  if (!sel.length) return 0
  const ids = new Set(sel.map((n: any) => n.id))
  nodeClipboard = {
    nodes: sel.map((n: any) => ({
      id: n.id,
      type: n.type,
      position: { x: n.computedPosition?.x ?? n.position?.x ?? 0, y: n.computedPosition?.y ?? n.position?.y ?? 0 },
      data: dupData(n.data),
    })),
    edges: edges.value
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle })),
  }
  pasteRound = 0
  return sel.length
}

/**
 * 给同一拍里刚加进来的节点接线。
 *
 * 必须整体换一个新数组（和套模板、加载其他画布同一种写法），不能用 addEdge：
 * addEdge 是往原数组里 push，vue-flow 立刻就校验这条线，而新节点要到下一拍才进它的
 * 仓库 —— 线的两端「不存在」，被悄悄丢掉。
 */
function appendEdges(conns: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }[]) {
  if (!conns.length) return
  edges.value = [
    ...edges.value,
    ...conns.map((c) => ({ id: `e_${genId()}`, ...c, type: 'glow' }) as Edge),
  ]
}

/** 把剪贴板里的节点贴回画布：每贴一次往右下多错开一格，贴完选中新节点 */
function pasteNodes(): boolean {
  const clip = nodeClipboard
  if (!clip || !clip.nodes.length) return false
  hist.record()
  pasteRound++
  const shift = 40 * pasteRound
  const idMap = new Map<string, string>()
  const fresh: Node[] = clip.nodes.map((n) => {
    const id = genId()
    idMap.set(n.id, id)
    return {
      id,
      type: n.type,
      position: { x: n.position.x + shift, y: n.position.y + shift },
      data: JSON.parse(JSON.stringify(n.data)),
    } as Node
  })
  nodes.value = [...nodes.value, ...fresh]
  appendEdges(clip.edges.map((e) => ({ ...e, source: idMap.get(e.source)!, target: idMap.get(e.target)! })))
  const freshIds = new Set(fresh.map((n) => n.id))
  nextTick(() => {
    removeSelectedNodes(getSelectedNodes.value)
    addSelectedNodes(getNodes.value.filter((n: any) => freshIds.has(n.id)))
  })
  MessagePlugin.success(t('canvas.clipboard.pasted', { n: fresh.length }))
  return true
}

/** 复制/分叉共用：剥掉运行时字段，再摘掉版本历史 —— 那是原节点的账，
 *  复制品顶着别人的历史，切过去看到的图和它自己的参数对不上。 */
function dupData(data: any) {
  const d = JSON.parse(JSON.stringify(stripNodeData(data)))
  delete d.results
  delete d.resultIndex
  return d
}

/** 只有生成类节点、而且已经出过东西，才谈得上分叉 */
const FORKABLE_TYPES = new Set(['image-gen', 'image-edit', 'video-gen', 'video-edit'])
const contextIsFrame = computed(() =>
  nodes.value.find((x) => x.id === contextMenu.value.nodeId)?.type === 'frame')

const contextCanFork = computed(() => {
  const n = nodes.value.find((x) => x.id === contextMenu.value.nodeId)
  return !!n && FORKABLE_TYPES.has(n.type as string) && !!(n.data?.imageUrl || n.data?.videoUrl)
})

/**
 * 分叉：把节点连同它当前显示的这一版产物复制一份，上游连线一起接过来。
 *
 * 解决的是「这版还行，想在它基础上改参数再试一次，但别把它盖掉」。
 * 直接重跑只会把当前版本挤进历史条，分叉则是两条线并排留在画布上 ——
 * 各自往下接不同的后续节点。
 */
function forkFromContext() {
  const src = nodes.value.find((n) => n.id === contextMenu.value.nodeId)
  closeContextMenu()
  if (!src) return
  hist.record()
  const newId = genId()
  const data = JSON.parse(JSON.stringify(stripNodeData(src.data)))
  // 历史是原节点的账，不跟着分叉走；taskId 更不能带 —— 带着旧 taskId 的节点
  // 会被 resumeIncompleteTasks 当成「还没跑完」再轮询一遍
  delete data.results
  delete data.resultIndex
  delete data.taskId
  delete data.taskIds
  delete data.runPending
  nodes.value.push({
    id: newId,
    type: src.type,
    position: { x: (src.position?.x || 0) + 60, y: (src.position?.y || 0) + 60 },
    data,
  } as Node)
  // 上游连线照搬：分叉出来就该是能直接跑的，让用户重新连一遍等于白分
  for (const e of edges.value.filter((e) => e.target === src.id)) {
    edges.value = addEdge({
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: newId,
      targetHandle: e.targetHandle,
      type: 'glow',
    } as any, edges.value) as Edge[]
  }
  MessagePlugin.success(t('canvas.fork.forked'))
}

/**
 * 延续这一版：拿当前这一版结果当参考图，另起一个同款节点接着改。
 *
 * 这不是局部重绘 —— 上游没有 mask 能力（实测确认过），做不到「只改一处、
 * 别处纹丝不动」。它是让模型贴着上一版重新生成，整张都会变、只是变得少。
 * 界面文案上不能把话说满。
 */
function continueFromContext() {
  const src = nodes.value.find((n) => n.id === contextMenu.value.nodeId)
  closeContextMenu()
  if (!src) return
  const url = src.data?.imageUrl
  if (!url) { MessagePlugin.warning(t('canvas.fork.noResult')); return }

  hist.record()
  const baseX = (src.position?.x || 0)
  const baseY = (src.position?.y || 0)

  // 1) 把当前结果落成一个图片节点，摆在原节点下方
  const refId = genId()
  // 2) 同款生成节点，参数留着、产物和任务 id 都清掉
  const genNodeId = genId()
  const data = JSON.parse(JSON.stringify(stripNodeData(src.data)))
  delete data.results
  delete data.resultIndex
  delete data.taskId
  delete data.taskIds
  delete data.runPending
  delete data.imageUrl
  delete data.imageUrls
  delete data.cost

  nodes.value = [
    ...nodes.value,
    { id: refId, type: 'image', position: { x: baseX, y: baseY + 320 }, data: { imageUrl: url } } as Node,
    { id: genNodeId, type: src.type, position: { x: baseX + 300, y: baseY + 320 }, data } as Node,
  ]

  // 参考图接上；原节点的文本类上游也照搬，省得用户重连一遍提示词
  const conns = [{ source: refId, sourceHandle: 'image-out', target: genNodeId, targetHandle: 'image-in' }]
  for (const e of edges.value.filter((e) => e.target === src.id && e.targetHandle === 'text-in')) {
    conns.push({ source: e.source, sourceHandle: e.sourceHandle as string, target: genNodeId, targetHandle: e.targetHandle as string })
  }
  appendEdges(conns)

  MessagePlugin.success(t('canvas.fork.continued'))
}

function deleteFromContext() {
  if (contextMenu.value.nodeId) deleteNodesById([contextMenu.value.nodeId])
  closeContextMenu()
}

function duplicateFromContext() {
  if (contextMenu.value.nodeId) duplicateNodesById([contextMenu.value.nodeId])
  closeContextMenu()
}

function onDocClick(e: MouseEvent) {
  // 点击菜单之外的区域关闭
  const target = e.target as HTMLElement
  // 外观面板自己 stop 了 mousedown，这里只负责"点到别处就收起"
  if (!target.closest('.cs-panel')) stylePanelOpen.value = false
  if (target.closest('.ctx-menu, .ed-menu, .ed-pal, .ed-palmenu, .ed-fly, .ed-proj')) return
  closeMenus()
}

const workflowName = ref(t('canvas.untitled'))
const currentId = ref<string | null>(null)
const lastSavedAt = ref<string | null>(null)

const saving = ref(false)
const autoSaving = ref(false)
const dirty = ref(false)
// 最近一次保存没成功（手动或自动）。下一次存上了就清掉
const saveFailed = ref(false)

/** 标题块里那一小段保存状态：保存中 / 保存失败 / 未保存 / 已保存 · 时间 */
const saveState = computed<{ cls: string; text: string }>(() => {
  if (autoSaving.value || saving.value) return { cls: 'run', text: t('common.saving') }
  if (saveFailed.value) return { cls: 'err', text: t('canvas.save.failed') }
  if (dirty.value || !lastSavedAt.value) return { cls: 'warn', text: t('canvas.save.unsaved') }
  return { cls: 'ok', text: t('canvas.save.savedAt', { time: formatSavedTime(lastSavedAt.value) }) }
})
const loading = ref(false)

// 自动保存：去抖 + 指纹去重
const AUTO_SAVE_DELAY = 1500
// 去抖最多推迟这么久。节点在跑的时候进度每隔一两秒写回一次，每次都会重置去抖计时，
// 没有这个上限的话，运行期间（以及别的节点还在跑时刚出的结果）一直存不下去
const AUTO_SAVE_MAX_WAIT = 5000
let autoSaveTimer: number | null = null
let autoSaveDueBy = 0
let lastFingerprint: string | null = null
let suppressAutoSave = false  // 加载 / 重置时临时关闭以避免误触发

// taskId 要保留，否则刷新后无法恢复轮询；
// errorMsg 也要保留 —— 否则失败的任务回来还会被 resumeIncompleteTasks 当作"未完成"再轮一次。
// status/progress 是 UI 瞬时态可以扔（load 时根据 imageUrl/errorMsg 重新推导）。
// validationError/validationStamp 也是瞬时态：刷新后不该残留"必填项缺失"的红框。
const RUNTIME_FIELDS = ['status', 'progress', 'validationError', 'validationStamp']

function stripNodeData(d: any) {
  if (!d || typeof d !== 'object') return d
  const out: Record<string, any> = {}
  for (const k of Object.keys(d)) {
    if (!RUNTIME_FIELDS.includes(k)) out[k] = d[k]
  }
  return out
}

/**
 * 落库只留「重建画布需要的」那几个字段。
 *
 * vue-flow 会往节点和连线对象上挂一堆运行时状态：节点上有 selected / dragging /
 * computedPosition / handleBounds，连线上更是挂着两端节点的完整副本（sourceNode / targetNode）。
 * 原样存的话，一条线就带两份节点数据，画布体积成倍涨（保存有体积上限），
 * 而且光是点选一下节点指纹就变了，白白触发一次保存。
 */
const NODE_SAVE_FIELDS = ['id', 'type', 'position', 'parentNode', 'extent', 'dimensions', 'style', 'selectable'] as const
function nodeForSave(n: any) {
  const out: Record<string, any> = {}
  for (const k of NODE_SAVE_FIELDS) if (n[k] !== undefined) out[k] = n[k]
  out.data = stripNodeData(n.data)
  return out
}
function edgeForSave(e: any) {
  return { id: e.id, type: e.type, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }
}

/** 整份文档（对外的格式，见 embed/document.ts）：内容加上视口和格式版本号 */
function buildDocument(): CanvasDocument {
  return JSON.parse(JSON.stringify({ schemaVersion: CANVAS_SCHEMA_VERSION, ...buildContent(), viewport: { ...viewport.value } }))
}

/** 画布的内容：名字、节点、连线、外观。「改没改过」只看这些 */
function buildContent() {
  return {
    name: workflowName.value?.trim() || t('canvas.untitled'),
    nodes: nodes.value.map(nodeForSave),
    edges: edges.value.map(edgeForSave),
    // 画布外观。后端 PUT 是显式白名单透传，那边不加对应的一行这里存了也白存
    // nodeLayout：这张画布的节点是在哪种布局下排的（见 arrangedLayout），不是「用哪种布局显示」
    settings: { bg: bgSettings.value, ...(arrangedLayout.value ? { nodeLayout: arrangedLayout.value } : {}) },
    // 这张画布套用的品牌包；空串 = 不套用
    brandKitId: canvasKitId.value,
  }
}

/**
 * 视口（平移 / 缩放）跟着每次保存一起落库，但不进指纹：看画布不算改画布，
 * 挪一下视野不该让标题旁边跳成「未保存」。
 */
function buildFingerprint() {
  return JSON.stringify(buildContent())
}

const viewportKey = (v: Viewport) => `${Math.round(v.x)}|${Math.round(v.y)}|${(v.zoom || 1).toFixed(3)}`
let savedViewportKey = ''

let nodeCounter = 0
const genId = () => `n_${Date.now().toString(36)}_${(nodeCounter++).toString(36)}`

// 生成类节点的 model 不在这里写死 —— 可用模型来自后端清单，建节点那一刻再取默认值，
// 见 nodeDefaults。
const NODE_DEFAULTS: Record<NodeKind, any> = {
  'text': { text: '' },
  'image': { imageUrl: '' },
  'video': { videoUrl: '' },
  'image-collection': { imageUrls: [] },
  'image-gen': { prompt: '', status: 'idle' },
  'image-edit': { instruction: '', status: 'idle' },
  'video-gen': { prompt: '', aspectRatio: '16:9', status: 'idle' },
  'video-edit': { prompt: '', aspectRatio: '16:9', status: 'idle' },
  'video-analysis': { text: '', status: 'idle' },
  'llm': { text: '', status: 'idle' },
  'output': { imageUrl: '', videoUrl: '', status: 'idle' },
  'platform-export': { group: 'domestic', status: 'idle' },
  'slice': { cols: 3, rows: 3, status: 'idle' },
  'collage': { cols: 2, rows: 2, gap: 0, bg: '#ffffff', ratio: '', status: 'idle' },
  'watermark': { markUrl: '', position: 'br', scalePct: 20, opacity: 70, marginPct: 3, status: 'idle' },
  'fit-size': { ratio: '', bg: '#ffffff', format: 'auto', quality: 88, maxKb: 0, status: 'idle' },
  'frame': { label: '', w: 320, h: 240 },
}

/** 该类型节点的默认模型；不是生成类节点返回 null */
function defaultModelFor(kind: string): string | null {
  if (kind === 'image-gen' || kind === 'image-edit') return defaultModelId('image')
  if (kind === 'video-gen') return defaultModelId('video')
  if (kind === 'video-edit') return defaultVideoEditModelId()
  return null
}

/** 新建节点的初始 data。一个模型都没有时 model 是空串，节点自己会提示去设置 */
function nodeDefaults(kind: NodeKind): Record<string, any> {
  const base = JSON.parse(JSON.stringify(NODE_DEFAULTS[kind] || {}))
  const model = defaultModelFor(kind)
  if (model !== null) base.model = model
  return base
}

/**
 * 模板里的节点 data：模板是别处写好的，里面的 model 在这个实例上不一定存在
 * （没连那个接入、或者模型被停用了），认不出来就换成当前的默认模型。
 */
function templateNodeData(kind: NodeKind, raw: any): Record<string, any> {
  // 模板不带品牌包：放进哪张画布就跟哪张画布的
  const { brandKitOverride: _kit, brandKitId: _oldKit, ...own } = raw || {}
  const data = { ...nodeDefaults(kind), ...own }
  const fallback = defaultModelFor(kind)
  if (fallback !== null && (!data.model || !isModelSupported(data.model))) data.model = fallback
  return data
}

/**
 * 没指定落点的新节点（工具条、素材库加的）放在哪。
 *
 * 在当前视野里从左上往右下一格格找，落在第一块不压着已有节点的空地上 ——
 * 原来固定放在左上角，那里已经有节点时新节点就整个盖在它上面。
 * 视野里摆满了才退回「从左上角逐个错开」，至少每个都露着头。
 */
function freeSpot(): { x: number; y: number } {
  const zoom = viewport.value.zoom || 1
  const toFlow = (sx: number, sy: number) => ({ x: (sx - viewport.value.x) / zoom, y: (sy - viewport.value.y) / zoom })
  const pane = edRef.value?.querySelector('.vf-wrap') as HTMLElement | null
  // 四边让给悬浮块：顶上是标题块，底下是工具条和右下角的生成队列圆钮（两者一样高），
  // 右边是属性面板（开着的话），工具面板贴着哪条边就再让哪条边
  const W = pane?.clientWidth || 1200, H = pane?.clientHeight || 800
  const ins = chromeInsets(W, H)
  const paneW = W - (ins.r - 24)
  const paneH = H - Math.max(80, ins.b - 60)
  // 新节点还没量过尺寸，按常见节点大小留地方（生成节点在布局 c 下更宽更高）；组是一大片底板，不算占位
  const BOX_W = nodeLayout.value === 'c' ? 340 : 300, BOX_H = nodeLayout.value === 'c' ? 420 : 320, GAP = 24
  const boxes = getNodes.value.filter((n: any) => n.type !== 'frame').map(nodeBox)
  const hits = (p: { x: number; y: number }) => boxes.some((b) =>
    p.x < b.right + GAP && p.x + BOX_W + GAP > b.left && p.y < b.bottom + GAP && p.y + BOX_H + GAP > b.top)
  for (let sy = ins.t; sy + BOX_H * zoom <= paneH; sy += (BOX_H + GAP) * zoom) {
    for (let sx = ins.l; sx + BOX_W * zoom <= paneW; sx += (BOX_W + GAP) * zoom) {
      const p = toFlow(sx, sy)
      if (!hits(p)) return p
    }
  }
  const STEP = 30
  const p = toFlow(200, 120)
  const taken = () => boxes.some((b) => Math.abs(b.left - p.x) < STEP / 2 && Math.abs(b.top - p.y) < STEP / 2)
  while (taken()) { p.x += STEP; p.y += STEP }
  return p
}

function addNode(kind: NodeKind, dataOverride?: Record<string, any>, position?: { x: number; y: number }) {
  hist.record()
  const id = genId()
  const node: Node = {
    id,
    type: kind,
    position: position ?? freeSpot(),
    data: { ...nodeDefaults(kind), ...(dataOverride || {}) },
  }
  nodes.value.push(node)
  return id
}

// 素材库「添加到画布」：视频 → video 节点，图片 → image 节点
function onAddAsset(asset: { nodeType: string; mediaUrl: string }) {
  if (!asset?.mediaUrl) return
  if (asset.nodeType === 'VIDEO') {
    addNode('video', { videoUrl: asset.mediaUrl })
  } else {
    addNode('image', { imageUrl: asset.mediaUrl })
  }
  libraryOpen.value = false
  MessagePlugin.success(t('canvas.add.added'))
}

// 文本模板「添加到画布」：新建 text 节点并填入内容
function onAddText(content: string) {
  addNode('text', { text: content || '' })
  libraryOpen.value = false
  MessagePlugin.success(t('canvas.add.added'))
}

// ============ 拖放文件 / 粘贴图片 → 建节点并上传 ============
// 图片 → image 节点，视频 → video 节点；上传成功后节点已带 URL 出现在落点处。

// 上传单个文件并在指定位置建对应节点。失败抛错，由上层统一 toast。
async function addMediaFileNode(file: File, position?: { x: number; y: number }) {
  if (file.type.startsWith('image/')) {
    const url = await uploadCanvasImage(file)
    addNode('image', { imageUrl: url }, position)
  } else if (file.type.startsWith('video/')) {
    const url = await uploadCanvasVideo(file)
    addNode('video', { videoUrl: url }, position)
  } else {
    throw new Error(t('canvas.add.onlyMediaDrop'))
  }
}

// 依次上传多个文件，落点逐个错开，避免节点重叠；逐个 toast 失败原因，不因一个失败中断其余。
async function addMediaFiles(files: File[], basePos?: { x: number; y: number }) {
  const media = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
  if (media.length === 0) {
    MessagePlugin.warning(t('canvas.add.onlyMedia'))
    return
  }
  const loading = MessagePlugin.loading(media.length > 1 ? t('canvas.add.uploadingN', { n: media.length }) : t('common.uploading'), 0)
  let ok = 0
  for (let i = 0; i < media.length; i++) {
    const pos = basePos ? { x: basePos.x + i * 36, y: basePos.y + i * 36 } : undefined
    try {
      await addMediaFileNode(media[i], pos)
      ok++
    } catch (err: any) {
      MessagePlugin.error(t('canvas.add.fileError', { name: media[i].name, msg: apiErrorMessage(err, t('upload.failed')) }))
    }
  }
  MessagePlugin.close(loading)
  if (ok > 0) MessagePlugin.success(ok > 1 ? t('canvas.add.addedN', { n: ok }) : t('canvas.add.added'))
}

// —— 拖放 ——
// dragDepth 计数抵消 dragenter/dragleave 在子元素间冒泡造成的抖动
const dragActive = ref(false)
let dragDepth = 0
function dtHasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types || []).includes('Files')
}
function onDragEnter(e: DragEvent) {
  if (!dtHasFiles(e)) return
  e.preventDefault()
  dragDepth++
  dragActive.value = true
}
function onDragOver(e: DragEvent) {
  if (!dtHasFiles(e)) return
  e.preventDefault()  // 必须阻止默认，drop 才会触发
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}
function onDragLeave(e: DragEvent) {
  if (!dtHasFiles(e)) return
  dragDepth--
  if (dragDepth <= 0) { dragDepth = 0; dragActive.value = false }
}
function onCanvasDrop(e: DragEvent) {
  dragDepth = 0
  dragActive.value = false
  const files = Array.from(e.dataTransfer?.files || [])
  if (files.length === 0) return
  e.preventDefault()
  const pos = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
  addMediaFiles(files, pos)
}

// —— 粘贴图片 ——
// 只在剪贴板含图片文件时接管；纯文本粘贴（如往提示词里粘）走浏览器默认，不干预。
function onCanvasPaste(e: ClipboardEvent) {
  if (readOnly.value || !ownsKeyEvent(e, embed.root)) return
  const items = Array.from(e.clipboardData?.items || [])
  const imgs = items
    .filter(it => it.kind === 'file' && it.type.startsWith('image/'))
    .map(it => it.getAsFile())
    .filter((f): f is File => !!f)
  if (imgs.length === 0) {
    // 系统剪贴板里没有图片：焦点在画布上（不是在输入框里打字）就贴节点剪贴板
    if (!isTypingTarget(e.target) && !anyOverlayOpen() && pasteNodes()) e.preventDefault()
    return
  }
  e.preventDefault()
  // 落在当前视口中心：把画布可视区中点换算成画布坐标
  const el = edRef.value?.querySelector('.vf-wrap') as HTMLElement | null
  const rect = el?.getBoundingClientRect()
  const center = rect
    ? screenToFlowCoordinate({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    : undefined
  addMediaFiles(imgs, center)
}

// 从 handle id 提取数据类型，如 "text-in" -> "text"
function extractDataType(handleId: string | null | undefined): DataType | null {
  if (!handleId) return null
  const prefix = handleId.split('-')[0]
  if (prefix === 'text' || prefix === 'image' || prefix === 'video') return prefix
  return null
}

// 严格类型校验：source 和 target 的数据类型必须一致
// 方向校验：source 端必须是输出口（*-out），target 端必须是输入口（*-in）
// 否则 Vue Flow 会允许从一个 target handle 反向拖到另一个 target handle（例：成品→成品）
function isValidConnection(conn: Connection | Edge): boolean {
  if (conn.source === conn.target) return false
  if (!conn.sourceHandle?.endsWith('-out')) return false
  if (!conn.targetHandle?.endsWith('-in')) return false
  const srcType = extractDataType(conn.sourceHandle)
  const tgtType = extractDataType(conn.targetHandle)
  if (!srcType || !tgtType) return false
  if (srcType !== tgtType) return false
  // 「视频」源节点可连到「视频生成」「视频编辑」或「成品」节点
  const srcNode = nodes.value.find(n => n.id === conn.source)
  if (srcNode?.type === 'video') {
    const tgtNode = nodes.value.find(n => n.id === conn.target)
    if (!['video-gen', 'video-edit', 'video-analysis', 'output'].includes(tgtNode?.type as string)) return false
  }
  return true
}

// 端口连边规则：
//  - 多张图片端口（gen 节点 + image-collection 的 image-in）允许多条
//  - 其它端口（text-in / video-in / output 的 image-in）单条，新连替换旧的
function onConnect(conn: Connection) {
  if (!isValidConnection(conn)) {
    MessagePlugin.warning(t('canvas.connect.typeMismatch'))
    return
  }
  hist.record()
  const targetNode = nodes.value.find(n => n.id === conn.target)
  // 首尾帧模式下「首帧」只收一张：多接一张就会把尾帧挤出提交名单
  // （送出去只取两张，[图1,图2] 一占，尾帧就被静默丢掉了）。
  // 尾帧口本来就不在多图之列，天然单条。
  const framesMode = !!targetNode && targetNode.type === 'video-gen' && isFramesModeData(targetNode.data)
  const isMultiImagePort =
    targetNode
    && conn.targetHandle === 'image-in'
    && MULTI_IMAGE_IN_NODE_TYPES.has(targetNode.type as string)
    && !framesMode
  // 成品节点的视频入口也允许接多个
  const isMultiVideoPort =
    targetNode
    && conn.targetHandle === 'video-in'
    && targetNode.type === 'output'
  // 文本输入一律允许接多条（按连入顺序 / 节点里的 textOrder 拼接）
  const isMultiTextPort =
    targetNode
    && conn.targetHandle === 'text-in'

  if (!isMultiImagePort && !isMultiVideoPort && !isMultiTextPort) {
    edges.value = edges.value.filter(
      (e) => !(e.target === conn.target && e.targetHandle === conn.targetHandle)
    )
  }
  // addEdge 不会套用 default-edge-options，新连线要显式带上 type='glow' 才走 GlowEdge
  edges.value = addEdge({ ...conn, type: 'glow' }, edges.value) as Edge[]
}

function onViewportChange(v: Viewport) {
  viewport.value = v
}

/* ===== 拖动节点时的智能对齐参考线 + 磁吸 ===== */
// 参考线：type='v' 竖线画在屏幕坐标 pos(x)，纵向从 a→b；type='h' 横线画在 pos(y)，横向 a→b
interface AlignGuide {
  type: 'v' | 'h'
  pos: number
  a: number; b: number    // 画线区间：两端各多出 GUIDE_PAD_PX，这段专门用来渐隐
  ca: number; cb: number  // 真正对齐到的内容区间，端点圆点画在这儿
  opacity: number         // 吸附范围内全亮，SNAP→SHOW 之间随距离线性衰减
  center: boolean         // 命中的是中线（画虚线）还是边缘（画实线）
}
const alignGuides = ref<AlignGuide[]>([])
const guidesOn = ref(false)

const SNAP_PX = 6      // 吸附阈值（屏幕像素）：进到这个范围才真的吸过去
const SHOW_PX = 18     // 显示阈值：更早给一根淡线预告，靠近的过程里就有反馈，不是突然被抓走
const RELEASE_PX = 12  // 脱离阈值：吸住后要走出这么远才松开。
                       // 进 6 出 12 的迟滞是「黏性」的来源 —— 没有它，贴着阈值来回蹭时
                       // 会在吸住/松开之间高频切换，那是硬感的另一半，跟颜色无关。
const GUIDE_PAD_PX = 28 // 参考线超出内容的长度，全部用于两端渐隐

// 当前吸住的那条目标线（flow 坐标），null = 没吸住。做迟滞用。
let stickX: number | null = null
let stickY: number | null = null
let guidesHideTimer: number | null = null

interface AlignCand { delta: number; target: number; center: boolean }

/**
 * 从候选里挑一条，并维护迟滞状态。
 * 已经吸住的那条优先，且允许拖到 RELEASE 才松手；没吸住时才按最近的挑。
 */
function chooseGuide(
  cands: AlignCand[],
  stick: number | null,
  snapThr: number,
  releaseThr: number,
): { cand: AlignCand | null; stick: number | null; snapped: boolean } {
  const byDist = (a: AlignCand, b: AlignCand) => Math.abs(a.delta) - Math.abs(b.delta)
  if (stick !== null) {
    const held = cands
      .filter((c) => Math.abs(c.target - stick) < 0.5 && Math.abs(c.delta) <= releaseThr)
      .sort(byDist)[0]
    if (held) return { cand: held, stick, snapped: true }
  }
  const best = cands.slice().sort(byDist)[0]
  if (!best) return { cand: null, stick: null, snapped: false }
  const snapped = Math.abs(best.delta) <= snapThr
  return { cand: best, stick: snapped ? best.target : null, snapped }
}

/** 命中全亮，只是靠近就按距离衰减到很淡 —— 这样"越靠越亮"，而不是突然出现 */
function guideOpacity(delta: number, snapThr: number, showThr: number, snapped: boolean): number {
  if (snapped) return 1
  const d = Math.abs(delta)
  if (d <= snapThr) return 1
  const k = 1 - (d - snapThr) / Math.max(1e-6, showThr - snapThr)
  return 0.1 + 0.45 * Math.max(0, Math.min(1, k))
}

function setGuides(g: AlignGuide[]) {
  if (!g.length) { hideGuides(); return }
  if (guidesHideTimer) { clearTimeout(guidesHideTimer); guidesHideTimer = null }
  alignGuides.value = g
  guidesOn.value = true
}

/** 先把 opacity 过渡到 0，等淡出跑完再清数据；直接清会变成瞬间消失 */
function hideGuides() {
  guidesOn.value = false
  if (guidesHideTimer) clearTimeout(guidesHideTimer)
  guidesHideTimer = window.setTimeout(() => {
    alignGuides.value = []
    guidesHideTimer = null
  }, 140)
}

function nodeBox(n: any) {
  const w = n.dimensions?.width || n.width || 0
  const h = n.dimensions?.height || n.height || 0
  const x = n.computedPosition?.x ?? n.position?.x ?? 0
  const y = n.computedPosition?.y ?? n.position?.y ?? 0
  return { x, y, w, h, left: x, cx: x + w / 2, right: x + w, top: y, cy: y + h / 2, bottom: y + h }
}

function onNodeDragMove(evt: any) {
  const node = evt?.node
  const draggingSet: any[] = evt?.nodes || []
  // 多选一起拖时不做单节点对齐，避免相互干扰
  if (!node || draggingSet.length > 1) { hideGuides(); return }

  const zoom = viewport.value.zoom || 1
  const vp = viewport.value
  // 阈值都是「屏幕像素」语义，换算到 flow 坐标才能跟节点位置比
  const showThr = SHOW_PX / zoom
  const snapThr = SNAP_PX / zoom
  const releaseThr = RELEASE_PX / zoom
  const others = getNodes.value.filter((n: any) => n.id !== node.id)
  if (!others.length) { hideGuides(); return }

  const b = nodeBox(node)
  // [是否中线, 坐标]：中线命中要画虚线，跟边缘对齐区分开
  const dragV: [boolean, number][] = [[false, b.left], [true, b.cx], [false, b.right]]
  const dragH: [boolean, number][] = [[false, b.top], [true, b.cy], [false, b.bottom]]

  const candX: AlignCand[] = []
  const candY: AlignCand[] = []
  for (const o of others) {
    const ob = nodeBox(o)
    const tgtV: [boolean, number][] = [[false, ob.left], [true, ob.cx], [false, ob.right]]
    const tgtH: [boolean, number][] = [[false, ob.top], [true, ob.cy], [false, ob.bottom]]
    for (const [dc, dv] of dragV) {
      for (const [tc, tv] of tgtV) {
        const delta = tv - dv
        if (Math.abs(delta) <= showThr) candX.push({ delta, target: tv, center: dc || tc })
      }
    }
    for (const [dc, dh] of dragH) {
      for (const [tc, th] of tgtH) {
        const delta = th - dh
        if (Math.abs(delta) <= showThr) candY.push({ delta, target: th, center: dc || tc })
      }
    }
  }

  const rx = chooseGuide(candX, stickX, snapThr, releaseThr)
  const ry = chooseGuide(candY, stickY, snapThr, releaseThr)
  stickX = rx.stick
  stickY = ry.stick

  // 吸附：position 供保存/连线，computedPosition 才是实际渲染位置，两者都要改。
  // 只有真吸住（含迟滞保持）才动位置；纯预告态不碰节点，否则线还没亮就被拽走了。
  if (rx.cand && rx.snapped && rx.cand.delta) {
    node.position.x += rx.cand.delta
    if (node.computedPosition) node.computedPosition.x += rx.cand.delta
  }
  if (ry.cand && ry.snapped && ry.cand.delta) {
    node.position.y += ry.cand.delta
    if (node.computedPosition) node.computedPosition.y += ry.cand.delta
  }

  // 吸附后重算盒子，让参考线跨越所有对齐到该线的节点
  const nb = nodeBox(node)
  const EPS = 0.5
  const guides: AlignGuide[] = []
  if (rx.cand) {
    const tx = rx.cand.target
    let lo = nb.top, hi = nb.bottom
    for (const o of others) {
      const ob = nodeBox(o)
      if (Math.abs(ob.left - tx) < EPS || Math.abs(ob.cx - tx) < EPS || Math.abs(ob.right - tx) < EPS) {
        lo = Math.min(lo, ob.top); hi = Math.max(hi, ob.bottom)
      }
    }
    const ca = lo * zoom + vp.y
    const cb = hi * zoom + vp.y
    guides.push({
      type: 'v', pos: tx * zoom + vp.x,
      ca, cb, a: ca - GUIDE_PAD_PX, b: cb + GUIDE_PAD_PX,
      opacity: guideOpacity(rx.cand.delta, snapThr, showThr, rx.snapped),
      center: rx.cand.center,
    })
  }
  if (ry.cand) {
    const ty = ry.cand.target
    let lo = nb.left, hi = nb.right
    for (const o of others) {
      const ob = nodeBox(o)
      if (Math.abs(ob.top - ty) < EPS || Math.abs(ob.cy - ty) < EPS || Math.abs(ob.bottom - ty) < EPS) {
        lo = Math.min(lo, ob.left); hi = Math.max(hi, ob.right)
      }
    }
    const ca = lo * zoom + vp.x
    const cb = hi * zoom + vp.x
    guides.push({
      type: 'h', pos: ty * zoom + vp.y,
      ca, cb, a: ca - GUIDE_PAD_PX, b: cb + GUIDE_PAD_PX,
      opacity: guideOpacity(ry.cand.delta, snapThr, showThr, ry.snapped),
      center: ry.cand.center,
    })
  }
  setGuides(guides)
}

// 拖动开始就得记：拖完再记，快照里已经是新位置了，撤销回去等于没撤
let dragStartPositions: string | null = null
function posFingerprint() {
  return JSON.stringify(nodes.value.map((n) => [n.id, n.position?.x, n.position?.y]))
}
function onNodeDragStart() {
  hist.record()
  dragStartPositions = posFingerprint()
}

function onNodeDragStop() {
  stickX = null
  stickY = null
  hideGuides()
  // d3-drag 的 start 在 mousedown 就触发了 —— 只是点一下节点也会走一遍。
  // 位置没变就把刚记的那格丢掉，否则点几下就把历史挤满了。
  if (dragStartPositions !== null) {
    if (posFingerprint() === dragStartPositions) hist.drop()
    dragStartPositions = null
  }
}

async function doSave(silent: boolean): Promise<boolean> {
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null }
  autoSaveDueBy = 0
  // 只读：什么都不往外写（视口也不存）
  if (readOnly.value) return false
  const content = buildContent()
  const fp = JSON.stringify(content)
  const vp = { ...viewport.value }
  // 改版前排的画布查过一遍之后，随这次保存把标记清掉（见 checkLegacyLayout）
  const clearLegacy = legacyLayoutChecked
  try {
    if (!currentId.value) {
      if (!silent) MessagePlugin.error(t('canvas.save.notLoaded'))
      return false
    }
    if (viewportTimer) { clearTimeout(viewportTimer); viewportTimer = null }
    const res = await workflowApi.update(currentId.value, { ...content, viewport: vp, ...(clearLegacy ? { legacyLayout: false as const } : {}) })

    if (res.data.result === 0 && res.data.data) {
      lastSavedAt.value = res.data.data.updatedAt
      lastFingerprint = fp
      savedViewportKey = viewportKey(vp)
      embed.emit('saved', { canvasId: currentId.value, updatedAt: res.data.data.updatedAt })
      if (clearLegacy) legacyLayoutChecked = false
      dirty.value = false
      saveFailed.value = false
      if (!silent) MessagePlugin.success(t('common.saved'))
      return true
    }
    saveFailed.value = true
    // 后端拒绝（如 payload 超限）即使是自动保存也要 toast，避免用户不知情地一直丢失改动
    MessagePlugin.error(res.data.message || t('canvas.save.failed'))
    return false
  } catch (err: any) {
    saveFailed.value = true
    const msg = apiErrorMessage(err, t('canvas.save.failed'))
    const status = err?.response?.status
    // 4xx 业务/校验错误，自动保存也要提示；网络/5xx 类只记日志，避免反复打扰
    if (!silent || (typeof status === 'number' && status >= 400 && status < 500)) {
      MessagePlugin.error(msg)
    } else {
      console.error('[auto-save] failed:', err)
    }
    return false
  }
}

async function handleSave() {
  saving.value = true
  try {
    await doSave(false)
  } finally {
    saving.value = false
  }
}

async function autoSave() {
  autoSaveTimer = null
  autoSaveDueBy = 0
  if (saving.value || autoSaving.value) return
  // 空画布且未持久化过 → 不创建
  if (!currentId.value && nodes.value.length === 0) return
  const fp = buildFingerprint()
  if (fp === lastFingerprint) {
    dirty.value = false
    return
  }
  autoSaving.value = true
  try {
    // 先告诉宿主「内容变了」（change 事件 / onChange），再存
    embed.emit('change', { canvasId: currentId.value || '', document: buildDocument() })
    await doSave(true)
  } finally {
    autoSaving.value = false
  }
}

function scheduleAutoSave() {
  if (suppressAutoSave || readOnly.value) return
  dirty.value = true
  const now = Date.now()
  // 只嵌编辑器时停手多久算「改完了」由宿主定（changeDebounceMs）
  const delay = host ? host.changeDebounceMs : AUTO_SAVE_DELAY
  if (!autoSaveDueBy) autoSaveDueBy = now + Math.max(AUTO_SAVE_MAX_WAIT, delay)
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = window.setTimeout(autoSave, Math.max(0, Math.min(delay, autoSaveDueBy - now)))
}

/**
 * 视口单独存：平移 / 缩放不是「改动」，不置 dirty，也不让保存状态闪成「未保存 / 保存中」。
 * 停手一会儿后悄悄只把视口发给后端（后端对只带视口的保存不更新 updatedAt），
 * 下次打开还在原来看的位置。失败了无所谓：下一次内容保存会把视口一起带上。
 */
const VIEWPORT_SAVE_DELAY = 1200
let viewportTimer: number | null = null
function scheduleViewportSave() {
  if (suppressAutoSave || !currentId.value || readOnly.value) return
  if (viewportTimer) clearTimeout(viewportTimer)
  viewportTimer = window.setTimeout(() => { void saveViewport() }, VIEWPORT_SAVE_DELAY)
}
async function saveViewport() {
  if (viewportTimer) { clearTimeout(viewportTimer); viewportTimer = null }
  const id = currentId.value
  const vp = { ...viewport.value }
  const key = viewportKey(vp)
  if (!id || key === savedViewportKey) return
  try {
    await workflowApi.update(id, { viewport: vp })
    if (currentId.value === id) savedViewportKey = key
  } catch { /* 见上：丢一次视口不值得打扰用户 */ }
}

// 拆分自动保存监听：只有 nodes/edges 需要深度遍历；workflowName 是字符串，浅监听即可。
// viewport（平移/缩放高频变化）不走这条路，见上面的 scheduleViewportSave。
watch([nodes, edges], scheduleAutoSave, { deep: true })
watch(viewport, scheduleViewportSave)
watch(workflowName, scheduleAutoSave)
watch(bgSettings, scheduleAutoSave, { deep: true })
watch(canvasKitId, scheduleAutoSave)

// ============ 项目切换 / 加载其他画布 ============
const projList = ref<any[]>([])
const projLoading = ref(false)
const projMenuOpen = ref(false)
const importPickerOpen = ref(false)
const otherCanvases = computed(() => projList.value.filter((w: any) => w.id !== currentId.value))
async function loadProjList() {
  projLoading.value = true
  try { const r = await workflowApi.list(); if (r.data.result === 0) projList.value = r.data.data || [] }
  catch { /* 拉不到不影响画布 */ } finally { projLoading.value = false }
}
function toggleProjMenu() {
  projMenuOpen.value = !projMenuOpen.value
  if (projMenuOpen.value) loadProjList()
}
async function switchToCanvas(id: string) {
  projMenuOpen.value = false
  if (!id || id === currentId.value) return
  if (dirty.value) await doSave(true)
  if (host) { host.canvasId.value = id; return }
  router.push(`/canvas/${id}`)
}
function openImportPicker() {
  projMenuOpen.value = false
  importPickerOpen.value = true
  loadProjList()
}
function importCanvas(w: any) {
  importPickerOpen.value = false
  loadOtherCanvasInto(w.id)
}
// 把另一张画布的全部数据加载进当前画布：节点重新分配 id、整体偏移到当前视口，
// 避免和已有节点冲突/重叠；组的父子关系一并重映射；带上结果图/参考图（引用），
// 但去掉在途轮询句柄 taskId，避免跨画布重复轮询。
async function loadOtherCanvasInto(id: string) {
  try {
    const r = await workflowApi.detail(id)
    if (r.data.result !== 0 || !r.data.data) { MessagePlugin.error(r.data.message || t('common.loadFailed')); return }
    const w: any = r.data.data
    const srcNodes: any[] = w.nodes || []
    const srcEdges: any[] = w.edges || []
    if (!srcNodes.length) { MessagePlugin.warning(t('canvas.project.sourceEmpty')); return }
    hist.record()
    const idMap = new Map<string, string>()
    for (const n of srcNodes) idMap.set(n.id, genId())
    const origin = insertOrigin()
    const roots = srcNodes.filter((n: any) => !(n.parentNode && idMap.has(n.parentNode)))
    const baseX = origin.x - Math.min(...roots.map((n: any) => n.position?.x || 0))
    const baseY = origin.y - Math.min(...roots.map((n: any) => n.position?.y || 0))
    // 那张画布套用的品牌包跟这张不一样时，原来「跟随画布」的生成节点在这里钉成各自的例外，
    // 这样搬过来之后每个节点套用的还是原来那一个。
    const srcKit = typeof w.brandKitId === 'string' ? w.brandKitId : ''
    const pinKit = srcKit !== canvasKitId.value ? (srcKit || KIT_NONE) : ''
    const newNodes = srcNodes.map((n: any) => {
      const isChild = !!n.parentNode && idMap.has(n.parentNode)
      const data: any = JSON.parse(JSON.stringify(stripNodeData(n.data)))
      delete data.taskId; delete data.taskIds; delete data.runPending
      if (pinKit && BRAND_KIT_NODE_TYPES.includes(n.type) && !data.brandKitOverride) data.brandKitOverride = pinKit
      const nn: any = {
        id: idMap.get(n.id)!,
        type: n.type,
        position: isChild
          ? { x: n.position?.x || 0, y: n.position?.y || 0 }
          : { x: baseX + (n.position?.x || 0), y: baseY + (n.position?.y || 0) },
        data,
      }
      if (isChild) { nn.parentNode = idMap.get(n.parentNode); nn.extent = n.extent }
      if (n.dimensions) nn.dimensions = n.dimensions
      if (n.style) nn.style = n.style
      if (GEN_MEDIA_TYPES.includes(n.type)) {
        if (data.imageUrl || data.videoUrl) data.status = 'done'
        else if (data.errorMsg) data.status = 'error'
      }
      return nn as Node
    })
    const newEdges: Edge[] = srcEdges
      .filter((e: any) => idMap.has(e.source) && idMap.has(e.target))
      .map((e: any) => ({
        id: `e_${genId()}`,
        source: idMap.get(e.source)!, target: idMap.get(e.target)!,
        sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, type: 'glow',
      }) as Edge)
    nodes.value = [...nodes.value, ...newNodes]
    edges.value = [...edges.value, ...newEdges]
    fitToNodes = newNodes.map((n) => n.id)
    MessagePlugin.success(t('canvas.project.imported', { name: w.name, n: newNodes.length }))
  } catch (e: any) {
    MessagePlugin.error(apiErrorMessage(e, t('common.loadFailed')))
  }
}

function goToList() {
  // 只嵌编辑器：「返回」去哪儿是宿主的事
  if (host) { host.onBack?.(); return }
  router.push('/canvases')
}

/** 画布打不开（不存在、没权限、网络错）之后去哪儿：有列表页回列表页，没有就留在原地（错误已经告诉宿主了） */
function leaveBrokenCanvas(message: string, cause?: unknown) {
  embed.emit('error', { scope: 'load', message, cause })
  if (!host && isPageAllowed(embed.pages, 'canvases')) router.replace('/canvases')
}

// ============ 素材库 / 我的分享 弹窗 ============
const libraryOpen = ref(false)
const libraryInitialTab = ref<'material' | 'mine'>('material')

function openLibrary() {
  libraryInitialTab.value = 'material'
  libraryOpen.value = true
}

function goToMyShares() {
  libraryInitialTab.value = 'mine'
  libraryOpen.value = true
}

// 画布模板弹窗
const templateDialogOpen = ref(false)
const guideOpen = ref(false)
// 教程打开时先跳到哪一节（'' = 从头看）；「快捷键」入口用它直达那一节
const guideSection = ref('')
function openGuide(section: string) {
  guideSection.value = section
  guideOpen.value = true
}
function openTemplates() {
  templateDialogOpen.value = true
}

// 应用模板：把预设节点图重新生成 id、偏移到当前视口，插入现有画布（不清空已有内容）
function applyTemplate(tpl: { title?: string; graph?: { nodes?: any[]; edges?: any[] } }) {
  const g = tpl?.graph
  if (!g || !Array.isArray(g.nodes) || g.nodes.length === 0) {
    MessagePlugin.warning(t('canvas.tpl.emptyContent'))
    return
  }
  hist.record()
  // 模板局部 id → 新的全局 id
  const idMap = new Map<string, string>()
  for (const n of g.nodes) idMap.set(n.id, genId())

  // 基准点：空画布放视野左上，否则接在现有内容下方（见 insertOrigin）；模板自身的最小坐标对到基准点上
  const origin = insertOrigin()
  const baseX = origin.x - Math.min(...g.nodes.map((n: any) => n.position?.x || 0))
  const baseY = origin.y - Math.min(...g.nodes.map((n: any) => n.position?.y || 0))

  const newNodes: Node[] = g.nodes.map((n: any) => ({
    id: idMap.get(n.id)!,
    type: n.type,
    position: {
      x: baseX + (n.position?.x || 0),
      y: baseY + (n.position?.y || 0),
    },
    data: templateNodeData(n.type as NodeKind, n.data),
  }))

  const newEdges: Edge[] = (g.edges || [])
    .filter((e: any) => idMap.has(e.source) && idMap.has(e.target))
    .map((e: any) => ({
      id: `e_${genId()}`,
      source: idMap.get(e.source)!,
      target: idMap.get(e.target)!,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      type: 'glow',
    }))

  // 模板可声明「默认成组」：把整套节点圈进一个画框，方便整体拖动 / 删除
  if ((g as any).group && newNodes.length) {
    const PAD = 28, PAD_TOP = 34
    const TYPE_SIZE: Record<string, { w: number; h: number }> = {
      image: { w: 260, h: 300 }, 'image-collection': { w: 260, h: 300 },
      text: { w: 280, h: 240 },
    }
    // 生成节点的大小跟着当前布局走
    const est = (type: string) => (isGenNodeKind(type) ? genNodeSize(type, nodeLayout.value) : TYPE_SIZE[type] || { w: 260, h: 220 })
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of newNodes) {
      const sz = est(n.type as string)
      minX = Math.min(minX, n.position.x); minY = Math.min(minY, n.position.y)
      maxX = Math.max(maxX, n.position.x + sz.w); maxY = Math.max(maxY, n.position.y + sz.h)
    }
    const fpos = { x: minX - PAD, y: minY - PAD_TOP }
    const fw = Math.round(maxX - minX + PAD * 2)
    const fh = Math.round(maxY - minY + PAD_TOP + PAD)
    const frameId = genId()
    const frame = {
      id: frameId, type: 'frame', position: fpos,
      data: { label: tpl.title || '', w: fw, h: fh },
      dimensions: { width: fw, height: fh }, selectable: true,
    } as unknown as Node
    for (const n of newNodes) {
      ;(n as any).parentNode = frameId
      ;(n as any).extent = 'parent'
      n.position = { x: n.position.x - fpos.x, y: n.position.y - fpos.y }
    }
    nodes.value = [...nodes.value, frame, ...newNodes]
  } else {
    nodes.value = [...nodes.value, ...newNodes]
  }
  edges.value = [...edges.value, ...newEdges]
  fitToNodes = newNodes.map((n) => n.id)
  templateDialogOpen.value = false
  MessagePlugin.success(t('canvas.tpl.added', { title: tpl.title || '' }))
}

// ============ 分享链接 ============
// 分享 = 给当前画布存一份只读快照并发一个链接；有效期可选，0 表示永久
type ShareExpiry = 0 | 1 | 7 | 30
const shareOpen = ref(false)
const publishing = ref(false)
const shareForm = ref<{ title: string; description: string; expiresInDays: ShareExpiry }>({
  title: '', description: '', expiresInDays: 7,
})
const shareResult = ref<{ link: string; expiresAt: string | null } | null>(null)

const shareExpiryOptions = computed<{ value: ShareExpiry; label: string }[]>(() => [
  { value: 1, label: t('canvas.share.expiry1') },
  { value: 7, label: t('canvas.share.expiry7') },
  { value: 30, label: t('canvas.share.expiry30') },
  { value: 0, label: t('canvas.share.expiryNever') },
])

/** 分享链接的地址：按本产品的路由拼（挂在子路径下、hash 路由都对）；只嵌编辑器时没有分享页，由适配器的 share.linkFor 给 */
function defaultShareLink(token: string): string {
  try { return new URL(router.resolve({ name: 'share', params: { token } }).href, location.href).href }
  catch { return `${location.origin}/share/${token}` }
}
function openShareDialog() {
  if (!currentId.value) {
    MessagePlugin.warning(t('canvas.share.notLoaded'))
    return
  }
  if (nodes.value.length === 0) {
    MessagePlugin.warning(t('canvas.share.empty'))
    return
  }
  shareForm.value = {
    title: workflowName.value?.trim() || t('canvas.untitled'),
    description: '',
    expiresInDays: shareForm.value.expiresInDays,
  }
  shareResult.value = null
  shareOpen.value = true
}

function closeShareDialog() {
  if (publishing.value) return
  shareOpen.value = false
}

async function handlePublish() {
  if (!currentId.value) return
  publishing.value = true
  try {
    // 先把最新改动落库，确保分享的是当前画布；没存上就别发链接，否则分享出去的是旧内容
    if (dirty.value && !(await doSave(true))) {
      MessagePlugin.error(t('canvas.save.failed'))
      return
    }
    const res = await canvasShareApi.publish({
      workflowId: currentId.value,
      title: shareForm.value.title.trim() || undefined,
      description: shareForm.value.description.trim() || undefined,
      // 永久也要明说（0）：同一张画布再次发布时，不带这个字段表示「沿用原来的有效期」
      expiresInDays: shareForm.value.expiresInDays,
    })
    const data = res.data.data
    if (res.data.result === 0 && data?.token) {
      shareResult.value = {
        link: shareLinkFor(data.token, defaultShareLink(data.token)),
        expiresAt: data.expiresAt || null,
      }
      MessagePlugin.success(data.updated ? t('canvas.share.updated') : t('canvas.share.created'))
    } else {
      MessagePlugin.error(res.data.message || t('canvas.share.failed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('canvas.share.failed')))
  } finally {
    publishing.value = false
  }
}

function selectAllText(e: FocusEvent) {
  (e.target as HTMLInputElement | null)?.select()
}

async function copyShareLink() {
  const link = shareResult.value?.link
  if (!link) return
  try {
    await navigator.clipboard.writeText(link)
    MessagePlugin.success(t('common.copied'))
  } catch {
    // 非安全上下文（用 http 加局域网 IP 访问自建实例很常见）下没有 clipboard API，退回老办法
    const ta = document.createElement('textarea')
    ta.value = link
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    if (ok) MessagePlugin.success(t('common.copied'))
    else MessagePlugin.error(t('common.copyFailed'))
  }
}

/**
 * 没存过视口的画布（新建的、从模板或接口建的）第一次打开时，把内容框进视野：
 * 视口停在默认的原点上，靠近原点的节点正好压在左侧浮动工具条底下。
 * 要等节点量完尺寸才能算包围盒，所以挂在 onNodesInitialized 上；
 * 存过视口的画布不走这里，原样还原用户上次看的位置。
 */
let fitOnInit = false
// 套模板 / 加载其他画布插进来的那批节点：量完尺寸后把视野移过去
let fitToNodes: string[] | null = null
onNodesInitialized(() => {
  if (legacyLayoutPending) {
    legacyLayoutPending = false
    fitOnInit = false
    fitToNodes = null
    void checkLegacyLayout()
  } else if (fitOnInit) {
    fitOnInit = false
    fitToNodes = null
    fitFree({ maxZoom: 1 })
    if (layoutCheckPending) { layoutCheckPending = false; void checkLayoutFit('open') }
  } else if (layoutCheckPending) {
    layoutCheckPending = false
    void checkLayoutFit('open')
  } else if (fitToNodes) {
    const ids = fitToNodes
    fitToNodes = null
    fitFree({ nodes: ids, maxZoom: 1, duration: 300 })
  }
})

/**
 * 改版前排的画布，只查一次。
 *
 * 改版后生成类节点高了一倍左右，老画布里上下相邻的节点现在会互相压着。后端在读到老画布时
 * 打了个标记（legacyLayout），这里第一次打开时：
 *   1. 先把全部内容框进视野 —— 开着 only-render-visible-elements，视野外的节点没渲染、量不到尺寸；
 *   2. 按实测尺寸看散节点有没有真的叠在一起；
 *   3. 叠了才整理（就是工具条上那个「自动整理」），记一笔历史，Ctrl+Z 或提示条上的「撤销」都能退回去；
 *      没叠就一个位置都不动，视野也还原。
 * 不管整没整理，标记都随即清掉，这张画布以后再也不会走这里；改版后新建、保存过的画布没有这个标记。
 */
let legacyLayoutPending = false
let legacyLayoutChecked = false
/** 刚载入的画布还没查过「在别的节点布局下排的、现在压住了没有」（见 checkLayoutFit） */
let layoutCheckPending = false

/** 等节点量完尺寸：都有宽高了就走，最多等 timeout 毫秒（缩放到下限还框不全的大画布会剩几个量不到，按类型估） */
function waitForMeasured(timeout = 1500): Promise<void> {
  const started = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      const pending = (nodes.value as any[]).some((n) => !(findNode(n.id)?.dimensions?.height))
      if (!pending || Date.now() - started > timeout) resolve()
      else window.setTimeout(tick, 60)
    }
    window.setTimeout(tick, 60)
  })
}

async function checkLegacyLayout() {
  const id = currentId.value
  if (!id) return
  const before = { ...viewport.value }
  const hadViewport = !!(before.x || before.y || (before.zoom || 1) !== 1)
  fitFree({ maxZoom: 1 })
  await waitForMeasured()
  if (currentId.value !== id) return
  legacyLayoutChecked = true
  if (layout.hasOverlap()) {
    hist.record()
    if (await layout.arrange()) {
      if (currentId.value !== id) return
      arrangedLayout.value = nodeLayout.value
      showLayoutUndo(t('canvas.layout.legacyArranged'))
      // 新位置和「已查过」一起落库；之后撤销也只是一次普通的改动
      await doSave(true)
      return
    }
    hist.drop()
  } else if (hadViewport) {
    setViewport(before)
  }
  if (currentId.value !== id) return
  // 没动任何位置：只把标记清掉（后端对这种保存不更新 updatedAt）
  try {
    await workflowApi.update(id, { legacyLayout: false })
    legacyLayoutChecked = false
  } catch { /* 清不掉就留着，下次保存内容时会再带一次 */ }
}

/**
 * 把内容框进「没被控件盖住」的那块区域。
 *
 * vue-flow 自带的 fitView 按整块画布居中，而画布四周浮着标题块、工具面板、工具条、
 * 小地图和右下角的生成队列圆钮 —— 照它的算法，边上的节点正好压在这些块底下。这里按
 * 四边各自让出的宽度算视口（见 chromeInsets），其余（只框某几个节点、缩放上限、动画时长）与 fitView 的用法一致。
 * 圆钮不单独让位：桌面上它和工具条、小地图同在底边那一条里；手机上底边多让出它那一层。
 * 它被拖到别处之后不再跟着让 —— 那是用户自己挑的位置，和别的小控件一样允许节点从底下过。
 */
function fitFree(opts: { nodes?: string[]; maxZoom?: number; duration?: number } = {}) {
  const pane = edRef.value?.querySelector('.vf-wrap') as HTMLElement | null
  const only = opts.nodes ? new Set(opts.nodes) : null
  // 不能用 getNodes / nodeBox：开了 only-render-visible-elements 之后，getNodes 只给视野里
  // 的那几个节点 —— 照它算，「适应屏幕」永远只框得住眼下已经看得见的。这里从完整的 nodes
  // 取 position（子节点叠上父节点的），尺寸问 vue-flow 要，量不到的按常见节点大小估。
  const all = nodes.value as any[]
  const byId = new Map(all.map((n) => [n.id, n]))
  const absPos = (n: any): { x: number; y: number } => {
    const p = n.parentNode ? byId.get(n.parentNode) : null
    const base = p ? absPos(p) : { x: 0, y: 0 }
    return { x: base.x + (n.position?.x || 0), y: base.y + (n.position?.y || 0) }
  }
  const boxes = all.filter((n) => !only || only.has(n.id)).map((n) => {
    const { x, y } = absPos(n)
    const dim = measuredSize(n.id)
    const est = estimateNodeSize(n.type, nodeLayout.value)
    const w = dim?.width || est.w, h = dim?.height || est.h
    return { left: x, top: y, right: x + w, bottom: y + h }
  })
  if (!pane || !boxes.length) return
  const W = pane.clientWidth, H = pane.clientHeight
  paneWidth.value = W
  const inset = chromeInsets(W, H)
  const freeW = Math.max(120, W - inset.l - inset.r)
  const freeH = Math.max(120, H - inset.t - inset.b)
  const minX = Math.min(...boxes.map((b) => b.left)), maxX = Math.max(...boxes.map((b) => b.right))
  const minY = Math.min(...boxes.map((b) => b.top)), maxY = Math.max(...boxes.map((b) => b.bottom))
  const zoom = Math.max(MIN_ZOOM, Math.min(opts.maxZoom ?? 2, freeW / (maxX - minX), freeH / (maxY - minY)))
  setViewport({
    x: inset.l + (freeW - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: inset.t + (freeH - (maxY - minY) * zoom) / 2 - minY * zoom,
    zoom,
  }, { duration: opts.duration || 0 })
}

/**
 * 一整批节点（模板、另一张画布）插到哪：画布是空的就放在视野左上；
 * 已经有内容就接在现有内容的正下方 —— 原来一律放视野左上，会整片压在现有节点上。
 */
function insertOrigin(): { x: number; y: number } {
  const boxes = getNodes.value.map(nodeBox)
  if (!boxes.length) {
    return { x: -viewport.value.x / viewport.value.zoom + 120, y: -viewport.value.y / viewport.value.zoom + 80 }
  }
  return { x: Math.min(...boxes.map((b) => b.left)), y: Math.max(...boxes.map((b) => b.bottom)) + 80 }
}

async function loadWorkflow(id: string) {
  loading.value = true
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null }
  suppressAutoSave = true
  try {
    const res = await workflowApi.detail(id)
    if (res.data.result === 0 && res.data.data) {
      applyWorkflow(res.data.data)
      if (!readyAnnounced) { readyAnnounced = true; embed.emit('ready', { canvasId: currentId.value || id }) }
    } else {
      MessagePlugin.error(res.data.message || t('common.loadFailed'))
      leaveBrokenCanvas(res.data.message || t('common.loadFailed'))
    }
  } catch (err: any) {
    MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
    leaveBrokenCanvas(apiErrorMessage(err, t('common.loadFailed')), err)
  } finally {
    loading.value = false
    setTimeout(() => { suppressAutoSave = false }, 0)
  }
}
let readyAnnounced = false

/** 把一份画布（接口返回的，或宿主直接给的文档）铺到编辑器里 */
function applyWorkflow(w: any) {
    {
      // 剥离瞬时字段，避免还原出"运行中"等历史状态；
      // 但 gen 节点要根据持久化的产物/错误推导出最终展示态：
      //  - 已有产物 → status='done'
      //  - 已落库错误 → status='error'（避免再被 resumeIncompleteTasks 轮询一次才显示失败）
      //  - 其它（只有 taskId）→ 留空，由 resumeIncompleteTasks 接管为 running
      // 文本任务节点（大语言模型 / 视频分析）成功时会清掉 errorMsg，所以存着 errorMsg
      // 就是最近一次运行失败了；有没有文字由节点自己显示，这里只还原失败态。
      nodes.value = (w.nodes || []).map((n: any) => {
        const data = stripNodeData(n.data)
        if (GEN_MEDIA_TYPES.includes(n.type)) {
          if (data.imageUrl || data.videoUrl) {
            data.status = 'done'
          } else if (data.errorMsg) {
            data.status = 'error'
          }
        } else if (TEXT_TASK_TYPES.includes(n.type) && data.errorMsg) {
          data.status = 'error'
        }
        // 有一版的组存过 style.pointerEvents:'none'（那时组做成穿透的）。
        // 留着会让老画布里的组点不动也拖不了，读进来就清掉。
        if (n.type === 'frame' && n.style && 'pointerEvents' in n.style) {
          const { pointerEvents: _pe, ...restStyle } = n.style
          return { ...n, data, style: restStyle }
        }
        return { ...n, data }
      })
      // 老画布存的 edge 可能是 smoothstep / default，统一拉到 glow 应用新样式
      edges.value = (w.edges || []).map((e: any) => ({ ...e, type: 'glow' }))
      // 老画布没有 settings，normalizeCanvasBg 会兜底到默认底色 = 改动前的行为
      bgSettings.value = normalizeCanvasBg((w as any).settings?.bg)
      canvasKitId.value = w.brandKitId || ''
      {
        const saved = (w as any).settings?.nodeLayout
        arrangedLayout.value = saved === 'a' || saved === 'b' || saved === 'c' ? saved : ''
        layoutNote.value = { visible: false, text: '' }
        // 一个节点都没有的画布无所谓在哪种布局下排的：记成当前的
        if (!nodes.value.length) arrangedLayout.value = nodeLayout.value
      }
      const vp = w.viewport || { x: 0, y: 0, zoom: 1 }
      fitOnInit = nodes.value.length > 0 && !vp.x && !vp.y && (vp.zoom || 1) === 1
      legacyLayoutPending = !!w.legacyLayout && nodes.value.length > 1
      legacyLayoutChecked = false
      layoutCheckPending = !legacyLayoutPending && nodes.value.length > 1 && arrangedLayout.value !== nodeLayout.value
      savedViewportKey = viewportKey(vp)
      viewport.value = vp
      // 把 zoom 钳制在 [0.2, 2]，防止历史脏数据把节点撑爆
      setViewport({ x: vp.x, y: vp.y, zoom: Math.min(2, Math.max(0.2, vp.zoom || 1)) })
      workflowName.value = w.name
      currentId.value = w.id
      lastSavedAt.value = w.updatedAt
      lastFingerprint = buildFingerprint()
      dirty.value = false
      saveFailed.value = false
      // 换画布要清历史，否则能「撤销」到上一张画布的内容
      hist.reset()
      // 对刷新前还在跑的 task，自动恢复轮询拉结果
      setTimeout(() => {
        // 只读：不接着轮询，也不改节点上的东西
        if (readOnly.value) return
        executor.resumeIncompleteTasks()
        // 存着的失败原因是当时界面语言的一句话，按现在的语言重取
        void executor.refreshRunErrors()
      }, 100)
    }
}

function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 保存状态里的时间：今天的只写时分，更早的带上日期 */
function formatSavedTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return d.toDateString() === new Date().toDateString() ? time : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value || autoSaving.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}

// 路由内导航（点击侧栏 / 浏览器后退）— 自定义确认 + 自动保存
// 注意：vue-router 4 中，async 守卫返回的 Promise 会被优先采用为决策结果；
// 如果在 async 函数里只调用 next() 而不 await，函数会立刻 resolve 为 undefined，
// 路由会把它当作"放行"，对话框还没显示就已经跳走了。
// 这里改为返回 Promise<boolean>，等用户在对话框中做出选择再 resolve。
let bypassRouteGuard = false
onBeforeRouteLeave((_to, _from) => {
  if (bypassRouteGuard) return true
  if (!dirty.value && !autoSaving.value) return true
  return new Promise<boolean>((resolve) => {
    const dlg = DialogPlugin.confirm({
      header: t('canvas.leave.title'),
      body: t('canvas.leave.body'),
      confirmBtn: t('canvas.leave.confirm'),
      cancelBtn: t('canvas.leave.cancel'),
      // 必须点按钮做出选择 —— 不能点遮罩 / Esc / 右上角叉自动取消
      closeOnOverlayClick: false,
      closeOnEscKeydown: false,
      closeBtn: false,
      onConfirm: async () => {
        try { await doSave(true) } catch {}
        bypassRouteGuard = true
        dlg.destroy()
        resolve(true)
      },
      onCancel: () => {
        dlg.destroy()
        resolve(false)
      },
    })
  })
})

/* ==================== 节点搜索 ==================== */
// 500 个节点靠肉眼找不现实。搜提示词 / 文本 / 模型 / 节点类型名，命中就飞过去。
const searchOpen = ref(false)
const searchKw = ref('')

const searchResults = computed(() => {
  const kw = searchKw.value.trim()
  if (!kw) return []
  return nodes.value
    .filter((n: any) => matchNode(n, kw, nodeTypeLabel))
    .slice(0, 30)
    .map((n: any) => ({
      id: n.id,
      type: nodeTypeLabel(String(n.type || '')),
      // 摘一句能认出来的：优先提示词，其次文本内容
      brief: String(n.data?.prompt || n.data?.instruction || n.data?.text || n.data?.label || '').slice(0, 40),
    }))
})

function openSearch() {
  searchOpen.value = true
  nextTick(() => searchInputRef.value?.focus())
}
const searchInputRef = ref<HTMLInputElement | null>(null)

function gotoNode(id: string) {
  // 不能从 getNodes 里找：开了 only-render-visible-elements，视野外的节点不在里面，
  // 而从队列 / 搜索点过来的恰恰多半是看不见的那个
  const n = findNode(id)
  if (!n) return
  fitFree({ nodes: [id], maxZoom: 1, duration: 300 })
  // 只留这一个选中：从队列或搜索点过来，要的是「就是它」
  removeSelectedNodes(getSelectedNodes.value)
  addSelectedNodes([n as any])
}

/* ==================== 键盘快捷键 ==================== */
/**
 * 只在「画布本身」有焦点时生效。节点里的提示词是 textarea，在里面按
 * Ctrl+A / Delete / Ctrl+Z 必须是文本框自己的行为，不能被画布截走。
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return el.isContentEditable === true
}

/**
 * TDesign 的 DialogPlugin.confirm（整理大画布 / 离开画布 / 逐项下载那几个）是
 * teleport 到 body 的，没有可读的状态标志，只能看 DOM 里有没有正在显示的那一层。
 * 用 getBoundingClientRect 判可见，不能用 offsetParent —— 弹层是 position:fixed，
 * fixed 元素的 offsetParent 恒为 null，那样判会把「开着」误判成「没开」。
 */
function tdesignDialogVisible(): boolean {
  for (const el of Array.from(embed.root.querySelectorAll('.t-dialog__ctx'))) {
    const r = (el as HTMLElement).getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return true
  }
  return false
}

/** 有弹层开着就别抢键 —— 图片编辑器自己也用 Ctrl+Z */
function anyOverlayOpen(): boolean {
  return batchOpen.value || editorState.value.open || lightbox.value.open
    || detailModal.value.open || libraryOpen.value || templateDialogOpen.value
    || shareOpen.value || batch.open.value || pickerBusy.value || kitEditor.value.open
    || tdesignDialogVisible()
}

function doUndo() {
  if (!hist.undo()) return
  closeMenus()
}
function doRedo() {
  if (!hist.redo()) return
  closeMenus()
}

function deleteSelection() {
  const nodeIds = getSelectedNodes.value.map((n: any) => n.id)
  const edgeIds = getSelectedEdges.value.map((e: any) => e.id)
  if (!nodeIds.length && !edgeIds.length) return
  hist.record()
  // 先删边：removeNodes 会连带删掉挂在节点上的边，反过来的话 edgeIds 里
  // 可能已经有不存在的 id 了
  if (edgeIds.length) {
    const gone = new Set(edgeIds)
    edges.value = edges.value.filter((e: any) => !gone.has(e.id))
  }
  if (nodeIds.length) removeNodes(nodeIds)
}

/**
 * 按住 Shift（框选键）时把组临时变穿透，见 .box-selecting 那条样式。
 *
 * 组是个铺满一大片的节点，鼠标在它上面按下永远被判成「拖这个组」，框选根本
 * 拉不起来 —— 组里的节点就只能一个个点着选，「移出组」几乎没法用。
 * 窗口失焦要复位：按着 Shift 切走再回来，keyup 是收不到的。
 */
const boxSelecting = ref(false)
function onShiftDown(e: KeyboardEvent) { if (e.key === 'Shift' && !readOnly.value) boxSelecting.value = true }
function onShiftUp(e: KeyboardEvent) { if (e.key === 'Shift') boxSelecting.value = false }
function onWindowBlur() { boxSelecting.value = false }

function syncPaneWidth() {
  const pane = edRef.value?.querySelector('.vf-wrap') as HTMLElement | null
  if (pane?.clientWidth) paneWidth.value = pane.clientWidth
}

/**
 * 选中一个生成节点时的两个键，要抢在 vue-flow 前面（捕获阶段）处理：
 *   Ctrl / ⌘ + Enter  运行它。vue-flow 把聚焦节点上的 Enter 当成「点一下节点」，而 Ctrl 又是它的
 *                     多选键 —— 不拦的话这一下会把节点取消选中。
 *   Esc               收起它的输入条 / 属性面板，节点保持选中。vue-flow 的 Esc 是取消选中。
 *                     有菜单开着时不拦，先让菜单收掉。
 */
function onCanvasKeydownCapture(e: KeyboardEvent) {
  if (readOnly.value || !ownsKeyEvent(e, embed.root)) return
  if (isTypingTarget(e.target) || anyOverlayOpen()) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const n = soleGenNode.value
    if (!n) return
    e.preventDefault()
    e.stopPropagation()
    void executor.runSubtree(n.id)
    return
  }
  if (e.key === 'Escape' && panelNode.value) {
    if (contextMenu.value.open || addMenu.value.open || moreMenu.value.open || palMenu.value.open || fly.value || stylePanelOpen.value || searchOpen.value) return
    e.preventDefault()
    e.stopPropagation()
    closeGenPanel()
  }
}

function onCanvasKeydown(e: KeyboardEvent) {
  // 嵌在别人的页面里：按键不是冲着这块画布来的就不管（宿主自己的输入框、别的嵌入实例）
  if (!ownsKeyEvent(e, embed.root)) return
  if (isTypingTarget(e.target)) return
  if (readOnly.value) return
  if (anyOverlayOpen()) return
  const mod = e.ctrlKey || e.metaKey
  const key = (e.key || '').toLowerCase()

  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) doRedo()
    else doUndo()
    return
  }
  // Ctrl+Y：Windows 上重做的另一套习惯
  if (mod && key === 'y') { e.preventDefault(); doRedo(); return }
  if (mod && key === 'a') { e.preventDefault(); addSelectedNodes(getNodes.value); return }
  // Ctrl+C：页面上选着文字时让浏览器照常复制文字，否则复制选中的节点（粘贴走 paste 事件）
  if (mod && key === 'c') {
    if (window.getSelection()?.toString()) return
    const n = copySelection()
    if (n) MessagePlugin.success(t('canvas.clipboard.copied', { n }))
    return
  }
  if (mod && key === 'd') {
    e.preventDefault()
    duplicateNodesById(getSelectedNodes.value.map((n: any) => n.id))
    return
  }
  // 顶掉浏览器的「保存网页」
  if (mod && key === 's') { e.preventDefault(); void handleSave(); return }
  if (mod && key === '0') { e.preventDefault(); fitFree(); return }
  if (mod && key === 'f') { e.preventDefault(); openSearch(); return }
  // Ctrl+G 成组：选中的里面已经有组就走合并，全是散节点就直接圈一个新组
  if (mod && key === 'g') {
    e.preventDefault()
    if (e.shiftKey) ungroupSelected()
    else if (selectedGrouped.value >= 1 && getSelectedNodes.value.length >= 2) mergeIntoGroup()
    else groupIntoFrame()
    return
  }
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); return }
  if (key === 'escape') { closeMenus(); stylePanelOpen.value = false; searchOpen.value = false; return }
  // 选中一个生成节点后直接打字：焦点落进它的提示词框，这一键照常进到框里。
  // 空格留给画布（按住拖动平移）；输入法组字的第一键 key 是 Process。
  if (!mod && !e.altKey && soleGenNode.value && e.key !== ' ' && (e.key.length === 1 || e.key === 'Process')) {
    focusGenPrompt()
  }
}

// 编辑器内切换项目：URL 的画布 id 变了就重新加载
watch(wantedCanvasId, (id) => {
  if (id && id !== currentId.value) loadWorkflow(id)
})

// 只读开着的时候什么都不存。关掉的那一刻如果内容和上次存的不一样（比如只读期间有一次运行跑完了），补存一次
watch(readOnly, (ro) => {
  if (ro) { closeMenus(); return }
  if (currentId.value && buildFingerprint() !== lastFingerprint) scheduleAutoSave()
})

/* ==================== 给宿主的事件和方法（只嵌编辑器时） ==================== */
// 监听的是拼出来的一个字符串：选中集合真的变了才发，不会因为数组换了个新的就重复发
watch(() => JSON.stringify([getSelectedNodes.value.map((n: any) => n.id), getSelectedEdges.value.map((e: any) => e.id)]), (key) => {
  const [nodeIds, edgeIds] = JSON.parse(key) as [string[], string[]]
  embed.emit('selection', { nodeIds, edgeIds })
})
if (host) {
  host.api.value = {
    getDocument: buildDocument,
    setDocument(doc) {
      suppressAutoSave = true
      try { applyWorkflow({ id: currentId.value || wantedCanvasId.value, updatedAt: lastSavedAt.value, ...migrateDocument(doc) }) }
      finally { setTimeout(() => { suppressAutoSave = false }, 0) }
    },
    save: () => doSave(true),
    fitView: () => fitFree({ duration: 200 }),
    runAll: () => executor.runAll(),
    runNode: (id) => executor.runSubtree(id),
    addNode: (type, data, position) => addNode(type as NodeKind, data as Record<string, any> | undefined, position),
    undo: doUndo,
    redo: doRedo,
  }
}

onMounted(async () => {
  // 默认带着外壳（顶栏 + 图标侧栏）；沉浸式从「更多」里手动进
  appStore.setImmersive(false)
  document.addEventListener('mousedown', onDocClick)
  document.addEventListener('paste', onCanvasPaste)
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('keydown', onCanvasKeydown)
  window.addEventListener('keydown', onCanvasKeydownCapture, true)
  window.addEventListener('keydown', onShiftDown)
  window.addEventListener('keyup', onShiftUp)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('resize', syncPaneWidth)
  syncPaneWidth()
  // 品牌包列表：拉不到不影响画布使用（useBrandKits 内部已吞掉异常）
  if (feat.brandKit) void brandKits.load()
  const paramId = wantedCanvasId.value
  if (paramId) {
    await loadWorkflow(paramId)
  } else if (!host) {
    // 没有 id 不应该进入编辑器 —— 回列表
    router.replace('/canvases')
  }
  // 首次进画布自动弹一次使用教程（之后只能手动从「更多」打开）
  try {
    if (feat.guide && lcLocal.getItem('canvas_guide_autoshown') !== '1') {
      guideOpen.value = true
      lcLocal.setItem('canvas_guide_autoshown', '1')
    }
  } catch { /* localStorage 不可用就算了 */ }
})

onBeforeUnmount(() => {
  // 离开画布页复位，恢复其他页面的外壳
  appStore.setImmersive(false)
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('paste', onCanvasPaste)
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('keydown', onCanvasKeydown)
  window.removeEventListener('keydown', onCanvasKeydownCapture, true)
  window.removeEventListener('keydown', onShiftDown)
  window.removeEventListener('keyup', onShiftUp)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('resize', syncPaneWidth)
  if (layoutUndoTimer) { clearTimeout(layoutUndoTimer); layoutUndoTimer = null }
  if (guidesHideTimer) { clearTimeout(guidesHideTimer); guidesHideTimer = null }
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
    // 离开页面时若有未保存修改，立即触发一次（best-effort，不阻塞）
    if (dirty.value && currentId.value) {
      autoSave().catch(() => {})
    }
  }
  // 刚挪过视野还没来得及存：走之前补一次
  if (viewportTimer) void saveViewport()
})
</script>

<style scoped>
/* 只读（只嵌编辑器时的 readOnly）：节点整个不接鼠标，画布照样能平移缩放 */
.ed.read-only :deep(.vue-flow__node), .ed.read-only :deep(.vue-flow__edge) { pointer-events: none !important; }
.ed.read-only :deep(.vue-flow__handle) { visibility: hidden; }

/* 编辑器：画布铺满外壳给的整块区域，所有控件都是浮在上面的玻璃块。 */
.ed {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: var(--text);
}

/* ---------- 画布 ---------- */
.vf-wrap {
  position: absolute;
  inset: 0;
  /* 自选底色时由行内 style 给；默认档走下面的深蓝 */
  background: var(--flow-bg);
}
.vf-wrap.auto {
  background:
    radial-gradient(900px 520px at 78% -8%, var(--flow-aura-1), transparent 62%),
    radial-gradient(760px 520px at 4% 108%, var(--flow-aura-2), transparent 60%),
    linear-gradient(180deg, var(--bg-0), var(--bg-1));
}
/* 按住 Shift 框选时，组不吃鼠标事件 —— 否则框选没法从组上面拉起来。
   组自己和标题栏都要关掉，标题栏是另开的 pointer-events:auto。
   !important 是必须的：vue-flow 把 pointer-events 写在节点的行内 style 上，
   类选择器压不过行内样式。 */
.vf-wrap.box-selecting :deep(.vue-flow__node-frame),
.vf-wrap.box-selecting :deep(.vue-flow__node-frame *) {
  pointer-events: none !important;
}
/* 拖入文件时：整片画布描边高亮 */
.vf-wrap.drag-over::after {
  content: '';
  position: absolute;
  inset: 8px;
  border: 2px dashed rgb(var(--c-cyan) / .7);
  border-radius: 16px;
  background: rgb(var(--c-cyan) / .06);
  pointer-events: none;
  z-index: 4;
}
/* 小地图：左下角的玻璃块（皮肤在 vue-flow-theme.css，这里只管摆位） */
.vf-wrap :deep(.vue-flow__minimap) { left: 16px; bottom: 20px; }

/* 拖动节点时的智能对齐参考线 */
.vf-align-guides {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  overflow: visible;
  z-index: 3;
  /* 出现 120ms 淡入、消失 90ms 淡出。参考线是辅助信息，不该比内容还抢眼 */
  opacity: 0;
  transition: opacity 90ms ease-in;
}
.vf-align-guides.on {
  opacity: 1;
  transition: opacity 120ms ease-out;
}
/* 渐变端点的颜色只能走 CSS：stop-color 写成 SVG 属性时不解析 var() */
.vf-align-guides stop { stop-color: var(--guide); }
.vf-align-guides line {
  stroke-width: 1.5;
  stroke-linecap: round;
  /* 不用 crispEdges：像素对齐会把线钉成一根硬边，这里要的正是柔边 */
  shape-rendering: geometricPrecision;
}
.vf-align-guides circle { fill: var(--guide); }

.vf-drop-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 28px;
  background: rgb(var(--c-glass) / .92);
  border: 1px solid rgb(var(--c-cyan) / .6);
  border-radius: var(--r-md);
  box-shadow: var(--sh-1);
  color: var(--cyan-soft);
  font-size: 14px;
  pointer-events: none;
  z-index: 5;
}
.vf-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  background: rgb(var(--c-chrome-0) / .72);
  color: var(--text-2);
  font-size: 14px;
  z-index: 4;
}

/* ---------- 悬浮玻璃块 ---------- */
.fl {
  position: absolute;
  z-index: 6;
  border-radius: 14px;
  border: 1px solid var(--line-2);
  background: rgb(var(--c-glass) / .88);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  box-shadow: var(--sh-1);
}
.fl hr, .lc-menu hr { border: 0; background: var(--line-2); flex: none; }
.flip { transform: rotate(180deg); }

/* 左上：标题块 */
.ed-title {
  left: 16px; top: 16px; height: 44px;
  display: flex; align-items: center; gap: 8px; padding: 0 14px 0 6px;
  max-width: calc(100% - 32px);
  min-width: 0;
}
/* 属性面板（布局 b）开着：标题块别伸到它底下去 */
.ed.insp-open .ed-title { max-width: calc(100% - 32px - 332px); }
/* 画布名：镜像文字撑开宽度，输入框叠在上面 —— 名字多长块就多宽，超了就截断 */
.ed-name { position: relative; display: block; min-width: 40px; max-width: 320px; flex: 0 1 auto; overflow: hidden; height: 30px; border-radius: 8px; }
.ed-name-mirror {
  display: block; visibility: hidden; white-space: pre; padding: 0 8px;
  font: 600 14px/30px var(--f-disp); overflow: hidden; text-overflow: ellipsis;
}
.ed-name input {
  position: absolute; inset: 0; width: 100%; height: 100%; padding: 0 8px;
  border: 1px solid transparent; border-radius: 8px; background: transparent; outline: none;
  font: 600 14px/28px var(--f-disp); color: var(--text); text-overflow: ellipsis;
}
.ed-name input::placeholder { color: var(--text-3); font-weight: 400; }
.ed-name input:hover { background: rgb(var(--c-film) / .08); }
.ed-name input:focus { background: var(--well); border-color: var(--cyan); }
.ed-save {
  border: 0; background: none; padding: 4px 2px; border-radius: 6px; font-size: 12px; flex: none;
  font-variant-numeric: tabular-nums;
}
.ed-save:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 3px; }
.ed-save:disabled { cursor: default; }
.ed-save:focus-visible { outline: none; box-shadow: var(--ring); }

/* 工具面板：位置由 transform 给（可拖动），竖排一列 / 横排一行 */
.ed-pal {
  left: 0; top: 0; padding: 6px; display: flex; gap: 4px;
  max-width: calc(100% - 16px); max-height: calc(100% - 16px);
  overflow: auto; scrollbar-width: none; touch-action: none; will-change: transform;
  user-select: none; -webkit-user-select: none;
}
.ed-pal::-webkit-scrollbar { display: none; }
.ed-pal.v { flex-direction: column; width: 48px; }
.ed-pal.h { flex-direction: row; align-items: center; height: 48px; }
.ed-pal.v hr { height: 1px; margin: 2px 4px; }
.ed-pal.h hr { width: 1px; height: 20px; margin: 0 2px; }
/* 松手吸边、复位、窗口变化时滑过去；拖着的时候必须跟手，不能有过渡 */
.ed-pal.ready { transition: transform .24s cubic-bezier(.2, .8, .2, 1), box-shadow .15s; }
.ed-pal.drag { transition: none; box-shadow: var(--sh-2); border-color: var(--line-3); cursor: grabbing; }
/* 把手：安静的六个点，悬停 / 拖动时才亮一点 */
.pal-grip {
  flex: none; padding: 0; border: 0; border-radius: 7px; background: none; color: var(--text-3);
  display: grid; place-items: center; cursor: grab; touch-action: none; opacity: .7;
  transition: background .15s, color .15s, opacity .15s;
}
.ed-pal.v .pal-grip { width: 34px; height: 16px; }
.ed-pal.h .pal-grip { width: 16px; height: 34px; }
.ed-pal.h .pal-grip .lc-ic { transform: rotate(90deg); }
.pal-grip:hover, .pal-grip.on, .ed-pal.drag .pal-grip { background: rgb(var(--c-film) / .12); color: var(--text); opacity: 1; }
.ed-pal.drag .pal-grip { cursor: grabbing; }
.pal-grip:focus-visible, .ed-pal .lc-tb:focus-visible { outline: none; box-shadow: var(--ring); }
/* 方向开关：比加节点的按钮矮一截，一眼看得出不是同一类 */
.ed-pal .pal-turn { color: var(--text-3); }
.ed-pal.v .pal-turn { height: 24px; }
.ed-pal.h .pal-turn { width: 24px; }
/* 把手的小菜单 */
.ed-palmenu { position: absolute; z-index: 9; min-width: 160px; white-space: nowrap; }
.ed-palmenu .lc-menu-item { width: 100%; gap: 10px; border: 0; background: none; text-align: left; }
.ed-palmenu .lc-menu-item .lc-ic { color: var(--text-3); }
.ed-palmenu .lc-menu-item:hover:not(:disabled) .lc-ic { color: var(--cyan); }
.ed-palmenu .lc-menu-item:disabled { opacity: .42; cursor: not-allowed; background: none; color: var(--text-2); }
.ed-palmenu .lc-menu-item:focus-visible { outline: none; box-shadow: var(--ring); }

/* 面板按钮的展开层：位置和高度上限由脚本按面板眼下在哪来给 */
.ed-fly {
  left: 72px; top: 76px; width: 220px; z-index: 8;
  display: flex; flex-direction: column; min-height: 0;
  max-height: calc(100% - 16px);
}
.ed-fly.wide { width: 340px; }
.ed-fly-h {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 8px 8px 6px 14px; font: 600 13px/1.4 var(--f-disp); color: var(--text); flex: none;
}
.ed-fly-b { padding: 0 6px 6px; overflow-y: auto; min-height: 0; }

/* 菜单里的分组小标题 / 两列网格 / 一项（面板展开层、右键菜单、「更多」共用） */
.ed-sub { font-size: 11px; color: var(--text-3); padding: 8px 8px 4px; }
.ed-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; }
.ed-grid.one { grid-template-columns: 1fr; }
/* 落单的那项占满一行，别缩在半边留一块白 */
.ed-grid .ed-item:only-child { grid-column: 1 / -1; }
.ed-item {
  display: flex; align-items: center; gap: 8px; min-width: 0; height: 34px; padding: 0 8px;
  border: 0; border-radius: 8px; background: none; color: var(--text-2); font-size: 13px; text-align: left;
  transition: background .12s, color .12s;
}
.ed-item .lc-ic { width: 16px; height: 16px; color: var(--text-3); transition: color .12s; }
.ed-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.ed-item:hover:not(:disabled) { background: rgb(var(--c-film) / .12); color: var(--text); }
.ed-item:hover:not(:disabled) .lc-ic { color: var(--cyan); }
.ed-item:focus-visible { outline: none; box-shadow: var(--ring); }
.ed-item:disabled { opacity: .42; cursor: not-allowed; }
/* 单选项里当前选中的那一个（节点布局） */
.ed-item.on { background: rgb(var(--c-cyan) / .12); color: var(--cyan-soft); }
.ed-item.on .lc-ic { color: var(--cyan); }

.ed-legend {
  display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; padding: 8px;
  border-top: 1px solid var(--line); font-size: 11px; color: var(--text-3);
}
.ed-legend span { display: inline-flex; align-items: center; gap: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--port-bg); border: 2px solid var(--cyan); flex: none; }
.d-text { border-color: var(--port-text); }
.d-video { border-color: var(--port-video); }
.d-last { background: var(--cyan); }

/* 切换项目 */
.ed-proj { left: 16px; top: 68px; width: 300px; max-width: calc(100% - 32px); z-index: 9; display: flex; flex-direction: column; max-height: calc(100% - 100px); }
.ed-proj-list { overflow-y: auto; min-height: 0; padding: 0 6px; display: grid; gap: 2px; }
.ed-proj-foot { padding: 8px; border-top: 1px solid var(--line); margin-top: 6px; }
.proj-item {
  display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px; min-width: 0;
  border: 1px solid transparent; border-radius: 10px; background: none; color: var(--text-2); text-align: left;
}
.proj-item:hover { background: rgb(var(--c-film) / .1); }
.proj-item.cur { border-color: rgb(var(--c-cyan) / .4); background: rgb(var(--c-cyan) / .06); }
.proj-thumb { flex: none; width: 48px; height: 34px; border-radius: 6px; border: 1px solid var(--line); display: grid; place-items: center; color: var(--text-3); }
.proj-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.proj-item-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 500; color: var(--text); }
.proj-item-time { font: 11px/1.3 var(--f-mono); color: var(--text-3); }
.proj-dialog { width: 440px; }
.proj-dialog .lc-dialog-body { display: grid; gap: 2px; padding: 16px 14px; }
.proj-note { margin: 0 6px 8px; }

/* 没有模型的提示：右上角（那里现在是空的），标题块把它那一段宽度让出来。
   属性面板开着时右上角归面板：提示挪到第二排、面板左边 */
.ed-hint {
  position: absolute; z-index: 6; top: 16px; right: 16px;
  max-width: min(520px, calc(100% - 552px)); align-items: center;
  background: var(--hint-bg); box-shadow: var(--sh-1);
}
.ed-hint a { white-space: nowrap; font-weight: 500; }
.ed.has-hint .ed-title { max-width: calc(100% - 48px - min(520px, 100% - 552px)); }
.ed.insp-open .ed-hint { top: 68px; right: 348px; max-width: calc(100% - 436px); }
.ed.has-hint.insp-open .ed-title { max-width: calc(100% - 32px - 332px); }

/* 底部中间：工具条 */
.ed-tools {
  left: 50%; bottom: 20px; transform: translateX(-50%);
  height: 48px; display: flex; align-items: center; gap: 4px; padding: 0 6px;
  max-width: calc(100% - 32px);
}
.ed-tools hr { width: 1px; height: 20px; margin: 0 4px; }
.ed-zoom {
  width: 48px; height: 34px; border: 0; border-radius: 9px; background: none; flex: none;
  font: 500 12px var(--f-mono); color: var(--text-2); text-align: center;
}
.ed-zoom:hover { background: rgb(var(--c-film) / .12); color: var(--text); }
.ed-arrange { height: 34px; border-color: transparent; background: none; color: var(--text); flex: none; }
.ed-run { height: 34px; padding: 0 14px; font-size: 13px; flex: none; }
.ed-run .lc-ic { fill: currentColor; }

/* 整理后的「撤销」小条：浮在工具条上方 */
.ed-undo {
  left: 50%; bottom: 80px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 6px 0 14px;
  font-size: 13px; color: var(--text-2); white-space: nowrap;
}

/* 换布局后节点互相压住的提示：和「撤销」小条同一个位置、同一种样子 */
.ed-note { gap: 4px; max-width: calc(100% - 32px); }
.ed-note > span { overflow: hidden; text-overflow: ellipsis; margin-right: 4px; }
/* 属性面板（布局 b）开着：底部工具条和它上面的小条往左让，别钻到面板底下 */
.ed.insp-open .ed-tools, .ed.insp-open .ed-undo { left: calc(50% - 166px); }

/* ---------- 菜单 ---------- */
.lc-menu hr { height: 1px; margin: 4px 6px; }
.ctx-menu { position: fixed; z-index: 2000; min-width: 200px; max-width: 280px; max-height: calc(calc(100 * var(--lc-vh)) - 16px); }
.ctx-menu .lc-menu-item { width: 100%; gap: 10px; border: 0; background: none; text-align: left; }
.ctx-menu .lc-menu-item .lc-ic { color: var(--text-3); }
.ctx-menu .lc-menu-item:hover .lc-ic { color: var(--cyan); }
.ctx-menu .lc-menu-item.danger { color: var(--err-soft); }
.ctx-menu .lc-menu-item.danger .lc-ic { color: var(--err-soft); }
.ctx-menu .lc-menu-item.danger:hover { background: rgb(var(--c-err) / .12); }
/* 品牌包那几项是单选：选中的前面打勾，没选中的留出同样宽的空位 */
.ctx-menu .ed-sub { padding-top: 4px; }
.ctx-menu .ctx-kit.active .lc-ic { color: var(--cyan); }
.ctx-kit-gap { width: 14px; flex: none; }
.ctx-kit-l { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 两列排布：节点类型有十几种，一列一屏放不下。
   固定宽度是必要的 —— 不定宽的话「改尺寸 / 压缩」这种长标签会把整个菜单撑开。 */
.ed-menu { position: fixed; z-index: 2000; width: 344px; max-width: calc(calc(100 * var(--lc-vw)) - 16px); }
.ed-menu-title { font: 600 13px/1.4 var(--f-disp); color: var(--text); padding: 6px 8px 0; }

/* ---------- 节点搜索 ---------- */
.nsearch { top: 16px; left: 50%; transform: translateX(-50%); width: 360px; max-width: calc(100% - 32px); z-index: 10; padding: 6px; }
.nsearch-bar { border-color: var(--line); }
.nsearch-empty { padding: 10px 8px 6px; font-size: 12px; color: var(--text-3); }
.nsearch-list { max-height: 264px; overflow-y: auto; margin-top: 6px; display: grid; gap: 2px; }
.nsearch-item {
  display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 6px 8px;
  border: 0; border-radius: 8px; background: none; text-align: left; color: var(--text-2);
}
.nsearch-item:hover { background: rgb(var(--c-film) / .12); color: var(--text); }
.nsearch-b { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

/* ---------- 分享弹窗 ---------- */
.share-dialog { width: 480px; }
.share-tip { margin: 0 0 16px; }
.share-last { margin-bottom: 0; }
.share-expiry { align-self: flex-start; }
.share-link-row { display: flex; gap: 8px; }
.share-link-row .lc-input { flex: 1; min-width: 0; font-size: 12px; }
.share-link-row .lc-btn { height: 40px; flex: none; }

/* 手机上抽屉后面的遮罩：桌面不出现 */
.ed-scrim { display: none; }

/* ---------- 窄屏 ---------- */
@media (max-width: 1100px) {
  /* 提示条挪到第二排：第一排放不下了。左边留出工具面板默认待的那一条 */
  .ed-hint { top: 68px; max-width: calc(100% - 104px); }
  .ed.has-hint .ed-title { max-width: calc(100% - 32px); }
}
@media (max-width: 640px) {
  .ed-title { left: 8px; top: 8px; height: 40px; padding: 0 8px 0 3px; gap: 4px; max-width: calc(100% - 16px); }
  .ed-name { min-width: 24px; }
  .ed-name-mirror, .ed-name input { padding: 0 4px; font-size: 13px; }
  /* 保存状态只留圆点，文字靠 title / 读屏 */
  .ed-save { padding: 6px; }
  .ed-save > span { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  /* 展开层是底部抽屉 */
  .ed-fly, .ed-fly.wide {
    left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: min(72%, 560px); z-index: 41;
    background: rgb(var(--c-glass) / .97); box-shadow: var(--sh-2);
  }
  .ed-proj { left: 8px; top: 56px; max-width: calc(100% - 16px); }
  /* 工具条贴底，放不下就在自己里面横向滚动 */
  .ed-tools {
    left: 8px; right: 8px; bottom: 8px; transform: none; max-width: none; height: 46px;
    overflow-x: auto; overflow-y: hidden; scrollbar-width: none; justify-content: flex-start; gap: 2px;
  }
  .ed-tools::-webkit-scrollbar { display: none; }
  /* 缩放百分比和分隔线先让出来，「运行全部」才不会被挤到屏幕外 */
  .ed-tools .ed-zoom, .ed-tools hr { display: none; }
  .ed-tools .ed-run { margin-left: auto; }
  .ed-arrange { width: 34px; padding: 0; }
  .ed-arrange > span { display: none; }
  .ed-arrange .lc-ic { width: 18px; height: 18px; color: var(--text-2); }
  /* 「撤销」贴在工具条上面；右边留出生成队列圆钮默认待的那一角 */
  .ed-undo { left: 8px; right: 76px; bottom: 62px; transform: none; justify-content: space-between; }
  .ed-note { max-width: none; }
  .vf-wrap :deep(.vue-flow__minimap) { display: none; }
  .nsearch { top: 56px; left: 8px; right: 8px; transform: none; width: auto; max-width: none; }
  .ed-hint, .ed.insp-open .ed-hint { top: 108px; left: 8px; right: 8px; max-width: none; }
  .ed.has-hint .ed-title, .ed.has-hint.insp-open .ed-title { max-width: calc(100% - 16px); }
  .ed.sheet-open .ed-scrim { display: block; position: absolute; inset: 0; z-index: 40; background: var(--scrim); }
  .ed-menu:not(.ed-more) { max-height: calc(calc(100 * var(--lc-vh)) - 80px) !important; }
}
/* 手机宽度（和上面同一个断点，类名由脚本按 matchMedia 加）：工具面板是标题块下面固定的一横条，
   不能拖，放不下就在自己里面横向滚动 */
.ed-pal.phone {
  left: 8px; top: 56px; height: 46px; padding: 5px; gap: 2px; max-width: calc(100% - 16px);
  overflow-x: auto; overflow-y: hidden; touch-action: pan-x; transform: none; transition: none;
}
.ed-pal.phone hr { margin: 0 1px; }
@media (prefers-reduced-motion: reduce) {
  .ed-pal.ready { transition: none; }
}
</style>
