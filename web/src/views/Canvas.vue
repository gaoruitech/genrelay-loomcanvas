<template>
  <div ref="edRef" class="ed" :class="{ 'sheet-open': !!fly, 'insp-open': inspectorInset > 0, 'mini-off': miniCramped, 'has-hint': noModels, 'read-only': readOnly, 'no-title': !feat.titleBar, 'panel-sheet': !!panelSheet }" :style="{ '--ed-top': edTop + 'px' }" :data-node-layout="nodeLayout">
    <!-- 素材库 / 我的分享 / 模板 / 教程 -->
    <LibraryDialog v-if="libraryMenuItems.length" v-model="libraryOpen" :initial-tab="libraryInitialTab" :read-only="readOnly" @add-asset="onAddAsset" @apply-template="applyTemplate" @add-text="onAddText" />
    <CanvasTemplateDialog v-if="feat.templates" v-model="templateDialogOpen" :current-graph="readOnly ? undefined : templateGraph" @apply="applyTemplate" />
    <CanvasGuide v-if="feat.guide" v-model="guideOpen" :section="guideSection" :empty="!loading && nodes.length === 0" @open-templates="openTemplates" />

    <!-- 创建分享链接弹窗：先填表，创建成功后同一个弹窗里换成链接 + 复制 -->
    <div v-if="shareOpen" class="lc-mask lc-sheet" @click.self="closeShareDialog">
      <div v-dialog="closeShareDialog" class="lc-dialog share-dialog" :class="{ team: teamCanvas }" role="dialog" aria-modal="true" :aria-label="shareTitle">
        <div class="lc-dialog-head">
          <span class="share-h">{{ shareTitle }}</span>
          <button class="lc-x" :aria-label="t('common.close')" @click="closeShareDialog">×</button>
        </div>
        <!-- 团队里的画布：「团队内」是谁能看、谁能改；「对外链接」是原来的只读快照 -->
        <div v-if="teamCanvas" class="share-tabs" role="tablist">
          <button type="button" role="tab" :aria-selected="shareTab === 'team'" :class="{ on: shareTab === 'team' }" data-testid="share-tab-team" @click="shareTab = 'team'">
            <LcIcon name="users" size="s" />{{ t('canvas.share.tabTeam') }}
          </button>
          <button v-if="feat.share" type="button" role="tab" :aria-selected="shareTab === 'link'" :class="{ on: shareTab === 'link' }" data-testid="share-tab-link" @click="shareTab = 'link'">
            <LcIcon name="share" size="s" />{{ t('canvas.share.tabLink') }}
          </button>
        </div>
        <template v-if="teamCanvas && shareTab === 'team'">
          <div class="lc-dialog-body">
            <CanvasAccessPanel v-model="accessDraft" :read-only="!canSetAccess" :lock="accessLock" />
            <p v-if="accessError" class="lc-error-text share-err" role="alert">{{ accessError }}</p>
          </div>
          <div class="lc-dialog-foot">
            <button class="lc-btn" :disabled="accessSaving" @click="closeShareDialog">{{ canSetAccess ? t('common.cancel') : t('common.close') }}</button>
            <button v-if="canSetAccess" class="lc-btn primary" :disabled="accessSaving || accessDraft === teamVisibility" data-testid="share-access-save" @click="saveAccess">
              {{ accessSaving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </template>
        <!-- 不能给这张画布发对外链接（只读、没有编辑权，或团队设置成只有团长和管理员能分享） -->
        <template v-else-if="teamCanvas && !canPublishShare">
          <div class="lc-dialog-body" data-testid="share-readonly">
            <div class="lc-alert info"><LcIcon name="info" /><span>{{ readOnly ? t('canvas.share.readOnlyNote') : t('canvas.share.cannotPublish') }}</span></div>
            <!-- 已经有的对外链接照样能看、能复制；创建、换有效期、撤销都要能编辑才行 -->
            <p v-if="shareExisting.state === 'loading'" class="lc-help share-ex">{{ t('common.loading') }}</p>
            <div v-else-if="shareExisting.state === 'found'" class="lc-field share-last share-ex">
              <label :for="uid + '-share-ex'">{{ t('canvas.share.existingLabel') }}</label>
              <div class="share-link-row">
                <input :id="uid + '-share-ex'" class="lc-input lc-mono" readonly :value="shareExisting.link" data-testid="share-existing-link" @focus="selectAllText" />
                <button class="lc-btn primary quiet" data-testid="share-existing-copy" @click="copyShareLink(shareExisting.link)"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
              </div>
              <p class="lc-help">{{ shareExisting.expiresAt ? t('canvas.share.expiresAt', { time: formatTime(shareExisting.expiresAt) }) : t('canvas.share.neverExpires') }}</p>
            </div>
            <p v-else class="lc-help share-ex" data-testid="share-existing-none">{{ shareExisting.state === 'error' ? t('canvas.share.existingFailed') : t('canvas.share.existingNone') }}</p>
          </div>
          <div class="lc-dialog-foot"><button class="lc-btn" @click="closeShareDialog">{{ t('common.close') }}</button></div>
        </template>
        <template v-else-if="!shareResult">
          <div class="lc-dialog-body">
            <p class="lc-help share-tip">{{ teamCanvas ? t('canvas.share.tipTeam') : t('canvas.share.tip') }}</p>
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
                <button class="lc-btn primary quiet" @click="copyShareLink(shareResult.link)"><LcIcon name="copy" size="s" />{{ t('common.copy') }}</button>
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
        <div v-dialog="() => (importPickerOpen = false)" class="lc-dialog proj-dialog" role="dialog" aria-modal="true" :aria-label="t('canvas.project.importTitle')">
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
        :node-drag-threshold="touchFirst ? 6 : 1"
        :connection-radius="touchFirst ? 36 : 20"
        :elements-selectable="true"
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
          v-if="feat.minimap && !miniCramped"
          position="bottom-left"
          pannable
          zoomable
          :width="168"
          :height="104"
          :node-color="vfMiniNode"
          :node-border-radius="3"
          :mask-color="vfMiniMask"
          :mask-stroke-color="vfMiniStroke"
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

    <!-- 选中一个生成节点后候着输入法的那个看不见的框（见 armIme）；里面的输入框在挂载时放进 shadow root -->
    <div ref="imeHostRef" class="ed-ime" :style="{ transform: `translate3d(${imeBox.x}px, ${imeBox.y}px, 0)`, height: imeBox.h + 'px' }" />
    <!-- 输入法正在组的那一段字：写在提示词框里，下划线画在这儿（一行一条） -->
    <div
      v-for="(m, i) in imeMarks"
      :key="'ime-' + i"
      class="ed-ime-mark"
      :style="{ transform: `translate3d(${m.x}px, ${m.y}px, 0)`, width: m.w + 'px', borderBottomColor: m.c }"
      aria-hidden="true"
    />

    <!-- 多选工具条：选中两个及以上节点时贴着选区出现（三种节点布局都一样）。紧跟在画布后面：Tab 走完节点就到它 -->
    <SelectionToolbar
      v-if="selCount >= 2 && !readOnly && !loading"
      :count="selCount"
      :runnable="selRunnable.length"
      :running="selRunBusy"
      :blocked="selRunBlocked"
      :busy="layout.running.value"
      :merge="canMergeSelected"
      :ungroup="selectedFrames >= 1 ? 'frame' : selectedInGroup >= 1 ? 'release' : ''"
      :avoid="palAvoid"
      @align="runAlign"
      @distribute="runDistribute"
      @group="groupSelection"
      @ungroup="ungroupSelected"
      @run="runSelected"
      @delete="deleteSelection"
    />

    <!-- ============ 悬浮玻璃块 ============ -->

    <!-- 左上：返回 + 画布名（就地改名）+ 保存状态 -->
    <div v-if="feat.titleBar" ref="titleRef" class="fl ed-title">
      <button v-if="canGoBack" v-tip="{ text: t('canvas.topbar.backToList'), placement: 'bottom' }" class="lc-tb" :aria-label="t('canvas.topbar.backToList')" @click="goToList">
        <LcIcon name="chev" class="flip" />
      </button>
      <!-- 改名不是改内容：有编辑权就能改，别人正在编辑（我是只读）时也一样；只有查看权的人改不了，悬停时说明 -->
      <label v-tip="{ text: canRename ? '' : renameDenied, placement: 'bottom' }" class="ed-name" :class="{ fixed: !canRename }">
        <span class="ed-name-mirror" aria-hidden="true">{{ workflowName || t('canvas.untitled') }}</span>
        <input
          v-model="workflowName"
          :readonly="!canRename"
          maxlength="80"
          :placeholder="t('canvas.untitled')"
          :aria-label="canRename ? t('canvas.topbar.rename') : renameDenied"
          data-testid="title-name"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
          @keydown.esc="cancelNameEdit($event)"
          @blur="commitName"
        />
      </label>
      <!-- 团队画布的可见范围：点开是「分享」弹窗的「团队内」页签（只读时也能看） -->
      <button v-if="teamCanvas" v-tip="{ text: t('canvas.collab.accessTip'), placement: 'bottom' }" class="ed-vis" type="button" :aria-label="t('canvas.collab.accessTip')" data-testid="title-visibility" @click="openShareDialog('team')">
        <VisibilityChip :value="teamVisibility" plain :title="false" />
      </button>
      <span v-if="collab.readOnly.value && collab.mode.value !== 'pending'" class="lc-tag warn ed-ro" data-testid="title-readonly">{{ t('canvas.collab.readOnlyTag') }}</span>
      <button v-if="!readOnly" v-tip="{ text: t('canvas.save.saveNow'), placement: 'bottom' }" class="ed-save lc-st" :class="saveState.cls" :disabled="saving" @click="handleSave">
        <!-- 几种状态的字叠在同一格里量宽：「未保存」和「已保存 · 12:30」换来换去时标题块不跟着变宽变窄，
             贴着它摆的多选工具条、输入条也就不会跟着挪 -->
        <span class="ed-save-box">
          <span v-for="s in saveSizers" :key="s" class="ed-save-sz" aria-hidden="true">{{ s }}</span>
          <span class="ed-save-t">{{ saveState.text }}</span>
        </span>
      </button>
      <!-- 这张画布套用的品牌包：整张画布一处选，所有生成节点跟着用 -->
      <CanvasBrandKitChip
        v-if="!loading && feat.brandKit && !readOnly"
        :model-value="canvasKitId"
        :kits="brandKits.kits.value"
        :loaded="brandKits.loaded.value"
        :can-manage="brandKits.canManage.value"
        :exceptions="kitExceptionCount"
        @update:model-value="setCanvasKit"
        @edit="openKitEditor"
        @create="openKitEditor(null)"
      />
    </div>

    <!-- 只读提示条：别人正在编辑 / 被接管了 / 只有查看权。保存冲突是模态的，选完才继续 -->
    <CollabBar
      :mode="collab.mode.value"
      :holder="collab.holder.value"
      :lost-how="collab.lostHow.value"
      :place="barPlace"
      :can-take-over="collab.canTakeOver.value"
      :can-copy="copyAvailable"
      :unsaved="dirty"
      :busy="collabBusy || collab.busy.value"
      :error-message="collab.errorMessage.value"
      @take-over="takeOverCanvas"
      @copy="saveAsCopy('copy')"
      @save-copy="saveAsCopy('mine')"
      @reload="reloadLatest"
      @retry="collab.retry()"
    />
    <ConflictDialog
      v-if="collab.conflict.value"
      :conflict="collab.conflict.value"
      :can-copy="copyAvailable"
      :busy="collabBusy"
      :error="conflictError"
      @copy="saveAsCopy('mine')"
      @reload="reloadLatest"
      @overwrite="overwriteWithMine"
    />

    <!-- 工具面板：加节点（+ 是全部节点，下面按类别分）、素材库、分享、更多画布操作。
         默认竖排在左边；抓着把手（或面板空白处）可以拖到任何地方，把手旁边的开关切横排 / 竖排。
         手机上是标题块下面固定的一横条，不能拖。 -->
    <div
      v-if="feat.palette && (!readOnly || palReadOnly)"
      ref="palRef"
      class="fl ed-pal"
      :class="[palOrient, { phone: palPhone, ready: palReady, drag: palDragging, compact: palFit.compact, ro: palReadOnly, under: palCovered }]"
      :style="palPhone ? undefined : { transform: `translate3d(${palXY.x}px, ${palXY.y}px, 0)` }"
      role="toolbar"
      :aria-label="palReadOnly ? t('canvas.readonly.palLabel') : t('canvas.pal.label')"
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
          v-tip="{ text: t('canvas.pal.grip'), placement: palTipSide }"
          type="button"
          class="pal-grip"
          :class="{ on: palMenu.open }"
          :aria-label="t('canvas.pal.grip')"
          aria-haspopup="menu"
          :aria-expanded="palMenu.open"
          data-pal="grip"
          @click="onGripClick"
        ><LcIcon name="grip" size="s" /></button>
        <button
          v-tip="{ text: turnLabel, placement: palTipSide }"
          type="button"
          class="lc-tb pal-turn"
          :aria-label="turnLabel"
          data-pal="turn"
          @click="turnPalette"
        ><LcIcon :name="palOrient === 'v' ? 'turnh' : 'turnv'" size="s" /></button>
        <hr />
      </template>
      <!-- 加节点（+ 是全部，后面按类别）、素材库、分享、更多；放不下时靠后的几颗收进「更多工具」（见 palFit） -->
      <template v-for="it in palShown" :key="it.key">
        <hr v-if="it.hr" />
        <button
          v-else
          v-tip="{ text: it.title, placement: palTipSide }"
          type="button"
          class="lc-tb"
          :class="{ on: it.on, 'pal-ro': it.ro }"
          :aria-label="it.title"
          :aria-haspopup="it.popup"
          :aria-expanded="it.popup ? !!it.on : undefined"
          :aria-pressed="it.pressed === undefined ? undefined : it.pressed"
          :disabled="it.disabled"
          :data-pal="it.key"
          @click="it.run()"
        >
          <LcIcon v-if="it.icon" :name="it.icon" />
          <svg v-else class="lc-ic" :class="it.svgClass" viewBox="0 0 24 24" aria-hidden="true" v-html="it.svg" />
        </button>
      </template>
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
        <button v-tip="t('common.close')" class="lc-tb sm" :aria-label="t('common.close')" @click="fly = ''"><LcIcon name="x" size="s" /></button>
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
              :data-key="item.key"
              @click="runFlyItem(item)"
            >
              <LcIcon v-if="item.lc" :name="item.lc" />
              <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
              <span v-tip="{ text: item.label, clipped: true }">{{ item.label }}</span>
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
    <div ref="toolsRef" class="fl ed-tools" role="toolbar" :aria-label="t('canvas.tools.label')">
      <button class="lc-tb" :disabled="zoomPct <= MIN_ZOOM * 100" v-tip="t('canvas.tools.zoomOut')" :aria-label="t('canvas.tools.zoomOut')" @click="zoomOut()"><LcIcon name="zout" /></button>
      <button v-tip="t('canvas.tools.zoomReset')" class="ed-zoom" @click="zoomTo(1, { duration: 200 })">{{ zoomPct }}%</button>
      <button class="lc-tb" :disabled="zoomPct >= MAX_ZOOM * 100" v-tip="t('canvas.tools.zoomIn')" :aria-label="t('canvas.tools.zoomIn')" @click="zoomIn()"><LcIcon name="zin" /></button>
      <button class="lc-tb" v-tip="t('canvas.tools.fit')" :aria-label="t('canvas.tools.fit')" @click="fitFree({ duration: 200 })"><LcIcon name="fit" /></button>
      <template v-if="!readOnly">
      <hr />
      <!-- 撤销 / 重做：快捷键之外还是要给可见入口，不然只有知道 Ctrl+Z 的人能用 -->
      <button class="lc-tb" :disabled="!hist.canUndo.value" v-tip="t('canvas.topbar.undoTip')" :aria-label="t('canvas.topbar.undo')" @click="doUndo"><LcIcon name="undo" /></button>
      <button class="lc-tb" :disabled="!hist.canRedo.value" v-tip="t('canvas.topbar.redoTip')" :aria-label="t('canvas.topbar.redo')" @click="doRedo"><LcIcon name="redo" /></button>
      <hr />
      <button v-tip="t('canvas.menu.arrange')" class="lc-btn sm ed-arrange" :disabled="layout.running.value || nodes.length < 2" @click="runArrange">
        <LcIcon name="layout" size="s" /><span>{{ t('canvas.tools.arrange') }}</span>
      </button>
      <hr />
      <!-- 团队空间：我本月的上限用到哪儿了（最紧的那一项）。到 80% 变提醒色，用完变错误色 -->
      <span v-if="budgetChip" v-tip="budgetChip.title" class="ed-budget lc-mono" :class="budgetChip.state" data-testid="budget-chip">{{ budgetChip.text }}</span>
      <button
        class="lc-btn primary sm ed-run"
        :disabled="executor.running.value"
        v-tip="executor.running.value ? '' : t('canvas.tools.runAllTip')"
        @click="executor.runAll()"
      >
        <LcIcon name="play" size="s" /><span>{{ executor.running.value ? t('canvas.topbar.running') : t('canvas.topbar.runAll') }}</span>
      </button>
      </template>
    </div>

    <!-- 整理后的反悔入口：整理是一次性重排全部位置，没有撤销就不敢点 -->
    <!-- 触屏多选开着：说清楚现在点节点是在挑，选了几个，怎么结束 -->
    <div v-if="touchMultiOn" class="fl ed-undo ed-multi" :style="undoStyle" role="status" data-testid="touch-multi">
      <span>{{ t('canvas.touchMulti.state', { n: selCount }) }}</span>
      <button class="lc-btn primary sm" type="button" data-testid="touch-multi-done" @click="endTouchMulti">{{ t('canvas.touchMulti.done') }}</button>
    </div>

    <div v-if="layoutUndo.visible && !touchMultiOn" class="fl ed-undo" :style="undoStyle">
      <span>{{ layoutUndo.text }}</span>
      <button class="lc-btn text sm" @click="undoLayout">{{ t('canvas.layout.undo') }}</button>
    </div>

    <!-- 换了节点布局（或这张画布是在另一种布局下排的）之后节点互相压住：只提示，点了才整理 -->
    <div v-if="layoutNote.visible && !layoutUndo.visible && !touchMultiOn" class="fl ed-undo ed-note" :style="undoStyle" role="status" data-testid="layout-note">
      <span>{{ layoutNote.text }}</span>
      <!-- 只读：这句话照样说（看的人可以在「更多」里换回原来的布局），「自动整理」是改画布，不出现 -->
      <button v-if="!readOnly" class="lc-btn text sm" data-testid="layout-note-arrange" @click="arrangeFromNote">{{ t('canvas.tools.arrange') }}</button>
      <button v-tip="t('common.close')" class="lc-tb sm" :aria-label="t('common.close')" @click="dismissLayoutNote"><LcIcon name="x" size="s" /></button>
    </div>

    <!-- 生成节点的编辑面板，整张画布只有一个实例：布局 a 是跟着选中节点的输入条，布局 b 是右缘的属性面板。
         布局 c 没有面板，全在节点上。按节点 id 加 key：换一个节点就整个重建。 -->
    <GenComposer
      v-if="nodeLayout === 'a' && panelNode"
      :key="'gc-' + panelNode.id"
      ref="genPanelRef"
      :node-id="panelNode.id"
      :kind="panelNode.kind"
      :avoid="palAvoid"
      @close="closeGenPanel"
      @sheet="panelSheet = $event"
    />
    <GenInspector
      v-else-if="nodeLayout === 'b' && panelNode"
      :key="'gi-' + panelNode.id"
      ref="genPanelRef"
      :node-id="panelNode.id"
      :kind="panelNode.kind"
      @close="closeGenPanel"
      @sheet="panelSheet = $event"
    />

    <!-- 生成队列：一颗悬浮圆钮，默认在右下角，可以拖走；点开是贴着它的清单卡片 -->
    <QueuePanel
      v-if="feat.queue"
      :nodes="nodes"
      :right-inset="inspectorInset"
      :avoid="queueAvoid"
      :workflow-id="currentId"
      :title-of="nodeTypeLabel"
      :budget="budget"
      @open="loadBudget"
      :cancel-node="executor.cancelNode"
      :read-only="readOnly"
      @focus="gotoNode"
    />
    <!-- 手机上节点面板抽屉后面的遮罩 -->
    <div class="ed-scrim" @click="fly = ''" />

    <!-- 节点右键菜单 -->
    <div
      v-if="contextMenu.open"
      ref="ctxMenuRef"
      class="ctx-menu lc-menu"
      role="menu"
      :aria-label="t('canvas.ctx.label')"
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
      @click.stop
      @keydown="onCtxMenuKey"
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
        <button v-if="feat.assetLibrary && !readOnly" class="lc-menu-item" role="menuitem" @click="saveToAssetsFromContext">
          <LcIcon name="folder" size="s" />
          {{ t('canvas.ctx.saveToAssets') }}
        </button>
        <button v-if="contextImageUrl && feat.imageEditor && !readOnly" class="lc-menu-item" role="menuitem" @click="editImageFromContext">
          <LcIcon name="edit" size="s" />
          {{ t('canvas.ctx.editImage') }}
        </button>
        <button class="lc-menu-item" role="menuitem" @click="detailFromContext">
          <LcIcon name="info" size="s" />
          {{ t('canvas.ctx.taskDetail') }}
        </button>
        <button v-if="contextCanFork && !readOnly" class="lc-menu-item" role="menuitem" @click="continueFromContext">
          <LcIcon name="refresh" size="s" />
          {{ t('canvas.ctx.continue') }}
        </button>
        <button v-if="contextCanFork && !readOnly" class="lc-menu-item" role="menuitem" @click="forkFromContext">
          <LcIcon name="branch" size="s" />
          {{ t('canvas.ctx.fork') }}
        </button>
        <hr v-if="!readOnly" />
      </template>
      <!-- 只读：右键菜单里只有上面「看」的那几项（看原图 / 下载 / 任务详情）；下面改画布的一概不出 -->
      <template v-if="!readOnly">
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
      </template>
    </div>

    <!-- 画布空白处右键：添加节点菜单（在光标位置弹出） -->
    <div
      v-if="addMenu.open"
      data-menu="add"
      class="ed-menu lc-menu"
      role="menu"
      :style="{ left: addMenu.x + 'px', top: addMenu.y + 'px', maxHeight: `calc(calc(100 * var(--lc-vh)) - ${addMenu.y}px - 16px)` }"
      @click.stop
    >
      <!-- 导航（沉浸式 / 我的画布 / 使用教程）永远置顶 -->
      <template v-if="navMenuGroup">
        <div class="ed-grid">
          <button v-for="item in navMenuGroup.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
            <LcIcon v-if="item.lc" :name="item.lc" />
            <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
            <span v-tip="{ text: item.label, clipped: true }">{{ item.label }}</span>
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
            <button v-for="item in grp.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
              <LcIcon v-if="item.lc" :name="item.lc" />
              <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
              <span v-tip="{ text: item.label, clipped: true }">{{ item.label }}</span>
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
          <button v-for="item in group.items" :key="item.kind" class="ed-item" role="menuitem" :data-key="item.kind" @click="addNodeFromMenu(item.kind)">
            <svg class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
            <span v-tip="{ text: item.label, clipped: true }">{{ item.label }}</span>
          </button>
        </div>
      </template>
      <template v-if="!hasSelectionForMenu">
        <template v-for="(grp, gi) in otherMenuGroups" :key="'cg-' + gi">
          <hr />
          <div v-if="grp.title" class="ed-sub">{{ grp.title }}</div>
          <div class="ed-grid">
            <button v-for="item in grp.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
              <LcIcon v-if="item.lc" :name="item.lc" />
              <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
              <span v-tip="{ text: item.label, clipped: true }">{{ item.label }}</span>
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
          <button v-for="item in grp.items" :key="item.key" class="ed-item" role="menuitem" :disabled="item.disabled" :class="{ on: item.active }" :data-key="item.key" @click="runCanvasMenuItem(item)">
            <LcIcon v-if="item.lc" :name="item.lc" />
            <svg v-else class="lc-ic" viewBox="0 0 24 24" aria-hidden="true" v-html="item.icon" />
            <span v-tip="{ text: item.label, clipped: true }">{{ item.label }}</span>
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
        <button v-tip="t('common.close')" class="lc-inp-btn" :aria-label="t('common.close')" @click="searchOpen = false"><LcIcon name="x" size="s" /></button>
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
import { vDialog } from '@/directives/dialog'
import { lcLocal } from '@/utils/storage'
import { ref, shallowRef, computed, onMounted, onBeforeUnmount, provide, reactive, watch, markRaw, type Ref, nextTick } from 'vue'
import { useRoute, useRouter, onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ensureHttps } from '@/utils/mediaUrl'
import { canvasImageThumb } from '@/utils/canvasMedia'
// SelectionMode.Partial：框选判定放宽成「碰到就算」。vue-flow 默认的 Full 要求
// 节点被完整框住，压到一半不算选中 —— 用户会以为框选坏了。同类画布工具普遍用 Partial。
import { VueFlow, useVueFlow, SelectionMode, type Node, type Edge, type Connection, addEdge } from '@vue-flow/core'
import { installPinchRouter, coarsePointer, type LongPressAt } from '@/composables/canvasTouch'
import { useTouchMultiSelect } from '@/composables/useTouchMultiSelect'
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
import SelectionToolbar from '@/components/canvas/SelectionToolbar.vue'
import '@/components/canvas/gen/gen.css'
import {
  CANVAS_NODE_UI_KEY, GEN_NODE_SIZE, INSPECTOR_GAP, INSPECTOR_WIDTH, NODE_LAYOUTS, genNodeSize, isGenNodeKind, normalizeNodeLayout,
  type GenNodeKind, type NodeLayout, type NodePeek,
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

import { workflowApi, canvasShareApi, userAssetApi, apiErrorMessage, adapterError, canCreateCanvas } from '@/utils/canvasBackend'
import { workflowApi as stockWorkflowApi, teamApi as stockTeamApi, unwrap as unwrapStock, SPACE_GONE_CODES, isTeamId } from '@/utils/api'
import { useCanvasCollab, createSerialQueue } from '@/composables/useCanvasCollab'
import CollabBar from '@/components/canvas/CollabBar.vue'
import ConflictDialog from '@/components/canvas/ConflictDialog.vue'
import CanvasAccessPanel from '@/components/space/CanvasAccessPanel.vue'
import VisibilityChip from '@/components/space/VisibilityChip.vue'
import type { CanvasLock, CanvasVisibility, LimitMeterState, LimitSide, TeamLimits } from '@/types'
import { uploadCanvasImage, uploadCanvasVideo } from '@/utils/canvasUpload'
import { downloadCanvasAsset } from '@/utils/canvasDownload'
import { useAppStore } from '@/stores/app'
import { useSpaceStore, spaceParam } from '@/stores/space'
import { CANVAS_BUDGET_KEY } from '@/composables/canvasBudgetKey'
import { blockedText, meterText, preflight, refusalText, resetText, storedRefusal } from '@/utils/budget'
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
import { usePaletteDock, fitPalette, fitPhoneStrip, palFloor, palLength, PAL_OVERFLOW, type PalFit, type PalPart } from '@/composables/usePaletteDock'
import { clampNum, fitInArea, rectsIn, watchRects, type Rect } from '@/utils/floatSpot'
import { libraryGroupLabelKey, shareButtonLabelKey } from '@/utils/canvasLabels'
import { textareaRangeRects } from '@/utils/textareaRange'
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
  DEFAULT_CANVAS_BG, normalizeCanvasBg, patternColorFor, groundToneFor,
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
const spaceStore = useSpaceStore()
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
/**
 * 多人轮流改一张画布：编辑锁、带版本的保存、保存冲突（见 composables/useCanvasCollab.ts）。
 * 后端没有这回事（没有锁的适配器、载入时不给版本）时它始终是「可编辑」，编辑器和以前一样。
 */
const collab = useCanvasCollab({
  canvasId: () => currentId.value,
  reload: (o) => reloadContent(!!o?.quiet),
  hasUnsaved: () => dirty.value,
  onEditable: () => resumeAfterLoad(),
  onLost: () => { closeMenus() },
  onRenamed: (name) => followRename(name),
})
/** 只读：宿主要求的，或者这张画布现在轮不到我改（别人在编辑、我只有查看权、丢了锁） */
const readOnly = computed(() => !!host?.readOnly.value || collab.readOnly.value)
/**
 * 只读（别人正在编辑、我只有查看权、丢了锁）时工具面板换成「只读」的那一套：只留看得、拿得走的——
 * 素材库（浏览、下载）、分享（看和复制已有的链接、团队权限）、更多（搜索、打包下载、教程……），不放任何会改画布的。
 * 宿主要求的只读（只嵌编辑器）不出面板，和以前一样；正在拿锁的那一下也不出，免得闪一下再换。
 */
const palReadOnly = computed(() => collab.readOnly.value && collab.mode.value !== 'pending' && !host?.readOnly.value)
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
  onNodeClick, connectionStartHandle, multiSelectionActive,
} = useVueFlow()

/* ==================== 触屏 ==================== */
/**
 * 画布上的手指手势（都是有意定下的，改之前先看 composables/canvasTouch.ts；docs/user-guide「基础操作」里的「触屏上」一条写的是同一套）：
 *   · 单指拖空白处 = 平移；双指 = 缩放 / 平移，落在节点上也一样（installPinchRouter）；双击空白处 = 放大一档（d3-zoom 自带，和鼠标双击一致）
 *   · 单指拖节点 = 挪节点（只读时节点不可拖，这一下平移画布）；轻点节点 = 选中；轻点空白 = 取消选中；节点里能滚的长文本单指滚它自己
 *   · 长按 0.5 秒 = 右键菜单（节点上是节点菜单，空白处是加节点菜单），由 installPinchRouter 自己计时，不靠浏览器的 contextmenu
 *     （iOS Safari 长按不发它；安卓发的那一下被拦掉，免得开两遍）。输入框、按钮、端口、连线上的长按不归它
 *   · 框选仍然只有鼠标 + Shift；触屏上多选是工具面板里的「多选」开关（useTouchMultiSelect）
 * 主设备是手指时（手机、平板）：手指落下总会抖几个像素，节点要拖过 6px 才算拖（否则一碰就成了「挪了一下」，还会把面板点出来）；
 * 拉线时离端口 36px 以内就吸附（鼠标是 20px）。主设备是鼠标的机器这两个数不变。
 */
const touchFirst = coarsePointer()
let stopPinchRouter: (() => void) | null = null
onMounted(() => {
  const wrap = edRef.value?.querySelector<HTMLElement>('.vf-wrap')
  if (!wrap) return
  stopPinchRouter = installPinchRouter(wrap, {
    viewport: () => wrap.querySelector<HTMLElement>('.vue-flow__viewport'),
    busy: () => connectionStartHandle.value !== null,
    longPress: touchFirst ? openMenuByLongPress : undefined,
  })
})
onBeforeUnmount(() => { stopPinchRouter?.(); stopPinchRouter = null })
/** 长按：开和右键同一个菜单，开在手指的位置；开了返回 true */
function openMenuByLongPress({ x, y, target }: LongPressAt): boolean {
  const ev = { clientX: x, clientY: y, pointerType: 'touch', target, preventDefault: () => {} }
  const el = target.closest<HTMLElement>('.vue-flow__node')
  if (el) {
    const node = findNode(el.dataset.id || '')
    if (!node) return false
    onNodeContextMenu({ event: ev, node })
    if (contextMenu.value.open) keepMenuInView('.ctx-menu', contextMenu.value)
    return contextMenu.value.open
  }
  if (!target.closest('.vue-flow__pane')) return false
  onPaneContextMenu(ev as unknown as MouseEvent)
  if (addMenu.value.open) keepMenuInView('[data-menu=add]', addMenu.value)
  return addMenu.value.open
}
/**
 * 手机上加节点菜单比手指下面剩的高度还高（按右键的老算法只给它留了 360px）：整块往上挪到底边以内。
 * 只在长按这条路上做，鼠标右键的位置一点不变
 */
function keepMenuInView(sel: string, m: { y: number }) {
  void nextTick(() => {
    const el = edRef.value?.querySelector<HTMLElement>(sel)
    if (!el) return
    const top = el.getBoundingClientRect().top
    const h = Math.min(el.scrollHeight, window.innerHeight - 16)
    const over = top + h - (window.innerHeight - 8)
    if (over > 0) m.y = Math.max(8, m.y - over)
  })
}
/** 触屏多选：工具面板里的开关，开着时点节点是加入 / 移出选择 */
const { on: touchMultiOn, toggle: toggleTouchMulti, done: endTouchMulti } = useTouchMultiSelect({
  enabled: () => touchFirst && !readOnly.value,
  count: () => getSelectedNodes.value.length,
  active: multiSelectionActive,
})

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
  // 触屏多选开着：点节点是在挑节点，不出面板
  return n && n.id !== panelDismissedId.value && nodeLayout.value !== 'c' && !touchMultiOn.value ? n : null
})
watch(() => soleGenNode.value?.id || '', (id) => { if (id !== panelDismissedId.value) panelDismissedId.value = '' })
onNodeClick(({ node }) => { if (node.id === panelDismissedId.value) panelDismissedId.value = '' })
function closeGenPanel() {
  if (soleGenNode.value) panelDismissedId.value = soleGenNode.value.id
  // 焦点刚从提示词框里出来：节点还选着，接着候着输入法（再打字就把面板唤回来）
  void nextTick(armIme)
}
const genPanelRef = ref<{ focusPrompt: () => boolean; run: () => void; makeRoom?: () => boolean } | null>(null)
/**
 * 输入条 / 属性面板眼下是贴底的抽屉（手机宽度，或者桌面上编辑区放不下「节点 + 输入条」）时它占的矩形，相对编辑区；
 * 不是抽屉就是 null。抽屉压在所有悬浮块上面，所以它开着的时候：
 *   · 底部工具条、它上面的小条、小地图先收起来（被盖住一半比不出现更糟），抽屉一关就回来；
 *   · 生成队列圆钮、工具面板把它当成占着的一块绕开（圆钮挪到它上面，面板挪到最近的空地），抽屉一关各回各位。
 * 面板卸掉时它自己会报 null（见 GenComposer / GenInspector 的 sheet 事件）。
 */
