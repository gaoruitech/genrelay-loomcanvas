<template>
  <!-- 落地页「界面」一节的主体：五张卡片，每张是一幅示意图 + 标题 + 一两句话。
       示意图是用 HTML / CSS 画的（和首屏那张一样不整体缩放：里面的字写多大就是多大，最小 12px），
       颜色全部取令牌，两套主题共用一张图；只有「主题」那张的两块预览各套着一整组令牌（.lc-theme-dark / .lc-theme-light）。
       这里写的每一条都对得上产品里真有的东西：改了编辑器的行为，这里要跟着改。 -->
  <div class="ui">
    <!-- 一、三种节点布局：同一个节点在三种布局下的样子 -->
    <article class="uc lay lc-glass">
      <div class="art lay-art" role="img" :aria-label="t('landing.ui.lay.alt')">
        <div v-for="l in LAYOUTS" :key="l" class="lay-col" aria-hidden="true">
          <div class="stage" :class="'l-' + l">
            <!-- 结果优先：节点基本就是结果，选中后下方出一条输入条 -->
            <template v-if="l === 'a'">
              <div class="nd sel">
                <div class="nd-h"><LcIcon name="image" size="s" /><span>{{ t('landing.ui.lay.node') }}</span></div>
                <Pic />
                <div class="bars"><i class="w3" /><i class="w2" /><i class="w1" /></div>
              </div>
              <div class="comp"><span>{{ t('landing.ui.lay.prompt') }}</span><i class="go"><LcIcon name="play" size="s" /></i></div>
            </template>
            <!-- 紧凑 + 右侧面板：节点小，设置都在画布右缘的面板里 -->
            <template v-else-if="l === 'b'">
              <div class="nd sel small">
                <div class="nd-h"><LcIcon name="image" size="s" /><span>{{ t('landing.ui.lay.node') }}</span></div>
                <Pic />
                <div class="bars"><i class="w3" /><i class="go dot" /></div>
              </div>
              <div class="insp">
                <b>{{ t('landing.ui.lay.prompt') }}</b>
                <div class="box"><i class="w4" /><i class="w3" /></div>
                <div class="bars col"><i class="w4" /><i class="w2" /></div>
                <span class="runb">{{ t('landing.ui.lay.run') }}</span>
              </div>
            </template>
            <!-- 全部放在节点上：结果在上，提示词框、模型、参数、运行都在节点里 -->
            <template v-else>
              <div class="nd sel full">
                <div class="nd-h"><LcIcon name="image" size="s" /><span>{{ t('landing.ui.lay.node') }}</span></div>
                <Pic />
                <div class="box"><span>{{ t('landing.ui.lay.prompt') }}</span></div>
                <div class="bars"><i class="w2" /><i class="w1" /><i class="go"><LcIcon name="play" size="s" /></i></div>
              </div>
            </template>
          </div>
          <div class="lay-cap"><b>{{ t(`landing.ui.lay.${l}`) }}</b><span>{{ t(`landing.ui.lay.${l}Hint`) }}</span></div>
        </div>
      </div>
      <h3>{{ t('landing.ui.lay.title') }}</h3>
      <p>{{ t('landing.ui.lay.desc') }}</p>
    </article>

    <!-- 二、主题和语言：两块预览各用自己那套令牌，所以不管页面现在是哪套主题，左边永远是深色、右边永远是浅色 -->
    <article class="uc theme lc-glass">
      <div class="art th-art" role="img" :aria-label="t('landing.ui.theme.alt')">
        <div class="th-pair" aria-hidden="true">
            <span v-for="s in SIDES" :key="s" class="th-thumb" :class="`lc-theme-${s}`">
              <svg viewBox="0 0 168 104" preserveAspectRatio="xMidYMid slice">
                <rect class="bg" width="168" height="104" />
                <path class="grid" d="M0 26h168M0 52h168M0 78h168M42 0v104M84 0v104M126 0v104" />
                <rect class="bar" width="168" height="14" />
                <rect class="logo" x="6" y="4" width="6" height="6" rx="2" />
                <path class="t3" d="M16 7h18" />
                <circle class="av" cx="158" cy="7" r="3.2" />
                <rect class="card" x="14" y="28" width="58" height="62" rx="5" />
                <rect class="media" x="19" y="33" width="48" height="28" rx="3" />
                <path class="hill" d="M19 55l10-9 8 6 9-10 21 15v1a3 3 0 0 1-3 3H22a3 3 0 0 1-3-3z" />
                <path class="t2" d="M19 70h30" /><path class="t3" d="M19 78h42M19 84h24" />
                <rect class="card" x="96" y="36" width="58" height="46" rx="5" />
                <path class="t2" d="M102 46h26" />
                <rect class="well" x="101" y="53" width="48" height="10" rx="2.5" />
                <rect class="btn" x="125" y="68" width="24" height="9" rx="3" />
                <path class="wire" d="M72 58c12 0 12 1 24 1" />
                <circle class="port" cx="72" cy="58" r="2.2" /><circle class="port" cx="96" cy="59" r="2.2" />
              </svg>
            </span>
        </div>
        <div class="th-row" aria-hidden="true">
          <span class="th-modes"><span v-for="m in MODES" :key="m.k" class="lc-chip"><LcIcon :name="m.icon" size="s" />{{ t(`landing.ui.theme.${m.k}`) }}</span></span>
          <span class="th-lang"><LcIcon name="globe" size="s" /><span v-for="l in LOCALE_OPTIONS" :key="l.value" class="lc-chip o">{{ l.label }}</span></span>
        </div>
      </div>
      <h3>{{ t('landing.ui.theme.title') }}</h3>
      <p>{{ t('landing.ui.theme.desc') }}</p>
    </article>

    <!-- 三、工作区：挪了位置、转成横排的工具栏；选中三个节点时的工具条；带进度环的队列圆钮 -->
    <article class="uc arrange lc-glass">
      <div class="art ar-art" role="img" :aria-label="t('landing.ui.arrange.alt')">
        <div class="stage ar" aria-hidden="true">
          <i class="ar-ghost" />
          <div class="ar-pal">
            <LcIcon name="grip" size="s" class="dim" />
            <i v-for="n in PAL" :key="n"><LcIcon :name="n" size="s" /></i>
            <LcIcon name="turnv" size="s" class="dim" />
          </div>
          <div class="ar-bar">
            <span><LcIcon name="layout" size="s" />{{ t('landing.ui.arrange.align') }}</span>
            <span><LcIcon name="folder" size="s" />{{ t('landing.ui.arrange.group') }}</span>
            <span class="hot"><LcIcon name="play" size="s" />{{ t('landing.ui.arrange.runSel') }}</span>
          </div>
          <div class="ar-sel"><i class="mini" /><i class="mini" /><i class="mini out" /></div>
          <span class="lc-ring sm ar-fab"><span>2</span></span>
        </div>
      </div>
      <h3>{{ t('landing.ui.arrange.title') }}</h3>
      <p>{{ t('landing.ui.arrange.desc') }}</p>
    </article>

    <!-- 四、手机和触屏：手机上的编辑器，输入条是贴底的抽屉 -->
    <article class="uc phone lc-glass">
      <div class="art ph-art" role="img" :aria-label="t('landing.ui.phone.alt')">
        <div class="ph" aria-hidden="true">
          <div class="ph-scr">
            <div class="ph-top"><i class="ph-logo" /><b>{{ t('landing.hero.title') }}</b><span class="lc-st ok">{{ t('landing.hero.saved') }}</span></div>
            <div class="ph-pal"><i v-for="n in PAL_PHONE" :key="n"><LcIcon :name="n" size="s" /></i></div>
            <div class="stage ph-cv">
              <div class="nd sel">
                <div class="nd-h"><LcIcon name="video" size="s" /><span>{{ t('landing.hero.i2v') }}</span></div>
                <Pic />
              </div>
              <span class="lc-ring sm ph-fab"><span>1</span></span>
            </div>
            <div class="ph-sheet">
              <i class="grab" />
              <div class="box"><span>{{ t('landing.hero.promptText') }}</span></div>
              <div class="ph-row"><span class="lc-chip">Veo 3.1</span><span class="lc-chip">16:9</span><span class="lc-sp" /><span class="lc-btn primary sm"><LcIcon name="play" size="s" />{{ t('landing.hero.run') }}</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="txt">
        <h3>{{ t('landing.ui.phone.title') }}</h3>
        <p>{{ t('landing.ui.phone.desc') }}</p>
        <ul>
          <li v-for="b in PHONE_POINTS" :key="b"><LcIcon name="check" size="s" /><span>{{ t(`landing.ui.phone.${b}`) }}</span></li>
        </ul>
        <p class="note">{{ t('landing.ui.phone.note') }}</p>
      </div>
    </article>

    <!-- 五、键盘和输入：几组快捷键，和一个正在用输入法打字的节点 -->
    <article class="uc keys lc-glass">
      <div class="art kb-art" role="img" :aria-label="t('landing.ui.keys.alt')">
        <div class="kb-list" aria-hidden="true">
          <div v-for="s in SHORTCUTS" :key="s.k" class="kb-row">
            <span class="kb-keys"><kbd v-for="k in s.keys" :key="k">{{ k }}</kbd></span>
            <span>{{ t(`landing.ui.keys.${s.k}`) }}</span>
          </div>
          <small>{{ t('landing.ui.keys.mac') }}</small>
        </div>
        <div class="kb-ime" aria-hidden="true">
          <div class="nd sel">
            <div class="nd-h"><LcIcon name="image" size="s" /><span>{{ t('landing.ui.lay.node') }}</span></div>
            <div class="box"><span>{{ t('landing.ui.keys.imeText') }}<u>{{ t('landing.ui.keys.imeComp') }}</u><i class="caret" /></span></div>
            <div class="cand"><b>1 {{ t('landing.ui.keys.imeC1') }}</b><span>2 {{ t('landing.ui.keys.imeC2') }}</span></div>
          </div>
          <small>{{ t('landing.ui.keys.ime') }}</small>
        </div>
      </div>
      <div class="txt">
        <h3>{{ t('landing.ui.keys.title') }}</h3>
        <p>{{ t('landing.ui.keys.desc') }}</p>
      </div>
    </article>
  </div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { useI18n } from 'vue-i18n'