const panelSheet = ref<Rect | null>(null)
/**
 * 顶上那几排（标题块；手机上还有工具面板的一横条；只读提示条；没有模型的提示）到哪儿为止，相对编辑区。
 * 贴底的抽屉按它封顶（样式里的 --ed-top）：抽屉和这几排之间总要给正在看的那个节点留出一条 ——
 * 560 高的手机上只读提示条折成两行，不这么算抽屉会一直顶到提示条底下，中间一点画布都不剩。
 * 这几块各有各的变法（名字变长、提示条时有时无、折不折行），隔一会儿量一次。
 */
const edTop = ref(110)
let stopTopRows: (() => void) | null = null
onMounted(() => {
  // 工具面板只算手机上那一横条（位置是样式写死的）。能拖动的那种不算：它自己要绕开贴底的抽屉，抽屉的高度又按这个数封顶 ——
  // 把它算进来两边就互相追着跑（抽屉开着时横排的面板让到抽屉上面 → 算成「顶上一排」→ 抽屉变矮 → 面板跟着下去 →
  // 不算了 → 抽屉变回去……）。量的结果不能取决于量完之后会变的东西
  stopTopRows = watchRects(() => edRef.value, TOP_ROWS, (rects) => {
    const next = topRowsBottom(rects)
    if (next !== edTop.value) edTop.value = next
  }, 500)
})
const TOP_ROWS = '.ed-title, .ed-pal.phone, .clb, .ed-hint'
const topRowsBottom = (rects: Rect[]) => {
  const rows = rects.filter((r) => r.t < 220 && r.r - r.l > r.b - r.t)
  return rows.length ? Math.round(Math.max(...rows.map((r) => r.b))) : 60
}
onBeforeUnmount(() => { stopTopRows?.(); stopTopRows = null })
/** 属性面板开着时占掉的右侧宽度；「适应屏幕」、新节点落点、队列圆钮都要让出来。手机上面板是底部抽屉，不占宽度 */
const paneWidth = ref(1200)
const paneHeight = ref(800)
const inspectorInset = computed(() => (nodeLayout.value === 'b' && panelNode.value && paneWidth.value > 640 ? INSPECTOR_WIDTH + INSPECTOR_GAP : 0))
/**
 * 属性面板开着、窗口又不宽（1000–1100 那一档）时，底部工具条往左让，小地图和它之间就不够放了 —— 两块会叠在一起。
 * 这时先收起小地图（面板一关就回来）：工具条是要点的，小地图只是看的。数 = 小地图那一条 + 工具条的常见宽度 + 两边的空。
 */
const miniCramped = computed(() => !!panelSheet.value || paneHeight.value < MINI_MIN_PANE_H || paneWidth.value - inspectorInset.value < toolsWidth.value + 2 * MINI_STRIP)
/**
 * 小地图那一条有多宽：左边距 16 + 小地图 168 + 和工具条之间的空 12。底部工具条是居中的（属性面板开着时在剩下的宽度里居中），
 * 它的左边缘到不了这条线右边，两块就叠上了 —— 以前只在属性面板开着时才查，窗口 700–960 宽、面板没开时照样叠。
 * 工具条的宽度是量出来的：语言、有没有「本月上限」那一小段、只读（只剩缩放那几颗）都会改它。
 */
const MINI_STRIP = 196
const toolsRef = ref<HTMLElement | null>(null)
const toolsWidth = ref(520)
/**
 * 编辑区矮到这个数以下（笔记本上开着开发者工具、嵌在别人页面里的一小条）也先收起小地图：它占着左下角 126 高的一截，
 * 工具面板从标题块下面（76）排下来，收到最紧（小一号 + 只留「+」「更多工具」「更多」，155 高）也放不下，
 * 只能被挤到小地图旁边去。面板是要点的，小地图只是看的。
 */
const MINI_MIN_PANE_H = 372

/**
 * 布局 b：属性面板停在画布右缘，窗口不宽（1000–1100）时它正好盖住右边那一列节点 —— 点中的那个节点
 * 一选上就被自己的面板挡住了。面板一开，选中的节点要是落在它底下，就把画布横向平移到看得见的地方
 * （带动画；只是换了个视野，不是改动，不进撤销）。只挪刚好够的距离，纵向不动；节点比空出来的那一段还宽时左边对齐。
 * 等手松开再挪：按下节点可能是要拖它，拖到一半画布自己动起来会把节点甩出去。
 */
let pointerHeld = false
let revealPending = ''
let revealTimer: number | null = null
/** 这个节点刚被「定位过去」（队列 / 搜索）：视野已经按面板开着的样子摆好了，不用再挪 */
let revealSkipId = ''
function revealNode(id: string) {
  const n = findNode(id)
  const pane = edRef.value?.querySelector('.vf-wrap') as HTMLElement | null
  if (!n || !pane || inspectorInset.value <= 0) return
  const W = pane.clientWidth
  const ins = chromeInsets(W, pane.clientHeight)
  const vp = viewport.value
  const z = vp.zoom || 1
  const est = estimateNodeSize(n.type, nodeLayout.value)
  const x = vp.x + (n.computedPosition?.x ?? n.position.x) * z
  const w = (measuredSize(id)?.width || est.w) * z
  const left = ins.l, right = W - ins.r
  // 没被面板盖住：不动（哪怕它有一截在别处出了视野 —— 那是用户自己摆的视野）
  if (x + w <= W - inspectorInset.value) return
  let dx = right - (x + w)
  if (x + dx < left) dx = left - x
  if (Math.abs(dx) < 1) return
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  void setViewport({ x: vp.x + dx, y: vp.y, zoom: z }, { duration: still ? 0 : 260 })
}
function flushReveal() {
  revealTimer = null
  const id = revealPending
  if (!id || pointerHeld) return
  revealPending = ''
  if (panelNode.value?.id !== id) return
  if (nodeLayout.value === 'b') revealNode(id)
  // 布局 a：节点四周放不下输入条（窗口矮、节点靠边）时，同样把画布挪一小段腾出地方，不让输入条盖住节点自己的端口
  else if (nodeLayout.value === 'a') genPanelRef.value?.makeRoom?.()
}
function scheduleReveal(id: string, wait = 80) {
  revealPending = id
  if (revealTimer !== null) clearTimeout(revealTimer)
  // 等一拍：面板这一拍才挂出来，工具面板也可能因为它让了位
  revealTimer = window.setTimeout(flushReveal, wait)
}
/** 输入条要等节点端口旁的名字小签淡入、自己的高度量出来之后才知道放不放得下 */
const ROOM_WAIT = 300
function onRevealPointerDown(e: PointerEvent) {
  pointerHeld = true
  lastInput = { type: e.pointerType || 'mouse', at: Date.now() }
}
function onRevealPointerUp() {
  pointerHeld = false
  if (revealPending) scheduleReveal(revealPending, nodeLayout.value === 'a' ? ROOM_WAIT : 80)
  // 点完 / 拖完之后（click 已经发完、选中已经更新）：该候着输入法就候着
  window.setTimeout(armIme, 0)
}
watch(() => (nodeLayout.value === 'b' && inspectorInset.value > 0 && panelNode.value ? panelNode.value.id : ''), (id) => {
  if (!id) { revealPending = ''; return }
  if (id === revealSkipId) { revealSkipId = ''; return }
  scheduleReveal(id)
})
watch(() => (nodeLayout.value === 'a' && panelNode.value ? panelNode.value.id : ''), (id) => {
  if (!id) { if (nodeLayout.value === 'a') revealPending = ''; return }
  // 刚被「定位过去」的节点：等那一下平移走完再看
  scheduleReveal(id, id === revealSkipId ? ROOM_WAIT + 360 : ROOM_WAIT)
})

// 布局 c：节点把「聚焦自己的提示词框」登记上来
const promptFocusers = new Map<string, () => void>()
/**
 * 只读时各节点「切换着看」到了哪一版 / 哪一张：只记在这里，不写进节点数据（存着的文档一个字节都不变）。
 * 变回可编辑、换了画布就清空 —— 可编辑时看到的必须是文档里真存着的那一版。
 */
const nodePeek = reactive(new Map<string, NodePeek>())
provide(CANVAS_NODE_UI_KEY, {
  layout: nodeLayout,
  // 所有节点类型都看它：只读时「做事」的入口不出现，「看」的照常（见 composables/nodeLayout.ts）
  readOnly,
  registerPromptFocus: (id, fn) => { if (fn) promptFocusers.set(id, fn); else promptFocusers.delete(id) },
  viewMedia: (url, type) => { if (url) lightbox.value = { open: true, url, type } },
  peek: nodePeek,
  fillDefaults: fillNodeDefaults,
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
    // 面板被收起了（按过 Esc）：先打开，等它挂出来再把焦点放进去。这都发生在这一键的默认动作之前，
    // 所以唤出面板的这个字符照常进到提示词框里，不会丢
    panelDismissedId.value = ''
    void nextTick(() => genPanelRef.value?.focusPrompt())
    return false
  }
  return genPanelRef.value?.focusPrompt() || false
}

/* ---------- 选中一个生成节点后，直接用输入法打字 ---------- */
/**
 * 浏览器只在「可编辑的元素」有焦点时才开着输入法。焦点在节点（一个普通 div）上时，第一个键是当作英文字母送进页面的，
 * 等焦点挪进提示词框、输入法才接手 —— 想打「你好」，框里出来的是一个「n」再加上「ihao」拼出来的字。
 *
 * 所以选中一个生成节点之后（鼠标点的，或者键盘走到它身上选中的），把焦点悄悄放到一个看不见的输入框上等着
 * （下面叫「候着的框」）：
 *   · 它在一个 closed 的 shadow root 里：页面上别的按键处理（画布的快捷键、vue-flow 的空格平移 / Shift 框选）
 *     看到的事件目标是外面那个 div，不是输入框 —— 它们照常工作，Delete 还是删节点，Ctrl+Z 还是撤销；
 *   · 直接敲字母（没开输入法）：和以前一样，按下的那一刻把焦点挪进提示词框，这个字母照常进去；
 *   · 输入法组字：就在候着的框里组。组的过程实时写在提示词框的末尾、底下画着下划线（和在框里直接组字一个样），
 *     候着的框跟着这一段的末尾走 —— 输入法的候选窗是贴着它出的，所以就开在字旁边。上屏之后把焦点交给提示词框；
 *   · 方向键、Esc 转给节点（vue-flow 用它们挪节点 / 取消选中），Tab 先把焦点还给节点再走：Tab 顺序和以前一样。
 * 触屏、手写笔不这么做：聚焦一个输入框就会弹出软键盘 / 手写板，点一下节点不该这样 —— 要打字就点提示词框。
 */
const imeHostRef = ref<HTMLElement | null>(null)
/** 候着的框在哪、多高（相对编辑区）：贴着提示词框里的光标 */
const imeBox = ref({ x: 0, y: 0, h: 18 })
/** 正在组的那一段字的下划线，一行一条（相对编辑区） */
const imeMarks = ref<{ x: number; y: number; w: number; c: string }[]>([])
let imeTa: HTMLTextAreaElement | null = null
let imeComposing = false
/** 这一次组字开始前提示词框里的字：组字过程中显示的是「它 + 正在组的那一段」 */
let imeBase: { el: HTMLTextAreaElement; value: string } | null = null
/** 这一次组字是给哪个节点的 */
let imeNode = ''
/** 最近一次是用什么操作的：mouse / touch / pen（指针按下），key（按键） */
let lastInput = { type: '', at: 0 }
/**
 * 组字写进去的那个提示词框这会儿并没有焦点（焦点在候着的框上），但它得照「正在里面打字」的样子画：
 * 布局 c 节点里的框没聚焦时收成两行，组的字一多就看不见了。所以组字期间告诉它一声（它只认 focus / blur 事件）。
 */
let imeLit: HTMLTextAreaElement | null = null
function imeLight(el: HTMLTextAreaElement) {
  if (imeLit === el || document.activeElement === el) return
  imeUnlight()
  imeLit = el
  el.dispatchEvent(new FocusEvent('focus'))
}
function imeUnlight() {
  const el = imeLit
  imeLit = null
  // 真的聚焦上去了就不用还原：它自己会收到真的 blur
  if (el && el.isConnected && document.activeElement !== el) el.dispatchEvent(new FocusEvent('blur'))
}
/** Tab 交接的那一下：焦点先还给节点、再由浏览器往下走，这一下落在节点上不算「键盘走到了节点上」 */
let imeHandoff = false
let imeFrame = 0

const selectedGenEl = () => {
  const n = soleGenNode.value
  return n ? edRef.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(n.id)}"]`) || null : null
}
/** 直接打字会落进去的那个框：和 focusGenPrompt 聚焦的是同一个（a 输入条 / b 属性面板 / c 节点里；没有提示词框的落到系统提示词） */
function genPromptEl(): HTMLTextAreaElement | null {
  if (!soleGenNode.value) return null
  const scope = nodeLayout.value === 'c' ? selectedGenEl() : edRef.value?.querySelector('.gc, .gi')
  return scope?.querySelector<HTMLTextAreaElement>('textarea.gf-textarea:not(:disabled)') || null
}
const imeFocused = () => !!imeHostRef.value && document.activeElement === imeHostRef.value
/**
 * 把候着的框摆到提示词框里的光标上 —— 没在组字时是字的末尾，正在组字时是这一段的末尾 —— 并画出这一段的下划线。
 * 提示词框还没出来（面板收着、节点没画出来）就摆在节点左下角。
 */
function placeIme() {
  const ed = edRef.value
  if (!ed) return
  const o = ed.getBoundingClientRect()
  const el = genPromptEl()
  if (el) {
    const end = el.value.length
    const from = imeComposing && imeBase?.el === el ? Math.min(imeBase.value.length, end) : end
    const rects = textareaRangeRects(el, from, end)
    const last = rects[rects.length - 1]
    if (last) {
      // 线的颜色就是框里字的颜色（各布局、聚焦与否不一样）
      const c = from < end ? getComputedStyle(el).color : ''
      imeMarks.value = from < end
        ? rects.map((r) => ({ x: Math.round(r.left - o.left), y: Math.round(r.bottom - o.top) - 1, w: Math.max(1, Math.round(r.right - r.left)), c }))
        : []
      imeBox.value = { x: Math.round(last.right - o.left), y: Math.round(last.top - o.top), h: Math.max(12, Math.round(last.bottom - last.top)) }
      return
    }
  }
  imeMarks.value = []
  const at = el || selectedGenEl()
  if (!at) return
  const r = at.getBoundingClientRect()
  imeBox.value = { x: Math.round(r.left - o.left + 12), y: Math.round(r.bottom - o.top - 20), h: 18 }
}
/** 下一帧再摆一次（输入条的高度、位置这一拍可能刚变）；一帧里只摆一次 */
function trackIme() {
  if (imeFrame || typeof requestAnimationFrame === 'undefined') return
  imeFrame = requestAnimationFrame(() => { imeFrame = 0; if (imeFocused()) placeIme() })
}
/** 该候着就候着：只选中了一个生成节点、焦点在画布上（不在任何控件里）、用的是鼠标或键盘 */
function armIme() {
  if (!imeTa || !soleGenNode.value || readOnly.value || anyOverlayOpen()) return
  // 触屏 / 手写笔：聚焦输入框会弹出软键盘 / 手写板
  if (lastInput.type !== 'mouse' && lastInput.type !== 'key') return
  const active = document.activeElement
  if (active && active !== document.body && active !== selectedGenEl()) return
  // 刚拖着选了一段字（报错信息是可以选中复制的）：聚焦会把选区清掉
  if (window.getSelection()?.toString()) return
  placeIme()
  imeTa.focus({ preventScroll: true })
}
function disarmIme() {
  if (imeFocused()) imeTa?.blur()
}
/** 键盘把焦点带到了选中的那个生成节点上（Tab / Shift+Tab 走回来）：同样候着 */
function onEdFocusIn(e: FocusEvent) {
  if (imeHandoff || lastInput.type !== 'key') return
  if (e.target && e.target === selectedGenEl()) armIme()
}
/** 把「组字前的字 + 这一段」写进提示词框（走它自己的 input，和手打的一样进节点数据） */
function imeApply(text: string): HTMLTextAreaElement | null {
  // 组到一半选中的节点换了（或没了）：这一段不写进别的节点里
  if (!soleGenNode.value || soleGenNode.value.id !== imeNode) return null
  const el = genPromptEl()
  if (!el) return null
  if (!imeBase || imeBase.el !== el) imeBase = { el, value: el.value }
  if (imeComposing) imeLight(el)
  const next = (imeBase.value + text).slice(0, el.maxLength > 0 ? el.maxLength : undefined)
  if (el.value !== next) {
    el.value = next
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }
  // 字是接在末尾的：框里的字多到要滚动时，滚到看得见这一段
  el.scrollTop = el.scrollHeight
  return el
}
function onImeStart() {
  imeComposing = true
  imeBase = null
  imeNode = soleGenNode.value?.id || ''
  // 面板被收起了（按过 Esc）：组字一开始就把它唤出来
  if (soleGenNode.value && !panelNode.value && nodeLayout.value !== 'c') panelDismissedId.value = ''
  placeIme()
}
function onImeUpdate(e: CompositionEvent) {
  imeApply(e.data || '')
  // 现在就摆（候选窗马上要用这个位置），下一帧、稍后再各摆一次：输入条会因为字多了一行而长高、挪位
  placeIme()
  trackIme()
  window.setTimeout(() => { if (imeComposing) placeIme() }, 140)
}
function onImeEnd(e: CompositionEvent) {
  imeComposing = false
  imeMarks.value = []
  const text = e.data || ''
  const finish = () => {
    const el = imeApply(text)
    imeBase = null
    if (imeTa) imeTa.value = ''
    // 上屏了：后面的字直接打在提示词框里。组字是被「点了别处」打断的就不抢焦点
    if (el && imeFocused()) {
      el.focus({ preventScroll: true })
      el.setSelectionRange(el.value.length, el.value.length)
    }
    imeUnlight()
  }
  // 面板这一拍才挂出来（刚被唤出）：等它
  if (genPromptEl()) finish()
  else void nextTick(finish)
}
function onImeInput() {
  // 不是组字进来的字（粘贴、没接住的字符）：不留在这个看不见的框里
  if (!imeComposing && imeTa) imeTa.value = ''
}
function onImeKeydown(e: KeyboardEvent) {
  // 输入法的键：候选窗马上要出，先把位置摆准（输入条可能刚挪过）
  if (e.isComposing || e.keyCode === 229) { if (!imeComposing) placeIme(); return }
  const el = selectedGenEl()
  if (!el) return
  // Tab：从节点接着往下走，而不是从这个看不见的框
  if (e.key === 'Tab') {
    imeHandoff = true
    el.focus({ preventScroll: true })
    window.setTimeout(() => { imeHandoff = false }, 0)
    return
  }
  // 回车在节点上本来就什么都不做（已经选中了）：别让它在这个看不见的框里换行
  if (e.key === 'Enter') { e.preventDefault(); return }
  // 方向键（挪节点）、Esc（取消选中）是 vue-flow 挂在节点自己身上的：转给它。
  // 走到这儿的 Esc 是面板已经收起之后的那一下 —— 面板开着时的 Esc 在画布的捕获阶段就处理掉了
  const arrow = e.key.startsWith('Arrow') && !e.ctrlKey && !e.metaKey && !e.altKey
  if (arrow || e.key === 'Escape') {
    if (arrow) e.preventDefault()
    el.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true }))
  }
}
function onModalityKey() { lastInput = { type: 'key', at: Date.now() } }
function onImeResize() { if (imeFocused()) trackIme() }
onMounted(() => {
  window.addEventListener('keydown', onModalityKey, true)
  window.addEventListener('resize', onImeResize)
  edRef.value?.addEventListener('focusin', onEdFocusIn)
  const host = imeHostRef.value
  if (!host || typeof host.attachShadow !== 'function') return
  try {
    const ta = document.createElement('textarea')
    ta.tabIndex = -1
    ta.rows = 1
    ta.setAttribute('aria-label', t('canvas.typeHere'))
    ta.setAttribute('autocomplete', 'off')
    ta.setAttribute('autocapitalize', 'off')
    ta.spellcheck = false
    // 样式走 CSSOM（内容安全策略不许写 style 属性）；shadow root 里用不到外面的样式表
    for (const [k, v] of Object.entries({ display: 'block', width: '2px', height: '100%', margin: '0', padding: '0', border: '0', outline: '0', resize: 'none', overflow: 'hidden', background: 'transparent', color: 'transparent', caretColor: 'transparent', font: '14px/18px sans-serif' })) {
      ta.style.setProperty(k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()), v)
    }
    ta.addEventListener('compositionstart', onImeStart)
    ta.addEventListener('compositionupdate', onImeUpdate)
    ta.addEventListener('compositionend', onImeEnd)
    ta.addEventListener('input', onImeInput)
    ta.addEventListener('keydown', onImeKeydown)
    ta.addEventListener('blur', () => { imeMarks.value = []; if (!imeComposing) imeUnlight() })
    host.attachShadow({ mode: 'closed' }).appendChild(ta)
    imeTa = ta
  } catch { /* 没有 shadow DOM 的环境：退回老办法，第一键按下时再聚焦 */ }
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onModalityKey, true)
  window.removeEventListener('resize', onImeResize)
  edRef.value?.removeEventListener('focusin', onEdFocusIn)
  if (imeFrame) cancelAnimationFrame(imeFrame)
  imeTa = null
})
watch(locale, () => { imeTa?.setAttribute('aria-label', t('canvas.typeHere')) })
// 选中的换了（或没了）：该候着就候着，不该就放开
watch(() => soleGenNode.value?.id || '', (id) => {
  if (!id) { disarmIme(); return }
  void nextTick(armIme)
}, { flush: 'post' })
watch(readOnly, (ro) => { if (ro) disarmIme() })
// 候着的时候画布平移 / 缩放了：光标的位置跟着变
watch(viewport, () => { if (imeFocused()) trackIme() })

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
/** 换这张画布套用的品牌包：记一笔历史，撤销一步回到原来那个、重做再套上（hist 的 extra 带着 canvasKitId 走） */
function setCanvasKit(id: string) {
  const next = id || ''
  if (readOnly.value || next === canvasKitId.value) return
  hist.record()
  canvasKitId.value = next
}
/** 改一个节点的例外：'' = 跟随画布（把字段删掉，而不是存一个空串） */
function setNodeKitOverride(nodeId: string, value: string) {
  const n = nodes.value.find((x) => x.id === nodeId)
  if (readOnly.value || !n || (n.data?.brandKitOverride || '') === value) return
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
  if (created) setCanvasKit(kit.id)
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
  else if (status === 'error') embed.emit('run:failed', { ...base, error: storedRefusal(d.refusal) ? refusalText(storedRefusal(d.refusal)!).full : String(d.errorMsg || '') })
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

/** 「运行所选」已经就整批问过一次「要不要重跑」：批里逐个节点发起运行的那一瞬间不再各问一遍（见 runSelected） */
let rerunApproved = false
const executor = useCanvasExecutor({
  nodes, edges, updateNodeData: updateNodeDataTracked,
  getNodeBrandKit: (nodeData) => resolveKit(nodeData).kit,
  getWorkflowId: () => currentId.value,
  persist: () => doSave(true),
  confirmRerun: (info) => (rerunApproved ? Promise.resolve(true) : confirmRerun(info)),
})
provide(CANVAS_EXECUTOR_KEY, executor)
// 切换界面语言：后端给出的运行失败原因跟着换
watch(locale, () => { void executor.refreshRunErrors() })

/* ==================== 撤销 / 重做 ==================== */
// 约定：每个会改变画布结构的操作，动手之前先调一次 hist.record()。
// 为什么不挂 watch 自动记录，见 useCanvasHistory 顶部注释。
const hist = useCanvasHistory({
  nodes, edges,
  // 画布套用的品牌包不在节点里，但换它一样是「改了画布」：跟着快照一起记、一起还原
  extra: { get: () => ({ kit: canvasKitId.value }), set: (v) => { canvasKitId.value = typeof v?.kit === 'string' ? v.kit : '' } },
})

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
// 小地图：外框、遮罩、节点块、视口框都走「画布底」那组令牌（--mini-*），跟着底色的明暗走 —— 浅色主题里选了深底，
// 小地图就是深色的一块。颜色由样式给（见下面 .vf-wrap 的几条）：传给组件的属性只是样式表到位之前的初值，
// 属性里也解析不了画布容器上 [data-ground] 换过的取值。
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
  if (readOnly.value) return
  bgSettings.value = normalizeCanvasBg(v)
}