import { LOCALE_OPTIONS } from '@/locales'
import LcIcon from '@/components/LcIcon.vue'

const { t } = useI18n()

const LAYOUTS = ['a', 'b', 'c'] as const
const SIDES = ['dark', 'light'] as const
const MODES = [{ k: 'dark', icon: 'moon' }, { k: 'light', icon: 'sun' }, { k: 'system', icon: 'monitor' }] as const
const PAL = ['plus', 'text', 'image', 'video'] as const
const PAL_PHONE = ['plus', 'text', 'image', 'video', 'chat', 'more'] as const
const PHONE_POINTS = ['b0', 'b1', 'b2', 'b3'] as const
/** 和 docs/user-guide 的「快捷键」一章对得上 */
const SHORTCUTS = [
  { k: 'undo', keys: ['Ctrl', 'Z'] },
  { k: 'redo', keys: ['Ctrl', 'Shift', 'Z'] },
  { k: 'run', keys: ['Ctrl', 'Enter'] },
  { k: 'group', keys: ['Ctrl', 'G'] },
  { k: 'find', keys: ['Ctrl', 'F'] },
  { k: 'esc', keys: ['Esc'] },
] as const

/** 节点里那张「结果」：一小幅夜景，颜色取插画令牌（见样式里的 .pic） */
const Pic = () => h('svg', { class: 'pic', viewBox: '0 0 120 60', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' }, [
  h('rect', { class: 'p-sky', width: 120, height: 60 }),
  h('circle', { class: 'p-moon', cx: 92, cy: 16, r: 6 }),
  h('path', { class: 'p-far', d: 'M0 44l22-16 16 10 20-18 26 20 14-8 22 14v14H0z' }),
  h('path', { class: 'p-near', d: 'M0 52l30-12 24 8 28-12 38 14v10H0z' }),
])
</script>