/* ==================== 自动整理 ==================== */
const layout = useAutoLayout({
  nodes, edges, getNodes, updateNode, fitView: fitFree,
  measure: measuredSize,
  nodeLayout: () => nodeLayout.value,
  // 选中的全部节点：getNodes 只有视野里的那些，选区伸到视野外时不能漏
  selected: () => getSelectedNodes.value,
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
  if (readOnly.value) return
  if (nodes.value.length < 2) { MessagePlugin.info(t('canvas.layout.needTwo')); return }
  if (nodes.value.length > LAYOUT_CONFIRM_THRESHOLD && !(await confirmBigLayout(nodes.value.length))) return
  hist.record()
  layoutNote.value = { visible: false, text: '' }
  arrangedLayout.value = nodeLayout.value
  if (await layout.arrange()) showLayoutUndo(t('canvas.layout.arranged'))
  else hist.drop()
}
async function runSnapToGrid() {
  if (readOnly.value) return
  hist.record()
  if (await layout.snapToGrid()) showLayoutUndo(t('canvas.layout.snapped'))
  else { hist.drop(); MessagePlugin.info(t('canvas.layout.alreadySnapped')) }
}
async function runAlign(mode: AlignMode) {
  if (readOnly.value || layout.running.value) return
  hist.record()
  if (await layout.alignSelected(mode)) showLayoutUndo(t('canvas.layout.aligned'))
  else {
    hist.drop()
    MessagePlugin.info(t(layout.selectedCount.value >= 2 ? 'canvas.layout.alreadyAligned' : 'canvas.layout.alignNeedTwo'))
  }
}
async function runDistribute(axis: DistributeAxis) {
  if (readOnly.value || layout.running.value) return
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
  // 只读：只是把这句话收起来，不记「看过了」—— 那一笔是跟着画布存的
  if (readOnly.value) return
  // 看过了：这张画布就算是在当前布局下排的，下次打开不再提（跟着画布存下去）
  arrangedLayout.value = nodeLayout.value
  scheduleAutoSave()
}
async function arrangeFromNote() {
  if (readOnly.value) return
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
  // 「在哪种布局下排的」这一笔是编辑器记的，不是人改的（ownWrite）：打开一张画布后检查完再记，人这时多半已经点过画布了
  const noteArranged = () => ownWrite(() => { arrangedLayout.value = nodeLayout.value })
  if (nodes.value.length < 2) { noteArranged(); return }
  if (kind === 'open') await waitForMeasured()
  else { await nextTick(); await waitForRelayout() }
  if (seq !== layoutCheckSeq || currentId.value !== id) return
  if (layout.hasOverlap()) {
    layoutNote.value = { visible: true, text: t(kind === 'switch' ? 'canvas.nodeLayout.overlapSwitched' : 'canvas.nodeLayout.overlapOpened') }
  } else {
    noteArranged()
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
  alignR:   '<path d="M20 3v18"/><rect x="7" y="6" width="9" height="4" rx="1"/><rect x="3" y="14" width="13" height="4" rx="1"/>',
  alignT:   '<path d="M3 4h18"/><rect x="6" y="8" width="4" height="9" rx="1"/><rect x="14" y="8" width="4" height="13" rx="1"/>',
  alignM:   '<path d="M3 12h18"/><rect x="6" y="6" width="4" height="12" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/>',
  alignB:   '<path d="M3 20h18"/><rect x="6" y="7" width="4" height="9" rx="1"/><rect x="14" y="3" width="4" height="13" rx="1"/>',
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
  // 只读时没有「套用模板」这回事（那是往画布里加节点）
] as CanvasMenuItem[]).filter((i) => (i.key === 'library' ? feat.assetLibrary : i.key === 'templates' ? feat.templates && !readOnly.value : feat.share)))

/**
 * 素材那一组入口叫什么：按真开着的那几项说。素材库和画布模板都在才叫「素材与模板」；只剩一项时就是那一项的名字
 * —— 只开了模板的集成方不该在按钮上读到「素材」，反过来也一样。
 */
const libraryGroupLabel = computed(() => {
  const items = libraryMenuItems.value
  const key = libraryGroupLabelKey(items.map((i) => i.key))
  return key ? t(key) : items[0]?.label || ''
})
/** 菜单里这一组的小标题：只有一项时不用再写一遍 */
const libraryGroupTitle = computed(() => (libraryMenuItems.value.length > 1 ? libraryGroupLabel.value : ''))

/** 只读时「更多」里还留着的：都是看的、拿走的、只影响我自己这边显示的 */
const READ_ONLY_MENU_KEYS = new Set(['immersive', 'list', 'switch-proj', 'guide', 'shortcuts', 'download', 'search', 'library', 'my-shares'])

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
    // 只读：改画布的那些项整项不出，不是摆着置灰
    .map((g) => (readOnly.value ? { ...g, title: g.items.some((i) => READ_ONLY_MENU_KEYS.has(i.key) || i.key.startsWith('node-layout-')) ? g.title : '', items: g.items.filter((i) => READ_ONLY_MENU_KEYS.has(i.key) || i.key.startsWith('node-layout-')) } : g))
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
      { key: 'align-right', label: t('canvas.menu.alignRight'), icon: MENU_ICONS.alignR, disabled: busy, run: () => runAlign('right') },
      { key: 'align-top', label: t('canvas.menu.alignTop'), icon: MENU_ICONS.alignT, disabled: busy, run: () => runAlign('top') },
      { key: 'align-vcenter', label: t('canvas.menu.alignVCenter'), icon: MENU_ICONS.alignM, disabled: busy, run: () => runAlign('vcenter') },
      { key: 'align-bottom', label: t('canvas.menu.alignBottom'), icon: MENU_ICONS.alignB, disabled: busy, run: () => runAlign('bottom') },
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

  groups.push({ title: libraryGroupTitle.value, items: libraryMenuItems.value })

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
// 功能关着（features.imageEditor）就不 provide：图片节点上那颗「裁剪 / 旋转」按 inject 到没有决定出不出
if (feat.imageEditor) provide(CANVAS_IMAGE_EDITOR_KEY, { open: (opts) => openImageEditor(opts.url, opts.nodeId) })

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
  if (!n || readOnly.value) return
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
  // 编辑器开着的时候丢了编辑权：结果不往画布上写
  if (readOnly.value) { closeEditor(null); return }
  const nodeId = editorState.value.nodeId
  if (payload.mode === 'replace') applyEditReplace(nodeId, payload.url)
  else applyEditAsNewNode(nodeId, payload.url)
  closeEditor(payload)
  MessagePlugin.success(payload.mode === 'replace' ? t('canvas.editor.replaced') : t('canvas.editor.newNode'))
}

/* ==================== 工具面板 ==================== */
// 「+」是全部节点；下面按类别各一颗按钮，点开是这一类的节点；再往后是素材库那组入口、分享和「更多」。
// 只有一种节点的类别（文本）点一下直接加。手机上展开层变成底部抽屉。
type FlyKey = '' | 'all' | 'lib' | 'over' | 'text' | 'image' | 'video' | 'chat' | 'tools'
const PAL_CATS: { key: Exclude<FlyKey, '' | 'all' | 'lib' | 'over'>; icon: string; kinds: NodeKind[] }[] = [
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
const {
  xy: palXY, rect: palRect, orient: palOrient, phone: palPhone, ready: palReady, dragging: palDragging, isDefault: palIsDefault,
  budget: palBudget, layout: layoutPal, onDown: palDown, onMove: palMove, onUp: palUp, nudge: nudgePal, toggleOrient, reset: resetPal,
} = usePaletteDock({
  host: edRef,
  el: palRef,
  // 属性面板有入场动画，从 DOM 量会偏：按它的固定尺寸算（右 12、上下 12、宽 INSPECTOR_WIDTH）
  extraObstacles: () => {
    const host = edRef.value
    // 贴底的抽屉开着：面板要是正好在它底下（横排贴在底边、竖排伸到底），挪到最近的空地；抽屉关了回到记着的位置
    const sheet = panelSheet.value ? [panelSheet.value] : []
    if (!host || inspectorInset.value <= 0) return sheet
    const W = host.clientWidth
    return [...sheet, { l: W - 12 - INSPECTOR_WIDTH, t: 12, r: W - 12, b: host.clientHeight - 12 }]
  },
  // 眼下这些按钮一颗不收时有多长（palGroups 在下面才定义；这里只在摆放的时候才读）
  lengths: () => ({ full: palLength(palGroups.value, false), compact: palLength(palGroups.value, true), floor: palFloor(palGroups.value) }),
  onDragStart: () => closeMenus(),
  // 把手上点一下开小菜单；鼠标紧接着再点一下（双击）= 复位
  onGripTap: () => togglePalMenu(),
  onGripDouble: () => resetPalette(),
})

/* ---- 面板上摆哪些按钮 ---- */
// 分组的顺序就是排布的顺序，组与组之间一条分隔线。面板在它该待的地方真放不下时（usePaletteDock 的 planBudget / fitPalette）：
// 先换小一号，再按 fold 从大到小收进「更多工具」：工具 → 对话 → 视频 → 图片 → 文本 → 素材库 → 分享。
// 各类节点先收：「+」一直留在面板上，里面有全部节点，收掉的只是少点一下的捷径；素材库和分享是各自唯一的入口，最后才收。
const PAL_FOLD: Record<string, number> = { tools: 7, chat: 6, video: 5, image: 4, text: 3, lib: 2, share: 1 }
// 团队画布（有可见范围）也出分享钮；这里比 teamCanvas 的定义早，直接读它背后的那一项
const palShare = computed(() => feat.share || (!host && !!collab.meta.value.visibility))
/**
 * 那颗按钮叫什么，要和点开之后看到的对得上：个人画布只有「创建分享链接」；团队画布是「分享与权限」两个页签；
 * 对外链接关着（features.share）的团队画布上只剩「团队权限」—— 这时不能还叫「创建分享链接」。
 */
const shareButtonLabel = computed(() => t(shareButtonLabelKey({ share: feat.share, team: !host && !!collab.meta.value.visibility, readOnly: palReadOnly.value })))
const palExit = computed(() => appStore.immersive && feat.immersive)
const palGroups = computed<PalPart[][]>(() => [
  palPhone.value ? [] : [{ key: 'grip', kind: 'grip' }, { key: 'turn', kind: 'turn' }],
  // 只读：加节点的那几颗换成一枚「只读」标记，后面只留素材库、分享、更多
  palReadOnly.value ? [{ key: 'ro' }] : [{ key: 'all' }],
  palReadOnly.value ? [] : palCats.value.map((c) => ({ key: c.key, fold: PAL_FOLD[c.key] })),
  libraryMenuItems.value.length ? [{ key: 'lib', fold: PAL_FOLD.lib }] : [],
  [...(palShare.value ? [{ key: 'share', fold: PAL_FOLD.share }] : []), ...(touchFirst && !readOnly.value ? [{ key: 'multi' }] : []), { key: 'more' }, ...(palExit.value ? [{ key: 'exit' }] : [])],
])
// 手机：横条的长度就是编辑区宽度减去两边各 8px（样式里的 max-width），放不下就收几颗进「更多工具」，不横着滚
const palFit = computed<PalFit>(() => (palPhone.value ? fitPhoneStrip(palGroups.value, paneWidth.value - 16) : fitPalette(palGroups.value, palBudget.value)))
const palFolded = computed(() => new Set(palFit.value.folded))
/** 提示朝哪边出：竖排朝右（贴着右边时指令自己会翻到左边），横排 / 手机朝下 */
const palTipSide = computed(() => (palOrient.value === 'v' ? 'right' as const : 'bottom' as const))

interface PalItem {
  key: string
  hr?: boolean
  title?: string
  /** LcIcon 的图标名；没有就用 svg（<svg> 里面那一段） */
  icon?: string
  svg?: string
  svgClass?: string
  on?: boolean
  popup?: 'menu' | 'true'
  disabled?: boolean
  /** 只读标记：不是工具，点了说明现在能做什么 */
  ro?: boolean
  /** 开关（触屏多选）：按下 / 没按下 */
  pressed?: boolean
  run: () => void
}
const PAL_OVER_ICON = '<polyline points="7 6 12 11 17 6"/><polyline points="7 13 12 18 17 13"/>'
/** 把手和方向开关之后的那一串：按钮和分隔线，已经去掉收起来的 */
const palShown = computed<PalItem[]>(() => {
  const gone = palFolded.value
  const cats = palCats.value
  const def = (key: string): PalItem | null => {
    if (key === 'all') return { key, title: t('canvas.rail.addNode'), icon: 'plus', on: fly.value === 'all', popup: 'true', run: () => toggleFly('all') }
    if (key === 'ro') return { key, title: t('canvas.readonly.palTip'), icon: 'eye', ro: true, run: explainReadOnly }
    if (key === 'lib') {
      const items = libraryMenuItems.value
      const title = palReadOnly.value && items.some((i) => i.key === 'library') ? t('canvas.readonly.library') : libraryGroupLabel.value
      // 只剩一项：点一下直接开它，不再多弹一层只有一行的清单
      if (items.length === 1) return { key, title, icon: items[0].lc || 'folder', run: () => { closeMenus(); items[0].run() } }
      return { key, title, icon: 'folder', on: fly.value === 'lib', popup: 'true', run: () => toggleFly('lib') }
    }
    if (key === 'share' && palReadOnly.value) return { key, title: shareButtonLabel.value, icon: 'share', run: openShareFromPal }
    if (key === PAL_OVERFLOW) {
      return {
        key, title: t('canvas.pal.overflow'), svg: PAL_OVER_ICON, svgClass: palOrient.value === 'h' ? 'pal-over-h' : '',
        on: fly.value === 'over', popup: 'true', run: () => toggleFly('over'),
      }
    }
    if (key === 'share') return { key, title: shareButtonLabel.value, icon: 'share', disabled: saving.value || publishing.value, run: openShareFromPal }
    if (key === 'more') return { key, title: t('canvas.topbar.more'), icon: 'more', on: moreMenu.value.open, popup: 'menu', run: toggleMoreMenu }
    if (key === 'multi') return { key, title: t('canvas.touchMulti.tip'), icon: 'check', on: touchMultiOn.value, pressed: touchMultiOn.value, run: () => { closeMenus(); toggleTouchMulti() } }
    // 沉浸式里没有外壳导航：留一颗看得见的退出钮
    if (key === 'exit') return { key, title: t('canvas.menu.exitImmersive'), svg: MENU_ICONS.exitFull, run: () => appStore.setImmersive(false) }
    const c = cats.find((x) => x.key === key)
    return c ? { key, title: c.title, icon: c.icon, on: fly.value === c.key, popup: c.kinds.length > 1 ? 'true' : undefined, run: () => onPalClick(c) } : null
  }
  const out: PalItem[] = []
  palGroups.value.slice(1).forEach((group, gi) => {
    const keys = group.map((p) => p.key).filter((k) => !gone.has(k))
    // 展开钮接在类别那一组的末尾
    if (gi === 1 && gone.size) keys.push(PAL_OVERFLOW)
    const items = keys.map(def).filter((x): x is PalItem => !!x)
    if (!items.length) return
    if (out.length) out.push({ key: 'hr-' + gi, hr: true, run: () => {} })
    out.push(...items)
  })
  return out
})
// 收起 / 展开的那一刻：开着的展开层对着的按钮可能已经不在面板上了，收掉
watch(() => palFit.value.folded.join(), () => { if (fly.value) fly.value = '' })
const turnLabel = computed(() => (palOrient.value === 'v' ? t('canvas.pal.toHorizontal') : t('canvas.pal.toVertical')))
/**
 * 只读提示条放哪：标题块右边剩下的那一段里居中；剩得不够宽（窄窗口、长句子）就换到第二行，
 * 手机上再让开标题块下面那一横条工具面板。标题块的宽度跟着名字、标签变，所以量着来。
 */
const titleRef = ref<HTMLElement | null>(null)
const barPlace = ref<{ top: number; left: number; right: number }>({ top: 16, left: 16, right: 16 })
const BAR_MIN_ROOM = 460
function placeBar() {
  const ed = edRef.value
  if (!ed) return
  const title = titleRef.value
  const left = title ? title.offsetLeft + title.offsetWidth + 12 : 16
  // 属性面板（布局 b）开着：右边那一条是它的，提示条不伸到它底下去（按钮会被盖住）
  const right = 16 + inspectorInset.value
  let next: { top: number; left: number; right: number }
  if (ed.clientWidth - left - right >= BAR_MIN_ROOM) next = { top: title ? title.offsetTop : 16, left, right }
  else {
    const row2 = title ? title.offsetTop + title.offsetHeight + 8 : 16
    // 手机：工具面板是标题块下面固定的一横条，提示条排在它下面；桌面：面板默认竖在左边，让开那一列
    const pal = palPhone.value ? palRef.value : null
    next = palPhone.value
      ? { top: pal ? pal.offsetTop + pal.offsetHeight + 8 : row2, left: 8, right: 8 }
      : { top: row2, left: feat.palette ? 76 : 16, right }
  }
  const cur = barPlace.value
  if (cur.top !== next.top || cur.left !== next.left || cur.right !== next.right) barPlace.value = next
}
// 属性面板开合：提示条的右边界跟着变
watch(inspectorInset, () => { void nextTick(placeBar) }, { flush: 'post' })
let barObserver: ResizeObserver | null = null
watch([titleRef, edRef, palRef, palPhone, toolsRef], () => {
  barObserver?.disconnect()
  if (typeof ResizeObserver === 'undefined') { placeBar(); return }
  barObserver = new ResizeObserver(() => { placeBar(); syncPaneWidth() })
  for (const el of [titleRef.value, edRef.value, palRef.value, toolsRef.value]) if (el) barObserver.observe(el)
  placeBar()
}, { flush: 'post', immediate: true })
onBeforeUnmount(() => { barObserver?.disconnect(); barObserver = null })

/** 只读标记点一下：说清楚现在能做什么、不能做什么（触屏上没有悬停提示） */
function explainReadOnly() {
  closeMenus()
  MessagePlugin.info(t('canvas.readonly.explain'))
}
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
    const x = clampNum(right ? P.r + GAP : P.l - GAP - w, EDGE, W - w - EDGE)
    // 编辑区矮、弹出层长的时候它会往上顶：顶到标题块下面为止，不盖住画布的名字和保存状态
    let top = EDGE
    const title = titleRef.value
    if (title && x < title.offsetLeft + title.offsetWidth + GAP && x + w > title.offsetLeft - GAP) top = Math.max(top, title.offsetTop + title.offsetHeight + GAP)
    const maxH = Math.max(120, H - EDGE - top)
    return {
      x,
      y: clampNum(by - 6, top, Math.max(top, H - EDGE - Math.min(h, maxH))),
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
// 属性面板开合、提示条出现 / 消失、贴底的抽屉开合、只读提示条出现 / 消失：面板重新找位置
// （它们不改编辑区的尺寸，ResizeObserver 不会报）
watch([inspectorInset, () => noModels.value, miniCramped, panelSheet, () => collab.mode.value, barPlace], () => { void nextTick(layoutPal) }, { flush: 'post' })
/**
 * 生成节点的面板开着（贴底的抽屉，或布局 b 右缘的属性面板）、编辑区又小：工具面板找不到放得下的空地（顶上是标题块，
 * 下面 / 右边是面板），只能留在原位，被面板压住、或者被挤到底部工具条上。这时先把它收起来 —— 人正在面板里改这个节点，
 * 面板一关（Esc）工具面板就回来。收起来的时候它不算占地方（别的悬浮块不用绕它）。
 * 没有面板开着时不收：那时放不下靠的是把面板收紧（fitPalette）。
 */
const hitRect = (a: Rect, b: Rect) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 1 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 1
const palCovered = computed(() => {
  const p = palRect.value, ed = edRef.value
  if (!p || !ed || palPhone.value) return false
  const blocks: Rect[] = []
  if (panelSheet.value) blocks.push(panelSheet.value)
  if (inspectorInset.value > 0) blocks.push({ l: ed.clientWidth - 12 - INSPECTOR_WIDTH, t: 12, r: ed.clientWidth - 12, b: ed.clientHeight - 12 })
  if (!blocks.length) return false
  // 面板开着时底部工具条会往左让、标题块会收窄：工具面板要是找不到空地、压在它们身上也算
  return [...blocks, ...rectsIn(ed, '.ed-tools, .ed-title, .clb')].some((b) => hitRect(p, b))
})
/** 输入条、多选工具条要绕开的矩形：工具面板眼下的位置 */
const palAvoid = computed<Rect[]>(() => (palRect.value && !palCovered.value ? [palRect.value] : []))
/**
 * 「撤销整理」/「节点互相压住了」那条小条默认浮在底部工具条上面。工具面板要是正好停在那儿（横排拖到了底边），
 * 小条升到面板上面去：它是临时出现的那一个，不让常驻的面板为它跳开。
 */
const undoStyle = computed(() => {
  if (palPhone.value) return undefined
  const H = paneHeight.value, room = paneWidth.value - inspectorInset.value, mid = room / 2
  let bottom = 0
  // 小地图开着（只读时底部工具条很短，窄窗口里小地图也在）而编辑区不够宽：小条居中、最宽五百多，会伸到小地图上面去 ——
  // 升到小地图上面（小地图：离底 20、高 104）
  if (feat.minimap && !miniCramped.value && room < 580 + 2 * MINI_STRIP) bottom = 20 + 104 + 12
  const p = palCovered.value ? null : palRect.value
  if (p) {
    // 小条：离底 80（或者上面算出来的那个数）、高 36、居中
    const base = bottom || 80
    const band: Rect = { l: mid - 290, r: mid + 290, t: H - base - 36 - 8, b: H - base + 8 }
    if (hitRect(p, band)) {
      const above = Math.round(H - p.t + 12)
      // 面板很高（竖排横在中间）：升上去就顶到标题块了，那就不动
      if (H - above - 36 > 76) bottom = above
    }
  }
  return bottom ? { bottom: bottom + 'px' } : undefined
})
/** 生成队列圆钮要绕开的：工具面板，加上贴底的抽屉（开着的话） */
const queueAvoid = computed<Rect[]>(() => [...palAvoid.value, ...(panelSheet.value ? [panelSheet.value] : [])])

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
// （不直接看 palShown：它里面读的 saving / publishing 定义在后面，这里一建监听就会去读）
watch([palPhone, () => appStore.immersive, palOrient, () => palFit.value.folded.join(), () => palGroups.value.flat().length], () => { void nextTick(() => syncPalTabStops()) }, { flush: 'post' })
onMounted(() => syncPalTabStops())

/**
 * 四边各被悬浮块占掉多少：「适应屏幕」和新节点的落点都按这个让。
 * 面板想放哪放哪，所以只在它贴边的时候让：竖排贴左 / 右边让出那一条宽度，横排在顶上 / 底下那一带
 * 让出那一条高度；漂在画布中间时不让 —— 那是用户自己挑的位置，和别的小控件一样允许节点从底下过。
 */
function chromeInsets(W: number, H: number): { l: number; t: number; r: number; b: number } {
  layoutPal()
  // 被面板挤得收起来的工具面板不占地方
  const p = palCovered.value ? null : palRect.value
  // 顶上那几排实际到哪儿为止（edTop：标题块、手机上面板那一横条，加上只读提示条 / 没有模型的提示 —— 窄窗口里提示条
  // 排在第二行，有人正在编辑时还会折成三行）。以前只按标题块和面板算：只读的人在手机上从搜索 / 队列跳到一个节点，
  // 节点的上半截和输出端口正好压在提示条底下。
  // 这里现量，不用 edTop 记着的那个数：它半秒才量一次，提示条刚出现 / 刚折成三行的那半秒里（载入后拿不到锁的那一下、
  // 对方刚开始编辑）记着的还是旧的，这时候「适应屏幕」「定位到节点」照旧数算，节点就又压到提示条底下去了
  const top = edRef.value ? topRowsBottom(rectsIn(edRef.value, TOP_ROWS)) : edTop.value
  // 手机：顶上是标题块 + 面板那一横条；底边除了工具条，还有它上面右角的生成队列圆钮
  if (palPhone.value) return { l: 12, t: Math.max(60, (p ? p.b : 102) + 6, top + 6), r: 12, b: 126 }
  // 顶上让给标题块；底边多让一截：左下角的小地图比工具条高（右下角的圆钮也在这一条里）；
  // 右边：属性面板开着时把它的宽度让出来
  const ins = { l: 24, t: Math.max(76, top + 16), r: 24 + inspectorInset.value, b: 140 }
  if (!p) return ins
  if (palOrient.value === 'v') {
    if (p.l <= 18) ins.l = p.r + 24
    else if (p.r >= W - inspectorInset.value - 18) ins.r = W - p.l + 24
  } else if (p.t <= Math.max(78, top + 18)) {
    // 横排在顶上那一带：贴着上边，或者被标题块 / 提示条挤到它们下面那一行
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
  if (fly.value === 'lib') return libraryGroupLabel.value
  if (fly.value === 'over') return t('canvas.pal.overflow')
  return fly.value ? t(PAL_TITLE_KEYS[fly.value]) : ''
})
const flyGroups = computed<{ title: string; items: CanvasMenuItem[] }[]>(() => {
  if (fly.value === 'all') {
    return [
      ...NODE_MENU_LAYOUT.map((g) => ({ title: t(g.titleKey), items: g.kinds.filter((k) => offeredKinds.value.has(k)).map(nodeMenuItem) })),
      { title: t('canvas.menu.groupTitle'), items: [frameMenuItem.value] },
      { title: libraryGroupTitle.value, items: libraryMenuItems.value },
    ].filter((g) => g.items.length)
  }
  if (fly.value === 'lib') return [{ title: '', items: libraryMenuItems.value }]
  const catItems = (cat: { key: string; kinds: NodeKind[] }) => {
    const items = cat.kinds.map(nodeMenuItem)
    // 「组」不是往画布上加一个节点，而是把选中的节点圈起来 —— 归在工具里
    if (cat.key === 'tools') items.push(frameMenuItem.value)
    return items
  }
  // 「更多工具」：面板上放不下、收起来的那几颗，按它们原来的顺序一组一组列出来
  if (fly.value === 'over') {
    const gone = palFolded.value
    const groups = palCats.value.filter((c) => gone.has(c.key)).map((c) => ({ title: c.title, items: catItems(c) }))
    if (gone.has('lib')) groups.push({ title: libraryGroupTitle.value, items: libraryMenuItems.value })
    if (gone.has('share')) {
      groups.push({ title: '', items: [{ key: 'share', label: shareButtonLabel.value, lc: 'share', disabled: saving.value || publishing.value, run: openShareFromPal }] })
    }
    return groups
  }
  const cat = palCats.value.find((c) => c.key === fly.value)
  return cat ? [{ title: '', items: catItems(cat) }] : []
})
function runFlyItem(item: CanvasMenuItem) {
  if (item.disabled) return
  // 展开层马上要收起：焦点先回到打开它的那颗面板按钮上——这一项要是开了弹窗（素材库、画布模板），弹窗关掉后焦点回到那儿
  const active = document.activeElement
  if (active && flyRef.value?.contains(active)) flyRef.value.ownerDocument.querySelector<HTMLElement>('.ed-pal .lc-tb.on')?.focus({ preventScroll: true })
  fly.value = ''
  item.run()
}

// 右键菜单
const contextMenu = ref({ open: false, x: 0, y: 0, nodeId: '' })
const ctxMenuRef = ref<HTMLElement | null>(null)
/** 这一次是键盘叫出来的（菜单键 / Shift+F10）：焦点进菜单，收起后还给节点 */
let ctxByKey = false
const ctxItems = () => Array.from(ctxMenuRef.value?.querySelectorAll<HTMLElement>('button:not(:disabled)') || [])
/** 菜单里 ↑ ↓ Home End 在各项之间走；Tab 走出去就收起 */
function onCtxMenuKey(e: KeyboardEvent) {
  const list = ctxItems()
  if (!list.length) return
  if (e.key === 'Tab') { e.preventDefault(); closeContextMenuToNode(); return }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  e.preventDefault(); e.stopPropagation()
  const i = list.indexOf(document.activeElement as HTMLElement)
  const to = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
  list[to].focus()
}
/** Esc / Tab 收起右键菜单（焦点怎么还，见 closeContextMenu） */
function closeContextMenuToNode() { closeContextMenu() }

/**
 * 右键一个生成节点时的「品牌包」几项：跟随画布 / 此节点不套用 / 单独用某一个。
 * 一个品牌包都没有、节点也没有例外时不出这一组。
 */
const contextKitOptions = computed<{ value: string; label: string; on: boolean }[] | null>(() => {
  // 品牌包整个关着（features.brandKit）、或者只读（换品牌包是改画布）：不出这一组
  if (!feat.brandKit || readOnly.value) return null
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
  // 只读：菜单里只有「看」的那几项（看原图 / 下载 / 任务详情）。这个节点一项都没有就不弹空菜单，
  // 也不拦浏览器自己的右键菜单 —— 选中的字要能右键复制、图片要能右键另存
  if (readOnly.value && !viewableInfo(node.id)) { closeMenus(); return }
  event.preventDefault?.()
  closeAddMenu()
  // 右键一个还没选中的组，先把它选上：「合并为一组」「移出组」都是按选中集合
  // 干活的，不选上这几项就永远是灰的。已经在选中集里就别动，免得把用户
  // 辛苦框好的一片给清了。
  if (node.type === 'frame' && !readOnly.value) {
    const g = getNodes.value.find((n: any) => n.id === node.id)
    // removeSelectedNodes 要显式传要取消的那批，没有无参重载
    if (g && !g.selected) { removeSelectedNodes(getSelectedNodes.value); addSelectedNodes([g]) }
  }
  // 夹进视口：在屏幕右边 / 底边右键时菜单别开到外面去
  const fr = frame()
  /**
   * 键盘叫出来的（菜单键 / Shift+F10，焦点在节点上）：这个事件没有鼠标按键（button 不是 2），坐标是浏览器按焦点元素估的、
   * 有的环境干脆是 (0, 0)。菜单贴着节点的左上角开，焦点进菜单的第一项 —— 不然菜单开在别处、键盘也走不进去。
   * 触屏长按也是没有右键的 contextmenu，但它带着手指的位置（pointerType 是 touch / pen，或者有 touches）。
   */
  const byTouch = !!event.touches || event.pointerType === 'touch' || event.pointerType === 'pen'
  ctxByKey = !byTouch && event.button !== 2
  let cx = event.clientX ?? event.touches?.[0]?.clientX ?? 0
  let cy = event.clientY ?? event.touches?.[0]?.clientY ?? 0
  if (ctxByKey) {
    const el = edRef.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(node.id)}"]`)
    const r = el?.getBoundingClientRect()
    if (r) { cx = r.left + Math.min(28, r.width / 2); cy = r.top + Math.min(40, r.height / 2) }
  }
  const x = Math.max(8, Math.min(cx - fr.x, fr.w - 288))
  const y = Math.max(8, Math.min(cy - fr.y, fr.h - 380))
  contextMenu.value = {
    open: true,
    x,
    y,
    nodeId: node.id,
  }
  if (ctxByKey) void nextTick(() => ctxItems()[0]?.focus({ preventScroll: true }))
}

// ===== 右键菜单里的「查看原图 / 下载原图 / 任务详情」（仅对有产物的生成节点显示）=====
const GEN_MEDIA_TYPES = ['image-gen', 'image-edit', 'video-gen', 'video-edit']
/** 输出文字的任务节点：没有媒体产物，但同样有任务号和失败原因 */
const TEXT_TASK_TYPES = ['llm', 'video-analysis']
// 右键目标若是带产物的生成节点，解析出媒体信息；否则返回 null（不显示这几项）
function viewableInfo(nodeId: string) {
  const n = nodes.value.find((x) => x.id === nodeId)
  if (!n || !GEN_MEDIA_TYPES.includes(n.type as string)) return null
  const isVideo = n.type === 'video-gen' || n.type === 'video-edit'
  let data: Record<string, any> = n.data || {}
  // 只读时「切换着看」到的那一版（见 nodePeek）：右键出来的原图 / 下载 / 详情是他眼前的这一张
  const pk = readOnly.value ? nodePeek.get(n.id) : undefined
  if (pk) {
    const list = Array.isArray(data.results) ? data.results : []
    const r = typeof pk.resultIndex === 'number' ? list[pk.resultIndex] : null
    const urls: string[] = r ? (r.urls || []).filter(Boolean) : (isVideo ? data.videoUrls : data.imageUrls) || []
    const url = pk.url && urls.includes(pk.url) ? pk.url : r ? urls[0] : ''
    if (url) data = { ...data, ...(isVideo ? { videoUrl: url, videoUrls: urls } : { imageUrl: url, imageUrls: urls }), ...(r ? { cost: r.cost ?? null } : {}) }
  }
  const url = isVideo ? (data.videoUrl || '') : (data.imageUrl || '')
  if (!url) return null
  return {
    mediaType: (isVideo ? 'video' : 'image') as 'image' | 'video',
    url: url as string,
    // 详情弹窗类型与各节点自身用法保持一致（视频编辑也按 video-gen 展示）
    detailType: (n.type === 'video-edit' ? 'video-gen' : n.type) as NodeKind,
    data,
  }
}
const contextNodeInfo = computed(() => viewableInfo(contextMenu.value.nodeId))

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
  if (!contextMenu.value.open) return
  // 键盘叫出来的那一次、焦点还在菜单里（按了 Esc，或者回车选了一项）：菜单一没，焦点会掉回页面开头 —— 还给它的节点。
  // 选的那一项要是开了弹窗，弹窗关掉后焦点也就回到这个节点上
  const back = ctxByKey && contextMenu.value.nodeId && ctxMenuRef.value?.contains(document.activeElement)
    ? edRef.value?.querySelector<HTMLElement>(`.vue-flow__node[data-id="${CSS.escape(contextMenu.value.nodeId)}"]`) || null
    : null
  contextMenu.value.open = false
  back?.focus({ preventScroll: true })
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
  if (!ids.length || readOnly.value) return
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

/* ==================== 多选工具条（已选 N 个 · 对齐 · 编组 · 运行所选） ==================== */
const selCount = computed(() => getSelectedNodes.value.length)
/** 编组：和 Ctrl+G 是同一件事 —— 选中的里面已经有组就合并，全是散节点就圈一个新组 */
function groupSelection() {
  if (selectedGrouped.value >= 1 && getSelectedNodes.value.length >= 2) mergeIntoGroup()
  else groupIntoFrame()
}
/** 能运行的节点：生成类、本机处理的工具类、成品（成品 = 把它的上游跑出来） */
const RUNNABLE_TYPES = new Set<string>(['platform-export', 'slice', 'collage', 'watermark', 'fit-size', 'output'])
const isRunnable = (type: unknown) => isGenNodeKind(type) || RUNNABLE_TYPES.has(type as string)
const selRunnable = computed(() => getSelectedNodes.value.filter((n: any) => isRunnable(n.type)))
const selRunBusy = ref(false)
/**
 * 运行所选：选中的每个可运行节点都跑一次（和逐个点它们的运行钮一样，已有结果的也重跑），它们各自需要重跑的上游一并带上。
 *
 * 选中的节点之间有先后关系时按先后来：上游的先跑完、下游再发起，下游拿到的才是这一次的新结果
 * （各自同时发起的话，下游会直接用上游的旧结果）。没有先后关系的照常并发，名额由执行器管。
 * 「已有结果、要再花一次钱」的确认整批只问一次。
 */
async function runSelected() {
  if (readOnly.value || selRunBusy.value) return
  const targets = selRunnable.value.map((n: any) => n.id as string)
  if (!targets.length) { MessagePlugin.info(t('canvas.sel.runNone')); return }
  // 每月上限已经用完：整批都会被拒，不发
  if (selRunBlocked.value) { MessagePlugin.warning(selRunBlocked.value); return }
  const picked = new Set(targets)
  const upstream = (id: string) => {
    const seen = new Set<string>()
    const walk = (x: string) => { for (const e of edges.value) if (e.target === x && !seen.has(e.source)) { seen.add(e.source); walk(e.source) } }
    walk(id)
    return seen
  }
  const upOf = new Map(targets.map((id) => [id, upstream(id)]))
  // 这一批里已经有结果、又会重新提交的付费节点：选中的那些，加上它们上游被标成「过期」要跟着重跑的
  const holdsPaid = (n: any) => (GEN_MEDIA_TYPES.includes(n.type) ? !!(n.data?.imageUrl || n.data?.videoUrl) : TEXT_TASK_TYPES.includes(n.type) && !!n.data?.text)
  const reruns = new Set<string>()
  for (const id of targets) { const n = findNode(id); if (n && holdsPaid(n)) reruns.add(id) }
  for (const ups of upOf.values()) {
    for (const id of ups) { const n = findNode(id); if (n && !picked.has(id) && n.data?.status === 'stale' && holdsPaid(n)) reruns.add(id) }
  }
  if (reruns.size) {
    const textCount = [...reruns].filter((id) => TEXT_TASK_TYPES.includes(findNode(id)?.type as string)).length
    if (!(await confirmRerun({ count: reruns.size, textCount }))) return
  }
  selRunBusy.value = true
  const started = new Map<string, Promise<void>>()
  // stack：正在等的这条链，误连成环时用它断开，不互相等死
  const run = (id: string, stack: Set<string>): Promise<void> => {
    const had = started.get(id)
    if (had) return had
    const next = new Set(stack).add(id)
    const deps = [...(upOf.get(id) || [])].filter((d) => picked.has(d) && !next.has(d))
    const p = Promise.all(deps.map((d) => run(d, next))).then(() => {
      // 执行器在发起的那一瞬间（同步）问要不要重跑：整批已经问过了
      rerunApproved = true
      try { return executor.runSubtree(id) } finally { rerunApproved = false }
    }).catch(() => { /* 失败写在节点上，这里不用再报 */ })
    started.set(id, p)
    return p
  }
  try {
    await Promise.all(targets.map((id) => run(id, new Set())))
  } finally {
    selRunBusy.value = false
  }
}

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
  if (readOnly.value) return
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
  if (readOnly.value || !clip || !clip.nodes.length) return false
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
  if (!src || readOnly.value) return
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
  if (!src || readOnly.value) return
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
  // 画布还没载入：不是「未保存」（以前每次打开都先闪一下这三个字）
  if (!dirty.value && !lastSavedAt.value && (loading.value || !currentId.value)) return { cls: 'run', text: t('common.loading') }
  if (dirty.value || !lastSavedAt.value) return { cls: 'warn', text: t('canvas.save.unsaved') }
  return { cls: 'ok', text: t('canvas.save.savedAt', { time: formatSavedTime(lastSavedAt.value) }) }
})
/** 保存状态可能出现的几句话（见模板里 .ed-save-box）：占位用，不显示 */
const saveSizers = computed(() => [...new Set([
  t('common.saving'), t('canvas.save.failed'), t('canvas.save.unsaved'),
  t('canvas.save.savedAt', { time: formatSavedTime(lastSavedAt.value) || '00:00' }),
])])
const loading = ref(false)

// 自动保存：去抖 + 指纹去重
const AUTO_SAVE_DELAY = 1500
// 去抖最多推迟这么久。节点在跑的时候进度每隔一两秒写回一次，每次都会重置去抖计时，
// 没有这个上限的话，运行期间（以及别的节点还在跑时刚出的结果）一直存不下去
const AUTO_SAVE_MAX_WAIT = 5000
let autoSaveTimer: number | null = null
let autoSaveDueBy = 0
let lastFingerprint: string | null = null
/** 上次保存时「人画的那部分」的指纹（见 printOf 的 forEdit）：和它一样 = 这次变的只是编辑器自己算出来的东西 */
let lastEditPrint: string | null = null
let suppressAutoSave = false  // 加载 / 重置时临时关闭以避免误触发
/**
 * 载入这张画布之后人动过手没有（指针按下、按键、拖放、粘贴 —— 改画布的每一种办法都要先经过其中一样）。
 * 没动过之前画布上的变化都是编辑器自己补的：生成节点挂上来时把默认模型、对齐后的参数、预估成本写进节点（接口 / 模板建的
 * 画布里没有这些），布局检查把「在哪种布局下排的」记下来。这些要存，但不是「未保存的改动」—— 以前一张没碰过的画布
 * 打开两秒后会跳成「未保存」，再跳「保存中」「已保存」。
 */