<style scoped>
/* 宽屏三列：布局（两列宽）+ 手机（右边一列、两排高）/ 主题 + 工作区 / 键盘（整行） */
.ui { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin-top: 48px; }
.uc { display: flex; flex-direction: column; min-width: 0; padding: 24px; }
.uc.lay { grid-column: span 2; }
.uc.phone { grid-column: 3; grid-row: 1 / span 2; }
.uc.keys { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.7fr); gap: 32px; align-items: center; }
.uc.keys .art { order: 2; margin-bottom: 0; }

.uc h3 { font: 600 18px/1.4 var(--f-disp); color: var(--text); }
.uc p { color: var(--text-2); font-size: 14px; line-height: 1.7; margin-top: 6px; }
.uc ul { list-style: none; margin: 14px 0 0; padding: 0; display: grid; gap: 8px; }
.uc li { display: flex; gap: 10px; color: var(--text-2); font-size: 14px; line-height: 1.6; }
.uc li svg { flex: none; margin-top: 4px; color: var(--cyan); }
.uc .note { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); color: var(--text-3); font-size: 13px; }

/* 图框：卡片被同一排里更高的那张撑高时，多出来的高度给图框，文字都落在卡片底部、同一排对得齐 */
.art { flex: 1; display: flex; flex-direction: column; justify-content: center; margin-bottom: 20px; border-radius: 12px; border: 1px solid var(--line); background: rgb(var(--c-well) / .45); padding: 16px; min-width: 0; }
.stage { position: relative; border-radius: 10px; border: 1px solid var(--line); overflow: hidden; background-color: rgb(var(--c-chrome-0) / .5); background-image: radial-gradient(rgb(var(--c-film) / .2) 1px, transparent 1px); background-size: 16px 16px; }