let touchedSinceLoad = false
const markTouched = () => { touchedSinceLoad = true }
const TOUCH_EVENTS = ['pointerdown', 'keydown', 'drop', 'paste', 'cut'] as const
onMounted(() => { for (const e of TOUCH_EVENTS) window.addEventListener(e, markTouched, true) })
onBeforeUnmount(() => { for (const e of TOUCH_EVENTS) window.removeEventListener(e, markTouched, true) })

// taskId 要保留，否则刷新后无法恢复轮询；
// errorMsg 也要保留 —— 否则失败的任务回来还会被 resumeIncompleteTasks 当作"未完成"再轮一次。
// status/progress 是 UI 瞬时态可以扔（load 时根据 imageUrl/errorMsg 重新推导）。
// validationError/validationStamp 也是瞬时态：刷新后不该残留"必填项缺失"的红框。
// refusal：被团队每月上限拦下的说明，说的是「这个人此刻」的事，不进画布数据
const RUNTIME_FIELDS = ['status', 'progress', 'validationError', 'validationStamp', 'refusal', 'cancelNote']

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

/**
 * 画布里画的东西：节点、连线、外观、品牌包。「改没改过」只看这些，内容保存也只发这些——
 * 名字不在里面：改名是另一回事（commitName），不要锁、不带版本，别人正在编辑时也能改。
 */
function buildDrawing() {
  return {
    nodes: nodes.value.map(nodeForSave),
    edges: edges.value.map(edgeForSave),
    // 画布外观。后端 PUT 是显式白名单透传，那边不加对应的一行这里存了也白存
    // nodeLayout：这张画布的节点是在哪种布局下排的（见 arrangedLayout），不是「用哪种布局显示」
    settings: { bg: bgSettings.value, ...(arrangedLayout.value ? { nodeLayout: arrangedLayout.value } : {}) },
    // 这张画布套用的品牌包；空串 = 不套用
    brandKitId: canvasKitId.value,
  }
}
/** 整张画布：名字加上面那些。给文档（宿主的 getDocument / change 事件）、另存为副本、存成模板用 */
function buildContent() {
  return { name: workflowName.value?.trim() || t('canvas.untitled'), ...buildDrawing() }
}

/**
 * 一份内容的指纹：「和上次存的一样不一样」只看它。
 *  - 视口（平移 / 缩放）跟着每次保存一起落库，但不进指纹：看画布不算改画布，挪一下视野不该让标题旁边跳成「未保存」。
 *  - 节点量出来的尺寸（dimensions）也不进：那是渲染的结果，换一种节点布局、提示词框长高一行都会变，每次打开还会重新量一遍。
 *    它照样跟着下一次保存落库（buildDrawing 里有），只是不为它单独存一次。组除外：组的大小是人拉出来的。
 *  - forEdit：再去掉预估成本。它是按模型、参数、价格表算出来的，算回来的时候写进节点 —— 要存（只读的人看的是存着的那个数），
 *    但不是人改的（见 isOwnFill）。
 */
function printOf(drawing: ReturnType<typeof buildDrawing>, forEdit = false) {
  return JSON.stringify({
    ...drawing,
    nodes: drawing.nodes.map((n) => {
      let out = n
      if (out.type !== 'frame' && out.dimensions !== undefined) { const { dimensions: _d, ...rest } = out; out = rest }
      if (forEdit && out.data && typeof out.data === 'object' && 'estimatedCost' in out.data) { const { estimatedCost: _c, ...data } = out.data; out = { ...out, data } }
      return out
    }),
  })
}
function buildFingerprint(forEdit = false) {
  return printOf(buildDrawing(), forEdit)
}
/** 眼下的内容就是存着的那一份（刚载入、刚存完、刚另存成副本）：两个指纹一起记 */
function markSaved(drawing = buildDrawing()) {
  lastFingerprint = printOf(drawing)
  lastEditPrint = printOf(drawing, true)
}
/**
 * 眼下和上次存的不一样的地方是不是编辑器自己补的：载入之后人还没动过手，或者人画的那部分没变（只多了预估成本）。
 * 是的话照样存，但不标「未保存」、保存时状态也不闪「保存中」。
 */
function isOwnFill() {
  return !touchedSinceLoad || buildFingerprint(true) === lastEditPrint
}
/**
 * 编辑器自己补的写入都从这里过：按来源认，不靠「人还没动过手」。现在有两处 —— 生成节点补默认值（默认模型、按模型对齐的
 * 参数，见 useGenNode 的 fill），打开画布后的布局检查记下「在哪种布局下排的」（checkLayoutFit 的 open）。
 * 它们都可能来得很晚：模型清单慢、节点还没量完，人已经点过画布（选中、平移）了，那时再按「没动过手」就认不出来。
 * 所以写之前看一眼有没有人改的东西等着存：没有的话，写完把「人画的那部分」的基准挪到写完的样子，之后的比较（isOwnFill）
 * 里它就不算改动；照样会悄悄存一次（lastFingerprint 没动）。有人改的东西在等，就不挪 —— 本来就该标「未保存」。
 */
function ownWrite(write: () => void) {
  const own = !dirty.value && isOwnFill()
  write()
  if (own) lastEditPrint = buildFingerprint(true)
}
function fillNodeDefaults(id: string, patch: Record<string, any>) {
  ownWrite(() => updateNodeData(id, patch))
}

/* ---------- 画布的名字：元数据，不是内容 ---------- */
/** 服务端现在存着的名字；workflowName 是标题框里的字，两者不一样 = 正在改、还没提交 */
const savedName = ref('')
/**
 * 能不能改名：对这张画布有编辑权就行。别人正在编辑、我是只读时也能改（服务端的改名不要锁）；
 * 只有查看权的人、宿主要求只读的编辑器不能。
 */