/* ---- 图里通用的小件：节点、结果图、灰条、提示词框、运行钮 ---- */
.nd { width: 136px; flex: none; border-radius: 10px; border: 1px solid var(--line-2); background: var(--grad-node); box-shadow: var(--sh-1); overflow: hidden; }
.nd.sel { border-color: var(--cyan); }
.nd-h { height: 26px; display: flex; align-items: center; gap: 6px; padding: 0 8px; border-bottom: 1px solid var(--line); font: 600 12px/1 var(--f-body); color: var(--text); white-space: nowrap; }
.nd-h :deep(.lc-ic) { color: var(--cyan); flex: none; }
.nd-h span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pic { display: block; width: calc(100% - 12px); height: 52px; margin: 6px 6px 0; border-radius: 6px; }
.pic :deep(.p-sky) { fill: var(--art-sky-1); }
.pic :deep(.p-moon) { fill: var(--art-moon); }
.pic :deep(.p-far) { fill: var(--art-b1); }
.pic :deep(.p-near) { fill: var(--art-b2); }
.bars { display: flex; align-items: center; gap: 5px; padding: 7px 8px; }
.bars.col { flex-direction: column; align-items: stretch; padding: 0; gap: 6px; }
.bars i:not(.go) { height: 5px; border-radius: 3px; background: rgb(var(--c-film) / .28); }
.w1 { width: 18%; } .w2 { width: 26%; } .w3 { width: 40%; } .w4 { width: 100%; }
.bars.col .w2 { width: 60%; }
.box { margin: 6px 6px 0; padding: 5px 7px; border-radius: 6px; border: 1px solid var(--line); background: var(--well); color: var(--text-3); font-size: 12px; line-height: 1.5; display: grid; gap: 5px; }
.box i { height: 5px; border-radius: 3px; background: rgb(var(--c-film) / .28); }
.go { width: 20px; height: 20px; flex: none; margin-left: auto; border-radius: 6px; display: grid; place-items: center; background: var(--btn-bg); color: var(--btn-fg); }
.go :deep(.lc-ic) { width: 12px; height: 12px; }
.go.dot { width: 14px; height: 14px; border-radius: 50%; }

/* ---- 一、三种布局 ---- */
.lay-art { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; justify-content: stretch; align-content: center; }
.lay-col { min-width: 0; display: flex; flex-direction: column; }
.lay-col .stage { height: 190px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px; }
.stage.l-a { flex-direction: column; }
.comp { width: 168px; max-width: 100%; height: 30px; flex: none; display: flex; align-items: center; gap: 6px; padding: 0 5px 0 9px; border-radius: 9px; border: 1px solid var(--line-3); background: var(--glass-panel); box-shadow: var(--sh-1); color: var(--text-3); font-size: 12px; }
.comp span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stage.l-b { justify-content: flex-start; padding: 0 0 0 10px; }
.stage.l-b .nd { width: auto; flex: 1 1 0; max-width: 112px; margin: 0 auto; }
.nd.small .pic { height: 34px; }
.insp { align-self: stretch; width: 44%; max-width: 124px; flex: none; display: flex; flex-direction: column; gap: 8px; padding: 10px 9px; border-left: 1px solid var(--line-2); background: var(--glass-panel); }
.insp b { font: 600 12px/1.3 var(--f-body); color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.insp .box { margin: 0; padding: 7px; }
.runb { margin-top: auto; height: 24px; border-radius: 7px; display: grid; place-items: center; background: var(--btn-bg); color: var(--btn-fg); font: 600 12px/1 var(--f-body); }
.nd.full { width: 150px; }
.nd.full .pic { height: 44px; }
.lay-cap { margin-top: 10px; display: grid; gap: 2px; }
.lay-cap b { font: 600 13px/1.4 var(--f-disp); color: var(--text); }
.lay-cap span { font-size: 12px; line-height: 1.5; color: var(--text-3); }

/* ---- 二、主题：.th-thumb 里的取值都落在它自己那套令牌里，不跟页面当前的主题走 ---- */
/* 两扇窗一前一后叠着：深色在左上，浅色压在它的右下角 */
.th-pair { position: relative; width: 100%; max-width: 380px; margin: 0 auto; aspect-ratio: 300 / 172; }
.th-thumb { position: absolute; display: block; width: 64%; aspect-ratio: 168 / 104; border-radius: 9px; overflow: hidden; border: 1px solid var(--line-2); box-shadow: var(--sh-1); }
.th-thumb.lc-theme-dark { left: 0; top: 0; }
.th-thumb.lc-theme-light { right: 0; bottom: 0; }
.th-thumb svg { display: block; width: 100%; height: 100%; }
.th-thumb .bg { fill: var(--bg-0); }
.th-thumb .grid { fill: none; stroke: var(--grid-line); stroke-width: 1; }
.th-thumb .bar { fill: var(--panel-solid); opacity: .82; }
.th-thumb .logo { fill: var(--logo-plate); stroke: var(--hue-cyan); stroke-width: 1; }
.th-thumb .av { fill: var(--hue-violet); }
.th-thumb .card { fill: var(--mock-node); stroke: var(--line-2); stroke-width: 1; }
.th-thumb .media { fill: var(--art-sky-1); }
.th-thumb .hill { fill: var(--art-sky-2); opacity: .85; }
.th-thumb .well { fill: var(--well-solid); stroke: var(--line); stroke-width: .8; }
.th-thumb .btn { fill: var(--btn-bg); }
.th-thumb .t2, .th-thumb .t3 { fill: none; stroke-linecap: round; }
.th-thumb .t2 { stroke: var(--text-2); stroke-width: 2; }
.th-thumb .t3 { stroke: var(--text-3); stroke-width: 2; }
.th-thumb .wire { fill: none; stroke: var(--hue-sky); stroke-width: 1.4; }
.th-thumb .port { fill: var(--port-bg); stroke: var(--cyan); stroke-width: 1; }
.th-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line); }
.th-modes { display: inline-flex; flex-wrap: wrap; gap: 6px; }
.th-lang { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); }