const canRename = computed(() => !host?.readOnly.value && collab.mode.value !== 'view' && collab.meta.value.access?.canEdit !== false)
const renameDenied = computed(() => (host?.readOnly.value ? t('canvas.rename.deniedReadOnly') : t('canvas.rename.deniedView')))
/** 标题框失去焦点 / 回车 / 标签页被切走：名字变了就单独存一次（PATCH …/meta），不动内容的版本，也不要编辑锁 */
async function commitName() {
  const id = currentId.value
  if (!id) return
  if (!canRename.value) { workflowName.value = savedName.value; return }
  const name = workflowName.value?.trim() || savedName.value || t('canvas.untitled')
  workflowName.value = name
  if (name === savedName.value) return
  const before = savedName.value
  savedName.value = name
  try {
    const res = await workflowApi.update(id, { name })
    if (currentId.value !== id) return
    if (res.data.data?.updatedAt) lastSavedAt.value = res.data.data.updatedAt
    embed.emit('change', { canvasId: id, document: buildDocument() })
    embed.emit('saved', { canvasId: id, updatedAt: res.data.data?.updatedAt || lastSavedAt.value || '' })
  } catch (err) {
    if (currentId.value !== id) return
    // 没改成：标题退回原来的名字（这期间又改了别的字就不动它）
    if (savedName.value === name) savedName.value = before
    if (workflowName.value === name) workflowName.value = before
    // 编辑权被收回了：换成只读（提示条会说明）
    if (adapterError(err).code === 'team.forbidden') collab.saveFailed(err)
    if (!(SPACE_GONE_CODES as readonly string[]).includes(adapterError(err).code)) MessagePlugin.error(apiErrorMessage(err, t('canvas.rename.failed')))
  }
}
/** Esc：放弃这次改名 */
function cancelNameEdit(e: Event) {
  workflowName.value = savedName.value
  ;(e.target as HTMLInputElement | null)?.blur()
}
/** 画布在别处被改了名（列表里、另一个人的编辑器里）：标题跟着变。我自己正改到一半就不打断，等我提交 */
function followRename(name: string) {
  if (name === savedName.value) return
  const editing = workflowName.value !== savedName.value
  savedName.value = name
  if (!editing) workflowName.value = name
  MessagePlugin.info(t('canvas.rename.followed', { name }))
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
  // 往画布上加节点的所有入口（面板、右键、素材库、拖文件、粘贴、宿主的 addNode）都汇到这里：只读时一个都不加
  if (readOnly.value) return ''
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
  // 只读：不收文件 —— 不亮「松手添加」的高亮，松手也不上传（上传是一次写请求）
  if (readOnly.value) return
  dragDepth++
  dragActive.value = true
}
function onDragOver(e: DragEvent) {
  if (!dtHasFiles(e)) return
  e.preventDefault()  // 必须阻止默认，drop 才会触发（只读时也要拦：不然浏览器会直接打开这个文件、离开页面）
  if (e.dataTransfer) e.dataTransfer.dropEffect = readOnly.value ? 'none' : 'copy'
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
  if (readOnly.value) { explainReadOnly(); return }
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
  if (readOnly.value) return
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

/**
 * 同一张画布的内容保存一次只发一个（手动、自动、离开页面时补存的、宿主调的都排在同一条队上）：
 * 两个保存同时在路上，后一个带的版本号正要被前一个替换，会被自己的前一次保存判成冲突。
 * 排到的时候才取内容，所以排队期间的改动会一起存上。
 */
const saveQueue = createSerialQueue()
function doSave(silent: boolean, force = false): Promise<boolean> {
  return saveQueue.run(() => doSaveNow(silent, force))
}

async function doSaveNow(silent: boolean, force: boolean): Promise<boolean> {
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null }
  autoSaveDueBy = 0
  // 只读：什么都不往外写（视口也不存）
  if (readOnly.value) return false
  // 有一个保存冲突还没处理：用户选完之前不再保存（「用我的版本覆盖」走 force）
  if (collab.blocked.value && !force) return false
  const content = buildDrawing()
  const fp = printOf(content)
  const vp = { ...viewport.value }
  // 改版前排的画布查过一遍之后，随这次保存把标记清掉（见 checkLegacyLayout）
  const clearLegacy = legacyLayoutChecked
  try {
    if (!currentId.value) {
      if (!silent) MessagePlugin.error(t('canvas.save.notLoaded'))
      return false
    }
    if (viewportTimer) { clearTimeout(viewportTimer); viewportTimer = null }
    const savingId = currentId.value
    const res = await workflowApi.update(savingId, { ...content, viewport: vp, ...(clearLegacy ? { legacyLayout: false as const } : {}) }, collab.saveOptions(force))
    // 请求在路上的时候换了画布：这次保存是上一张的，和现在这张无关
    if (currentId.value !== savingId) return true

    if (res.data.result === 0 && res.data.data) {
      collab.saved(res.data.data)
      lastSavedAt.value = res.data.data.updatedAt
      markSaved(content)
      savedViewportKey = viewportKey(vp)
      embed.emit('saved', { canvasId: currentId.value, updatedAt: res.data.data.updatedAt })
      if (clearLegacy) legacyLayoutChecked = false
      dirty.value = false
      saveFailed.value = false
      if (!silent) MessagePlugin.success(t('common.saved'))
      // 保存期间又改了东西：这一次没带上，再排一次
      if (buildFingerprint() !== fp) scheduleAutoSave()
      return true
    }
    saveFailed.value = true
    // 后端拒绝（如 payload 超限）即使是自动保存也要 toast，避免用户不知情地一直丢失改动
    MessagePlugin.error(res.data.message || t('canvas.save.failed'))
    return false
  } catch (err: any) {
    saveFailed.value = true
    // 冲突、丢了锁、编辑权被收回：状态已经换好（冲突弹窗 / 只读提示条会说明），不弹「保存失败」，也不重试
    const why = collab.saveFailed(err)
    if (why) {
      if (why === 'forbidden') MessagePlugin.error(apiErrorMessage(err, t('canvas.save.failed')))
      return false
    }
    // 这个空间对我已经不存在了（被移出团队等）：全局会把人带回个人空间并说明原因
    if ((SPACE_GONE_CODES as readonly string[]).includes(adapterError(err).code)) return false
    const msg = apiErrorMessage(err, t('canvas.save.failed'))
    const status = err?.response?.status ?? err?.status
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
  // 已经有一次保存在路上：它存完会自己检查「期间又改了没有」，不用再排一个
  if (saving.value || autoSaving.value || saveQueue.busy) return
  if (readOnly.value || collab.blocked.value) return
  // 空画布且未持久化过 → 不创建
  if (!currentId.value && nodes.value.length === 0) return
  const fp = buildFingerprint()
  if (fp === lastFingerprint) {
    dirty.value = false
    return
  }
  // 没标「未保存」的那些（编辑器自己补的默认值、预估成本，见 isOwnFill）悄悄存：状态不闪「保存中」
  autoSaving.value = dirty.value
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
  // 这个监听是深度的：选中一下节点、节点在跑时的进度、量出来的尺寸也会走到这里。人画的那部分真变了才标「未保存」；
  // 编辑器自己补的（isOwnFill）照样排一次保存，悄悄存。已经标上了就不再比（拖动时每一帧都会来）
  if (!dirty.value && !isOwnFill()) dirty.value = true
  // 冲突没处理完：改动先留在页面上（标着「未保存」），不往外发
  if (collab.blocked.value) return
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
  // 只读（停手之后才变成只读的也算）：视口也不存
  if (!id || key === savedViewportKey || readOnly.value) return
  try {
    await workflowApi.update(id, { viewport: vp })
    if (currentId.value === id) savedViewportKey = key
  } catch { /* 见上：丢一次视口不值得打扰用户 */ }
}

// 拆分自动保存监听：只有 nodes/edges 需要深度遍历；workflowName 是字符串，浅监听即可。
// viewport（平移/缩放高频变化）不走这条路，见上面的 scheduleViewportSave。
watch([nodes, edges], scheduleAutoSave, { deep: true })
watch(viewport, scheduleViewportSave)
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
  if (readOnly.value) return
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
/** 「把当前画布存为模板」要的节点图；空画布没什么可存 */
function templateGraph(): { nodes: any[]; edges: any[]; viewport?: any } | null {
  if (!nodes.value.length) return null
  const c = buildContent()
  return { nodes: JSON.parse(JSON.stringify(c.nodes)), edges: JSON.parse(JSON.stringify(c.edges)), viewport: { ...viewport.value } }
}
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
  if (readOnly.value) return
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
/** 团队画布的「分享」弹窗有两个页签：团队内（可见范围）、对外链接 */
const shareTab = ref<'team' | 'link'>('link')
const shareTitle = computed(() => (teamCanvas.value ? t('canvas.share.titleNamed', { name: workflowName.value?.trim() || t('canvas.untitled') }) : t('canvas.share.title')))
const accessDraft = ref<CanvasVisibility>('team_view')
const accessSaving = ref(false)
const accessError = ref('')
const canSetAccess = computed(() => !!collab.meta.value.access?.canSetVisibility)
/** 能不能发对外链接：要能编辑这张画布（团队设成「只有团长和管理员能分享」时成员不行），而且此刻不是只读 */
const canPublishShare = computed(() => feat.share && collab.meta.value.access?.canShare !== false && !readOnly.value)
/** 「团队内」页签里那一行「谁正在编辑」 */
const accessLock = computed<CanvasLock | null>(() => {
  const who = (name: string, id: string, mine: boolean): CanvasLock => ({ by: { id, username: name, name }, at: '', expiresAt: '', mine })
  if (collab.mode.value === 'mine') return who(appStore.user?.username || '', appStore.user?.id || '', true)
  const h = collab.holder.value
  return h && (collab.mode.value === 'held' || collab.mode.value === 'lost' || collab.mode.value === 'view') ? who(h.by.name, h.by.id, false) : null
})

/** 不能发链接的人（只读、没有分享权）在「对外链接」页签里看到的：这张画布已经有的那条链接（我看得到的话） */
const shareExisting = ref<{ state: 'loading' | 'found' | 'none' | 'error'; link: string; expiresAt: string | null }>({ state: 'none', link: '', expiresAt: null })
async function loadExistingShare() {
  const id = currentId.value
  shareExisting.value = { state: 'loading', link: '', expiresAt: null }
  try {
    const res = await canvasShareApi.mine()
    if (currentId.value !== id) return
    const body: any = res.data.data
    const list: any[] = Array.isArray(body) ? body : body?.list || []
    const now = Date.now()
    const hit = list.find((s) => s && s.workflowId === id && !s.revoked && s.token && (!s.expiresAt || new Date(s.expiresAt).getTime() > now))
    shareExisting.value = hit
      ? { state: 'found', link: shareLinkFor(hit.token, defaultShareLink(hit.token)), expiresAt: hit.expiresAt || null }
      : { state: 'none', link: '', expiresAt: null }
  } catch {
    if (currentId.value === id) shareExisting.value = { state: 'error', link: '', expiresAt: null }
  }
}

async function saveAccess() {
  const id = currentId.value
  if (!id || accessSaving.value || !canSetAccess.value) return
  accessSaving.value = true
  accessError.value = ''
  try {
    const out = unwrapStock(await stockWorkflowApi.setAccess(id, accessDraft.value))
    collab.meta.value = { ...collab.meta.value, visibility: out.visibility || accessDraft.value, access: out.access || collab.meta.value.access }
    MessagePlugin.success(t('spaces.access.saved', { level: t(`spaces.visibility.${accessDraft.value}.label`) }))
    shareOpen.value = false
  } catch (err) {
    accessError.value = apiErrorMessage(err, t('common.operationFailed'))
  } finally {
    accessSaving.value = false
  }
}

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
function openShareDialog(tab?: 'team' | 'link') {
  if (!currentId.value) {
    MessagePlugin.warning(t('canvas.share.notLoaded'))
    return
  }
  // 空画布没什么可对外分享的；团队画布照样能打开弹窗改可见范围
  if (nodes.value.length === 0 && !teamCanvas.value) {
    MessagePlugin.warning(t('canvas.share.empty'))
    return
  }
  shareTab.value = teamCanvas.value ? (tab === 'link' && feat.share ? 'link' : 'team') : 'link'
  accessDraft.value = teamVisibility.value
  accessError.value = ''
  shareForm.value = {
    title: workflowName.value?.trim() || t('canvas.untitled'),
    description: '',
    expiresInDays: shareForm.value.expiresInDays,
  }
  shareResult.value = null
  shareOpen.value = true
  if (teamCanvas.value && feat.share && !canPublishShare.value) void loadExistingShare()
}

function closeShareDialog() {
  if (publishing.value || accessSaving.value) return
  shareOpen.value = false
}

async function handlePublish() {
  if (!currentId.value) return
  if (nodes.value.length === 0) { MessagePlugin.warning(t('canvas.share.empty')); return }
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

async function copyShareLink(link: string | undefined) {
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
  // 只读时不替别人整理、也不往外存
  if (!id || readOnly.value) return
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
  // 缩到头（MIN_ZOOM）还是比空着的那块大 —— 手机上一张大画布、顶上又是折成三行的只读提示条：不居中。
  // 居中是把多出来的一半分到上边 / 左边，最上面那排节点就伸到标题块、提示条底下去了（360×560 上压进去近 40px）。
  // 从空地的左上角排起，放不下的在右边 / 下面，往那边拖着看
  const padX = Math.max(0, (freeW - (maxX - minX) * zoom) / 2), padY = Math.max(0, (freeH - (maxY - minY) * zoom) / 2)
  setViewport({
    x: inset.l + padX - minX * zoom,
    y: inset.t + padY - minY * zoom,
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
  // 换到另一张画布：先把上一张的锁还回去
  if (currentId.value && currentId.value !== id) collab.end()
  suppressAutoSave = true
  try {
    const res = await workflowApi.detail(id)
    if (res.data.result === 0 && res.data.data) {
      applyWorkflow(res.data.data)
      // 这张画布现在轮不轮得到我改：拿编辑锁，或者落到只读
      await collab.begin(res.data.data.meta)
      void loadBudget()
      if (!readyAnnounced) { readyAnnounced = true; embed.emit('ready', { canvasId: currentId.value || id }) }
    } else {
      MessagePlugin.error(res.data.message || t('common.loadFailed'))
      leaveBrokenCanvas(res.data.message || t('common.loadFailed'))
    }
  } catch (err: any) {
    // 这个空间里没有这张画布：也许链接是另一个空间的（不带空间前缀的老链接、别人发来的）。在我能进的别的空间里找一下
    if (adapterError(err).status === 404 && await openInOtherSpace(id)) return
    // 当前这个空间对我已经不存在了：全局会把人带回个人空间并说明原因，这里不再多弹一条
    if (!(SPACE_GONE_CODES as readonly string[]).includes(adapterError(err).code)) MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
    leaveBrokenCanvas(apiErrorMessage(err, t('common.loadFailed')), err)
  } finally {
    loading.value = false
    setTimeout(() => { suppressAutoSave = false }, 0)
  }
}

/**
 * 画布不在当前空间里时：到我所在的别的空间里找。找到了就换到那个空间打开它，并说一声。
 * 只在用户能自己换空间的时候做（独立应用、没被集成方定死空间的整站嵌入）。
 */
async function openInOtherSpace(id: string): Promise<boolean> {
  if (host || !spaceStore.canSwitch) return false
  const others = spaceStore.spaces
    .map((s) => ({ id: s.kind === 'team' ? s.id : '', name: s.kind === 'team' ? s.name : t('spaces.personal'), open: s.kind !== 'team' || (s.status || 'active') === 'active' }))
    .filter((s) => s.open && s.id !== spaceStore.currentId)
  for (const s of others) {
    try {
      if (!(await stockWorkflowApi.findIn(id, s.id || 'personal'))) continue
    } catch { continue }
    MessagePlugin.info(t('canvas.collab.inOtherSpace', { space: s.name }))
    await router.replace(s.id ? { name: 'canvas', params: { id, space: spaceParam(s.id) } } : { name: 'canvas', params: { id }, query: { space: 'personal' } })
    return true
  }
  return false
}
let readyAnnounced = false

/**
 * 只把内容重新取一遍（不重新拿锁）：拿到锁之后发现载入的已经不是最新的一版时用。返回取到的版本。
 * quiet：人正只读看着，对方又保存了——换成新内容，但不动他的视野，出错也不打扰（下一轮再取）。
 */
async function reloadContent(quiet = false): Promise<number | undefined> {
  const id = currentId.value
  if (!id) return undefined
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null }
  suppressAutoSave = true
  try {
    const res = await workflowApi.detail(id)
    if (res.data.result !== 0 || !res.data.data || currentId.value !== id) return undefined
    applyWorkflow(res.data.data, { keepView: quiet })
    collab.meta.value = res.data.data.meta || {}
    return res.data.data.meta?.revision
  } catch (err) {
    if (!quiet) MessagePlugin.error(apiErrorMessage(err, t('common.loadFailed')))
    return undefined
  } finally {
    setTimeout(() => { suppressAutoSave = false }, 0)
  }
}

/** 载入（或拿到锁）之后：接着轮询刷新前还在跑的任务。每次载入只做一次；只读时不做 */
let loadSeq = 0
let resumedSeq = -1
function resumeAfterLoad() {
  if (readOnly.value || resumedSeq === loadSeq) return
  resumedSeq = loadSeq
  executor.resumeIncompleteTasks()
  // 存着的失败原因是当时界面语言的一句话，按现在的语言重取
  void executor.refreshRunErrors()
}

/* ==================== 团队画布：可见范围、接管、另存为副本、冲突 ==================== */
/** 这张画布在团队空间里（有可见范围这回事）。只嵌编辑器时没有：适配器不讲可见范围 */
const teamVisibility = computed<CanvasVisibility>(() => (collab.meta.value.visibility || 'team_view') as CanvasVisibility)
const teamCanvas = computed(() => !host && !!collab.meta.value.visibility)
/** 能不能把一份文档另存成新画布（「复制一份」「把我的版本另存为副本」都靠它） */
const copyAvailable = computed(() => canCreateCanvas())
const collabBusy = ref(false)
const conflictError = ref('')

function openCanvas(id: string) {
  void router.push({ name: 'canvas', params: { id } })
}

/**
 * 把编辑器里现在的内容另存成一张新画布（团队里默认「仅自己」），然后打开它。
 * mine：我的改动没存上（冲突、丢了锁），存到副本里就不会丢；copy：只读的人想拿一份去改。
 */
async function saveAsCopy(kind: 'mine' | 'copy') {
  if (collabBusy.value) return
  collabBusy.value = true
  conflictError.value = ''
  try {
    const content = buildContent()
    const name = t('common.copyName', { name: content.name })
    const res = await workflowApi.create(
      { ...content, name, viewport: { ...viewport.value } },
      collab.meta.value.visibility ? { visibility: 'private' } : undefined,
    )
    const id = res.data.data?.id
    if (!id) throw new Error(t('common.operationFailed'))
    // 我的改动已经在副本里了：这张画布上不再有「没保存的东西」，离开时不要再提示、也不要再存
    markSaved()
    dirty.value = false
    collab.clearConflict()
    MessagePlugin.success(t(kind === 'mine' ? 'canvas.collab.savedAsCopy' : 'canvas.collab.copied', { name }))
    if (host) {
      // 只嵌编辑器：开哪张画布是宿主的事。告诉它副本的 id；这边留在原来那张上，换成最新保存的内容
      embed.emit('created', { canvasId: id, fromCanvasId: currentId.value || '' })
      if (kind === 'mine' && currentId.value) await loadWorkflow(currentId.value)
    } else {
      openCanvas(id)
    }
  } catch (err) {
    const msg = apiErrorMessage(err, t('common.operationFailed'))
    if (collab.conflict.value) conflictError.value = msg
    else MessagePlugin.error(msg)
  } finally {
    collabBusy.value = false
  }
}

/** 放弃我这次的改动，看最新保存的那一版 */
async function reloadLatest() {
  const id = currentId.value
  if (!id || collabBusy.value) return
  collabBusy.value = true
  conflictError.value = ''
  try {
    await loadWorkflow(id)
  } finally {
    collabBusy.value = false
  }
}

/** 冲突时「用我的版本覆盖」：只有服务端说可以（canOverwrite）才摆得出这个按钮 */
async function overwriteWithMine() {
  if (collabBusy.value) return
  collabBusy.value = true
  conflictError.value = ''
  try {
    const ok = await doSave(true, true)
    if (ok) MessagePlugin.success(t('canvas.conflict.overwritten'))
    else if (collab.conflict.value) conflictError.value = t('canvas.save.failed')
  } finally {
    collabBusy.value = false
  }
}

/* ---------- 团队里的每月上限：在「运行」旁边和队列清单里让人看得到自己还剩多少 ---------- */
const budget = shallowRef<TeamLimits | null>(null)
async function loadBudget() {
  const teamId = collab.meta.value.spaceId
  // 只在团队空间里有；只嵌编辑器时没有团队这回事
  if (host || !isTeamId(teamId)) { budget.value = null; return }
  try {
    const out = unwrapStock(await stockTeamApi.limits(teamId))
    if (collab.meta.value.spaceId === teamId) budget.value = out
  } catch { /* 取不到就不显示；被拒绝时服务端的提示里有具体数字 */ }
}
/** 一批节点同时动的时候只取一次 */
let budgetTimer: number | null = null
function scheduleBudgetReload() {
  if (budgetTimer != null) return
  budgetTimer = window.setTimeout(() => { budgetTimer = null; void loadBudget() }, 400)
}
onBeforeUnmount(() => { if (budgetTimer != null) window.clearTimeout(budgetTimer) })
provide(CANVAS_BUDGET_KEY, {
  limits: budget,
  canSetLimits: computed(() => !host && spaceStore.isTeam && spaceStore.can('limits:manage')),
  canSetPrices: computed(() => !host && spaceStore.isTeam && spaceStore.can('provider:manage')),
  limitsTo: computed(() => (budget.value && !host ? { name: 'team', params: { tab: 'settings', space: spaceParam(collab.meta.value.spaceId || '') } } : null)),
  pricesTo: computed(() => (budget.value && !host ? { name: 'models', params: { space: spaceParam(collab.meta.value.spaceId || '') } } : null)),
  reload: () => { void loadBudget() },
})
/**
 * 「运行所选」现在会不会被每月上限整批拦下（我的 / 团队的次数、金额用完了）—— 和单个节点运行前的提醒是同一份判断。
 * 会的话给出那一句话：按钮置灰、提示里写原因，不让一批节点各发一次必然被拒的请求。
 * 只是某个模型没填价格的那种不在这里拦：那是一个一个节点的事，照常由各节点自己说明。
 */
const selRunBlocked = computed(() => {
  void locale.value
  const b = budget.value
  if (!b?.member?.effective?.blockedBy) return ''
  const pre = preflight(b)
  return pre ? refusalText(pre, { canSetLimits: !host && spaceStore.isTeam && spaceStore.can('limits:manage') }).full : ''
})
/**
 * 「运行」旁边那一小句：最要紧的一项上限（先看会不会被拦，再看哪一项离上限最近）。
 * 状态取服务端给的 effective，不在这里按比例再判；都没设上限就不出。
 */
const budgetChip = computed<{ text: string; title: string; state: string } | null>(() => {
  void locale.value
  const b = budget.value
  if (!b) return null
  const RANK = { unlimited: 0, ok: 1, near: 2, reached: 3 } as const
  const all: { mine: boolean; unit: 'runs' | 'amount'; m: LimitMeterState }[] = []
  const add = (side: LimitSide | undefined, mine: boolean) => {
    if (!side) return
    for (const unit of ['runs', 'amount'] as const) if (side.effective[unit].limit != null) all.push({ mine, unit, m: side.effective[unit] })
  }
  add(b.member, true)
  add(b.team, false)
  const blocked = b.member.effective.blockedBy
  if (!all.length && !blocked) return null
  const ratio = (x: LimitMeterState) => (x.limit && x.limit > 0 ? x.used / x.limit : 1)
  const top = all.length ? all.reduce((a, c) => (RANK[c.m.state] > RANK[a.m.state] || (RANK[c.m.state] === RANK[a.m.state] && ratio(c.m) > ratio(a.m)) ? c : a)) : null
  const reset = t('spaces.limits.resetsAt', { when: resetText(b.resetsAt, b.timezone) })
  if (blocked) {
    const pre = preflight(b)
    return { text: blockedText(b.member), title: pre ? refusalText(pre).full : reset, state: 'reached' }
  }
  if (!top) return null
  const who = top.mine ? t('spaces.limits.mine') : t('spaces.limits.team')
  const label = t(top.unit === 'amount' ? 'spaces.limits.amountLabel' : 'spaces.limits.runsLabel')
  return {
    text: t('canvas.budget.month', { text: meterText(top.m, top.unit, b.currency) }),
    title: [`${who} · ${label}`, top.m.state === 'near' ? t('spaces.limits.near') : '', t('spaces.limits.definition'), reset].filter(Boolean).join(t('spaces.refusal.join')),
    state: top.m.state,
  }
})

async function takeOverCanvas() {
  const from = collab.holder.value?.by.name || ''
  const self = !!collab.holder.value?.sameUser
  if (await collab.takeOver()) MessagePlugin.success(self ? t('canvas.collab.tookOverSelf') : t('canvas.collab.tookOver', { name: from }))
  else if (collab.mode.value === 'view') MessagePlugin.error(t('canvas.collab.cannotTakeOver'))
}

/**
 * 把一份画布（接口返回的，或宿主直接给的文档）铺到编辑器里。
 * keepView：只换内容，视野留在人正看着的地方（只读时对方又保存了）。
 */
function applyWorkflow(w: any, o: { keepView?: boolean } = {}) {
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
      legacyLayoutPending = !!w.legacyLayout && nodes.value.length > 1
      legacyLayoutChecked = false
      layoutCheckPending = !legacyLayoutPending && nodes.value.length > 1 && arrangedLayout.value !== nodeLayout.value
      if (!o.keepView) {
        const vp = w.viewport || { x: 0, y: 0, zoom: 1 }
        fitOnInit = nodes.value.length > 0 && !vp.x && !vp.y && (vp.zoom || 1) === 1
        savedViewportKey = viewportKey(vp)
        viewport.value = vp
        // 把 zoom 钳制在 [0.2, 2]，防止历史脏数据把节点撑爆
        setViewport({ x: vp.x, y: vp.y, zoom: Math.min(2, Math.max(0.2, vp.zoom || 1)) })
      }
      // 我正在标题框里改名、还没提交：不打断
      if (!o.keepView || workflowName.value === savedName.value) workflowName.value = w.name
      savedName.value = w.name
      currentId.value = w.id
      lastSavedAt.value = w.updatedAt
      markSaved()
      touchedSinceLoad = false
      dirty.value = false
      saveFailed.value = false
      // 换画布要清历史，否则能「撤销」到上一张画布的内容
      hist.reset()
      // 对刷新前还在跑的 task，自动恢复轮询拉结果（只读时不做；之后拿到编辑锁的那一刻会补上）
      loadSeq++
      setTimeout(resumeAfterLoad, 100)
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

/**
 * 页面被关掉 / 刷新 / 跳到别的网站：把编辑锁还回去。这时候普通请求不保证发得出去，所以走 sendBeacon
 * （适配器的 releaseLock({ unloading: true })），别人不用等锁过期。真没发出去（进程被杀、断网）锁也会自己过期。
 * 从往返缓存里回来（persisted）时页面还是原样，要重新拿锁。
 */
function onPageHide() { collab.end({ unloading: true }) }
/**
 * 标签页被切到后台、最小化、或者马上要关：把没存的先存上——后台页的定时器会被浏览器放慢，等自动保存的那个定时器就晚了；
 * 关页面时这也是最后一个靠得住的时机（pagehide 时再发的保存不一定发得出去）。回到前台的那一下由 useCanvasCollab 续锁。
 */
function onVisibilityChange() {
  if (document.visibilityState !== 'hidden' || !currentId.value) return
  if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.ed-name')) void commitName()
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; void autoSave() }
  else if (viewportTimer) void saveViewport()
}
function onPageShow(e: PageTransitionEvent) {
  if (e.persisted && currentId.value) void loadWorkflow(currentId.value)
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
  // 上一次搜的词还留着（接着找下一个）；整段选中，直接打字就是换一个词
  nextTick(() => { searchInputRef.value?.focus(); searchInputRef.value?.select() })
}
const searchInputRef = ref<HTMLInputElement | null>(null)

function gotoNode(id: string) {
  // 不能从 getNodes 里找：开了 only-render-visible-elements，视野外的节点不在里面，
  // 而从队列 / 搜索点过来的恰恰多半是看不见的那个
  const n = findNode(id)
  if (!n) return
  // 只留这一个选中：从队列或搜索点过来，要的是「就是它」
  removeSelectedNodes(getSelectedNodes.value)
  addSelectedNodes([n as any])
  // 它的输入条 / 属性面板要是被收起过（按过 Esc），定位过来就重新打开 —— 和再点一下这个节点一样。
  // （它本来就选着的话，上面这一退一选在同一拍里，选中没「变」，靠选中变化来复位的那条监听不会走到）
  if (panelDismissedId.value === id) panelDismissedId.value = ''
  // 先选中、等一拍再框：布局 b 下选中会打开属性面板，框的时候要把它那一条宽度让出来
  revealSkipId = id
  void nextTick(() => {
    fitFree({ nodes: [id], maxZoom: 1, duration: 300 })
    window.setTimeout(() => { if (revealSkipId === id) revealSkipId = '' }, 0)
  })
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
  if (readOnly.value || !hist.undo()) return
  closeMenus()
}
function doRedo() {
  if (readOnly.value || !hist.redo()) return
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
  if (pane?.clientHeight) paneHeight.value = pane.clientHeight
  // 底部工具条眼下有多宽（收起来的时候量到 0，不算）
  const tw = toolsRef.value?.offsetWidth || 0
  if (tw > 0 && Math.abs(tw - toolsWidth.value) > 1) toolsWidth.value = tw
}

/**
 * 布局 b 在手机宽度下，属性面板是贴底的抽屉（最高占到 76%）：选中的节点多半就在它底下。抽屉一开，把节点摆进
 * 抽屉上面剩下的那一块 —— 放不下就把画布缩小到刚好放得下（utils/floatSpot.ts 的 fitInArea）。只是换了视野，不进撤销。
 * 布局 a 的输入条自己做同一件事（GenComposer 的 revealAbove：它还要顾节点四周放不放得下）。
 */
let sheetRevealTimer: number | null = null
function revealAboveSheet() {
  sheetRevealTimer = null
  const sheet = panelSheet.value, ed = edRef.value
  const sel = panelNode.value
  const n = sel ? findNode(sel.id) : null
  if (!sheet || !ed || !n || nodeLayout.value !== 'b' || pointerHeld) return
  const vp = viewport.value, z = vp.zoom || 1
  const est = estimateNodeSize(n.type, nodeLayout.value)
  const size = measuredSize(n.id) || { width: est.w, height: est.h }
  const fx = n.computedPosition?.x ?? n.position.x, fy = n.computedPosition?.y ?? n.position.y
  // 端口的圆点一半在节点外面：两边各多算一点
  const PAD = 12
  const rect = { l: vp.x + fx * z - PAD, t: vp.y + fy * z, r: vp.x + (fx + size.width) * z + PAD, b: vp.y + (fy + size.height) * z }
  // 顶上那几排（标题块、工具面板的一横条、只读提示条、没有模型的提示）下面起算。只算横着的：竖排在左边的工具面板
  // 不是「一排」（把它算进去，它的底边会把这一块压没）—— 它交给找空地那一步去绕
  const rows = rectsIn(ed, '.ed-title, .ed-pal, .clb, .ed-hint')
  const tops = rows.filter((r) => r.t < 160 && r.r - r.l > r.b - r.t)
  const bottom = sheet.t - 12
  let top = Math.max(8, ...tops.map((r) => r.b + 8))
  // 它们下面连一小条都不剩（很矮的窗口里只读提示条折成了两三行）：按整块算，压着顶上那几排也比压在抽屉底下强
  if (bottom - top < 48) top = 8
  const area = { l: 8, t: top, r: ed.clientWidth - 8, b: bottom }
  const fit = fitInArea(rect, area, [...rectsIn(ed, '.qf'), ...rows.filter((r) => !tops.includes(r))], { gap: 8, minScale: MIN_ZOOM / z })
  if (!fit) return
  const nz = z * fit.scale
  const still = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  void setViewport({ x: Math.round(fit.x + PAD * fit.scale - fx * nz), y: Math.round(fit.y - fy * nz), zoom: nz }, { duration: still ? 0 : 240 })
}
// 抽屉出现、换了大小：等它和挪到它上面去的生成队列圆钮都落定再摆
watch(panelSheet, (s) => {
  if (sheetRevealTimer !== null) { clearTimeout(sheetRevealTimer); sheetRevealTimer = null }
  if (s && nodeLayout.value === 'b') sheetRevealTimer = window.setTimeout(revealAboveSheet, 520)
})

/**
 * 选中一个生成节点时的两个键，要抢在 vue-flow 前面（捕获阶段）处理：
 *   Ctrl / ⌘ + Enter  运行它。vue-flow 把聚焦节点上的 Enter 当成「点一下节点」，而 Ctrl 又是它的
 *                     多选键 —— 不拦的话这一下会把节点取消选中。
 *   Esc               一次只收最里面的一层，从里到外：
 *                       大图预览 > 弹窗 > 菜单 / 弹出层 > 输入条 / 属性面板 > 选中
 *                     前三层各管各的（它们自己监听 Esc），这里只做一件事：别抢。按键落在弹窗 / 菜单 / 气泡里面、
 *                     或者落在一颗展开着弹出层的按钮上，都是那一层的；节点自己开的弹窗（任务详情、放大编辑、
 *                     成品大图）画布这边没有状态可查，所以看的是 DOM 里有没有开着的遮罩。
 *                     画布自己的菜单（右键、添加节点、更多、面板展开层、外观、搜索）在这里收，并且到此为止 ——
 *                     不然 vue-flow 会在同一下里把节点也取消选中（输入条跟着没了）。
 *                     只读时也一样：只读也能选中节点、开着只读的输入条 / 属性面板。
 */
const ESC_LAYER = '[role="dialog"], [role="alertdialog"], .lc-mask, .cp-pop, [data-lc-popup]'
/** 画布自己的几种菜单：它们的 Esc 归这里收；别的 .lc-menu（节点上的下拉、品牌包面板）归各自的组件 */
const OWN_MENU = '.ctx-menu, .ed-menu, .ed-palmenu'
function escBelongsElsewhere(el: Element | null): boolean {
  if (el?.closest) {
    if (el.closest(ESC_LAYER)) return true
    if (el.closest('.lc-menu') && !el.closest(OWN_MENU)) return true
    // 焦点还在打开弹出层的那颗按钮上（节点上的下拉、生成队列的圆钮、品牌包标记）
    const trigger = el.closest('[aria-expanded="true"]')
    if (trigger && !trigger.closest('.ed-pal')) return true
  }
  // 开着的遮罩 / 模态层：焦点不一定在里面（大图预览不抢焦点）
  return !!embed.root.querySelector('.lc-mask, .ml-mask, [aria-modal="true"]')
}
const canvasMenuOpen = () => contextMenu.value.open || addMenu.value.open || moreMenu.value.open || palMenu.value.open
  || !!fly.value || projMenuOpen.value || stylePanelOpen.value || searchOpen.value
function onCanvasKeydownCapture(e: KeyboardEvent) {
  if (!ownsKeyEvent(e, embed.root)) return
  // 输入法正在组字（在候着的那个框里）：回车是上屏、Esc 是取消组字，都不是给画布的
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Escape') {
    const el = e.target as Element | null
    if (escBelongsElsewhere(el) || anyOverlayOpen()) return
    // 输入框里的 Esc 是那个输入框的（提示词框：失焦并收起面板；搜索框：关搜索；标题：放弃改名）
    if (isTypingTarget(el)) return
    if (canvasMenuOpen()) {
      e.preventDefault()
      e.stopPropagation()
      closeContextMenuToNode()
      closeMenus()
      stylePanelOpen.value = false
      searchOpen.value = false
      return
    }
    // 触屏多选开着：Esc 先结束它（选中的留着）
    if (touchMultiOn.value) {
      e.preventDefault()
      e.stopPropagation()
      endTouchMulti()
      return
    }
    if (panelNode.value) {
      e.preventDefault()
      e.stopPropagation()
      closeGenPanel()
    }
    return
  }
  if (readOnly.value || isTypingTarget(e.target) || anyOverlayOpen()) return
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const n = soleGenNode.value
    if (!n) return
    e.preventDefault()
    e.stopPropagation()
    void executor.runSubtree(n.id)
  }
}

function onCanvasKeydown(e: KeyboardEvent) {
  // 嵌在别人的页面里：按键不是冲着这块画布来的就不管（宿主自己的输入框、别的嵌入实例）
  if (!ownsKeyEvent(e, embed.root)) return
  if (isTypingTarget(e.target)) return
  if (anyOverlayOpen()) return
  const mod = e.ctrlKey || e.metaKey
  const key = (e.key || '').toLowerCase()
  // 只读：只留「看」的那几个键 —— 找节点、适应屏幕、Esc 收菜单。改画布的键一个都不接
  if (readOnly.value) {
    if (e.isComposing || e.keyCode === 229) return
    if (mod && key === 'f' && feat.search) { e.preventDefault(); openSearch(); return }
    if (mod && key === '0') { e.preventDefault(); fitFree(); return }
    if (key === 'escape') { closeMenus(); stylePanelOpen.value = false; searchOpen.value = false }
    return
  }

  // 输入法的键（正在组字，或者这一键被输入法拿走了）：不是快捷键 —— 组字时的退格、回车、空格都是输入法的。
  // 焦点已经在候着的那个框上：就在那儿组；否则（少数环境下不可编辑的地方也开着输入法）把焦点放进提示词框
  if (e.isComposing || e.keyCode === 229 || e.key === 'Process') {
    if (!imeFocused() && !mod && !e.altKey && soleGenNode.value) focusGenPrompt()
    return
  }

  if (mod && key === 'z') {
    e.preventDefault()
    if (e.shiftKey) doRedo()
    else doUndo()
    return
  }
  // Ctrl+Y：Windows 上重做的另一套习惯
  if (mod && key === 'y') { e.preventDefault(); doRedo(); return }
  // 全选是全部节点：getNodes 只有视野里的那些（only-render-visible-elements），照它选会漏掉看不见的
  if (mod && key === 'a') { e.preventDefault(); addSelectedNodes(nodes.value.map((n) => findNode(n.id)).filter(Boolean) as any); return }
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
  // 搜索关着（features.search）就不接：Ctrl+F 留给浏览器 / 宿主页面自己的查找
  if (mod && key === 'f' && feat.search) { e.preventDefault(); openSearch(); return }
  // Ctrl+G 成组：选中的里面已经有组就走合并，全是散节点就直接圈一个新组
  if (mod && key === 'g') {
    e.preventDefault()
    if (e.shiftKey) ungroupSelected()
    else groupSelection()
    return
  }
  if (key === 'delete' || key === 'backspace') { e.preventDefault(); deleteSelection(); return }
  if (key === 'escape') { closeMenus(); stylePanelOpen.value = false; searchOpen.value = false; return }
  // 选中一个生成节点后直接打字：焦点落进它的提示词框，这一键照常进到框里。
  // 空格留给画布（按住拖动平移）。输入法的键在上面已经分出去了。
  if (!mod && !e.altKey && soleGenNode.value && e.key !== ' ' && e.key.length === 1) {
    focusGenPrompt()
  }
}

// 编辑器内切换项目：URL 的画布 id 变了就重新加载
watch(wantedCanvasId, (id) => {
  if (id && id !== currentId.value) loadWorkflow(id)
})

// 有节点开始跑、跑完或被拒绝之后把上限的数字刷新一下：次数、金额都变了（进行中的也占着名额）
watch(() => nodes.value.filter((n: any) => n.data?.status === 'running' || n.data?.status === 'queued').length, (now, before) => {
  if (budget.value && now !== before) scheduleBudgetReload()
})
watch(() => nodes.value.filter((n: any) => n.data?.refusal).length, (now, before) => {
  if (now > before) scheduleBudgetReload()
})

// 只读开着的时候什么都不存。关掉的那一刻如果内容和上次存的不一样（比如只读期间有一次运行跑完了），补存一次
watch(readOnly, (ro) => {
  if (ro) { closeMenus(); return }
  if (currentId.value && buildFingerprint() !== lastFingerprint) scheduleAutoSave()
})
/**
 * 变成只读的那一刻（丢了锁、被接管、编辑权被收回）：
 *  - 正在里面打字的那个框退出来 —— 节点里的、输入条 / 属性面板里的、放大编辑里的。框本身这一拍已经变成 readonly，
 *    光标还留在里面的话，人会接着打、却一个字都进不去。标题框不算（改名不要编辑锁）；
 *  - 只为「改」开着的层收掉：单图编辑器、画布模板、载入其他画布、外观面板、批量运行、品牌包编辑。
 *    它们的结果本来也写不进去（各入口都有只读判断），留着只会让人白忙。
 * 变回可编辑：只读期间「切换着看」的记录清掉，画面回到文档里真存着的那一版。
 * 节点层不再整个 inert：只读的人要能点开大图、放视频、选字、Tab 到这些「看」的控件上（各节点自己看 readOnly）。
 */
const EDIT_FIELD_HOSTS = '.vue-flow__nodes, .gc, .gi, .gf-expand, .gn-tmodal, .cv-prompt-popover'
watch(readOnly, (ro) => {
  if (!ro) { nodePeek.clear(); return }
  const active = document.activeElement
  if (active instanceof HTMLElement && isTypingTarget(active) && embed.root.contains(active) && active.closest(EDIT_FIELD_HOSTS)) active.blur()
  if (editorState.value.open) closeEditor(null)
  templateDialogOpen.value = false
  importPickerOpen.value = false
  stylePanelOpen.value = false
  kitEditor.value.open = false
  if (batch.open.value && !batch.running.value) batch.open.value = false
}, { flush: 'post' })
// 换了一张画布：上一张「切换着看」的记录不带过来
watch(() => currentId.value, () => nodePeek.clear())

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
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('keydown', onCanvasKeydown)
  window.addEventListener('keydown', onCanvasKeydownCapture, true)
  window.addEventListener('keydown', onShiftDown)
  window.addEventListener('keyup', onShiftUp)
  window.addEventListener('blur', onWindowBlur)
  window.addEventListener('resize', syncPaneWidth)
  window.addEventListener('pointerdown', onRevealPointerDown, true)
  window.addEventListener('pointerup', onRevealPointerUp, true)
  window.addEventListener('pointercancel', onRevealPointerUp, true)
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
  // 标题框里改到一半的名字：走之前提交（改名不要锁，不用排在还锁之前）
  void commitName()
  document.removeEventListener('mousedown', onDocClick)
  document.removeEventListener('paste', onCanvasPaste)
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('pagehide', onPageHide)
  window.removeEventListener('pageshow', onPageShow)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.removeEventListener('keydown', onCanvasKeydown)
  window.removeEventListener('keydown', onCanvasKeydownCapture, true)
  window.removeEventListener('keydown', onShiftDown)
  window.removeEventListener('keyup', onShiftUp)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('resize', syncPaneWidth)
  window.removeEventListener('pointerdown', onRevealPointerDown, true)
  window.removeEventListener('pointerup', onRevealPointerUp, true)
  window.removeEventListener('pointercancel', onRevealPointerUp, true)
  if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null }
  if (sheetRevealTimer !== null) { clearTimeout(sheetRevealTimer); sheetRevealTimer = null }
  if (layoutUndoTimer) { clearTimeout(layoutUndoTimer); layoutUndoTimer = null }
  if (guidesHideTimer) { clearTimeout(guidesHideTimer); guidesHideTimer = null }
  let lastSave: Promise<unknown> = Promise.resolve()
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
    // 离开页面时若有未保存修改，立即触发一次（best-effort，不阻塞）。
    // 和自动保存同一个顺序：先告诉宿主「内容变了」（change / onChange），再存 —— 只给文档、自己不存的宿主
    // 只认这个事件，少了这一下，卸载前最后那一小段（还在防抖里）的改动它就永远收不到
    if (dirty.value && !readOnly.value && !collab.blocked.value && buildFingerprint() !== lastFingerprint) {
      embed.emit('change', { canvasId: currentId.value || '', document: buildDocument() })
      if (currentId.value) lastSave = doSave(true).catch(() => {})
    }
  }
  // 刚挪过视野还没来得及存：走之前补一次
  if (viewportTimer) void saveViewport()
  // 停心跳、把编辑锁还回去。等补存的那一次先到（保存会顺带续锁，后到的话画布要白白再「正在编辑」一分钟）
  void lastSave.then(() => collab.end())
})
</script>