/* ---- 三、工作区 ---- */
.stage.ar { height: 214px; }
.ar-ghost { position: absolute; left: 10px; top: 46px; width: 30px; height: 122px; border-radius: 10px; border: 1px dashed var(--line-3); }
.ar-pal, .ar-bar { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; border-radius: 10px; border: 1px solid var(--line-2); background: var(--glass-panel); box-shadow: var(--sh-1); white-space: nowrap; }
.ar-pal { top: 10px; gap: 2px; padding: 3px 6px; color: var(--text-2); }
.ar-pal i { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; }
.ar-pal i:first-of-type { background: rgb(var(--c-cyan) / .14); color: var(--cyan); }
.dim { color: var(--text-3); }
.ar-bar { top: 62px; gap: 2px; padding: 3px; font-size: 12px; color: var(--text-2); }
.ar-bar span { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border-radius: 7px; }
.ar-bar .hot { background: rgb(var(--c-cyan) / .14); color: var(--cyan-soft); }
.ar-sel { position: absolute; left: 50%; top: 104px; transform: translateX(-50%); display: flex; align-items: center; gap: 14px; padding: 10px 12px; border-radius: 8px; border: 1px dashed var(--sel-line); background: var(--sel-fill); }
.mini { width: 44px; height: 34px; border-radius: 7px; border: 1px solid var(--cyan); background: var(--grad-node); }
.mini.out { height: 44px; background: var(--art-sky-1); }
.ar-fab { position: absolute; right: 10px; bottom: 10px; --p: 64; font-size: 12px; box-shadow: var(--sh-1); }

/* ---- 四、手机 ---- */
.ph-art { align-items: center; }
.ph { width: 262px; max-width: 100%; flex: none; padding: 7px; border-radius: 30px; border: 1px solid var(--line-3); background: var(--panel-solid); box-shadow: var(--sh-2); }
.ph-scr { border-radius: 23px; overflow: hidden; border: 1px solid var(--line); background: var(--bg-0); }
.ph-top { height: 38px; display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--line); background: var(--panel-solid); font-size: 12px; white-space: nowrap; }
.ph-top b { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-weight: 600; color: var(--text); }
.ph-top .lc-st { font-size: 12px; flex: none; }
.ph-logo { width: 16px; height: 16px; flex: none; border-radius: 5px; background: var(--grad-btn); }
.ph-pal { display: flex; justify-content: space-between; padding: 4px 10px; border-bottom: 1px solid var(--line); background: var(--glass-panel); color: var(--text-2); }
.ph-pal i { width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; }
.ph-pal i:first-child { background: rgb(var(--c-cyan) / .14); color: var(--cyan); }
.stage.ph-cv { height: 196px; padding-bottom: 12px; display: grid; place-items: center; border: 0; border-radius: 0; }
.ph-cv .nd { width: 156px; }
.ph-cv .pic { height: 72px; margin-bottom: 6px; }
.ph-fab { position: absolute; right: 8px; bottom: 20px; --p: 40; --s: 34px; font-size: 12px; box-shadow: var(--sh-1); }
.ph-sheet { position: relative; margin-top: -12px; padding: 8px 10px 12px; border-radius: 16px 16px 0 0; border-top: 1px solid var(--line-3); background: var(--panel-solid); box-shadow: var(--sh-1); }
.grab { display: block; width: 36px; height: 4px; margin: 0 auto 8px; border-radius: 2px; background: rgb(var(--c-film) / .35); }
.ph-sheet .box { margin: 0; padding: 7px 9px; color: var(--text-2); }
.ph-sheet .box span { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
.ph-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.ph-row .lc-btn { pointer-events: none; flex: none; }

/* ---- 五、键盘和输入 ---- */
.kb-art { flex-direction: row; align-items: center; gap: 24px; }
.kb-list { flex: 1 1 0; min-width: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 20px; }
.kb-row { display: flex; align-items: center; gap: 10px; min-width: 0; font-size: 13px; color: var(--text-2); }
.kb-row > span:last-child { min-width: 0; }
.kb-keys { display: inline-flex; gap: 4px; flex: none; }
kbd { min-width: 26px; height: 24px; padding: 0 6px; display: inline-grid; place-items: center; border-radius: 6px; border: 1px solid var(--line-2); border-bottom-width: 2px; background: var(--panel-2); color: var(--text); font: 500 12px/1 var(--f-mono); }
.kb-art small { font-size: 12px; line-height: 1.5; color: var(--text-3); }
.kb-list small { grid-column: 1 / -1; }
.kb-ime { flex: none; display: grid; justify-items: center; gap: 10px; }
.kb-ime .nd { width: 190px; overflow: visible; padding-bottom: 8px; }
.kb-ime .box { color: var(--text); }
.kb-ime u { text-decoration: underline dotted; text-underline-offset: 3px; color: var(--cyan-soft); margin-left: 1px; }
.caret { display: inline-block; width: 1px; height: 13px; margin-left: 1px; vertical-align: -2px; background: var(--cyan); animation: ui-blink 1.1s steps(1) infinite; }
.cand { display: inline-flex; gap: 10px; margin: 5px 0 0 70px; padding: 4px 9px; border-radius: 7px; border: 1px solid var(--line-2); background: var(--panel-solid); box-shadow: var(--sh-1); font-size: 12px; color: var(--text-2); white-space: nowrap; }
.cand b { font-weight: 600; color: var(--cyan-soft); }
@keyframes ui-blink { 50% { opacity: 0; } }

/* 两列：布局、手机、键盘各占一整行；手机那张横过来（图在左、字在右） */
@media (max-width: 1100px) {
  .ui { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .uc.lay, .uc.phone, .uc.keys { grid-column: 1 / -1; grid-row: auto; }
  /* 两列时图那一边窄：多分一点给它，快捷键的说明才不折行 */
  .uc.keys { grid-template-columns: minmax(0, 1fr) minmax(0, 2.2fr); gap: 24px; }
  .kb-art { gap: 16px; }
  .kb-list { column-gap: 12px; }
  .kb-ime .nd { width: 172px; }
  .uc.phone { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 32px; align-items: center; }
  .uc.phone .art { margin-bottom: 0; padding: 20px 28px; }
}
@media (max-width: 820px) {
  .uc.keys { display: flex; }
  .uc.keys .art { order: 0; margin-bottom: 20px; }
}
@media (max-width: 600px) {
  .ui { grid-template-columns: minmax(0, 1fr); gap: 12px; margin-top: 28px; }
  .uc { padding: 18px; }
  .art { padding: 10px; margin-bottom: 16px; }
  .uc.phone { display: flex; }
  .uc.phone .art { margin-bottom: 16px; padding: 16px 10px; }
  /* 三种布局在手机上竖着排：每一种一行，图在上、名字在下 */
  .lay-art { grid-template-columns: minmax(0, 1fr); gap: 16px; }
  .lay-col .stage { height: 176px; }
  .kb-art { flex-direction: column; align-items: stretch; gap: 16px; }
  .kb-list { grid-template-columns: minmax(0, 1fr); }
  .kb-ime { padding-top: 16px; border-top: 1px solid var(--line); }
}
</style>