<style scoped>
/* 只读（别人正在编辑、只有查看权、只嵌编辑器时的 readOnly）。
   节点照常接鼠标和键盘：点开大图、放视频、选字复制、展开长文、切换查看版本都要能用 —— 哪些入口出、哪些不出由各节点自己看
   readOnly 决定（composables/nodeLayout.ts 的 useCanvasReadOnly、useGenNode 的 viewOnly），这里不再靠样式整片盖住。
   这里只管两样没有组件可问的：连线不能点（选中一条线只为了删它），端口还在（线要有个头）但不是拖线的把手 */
.ed.read-only :deep(.vue-flow__edge) { pointer-events: none !important; }
.ed.read-only :deep(.vue-flow__handle) { cursor: default; }
.ed.read-only :deep(.vue-flow__handle:hover) { box-shadow: none; }
.ed.read-only :deep(.vue-flow__node) { cursor: default; }

/* 编辑器：画布铺满外壳给的整块区域，所有控件都是浮在上面的玻璃块。 */
.ed {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: var(--text);
  /* 编辑器里不让浏览器自己缩放页面（双指、双击）：悬浮的工具条、面板上的手势只剩「滚动」这一种，滚的也只是它们自己里面 */
  touch-action: pan-x pan-y;
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
/* 小地图：左下角的玻璃块（外框的皮肤在 vue-flow-theme.css）。遮罩 / 视口框 / 节点块的颜色在这里按令牌给：
   组件把颜色写成 SVG 属性，属性不解析 var()，样式的优先级比属性高 */
.vf-wrap :deep(.vue-flow__minimap) { left: 16px; bottom: 20px; }
.vf-wrap :deep(.vue-flow__minimap-mask) { fill: var(--mini-mask); stroke: var(--mini-stroke); }
.vf-wrap :deep(.vue-flow__minimap-node) { fill: var(--mini-node); }

/* 候着输入法的那个框：看不见、点不到，只占一个位置（输入法的候选窗跟着它出） */
.ed-ime { position: absolute; left: 0; top: 0; z-index: 1; width: 2px; height: 18px; overflow: hidden; opacity: 0; pointer-events: none; }
/* 正在组的那一段字的下划线：和浏览器在输入框里画的一样，一条字色的细线。盖在输入条 / 属性面板 / 抽屉上面 */
.ed-ime-mark { position: absolute; left: 0; top: 0; z-index: 42; height: 0; border-bottom: 1px solid var(--text); pointer-events: none; }

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
/* 上限跟着窗口走：窄窗口 320，1280 起到 480 —— 宽屏上旁边明明空着，名字不该在 320 就截。标题块自己还有一道
   「不超出编辑器」的上限（.ed-title 的 max-width），名字是可收缩的那一项，放不下时照样在这里截成省略号 */
.ed-name { position: relative; display: block; min-width: 40px; max-width: clamp(320px, 37.5vw, 480px); flex: 0 1 auto; overflow: hidden; height: 30px; border-radius: 8px; }
/* 两个的盒子和字必须是同一套：以前镜像没有边框、输入框有 1px 边框，输入框里能放字的地方就比镜像量出来的窄 2px ——
   名字再短、旁边再空，也总是被截成省略号。字距等也写死成一样的（输入框不继承外面的 letter-spacing，span 会）。 */
.ed-name-mirror, .ed-name input {
  box-sizing: border-box; padding: 0 8px; border: 1px solid transparent;
  font: 600 14px/28px var(--f-disp); letter-spacing: normal; word-spacing: normal; text-indent: 0; text-transform: none;
  font-kerning: auto; font-feature-settings: normal; font-variant-ligatures: normal;
}
.ed-name-mirror {
  display: block; visibility: hidden; white-space: pre; overflow: hidden; text-overflow: ellipsis;
  /* 输入框里的字是另一套排版（内部的编辑区），宽度按整像素取；镜像多留 1px，免得正好差零点几像素又截掉最后一个字 */
  padding-right: 9px;
}
.ed-name input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  border-radius: 8px; background: transparent; outline: none;
  color: var(--text); text-overflow: ellipsis;
}
.ed-name input::placeholder { color: var(--text-3); font-weight: 400; }
.ed-name input:hover { background: rgb(var(--c-film) / .08); }
/* 不能改名（只有查看权）：就是一行字，不摆出「点了能改」的样子 */
.ed-name.fixed input { cursor: default; }
.ed-name.fixed input:hover, .ed-name.fixed input:focus { background: none; border-color: transparent; }
.ed-name input:focus { background: var(--well); border-color: var(--cyan); }
.ed-save {
  border: 0; background: none; padding: 4px 2px; border-radius: 6px; font-size: 12px; flex: none;
  font-variant-numeric: tabular-nums;
}
.ed-save-box { display: inline-grid; justify-items: start; }
.ed-save-box > * { grid-area: 1 / 1; }
.ed-save-sz { visibility: hidden; }
.ed-save:hover:not(:disabled) .ed-save-t { text-decoration: underline; text-underline-offset: 3px; }
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
/* 编辑区太矮放不下整条时的小一号（和 usePaletteDock 里 PAL_METRICS.compact 是同一组数） */
.ed-pal.compact { padding: 4px; gap: 2px; }
.ed-pal.compact.v { width: 40px; }
.ed-pal.compact.h { height: 40px; }
.ed-pal.compact .lc-tb { width: 30px; height: 30px; border-radius: 8px; }
.ed-pal.compact.v hr { margin: 1px 4px; }
.ed-pal.compact.h hr { height: 16px; margin: 0 1px; }
.ed-pal .pal-over-h { transform: rotate(-90deg); }
/* 只读时的面板：一圈提醒色的边，最前面一枚「只读」标记（不是工具，是说明），后面只有看的、拿走的 */
.ed-pal.ro { border-color: rgb(var(--c-warn) / .45); }
.ed-pal .pal-ro { color: var(--warn); background: var(--warning-dim); }
.ed-pal .pal-ro:hover { background: rgb(var(--c-warn) / .22); color: var(--warn); }
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
.ed-pal.compact.v .pal-grip { width: 30px; height: 12px; }
.ed-pal.compact.h .pal-grip { width: 12px; height: 30px; }
.ed-pal.compact.v .pal-turn { height: 20px; }
.ed-pal.compact.h .pal-turn { width: 20px; }
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
/* 属性面板（布局 b）开着：底部工具条和它上面的小条往左让，别钻到面板底下；剩下的那一段比工具条还窄时
   （窗口 700–900 宽）工具条在自己里面横向滚动，不伸到面板底下、也不伸出编辑区 */
.ed.insp-open .ed-tools, .ed.insp-open .ed-undo { left: calc(50% - 166px); max-width: calc(100% - 332px - 32px); }
.ed.insp-open .ed-tools { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; justify-content: flex-start; }
.ed.insp-open .ed-tools::-webkit-scrollbar { display: none; }
/* 面板开着、工具面板躲不开它（见 palCovered）：先收起来 */
.ed-pal.under { visibility: hidden; pointer-events: none; }
/* 输入条 / 属性面板是贴底的抽屉时（手机宽度，或编辑区放不下「节点 + 输入条」）：抽屉压在最上面，底部工具条和它上面的
   小条被盖住一半比不出现更糟 —— 先收起来，抽屉一关就回来（小地图同理，见 miniCramped）。
   缩放用滚轮 / 双指照常；「运行」在抽屉里就有 */
.ed.panel-sheet .ed-tools, .ed.panel-sheet .ed-undo { visibility: hidden; pointer-events: none; }

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
.share-dialog.team { width: 580px; }
.share-h { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.share-tabs { display: flex; gap: 4px; padding: 0 20px; border-bottom: 1px solid var(--line); }
.share-tabs button {
  display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 14px; border: 0; background: none;
  color: var(--text-2); font-size: 14px; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.share-tabs button:hover { color: var(--text); }
.share-tabs button.on { color: var(--text); font-weight: 600; border-bottom-color: var(--cyan); }
.share-tabs button:focus-visible { outline: none; box-shadow: var(--ring); border-radius: 8px 8px 0 0; }
.share-err { margin: 12px 0 0; }
.ed-vis { border: 0; background: none; padding: 0; border-radius: 8px; flex: none; display: inline-flex; }
.ed-vis:focus-visible { outline: none; box-shadow: var(--ring); }
.ed-ro { flex: none; }
.ed-budget { flex: none; font-size: 11px; color: var(--text-3); white-space: nowrap; padding: 0 4px; }
.ed-budget.near { color: var(--warn); }
.ed-budget.reached { color: var(--err-soft); }
@media (max-width: 640px) { .ed-budget { display: none; } }
.share-tip { margin: 0 0 16px; }
.share-last { margin-bottom: 0; }
.share-ex { margin-top: 16px; }
p.share-ex { margin-bottom: 0; }
.share-expiry { align-self: flex-start; }
.share-link-row { display: flex; gap: 8px; }
.share-link-row .lc-input { flex: 1; min-width: 0; font-size: 12px; }
.share-link-row .lc-btn { height: 40px; flex: none; }

/* 手机上「没有模型」的提示条占着工具面板下面那一排：多选工具条让到底部工具条上面去 */
.ed.has-hint .st.phone { top: auto; bottom: 122px; }

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
  .ed-name-mirror { padding-right: 5px; }
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
  /* 只读时只剩缩放那三颗：不用铺满一整条，收到左边 */
  .ed.read-only .ed-tools { right: auto; }
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
